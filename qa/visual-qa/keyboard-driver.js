'use strict';
// Minimal packaged-keyboard interaction driver for the final QA enablement pass.
// Reads keyboard jobs from --jobs=<file>, spawns the packaged Electron in
// capture-server mode, drives the real window via main.js's `keyboard` job
// type (webContents.sendInputEvent + executeJavaScript for inspectFocus),
// and reports the focused element after each key. Does NOT use the
// VisualQaRunner's screenshot loop -- the keyboard jobs are the
// capture-server-side work; the driver just relays.
//
// Usage:
//   node qa/visual-qa/keyboard-driver.js \
//     --exe=<path to packaged WRL Forge.exe> \
//     --jobs=<jobs.json> \
//     [--user-data=<dir>] [--platform=<host platform: linux|darwin|win32>]
//
// On POSIX, jobs are delivered via stdin (newline-JSON). On Windows, the
// capture-server reads from a file (WRL_FORGE_CAPTURE_JOBS_FILE). The driver
// detects the host platform and uses the matching transport.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function parseArgs(argv) {
  const args = { flags: {} };
  for (const a of argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) args.flags[m[1]] = m[2];
  }
  return args;
}

const args = parseArgs(process.argv);
const exe = args.flags.exe;
const jobsFile = args.flags.jobs;
const userData = args.flags['user-data'] || path.join(os.tmpdir(), 'wrlforge-keyboard-' + Date.now());
const platform = (args.flags.platform || process.platform);

if (!exe || !jobsFile) {
  console.error('usage: keyboard-driver.js --exe=<path> --jobs=<jobs.json> [--user-data=<dir>]');
  process.exit(2);
}

fs.mkdirSync(userData, { recursive: true });

// Strip BOM from the jobs file
const { readJsonFile } = require('./json-file');
let jobs;
try {
  jobs = readJsonFile(jobsFile);
} catch (err) {
  console.error('keyboard-driver: bad jobs file: ' + err.message);
  process.exit(2);
}

// Setup env
const env = { ...process.env, WRL_FORGE_CAPTURE_SERVER: '1', WRL_FORGE_NO_EDITOR: '1' };

// Use the file transport on both Linux and Windows: it's simpler, doesn't
// depend on a reliable stdin pipe (a GUI-subsystem electron.exe on Windows
// gets an immediately-ended stdin), and main.js reads the file at startup.
const tmpJobs = path.join(userData, 'jobs.json');
fs.writeFileSync(tmpJobs, JSON.stringify(jobs));
env.WRL_FORGE_CAPTURE_JOBS_FILE = tmpJobs;
env.WRL_FORGE_USER_DATA = userData;
const exeArgs = platform === 'win32' ? [] : ['--user-data-dir=' + userData];
const child = spawn(exe, exeArgs, { cwd: path.dirname(exe), env, stdio: ['pipe', 'pipe', 'inherit'] });

let buf = '';
const results = [];
child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    if (line.startsWith('WRL_FORGE_CAPTURE_OK ')) {
      const rest = line.slice('WRL_FORGE_CAPTURE_OK '.length);
      const sp = rest.indexOf(' ');
      const id = sp >= 0 ? rest.slice(0, sp) : rest;
      const payload = sp >= 0 ? rest.slice(sp + 1) : '{}';
      try { results.push({ ok: true, id, payload: JSON.parse(payload) }); }
      catch { results.push({ ok: true, id, payload: null, raw: payload }); }
    } else if (line.startsWith('WRL_FORGE_CAPTURE_ERR ')) {
      const rest = line.slice('WRL_FORGE_CAPTURE_ERR '.length);
      const sp = rest.indexOf(' ');
      const id = sp >= 0 ? rest.slice(0, sp) : rest;
      const msg = sp >= 0 ? rest.slice(sp + 1) : '';
      results.push({ ok: false, id, error: msg });
    } else if (line === 'WRL_FORGE_CAPTURE_READY') {
      results.push({ event: 'ready' });
    }
  }
});

child.on('close', (code) => {
  process.stdout.write(JSON.stringify({ event: 'close', code, resultsCount: results.length, results }) + '\n');
  process.exit(results.some((r) => r.ok === false) ? 1 : 0);
});

setTimeout(() => {
  console.error('keyboard-driver: timeout, killing');
  try { child.kill('SIGKILL'); } catch {}
}, 30000);