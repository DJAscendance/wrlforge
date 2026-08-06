'use strict';
// WD1.4 spike -- parse sessions and the harness parse-identity invariant.
//
// THROWAWAY PROTOTYPE.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
//
// `oracle.classify` decides `correct` vs `wrong` by comparing the candidate's node
// to the oracle's node with `===` -- OBJECT IDENTITY. That is the right comparison
// (structural equality would let a look-alike pass), but it has a trap: two parses
// of the SAME text produce structurally equal, non-identical trees. Compare across
// them and every strategy reads as `wrong`.
//
// This bit the harness for real during development. A test parsed the edited text
// once for the index and again for the oracle, and strategy D -- which is provably
// correct on that case -- was reported as a wrong anchor. A silent 100% failure
// that looks exactly like a genuine safety finding is the worst possible failure
// mode for a lane whose entire output is a safety claim.
//
// So the invariant is made executable and LOUD: every parse is wrapped in a
// session carrying a spike-local id, indexes and oracle results inherit that id,
// and `classify` throws a structured HarnessError rather than returning a verdict
// when the two sides do not come from the same session.
//
// Determinism: session ids come from a monotonic counter, not a clock or a random
// source, and `resetSessions()` restores it. No identifier is ever written into
// document source.

/** A structured harness failure. Never a silent verdict, never a bare Error. */
class HarnessError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
    this.detail = detail;
  }
}

const HARNESS = Object.freeze({
  MIXED_PARSE_SESSION: 'harness/mixed-parse-session',
  MISSING_SESSION: 'harness/missing-parse-session',
});

let counter = 0;

/** Reset the id counter. Tests call this so ids stay stable and readable. */
function resetSessions() {
  counter = 0;
}

/**
 * Wrap one parse of one exact text in a session.
 *
 * @param {string} text The exact canonical text that was parsed.
 * @param {object} parseResult The result of `parse(text)` -- passed in rather than
 *   produced here so the spike keeps using the production parser directly.
 * @param {string} [label] Human-readable tag for error messages only.
 */
function createSession(text, parseResult, label = '') {
  counter += 1;
  return {
    sessionId: `ps${counter}`,
    label,
    text,
    parse: parseResult,
  };
}

/**
 * The invariant. Throws unless the oracle result and the candidate result came
 * from the same parse session.
 *
 * Two results that both carry NO session are permitted: unit tests build synthetic
 * oracle/candidate objects to exercise the classification truth table, and those
 * never touch a real tree. Anything else -- both tagged and different, or one
 * tagged and the other not -- is a harness bug and is raised as one.
 */
function assertSameSession(oracleResult, candidate) {
  const a = oracleResult ? oracleResult.sessionId : undefined;
  const b = candidate ? candidate.sessionId : undefined;
  if (a === undefined && b === undefined) return;
  if (a === undefined || b === undefined) {
    throw new HarnessError(
      HARNESS.MISSING_SESSION,
      'classification mixes a session-tagged result with an untagged one',
      { oracleSession: a === undefined ? null : a, candidateSession: b === undefined ? null : b },
    );
  }
  if (a !== b) {
    throw new HarnessError(
      HARNESS.MIXED_PARSE_SESSION,
      `classification compares nodes from different parse sessions (${a} vs ${b}); `
      + 'object identity is meaningless across parses -- reuse one session for both sides',
      { oracleSession: a, candidateSession: b },
    );
  }
}

module.exports = { HarnessError, HARNESS, createSession, resetSessions, assertSameSession };
