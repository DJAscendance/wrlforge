'use strict';
// Phase 7C1 -- Buffer-overlay foundation for previewing UNSAVED editor buffers
// through X_ITE without ever writing a temporary file. Pure and dependency-free
// (no fs, no Electron): text + identity in, a structured decision out. It is the
// main-process, session-scoped registry that a later slice (7C2/7C3) wires into
// `preview:load` / `world:previewLoad` so X_ITE renders the in-memory buffer in
// place of the on-disk bytes.
//
// The whole safety posture is a single idea: an overlay is a *byte substitution*
// for a path that is ALREADY authorized, never a new grant. This module therefore
// NEVER authorizes a path, expands a World asset graph, resolves a renderer path,
// fetches anything, writes a file, mutates a source, or persists across restarts.
// It re-implements none of `src/editor/path-authorizer.js` or the World graph:
// registration REQUIRES an authorization proof the owning controller already
// obtained from those systems (see `mallAuthorization` / `worldAuthorization` and
// `defaultVerifyAuthorization` below -- the narrow integration boundary), and the
// overlay only checks the proof matches the entry it is being asked to create.
//
// Ordering authority is a pair of monotonic INTEGERS, never timestamps:
//   * bufferVersion -- the renderer's per-edit version (promoted onto the request).
//                      A newer version must never be replaced by an older one.
//   * generation    -- a main-held per-session preview-attempt counter. A newer
//                      generation must never be replaced/completed by an older one.
//
// The last-valid-scene state machine lives in `./preview-state`; the debounce /
// coalescing coordinator lives in `./preview-scheduler`. Both are pure and are
// re-exported here so callers have one require point.

const { createPreviewState, PREVIEW_STATES, FAILURE } = require('./preview-state');
const { createPreviewScheduler } = require('./preview-scheduler');

// ---- Size thresholds (documented in docs/PHASE_7C_PROPOSAL.md and README) ----
//
// AUTO_REFRESH_MAX_BYTES: the LOCKED automatic-preview threshold. A buffer at or
// below 1 MiB may participate in debounced auto-refresh. Above it, the buffer is
// still a perfectly valid preview target but only via an explicit Update (7C2+).
//
// HARD_MAX_BYTES: an explicit in-memory safety maximum. Rationale: a WRL *source*
// above 8 MiB is pathological -- a world's bulk is binary textures, not VRML text,
// and the largest measured perf fixture is ~1.3 MB (docs/PHASE_7C_PROPOSAL.md
// section 11). An in-memory preview holds transient copies (overlay + IPC marshal
// + X_ITE parse), so an 8 MiB text ceiling bounds worst-case transient memory to
// tens of MiB while comfortably clearing every realistic source. Above the hard
// max the preview is REFUSED with a clear category -- the text is never stored and
// NEVER silently truncated. 8x headroom over the auto threshold is deliberate.
const AUTO_REFRESH_MAX_BYTES = 1024 * 1024; // 1 MiB
const HARD_MAX_BYTES = 8 * 1024 * 1024; // 8 MiB

const PROFILES = new Set(['mall', 'world']);

// Byte-size tier for later UI logic. Pure; distinguishes the three bands the
// proposal requires: auto-refresh eligible / manual-update only / hard refusal.
function classifyBufferSize(byteLength, opts = {}) {
  const autoMax = opts.autoMaxBytes == null ? AUTO_REFRESH_MAX_BYTES : opts.autoMaxBytes;
  const hardMax = opts.hardMaxBytes == null ? HARD_MAX_BYTES : opts.hardMaxBytes;
  const len = Number(byteLength) || 0;
  if (len > hardMax) {
    return {
      tier: 'refused', autoEligible: false, manualEligible: false,
      byteLength: len, autoMaxBytes: autoMax, hardMaxBytes: hardMax,
    };
  }
  if (len > autoMax) {
    return {
      tier: 'manual', autoEligible: false, manualEligible: true,
      byteLength: len, autoMaxBytes: autoMax, hardMaxBytes: hardMax,
    };
  }
  return {
    tier: 'auto', autoEligible: true, manualEligible: true,
    byteLength: len, autoMaxBytes: autoMax, hardMaxBytes: hardMax,
  };
}

// UTF-8 byte length. Buffer is a plain Node global (not fs/Electron), so using it
// keeps the module pure and testable. Callers may also pass byteLength directly.
function utf8ByteLength(text) {
  return Buffer.byteLength(String(text == null ? '' : text), 'utf8');
}

// ---- Authorization proof helpers (the narrow integration boundary) ----
//
// The owning main-process controller computes these from the systems that already
// own authorization -- the Mall session's held source path, or the World scan
// graph via `buildAuthorizedSet` / `authorizeWorldReference`. The overlay treats a
// proof as opaque except for the strict shape-and-match check in
// `defaultVerifyAuthorization`. This is what lets the overlay refuse to invent a
// grant WITHOUT duplicating a single line of the authorizer or the graph walk.

// A Mall proof: the edited path IS the held session source. `source` names the
// authority so a World proof can never be mistaken for a Mall one.
function mallAuthorization(path) {
  return { ok: true, profile: 'mall', source: 'mall-session', path: String(path) };
}

// A World proof: the edited path is a member of the current scan's authorized WRL
// set (`inGraph`) confined to the project root. The caller must have run the real
// graph/realpath authorization first; this only records its result.
function worldAuthorization(path, { inGraph } = {}) {
  return {
    ok: inGraph === true, profile: 'world', source: 'world-graph',
    inGraph: inGraph === true, path: String(path),
  };
}

// Default proof verifier. Rejects anything that is not a well-formed, matching
// proof for the exact {path, profile} being registered. Injectable via the
// constructor so a later controller can tighten it, never loosen the contract.
function defaultVerifyAuthorization(proof, entry) {
  if (!proof || typeof proof !== 'object') return { ok: false, reason: 'no-proof' };
  if (proof.ok !== true) return { ok: false, reason: 'not-authorized' };
  if (proof.profile !== entry.profile) return { ok: false, reason: 'profile-mismatch' };
  if (proof.path !== entry.path) return { ok: false, reason: 'path-mismatch' };
  if (entry.profile === 'mall' && proof.source !== 'mall-session') {
    return { ok: false, reason: 'wrong-source' };
  }
  if (entry.profile === 'world') {
    if (proof.source !== 'world-graph') return { ok: false, reason: 'wrong-source' };
    if (proof.inGraph !== true) return { ok: false, reason: 'not-in-graph' };
  }
  return { ok: true };
}

// Resolve statuses -- the six-way structured result `resolve()` returns. Callers
// (7C2/7C3) map 'overlay' to "serve buffer bytes" and 'disk'/'missing' to "do your
// normal authorized disk read"; every other status means "do NOT override".
const RESOLVE = Object.freeze({
  OVERLAY: 'overlay', // hit: serve entry.text in place of disk
  DISK: 'disk', // open session, an overlay exists, but a DIFFERENT authorized path was asked for
  MISSING: 'missing', // open session, no overlay registered at all
  STALE: 'stale', // request generation is older than the session's current generation
  UNAUTHORIZED: 'unauthorized', // identity spoof: path matches but profile/doc does not
  CLOSED: 'closed', // unknown or closed session -- can never serve buffer content
});

function overlayError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function isDefinedKey(v) {
  return (typeof v === 'string' && v.length > 0) || (typeof v === 'number' && Number.isFinite(v));
}

// The registry. One record per editor session; at most one active override per
// session (editing one document at a time). Records persist across an entry being
// cleared so `resolve` can still distinguish "open but no overlay" (missing/disk)
// from "closed" -- but an invalidated session NEVER serves buffer content again.
class BufferOverlay {
  constructor(deps = {}) {
    this._sessions = new Map();
    this._seq = 0;
    this._verifyAuthorization = deps.verifyAuthorization || defaultVerifyAuthorization;
    this._autoMaxBytes = deps.autoMaxBytes == null ? AUTO_REFRESH_MAX_BYTES : deps.autoMaxBytes;
    this._hardMaxBytes = deps.hardMaxBytes == null ? HARD_MAX_BYTES : deps.hardMaxBytes;
  }

  _rec(sessionId) {
    return this._sessions.get(sessionId);
  }

  _ensureOpenRec(sessionId) {
    let rec = this._sessions.get(sessionId);
    if (rec && rec.open === false) {
      throw overlayError('ECLOSED', 'session is closed');
    }
    if (!rec) {
      rec = {
        sessionId, open: true, entry: null,
        generation: 0, requestedGeneration: 0, acceptedGeneration: 0,
      };
      this._sessions.set(sessionId, rec);
    }
    return rec;
  }

  // Register (or replace) the override for a session. Throws a typed error on any
  // invalid, unauthorized, stale-version, or oversized request -- and stores
  // NOTHING in those cases (failed registration leaves no residue). Returns a
  // text-free descriptor on success.
  register(input = {}) {
    const {
      sessionId, docId, path, profile, bufferVersion, text, authorization,
    } = input;
    let { byteLength } = input;

    if (!isDefinedKey(sessionId)) throw overlayError('EBADARG', 'sessionId is required');
    if (typeof docId !== 'string' || docId === '') throw overlayError('EBADARG', 'docId is required');
    if (typeof path !== 'string' || path === '') throw overlayError('EBADARG', 'path is required');
    if (!PROFILES.has(profile)) throw overlayError('EPROFILE', `unknown profile: ${profile}`);
    if (!Number.isInteger(bufferVersion) || bufferVersion < 0) {
      throw overlayError('EBADARG', 'bufferVersion must be a non-negative integer');
    }
    if (typeof text !== 'string') throw overlayError('EBADARG', 'text must be a string');

    if (byteLength == null) byteLength = utf8ByteLength(text);
    const size = classifyBufferSize(byteLength, {
      autoMaxBytes: this._autoMaxBytes, hardMaxBytes: this._hardMaxBytes,
    });
    if (size.tier === 'refused') {
      // Hard refusal: never store, never truncate.
      throw overlayError('EBUFFERTOOLARGE',
        `buffer ${byteLength} bytes exceeds hard maximum ${this._hardMaxBytes}`);
    }

    const auth = this._verifyAuthorization(authorization, { path, profile });
    if (!auth || auth.ok !== true) {
      throw overlayError('ENOAUTH', `authorization rejected: ${(auth && auth.reason) || 'unknown'}`);
    }

    const rec = this._ensureOpenRec(sessionId);
    const cur = rec.entry;
    if (cur && cur.docId === docId && bufferVersion <= cur.bufferVersion) {
      // A newer buffer version must never be replaced by an older one.
      throw overlayError('ESTALEVERSION',
        `bufferVersion ${bufferVersion} <= current ${cur.bufferVersion}`);
    }

    rec.entry = {
      sessionId, docId, path, profile, bufferVersion, text,
      byteLength, sizeTier: size.tier, seq: ++this._seq,
    };
    return this.describe(sessionId);
  }

  // Issue the next preview generation for a session (a preview attempt is about to
  // start). Returns the new generation integer. Throws on a closed/unknown session.
  beginGeneration(sessionId) {
    const rec = this._sessions.get(sessionId);
    if (!rec || rec.open === false) throw overlayError('ECLOSED', 'session is closed');
    rec.generation += 1;
    rec.requestedGeneration = rec.generation;
    return rec.generation;
  }

  // Accept the completion of a generation. Rejects a stale (older) or replayed
  // (already-accepted) generation deterministically -- an older render can never
  // be marked current. Returns { ok, reason?, generation? }.
  acceptGeneration(sessionId, generation) {
    const rec = this._sessions.get(sessionId);
    if (!rec || rec.open === false) return { ok: false, reason: 'closed' };
    if (!Number.isInteger(generation)) return { ok: false, reason: 'bad-generation' };
    if (generation <= rec.acceptedGeneration) return { ok: false, reason: 'replayed' };
    if (generation !== rec.requestedGeneration) return { ok: false, reason: 'stale' };
    rec.acceptedGeneration = generation;
    return { ok: true, generation };
  }

  // The read path used by the (later) preview/asset handler. Pure decision only --
  // it NEVER reads disk. Returns { status, ... }. On an 'overlay' hit it returns
  // the buffer text; every other status carries no buffer content.
  resolve(query = {}) {
    const { sessionId, generation, path, docId, profile } = query;
    const rec = this._sessions.get(sessionId);
    if (!rec || rec.open === false) return { status: RESOLVE.CLOSED };

    if (generation != null) {
      if (!Number.isInteger(generation) || generation !== rec.generation) {
        // Older OR unexpectedly-newer than the session's current generation.
        return { status: RESOLVE.STALE, current: rec.generation };
      }
    }

    const entry = rec.entry;
    if (!entry) return { status: RESOLVE.MISSING };

    if (path === entry.path) {
      if (profile != null && profile !== entry.profile) {
        return { status: RESOLVE.UNAUTHORIZED, reason: 'profile-mismatch' };
      }
      if (docId != null && docId !== entry.docId) {
        return { status: RESOLVE.UNAUTHORIZED, reason: 'doc-mismatch' };
      }
      return {
        status: RESOLVE.OVERLAY,
        text: entry.text,
        bufferVersion: entry.bufferVersion,
        byteLength: entry.byteLength,
        profile: entry.profile,
        generation: rec.generation,
      };
    }
    // A different, separately-authorized path (e.g. a sibling asset): the caller
    // performs its normal authorized disk read.
    return { status: RESOLVE.DISK };
  }

  // Drop the override but keep the session open (document close/switch). Bumps the
  // generation so any request in flight for the old buffer becomes stale.
  invalidateDocument(sessionId) {
    const rec = this._sessions.get(sessionId);
    if (!rec) return false;
    rec.entry = null;
    rec.generation += 1;
    rec.requestedGeneration = rec.generation;
    return true;
  }

  // Close a session: drop its override and mark it closed forever. No overlay may
  // survive its owning session (session close / renderer reload / shutdown path).
  invalidateSession(sessionId) {
    const rec = this._sessions.get(sessionId);
    if (!rec) return false;
    rec.entry = null;
    rec.open = false;
    rec.generation += 1;
    rec.requestedGeneration = rec.generation;
    return true;
  }

  // Wipe everything (application shutdown / renderer teardown).
  clear() {
    this._sessions.clear();
    this._seq = 0;
  }

  // Text-free diagnostics. describe(sessionId) -> that session's metadata;
  // describe() -> registry-wide leak-assertion state. Buffer CONTENTS are never
  // exposed here or logged.
  describe(sessionId) {
    if (sessionId === undefined) {
      const overlays = [];
      let activeGenerations = 0;
      for (const rec of this._sessions.values()) {
        if (rec.entry) overlays.push(rec.sessionId);
        if (rec.open && rec.requestedGeneration > rec.acceptedGeneration) activeGenerations += 1;
      }
      return {
        size: overlays.length,
        sessions: [...this._sessions.keys()],
        overlays,
        activeGenerations,
      };
    }
    const rec = this._sessions.get(sessionId);
    if (!rec) return { known: false, open: false, hasOverlay: false };
    const e = rec.entry;
    return {
      known: true,
      open: rec.open,
      hasOverlay: !!e,
      docId: e ? e.docId : null,
      path: e ? e.path : null,
      profile: e ? e.profile : null,
      bufferVersion: e ? e.bufferVersion : null,
      byteLength: e ? e.byteLength : null,
      sizeTier: e ? e.sizeTier : null,
      generation: rec.generation,
      requestedGeneration: rec.requestedGeneration,
      acceptedGeneration: rec.acceptedGeneration,
    };
  }

  // ---- Leak-assertion surface (used by QA after session close) ----
  get size() {
    let n = 0;
    for (const rec of this._sessions.values()) if (rec.entry) n += 1;
    return n;
  }

  get activeGenerationCount() {
    let n = 0;
    for (const rec of this._sessions.values()) {
      if (rec.open && rec.requestedGeneration > rec.acceptedGeneration) n += 1;
    }
    return n;
  }

  sessionIdsWithEntries() {
    const out = [];
    for (const rec of this._sessions.values()) if (rec.entry) out.push(rec.sessionId);
    return out;
  }
}

function createBufferOverlay(deps) {
  return new BufferOverlay(deps);
}

module.exports = {
  BufferOverlay,
  createBufferOverlay,
  classifyBufferSize,
  utf8ByteLength,
  mallAuthorization,
  worldAuthorization,
  defaultVerifyAuthorization,
  AUTO_REFRESH_MAX_BYTES,
  HARD_MAX_BYTES,
  RESOLVE,
  PROFILES,
  // Re-exported pure helpers so callers have a single require point.
  createPreviewState,
  PREVIEW_STATES,
  FAILURE,
  createPreviewScheduler,
};
