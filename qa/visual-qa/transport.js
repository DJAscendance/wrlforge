'use strict';
// Platform-aware capture-server job transport (Phase 7C5).
//
// POSIX: the historical path -- newline-delimited JSON jobs over the child's
// stdin. The runner's defaults already do this, so this returns no overrides.
//
// Windows: a GUI-subsystem electron.exe gets an IMMEDIATELY-ended process.stdin
// (readline fires 'close' at ~34ms and piped data is never delivered), so the
// stdin transport cannot work at all. Instead the batch is written to a file the
// server reads at startup (WRL_FORGE_CAPTURE_JOBS_FILE); the server emits one
// result line per job on stdout (stdout, WebGL, and capturePage all work) and
// self-quits after the last job. Only stdin is broken on Windows.
// See docs/WINDOWS_NATIVE_QA_PLAN.md Sec.5 and main.js (capture server).
//
// Returns { env, runnerOpts, jobsFile, cleanup }:
//   env         -- merge into the spawned Electron's environment
//   runnerOpts  -- merge into `new VisualQaRunner(...)` opts
//   jobsFile    -- the batch file path (null on POSIX)
//   cleanup()   -- remove the temp jobs dir (no-op on POSIX)
// Pure w.r.t. injected deps so it is unit-testable without touching win32.

const realFs = require('fs');
const realOs = require('os');
const realPath = require('path');

function makeCaptureTransport(platform = process.platform, deps = {}) {
  const fs = deps.fs || realFs;
  const os = deps.os || realOs;
  const path = deps.path || realPath;
  if (platform !== 'win32') {
    return { env: {}, runnerOpts: {}, jobsFile: null, cleanup: () => {} };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-jobs-'));
  const jobsFile = path.join(dir, 'jobs.json');
  return {
    jobsFile,
    env: { WRL_FORGE_CAPTURE_JOBS_FILE: jobsFile },
    runnerOpts: {
      // Written before every spawn (incl. retries) so a relaunch re-reads the batch.
      prepareJobs: (jobs) => fs.writeFileSync(jobsFile, JSON.stringify(jobs)),
      writeJob: () => {},        // already delivered via the file
      requestShutdown: () => {}, // server self-quits after the last job
    },
    cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
}

module.exports = { makeCaptureTransport };
