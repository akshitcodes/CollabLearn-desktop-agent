import { useState, useEffect } from 'react';
import { AgentInfo, User, Workspace, Task } from '../shared/types';
import AgentCard from './components/AgentCard';
import SettingsPage from './pages/SettingsPage';
import AuthModal from './components/AuthModal';
import WorkspaceBrowser from './components/WorkspaceBrowser';
import TaskList from './components/TaskList';
import IdeationPanel from './components/IdeationPanel';

type Page = 'dashboard' | 'settings' | 'workspaces' | 'tasks' | 'ideation';

function App() {
  const [version, setVersion] = useState<string>('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  
  // Workspace state
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const v = await window.electronAPI.getVersion();
        setVersion(v);
        setStatus('ready');
        
        // Check auth status
        const authenticated = await window.electronAPI.auth.isAuthenticated();
        setIsAuthenticated(authenticated);
        
        if (authenticated) {
          const userData = await window.electronAPI.auth.getUser();
          setUser(userData);
        }
      } catch (err) {
        console.error('Failed to initialize:', err);
        setStatus('error');
      }
    };
    init();
    loadAgents();
  }, []);

  const loadAgents = async () => {
    setAgentsLoading(true);
    try {
      const available = await window.electronAPI.agents.getAvailable();
      const agentsWithConfig = available.map((agent: any) => ({
        ...agent,
        enabled: agent.config?.enabled ?? true,
      }));
      setAgents(agentsWithConfig);
    } catch (err) {
      console.error('Failed to load agents:', err);
    } finally {
      setAgentsLoading(false);
    }
  };

  const handleNavigate = (page: Page) => {
    setCurrentPage(page);
    if (page === 'dashboard') {
      loadAgents();
      setSelectedWorkspace(null);
    }
  };

  const handleAuthSuccess = (userData: User) => {
    setIsAuthenticated(true);
    setUser(userData);
    setShowAuthModal(false);
  };

  const handleLogout = async () => {
    await window.electronAPI.auth.logout();
    setIsAuthenticated(false);
    setUser(null);
    setSelectedWorkspace(null);
    setCurrentPage('dashboard');
  };

  const handleSelectWorkspace = (workspace: Workspace) => {
    setSelectedWorkspace(workspace);
    setCurrentPage('tasks');
  };

  const handleExecuteTask = async (task: Task, agentId: string) => {
    console.log(`Executing task ${task.id} with agent ${agentId}`);
    // Navigate to settings to use the test runner for now
    // Full integration in Phase 4
    setCurrentPage('settings');
  };

  const installedAgents = agents.filter(a => a.installed);
  const notInstalledAgents = agents.filter(a => !a.installed);

  const renderContent = () => {
    switch (currentPage) {
      case 'settings':
        return <SettingsPage onNavigate={handleNavigate} />;
      
      case 'workspaces':
        return (
          <section className="content">
            <WorkspaceBrowser onSelectWorkspace={handleSelectWorkspace} />
          </section>
        );
      
      case 'tasks':
        if (!selectedWorkspace) {
          handleNavigate('workspaces');
          return null;
        }
        return (
          <section className="content">
            <TaskList
              workspace={selectedWorkspace}
              onBack={() => handleNavigate('workspaces')}
              agents={agents}
              onExecuteTask={handleExecuteTask}
            />
          </section>
        );
      
      case 'ideation':
        return (
          <section className="content ideation-content">
            <IdeationPanel onBack={() => handleNavigate('dashboard')} />
          </section>
        );
      
      default:
        return (
          <>
            <header className="header">
              <h1>Dashboard</h1>
              <div className="status-badge" data-status={status}>
                {status === 'loading' ? '⏳ Loading...' : 
                 status === 'ready' ? '✅ Ready' : '❌ Error'}
              </div>
            </header>

            <section className="content">
              <div className="welcome-card">
                <h2>Welcome to CollabLearn Desktop</h2>
                {isAuthenticated && user ? (
                  <>
                    <p className="user-greeting">
                      Logged in as <strong>{user.username}</strong>
                    </p>
                    <p>
                      Sync your tasks and run coding agents locally.
                    </p>
                    <div className="actions">
                      <button 
                        className="btn btn-primary"
                        onClick={() => handleNavigate('workspaces')}
                      >
                        📂 View Workspaces
                      </button>
                      <button 
                        className="btn btn-secondary"
                        onClick={() => handleNavigate('settings')}
                      >
                        Configure Agents
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p>
                      Connect to your CollabLearn account to sync tasks and 
                      run coding agents locally.
                    </p>
                    <div className="actions">
                      <button 
                        className="btn btn-primary"
                        onClick={() => setShowAuthModal(true)}
                      >
                        🔐 Connect Account
                      </button>
                      <button 
                        className="btn btn-secondary"
                        onClick={() => handleNavigate('settings')}
                      >
                        Configure Agents
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="agents-card">
                <h3>Detected Agents</h3>
                {agentsLoading ? (
                  <div className="loading-state">Detecting agents...</div>
                ) : agents.length === 0 ? (
                  <p className="placeholder">
                    No agents detected. Install GitHub Copilot CLI or Claude Code to get started.
                  </p>
                ) : (
                  <div className="agents-list">
                    {installedAgents.length > 0 && (
                      <div className="agents-section">
                        <h4>Available ({installedAgents.length})</h4>
                        {installedAgents.map(agent => (
                          <AgentCard key={agent.id} agent={agent} compact />
                        ))}
                      </div>
                    )}
                    {notInstalledAgents.length > 0 && (
                      <div className="agents-section">
                        <h4>Not Installed ({notInstalledAgents.length})</h4>
                        {notInstalledAgents.map(agent => (
                          <AgentCard key={agent.id} agent={agent} compact />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          </>
        );
    }
  };

  return (
    <div className="app">
      <div className="sidebar">
        <div className="logo">
          <span className="logo-icon">⚡</span>
          <span className="logo-text">CollabLearn</span>
        </div>
        <nav className="nav">
          <a 
            href="#" 
            className={`nav-item ${currentPage === 'dashboard' ? 'active' : ''}`}
            onClick={(e) => { e.preventDefault(); handleNavigate('dashboard'); }}
          >
            <span>🏠</span> Dashboard
          </a>
          <a 
            href="#" 
            className={`nav-item ${currentPage === 'workspaces' || currentPage === 'tasks' ? 'active' : ''} ${!isAuthenticated ? 'disabled' : ''}`}
            onClick={(e) => { 
              e.preventDefault(); 
              if (isAuthenticated) handleNavigate('workspaces'); 
            }}
            title={!isAuthenticated ? 'Login to view workspaces' : ''}
          >
            <span>📂</span> Workspaces
          </a>
          <a 
            href="#" 
            className={`nav-item ${currentPage === 'ideation' ? 'active' : ''} ${!isAuthenticated ? 'disabled' : ''}`}
            onClick={(e) => { 
              e.preventDefault(); 
              if (isAuthenticated) handleNavigate('ideation'); 
            }}
            title={!isAuthenticated ? 'Login to use Ideation' : ''}
          >
            <span>💡</span> Ideation
          </a>
          <a 
            href="#" 
            className={`nav-item ${currentPage === 'settings' ? 'active' : ''}`}
            onClick={(e) => { e.preventDefault(); handleNavigate('settings'); }}
          >
            <span>⚙️</span> Settings
          </a>
        </nav>
        
        {/* User section */}
        <div className="sidebar-footer">
          {isAuthenticated && user ? (
            <div className="user-info">
              <span className="user-avatar">👤</span>
              <span className="user-name">{user.username}</span>
              <button 
                className="btn btn-icon logout-btn" 
                onClick={handleLogout}
                title="Logout"
              >
                🚪
              </button>
            </div>
          ) : (
            <button 
              className="btn btn-sm btn-primary"
              onClick={() => setShowAuthModal(true)}
            >
              🔐 Connect
            </button>
          )}
        </div>
        
        <div className="version">v{version || '...'}</div>
      </div>

      <main className="main">
        {renderContent()}
      </main>

      {/* Auth Modal */}
      {showAuthModal && (
        <AuthModal
          onSuccess={handleAuthSuccess}
          onClose={() => setShowAuthModal(false)}
        />
      )}
    </div>
  );
}

export default App;
