'use strict';
// Phase 5A World Packaging visual-QA orchestrator.
//
// Drives the packaging-audit UI states through ONE reused Electron capture-server
// process via VisualQaRunner (concurrency 1, launch cap, cooldown, timeouts,
// graceful teardown, PID tracking, leak check) -- the SAME sanctioned harness the
// Mall/World visual tests use. No per-screenshot launches, no pkill/killall, no
// external screenshot loops.
//
//   node qa/phase-5a-world-packaging/orchestrate.js
//
// States captured (one launch, in order):
//   1. ready       -- a clean world (nested): status READY, totals, manifest
//   2. seventy     -- 71-texture world (valid70): >70 textures packaged
//   3. needs-review-- unused-file world (unused): unused files reported, not packaged
//   4. cycle       -- bounded dependency cycle (cycle): safe, not blocking
//   5. blocked     -- broken world: missing/case/unsafe/remote block packaging
//   6. build       -- an ACTUAL deterministic bundle build for the clean world,
//                     written ONLY to the OS temp dir (never a real destination,
//                     never inside the project), then the output location shown.
//   7. narrow      -- packaging section reflow at a narrow width
//
// Read-only against the committed fixtures (the only write is the QA bundle into
// the OS temp dir). Writes PNGs + per-state audit debug into ./screenshots +
// ./RESULTS.json and prints a lifecycle report.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { VisualQaRunner } = require('../visual-qa/runner');
const { acquire } = require('../visual-qa/lock');

const repoRoot = path.join(__dirname, '..', '..');
const FX = path.join(repoRoot, 'test', 'fixtures', 'world');
const OUT = path.join(__dirname, 'screenshots');
const SIZE = '1100x860';
const NARROW = '720x900';

function fixture(proj, primary) {
  return { root: path.join(FX, proj), primary: path.join(FX, proj, primary || 'world.wrl') };
}

function realSpawn() {
  return spawn(require('electron'), ['.', '--no-sandbox'], {
    cwd: repoRoot,
    env: { ...process.env, WRL_FORGE_CAPTURE_SERVER: '1', WRL_FORGE_NO_EDITOR: '1', WRL_FORGE_SETTLE_MS: '1600' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

async function main() {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    console.error('phase-5a: no DISPLAY/WAYLAND_DISPLAY -- refusing to launch Electron headless-blind.');
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-p5a-'));
  const bundleDest = path.join(tmp, 'nested-review-bundle.zip');

  const jobs = [
    { id: '1-ready', world: fixture('nested'), packageAudit: true, size: SIZE, out: path.join(OUT, '1-ready.png') },
    { id: '2-seventy', world: fixture('valid70'), packageAudit: true, size: SIZE, out: path.join(OUT, '2-seventy-textures.png') },
    { id: '3-needs-review', world: fixture('unused'), packageAudit: true, size: SIZE, out: path.join(OUT, '3-needs-review-unused.png') },
    { id: '4-cycle', world: fixture('cycle', 'a.wrl'), packageAudit: true, size: SIZE, out: path.join(OUT, '4-cycle-safe.png') },
    { id: '5-blocked', world: fixture('broken'), packageAudit: true, size: SIZE, out: path.join(OUT, '5-blocked.png') },
    { id: '6-build', world: fixture('nested'), buildBundle: bundleDest, size: SIZE, out: path.join(OUT, '6-bundle-built.png') },
    { id: '7-narrow', world: fixture('nested'), packageAudit: true, size: NARROW, out: path.join(OUT, '7-narrow-layout.png') },
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
    fixtureCount: jobs.filter((j) => j.world).length,
    captureCount: jobs.filter((j) => j.out).length,
    retries: log.filter((l) => l.event === 'retry:scheduled').length,
    exitEvents: log.filter((l) => l.event === 'exit').map((l) => ({ pid: l.pid, code: l.code, graceful: l.graceful })),
    leakChecks: log.filter((l) => l.event === 'leak:check'),
    survivors,
    runError,
    bundleDest,
    perState: results.map((r) => ({ id: r.id, out: r.out, packageAudit: r.packageAudit || null, bundle: r.bundle ? { outPath: r.bundle.outPath, bytes: r.bundle.bytes, entryCount: r.bundle.entryCount } : null, bundleError: r.bundleError || null })),
  };
  fs.writeFileSync(path.join(__dirname, 'RESULTS.json'), JSON.stringify(report, null, 2));

  // Best-effort scratch cleanup (under the OS temp dir).
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

  process.stdout.write(JSON.stringify({ event: 'phase-5a-report', ...report }) + '\n');
  process.exit(failed ? 1 : 0);
}

main();
