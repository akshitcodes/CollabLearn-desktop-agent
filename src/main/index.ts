import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { registerIpcHandlers } from './ipc/handlers';
import { startServer, stopServer, PORT } from './server';

// Determine if we're in development mode
// Only use dev server when explicitly set via env var (from yarn dev)
// yarn start should always load from built files
const isDev = process.env.ELECTRON_IS_DEV === '1';

// Services (will be implemented in later phases)
// import { AuthService } from './services/AuthService';
// import { ConfigStore } from './services/ConfigStore';
// import { AgentManager } from './services/AgentManager';

let mainWindow: BrowserWindow | null = null;

// Register IPC handlers before creating window
registerIpcHandlers();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  // Load the app
  if (isDev) {
    console.log('Running in development mode, loading from Vite dev server');
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    console.log('Running in production mode, loading from dist');
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(async () => {
  // Start the local HTTP server for browser access
  try {
    await startServer();
    console.log(`🌐 Browser access available at http://localhost:${PORT}`);
  } catch (error) {
    console.error('Failed to start local server:', error);
  }
  
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Clean up server on quit
app.on('before-quit', async () => {
  await stopServer();
});

// IPC Handlers (will be expanded)
ipcMain.handle('app:version', () => app.getVersion());

