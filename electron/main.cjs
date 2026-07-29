// Electron entry point. In development run `npm run dev` first, then
// `npm run desktop:dev` (loads the Vite dev server). Packaged builds load
// the static files from dist/.
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

const DEV_URL = process.env.ELECTRON_START_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'Fencing Vault',
    backgroundColor: '#0c0d10',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  // External links (e.g. InstantDB dashboard in the setup guide) open in the
  // system browser rather than a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
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
