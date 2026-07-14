'use strict';
// Feature A (Vision Accommodations) visual-QA orchestrator.
//
// Drives the required vision states -- High Contrast theme, the full zoom range,
// scaled chrome (toolbar/status bar/panels), a scaled modal, and zoom
// persistence across a renderer reload -- through ONE reused Electron
// capture-server process via VisualQaRunner (concurrency 1, launch cap, cooldown,
// timeouts, graceful teardown, PID tracking, leak check). No per-screenshot
// launches, no pkill/killall -- the same sanctioned harness the 7B run uses.
//
//   node qa/phase-7c-vision/orchestrate.js
//
// Every source the editor opens is a SCRATCH file staged in the OS temp dir; the
// capture server refuses any editor target outside temp. PNGs + per-state editor
// status go to ./screenshots + ./RESULTS.json. Scratch is cleaned up after.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { VisualQaRunner } = require('../visual-qa/runner');
const { acquire } = require('../visual-qa/lock');

const repoRoot = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'screenshots');
const SIZE = '1200x820';

// A document with both an outline (DEF nodes) AND a syntax diagnostic (the
// unclosed Box), so the sidebar's Outline and Diagnostics panels both populate
// and their scaling is visible.
const PANELS =
  '#VRML V2.0 utf8\n' +
  'WorldInfo { title "Vision Scratch" }\n' +
  'DEF Root Transform {\n' +
  '  children [\n' +
  '    DEF Body Shape { appearance Appearance { material Material { diffuseColor 1 0 0 } } geometry Box { size 2 2 2 } }\n' +
  '    DEF Ball Shape { geometry Sphere { radius 1 } }\n' +
  '  ]\n' +
  '}\n' +
  'Shape { geometry Box { size 2 2\n'; // unclosed -> a diagnostic

function stageMall(name, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-visionqa-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, text, 'utf8');
  return p;
}

function realSpawn() {
  return spawn(require('electron'), ['.', '--no-sandbox'], {
    cwd: repoRoot,
    env: { ...process.env, WRL_FORGE_CAPTURE_SERVER: '1', WRL_FORGE_NO_EDITOR: '1', WRL_FORGE_SETTLE_MS: '900' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

function png(name) { return path.join(OUT, name + '.png'); }

async function main() {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    console.error('phase-7c-vision: no DISPLAY/WAYLAND_DISPLAY -- refusing to launch Electron headless-blind.');
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const doc = stageMall('vision.wrl', PANELS);
  const mall = (extra) => ({ context: 'mall', mallPath: doc, ...extra });

  // ZOOM_MIN=-3, ZOOM_MAX=8 (mirror of src/editor/ui-state.js).
  const jobs = [
    { id: '01-dark-default', editor: mall({ theme: 'dark', zoom: 0 }), size: SIZE, out: png('01-dark-default') },
    { id: '02-contrast-default', editor: mall({ theme: 'contrast', zoom: 0 }), size: SIZE, out: png('02-contrast-default') },
    { id: '03-contrast-max', editor: mall({ theme: 'contrast', zoom: 8 }), size: SIZE, out: png('03-contrast-max-zoom') },
    { id: '04-zoom-min', editor: mall({ theme: 'dark', zoom: -3 }), size: SIZE, out: png('04-zoom-min') },
    { id: '05-zoom-mid', editor: mall({ theme: 'dark', zoom: 4 }), size: SIZE, out: png('05-zoom-mid') },
    { id: '06-chrome-and-panels', editor: mall({ theme: 'dark', zoom: 5 }), size: SIZE, out: png('06-chrome-and-panels-scaled') },
    { id: '07-modal-enlarged', editor: mall({ theme: 'dark', zoom: 5, step: 'modal' }), size: SIZE, out: png('07-modal-enlarged') },
    { id: '08-persist-set', editor: mall({ theme: 'dark', zoom: 5 }), size: SIZE, out: png('08-persist-set') },
    // No zoom directive: on the fresh page load, init() reapplies the PERSISTED
    // zoom (5) from localStorage -> proves persistence across a renderer reload.
    { id: '09-persist-after-reload', editor: mall({ theme: 'dark' }), size: SIZE, out: png('09-persist-after-reload') },
  ];

  const log = [];
  const runner = new VisualQaRunner({
    spawn: realSpawn,
    maxLaunches: 2,
    retriesPerLaunch: 1,
    captureTimeoutMs: 45000,
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
    perState: results.map((r) => ({ id: r.id, out: r.out, editor: r.editor || null })),
  };
  fs.writeFileSync(path.join(__dirname, 'RESULTS.json'), JSON.stringify(report, null, 2));

  // Best-effort scratch cleanup (all under the OS temp dir).
  try { fs.rmSync(path.dirname(doc), { recursive: true, force: true }); } catch { /* ignore */ }

  console.log('\n=== Feature A (Vision Accommodations) visual QA ===');
  console.log(`launches: ${report.launchesUsed} · pids: ${report.pids.join(',')} · captures: ${results.length}/${jobs.length} · survivors: ${survivors.length} · runError: ${runError || 'none'}`);
  for (const r of report.perState) {
    console.log(`  ${r.out ? 'OK ' : '?? '} ${r.id}` + (r.editor ? ` — ${JSON.stringify(r.editor)}` : ''));
  }
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
