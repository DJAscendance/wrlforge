'use strict';
// The ONLY sanctioned entry point for a real WRL Forge visual-QA batch.
//
//   node qa/visual-qa/cli.js <jobs.json> [--max=N] [--cooldown=MS] [--retries=N]
//
// <jobs.json> is a JSON array of jobs:
//   [{ "id":"def-use", "fixture":"/abs/path.wrl", "mode":"fit",
//      "size":"900x600", "out":"/abs/out.png", "json":true }, ...]
//
// It acquires the single-instance lock, spawns exactly ONE Electron
// capture-server, drives every job through it, tears it down, verifies no
// process leaked, and emits one structured JSON log line per lifecycle event.
// Exit code is non-zero on any failure (timeout, cap, leak, job error) so CI /
// callers can gate on it. See docs/VISUAL_QA_SAFETY.md.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { VisualQaRunner } = require('./runner');
const { acquire } = require('./lock');

const repoRoot = path.join(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) args.flags[m[1]] = m[2];
    else args.positional.push(a);
  }
  return args;
}

function realSpawn() {
  const electronBinary = require('electron');
  return spawn(electronBinary, ['.', '--no-sandbox'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      WRL_FORGE_CAPTURE_SERVER: '1',
      WRL_FORGE_NO_EDITOR: '1', // never spawn VSCodium per fixture during QA
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

async function main() {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    console.error('visual-qa: no DISPLAY/WAYLAND_DISPLAY -- refusing to launch Electron headless-blind.');
    process.exit(2);
  }
  const args = parseArgs(process.argv.slice(2));
  const jobsFile = args.positional[0];
  if (!jobsFile) { console.error('usage: node qa/visual-qa/cli.js <jobs.json> [--max=N] [--cooldown=MS] [--retries=N]'); process.exit(2); }

  const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  const opts = {
    spawn: realSpawn,
    log: (rec) => process.stdout.write(JSON.stringify(rec) + '\n'),
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
  }

  const survivors = runner.survivors();
  process.stdout.write(JSON.stringify({ event: 'survivors', pids: survivors }) + '\n');
  if (survivors.length > 0) failed = true;
  process.exit(failed ? 1 : 0);
}

main();
