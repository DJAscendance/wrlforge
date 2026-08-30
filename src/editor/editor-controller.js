'use strict';
// Native editor controller (Phase 7B) -- the main-process orchestrator that sits
// between the confined `editor:*` IPC surface and the pieces that do the work:
//   * EditorSession        -- holds the one open document, owns its path
//   * authorizeWorldReference -- confines renderer-named World WRL opens
//   * session-store        -- persists/restores the most-recent document
//   * launchExternal (injected) -- optional "Open in External Editor"
//   * promptSaveAs (injected)   -- main-owned Save-As dialog
//
// Everything Electron-specific is injected, so the entire IPC behaviour (path
// authorization, stale-session rejection, conflict handling, restore rules) is
// unit-testable with plain fakes -- no BrowserWindow, no dialog, no real editor.
//
// Path posture: the renderer NEVER supplies a write destination. `save` writes
// only to the held source path; `saveAs` writes only to a path the MAIN process
// obtained from its own dialog (promptSaveAs). The one path the renderer names is
// a World reference to OPEN (read), and it is authorized against the scan graph.

const nodePath = require('path');
const { EditorSession } = require('./session');
const { authorizeWorldReference } = require('./path-authorizer');
const store = require('./session-store');

const PROFILE = Object.freeze({ MALL: 'mall-item', WORLD: 'world', GENERIC: 'generic' });
const CONTEXT = Object.freeze({ MALL: 'mall', WORLD: 'world', GENERIC: 'generic' });

function tagged(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  if (extra) Object.assign(err, extra);
  return err;
}

class EditorController {
  constructor(deps = {}) {
    this.session = deps.session || new EditorSession(deps.ioDeps);
    // Context providers -- main injects live getters over currentSession/worldSession.
    this.getMallSource = deps.getMallSource || (() => null);      // () => absPath | null
    this.getWorldContext = deps.getWorldContext || (() => null);  // () => { root, primary, allowedWrl:Set } | null
    this.launchExternal = deps.launchExternal || (() => ({ launched: false, reason: 'unavailable' }));
    this.promptSaveAs = deps.promptSaveAs || (async () => null);  // ({defaultPath, format}) => destPath | null
    this.userDataPath = deps.userDataPath || null;
    this.storeDeps = deps.storeDeps;   // injectable fs for session-store
    this.authDeps = deps.authDeps;     // injectable fs for the authorizer (realpath)
    // Optional Phase Beta 2 hook: a successful Save clears the recovery
    // snapshot via the injected recovery controller. Decoupled this way so
    // an EditorController standalone (or test) keeps its old behaviour.
    this.recoveryController = deps.recoveryController || null;
    this.sessionId = 0;                // bumped on each fresh open -> stale-session guard
    this._record = null;               // last persisted { sourcePath, context, profile, root, format }
  }

  // ---- opening -------------------------------------------------------------

  openMall() {
    const src = this.getMallSource();
    if (!src) throw tagged('ENOMALL', 'No Mall item is open.');
    return this._open(nodePath.resolve(src), { profile: PROFILE.MALL, context: CONTEXT.MALL, root: null });
  }

  openWorldPrimary() {
    const w = this.getWorldContext();
    if (!w || !w.primary) throw tagged('ENOWORLD', 'No primary world is selected.');
    return this._open(nodePath.resolve(w.primary), { profile: PROFILE.WORLD, context: CONTEXT.WORLD, root: w.root });
  }

  openWorldReference(ref) {
    const w = this.getWorldContext();
    if (!w || !w.root) throw tagged('ENOWORLD', 'No World Project is open.');
    const auth = authorizeWorldReference({ root: w.root, allowedWrl: w.allowedWrl, ref }, this.authDeps);
    if (!auth.ok) throw tagged('EAUTH', `Refusing to open that reference (${auth.reason}).`, { reason: auth.reason });
    return this._open(auth.resolved, { profile: PROFILE.WORLD, context: CONTEXT.WORLD, root: w.root });
  }

  _open(absPath, { profile, context, root }) {
    const info = this.session.open(absPath, { profile, context });
    this.sessionId += 1;
    this._record = { sourcePath: absPath, context, profile, root: root || null, format: info.format };
    this._persist();
    return this.describe({ includeText: true });
  }

  // Phase Beta 2 -- restore from a recovery snapshot. Opens the held source
// the same way _open does, then installs the recovered buffer as the live
// text (without writing to disk). The resulting session is dirty.
//
// Phase Beta 2 corrections:
//   QA pass 1:
//   * B2: a missing source no longer throws. Instead, we return
//     `{ recoveredAsUnsaved: true, ... }` so the caller can keep the
//     recovery record on disk and offer the user a source-less viewer.
//   QA pass 2 (this revision):
//   * B1 real source stat: openFromRecovery accepts the persistent
//     `sourceStat` from the recovery record (v2+) and uses it as the
//     session's authoritative on-disk stat. The earlier synthesized-
//     from-decompressed-text helper is unsafe for gzip and is no longer
//     used; the conflict path runs against the real source's byte-level
//     hash (sha1 over the on-disk bytes, gzip or plain).
//   * Property contract: the adopter passes `baseline` (one name; the
//     earlier `baselineOverride` alias is gone -- it is checked neither
//     here nor in the recovery store).
  openFromRecovery({ sourcePath, profile, context, root, buffer, baseline, sourceStat }) {
    if (typeof sourcePath !== 'string' || !sourcePath) {
      throw tagged('EARG', 'openFromRecovery requires a sourcePath.');
    }
    if (typeof buffer !== 'string') {
      throw tagged('EARG', 'openFromRecovery requires a buffer string.');
    }
    const abs = nodePath.resolve(sourcePath);
    const fs = (this.ioDeps && this.ioDeps.fs) || require('fs');
    // Source-missing fast-path (B2). We do NOT throw. The recovery file can
    // outlive its source (the user deleted or moved the source after the
    // crash); the buffer is still recoverable. The caller offers a source-
    // less viewer instead.
    if (!fs.existsSync(abs)) {
      return {
        recoveredAsUnsaved: true,
        sourceMissingRecovered: true,
        sourcePath: abs,
        profile: profile || 'generic',
        context: context || 'generic',
        format: 'plain',
        buffer,
        baseline: typeof baseline === 'string' ? baseline : '',
        dirty: !!buffer && buffer !== (typeof baseline === 'string' ? baseline : ''),
        // A missing source means we have no conflict anchor -- the recovery
        // record's `sourceStat` may still describe the bytes of the original
        // file. We surface it so the renderer can offer a viewer/copy UI
        // without ever writing the source.
        sourceStat: sourceStat || null,
      };
    }
    // Reuse the regular open path (filesystem read, format sniff, stat).
    const info = this.session.open(abs, { profile, context });
    this.sessionId += 1;
    this._record = { sourcePath: abs, context, profile, root: root || null, format: info.format };
    this._persist();
    // Install the recovered buffer on top of the freshly-loaded text. Patch
    // the doc baseline to the RECOVERED baseline so dirty tracking matches
    // what the user had on screen. When `baseline` is missing or empty we
    // fall back to the just-read disk text (the snapshot may have been made
    // on a clean buffer that exactly matched disk).
    const { withText } = require('./wrl-document');
    const resolvedBaseline = (typeof baseline === 'string' && baseline.length)
      ? baseline
      : info.text;
    this.session.doc = withText(this.session.doc, buffer);
    this.session.doc = { ...this.session.doc, baseline: resolvedBaseline };
    // B1 fix: use the REAL on-disk stat from the snapshot, NOT a derivation
    // from decompressed text. safeSave's detectExternalChange compares this
    // stat against the live disk on the next Save -- any post-snapshot
    // external change to the source file raises EEXTERNAL through the
    // existing conflict path.
    if (sourceStat && typeof sourceStat === 'object'
        && typeof sourceStat.size === 'number'
        && typeof sourceStat.hash === 'string'
        && typeof sourceStat.mtimeMs === 'number') {
      this.session.doc = { ...this.session.doc, stat: sourceStat };
    }
    // No fallback to a synthesized stat. Records that lack sourceStat (v1
    // legacy) are accepted by the recover store but explicit: the renderer
    // is signalled that the conflict path has no anchor, and the user must
    // use Save As or accept the conflict on the next Save. We surface that
    // through `recoveredFromLegacySnapshot: true`.
    return {
      ...this.describe({ includeText: true }),
      dirty: this.session.describe().dirty,
      recoveredAsUnsaved: false,
      recoveredFromLegacySnapshot: !sourceStat,
    };
  }

  // ---- state / editing -----------------------------------------------------

  describe({ includeText = false } = {}) {
    const d = this.session.describe({ includeText });
    if (d.open) d.sessionId = this.sessionId;
    return d;
  }

  // Guard every mutating op: a document must be open, and the caller's sessionId
  // (when supplied) must match the current one -- a stale renderer that missed a
  // reopen cannot write into the wrong document.
  _require(sessionId) {
    if (!this.session.isOpen()) throw tagged('ENOOPEN', 'No document is open.');
    if (sessionId != null && sessionId !== this.sessionId) {
      throw tagged('ESTALE', 'This editor session is stale; the open document changed.');
    }
  }

  setText(sessionId, text) {
    this._require(sessionId);
    if (typeof text !== 'string') throw tagged('EARG', 'text must be a string.');
    return { dirty: this.session.setText(text), sessionId: this.sessionId };
  }

  save(sessionId, text, { allowOverwrite = false } = {}) {
    this._require(sessionId);
    if (text != null && typeof text !== 'string') throw tagged('EARG', 'text must be a string.');
    const res = this.session.save(text, { allowOverwrite }); // writes ONLY to the held path
    if (this._record) this._record.format = res.format;
    this._persist();
    // Phase Beta 2 -- on a clean Save, drop the recovery snapshot. The Save
    // path is the canonical "the user has safely kept their work" event.
    // Failures (EEXTERNAL, EVERIFY) fall through without clearing (handled
    // by the throw above). This is unit-test-friendly: only an injected
    // recovery controller participates; the legacy single-module test path
    // is unaffected.
    if (res && res.ok && this.recoveryController) {
      this.recoveryController.recordClear();
    }
    return { ...res, sessionId: this.sessionId };
  }

  async saveAs(sessionId, text, { format = null } = {}) {
    this._require(sessionId);
    if (text != null && typeof text !== 'string') throw tagged('EARG', 'text must be a string.');
    const cur = this.session.describe();
    const dest = await this.promptSaveAs({ defaultPath: cur.sourcePath, format: format || cur.format });
    if (!dest) return { ok: false, canceled: true, sessionId: this.sessionId };
    const res = this.session.saveAs(dest, { text, format }); // dest came from MAIN's dialog
    // Re-point persistence at the user-chosen file. Its authorized context is now
    // "generic" (main's own dialog = user intent); restore will only re-check that
    // it still exists. The session id is unchanged -- same continuous edit buffer.
    this._record = { sourcePath: res.sourcePath, context: CONTEXT.GENERIC, profile: this._record ? this._record.profile : PROFILE.GENERIC, root: null, format: res.format };
    this._persist();
    return { ...res, sessionId: this.sessionId };
  }

  reload(sessionId) {
    this._require(sessionId);
    const res = this.session.reload();
    return { ...res, sessionId: this.sessionId };
  }

  // Read-only conflict probe -- tolerant of a null sessionId so the renderer can
  // poll cheaply without threading the id.
  checkConflict(sessionId) {
    if (!this.session.isOpen()) return { open: false };
    if (sessionId != null && sessionId !== this.sessionId) return { open: true, stale: true };
    return this.session.checkConflict();
  }

  // Optional "Open in External Editor" -- delegates to the injected launcher on
  // the SAME source file the native editor holds (no renderer-supplied path).
  openInExternal(sessionId) {
    this._require(sessionId);
    const { sourcePath } = this.session.describe();
    return { sourcePath, editorStatus: this.launchExternal(sourcePath) };
  }

  // Explicit close -- forget the persisted record so it is NOT auto-restored.
  close(sessionId) {
    this._require(sessionId);
    const was = this.session.close();
    this._record = null;
    this._clear();
    return was;
  }

  // Offer back the most-recent document, if it survives restore authorization.
  // Returns a describe()-shaped payload with { restored:true } or { restored:false, reason }.
  restore() {
    const record = this._loadRecord();
    if (!record) return { open: false, restored: false, reason: 'none' };
    const check = store.validateRestore(record, this.storeDeps);
    if (!check.ok) return { open: false, restored: false, reason: check.reason };
    const info = this.session.open(record.sourcePath, { profile: record.profile, context: record.context });
    this.sessionId += 1;
    this._record = { ...record, format: info.format };
    return { ...this.describe({ includeText: true }), restored: true };
  }

  // ---- persistence helpers -------------------------------------------------
  _persist() {
    if (this.userDataPath && this._record) store.saveSession(this.userDataPath, this._record, this.storeDeps);
  }

  _clear() {
    if (this.userDataPath) store.clearSession(this.userDataPath, this.storeDeps);
  }

  _loadRecord() {
    if (this._record) return this._record;
    if (this.userDataPath) return store.loadSession(this.userDataPath, this.storeDeps);
    return null;
  }
}

module.exports = { EditorController, PROFILE, CONTEXT };
