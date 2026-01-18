// ===========================================
// ConfigStore Service
// ===========================================
// Persists user settings and agent configurations securely.

export interface StoreSchema {
  // Auth
  authToken: string | null;
  userId: number | null;
  username: string | null;

  // App settings
  theme: 'light' | 'dark' | 'system';
  autoSync: boolean;
  syncIntervalMinutes: number;
  apiBaseUrl: string | null;  // Custom API URL (null = production)

  // Agent configurations
  agents: Record<string, {
    enabled: boolean;
    executablePath: string;
    defaultFlags: string[];
  }>;

  // Default agent to use
  defaultAgent: string | null;

  // Last synced workspace
  lastWorkspaceId: number | null;

  // Cached agent versions
  agentVersions: Record<string, {
    version: string | null;
    checkedAt: number;
  }>;

  // Workspace to local directory mapping
  workspaceDirectories: Record<number, string>;

  // Execution logs cache (persisted output for reopening modal)
  executionLogs: Record<number, {
    outputs: Array<{ type: string; data: string; timestamp: number }>;
    lastExecutedAt: number;
    processId?: string;
    status?: 'running' | 'completed' | 'failed' | 'stopped';
  }>;
}

const defaults: StoreSchema = {
  authToken: null,
  userId: null,
  username: null,
  theme: 'dark',
  autoSync: true,
  syncIntervalMinutes: 5,
  apiBaseUrl: null,  // null = use production (see PRODUCTION_API_URL in shared/constants.ts)
  agents: {},
  defaultAgent: null,
  lastWorkspaceId: null,
  agentVersions: {},
  workspaceDirectories: {},
  executionLogs: {},
};

// Use a simple JSON file store instead of electron-store for now
// This avoids ESM/CommonJS compatibility issues
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

let storeData: StoreSchema = { ...defaults };
let storePath: string = '';

function getStorePath(): string {
  if (!storePath) {
    const userDataPath = app.getPath('userData');
    storePath = path.join(userDataPath, 'collablearn-config.json');
  }
  return storePath;
}

function loadStore(): void {
  try {
    const filePath = getStorePath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      storeData = { ...defaults, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('Failed to load config:', error);
    storeData = { ...defaults };
  }
}

function saveStore(): void {
  try {
    const filePath = getStorePath();
    fs.writeFileSync(filePath, JSON.stringify(storeData, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

// Initialize on first access
let initialized = false;
function ensureInitialized(): void {
  if (!initialized) {
    loadStore();
    initialized = true;
  }
}

/**
 * ConfigStore Service
 * 
 * Provides a simple API for storing and retrieving configuration.
 * Data is persisted to disk as JSON.
 */
export const ConfigStore = {
  // Generic get/set
  get<K extends keyof StoreSchema>(key: K): StoreSchema[K] {
    ensureInitialized();
    return storeData[key];
  },

  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void {
    ensureInitialized();
    storeData[key] = value;
    saveStore();
  },

  // Auth helpers
  getAuthToken(): string | null {
    ensureInitialized();
    return storeData.authToken;
  },

  setAuth(token: string, userId: number, username: string): void {
    ensureInitialized();
    storeData.authToken = token;
    storeData.userId = userId;
    storeData.username = username;
    saveStore();
  },

  clearAuth(): void {
    ensureInitialized();
    storeData.authToken = null;
    storeData.userId = null;
    storeData.username = null;
    saveStore();
  },

  isAuthenticated(): boolean {
    ensureInitialized();
    return storeData.authToken !== null;
  },

  // Agent config helpers
  getAgentConfig(agentId: string) {
    ensureInitialized();
    return storeData.agents[agentId] || null;
  },

  setAgentConfig(
    agentId: string,
    config: { enabled: boolean; executablePath: string; defaultFlags: string[] }
  ): void {
    ensureInitialized();
    storeData.agents[agentId] = config;
    saveStore();
  },

  // Agent version cache
  getCachedAgentVersion(agentId: string): { version: string | null; checkedAt: number } | null {
    ensureInitialized();
    return storeData.agentVersions[agentId] || null;
  },

  setCachedAgentVersion(agentId: string, version: string | null): void {
    ensureInitialized();
    storeData.agentVersions[agentId] = { version, checkedAt: Date.now() };
    saveStore();
  },

  // Reset to defaults
  reset(): void {
    storeData = { ...defaults };
    saveStore();
  },

  // Get store path (for debugging)
  getStorePath(): string {
    return getStorePath();
  },

  // Workspace directory helpers
  getWorkspaceDirectory(workspaceId: number): string | null {
    ensureInitialized();
    return storeData.workspaceDirectories[workspaceId] || null;
  },

  setWorkspaceDirectory(workspaceId: number, directoryPath: string): void {
    ensureInitialized();
    storeData.workspaceDirectories[workspaceId] = directoryPath;
    saveStore();
  },

  clearWorkspaceDirectory(workspaceId: number): void {
    ensureInitialized();
    delete storeData.workspaceDirectories[workspaceId];
    saveStore();
  },

  // Execution logs helpers
  getExecutionLogs(taskId: number): {
    outputs: Array<{ type: string; data: string; timestamp: number }>;
    lastExecutedAt: number;
    processId?: string;
    status?: 'running' | 'completed' | 'failed' | 'stopped';
  } | null {
    ensureInitialized();
    return storeData.executionLogs[taskId] || null;
  },

  setExecutionLogs(taskId: number, outputs: Array<{ type: string; data: string; timestamp: number }>): void {
    ensureInitialized();
    const prev = storeData.executionLogs[taskId];
    storeData.executionLogs[taskId] = {
      outputs,
      lastExecutedAt: Date.now(),
      processId: prev?.processId,
      status: prev?.status,
    };
    saveStore();
  },

  setExecutionMeta(taskId: number, meta: { processId?: string; status?: 'running' | 'completed' | 'failed' | 'stopped' }): void {
    ensureInitialized();
    const prev = storeData.executionLogs[taskId];
    storeData.executionLogs[taskId] = {
      outputs: prev?.outputs || [],
      lastExecutedAt: prev?.lastExecutedAt || Date.now(),
      processId: meta.processId ?? prev?.processId,
      status: meta.status ?? prev?.status,
    };
    saveStore();
  },

  appendExecutionOutput(taskId: number, output: { type: string; data: string; timestamp: number }): void {
    ensureInitialized();
    const prev = storeData.executionLogs[taskId];
    const outputs = [...(prev?.outputs || []), output];
    const capped = outputs.length > 2000 ? outputs.slice(outputs.length - 2000) : outputs;
    storeData.executionLogs[taskId] = {
      outputs: capped,
      lastExecutedAt: Date.now(),
      processId: prev?.processId,
      status: prev?.status,
    };
    saveStore();
  },

  clearExecutionLogs(taskId: number): void {
    ensureInitialized();
    delete storeData.executionLogs[taskId];
    saveStore();
  },
};

export default ConfigStore;

