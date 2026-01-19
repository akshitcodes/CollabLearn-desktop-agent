import { ipcMain, IpcMainInvokeEvent, dialog } from 'electron';
import { ConfigStore, StoreSchema } from '../services/ConfigStore';
import { agentManager } from '../services/AgentManager';
import { AuthService } from '../services/AuthService';
import { SyncService } from '../services/SyncService';

// ===========================================
// IPC Handlers
// ===========================================
// Type-safe IPC handler registration.
// Each handler corresponds to a channel exposed in preload.ts

type IpcHandler<T = unknown, R = unknown> = (
  event: IpcMainInvokeEvent,
  ...args: T[]
) => Promise<R> | R;

/**
 * Register all IPC handlers
 * Call this from main process on app ready
 */
export function registerIpcHandlers(): void {
  // === Config handlers ===
  ipcMain.handle('config:get', (_event, key: keyof StoreSchema) => {
    return ConfigStore.get(key);
  });

  ipcMain.handle('config:set', (_event, key: keyof StoreSchema, value: unknown) => {
    // Type assertion needed for dynamic key access
    (ConfigStore as any).set(key, value);
    return true;
  });

  // === Auth handlers ===
  ipcMain.handle('auth:login', async (_event, token: string) => {
    const result = await AuthService.login(token);
    if (result.success && result.user) {
      return { success: true, user: result.user };
    }
    return { success: false, error: result.error };
  });

  ipcMain.handle('auth:logout', () => {
    AuthService.logout();
    return { success: true };
  });

  ipcMain.handle('auth:isAuthenticated', () => {
    return AuthService.isAuthenticated();
  });

  ipcMain.handle('auth:getUser', () => {
    return AuthService.getUser();
  });

  ipcMain.handle('auth:validateToken', async () => {
    return AuthService.validateToken();
  });

  // === Agent handlers ===
  ipcMain.handle('agents:getAvailable', async () => {
    return agentManager.getAvailableAgents();
  });

  ipcMain.handle('agents:refresh', async () => {
    await agentManager.refreshAgents();
    return { success: true };
  });

  ipcMain.handle('agents:execute', async (_event, agentId: string, taskId: string) => {
    // TODO: Fetch task details from sync service or expect full task object
    console.log(`Execute request: agent=${agentId}, task=${taskId}`);
    // For now, return a stub - full execution will be wired in Phase 4
    return { processId: `${agentId}-${taskId}-${Date.now()}` };
  });

  // Execute a task with an agent
  // This handler updates backend status on completion even if renderer modal is closed
  ipcMain.handle('agents:executeTest', async (event, agentId: string, taskInput: {
    title: string;
    description: string;
    projectPath: string;
    context?: string;
    taskId?: number;  // Real task ID for status updates
    model?: string;   // AI model to use for execution
  }) => {
    console.log(`🧪 Task execution: agent=${agentId}, path=${taskInput.projectPath}, taskId=${taskInput.taskId || 'test'}, model=${taskInput.model || 'default'}`);
    
    const task = {
      id: taskInput.taskId ? `task-${taskInput.taskId}` : `test-${Date.now()}`,
      title: taskInput.title,
      description: taskInput.description,
      context: taskInput.context,
      projectPath: taskInput.projectPath,
      model: taskInput.model,  // Pass model to task
    };
    
    const processId = `${agentId}-${task.id}-${Date.now()}`;
    const realTaskId = taskInput.taskId; // Store for status updates

    // Persist execution meta so UI can recover even if modal closes
    if (realTaskId) {
      ConfigStore.setExecutionMeta(realTaskId, { processId, status: 'running' });
      // Also ensure backend is set to IN_PROGRESS from main process
      try {
        await SyncService.updateTaskStatus(realTaskId, 'in_progress');
      } catch (err) {
        console.error('Failed to set task in_progress (main):', err);
      }
    }

    try {
      const observable = agentManager.executeTask(agentId, task, processId);

      let hasError = false;

      // Stream output to renderer and persist logs regardless of modal lifecycle
      observable.subscribe({
        next: (output) => {
          event.sender.send(`agent:output:${processId}`, output);

          if (realTaskId) {
            ConfigStore.appendExecutionOutput(realTaskId, output);
          }

          // Track if we had an error
          if (output.type === 'error') {
            hasError = true;
          }
        },
        error: async (error) => {
          const out = {
            type: 'error',
            data: error.message || 'Unknown error',
            timestamp: Date.now(),
          };
          event.sender.send(`agent:output:${processId}`, out);

          if (realTaskId) {
            ConfigStore.appendExecutionOutput(realTaskId, out);
            ConfigStore.setExecutionMeta(realTaskId, { status: 'failed' });
          }

          // Update backend status to blocked on error (in main process)
          if (realTaskId) {
            try {
              await SyncService.updateTaskStatus(realTaskId, 'blocked');
              console.log(`❌ Task ${realTaskId} status updated to: BLOCKED (error)`);
            } catch (err) {
              console.error('Failed to update task status on error:', err);
            }
          }
        },
        complete: async () => {
          console.log(`✅ Execution completed: ${processId}`);

          if (realTaskId) {
            ConfigStore.setExecutionMeta(realTaskId, { status: hasError ? 'failed' : 'completed' });
          }

          // Update backend status on completion (in main process)
          // This works even if the modal is closed!
          if (realTaskId) {
            try {
              const finalStatus = hasError ? 'blocked' : 'completed';
              await SyncService.updateTaskStatus(realTaskId, finalStatus);
              console.log(`✅ Task ${realTaskId} status updated to: ${finalStatus.toUpperCase()}`);
            } catch (err) {
              console.error('Failed to update task status on complete:', err);
            }
          }
        },
      });

      return { processId };
    } catch (error) {
      console.error('Failed to execute task:', error);
      if (realTaskId) {
        ConfigStore.setExecutionMeta(realTaskId, { status: 'failed' });
      }
      throw error;
    }
  });

  ipcMain.handle('agents:stop', async (_event, processId: string) => {
    await agentManager.stopExecution(processId);
    return { success: true };
  });

  // Generate a summary of task output using the agent
  ipcMain.handle('agents:summarize', async (_event, agentId: string, taskTitle: string, output: string) => {
    try {
      const summary = await agentManager.generateSummary(agentId, taskTitle, output);
      return { success: true, summary };
    } catch (error) {
      console.error('Failed to generate summary:', error);
      return { success: false, summary: 'Task completed successfully' };
    }
  });

  // List available AI models for an agent
  ipcMain.handle('agents:listModels', async (_event, agentId: string) => {
    try {
      const adapter = agentManager.getAdapter(agentId);
      if (adapter?.getAvailableModels) {
        return { success: true, models: adapter.getAvailableModels() };
      }
      return { success: false, models: [] };
    } catch (error) {
      console.error('Failed to list models:', error);
      return { success: false, models: [] };
    }
  });

  // === Sync handlers ===
  ipcMain.handle('sync:fetchWorkspaces', async () => {
    try {
      return await SyncService.fetchWorkspaces();
    } catch (error) {
      console.error('Failed to fetch workspaces:', error);
      throw error;
    }
  });

  ipcMain.handle('sync:fetchPhases', async (_event, workspaceId: number) => {
    try {
      return await SyncService.fetchPhases(workspaceId);
    } catch (error) {
      console.error('Failed to fetch phases:', error);
      throw error;
    }
  });

  ipcMain.handle('sync:fetchTasks', async (_event, workspaceId: number) => {
    try {
      return await SyncService.fetchTasks(workspaceId);
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
      throw error;
    }
  });

  ipcMain.handle('sync:fetchTasksByPhase', async (_event, phaseId: number) => {
    try {
      return await SyncService.fetchTasksByPhase(phaseId);
    } catch (error) {
      console.error('Failed to fetch tasks by phase:', error);
      throw error;
    }
  });

  ipcMain.handle('sync:updateTaskStatus', async (_event, taskId: number, status: string) => {
    try {
      await SyncService.updateTaskStatus(taskId, status);
      return { success: true };
    } catch (error) {
      console.error('Failed to update task status:', error);
      throw error;
    }
  });

  ipcMain.handle('sync:fetchRoadmapOverview', async (_event, workspaceId: number) => {
    try {
      return await SyncService.fetchRoadmapOverview(workspaceId);
    } catch (error) {
      console.error('Failed to fetch roadmap overview:', error);
      throw error;
    }
  });

  // === Workspace Directory handlers ===
  ipcMain.handle('workspace:getDirectory', (_event, workspaceId: number) => {
    return ConfigStore.getWorkspaceDirectory(workspaceId);
  });

  ipcMain.handle('workspace:setDirectory', (_event, workspaceId: number, directoryPath: string) => {
    ConfigStore.setWorkspaceDirectory(workspaceId, directoryPath);
    return { success: true };
  });

  ipcMain.handle('workspace:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Project Folder',
      buttonLabel: 'Select Folder',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, path: null };
    }

    return { canceled: false, path: result.filePaths[0] };
  });

  // === Execution Logs handlers ===
  ipcMain.handle('logs:get', (_event, taskId: number) => {
    return ConfigStore.getExecutionLogs(taskId);
  });

  ipcMain.handle('logs:set', (_event, taskId: number, outputs: Array<{ type: string; data: string; timestamp: number }>) => {
    ConfigStore.setExecutionLogs(taskId, outputs);
    return { success: true };
  });

  ipcMain.handle('logs:getStatus', (_event, taskId: number) => {
    const meta = ConfigStore.getExecutionLogs(taskId);
    const processId = meta?.processId || null;
    // Check live process status first, fall back to persisted status
    const agentStatus = processId ? agentManager.getExecutionStatus(processId) : null;
    const status = agentStatus ?? meta?.status ?? null;
    return { processId, status };
  });

  ipcMain.handle('logs:clear', (_event, taskId: number) => {
    ConfigStore.clearExecutionLogs(taskId);
    return { success: true };
  });

  // === Phase Orchestration handlers ===
  // Import dynamically to avoid circular imports
  ipcMain.handle('phase:execute', async (event, options: {
    phaseId: number;
    workspaceId: number;
    agentId: string;
    projectPath: string;
  }) => {
    const { phaseOrchestrator } = await import('../services/PhaseOrchestrator');
    
    console.log(`🚀 [IPC] Phase execution: phase=${options.phaseId}, workspace=${options.workspaceId}`);
    
    const result = await phaseOrchestrator.executePhase(options, {
      onTaskStart: (task) => {
        event.sender.send('phase:taskStart', task);
      },
      onTaskComplete: (task, taskResult) => {
        event.sender.send('phase:taskComplete', { task, result: taskResult });
      },
      onTaskOutput: (task, output) => {
        event.sender.send('phase:taskOutput', { taskId: task.id, output });
      },
      onBlocker: (task, reason) => {
        event.sender.send('phase:blocker', { task, reason });
      },
      onPhaseComplete: (phaseResult) => {
        event.sender.send('phase:complete', phaseResult);
      },
    });
    
    return result;
  });

  ipcMain.handle('phase:stop', async (_event, immediately = false) => {
    const { phaseOrchestrator } = await import('../services/PhaseOrchestrator');
    
    if (immediately) {
      await phaseOrchestrator.forceStop();
    } else {
      phaseOrchestrator.stopAfterCurrentTask();
    }
    
    return { success: true };
  });

  ipcMain.handle('phase:isExecuting', async () => {
    const { phaseOrchestrator } = await import('../services/PhaseOrchestrator');
    return phaseOrchestrator.isExecuting();
  });

  // === Context Sync handlers ===
  ipcMain.handle('context:sync', async (_event, options: {
    projectPath: string;
    agentId: string;
    workspaceId: number;
    forceRefresh?: boolean;
  }) => {
    const { ContextBridge } = await import('../services/ContextBridge');
    
    console.log(`📦 [IPC] Context sync: workspace=${options.workspaceId}, agent=${options.agentId}`);
    
    const result = await ContextBridge.syncContext(
      options.projectPath,
      options.agentId,
      options.workspaceId,
      options.forceRefresh
    );
    
    return result;
  });

  ipcMain.handle('context:hasLocal', async (_event, options: {
    projectPath: string;
    agentId: string;
  }) => {
    const { ContextBridge } = await import('../services/ContextBridge');
    return ContextBridge.hasLocalContext(options.projectPath, options.agentId);
  });

  console.log('✅ IPC handlers registered');
}

/**
 * Helper to create typed IPC handlers
 */
export function createHandler<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> | TResult
): void {
  ipcMain.handle(channel, handler as IpcHandler);
}
