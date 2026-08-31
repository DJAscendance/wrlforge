'use strict';
// The ONLY sanctioned entry point for a real WRL Forge visual-QA batch.
//
//   node qa/visual-qa/cli.js <jobs.json> [--max=N] [--cooldown=MS] [--retries=N]
//                                        [--target=source|win-unpacked|portable|installed]
//                                        [--exe=<path to WRL Forge.exe>] [--allow-headed]
//
// <jobs.json> is a JSON array of jobs:
//   [{ "id":"def-use", "fixture":"/abs/path.wrl", "mode":"fit",
//      "size":"900x600", "out":"/abs/out.png", "json":true }, ...]
//
// It acquires the single-instance lock, spawns exactly ONE Electron
// capture-server, drives every job through it, tears it down, verifies no
// process leaked, and emits one structured JSON log line per lifecycle event.
// Exit code is non-zero on any failure (timeout, cap, leak, job error) so CI /
// callers can gate on it. See docs/VISUAL_QA_SAFETY.md and
// docs/WINDOWS_NATIVE_QA_PLAN.md (Phase 7C4) for the Windows target/session flags.
//
// --target selects what gets spawned: 'source' (default) launches `electron .`
// exactly as before; 'win-unpacked'/'portable'/'installed' spawn a packaged
// build's exe directly (same WRL_FORGE_CAPTURE_SERVER stdin/stdout protocol,
// same stdio pipes -- only the launched binary differs). 'win-unpacked' and
// 'portable' resolve a default path under release/; 'installed' has no fixed
// default and always requires --exe.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { VisualQaRunner } = require('./runner');
const { acquire } = require('./lock');
const { guardWindowsWorkspace } = require('./workspace-guard');
const { makeCaptureTransport } = require('./transport');
const { readJsonFile } = require('./json-file');

const repoRoot = path.join(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) args.flags[m[1]] = m[2];
    else if (/^--[^=]+$/.test(a)) args.flags[a.slice(2)] = true; // boolean flag, e.g. --allow-headed
    else args.positional.push(a);
  }
  return args;
}

// No DISPLAY/WAYLAND_DISPLAY concept exists on Windows -- refusing to launch
// "headless-blind" there instead means requiring an explicit acknowledgment
// that an interactive session is present, since there's no env var to check.
function checkSessionPresent(args, platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    if (!args.flags['allow-headed']) {
      console.error('visual-qa: Windows has no DISPLAY/WAYLAND_DISPLAY concept -- pass --allow-headed to confirm an interactive session is present before launching Electron.');
      process.exit(2);
    }
    return;
  }
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) {
    console.error('visual-qa: no DISPLAY/WAYLAND_DISPLAY -- refusing to launch Electron headless-blind.');
    process.exit(2);
  }
}

// Default packaged-exe locations under release/ for the two build-once targets.
// 'installed' has no fixed default (install directory is user/version specific).
function resolveExeForTarget(target, root = repoRoot) {
  if (target === 'win-unpacked') {
    return path.join(root, 'release', 'win-unpacked', 'WRL Forge.exe');
  }
  if (target === 'portable') {
    const dir = path.join(root, 'release');
    if (!fs.existsSync(dir)) return null;
    const match = fs.readdirSync(dir).find((f) => /portable.*\.exe$/i.test(f));
    return match ? path.join(dir, match) : null;
  }
  return null;
}

function realSpawn(args, extraEnv = {}) {
  const target = args.flags.target || 'source';
  const env = {
    ...process.env,
    WRL_FORGE_CAPTURE_SERVER: '1',
    WRL_FORGE_NO_EDITOR: '1', // never spawn VSCodium per fixture during QA
    ...extraEnv, // e.g. WRL_FORGE_CAPTURE_JOBS_FILE on the Windows file transport
  };
  if (target === 'source') {
    const electronBinary = require('electron');
    return spawn(electronBinary, ['.', '--no-sandbox'], { cwd: repoRoot, env, stdio: ['pipe', 'pipe', 'inherit'] });
  }
  const exePath = args.flags.exe || resolveExeForTarget(target);
  if (!exePath) throw new Error(`--target=${target} needs --exe=<path to WRL Forge.exe> (no default found)`);
  if (!fs.existsSync(exePath)) throw new Error(`--target=${target}: exe not found at ${exePath}`);
  return spawn(exePath, [], { cwd: path.dirname(exePath), env, stdio: ['pipe', 'pipe', 'inherit'] });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // On Windows, refuse a UNC / network-drive / host-share workspace (no-op on
  // Linux, which is never blocked).
  guardWindowsWorkspace({ cwd: repoRoot, label: 'visual-qa' });
  checkSessionPresent(args);
  const jobsFile = args.positional[0];
  if (!jobsFile) {
    console.error('usage: node qa/visual-qa/cli.js <jobs.json> [--max=N] [--cooldown=MS] [--retries=N] [--target=source|win-unpacked|portable|installed] [--exe=<path>] [--allow-headed]');
    process.exit(2);
  }

  const jobs = readJsonFile(jobsFile);
  // Platform-aware transport: stdin on POSIX, a jobs file on Windows (where a
  // GUI-subsystem electron.exe has an immediately-ended stdin -- Phase 7C5).
  const transport = makeCaptureTransport();
  const opts = {
    spawn: () => realSpawn(args, transport.env),
    log: (rec) => process.stdout.write(JSON.stringify(rec) + '\n'),
    ...transport.runnerOpts,
  };
  if (args.flags.max) opts.maxLaunches = Number(args.flags.max);
  if (args.flags.cooldown) opts.cooldownMs = Number(args.flags.cooldown);
  if (args.flags.retries) opts.retriesPerLaunch = Number(args.flags.retries);

  const release = acquire();
  const runner = new VisualQaRunner(opts);
  let failed = false;
  try {
    const results = await runner.run(jobs);
    process.stdout.write(JSON.stringify({ event: 'results', results }) + '\n');
  } catch (err) {
    failed = true;
    process.stdout.write(JSON.stringify({ event: 'error', code: err.code, message: String(err.message || err) }) + '\n');
  } finally {
    release();
    transport.cleanup();
  }

  const survivors = runner.survivors();
  process.stdout.write(JSON.stringify({ event: 'survivors', pids: survivors }) + '\n');
  if (survivors.length > 0) failed = true;
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();

module.exports = { parseArgs, checkSessionPresent, resolveExeForTarget, realSpawn };
