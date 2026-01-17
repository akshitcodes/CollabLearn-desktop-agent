import { spawn, ChildProcess, execSync } from 'child_process';
import * as path from 'path';
import { AgentAdapter, AgentConfig, TaskPrompt, ExecuteOptions } from './types';

// ===========================================
// GitHub Copilot CLI Adapter
// ===========================================
// Adapter for GitHub Copilot CLI (gh copilot)
// Requires: gh CLI installed with copilot extension

export class CopilotAdapter implements AgentAdapter {
  readonly id = 'github-copilot';
  readonly name = 'GitHub Copilot';
  readonly icon = 'copilot';
  
  // Track which variant is installed
  private detectedCommand: 'copilot' | 'gh copilot' | null = null;

  /**
   * Check if copilot CLI is installed (standalone or gh extension)
   */
  async isInstalled(): Promise<boolean> {
    // Try standalone copilot first (newer CLI)
    try {
      execSync('copilot --version', { stdio: 'pipe' });
      this.detectedCommand = 'copilot';
      return true;
    } catch {
      // Fall back to gh copilot extension
      try {
        execSync('gh copilot --version', { stdio: 'pipe' });
        this.detectedCommand = 'gh copilot';
        return true;
      } catch {
        this.detectedCommand = null;
        return false;
      }
    }
  }

  /**
   * Get the version of copilot CLI
   */
  async getVersion(): Promise<string | null> {
    const command = this.detectedCommand || 'copilot';
    try {
      const output = execSync(`${command} --version`, { 
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      // Parse version from output (e.g., "Version 0.0.381 · Commit cd1e4cc")
      const match = output.match(/(?:version\s+)?(\d+\.\d+\.\d+)/i);
      return match ? match[1] : output.trim().split('\n')[0];
    } catch {
      return null;
    }
  }

  /**
   * Get default configuration
   */
  getDefaultConfig(): AgentConfig {
    return {
      enabled: true,
      executablePath: this.detectedCommand === 'gh copilot' ? 'gh' : 'copilot',
      defaultFlags: [],
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
   * Build the command line arguments for standalone copilot CLI
   */
  buildCommand(task: TaskPrompt, config: AgentConfig): string[] {
    const prompt = this.buildPrompt(task);
    
    // Standalone copilot CLI uses -p for prompt
    if (this.detectedCommand === 'copilot') {
      return [
        '-p', `"${prompt}"`,  // Quote the prompt for shell
        ...config.defaultFlags,
      ];
    }
    
    // gh copilot extension uses explain/suggest subcommands
    // For now, use explain for general queries
    return [
      'copilot',
      'explain',
      `"${prompt}"`,
      ...config.defaultFlags,
    ];
  }

  /**
   * Execute the agent with a task
   */
  execute(task: TaskPrompt, options: ExecuteOptions): ChildProcess {
    const config = this.getDefaultConfig();
    const args = this.buildCommand(task, config);
    
    // For gh copilot, we need to spawn 'gh' with copilot as first arg
    const command = this.detectedCommand === 'gh copilot' ? 'gh' : config.executablePath;

    const normalizedCwd = path.resolve(options.cwd);
    const env = { ...process.env, ...options.env };

    if (process.platform === 'win32' && this.isOneDrivePath(normalizedCwd)) {
      const { shellCommand, shellArgs } = this.buildPowerShellInvocation(command, args, normalizedCwd);

      return spawn(shellCommand, shellArgs, {
        cwd: this.getSafeWindowsCwd(),
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    
    return spawn(command, args, {
      cwd: normalizedCwd,
      env,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Build a prompt from task details - single line for CLI compatibility
   */
  private buildPrompt(task: TaskPrompt): string {
    // Keep prompt on single line to avoid shell escaping issues
    let parts: string[] = [];
    parts.push(`Task: ${task.title}.`);
    if (task.description) {
      parts.push(`Description: ${task.description}.`);
    }
    if (task.context) {
      parts.push(`Context: ${task.context}.`);
    }
    parts.push(`Project: ${task.projectPath}`);
    return parts.join(' ');
  }

  private isOneDrivePath(targetPath: string): boolean {
    const oneDriveRoots = [
      process.env.OneDrive,
      process.env.OneDriveConsumer,
      process.env.OneDriveCommercial,
    ].filter((value): value is string => Boolean(value));

    if (oneDriveRoots.length === 0) return false;

    const normalizedTarget = path.resolve(targetPath).toLowerCase();
    return oneDriveRoots.some(root => normalizedTarget.startsWith(path.resolve(root).toLowerCase()));
  }

  private buildWindowsCommandLine(command: string, args: string[]): string {
    const escapeArg = (arg: string) => this.escapeWindowsCmdArgument(arg);
    return [command, ...args.map(escapeArg)].join(' ');
  }

  private buildPowerShellInvocation(command: string, args: string[], cwd: string): { shellCommand: string; shellArgs: string[] } {
    const quotedCommand = this.escapePowerShellLiteral(command);
    const quotedArgs = args.map(arg => this.escapePowerShellLiteral(arg)).join(' ');
    const quotedCwd = this.escapePowerShellLiteral(cwd);
    const script = `Set-Location -LiteralPath ${quotedCwd}; & ${quotedCommand} ${quotedArgs}`.trim();

    return {
      shellCommand: 'powershell.exe',
      shellArgs: ['-NoProfile', '-NonInteractive', '-Command', script],
    };
  }

  private escapeWindowsCmdArgument(value: string): string {
    if (!value) return '""';
    const isQuoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
    const base = isQuoted ? value.slice(1, -1) : value;

    const escaped = base
      .replace(/\^/g, '^^')
      .replace(/&/g, '^&')
      .replace(/\|/g, '^|')
      .replace(/</g, '^<')
      .replace(/>/g, '^>')
      .replace(/"/g, '\\"');

    const needsQuotes = /\s|"/.test(escaped);
    return needsQuotes ? `"${escaped}"` : escaped;
  }

  private escapePowerShellLiteral(value: string): string {
    const sanitized = value.replace(/'/g, "''");
    return `'${sanitized}'`;
  }

  private getSafeWindowsCwd(): string {
    const userProfile = process.env.USERPROFILE;
    if (userProfile) return userProfile;

    const homeDrive = process.env.HOMEDRIVE;
    const homePath = process.env.HOMEPATH;
    if (homeDrive && homePath) return path.resolve(`${homeDrive}${homePath}`);

    return process.cwd();
  }
}

export default CopilotAdapter;

