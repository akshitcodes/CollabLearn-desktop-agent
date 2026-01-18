// ===========================================
// ContextBridge Service
// ===========================================
// Bridges CollabLearn context (from web) to desktop agent execution.
// Reads local context files and agent configs, or fetches from API.

import * as fs from 'fs/promises';
import * as path from 'path';
import { AuthService } from './AuthService';
import { ConfigStore } from './ConfigStore';
import { PRODUCTION_API_URL } from '../../shared/constants';

// Agent config file paths (must match AgentConfigService.js on backend)
const AGENT_CONFIG_PATHS: Record<string, string> = {
  copilot: '.github/copilot-instructions.md',
  claude: 'CLAUDE.md',
  cursor: '.cursor/rules/collablearn.mdc',
  antigravity: '.agent/rules/collablearn.md',
};

// Context pack file paths (must match ContextPackService.js on backend)
const CONTEXT_PACK_PATHS = {
  product: 'docs/@product.md',
  techSpec: 'docs/@tech-spec.md',
  activePlan: 'docs/@active-plan.md',
  // Alternate location (older convention)
  contextPack: '.context-pack',
};

export interface CollabLearnContext {
  agentInstructions: string | null;
  activePlan: string | null;
  techSpec: string | null;
  product: string | null;
  sourceType: 'local' | 'api' | 'none';
}

export interface FetchedContextPack {
  files: Array<{ path: string; content: string; type: string }>;
  metadata: {
    collab_id: number;
    generated_at: string;
  };
}

export interface FetchedAgentConfig {
  files: Array<{ path: string; content: string; agent: string }>;
  metadata: {
    projectId: number;
    generatedAt: string;
  };
}

// API base URL
function getApiBaseUrl(): string {
  const customUrl = ConfigStore.get('apiBaseUrl') as string | undefined;
  return customUrl || PRODUCTION_API_URL;
}

/**
 * ContextBridge - Loads CollabLearn context for agent execution
 */
export const ContextBridge = {
  /**
   * Get the system prompt for a specific agent.
   * Priority: local agent config file > API fetch > null
   */
  async getSystemPromptForAgent(
    agentId: string,
    projectPath: string,
    workspaceId?: number
  ): Promise<string | null> {
    // 1. Try reading local agent config file
    const localInstructions = await this.readLocalAgentConfig(agentId, projectPath);
    if (localInstructions) {
      console.log(`📄 [CONTEXT-BRIDGE] Using local agent config for ${agentId}`);
      return localInstructions;
    }

    // 2. If we have a workspace ID, try fetching from API
    if (workspaceId) {
      console.log(`🌐 [CONTEXT-BRIDGE] Local config not found, fetching from API...`);
      const apiConfig = await this.fetchAgentConfigFromApi(workspaceId, agentId);
      if (apiConfig) {
        // Optionally write to local for future use
        await this.writeAgentConfigLocally(projectPath, agentId, apiConfig);
        return apiConfig;
      }
    }

    console.log(`⚠️ [CONTEXT-BRIDGE] No agent config found for ${agentId}`);
    return null;
  },

  /**
   * Load full CollabLearn context for a project
   */
  async loadContext(
    projectPath: string,
    agentId: string,
    workspaceId?: number
  ): Promise<CollabLearnContext> {
    // Try local first
    const localContext = await this.loadLocalContext(projectPath, agentId);
    if (localContext.sourceType === 'local') {
      return localContext;
    }

    // Fall back to API if workspace ID is available
    if (workspaceId) {
      const apiContext = await this.loadContextFromApi(workspaceId, agentId, projectPath);
      if (apiContext.sourceType === 'api') {
        return apiContext;
      }
    }

    return {
      agentInstructions: null,
      activePlan: null,
      techSpec: null,
      product: null,
      sourceType: 'none',
    };
  },

  /**
   * Read local agent config file
   */
  async readLocalAgentConfig(agentId: string, projectPath: string): Promise<string | null> {
    const relativePath = AGENT_CONFIG_PATHS[agentId];
    if (!relativePath) {
      console.log(`⚠️ [CONTEXT-BRIDGE] Unknown agent: ${agentId}`);
      return null;
    }

    const absolutePath = path.join(projectPath, relativePath);
    try {
      const content = await fs.readFile(absolutePath, 'utf-8');
      return content;
    } catch {
      return null;
    }
  },

  /**
   * Load context from local files
   */
  async loadLocalContext(projectPath: string, agentId: string): Promise<CollabLearnContext> {
    const result: CollabLearnContext = {
      agentInstructions: null,
      activePlan: null,
      techSpec: null,
      product: null,
      sourceType: 'none',
    };

    // Read agent instructions
    result.agentInstructions = await this.readLocalAgentConfig(agentId, projectPath);

    // Try both context pack locations
    const contextPackDir = path.join(projectPath, CONTEXT_PACK_PATHS.contextPack);
    const docsDir = path.join(projectPath, 'docs');

    // Check .context-pack/ first, then docs/
    let basePath = contextPackDir;
    try {
      await fs.access(contextPackDir);
    } catch {
      basePath = docsDir;
    }

    // Read context pack files
    try {
      result.activePlan = await fs.readFile(
        path.join(basePath, '@active-plan.md'),
        'utf-8'
      );
    } catch {
      // Try docs path
      try {
        result.activePlan = await fs.readFile(
          path.join(docsDir, '@active-plan.md'),
          'utf-8'
        );
      } catch {
        // Not found in either location
      }
    }

    try {
      result.techSpec = await fs.readFile(
        path.join(basePath, '@tech-spec.md'),
        'utf-8'
      );
    } catch {
      try {
        result.techSpec = await fs.readFile(
          path.join(docsDir, '@tech-spec.md'),
          'utf-8'
        );
      } catch {
        // Not found
      }
    }

    try {
      result.product = await fs.readFile(
        path.join(basePath, '@product.md'),
        'utf-8'
      );
    } catch {
      try {
        result.product = await fs.readFile(
          path.join(docsDir, '@product.md'),
          'utf-8'
        );
      } catch {
        // Not found
      }
    }

    // Determine source type
    if (result.agentInstructions || result.activePlan) {
      result.sourceType = 'local';
    }

    return result;
  },

  /**
   * Fetch agent config from CollabLearn API
   */
  async fetchAgentConfigFromApi(
    workspaceId: number,
    agentId: string
  ): Promise<string | null> {
    try {
      const token = AuthService.getToken();
      if (!token) {
        console.log('⚠️ [CONTEXT-BRIDGE] Not authenticated, cannot fetch from API');
        return null;
      }

      const response = await fetch(
        `${getApiBaseUrl()}/agent-config/stored/${workspaceId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        console.log(`⚠️ [CONTEXT-BRIDGE] API returned ${response.status}`);
        return null;
      }

      const data = await response.json();
      if (!data.success || !data.data?.files) {
        return null;
      }

      // Find the config for the requested agent
      const agentConfig = data.data.files.find(
        (f: { agent: string }) => f.agent === agentId
      );
      return agentConfig?.content || null;
    } catch (error) {
      console.error('❌ [CONTEXT-BRIDGE] API fetch failed:', error);
      return null;
    }
  },

  /**
   * Load context from API and optionally write locally
   */
  async loadContextFromApi(
    workspaceId: number,
    agentId: string,
    projectPath: string
  ): Promise<CollabLearnContext> {
    const result: CollabLearnContext = {
      agentInstructions: null,
      activePlan: null,
      techSpec: null,
      product: null,
      sourceType: 'none',
    };

    try {
      const token = AuthService.getToken();
      if (!token) {
        return result;
      }

      // Fetch both context pack and agent config in parallel
      const [contextPackRes, agentConfigRes] = await Promise.all([
        fetch(`${getApiBaseUrl()}/context-pack/stored/${workspaceId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${getApiBaseUrl()}/agent-config/stored/${workspaceId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      // Parse context pack
      if (contextPackRes.ok) {
        const cpData = await contextPackRes.json();
        if (cpData.success && cpData.data?.files) {
          for (const file of cpData.data.files) {
            if (file.type === 'active_plan') {
              result.activePlan = file.content;
            } else if (file.type === 'tech_spec') {
              result.techSpec = file.content;
            } else if (file.type === 'product') {
              result.product = file.content;
            }
          }
        }
      }

      // Parse agent config
      if (agentConfigRes.ok) {
        const acData = await agentConfigRes.json();
        if (acData.success && acData.data?.files) {
          const config = acData.data.files.find(
            (f: { agent: string }) => f.agent === agentId
          );
          if (config) {
            result.agentInstructions = config.content;
          }
        }
      }

      if (result.agentInstructions || result.activePlan) {
        result.sourceType = 'api';
        // Write locally for future use
        await this.writeContextLocally(projectPath, result, agentId);
      }

      return result;
    } catch (error) {
      console.error('❌ [CONTEXT-BRIDGE] Failed to load from API:', error);
      return result;
    }
  },

  /**
   * Write agent config to local project
   */
  async writeAgentConfigLocally(
    projectPath: string,
    agentId: string,
    content: string
  ): Promise<void> {
    const relativePath = AGENT_CONFIG_PATHS[agentId];
    if (!relativePath) return;

    const absolutePath = path.join(projectPath, relativePath);
    try {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf-8');
      console.log(`💾 [CONTEXT-BRIDGE] Wrote agent config to ${relativePath}`);
    } catch (error) {
      console.error(`❌ [CONTEXT-BRIDGE] Failed to write agent config:`, error);
    }
  },

  /**
   * Write full context to local project
   */
  async writeContextLocally(
    projectPath: string,
    context: CollabLearnContext,
    agentId: string
  ): Promise<void> {
    const contextPackDir = path.join(projectPath, '.context-pack');

    try {
      await fs.mkdir(contextPackDir, { recursive: true });

      if (context.activePlan) {
        await fs.writeFile(
          path.join(contextPackDir, '@active-plan.md'),
          context.activePlan,
          'utf-8'
        );
      }
      if (context.techSpec) {
        await fs.writeFile(
          path.join(contextPackDir, '@tech-spec.md'),
          context.techSpec,
          'utf-8'
        );
      }
      if (context.product) {
        await fs.writeFile(
          path.join(contextPackDir, '@product.md'),
          context.product,
          'utf-8'
        );
      }

      // Write agent config
      if (context.agentInstructions) {
        await this.writeAgentConfigLocally(projectPath, agentId, context.agentInstructions);
      }

      console.log(`💾 [CONTEXT-BRIDGE] Context pack written to .context-pack/`);
    } catch (error) {
      console.error(`❌ [CONTEXT-BRIDGE] Failed to write context:`, error);
    }
  },

  /**
   * Check if CollabLearn context exists locally
   */
  async hasLocalContext(projectPath: string, agentId: string): Promise<boolean> {
    const config = await this.readLocalAgentConfig(agentId, projectPath);
    return config !== null;
  },

  /**
   * Sync context from API to local project
   * Call this before running tasks to ensure context is available
   */
  async syncContext(
    projectPath: string,
    agentId: string,
    workspaceId: number,
    forceRefresh = false
  ): Promise<{ synced: boolean; source: 'local' | 'api' | 'none' }> {
    // Check if local context exists
    if (!forceRefresh) {
      const hasLocal = await this.hasLocalContext(projectPath, agentId);
      if (hasLocal) {
        return { synced: true, source: 'local' };
      }
    }

    // Fetch from API and write locally
    const context = await this.loadContextFromApi(workspaceId, agentId, projectPath);
    return {
      synced: context.sourceType !== 'none',
      source: context.sourceType,
    };
  },
};

export default ContextBridge;
