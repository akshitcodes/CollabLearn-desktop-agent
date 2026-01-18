// ===========================================
// SyncService
// ===========================================
// Syncs workspaces and tasks from CollabLearn backend.

import { ConfigStore } from './ConfigStore';
import { AuthService } from './AuthService';
import { Workspace, Phase, Task } from '../../shared/types';
import { PRODUCTION_API_URL } from '../../shared/constants';

// API base URL
const getApiBaseUrl = (): string => {
  const customUrl = ConfigStore.get('apiBaseUrl');
  return customUrl || PRODUCTION_API_URL;
};

/**
 * Helper to make authenticated API requests
 */
async function fetchWithAuth(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const token = AuthService.getToken();
  
  if (!token) {
    throw new Error('Not authenticated');
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };

  return fetch(`${getApiBaseUrl()}${endpoint}`, {
    ...options,
    headers,
  });
}

/**
 * SyncService - Fetches data from CollabLearn backend
 */
export const SyncService = {
  /**
   * Fetch all workspaces (collabs) the user has access to
   * Combines user-created and user-joined collabs
   */
  async fetchWorkspaces(): Promise<Workspace[]> {
    try {
      // Fetch both created and joined workspaces
      const [createdRes, joinedRes] = await Promise.all([
        fetchWithAuth('/collabs/user-created'),
        fetchWithAuth('/collabs/user-joined'),
      ]);

      if (!createdRes.ok || !joinedRes.ok) {
        // Try to get error message
        if (createdRes.status === 401 || joinedRes.status === 401) {
          throw new Error('Session expired. Please login again.');
        }
        throw new Error('Failed to fetch workspaces');
      }

      const created = await createdRes.json();
      const joined = await joinedRes.json();

      // Transform to Workspace type and combine
      const workspaces: Workspace[] = [];
      const seenIds = new Set<number>();

      // Add created (owner)
      for (const collab of created.collabs || created || []) {
        if (!seenIds.has(collab.id)) {
          seenIds.add(collab.id);
          workspaces.push({
            id: collab.id,
            name: collab.name || collab.title,
            description: collab.description,
            createdAt: collab.created_at || collab.createdAt,
            role: 'owner',
          });
        }
      }

      // Add joined (builder or viewer)
      for (const collab of joined.collabs || joined || []) {
        if (!seenIds.has(collab.id)) {
          seenIds.add(collab.id);
          workspaces.push({
            id: collab.id,
            name: collab.name || collab.title,
            description: collab.description,
            createdAt: collab.created_at || collab.createdAt,
            role: collab.role || 'builder',
          });
        }
      }

      console.log(`📦 Fetched ${workspaces.length} workspaces`);
      return workspaces;
    } catch (error) {
      console.error('Failed to fetch workspaces:', error);
      throw error;
    }
  },

  /**
   * Fetch phases for a workspace
   */
  async fetchPhases(workspaceId: number): Promise<Phase[]> {
    try {
      const response = await fetchWithAuth(`/collabs/${workspaceId}/roadmap/phases`);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Session expired. Please login again.');
        }
        throw new Error('Failed to fetch phases');
      }

      const data = await response.json();
      // Backend returns { success: true, data: [...] }
      const phases = data.data || data.phases || data || [];

      return phases.map((p: any) => ({
        id: p.id,
        title: p.title || p.name,
        description: p.description,
        order: p.order || p.position || 0,
        tasksCount: p.tasks_count || p.tasksCount || 0,
        completedCount: p.completed_count || p.completedCount || 0,
      }));
    } catch (error) {
      console.error('Failed to fetch phases:', error);
      throw error;
    }
  },

  /**
   * Fetch all tasks for a workspace (across all phases)
   */
  async fetchTasks(workspaceId: number): Promise<Task[]> {
    try {
      const response = await fetchWithAuth(`/collabs/${workspaceId}/roadmap/tasks`);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Session expired. Please login again.');
        }
        throw new Error('Failed to fetch tasks');
      }

      const data = await response.json();
      // Backend returns { success: true, data: [...] }
      const tasks = data.data || data.tasks || data || [];

      // Status normalization: backend uses uppercase (TODO, IN_PROGRESS, COMPLETED, BLOCKED)
      // Frontend uses lowercase (pending, in_progress, completed, blocked)
      const normalizeStatus = (status: string): string => {
        const statusMap: Record<string, string> = {
          'TODO': 'pending',
          'IN_PROGRESS': 'in_progress',
          'DONE': 'completed',
          'BLOCKED': 'blocked',
        };
        return statusMap[status] || status?.toLowerCase() || 'pending';
      };

      return tasks.map((t: any) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: normalizeStatus(t.status),
        priority: t.priority?.toLowerCase() || 'medium',
        phaseId: t.phase_id || t.phaseId,
        github_issue_number: t.github_issue_number,
        github_issue_url: t.github_issue_url,
      }));
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
      throw error;
    }
  },

  /**
   * Fetch tasks for a specific phase
   * Note: roadmapRoutes is mounted at /api in app.js
   */
  async fetchTasksByPhase(phaseId: number): Promise<Task[]> {
    try {
      const response = await fetchWithAuth(`/api/phases/${phaseId}/tasks`);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Session expired. Please login again.');
        }
        throw new Error('Failed to fetch tasks');
      }

      const data = await response.json();
      // Backend returns { success: true, data: [...] }
      const tasks = data.data || data.tasks || data || [];

      // Status normalization: backend uses uppercase, frontend uses lowercase
      const normalizeStatus = (status: string): string => {
        const statusMap: Record<string, string> = {
          'TODO': 'pending',
          'IN_PROGRESS': 'in_progress',
          'DONE': 'completed',
          'BLOCKED': 'blocked',
        };
        return statusMap[status] || status?.toLowerCase() || 'pending';
      };

      return tasks.map((t: any) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: normalizeStatus(t.status),
        priority: t.priority?.toLowerCase() || 'medium',
        phaseId: t.phase_id || t.phaseId || phaseId,
        github_issue_number: t.github_issue_number,
        github_issue_url: t.github_issue_url,
      }));
    } catch (error) {
      console.error('Failed to fetch tasks by phase:', error);
      throw error;
    }
  },

  /**
   * Update task status
   * Backend expects uppercase status values: TODO, IN_PROGRESS, COMPLETED, BLOCKED
   * Note: roadmapRoutes is mounted at /api in app.js, so endpoint is /api/tasks/:taskId
   */
  async updateTaskStatus(taskId: number, status: string): Promise<void> {
    // Normalize status to uppercase (backend expects TODO, IN_PROGRESS, COMPLETED, BLOCKED)
    const statusMap: Record<string, string> = {
      'pending': 'TODO',
      'todo': 'TODO',
      'in_progress': 'IN_PROGRESS',
      'completed': 'DONE',
      'blocked': 'BLOCKED',
    };
    const normalizedStatus = statusMap[status.toLowerCase()] || status.toUpperCase();
    
    try {
      // roadmapRoutes is mounted at /api in backend app.js
      const response = await fetchWithAuth(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: normalizedStatus }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`Failed to update task ${taskId}:`, response.status, errorBody);
        throw new Error(`Failed to update task status: ${response.status} - ${errorBody}`);
      }

      console.log(`✅ Task ${taskId} status updated to: ${normalizedStatus}`);
    } catch (error) {
      console.error('Failed to update task status:', error);
      throw error;
    }
  },

  /**
   * Fetch roadmap overview (summary stats)
   */
  async fetchRoadmapOverview(workspaceId: number): Promise<{
    totalPhases: number;
    totalTasks: number;
    completedTasks: number;
    inProgressTasks: number;
  }> {
    try {
      const response = await fetchWithAuth(`/collabs/${workspaceId}/roadmap/overview`);

      if (!response.ok) {
        throw new Error('Failed to fetch roadmap overview');
      }

      const data = await response.json();
      return {
        totalPhases: data.total_phases || data.totalPhases || 0,
        totalTasks: data.total_tasks || data.totalTasks || 0,
        completedTasks: data.completed_tasks || data.completedTasks || 0,
        inProgressTasks: data.in_progress_tasks || data.inProgressTasks || 0,
      };
    } catch (error) {
      console.error('Failed to fetch roadmap overview:', error);
      throw error;
    }
  },
};

export default SyncService;
