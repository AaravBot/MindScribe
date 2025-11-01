// main.js — MindScribe (final updated)
const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');

// --- main-process defensive logging (helps capture crash reasons) ---
process.on('uncaughtException', (err) => {
  console.error('MAIN: Uncaught exception:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (r) => {
  console.error('MAIN: Unhandled rejection:', r);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadFile('index.html');

  // During debugging it's convenient to keep DevTools detached so it doesn't disconnect
  // when the renderer reloads or when selecting capture sources. Uncomment during debug:
  // win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handler: main process will call desktopCapturer.getSources and return results
ipcMain.handle('mindscribe-get-sources', async (event) => {
  try {
    // request both window and screen sources
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 }
    });

    // return only plain, serializable fields (avoid sending native objects)
    return (sources || []).map(s => ({
      id: String(s.id),
      name: String(s.name || ''),
      display_id: s.display_id || null
    }));
  } catch (err) {
    console.error('Main: getSources error', err && err.stack ? err.stack : err);
    throw err;
  }
});
