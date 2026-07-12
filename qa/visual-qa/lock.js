'use strict';
// Single-instance guard for visual QA. Guarantees at most ONE orchestrator
// (and therefore at most one Electron capture-server) can run at a time on this
// machine, and reclaims a lock left behind by a crashed run instead of wedging
// forever. Pure/injectable so it is fully unit-testable without real processes.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_LOCK_PATH = path.join(os.tmpdir(), 'wrl-forge-visual-qa.lock');

// Is a pid still alive? signal 0 performs error-checking without sending a
// signal: it throws ESRCH when the process is gone, EPERM when it exists but is
// owned by someone else (still "alive" for our purposes).
function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// Acquire the lock. Returns a release() function. Throws if a *live* holder
// already owns it. A lock whose recorded pid is dead is treated as stale and
// reclaimed. `deps` (isAlive, pid, now) are injectable for tests.
function acquire(lockPath = DEFAULT_LOCK_PATH, deps = {}) {
  const isAlive = deps.isAlive || defaultIsAlive;
  const pid = deps.pid || process.pid;
  const now = deps.now || (() => Date.now());

  const write = () => fs.writeFileSync(lockPath, JSON.stringify({ pid, at: now() }), { flag: 'w' });

  let existing = null;
  try {
    existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    existing = null; // no lock, or unreadable/garbage -> treat as free
  }

  if (existing && Number.isInteger(existing.pid) && existing.pid !== pid && isAlive(existing.pid)) {
    const e = new Error(
      `visual QA is already running (pid ${existing.pid}, lock ${lockPath}). ` +
      `Refusing to launch a second Electron capture-server.`
    );
    e.code = 'ELOCKED';
    throw e;
  }

  // Free or stale -> take it (overwriting a stale holder's pid).
  write();

  let released = false;
  return function release() {
    if (released) return;
    released = true;
    try {
      const cur = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (cur && cur.pid === pid) fs.unlinkSync(lockPath);
    } catch {
      // Someone else's lock or already gone -- don't remove what isn't ours.
    }
  };
}

module.exports = { acquire, defaultIsAlive, DEFAULT_LOCK_PATH };
