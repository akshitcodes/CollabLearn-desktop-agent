// ===========================================
// IdeationService
// ===========================================
// Handles ideation chat sessions in desktop app using user's SOTA models.
// Fetches prompts from server, runs chat via CopilotSdkAdapter, syncs to CollabLearn.

import { randomUUID } from 'crypto';
import { ConfigStore } from './ConfigStore';
import { AuthService } from './AuthService';
import { PRODUCTION_API_URL } from '../../shared/constants';

// API base URL
const getApiBaseUrl = (): string => {
  const customUrl = ConfigStore.get('apiBaseUrl');
  return customUrl || PRODUCTION_API_URL;
};

// Helper to make authenticated API requests
const fetchWithAuth = async (endpoint: string, options: RequestInit = {}): Promise<Response> => {
  const token = AuthService.getToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  return fetch(`${getApiBaseUrl()}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
};

// ===========================================
// Types
// ===========================================

export type IdeationMode = 'standard' | 'deep_brainstorm';

export interface IdeationConfig {
  mode: IdeationMode;
  systemPrompt: string;
  planGenerationPrompt: string;
  summarizationPrompt: string; // New field
  config: {
    maxTokens: number;
    planMaxTokens: number;
    temperature: number;
    generateDiagrams: boolean;
  };
  tools: Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
}

export interface IdeationSession {
  sessionId: string;
  mode: IdeationMode;
  projectTitle?: string;
  status: 'active' | 'plan_generated' | 'completed';
  messages: IdeationMessage[];
  createdAt: Date;
  updatedAt: Date;
  linkedCollabId?: number;
}

export interface IdeationMessage {
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface ContextPackPrompts {
  product: { description: string; prompt: string };
  tech_spec: { description: string; prompt: string };
  active_plan: { description: string; prompt: string };
}

export interface AgentConfigTemplate {
  path: string;
  template: string;
}

export interface GeneratedContextPack {
  files: Array<{ path: string; content: string }>;
  agentConfigs: Array<{ agent: string; path: string; content: string }>;
}

// ===========================================
// IdeationService
// ===========================================

export const IdeationService = {
  /**
   * Fetch ideation prompts from server
   * These are the protected system prompts for ideation chat
   */
  async fetchIdeationConfig(mode: IdeationMode): Promise<IdeationConfig> {
    console.log(`📥 Fetching ideation config for mode: ${mode}`);
    
    const response = await fetchWithAuth(`/api/desktop/prompts/ideation/${mode}`);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to fetch ideation config');
    }
    
    const result = await response.json();
    console.log(`✅ Fetched ideation config for ${mode} mode`);
    return result.data;
  },

  /**
   * Fetch all context pack prompts
   */
  async fetchContextPackPrompts(): Promise<ContextPackPrompts> {
    console.log('📥 Fetching context pack prompts');
    
    const response = await fetchWithAuth('/api/desktop/prompts/context-pack/all');
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to fetch context pack prompts');
    }
    
    const result = await response.json();
    console.log('✅ Fetched context pack prompts');
    return result.data.prompts;
  },

  /**
   * Fetch agent config templates
   */
  async fetchAgentConfigTemplates(): Promise<Record<string, AgentConfigTemplate>> {
    console.log('📥 Fetching agent config templates');
    
    const response = await fetchWithAuth('/api/desktop/prompts/agent-config/all');
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to fetch agent config templates');
    }
    
    const result = await response.json();
    console.log('✅ Fetched agent config templates');
    return result.data.agents;
  },

  /**
   * Create a new ideation session (local + sync to server)
   */
  async createSession(mode: IdeationMode, projectTitle?: string): Promise<IdeationSession> {
    const sessionId = randomUUID();
    const now = new Date();
    
    const session: IdeationSession = {
      sessionId,
      mode,
      projectTitle,
      status: 'active',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    // Store session locally
    this.storeSessionLocally(session);
    
    // Sync to server (background, don't block)
    this.syncSessionToServer(session).catch(err => {
      console.warn('Failed to sync session to server:', err.message);
    });

    console.log(`📝 Created new ideation session: ${sessionId}`);
    return session;
  },

  /**
   * Add a message to session and sync
   */
  addMessage(
    session: IdeationSession,
    role: 'user' | 'assistant',
    content: string,
    metadata?: Record<string, unknown>
  ): IdeationMessage {
    const message: IdeationMessage = {
      messageId: randomUUID(),
      role,
      content,
      timestamp: new Date(),
      metadata,
    };
    
    session.messages.push(message);
    session.updatedAt = new Date();
    
    // Store locally
    this.storeSessionLocally(session);
    
    return message;
  },

  /**
   * Build the messages array for AI chat (includes system prompt)
   */
  buildChatMessages(
    session: IdeationSession,
    ideationConfig: IdeationConfig
  ): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: ideationConfig.systemPrompt },
    ];
    
    // Add conversation history
    for (const msg of session.messages) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }
    
    return messages;
  },

  /**
   * Sync session to CollabLearn server
   */
  async syncSessionToServer(session: IdeationSession): Promise<void> {
    console.log(`🔄 Syncing session ${session.sessionId} to server`);
    
    try {
      // Sync session metadata
      const sessionResponse = await fetchWithAuth('/api/desktop/ideation/sync-session', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: session.sessionId,
          mode: session.mode,
          projectTitle: session.projectTitle,
          status: session.status,
          metadata: { source: 'desktop' },
        }),
      });
      
      if (!sessionResponse.ok) {
        throw new Error('Failed to sync session metadata');
      }
      
      // Sync messages
      if (session.messages.length > 0) {
        const messagesResponse = await fetchWithAuth('/api/desktop/ideation/sync-messages', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: session.sessionId,
            messages: session.messages.map(m => ({
              messageId: m.messageId,
              role: m.role,
              content: m.content,
              timestamp: m.timestamp.toISOString(),
              metadata: m.metadata,
            })),
          }),
        });
        
        if (!messagesResponse.ok) {
          throw new Error('Failed to sync messages');
        }
      }
      
      console.log(`✅ Session synced to server`);
    } catch (error) {
      console.error('Sync error:', error);
      throw error;
    }
  },

  /**
   * Link session to a collab/workspace
   */
  async linkToCollab(sessionId: string, collabId: number): Promise<void> {
    const response = await fetchWithAuth('/api/desktop/ideation/link-collab', {
      method: 'POST',
      body: JSON.stringify({ sessionId, collabId }),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to link session to collab');
    }
    
    console.log(`🔗 Linked session ${sessionId} to collab ${collabId}`);
  },

  /**
   * Store session locally for offline access
   */
  storeSessionLocally(session: IdeationSession): void {
    const sessions = this.getLocalSessions();
    const index = sessions.findIndex(s => s.sessionId === session.sessionId);
    
    if (index >= 0) {
      sessions[index] = session;
    } else {
      sessions.unshift(session); // Add to front (most recent first)
    }
    
    // Keep only last 20 sessions locally
    const trimmed = sessions.slice(0, 20);
    ConfigStore.set('ideationSessions', JSON.stringify(trimmed));
  },

  /**
   * Get locally stored sessions
   */
  getLocalSessions(): IdeationSession[] {
    const stored = ConfigStore.get('ideationSessions');
    if (!stored) return [];
    
    try {
      return JSON.parse(stored);
    } catch {
      return [];
    }
  },

  /**
   * Get a specific local session
   */
  getLocalSession(sessionId: string): IdeationSession | null {
    const sessions = this.getLocalSessions();
    return sessions.find(s => s.sessionId === sessionId) || null;
  },

  /**
   * Fetch user's sessions from server
   */
  async fetchServerSessions(limit = 10): Promise<IdeationSession[]> {
    const response = await fetchWithAuth(`/api/desktop/ideation/sessions?limit=${limit}`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch sessions from server');
    }
    
    const result = await response.json();
    return result.data.sessions;
  },

  /**
   * Extract ideation summary from conversation
   * This is used to generate context packs
   */
  /**
   * Build the summarization prompt with conversation history
   */
  buildSummarizationPrompt(
    session: IdeationSession,
    summarizationPromptTemplate: string
  ): string {
    const conversationText = session.messages
      .map(msg => `${msg.role.toUpperCase()}: ${msg.content}`)
      .join('\n\n');
      
    return summarizationPromptTemplate.replace('{{conversationText}}', conversationText);
  },

  /**
   * Extract ideation summary from conversation or use provided JSON
   */
  extractSummary(session: IdeationSession, generatedSummaryJson?: string): Record<string, unknown> {
    // If we have a dedicated generated summary, try to parse it
    if (generatedSummaryJson) {
      try {
        const parsed = JSON.parse(generatedSummaryJson);
        return {
          ...parsed,
          conversation_length: session.messages.length,
          last_updated: session.updatedAt,
        };
      } catch (e) {
        console.warn('Failed to parse generated summary JSON:', e);
      }
    }

    // Fallback: Basic summary structure if dynamic summarization wasn't run
    const lastAssistantMessage = [...session.messages]
      .reverse()
      .find(m => m.role === 'assistant');
    
    // Create a heuristic summary
    const summary = {
      project_idea: session.projectTitle || 'Untitled Project',
      mode: session.mode,
      conversation_length: session.messages.length,
      created_at: session.createdAt,
      last_updated: session.updatedAt,
      // Include the last message as context notes if needed
      context_notes: lastAssistantMessage ? lastAssistantMessage.content.substring(0, 500) + '...' : ''
    };
    
    return summary;
  },

  /**
   * Send a message and get AI response using local SOTA model
   * Uses CopilotSdkAdapter for actual AI chat
   */
  async sendMessage(
    sessionId: string,
    userMessage: string,
    mode: IdeationMode = 'standard',
    onChunk?: (chunk: string) => void
  ): Promise<{ response: string; messageId: string }> {
    console.log(`💬 Sending message in session ${sessionId}`);
    
    // Get session from local storage
    const sessions = this.getLocalSessions();
    const session = sessions.find(s => s.sessionId === sessionId);
    
    if (!session) {
      throw new Error('Session not found');
    }

    // Fetch ideation config for system prompt
    const config = await this.fetchIdeationConfig(mode);
    
    // Add user message to session
    const userMsg = this.addMessage(session, 'user', userMessage);
    
    // Import CopilotSdkAdapter class and create instance
    const CopilotSdkAdapter = (await import('../agents/CopilotSdkAdapter')).default;
    const adapter = new CopilotSdkAdapter();
    
    // Create ideation session with CopilotSdkAdapter
    const toolEvents: Array<{ type: string; toolName: string }> = [];
    const copilotSession = await adapter.createIdeationSession(
      config.systemPrompt,
      (event: { type: string; toolName: string }) => {
        toolEvents.push({ type: event.type, toolName: event.toolName });
        console.log(`🔧 Tool event: ${event.type} - ${event.toolName}`);
      }
    );

    // Build messages for chat
    const messages = this.buildChatMessages(session, config);
    
    // Send message and get response
    let fullResponse = '';
    
    try {
      // Use message streaming
      const turns = copilotSession.turns({
        prompt: userMessage,
      });
      
      for await (const event of turns) {
        if (event.kind === 'text') {
          fullResponse += event.text;
          if (onChunk) {
            onChunk(event.text);
          }
        }
      }
    } catch (error: any) {
      console.error('❌ AI response error:', error);
      throw new Error(error.message || 'Failed to get AI response');
    }

    // Add assistant message to session
    const assistantMsg = this.addMessage(session, 'assistant', fullResponse, {
      toolEvents,
    });

    // Sync to server (background)
    this.syncSessionToServer(session).catch(err => {
      console.warn('Failed to sync session:', err.message);
    });

    console.log(`✅ AI response received (${fullResponse.length} chars)`);
    
    return {
      response: fullResponse,
      messageId: assistantMsg.messageId,
    };
  },
};

export default IdeationService;
