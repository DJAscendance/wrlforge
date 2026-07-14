'use strict';
// Phase 7C2 (Mall unsaved-buffer live preview) visual-QA orchestrator.
//
// Drives the required live-preview states -- 50/50 split, unsaved Original + Fit
// renders, auto-update after an edit, manual Update, last-valid retention through
// a temporary syntax error, recovery, saved-version fallback, preview-maximized,
// editor-only, a moved divider, High Contrast at zoom, local-texture resolution,
// remote-texture blocking, the large-file manual state, and the overlay/generation
// leak check after close -- through ONE reused Electron capture-server process via
// VisualQaRunner (concurrency 1, launch cap, cooldown, timeouts, PID tracking,
// zero-survivor teardown). No per-screenshot launches, no pkill/killall.
//
//   node qa/phase-7c-mall-preview/orchestrate.js
//
// Every source the editor opens is a SCRATCH file under the OS temp dir; the
// capture server refuses any editor target outside temp, never mutates a fixture,
// and writes no .edit.wrl / temporary preview WRL. PNGs + per-state preview status
// go to ./screenshots + ./RESULTS.json. Scratch is cleaned up after.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { VisualQaRunner } = require('../visual-qa/runner');
const { acquire } = require('../visual-qa/lock');

const repoRoot = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'screenshots');
const SIZE = '1280x860';

const HEADER = '#VRML V2.0 utf8\n';
const CUBE =
  HEADER +
  'WorldInfo { title "Preview Scratch" }\n' +
  'DEF Root Transform { children [\n' +
  '  DEF Body Shape { appearance Appearance { material Material { diffuseColor 1 0.3 0.2 } } geometry Box { size 2 2 2 } }\n' +
  '] }\n';
const CUBE_EDIT =
  HEADER +
  'WorldInfo { title "Preview Scratch" }\n' +
  'DEF Root Transform { children [\n' +
  '  DEF Body Shape { appearance Appearance { material Material { diffuseColor 0.2 0.8 1 } } geometry Sphere { radius 1.4 } }\n' +
  '] }\n';
const BROKEN = HEADER + 'Shape { geometry Box { size 2 2\n'; // unterminated -> X_ITE rejects
const TEXTURED =
  HEADER +
  'Shape {\n' +
  '  appearance Appearance { texture ImageTexture { url "wood.png" } }\n' +
  '  geometry Box { size 2 2 2 }\n' +
  '}\n';
const REMOTE =
  HEADER +
  'Shape {\n' +
  '  appearance Appearance { texture ImageTexture { url "http://example.com/remote.png" } }\n' +
  '  geometry Box { size 2 2 2 }\n' +
  '}\n';
// A >1 MiB source: real geometry + a big trailing comment block so it parses but
// exceeds the 1 MiB auto-refresh threshold (manual-Update only).
const LARGE = CUBE + '\n#' + 'x'.repeat(1024 * 1024 + 4096) + '\n';

// A 1x1 transparent PNG so the textured item's relative texture resolves from the
// SOURCE directory exactly as the on-disk preview would.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function stage(name, text, extraFiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-mallpreviewqa-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, text, 'utf8');
  if (extraFiles) for (const [fn, buf] of Object.entries(extraFiles)) fs.writeFileSync(path.join(dir, fn), buf);
  return p;
}

function realSpawn() {
  return spawn(require('electron'), ['.', '--no-sandbox'], {
    cwd: repoRoot,
    env: { ...process.env, WRL_FORGE_CAPTURE_SERVER: '1', WRL_FORGE_NO_EDITOR: '1', WRL_FORGE_SETTLE_MS: '1300' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

function png(name) { return path.join(OUT, name + '.png'); }

async function main() {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    console.error('phase-7c-mall-preview: no DISPLAY/WAYLAND_DISPLAY -- refusing to launch Electron headless-blind.');
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const cube = stage('item.wrl', CUBE);
  const textured = stage('textured.wrl', TEXTURED, { 'wood.png': PNG_1x1 });
  const remote = stage('remote.wrl', REMOTE);
  const large = stage('large.wrl', LARGE);
  const scratchDirs = [cube, textured, remote, large].map((p) => path.dirname(p));

  const mall = (docPath, extra) => ({ context: 'mall', mallPath: docPath, ...extra });

  const jobs = [
    { id: '01-split-5050', editor: mall(cube, { previewLayout: 'split' }), size: SIZE, out: png('01-split-5050') },
    { id: '02-unsaved-original', editor: mall(cube, { fitMode: 'original' }), size: SIZE, out: png('02-unsaved-original') },
    { id: '03-unsaved-fit', editor: mall(cube, { fitMode: 'fit' }), size: SIZE, out: png('03-unsaved-fit') },
    { id: '04-auto-update-after-edit', editor: mall(cube, { step: 'type', text: CUBE_EDIT }), size: SIZE, out: png('04-auto-update-after-edit') },
    { id: '05-manual-update', editor: mall(cube, { step: 'type', text: CUBE_EDIT, previewStep: 'update' }), size: SIZE, out: png('05-manual-update') },
    { id: '06-updating', editor: mall(cube, { step: 'type', text: CUBE_EDIT }), size: SIZE, out: png('06-updating') },
    { id: '07-outdated-large', editor: mall(large, { step: 'type', text: LARGE + '\n#more\n' }), size: SIZE, out: png('07-outdated-large') },
    { id: '08-syntax-error-lastvalid', editor: mall(cube, { step: 'type', text: CUBE, text2: BROKEN }), size: SIZE, out: png('08-syntax-error-lastvalid') },
    { id: '09-recovery', editor: mall(cube, { step: 'type', text: BROKEN, text2: CUBE_EDIT }), size: SIZE, out: png('09-recovery') },
    { id: '10-saved-fallback', editor: mall(cube, { step: 'type', text: CUBE_EDIT, previewStep: 'saved' }), size: SIZE, out: png('10-saved-fallback') },
    { id: '11-preview-max', editor: mall(cube, { previewLayout: 'preview-max' }), size: SIZE, out: png('11-preview-max') },
    { id: '12-editor-only', editor: mall(cube, { previewLayout: 'editor-only' }), size: SIZE, out: png('12-editor-only') },
    // A persisted 'editor-only' layout (job 12) sticks across reloads by design, so
    // jobs that must show the preview reset the layout to 'split' explicitly.
    { id: '13-divider-moved', editor: mall(cube, { previewLayout: 'split', previewStepSplit: -0.15 }), size: SIZE, out: png('13-divider-moved') },
    { id: '14-contrast-zoom', editor: mall(cube, { previewLayout: 'split', theme: 'contrast', zoom: 4 }), size: SIZE, out: png('14-contrast-zoom') },
    { id: '15-local-texture', editor: mall(textured, { previewLayout: 'split', previewStep: 'update' }), size: SIZE, out: png('15-local-texture') },
    { id: '16-remote-blocked', editor: mall(remote, { previewLayout: 'split', previewStep: 'update' }), size: SIZE, out: png('16-remote-blocked') },
    { id: '17-large-manual', editor: mall(large, { previewLayout: 'split', previewStep: 'update' }), size: SIZE, out: png('17-large-manual') },
    { id: '18-leak-after-close', editor: mall(cube, { previewLayout: 'split', step: 'type', text: CUBE_EDIT, leakAfterClose: true }), size: SIZE, out: png('18-leak-after-close') },
  ];

  const log = [];
  const runner = new VisualQaRunner({
    spawn: realSpawn,
    maxLaunches: 2,
    retriesPerLaunch: 1,
    captureTimeoutMs: 60000,
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
  }

  const survivors = runner.survivors();
  if (survivors.length) failed = true;

  // The leak job must report zero overlays/generations after close.
  const leakJob = results.find((r) => r.id === '18-leak-after-close');
  const leak = leakJob && leakJob.leak;
  const leakOk = !!leak && leak.size === 0 && leak.activeGenerations === 0;
  if (leakJob && !leakOk) failed = true;

  const launchEvents = log.filter((l) => l.event === 'launch');
  const report = {
    launchCount: launchEvents.length,
    launchesUsed: runner.launchesUsed,
    pids: launchEvents.map((l) => l.pid),
    captureCount: jobs.filter((j) => j.out).length,
    retries: log.filter((l) => l.event === 'retry:scheduled').length,
    exitEvents: log.filter((l) => l.event === 'exit').map((l) => ({ pid: l.pid, code: l.code, graceful: l.graceful })),
    survivors,
    runError,
    leak: leak || null,
    leakOk,
    perState: results.map((r) => ({ id: r.id, out: r.out, preview: r.preview || null, editor: r.editor || null, leak: r.leak || null })),
  };
  fs.writeFileSync(path.join(__dirname, 'RESULTS.json'), JSON.stringify(report, null, 2));

  // Best-effort scratch cleanup (all under the OS temp dir).
  for (const d of scratchDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

  console.log('\n=== Phase 7C2 (Mall unsaved-buffer preview) visual QA ===');
  console.log(`launches: ${report.launchesUsed} · pids: ${report.pids.join(',')} · captures: ${results.length}/${jobs.length} · survivors: ${survivors.length} · leakOk: ${leakOk} · runError: ${runError || 'none'}`);
  for (const r of report.perState) {
    const chip = r.preview && r.preview.chip ? ` [${r.preview.chip}]` : '';
    console.log(`  ${r.out ? 'OK ' : '?? '} ${r.id}${chip}`);
  }
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
