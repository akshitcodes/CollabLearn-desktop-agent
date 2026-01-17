import { useState, useEffect } from 'react';
import { Workspace } from '../../shared/types';

interface WorkspaceBrowserProps {
  onSelectWorkspace: (workspace: Workspace) => void;
}

/**
 * WorkspaceBrowser - Lists user's workspaces (collabs)
 * Shows role indicators and allows navigation to tasks
 */
export function WorkspaceBrowser({ onSelectWorkspace }: WorkspaceBrowserProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const loadWorkspaces = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await window.electronAPI.sync.fetchWorkspaces();
      setWorkspaces(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspaces');
    } finally {
      setIsLoading(false);
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'owner': return '#10b981'; // green
      case 'builder': return '#3b82f6'; // blue
      case 'viewer': return '#8b5cf6'; // purple
      default: return '#6b7280'; // gray
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner': return '👑';
      case 'builder': return '🔨';
      case 'viewer': return '👁️';
      default: return '👤';
    }
  };

  if (isLoading) {
    return (
      <div className="workspace-browser">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading workspaces...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="workspace-browser">
        <div className="error-state">
          <p>⚠️ {error}</p>
          <button className="btn btn-secondary" onClick={loadWorkspaces}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div className="workspace-browser">
        <div className="empty-state">
          <p>📭 No workspaces found</p>
          <p className="hint">Create a workspace on collablearn.in to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-browser">
      <div className="workspace-header">
        <h3>📂 Your Workspaces</h3>
        <button className="btn btn-icon" onClick={loadWorkspaces} title="Refresh">
          🔄
        </button>
      </div>
      
      <div className="workspace-list">
        {workspaces.map((workspace) => (
          <div
            key={workspace.id}
            className="workspace-card"
            onClick={() => onSelectWorkspace(workspace)}
          >
            <div className="workspace-info">
              <h4 className="workspace-name">{workspace.name}</h4>
              {workspace.description && (
                <p className="workspace-description">{workspace.description}</p>
              )}
            </div>
            <div className="workspace-meta">
              <span 
                className="role-badge"
                style={{ backgroundColor: getRoleColor(workspace.role) }}
              >
                {getRoleIcon(workspace.role)} {workspace.role}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default WorkspaceBrowser;
