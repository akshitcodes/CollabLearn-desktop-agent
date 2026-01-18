import { spawn, ChildProcess, execSync } from 'child_process';
import { AgentAdapter, AgentConfig, TaskPrompt, ExecuteOptions } from './types';

// ===========================================
// Claude Code CLI Adapter
// ===========================================
// Adapter for Anthropic's Claude Code CLI
// Requires: claude CLI installed
//
// LIMITATIONS vs Copilot SDK:
// - No bi-directional tool callbacks (Claude operates autonomously)
// - Limited control over file operations (no approval flow)
// - Basic stdout/stderr parsing instead of structured events
// 
// TODO: Explore Claude Agent SDK for better integration
// See: https://docs.claude.com/en/docs/agent-sdk

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude-code';
  readonly name = 'Claude Code';
  readonly icon = 'claude';

  /**
   * Check if claude CLI is installed
   */
  async isInstalled(): Promise<boolean> {
    try {
      execSync('claude --version', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the version of claude CLI
   */
  async getVersion(): Promise<string | null> {
    try {
      const output = execSync('claude --version', { 
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      // Parse version from output
      const match = output.match(/(\d+\.\d+\.\d+)/);
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
      executablePath: 'claude',
      defaultFlags: [
        '--output-format', 'stream-json',
        '--allowedTools', 'Edit,Bash,Read,Write',
        '--max-budget-usd', '5.00',
        '--max-turns', '50',
      ],
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
   * Build the command line arguments
   */
  buildCommand(task: TaskPrompt, config: AgentConfig): string[] {
    const prompt = this.buildPrompt(task);
    return [
      '-p', prompt,           // Prompt flag for headless mode
      '--cwd', task.projectPath,
      ...config.defaultFlags,
    ];
  }

  /**
   * Execute the agent with a task
   */
  execute(task: TaskPrompt, options: ExecuteOptions): ChildProcess {
    const config = this.getDefaultConfig();
    const args = this.buildCommand(task, config);
    
    return spawn(config.executablePath, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Build a prompt from task details
   */
  private buildPrompt(task: TaskPrompt): string {
    let prompt = `# Task: ${task.title}\n\n`;
    if (task.description) {
      prompt += `## Description\n${task.description}\n\n`;
    }
    if (task.context) {
      prompt += `## Context\n${task.context}\n\n`;
    }
    prompt += `Please complete this task in the project at: ${task.projectPath}`;
    return prompt;
  }
}

export default ClaudeAdapter;
