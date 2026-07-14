'use strict';
// Phase 7B Native Editor visual-QA orchestrator.
//
// Drives the required native-editor states through ONE reused Electron
// capture-server process via VisualQaRunner (concurrency 1, launch cap, cooldown,
// timeouts, graceful teardown, PID tracking, leak check) -- the SAME sanctioned
// harness the Mall/World runs use. No per-screenshot launches, no pkill/killall.
//
//   node qa/phase-7b-native-editor/orchestrate.js
//
// Every source the editor opens is a SCRATCH file staged in the OS temp dir; the
// capture server refuses any editor target outside temp. Saves and the staged
// external change all land on those scratch files -- never a real project. PNGs +
// per-state editor status go to ./screenshots + ./RESULTS.json.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { VisualQaRunner } = require('../visual-qa/runner');
const { acquire } = require('../visual-qa/lock');
const { makeCaptureTransport } = require('../visual-qa/transport');

const repoRoot = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'screenshots');
const SIZE = '1200x820';

// --- scratch fixtures (all under the OS temp dir) ---------------------------
const RICH =
  '#VRML V2.0 utf8\n' +
  'WorldInfo { title "Scratch Item" }\n' +
  'DEF Root Transform {\n' +
  '  children [\n' +
  '    DEF Body Shape { appearance Appearance { material Material { diffuseColor 1 0 0 } } geometry Box { size 2 2 2 } }\n' +
  '    Shape { geometry Sphere { radius 1 } }\n' +
  '  ]\n' +
  '}\n' +
  'ROUTE Root.translation TO Body.translation\n';

const WITH_ERRORS =
  '#VRML V2.0 utf8\n' +
  'Shape { geometry Box { size 2 2 \n' +
  'Group { children [ }\n';

const WITH_ADVISORY =
  '#VRML V2.0 utf8\n' +
  'DEF Dup Shape { geometry Box {} }\n' +
  'DEF Dup Shape { geometry Sphere {} }\n';

const WORLD_PRIMARY =
  '#VRML V2.0 utf8\n' +
  'WorldInfo { title "Scratch World" }\n' +
  'Viewpoint { position 0 1 8 }\n' +
  'Transform { children [ Inline { url "parts/inner.wrl" } Shape { geometry Box { size 5 3 5 } } ] }\n';

const WORLD_INNER =
  '#VRML V2.0 utf8\n' +
  'Shape { geometry Cone { bottomRadius 1 height 2 } }\n';

function stageMall(name, text, gzip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-p7b-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, gzip ? require('zlib').gzipSync(Buffer.from(text, 'utf8'), { level: 9 }) : text);
  return p;
}

function stageWorld() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-p7bw-'));
  fs.mkdirSync(path.join(dir, 'parts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'world.wrl'), WORLD_PRIMARY, 'utf8');
  const inner = path.join(dir, 'parts', 'inner.wrl');
  fs.writeFileSync(inner, WORLD_INNER, 'utf8');
  return { root: dir, primary: path.join(dir, 'world.wrl'), inner };
}

function realSpawn(extraEnv = {}) {
  return spawn(require('electron'), ['.', '--no-sandbox'], {
    cwd: repoRoot,
    env: { ...process.env, WRL_FORGE_CAPTURE_SERVER: '1', WRL_FORGE_NO_EDITOR: '1', WRL_FORGE_SETTLE_MS: '900', ...extraEnv },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

async function main() {
  if (process.platform !== 'win32' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    console.error('phase-7b: no DISPLAY/WAYLAND_DISPLAY -- refusing to launch Electron headless-blind.');
    process.exit(2);
  }
  const transport = makeCaptureTransport();
  fs.mkdirSync(OUT, { recursive: true });

  const mallPlain = stageMall('item.wrl', RICH, false);
  const mallGzip = stageMall('item.wrl', RICH, true);
  const mallErrors = stageMall('broken.wrl', WITH_ERRORS, false);
  const mallAdvisory = stageMall('advisory.wrl', WITH_ADVISORY, false);
  const mallDirty = stageMall('dirty.wrl', RICH, false);
  const mallSave = stageMall('save.wrl', RICH, false);
  const mallConflict = stageMall('conflict.wrl', RICH, false);
  const mallExternal = stageMall('external.wrl', RICH, false);
  const world = stageWorld();

  const jobs = [
    { id: '01-mall-plain', editor: { context: 'mall', mallPath: mallPlain }, size: SIZE, out: png('01-mall-plain') },
    { id: '02-mall-gzip', editor: { context: 'mall', mallPath: mallGzip }, size: SIZE, out: png('02-mall-gzip') },
    { id: '03-highlighting', editor: { context: 'mall', mallPath: mallPlain }, size: SIZE, out: png('03-highlighting') },
    { id: '04-diagnostic-nav', editor: { context: 'mall', mallPath: mallErrors, step: 'diagnostic' }, size: SIZE, out: png('04-diagnostic-nav') },
    { id: '05-advisories', editor: { context: 'mall', mallPath: mallAdvisory }, size: SIZE, out: png('05-advisories-separate') },
    { id: '06-dirty', editor: { context: 'mall', mallPath: mallDirty, step: 'type', text: RICH + '# edited\n' }, size: SIZE, out: png('06-dirty') },
    { id: '07-save', editor: { context: 'mall', mallPath: mallSave, step: 'save', text: RICH + '# saved\n' }, size: SIZE, out: png('07-save-success') },
    { id: '08-world-primary', editor: { context: 'world', root: world.root, primary: world.primary }, size: SIZE, out: png('08-world-primary') },
    { id: '09-nested-ref', editor: { context: 'world', root: world.root, primary: world.primary, ref: world.inner }, size: SIZE, out: png('09-nested-referenced') },
    { id: '10-outline-nav', editor: { context: 'mall', mallPath: mallPlain, step: 'outline' }, size: SIZE, out: png('10-outline-nav') },
    { id: '11-conflict', editor: { context: 'mall', mallPath: mallConflict, step: 'conflict', text: RICH + '# mine\n' }, size: SIZE, out: png('11-conflict-dialog') },
    { id: '12-external', editor: { context: 'mall', mallPath: mallExternal, step: 'external' }, size: SIZE, out: png('12-external-editor') },
    // Built-in themes (dark is the default shown above); each captured for contrast.
    { id: '13-theme-light', editor: { context: 'mall', mallPath: mallPlain, theme: 'light' }, size: SIZE, out: png('13-theme-light') },
    { id: '14-theme-terminal', editor: { context: 'mall', mallPath: mallPlain, theme: 'terminal' }, size: SIZE, out: png('14-theme-terminal') },
    { id: '15-theme-tokyo', editor: { context: 'mall', mallPath: mallPlain, theme: 'tokyo' }, size: SIZE, out: png('15-theme-tokyo') },
  ];

  const log = [];
  const runner = new VisualQaRunner({
    spawn: () => realSpawn(transport.env),
    ...transport.runnerOpts,
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
    transport.cleanup();
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
  for (const p of [mallPlain, mallGzip, mallErrors, mallAdvisory, mallDirty, mallSave, mallConflict, mallExternal]) {
    try { fs.rmSync(path.dirname(p), { recursive: true, force: true }); } catch { /* ignore */ }
  }
  try { fs.rmSync(world.root, { recursive: true, force: true }); } catch { /* ignore */ }

  console.log('\n=== Phase 7B Native Editor visual QA ===');
  console.log(`launches: ${report.launchesUsed} · pids: ${report.pids.join(',')} · captures: ${results.length}/${jobs.length} · survivors: ${survivors.length} · runError: ${runError || 'none'}`);
  for (const r of report.perState) {
    console.log(`  ${r.out ? 'OK ' : '?? '} ${r.id}` + (r.editor ? ` — ${JSON.stringify(r.editor)}` : ''));
  }
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
  process.exit(failed ? 1 : 0);
}

function png(name) { return path.join(OUT, name + '.png'); }

main().catch((err) => { console.error(err); process.exit(1); });
