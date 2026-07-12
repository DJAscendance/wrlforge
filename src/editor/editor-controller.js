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
