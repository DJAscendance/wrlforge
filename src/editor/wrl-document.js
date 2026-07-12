'use strict';
// Native editor document model (Phase 7B) -- a PURE state descriptor for one open
// WRL buffer. No fs, no Electron, no CodeMirror: just the transitions the app
// reasons about (load -> edit -> save/reload) so dirty-state and format tracking
// are unit-testable in isolation, exactly like the parser and package-plan.
//
// The live text lives in the editor (CodeMirror) in the renderer; this model
// carries the SESSION facts the main process owns: where the file is, whether it
// is gzip- or plain-encoded, the baseline text last synced to disk (for a correct
// dirty comparison), and the on-disk state stamp used for external-change
// detection (see file-io.js). It never reads or writes files itself.

// A WRL source is stored on disk either plain UTF-8 or gzip-compressed. We track
// which so a save round-trips the SAME format (a gzip source is never silently
// rewritten as plain -- a locked requirement).
const FORMAT = Object.freeze({ PLAIN: 'plain', GZIP: 'gzip' });

function formatFromGzip(wasGzipped) {
  return wasGzipped ? FORMAT.GZIP : FORMAT.PLAIN;
}

// Build a document from a load result (see file-io.loadDocument). `baseline` is
// the text as it exists on disk; `text` starts equal to it (a freshly opened
// buffer is not dirty). `stat` is the on-disk state stamp for conflict detection.
function createDocument({ sourcePath, text, format, stat }) {
  if (format !== FORMAT.PLAIN && format !== FORMAT.GZIP) {
    throw new Error(`Unknown WRL document format '${format}'`);
  }
  return {
    sourcePath,
    format,
    baseline: text, // text last known to match disk
    text, // current buffer text
    stat: stat || null, // { mtimeMs, size, hash } | null
  };
}

// Return a new document with the buffer text replaced. Dirty state is DERIVED
// from `text !== baseline`, never stored separately, so it cannot drift out of
// sync with the actual contents.
function withText(doc, text) {
  return { ...doc, text };
}

function isDirty(doc) {
  return doc.text !== doc.baseline;
}

// After a successful save (or a reload), the buffer now matches disk: adopt the
// just-written text as the new baseline and record the fresh on-disk stat. When
// reloading, pass the disk text as `text` so both baseline and buffer reset to it.
function markSynced(doc, { text, stat }) {
  const next = text != null ? text : doc.text;
  return { ...doc, baseline: next, text: next, stat: stat || doc.stat };
}

// Re-point a document at a new destination (Save As). The new path becomes the
// source; format may change if the user chose a different target encoding. The
// buffer text is unchanged but is now the baseline for the new file.
function withSource(doc, { sourcePath, format, stat }) {
  return {
    ...doc,
    sourcePath,
    format: format || doc.format,
    baseline: doc.text,
    stat: stat || null,
  };
}

module.exports = {
  FORMAT,
  formatFromGzip,
  createDocument,
  withText,
  isDirty,
  markSynced,
  withSource,
};
