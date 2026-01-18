/**
 * IdeationPanel - Desktop Ideation Chat Interface
 * 
 * Provides SOTA-powered brainstorming similar to web version.
 * Uses user's Copilot/Claude for AI responses.
 */

import { useState, useEffect, useRef } from 'react';
import './IdeationPanel.css';

// ===========================================
// Types
// ===========================================

interface IdeationMessage {
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

interface IdeationSession {
  sessionId: string;
  mode: 'standard' | 'deep_brainstorm';
  projectTitle?: string;
  status: 'active' | 'plan_generated' | 'completed';
  messages: IdeationMessage[];
  createdAt: Date;
  updatedAt: Date;
  formData?: IdeationFormData;
}

interface IdeationFormData {
  idea: string;
  goal: string;
  ideaKnowledge: string;
  timeline: string;
  skills: string;
}

interface IdeationPanelProps {
  onBack?: () => void;
}

type IdeationMode = 'standard' | 'deep_brainstorm';

// ===========================================
// Options Data (matching web version)
// ===========================================

const goalOptions = [
  { value: 'college_project', label: '🎓 College Project', desc: 'Academic assignment' },
  { value: 'startup', label: '🚀 Startup Idea', desc: 'Building a business' },
  { value: 'passion_project', label: '💜 Personal Project', desc: 'Passion-driven' },
  { value: 'hackathon', label: '⚡ Hackathon', desc: 'Time-boxed build' },
];

const knowledgeOptions = [
  { value: 'completely_new', label: '🌱 New to this', desc: 'Starting fresh' },
  { value: 'some_research', label: '📚 Some research', desc: 'Basic understanding' },
  { value: 'good_understanding', label: '🎯 Good grasp', desc: 'Domain experience' },
  { value: 'expert_level', label: '🚀 Expert', desc: 'Deep expertise' },
];

const timelineOptions = [
  { value: 'less_than_1_month', label: '⚡ < 1 month', desc: 'Quick sprint' },
  { value: '1_to_3_months', label: '🎯 1-3 months', desc: 'Steady progress' },
  { value: '3_to_6_months', label: '📈 3-6 months', desc: 'Medium-term' },
  { value: '6_plus_months', label: '🚀 6+ months', desc: 'Long-term vision' },
];

// ===========================================
// Component
// ===========================================

export default function IdeationPanel({ onBack }: IdeationPanelProps) {
  // State
  const [sessions, setSessions] = useState<IdeationSession[]>([]);
  const [currentSession, setCurrentSession] = useState<IdeationSession | null>(null);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStartScreen, setShowStartScreen] = useState(true);
  
  // Form state (single page)
  const [mode, setMode] = useState<IdeationMode>('standard');
  const [idea, setIdea] = useState('');
  const [goal, setGoal] = useState('');
  const [ideaKnowledge, setIdeaKnowledge] = useState('');
  const [timeline, setTimeline] = useState('');
  const [skills, setSkills] = useState('');
  
  // Chat area ref for auto-scroll
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  // Validation
  const isFormValid = idea.trim().length >= 10 && goal && ideaKnowledge && timeline;
  
  // Load local sessions on mount
  useEffect(() => {
    loadLocalSessions();
  }, []);
  
  // Auto-scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages]);
  
  const loadLocalSessions = async () => {
    try {
      const localSessions = await window.electronAPI.ideation.getLocalSessions();
      setSessions(localSessions || []);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  };
  
  const handleStartSession = async () => {
    if (!isFormValid) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Create session via IPC with form data
      const session = await window.electronAPI.ideation.createSession({
        mode,
        projectTitle: idea.substring(0, 50),
      });
      
      // Store form data with session
      const sessionWithData: IdeationSession = {
        ...session,
        formData: { idea, goal, ideaKnowledge, timeline, skills },
      };
      
      setCurrentSession(sessionWithData);
      setShowStartScreen(false);
      setSessions(prev => [sessionWithData, ...prev]);
      
      // Build initial context message from form data
      const contextMessage = buildContextMessage({ idea, goal, ideaKnowledge, timeline, skills });
      
      // Add as first user message
      const contextMsg: IdeationMessage = {
        messageId: `ctx-${Date.now()}`,
        role: 'user',
        content: contextMessage,
        timestamp: new Date(),
      };
      
      setCurrentSession(prev => prev ? {
        ...prev,
        messages: [contextMsg],
      } : null);
      
      // TODO: Send to AI and get response
      // For now, add placeholder response
      setTimeout(() => {
        const assistantMsg: IdeationMessage = {
          messageId: `resp-${Date.now()}`,
          role: 'assistant',
          content: `Great! I understand you want to build ${idea.substring(0, 100)}...\n\nAs a ${knowledgeOptions.find(k => k.value === ideaKnowledge)?.label || ''} with a ${timelineOptions.find(t => t.value === timeline)?.label || ''} timeline, let me help you develop this concept.\n\n**Next Steps:**\n1. Let's clarify the core problem you're solving\n2. Define your target users\n3. Identify key features\n\nWhat specific aspect would you like to explore first?`,
          timestamp: new Date(),
        };
        
        setCurrentSession(prev => prev ? {
          ...prev,
          messages: [...prev.messages, assistantMsg],
        } : null);
        setIsLoading(false);
      }, 1500);
      
    } catch (err: any) {
      setError(err.message || 'Failed to start session');
      setIsLoading(false);
    }
  };
  
  const buildContextMessage = (data: IdeationFormData): string => {
    const goalLabel = goalOptions.find(g => g.value === data.goal)?.label || data.goal;
    const knowledgeLabel = knowledgeOptions.find(k => k.value === data.ideaKnowledge)?.label || data.ideaKnowledge;
    const timelineLabel = timelineOptions.find(t => t.value === data.timeline)?.label || data.timeline;
    
    return `**My Project Idea:**\n${data.idea}\n\n**Goal:** ${goalLabel}\n**Experience Level:** ${knowledgeLabel}\n**Timeline:** ${timelineLabel}${data.skills ? `\n**Skills:** ${data.skills}` : ''}`;
  };
  
  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !currentSession || isLoading) return;
    
    const userMessage = inputMessage.trim();
    setInputMessage('');
    setIsLoading(true);
    setError(null);
    
    const userMsg: IdeationMessage = {
      messageId: `msg-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    };
    
    setCurrentSession(prev => prev ? {
      ...prev,
      messages: [...prev.messages, userMsg],
    } : null);
    
    try {
      // TODO: Call CopilotSdkAdapter via IPC to get AI response
      setTimeout(() => {
        const assistantMsg: IdeationMessage = {
          messageId: `resp-${Date.now()}`,
          role: 'assistant',
          content: `I received: "${userMessage}"\n\n[AI response will come from your local Copilot/Claude model. Integration in progress...]`,
          timestamp: new Date(),
        };
        
        setCurrentSession(prev => prev ? {
          ...prev,
          messages: [...prev.messages, assistantMsg],
        } : null);
        setIsLoading(false);
      }, 1000);
      
      // Sync session to server (background)
      window.electronAPI.ideation.syncSession(currentSession).catch(console.warn);
      
    } catch (err: any) {
      setError(err.message || 'Failed to send message');
      setIsLoading(false);
    }
  };
  
  const handleSelectSession = (session: IdeationSession) => {
    setCurrentSession(session);
    setMode(session.mode);
    setShowStartScreen(false);
  };
  
  const handleBack = () => {
    if (currentSession) {
      setCurrentSession(null);
      setShowStartScreen(true);
    } else if (onBack) {
      onBack();
    }
  };
  
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };
  
  // ===========================================
  // Render: Start Screen (Single Page Form)
  // ===========================================
  if (showStartScreen) {
    return (
      <div className="ideation-panel">
        <div className="ideation-header">
          <button className="btn btn-icon" onClick={onBack} title="Back">←</button>
          <h2>💡 Start New Ideation</h2>
        </div>
        
        <div className="ideation-form">
          {/* Mode Selection */}
          <div className="form-section">
            <label className="form-label">Mode</label>
            <div className="mode-toggle">
              <button 
                className={`mode-btn ${mode === 'standard' ? 'active' : ''}`}
                onClick={() => setMode('standard')}
              >
                ⚡ Standard
              </button>
              <button 
                className={`mode-btn premium ${mode === 'deep_brainstorm' ? 'active' : ''}`}
                onClick={() => setMode('deep_brainstorm')}
              >
                🧠 Deep Brainstorm
              </button>
            </div>
          </div>
          
          {/* Idea Input */}
          <div className="form-section">
            <label className="form-label">
              What's your idea? <span className="required">*</span>
            </label>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Describe your project idea... What problem does it solve? Who is it for?"
              rows={4}
              className="form-textarea"
            />
            <span className="char-count">{idea.length}/500</span>
          </div>
          
          {/* Goal Selection */}
          <div className="form-section">
            <label className="form-label">
              What's your goal? <span className="required">*</span>
            </label>
            <div className="option-grid">
              {goalOptions.map(opt => (
                <button
                  key={opt.value}
                  className={`option-btn ${goal === opt.value ? 'selected' : ''}`}
                  onClick={() => setGoal(opt.value)}
                >
                  <span className="option-label">{opt.label}</span>
                  <span className="option-desc">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>
          
          {/* Knowledge Level */}
          <div className="form-section">
            <label className="form-label">
              Your experience with this idea <span className="required">*</span>
            </label>
            <div className="option-grid">
              {knowledgeOptions.map(opt => (
                <button
                  key={opt.value}
                  className={`option-btn ${ideaKnowledge === opt.value ? 'selected' : ''}`}
                  onClick={() => setIdeaKnowledge(opt.value)}
                >
                  <span className="option-label">{opt.label}</span>
                  <span className="option-desc">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>
          
          {/* Timeline */}
          <div className="form-section">
            <label className="form-label">
              Timeline <span className="required">*</span>
            </label>
            <div className="option-grid">
              {timelineOptions.map(opt => (
                <button
                  key={opt.value}
                  className={`option-btn ${timeline === opt.value ? 'selected' : ''}`}
                  onClick={() => setTimeline(opt.value)}
                >
                  <span className="option-label">{opt.label}</span>
                  <span className="option-desc">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>
          
          {/* Skills (Optional) */}
          <div className="form-section">
            <label className="form-label">Your skills (optional)</label>
            <input
              type="text"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="e.g., React, Python, Design..."
              className="form-input"
            />
          </div>
          
          {/* Start Button */}
          <div className="form-actions">
            <button 
              className="btn btn-primary btn-lg"
              onClick={handleStartSession}
              disabled={!isFormValid || isLoading}
            >
              {isLoading ? 'Starting...' : '🚀 Start Ideation'}
            </button>
            {!isFormValid && (
              <p className="form-hint">Fill in required fields (idea min 10 chars)</p>
            )}
          </div>
          
          {/* Recent Sessions */}
          {sessions.length > 0 && (
            <div className="recent-sessions">
              <h4>Recent Sessions</h4>
              <div className="session-list">
                {sessions.slice(0, 3).map(session => (
                  <div 
                    key={session.sessionId}
                    className="session-item"
                    onClick={() => handleSelectSession(session)}
                  >
                    <span className="session-title">
                      {session.projectTitle || 'Untitled Session'}
                    </span>
                    <span className="session-meta">
                      {session.mode} • {session.messages.length} msgs
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {error && <div className="error-banner">{error}</div>}
      </div>
    );
  }
  
  // ===========================================
  // Render: Chat Interface
  // ===========================================
  return (
    <div className="ideation-panel">
      <div className="ideation-header">
        <button className="btn btn-icon" onClick={handleBack} title="Back">←</button>
        <h2>
          {currentSession?.projectTitle || 'Ideation'}
          <span className={`mode-badge ${mode}`}>
            {mode === 'deep_brainstorm' ? '🧠 Deep' : '⚡ Standard'}
          </span>
        </h2>
      </div>
      
      <div className="ideation-chat">
        <div className="chat-messages">
          {currentSession?.messages.map((msg) => (
            <div 
              key={msg.messageId}
              className={`chat-message ${msg.role}`}
            >
              <div className="message-avatar">
                {msg.role === 'user' ? '👤' : '🤖'}
              </div>
              <div className="message-content">
                <pre>{msg.content}</pre>
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className="chat-message assistant loading">
              <div className="message-avatar">🤖</div>
              <div className="message-content">
                <div className="typing-indicator">
                  <span></span><span></span><span></span>
                </div>
              </div>
            </div>
          )}
          
          <div ref={chatEndRef} />
        </div>
        
        <div className="chat-input-area">
          <textarea
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Continue the conversation..."
            disabled={isLoading}
            rows={2}
          />
          <button 
            className="btn btn-primary send-btn"
            onClick={handleSendMessage}
            disabled={!inputMessage.trim() || isLoading}
          >
            {isLoading ? '...' : 'Send'}
          </button>
        </div>
      </div>
      
      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
