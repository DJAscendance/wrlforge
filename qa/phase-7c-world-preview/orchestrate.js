'use strict';
// Phase 7C3 (World unsaved-buffer live preview) visual-QA orchestrator.
//
// Drives the required live-preview states -- primary + nested unsaved renders in
// the FULL world scene, auto/manual update, last-valid retention through broken
// primary AND broken nested text, recovery, saved-version fallback, viewpoint
// preservation + fallback, navigation-mode preservation, new-file-reference
// blocking + the Find-new-files rescan, missing/case/remote/unsafe findings,
// preview-max / editor-only layouts, High Contrast at zoom, a 70+ texture world,
// a nested gzip Inline, the zero-overlay leak gate, and project-switch cleanup --
// through ONE reused Electron capture-server process via VisualQaRunner
// (concurrency 1, launch cap, cooldown, timeouts, PID tracking, zero-survivor
// teardown). No per-screenshot launches, no pkill/killall.
//
//   node qa/phase-7c-world-preview/orchestrate.js   (npm run qa:world-preview)
//
// Every project the editor opens is a SCRATCH world staged under the OS temp
// dir; the capture server refuses editor targets outside temp, no historical
// fixture is mutated, and no temporary preview WRL / .edit.wrl is written.
// PNGs + per-state preview status go to ./screenshots + ./RESULTS.json.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { VisualQaRunner } = require('../visual-qa/runner');
const { acquire } = require('../visual-qa/lock');
const { makeCaptureTransport } = require('../visual-qa/transport');

const repoRoot = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'screenshots');
const SIZE = '1280x860';
const HEADER = '#VRML V2.0 utf8\n';

// A 1x1 PNG for scratch textures.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAABAAAAAQAAAAEIBAMAAAAsvV0uAAAAC1BMVEX///8AAAAAAP+cboLnAAAADUlEQVR4nGNgYGBgAAAABQABp+jjWAAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_OK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// ---- scratch world A: primary + nested + gzip nested + texture + unused file --
const PRIMARY = HEADER +
  'WorldInfo { title "World Preview Scratch" }\n' +
  'DEF Entry Viewpoint { position 0 1.6 8 description "Front door" }\n' +
  'DEF Above Viewpoint { position 0 12 0.01 orientation 1 0 0 -1.5707 description "Overview" }\n' +
  'NavigationInfo { type [ "EXAMINE" "ANY" ] }\n' +
  'DEF Floor Shape { appearance Appearance { texture ImageTexture { url "textures/floor.png" } } geometry Box { size 8 0.2 8 } }\n' +
  'DEF Landmark Transform { translation 0 1.2 0 children [ Shape { appearance Appearance { material Material { diffuseColor 1 0.4 0.2 } } geometry Cone { bottomRadius 1 height 2 } } ] }\n' +
  'Inline { url "rooms/hall.wrl" }\n' +
  'Inline { url "gz/vault.wrl" }\n';
const PRIMARY_EDIT = PRIMARY.replace('diffuseColor 1 0.4 0.2', 'diffuseColor 0.2 0.8 1')
  .replace('geometry Cone { bottomRadius 1 height 2 }', 'geometry Sphere { radius 1.1 }');
const PRIMARY_NO_ABOVE = PRIMARY_EDIT.replace(/DEF Above Viewpoint \{[^}]*\}\n/, '');
const PRIMARY_BROKEN = HEADER + 'Shape { geometry Box { size 2 2\n';

const NESTED = HEADER +
  'DEF Hall Transform { translation 3 1 0 children [ Shape { appearance Appearance { material Material { diffuseColor 0.3 1 0.4 } } geometry Cylinder { radius 0.6 height 2 } } ] }\n';
const NESTED_EDIT = NESTED.replace('diffuseColor 0.3 1 0.4', 'diffuseColor 1 0.9 0.1')
  .replace('geometry Cylinder { radius 0.6 height 2 }', 'geometry Box { size 1.2 2 1.2 }');
const NESTED_BROKEN = HEADER + 'Transform { children [ Shape {\n';
const NESTED_NEWREF = NESTED_EDIT + 'Inline { url "../newthing.wrl" }\n';

const NEWTHING = HEADER +
  'DEF NewThing Transform { translation -3 1 0 children [ Shape { appearance Appearance { material Material { diffuseColor 1 1 0.2 } } geometry Box { size 1 2 1 } } ] }\n';
const VAULT = HEADER +
  'DEF Vault Transform { translation 0 1 -3 children [ Shape { appearance Appearance { material Material { diffuseColor 0.8 0.3 1 } } geometry Sphere { radius 0.8 } } ] }\n';

// ---- scratch world FINDINGS: an edit introduces every blocked reference kind --
const FINDINGS_CLEAN = HEADER + 'Shape { appearance Appearance { material Material { diffuseColor 0.5 0.6 0.9 } } geometry Box { size 2 2 2 } }\n';
const FINDINGS_EDIT = FINDINGS_CLEAN +
  'Shape { appearance Appearance { texture ImageTexture { url "missing.png" } } geometry Box { size 1 1 1 } }\n' +
  'Shape { appearance Appearance { texture ImageTexture { url "case.png" } } geometry Sphere { radius 0.5 } }\n' +
  'Shape { appearance Appearance { texture ImageTexture { url "http://example.com/x.png" } } geometry Cone {} }\n' +
  'Inline { url "../../escape.wrl" }\n';

function stageWorldA() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-worldpreviewqa-A-'));
  fs.mkdirSync(path.join(root, 'rooms'));
  fs.mkdirSync(path.join(root, 'gz'));
  fs.mkdirSync(path.join(root, 'textures'));
  fs.writeFileSync(path.join(root, 'entry.wrl'), PRIMARY, 'utf8');
  fs.writeFileSync(path.join(root, 'rooms', 'hall.wrl'), NESTED, 'utf8');
  fs.writeFileSync(path.join(root, 'gz', 'vault.wrl'), zlib.gzipSync(Buffer.from(VAULT, 'utf8'), { level: 9 }));
  fs.writeFileSync(path.join(root, 'textures', 'floor.png'), PNG_OK);
  fs.writeFileSync(path.join(root, 'newthing.wrl'), NEWTHING, 'utf8'); // on disk, unreferenced
  return root;
}

function stageFindings() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-worldpreviewqa-F-'));
  fs.writeFileSync(path.join(root, 'scene.wrl'), FINDINGS_CLEAN, 'utf8');
  fs.writeFileSync(path.join(root, 'CASE.PNG'), PNG_OK); // referenced as case.png
  return root;
}

function stageBigTex(n) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-worldpreviewqa-T-'));
  let body = HEADER + 'WorldInfo { title "BigTex" }\nDEF V Viewpoint { position 0 4 26 description "Grid" }\n';
  for (let i = 0; i < n; i++) {
    const name = `tex${String(i).padStart(3, '0')}.png`;
    fs.writeFileSync(path.join(root, name), i % 2 ? PNG_OK : PNG_1x1);
    const x = (i % 12) * 2 - 11, y = Math.floor(i / 12) * 2;
    body += `Transform { translation ${x} ${y} 0 children [ Shape { appearance Appearance { texture ImageTexture { url "${name}" } } geometry Box { size 1.6 1.6 0.4 } } ] }\n`;
  }
  fs.writeFileSync(path.join(root, 'big.wrl'), body, 'utf8');
  return root;
}

function stageWorldB() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-worldpreviewqa-B-'));
  fs.writeFileSync(path.join(root, 'main.wrl'), HEADER + 'DEF Solo Shape { appearance Appearance { material Material { diffuseColor 0.9 0.2 0.6 } } geometry Box { size 2 2 2 } }\n', 'utf8');
  return root;
}

function realSpawn(extraEnv = {}) {
  return spawn(require('electron'), ['.', '--no-sandbox'], {
    cwd: repoRoot,
    env: { ...process.env, WRL_FORGE_CAPTURE_SERVER: '1', WRL_FORGE_NO_EDITOR: '1', WRL_FORGE_SETTLE_MS: '1600', ...extraEnv },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

const png = (name) => path.join(OUT, name + '.png');
const chipOf = (r) => (r.preview && r.preview.chip) || '';
const worldOf = (r) => (r.preview && r.preview.world) || {};

async function main() {
  if (process.platform !== 'win32' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    console.error('phase-7c-world-preview: no DISPLAY/WAYLAND_DISPLAY -- refusing to launch Electron headless-blind.');
    process.exit(2);
  }
  const transport = makeCaptureTransport();
  fs.mkdirSync(OUT, { recursive: true });

  const rootA = stageWorldA();
  const rootF = stageFindings();
  const rootT = stageBigTex(72);
  const rootB = stageWorldB();
  const scratch = [rootA, rootF, rootT, rootB];

  const A = { root: rootA, primary: path.join(rootA, 'entry.wrl') };
  const AN = { ...A, ref: path.join(rootA, 'rooms', 'hall.wrl') };
  const F = { root: rootF, primary: path.join(rootF, 'scene.wrl') };
  const T = { root: rootT, primary: path.join(rootT, 'big.wrl') };
  const B = { root: rootB, primary: path.join(rootB, 'main.wrl') };
  const world = (proj, extra) => ({ context: 'world', ...proj, previewLayout: 'split', ...extra });

  const jobs = [
    { id: '01-primary-split', editor: world(A, {}), size: SIZE, out: png('01-primary-split') },
    { id: '02-unsaved-primary', editor: world(A, { step: 'type', text: PRIMARY_EDIT }), size: SIZE, out: png('02-unsaved-primary') },
    { id: '03-unsaved-nested', editor: world(AN, { step: 'type', text: NESTED_EDIT }), size: SIZE, out: png('03-unsaved-nested') },
    { id: '04-auto-update', editor: world(A, { text2: PRIMARY_EDIT }), size: SIZE, out: png('04-auto-update') },
    { id: '05-manual-update', editor: world(A, { step: 'type', text: PRIMARY_EDIT, previewStep: 'update' }), size: SIZE, out: png('05-manual-update') },
    { id: '06-broken-primary-lastvalid', editor: world(A, { step: 'type', text: PRIMARY_EDIT, text2: PRIMARY_BROKEN }), size: SIZE, out: png('06-broken-primary-lastvalid') },
    { id: '07-broken-nested-lastvalid', editor: world(AN, { step: 'type', text: NESTED_EDIT, text2: NESTED_BROKEN }), size: SIZE, out: png('07-broken-nested-lastvalid') },
    { id: '08-recovery', editor: world(A, { step: 'type', text: PRIMARY_BROKEN, text2: PRIMARY_EDIT }), size: SIZE, out: png('08-recovery') },
    { id: '09-saved-fallback', editor: world(A, { step: 'type', text: PRIMARY_EDIT, previewStep: 'saved' }), size: SIZE, out: png('09-saved-fallback') },
    { id: '10-viewpoint-preserved', editor: world(A, { previewViewpoint: 1, text2: PRIMARY_EDIT }), size: SIZE, out: png('10-viewpoint-preserved') },
    { id: '11-viewpoint-fallback', editor: world(A, { previewViewpoint: 1, text2: PRIMARY_NO_ABOVE }), size: SIZE, out: png('11-viewpoint-fallback') },
    { id: '12-nav-preserved', editor: world(A, { previewNav: 'WALK', text2: PRIMARY_EDIT }), size: SIZE, out: png('12-nav-preserved') },
    { id: '13-newref-blocked', editor: world(AN, { step: 'type', text: NESTED_NEWREF }), size: SIZE, out: png('13-newref-blocked') },
    { id: '14-find-new-files', editor: world(AN, { step: 'save', text: NESTED_NEWREF, previewStep: 'findnew' }), size: SIZE, out: png('14-find-new-files') },
    { id: '15-findings-blocked', editor: world(F, { step: 'type', text: FINDINGS_EDIT }), size: SIZE, out: png('15-findings-blocked') },
    { id: '16-preview-max', editor: world(A, { previewLayout: 'preview-max' }), size: SIZE, out: png('16-preview-max') },
    { id: '17-editor-only', editor: world(A, { previewLayout: 'editor-only' }), size: SIZE, out: png('17-editor-only') },
    { id: '18-contrast-zoom', editor: world(A, { theme: 'contrast', zoom: 4 }), size: SIZE, out: png('18-contrast-zoom') },
    // 19 resets the persisted theme/zoom from 18 (persistence is correct product
    // behavior; the reset keeps the remaining evidence in the default theme).
    { id: '19-seventy-textures', editor: world(T, { theme: 'dark', zoom: 0 }), size: SIZE, out: png('19-seventy-textures') },
    { id: '20-nested-gzip', editor: world(A, { step: 'type', text: PRIMARY_EDIT }), size: SIZE, out: png('20-nested-gzip') },
    { id: '21-leak-after-close', editor: world(A, { step: 'type', text: PRIMARY_EDIT, leakAfterClose: true }), size: SIZE, out: png('21-leak-after-close') },
    // 22 switches to a DIFFERENT scratch project in the SAME reused process: the
    // new document's load invalidates the previous project's overlay session, and
    // the close gate must again reach zero.
    { id: '22-project-switch-cleanup', editor: world(B, { step: 'type', text: HEADER + 'DEF Solo Shape { geometry Box { size 3 1 1 } }\n', leakAfterClose: true }), size: SIZE, out: png('22-project-switch-cleanup') },
  ];

  // Per-state gates (beyond "a PNG was captured"): chips, identities, viewpoint/
  // nav preservation, findings, texture counts, and both leak checks.
  const EXPECT = {
    '01-primary-split': (r) => r.preview.context === 'world' && chipOf(r) === 'Live' && worldOf(r).editedIsPrimary === true,
    '02-unsaved-primary': (r) => chipOf(r) === 'Live' && worldOf(r).editedIsPrimary === true && worldOf(r).haveValidScene,
    '03-unsaved-nested': (r) => chipOf(r) === 'Live' && worldOf(r).editedRel === 'rooms/hall.wrl' && worldOf(r).editedIsPrimary === false,
    '04-auto-update': (r) => chipOf(r) === 'Live',
    '05-manual-update': (r) => chipOf(r) === 'Live',
    '06-broken-primary-lastvalid': (r) => chipOf(r) === 'Showing last good version' && worldOf(r).haveValidScene,
    '07-broken-nested-lastvalid': (r) => chipOf(r) === 'Showing last good version' && worldOf(r).haveValidScene,
    '08-recovery': (r) => chipOf(r) === 'Live',
    '09-saved-fallback': (r) => chipOf(r) === 'Showing saved version',
    // Gate on the OBSERVABLE binding (which viewpoint ended up bound), not on
    // which identity field this X_ITE build exposes: user-viewpoint nodes may
    // not answer a DEF name, in which case the description tier carries it.
    '10-viewpoint-preserved': (r) => {
      const b = worldOf(r).boundViewpoint || {};
      return chipOf(r) === 'Live' && (b.name === 'Above' || (b.description === 'Overview' && b.index === 1));
    },
    '11-viewpoint-fallback': (r) => {
      const b = worldOf(r).boundViewpoint || {};
      return chipOf(r) === 'Live' && (b.name === 'Entry' || (b.description === 'Front door' && b.index === 0));
    },
    '12-nav-preserved': (r) => chipOf(r) === 'Live' && worldOf(r).navChoice === 'WALK',
    '13-newref-blocked': (r) => chipOf(r) === 'New file reference found — choose Find new files' && r.preview.newRefs >= 1,
    '14-find-new-files': (r) => chipOf(r) === 'Live' && r.preview.newRefs === 0,
    '15-findings-blocked': (r) => {
      const b = worldOf(r).buffer || {};
      return (b.missingRefs || []).length >= 1 && (b.caseRefs || []).length >= 1
        && (b.remoteRefs || []).length >= 1 && (b.unsafeRefs || []).length >= 1;
    },
    '16-preview-max': (r) => r.preview.layout === 'preview-max',
    '17-editor-only': (r) => r.preview.layout === 'editor-only',
    '18-contrast-zoom': (r) => chipOf(r) === 'Live',
    '19-seventy-textures': (r) => chipOf(r) === 'Live' && ((worldOf(r).counts || {}).uniqueTextures || 0) >= 70,
    '20-nested-gzip': (r) => chipOf(r) === 'Live' && ((worldOf(r).counts || {}).wrlFiles || 0) >= 3 && worldOf(r).haveValidScene,
    '21-leak-after-close': (r) => r.leak && r.leak.size === 0 && r.leak.activeGenerations === 0,
    '22-project-switch-cleanup': (r) => chipOf(r) === 'Live' && r.leak && r.leak.size === 0 && r.leak.activeGenerations === 0,
  };

  const log = [];
  const runner = new VisualQaRunner({
    spawn: () => realSpawn(transport.env),
    ...transport.runnerOpts,
    maxLaunches: 2,
    retriesPerLaunch: 1,
    captureTimeoutMs: 90000,
    log: (rec) => { log.push(rec); process.stdout.write(JSON.stringify(rec) + '\n'); },
  });

  const release = acquire();
  let results = [];
  let failed = false;
  let runError = null;
  try {
    results = await runner.run(jobs);
  } catch (err) {
    failed = true;
    runError = String((err && err.message) || err);
    process.stdout.write(JSON.stringify({ event: 'error', code: err.code, message: runError }) + '\n');
  } finally {
    release();
    transport.cleanup();
  }

  const survivors = runner.survivors();
  if (survivors.length) failed = true;

  const gates = [];
  for (const r of results) {
    const gate = EXPECT[r.id];
    let ok = false, err = null;
    try { ok = !!(gate && r.preview && gate(r)); } catch (e) { err = String(e && e.message); }
    if (!ok) failed = true;
    gates.push({ id: r.id, ok, err });
  }
  if (results.length !== jobs.length) failed = true;

  const launchEvents = log.filter((l) => l.event === 'launch');
  const report = {
    launchCount: launchEvents.length,
    launchesUsed: runner.launchesUsed,
    pids: launchEvents.map((l) => l.pid),
    captureCount: results.length,
    retries: log.filter((l) => l.event === 'retry:scheduled').length,
    exitEvents: log.filter((l) => l.event === 'exit').map((l) => ({ pid: l.pid, code: l.code, graceful: l.graceful })),
    survivors,
    runError,
    gates,
    perState: results.map((r) => ({ id: r.id, out: r.out, preview: r.preview || null, leak: r.leak || null })),
  };
  fs.writeFileSync(path.join(__dirname, 'RESULTS.json'), JSON.stringify(report, null, 2));

  // Best-effort scratch cleanup (all under the OS temp dir).
  for (const d of scratch) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

  console.log('\n=== Phase 7C3 (World unsaved-buffer preview) visual QA ===');
  console.log(`launches: ${report.launchesUsed} · pids: ${report.pids.join(',')} · captures: ${results.length}/${jobs.length} · survivors: ${survivors.length} · runError: ${runError || 'none'}`);
  for (const g of gates) {
    const r = results.find((x) => x.id === g.id) || {};
    console.log(`  ${g.ok ? 'OK ' : 'FAIL'} ${g.id} [${chipOf(r)}]${g.err ? ' err=' + g.err : ''}`);
  }
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
