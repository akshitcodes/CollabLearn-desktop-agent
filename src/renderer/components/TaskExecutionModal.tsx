import { useState, useEffect, useMemo } from 'react';
import { Task, ModelInfo } from '../../shared/types';
import { TerminalOutput } from './TerminalOutput';

interface AgentOutput {
  type: 'stdout' | 'stderr' | 'status' | 'complete' | 'error' | 'tool_start' | 'tool_end' | 'tool_error';
  data: string;
  timestamp: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
}

interface TaskExecutionModalProps {
  task: Task;
  agentId: string;
  agentName: string;
  projectPath: string;
  workspaceId: number;
  cachedOutput?: AgentOutput[];
  cachedSummary?: string | null;
  initialProcessId?: string | null;
  initialExecutionStatus?: 'running' | 'completed' | 'failed' | 'stopped' | null;
  onClose: () => void;
  onStart: (taskId: number) => void;  // Called when execution starts
  onComplete: (status: 'completed' | 'error', outputs: AgentOutput[], summary?: string) => void;
}

/**
 * TaskExecutionModal - Execute a synced task with an agent
 * Shows real-time output and reports status back to backend
 */
export function TaskExecutionModal({
  task,
  agentId,
  agentName,
  projectPath,
  workspaceId,
  cachedOutput = [],
  cachedSummary = null,
  initialProcessId = null,
  initialExecutionStatus = null,
  onClose,
  onStart,
  onComplete,
}: TaskExecutionModalProps) {
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'error'>(() => {
    if (initialExecutionStatus === 'running') return 'running';
    if (initialExecutionStatus === 'failed') return 'error';
    if (initialExecutionStatus === 'completed' || initialExecutionStatus === 'stopped') return 'completed';
    return cachedOutput.length > 0 ? 'completed' : 'idle';
  });
  const [outputs, setOutputs] = useState<AgentOutput[]>(cachedOutput);
  const [processId, setProcessId] = useState<string | null>(initialProcessId);
  const [summary, setSummary] = useState<string | null>(cachedSummary);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  
  // Model selection state
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('claude-sonnet-4.5');
  const [isLoadingModels, setIsLoadingModels] = useState(true);

  // Fetch available models on mount
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const result = await window.electronAPI.agents.listModels(agentId);
        if (result.success && result.models.length > 0) {
          setAvailableModels(result.models);
          // Keep claude-sonnet-4.5 as default if available, otherwise use first model
          const hasDefault = result.models.some(m => m.id === 'claude-sonnet-4.5');
          if (!hasDefault) {
            setSelectedModel(result.models[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to fetch models:', err);
      } finally {
        setIsLoadingModels(false);
      }
    };
    fetchModels();
  }, [agentId]);

  // Subscribe to agent output events
  useEffect(() => {
    if (!processId) return;

    const unsubscribe = window.electronAPI.on(`agent:output:${processId}`, (output: unknown) => {
      const agentOutput = output as AgentOutput;
      console.log(`📥 Agent output received:`, agentOutput.type, agentOutput.data?.substring(0, 100));
      
      setOutputs(prev => {
        const newOutputs = [...prev, agentOutput];
        
        // Handle completion inside setState to get latest outputs
        if (agentOutput.type === 'complete') {
          console.log('✅ Complete event received, updating status...');
          setStatus('completed');
          // Call with current outputs
          handleTaskComplete('completed', newOutputs);
        } else if (agentOutput.type === 'error') {
          console.log('❌ Error event received');
          setStatus('error');
          handleTaskComplete('error', newOutputs);
        }
        
        return newOutputs;
      });
    });

    return () => {
      unsubscribe();
    };
  }, [processId]);

  const handleTaskComplete = async (finalStatus: 'completed' | 'error', currentOutputs: AgentOutput[]) => {
    // Update task status in backend
    console.log(`🔄 handleTaskComplete called with status: ${finalStatus}`);
    try {
      const backendStatus = finalStatus === 'completed' ? 'completed' : 'blocked';
      await window.electronAPI.sync.updateTaskStatus(task.id, backendStatus);
      console.log(`✅ Task ${task.id} status updated to: ${backendStatus}`);
    } catch (err) {
      console.error('Failed to update task status:', err);
    }
    
    // Generate AI summary
    if (finalStatus === 'completed') {
      setIsGeneratingSummary(true);
      try {
        const outputText = currentOutputs
          .filter(o => o.type === 'stdout' || o.type === 'stderr')
          .map(o => o.data)
          .join('');
        
        const result = await window.electronAPI.agents.summarize(agentId, task.title, outputText);
        if (result.success && result.summary) {
          setSummary(result.summary);
          onComplete(finalStatus, currentOutputs, result.summary);
        } else {
          setSummary('Task completed successfully');
          onComplete(finalStatus, currentOutputs, 'Task completed successfully');
        }
      } catch (err) {
        console.error('Failed to generate summary:', err);
        setSummary('Task completed successfully');
        onComplete(finalStatus, currentOutputs, 'Task completed successfully');
      } finally {
        setIsGeneratingSummary(false);
      }
    } else {
      // For errors, use a simple message
      setSummary('Task encountered an error');
      onComplete(finalStatus, currentOutputs, 'Task encountered an error');
    }
  };

  const handleExecute = async () => {
    setStatus('running');
    setOutputs([]);
    setSummary(null);

    // Notify parent that execution is starting (updates task list UI)
    onStart(task.id);

    // Update task to in_progress on backend
    try {
      await window.electronAPI.sync.updateTaskStatus(task.id, 'in_progress');
    } catch (err) {
      console.error('Failed to set task in_progress:', err);
    }

    try {
      // Pass taskId and model so main process can update backend status even if modal is closed
      const result = await window.electronAPI.agents.executeTest(agentId, {
        title: task.title,
        description: task.description || '',
        projectPath: projectPath,
        context: `Task ID: ${task.id}\nPhase ID: ${task.phaseId}\nPriority: ${task.priority}`,
        taskId: task.id,  // Real task ID for main process status updates
        model: selectedModel,  // Selected AI model
      });
      setProcessId(result.processId);
    } catch (err) {
      console.error('Failed to execute agent:', err);
      setStatus('error');
      const errorOutput: AgentOutput = {
        type: 'error',
        data: err instanceof Error ? err.message : 'Unknown error',
        timestamp: Date.now(),
      };
      setOutputs([errorOutput]);
      onComplete('error', [errorOutput]);
    }
  };

  const handleStop = async () => {
    if (processId) {
      try {
        await window.electronAPI.agents.stop(processId);
        const stopOutput: AgentOutput = {
          type: 'status',
          data: 'Process stopped by user',
          timestamp: Date.now(),
        };
        setOutputs(prev => [...prev, stopOutput]);
        setStatus('completed');
      } catch (err) {
        console.error('Failed to stop agent:', err);
      }
    }
  };

  const getStatusIcon = (taskStatus: string) => {
    switch (taskStatus) {
      case 'completed': return '✅';
      case 'in_progress': return '🔄';
      case 'blocked': return '🚫';
      default: return '⏳';
    }
  };

  // Accumulate terminal output as a single string for proper rendering
  const accumulatedOutput = useMemo(() => {
    return outputs
      .filter(o => o.type === 'stdout' || o.type === 'stderr')
      .map(o => o.data)
      .join('');
  }, [outputs]);

  // Get only the initial status message (started), not completion messages
  const statusMessages = useMemo(() => {
    return outputs.filter(o => o.type === 'status' || o.type === 'tool_start' || o.type === 'tool_end' || o.type === 'tool_error');
  }, [outputs]);

  const isReportMode = status === 'completed' && outputs.length > 0;

  return (
    <div className="task-execution-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="task-execution-modal">
        <div className="modal-header">
          <div className="modal-title">
            <span className="modal-icon">{isReportMode ? '📋' : '⚡'}</span>
            <h3>{isReportMode ? 'Agent Report' : 'Execute Task'}</h3>
          </div>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        {/* Task Info */}
        <div className="task-info-section">
          <div className="task-info-header">
            <span className="task-status-icon">{getStatusIcon(task.status)}</span>
            <h4 className="task-title">{task.title}</h4>
          </div>
          {task.description && (
            <p className="task-description">{task.description}</p>
          )}
          <div className="task-meta-row">
            <span className="meta-item">
              <strong>Agent:</strong> {agentName}
            </span>
            <span className="meta-item">
              <strong>Path:</strong> <code>{projectPath}</code>
            </span>
          </div>
        </div>

        {/* Report Summary - shown for completed tasks */}
        {isReportMode && (
          <div className="report-summary">
            <div className="report-summary-header">
              <span className="summary-icon">✨</span>
              <strong>AI Summary</strong>
              {isGeneratingSummary && <span className="summary-loading">Generating...</span>}
            </div>
            {isGeneratingSummary ? (
              <div className="summary-text summary-loading-text">
                <span className="loading-spinner">⏳</span> Asking agent to summarize the output...
              </div>
            ) : (
              <pre className="summary-text">{summary || 'Summary not available'}</pre>
            )}
            <div className="report-stats">
              <span className="stat-item">
                <strong>{outputs.filter(o => o.type === 'stdout').length}</strong> outputs
              </span>
              <span className="stat-item">
                <strong>{outputs.filter(o => o.type === 'stderr' || o.type === 'error').length}</strong> errors
              </span>
              <span className="stat-item">
                Ran at <strong>{outputs[0] ? new Date(outputs[0].timestamp).toLocaleString() : 'N/A'}</strong>
              </span>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="execution-actions">
          {/* Model selector */}
          <div className="model-selector">
            <label htmlFor="model-select">Model:</label>
            <select
              id="model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={status === 'running' || isLoadingModels}
              className="model-dropdown"
            >
              {isLoadingModels ? (
                <option value="">Loading...</option>
              ) : (
                availableModels.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name} {model.multiplier && `(${model.multiplier})`}
                  </option>
                ))
              )}
            </select>
          </div>
          
          {status === 'running' ? (
            <button className="btn btn-danger" onClick={handleStop}>
              ⏹ Stop Execution
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleExecute}
              disabled={isLoadingModels}
            >
              {outputs.length > 0 ? '🔄 Re-run Task' : '▶ Run Task'}
            </button>
          )}
          <span className={`execution-status ${status}`}>
            {status === 'idle' && '⚪ Ready'}
            {status === 'running' && '🔄 Running...'}
            {status === 'completed' && '✅ Completed'}
            {status === 'error' && '❌ Error'}
          </span>
        </div>

        {/* Status messages - only show if running or just started */}
        {status === 'running' && statusMessages.length > 0 && (
          <div className="status-messages">
            {statusMessages.slice(-1).map((msg, idx) => (
              <div key={idx} className={`status-message status-${msg.type}`}>
                <span className="status-icon">📋</span>
                <span className="status-text">{msg.data}</span>
              </div>
            ))}
          </div>
        )}

        {/* Terminal Output viewer */}
        <div className="execution-output-container">
          {outputs.length === 0 ? (
            <div className="output-placeholder">
              Click "Run Task" to start execution. Output will appear here...
            </div>
          ) : (
            <>
              {isReportMode && (
                <div className="output-header">
                  <span>📜 Full Agent Log</span>
                </div>
              )}
              <TerminalOutput 
                output={accumulatedOutput} 
                isRunning={status === 'running'}
                className="task-terminal"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default TaskExecutionModal;
