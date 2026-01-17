import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import { exec, execSync, ChildProcess, spawn } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { CopilotClient, defineTool } from '@github/copilot-sdk';
import { AgentAdapter, AgentConfig, TaskPrompt, ExecuteOptions, AgentOutput, ModelInfo } from './types';
import { Subject } from 'rxjs';

const execAsync = promisify(exec);

function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*m/g, '');
}

function truncateText(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  const head = input.slice(0, Math.floor(maxChars * 0.5));
  const tail = input.slice(-Math.floor(maxChars * 0.5));
  return `${head}\n...[truncated ${input.length - head.length - tail.length} chars]...\n${tail}`;
}

function safeToolText(input: string, maxChars = 20000): string {
  return truncateText(stripAnsi(input), maxChars);
}

// ===========================================
// GitHub Copilot SDK Adapter
// ===========================================
// SDK-based adapter with full tool support for file editing and command execution.
// This provides bi-directional communication with Copilot, unlike the CLI adapter.

export interface CopilotSdkConfig extends AgentConfig {
  /** Prefer SDK mode over CLI spawning */
  preferSdkMode: boolean;
  /** Model to use (gpt-5, claude-sonnet-4.5, etc.) */
  model?: string;
  /** Maximum time to wait for session operations */
  sessionTimeoutMs?: number;
}

export interface ToolExecutionEvent {
  type: 'tool_start' | 'tool_end' | 'tool_error';
  toolName: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  timestamp: number;
}

export class CopilotSdkAdapter implements AgentAdapter {
  readonly id = 'github-copilot-sdk';
  readonly name = 'GitHub Copilot (SDK)';
  readonly icon = 'copilot';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private activeSession: any = null;
  private isCliAvailable = false;
  private cliVersion: string | null = null;

  /**
   * Check if Copilot CLI is installed (required for SDK)
   */
  async isInstalled(): Promise<boolean> {
    const env = process.platform === 'win32' ? this.buildWindowsEnv() : undefined;

    // On Windows, `copilot` often resolves to a PowerShell shim, but the SDK spawns via cmd.
    // Prefer validating `copilot.cmd` first.
    const candidates = process.platform === 'win32' ? ['copilot.cmd', 'copilot'] : ['copilot'];

    for (const cmd of candidates) {
      try {
        execSync(`${cmd} --version`, { stdio: 'pipe', env });
        this.isCliAvailable = true;
        return true;
      } catch {
        // try next
      }
    }

    this.isCliAvailable = false;
    return false;
  }

  /**
   * Get CLI version
   */
  async getVersion(): Promise<string | null> {
    if (this.cliVersion) return this.cliVersion;

    try {
      const env = process.platform === 'win32' ? this.buildWindowsEnv() : undefined;
      const versionCmd = process.platform === 'win32' ? 'copilot.cmd' : 'copilot';
      const output = execSync(`${versionCmd} --version`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
      const match = output.match(/(?:version\s+)?(\d+\.\d+\.\d+)/i);
      this.cliVersion = match ? match[1] : output.trim().split('\n')[0];
      return this.cliVersion;
    } catch {
      return null;
    }
  }


  private buildWindowsEnv(): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    const systemRoot = env.SystemRoot || env.WINDIR || 'C:\\Windows';
    const system32 = path.join(systemRoot, 'System32');

    const pathValue = env.PATH || env.Path || '';
    const pathEntries = pathValue.split(';').filter(Boolean);

    const normalizedEntries = new Set(pathEntries.map((entry) => entry.toLowerCase()));

    if (!normalizedEntries.has(system32.toLowerCase())) {
      pathEntries.unshift(system32);
    }

    if (process.env.APPDATA) {
      const npmBinPath = path.join(process.env.APPDATA, 'npm');
      if (!normalizedEntries.has(npmBinPath.toLowerCase())) {
        pathEntries.unshift(npmBinPath);
      }
    }

    const finalPath = pathEntries.join(';');
    env.PATH = finalPath;
    env.Path = finalPath;

    if (!env.COMSPEC) {
      env.COMSPEC = path.join(systemRoot, 'System32', 'cmd.exe');
    }

    // Some environments (Electron/packaged) may not carry PATHEXT reliably.
    // Setting a sane default improves cmd.exe command resolution.
    if (!env.PATHEXT) {
      env.PATHEXT = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC';
    }

    return env;
  }

  private resolveCliPathForSdk(config: CopilotSdkConfig, env: Record<string, string>): string {
    const isWindows = process.platform === 'win32';
    const configuredPath = (config.executablePath || (isWindows ? 'copilot.cmd' : 'copilot')).trim();

    // If user explicitly points to a JS entrypoint, keep it absolute so SDK uses `node <file>.js`
    if (configuredPath.toLowerCase().endsWith('.js')) {
      return configuredPath;
    }

    if (!isWindows) {
      return configuredPath || 'copilot';
    }

    // Windows workaround:
    // The SDK's Windows branch spawns `cmd /c "<cliPath>" ...` which is brittle when the
    // command is quoted. Instead, point cliPath at the underlying JS entrypoint so the SDK
    // uses the `node <file>.js` branch (reliable cross-environment).
    const appData = env.APPDATA || process.env.APPDATA;
    if (appData) {
      const npmLoaderJs = path.join(appData, 'npm', 'node_modules', '@github', 'copilot', 'npm-loader.js');
      if (fsSync.existsSync(npmLoaderJs)) {
        return npmLoaderJs;
      }
    }

    // IMPORTANT (Windows): Copilot SDK only wraps with `cmd /c` when cliPath is NOT absolute.
    // Absolute `.cmd` paths cause Node spawn(EINVAL) because they're batch scripts.
    // So: if we have an absolute .cmd/.bat, add its dir to PATH and pass only basename.
    const lower = configuredPath.toLowerCase();
    const isBatch = lower.endsWith('.cmd') || lower.endsWith('.bat');

    if (path.isAbsolute(configuredPath) && isBatch) {
      const dir = path.dirname(configuredPath);
      const base = path.basename(configuredPath);

      const pathValue = env.PATH || env.Path || '';
      const pathEntries = pathValue.split(';').filter(Boolean);
      const normalized = new Set(pathEntries.map((p) => p.toLowerCase()));
      if (!normalized.has(dir.toLowerCase())) {
        pathEntries.unshift(dir);
        const finalPath = pathEntries.join(';');
        env.PATH = finalPath;
        env.Path = finalPath;
      }

      return base;
    }

    // Prefer a non-absolute command name so SDK uses cmd-wrapper reliably.
    if (path.isAbsolute(configuredPath)) {
      return configuredPath;
    }

    // Ensure we pick the cmd shim by default (cmd.exe doesn't execute the .ps1 shim).
    if (!configuredPath || configuredPath === 'copilot') {
      return 'copilot.cmd';
    }

    return configuredPath;
  }

  /**
   * Get default configuration
   */
  getDefaultConfig(): CopilotSdkConfig {
    return {
      enabled: true,
      executablePath: process.platform === 'win32' ? 'copilot.cmd' : 'copilot',
      defaultFlags: [],
      preferSdkMode: true,
      model: 'gpt-5',
      sessionTimeoutMs: 120000, // 2 minutes
    };
  }

  /**
   * Validate configuration
   */
  validateConfig(config: AgentConfig): boolean {
    return (
      typeof config.enabled === 'boolean' &&
      typeof config.executablePath === 'string' &&
      config.executablePath.length > 0 &&
      Array.isArray(config.defaultFlags)
    );
  }

  /**
   * Build command (for compatibility with AgentAdapter interface)
   * SDK mode doesn't use CLI command building directly
   */
  buildCommand(task: TaskPrompt, config: AgentConfig): string[] {
    // SDK mode uses structured communication, not CLI args
    return ['copilot', 'sdk-mode', '--task', task.title];
  }

  /**
   * Get available AI models for this agent
   * Returns curated list of models commonly available in Copilot
   */
  getAvailableModels(): ModelInfo[] {
    return [
      // Anthropic Models
      { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', provider: 'anthropic', multiplier: '1x' },
      { id: 'claude-opus-4.5', name: 'Claude Opus 4.5', provider: 'anthropic', multiplier: '3x' },
      { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', provider: 'anthropic', multiplier: '0.33x' },
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic', multiplier: '1x', requiresEnablement: true },
      
      // OpenAI Models
      { id: 'gpt-5.2', name: 'GPT-5.2', provider: 'openai', multiplier: '1x' },
      { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', provider: 'openai', multiplier: '1x', requiresEnablement: true },
      { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max', provider: 'openai', multiplier: '1x' },
      { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', provider: 'openai', multiplier: '1x' },
      { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', provider: 'openai', multiplier: '0.33x' },
      { id: 'gpt-5.1', name: 'GPT-5.1', provider: 'openai', multiplier: '1x', requiresEnablement: true },
      { id: 'gpt-5', name: 'GPT-5', provider: 'openai', multiplier: '1x' },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini', provider: 'openai', multiplier: '0x' },
      { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', multiplier: '0x' },
      
      // Google Models
      { id: 'gemini-3-pro', name: 'Gemini 3 Pro', provider: 'google', multiplier: '1x' },
    ];
  }

  /**
   * Start the SDK client
   */
  async startClient(): Promise<void> {
    console.log('🔌 Starting Copilot SDK client...');
    
    if (this.client) {
      console.log('  ⏩ Client already exists, skipping start');
      return;
    }

    try {
      if (!this.isCliAvailable) {
        await this.isInstalled();
      }

      if (!this.isCliAvailable) {
        throw new Error('GitHub Copilot CLI not found. Install with: npm i -g @github/copilot');
      }

      // On Windows, we need to:
      // 1. Use 'copilot.cmd' (non-absolute path) so SDK uses 'cmd /c' wrapper
      // 2. Add npm global bin to PATH so the subprocess can find it
      // 3. Use TCP mode (not stdio) for better Electron subprocess compatibility
      const isWindows = process.platform === 'win32';
      const config = this.getDefaultConfig();
      
      // Build environment with npm global bin + system paths in PATH
      const env = isWindows ? this.buildWindowsEnv() : ({ ...process.env } as Record<string, string>);
      const cliPath = this.resolveCliPathForSdk(config, env);
      if (isWindows && process.env.APPDATA) {
        const npmBinPath = path.join(process.env.APPDATA, 'npm');
        console.log(`  → Added npm bin to PATH: ${npmBinPath}`);
      }
      
      console.log(`  → Using CLI path: ${cliPath}`);
      console.log(`  → Using TCP mode (port: auto)`);
      console.log('  → Creating CopilotClient instance...');
      
      this.client = new CopilotClient({
        autoStart: true,
        autoRestart: true,
        useStdio: false,  // Use TCP mode for better Electron compatibility
        port: 0,          // Auto-select port
        cliPath: cliPath,
        env: env,
      });

      console.log('  → Calling client.start()...');
      await this.client.start();
      console.log('🚀 Copilot SDK client started successfully!');
    } catch (error) {
      console.error('❌ Failed to start Copilot SDK client:', error);
      this.client = null;
      throw error;
    }
  }

  /**
   * Stop the SDK client
   */
  async stopClient(): Promise<void> {
    if (this.activeSession) {
      await this.activeSession.destroy();
      this.activeSession = null;
    }
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
    console.log('🛑 Copilot SDK client stopped');
  }

  /**
   * Create a new session with tools configured
   */
  async createSession(
    projectPath: string,
    onToolEvent: (event: ToolExecutionEvent) => void,
    model?: string  // Optional model override
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    if (!this.client) {
      await this.startClient();
    }

    // Define the tools that Copilot can use
    const tools = this.defineTools(projectPath, onToolEvent);

    const config = this.getDefaultConfig();
    const sessionModel = model || config.model;
    
    console.log(`📦 Creating session with model: ${sessionModel}`);
    
    const session = await this.client!.createSession({
      model: sessionModel,
      tools,
      systemMessage: {
        content: this.buildSystemMessage(projectPath),
      },
    });

    this.activeSession = session;
    return session;
  }

  /**
   * Define the tools that Copilot can call
   */
  private defineTools(
    projectPath: string,
    onToolEvent: (event: ToolExecutionEvent) => void
  ) {
    return [
      // === EDIT FILE TOOL ===
      defineTool('edit_file', {
        description: 'Create or modify a file in the project',
        parameters: z.object({
          filePath: z.string().describe('Relative path to the file from project root'),
          content: z.string().describe('Complete content to write to the file'),
          createDirectories: z.boolean().optional().describe('Create parent directories if needed'),
        }),
        handler: async ({ filePath, content, createDirectories = true }: { filePath: string; content: string; createDirectories?: boolean }) => {
          const absolutePath = path.join(projectPath, filePath);

          onToolEvent({
            type: 'tool_start',
            toolName: 'edit_file',
            args: { filePath, contentLength: content.length },
            timestamp: Date.now(),
          });

          try {
            if (createDirectories) {
              await fs.mkdir(path.dirname(absolutePath), { recursive: true });
            }
            await fs.writeFile(absolutePath, content, 'utf-8');

            onToolEvent({
              type: 'tool_end',
              toolName: 'edit_file',
              result: { success: true, filePath: absolutePath },
              timestamp: Date.now(),
            });

            return { success: true, filePath: absolutePath, bytesWritten: content.length };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            onToolEvent({
              type: 'tool_error',
              toolName: 'edit_file',
              error: errorMsg,
              timestamp: Date.now(),
            });
            return { success: false, error: errorMsg };
          }
        },
      }),

      // === READ FILE TOOL ===
      defineTool('read_file', {
        description: 'Read the contents of a file from the project',
        parameters: z.object({
          filePath: z.string().describe('Relative path to the file from project root'),
        }),
        handler: async ({ filePath }: { filePath: string }) => {
          const absolutePath = path.join(projectPath, filePath);

          onToolEvent({
            type: 'tool_start',
            toolName: 'read_file',
            args: { filePath },
            timestamp: Date.now(),
          });

          try {
            const content = await fs.readFile(absolutePath, 'utf-8');

            onToolEvent({
              type: 'tool_end',
              toolName: 'read_file',
              result: { success: true, bytesRead: content.length },
              timestamp: Date.now(),
            });

            return { success: true, content, bytesRead: content.length };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            onToolEvent({
              type: 'tool_error',
              toolName: 'read_file',
              error: errorMsg,
              timestamp: Date.now(),
            });
            return { success: false, error: errorMsg };
          }
        },
      }),

      // === RUN COMMAND TOOL ===
      defineTool('run_command', {
        description: 'Execute a shell command in the project directory',
        parameters: z.object({
          command: z.string().describe('The shell command to execute'),
          cwd: z.string().optional().describe('Working directory (relative to project root)'),
          timeout: z.number().optional().describe('Timeout in milliseconds (default: 60000)'),
        }),
        handler: async ({ command, cwd, timeout = 60000 }: { command: string; cwd?: string; timeout?: number }) => {
          const workDir = cwd ? path.join(projectPath, cwd) : projectPath;

          onToolEvent({
            type: 'tool_start',
            toolName: 'run_command',
            args: { command, cwd: workDir },
            timestamp: Date.now(),
          });

          try {
            const { stdout, stderr } = await execAsync(command, {
              cwd: workDir,
              timeout,
              maxBuffer: 10 * 1024 * 1024, // 10MB
            });

            onToolEvent({
              type: 'tool_end',
              toolName: 'run_command',
              result: { success: true, hasOutput: stdout.length > 0 },
              timestamp: Date.now(),
            });

            return {
              success: true,
              stdout: safeToolText(stdout.trim()),
              stderr: safeToolText(stderr.trim()),
              exitCode: 0,
            };
          } catch (error: unknown) {
            const execError = error as { stdout?: string; stderr?: string; code?: number; message?: string };
            const errorMsg = execError.message || 'Command execution failed';

            onToolEvent({
              type: 'tool_error',
              toolName: 'run_command',
              error: errorMsg,
              timestamp: Date.now(),
            });

            return {
              success: false,
              stdout: safeToolText(execError.stdout || ''),
              stderr: safeToolText(execError.stderr || ''),
              exitCode: execError.code || 1,
              error: safeToolText(errorMsg, 8000),
            };
          }
        },
      }),

      // === LIST FILES TOOL ===
      defineTool('list_files', {
        description: 'List files and directories in a path',
        parameters: z.object({
          dirPath: z.string().optional().describe('Relative path from project root (default: root)'),
          recursive: z.boolean().optional().describe('List recursively (default: false)'),
          maxDepth: z.number().optional().describe('Max recursion depth (default: 3)'),
        }),
        handler: async ({ dirPath = '.', recursive = false, maxDepth = 3 }: { dirPath?: string; recursive?: boolean; maxDepth?: number }) => {
          const absolutePath = path.join(projectPath, dirPath);

          onToolEvent({
            type: 'tool_start',
            toolName: 'list_files',
            args: { dirPath, recursive },
            timestamp: Date.now(),
          });

          try {
            const files = await this.listFilesRecursive(absolutePath, recursive, maxDepth, 0);

            onToolEvent({
              type: 'tool_end',
              toolName: 'list_files',
              result: { success: true, fileCount: files.length },
              timestamp: Date.now(),
            });

            return { success: true, files, count: files.length };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            onToolEvent({
              type: 'tool_error',
              toolName: 'list_files',
              error: errorMsg,
              timestamp: Date.now(),
            });
            return { success: false, error: errorMsg };
          }
        },
      }),

      // === DELETE FILE TOOL ===
      defineTool('delete_file', {
        description: 'Delete a file from the project',
        parameters: z.object({
          filePath: z.string().describe('Relative path to the file from project root'),
        }),
        handler: async ({ filePath }: { filePath: string }) => {
          const absolutePath = path.join(projectPath, filePath);

          onToolEvent({
            type: 'tool_start',
            toolName: 'delete_file',
            args: { filePath },
            timestamp: Date.now(),
          });

          try {
            await fs.unlink(absolutePath);

            onToolEvent({
              type: 'tool_end',
              toolName: 'delete_file',
              result: { success: true, filePath: absolutePath },
              timestamp: Date.now(),
            });

            return { success: true, filePath: absolutePath };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            onToolEvent({
              type: 'tool_error',
              toolName: 'delete_file',
              error: errorMsg,
              timestamp: Date.now(),
            });
            return { success: false, error: errorMsg };
          }
        },
      }),
    ];
  }

  /**
   * Helper: list files recursively
   */
  private async listFilesRecursive(
    dirPath: string,
    recursive: boolean,
    maxDepth: number,
    currentDepth: number
  ): Promise<{ name: string; type: 'file' | 'directory'; path: string }[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const results: { name: string; type: 'file' | 'directory'; path: string }[] = [];

    for (const entry of entries) {
      // Skip common ignored directories
      if (['node_modules', '.git', 'dist', '.next', '__pycache__'].includes(entry.name)) {
        continue;
      }

      const entryPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(dirPath, entryPath);

      results.push({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        path: relativePath,
      });

      if (recursive && entry.isDirectory() && currentDepth < maxDepth) {
        const subEntries = await this.listFilesRecursive(
          entryPath,
          recursive,
          maxDepth,
          currentDepth + 1
        );
        results.push(...subEntries.map((e) => ({ ...e, path: path.join(entry.name, e.path) })));
      }
    }

    return results;
  }

  /**
   * Build system message with project context
   */
  private buildSystemMessage(projectPath: string): string {
    return `You are an AI coding agent working on a software project.

## Project Context
- **Project Path**: ${projectPath}
- **Your Capabilities**: You can read files, write files, run commands, and list directory contents.

## Workflow
1. First, understand the task by exploring the project structure if needed
2. Read relevant files to understand current implementation
3. Make changes using edit_file
4. Run tests or build commands to verify changes
5. Report completion with a summary

## Guidelines
- Always use relative paths from the project root
- Create directories automatically when writing files
- Run appropriate verification commands after making changes
- Keep files well-organized following project conventions`;
  }

  /**
   * Execute using SDK mode with full tool support
   * Returns an Observable for streaming output
   */
  executeSdk(
    task: TaskPrompt,
    options: ExecuteOptions,
    onOutput: (output: AgentOutput) => void,
    onToolEvent: (event: ToolExecutionEvent) => void
  ): { cancel: () => Promise<void>; done: Promise<void> } {
    let cancelled = false;

    const done = (async () => {
      try {
        // Start client if needed
        if (!this.client) {
          onOutput({
            type: 'status',
            data: 'Connecting to Copilot SDK...',
            timestamp: Date.now(),
          });
          await this.startClient();
        }

        // Create session with tools
        const modelDisplay = task.model || 'default';
        onOutput({
          type: 'status',
          data: `Creating session with model: ${modelDisplay}...`,
          timestamp: Date.now(),
        });

        const session = await this.createSession(task.projectPath, onToolEvent, task.model);

        // Set up event handlers - use type guard for SDK events
        session.on((event: { type: string; data?: Record<string, unknown> }) => {
          if (cancelled) return;

          const eventType = event.type;
          const eventData = event.data || {};

          switch (eventType) {
            case 'assistant.message_delta':
              if (typeof eventData.deltaContent === 'string') {
                onOutput({
                  type: 'stdout',
                  data: eventData.deltaContent,
                  timestamp: Date.now(),
                });
              }
              break;
            case 'assistant.message':
              if (typeof eventData.content === 'string') {
                onOutput({
                  type: 'stdout',
                  data: '\n' + eventData.content,
                  timestamp: Date.now(),
                });
              }
              break;
            case 'tool.execution_start': {
              const toolName = typeof eventData.toolName === 'string' ? eventData.toolName : 'unknown_tool';
              const args = (eventData.arguments as Record<string, unknown> | undefined) || undefined;
              const ts = Date.now();
              onToolEvent({
                type: 'tool_start',
                toolName,
                args,
                timestamp: ts,
              });
              break;
            }
            case 'tool.execution_complete': {
              const toolName = typeof eventData.toolName === 'string' ? eventData.toolName : 'unknown_tool';
              const success = eventData.success;
              const result = eventData.result;
              const ts = Date.now();

              if (success === false) {
                onToolEvent({
                  type: 'tool_error',
                  toolName,
                  error: typeof eventData.error === 'string' ? eventData.error : 'Tool failed',
                  timestamp: ts,
                });
              } else {
                onToolEvent({
                  type: 'tool_end',
                  toolName,
                  result,
                  timestamp: ts,
                });
              }
              break;
            }
            case 'tool.execution_error': {
              const toolName = typeof eventData.toolName === 'string' ? eventData.toolName : 'unknown_tool';
              const ts = Date.now();
              onToolEvent({
                type: 'tool_error',
                toolName,
                error: typeof eventData.error === 'string' ? eventData.error : 'Tool execution error',
                timestamp: ts,
              });
              break;
            }
            // Note: Tool execution events come from our custom handlers, not session events
            // The SDK provides these through the tool handler callbacks we defined
            default:
              // Log unexpected events for debugging
              if (eventType.startsWith('tool.') || eventType.includes('error')) {
                console.log(`SDK Event: ${eventType}`, eventData);
              }
              break;
          }
        });

        // Build the prompt
        const prompt = this.buildTaskPrompt(task);

        // Send message and wait for completion
        onOutput({
          type: 'status',
          data: `Starting task: ${task.title}`,
          timestamp: Date.now(),
        });

        const config = this.getDefaultConfig();
        await session.sendAndWait({ prompt }, config.sessionTimeoutMs);

        if (!cancelled) {
          onOutput({
            type: 'complete',
            data: 'Task completed successfully',
            timestamp: Date.now(),
          });
        }
      } catch (error) {
        // Log error to console for debugging
        console.error('❌ Copilot SDK execution failed:', error);
        
        if (!cancelled) {
          onOutput({
            type: 'error',
            data: error instanceof Error ? error.message : 'Unknown error',
            timestamp: Date.now(),
          });
        }
      }
    })();

    return {
      cancel: async () => {
        cancelled = true;
        if (this.activeSession) {
          await this.activeSession.abort();
        }
      },
      done,
    };
  }

  /**
   * Build prompt from task details
   */
  private buildTaskPrompt(task: TaskPrompt): string {
    let prompt = `## Task: ${task.title}\n\n`;

    if (task.description) {
      prompt += `### Description\n${task.description}\n\n`;
    }

    if (task.context) {
      prompt += `### Additional Context\n${task.context}\n\n`;
    }

    prompt += `### Instructions\n`;
    prompt += `Please complete this task in the project at: ${task.projectPath}\n`;
    prompt += `Use the available tools to read, write, and verify your changes.`;
    prompt += `\n\n### Non-interactive execution rules\n`;
    prompt += `- Avoid interactive commands/prompts (no TTY). Prefer flags like --yes / --no-interaction.\n`;
    prompt += `- If a scaffolder complains the directory is not empty, create a new subfolder and scaffold there.\n`;
    prompt += `- Keep tool outputs small; summarize long logs instead of pasting everything.`;

    return prompt;
  }

  /**
   * Legacy execute method for AgentAdapter compatibility
   * Returns a mock ChildProcess that bridges to SDK execution
   */
  execute(task: TaskPrompt, options: ExecuteOptions): ChildProcess {
    // For compatibility, create a fake process
    // Real SDK execution should use executeSdk() method
    const mockProcess = spawn('echo', [
      'Use CopilotSdkAdapter.executeSdk() for full SDK functionality',
    ]);

    console.warn(
      '⚠️ CopilotSdkAdapter.execute() called - use executeSdk() for full tool support'
    );

    return mockProcess;
  }
}

export default CopilotSdkAdapter;
