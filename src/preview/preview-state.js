'use strict';
// Phase 7C1 -- the last-valid-scene state machine for the unsaved-buffer preview.
// Pure and DOM-free: every transition is a total function `(state, ...) -> state`
// that returns a NEW frozen state and never mutates its input. It is deliberately
// independent of user-facing wording -- Phase 7C2 maps these internal states to
// release-quality copy ("Live", "Updating...", "Showing last good version", ...).
//
// The whole point is retaining the last successfully-rendered scene: a newer edit
// that fails to render must NOT clear the canvas. The machine tracks enough to
// prove that, and enforces the ordering rule that an OLDER success or failure can
// never change the state once a NEWER generation has begun.
//
// Generations and buffer versions are monotonic integers supplied by the owning
// controller (see ./buffer-overlay). This module records and compares them; it
// does not allocate them.

const PREVIEW_STATES = Object.freeze({
  IDLE: 'idle', // nothing rendered yet
  UPDATING: 'updating', // an attempt for `requestedGeneration` is in flight
  CURRENT: 'current', // the displayed scene matches the latest attempt
  FAILED: 'failed', // latest attempt failed AND there is no last-valid scene
  SHOWING_LAST_VALID: 'showing-last-valid', // latest attempt failed but a good scene remains on screen
  OUTDATED: 'outdated', // the buffer is newer than the displayed scene
  CLOSED: 'closed', // terminal: session closed
});

// Failure categories kept distinct so the four error surfaces never blur (see
// docs/PHASE_7C_PROPOSAL.md section 8). Copy mapping is a later slice's job.
const FAILURE = Object.freeze({
  SYNTAX: 'syntax', // parser reported syntax errors (auto-preview declined)
  PARSER: 'parser', // parser threw unexpectedly
  SCENE_LOAD: 'scene-load', // X_ITE rejected parser-clean text
  MISSING_ASSET: 'missing-asset', // a referenced asset was absent/unauthorized/remote
});

function freeze(s) {
  return Object.freeze(s);
}

function createPreviewState() {
  return freeze({
    state: PREVIEW_STATES.IDLE,
    requestedGeneration: 0,
    displayedGeneration: 0,
    lastValidGeneration: 0,
    currentBufferVersion: 0,
    displayedBufferVersion: 0,
    haveLastValid: false,
    failureCategory: null,
    source: null, // 'buffer' | 'disk' -- what produced the displayed scene
  });
}

// A once-closed machine is terminal: every transition is a no-op.
function isClosed(s) {
  return s.state === PREVIEW_STATES.CLOSED;
}

// The buffer changed. If a scene is (or was) on screen, we are now Outdated;
// otherwise we stay Idle. `bufferVersion` is monotonic; an older value is ignored.
function edit(s, bufferVersion) {
  if (isClosed(s)) return s;
  const v = Number.isInteger(bufferVersion) ? bufferVersion : s.currentBufferVersion;
  const nextVersion = Math.max(s.currentBufferVersion, v);
  const somethingShown = s.haveLastValid || s.displayedGeneration > 0;
  return freeze({
    ...s,
    currentBufferVersion: nextVersion,
    state: somethingShown ? PREVIEW_STATES.OUTDATED : PREVIEW_STATES.IDLE,
  });
}

// A preview attempt begins for `generation` (must be newer than any prior request,
// else ignored as stale). Records the buffer version this attempt is rendering.
function beginUpdate(s, generation, bufferVersion) {
  if (isClosed(s)) return s;
  if (!Number.isInteger(generation) || generation <= s.requestedGeneration) return s;
  const v = Number.isInteger(bufferVersion) ? bufferVersion : s.currentBufferVersion;
  return freeze({
    ...s,
    state: PREVIEW_STATES.UPDATING,
    requestedGeneration: generation,
    currentBufferVersion: Math.max(s.currentBufferVersion, v),
  });
}

// Internal guard: only the in-flight generation may complete. An older (or
// unexpectedly-newer) completion is ignored -- the ordering invariant.
function isCompletable(s, generation) {
  return Number.isInteger(generation) && generation === s.requestedGeneration;
}

// The in-flight attempt rendered successfully. Records it as the displayed AND the
// last-valid scene. `source` distinguishes a buffer render from a disk fallback.
function succeed(s, generation, bufferVersion, source = 'buffer') {
  if (isClosed(s) || !isCompletable(s, generation)) return s;
  const v = Number.isInteger(bufferVersion) ? bufferVersion : s.currentBufferVersion;
  return freeze({
    ...s,
    state: PREVIEW_STATES.CURRENT,
    displayedGeneration: generation,
    lastValidGeneration: generation,
    displayedBufferVersion: v,
    haveLastValid: true,
    failureCategory: null,
    source,
  });
}

// Convenience: land in Current showing the saved-on-disk scene (the "Show saved
// version" action). Same shape as succeed with source='disk'.
function diskFallback(s, generation, bufferVersion) {
  return succeed(s, generation, bufferVersion, 'disk');
}

// The in-flight attempt failed. If a last-valid scene exists it STAYS on screen
// (SHOWING_LAST_VALID); otherwise there is nothing to show (FAILED). Either way the
// displayed generation/version are unchanged -- we never advance to a broken scene.
function fail(s, generation, category) {
  if (isClosed(s) || !isCompletable(s, generation)) return s;
  return freeze({
    ...s,
    state: s.haveLastValid ? PREVIEW_STATES.SHOWING_LAST_VALID : PREVIEW_STATES.FAILED,
    failureCategory: category || null,
  });
}

// The editor switched to a different document. Retain generation monotonicity, but
// forget the displayed/last-valid scene -- the new document has none yet.
function switchDocument(s) {
  if (isClosed(s)) return s;
  return freeze({
    ...s,
    state: PREVIEW_STATES.IDLE,
    displayedGeneration: 0,
    lastValidGeneration: 0,
    displayedBufferVersion: 0,
    currentBufferVersion: 0,
    haveLastValid: false,
    failureCategory: null,
    source: null,
  });
}

// Terminal close.
function close(s) {
  return freeze({ ...s, state: PREVIEW_STATES.CLOSED });
}

// A module-unique name: this file is ALSO loaded as a plain browser <script>
// alongside ui-state.js / preview-scheduler.js, which share one global lexical
// scope -- a generic `const API` would collide and reject the whole script.
const PREVIEW_STATE_API = {
  PREVIEW_STATES,
  FAILURE,
  createPreviewState,
  edit,
  beginUpdate,
  succeed,
  diskFallback,
  fail,
  switchDocument,
  close,
};

// Dual use: CommonJS for main/tests (require('./preview-state')) AND a window
// global for the renderer (editor.html loads this via a plain <script>, no bundler).
if (typeof module !== 'undefined' && module.exports) module.exports = PREVIEW_STATE_API;
if (typeof window !== 'undefined') window.WrlPreviewState = PREVIEW_STATE_API; // eslint-disable-line no-undef
