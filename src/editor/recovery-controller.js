'use strict';
// Phase Beta 2 — Crash Recovery controller.
//
// Owns the lifecycle of a single in-flight editor session's recovery snapshot:
//   * recordDirtyState     -- the renderer pings here on every keystroke (or
//                            throttled); we coalesce writes through a
//                            configurable debounce so the recovery file is
//                            never written per-keystroke. The OLDEST
//                            in-flight timer fires the snapshot.
//
//   * readRecovery / clearRecovery -- startup-time read; on success, the
//                            renderer shows the Restore / Start Fresh prompt.
//
//   * adoptRecovery        -- Restore. Open the held source (if any), insert
//                            the recovered dirty buffer as the live editor
//                            state, mark it dirty, return describe() so the
//                            caller can navigate. The source file is NEVER
//                            touched here -- the buffer stays unsaved.
//
//   * recordClear          -- after a successful Save or an explicit Discard,
//                            drop the recovery snapshot. The Save / Discard
//                            paths report through THIS method rather than
//                            reaching into the store directly, so lifecycle
//                            is a single owner.
//
// Design choices the owner reviewed:
//   * Debounce window: 5 seconds. Long enough to coalesce normal typing, short
//     enough that a real crash within the next typing burst does not lose work.
//     Tests inject `deps.debounceMs`.
//   * The renderer is the SOURCE of dirty truth; main records only what it
//     receives. The store never invents a record from main's state alone.
//   * A recovery record for a "new file" (sourcePath=null) is supported -- a
//     user editing a file that was never saved still gets a recovery snapshot
//     on the next crash, and Restore opens it in a generic unsaved session.
//
// Injectable deps (forwarded where helpful): { fs, recoveryStoreDeps,
// debounceMs, now } -- every code path is unit-testable without Electron.

const store = require('./recovery-store');

// 5s is the cap between a keystroke and a recovery file. Tests override this.
const DEFAULT_DEBOUNCE_MS = 5000;

function isPathString(v) {
  return typeof v === 'string' && v.length > 0;
}

function makeContextDescriptor({ sourcePath = null, context = 'generic', profile = 'generic', root = null, format = 'plain', activeWorkspace = 'editor' }) {
  return {
    sourcePath: sourcePath == null ? null : String(sourcePath),
    context: String(context),
    profile: String(profile),
    root: root == null ? null : String(root),
    format: format === 'gzip' ? 'gzip' : 'plain',
    activeWorkspace: ['mall', 'world', 'editor'].includes(activeWorkspace) ? activeWorkspace : 'editor',
  };
}

class RecoveryController {
  constructor(deps = {}) {
    this.userDataPath = deps.userDataPath || null;
    this.storeDeps = deps.recoveryStoreDeps || deps.storeDeps || undefined;
    this.debounceMs = (deps.debounceMs != null && deps.debounceMs >= 0) ? deps.debounceMs : DEFAULT_DEBOUNCE_MS;
    this.openSession = deps.openSession || (() => { throw new Error('No session handler injected.'); });
    this.now = deps.now || (() => Date.now());
    // In-flight pending record (most-recent payload that hasn't been flushed
    // to disk). We keep both it and a timer so a rapid new keystroke after a
    // flush can rearm.
    this._pending = null;
    this._timer = null;
    // An optional logger for diagnostics; we do NOT default to console so a
    // headless unit test stays quiet.
    this._log = deps.log || (() => {});
  }

  // ---- lifecycle ----------------------------------------------------------

  // Snapshot the current dirty state. Coalesces frequent calls within the
  // debounce window. `payload` carries everything the store needs to
  // persist. The live on-disk stat is supplied by an injected `getSourceStat`
  // getter (provided by main) so we can carry the real conflict-detection
  // material with the snapshot -- not a derivation from decompressed text,
  // which is unsafe for gzip sources (Phase Beta 2 QA pass 2 fix B1).
  recordDirtyState(payload) {
    if (!this.userDataPath) return { ok: false, reason: 'no-userdata' };
    if (!payload || typeof payload.buffer !== 'string') {
      return { ok: false, reason: 'bad-payload' };
    }
    const ctx = makeContextDescriptor(payload);
    const sourceStat = (typeof this.getSourceStat === 'function')
      ? this.getSourceStat(payload.sourcePath)
      : null;
    this._pending = {
      // baseline travels with the renderer so dirty survives a page reload
      // (the editor restores baseline + text together).
      baseline: typeof payload.baseline === 'string' ? payload.baseline : '',
      buffer: payload.buffer,
      dirty: !!payload.dirty,
      sourceStat,
      updatedAt: this.now(),
      ...ctx,
    };
    this._schedule();
    return { ok: true };
  }

  _schedule() {
    if (this._timer) return; // already armed; the OLDEST in-flight wins
    const ms = this.debounceMs;
    if (ms === 0) {
      // Synchronous path -- tests + non-async harnesses.
      this._flush();
      return;
    }
    this._timer = setTimeout(() => {
      this._timer = null;
      this._flush();
    }, ms);
    // unref so a pending flush never holds the process open
    if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
  }

  _flush() {
    if (!this._pending) return;
    const rec = store.makeRecord(this._pending);
    this._pending = null;
    if (!this.userDataPath) return;
    const ok = store.saveRecovery(this.userDataPath, rec, this.storeDeps);
    if (!ok) this._log({ event: 'recovery-flush-failed' });
  }

  // Force-flush any in-flight snapshot (used on graceful Close + on a clear
  // request so a fast Discard immediately forgets the pending state without a
  // lingering timer). Returns nothing -- the result is observable through
  // loadRecovery() / clearRecovery().
  forceFlush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._flush();
  }

  // Forget the recovery snapshot. Called after successful Save, explicit
  // Discard, or the user's Start Fresh choice. Drops any pending in-flight
  // snapshot too (so a Discard right after a keystroke does not race a flush).
  recordClear() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._pending = null;
    if (!this.userDataPath) return { ok: false, reason: 'no-userdata' };
    const ok = store.clearRecovery(this.userDataPath, this.storeDeps);
    return { ok };
  }

  // ---- startup-time API ---------------------------------------------------

  // Read whatever recovery exists (best-effort, never throws). Returns
  // { found, record?, reason } -- the renderer turns `found` into the prompt
  // and `reason` into a diagnostic log line so a corrupt JSON never blocks
  // startup.
  readRecovery() {
    if (!this.userDataPath) return { found: false, reason: 'no-userdata' };
    const res = store.loadRecovery(this.userDataPath, this.storeDeps);
    if (!res.ok) {
      this._log({ event: 'recovery-load-skipped', reason: res.reason });
      return { found: false, reason: res.reason };
    }
    return { found: true, record: res.record };
  }

  // Adopt a recovery record -- Restore. Returns describe() of the newly
  // opened session (or { ok:false, reason } when the record cannot be
  // applied). The source file is NEVER written: the buffer is loaded as the
  // live text and marked dirty.
  //
  // Phase Beta 2 corrections (QA pass 1):
  //   * The recovery snapshot is NEVER cleared by this method. The user has
  //     not yet saved the recovered work; clearing the snapshot here would
  //     create a data-loss window where a second crash mid-edit loses the
  //     restored buffer. Recovery is now cleared ONLY by:
  //       - successful Save (main.js editor:save on ok:true)
  //       - explicit Discard (renderer action → main editor:close)
  //       - explicit Start Fresh (renderer action → main editor:recoveryClear)
  //   * A missing-source failure is NOT routed through Start Fresh. The
  //     recovered buffer is offered as a source-less unsaved session; the
  //     recovery file stays on disk until the user makes a deliberate choice.
  //   * The injected `openSession` no longer throws; it returns a structured
  //     result so this method can route cleanly without try/catch races.
  //
  // Two shapes:
  //   { sourcePath, ... }         -- open the held path, use the recovered
  //                                 buffer as the live text (baseline from
  //                                 disk is computed on demand via openSession).
  //   { sourcePath: null, ... }   -- the buffer is a "new file" we never
  //                                 saved; we cannot recover it through the
  //                                 native editor's openSession (which always
  //                                 points at a file). The renderer falls back
  //                                 to opening an EMPTY session, then sets the
  //                                 buffer text through the documented setText
  //                                 path and marks it dirty. We return the
  //                                 recovered buffer so it can.
  adoptRecovery(record) {
    if (!record) return { ok: false, reason: 'no-record' };
    const v = store.validateRecord(record);
    if (!v.ok) return { ok: false, reason: v.reason };

    // Source-bearing recovery: open the held path normally, then the renderer
    // replaces the buffer text on top.
    if (isPathString(record.sourcePath)) {
      // The injected openSession may legitimately fail when the source file is
      // missing -- the recovery file can outlive its source. The producer
      // (EditorController.openFromRecovery) returns a structured result in
      // that case; we DO NOT auto-clear recovery, and we DO NOT throw.
      const info = this.openSession({
        sourcePath: record.sourcePath,
        profile: record.profile,
        context: record.context,
        root: record.root,
        // The recovered baseline is the authoritative "what was on disk at
        // snapshot time". openFromRecovery uses it to override the doc
        // baseline so a fresh session restores the user's view of dirty.
        baseline: record.baseline,
        // The persisted sourceStat (v2+ records) is the authoritative
        // conflict-detection material on the next Save -- it carries the
        // REAL on-disk stat captured at snapshot time (size + sha1 of the
        // file bytes, gzip or plain). v1 records lack this field; openFrom
        // Recovery falls back to a viewer because there is no safeSave
        // conflict anchor.
        sourceStat: record.sourceStat || null,
        buffer: record.buffer,
      });
      // CRITICAL: do NOT clear the recovery record here. The user has only
      // chosen to restore -- they have not yet saved. A second crash before
      // any new edit would have nothing to recover. The record stays active
      // until the user performs a clean Save, an explicit Discard, or an
      // explicit Start Fresh (B3 fix).
      if (info && info.recoveredAsUnsaved) {
        return {
          ok: true,
          restored: true,
          activeWorkspace: record.activeWorkspace,
          sourceRecovered: false,
          sourceMissingRecovered: true,
          info,
        };
      }
      return {
        ok: true,
        restored: true,
        info,
        activeWorkspace: record.activeWorkspace,
        sourceRecovered: true,
      };
    }

    // Unsaved-no-source recovery: return the recovered buffer; the renderer
    // opens a fresh unsaved session and writes the buffer into it. Recovery
    // stays on disk -- the renderer may still edit this buffer further.
    return {
      ok: true,
      restored: true,
      activeWorkspace: record.activeWorkspace,
      sourceRecovered: false,
      sourceMissingRecovered: false,
      info: null,
      buffer: record.buffer,
      profile: record.profile,
      context: record.context,
      format: record.format,
    };
  }

  // ---- diagnostics -------------------------------------------------------
  // Internal-only. Used by tests + the optional main-side log to report what
  // the recovery controller would do without touching the disk.
  hasPending() { return !!this._pending; }
  hasTimer() { return !!this._timer; }
}

module.exports = { RecoveryController, DEFAULT_DEBOUNCE_MS };
