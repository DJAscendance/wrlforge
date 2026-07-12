'use strict';
// Isolated Electron shell for the X_ITE mall-fit spike. Deliberately
// separate from the production app's main.js -- not wired into any mall:*
// IPC channel, no filesystem write path exists anywhere in this file.
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Forward renderer console output to this process's stdout -- this is how
  // a CLI run captures the XITE_SPIKE_RESULT line, with no IPC surface needed.
  win.webContents.on('console-message', (_evt, _level, message) => console.log(message));
  win.webContents.on('did-fail-load', (_evt, code, desc) => console.error('[main] did-fail-load', code, desc));
  win.webContents.on('render-process-gone', (_evt, details) => console.error('[main] render-process-gone', details));

  const fixture = process.env.XITE_SPIKE_FIXTURE || 'simple-box.wrl';
  const search = `fixture=${encodeURIComponent(fixture)}` + (process.env.XITE_SPIKE_VERIFY_GUIDES ? '&verifyGuides=1' : '');
  win.loadFile(path.join(__dirname, 'index.html'), { search });

  // XITE_SPIKE_AUTOQUIT=<ms>: for non-interactive CLI runs (see NOTES.md).
  // Not used during normal interactive spike exploration.
  if (process.env.XITE_SPIKE_AUTOQUIT) {
    setTimeout(() => {
      app.quit();
      setTimeout(() => process.exit(0), 1000);
    }, Number(process.env.XITE_SPIKE_AUTOQUIT));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
