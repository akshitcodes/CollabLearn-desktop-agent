import { AgentInfo } from '../../shared/types';

interface AgentCardProps {
  agent: AgentInfo;
  onToggle?: (enabled: boolean) => void;
  onTest?: () => void;
  showToggle?: boolean;
  compact?: boolean;
}

/**
 * AgentCard - Displays agent info with optional toggle
 */
export function AgentCard({ agent, onToggle, onTest, showToggle = false, compact = false }: AgentCardProps) {
  const getAgentIcon = (icon: string) => {
    switch (icon) {
      case 'copilot': return '🤖';
      case 'claude': return '🧠';
      case 'codex': return '⚡';
      default: return '🔧';
    }
  };

  const handleToggle = () => {
    if (onToggle) {
      onToggle(!agent.enabled);
    }
  };

  if (compact) {
    return (
      <div className={`agent-card compact ${agent.installed ? 'installed' : 'not-installed'}`}>
        <span className="agent-icon">{getAgentIcon(agent.icon)}</span>
        <div className="agent-info">
          <span className="agent-name">{agent.name}</span>
          {agent.installed ? (
            <span className="agent-version">v{agent.version || 'unknown'}</span>
          ) : (
            <span className="agent-status not-installed">Not installed</span>
          )}
        </div>
        <span className={`status-indicator ${agent.installed ? 'success' : 'error'}`}>
          {agent.installed ? '✓' : '✗'}
        </span>
      </div>
    );
  }

  return (
    <div className={`agent-card ${agent.installed ? 'installed' : 'not-installed'}`}>
      <div className="agent-header">
        <span className="agent-icon large">{getAgentIcon(agent.icon)}</span>
        <div className="agent-details">
          <h4 className="agent-name">{agent.name}</h4>
          <div className="agent-meta">
            {agent.installed ? (
              <>
                <span className="badge success">Installed</span>
                <span className="agent-version">v{agent.version || 'unknown'}</span>
              </>
            ) : (
              <span className="badge error">Not Installed</span>
            )}
          </div>
        </div>
      </div>

      <div className="agent-actions">
        {showToggle && agent.installed && (
          <>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={agent.enabled}
                onChange={handleToggle}
              />
              <span className="toggle-slider"></span>
            </label>
            <span className="toggle-label">{agent.enabled ? 'Enabled' : 'Disabled'}</span>
          </>
        )}
        
        {agent.installed && onTest && (
          <button 
            className="btn btn-secondary btn-small" 
            onClick={onTest}
            title="Test this agent with a sample task"
          >
            🧪 Test
          </button>
        )}
      </div>
    </div>
  );
}

export default AgentCard;
