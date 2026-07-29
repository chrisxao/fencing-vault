// Electron entry point.
// Dev:  run `npm run desktop:dev` (starts Vite + Electron; loads localhost:5173)
// Prod: run `npm run desktop:build` (packages dist/ into a native installer)
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

// Some toolchains set ELECTRON_RUN_AS_NODE, which makes require('electron')
// return a string path instead of the Electron API. Clear it if present.
if (process.env.ELECTRON_RUN_AS_NODE) {
  delete process.env.ELECTRON_RUN_AS_NODE;
}

const DEV_URL = process.env.ELECTRON_START_URL || 'http://localhost:5173';

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'Fencing Vault',
    backgroundColor: '#0c0d10',
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // External links (InstantDB dashboard, etc.) open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (!app.isPackaged) {
    win.loadURL(DEV_URL).catch((err) => {
      console.error(
        `[electron] Could not load ${DEV_URL}. Is the Vite dev server running?`,
        err,
      );
    });
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
