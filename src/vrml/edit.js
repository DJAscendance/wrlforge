'use strict';
// VRML97 span-patch algebra (Phase WD1.2).
//
// PURE and dependency-free: strings and plain objects in, a new string (or a
// number, or a plain object) out. This module requires nothing -- no fs, no
// Electron, no CodeMirror, no parser, no source map, no AST. It holds no state
// between calls, reads no environment, and mutates none of its inputs. Two calls
// with equal arguments always produce equal results.
//
// It exists because WRL Forge's canonical document is the EXACT TEXT BUFFER and
// nothing else (docs/white-dune-2026/WD1_LOSSLESS_DOCUMENT_CORE_PLAN.md section 2).
// The AST, the source map, and every future scene tree / inspector / viewport are
// derived, disposable projections of that text. A GUI action therefore does not
// regenerate a document -- it emits a span-anchored text patch. Everything outside
// a patch's declared span is not "preserved", it is NEVER TOUCHED, which is why
// comments, whitespace, commas-as-whitespace, CRLF, numeric spelling, field order,
// and unknown or vendor syntax survive by construction rather than by feature work.
//
// WD1.2 builds the algebra only. It has no callers: nothing in the Mall lane, the
// World lane, the preview, the validator, or the editor routes through it yet.
//
// ---------------------------------------------------------------------------
// THE EDIT OBJECT
// ---------------------------------------------------------------------------
//
//   { from, to, insert }
//
// `from` and `to` are ZERO-BASED offsets into a JavaScript string, measured in
// UTF-16 CODE UNITS -- the same units the tokenizer's `range.start.offset` uses
// (src/vrml/tokenizer.js), the same units src/vrml/source-map.js answers in, and
// the same units CodeMirror 6 uses. They are NOT byte offsets, and this module
// cannot detect a byte offset handed to it: a caller holding bytes must convert
// before calling. An astral character (an emoji, say) occupies TWO code units, so
// offsets step by 2 across it; no code-point-boundary check is performed, exactly
// as in CodeMirror.
//
// Ranges are HALF-OPEN: `[from, to)`. `to` is the first offset NOT replaced. This
// is what makes `[0,3)` and `[3,5)` adjacent rather than overlapping, and it is
// the same convention as source-map.js -- the two modules compose directly, so
// `replaceSpan(sourceMap.rangeOf(node), text)` is the intended idiom.
//
// `insert` is the exact replacement text, used verbatim. Nothing is normalised:
// not line endings, not whitespace, not numbers, not comments, not VRML
// formatting of any kind.
//
//   insertion   from === to
//   deletion    from  <  to  and insert === ''
//   replacement from  <  to  and insert !== ''
//
// Edit objects returned by this module are frozen and carry EXACTLY those three
// keys. An edit accepted from a caller must also carry exactly those three keys:
// an unexpected key is rejected rather than ignored, because a silently dropped
// `{from, to, text}` typo is precisely the bug class this module exists to make
// impossible.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE DOES NOT DO
// ---------------------------------------------------------------------------
//
// * It NEVER parses. It does not know VRML97 from prose; an edit that produces
//   syntactically broken source is applied without complaint. Validating the
//   RESULT by reparsing is a caller's job (WD1.6 `document-transaction.js`).
// * It NEVER repairs caller input. No clamping, no sorting-into-legality, no
//   merging of overlaps, no de-duplication, no dropping of edits. Malformed input
//   throws; it is not massaged into something applicable.
// * It provides NO SEMANTIC IDENTITY. `mapOffset`/`mapRange` are positional
//   arithmetic over a known edit set and nothing more. They do not preserve node
//   identity, AST identity, DEF/USE identity, or "what the user meant by this
//   selection", and they cannot re-anchor across arbitrary or unknown edits. That
//   is the separate, genuinely hard problem of WD1.4 (`node-path.js`).

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

// Endpoint affinity: which side of an edit an offset sitting exactly on a seam
// belongs to. 'before' keeps it where it was (text inserted there lands after
// it); 'after' pushes it past the newly inserted text. CodeMirror's `mapPos`
// default association is the equivalent of 'before', and so is this module's.
const AFFINITY = Object.freeze({ BEFORE: 'before', AFTER: 'after' });

const AFFINITIES = new Set([AFFINITY.BEFORE, AFFINITY.AFTER]);

// Stable error codes, in the repo's `err.code` style (src/editor/file-io.js,
// src/world-project/bundle-builder.js, src/preview/buffer-overlay.js). Tests and
// future GUI callers key off these, so never change an existing string value.
const EDIT_ERROR = Object.freeze({
  // Malformed on its own terms -- checkable without any text: not an object,
  // wrong keys, non-integer / negative / non-finite offset, from > to, non-string
  // insert, non-array edit list, non-string source text.
  SHAPE: 'EEDITSHAPE',
  // Well-formed but does not fit the text it is being applied to: to > text.length.
  BOUNDS: 'EEDITBOUNDS',
  // Two edits contend for the same characters: intersecting spans, a span nested
  // in another, the same span twice, or an insertion STRICTLY INSIDE a span.
  OVERLAP: 'EEDITOVERLAP',
  // Two insertions at the same original offset. Applicable in two different
  // orders with two different results, so it is refused rather than resolved by
  // caller array order.
  AMBIGUOUS: 'EEDITAMBIGUOUS',
  // A range argument is not a recognised range shape, or has start > end.
  RANGE: 'EEDITRANGE',
  // An affinity argument is not 'before' or 'after'.
  AFFINITY: 'EEDITAFFINITY',
  // A mapped range would come back with from > to. Never silently swapped or
  // clamped -- the caller's affinity choice produced it and only the caller can
  // say what it meant.
  INVERTED: 'EEDITINVERTED',
});

const EDIT_KEYS = ['from', 'to', 'insert'];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

// One structured error shape for everything this module refuses. `code` is from
// EDIT_ERROR; `index` (when present) is the offending edit's position in the
// CALLER'S array, not in canonical order, so a failure points at the argument the
// caller actually wrote.
function editError(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  if (extra) {
    for (const key of Object.keys(extra)) {
      if (extra[key] !== undefined) err[key] = extra[key];
    }
  }
  return err;
}

const describe = (edit) => `{from:${edit.from}, to:${edit.to}, insert:${JSON.stringify(edit.insert)}}`;

const at = (index) => (index == null ? '' : ` (edits[${index}])`);

// ---------------------------------------------------------------------------
// Edit construction
// ---------------------------------------------------------------------------

function isPlainish(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Number.isInteger is false for NaN, Infinity, and fractions, so the three
// rejected offset classes collapse into one check.
function checkOffset(label, value, index) {
  if (!Number.isInteger(value)) {
    throw editError(EDIT_ERROR.SHAPE,
      `${label} must be an integer offset, got ${JSON.stringify(value)}${at(index)}`,
      { index, field: label, value });
  }
  if (value < 0) {
    throw editError(EDIT_ERROR.SHAPE,
      `${label} must not be negative, got ${value}${at(index)}`,
      { index, field: label, value });
  }
}

/**
 * Build one frozen edit.
 *
 * Validates the edit ON ITS OWN TERMS only. There is no text here, so `to` is
 * not bounds-checked -- that happens in `validateEdits`/`applyEdits`, which know
 * what the edit is being applied to.
 *
 * @param {number} from Zero-based UTF-16 offset; start of the replaced span.
 * @param {number} to Zero-based UTF-16 offset; first offset NOT replaced. Equal
 *   to `from` for an insertion.
 * @param {string} insert Exact replacement text, used verbatim.
 * @returns {{from:number,to:number,insert:string}} Frozen.
 * @throws {Error} code EEDITSHAPE.
 */
function createEdit(from, to, insert, index) {
  checkOffset('edit.from', from, index);
  checkOffset('edit.to', to, index);
  if (from > to) {
    throw editError(EDIT_ERROR.SHAPE,
      `edit.from must not be greater than edit.to, got from:${from}, to:${to}${at(index)}`,
      { index, from, to });
  }
  if (typeof insert !== 'string') {
    throw editError(EDIT_ERROR.SHAPE,
      `edit.insert must be a string, got ${insert === null ? 'null' : typeof insert}${at(index)}`,
      { index, value: insert });
  }
  return Object.freeze({ from, to, insert });
}

// Normalise anything a caller hands in as "an edit" into a frozen canonical edit,
// rejecting unknown keys rather than ignoring them.
function toEdit(value, index) {
  if (!isPlainish(value)) {
    throw editError(EDIT_ERROR.SHAPE,
      `an edit must be an object {from, to, insert}, got ${Array.isArray(value) ? 'an array' : JSON.stringify(value)}${at(index)}`,
      { index, value });
  }
  const unknown = Object.keys(value).filter((k) => !EDIT_KEYS.includes(k));
  if (unknown.length) {
    throw editError(EDIT_ERROR.SHAPE,
      `an edit must carry exactly {from, to, insert}; unexpected key(s): ${unknown.join(', ')}${at(index)}`,
      { index, unknown });
  }
  return createEdit(value.from, value.to, value.insert, index);
}

/**
 * A range in this module's canonical `{from, to}` form.
 *
 * Two shapes are accepted, deliberately: the compact `{from, to}` an editor
 * works in, and the positional `{start:{offset,...}, end:{offset,...}}` that
 * src/vrml/source-map.js `rangeOf()` returns -- so a span taken straight off an
 * AST node can be patched without the caller reshaping it. Anything else is
 * rejected; nothing is inferred.
 */
function toRange(range, label) {
  const what = label || 'range';
  if (!isPlainish(range)) {
    throw editError(EDIT_ERROR.RANGE,
      `${what} must be {from, to} or {start:{offset}, end:{offset}}, got ${JSON.stringify(range)}`,
      { value: range });
  }
  let from;
  let to;
  if (isPlainish(range.start) && isPlainish(range.end)) {
    from = range.start.offset;
    to = range.end.offset;
  } else if ('from' in range || 'to' in range) {
    from = range.from;
    to = range.to;
  } else {
    throw editError(EDIT_ERROR.RANGE,
      `${what} must be {from, to} or {start:{offset}, end:{offset}}, got keys [${Object.keys(range).join(', ')}]`,
      { value: range });
  }
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0) {
    throw editError(EDIT_ERROR.RANGE,
      `${what} offsets must be non-negative integers, got from:${JSON.stringify(from)}, to:${JSON.stringify(to)}`,
      { from, to });
  }
  if (from > to) {
    throw editError(EDIT_ERROR.RANGE,
      `${what}.from must not be greater than ${what}.to, got from:${from}, to:${to}`,
      { from, to });
  }
  return { from, to };
}

/**
 * Replace the text of `range` with `insert`. The natural pairing with
 * `sourceMap.rangeOf(node)` / `rangeOf(token)`.
 *
 * @param {object} range `{from, to}` or `{start:{offset}, end:{offset}}`.
 * @param {string} insert Exact replacement text.
 * @returns {{from:number,to:number,insert:string}} Frozen.
 * @throws {Error} code EEDITRANGE or EEDITSHAPE.
 */
function replaceSpan(range, insert) {
  const span = toRange(range);
  return createEdit(span.from, span.to, insert);
}

/**
 * Insert `text` at `offset`, replacing nothing.
 *
 * @param {number} offset Zero-based UTF-16 offset.
 * @param {string} text Exact text to insert.
 * @returns {{from:number,to:number,insert:string}} Frozen.
 * @throws {Error} code EEDITSHAPE.
 */
function insertAt(offset, text) {
  return createEdit(offset, offset, text);
}

/**
 * Delete the text of `range`.
 *
 * @param {object} range `{from, to}` or `{start:{offset}, end:{offset}}`.
 * @returns {{from:number,to:number,insert:string}} Frozen.
 * @throws {Error} code EEDITRANGE.
 */
function removeSpan(range) {
  const span = toRange(range);
  return createEdit(span.from, span.to, '');
}

// ---------------------------------------------------------------------------
// Canonical ordering
// ---------------------------------------------------------------------------
//
// CANONICAL ORDER IS THE ORDER THE EDITS' RESULTS APPEAR IN THE OUTPUT, read left
// to right. It is derived entirely from the edits themselves, never from the
// caller's array order, which is why two callers passing the same set in
// different orders get byte-identical results.
//
//   1. `from` ascending -- earlier in the source, earlier in the output.
//   2. at the same `from`: an INSERTION sorts before a span. An insertion at a
//      span's start therefore lands BEFORE the replacement text, which is the
//      only reading of "insert here, and also replace what starts here" that
//      keeps both edits' declared anchors intact.
//   3. `to` ascending, then `insert` lexicographically. Unreachable in practice
//      -- validation has already rejected every set that could tie this far --
//      but present so the order is TOTAL and can never fall through to
//      Array.prototype.sort's implementation details or to the caller's index.
//
// Application then proceeds in canonical order against the ORIGINAL text, taking
// each untouched gap verbatim. Every offset in the algorithm is an offset into
// the original string; no edit ever sees an offset shifted by another edit. That
// is the same guarantee as "apply from the highest offset to the lowest" (and
// test/vrml/edit.test.js checks the two agree on generated input), reached in one
// linear pass instead of one string rebuild per edit.

const isInsertion = (edit) => edit.from === edit.to;

function compareEdits(a, b) {
  if (a.from !== b.from) return a.from - b.from;
  const ai = isInsertion(a) ? 0 : 1;
  const bi = isInsertion(b) ? 0 : 1;
  if (ai !== bi) return ai - bi;
  if (a.to !== b.to) return a.to - b.to;
  if (a.insert === b.insert) return 0;
  return a.insert < b.insert ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
//
// Order of checks is fixed so error codes are deterministic for a given input:
//
//   1. the arguments themselves (text is a string, edits is an array)
//   2. every edit's shape, in CALLER order            -> EEDITSHAPE
//   3. every edit's bounds against `text`, in caller order -> EEDITBOUNDS
//   4. the set as a whole, in canonical order         -> EEDITOVERLAP / EEDITAMBIGUOUS
//
// A set is validated COMPLETELY before any of it is applied, so `applyEdits`
// either returns a fully-edited string or throws having produced nothing.

function normalizeEdits(edits, text) {
  if (!Array.isArray(edits)) {
    throw editError(EDIT_ERROR.SHAPE,
      `edits must be an array, got ${edits === null ? 'null' : typeof edits}`,
      { value: edits });
  }
  const entries = edits.map((value, index) => ({ edit: toEdit(value, index), index }));

  if (text != null) {
    for (const entry of entries) {
      if (entry.edit.to > text.length) {
        throw editError(EDIT_ERROR.BOUNDS,
          `edit ${describe(entry.edit)} reaches past the end of the text (length ${text.length})${at(entry.index)}`,
          { index: entry.index, edit: entry.edit, textLength: text.length });
      }
    }
  }

  const canonical = entries.slice().sort((a, b) => compareEdits(a.edit, b.edit));

  // Set-level conflicts. `maxEnd` is the furthest `to` seen so far, tracked
  // rather than merely comparing neighbours because sorting by `from` puts a
  // nested span [2,3) after its container [0,10) but not necessarily next to it.
  let maxEnd = -1;
  let maxEndEntry = null;
  const insertionsAt = new Map(); // offset -> caller index

  for (const entry of canonical) {
    const edit = entry.edit;
    if (isInsertion(edit)) {
      const seen = insertionsAt.get(edit.from);
      if (seen !== undefined) {
        throw editError(EDIT_ERROR.AMBIGUOUS,
          `two insertions at the same offset ${edit.from} could be applied in either order; `
          + `combine them into one edit or apply them in separate passes${at(entry.index)}`,
          { index: entry.index, edit, otherIndex: seen, offset: edit.from });
      }
      if (edit.from < maxEnd) {
        throw editError(EDIT_ERROR.OVERLAP,
          `insertion at ${edit.from} falls strictly inside ${describe(maxEndEntry.edit)}, `
          + `whose text is being replaced${at(entry.index)}`,
          { index: entry.index, edit, otherIndex: maxEndEntry.index, other: maxEndEntry.edit });
      }
      insertionsAt.set(edit.from, entry.index);
      if (edit.to > maxEnd) { maxEnd = edit.to; maxEndEntry = entry; }
      continue;
    }
    if (edit.from < maxEnd) {
      throw editError(EDIT_ERROR.OVERLAP,
        `edit ${describe(edit)} overlaps ${describe(maxEndEntry.edit)}; `
        + `overlapping edits are never merged${at(entry.index)}`,
        { index: entry.index, edit, otherIndex: maxEndEntry.index, other: maxEndEntry.edit });
    }
    maxEnd = edit.to;
    maxEndEntry = entry;
  }

  return canonical;
}

/**
 * Validate a complete edit set against `text` and return it in canonical order.
 *
 * The caller's array is never mutated or reordered; the returned array and every
 * edit in it are fresh and frozen. Returning the canonical order (rather than
 * just a boolean) is deliberate -- it is what `applyEdits` consumes, and it lets
 * a caller inspect exactly the sequence that will be applied.
 *
 * @param {string} text The ORIGINAL source every edit is anchored to.
 * @param {Array<object>} edits Edits in any order.
 * @returns {ReadonlyArray<{from:number,to:number,insert:string}>} Frozen, canonical.
 * @throws {Error} codes EEDITSHAPE, EEDITBOUNDS, EEDITOVERLAP, EEDITAMBIGUOUS.
 */
function validateEdits(text, edits) {
  if (typeof text !== 'string') {
    throw editError(EDIT_ERROR.SHAPE,
      `text must be a string, got ${text === null ? 'null' : typeof text}`,
      { value: text });
  }
  return Object.freeze(normalizeEdits(edits, text).map((entry) => entry.edit));
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

/**
 * Apply an edit set to `text`, returning a new string.
 *
 * Atomic: the whole set is validated first, so a bad edit anywhere means nothing
 * is produced at all -- there is no partial output and no partially-edited
 * string to clean up. An empty edit list returns the original string itself.
 *
 * Every character outside the union of the declared spans and insertion points
 * is copied verbatim from `text`, so CRLF, lone LF, tabs, trailing whitespace,
 * comments, VRML's comma-as-whitespace, numeric spelling, unknown syntax, and a
 * missing final newline all survive untouched. This is structural: those bytes
 * are never examined, let alone rewritten.
 *
 * @param {string} text The original source.
 * @param {Array<object>} edits Edits against `text`, in any order.
 * @returns {string} The edited text.
 * @throws {Error} codes EEDITSHAPE, EEDITBOUNDS, EEDITOVERLAP, EEDITAMBIGUOUS.
 */
function applyEdits(text, edits) {
  if (typeof text !== 'string') {
    throw editError(EDIT_ERROR.SHAPE,
      `text must be a string, got ${text === null ? 'null' : typeof text}`,
      { value: text });
  }
  const canonical = normalizeEdits(edits, text);
  if (canonical.length === 0) return text;

  const pieces = [];
  let cursor = 0;
  for (const entry of canonical) {
    const edit = entry.edit;
    // Guaranteed by canonical order plus overlap validation. Asserted anyway:
    // if this ever failed, characters outside a declared span would be lost or
    // duplicated, which is the one outcome this module exists to prevent.
    if (edit.from < cursor) {
      throw editError(EDIT_ERROR.OVERLAP,
        `internal invariant violated: canonical edit ${describe(edit)} starts before cursor ${cursor}`,
        { index: entry.index, edit });
    }
    pieces.push(text.slice(cursor, edit.from), edit.insert);
    cursor = edit.to;
  }
  pieces.push(text.slice(cursor));
  return pieces.join('');
}

// ---------------------------------------------------------------------------
// Offset mapping
// ---------------------------------------------------------------------------
//
// Where does an offset in the ORIGINAL text land in the EDITED text? Pure
// arithmetic over a validated edit set -- see the header's "no semantic identity"
// note before using it for anything that looks like selection preservation.
//
// For an INSERTION of n characters at p:
//   offset < p            -> unchanged
//   offset === p          -> 'before' keeps it at p; 'after' moves it to p + n
//   offset > p            -> shifted by n
//
// For a span [from, to) replaced by n characters (delta = n - (to - from)):
//   offset < from         -> unchanged
//   from <= offset < to   -> 'before' -> replacement start; 'after' -> replacement end
//   offset >= to          -> shifted by delta
//
// Note `to` is NOT interior: the range is half-open, so an offset at `to` is the
// first offset after the replaced text and simply shifts. `from` IS interior when
// from < to, so it is governed by affinity. For a deletion (n = 0) both affinities
// collapse to the deletion point, as they must.
//
// When several edits touch the same offset, the FIRST in canonical order that
// touches it decides the answer, and the ones before it have already contributed
// their shift. Concretely: with an insertion at p and a replacement starting at p,
// an 'after' offset at p lands between the inserted text and the replacement.

function checkAffinity(affinity, label) {
  if (!AFFINITIES.has(affinity)) {
    throw editError(EDIT_ERROR.AFFINITY,
      `${label || 'affinity'} must be 'before' or 'after', got ${JSON.stringify(affinity)}`,
      { value: affinity });
  }
}

/**
 * Map an offset in the original text to its position in the edited text.
 *
 * Takes no text: it needs only the edit set, so it performs no bounds check. Use
 * `validateEdits`/`applyEdits` when the text is available and bounds matter.
 * Shape, overlap, and ambiguity are still validated, because an ambiguous set has
 * no single answer to map through.
 *
 * @param {number} offset Zero-based UTF-16 offset into the ORIGINAL text.
 * @param {Array<object>} edits Edits against that original text, in any order.
 * @param {'before'|'after'} [affinity='before'] Which side of an edit an offset
 *   sitting exactly on the seam belongs to. Defaults to 'before', matching
 *   CodeMirror's default association.
 * @returns {number} The offset in the edited text.
 * @throws {Error} codes EEDITSHAPE, EEDITOVERLAP, EEDITAMBIGUOUS, EEDITAFFINITY.
 */
function mapOffset(offset, edits, affinity = AFFINITY.BEFORE) {
  checkOffset('offset', offset, null);
  checkAffinity(affinity);
  const canonical = normalizeEdits(edits, null);
  const after = affinity === AFFINITY.AFTER;

  let shift = 0;
  for (const entry of canonical) {
    const edit = entry.edit;
    const n = edit.insert.length;
    if (isInsertion(edit)) {
      if (offset < edit.from) return offset + shift;
      if (offset === edit.from) return offset + shift + (after ? n : 0);
      shift += n;
      continue;
    }
    if (offset < edit.from) return offset + shift;
    if (offset < edit.to) return edit.from + shift + (after ? n : 0);
    shift += n - (edit.to - edit.from);
  }
  return offset + shift;
}

/**
 * Map a half-open range through an edit set, one affinity per endpoint.
 *
 * Defaults are chosen for a SELECTION-like range: the start holds its ground
 * ('before') and the end absorbs what grows at it ('after'), so a range keeps
 * covering the text it covered and expands over an edit made inside it. For a
 * COLLAPSED CURSOR that default turns the cursor into a selection of any text
 * inserted at it -- pass the same affinity for both endpoints when a cursor must
 * stay a cursor.
 *
 * @param {object} range `{from, to}` or `{start:{offset}, end:{offset}}`.
 * @param {Array<object>} edits Edits against the original text, in any order.
 * @param {object} [options]
 * @param {'before'|'after'} [options.startAffinity='before']
 * @param {'before'|'after'} [options.endAffinity='after']
 * @returns {{from:number,to:number}} A fresh frozen range in the edited text.
 * @throws {Error} codes EEDITRANGE, EEDITAFFINITY, EEDITINVERTED, plus the
 *   `mapOffset` codes. An inverted result is reported, never silently swapped or
 *   clamped.
 */
function mapRange(range, edits, options = {}) {
  const span = toRange(range);
  const startAffinity = options.startAffinity === undefined ? AFFINITY.BEFORE : options.startAffinity;
  const endAffinity = options.endAffinity === undefined ? AFFINITY.AFTER : options.endAffinity;
  checkAffinity(startAffinity, 'options.startAffinity');
  checkAffinity(endAffinity, 'options.endAffinity');

  const from = mapOffset(span.from, edits, startAffinity);
  const to = mapOffset(span.to, edits, endAffinity);
  if (from > to) {
    throw editError(EDIT_ERROR.INVERTED,
      `mapped range is inverted (from:${from} > to:${to}); the chosen affinities `
      + `(start '${startAffinity}', end '${endAffinity}') pulled the endpoints past each other`,
      { from, to, startAffinity, endAffinity });
  }
  return Object.freeze({ from, to });
}

module.exports = {
  AFFINITY,
  EDIT_ERROR,
  createEdit,
  replaceSpan,
  insertAt,
  removeSpan,
  validateEdits,
  applyEdits,
  mapOffset,
  mapRange,
};
