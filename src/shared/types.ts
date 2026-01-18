// ===========================================
// Shared Types
// ===========================================
// Types used by both main and renderer processes

// Global type augmentation for window.electronAPI
declare global {
  interface Window {
    electronAPI: {
      getVersion: () => Promise<string>;
      
      agents: {
        getAvailable: () => Promise<AgentInfo[]>;
        execute: (agentId: string, taskId: string) => Promise<{ processId: string }>;
        executeTest: (agentId: string, task: TestTaskInput) => Promise<{ processId: string }>;
        stop: (processId: string) => Promise<void>;
        refresh: () => Promise<{ success: boolean }>;
        summarize: (agentId: string, taskTitle: string, output: string) => Promise<{ success: boolean; summary: string }>;
        listModels: (agentId: string) => Promise<{ success: boolean; models: ModelInfo[] }>;
      };
      
      sync: {
        fetchWorkspaces: () => Promise<Workspace[]>;
        fetchPhases: (workspaceId: number) => Promise<Phase[]>;
        fetchTasks: (workspaceId: number) => Promise<Task[]>;
        fetchTasksByPhase: (phaseId: number) => Promise<Task[]>;
        updateTaskStatus: (taskId: number, status: string) => Promise<{ success: boolean }>;
        fetchRoadmapOverview: (workspaceId: number) => Promise<{
          totalPhases: number;
          totalTasks: number;
          completedTasks: number;
          inProgressTasks: number;
        }>;
      };
      
      auth: {
        login: (token: string) => Promise<{ success: boolean; user?: User; error?: string }>;
        logout: () => Promise<void>;
        isAuthenticated: () => Promise<boolean>;
        getUser: () => Promise<User | null>;
        validateToken: () => Promise<boolean>;
      };
      
      config: {
        get: <T>(key: string) => Promise<T | null>;
        set: <T>(key: string, value: T) => Promise<void>;
      };
      
      workspace: {
        getDirectory: (workspaceId: number) => Promise<string | null>;
        setDirectory: (workspaceId: number, path: string) => Promise<{ success: boolean }>;
        selectDirectory: () => Promise<{ canceled: boolean; path: string | null }>;
      };
      
      logs: {
        get: (taskId: number) => Promise<{ outputs: Array<{ type: string; data: string; timestamp: number }>; lastExecutedAt: number; processId?: string; status?: 'running' | 'completed' | 'failed' | 'stopped' } | null>;
        set: (taskId: number, outputs: Array<{ type: string; data: string; timestamp: number }>) => Promise<{ success: boolean }>;
        clear: (taskId: number) => Promise<{ success: boolean }>;
        getStatus: (taskId: number) => Promise<{ processId: string | null; status: 'running' | 'completed' | 'failed' | 'stopped' | null }>; 
      };
      
      phase: {
        execute: (options: PhaseExecutionInput) => Promise<PhaseResultOutput>;
        stop: (immediately?: boolean) => Promise<{ success: boolean }>;
        isExecuting: () => Promise<boolean>;
      };
      
      context: {
        sync: (options: ContextSyncInput) => Promise<{ synced: boolean; source: 'local' | 'api' | 'none' }>;
        hasLocal: (options: { projectPath: string; agentId: string }) => Promise<boolean>;
      };
      
      ideation: {
        fetchConfig: (mode: 'standard' | 'deep_brainstorm') => Promise<IdeationConfig>;
        createSession: (options: { mode: 'standard' | 'deep_brainstorm'; projectTitle?: string }) => Promise<IdeationSession>;
        getLocalSessions: () => Promise<IdeationSession[]>;
        syncSession: (session: IdeationSession) => Promise<void>;
        linkToCollab: (sessionId: string, collabId: number) => Promise<void>;
        sendMessage: (options: { sessionId: string; message: string; mode: 'standard' | 'deep_brainstorm' }) => Promise<{ response: string; messageId: string }>;
      };
      
      contextpack: {
        preview: (options: { projectPath: string; agents?: ('cursor' | 'claude' | 'copilot' | 'windsurf')[] }) => Promise<{ files: string[]; existingFiles: string[] }>;
        fetchPrompts: () => Promise<ContextPackPrompts>;
        fetchAgentTemplates: () => Promise<Record<string, AgentConfigTemplate>>;
        writeFiles: (options: { projectPath: string; files: Array<{ type: string; content: string }>; overwrite?: boolean }) => Promise<GeneratedFile[]>;
        writeAgentConfigs: (options: { projectPath: string; agents?: ('cursor' | 'claude' | 'copilot' | 'windsurf')[]; overwrite?: boolean }) => Promise<GeneratedFile[]>;
      };
      
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
    };
  }
}

// User
export interface User {
  id: number;
  username: string;
  email: string;
  avatar?: string;
}

// Workspace (from CollabLearn)
export interface Workspace {
  id: number;
  name: string;
  description?: string;
  createdAt: string;
  role: 'owner' | 'builder' | 'viewer';
}

// Phase
export interface Phase {
  id: number;
  title: string;
  description?: string;
  order: number;
  tasksCount: number;
  completedCount: number;
}

// Task
export interface Task {
  id: number;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high';
  phaseId: number;
  github_issue_number?: number;
  github_issue_url?: string;
}

export type TaskStatus = 
  | 'pending' 
  | 'in_progress' 
  | 'completed' 
  | 'blocked';

// Agent Info (for UI)
export interface AgentInfo {
  id: string;
  name: string;
  icon: string;
  installed: boolean;
  version: string | null;
  enabled: boolean;
}

// Config types
export interface AppConfig {
  theme: 'light' | 'dark' | 'system';
  defaultAgent?: string;
  autoSync: boolean;
  syncInterval: number; // in minutes
}

export interface AgentConfig {
  enabled: boolean;
  executablePath: string;
  defaultFlags: string[];
}

// AI Model info for task execution
export interface ModelInfo {
  id: string;          // e.g., 'claude-sonnet-4.5', 'gpt-5.2'
  name: string;        // Display name
  provider: 'openai' | 'anthropic' | 'google';
  multiplier?: string; // Rate multiplier shown in CLI (e.g., '1x', '3x')
  requiresEnablement?: boolean;
}

// Input for test/task execution
export interface TestTaskInput {
  title: string;
  description: string;
  projectPath: string;
  context?: string;
  taskId?: number;  // Real task ID for main process to update backend status
  model?: string;   // Model to use for this task execution
}

// Phase orchestration input for IPC
export interface PhaseExecutionInput {
  phaseId: number;
  workspaceId: number;
  agentId: string;
  projectPath: string;
}

// Phase orchestration result for IPC
export interface TaskResultOutput {
  taskId: number;
  taskTitle: string;
  status: 'completed' | 'failed' | 'blocked' | 'skipped';
  blockerReason?: string;
  duration: number;
  output: string;
}

export interface PhaseResultOutput {
  phaseId: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksBlocked: number;
  tasksSkipped: number;
  results: TaskResultOutput[];
  stoppedByUser: boolean;
  blockerReason?: string;
  totalDuration: number;
}

// Context sync input for IPC
export interface ContextSyncInput {
  projectPath: string;
  agentId: string;
  workspaceId: number;
  forceRefresh?: boolean;
}

// ===========================================
// Ideation Types
// ===========================================

export interface IdeationMessage {
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface IdeationSession {
  sessionId: string;
  mode: 'standard' | 'deep_brainstorm';
  projectTitle?: string;
  status: 'active' | 'plan_generated' | 'completed';
  messages: IdeationMessage[];
  createdAt: Date;
  updatedAt: Date;
  linkedCollabId?: number;
}

export interface IdeationConfig {
  mode: 'standard' | 'deep_brainstorm';
  systemPrompt: string;
  planGenerationPrompt: string;
  summarizationPrompt?: string;
  config: {
    maxTokens: number;
    planMaxTokens: number;
    temperature: number;
    generateDiagrams: boolean;
  };
  tools: Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
}

// ===========================================
// Context Pack Types
// ===========================================

export interface ContextPackPrompts {
  product: { description: string; prompt: string };
  tech_spec: { description: string; prompt: string };
  active_plan: { description: string; prompt: string };
}

export interface AgentConfigTemplate {
  path: string;
  template: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
  type: 'context_pack' | 'agent_config';
}

export {};
