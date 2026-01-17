import { useState } from 'react';

interface AuthModalProps {
  onSuccess: (user: { id: number; username: string; email: string }) => void;
  onClose: () => void;
}

/**
 * AuthModal - Token paste login modal
 * Users paste their JWT token from the web app to authenticate
 */
export function AuthModal({ onSuccess, onClose }: AuthModalProps) {
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const result = await window.electronAPI.auth.login(token);
      
      if (result.success && result.user) {
        onSuccess(result.user);
      } else {
        setError(result.error || 'Authentication failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content auth-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🔐 Connect to CollabLearn</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <p className="auth-instructions">
            Paste your API key to connect your CollabLearn account.
          </p>
          
          <div className="token-steps">
            <div className="step">
              <span className="step-num">1</span>
              <span>Go to <a href="https://collablearn.in/settings" target="_blank" rel="noopener">Settings</a> on CollabLearn</span>
            </div>
            <div className="step">
              <span className="step-num">2</span>
              <span>Click "Generate API Key" under Developer Settings</span>
            </div>
            <div className="step">
              <span className="step-num">3</span>
              <span>Copy the <code>mcp_xxx...</code> key and paste below</span>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="token">API Key</label>
              <textarea
                id="token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="mcp_xxxxxxxxxxxxxxxxxxxx..."
                rows={3}
                disabled={isLoading}
                autoFocus
              />
            </div>

            {error && (
              <div className="error-message">
                ⚠️ {error}
              </div>
            )}

            <div className="modal-actions">
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={onClose}
                disabled={isLoading}
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="btn btn-primary"
                disabled={!token.trim() || isLoading}
              >
                {isLoading ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default AuthModal;
