'use strict';
// Phase 7C3 -- the main-process bridge that turns an UNSAVED World editor buffer
// (the primary WRL or an authorized nested WRL) into an authorized full-world
// live-preview payload, WITHOUT writing any temporary file. It is the World twin
// of src/preview/mall-preview-bridge.js: same 7C1 overlay, same monotonic
// version/generation model, same "the renderer never names a path" posture --
// but the authorization authority is the World scan graph, not a held Mall item.
//
// Pure and dependency-injectable (no Electron; fs enters ONLY through injectable
// deps -- realpath confinement, directory listings, and the gzip-transparent
// saved-source reader -- exactly like preview-source.js / path-authorizer.js).
// The renderer sends ONLY { sessionId, text, bufferVersion }. This bridge:
//   1. resolves the editor session (injected describeSession) and requires an
//      OPEN World document whose id matches the caller's,
//   2. requires an open World Project whose CURRENT scan graph root matches the
//      session root (a scan from another project can never authorize),
//   3. requires the held source path to be lexically inside the root, a member
//      of the current graph's authorized WRL set (exact-case: the allow-list is
//      keyed by the on-disk case), and realpath-confined (symlink escapes are
//      re-refused at preview time),
//   4. builds the World authorization proof from THAT membership (never from
//      renderer input) and registers the buffer in the 7C1 BufferOverlay -- a
//      byte substitution for an already-authorized path, never a new grant,
//   5. installs a serving context for the wrlworld:// handler: the SAME
//      { projectRoot, authorized } the disk preview would use, plus an overlay
//      lookup that is consulted only AFTER normal path + graph authorization
//      (see resolveWorldRequest's overlayLookup dep),
//   6. returns the disk-equivalent preview payload (buildPreviewPayload) with
//      the edited PRIMARY text substituted in memory when the edited document is
//      the primary; a nested edit keeps the saved primary text and substitutes
//      through the scheme handler when X_ITE requests that exact nested path.
//
// New references authored in the unsaved buffer NEVER expand authorization: they
// are classified (new / missing / case-mismatch / remote / unsafe) and surfaced,
// and only the explicit "Find new files" action (rescanForNewFiles) runs the
// normal World rescan -- authorization then comes from the NEW disk graph, never
// from unsaved text alone.

const nodePath = require('path');
const nodeFs = require('fs');
const {
  createBufferOverlay, worldAuthorization, HARD_MAX_BYTES, AUTO_REFRESH_MAX_BYTES,
} = require('./buffer-overlay');
const {
  buildAuthorizedSet, worldBaseUrl, buildPreviewPayload,
} = require('../world-project/preview-source');
const { realpathInside, lexicallyInside } = require('../editor/path-authorizer');
const { extractUrlRefs } = require('../world-project/url-fields');
const { classifyReference, CATEGORY } = require('../world-project/path-policy');
const { readWrlSource } = require('./wrl-source');

const WORLD_PROFILE = 'world';

const relOf = (root, abs) =>
  nodePath.relative(nodePath.resolve(root), nodePath.resolve(abs)).split(nodePath.sep).join('/');

function dedupe(a) { return [...new Set(a)]; }

class WorldPreviewBridge {
  constructor(deps = {}) {
    this.overlay = deps.overlay || createBufferOverlay(deps.overlayDeps);
    // () => the editor controller's describe() shape: { open, sessionId, context,
    // sourcePath, ... }. The bridge never reaches into the controller directly.
    this.describeSession = deps.describeSession || (() => ({ open: false }));
    // Live World Project session getters (main injects worldSession accessors).
    this.getWorldRoot = deps.getWorldRoot || (() => null);
    this.getWorldPrimary = deps.getWorldPrimary || (() => null);
    // () => the LAST SUCCESSFUL scan result ({ status, root, primary, graph, ... })
    // or null. Authorization always reads the current scan through this getter,
    // so a "Find new files" rescan is picked up on the very next Update.
    this.getScan = deps.getScan || (() => null);
    // async () => a fresh scan (worldSession.scan()). The ONLY rescan trigger is
    // the explicit rescanForNewFiles action -- never a debounced preview.
    this.rescan = deps.rescan || (async () => { throw new Error('rescan not provided'); });
    // (absPath) => { text, wasGzipped }: gzip-transparent disk read, used for the
    // saved primary (nested edits), the payload builder, and "Show saved version".
    this.readSaved = deps.readSaved || ((p) => readWrlSource(p));
    this.resolvePath = deps.resolvePath || ((p) => nodePath.resolve(String(p)));
    this.realpathInside = deps.realpathInside || ((root, target) => realpathInside(root, target));
    this.lexicallyInside = deps.lexicallyInside || lexicallyInside;
    // (absDir) => string[]: case-preserved directory listing for classifying NEW
    // buffer references (exists / case-only sibling / missing) without trusting
    // exists() on case-insensitive filesystems -- same rule as the asset graph.
    this.listDir = deps.listDir || ((d) => { try { return nodeFs.readdirSync(d); } catch { return []; } });
    this.buildAuthorizedSet = deps.buildAuthorizedSet || buildAuthorizedSet;
    this.worldBaseUrl = deps.worldBaseUrl || worldBaseUrl;
    this.buildPreviewPayload = deps.buildPreviewPayload || buildPreviewPayload;
    this.extractUrlRefs = deps.extractUrlRefs || extractUrlRefs;
    this.classifyReference = deps.classifyReference || classifyReference;

    this._activeSessionId = null; // deterministic doc-switch cleanup
    // The wrlworld:// serving context while the editor live preview is active:
    // { sessionId, projectRoot, authorized, ignoreOverlay } or null. It is the
    // SAME shape the workspace disk preview installs -- the overlay only ever
    // adds bytes for one already-authorized WRL path on top of it.
    this._serving = null;
  }

  // Shared precondition gate. Returns { ok:true, src, root, primary, scan,
  // authorized, isPrimary } or { ok:false, reason }. NEVER trusts a renderer
  // path: the only inputs are the session id and main-held state.
  _authorize(sessionId) {
    const d = this.describeSession();
    if (!d || !d.open) return { ok: false, reason: 'no-document' };
    if (sessionId == null || d.sessionId !== sessionId) return { ok: false, reason: 'stale-session' };
    if (d.context !== 'world') return { ok: false, reason: 'not-world' };
    if (typeof d.sourcePath !== 'string' || d.sourcePath === '') return { ok: false, reason: 'no-source' };

    const root = this.getWorldRoot();
    const primary = this.getWorldPrimary();
    if (!root || !primary) return { ok: false, reason: 'no-world-project' };
    const scan = this.getScan();
    if (!scan || !scan.graph || !scan.root || !scan.primary) return { ok: false, reason: 'no-scan' };
    // A scan for a DIFFERENT project (stale after a project switch) can never
    // authorize this document.
    const absRoot = this.resolvePath(root);
    if (this.resolvePath(scan.root) !== absRoot) return { ok: false, reason: 'root-mismatch' };

    const held = this.resolvePath(d.sourcePath);
    if (!this.lexicallyInside(absRoot, held)) return { ok: false, reason: 'outside-root' };

    // Graph membership: the allow-list is keyed by resolved on-disk (exact-case)
    // paths, so a case-different or since-dropped document misses here. Only a
    // readable WRL node may receive a buffer override -- never an asset.
    const authorized = this.buildAuthorizedSet(scan.graph);
    const entry = authorized.get(held);
    if (!entry || entry.kind !== 'wrl') return { ok: false, reason: 'not-in-graph' };

    // Realpath confinement re-checked at preview time (a symlink swapped in
    // after the editor open must not leak content from outside the root).
    if (!this.realpathInside(absRoot, held)) return { ok: false, reason: 'symlink-escape' };

    const scanPrimary = this.resolvePath(scan.primary);
    return {
      ok: true, src: held, root: absRoot, primary: scanPrimary, scan, authorized,
      isPrimary: held === scanPrimary,
    };
  }

  // Deterministic doc-switch cleanup: a load for a NEW session invalidates the
  // previous session's overlay, so a prior nested buffer can never leak into a
  // later document's renders.
  _trackActive(sessionId) {
    if (this._activeSessionId != null && this._activeSessionId !== sessionId) {
      this.overlay.invalidateSession(this._activeSessionId);
      if (this._serving && this._serving.sessionId === this._activeSessionId) this._serving = null;
    }
    this._activeSessionId = sessionId;
  }

  // Classify every url reference in the UNSAVED buffer against the CURRENT
  // authorized set. Never loads, never authorizes -- classification only:
  //   newRefs     -- local, in-root, exists at exact case, but NOT in the graph
  //                  (the "New file reference found -> Find new files" case)
  //   missingRefs -- local, in-root, no such file
  //   caseRefs    -- local, in-root, exists only as a case-different sibling
  //   remoteRefs  -- network URLs (blocked, never fetched)
  //   unsafeRefs  -- absolute paths / root traversal (refused)
  _analyzeBufferRefs(text, editedAbs, root, authorized) {
    const dir = nodePath.dirname(editedAbs);
    const seen = new Set();
    const out = { newRefs: [], missingRefs: [], caseRefs: [], remoteRefs: [], unsafeRefs: [] };
    for (const ref of this.extractUrlRefs(text)) {
      const v = ref.value;
      if (seen.has(v)) continue;
      seen.add(v);
      const cls = this.classifyReference(v, dir, root);
      if (cls.category === CATEGORY.INLINE_SCRIPT || cls.category === CATEGORY.MALFORMED) continue;
      if (cls.remote) { out.remoteRefs.push(v); continue; }
      if (cls.category === CATEGORY.ABSOLUTE || cls.category === CATEGORY.TRAVERSAL) {
        out.unsafeRefs.push(v);
        continue;
      }
      const abs = this.resolvePath(cls.resolved);
      if (authorized.has(abs)) continue; // already authorized: serves normally
      const rel = cls.projectRelative || v;
      const base = nodePath.basename(abs);
      let listing;
      try { listing = this.listDir(nodePath.dirname(abs)) || []; } catch { listing = []; }
      if (listing.includes(base)) out.newRefs.push(rel);
      else {
        const ci = listing.find((n) => n.toLowerCase() === base.toLowerCase());
        if (ci) out.caseRefs.push({ referenced: rel, actual: ci });
        else out.missingRefs.push(rel);
      }
    }
    for (const k of ['newRefs', 'missingRefs', 'remoteRefs', 'unsafeRefs']) out[k] = dedupe(out[k]);
    return out;
  }

  // Authorize + register the unsaved buffer, begin a preview generation, install
  // the serving context, and return the full-world render payload. The payload
  // is the disk preview's own shape (buildPreviewPayload) so the reused World
  // preview controller renders it verbatim; the edited PRIMARY's text is the
  // overlay's copy (main is the source of truth for what renders), while a
  // NESTED edit keeps the saved primary and substitutes via the scheme handler.
  load({ sessionId, text, bufferVersion } = {}) {
    const gate = this._authorize(sessionId);
    if (!gate.ok) return gate;
    if (typeof text !== 'string') return { ok: false, reason: 'bad-text' };
    if (!Number.isInteger(bufferVersion) || bufferVersion < 0) return { ok: false, reason: 'bad-version' };

    const src = gate.src;
    const docId = src; // one document per editor session; identity is its path
    const proof = worldAuthorization(src, { inGraph: true });

    let desc;
    try {
      desc = this.overlay.register({
        sessionId, docId, path: src, profile: WORLD_PROFILE, bufferVersion, text, authorization: proof,
      });
    } catch (e) {
      if (e.code === 'EBUFFERTOOLARGE') {
        return { ok: false, reason: 'too-large', sizeTier: 'refused', hardMaxBytes: HARD_MAX_BYTES };
      }
      if (e.code === 'ESTALEVERSION') {
        // Same idempotent-re-render rule as the Mall bridge: a manual Update /
        // layout re-show of the CURRENT edit re-renders the same authorized
        // bytes under a fresh generation; only a strictly-older version stays
        // refused as stale.
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
    // Read the text back THROUGH the overlay so what renders is provably the
    // registered, authorized copy for this generation (never a renderer echo).
    const resolved = this.overlay.resolve({ sessionId, generation, path: src, docId, profile: WORLD_PROFILE });
    if (resolved.status !== 'overlay') {
      return { ok: false, reason: 'resolve-failed', status: resolved.status };
    }

    // Serving context for the wrlworld:// handler: the SAME root + allow-list
    // the disk preview uses. Nested overlay substitution happens in the handler
    // AFTER its own confinement + allow-list check (overlayTextFor below).
    this._serving = {
      sessionId, projectRoot: gate.root, authorized: gate.authorized, ignoreOverlay: false,
    };

    const payload = this.buildPreviewPayload(gate.scan, { readSource: (p) => this.readSaved(p) });
    const buffer = this._analyzeBufferRefs(resolved.text, src, gate.root, gate.authorized);
    const out = {
      ...payload,
      ok: true,
      profile: WORLD_PROFILE,
      generation,
      bufferVersion,
      sizeTier: desc.sizeTier,
      editedRel: relOf(gate.root, src),
      editedIsPrimary: gate.isPrimary,
      buffer,
      // Merge buffer-scoped findings into the disk advisory lists so the reused
      // World warnings panel surfaces them without a second display path.
      remoteUrls: dedupe([...(payload.remoteUrls || []), ...buffer.remoteRefs]),
      missingAssets: dedupe([...(payload.missingAssets || []), ...buffer.missingRefs]),
      unsafeRefs: dedupe([...(payload.unsafeRefs || []), ...buffer.unsafeRefs]),
      caseMismatches: [...(payload.caseMismatches || []), ...buffer.caseRefs],
    };
    if (gate.isPrimary) {
      // The edited document IS the primary: substitute the buffer as the root
      // scene string. Base URL unchanged (the primary's own wrlworld:// dir), so
      // every nested reference still resolves through the authorized graph.
      out.text = resolved.text;
      out.wasGzipped = false;
      out.ok = true;
      out.status = 'ok';
      out.error = null;
    } else {
      // A NESTED edit: the root scene stays the saved primary; the override is
      // served by the scheme handler. The edited text also rides along so the
      // renderer can pre-validate it through X_ITE BEFORE replacing the world --
      // a failed Inline load is only an async warning to X_ITE, so without this
      // check a broken nested buffer would silently replace the full scene with
      // the edited piece missing instead of keeping the last good version.
      out.editedText = resolved.text;
    }
    return out;
  }

  // "Show saved version": render the full World Project ENTIRELY from disk. The
  // overlay entry is preserved (the unsaved state survives; a later Update
  // returns to it), but this render's scheme reads skip the overlay.
  saved({ sessionId } = {}) {
    const gate = this._authorize(sessionId);
    if (!gate.ok) return gate;
    const payload = this.buildPreviewPayload(gate.scan, { readSource: (p) => this.readSaved(p) });
    this._serving = {
      sessionId, projectRoot: gate.root, authorized: gate.authorized, ignoreOverlay: true,
    };
    return {
      ...payload,
      ok: payload.ok !== false,
      profile: WORLD_PROFILE,
      saved: true,
      editedRel: relOf(gate.root, gate.src),
      editedIsPrimary: gate.isPrimary,
    };
  }

  // Explicit "Find new files": run the NORMAL World rescan on the held project
  // session. The editor buffer and the overlay are untouched; the next Update
  // authorizes against the new graph via getScan(). Never called automatically.
  async rescanForNewFiles({ sessionId } = {}) {
    const gate = this._authorize(sessionId);
    if (!gate.ok) return gate;
    let scan;
    try {
      scan = await this.rescan();
    } catch (e) {
      return { ok: false, reason: e.code === 'EBUSY' ? 'busy' : 'rescan-failed', error: String((e && e.message) || e) };
    }
    if (!scan || scan.status !== 'ok') {
      return { ok: false, reason: 'rescan-failed', error: (scan && scan.error) || null };
    }
    const s = (scan.graph && scan.graph.stats) || {};
    return {
      ok: true,
      counts: {
        wrlFiles: s.wrlFiles || 0,
        uniqueAssets: s.uniqueAssets || 0,
        missing: s.missing || 0,
        caseMismatches: s.caseMismatches || 0,
      },
    };
  }

  // ---- wrlworld:// handler integration ------------------------------------
  // The serving context while the editor live preview is active (same shape as
  // the workspace's worldPreview global), or null when inactive.
  servingContext() {
    return this._serving
      ? { projectRoot: this._serving.projectRoot, authorized: this._serving.authorized }
      : null;
  }

  // The overlayLookup hook for resolveWorldRequest: called only AFTER the
  // request passed scheme/root confinement and the graph allow-list, and only
  // for WRL nodes. Returns the buffer text on an exact-path overlay hit for the
  // active session, else null (normal authorized disk read). Overlay presence
  // alone can never make a request valid -- unauthorized requests are refused
  // before this hook is ever consulted.
  overlayTextFor(absPath) {
    if (!this._serving || this._serving.ignoreOverlay) return null;
    const r = this.overlay.resolve({
      sessionId: this._serving.sessionId,
      path: this.resolvePath(absPath),
      profile: WORLD_PROFILE,
    });
    return r.status === 'overlay' ? r.text : null;
  }

  // Accept the completion of a generation (older/replayed generations are
  // refused by the overlay -- an out-of-order render can never become current).
  accept({ sessionId, generation } = {}) {
    return this.overlay.acceptGeneration(sessionId, generation);
  }

  // Deterministic cleanup. Document close/switch keeps the session open but
  // drops the overlay; editor close / renderer reload / navigate-away / project
  // switch invalidates the session and deactivates serving.
  invalidateDocument(sessionId) {
    if (this._serving && this._serving.sessionId === sessionId) this._serving = null;
    return this.overlay.invalidateDocument(sessionId);
  }

  invalidateSession(sessionId) {
    if (this._activeSessionId === sessionId) this._activeSessionId = null;
    if (this._serving && this._serving.sessionId === sessionId) this._serving = null;
    return this.overlay.invalidateSession(sessionId);
  }

  clear() {
    this._activeSessionId = null;
    this._serving = null;
    this.overlay.clear();
  }

  // Leak-assertion surface for QA (overlay/generation counts must be zero after
  // close; the serving context must be gone). Never exposes buffer text.
  leak() {
    const d = this.overlay.describe();
    return { ...d, serving: !!this._serving };
  }

  describe(sessionId) { return this.overlay.describe(sessionId); }
}

function createWorldPreviewBridge(deps) {
  return new WorldPreviewBridge(deps);
}

module.exports = {
  WorldPreviewBridge,
  createWorldPreviewBridge,
  WORLD_PROFILE,
  HARD_MAX_BYTES,
  AUTO_REFRESH_MAX_BYTES,
};
