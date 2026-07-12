'use strict';
// Native editor session (Phase 7B) -- the main-process holder for the ONE open
// editor document. It composes the pure document model (wrl-document.js) with the
// safe file I/O (file-io.js) and, crucially, OWNS the source path: the renderer
// supplies buffer text and intent, never a path to write. Save targets the held
// path; Save As targets a path the main process obtained from its own dialog.
// This mirrors the World lane's "main owns every project path" posture.
//
// Injectable `deps` (forwarded to file-io) keep the whole save/conflict surface
// unit-testable without real disk faults.

const {
  createDocument, withText, withSource, markSynced, isDirty, FORMAT,
} = require('./wrl-document');
const {
  loadDocument, reloadDocument, safeSave, detectExternalChange,
} = require('./file-io');

class EditorSession {
  constructor(deps) {
    this.deps = deps || undefined;
    this.doc = null;
    this.context = null; // 'mall' | 'world' | 'generic' -- where the file came from
    this.profile = 'generic';
  }

  isOpen() {
    return !!this.doc;
  }

  // Load a file into the buffer. `context`/`profile` record the lane so the
  // renderer can offer the right "back to Mall/World" navigation. The caller
  // (main) is responsible for having validated `filePath` for its context.
  open(filePath, { profile = 'generic', context = 'generic' } = {}) {
    const loaded = loadDocument(filePath, this.deps);
    this.doc = createDocument({
      sourcePath: loaded.sourcePath, text: loaded.text, format: loaded.format, stat: loaded.stat,
    });
    this.context = context;
    this.profile = profile;
    return this.describe({ includeText: true });
  }

  // A JSON-safe snapshot for the renderer. Text is included only on open/reload.
  describe({ includeText = false } = {}) {
    if (!this.doc) return { open: false };
    const out = {
      open: true,
      sourcePath: this.doc.sourcePath,
      format: this.doc.format,
      gzip: this.doc.format === FORMAT.GZIP,
      dirty: isDirty(this.doc),
      profile: this.profile,
      context: this.context,
      stat: this.doc.stat,
    };
    if (includeText) {
      out.text = this.doc.text;
      // The on-disk baseline travels with the text so the renderer can track
      // dirty locally (buffer !== baseline) after a page reload/navigation --
      // unsaved edits are preserved across Mall<->World<->editor page switches.
      out.baseline = this.doc.baseline;
    }
    return out;
  }

  // Sync the buffer text from the renderer (for dirty tracking); returns dirty.
  setText(text) {
    if (!this.doc) throw new Error('No document is open.');
    this.doc = withText(this.doc, text);
    return isDirty(this.doc);
  }

  // Save the buffer back to the held path in the SAME format. Refuses (throws
  // EEXTERNAL) if the file changed on disk since it was opened, unless the caller
  // resolved the conflict and passes allowOverwrite. On success the buffer is the
  // new baseline and the fresh on-disk stat is recorded.
  save(text, { allowOverwrite = false } = {}) {
    if (!this.doc) throw new Error('No document is open.');
    const buffer = text != null ? text : this.doc.text;
    const res = safeSave({
      filePath: this.doc.sourcePath,
      text: buffer,
      format: this.doc.format,
      expectedStat: this.doc.stat,
      allowOverwrite,
    }, this.deps);
    this.doc = markSynced(withText(this.doc, buffer), { text: buffer, stat: res.stat });
    return {
      ok: true, sourcePath: this.doc.sourcePath, format: this.doc.format,
      dirty: false, stat: res.stat, backup: res.backup, bytesWritten: res.bytesWritten,
    };
  }

  // Save to a NEW destination (path supplied by main's Save dialog). The session
  // re-points at the new file; format may change (e.g. gzip source -> plain copy).
  saveAs(destPath, { text = null, format = null } = {}) {
    if (!this.doc) throw new Error('No document is open.');
    const buffer = text != null ? text : this.doc.text;
    const fmt = format || this.doc.format;
    const res = safeSave({ filePath: destPath, text: buffer, format: fmt }, this.deps);
    this.doc = withSource(withText(this.doc, buffer), { sourcePath: destPath, format: fmt, stat: res.stat });
    return { ok: true, sourcePath: destPath, format: fmt, dirty: false, stat: res.stat, backup: res.backup };
  }

  // Discard buffer edits and re-read from disk (resolves a conflict by taking the
  // on-disk version). Returns the disk text so the renderer resets the editor.
  reload() {
    if (!this.doc) throw new Error('No document is open.');
    const loaded = reloadDocument(this.doc.sourcePath, this.deps);
    this.doc = markSynced(this.doc, { text: loaded.text, stat: loaded.stat });
    return { text: loaded.text, format: this.doc.format, stat: loaded.stat, dirty: false };
  }

  // Has the source changed on disk since we last synced? Cheap, read-only.
  checkConflict() {
    if (!this.doc) return { open: false };
    const change = detectExternalChange(this.doc.stat, this.doc.sourcePath, this.deps);
    return { open: true, changed: change.changed, reason: change.reason };
  }

  close() {
    const was = this.describe();
    this.doc = null;
    this.context = null;
    this.profile = 'generic';
    return was;
  }
}

module.exports = { EditorSession };
