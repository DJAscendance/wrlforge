'use strict';
// Phase Beta 2 — Crash Recovery. The recovery substrate: a small, WRITABLE
// store that remembers unsaved editor work so it can survive an abnormal exit
// (renderer-process crash, app hard kill, OS restart). It is intentionally
// separate from `session-store.js`, which records the most-recently-opened
// DOCUMENT (with format/context/root authorization); the recovery store records
// the DIRTY BUFFER that the document does not yet hold on disk.
//
// The two stores are deliberately decoupled so neither can ever silently mutate
// the other; a successful Save clears the recovery record without touching the
// session record, and a Close clears both through their respective APIs.
//
// Pure/injectable fs -- every disk touch goes through `deps.fs`, so save/load
// and (crucially) the validate-on-load rules are unit-testable without Electron.
//
// Recovery schema (versioned for forward-compatibility):
//
//   {
//     schemaVersion: 2,
//     sourcePath:   '/abs/path/to.wrl'        // the real source path; null when
//                                             // the buffer was an unsaved "new"
//                                             // file (we still snapshot it, so a
//                                             // crash mid-edit doesn't lose it;
//                                             // Restore offers it as a missing-
//                                             // source viewer instead).
//     context:      'mall' | 'world' | 'generic',
//     profile:      'mall-item' | 'world' | 'generic',
//     root:         '/abs/path' | null,       // world root for context='world'
//     format:       'plain' | 'gzip',
//     baseline:     '...text as on disk...',  // last known on-disk text
//     buffer:       '...current text...',     // current dirty buffer
//     dirty:        true,
//     activeWorkspace: 'mall' | 'world' | 'editor',
//     updatedAt:    1700000000000             // ms epoch; informational
//     sourceStat:   { mtimeMs, size, hash }    // v2 ONLY. Real disk stat at
//                                             // snapshot time -- this is the
//                                             // authoritative conflict-detection
//                                             // material on the next Save. v1
//                                             // records lack this field and are
//                                             // accepted; Restore still happens
//                                             // for v1 records, but the renderer
//                                             // falls back to a viewer because
//                                             // the conflict check has no anchor.
//   }

const nodePath = require('path');
const nodeFs = require('fs');

const RECOVERY_FILENAME = 'editor-recovery.json';
const SCHEMA_VERSION = 2;

function recoveryStorePath(userDataPath) {
  return nodePath.join(userDataPath, RECOVERY_FILENAME);
}

function resolveFs(deps) {
  return (deps && deps.fs) || nodeFs;
}

// --- record construction ---------------------------------------------------
// A recovery record is built from the controller's session + the renderer's
// current buffer. We DO NOT require an open source path: a "new file, not yet
// saved" buffer is still recovered (Restore opens it in a generic unsaved
// editor session).
function makeRecord({ sourcePath = null, context = 'generic', profile = 'generic', root = null, format = 'plain', baseline = '', buffer = '', dirty = false, activeWorkspace = 'editor', updatedAt = Date.now(), sourceStat = null }) {
  let safeSourceStat = null;
  if (sourceStat && typeof sourceStat === 'object') {
    const m = Number(sourceStat.mtimeMs);
    const s = Number(sourceStat.size);
    const h = typeof sourceStat.hash === 'string' ? sourceStat.hash : null;
    if (Number.isFinite(m) && Number.isFinite(s) && typeof h === 'string' && h.length > 0) {
      safeSourceStat = { mtimeMs: m, size: s, hash: h };
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    sourcePath: sourcePath == null ? null : String(sourcePath),
    context: String(context),
    profile: String(profile),
    root: root == null ? null : String(root),
    format: format === 'gzip' ? 'gzip' : 'plain',
    baseline: baseline == null ? '' : String(baseline),
    buffer: buffer == null ? '' : String(buffer),
    dirty: !!dirty,
    activeWorkspace: ['mall', 'world', 'editor'].includes(activeWorkspace) ? activeWorkspace : 'editor',
    updatedAt: typeof updatedAt === 'number' ? updatedAt : Date.now(),
    sourceStat: safeSourceStat,
  };
}

// --- validation ------------------------------------------------------------
// Load anything that looks like a record and decide if it is trustworthy. A
// corrupt or incomplete recovery file MUST NOT crash the app at startup; it
// must be treated as "no recovery" and reported so the prompt stays silent.
function validateRecord(parsed) {
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'bad-shape' };
  // Accept v1 (legacy, no sourceStat) AND v2 (current). Anything else is
  // a forward-compatibility reject.
  if (parsed.schemaVersion !== SCHEMA_VERSION && parsed.schemaVersion !== 1) {
    return { ok: false, reason: 'schema-mismatch' };
  }
  // context and profile are allowed to be any string -- new profiles are
  // additive -- but they must be present and typed.
  if (typeof parsed.context !== 'string') return { ok: false, reason: 'bad-context' };
  if (typeof parsed.profile !== 'string') return { ok: false, reason: 'bad-profile' };
  // sourcePath may be null only when the buffer is a "new file" we never
  // saved; otherwise it must be a string. The same goes for root.
  if (parsed.sourcePath != null && typeof parsed.sourcePath !== 'string') {
    return { ok: false, reason: 'bad-sourcePath' };
  }
  if (parsed.root != null && typeof parsed.root !== 'string') {
    return { ok: false, reason: 'bad-root' };
  }
  if (typeof parsed.format !== 'string' || (parsed.format !== 'plain' && parsed.format !== 'gzip')) {
    return { ok: false, reason: 'bad-format' };
  }
  if (typeof parsed.baseline !== 'string') return { ok: false, reason: 'bad-baseline' };
  if (typeof parsed.buffer !== 'string') return { ok: false, reason: 'bad-buffer' };
  if (typeof parsed.dirty !== 'boolean') return { ok: false, reason: 'bad-dirty' };
  if (typeof parsed.activeWorkspace !== 'string') return { ok: false, reason: 'bad-workspace' };
  if (!['mall', 'world', 'editor'].includes(parsed.activeWorkspace)) return { ok: false, reason: 'bad-workspace' };
  // v2 records MAY carry sourceStat. If present, every field must be the
  // right type (numbers + string hash). A malformed sourceStat is treated
  // like the field is absent -- the absence is non-fatal (the recovered
  // baseline still carries the text); what fails is the conflict-path
  // comparison (handled in code, not the schema gate).
  if (parsed.sourceStat != null) {
    if (typeof parsed.sourceStat !== 'object') return { ok: false, reason: 'bad-sourceStat' };
    if (typeof parsed.sourceStat.mtimeMs !== 'number') return { ok: false, reason: 'bad-sourceStat' };
    if (typeof parsed.sourceStat.size !== 'number') return { ok: false, reason: 'bad-sourceStat' };
    if (typeof parsed.sourceStat.hash !== 'string') return { ok: false, reason: 'bad-sourceStat' };
  }
  return { ok: true };
}

// --- persistence ----------------------------------------------------------
// Best-effort writes/reads: a lost snapshot is never fatal. The caller logs
// the failure rather than throwing.
function saveRecovery(userDataPath, record, deps = {}) {
  const fs = resolveFs(deps);
  if (!validateRecord(record).ok) return false;
  try {
    const p = recoveryStorePath(userDataPath);
    fs.mkdirSync(nodePath.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

// Loads the record AND validates it. Returns { ok, record? , reason? } so
// callers can distinguish "no recovery file" (silent) from "bad recovery"
// (log + treat as no recovery -- NEVER throw at startup).
function loadRecovery(userDataPath, deps = {}) {
  const fs = resolveFs(deps);
  let raw;
  try {
    raw = fs.readFileSync(recoveryStorePath(userDataPath), 'utf8');
  } catch {
    return { ok: false, reason: 'absent' };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
  const v = validateRecord(parsed);
  if (!v.ok) return { ok: false, reason: v.reason };
  return { ok: true, record: parsed };
}

// Forget the recovery snapshot (used after a successful Save, an explicit
// Discard, or the user's Start Fresh choice).
function clearRecovery(userDataPath, deps = {}) {
  const fs = resolveFs(deps);
  try {
    fs.rmSync(recoveryStorePath(userDataPath), { force: true });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  RECOVERY_FILENAME,
  SCHEMA_VERSION,
  recoveryStorePath,
  makeRecord,
  validateRecord,
  saveRecovery,
  loadRecovery,
  clearRecovery,
};
