'use strict';
// WD1.4 spike -- the transaction-integrity contract for strategy D.
//
// THROWAWAY PROTOTYPE.
//
// ---------------------------------------------------------------------------
// THE CONTRACT
// ---------------------------------------------------------------------------
//
// Strategy D re-anchors by mapping the selected node's old span forward through a
// set of edits. That is safe if and only if the edits it is given are EXACTLY the
// edits that turned the exact old canonical text into the exact new canonical text.
// Hand D a stale, partial, mismatched or foreign edit set and its arithmetic is
// still perfectly self-consistent -- it just describes a document that does not
// exist, and it will confidently return a node.
//
// The original spike measured D under the implicit assumption that the edit set was
// always truthful, because the harness generated both. That assumption is exactly
// what a production caller cannot be trusted to keep. So the contract is made
// executable here and it FAILS CLOSED:
//
//   1. the base text is the text the anchor was created against  (BASE_MISMATCH)
//   2. the edit set is structurally valid against that base text (EDIT_INVALID)
//   3. applying the edits to the base text succeeds                (APPLY_FAILED)
//   4. the result equals the supplied new text EXACTLY             (RESULT_MISMATCH)
//
// Only a receipt that clears all four permits strategy D to resolve. Everything
// else returns a structured rejection -- never an unclassified throw, and never a
// silent pass.
//
// No timestamps, no dependencies. A production implementation may carry document
// versions and content hashes instead of full text; this proves the BEHAVIOUR, not
// the representation.

const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const edit = require(path.join(REPO_ROOT, 'src', 'vrml', 'edit.js'));

// Receipts this module actually issued. A caller cannot forge membership of a
// module-private WeakSet, so `isIssued()` distinguishes a real receipt from a
// hand-rolled `{status:'verified'}` object. Added after an independent review
// pointed out that strategy D trusted any object with the right shape.
const ISSUED = new WeakSet();

/** sha256 of a string. Node built-in -- not a dependency. */
const digest = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const TX = Object.freeze({
  VERIFIED: 'verified',
  REJECTED: 'rejected',
});

const REASON = Object.freeze({
  OK: 'ok',
  BASE_MISMATCH: 'base-text-mismatch',
  EDIT_INVALID: 'edit-set-invalid',
  APPLY_FAILED: 'edit-apply-failed',
  RESULT_MISMATCH: 'result-text-mismatch',
  EMPTY_EDITS_FOR_CHANGED_TEXT: 'empty-edit-set-for-changed-text',
  MALFORMED_INPUT: 'malformed-input',
  MISSING_ANCHOR_BASE: 'missing-anchor-base-text',
});

const reject = (reason, detail = {}) => ({ status: TX.REJECTED, reason, detail, edits: null });

/** Mint a verified receipt and record that THIS module issued it. */
function issue(baseText, newText, edits) {
  const receipt = {
    status: TX.VERIFIED,
    reason: REASON.OK,
    detail: { editCount: edits.length },
    edits,
    // Bound to the exact documents. Strategy D checks `baseDigest` against the
    // digest of the document its anchor was created from, so a receipt minted for
    // a different document cannot license a re-anchor.
    baseDigest: digest(baseText),
    newDigest: digest(newText),
  };
  ISSUED.add(receipt);
  return receipt;
}

/** True only for a receipt object produced by `verify()` in this process. */
const isIssued = (receipt) => !!receipt && typeof receipt === 'object' && ISSUED.has(receipt);

/**
 * Verify that `edits` exactly connects `baseText` to `newText`.
 *
 * @param {object} input
 * @param {string} input.baseText The text the anchor was created against.
 * @param {string} input.anchorBaseText The text the CALLER claims the anchor was
 *   created against. Supplied separately so a caller that has drifted from the
 *   document it anchored into is caught, rather than silently re-based.
 * @param {object[]} input.edits Span patches in WD1.2 form.
 * @param {string} input.newText The exact text the caller says resulted.
 * @returns {{status:string, reason:string, detail:object, edits:object[]|null}}
 */
function verify({ baseText, anchorBaseText, edits, newText }) {
  if (typeof baseText !== 'string' || typeof newText !== 'string') {
    return reject(REASON.MALFORMED_INPUT, { note: 'baseText and newText must both be strings' });
  }
  if (!Array.isArray(edits)) {
    return reject(REASON.MALFORMED_INPUT, { note: 'edits must be an array' });
  }

  // 1. Base identity. If the caller anchored into a different document -- or an
  // older revision of this one -- nothing downstream can be trusted. Compared by
  // full text here; production would compare a version id plus a content hash.
  //
  // REQUIRED, not optional. An independent review showed that leaving it optional
  // let a caller mint a perfectly "verified" receipt for a document the anchor
  // never came from, and strategy D then re-anchored across two different files.
  if (anchorBaseText === undefined) {
    return reject(REASON.MISSING_ANCHOR_BASE, {
      note: 'anchorBaseText is required: the receipt must name the document the anchor was created against',
    });
  }
  if (anchorBaseText !== baseText) {
    return reject(REASON.BASE_MISMATCH, {
      note: 'the text the anchor was created against is not the text being edited',
      baseLength: baseText.length,
      anchorBaseLength: anchorBaseText.length,
    });
  }

  // An empty edit set is only truthful when nothing changed. This is called out
  // separately from RESULT_MISMATCH because "I made no edits" against changed text
  // is the specific shape of a caller that lost its transaction log.
  if (edits.length === 0) {
    if (baseText !== newText) {
      return reject(REASON.EMPTY_EDITS_FOR_CHANGED_TEXT, {
        note: 'no edits supplied but the text changed',
      });
    }
    return issue(baseText, newText, edits);
  }

  // 2. Structural validity against THIS base text. Ranges must be integers, ordered,
  // in-bounds and non-overlapping. WD1.2 owns the algebra; this only checks the
  // shape it requires, so an out-of-range edit is reported as invalid rather than
  // surfacing later as an apply failure.
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 0; i < sorted.length; i += 1) {
    const e = sorted[i];
    if (!e || typeof e !== 'object'
      || !Number.isInteger(e.from) || !Number.isInteger(e.to)
      || typeof e.insert !== 'string') {
      return reject(REASON.EDIT_INVALID, { note: 'edit is not {from:int, to:int, insert:string}', index: i });
    }
    if (e.from > e.to) {
      return reject(REASON.EDIT_INVALID, { note: 'edit range is inverted', index: i, from: e.from, to: e.to });
    }
    if (e.from < 0 || e.to > baseText.length) {
      return reject(REASON.EDIT_INVALID, {
        note: 'edit range is out of bounds for the base text',
        index: i, from: e.from, to: e.to, baseLength: baseText.length,
      });
    }
    if (i > 0 && e.from < sorted[i - 1].to) {
      return reject(REASON.EDIT_INVALID, { note: 'edits overlap', index: i });
    }
  }

  // 3. Apply through the accepted WD1.2 algebra -- not a local reimplementation, so
  // anything WD1.2 refuses is refused here too.
  let produced;
  try {
    produced = edit.applyEdits(baseText, edits);
  } catch (err) {
    return reject(REASON.APPLY_FAILED, { note: 'WD1.2 refused the edit set', code: err.code || 'error' });
  }

  // 4. The decisive check. Everything above can pass while the edit set still fails
  // to describe the supplied new text -- a missing edit, a wrong inserted string, a
  // stale set from an earlier revision. Exact equality is the only thing that rules
  // all of those out at once.
  if (produced !== newText) {
    return reject(REASON.RESULT_MISMATCH, {
      note: 'applying the edits to the base text did not reproduce the supplied new text',
      producedLength: produced.length,
      newLength: newText.length,
      firstDivergence: firstDivergence(produced, newText),
    });
  }

  return issue(baseText, newText, edits);
}

/** Offset of the first differing character, or null when equal. Diagnostics only. */
function firstDivergence(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i;
  return a.length === b.length ? null : n;
}

/** Convenience: a receipt for "nothing changed", used where no edit occurred. */
const unchanged = (text) => verify({ baseText: text, anchorBaseText: text, edits: [], newText: text });

module.exports = { TX, REASON, verify, unchanged, firstDivergence, isIssued, digest };
