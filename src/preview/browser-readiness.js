'use strict';
// Bounded X_ITE browser readiness gate (shared by the Mall and World previews).
//
// WHY THIS EXISTS
//
// `await X3D()` resolves as soon as every <x3d-canvas> element has a `.browser`
// property. It proves NOTHING about the WebGL2 context X_ITE captured when that
// browser was constructed. On Windows, a FIRST launch from a fresh application
// directory can lose that context during startup. Measured there (Windows 11,
// packaged app, fresh directory):
//
//     gl.isContextLost()                    === true
//     gl.getParameter(gl.MAX_TEXTURE_SIZE)  === null
//     gl.getError()                         === 0x9242 (CONTEXT_LOST_WEBGL)
//
// X_ITE listens for 'webglcontextlost' but never calls preventDefault() on it,
// so the browser engine never restores that context: it stays dead for the life
// of the X_ITE browser. Every later createX3DFromString() then throws from the
// default 1x1 texture allocation ("... greater than the maximum texture size
// (null px)") -- and because that throw happens INSIDE X_ITE's VRML parser, the
// parser rewrites it as "Parser error ... Unexpected end of file", blaming a
// perfectly valid document. Bounds and Cybertown Fit never compute.
//
// THE GATE
//
// Waiting alone cannot fix a context the engine will never restore, so the gate
// has two parts:
//
//   1. a readiness PREDICATE tied to the proved failure -- the context exists,
//      is not lost, and reports a usable positive MAX_TEXTURE_SIZE; and
//   2. a bounded RECOVERY -- when the predicate stays false because the context
//      is dead, replace the <x3d-canvas> element to obtain a brand-new X_ITE
//      browser with a brand-new context, at most `maxRecreates` times.
//
// The loop is condition-based: it returns the instant the predicate holds, polls
// on a short interval, has a finite deadline, never spins, and never loops
// forever. A timeout is reported as a PREVIEW INITIALIZATION failure, never as a
// document parse error.
//
// Everything time- and DOM-related is injected, so the whole gate unit-tests in
// plain Node with fake time and stub browsers -- no Electron, no WebGL, no X_ITE.

const WEBGL_CONTEXT_LOST_ERROR = 0x9242;
const WEBGL_MAX_TEXTURE_SIZE = 0x0d33;

const READINESS_DEFAULTS = {
  timeoutMs: 8000,      // overall deadline for "usable browser or honest failure"
  pollMs: 50,           // condition re-check interval
  recreateDelayMs: 150, // how long a dead context is tolerated before replacing it
  maxRecreates: 3,      // bounded recovery attempts
};

// A readiness/initialization failure. Deliberately NOT a parse error: callers
// must not tell the user to fix a document that was never parsed.
class WrlPreviewInitError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'PreviewInitError';
    this.code = 'preview-init';
    this.detail = detail || null;
  }
}

// Read the WebGL facts the predicate depends on. Never throws: a browser whose
// getContext() itself fails is simply "not usable yet".
function readGlState(browser) {
  const state = { hasBrowser: !!browser, hasContext: false, lost: null, maxTextureSize: null, contextLostError: false };
  if (!browser || typeof browser.getContext !== 'function') return state;
  let gl;
  try { gl = browser.getContext(); } catch (err) { state.error = String((err && err.message) || err); return state; }
  if (!gl) return state;
  state.hasContext = true;
  try { state.lost = typeof gl.isContextLost === 'function' ? gl.isContextLost() : null; } catch { state.lost = null; }
  try {
    const name = typeof gl.MAX_TEXTURE_SIZE === 'number' ? gl.MAX_TEXTURE_SIZE : WEBGL_MAX_TEXTURE_SIZE;
    state.maxTextureSize = gl.getParameter(name);
  } catch (err) { state.error = String((err && err.message) || err); }
  try {
    state.contextLostError = typeof gl.getError === 'function' && gl.getError() === WEBGL_CONTEXT_LOST_ERROR;
  } catch { /* a context this broken is already not usable */ }
  return state;
}

// THE readiness predicate. `maxTextureSize` is the exact value whose null made
// X_ITE's texture guard misfire, so proving it readable proves the WebGL state
// the parser depends on is live.
function isGlStateUsable(state) {
  if (!state || !state.hasContext) return false;
  if (state.lost === true) return false;
  if (state.contextLostError) return false;
  return typeof state.maxTextureSize === 'number' && Number.isFinite(state.maxTextureSize) && state.maxTextureSize > 0;
}

function isBrowserUsable(browser) {
  return isGlStateUsable(readGlState(browser));
}

// DOM recovery step, shared by both preview lanes: dispose the dead X_ITE
// browser and swap in a fresh <x3d-canvas> carrying the same attributes (id,
// tabindex, aria-label, ...), so the element the rest of the renderer looks up
// by id keeps working. Injected `doc` keeps this unit-testable against a stub.
function replaceCanvasElement(doc, id) {
  const current = doc.getElementById(id);
  if (!current) return null;
  // Best effort: X_ITE's dispose() releases the old (already dead) context and
  // tears down its shadow DOM. A context this broken can fail to dispose, and
  // that must not stop the replacement.
  try {
    const old = current.browser;
    if (old && typeof old.dispose === 'function') old.dispose();
  } catch { /* the context is already gone */ }
  const next = doc.createElement('x3d-canvas');
  const attrs = current.attributes ? Array.from(current.attributes) : [];
  for (const a of attrs) next.setAttribute(a.name, a.value);
  if (typeof current.replaceWith === 'function') current.replaceWith(next);
  else if (current.parentNode) current.parentNode.replaceChild(next, current);
  return next;
}

// Bounded wait for a usable X_ITE browser.
//
// deps:
//   awaitX3D()      -> Promise      X_ITE's own X3D() readiness promise
//   getBrowser()    -> browser|null the CURRENT canvas's browser
//   recreateBrowser() -> browser|null  replace the canvas, return the new browser
//   sleep(ms)       -> Promise
//   now()           -> ms
//
// Resolves { browser, state, recreates, waitedMs }; rejects with PreviewInitError.
async function acquireReadyBrowser(deps) {
  const { awaitX3D, getBrowser, recreateBrowser, sleep, now } = deps;
  const timeoutMs = deps.timeoutMs == null ? READINESS_DEFAULTS.timeoutMs : deps.timeoutMs;
  const pollMs = deps.pollMs == null ? READINESS_DEFAULTS.pollMs : deps.pollMs;
  const recreateDelayMs = deps.recreateDelayMs == null ? READINESS_DEFAULTS.recreateDelayMs : deps.recreateDelayMs;
  const maxRecreates = deps.maxRecreates == null ? READINESS_DEFAULTS.maxRecreates : deps.maxRecreates;

  const started = now();
  const deadline = started + timeoutMs;

  try {
    await awaitX3D();
  } catch (err) {
    throw new WrlPreviewInitError(
      '3D preview engine failed to start: ' + String((err && err.message) || err),
      { phase: 'X3D', waitedMs: now() - started },
    );
  }

  let recreates = 0;
  let unusableSince = null;
  let last = null;

  // Condition-based loop: one honest look before any wait, then poll. It returns
  // the instant the predicate holds, and leaves only via `return` or the
  // deadline -- there is no unbounded path and no busy spin (every iteration
  // that does not recreate sleeps).
  for (;;) {
    const browser = getBrowser();
    last = readGlState(browser);
    if (isGlStateUsable(last)) {
      return { browser, state: last, recreates, waitedMs: now() - started };
    }

    const t = now();
    if (unusableSince == null) unusableSince = t;

    // A context the engine has already declared lost will never come back on its
    // own -- replace the canvas instead of waiting out the clock.
    const deadContext = last.hasContext && (last.lost === true || last.contextLostError);
    if (deadContext && recreates < maxRecreates && t - unusableSince >= recreateDelayMs) {
      recreates += 1;
      unusableSince = null;
      try {
        recreateBrowser();
      } catch (err) {
        throw new WrlPreviewInitError(
          '3D preview could not be reinitialised: ' + String((err && err.message) || err),
          { phase: 'recreate', recreates, waitedMs: now() - started },
        );
      }
      continue; // re-check immediately; a fresh context is usually live at once
    }

    if (now() >= deadline) break;
    await sleep(pollMs);
    if (now() >= deadline) {
      // One last look: the predicate may have become true while we slept.
      const browser2 = getBrowser();
      const state2 = readGlState(browser2);
      if (isGlStateUsable(state2)) return { browser: browser2, state: state2, recreates, waitedMs: now() - started };
      last = state2;
      break;
    }
  }

  throw new WrlPreviewInitError(
    '3D preview could not start: the graphics context is not available.',
    { phase: 'readiness', state: last, recreates, waitedMs: now() - started, timeoutMs },
  );
}

const BROWSER_READINESS_API = {
  PreviewInitError: WrlPreviewInitError,
  readGlState,
  isGlStateUsable,
  isBrowserUsable,
  replaceCanvasElement,
  acquireReadyBrowser,
  CONTEXT_LOST_WEBGL: WEBGL_CONTEXT_LOST_ERROR,
  DEFAULTS: READINESS_DEFAULTS,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BROWSER_READINESS_API;
} else {
  window.WrlBrowserReadiness = BROWSER_READINESS_API;
}
