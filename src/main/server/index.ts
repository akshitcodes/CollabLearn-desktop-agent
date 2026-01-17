import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { agentManager } from '../services/AgentManager';
import { ConfigStore } from '../services/ConfigStore';

const PORT = 3456; // Using a less common port to avoid conflicts

let server: ReturnType<Express['listen']> | null = null;

/**
 * Create and configure Express server
 */
export function createServer(): Express {
  const app = express();

  // Middleware
  app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', `http://localhost:${PORT}`],
    credentials: true,
  }));
  app.use(express.json());

  // Serve static files from the renderer build
  // Path: from dist/main/index.js to dist/renderer (esbuild output)
  const staticPath = path.join(__dirname, '../renderer');
  app.use(express.static(staticPath));

  // Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ 
      status: 'ok', 
      timestamp: Date.now(),
      version: '0.1.0',
    });
  });

  // === Agent Routes ===
  
  // Get all available agents
  app.get('/api/agents', async (_req: Request, res: Response) => {
    try {
      const agents = await agentManager.getAvailableAgents();
      res.json({ success: true, data: agents });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // Refresh agent detection
  app.post('/api/agents/refresh', async (_req: Request, res: Response) => {
    try {
      await agentManager.refreshAgents();
      const agents = await agentManager.getAvailableAgents();
      res.json({ success: true, data: agents });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // === Config Routes ===
  
  // Get config value
  app.get('/api/config/:key', (req: Request, res: Response) => {
    try {
      const key = req.params.key as keyof typeof ConfigStore;
      const value = ConfigStore.get(key as any);
      res.json({ success: true, data: value });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // Set config value
  app.post('/api/config/:key', (req: Request, res: Response) => {
    try {
      const key = req.params.key;
      const { value } = req.body;
      ConfigStore.set(key as any, value);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // === Auth Routes ===
  
  app.get('/api/auth/status', (_req: Request, res: Response) => {
    res.json({ 
      success: true, 
      data: { 
        authenticated: ConfigStore.isAuthenticated(),
        token: ConfigStore.getAuthToken() ? '***' : null,
      }
    });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ success: false, error: 'Token required' });
      }
      // For MVP, just store the token
      ConfigStore.set('authToken', token);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    ConfigStore.clearAuth();
    res.json({ success: true });
  });

  // SPA catch-all: serve index.html for any non-API routes (Express 5.x syntax)
  app.get('/{*splat}', (_req: Request, res: Response) => {
    const indexPath = path.join(__dirname, '../renderer/index.html');
    res.sendFile(indexPath);
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Server error:', err);
    res.status(500).json({ success: false, error: err.message });
  });

  return app;
}

/**
 * Start the Express server
 */
export function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const app = createServer();
      server = app.listen(PORT, () => {
        console.log(`🌐 Local server running at http://localhost:${PORT}`);
        console.log(`   API endpoints available at http://localhost:${PORT}/api/`);
        resolve();
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`⚠️ Port ${PORT} already in use, server not started`);
          resolve(); // Don't fail, just skip server
        } else {
          reject(err);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Stop the Express server
 */
export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        console.log('🛑 Local server stopped');
        server = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

export { PORT };
