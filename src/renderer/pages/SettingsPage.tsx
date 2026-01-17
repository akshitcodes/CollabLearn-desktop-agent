import { useState, useEffect } from 'react';
import { AgentInfo } from '../../shared/types';
import AgentCard from '../components/AgentCard';
import AgentTestRunner from '../components/AgentTestRunner';

interface SettingsPageProps {
  onNavigate: (page: 'dashboard' | 'settings') => void;
}

/**
 * SettingsPage - Agent configuration and app settings
 */
export function SettingsPage({ onNavigate }: SettingsPageProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [testingAgent, setTestingAgent] = useState<AgentInfo | null>(null);

  useEffect(() => {
    loadAgents();
  }, []);

  const loadAgents = async () => {
    try {
      const available = await window.electronAPI.agents.getAvailable();
      // Map to include enabled status from config
      const agentsWithConfig = available.map((agent: any) => ({
        ...agent,
        enabled: agent.config?.enabled ?? true,
      }));
      setAgents(agentsWithConfig);
    } catch (err) {
      console.error('Failed to load agents:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await window.electronAPI.agents.refresh();
      await loadAgents();
    } catch (err) {
      console.error('Failed to refresh agents:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleAgentToggle = async (agentId: string, enabled: boolean) => {
    try {
      const currentConfig = await window.electronAPI.config.get<Record<string, any>>('agents') || {};
      const agentConfig = currentConfig[agentId] || {
        enabled: true,
        executablePath: '',
        defaultFlags: [],
      };
      
      agentConfig.enabled = enabled;
      currentConfig[agentId] = agentConfig;
      
      await window.electronAPI.config.set('agents', currentConfig);
      
      // Update local state
      setAgents(prev => prev.map(agent => 
        agent.id === agentId ? { ...agent, enabled } : agent
      ));
    } catch (err) {
      console.error('Failed to toggle agent:', err);
    }
  };

  const handleTestAgent = (agent: AgentInfo) => {
    setTestingAgent(agent);
  };

  return (
    <div className="settings-page">
      <header className="page-header">
        <button className="back-button" onClick={() => onNavigate('dashboard')}>
          ← Back
        </button>
        <h1>Settings</h1>
      </header>

      <section className="settings-section">
        <div className="section-header">
          <h2>Coding Agents</h2>
          <button 
            className="btn btn-secondary" 
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? '⏳ Refreshing...' : '🔄 Refresh'}
          </button>
        </div>
        
        <p className="section-description">
          Configure which coding agents are available for task execution.
          Click "Test" to try an agent with a sample task.
        </p>

        {loading ? (
          <div className="loading-state">Loading agents...</div>
        ) : (
          <div className="agents-grid">
            {agents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                showToggle={true}
                onToggle={(enabled) => handleAgentToggle(agent.id, enabled)}
                // onTest={() => handleTestAgent(agent)} // Test feature hidden by default
              />
            ))}
            {agents.length === 0 && (
              <div className="empty-state">
                No agents detected. Make sure CLI tools are installed.
              </div>
            )}
          </div>
        )}
      </section>

      <section className="settings-section">
        <h2>App Settings</h2>
        <p className="section-description">
          Additional settings will be available in future updates.
        </p>
        <div className="placeholder-settings">
          <div className="setting-row disabled">
            <span>Theme</span>
            <span className="coming-soon">Coming soon</span>
          </div>
          <div className="setting-row disabled">
            <span>Auto-sync</span>
            <span className="coming-soon">Coming soon</span>
          </div>
        </div>
      </section>

      {/* Test Runner Modal */}
      {testingAgent && (
        <AgentTestRunner
          agentId={testingAgent.id}
          agentName={testingAgent.name}
          onClose={() => setTestingAgent(null)}
        />
      )}
    </div>
  );
}

export default SettingsPage;

