'use strict';
// Phase 4B World Preview visual-QA orchestrator.
//
// Drives the 10 required World-preview states through ONE reused Electron
// capture-server process via VisualQaRunner (concurrency 1, launch cap, cooldown,
// timeouts, graceful teardown, PID tracking, leak check). This is the SAME
// sanctioned harness the Mall visual test uses -- no per-fixture/per-screenshot
// launches, no pkill/killall, no external screenshot loops.
//
//   node qa/phase-4b-world-preview/orchestrate.js
//
// It stages a scratch project in the OS temp dir (for the parse-fail -> recover
// sequence, whose bytes are swapped between jobs by the capture-server's QA-only
// scratch write -- never a real project file), runs the jobs, writes PNGs +
// per-state preview debug into ./screenshots + ./RESULTS.json, and prints a
// lifecycle report (launch count, PID, fixture/capture counts, retries, exit
// code, leak result). Read-only against the committed fixtures.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { VisualQaRunner } = require('../visual-qa/runner');
const { acquire } = require('../visual-qa/lock');

const repoRoot = path.join(__dirname, '..', '..');
const FX = path.join(repoRoot, 'test', 'fixtures', 'world');
const OUT = path.join(__dirname, 'screenshots');
const SIZE = '1100x820';
const NARROW = '720x900';

function fixture(proj, primary) {
  return { root: path.join(FX, proj), primary: path.join(FX, proj, primary || 'world.wrl') };
}

// --- scratch project for the parse-fail -> recover sequence --------------------
function stageScratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-p4b-'));
  fs.mkdirSync(path.join(dir, 'img'), { recursive: true });
  // a 1x1 PNG (reuse a committed one)
  fs.copyFileSync(path.join(FX, 'small', 'img', 'floor.png'), path.join(dir, 'img', 'tile.png'));
  return { dir, primary: path.join(dir, 'world.wrl') };
}
const GOOD_WORLD =
  '#VRML V2.0 utf8\nWorldInfo { title "Scratch World" }\n' +
  'Viewpoint { description "Scratch" position 0 1 8 }\n' +
  'Shape { appearance Appearance { texture ImageTexture { url "img/tile.png" } } geometry Box { size 5 3 5 } }\n';
const BROKEN_WORLD =
  '#VRML V2.0 utf8\nWorldInfo { title "Scratch World" }\n' +
  'Shape { appearance Appearance {{{{ this is not valid VRML at all >>>\n';

function realSpawn() {
  return spawn(require('electron'), ['.', '--no-sandbox'], {
    cwd: repoRoot,
    env: { ...process.env, WRL_FORGE_CAPTURE_SERVER: '1', WRL_FORGE_NO_EDITOR: '1', WRL_FORGE_SETTLE_MS: '1800' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

async function main() {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    console.error('phase-4b: no DISPLAY/WAYLAND_DISPLAY -- refusing to launch Electron headless-blind.');
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const scratch = stageScratch();

  // The 10 required states, each a world job in ONE process, in order.
  const jobs = [
    { id: '01-empty', world: null, size: SIZE, out: path.join(OUT, '01-empty-state.png') },
    { id: '02-small', world: fixture('small'), preview: true, size: SIZE, out: path.join(OUT, '02-small-world.png') },
    { id: '03-nested', world: fixture('nested'), preview: true, size: SIZE, out: path.join(OUT, '03-nested-inline.png') },
    { id: '04-gt20-tex', world: fixture('mini'), preview: true, size: SIZE, out: path.join(OUT, '04-more-than-20-textures.png') },
    { id: '05-seventy-tex', world: fixture('valid70'), preview: true, size: SIZE, out: path.join(OUT, '05-seventy-textures.png') },
    { id: '06-multi-vp', world: fixture('nested'), preview: true, viewpoint: 2, size: SIZE, out: path.join(OUT, '06-multiple-viewpoints.png') },
    { id: '07-missing-case', world: fixture('broken'), preview: true, size: SIZE, out: path.join(OUT, '07-missing-case-warnings.png') },
    { id: '08-remote-blocked', world: fixture('broken'), preview: true, size: SIZE, out: path.join(OUT, '08-remote-unsafe-blocked.png') },
    // parse fail -> recover on ONE scratch project (bytes swapped between jobs).
    { id: '09a-good', world: { ...scratch, root: scratch.dir, writePrimary: GOOD_WORLD }, preview: true, size: SIZE, out: path.join(OUT, '09a-scratch-good.png') },
    { id: '09b-parse-fail', world: { ...scratch, root: scratch.dir, writePrimary: BROKEN_WORLD }, preview: true, size: SIZE, out: path.join(OUT, '09b-parse-fail-keeps-last.png') },
    { id: '09c-recover', world: { ...scratch, root: scratch.dir, writePrimary: GOOD_WORLD }, preview: true, size: SIZE, out: path.join(OUT, '09c-recovered.png') },
    { id: '10-narrow', world: fixture('nested'), preview: true, size: NARROW, out: path.join(OUT, '10-narrow-layout.png') },
  ];
  // Fix scratch job shape (root/primary keys expected by the world job).
  for (const j of jobs) {
    if (j.world && j.world.dir) j.world = { root: j.world.dir, primary: j.world.primary, writePrimary: j.world.writePrimary };
  }

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

  // Lifecycle report.
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
    perState: results.map((r) => ({ id: r.id, out: r.out, preview: r.preview || null })),
  };
  fs.writeFileSync(path.join(__dirname, 'RESULTS.json'), JSON.stringify(report, null, 2));

  // Best-effort scratch cleanup (it is under the OS temp dir).
  try { fs.rmSync(scratch.dir, { recursive: true, force: true }); } catch { /* ignore */ }

  process.stdout.write(JSON.stringify({ event: 'phase-4b-report', ...report }) + '\n');
  process.exit(failed ? 1 : 0);
}

main();
