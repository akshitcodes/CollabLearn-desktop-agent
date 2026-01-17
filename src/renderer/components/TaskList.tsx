import { useState, useEffect, useRef } from 'react';
import { Task, Phase, Workspace, AgentInfo } from '../../shared/types';
import TaskExecutionModal from './TaskExecutionModal';

interface AgentOutput {
  type: 'stdout' | 'stderr' | 'status' | 'complete' | 'error' | 'tool_start' | 'tool_end' | 'tool_error';
  data: string;
  timestamp: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
}

interface TaskListProps {
  workspace: Workspace;
  onBack: () => void;
  agents: AgentInfo[];
  onExecuteTask?: (task: Task, agentId: string) => void;
}

/**
 * TaskList - Shows phases and tasks for a workspace
 * Allows running tasks with installed agents
 */
export function TaskList({ workspace, onBack, agents, onExecuteTask }: TaskListProps) {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const tasksRef = useRef<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPhase, setExpandedPhase] = useState<number | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [isSelectingDir, setIsSelectingDir] = useState(false);
  
  // Execution modal state
  const [executingTask, setExecutingTask] = useState<Task | null>(null);
  const [executingMeta, setExecutingMeta] = useState<{ processId: string | null; status: 'running' | 'completed' | 'failed' | 'stopped' | null } | null>(null);
  const [cachedOutputs, setCachedOutputs] = useState<Record<number, AgentOutput[]>>({});

  // Get installed agents only
  const installedAgents = agents.filter(a => a.installed);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    loadData();
    loadProjectDir();
    // Set default agent if available
    if (installedAgents.length > 0 && !selectedAgent) {
      setSelectedAgent(installedAgents[0].id);
    }
  }, [workspace.id]);

  // Keep task statuses in sync even when the modal is closed
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const inProgress = tasksRef.current.filter(t => t.status === 'in_progress');
      if (inProgress.length === 0) return;

      const results = await Promise.all(
        inProgress.map(t => window.electronAPI.logs.getStatus(t.id).catch(() => ({ processId: null, status: null })))
      );

      if (cancelled) return;

      const byId = new Map(inProgress.map((t, i) => [t.id, results[i]]));

      setTasks(prev => prev.map(t => {
        const meta = byId.get(t.id);
        if (!meta) return t;

        if (meta.status === 'running') return { ...t, status: 'in_progress' };
        if (meta.status === 'completed') return { ...t, status: 'completed' };
        if (meta.status === 'failed' || meta.status === 'stopped') return { ...t, status: 'blocked' };
        return t;
      }));
    };

    const id = window.setInterval(tick, 2000);
    tick();

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [workspace.id]);

  const loadProjectDir = async () => {
    const dir = await window.electronAPI.workspace.getDirectory(workspace.id);
    setProjectDir(dir);
  };

  const handleSelectDirectory = async () => {
    setIsSelectingDir(true);
    try {
      const result = await window.electronAPI.workspace.selectDirectory();
      if (!result.canceled && result.path) {
        await window.electronAPI.workspace.setDirectory(workspace.id, result.path);
        setProjectDir(result.path);
      }
    } finally {
      setIsSelectingDir(false);
    }
  };

  const loadData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [phasesData, tasksData] = await Promise.all([
        window.electronAPI.sync.fetchPhases(workspace.id),
        window.electronAPI.sync.fetchTasks(workspace.id),
      ]);

      // Overlay local execution state so the UI stays correct if a task is currently running
      const execStates = await Promise.all(
        tasksData.map(t => window.electronAPI.logs.getStatus(t.id).catch(() => ({ processId: null, status: null })))
      );

      const mergedTasks = tasksData.map((t, idx) => {
        const s = execStates[idx];
        if (s?.status === 'running') return { ...t, status: 'in_progress' as const };
        if (s?.status === 'completed') return { ...t, status: 'completed' as const };
        if (s?.status === 'failed' || s?.status === 'stopped') return { ...t, status: 'blocked' as const };
        return t;
      });

      setPhases(phasesData);
      setTasks(mergedTasks);

      // Auto-expand first phase
      if (phasesData.length > 0) {
        setExpandedPhase(phasesData[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  const getTasksByPhase = (phaseId: number) => {
    return tasks.filter(t => t.phaseId === phaseId);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return '✅';
      case 'in_progress': return '🔄';
      case 'blocked': return '🚫';
      default: return '⏳';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#10b981';
      case 'in_progress': return '#f59e0b';
      case 'blocked': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return '#ef4444';
      case 'medium': return '#f59e0b';
      case 'low': return '#10b981';
      default: return '#6b7280';
    }
  };

  const handleRunTask = async (task: Task) => {
    const [persistedLogs, meta] = await Promise.all([
      window.electronAPI.logs.get(task.id),
      window.electronAPI.logs.getStatus(task.id),
    ]);

    if (persistedLogs) {
      setCachedOutputs(prev => ({
        ...prev,
        [task.id]: persistedLogs.outputs as AgentOutput[],
      }));
    }

    setExecutingMeta(meta);

    // Open execution modal (patch status so modal header shows correct state)
    const patchedTask: Task =
      meta.status === 'running'
        ? { ...task, status: 'in_progress' }
        : task;

    setExecutingTask(patchedTask);
  };

  // Called when execution starts - update local state immediately
  const handleExecutionStart = (taskId: number) => {
    setTasks(prev => prev.map(t => 
      t.id === taskId ? { ...t, status: 'in_progress' } : t
    ));
  };

  const handleExecutionComplete = async (taskId: number, status: 'completed' | 'error', outputs: AgentOutput[]) => {
    // Cache the outputs in memory
    setCachedOutputs(prev => ({
      ...prev,
      [taskId]: outputs,
    }));
    
    // Persist outputs to disk
    await window.electronAPI.logs.set(taskId, outputs);
    
    // Update task in local state to reflect new status
    setTasks(prev => prev.map(t => 
      t.id === taskId ? { ...t, status: status === 'completed' ? 'completed' : 'blocked' } : t
    ));
  };

  const handleModalClose = () => {
    setExecutingTask(null);
    setExecutingMeta(null);
    // Refresh, but keep local execution overlay so in-progress tasks don't "reset"
    loadData();
  };

  if (isLoading) {
    return (
      <div className="task-list">
        <div className="task-header">
          <button className="btn btn-icon" onClick={onBack}>←</button>
          <h3>{workspace.name}</h3>
        </div>
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading tasks...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="task-list">
        <div className="task-header">
          <button className="btn btn-icon" onClick={onBack}>←</button>
          <h3>{workspace.name}</h3>
        </div>
        <div className="error-state">
          <p>⚠️ {error}</p>
          <button className="btn btn-secondary" onClick={loadData}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="task-list">
      <div className="task-header">
        <button className="btn btn-icon" onClick={onBack} title="Back to workspaces">
          ←
        </button>
        <h3>{workspace.name}</h3>
        <div className="agent-selector">
          <label>Run with:</label>
          <select 
            value={selectedAgent || ''} 
            onChange={(e) => setSelectedAgent(e.target.value)}
            disabled={installedAgents.length === 0}
          >
            {installedAgents.length === 0 ? (
              <option>No agents installed</option>
            ) : (
              installedAgents.map(agent => (
                <option key={agent.id} value={agent.id}>
                  {agent.icon} {agent.name}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* Project Folder Setup Banner */}
      {!projectDir ? (
        <div className="setup-banner">
          <div className="setup-banner-content">
            <span className="setup-icon">📁</span>
            <div className="setup-text">
              <strong>Set Project Folder</strong>
              <span>Choose where agents will run code for this workspace</span>
            </div>
            <button 
              className="btn btn-primary"
              onClick={handleSelectDirectory}
              disabled={isSelectingDir}
            >
              {isSelectingDir ? 'Selecting...' : 'Select Folder'}
            </button>
          </div>
        </div>
      ) : (
        <div className="project-dir-info">
          <span className="dir-icon">📂</span>
          <span className="dir-path" title={projectDir}>{projectDir}</span>
          <button 
            className="btn btn-sm btn-ghost"
            onClick={handleSelectDirectory}
            disabled={isSelectingDir}
            title="Change project folder"
          >
            Change
          </button>
        </div>
      )}

      {phases.length === 0 ? (
        <div className="empty-state">
          <p>📭 No roadmap phases found</p>
          <p className="hint">Add phases and tasks on collablearn.in</p>
        </div>
      ) : (
        <div className="phases-container">
          {phases.sort((a, b) => a.order - b.order).map((phase) => {
            const phaseTasks = getTasksByPhase(phase.id);
            const isExpanded = expandedPhase === phase.id;

            return (
              <div key={phase.id} className="phase-section">
                <div 
                  className="phase-header"
                  onClick={() => setExpandedPhase(isExpanded ? null : phase.id)}
                >
                  <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
                  <h4 className="phase-title">{phase.title}</h4>
                  <span className="phase-count">
                    {phase.completedCount}/{phase.tasksCount || phaseTasks.length}
                  </span>
                </div>

                {isExpanded && (
                  <div className="phase-tasks">
                    {phaseTasks.length === 0 ? (
                      <p className="no-tasks">No tasks in this phase</p>
                    ) : (
                      phaseTasks.map((task) => (
                        <div key={task.id} className={`task-item ${task.status === 'in_progress' ? 'in-progress' : ''}`}>
                          <div className={`task-status ${task.status === 'in_progress' ? 'running' : ''}`} style={{ color: getStatusColor(task.status) }}>
                            {getStatusIcon(task.status)}
                          </div>
                          <div className="task-content">
                            <div className="task-title">{task.title}</div>
                            {task.description && (
                              <div className="task-description">{task.description}</div>
                            )}
                            <div className="task-meta">
                              <span 
                                className="priority-badge"
                                style={{ borderColor: getPriorityColor(task.priority) }}
                              >
                                {task.priority}
                              </span>
                              {task.github_issue_url && (
                                <a 
                                  href={task.github_issue_url} 
                                  target="_blank" 
                                  rel="noopener"
                                  className="github-link"
                                >
                                  GitHub #{task.github_issue_number}
                                </a>
                              )}
                            </div>
                          </div>
                          <div className="task-actions">
                            {task.status === 'in_progress' ? (
                              <button
                                className="btn btn-sm btn-running"
                                onClick={() => handleRunTask(task)}
                                title="View running task"
                              >
                                <span className="running-spinner"></span>
                                Running...
                              </button>
                            ) : task.status === 'completed' ? (
                              <button
                                className="btn btn-sm btn-completed"
                                onClick={() => handleRunTask(task)}
                                title="View agent report"
                              >
                                📋 View Report
                              </button>
                            ) : (
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => handleRunTask(task)}
                                disabled={!projectDir || !selectedAgent}
                                title={
                                  !projectDir
                                    ? 'Set project folder first'
                                    : !selectedAgent 
                                    ? 'No agent selected' 
                                    : `Run with ${installedAgents.find(a => a.id === selectedAgent)?.name}`
                                }
                              >
                                ▶ Run
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Task Execution Modal */}
      {executingTask && selectedAgent && projectDir && (
        <TaskExecutionModal
          task={executingTask}
          agentId={selectedAgent}
          agentName={installedAgents.find(a => a.id === selectedAgent)?.name || selectedAgent}
          projectPath={projectDir}
          workspaceId={workspace.id}
          cachedOutput={cachedOutputs[executingTask.id]}
          initialProcessId={executingMeta?.processId}
          initialExecutionStatus={executingMeta?.status}
          onClose={handleModalClose}
          onStart={handleExecutionStart}
          onComplete={(status, outputs) => handleExecutionComplete(executingTask.id, status, outputs)}
        />
      )}
    </div>
  );
}

export default TaskList;
