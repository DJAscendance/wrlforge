'use strict';
// Phase 7C2 -- the main-process bridge that turns an UNSAVED Mall editor buffer
// into an authorized live-preview payload, WITHOUT writing any temporary file.
// It is the one place that decides "may this buffer be previewed, and as what?".
//
// Pure and dependency-injectable (no Electron; the only Node touch is path
// resolution, injectable). The renderer sends ONLY { sessionId, text,
// bufferVersion } -- never a filesystem path, base directory, asset root, URL, or
// scheme. This bridge:
//   1. resolves the editor session (via the injected describeSession),
//   2. confirms it is an OPEN Mall document whose id matches the caller's,
//   3. confirms the held source path equals the active AUTHORIZED Mall source,
//   4. builds the Mall authorization proof from THAT path (never a renderer path),
//   5. registers the buffer bytes in the 7C1 BufferOverlay (byte substitution
//      only) and begins a preview generation,
//   6. returns only what the preview renderer needs: the (overlay-owned) text,
//      the source-directory base URL so relative local textures resolve exactly
//      as the on-disk preview, advisory remote-url findings, and the generation.
//
// Everything the overlay guarantees (no path authorization, monotonic version +
// generation, hard size ceiling, deterministic cleanup, no text in diagnostics)
// is inherited unchanged -- this bridge only supplies the authorization proof the
// overlay requires and the Electron-free context it needs.

const nodePath = require('path');
const {
  createBufferOverlay, mallAuthorization, HARD_MAX_BYTES, AUTO_REFRESH_MAX_BYTES,
} = require('./buffer-overlay');
const { fileDirUrl } = require('./texture-base');

const MALL_PROFILE = 'mall';

class MallPreviewBridge {
  constructor(deps = {}) {
    this.overlay = deps.overlay || createBufferOverlay(deps.overlayDeps);
    // () => the editor controller's describe() shape: { open, sessionId, context,
    // sourcePath, ... }. The bridge never reaches into the controller directly.
    this.describeSession = deps.describeSession || (() => ({ open: false }));
    // () => the absolute path of the currently-open, AUTHORIZED Mall source (the
    // Mall workspace's held item), or null. This is the authority the held editor
    // source must match -- the renderer can never widen it.
    this.getAuthorizedMallSource = deps.getAuthorizedMallSource || (() => null);
    this.baseUrlFor = deps.baseUrlFor || fileDirUrl;
    this.scanRemoteUrls = deps.scanRemoteUrls || (() => []);
    // (absPath) => { text, wasGzipped }: read the ON-DISK saved source for the
    // "Show saved version" action (decompresses gzip; never touches the overlay).
    this.readSaved = deps.readSaved || (() => { throw new Error('readSaved not provided'); });
    this.resolvePath = deps.resolvePath || ((p) => nodePath.resolve(String(p)));
    this._activeSessionId = null; // for deterministic doc-switch cleanup
  }

  // Shared precondition check: an open Mall document whose id the caller supplied,
  // whose held path equals the active authorized Mall source. Returns { ok, src }
  // or { ok:false, reason }. NEVER trusts a renderer-supplied path.
  _authorize(sessionId) {
    const d = this.describeSession();
    if (!d || !d.open) return { ok: false, reason: 'no-document' };
    if (sessionId == null || d.sessionId !== sessionId) return { ok: false, reason: 'stale-session' };
    if (d.context !== 'mall') return { ok: false, reason: 'not-mall' };
    if (typeof d.sourcePath !== 'string' || d.sourcePath === '') return { ok: false, reason: 'no-source' };
    const held = this.resolvePath(d.sourcePath);
    const authorized = this.getAuthorizedMallSource();
    if (!authorized) return { ok: false, reason: 'no-authorized-source' };
    if (this.resolvePath(authorized) !== held) return { ok: false, reason: 'source-mismatch' };
    return { ok: true, src: held };
  }

  // Deterministic doc-switch cleanup: a load for a NEW session invalidates the
  // previous session's overlay so no overlay ever outlives its document.
  _trackActive(sessionId) {
    if (this._activeSessionId != null && this._activeSessionId !== sessionId) {
      this.overlay.invalidateSession(this._activeSessionId);
    }
    this._activeSessionId = sessionId;
  }

  // Authorize + register the unsaved buffer and begin a preview generation.
  // Returns { ok:true, generation, bufferVersion, text, baseURL, sourcePath,
  // remoteUrls, sizeTier, wasGzipped:false } or { ok:false, reason, ... }. The
  // `text` returned is the OVERLAY's copy (main is the source of truth for what
  // renders), so the renderer never renders bytes main didn't authorize.
  load({ sessionId, text, bufferVersion } = {}) {
    const gate = this._authorize(sessionId);
    if (!gate.ok) return gate;
    if (typeof text !== 'string') return { ok: false, reason: 'bad-text' };
    if (!Number.isInteger(bufferVersion) || bufferVersion < 0) return { ok: false, reason: 'bad-version' };

    const src = gate.src;
    const docId = src; // one document per editor session; its identity is its path
    const proof = mallAuthorization(src);

    let desc;
    try {
      desc = this.overlay.register({
        sessionId, docId, path: src, profile: MALL_PROFILE, bufferVersion, text, authorization: proof,
      });
    } catch (e) {
      if (e.code === 'EBUFFERTOOLARGE') {
        return { ok: false, reason: 'too-large', sizeTier: 'refused', hardMaxBytes: HARD_MAX_BYTES };
      }
      if (e.code === 'ESTALEVERSION') {
        // A manual Update (or layout re-show / mode switch) re-renders the CURRENT
        // edit -- same bufferVersion, same authorized bytes already in the overlay.
        // That is an idempotent re-render, not a stale request: begin a fresh
        // GENERATION over the existing entry. Only a STRICTLY-older version (a late
        // request for a superseded edit) stays refused.
        const cur = this.overlay.describe(sessionId);
        if (cur && cur.hasOverlay && cur.docId === docId && cur.bufferVersion === bufferVersion) {
          desc = cur;
        } else {
          return { ok: false, reason: 'stale-version' };
        }
      } else if (e.code === 'ENOAUTH') {
        return { ok: false, reason: 'unauthorized' };
      } else {
        return { ok: false, reason: 'register-failed', code: e.code || 'unknown' };
      }
    }

    this._trackActive(sessionId);
    const generation = this.overlay.beginGeneration(sessionId);
    // Read the text back THROUGH the overlay so what we return is provably the
    // registered, authorized copy for this generation (never a renderer echo).
    const resolved = this.overlay.resolve({ sessionId, generation, path: src, docId, profile: MALL_PROFILE });
    if (resolved.status !== 'overlay') {
      return { ok: false, reason: 'resolve-failed', status: resolved.status };
    }
    return {
      ok: true,
      generation,
      bufferVersion,
      text: resolved.text,
      baseURL: this.baseUrlFor(src),
      sourcePath: src,
      remoteUrls: this.scanRemoteUrls(resolved.text),
      sizeTier: desc.sizeTier,
      wasGzipped: false,
    };
  }

  // The "Show saved version" action: render the ON-DISK source, not the buffer.
  // Reads disk (decompressing gzip so X_ITE only sees plain text) and does NOT
  // touch the overlay -- it is a pure display of the last-saved bytes.
  saved({ sessionId } = {}) {
    const gate = this._authorize(sessionId);
    if (!gate.ok) return gate;
    const src = gate.src;
    let read;
    try { read = this.readSaved(src); }
    catch (e) { return { ok: false, reason: 'read-failed', error: String((e && e.message) || e) }; }
    return {
      ok: true,
      text: read.text,
      baseURL: this.baseUrlFor(src),
      sourcePath: src,
      remoteUrls: this.scanRemoteUrls(read.text),
      wasGzipped: !!read.wasGzipped,
      saved: true,
    };
  }

  // Accept the completion of a generation (older/replayed generations are refused
  // by the overlay, so an out-of-order render can never be marked current).
  accept({ sessionId, generation } = {}) {
    return this.overlay.acceptGeneration(sessionId, generation);
  }

  // Deterministic cleanup. Document close/switch keeps the session open but drops
  // the overlay; renderer reload / editor close / navigate-away invalidates it.
  invalidateDocument(sessionId) { return this.overlay.invalidateDocument(sessionId); }
  invalidateSession(sessionId) {
    if (this._activeSessionId === sessionId) this._activeSessionId = null;
    return this.overlay.invalidateSession(sessionId);
  }
  clear() { this._activeSessionId = null; this.overlay.clear(); }

  // Leak-assertion surface for QA (overlay/generation counts must be zero after
  // close). Never exposes buffer text.
  leak() { return this.overlay.describe(); }
  describe(sessionId) { return this.overlay.describe(sessionId); }
}

function createMallPreviewBridge(deps) {
  return new MallPreviewBridge(deps);
}

module.exports = {
  MallPreviewBridge,
  createMallPreviewBridge,
  MALL_PROFILE,
  HARD_MAX_BYTES,
  AUTO_REFRESH_MAX_BYTES,
};
