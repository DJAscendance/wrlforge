'use strict';
const { app, BrowserWindow, dialog, ipcMain, shell, screen, session, protocol } = require('electron');
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
const { detectPrimaries } = require('./src/world-project/project-loader');
const { summarize } = require('./src/world-project/project-stats');
const { ProjectSession } = require('./src/world-project/session');
const {
  WORLD_PREVIEW_SCHEME,
  buildAuthorizedSet,
  buildPreviewPayload,
  resolveWorldRequest,
} = require('./src/world-project/preview-source');
const { buildPackagePlan, buildManifest } = require('./src/world-project/package-plan');
const { writeReviewBundle } = require('./src/world-project/bundle-builder');
const { resolveEditor, buildLaunch } = require('./src/editor/editor-locator');
const { loadSettings } = require('./src/settings/app-settings');
const { EditorController } = require('./src/editor/editor-controller');
const { openMallItem, openExternalEditor } = require('./src/editor/mall-edit-flow');
const { createMallPreviewBridge } = require('./src/preview/mall-preview-bridge');

// The World Project preview scheme (Phase 4B) is a privileged, standard, LOCAL
// scheme. This MUST run before app 'ready'. It does NOT bypass CSP -- world.html
// still lists the scheme explicitly. Its handler (installed in whenReady) serves
// ONLY asset-graph-authorized files confined to the open project's root.
protocol.registerSchemesAsPrivileged([{
  scheme: WORLD_PREVIEW_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

// The currently-authorized World Project preview: { projectRoot, authorized:Map }
// or null when no world preview is active. Set only by world:previewLoad (which
// derives the allow-list from the production asset graph). The scheme handler
// reads this; when null it refuses every request. READ-ONLY -- serving reads
// files, never writes.
let worldPreview = null;

// Which file the embedded preview is allowed to read. Set only by openMallFile
// (which itself is reached only via the user's Open dialog or an explicit path),
// so the read-only preview:load channel can never be steered at an arbitrary
// path by the renderer -- it may read only the currently-open item or its
// .edit.wrl sibling, never a renderer-supplied path.
let currentSession = null; // { mallPath, editFile }

// The single open World Project (Phase 4A). The main process owns the project
// root and detected primary candidates; the renderer never supplies an arbitrary
// scan path -- it can only pick among candidates the main process detected. The
// world surface is strictly READ-ONLY: there is no write-capable world IPC.
const worldSession = new ProjectSession();

// The main window, used for Mall<->World page navigation (main keeps control of
// which local page loads; the renderer cannot navigate to an arbitrary URL).
let mainWindow = null;

// The native editor controller (Phase 7B). Instantiated in whenReady (it needs
// app.getPath('userData') for session restore). It owns the one open editor
// document and every path decision; the renderer supplies only text + intent (and
// a World reference to OPEN, which is authorized against the scan graph below).
let editorController = null;

// The Mall live-preview bridge (Phase 7C2). Turns the native editor's UNSAVED
// buffer into an authorized X_ITE preview payload without writing any temp file.
// It owns the 7C1 BufferOverlay; the renderer sends only { sessionId, text,
// bufferVersion } and never a path. Instantiated in whenReady alongside the
// editor controller (it reads the live currentSession / editor describe).
let mallPreviewBridge = null;

// Renderer pages the app may navigate between (whitelist -- never a path from
// the renderer). Both share the one BrowserWindow, preload, and security config.
const APP_PAGES = { mall: 'index.html', world: 'world.html', editor: 'editor.html' };
let currentPage = 'mall';

// Navigate the one window to a whitelisted local page and await its load. Used
// by both the interactive nav buttons and the capture-server QA harness so the
// same reused window can screenshot either workspace.
async function gotoPage(page) {
  const file = APP_PAGES[page];
  if (!file || !mainWindow) return;
  if (currentPage === page) return;
  await mainWindow.loadFile(path.join(__dirname, 'renderer', file));
  currentPage = page;
}

// Flatten a session scan result into a JSON-safe payload for the renderer. The
// graph is already free of Sets (referencedBy arrays); this trims wrlNodes to
// display fields and attaches the derived summary. Read-only data only.
function serializeScan(scan) {
  const g = scan.graph || { references: [], wrlNodes: [], assets: [], missing: [], caseMismatches: [], remoteRefs: [], unsafe: [], cycles: [] };
  return {
    ok: scan.status === 'ok',
    status: scan.status,
    error: scan.error || null,
    stale: !!scan.stale,
    superseded: !!scan.superseded,
    root: scan.root,
    primary: scan.primary,
    primaryGzip: !!scan.primaryGzip,
    scanMs: scan.scanMs,
    summary: summarize(scan),
    references: g.references,
    wrlNodes: g.wrlNodes.map((n) => ({ path: n.path, depth: n.depth, parent: n.parent || null, bytes: n.bytes, unreadable: n.unreadable || null, refs: n.refs || [] })),
    assets: g.assets,
    missing: g.missing,
    caseMismatches: g.caseMismatches,
    remoteRefs: g.remoteRefs,
    unsafe: g.unsafe,
    cycles: g.cycles,
    truncated: !!g.truncated,
    depthCapped: !!g.depthCapped,
  };
}

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

// Install the World Project preview scheme handler (Phase 4B). X_ITE resolves the
// world's nested Inline / textures against wrlworld:// URLs, so every dependency
// read comes back through here -- authorized against the production asset graph
// and confined to the project root. WRL nodes are served gzip-decompressed (X_ITE
// only ever sees plain text); assets are served as raw bytes. Nothing is written.
function installWorldPreviewProtocol() {
  protocol.handle(WORLD_PREVIEW_SCHEME, async (request) => {
    const res = resolveWorldRequest(worldPreview, request.url);
    if (res.status !== 200) {
      return new Response(res.error || 'unavailable', { status: res.status });
    }
    return new Response(res.body, { headers: { 'content-type': res.mimeType } });
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
  mainWindow = win;

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

      // Native editor job (Phase 7B): drive the real editor lane in the SAME
      // reused window. Main points its context (currentSession / worldSession) at
      // a SCRATCH fixture confined to the OS temp dir, opens it through the real
      // editorController, navigates to the editor page, optionally runs scripted
      // steps (type/save/click-diagnostic/outline/external), stages an external
      // change to raise the conflict dialog, then screenshots. Reachable only
      // under WRL_FORGE_CAPTURE_SERVER; never touches a real project file.
      if ('editor' in job) {
        const e = job.editor || {};
        const os = require('os');
        const inTemp = (p) => path.resolve(String(p || '')).startsWith(path.resolve(os.tmpdir()));

        // Establish the lane context so editorController resolves the source.
        if (e.context === 'world') {
          if (!inTemp(e.root)) throw new Error('editor world root must be under the OS temp dir');
          if (typeof e.writeSource === 'string') {
            if (!inTemp(e.primary)) throw new Error('editor writeSource refused outside the OS temp dir');
            fs.writeFileSync(e.primary, e.writeSource, 'utf8');
          }
          worldSession.open({ root: e.root, primary: e.primary, candidates: [{ path: e.primary }] });
          await worldSession.scan();
          if (e.ref) editorController.openWorldReference(e.ref);
          else editorController.openWorldPrimary();
        } else {
          if (!inTemp(e.mallPath)) throw new Error('editor mallPath must be under the OS temp dir');
          if (typeof e.writeSource === 'string') {
            const buf = e.gzip ? zlib.gzipSync(Buffer.from(e.writeSource, 'utf8'), { level: 9 }) : Buffer.from(e.writeSource, 'utf8');
            fs.writeFileSync(e.mallPath, buf);
          }
          currentSession = { mallPath: e.mallPath, editFile: e.mallPath };
          editorController.openMall();
        }

        // Force a FRESH load of the editor page every job (gotoPage would no-op
        // when already on 'editor', leaving the previous job's document shown).
        // Production never needs this -- a user always leaves the editor page
        // before returning to it -- but the batch harness reopens it back-to-back.
        await mainWindow.loadFile(path.join(__dirname, 'renderer', 'editor.html'));
        currentPage = 'editor';
        // Wait for the editor page to mount its CodeMirror surface (or show the
        // no-document message), bounded so a stuck load can't hang the run.
        await win.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 60; i++) {
            if (window.__wrlEditor && window.__wrlEditor.ready()) return true;
            await new Promise((r) => setTimeout(r, 100));
          }
          return false;
        })()`);
        await new Promise((r) => setTimeout(r, SETTLE_MS));

        // Optional theme selection (visual-QA showcase of the built-in themes).
        if (e.theme) {
          await win.webContents.executeJavaScript(`window.__wrlEditor.setTheme(${JSON.stringify(e.theme)})`);
          await new Promise((r) => setTimeout(r, 400));
        }

        // Optional zoom level (visual-QA of the vision-accommodation scaling).
        if (e.zoom != null) {
          await win.webContents.executeJavaScript(`window.__wrlEditor.setZoom(${JSON.stringify(e.zoom)})`);
          await new Promise((r) => setTimeout(r, 400));
        }

        // Optional scripted step, driven through the page's own QA hook.
        if (e.step === 'type') {
          await win.webContents.executeJavaScript(`window.__wrlEditor.setText(${JSON.stringify(e.text || '')})`);
          await new Promise((r) => setTimeout(r, SETTLE_MS));
        } else if (e.step === 'save') {
          await win.webContents.executeJavaScript(`window.__wrlEditor.setText(${JSON.stringify(e.text || '')})`);
          await new Promise((r) => setTimeout(r, 400));
          await win.webContents.executeJavaScript(`window.__wrlEditor.click('saveBtn')`);
          await new Promise((r) => setTimeout(r, SETTLE_MS));
        } else if (e.step === 'diagnostic') {
          await win.webContents.executeJavaScript(`window.__wrlEditor.clickFirst('#diagList .row-item')`);
          await new Promise((r) => setTimeout(r, 400));
        } else if (e.step === 'outline') {
          await win.webContents.executeJavaScript(`window.__wrlEditor.clickFirst('#outlineList .row-item')`);
          await new Promise((r) => setTimeout(r, 400));
        } else if (e.step === 'external') {
          await win.webContents.executeJavaScript(`window.__wrlEditor.click('externalBtn')`);
          await new Promise((r) => setTimeout(r, 400));
        } else if (e.step === 'modal') {
          // Open the in-DOM go-to-line modal so it can be captured (e.g. scaled).
          await win.webContents.executeJavaScript(`window.__wrlEditor.click('gotoBtn')`);
          await new Promise((r) => setTimeout(r, 400));
        } else if (e.step === 'conflict') {
          // Type an edit, stage an EXTERNAL change to the same scratch source,
          // then attempt Save -> the renderer raises the Reload/Save As/Cancel dialog.
          const target = e.context === 'world' ? (e.ref || e.primary) : e.mallPath;
          await win.webContents.executeJavaScript(`window.__wrlEditor.setText(${JSON.stringify(e.text || '# mine\\n')})`);
          await new Promise((r) => setTimeout(r, 300));
          if (inTemp(target)) {
            const raw = fs.readFileSync(target);
            const isGz = raw[0] === 0x1f && raw[1] === 0x8b;
            const bytes = Buffer.from('#VRML V2.0 utf8\n# externally changed\n', 'utf8');
            fs.writeFileSync(target, isGz ? zlib.gzipSync(bytes, { level: 9 }) : bytes);
          }
          await win.webContents.executeJavaScript(`window.__wrlEditor.click('saveBtn')`);
          await new Promise((r) => setTimeout(r, SETTLE_MS));
        }

        // Phase 7C2 live-preview steps (Mall editor only). These drive the SAME
        // preview controls the user uses, through the page's own __wrlEditor hooks
        // -- no new capability. The preview authorizes against currentSession
        // (the scratch mallPath set above), so it renders the unsaved buffer.
        if (e.previewLayout) {
          await win.webContents.executeJavaScript(`window.__wrlEditor.previewLayout(${JSON.stringify(e.previewLayout)})`);
          await new Promise((r) => setTimeout(r, 500));
        }
        if (e.fitMode) {
          await win.webContents.executeJavaScript(`window.__wrlEditor.fitMode(${JSON.stringify(e.fitMode)})`);
          await new Promise((r) => setTimeout(r, SETTLE_MS));
        }
        if (e.previewStepSplit) {
          await win.webContents.executeJavaScript(`window.__wrlEditor.previewStepSplit(${JSON.stringify(e.previewStepSplit)})`);
          await new Promise((r) => setTimeout(r, 400));
        }
        if (e.previewStep === 'update') {
          await win.webContents.executeJavaScript('window.__wrlEditor.previewUpdate()');
          await new Promise((r) => setTimeout(r, SETTLE_MS));
        } else if (e.previewStep === 'saved') {
          await win.webContents.executeJavaScript('window.__wrlEditor.previewSaved()');
          await new Promise((r) => setTimeout(r, SETTLE_MS));
        } else if (e.previewStep === 'maximize') {
          await win.webContents.executeJavaScript('window.__wrlEditor.previewMaximize()');
          await new Promise((r) => setTimeout(r, 500));
        }
        // A second edit (used for the temporary-syntax-error / recovery captures).
        if (typeof e.text2 === 'string') {
          await win.webContents.executeJavaScript(`window.__wrlEditor.setText(${JSON.stringify(e.text2)})`);
          await new Promise((r) => setTimeout(r, SETTLE_MS));
        }

        const status = await win.webContents.executeJavaScript(
          '(window.__wrlEditor && window.__wrlEditor.status) ? JSON.stringify(window.__wrlEditor.status()) : "null"'
        );
        payload.editor = JSON.parse(status);
        const pv = await win.webContents.executeJavaScript(
          '(window.__wrlEditor && window.__wrlEditor.previewState) ? JSON.stringify(window.__wrlEditor.previewState()) : "null"'
        );
        payload.preview = JSON.parse(pv);
        if (job.out) {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(job.out, img.toPNG());
          payload.out = job.out;
        }
        // Leak assertion: after closing the editor session, no overlay/generation
        // may remain for it (Phase 7C2 resource-cleanup gate).
        if (e.leakAfterClose) {
          const sid = editorController.describe().sessionId;
          if (sid != null) mallPreviewBridge.invalidateSession(sid);
          payload.leak = mallPreviewBridge.leak();
        }
        return payload;
      }

      // World Project job (Phase 4A): drive the read-only World workspace across
      // a sequence of states in the SAME reused window. `world` may be null (the
      // empty-project state) or { root, primary } (a scratch project the trusted
      // main process points the confined scan at -- the renderer never supplies
      // this). No mutation: scanning only reads.
      if ('world' in job) {
        await gotoPage('world');
        if (job.world) {
          // QA-only: swap the SCRATCH primary's bytes before scanning, so the
          // parse-fail->recover sequence can be driven inside ONE reused process
          // without mid-run file edits from the orchestrator. Confined to the OS
          // temp dir -- this never touches a real project file, and is reachable
          // only under WRL_FORGE_CAPTURE_SERVER (never in normal use).
          if (typeof job.world.writePrimary === 'string') {
            const os = require('os');
            const scratch = path.resolve(job.world.primary);
            if (scratch.startsWith(path.resolve(os.tmpdir()))) {
              fs.writeFileSync(scratch, job.world.writePrimary, 'utf8');
            } else {
              throw new Error('writePrimary refused outside the OS temp dir');
            }
          }
          worldSession.open({ root: job.world.root, primary: job.world.primary, candidates: [{ path: job.world.primary }] });
          const scan = await worldSession.scan();
          const ser = serializeScan(scan);
          await win.webContents.executeJavaScript(`window.__wrlForgeApplyWorld(${JSON.stringify(ser)})`);
          payload.summary = ser.summary;
          // Drive the embedded X_ITE world preview through the real read-only
          // world:previewLoad path + confined wrlworld:// handler.
          if (job.preview) {
            const opts = JSON.stringify({ viewpoint: job.viewpoint, reset: !!job.reset });
            const dbg = await win.webContents.executeJavaScript(
              `(async () => JSON.stringify(await window.__wrlForgeWorldPreview(${opts})))()`
            );
            payload.preview = JSON.parse(dbg);
          }
          // Drive the read-only PACKAGE AUDIT display (Phase 5A).
          if (job.packageAudit || job.buildBundle) {
            const plan = buildPackagePlan(scan);
            const audit = {
              ok: plan.ok, status: plan.status, projectName: plan.projectName,
              primaryRel: plan.primaryRel, totals: plan.totals, blocking: plan.blocking,
              findings: plan.findings, unusedFiles: plan.unusedFiles, files: plan.files,
              manifest: buildManifest(plan), label: plan.label, disclaimer: plan.disclaimer,
            };
            await win.webContents.executeJavaScript(
              `window.__wrlForgeApplyPackageAudit(${JSON.stringify(audit)});` +
              `(document.getElementById('pkgStatusBadge')||{}).scrollIntoView&&document.getElementById('pkgStatusBadge').scrollIntoView({block:'start'});`
            );
            payload.packageAudit = { status: plan.status, totals: plan.totals,
              blocking: plan.blocking.map((b) => b.code), unused: plan.unusedFiles.length };
            // QA-only bundle build: writes ONLY under the OS temp dir (never a
            // real destination, never inside the project), mirroring writePrimary's
            // confinement. Reachable only under WRL_FORGE_CAPTURE_SERVER.
            if (job.buildBundle && plan.status !== 'blocked') {
              const os = require('os');
              const dest = path.resolve(String(job.buildBundle));
              if (!dest.startsWith(path.resolve(os.tmpdir()))) {
                throw new Error('buildBundle refused outside the OS temp dir');
              }
              try {
                payload.bundle = writeReviewBundle(scan, dest, { plan });
                await win.webContents.executeJavaScript(
                  `window.__wrlForgeApplyBundleResult(${JSON.stringify({ ok: true, outPath: payload.bundle.outPath, bytes: payload.bundle.bytes, entryCount: payload.bundle.entryCount })})`
                );
              } catch (err) {
                payload.bundleError = String(err.message || err);
                await win.webContents.executeJavaScript(
                  `window.__wrlForgeApplyBundleResult(${JSON.stringify({ ok: false, error: payload.bundleError })})`
                );
              }
            }
          }
        } else {
          worldSession.open({ root: null, primary: null, candidates: [], empty: true });
          worldPreview = null;
          await win.webContents.executeJavaScript('window.__wrlForgeResetWorld && window.__wrlForgeResetWorld()');
        }
        await new Promise((r) => setTimeout(r, SETTLE_MS));
        if (job.out) {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(job.out, img.toPNG());
          payload.out = job.out;
        }
        return payload;
      }

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

// The set of absolute WRL-node paths the current world scan discovered (readable
// only). This is the editor's open allow-list for "Open a referenced WRL": only a
// real dependency node may be opened, never an arbitrary in-root file.
function worldWrlSet() {
  const set = new Set();
  const scan = worldSession.last;
  if (scan && scan.graph) {
    for (const n of scan.graph.wrlNodes || []) {
      if (!n.unreadable) set.add(path.resolve(n.path));
    }
  }
  return set;
}

// Build the native editor controller, injecting the live context providers and
// the main-owned dialog/launcher. Keeps EditorController free of Electron so its
// authorization/stale/conflict/restore logic stays unit-tested.
function createEditorController() {
  return new EditorController({
    userDataPath: app.getPath('userData'),
    getMallSource: () => (currentSession ? currentSession.mallPath : null),
    getWorldContext: () => {
      if (!worldSession.primary) return null;
      return { root: worldSession.root, primary: worldSession.primary, allowedWrl: worldWrlSet() };
    },
    launchExternal: (filePath) => launchEditor(filePath),
    promptSaveAs: async ({ defaultPath }) => {
      const res = await dialog.showSaveDialog(mainWindow, {
        title: 'Save WRL As',
        defaultPath: defaultPath || undefined,
        filters: [
          { name: 'VRML files', extensions: ['wrl', 'wrz'] },
          { name: 'All files', extensions: ['*'] },
        ],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      return (res.canceled || !res.filePath) ? null : res.filePath;
    },
  });
}

app.whenReady().then(() => {
  installPreviewNetworkGuard();
  installWorldPreviewProtocol();
  editorController = createEditorController();
  mallPreviewBridge = createMallPreviewBridge({
    // The renderer never supplies a path: the bridge resolves the editor session
    // itself and confirms the held source equals the authorized Mall item.
    describeSession: () => editorController.describe(),
    getAuthorizedMallSource: () => (currentSession ? currentSession.mallPath : null),
    scanRemoteUrls,
    readSaved: (absPath) => readWrlSource(absPath),
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// I/O + launch dependency bag for the Mall edit flow (src/editor/mall-edit-flow.js).
// Kept here so the flow itself stays pure and unit-testable without Electron.
const mallEditDeps = {
  readSource: (p) => readWrlSource(p),
  editPathFor,
  writeWorkingCopy: (editFile, text) => fs.writeFileSync(editFile, text, 'utf8'),
  workingCopyExists: (editFile) => fs.existsSync(editFile),
  launch: (editFile) => launchEditor(editFile),
};

// Open a mall .wrl (gzip or plain) and prepare its plain .edit.wrl working copy.
// Opening a file is PASSIVE (Phase 7B1): it never launches an external editor.
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
  // Passive open: write the plain working copy, but do NOT launch any external
  // editor. The external editor starts only via the explicit mall:openInEditor
  // action below.
  const info = openMallItem(mallPath, mallEditDeps);
  currentSession = { mallPath, editFile: info.editFile };
  return {
    mallPath: info.mallPath,
    editFile: info.editFile,
    wasGzipped: info.wasGzipped,
    rawBytes: info.rawBytes,
    ...validate(info.text),
  };
}

// Resolve the external editor per platform (VSCodium → VS Code), honouring a
// user override from settings.json (`editorCommand`) or the WRL_FORGE_EDITOR env
// var. Cross-platform: Linux `codium` on PATH; Windows install locations + PATH
// shims (see src/editor/editor-locator.js).
function resolveConfiguredEditor() {
  let override = null;
  try {
    override = loadSettings(app.getPath('userData')).editorCommand;
  } catch { /* settings are best-effort */ }
  return resolveEditor({ override });
}

// Launch the editor on editFile. Returns { launched:true } or a structured
// { launched:false, reason } so callers can surface a clear "editor not found"
// message instead of failing silently. Never throws.
function launchEditor(editFile) {
  // WRL_FORGE_NO_EDITOR lets the non-interactive QA/screenshot harness drive the
  // real open flow without spawning a VSCodium window per run.
  if (process.env.WRL_FORGE_NO_EDITOR) return { launched: false, reason: 'disabled' };
  const resolution = resolveConfiguredEditor();
  if (!resolution.found) {
    console.warn('[wrl-forge] editor not found:', resolution.hint);
    return { launched: false, reason: 'not-found', hint: resolution.hint, tried: resolution.tried };
  }
  try {
    const spec = buildLaunch(resolution, editFile);
    const child = spawn(spec.command, spec.args, spec.options);
    // A spawn error (e.g. a stale path) arrives asynchronously; surface it in the
    // log rather than crashing the app. The user can still edit via the OS.
    child.on('error', (err) => console.warn('[wrl-forge] editor launch failed:', String(err && err.message || err)));
    child.unref();
    return { launched: true, command: resolution.command, source: resolution.source };
  } catch (err) {
    return { launched: false, reason: 'spawn-failed', error: String((err && err.message) || err) };
  }
}

// Explicit "Open in External Editor" action. This is the ONLY Mall-lane path that
// starts an external-editor process: it ensures the .edit.wrl working copy exists
// (recreating it from the source if it was removed) and launches the editor on it.
ipcMain.handle('mall:openInEditor', async () => {
  if (!currentSession) throw new Error('No file is open.');
  const { editFile, editorStatus } = openExternalEditor(currentSession, mallEditDeps);
  return { editFile, editorStatus };
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

// ---------------------------------------------------------------------------
// World Project lane (Phase 4A) -- READ-ONLY. No handler writes, repairs, copies,
// renames, deletes, uploads, or fetches. The main process owns every project
// path; the renderer can only pick among detected candidates and read results.
// ---------------------------------------------------------------------------

// Switch the one window between the Mall and World workspaces (whitelisted page).
ipcMain.handle('app:goto', async (_evt, page) => {
  if (!APP_PAGES[page]) throw new Error(`Unknown page '${page}'.`);
  await gotoPage(page);
  return { page };
});

// Open a project FOLDER: detect the primary world file(s) within it. Ambiguity is
// reported (candidates returned) rather than silently guessed.
ipcMain.handle('world:openFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a World Project folder',
    properties: ['openDirectory'],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const root = res.filePaths[0];
  const detection = detectPrimaries(root);
  return worldSession.open({ root, ...detection });
});

// Open a single primary WORLD FILE directly; its folder becomes the project root.
ipcMain.handle('world:openPrimaryFile', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a primary world .wrl / .wrz',
    properties: ['openFile'],
    filters: [
      { name: 'VRML worlds', extensions: ['wrl', 'wrz'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const primary = res.filePaths[0];
  const root = path.dirname(primary);
  return worldSession.open({
    root,
    primary,
    candidates: [{ path: primary, relative: path.basename(primary), bytes: safeSize(primary), depth: 0, referenced: false, preferred: true }],
    ambiguous: false,
    empty: false,
  });
});

// Resolve an ambiguous project: choose one detected candidate as the primary.
ipcMain.handle('world:choosePrimary', async (_evt, primaryPath) => {
  return worldSession.choosePrimary(primaryPath);
});

// Scan the currently-open project (held root + selected primary). Overlapping
// scans are refused by the session; a transient failure keeps the last result.
ipcMain.handle('world:scan', async () => {
  try {
    const scan = await worldSession.scan();
    return serializeScan(scan);
  } catch (err) {
    return { ok: false, status: err.code === 'EBUSY' ? 'busy' : 'error', error: String(err.message || err) };
  }
});

// Refresh == rescan the same primary (external edits picked up on demand only).
ipcMain.handle('world:refresh', async () => {
  try {
    const scan = await worldSession.scan();
    return serializeScan(scan);
  } catch (err) {
    return { ok: false, status: err.code === 'EBUSY' ? 'busy' : 'error', error: String(err.message || err) };
  }
});

// Read-only World Project PREVIEW loader (Phase 4B). Ensures a scan exists,
// installs the asset-graph-derived read-authorization set into the scheme
// handler, and returns ONLY controlled content + metadata to the renderer: the
// decompressed primary text, the wrlworld base URL, advisory counts, and the
// warning lists. It takes NO renderer-supplied path and never writes -- the main
// process owns every project path (held in worldSession). X_ITE then resolves the
// world's nested deps through the confined wrlworld:// handler.
ipcMain.handle('world:previewLoad', async () => {
  if (!worldSession.primary) throw new Error('No primary world is selected.');
  let scan = worldSession.last;
  if (!scan) scan = await worldSession.scan();
  worldPreview = {
    projectRoot: path.resolve(scan.root),
    authorized: buildAuthorizedSet(scan.graph),
  };
  return buildPreviewPayload(scan);
});

ipcMain.handle('world:describe', async () => worldSession.describe());

// Reveal a path in the OS file manager, confined to the open project's root and
// only if it actually exists on disk (never a renderer-chosen arbitrary path).
ipcMain.handle('world:reveal', async (_evt, targetPath) => {
  if (!worldSession.root) throw new Error('No World Project is open.');
  const root = path.resolve(worldSession.root);
  const target = path.resolve(String(targetPath || ''));
  const rel = path.relative(root, target);
  const inside = target === root || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (!inside) throw new Error('Refusing to reveal a path outside the project root.');
  if (!fs.existsSync(target)) throw new Error('That path no longer exists.');
  shell.showItemInFolder(target);
  return { revealed: target };
});

ipcMain.handle('world:revealRoot', async () => {
  if (!worldSession.root || !fs.existsSync(worldSession.root)) throw new Error('No World Project root available.');
  shell.showItemInFolder(worldSession.root);
  return { revealed: worldSession.root };
});

// Explicit-only: launch VSCodium on the primary world file. Opening a World
// Project never auto-launches the editor.
ipcMain.handle('world:openPrimaryInEditor', async () => {
  if (!worldSession.primary) throw new Error('No primary world is selected.');
  const editorStatus = launchEditor(worldSession.primary);
  return { primary: worldSession.primary, editorStatus };
});

// Read-only PACKAGE AUDIT (Phase 5A). Ensures a scan exists, derives the
// deterministic package plan from the production asset graph, and returns the
// renderer-facing audit: status (ready/blocked/needs-review), totals, blocking
// findings, unused files, findings, and a manifest preview. It NEVER writes and
// takes no renderer-supplied path (main owns every project path via worldSession).
ipcMain.handle('world:packageAudit', async () => {
  if (!worldSession.primary) throw new Error('No primary world is selected.');
  let scan = worldSession.last;
  if (!scan) scan = await worldSession.scan();
  const plan = buildPackagePlan(scan);
  return {
    ok: plan.ok,
    status: plan.status,
    projectName: plan.projectName,
    primaryRel: plan.primaryRel,
    totals: plan.totals,
    blocking: plan.blocking,
    findings: plan.findings,
    unusedFiles: plan.unusedFiles,
    files: plan.files,
    manifest: buildManifest(plan),
    label: plan.label,
    disclaimer: plan.disclaimer,
  };
});

// Explicit-user-action BUILD REVIEW BUNDLE (Phase 5A). Requires an explicit
// destination (a Save dialog owned by the main process — the renderer never
// supplies a path). Writes a deterministic ZIP ONLY to a new location OUTSIDE the
// project (bundle-builder refuses in-project writes, overwrites, and blocked
// projects). The source project is never mutated. NOT an upload: nothing is sent
// anywhere and no server compatibility is claimed.
ipcMain.handle('world:buildReviewBundle', async () => {
  if (!worldSession.primary) throw new Error('No primary world is selected.');
  let scan = worldSession.last;
  if (!scan) scan = await worldSession.scan();

  // Pre-flight the plan so we can refuse a blocked project BEFORE prompting.
  const plan = buildPackagePlan(scan);
  if (plan.status === 'blocked' || plan.blocking.length) {
    return { ok: false, code: 'EBLOCKED', status: 'blocked', blocking: plan.blocking,
      error: 'Packaging is blocked — resolve the blocking findings first.' };
  }

  // Default the bundle name + a location OUTSIDE the project (its parent folder),
  // so the default never lands inside the source project.
  const defaultName = `${plan.projectName || 'world'}-world-project-bundle.zip`;
  const defaultDir = path.dirname(path.resolve(scan.root));
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Save WRL Forge World Project Bundle',
    defaultPath: path.join(defaultDir, defaultName),
    filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  if (res.canceled || !res.filePath) return null;

  try {
    const summary = writeReviewBundle(scan, res.filePath, { plan });
    return { ok: true, ...summary };
  } catch (err) {
    return { ok: false, code: err.code || 'EBUNDLE', error: String(err.message || err),
      blocking: (err.plan && err.plan.blocking) || undefined };
  }
});

// ---------------------------------------------------------------------------
// Native editor lane (Phase 7B). The main process (editorController) owns the one
// open document and every path decision. The renderer supplies text + intent and,
// for a World "open referenced WRL", a reference that is authorized against the
// scan graph. There is NO channel by which the renderer names a write path: save
// writes only to the held source; saveAs writes only to a path from main's own
// Save dialog. Conflict (external change) is returned structured so the renderer
// can raise its Reload / Save As / Cancel choice.
// ---------------------------------------------------------------------------
ipcMain.handle('editor:openMall', async () => editorController.openMall());
ipcMain.handle('editor:openWorldPrimary', async () => editorController.openWorldPrimary());
ipcMain.handle('editor:openWorldReference', async (_evt, ref) => editorController.openWorldReference(ref));
ipcMain.handle('editor:describe', async (_evt, opts) => editorController.describe(opts));
ipcMain.handle('editor:setText', async (_evt, { sessionId, text } = {}) => editorController.setText(sessionId, text));

ipcMain.handle('editor:save', async (_evt, { sessionId, text, allowOverwrite } = {}) => {
  try {
    return editorController.save(sessionId, text, { allowOverwrite });
  } catch (err) {
    // A conflict or failed verification is an expected, user-actionable outcome:
    // return it structured (source untouched, buffer stays dirty) so the renderer
    // can offer Reload / Save As / Cancel. Programming/renderer-state errors
    // (stale id, bad arg, nothing open) reject as usual.
    if (err.code === 'EEXTERNAL' || err.code === 'EVERIFY') {
      return { ok: false, code: err.code, error: String(err.message || err), current: err.current || null };
    }
    throw err;
  }
});

ipcMain.handle('editor:saveAs', async (_evt, { sessionId, text, format } = {}) =>
  editorController.saveAs(sessionId, text, { format }));
ipcMain.handle('editor:reload', async (_evt, { sessionId } = {}) => editorController.reload(sessionId));
ipcMain.handle('editor:checkConflict', async (_evt, { sessionId } = {}) => editorController.checkConflict(sessionId));
ipcMain.handle('editor:openInExternal', async (_evt, { sessionId } = {}) => editorController.openInExternal(sessionId));
ipcMain.handle('editor:close', async (_evt, { sessionId } = {}) => {
  // Closing an editor session must leave no live preview overlay behind.
  if (mallPreviewBridge && sessionId != null) mallPreviewBridge.invalidateSession(sessionId);
  return editorController.close(sessionId);
});
ipcMain.handle('editor:restore', async () => editorController.restore());

// ---------------------------------------------------------------------------
// Mall live-preview IPC (Phase 7C2). The renderer sends ONLY { sessionId, text,
// bufferVersion } -- never a path/base/root/url/scheme. The bridge resolves the
// editor session, confirms it is the AUTHORIZED Mall source, byte-substitutes the
// unsaved buffer through the 7C1 overlay, and returns the render payload. No file
// is written; there is no channel by which the renderer names a path to read.
// ---------------------------------------------------------------------------
ipcMain.handle('editor:previewLoad', async (_evt, { sessionId, text, bufferVersion } = {}) =>
  mallPreviewBridge.load({ sessionId, text, bufferVersion }));
ipcMain.handle('editor:previewSaved', async (_evt, { sessionId } = {}) =>
  mallPreviewBridge.saved({ sessionId }));
ipcMain.handle('editor:previewAccept', async (_evt, { sessionId, generation } = {}) =>
  mallPreviewBridge.accept({ sessionId, generation }));
ipcMain.handle('editor:previewClose', async (_evt, { sessionId } = {}) => {
  if (mallPreviewBridge && sessionId != null) mallPreviewBridge.invalidateSession(sessionId);
  return { ok: true };
});
ipcMain.handle('editor:previewLeak', async () => (mallPreviewBridge ? mallPreviewBridge.leak() : null));

function safeSize(p) {
  try { return fs.statSync(p).size; } catch { return null; }
}
