'use strict';
// Phase 7B1 focused visual pass — passive-launch closeout.
//
// Proves, through ONE reused Electron capture-server process (VisualQaRunner,
// concurrency 1, launch cap, leak check — the SAME sanctioned harness as every
// other run; no per-screenshot launches, no pkill/killall), that:
//
//   01  Opening a Mall .wrl loads the workspace normally with NO external-editor
//       launch and NO "editor not found" banner (the banner is gated to the
//       explicit action). Spawned with WRL_FORGE_NO_EDITOR=1, so even the launcher
//       is inert here — and the production code no longer calls it on open at all
//       (see src/editor/mall-edit-flow.js + test/editor/mall-edit-flow.test.js).
//   02  The native editor is opened EXPLICITLY (an explicit user action).
//   03  The external editor is requested EXPLICITLY (the only path that launches it).
//
// The deterministic proof that open never launches / native editing never writes a
// .edit.wrl / the not-found banner is explicit-only lives in the unit + product-
// posture tests; these captures confirm the GUI states around those behaviors and
// that serialized single-process execution stays leak-free.
//
//   node qa/phase-7b1-native-closeout/orchestrate.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { VisualQaRunner } = require('../visual-qa/runner');
const { acquire } = require('../visual-qa/lock');

const repoRoot = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'screenshots');
const SIZE = '1200x820';

const RICH =
  '#VRML V2.0 utf8\n' +
  'WorldInfo { title "Scratch Item" }\n' +
  'DEF Root Transform {\n' +
  '  children [\n' +
  '    DEF Body Shape { appearance Appearance { material Material { diffuseColor 1 0 0 } } geometry Box { size 2 2 2 } }\n' +
  '    Shape { geometry Sphere { radius 1 } }\n' +
  '  ]\n' +
  '}\n';

function stageMall(name, text, gzip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-p7b1-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, gzip ? zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 }) : text);
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
    console.error('phase-7b1: no DISPLAY/WAYLAND_DISPLAY -- refusing to launch Electron headless-blind.');
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const mall = stageMall('item.wrl', RICH, false);

  const jobs = [
    // Mall workspace after a REAL passive open (openMallPath -> openMallFile).
    { id: '01-mall-open-passive', fixture: mall, size: SIZE, out: png('01-mall-open-passive') },
    // Native editor opened EXPLICITLY on the same item.
    { id: '02-native-editor-explicit', editor: { context: 'mall', mallPath: mall }, size: SIZE, out: png('02-native-editor-explicit') },
    // External editor requested EXPLICITLY (the editor page "Open in External Editor").
    { id: '03-external-editor-explicit', editor: { context: 'mall', mallPath: mall, step: 'external' }, size: SIZE, out: png('03-external-editor-explicit') },
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
    survivors,
    runError,
    perState: results.map((r) => ({ id: r.id, out: r.out, editor: r.editor || null })),
  };
  fs.writeFileSync(path.join(__dirname, 'RESULTS.json'), JSON.stringify(report, null, 2));

  try { fs.rmSync(path.dirname(mall), { recursive: true, force: true }); } catch { /* ignore */ }

  console.log('\n=== Phase 7B1 passive-launch closeout visual QA ===');
  console.log(`launches: ${report.launchesUsed} · pids: ${report.pids.join(',')} · captures: ${results.length}/${jobs.length} · survivors: ${survivors.length} · runError: ${runError || 'none'}`);
  for (const r of report.perState) {
    console.log(`  ${r.out ? 'OK ' : '?? '} ${r.id}` + (r.editor ? ` — ${JSON.stringify(r.editor)}` : ''));
  }
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
