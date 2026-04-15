import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from 'electron';
import path from 'path';
import { restoreBackgroundAgentSessions, setupIpcHandlers } from './ipcHandlers';

// Prevent third-party crashes from killing the whole Electron process.
process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught exception (non-fatal):', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection (non-fatal):', reason);
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let backgroundRestoreScheduled = false;

export function getMainWindow() {
  return mainWindow;
}

const createWindow = () => {
  const preloadPath = path.join(__dirname, 'preload.js');

  console.log('Main Process Starting...');
  console.log('Preload Path:', preloadPath);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    titleBarStyle: 'hidden',
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'fullscreen-ui',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:3002');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
  mainWindow.maximize();

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.setSkipTaskbar(true);
    mainWindow?.hide();
  });

  mainWindow.on('show', () => {
    mainWindow?.setSkipTaskbar(false);
  });

  mainWindow.webContents.once('did-finish-load', () => {
    if (backgroundRestoreScheduled) return;
    backgroundRestoreScheduled = true;
    setTimeout(() => {
      if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
        restoreBackgroundAgentSessions(mainWindow.webContents);
      }
    }, 1500);
  });
};

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="3" y="3" width="26" height="26" rx="8" fill="#0f172a"/>
      <circle cx="16" cy="16" r="6" fill="#22c55e"/>
      <circle cx="16" cy="16" r="2" fill="#dcfce7"/>
    </svg>
  `;
  return nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
    .resize({ width: 16, height: 16 });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.setSkipTaskbar(false);
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip('后台 Agent 正在运行');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '打开窗口',
      click: () => showMainWindow(),
    },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('click', () => showMainWindow());
}

app.whenReady().then(() => {
  setupIpcHandlers();
  createTray();
  createWindow();

  app.on('activate', () => {
    showMainWindow();
  });

  ipcMain.handle('get-version', () => app.getVersion());
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // Keep the app and background agent alive even when every window is hidden.
});
