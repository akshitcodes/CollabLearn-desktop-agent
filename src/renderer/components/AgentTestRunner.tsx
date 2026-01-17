import { useState, useEffect, useMemo } from 'react';
import { TerminalOutput } from './TerminalOutput';

interface AgentOutput {
  type: 'stdout' | 'stderr' | 'status' | 'complete' | 'error' | 'tool_start' | 'tool_end' | 'tool_error';
  data: string;
  timestamp: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
}

interface AgentTestRunnerProps {
  agentId: string;
  agentName: string;
  onClose: () => void;
}

/**
 * AgentTestRunner - A modal/panel to test agent execution
 * Shows real-time output from the agent
 */
export function AgentTestRunner({ agentId, agentName, onClose }: AgentTestRunnerProps) {
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle');
  const [outputs, setOutputs] = useState<AgentOutput[]>([]);
  const [processId, setProcessId] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string>('');
  const [taskDescription, setTaskDescription] = useState<string>('List the files in the current directory');

  // Accumulate terminal output as a single string for proper rendering
  const accumulatedOutput = useMemo(() => {
    return outputs
      .filter(o => o.type === 'stdout' || o.type === 'stderr')
      .map(o => o.data)
      .join('');
  }, [outputs]);

  // Get status messages separately
  const statusMessages = useMemo(() => {
    return outputs.filter(o => o.type === 'status' || o.type === 'complete' || o.type === 'error' || o.type === 'tool_start' || o.type === 'tool_end' || o.type === 'tool_error');
  }, [outputs]);

  // Subscribe to agent output events
  useEffect(() => {
    if (!processId) return;

    const unsubscribe = window.electronAPI.on(`agent:output:${processId}`, (output: unknown) => {
      const agentOutput = output as AgentOutput;
      setOutputs(prev => [...prev, agentOutput]);
      
      if (agentOutput.type === 'complete') {
        setStatus('completed');
      } else if (agentOutput.type === 'error') {
        setStatus('error');
      }
    });

    return () => {
      unsubscribe();
    };
  }, [processId]);

  const handleExecute = async () => {
    if (!projectPath.trim()) {
      alert('Please enter a project path');
      return;
    }

    setStatus('running');
    setOutputs([]);
    
    try {
      const result = await window.electronAPI.agents.executeTest(agentId, {
        title: 'Test Task',
        description: taskDescription,
        projectPath: projectPath,
      });
      setProcessId(result.processId);
    } catch (err) {
      console.error('Failed to execute agent:', err);
      setStatus('error');
      setOutputs([{
        type: 'error',
        data: err instanceof Error ? err.message : 'Unknown error',
        timestamp: Date.now(),
      }]);
    }
  };

  const handleStop = async () => {
    if (processId) {
      try {
        await window.electronAPI.agents.stop(processId);
        setStatus('completed');
        setOutputs(prev => [...prev, {
          type: 'status',
          data: 'Process stopped by user',
          timestamp: Date.now(),
        }]);
      } catch (err) {
        console.error('Failed to stop agent:', err);
      }
    }
  };

  return (
    <div className="agent-test-runner-overlay">
      <div className="agent-test-runner">
        <div className="test-runner-header">
          <h3>🧪 Test {agentName}</h3>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        <div className="test-runner-config">
          <div className="config-field">
            <label>Project Path</label>
            <input
              type="text"
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder="C:\path\to\your\project"
              disabled={status === 'running'}
            />
          </div>
          
          <div className="config-field">
            <label>Task Description</label>
            <textarea
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              placeholder="Describe what you want the agent to do..."
              rows={3}
              disabled={status === 'running'}
            />
          </div>
        </div>

        <div className="test-runner-actions">
          {status === 'running' ? (
            <button className="btn btn-danger" onClick={handleStop}>
              ⏹ Stop
            </button>
          ) : (
            <button 
              className="btn btn-primary" 
              onClick={handleExecute}
              disabled={!projectPath.trim()}
            >
              ▶ Run Test
            </button>
          )}
          <span className={`status-indicator ${status}`}>
            {status === 'idle' && '⚪ Ready'}
            {status === 'running' && '🔄 Running...'}
            {status === 'completed' && '✅ Completed'}
            {status === 'error' && '❌ Error'}
          </span>
        </div>

        {/* Status messages */}
        {statusMessages.length > 0 && (
          <div className="status-messages">
            {statusMessages.map((msg, idx) => (
              <div key={idx} className={`status-message status-${msg.type}`}>
                <span className="status-icon">
                  {msg.type === 'status' && '📋'}
                  {msg.type === 'complete' && '✅'}
                  {msg.type === 'error' && '❌'}
                </span>
                <span className="status-text">{msg.data}</span>
              </div>
            ))}
          </div>
        )}

        {/* Terminal output */}
        <div className="test-runner-output">
          {outputs.length === 0 ? (
            <div className="output-placeholder">
              Output will appear here when you run the test...
            </div>
          ) : (
            <TerminalOutput 
              output={accumulatedOutput} 
              isRunning={status === 'running'}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default AgentTestRunner;
