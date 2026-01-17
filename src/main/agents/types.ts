// ===========================================
// Agent Adapter Interface
// ===========================================
// This is the plugin interface for coding agents.
// To add a new agent, create a class implementing this interface.

import { ChildProcess } from 'child_process';

export interface TaskPrompt {
  id: string;
  title: string;
  description: string;
  context?: string;      // Additional context from plan/phase
  projectPath: string;   // Where to run the agent
  model?: string;        // Optional model override for SDK execution
}

export interface ExecuteOptions {
  cwd: string;
  env?: Record<string, string>;
  flags?: string[];      // Additional CLI flags
  timeout?: number;      // Timeout in ms
}

export interface AgentConfig {
  enabled: boolean;
  executablePath: string;   // Path to CLI (or just name if in PATH)
  defaultFlags: string[];   // Default CLI flags
  customPromptTemplate?: string;  // Optional custom prompt format
}

export interface AgentInfo {
  id: string;
  name: string;
  icon: string;           // Icon name or path
  installed: boolean;
  version: string | null;
  config: AgentConfig;
}

// AI Model info for task execution
export interface ModelInfo {
  id: string;          // e.g., 'claude-sonnet-4.5', 'gpt-5.2'
  name: string;        // Display name
  provider: 'openai' | 'anthropic' | 'google';
  multiplier?: string; // Rate multiplier shown in CLI (e.g., '1x', '3x')
  requiresEnablement?: boolean;
}

export interface AgentOutput {
  type: 'stdout' | 'stderr' | 'status' | 'complete' | 'error' | 'tool_start' | 'tool_end' | 'tool_error';
  data: string;
  timestamp: number;
  /** Tool name if this is a tool event */
  toolName?: string;
  /** Tool arguments if this is a tool_start event */
  toolArgs?: Record<string, unknown>;
  /** Tool result if this is a tool_end event */
  toolResult?: unknown;
}

/**
 * Tool execution event from SDK adapter
 */
export interface ToolExecutionEvent {
  type: 'tool_start' | 'tool_end' | 'tool_error';
  toolName: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  timestamp: number;
}

/**
 * Execution mode for agents
 */
export type ExecuteMode = 'cli' | 'sdk';

/**
 * Agent Adapter Interface
 * 
 * Implement this interface to add support for a new coding agent.
 * Each adapter handles detection, configuration, and execution for one agent.
 */
export interface AgentAdapter {
  /** Unique identifier for this agent */
  readonly id: string;
  
  /** Display name */
  readonly name: string;
  
  /** Icon identifier (for UI) */
  readonly icon: string;

  // === Detection ===
  
  /** Check if the agent CLI is installed */
  isInstalled(): Promise<boolean>;
  
  /** Get the installed version (null if not installed) */
  getVersion(): Promise<string | null>;

  // === Configuration ===
  
  /** Get default configuration for this agent */
  getDefaultConfig(): AgentConfig;
  
  /** Validate a configuration object */
  validateConfig(config: AgentConfig): boolean;

  // === Execution ===
  
  /** 
   * Build the full command line for a task
   * This allows inspection before execution
   */
  buildCommand(task: TaskPrompt, config: AgentConfig): string[];
  
  /** 
   * Execute the agent with a task
   * Returns the child process for streaming output
   */
  execute(task: TaskPrompt, options: ExecuteOptions): ChildProcess;

  /**
   * Execute using SDK mode (optional)
   * Returns cancel handle and completion promise
   */
  executeSdk?: (
    task: TaskPrompt,
    options: ExecuteOptions,
    onOutput: (output: AgentOutput) => void,
    onToolEvent: (event: ToolExecutionEvent) => void
  ) => { cancel: () => Promise<void>; done: Promise<void> };

  /**
   * Get available AI models for this agent (optional)
   * Only supported by SDK-mode adapters
   */
  getAvailableModels?: () => ModelInfo[];
}
