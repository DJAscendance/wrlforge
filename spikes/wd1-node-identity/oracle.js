'use strict';
// WD1.4 spike -- the CORRECTNESS ORACLE.
//
// THROWAWAY PROTOTYPE.
//
// ---------------------------------------------------------------------------
// INDEPENDENCE FROM THE CANDIDATES -- read this before changing anything here
// ---------------------------------------------------------------------------
//
// This module MUST NOT require ./identity.js, and it never receives a candidate
// result while establishing the expected node. Concretely:
//
//   * It does its OWN walk of the reparsed tree (`ast.walk`). It does not use
//     identity.js's index, its paths, or its fingerprints.
//   * It never calls src/vrml/edit.js's `mapOffset`/`mapRange`. Strategy D is
//     built on that mapping, so sharing it would make D right by construction.
//     The expected span arrives from scenarios.js, computed by that scenario's
//     own arithmetic over the edits it placed.
//   * It proves the expected node by TWO independent facts that must agree --
//     the exact post-edit span, and the exact post-edit SOURCE TEXT -- and it
//     additionally requires that exactly one node in the reparsed document
//     satisfies both. A node that merely resembles the expectation is never
//     accepted, and if the proof is not unique the case is reported as
//     `oracle-unresolved` rather than scored.
//
// `classify()` is the only function that sees a candidate result, and by then
// the expected node is already fixed.

const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { NODE, walk } = require(path.join(REPO_ROOT, 'src', 'vrml', 'ast.js'));
// session.js carries no expectation and no candidate logic -- it only enforces
// that both sides of a comparison came from the same parse.
const { assertSameSession, HarnessError, HARNESS } = require('./session');

const ORACLE = Object.freeze({
  ESTABLISHED: 'established',
  DELETED: 'deleted',
  UNRESOLVED: 'unresolved',
});

const CLASS = Object.freeze({
  CORRECT: 'correct',
  SAFE_LOSS: 'safe-loss',
  AMBIGUOUS: 'ambiguous',
  WRONG: 'wrong',
  ORACLE_UNRESOLVED: 'oracle-unresolved',
});

/**
 * Establish the expected post-edit node, or refuse to.
 *
 * SIGNATURE: `establish(expectation, session, nodeType)` -- THREE arguments.
 *
 * The parameter names below are the historical 4-arg shape and are kept only
 * because the body rebinds them; a caller using the old
 * `(expectation, parse, text, nodeType)` form does NOT silently mis-score, it
 * throws `harness/missing-parse-session` (asserted in test.js).
 *
 * @param {object} expectation From scenarios.js: `{kind:'preserved', start, end, text}`
 *   or `{kind:'deleted'}`.
 * @param {object} newParse A parse SESSION `{sessionId, text, parse}` -- see session.js.
 * @param {string} newText The selected node's type in the ORIGINAL parse (the
 *   third positional argument). Type is required to match: an edit that changes a
 *   node's type has destroyed the thing the user selected, whatever occupies the
 *   span afterwards.
 * @returns {{status:string, node:object|null, reason:string, sessionId:string}}
 */
function establish(expectation, newParse, newText, nodeType) {
  // A SESSION IS REQUIRED: establish(expectation, session, nodeType).
  //
  // Accepting a bare (parse, text) pair used to be allowed, and an independent
  // review showed it defeated the whole invariant -- two raw parses of identical
  // text both produced untagged results, `assertSameSession` waved the comparison
  // through, and every strategy was reported as a wrong anchor. There must be no
  // untagged path out of a real parse.
  if (!newParse || typeof newParse.sessionId !== 'string' || !newParse.parse) {
    throw new HarnessError(
      HARNESS.MISSING_SESSION,
      'oracle.establish requires a parse session (session.createSession(text, parse(text))), not a bare parse result',
    );
  }
  const session = newParse;
  const sessionId = session.sessionId;
  nodeType = newText;              // establish(expectation, session, nodeType)
  newText = session.text;
  newParse = session.parse;
  const tag = (result) => ({ ...result, sessionId });

  if (!expectation) return tag({ status: ORACLE.UNRESOLVED, node: null, reason: 'no expectation' });
  if (expectation.kind === 'deleted') {
    return tag({ status: ORACLE.DELETED, node: null, reason: 'the selected node\'s text was removed' });
  }
  if (expectation.kind !== 'preserved') {
    return tag({ status: ORACLE.UNRESOLVED, node: null, reason: `unsupported expectation kind ${expectation.kind}` });
  }

  const { start, end, text } = expectation;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start >= end || end > newText.length) {
    return tag({ status: ORACLE.UNRESOLVED, node: null, reason: 'expected span is out of range for the edited text' });
  }
  // Proof 1: the bytes at the expected span are exactly the expected bytes. This
  // is checked before the tree is consulted at all -- if the scenario's model of
  // its own edits was wrong, the case is unscorable and must not be counted.
  if (newText.slice(start, end) !== text) {
    return tag({ status: ORACLE.UNRESOLVED, node: null, reason: 'edited text at the expected span does not match the expected node text' });
  }

  // Proof 2: exactly one node instance in the reparsed tree occupies that exact
  // span with the same node type. Own traversal -- see the independence note.
  const matches = [];
  if (newParse.tree) {
    walk(newParse.tree, (node) => {
      if (node.type !== NODE.NODE) return;
      if (!node.range) return;
      if (node.range.start.offset !== start || node.range.end.offset !== end) return;
      if (node.nodeType !== nodeType) return;
      matches.push(node);
    });
  }
  if (matches.length === 0) {
    return tag({ status: ORACLE.UNRESOLVED, node: null, reason: 'no reparsed node occupies the expected span with the expected type' });
  }
  if (matches.length > 1) {
    return tag({ status: ORACLE.UNRESOLVED, node: null, reason: 'several reparsed nodes occupy the expected span; the expectation is not unique' });
  }
  return tag({ status: ORACLE.ESTABLISHED, node: matches[0], reason: 'unique span + text + type proof' });
}

/**
 * Classify one candidate result against an already-established oracle result.
 *
 * The five labels are exactly the WD1.4 taxonomy. Note that for a `deleted`
 * expectation, `safe-loss` is the DESIRED outcome, not a partial failure -- the
 * user removed the node, so there is nothing left to select.
 *
 * @param {object} oracleResult From `establish()`.
 * @param {object} candidate `{status:'resolved'|'ambiguous'|'refused', node}`.
 * @returns {string} One of CLASS.
 */
function classify(oracleResult, candidate) {
  // HARNESS INVARIANT, checked before any verdict is formed. `correct` is decided
  // by `candidate.node === oracleResult.node`, which is meaningless across two
  // parses of the same text -- it reports every strategy as `wrong`. Rather than
  // return that plausible-looking lie, throw. See session.js.
  assertSameSession(oracleResult, candidate);

  if (!oracleResult || oracleResult.status === ORACLE.UNRESOLVED) return CLASS.ORACLE_UNRESOLVED;
  if (!candidate) return CLASS.ORACLE_UNRESOLVED;

  if (candidate.status === 'ambiguous') return CLASS.AMBIGUOUS;
  if (candidate.status === 'refused') return CLASS.SAFE_LOSS;
  if (candidate.status !== 'resolved') return CLASS.ORACLE_UNRESOLVED;

  // The candidate claims a node.
  if (oracleResult.status === ORACLE.DELETED) return CLASS.WRONG;
  return candidate.node === oracleResult.node ? CLASS.CORRECT : CLASS.WRONG;
}

/**
 * A short, sanitized description of an AST node instance, for wrong-anchor
 * reporting. Never includes source text or a filesystem path.
 */
function describeNode(node, newText) {
  if (!node) return null;
  const range = node.range || null;
  return {
    nodeType: node.nodeType || node.type,
    def: node.def || null,
    start: range ? range.start.offset : null,
    end: range ? range.end.offset : null,
    line: range ? range.start.line : null,
    fields: Array.isArray(node.fields) ? node.fields.map((f) => f.name).join(',') : null,
    length: range && newText ? range.end.offset - range.start.offset : null,
  };
}

module.exports = { ORACLE, CLASS, establish, classify, describeNode };
