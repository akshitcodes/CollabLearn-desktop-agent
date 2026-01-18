// ===========================================
// Phase Orchestrator Service
// ===========================================
// Orchestrates auto-execution of all tasks within a phase.
// Handles sequential execution, blocker detection, and status sync.

import { Observable, Subject, Subscription } from 'rxjs';
import { Task } from '../../shared/types';
import { AgentOutput, TaskPrompt } from '../agents/types';
import { agentManager } from './AgentManager';
import { SyncService } from './SyncService';
import { ContextBridge } from './ContextBridge';

// Blocker detection patterns
const BLOCKER_PATTERNS = [
  /BLOCKED:/i,
  /🚫/,
  /cannot proceed/i,
  /missing.*required/i,
  /waiting for.*input/i,
  /need.*clarification/i,
  /unable to continue/i,
  /blocked by/i,
];

export interface PhaseExecutionOptions {
  phaseId: number;
  workspaceId: number;
  agentId: string;
  projectPath: string;
}

export interface TaskResult {
  taskId: number;
  taskTitle: string;
  status: 'completed' | 'failed' | 'blocked' | 'skipped';
  blockerReason?: string;
  duration: number; // ms
  output: string;
}

export interface PhaseResult {
  phaseId: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksBlocked: number;
  tasksSkipped: number;
  results: TaskResult[];
  stoppedByUser: boolean;
  blockerReason?: string;
  totalDuration: number;
}

export interface PhaseExecutionEvents {
  onTaskStart: (task: Task) => void;
  onTaskComplete: (task: Task, result: TaskResult) => void;
  onTaskOutput: (task: Task, output: AgentOutput) => void;
  onBlocker: (task: Task, reason: string) => void;
  onPhaseComplete: (result: PhaseResult) => void;
}

/**
 * PhaseOrchestrator - Auto-executes all tasks in a phase sequentially
 */
export class PhaseOrchestrator {
  private isRunning = false;
  private shouldStop = false;
  private currentTaskSubscription: Subscription | null = null;
  private currentProcessId: string | null = null;

  /**
   * Execute all pending tasks in a phase
   */
  async executePhase(
    options: PhaseExecutionOptions,
    events: Partial<PhaseExecutionEvents>
  ): Promise<PhaseResult> {
    if (this.isRunning) {
      throw new Error('Phase execution already in progress');
    }

    this.isRunning = true;
    this.shouldStop = false;

    const startTime = Date.now();
    const results: TaskResult[] = [];

    try {
      // Ensure context is synced before starting
      console.log(`📦 [ORCHESTRATOR] Syncing context for workspace ${options.workspaceId}...`);
      await ContextBridge.syncContext(
        options.projectPath,
        options.agentId,
        options.workspaceId
      );

      // Fetch tasks for the phase
      console.log(`📋 [ORCHESTRATOR] Fetching tasks for phase ${options.phaseId}...`);
      const allTasks = await SyncService.fetchTasksByPhase(options.phaseId);
      
      // Filter to pending/in_progress tasks only
      const pendingTasks = allTasks.filter(
        t => t.status === 'pending' || t.status === 'in_progress'
      );

      console.log(`🎯 [ORCHESTRATOR] Found ${pendingTasks.length} pending tasks to execute`);

      if (pendingTasks.length === 0) {
        return {
          phaseId: options.phaseId,
          tasksCompleted: 0,
          tasksFailed: 0,
          tasksBlocked: 0,
          tasksSkipped: 0,
          results: [],
          stoppedByUser: false,
          totalDuration: Date.now() - startTime,
        };
      }

      // Execute each task sequentially
      for (const task of pendingTasks) {
        if (this.shouldStop) {
          console.log(`⏹️ [ORCHESTRATOR] Stop requested, skipping remaining tasks`);
          // Mark remaining tasks as skipped
          results.push({
            taskId: task.id,
            taskTitle: task.title,
            status: 'skipped',
            duration: 0,
            output: 'Skipped by user',
          });
          continue;
        }

        events.onTaskStart?.(task);

        const taskResult = await this.executeTask(
          task,
          options,
          events
        );

        results.push(taskResult);
        events.onTaskComplete?.(task, taskResult);

        // If blocked, stop execution and notify
        if (taskResult.status === 'blocked') {
          events.onBlocker?.(task, taskResult.blockerReason || 'Unknown blocker');
          console.log(`🚫 [ORCHESTRATOR] Task blocked, stopping phase execution`);
          break;
        }

        // If failed, continue to next task but log it
        if (taskResult.status === 'failed') {
          console.log(`❌ [ORCHESTRATOR] Task failed, continuing to next...`);
        }
      }

      // Calculate final stats
      const phaseResult: PhaseResult = {
        phaseId: options.phaseId,
        tasksCompleted: results.filter(r => r.status === 'completed').length,
        tasksFailed: results.filter(r => r.status === 'failed').length,
        tasksBlocked: results.filter(r => r.status === 'blocked').length,
        tasksSkipped: results.filter(r => r.status === 'skipped').length,
        results,
        stoppedByUser: this.shouldStop,
        blockerReason: results.find(r => r.status === 'blocked')?.blockerReason,
        totalDuration: Date.now() - startTime,
      };

      events.onPhaseComplete?.(phaseResult);
      return phaseResult;

    } finally {
      this.isRunning = false;
      this.shouldStop = false;
      this.currentTaskSubscription = null;
      this.currentProcessId = null;
    }
  }

  /**
   * Execute a single task and detect blockers
   */
  private async executeTask(
    task: Task,
    options: PhaseExecutionOptions,
    events: Partial<PhaseExecutionEvents>
  ): Promise<TaskResult> {
    const taskStartTime = Date.now();
    let taskOutput = '';
    let blockerDetected = false;
    let blockerReason: string | undefined;

    return new Promise((resolve) => {
      const taskPrompt: TaskPrompt = {
        id: String(task.id),
        title: task.title,
        description: task.description || '',
        projectPath: options.projectPath,
        workspaceId: options.workspaceId,
      };

      // Update status to IN_PROGRESS
      SyncService.updateTaskStatus(task.id, 'in_progress').catch(err => {
        console.error(`Failed to update task status:`, err);
      });

      const processId = `phase-${options.phaseId}-task-${task.id}-${Date.now()}`;
      this.currentProcessId = processId;

      const output$ = agentManager.executeTask(options.agentId, taskPrompt, processId);

      this.currentTaskSubscription = output$.subscribe({
        next: (output: AgentOutput) => {
          taskOutput += output.data + '\n';
          events.onTaskOutput?.(task, output);

          // Check for blocker patterns in output
          if (!blockerDetected && this.detectBlocker(output.data)) {
            blockerDetected = true;
            blockerReason = this.extractBlockerReason(output.data);
            console.log(`🚫 [ORCHESTRATOR] Blocker detected: ${blockerReason}`);
          }
        },
        error: (error) => {
          console.error(`❌ [ORCHESTRATOR] Task execution error:`, error);
          resolve({
            taskId: task.id,
            taskTitle: task.title,
            status: 'failed',
            duration: Date.now() - taskStartTime,
            output: taskOutput + `\n\nError: ${error.message}`,
          });
        },
        complete: () => {
          const duration = Date.now() - taskStartTime;

          if (blockerDetected) {
            // Update status to BLOCKED
            SyncService.updateTaskStatus(task.id, 'blocked').catch(err => {
              console.error(`Failed to update task status:`, err);
            });

            resolve({
              taskId: task.id,
              taskTitle: task.title,
              status: 'blocked',
              blockerReason,
              duration,
              output: taskOutput,
            });
          } else {
            // Update status to DONE
            SyncService.updateTaskStatus(task.id, 'completed').catch(err => {
              console.error(`Failed to update task status:`, err);
            });

            resolve({
              taskId: task.id,
              taskTitle: task.title,
              status: 'completed',
              duration,
              output: taskOutput,
            });
          }
        },
      });
    });
  }

  /**
   * Detect if output contains a blocker pattern
   */
  private detectBlocker(output: string): boolean {
    for (const pattern of BLOCKER_PATTERNS) {
      if (pattern.test(output)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Extract blocker reason from output
   */
  private extractBlockerReason(output: string): string {
    // Try to find a line containing the blocker
    const lines = output.split('\n');
    for (const line of lines) {
      for (const pattern of BLOCKER_PATTERNS) {
        if (pattern.test(line)) {
          return line.trim().slice(0, 200); // Limit to 200 chars
        }
      }
    }
    return 'Task reported a blocker';
  }

  /**
   * Stop execution after current task completes
   */
  stopAfterCurrentTask(): void {
    console.log('⏸️ [ORCHESTRATOR] Stop requested - will stop after current task');
    this.shouldStop = true;
  }

  /**
   * Force stop immediately (kills current process)
   */
  async forceStop(): Promise<void> {
    console.log('⏹️ [ORCHESTRATOR] Force stopping execution');
    this.shouldStop = true;

    if (this.currentTaskSubscription) {
      this.currentTaskSubscription.unsubscribe();
    }

    if (this.currentProcessId) {
      try {
        await agentManager.stopExecution(this.currentProcessId);
      } catch (error) {
        console.error('Failed to stop execution:', error);
      }
    }
  }

  /**
   * Check if phase execution is in progress
   */
  isExecuting(): boolean {
    return this.isRunning;
  }
}

// Singleton instance
export const phaseOrchestrator = new PhaseOrchestrator();
export default phaseOrchestrator;
