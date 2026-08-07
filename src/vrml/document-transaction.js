'use strict';
// Parse sessions + verified document transactions (Phase WD1.4).
//
// PURE and browser-safe: this module requires exactly one thing, the WD1.2 span
// patch algebra (src/vrml/edit.js), which itself requires nothing. No fs, no
// Electron, no CodeMirror, no crypto, no parser. It holds one piece of state --
// a monotonic session counter -- reads no environment, and mutates none of its
// inputs.
//
// It exists because WRL Forge's canonical document is the EXACT TEXT BUFFER
// (docs/white-dune-2026/WD1_LOSSLESS_DOCUMENT_CORE_PLAN.md section 2). Tokens,
// AST, source map, scene tree, semantic indexes, inspector state and viewport
// state are derived, disposable projections of that text. Nothing in this module
// writes an identifier into a document, keeps a sidecar, or treats a tree as
// canonical state.
//
// ---------------------------------------------------------------------------
// 1. PARSE SESSION
// ---------------------------------------------------------------------------
//
// A parse session binds ONE exact source text to ONE exact parse of it, and
// carries an identity valid only for that pair:
//
//   const session = createParseSession(text, parse(text));
//
// Two parses of byte-identical text are two DIFFERENT sessions, deliberately.
// AST nodes are compared by object identity downstream (src/vrml/node-identity.js),
// and two parses of the same text produce structurally equal but non-identical
// trees -- comparing across them is meaningless and, worse, looks like a real
// answer. The WD1.4 research spike hit exactly that during development and read
// it as a 100% strategy failure. So the invariant is executable here rather than
// documented: a session cannot be forged (membership of a module-private WeakSet
// is not something a caller can fake), and every consumer requires one.
//
// Sessions are NOT persisted, carry no timestamp, and carry no random value.
// The id is a monotonic per-process counter, so it is deterministic within a run
// and meaningless outside the process that minted it -- which is the point: a
// session id must never survive a reload.
//
// THE ID IS DIAGNOSTIC ONLY. Nothing authorizes on it. `sessionId` exists so a
// log line can say "selection lost: was ps3, now ps7"; every consumer that has to
// decide whether two values belong to the same parse compares the session OBJECT
// (see src/vrml/node-identity.js, which holds the originating session in a
// module-private WeakMap). This is not a stylistic preference. An earlier revision
// of Tier 0 compared `selection.sessionId !== session.sessionId`, and because a
// counter can be restarted, two different documents could both mint `ps1`; a
// selection made in the first then RESOLVED, confidently, to a node that did not
// exist in the second document's tree. There is deliberately no way to restart the
// counter now, and -- more importantly -- no code path that would care if there
// were.
//
// ---------------------------------------------------------------------------
// 2. VERIFIED DOCUMENT TRANSACTION
// ---------------------------------------------------------------------------
//
//   const receipt = verifyTransaction({ oldText, edits, newText });
//
// The receipt is the ONLY evidence that a specific edit set is exactly what
// turned `oldText` into `newText`. Tier 1 node re-anchoring (node-identity.js)
// maps a node's old span forward through that edit set; handed a stale, partial,
// foreign or merely plausible edit set, that arithmetic is still perfectly
// self-consistent -- it just describes a document that does not exist, and it
// would confidently return the wrong node. Verification is therefore the gate,
// and it FAILS CLOSED:
//
//   1. the inputs are well-formed                     -> malformed-input
//   2. the edit set is structurally valid vs. oldText -> edit-set-invalid
//   3. WD1.2 applyEdits accepts it                    -> edit-apply-failed
//   4. the result equals newText BYTE FOR BYTE        -> result-text-mismatch
//      (an empty edit set against changed text is called out separately, as
//      empty-edit-set-for-changed-text, because "I made no edits" against text
//      that did change is the signature of a caller that lost its transaction
//      log rather than of an arithmetic slip)
//
// EXACT EQUALITY, NOT A HASH. A digest would be smaller but weaker, and would
// pull in Node's crypto module -- this file must stay loadable in a renderer or
// a browser. The receipt therefore holds references to the exact old and new
// text for as long as it lives, which is sanctioned precisely because a receipt
// is short-lived.
//
// A RECEIPT IS EPHEMERAL. It is:
//   * non-serializable        -- its binding lives in a module-private WeakMap,
//                                so a JSON round-trip produces an inert object
//                                that `isVerifiedReceipt` rejects;
//   * unforgeable             -- only verifyTransaction() can mint one;
//   * document-bound          -- it names exactly one (oldText, newText) pair;
//   * invalid once the transaction chain breaks -- a reload, an external edit,
//     an unknown edit, or any second transaction ends its usefulness;
//   * NEVER to be persisted, stored in a document, or replayed against another
//     document;
//   * REUSABLE, within its own transaction, for as many selections as needed --
//     one verification can re-anchor every selection the editor holds.
//
// Rejections are structured values with stable `reason` ids, never a bare throw:
// ordinary invalid input is an expected outcome here, not an exception. The two
// things that DO throw are programming errors -- a non-string text where a
// session is being built, and a non-session where a session is required.

const edit = require('./edit');

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

// Stable error codes, in the repo's `err.code` style (src/vrml/edit.js,
// src/editor/file-io.js). Never change an existing string value.
const TX_ERROR = Object.freeze({
  // A parse session was required and something else was supplied.
  SESSION: 'ETXSESSION',
  // createParseSession's own arguments are wrong.
  SHAPE: 'ETXSHAPE',
});

const TX_STATUS = Object.freeze({
  VERIFIED: 'verified',
  REJECTED: 'rejected',
});

// Stable reason ids. Tests and future callers key off these strings.
const TX_REASON = Object.freeze({
  OK: 'ok',
  MALFORMED_INPUT: 'malformed-input',
  EDIT_SET_INVALID: 'edit-set-invalid',
  EDIT_APPLY_FAILED: 'edit-apply-failed',
  RESULT_MISMATCH: 'result-text-mismatch',
  EMPTY_EDITS_FOR_CHANGED_TEXT: 'empty-edit-set-for-changed-text',
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function txError(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  if (extra) for (const key of Object.keys(extra)) err[key] = extra[key];
  return err;
}

// ---------------------------------------------------------------------------
// Parse sessions
// ---------------------------------------------------------------------------

// Sessions this module actually created. A caller cannot forge membership of a
// module-private WeakSet, so an object that merely LOOKS like a session -- the
// right keys, a plausible id -- is not accepted anywhere.
const SESSIONS = new WeakSet();

// Strictly increasing for the life of the process. There is NO reset: a helper
// that restarts it would let two unrelated documents display the same id, and
// while nothing authorizes on the id today, an API that hands out colliding ids
// is an invitation to start.
let sessionCounter = 0;

/**
 * Bind one exact source text to one exact parse of it.
 *
 * @param {string} text The exact canonical text that was parsed.
 * @param {object} parseResult The result of `parse(text)` from src/vrml. Passed
 *   in rather than produced here so this module never depends on the parser.
 * @returns {{sessionId:string, text:string, parse:object}} Frozen. `sessionId` is
 *   a DIAGNOSTIC label, never an authorization token -- hold the session object.
 * @throws {Error} code ETXSHAPE.
 */
function createParseSession(text, parseResult) {
  if (typeof text !== 'string') {
    throw txError(TX_ERROR.SHAPE,
      `createParseSession: text must be a string, got ${text === null ? 'null' : typeof text}`);
  }
  if (!parseResult || typeof parseResult !== 'object' || Array.isArray(parseResult)) {
    throw txError(TX_ERROR.SHAPE,
      'createParseSession: parseResult must be the object returned by parse(text)');
  }
  sessionCounter += 1;
  const session = Object.freeze({
    sessionId: `ps${sessionCounter}`,
    text,
    parse: parseResult,
  });
  SESSIONS.add(session);
  return session;
}

/** True only for a session object created by `createParseSession` in this process. */
function isParseSession(value) {
  return !!value && typeof value === 'object' && SESSIONS.has(value);
}

/**
 * Require a real parse session. Throws rather than returning a refusal: handing
 * a bare parse result, a plain object, or a session-shaped literal to an
 * identity API is a programming error, and the whole point of the session model
 * is that there is no quiet path around it.
 *
 * @throws {Error} code ETXSESSION.
 */
function assertParseSession(value, label = 'session') {
  if (!isParseSession(value)) {
    throw txError(TX_ERROR.SESSION,
      `${label} must be a parse session created by createParseSession(text, parse(text))`,
      { value: null });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Transaction receipts
// ---------------------------------------------------------------------------

// The binding a receipt stands for: the exact texts and the exact canonical edit
// set. Kept OFF the receipt object so a receipt cannot be serialized, inspected,
// or mutated into naming a different document -- and so that a hand-rolled
// `{status:'verified'}` object has nothing behind it.
const RECEIPTS = new WeakMap();

const rejectTx = (reason, detail) => Object.freeze({
  status: TX_STATUS.REJECTED,
  reason,
  detail: Object.freeze(detail || {}),
});

/**
 * Verify that `edits` is exactly the edit set that turned `oldText` into
 * `newText`.
 *
 * @param {object} input
 * @param {string} input.oldText The exact canonical text before the edit.
 * @param {Array<object>} input.edits WD1.2 span patches `{from, to, insert}`,
 *   in any order, anchored to `oldText`.
 * @param {string} input.newText The exact canonical text the caller says resulted.
 * @returns {object} A frozen verified receipt `{status:'verified', reason:'ok',
 *   editCount}`, or a frozen rejection `{status:'rejected', reason, detail}`.
 *   Never throws for ordinary invalid input.
 */
function verifyTransaction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return rejectTx(TX_REASON.MALFORMED_INPUT, { note: 'expected {oldText, edits, newText}' });
  }
  const { oldText, edits, newText } = input;
  if (typeof oldText !== 'string' || typeof newText !== 'string') {
    return rejectTx(TX_REASON.MALFORMED_INPUT, { note: 'oldText and newText must both be strings' });
  }
  if (!Array.isArray(edits)) {
    return rejectTx(TX_REASON.MALFORMED_INPUT, { note: 'edits must be an array' });
  }

  // An empty edit set is truthful only when nothing changed. Reported under its
  // own reason: it is the shape of a caller that lost its transaction log, not
  // of a caller whose arithmetic drifted.
  if (edits.length === 0 && oldText !== newText) {
    return rejectTx(TX_REASON.EMPTY_EDITS_FOR_CHANGED_TEXT,
      { note: 'no edits supplied but the text changed' });
  }

  // 1. Structural validity against THIS text, through the accepted WD1.2
  // operation rather than a local reimplementation -- shape, bounds, overlap and
  // ambiguity are all WD1.2's rules, so anything it refuses is refused here.
  let canonical;
  try {
    canonical = edit.validateEdits(oldText, edits);
  } catch (err) {
    return rejectTx(TX_REASON.EDIT_SET_INVALID, {
      note: 'WD1.2 refused the edit set',
      code: err.code || 'error',
      index: typeof err.index === 'number' ? err.index : null,
    });
  }

  // 2. Application, again through WD1.2.
  let produced;
  try {
    produced = edit.applyEdits(oldText, canonical);
  } catch (err) {
    return rejectTx(TX_REASON.EDIT_APPLY_FAILED, {
      note: 'WD1.2 refused to apply the edit set',
      code: err.code || 'error',
    });
  }

  // 3. The decisive check. Everything above can pass while the set still fails to
  // describe the supplied new text: a missing edit, a wrong inserted string, a
  // stale set from an earlier revision, a set from another document that happens
  // to fit. Exact equality rules out all of them at once.
  if (produced !== newText) {
    return rejectTx(TX_REASON.RESULT_MISMATCH, {
      note: 'applying the edits to the old text did not reproduce the supplied new text',
      producedLength: produced.length,
      newLength: newText.length,
      firstDivergence: firstDivergence(produced, newText),
    });
  }

  const receipt = Object.freeze({
    status: TX_STATUS.VERIFIED,
    reason: TX_REASON.OK,
    editCount: canonical.length,
  });
  RECEIPTS.set(receipt, { oldText, newText, edits: canonical });
  return receipt;
}

/** True only for a receipt minted by `verifyTransaction` in this process. */
function isVerifiedReceipt(value) {
  return !!value && typeof value === 'object' && RECEIPTS.has(value);
}

/**
 * Is this receipt bound to exactly this "before" document?
 *
 * A predicate rather than a getter: it answers the only question a consumer has
 * without handing the document text back out, which keeps the receipt's binding
 * private and un-persistable.
 */
function receiptBindsOldText(receipt, text) {
  const bound = isVerifiedReceipt(receipt) ? RECEIPTS.get(receipt) : null;
  return !!bound && typeof text === 'string' && bound.oldText === text;
}

/** Is this receipt bound to exactly this "after" document? */
function receiptBindsNewText(receipt, text) {
  const bound = isVerifiedReceipt(receipt) ? RECEIPTS.get(receipt) : null;
  return !!bound && typeof text === 'string' && bound.newText === text;
}

/**
 * INTERNAL. The exact canonical edit set this receipt verified, or null.
 *
 * Deliberately NOT part of the public `require('./src/vrml')` surface: it exists
 * for one caller, node-identity.js's Tier 1 re-anchoring, which must map a span
 * through the transaction and can only do that with the edits themselves. A
 * consumer that wants the edits already has them -- it supplied them to
 * `verifyTransaction`.
 *
 * The returned value is immutable, not merely conventionally read-only: WD1.2's
 * `validateEdits` freezes both the array and every edit in it, and the receipt's
 * binding lives in a module-private WeakMap, so there is no path from this value
 * back to mutable receipt state. `assertImmutableEdits` re-checks that here
 * rather than trusting the invariant, because a future WD1.2 change that stopped
 * freezing would otherwise silently hand out mutable internals.
 */
function receiptEdits(receipt) {
  const bound = isVerifiedReceipt(receipt) ? RECEIPTS.get(receipt) : null;
  if (!bound) return null;
  assertImmutableEdits(bound.edits);
  return bound.edits;
}

// A loud failure rather than a silent downgrade: if this ever trips, the caller
// would have been handed mutable receipt internals.
function assertImmutableEdits(edits) {
  if (!Object.isFrozen(edits)) {
    throw txError(TX_ERROR.SHAPE, 'receiptEdits: the canonical edit array is not frozen');
  }
  for (const e of edits) {
    if (!Object.isFrozen(e)) {
      throw txError(TX_ERROR.SHAPE, 'receiptEdits: a canonical edit is not frozen');
    }
  }
}

/** Offset of the first differing character, or null when equal. Diagnostics only. */
function firstDivergence(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i;
  return a.length === b.length ? null : n;
}

// Module exports. NOT the public surface -- src/vrml/index.js re-exports a
// deliberately narrower subset. Everything marked INTERNAL below is here for
// node-identity.js's CommonJS composition and for focused tests, and must stay
// out of the facade.
module.exports = {
  TX_ERROR,
  TX_STATUS,
  TX_REASON,
  createParseSession,
  isParseSession,          // INTERNAL
  assertParseSession,      // INTERNAL
  verifyTransaction,
  isVerifiedReceipt,
  receiptBindsOldText,     // INTERNAL
  receiptBindsNewText,     // INTERNAL
  receiptEdits,            // INTERNAL
  firstDivergence,         // INTERNAL
};
