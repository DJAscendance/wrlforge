'use strict';
// Native editor file I/O (Phase 7B) -- the ONLY fs-touching part of the editor
// lane. Conservative, backup-first, verify-before-commit saving plus
// external-change detection. Every fs/zlib/crypto/clock touch goes through an
// injectable `deps` bag so the interrupted-write, corrupt-write, and
// conflict-detection paths are exercised by unit tests without real disk faults.
//
// Reuses the production primitives rather than re-deriving them:
//   * isGzip (magic bytes)        <- src/files/vrml-file.js
//   * readWrlSource (gzip-transparent load) <- src/preview/wrl-source.js
//   * backupPath (timestamped, collision-free naming) <- src/files/backups.js
//
// Format is round-tripped exactly: a gzip source saves back as gzip, a plain
// source as plain. A gzip file is NEVER silently rewritten as plain.

const nodeFs = require('fs');
const nodeZlib = require('zlib');
const crypto = require('crypto');
const { isGzip } = require('../files/vrml-file');
const { readWrlSource } = require('../preview/wrl-source');
const { backupPath } = require('../files/backups');
const { FORMAT, formatFromGzip } = require('./wrl-document');

// Default dependency bag: the real platform. Tests pass a partial override.
function resolveDeps(deps) {
  return {
    fs: (deps && deps.fs) || nodeFs,
    zlib: (deps && deps.zlib) || nodeZlib,
    hash: (deps && deps.hash) || defaultHash,
    now: (deps && deps.now) || (() => new Date()),
    readSource: (deps && deps.readSource) || readWrlSource,
  };
}

function defaultHash(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

// --- state stamp for external-change detection -------------------------------
// A cheap size+mtime hint plus an authoritative content hash. Hash is the
// tiebreaker (mtime granularity/preservation varies across filesystems and
// tools), so a file that was rewritten with identical bytes is NOT a conflict,
// and a same-size edit still is.
function statFile(filePath, deps) {
  const d = resolveDeps(deps);
  const st = d.fs.statSync(filePath);
  const raw = d.fs.readFileSync(filePath);
  return { mtimeMs: st.mtimeMs, size: st.size, hash: d.hash(raw) };
}

// Compare a previously captured stamp to the file on disk NOW. Returns
// { changed, reason, current }. A vanished file counts as changed.
function detectExternalChange(prevStat, filePath, deps) {
  const d = resolveDeps(deps);
  if (!d.fs.existsSync(filePath)) {
    return { changed: true, reason: 'deleted', current: null };
  }
  const current = statFile(filePath, deps);
  if (!prevStat) return { changed: false, reason: 'no-baseline', current };
  if (current.hash !== prevStat.hash) {
    const reason = current.size !== prevStat.size ? 'size' : 'content';
    return { changed: true, reason, current };
  }
  return { changed: false, reason: 'unchanged', current };
}

// --- load --------------------------------------------------------------------
// Open a WRL into a plain-text buffer, transparently decompressing gzip. Returns
// { sourcePath, text, format, stat } ready for wrl-document.createDocument.
function loadDocument(filePath, deps) {
  const d = resolveDeps(deps);
  const { text, wasGzipped } = d.readSource(filePath);
  return {
    sourcePath: filePath,
    text,
    format: formatFromGzip(wasGzipped),
    stat: statFile(filePath, deps),
  };
}

// --- encode / decode ---------------------------------------------------------
function encodeForSave(text, format, deps) {
  const d = resolveDeps(deps);
  const utf8 = Buffer.from(text, 'utf8');
  if (format === FORMAT.GZIP) return d.zlib.gzipSync(utf8, { level: 9 });
  return utf8;
}

// Decode bytes back to text per format, using magic bytes as the ground truth so
// verification catches a format mismatch (e.g. a save that failed to compress).
function decodeBytes(bytes, format, deps) {
  const d = resolveDeps(deps);
  if (format === FORMAT.GZIP) {
    if (!isGzip(bytes)) throw new Error('expected gzip bytes but magic bytes are absent');
    return d.zlib.gunzipSync(bytes).toString('utf8');
  }
  return bytes.toString('utf8');
}

// --- safe save ---------------------------------------------------------------
// Conservative save that never leaves the destination in a half-written state:
//   1. encode text (gzip when the target format is gzip)
//   2. refuse if the destination changed under us (unless allowOverwrite)
//   3. write a temp sibling, flushing to disk (fsync) and closing it
//   4. VERIFY the temp reopens and decodes back to exactly `text`
//   5. back up the prior file to a timestamped, collision-free name
//   6. atomically rename the verified temp over the destination
//   7. report success only after the verified swap
//
// The original is only ever replaced by an already-verified temp, so ANY failure
// (encode, write, fsync, verify) leaves the source file untouched and removes the
// temp -- the caller keeps the buffer dirty and shows the error. Returns
// { ok, bytesWritten, backup, stat, format }.
function safeSave({ filePath, text, format, expectedStat, allowOverwrite }, deps) {
  const d = resolveDeps(deps);
  const fmt = format || FORMAT.PLAIN;

  // (2) conflict guard -- before touching anything on disk.
  if (!allowOverwrite && expectedStat && d.fs.existsSync(filePath)) {
    const change = detectExternalChange(expectedStat, filePath, deps);
    if (change.changed) {
      throw taggedError('EEXTERNAL',
        `The file changed on disk since it was opened (${change.reason}); refusing to overwrite.`,
        { current: change.current });
    }
  }

  // (1) encode.
  const bytes = encodeForSave(text, fmt, deps);

  const tmpPath = tempSiblingPath(filePath, d);
  try {
    // (3) write temp sibling with an explicit flush+close. Inside the try so a
    // failure mid-write (which may still have created the temp via openSync) is
    // cleaned up too -- the temp is never left presented as a completed save.
    writeAndFlush(tmpPath, bytes, d);

    // (4) verify the temp round-trips before we let it become the file.
    const back = d.fs.readFileSync(tmpPath);
    const decoded = decodeBytes(back, fmt, deps);
    if (decoded !== text) {
      throw taggedError('EVERIFY', 'Written file did not verify: decoded contents differ from the buffer.');
    }

    // (5) back up the prior file (timestamped -> never clobbers an unrelated
    // backup; that is the documented rotation rule).
    let backup = null;
    if (d.fs.existsSync(filePath)) {
      backup = backupPath(filePath, d.now);
      d.fs.copyFileSync(filePath, backup);
    }

    // (6) atomic replace.
    d.fs.renameSync(tmpPath, filePath);

    // (7) success -- stamp the freshly written file for future conflict checks.
    return { ok: true, bytesWritten: bytes.length, backup, format: fmt, stat: statFile(filePath, deps) };
  } catch (err) {
    // Never leave the temp presented as a completed save; original stays intact.
    safeUnlink(tmpPath, d);
    throw err;
  }
}

// Reload the on-disk contents into a fresh buffer, discarding buffer edits. Same
// shape as loadDocument; the caller resets baseline+buffer to this (see
// wrl-document.markSynced).
function reloadDocument(filePath, deps) {
  return loadDocument(filePath, deps);
}

// --- helpers -----------------------------------------------------------------
function tempSiblingPath(filePath, d) {
  // A hidden sibling in the same directory so the final rename is atomic (same
  // filesystem). The timestamp keeps concurrent saves of the same file distinct.
  const stamp = d.now().toISOString().replace(/[:.]/g, '-');
  return `${filePath}.wrlforge-tmp-${stamp}`;
}

function writeAndFlush(tmpPath, bytes, d) {
  const fd = d.fs.openSync(tmpPath, 'w');
  try {
    d.fs.writeSync(fd, bytes, 0, bytes.length, 0);
    d.fs.fsyncSync(fd);
  } finally {
    d.fs.closeSync(fd);
  }
}

function safeUnlink(p, d) {
  try {
    if (d.fs.existsSync(p)) d.fs.unlinkSync(p);
  } catch {
    // Best-effort cleanup; a leftover temp is inert and never shadows the source.
  }
}

function taggedError(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  if (extra) Object.assign(err, extra);
  return err;
}

module.exports = {
  loadDocument,
  reloadDocument,
  safeSave,
  encodeForSave,
  decodeBytes,
  statFile,
  detectExternalChange,
};
