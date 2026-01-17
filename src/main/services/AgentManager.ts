import { Subject, Observable } from 'rxjs';
import { ChildProcess } from 'child_process';
import { AgentAdapter, AgentInfo, AgentOutput, TaskPrompt, ToolExecutionEvent } from '../agents/types';
import { CopilotAdapter } from '../agents/CopilotAdapter';
import { CopilotSdkAdapter } from '../agents/CopilotSdkAdapter';
import { ClaudeAdapter } from '../agents/ClaudeAdapter';
import { ConfigStore } from './ConfigStore';

// ===========================================
// Agent Manager Service
// ===========================================
// Orchestrates agent detection, configuration, and execution.

interface RunningProcess {
  process?: ChildProcess;
  cancel?: () => Promise<void>;
  agentId: string;
  taskId: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  startedAt: number;
}

export class AgentManager {
  private adapters: Map<string, AgentAdapter> = new Map();
  private runningProcesses: Map<string, RunningProcess> = new Map();

  constructor() {
    // Register all available adapters
    this.registerAdapter(new CopilotSdkAdapter());
    this.registerAdapter(new CopilotAdapter());
    this.registerAdapter(new ClaudeAdapter());
  }

  /**
   * Register an agent adapter
   */
  registerAdapter(adapter: AgentAdapter): void {
    this.adapters.set(adapter.id, adapter);
    console.log(`📦 Registered agent adapter: ${adapter.name}`);
  }

  /**
   * Get all available agents with their status
   */
  async getAvailableAgents(): Promise<AgentInfo[]> {
    const agents: AgentInfo[] = [];

    for (const [id, adapter] of this.adapters) {
      const installed = await adapter.isInstalled();
      
      // Check cache first
      let version: string | null = null;
      const cached = ConfigStore.getCachedAgentVersion(id);
      const cacheValid = cached && (Date.now() - cached.checkedAt < 24 * 60 * 60 * 1000);

      if (cacheValid) {
        version = cached!.version;
      } else if (installed) {
        version = await adapter.getVersion();
        ConfigStore.setCachedAgentVersion(id, version);
      }

      // Get user config or default
      const userConfig = ConfigStore.getAgentConfig(id);
      const config = userConfig || adapter.getDefaultConfig();

      agents.push({
        id,
        name: adapter.name,
        icon: adapter.icon,
        installed,
        version,
        config,
      });
    }

    return agents;
  }

  /**
   * Refresh agent detection (re-check availability)
   */
  async refreshAgents(): Promise<void> {
    for (const [id, adapter] of this.adapters) {
      const installed = await adapter.isInstalled();
      if (installed) {
        const version = await adapter.getVersion();
        ConfigStore.setCachedAgentVersion(id, version);
      } else {
        ConfigStore.setCachedAgentVersion(id, null);
      }
    }
    console.log('🔄 Agent detection refreshed');
  }

  /**
   * Execute a task with a specific agent
   */
  executeTask(agentId: string, task: TaskPrompt, processId?: string): Observable<AgentOutput> {
    const adapter = this.adapters.get(agentId);
    if (!adapter) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const subject = new Subject<AgentOutput>();
    const finalProcessId = processId || `${agentId}-${task.id}-${Date.now()}`;

    try {
      if (adapter.executeSdk) {
        const handleSdkOutput = (output: AgentOutput) => {
          const processInfo = this.runningProcesses.get(finalProcessId);
          if (processInfo) {
            if (output.type === 'complete') processInfo.status = 'completed';
            if (output.type === 'error') processInfo.status = 'failed';
          }
          subject.next(output);
        };

        const handleToolEvent = (event: ToolExecutionEvent) => {
          const statusText = this.formatToolStatus(event);
          subject.next({
            type: 'status',
            data: statusText,
            timestamp: event.timestamp,
          });
          subject.next({
            type: event.type,
            data: statusText,
            timestamp: event.timestamp,
            toolName: event.toolName,
            toolArgs: event.args,
            toolResult: event.result,
          });
        };

        const execution = adapter.executeSdk(
          task,
          { cwd: task.projectPath },
          handleSdkOutput,
          handleToolEvent
        );

        // Track the running process
        this.runningProcesses.set(finalProcessId, {
          cancel: execution.cancel,
          agentId,
          taskId: task.id,
          status: 'running',
          startedAt: Date.now(),
        });

        subject.next({
          type: 'status',
          data: `Started ${adapter.name} for task: ${task.title}`,
          timestamp: Date.now(),
        });

        execution.done
          .then(() => {
            const processInfo = this.runningProcesses.get(finalProcessId);
            if (processInfo && processInfo.status === 'running') {
              processInfo.status = 'completed';
            }
          })
          .catch(() => {
            const processInfo = this.runningProcesses.get(finalProcessId);
            if (processInfo) {
              processInfo.status = 'failed';
            }
          })
          .finally(() => {
            subject.complete();
          });
      } else {
        const childProcess = adapter.execute(task, {
          cwd: task.projectPath,
        });

        // Track the running process
        this.runningProcesses.set(finalProcessId, {
          process: childProcess,
          agentId,
          taskId: task.id,
          status: 'running',
          startedAt: Date.now(),
        });

        // Emit status
        subject.next({
          type: 'status',
          data: `Started ${adapter.name} for task: ${task.title}`,
          timestamp: Date.now(),
        });

        // Stream stdout
        childProcess.stdout?.on('data', (data: Buffer) => {
          subject.next({
            type: 'stdout',
            data: data.toString(),
            timestamp: Date.now(),
          });
        });

        // Stream stderr
        childProcess.stderr?.on('data', (data: Buffer) => {
          subject.next({
            type: 'stderr',
            data: data.toString(),
            timestamp: Date.now(),
          });
        });

        // Handle completion
        childProcess.on('close', (code: number | null) => {
          const processInfo = this.runningProcesses.get(finalProcessId);
          if (processInfo) {
            processInfo.status = code === 0 ? 'completed' : 'failed';
          }

          subject.next({
            type: 'complete',
            data: `Process exited with code: ${code}`,
            timestamp: Date.now(),
          });
          subject.complete();
        });

        // Handle error
        childProcess.on('error', (error: Error) => {
          const processInfo = this.runningProcesses.get(finalProcessId);
          if (processInfo) {
            processInfo.status = 'failed';
          }

          subject.next({
            type: 'error',
            data: error.message,
            timestamp: Date.now(),
          });
          subject.error(error);
        });
      }
    } catch (error) {
      subject.next({
        type: 'error',
        data: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      });
      subject.error(error);
    }

    return subject.asObservable();
  }

  /**
   * Stop a running process
   */
  async stopExecution(processId: string): Promise<void> {
    const processInfo = this.runningProcesses.get(processId);
    if (!processInfo) {
      throw new Error(`Process not found: ${processId}`);
    }

    if (processInfo.process) {
      processInfo.process.kill();
    } else if (processInfo.cancel) {
      await processInfo.cancel();
    }

    processInfo.status = 'stopped';
    console.log(`🛑 Stopped process: ${processId}`);
  }

  /**
   * Get the status of a running execution
   */
  getExecutionStatus(processId: string): 'running' | 'completed' | 'failed' | 'stopped' | null {
    const processInfo = this.runningProcesses.get(processId);
    return processInfo?.status ?? null;
  }

  private formatToolStatus(event: ToolExecutionEvent): string {
    switch (event.type) {
      case 'tool_start':
        return `🔧 ${event.toolName} started`;
      case 'tool_end':
        return `✅ ${event.toolName} completed`;
      case 'tool_error':
        return `❌ ${event.toolName} failed: ${event.error || 'Unknown error'}`;
      default:
        return `${event.toolName}`;
    }
  }

  /**
   * Generate a summary of task output using the CLI agent
   */
  async generateSummary(agentId: string, taskTitle: string, output: string): Promise<string> {
    const adapter = this.adapters.get(agentId);
    if (!adapter) {
      return 'Summary not available';
    }

    // Truncate output if too long - keep key parts
    const maxOutputLength = 2000;
    let truncatedOutput = output;
    if (output.length > maxOutputLength) {
      // Keep first 500 chars and last 1500 chars
      truncatedOutput = output.slice(0, 500) + '\n...[truncated]...\n' + output.slice(-1500);
    }

    // Clean the output for CLI - remove special chars that cause issues
    const cleanOutput = truncatedOutput
      .replace(/\x1b\[[0-9;]*m/g, '')  // Remove ANSI codes
      .replace(/[`$"\\]/g, '')          // Remove problematic shell chars
      .replace(/\r?\n/g, ' ')           // Flatten to single line
      .replace(/\s+/g, ' ')             // Normalize whitespace
      .trim()
      .slice(0, 1500);                  // Final length limit

    return new Promise((resolve) => {
      // Create a very simple, short prompt
      const summaryPrompt = {
        id: `summary-${Date.now()}`,
        title: `Summarize: ${taskTitle.slice(0, 50)}`,
        description: `Give 2-3 sentence summary of what was done. Output: ${cleanOutput.slice(0, 500)}`,
        projectPath: process.cwd(),
      };

      try {
        const childProcess = adapter.execute(summaryPrompt, { cwd: process.cwd() });
        let summaryText = '';
        let timeout: NodeJS.Timeout;

        // Set timeout to avoid hanging
        timeout = setTimeout(() => {
          childProcess.kill();
          resolve(this.extractFallbackSummary(taskTitle, output));
        }, 20000);

        childProcess.stdout?.on('data', (data: Buffer) => {
          summaryText += data.toString();
        });

        childProcess.stderr?.on('data', (data: Buffer) => {
          // Check if it's an error message
          const errText = data.toString();
          if (errText.includes('error') || errText.includes('too many arguments')) {
            console.log('Summary CLI error, using fallback');
          }
        });

        childProcess.on('close', (code) => {
          clearTimeout(timeout);
          if (code !== 0 || !summaryText.trim()) {
            resolve(this.extractFallbackSummary(taskTitle, output));
            return;
          }
          // Clean up the summary text
          const cleaned = summaryText
            .replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI codes
            .trim();
          resolve(cleaned || this.extractFallbackSummary(taskTitle, output));
        });

        childProcess.on('error', () => {
          clearTimeout(timeout);
          resolve(this.extractFallbackSummary(taskTitle, output));
        });
      } catch {
        resolve(this.extractFallbackSummary(taskTitle, output));
      }
    });
  }

  /**
   * Extract a basic summary from output using regex patterns (fallback)
   */
  private extractFallbackSummary(taskTitle: string, output: string): string {
    const summaryParts: string[] = [];
    
    // Look for success indicators
    if (output.includes('Successfully') || output.includes('success') || output.includes('Done')) {
      summaryParts.push('Completed successfully');
    }
    
    // Look for files created
    const fileMatches = output.match(/(?:created?|wrote|generated?)\s+[`'"]?([\w./\\-]+\.\w+)[`'"]?/gi);
    if (fileMatches && fileMatches.length > 0) {
      const files = [...new Set(fileMatches.slice(0, 3))].join(', ');
      summaryParts.push(`Files: ${files}`);
    }
    
    // Look for packages installed
    const pkgMatch = output.match(/(?:added|installed)\s+(\d+)\s+packages?/i);
    if (pkgMatch) {
      summaryParts.push(`Installed ${pkgMatch[1]} packages`);
    }
    
    // Look for git operations
    if (output.includes('git init') || output.includes('Initialized')) {
      summaryParts.push('Initialized git repository');
    }
    
    if (summaryParts.length > 0) {
      return summaryParts.join('. ') + '.';
    }
    
    return `Task "${taskTitle}" completed.`;
  }

  /**
   * Get adapter by ID
   */
  getAdapter(agentId: string): AgentAdapter | undefined {
    return this.adapters.get(agentId);
  }
}

// Singleton instance
export const agentManager = new AgentManager();
export default agentManager;
