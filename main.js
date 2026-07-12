'use strict';
const { app, BrowserWindow, dialog, ipcMain, shell, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { validate } = require('./validator');
const { isGzip, editPathFor } = require('./src/files/vrml-file');
const { backupPath } = require('./src/files/backups');
const { readWrlSource } = require('./src/preview/wrl-source');
const { fileDirUrl } = require('./src/preview/texture-base');
const { isBlockedPreviewUrl, scanRemoteUrls } = require('./src/preview/url-policy');

// Which file the embedded preview is allowed to read. Set only by openMallFile
// (which itself is reached only via the user's Open dialog or an explicit path),
// so the read-only preview:load channel can never be steered at an arbitrary
// path by the renderer -- it may read only the currently-open item or its
// .edit.wrl sibling, never a renderer-supplied path.
let currentSession = null; // { mallPath, editFile }

// Hard network gate for the embedded X_ITE preview: cancel every request whose
// scheme is remote/network-capable (http/https/ws/ftp/protocol-relative), so an
// authored VRML `url` can never reach the network. Local schemes (file/data/
// blob) pass through. This is enforced in addition to the renderer CSP -- a
// layered control, not a single point of failure.
function installPreviewNetworkGuard() {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: isBlockedPreviewUrl(details.url) });
  });
}
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
      // Preview-surface presence (Phase 2B1): container, X_ITE engine global,
      // Original/Fit controls, and the CSP meta tag -- all probed in the real
      // renderer, not asserted from config.
      const preview = await win.webContents.executeJavaScript(`(() => ({
        hasPreviewCanvas: !!document.getElementById('preview'),
        xiteLoaded: typeof X3D === 'function',
        hasModeControls: !!document.getElementById('modeOriginal') && !!document.getElementById('modeFit'),
        hasCspMeta: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
      }))()`);
      const report = {
        title: win.getTitle(),
        hasVrmlpadBridge,
        contextIsolation: !rendererHasRequire,
        nodeIntegration: rendererHasProcess,
        ...preview,
      };
      console.log('WRL_FORGE_SMOKE_TEST_RESULT ' + JSON.stringify(report));
      app.quit();
    });
  }

  // Persistent capture-server mode: ONE long-lived Electron process that drives
  // many fixtures/screenshots through a single reused window, one command at a
  // time, instead of relaunching the app per capture. This is the ONLY sanctioned
  // path for visual QA batches (see qa/visual-qa/ and docs/VISUAL_QA_SAFETY.md) --
  // it is what prevents an Electron launch storm from ever taking down the
  // compositor again. Commands arrive as newline-delimited JSON on stdin:
  //   { id, fixture, mode?:'fit'|'original', size?:'WxH', out?:pngPath, json?:bool }
  //   { cmd:'shutdown' }
  // and each produces exactly one response line (READY once, then OK/ERR per id).
  // Security posture is unchanged: same window, same preload, same IPC surface.
  if (process.env.WRL_FORGE_CAPTURE_SERVER) {
    const SETTLE_MS = Number(process.env.WRL_FORGE_SETTLE_MS || 1200);
    const emit = (line) => process.stdout.write(line + '\n');
    // Process one job end-to-end against the reused window.
    async function runJob(job) {
      if (job.size) {
        const [w, h] = String(job.size).split('x').map(Number);
        if (w && h) win.setSize(w, h);
      }
      const payload = {};

      // JSON-only job: authoritative bounds/fit debug via the READ-ONLY preview
      // channel -- identical to the WRL_FORGE_PREVIEW_FIXTURE harness (points
      // currentSession at the fixture, never writes a .edit.wrl sibling), just
      // reused across many fixtures in one process instead of one spawn each.
      if (job.json && !job.out) {
        currentSession = { mallPath: job.fixture, editFile: job.fixture };
        const dbg = await win.webContents.executeJavaScript(
          '(async () => { await window.wrlPreview.load(); return JSON.stringify(window.wrlPreview._debug()); })()'
        );
        payload.debug = JSON.parse(dbg);
        return payload;
      }

      // Screenshot job: the REAL open->validate->preview flow (as in the app),
      // which produces a .edit.wrl -- callers point this at scratch copies.
      if (job.fixture) {
        await win.webContents.executeJavaScript(
          `(async () => { const d = await window.vrmlpad.openMallPath(${JSON.stringify(job.fixture)}); window.__wrlForgeApplyOpen(d); })()`
        );
        await new Promise((r) => setTimeout(r, SETTLE_MS));
        if (job.mode === 'fit') {
          await win.webContents.executeJavaScript("document.getElementById('modeFit').click()");
          await new Promise((r) => setTimeout(r, SETTLE_MS));
        } else if (job.mode === 'original') {
          await win.webContents.executeJavaScript("document.getElementById('modeOriginal').click()");
          await new Promise((r) => setTimeout(r, SETTLE_MS));
        }
      }
      if (job.out) {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(job.out, img.toPNG());
        payload.out = job.out;
      }
      return payload;
    }
    // Serialize commands: exactly one job runs at a time inside the process too,
    // so a burst of stdin lines can never open overlapping renders.
    let chain = Promise.resolve();
    const enqueue = (job) => {
      chain = chain.then(async () => {
        if (job && job.cmd === 'shutdown') { app.quit(); return; }
        try {
          const payload = await runJob(job);
          emit('WRL_FORGE_CAPTURE_OK ' + job.id + ' ' + JSON.stringify(payload));
        } catch (err) {
          emit('WRL_FORGE_CAPTURE_ERR ' + (job && job.id) + ' ' + String((err && err.message) || err));
        }
      });
    };
    win.webContents.once('did-finish-load', () => {
      const rl = require('readline').createInterface({ input: process.stdin });
      rl.on('line', (raw) => {
        const line = raw.trim();
        if (!line) return;
        let job;
        try { job = JSON.parse(line); } catch { emit('WRL_FORGE_CAPTURE_ERR - bad-json'); return; }
        enqueue(job);
      });
      // If the orchestrator's stdin closes (it died/was killed), never linger as
      // an orphan holding the GPU -- exit promptly.
      rl.on('close', () => app.quit());
      emit('WRL_FORGE_CAPTURE_READY');
    });
    return;
  }

  // Non-interactive QA screenshot harness: drive the REAL open->validate->preview
  // path against a (scratch) fixture, optionally switch to Fit mode, capture the
  // page to a PNG, then quit. Takes precedence over the JSON harness below.
  // NOTE: this single-shot path is retained for ad-hoc one-off captures only;
  // batch/visual-QA runs MUST use the capture-server above via qa/visual-qa/.
  if (process.env.WRL_FORGE_PREVIEW_CAPTURE) {
    const fixture = process.env.WRL_FORGE_PREVIEW_FIXTURE;
    const outPath = process.env.WRL_FORGE_PREVIEW_CAPTURE;
    const captureMode = process.env.WRL_FORGE_PREVIEW_MODE;
    win.webContents.once('did-finish-load', async () => {
      try {
        if (process.env.WRL_FORGE_WIN_SIZE) {
          const [w, h] = process.env.WRL_FORGE_WIN_SIZE.split('x').map(Number);
          if (w && h) win.setSize(w, h);
        }
        if (fixture) {
          await win.webContents.executeJavaScript(
            `(async () => { const d = await window.vrmlpad.openMallPath(${JSON.stringify(fixture)}); window.__wrlForgeApplyOpen(d); })()`
          );
          await new Promise((r) => setTimeout(r, 1400));
          if (captureMode === 'fit') {
            await win.webContents.executeJavaScript("document.getElementById('modeFit').click()");
            await new Promise((r) => setTimeout(r, 1600));
          }
        }
        const img = await win.webContents.capturePage();
        fs.writeFileSync(outPath, img.toPNG());
        console.log('WRL_FORGE_PREVIEW_CAPTURE_DONE ' + outPath);
      } catch (err) {
        console.log('WRL_FORGE_PREVIEW_CAPTURE_ERROR ' + String(err && err.stack || err));
      }
      app.quit();
    });
    return;
  }

  // Non-interactive preview harness (test/electron-preview.test.js): point the
  // read-only preview channel at a specific fixture, drive a real X_ITE load +
  // authoritative bounds/fit computation in the renderer, print the result as
  // one JSON line, then quit. Only active when explicitly requested.
  if (process.env.WRL_FORGE_PREVIEW_FIXTURE) {
    const fixture = process.env.WRL_FORGE_PREVIEW_FIXTURE;
    currentSession = { mallPath: fixture, editFile: fixture };
    win.webContents.once('did-finish-load', async () => {
      let line;
      try {
        const json = await win.webContents.executeJavaScript(
          '(async () => { await window.wrlPreview.load(); return JSON.stringify(window.wrlPreview._debug()); })()'
        );
        line = 'WRL_FORGE_PREVIEW_RESULT ' + json;
      } catch (err) {
        line = 'WRL_FORGE_PREVIEW_RESULT ' + JSON.stringify({ error: String(err && err.stack || err) });
      }
      console.log(line);
      app.quit();
    });
  }
}

app.whenReady().then(() => {
  installPreviewNetworkGuard();
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

  currentSession = { mallPath, editFile };

  launchEditor(editFile);

  return {
    mallPath,
    editFile,
    wasGzipped,
    rawBytes: raw.length,
    ...validate(text),
  };
}

function launchEditor(editFile) {
  // WRL_FORGE_NO_EDITOR lets the non-interactive QA/screenshot harness drive the
  // real open flow without spawning a VSCodium window per run.
  if (process.env.WRL_FORGE_NO_EDITOR) return;
  // codium is resolvable on PATH on Linux; a future Windows pass resolves the
  // per-platform executable name (see docs/PLATFORM_NOTES.md).
  const child = spawn('codium', [editFile], { detached: true, stdio: 'ignore' });
  child.unref();
}

// Explicit "Open in VSCodium" action for the currently-open edit file (the file
// is also launched automatically on open; this re-launches on demand).
ipcMain.handle('mall:openInEditor', async () => {
  if (!currentSession) throw new Error('No file is open.');
  launchEditor(currentSession.editFile);
  return { editFile: currentSession.editFile };
});

// Read-only preview source loader. `role` selects the currently-open item
// ('source') or its plain working copy ('edit') -- NOT a renderer-supplied path.
// Detects gzip by magic bytes and decompresses in the main process, so X_ITE
// only ever receives plain UTF-8 text (it never fetches/parses gzip bytes).
// Returns the source directory as a file:// baseURL so relative textures resolve
// against the item's own folder, plus any remote url references found (advisory).
// There is no write path here -- this channel cannot mutate any file.
ipcMain.handle('preview:load', async (_evt, role) => {
  if (!currentSession) throw new Error('No file is open to preview.');
  if (role !== 'source' && role !== 'edit') throw new Error(`Unknown preview role '${role}'.`);
  const target = role === 'source' ? currentSession.mallPath : currentSession.editFile;
  const { text, wasGzipped, rawBytes } = readWrlSource(target);
  return {
    role,
    text,
    wasGzipped,
    rawBytes,
    baseURL: fileDirUrl(target),
    sourcePath: target,
    remoteUrls: scanRemoteUrls(text),
  };
});

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
