'use strict';
// Phase 7C1 -- the debounce / coalescing coordinator for auto-refresh. Pure and
// clock-INJECTED: it holds NO real timer. Time enters only as an explicit `at`
// millisecond value on each call, so tests drive it with a fake clock and never
// sleep. A later slice (7C2) bridges this to a single real setTimeout, but the
// decision of WHETHER and WHAT to fire lives here where it is unit-testable.
//
// Locked behavior (docs/PHASE_7C_PROPOSAL.md):
//   * auto-refresh debounce = 700 ms (the midpoint of the proposed 600-800 ms).
//   * buffers over the auto threshold (1 MiB) are manual-Update only -- requestAuto
//     declines them, requestManual still accepts them.
//   * an explicit Update bypasses the debounce (fires immediately).
//   * multiple rapid edits coalesce into the NEWEST pending buffer version; the due
//     time slides forward to the newest edit + debounce.
//   * a pending timer is cancelled on document switch or session close.
//   * only ONE pending request per session is ever held.

const DEFAULT_DEBOUNCE_MS = 700;
const AUTO_REFRESH_MAX_BYTES = 1024 * 1024; // 1 MiB -- kept in sync with buffer-overlay

function createPreviewScheduler(opts = {}) {
  const debounceMs = opts.debounceMs == null ? DEFAULT_DEBOUNCE_MS : opts.debounceMs;
  const autoMaxBytes = opts.autoMaxBytes == null ? AUTO_REFRESH_MAX_BYTES : opts.autoMaxBytes;

  // sessionId -> { bufferVersion, dueAt, kind: 'auto'|'manual' }
  const pending = new Map();

  // Queue (or coalesce) a debounced auto-refresh for an edit at time `at`. A
  // buffer over the auto threshold is declined here (manual Update only). Coalesces
  // into the newest pending version and slides the due time to `at + debounceMs`.
  function requestAuto(sessionId, { bufferVersion, byteLength = 0, at }) {
    if (byteLength > autoMaxBytes) {
      return { scheduled: false, reason: 'manual-only', autoMaxBytes };
    }
    const prev = pending.get(sessionId);
    const version = prev ? Math.max(prev.bufferVersion, bufferVersion) : bufferVersion;
    const dueAt = at + debounceMs;
    pending.set(sessionId, { bufferVersion: version, dueAt, kind: 'auto' });
    return { scheduled: true, dueAt, bufferVersion: version };
  }

  // Explicit Update: bypass the debounce and mark the newest version due now. Not
  // size-gated here -- manual is allowed for buffers above the auto threshold (the
  // overlay's hard maximum is the only absolute ceiling).
  function requestManual(sessionId, { bufferVersion, at }) {
    const prev = pending.get(sessionId);
    const version = prev ? Math.max(prev.bufferVersion, bufferVersion) : bufferVersion;
    pending.set(sessionId, { bufferVersion: version, dueAt: at, kind: 'manual' });
    return { scheduled: true, immediate: true, bufferVersion: version };
  }

  // Ask whether the pending request for a session is due at time `at`. When it
  // fires, it is consumed (removed) -- the caller then begins a generation for the
  // returned bufferVersion. Returns { fire:false } when nothing is due.
  function poll(sessionId, at) {
    const p = pending.get(sessionId);
    if (!p) return { fire: false };
    if (at < p.dueAt) return { fire: false, dueAt: p.dueAt };
    pending.delete(sessionId);
    return { fire: true, bufferVersion: p.bufferVersion, kind: p.kind };
  }

  // Cancel any pending request (document switch / session close).
  function cancel(sessionId) {
    return pending.delete(sessionId);
  }

  // Cancel everything (shutdown).
  function clear() {
    pending.clear();
  }

  // Introspection (no side effects). Returns null when nothing is pending.
  function pendingFor(sessionId) {
    const p = pending.get(sessionId);
    return p ? { ...p } : null;
  }

  function pendingCount() {
    return pending.size;
  }

  return {
    debounceMs,
    autoMaxBytes,
    requestAuto,
    requestManual,
    poll,
    cancel,
    clear,
    pendingFor,
    pendingCount,
  };
}

// A module-unique name (see preview-state.js): loaded as a plain browser <script>
// in a shared global scope, a generic `const API` would collide with ui-state.js.
const PREVIEW_SCHEDULER_API = {
  createPreviewScheduler,
  DEFAULT_DEBOUNCE_MS,
  AUTO_REFRESH_MAX_BYTES,
};

// Dual use: CommonJS for main/tests AND a window global for the renderer.
if (typeof module !== 'undefined' && module.exports) module.exports = PREVIEW_SCHEDULER_API;
if (typeof window !== 'undefined') window.WrlPreviewScheduler = PREVIEW_SCHEDULER_API; // eslint-disable-line no-undef
