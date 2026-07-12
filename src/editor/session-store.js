'use strict';
// Native editor session persistence (Phase 7B) -- the small, WRITABLE store that
// remembers the most-recently-open editor document so it can be offered back on
// next launch. Unlike app-settings.js (deliberately read-only, user-owned), this
// file is machine-managed state, so it lives in its own module under userData.
//
// Pure/injectable fs -- every disk touch goes through `deps.fs`, so save/load and
// (crucially) the restore-authorization rules are unit-testable without Electron.
//
// A restored document is confined to its PREVIOUSLY AUTHORIZED context: a World
// document must still resolve inside the same project root it was opened from (no
// symlink escape); a Mall/generic document need only still exist. A missing file,
// a moved root, or a symlink escape all fail restore rather than opening blindly.

const nodePath = require('path');
const nodeFs = require('fs');
const { realpathInside } = require('./path-authorizer');

const SESSION_FILENAME = 'editor-session.json';

function sessionStorePath(userDataPath) {
  return nodePath.join(userDataPath, SESSION_FILENAME);
}

function resolveFs(deps) {
  return (deps && deps.fs) || nodeFs;
}

// Persist the last-open record. Best-effort: a write failure is swallowed (losing
// session restore is never fatal). `record` = { sourcePath, context, profile,
// root?, format }.
function saveSession(userDataPath, record, deps = {}) {
  const fs = resolveFs(deps);
  try {
    const p = sessionStorePath(userDataPath);
    fs.mkdirSync(nodePath.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

// Load the last-open record, or null when absent/garbage (best-effort).
function loadSession(userDataPath, deps = {}) {
  const fs = resolveFs(deps);
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionStorePath(userDataPath), 'utf8'));
    if (parsed && typeof parsed.sourcePath === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

// Forget the last-open record (used on explicit Close -- an explicit close means
// "do not auto-restore this next time"). Best-effort.
function clearSession(userDataPath, deps = {}) {
  const fs = resolveFs(deps);
  try {
    fs.rmSync(sessionStorePath(userDataPath), { force: true });
    return true;
  } catch {
    return false;
  }
}

// May this record be restored? Enforces the previously-authorized-context rule.
// Returns { ok, reason } with reason one of: bad-record | missing | moved-root |
// outside-context.
function validateRestore(record, deps = {}) {
  const fs = resolveFs(deps);
  if (!record || typeof record.sourcePath !== 'string') return { ok: false, reason: 'bad-record' };
  if (!fs.existsSync(record.sourcePath)) return { ok: false, reason: 'missing' };
  if (record.context === 'world') {
    if (!record.root || !fs.existsSync(record.root)) return { ok: false, reason: 'moved-root' };
    if (!realpathInside(record.root, record.sourcePath, fs)) return { ok: false, reason: 'outside-context' };
  }
  return { ok: true };
}

module.exports = {
  SESSION_FILENAME,
  sessionStorePath,
  saveSession,
  loadSession,
  clearSession,
  validateRestore,
};
