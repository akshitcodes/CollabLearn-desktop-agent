// ===========================================
// AuthService
// ===========================================
// Handles authentication with CollabLearn backend.
// Uses ConfigStore for token persistence.

import { ConfigStore } from './ConfigStore';
import { User } from '../../shared/types';
import { PRODUCTION_API_URL } from '../../shared/constants';

// API base URL - configurable via config, defaults to production
const getApiBaseUrl = (): string => {
  const customUrl = ConfigStore.get('apiBaseUrl');
  return customUrl || PRODUCTION_API_URL;
};

export interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
}

/**
 * AuthService - Manages user authentication
 * 
 * Token flow:
 * 1. User pastes JWT token from web app
 * 2. We validate by calling /users/user-details
 * 3. If valid, store token + user info
 */
export const AuthService = {
  /**
   * Login with a JWT token from the web app
   * Validates token by fetching user details from backend
   */
  async login(token: string): Promise<AuthResult> {
    if (!token || token.trim().length === 0) {
      return { success: false, error: 'Token is required' };
    }

    try {
      const response = await fetch(`${getApiBaseUrl()}/users/user-details`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token.trim()}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 401) {
          return { success: false, error: 'Invalid or expired token' };
        }
        return { success: false, error: errorData.error || 'Authentication failed' };
      }

      const userData = await response.json();
      
      // Store auth data
      ConfigStore.setAuth(
        token.trim(),
        userData.id,
        userData.username
      );

      const user: User = {
        id: userData.id,
        username: userData.username,
        email: userData.email,
        avatar: userData.avatar || userData.profile_picture,
      };

      console.log(`✅ Authenticated as: ${user.username} (ID: ${user.id})`);
      return { success: true, user };
    } catch (error) {
      console.error('Login error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error' 
      };
    }
  },

  /**
   * Logout - Clear stored credentials
   */
  logout(): void {
    ConfigStore.clearAuth();
    console.log('🚪 Logged out');
  },

  /**
   * Check if user is currently authenticated
   * Does NOT validate token with server
   */
  isAuthenticated(): boolean {
    return ConfigStore.isAuthenticated();
  },

  /**
   * Get stored token
   */
  getToken(): string | null {
    return ConfigStore.getAuthToken();
  },

  /**
   * Get stored user info
   */
  getUser(): User | null {
    const userId = ConfigStore.get('userId');
    const username = ConfigStore.get('username');
    
    if (!userId || !username) return null;
    
    return {
      id: userId,
      username: username,
      email: '', // Not stored locally
    };
  },

  /**
   * Validate current token with backend
   * Returns true if token is still valid
   */
  async validateToken(): Promise<boolean> {
    const token = this.getToken();
    if (!token) return false;

    try {
      const response = await fetch(`${getApiBaseUrl()}/users/user-details`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        // Token expired or invalid
        this.logout();
        return false;
      }

      return true;
    } catch (error) {
      console.error('Token validation error:', error);
      return false;
    }
  },
};

export default AuthService;
