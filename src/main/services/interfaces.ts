// ===========================================
// Service Interfaces
// ===========================================
// Core service contracts. All services implement these interfaces,
// making them easy to mock for testing and swap implementations.

import { Observable } from 'rxjs';

// Types (duplicated here to avoid circular imports)
export interface User {
  id: number;
  username: string;
  email: string;
  avatar?: string;
}

export interface Workspace {
  id: number;
  name: string;
  description?: string;
  createdAt: string;
  role: 'owner' | 'builder' | 'viewer';
}

export interface Phase {
  id: number;
  title: string;
  description?: string;
  order: number;
  tasksCount: number;
  completedCount: number;
}

export interface Task {
  id: number;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  priority: 'low' | 'medium' | 'high';
  phaseId: number;
}

export interface AgentInfo {
  id: string;
  name: string;
  icon: string;
  installed: boolean;
  version: string | null;
  enabled: boolean;
}

export interface AgentOutput {
  type: 'stdout' | 'stderr' | 'status' | 'complete' | 'error';
  data: string;
  timestamp: number;
}

// ===========================================
// IAuthService
// ===========================================
export interface IAuthService {
  /**
   * Login with a desktop token from CollabLearn web
   */
  login(token: string): Promise<User>;

  /**
   * Logout and clear stored credentials
   */
  logout(): void;

  /**
   * Get the stored auth token
   */
  getToken(): string | null;

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean;

  /**
   * Get the current user info
   */
  getCurrentUser(): User | null;
}

// ===========================================
// ISyncService
// ===========================================
export interface ISyncService {
  /**
   * Fetch all workspaces for the authenticated user
   */
  fetchWorkspaces(): Promise<Workspace[]>;

  /**
   * Fetch phases for a workspace
   */
  fetchPhases(workspaceId: number): Promise<Phase[]>;

  /**
   * Fetch tasks for a phase
   */
  fetchTasks(phaseId: number): Promise<Task[]>;

  /**
   * Update a task's status
   */
  updateTaskStatus(
    taskId: number,
    status: Task['status']
  ): Promise<void>;

  /**
   * Set the backend API URL
   */
  setApiUrl(url: string): void;
}

// ===========================================
// IAgentManager
// ===========================================
export interface IAgentManager {
  /**
   * Get list of all known agents with their status
   */
  getAvailableAgents(): Promise<AgentInfo[]>;

  /**
   * Refresh agent detection (re-check CLI availability)
   */
  refreshAgents(): Promise<void>;

  /**
   * Execute a task with a specific agent
   * Returns an observable for streaming output
   */
  executeTask(agentId: string, task: Task, projectPath: string, processId?: string): Observable<AgentOutput>;

  /**
   * Stop a running agent process
   */
  stopExecution(processId: string): Promise<void>;

  /**
   * Get the status of a running execution
   */
  getExecutionStatus(processId: string): 'running' | 'completed' | 'failed' | 'stopped' | null;
}
