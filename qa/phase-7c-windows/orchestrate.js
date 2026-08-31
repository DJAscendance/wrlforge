'use strict';
// Phase 7C4 Windows QA orchestrator: drives Tier 1 (packed self-test) and
// Tier 2 (visual QA via VisualQaRunner) against a chosen target, then writes
// a single evidence run directory per docs/WINDOWS_NATIVE_QA_PLAN.md Sec.8.
//
// Tier 3 (installer/uninstall/Start-Menu/SmartScreen smoke) stays PowerShell-
// only and maintainer-run (plan Sec.4/Sec.13) -- see tier3-smoke.ps1 in this
// directory. This orchestrator does not invoke it.
//
//   node qa/phase-7c-windows/orchestrate.js --jobs=<jobs.json> --out=<evidenceDir>
//     [--target=source|win-unpacked|portable|installed] [--exe=<path>]
//     [--skip-tier1] [--fixtures=<dir>[,<dir>...]] [--max=N] [--cooldown=MS] [--retries=N]
//     [--allow-headed]
//
// Exit code is non-zero if Tier 1 or Tier 2 failed, any tracked pid survived,
// or a committed fixture hash changed under the run -- any one of those means
// the evidence directory must not be ingested as a passing run (plan Sec.3, Sec.8).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { VisualQaRunner } = require('../visual-qa/runner');
const { parseArgs, checkSessionPresent, resolveExeForTarget, realSpawn } = require('../visual-qa/cli');
const { makeCaptureTransport } = require('../visual-qa/transport');
const { acquire } = require('../visual-qa/lock');
const evidence = require('../visual-qa/evidence');
const { guardWindowsWorkspace } = require('../visual-qa/workspace-guard');
const { readJsonFile } = require('../visual-qa/json-file');

const repoRoot = path.join(__dirname, '..', '..');

function electronBinaryForTarget(target, exe) {
  if (target === 'source' || !target) return require('electron');
  return exe || resolveExeForTarget(target, repoRoot);
}

// Runs the existing committed self-test (qa/phase-6b-windows/win-selftest.js)
// as node under the given Electron binary (dev Electron, win-unpacked,
// portable, or installed .exe -- ELECTRON_RUN_AS_NODE makes all of them behave
// like `node win-selftest.js`). No window opens.
function runTier1(electronBinary, outDir) {
  const outJson = path.join(outDir, 'tier1-selftest-result.json');
  const selftest = path.join(repoRoot, 'qa', 'phase-6b-windows', 'win-selftest.js');
  let stdout = '';
  let ok = true;
  try {
    stdout = execFileSync(electronBinary, [selftest, '--out', outJson], {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
    });
  } catch (err) {
    ok = false;
    stdout = String(err.stdout || '') + String(err.stderr || '') + String(err.message || err);
  }
  fs.writeFileSync(path.join(outDir, 'tier1-console.txt'), stdout);
  let result = null;
  try { result = readJsonFile(outJson); } catch { /* selftest didn't produce JSON */ }
  return { ok: ok && !!result && !result.failed, resultPath: outJson, result };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Refuse UNC / network-drive / host-share workspaces on Windows before any
  // packed self-test, spawn, or evidence write touches node_modules or fixtures.
  guardWindowsWorkspace({ cwd: repoRoot, label: 'qa:windows' });
  checkSessionPresent(args);

  const jobsFile = args.flags.jobs;
  const outDir = args.flags.out;
  if (!jobsFile || !outDir) {
    console.error('usage: node qa/phase-7c-windows/orchestrate.js --jobs=<jobs.json> --out=<evidenceDir> '
      + '[--target=source|win-unpacked|portable|installed] [--exe=<path>] [--skip-tier1] '
      + '[--fixtures=<dir>[,<dir>...]] [--max=N] [--cooldown=MS] [--retries=N] [--allow-headed]');
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const target = args.flags.target || 'source';
  const fixtureRoots = args.flags.fixtures
    ? args.flags.fixtures.split(',')
    : [path.join(repoRoot, 'test', 'fixtures')];

  const processesBefore = evidence.snapshotProcesses();
  const fixtureHashesBefore = evidence.hashFixtures(fixtureRoots);

  let tier1 = null;
  if (!args.flags['skip-tier1']) {
    const electronBinary = electronBinaryForTarget(target, args.flags.exe);
    if (electronBinary) tier1 = runTier1(electronBinary, outDir);
  }

  const jobs = readJsonFile(jobsFile);
  const release = acquire();
  // Platform-aware transport: on Windows a GUI-subsystem electron.exe has an
  // immediately-ended stdin, so jobs go through a file, not stdin (Phase 7C5).
  const transport = makeCaptureTransport();
  const runnerOpts = {
    spawn: () => realSpawn(args, transport.env),
    log: (rec) => process.stdout.write(JSON.stringify(rec) + '\n'),
    ...transport.runnerOpts,
  };
  if (args.flags.max) runnerOpts.maxLaunches = Number(args.flags.max);
  if (args.flags.cooldown) runnerOpts.cooldownMs = Number(args.flags.cooldown);
  if (args.flags.retries) runnerOpts.retriesPerLaunch = Number(args.flags.retries);
  const runner = new VisualQaRunner(runnerOpts);

  let tier2Results = null;
  let tier2Error = null;
  try {
    tier2Results = await runner.run(jobs);
  } catch (err) {
    tier2Error = { code: err.code, message: String(err.message || err) };
  } finally {
    release();
    transport.cleanup();
  }

  const survivors = runner.survivors();
  const processesAfter = evidence.snapshotProcesses();
  const fixtureHashesAfter = evidence.hashFixtures(fixtureRoots);
  const environment = evidence.captureEnvironment({ repoRoot, target, exe: args.flags.exe || null });

  const failed = !!tier2Error || survivors.length > 0 || (tier1 !== null && !tier1.ok);
  const results = { launchesUsed: runner.launchesUsed, tier1, tier2: tier2Results, tier2Error, survivors, failed };

  const { verdict, fixtureChanges } = evidence.writeRunEvidence(outDir, {
    title: `Windows Visual QA -- target=${target}`,
    environment,
    results,
    processesBefore,
    processesAfter,
    fixtureHashesBefore,
    fixtureHashesAfter,
  });

  console.log(`[qa:windows] verdict=${verdict} evidence=${outDir}`);
  if (fixtureChanges.length) console.error('[qa:windows] FIXTURE MUTATION DETECTED -- do not ingest this run.');
  process.exit(verdict === 'GO' ? 0 : 1);
}

if (require.main === module) main();

module.exports = { runTier1, electronBinaryForTarget };
