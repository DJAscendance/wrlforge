'use strict';
// Isolated Electron shell for the X_ITE mall-fit spike. Deliberately separate
// from the production app's main.js -- not wired into any mall:* IPC channel.
//
// Phase 2B0 added ONE read-only IPC channel ('wrl:load') so the main process
// can do gzip decompression and source-directory base-URL resolution before
// handing X_ITE plain text (X_ITE never fetches gzip bytes, and relative
// textures resolve against the item's own directory). It is strictly
// read-only: it reads a fixture confined to the fixtures/ directory and returns
// text -- there is NO write-capable IPC path anywhere in this file.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
// Shared preview modules moved to src/preview/ in Phase 2B1; the spike reuses
// them from there rather than keeping duplicate copies.
const { readWrlSource } = require('../../src/preview/wrl-source');
const { safeResolve, fileDirUrl } = require('../../src/preview/texture-base');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// Read-only loader: validate the renderer-supplied name stays inside
// fixtures/, read+decompress in the main process, and return decompressed text
// plus a `file://` base URL pointing at the source's own directory (so relative
// textures resolve there, not against index.html).
ipcMain.handle('wrl:load', (_evt, name) => {
  const abs = safeResolve(FIXTURES_DIR, name);
  if (!abs) throw new Error(`Refused to load '${name}': outside the approved fixtures directory.`);
  const { text, wasGzipped, rawBytes } = readWrlSource(abs);
  return { text, wasGzipped, rawBytes, baseURL: fileDirUrl(abs), sourcePath: abs };
});

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
  const parts = [`fixture=${encodeURIComponent(fixture)}`];
  if (process.env.XITE_SPIKE_VERIFY_GUIDES) parts.push('verifyGuides=1');
  if (process.env.XITE_SPIKE_DIAG) parts.push('diag=1');
  win.loadFile(path.join(__dirname, 'index.html'), { search: parts.join('&') });

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
