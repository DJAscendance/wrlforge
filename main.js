'use strict';
const { app, BrowserWindow, dialog, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { validate } = require('./validator');
const { isGzip, editPathFor } = require('./src/files/vrml-file');
const { backupPath } = require('./src/files/backups');
const {
  DEFAULT_WINDOW_STATE,
  windowStatePath,
  legacyWindowStatePath,
  isVisibleOnAnyDisplay,
} = require('./src/settings/window-state');

function loadWindowState() {
  try {
    const saved = JSON.parse(fs.readFileSync(windowStatePath(app.getPath('userData')), 'utf8'));
    if (saved.x != null && saved.y != null && isVisibleOnAnyDisplay(saved, screen.getAllDisplays())) return saved;
  } catch {
    // No saved state at the new (wrl-forge) path -- check the pre-rename
    // vrmlpad location before falling back to defaults.
    try {
      const legacy = JSON.parse(fs.readFileSync(legacyWindowStatePath(app.getPath('userData')), 'utf8'));
      if (legacy.x != null && legacy.y != null && isVisibleOnAnyDisplay(legacy, screen.getAllDisplays())) return legacy;
    } catch {
      // No legacy state either -- fall through to default.
    }
  }
  return { ...DEFAULT_WINDOW_STATE };
}

function saveWindowState(win) {
  const isMaximized = win.isMaximized();
  const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();
  const state = { ...bounds, isMaximized };
  try {
    const statePath = windowStatePath(app.getPath('userData'));
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state));
  } catch {
    // Best-effort -- losing saved window position isn't fatal.
  }
}

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (state.isMaximized) win.maximize();

  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(win), 500);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('close', () => {
    clearTimeout(saveTimer);
    saveWindowState(win);
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Non-interactive smoke-test hook (test/electron-smoke.test.js): report a
  // single JSON line describing security-relevant window state, then quit.
  // Only active when explicitly requested -- never runs during normal use.
  if (process.env.WRL_FORGE_SMOKE_TEST) {
    win.webContents.once('did-finish-load', async () => {
      // Probe actual renderer-side behavior rather than reading back the options
      // we passed to BrowserWindow -- this verifies what's really in effect.
      const hasVrmlpadBridge = await win.webContents.executeJavaScript(
        'typeof window.vrmlpad === "object" && window.vrmlpad !== null'
      );
      // contextIsolation:true means the renderer's main world has no access to the
      // preload script's Node-derived `require`; nodeIntegration:false means the
      // renderer has no global `process`/`require` at all.
      const rendererHasRequire = await win.webContents.executeJavaScript('typeof require !== "undefined"');
      const rendererHasProcess = await win.webContents.executeJavaScript('typeof process !== "undefined"');
      const report = {
        title: win.getTitle(),
        hasVrmlpadBridge,
        contextIsolation: !rendererHasRequire,
        nodeIntegration: rendererHasProcess,
      };
      console.log('WRL_FORGE_SMOKE_TEST_RESULT ' + JSON.stringify(report));
      app.quit();
    });
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

// Open a mall .wrl (gzip or plain), produce/refresh its plain .edit.wrl
// sibling, and launch VSCodium on that sibling.
ipcMain.handle('mall:open', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Open Cybertown mall .wrl (gzip or plain)',
    properties: ['openFile'],
    filters: [
      { name: 'VRML files', extensions: ['wrl', 'wrz'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return openMallFile(res.filePaths[0]);
});

ipcMain.handle('mall:openPath', async (_evt, mallPath) => openMallFile(mallPath));

function openMallFile(mallPath) {
  const raw = fs.readFileSync(mallPath);
  const wasGzipped = isGzip(raw);
  const text = wasGzipped ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');

  const editFile = editPathFor(mallPath);
  fs.writeFileSync(editFile, text, 'utf8');

  const child = spawn('codium', [editFile], { detached: true, stdio: 'ignore' });
  child.unref();

  return {
    mallPath,
    editFile,
    wasGzipped,
    rawBytes: raw.length,
    ...validate(text),
  };
}

// Re-read the plain .edit.wrl working copy, validate it, and report status
// without repacking -- used for a live "Check" button while editing.
ipcMain.handle('mall:check', async (_evt, editFile) => {
  const text = fs.readFileSync(editFile, 'utf8');
  return validate(text);
});

// Repack the edited plain text back into the mall .wrl, gzip by default
// (matching the mall upload convention), backing up whatever was there.
ipcMain.handle('mall:repack', async (_evt, { mallPath, editFile, asGzip }) => {
  const text = fs.readFileSync(editFile, 'utf8');
  const result = validate(text);

  if (fs.existsSync(mallPath)) {
    fs.copyFileSync(mallPath, backupPath(mallPath));
  }

  const out = asGzip ? zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 }) : Buffer.from(text, 'utf8');
  fs.writeFileSync(mallPath, out);

  return { mallPath, writtenBytes: out.length, ...result };
});

ipcMain.handle('shell:revealInFolder', async (_evt, filePath) => {
  shell.showItemInFolder(filePath);
});
