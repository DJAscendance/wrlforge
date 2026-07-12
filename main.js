'use strict';
const { app, BrowserWindow, dialog, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { validate } = require('./validator');

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const WINDOW_STATE_FILENAME = 'window-state.json';
const WINDOW_STATE_PATH = () => path.join(app.getPath('userData'), WINDOW_STATE_FILENAME);
// This app was previously named "vrmlpad" -- Electron derives userData from
// the package.json "name" field, so the rename to "wrl-forge" moved that
// directory. Fall back to the old sibling directory (appData/vrmlpad) so
// existing users don't lose their saved window position.
const LEGACY_WINDOW_STATE_PATH = () =>
  path.join(path.dirname(app.getPath('userData')), 'vrmlpad', WINDOW_STATE_FILENAME);
const DEFAULT_WINDOW_STATE = { width: 900, height: 700 };

function isGzip(buf) {
  return buf.length >= 2 && buf[0] === GZIP_MAGIC[0] && buf[1] === GZIP_MAGIC[1];
}

// Plain-text working copy lives next to the mall .wrl as "<name>.edit.wrl",
// so VSCodium's existing X3D/VRML extensions (syntax highlighting + live
// preview) can open it directly -- they can't render/edit inside a gzip file.
function editPathFor(mallPath) {
  const dir = path.dirname(mallPath);
  const base = path.basename(mallPath, path.extname(mallPath));
  return path.join(dir, `${base}.edit.wrl`);
}

function backupPath(filePath) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${filePath}.bak-${ts}`;
}

function loadWindowState() {
  try {
    const saved = JSON.parse(fs.readFileSync(WINDOW_STATE_PATH(), 'utf8'));
    if (saved.x != null && saved.y != null && isVisibleOnAnyDisplay(saved)) return saved;
  } catch {
    // No saved state at the new (wrl-forge) path -- check the pre-rename
    // vrmlpad location before falling back to defaults.
    try {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_WINDOW_STATE_PATH(), 'utf8'));
      if (legacy.x != null && legacy.y != null && isVisibleOnAnyDisplay(legacy)) return legacy;
    } catch {
      // No legacy state either -- fall through to default.
    }
  }
  return { ...DEFAULT_WINDOW_STATE };
}

// A saved position is only usable if it lands on a display that's actually
// connected right now -- otherwise (unplugged monitor, or an RDP session
// only forwarding one display) fall back to whatever display is visible.
function isVisibleOnAnyDisplay(bounds) {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
}

function saveWindowState(win) {
  const isMaximized = win.isMaximized();
  const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();
  const state = { ...bounds, isMaximized };
  try {
    fs.mkdirSync(path.dirname(WINDOW_STATE_PATH()), { recursive: true });
    fs.writeFileSync(WINDOW_STATE_PATH(), JSON.stringify(state));
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
