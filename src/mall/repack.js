'use strict';
// Mall Repack write safety (Lane B, B2).
//
// The Mall lane's "Repack & Save to mall .wrl" used to do the most dangerous
// thing a save can do: back up, then `writeFileSync` straight onto the real
// upload artifact, then measure what it had already replaced. Four defects in
// one sequence, each proven:
//
//   1. It re-encoded an UNCHANGED artifact. A Zopfli-packed shipping item
//      (Ragnum Red, 72,820 B) became 87,366 B of Node zlib for no edit at all.
//   2. It wrote directly to the destination, so an interrupted write destroyed
//      the artifact.
//   3. It discovered an over-limit result AFTER replacement -- the user was
//      told FAIL about a file WRLForge had just made too big.
//   4. It never proved the encoded bytes were the right document before
//      committing them.
//
// This module closes all four by composing existing pieces rather than growing
// a second write path:
//
//   safeSave()       src/editor/file-io.js -- preservation, candidate verify,
//                    size ceiling, temp + fsync + read-back + backup + rename
//   measureArtifact() src/mall/artifact-size.js -- Lane A file truth
//   validate()        validator.js -- Lane A verdict from supplied facts
//   mallPayload()     src/mall/artifact-size.js -- collision-guarded assembly
//
// LANE A REMAINS AUTHORITATIVE. The pre-write ceiling protects the WRITE; it is
// never the reported upload size. The final verdict always comes from
// `measureArtifact` re-reading the real bytes on disk -- after a successful
// write, after a preserved no-op, and after a refusal (where it describes the
// artifact that was left untouched). A candidate byte count is a candidate, and
// is labelled as one everywhere it appears.

const { safeSave } = require('../editor/file-io');
const { FORMAT } = require('../editor/wrl-document');
const { measureArtifact, mallPayload } = require('./artifact-size');
const { validate, MALL_UPLOAD_MAX_BYTES } = require('../../validator');

// Save failures the Mall UI can describe precisely. Anything else is surfaced
// as a generic failure rather than guessed at -- a save that failed for an
// unknown reason must still never render as success.
const SAVE_ERROR_MESSAGE = {
  ESIZE: 'Not saved — the repacked candidate is over the Mall upload limit. The existing file was not changed.',
  EVERIFY: 'Not saved — the repacked candidate did not verify. The existing file was not changed.',
  EEXTERNAL: 'Not saved — the mall file changed on disk since it was opened. The existing file was not changed.',
};

// Repack `text` into the real Mall artifact at `mallPath`.
//
// Order is normative (Lane B B2 §11) and each step exists because skipping it
// caused a real defect:
//
//   1. preservation  -- an unchanged gzip artifact is left ALONE: no encode, no
//                       temp, no backup, no new mtime, and crucially no size
//                       judgement. A 72,820 B Zopfli artifact stays valid even
//                       though re-encoding it would blow the limit.
//   2. encode        -- exact candidate bytes, in memory only.
//   3. verify        -- the candidate must decode back to exactly `text`.
//   4. measure       -- candidate.length.
//   5. ceiling       -- over MALL_UPLOAD_MAX_BYTES refuses BEFORE any mutation.
//   6..11. temp + fsync + read-back + verify + backup + atomic rename.
//   12. measure the REAL artifact now on disk.
//   13. validate against that measurement.
//
// Steps 1-5 all complete before the destination is touched, so every refusal
// leaves the original byte-identical with no backup and no temp.
//
// Returns an IPC-ready payload. It never throws for a save failure: the Mall UI
// needs the refusal AND the still-valid state of the existing artifact in one
// response.
//
// deps (injectable for tests): { safeSave, measureArtifact, validate, now, fs, zlib }
function repackMall({ mallPath, text, asGzip = true }, deps = {}) {
  const save = deps.safeSave || safeSave;
  const measure = deps.measureArtifact || measureArtifact;
  const check = deps.validate || validate;

  // Reuse the shared document-model constants rather than ad hoc strings.
  const format = asGzip ? FORMAT.GZIP : FORMAT.PLAIN;

  // Only a gzip output is a Mall upload artifact, so only a gzip output carries
  // the upload ceiling. A plain `.wrl` is the editable source; blocking it on
  // the upload limit would refuse a write that uploads nothing.
  const maxBytes = asGzip ? MALL_UPLOAD_MAX_BYTES : null;

  let res;
  try {
    res = save({
      filePath: mallPath,
      text,
      format,
      // Preservation is gzip-only by construction (wouldPreserve rejects any
      // other format), but asking for it only where it can apply keeps the
      // plain path visibly free of the shortcut.
      preserveExistingGzip: asGzip,
      verifyCandidate: true,
      maxBytes,
    }, deps);
  } catch (err) {
    // The write was refused or failed. The artifact on disk is whatever it was
    // before, so Lane A still describes it truthfully -- that is exactly the
    // information the user needs to see next to the refusal.
    return mallPayload({
      mallPath,
      saved: false,
      preserved: false,
      writtenBytes: 0,
      backup: null,
      errorCode: err.code || 'ESAVE',
      // Present only on ESIZE; null elsewhere so a reader cannot mistake an
      // absent number for zero.
      candidateBytes: err.candidateBytes == null ? null : err.candidateBytes,
      maxBytes: err.maxBytes == null ? null : err.maxBytes,
      overBytes: err.overBytes == null ? null : err.overBytes,
      message: SAVE_ERROR_MESSAGE[err.code] || `Not saved — ${err.message}`,
    }, check(text, measure(mallPath, text, deps)));
  }

  // (12) + (13) Lane A: weigh the file that now exists and prove it still
  // represents this text. A preserved no-op measures the untouched artifact;
  // a real write measures the bytes just committed. Neither reports the
  // candidate count as the upload size.
  return mallPayload({
    mallPath,
    saved: true,
    preserved: res.preserved === true,
    writtenBytes: res.bytesWritten,
    backup: res.backup,
    errorCode: null,
    candidateBytes: null,
    maxBytes: null,
    overBytes: null,
    message: res.preserved === true
      ? 'Already saved — the existing gzip artifact already matches this text, so nothing was rewritten.'
      : null,
  }, check(text, measure(mallPath, text, deps)));
}

module.exports = { repackMall, SAVE_ERROR_MESSAGE };
