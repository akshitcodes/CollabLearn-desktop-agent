import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getVersion: () => ipcRenderer.invoke('app:version'),

  // Agent operations (will be implemented)
  agents: {
    getAvailable: () => ipcRenderer.invoke('agents:getAvailable'),
    execute: (agentId: string, taskId: string) => 
      ipcRenderer.invoke('agents:execute', agentId, taskId),
    executeTest: (agentId: string, task: { title: string; description: string; projectPath: string; context?: string; taskId?: number; model?: string }) =>
      ipcRenderer.invoke('agents:executeTest', agentId, task),
    stop: (processId: string) => ipcRenderer.invoke('agents:stop', processId),
    refresh: () => ipcRenderer.invoke('agents:refresh'),
    summarize: (agentId: string, taskTitle: string, output: string) =>
      ipcRenderer.invoke('agents:summarize', agentId, taskTitle, output),
    listModels: (agentId: string) => ipcRenderer.invoke('agents:listModels', agentId),
  },

  // Sync operations
  sync: {
    fetchWorkspaces: () => ipcRenderer.invoke('sync:fetchWorkspaces'),
    fetchPhases: (workspaceId: number) => 
      ipcRenderer.invoke('sync:fetchPhases', workspaceId),
    fetchTasks: (workspaceId: number) => 
      ipcRenderer.invoke('sync:fetchTasks', workspaceId),
    fetchTasksByPhase: (phaseId: number) =>
      ipcRenderer.invoke('sync:fetchTasksByPhase', phaseId),
    updateTaskStatus: (taskId: number, status: string) =>
      ipcRenderer.invoke('sync:updateTaskStatus', taskId, status),
    fetchRoadmapOverview: (workspaceId: number) =>
      ipcRenderer.invoke('sync:fetchRoadmapOverview', workspaceId),
  },

  // Auth operations
  auth: {
    login: (token: string) => ipcRenderer.invoke('auth:login', token),
    logout: () => ipcRenderer.invoke('auth:logout'),
    isAuthenticated: () => ipcRenderer.invoke('auth:isAuthenticated'),
    getUser: () => ipcRenderer.invoke('auth:getUser'),
    validateToken: () => ipcRenderer.invoke('auth:validateToken'),
  },

  // Config operations
  config: {
    get: (key: string) => ipcRenderer.invoke('config:get', key),
    set: (key: string, value: unknown) => 
      ipcRenderer.invoke('config:set', key, value),
  },

  // Workspace directory operations
  workspace: {
    getDirectory: (workspaceId: number) => 
      ipcRenderer.invoke('workspace:getDirectory', workspaceId),
    setDirectory: (workspaceId: number, path: string) =>
      ipcRenderer.invoke('workspace:setDirectory', workspaceId, path),
    selectDirectory: () => 
      ipcRenderer.invoke('workspace:selectDirectory'),
  },

  // Execution logs (persisted output)
  logs: {
    get: (taskId: number) => ipcRenderer.invoke('logs:get', taskId),
    set: (taskId: number, outputs: Array<{ type: string; data: string; timestamp: number }>) =>
      ipcRenderer.invoke('logs:set', taskId, outputs),
    clear: (taskId: number) => ipcRenderer.invoke('logs:clear', taskId),
    getStatus: (taskId: number) => ipcRenderer.invoke('logs:getStatus', taskId),
  },

  // Phase orchestration (auto-mode)
  phase: {
    execute: (options: { phaseId: number; workspaceId: number; agentId: string; projectPath: string }) =>
      ipcRenderer.invoke('phase:execute', options),
    stop: (immediately = false) => ipcRenderer.invoke('phase:stop', immediately),
    isExecuting: () => ipcRenderer.invoke('phase:isExecuting'),
  },

  // Context sync (CollabLearn context files)
  context: {
    sync: (options: { projectPath: string; agentId: string; workspaceId: number; forceRefresh?: boolean }) =>
      ipcRenderer.invoke('context:sync', options),
    hasLocal: (options: { projectPath: string; agentId: string }) =>
      ipcRenderer.invoke('context:hasLocal', options),
  },

  // Event listeners for streaming output
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => 
      callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
});

// Type declaration for renderer
export type ElectronAPI = typeof window.electronAPI;
