'use strict';
// Stable node identity (Phase WD1.4).
//
// PURE and browser-safe: requires only src/vrml/ast.js (the read-only AST walk
// constants), src/vrml/edit.js (the WD1.2 span-patch algebra) and
// src/vrml/document-transaction.js (parse sessions + verified receipts). No fs,
// no Electron, no CodeMirror, no crypto, no parser. It writes nothing into a
// document: no synthetic id, no comment, no sidecar, no second buffer.
//
// ---------------------------------------------------------------------------
// THE HARD GATE
// ---------------------------------------------------------------------------
//
// A selection may be LOST. A selection may be reported AMBIGUOUS. This module
// may say it cannot prove identity. It may NEVER confidently return a different
// node. Every design decision below is downstream of that: the WD1.4 research
// spike (spikes/wd1-node-identity/) measured six candidate strategies over real
// VRML97 and found exactly one class of failure -- wrong anchors, all of them
// from structural-path identity, including cases where it returned a node after
// the user had DELETED the selected one. As recorded in the committed spike
// REPORT.md, that was 1,020 wrong anchors over 78,648 cases; those are HISTORICAL
// figures for the corpus as it stood on the spike run, and the corpus lives in
// external trees that change (see docs/white-dune-2026/WD1_4_NODE_IDENTITY.md
// for a later snapshot). The finding is what matters, not the count. That
// strategy is permanently rejected and is not implemented here, not even as a
// fallback. Neither is anything that picks a "closest", "first", or
// "highest-scoring" candidate.
//
// ---------------------------------------------------------------------------
// TWO TIERS, TWO LIFETIMES
// ---------------------------------------------------------------------------
//
// TIER 1 -- verified same-transaction re-anchoring (spike strategy D).
//   Permitted ONLY with a receipt proving the exact edit set that turned the
//   exact old canonical text into the exact new canonical text. Given that, a
//   node's old span maps forward through WD1.2 and the result must be occupied
//   by exactly one node with the same type, DEF name, parent type and containing
//   field. This is what lets ANONYMOUS nodes and BYTE-IDENTICAL SIBLINGS survive
//   ordinary editing (2,323 of 2,597 identical-sibling cases resolved correctly
//   in the spike, zero wrong).
//
//   IT IS NOT A DURABLE IDENTITY. It is a verified mapping through ONE known
//   transaction, and it means nothing once that chain breaks. It must never
//   survive a reload, a reopen, an external edit, an unknown edit chain, a
//   broken chain, serialization, or persistence to disk, and must never be
//   replayed against another document. The receipt binding enforces all of that
//   structurally: a receipt names one exact (oldText, newText) pair, cannot be
//   serialized, and cannot be forged.
//
// TIER 2 -- persistent identity (spike strategy A2).
//   A uniquely named DEF, its node type, and only the PROTO-lexical scope
//   evidence the parse tree itself already proves. Survives reloads, reopening,
//   external file changes, unknown edits and any reparse with no receipt.
//   Duplicate DEF names are AMBIGUOUS -- decided on name matches alone, BEFORE
//   node type is considered, because narrowing duplicates by type and taking the
//   survivor is exactly the "resolve a duplicate by picking the plausible one"
//   behaviour that produces wrong anchors. Never first-match. Never
//   closest-match. A renamed DEF is a safe loss. Anonymous nodes have NO
//   persistent identity. Where scope cannot be proven, this refuses.
//
//   Tier 2 is NOT a scope engine and does not presuppose one (WD1.5). It reads
//   the parse tree's own PROTO nesting and fails closed where that evidence is
//   insufficient -- an unnamed PROTO ancestor, or a parse that hit a node or
//   depth limit and therefore cannot prove uniqueness at all.
//
// TIER 0 -- current-parse selection.
//   A direct reference into one parse, valid only while that exact parse session
//   is live. Not identity; a convenience with a guard, so that a selection held
//   across a reparse fails loudly instead of comparing AST objects from two
//   different parses.
//
// SAFE FALLBACK IS THE NORMAL OUTCOME, not an edge case. Every resolution
// returns one of `resolved` / `ambiguous` / `refused` with a stable reason id.
// Nothing returns a bare null, and nothing returns a node it cannot prove.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE DELIBERATELY DOES NOT KEEP
// ---------------------------------------------------------------------------
//
// The spike's research index cost ~54.5 MB of heap on a DEF/USE-heavy world
// because it retained a serialized structural summary string per node. Nothing
// of that kind exists here: the index holds one small record per node instance
// (type, DEF name, parent type, containing field, scope key, start, end) built
// in a single traversal, and no field VALUES, no per-node JSON, and no
// document-wide positional index. It is built lazily on first use and cached
// against its session in a private WeakMap, so it is released as soon as the
// session is dropped.
//
// This module is standards-first and type-agnostic. Node types are used only as
// an equality constraint; nothing here requires a type to be a known VRML97
// node, so vendor and historical Cybertown/Blaxxun nodes re-anchor exactly as
// standard ones do. No Mall limit, placement rule, texture rule, upload rule or
// viewer-specific behaviour appears in it, and none may be added.

const { NODE } = require('./ast');
const edit = require('./edit');
const tx = require('./document-transaction');

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

const IDENTITY_ERROR = Object.freeze({
  // A node was required and something else -- or a node from another parse --
  // was supplied.
  NODE: 'EIDENTITYNODE',
});

/** The only three outcomes of a resolution. */
const IDENTITY_STATUS = Object.freeze({
  RESOLVED: 'resolved',
  AMBIGUOUS: 'ambiguous',
  REFUSED: 'refused',
});

/** The only two outcomes of an anchor-creation attempt. */
const ANCHOR_STATUS = Object.freeze({
  CREATED: 'created',
  UNSUPPORTED: 'unsupported',
});

// Stable reason ids. Callers and tests key off these strings; never change an
// existing value.
const IDENTITY_REASON = Object.freeze({
  // --- creation refused -------------------------------------------------
  NO_SOURCE_RANGE: 'node-has-no-source-range',
  NO_DEF_NAME: 'node-has-no-def-name',
  DEF_NOT_UNIQUE: 'def-name-not-unique-in-scope',
  SCOPE_NOT_PROVABLE: 'proto-scope-not-provable',
  PARSE_INCOMPLETE: 'document-parse-incomplete',
  // --- resolution refused -----------------------------------------------
  MALFORMED_ANCHOR: 'malformed-anchor',
  SESSION_CHANGED: 'parse-session-changed',
  NO_RECEIPT: 'no-transaction-receipt',
  RECEIPT_NOT_ISSUED: 'receipt-not-issued',
  RECEIPT_NOT_BOUND_TO_ANCHOR: 'receipt-not-bound-to-anchor-document',
  RECEIPT_NOT_BOUND_TO_RESULT: 'receipt-does-not-produce-this-document',
  EDIT_TOUCHES_BOUNDARY: 'edit-touches-node-boundary',
  MAPPING_REFUSED: 'offset-mapping-refused',
  NODE_REMOVED: 'node-replaced-or-removed',
  NO_NODE_AT_SPAN: 'no-node-at-mapped-span',
  DEF_NOT_FOUND: 'def-name-not-found',
  TYPE_CHANGED: 'node-type-changed',
  SCOPE_CHANGED: 'proto-scope-changed',
  // --- resolution ambiguous ---------------------------------------------
  SPAN_AMBIGUOUS: 'several-nodes-share-mapped-span',
  DEF_DUPLICATED: 'def-name-duplicated',
  // --- resolved ---------------------------------------------------------
  SAME_PARSE: 'same-parse-session',
  VERIFIED_SPAN: 'verified-transaction-span-match',
  UNIQUE_DEF: 'unique-def-in-scope',
});

// Structural context that is not a field name. Non-identifier strings, so they
// can never collide with a real VRML field name.
const CTX = Object.freeze({
  STATEMENT: '#statement',
  PROTO_BODY: '#proto-body',
  INTERFACE_DEFAULT: '#interface-default',
  ROOT: '#root',
  UNKNOWN: '#unknown',
});

const ANCHOR_KIND = Object.freeze({
  CURRENT: 'current-parse-selection',
  TRANSACTION: 'transaction-anchor',
  PERSISTENT: 'persistent-def-anchor',
});

// ---------------------------------------------------------------------------
// Result constructors
// ---------------------------------------------------------------------------

const resolvedResult = (node, reason) => Object.freeze({
  status: IDENTITY_STATUS.RESOLVED, node, reason,
});
const ambiguousResult = (reason, count) => Object.freeze({
  status: IDENTITY_STATUS.AMBIGUOUS, node: null, reason, count,
});
const refusedResult = (reason) => Object.freeze({
  status: IDENTITY_STATUS.REFUSED, node: null, reason,
});

const created = (anchor) => Object.freeze({ status: ANCHOR_STATUS.CREATED, anchor });
const unsupported = (reason) => Object.freeze({
  status: ANCHOR_STATUS.UNSUPPORTED, anchor: null, reason,
});

/** Was a resolution able to prove a node? */
const isResolved = (result) => !!result && result.status === IDENTITY_STATUS.RESOLVED;
/** Did a resolution find more than one candidate and refuse to choose? */
const isAmbiguous = (result) => !!result && result.status === IDENTITY_STATUS.AMBIGUOUS;
/** Did a resolution safely lose the selection? */
const isRefused = (result) => !!result && result.status === IDENTITY_STATUS.REFUSED;

function identityError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------
//
// One record per node INSTANCE (`NODE.NODE`). USE references, fields and value
// nodes are not selectable and are not recorded. Built in a single traversal
// that mirrors `ast.walk` exactly -- same skipped keys, arrays transparent,
// untyped holder objects entered -- so the parent/child relation recorded here
// is the same one the production walk reports. test/vrml/node-identity.test.js
// pins that equivalence.
//
// Context is carried DOWN the traversal rather than recomputed by walking
// ancestors back up, which keeps the whole build O(nodes) with O(depth) working
// memory and no per-node ancestor array.

const INDEXES = new WeakMap();

// The PROTO scope chain is spelled as a single string so it can key a Map, which
// makes the SEPARATOR a safety property rather than a formatting choice. This
// tokenizer classifies identifiers by EXCLUSION (src/vrml/tokenizer.js
// `isIdPart`), deliberately, so real Cybertown corpora tokenize: `/`, `:` and
// most punctuation are all legal inside a PROTO name. A `/` separator therefore
// spells `PROTO A/B` and `PROTO A { PROTO B }` identically, and an anchor from
// one resolves into the other -- a wrong anchor, reproduced during this lane's
// independent review. NUL is the one class the tokenizer can never emit
// (`isControl` rejects every code point <= 0x20), so it separates unambiguously.
// The scope key is an OPAQUE token: do not parse it, split it, or show it.
const SCOPE_SEP = '\u0000';
// A PROTO the parse could not name. Any node below one is refused outright
// (scopeProvable), so this only ever has to be distinct, never meaningful.
const UNNAMED_SCOPE = '?';

// The context that applies to the CHILDREN of `node`, given the context that
// applied to `node` itself.
function childContext(node, ctx) {
  switch (node.type) {
    // An MFNode array is transparent: an item's real context is the field that
    // holds the array, not the brackets.
    case NODE.ARRAY:
      return ctx;
    case NODE.FIELD:
      return {
        containingField: node.name || CTX.UNKNOWN,
        parentType: ctx.parentType,
        scopeKey: ctx.scopeKey,
        scopeProvable: ctx.scopeProvable,
      };
    case NODE.PROTO: {
      const name = typeof node.name === 'string' && node.name ? node.name : null;
      return {
        containingField: CTX.PROTO_BODY,
        parentType: ctx.parentType,
        scopeKey: ctx.scopeKey === ''
          ? (name || UNNAMED_SCOPE)
          : `${ctx.scopeKey}${SCOPE_SEP}${name || UNNAMED_SCOPE}`,
        // An unnamed PROTO means the parse could not name this scope, so no
        // scope below it is provable. Tier 2 refuses rather than guessing.
        scopeProvable: ctx.scopeProvable && name !== null,
      };
    }
    case NODE.INTERFACE:
      return {
        containingField: CTX.INTERFACE_DEFAULT,
        parentType: ctx.parentType,
        scopeKey: ctx.scopeKey,
        scopeProvable: ctx.scopeProvable,
      };
    case NODE.NODE:
      return {
        containingField: CTX.UNKNOWN,
        parentType: node.nodeType,
        scopeKey: ctx.scopeKey,
        scopeProvable: ctx.scopeProvable,
      };
    default:
      return {
        containingField: CTX.ROOT,
        parentType: ctx.parentType,
        scopeKey: ctx.scopeKey,
        scopeProvable: ctx.scopeProvable,
      };
  }
}

// Scope + DEF name in one key, separated by the same NUL and for the same
// reason as the scope chain above: no VRML identifier can contain one, so
// no scope/name pair can be spelled two ways.
const scopedDefKey = (scopeKey, defName) => `${scopeKey}\u0000${defName}`;

function buildIndex(session) {
  const parseResult = session.parse;
  const tree = parseResult && parseResult.tree ? parseResult.tree : null;
  const byNode = new Map();
  const bySpanStart = new Map();
  const byScopedDef = new Map();

  function record(node, ctx) {
    const range = node.range;
    const start = range && range.start ? range.start.offset : null;
    const end = range && range.end ? range.end.offset : null;
    const entry = {
      node,
      nodeType: node.nodeType,
      defName: node.def || null,
      parentType: ctx.parentType,
      containingField: ctx.containingField,
      scopeKey: ctx.scopeKey,
      scopeProvable: ctx.scopeProvable,
      start,
      end,
    };
    byNode.set(node, entry);
    if (start !== null && end !== null) {
      const bucket = bySpanStart.get(start);
      if (bucket) bucket.push(entry);
      else bySpanStart.set(start, [entry]);
    }
    if (entry.defName !== null) {
      const key = scopedDefKey(entry.scopeKey, entry.defName);
      const bucket = byScopedDef.get(key);
      if (bucket) bucket.push(entry);
      else byScopedDef.set(key, [entry]);
    }
  }

  function descend(container, ctx) {
    for (const key in container) {
      if (key === 'range' || key === 'type' || key === 'leadingTrivia') continue;
      const value = container[key];
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (!item || typeof item !== 'object') continue;
          if (typeof item.type === 'string') enter(item, ctx);
          else descend(item, ctx);
        }
        continue;
      }
      if (typeof value.type === 'string') enter(value, ctx);
      else descend(value, ctx);
    }
  }

  function enter(node, ctx) {
    if (node.type === NODE.NODE) record(node, ctx);
    descend(node, childContext(node, ctx));
  }

  // The Document root is never itself a selectable node instance, so the walk
  // starts at its children with the context a top-level statement sits in.
  if (tree) {
    descend(tree, {
      containingField: CTX.STATEMENT,
      parentType: CTX.ROOT,
      scopeKey: '',
      scopeProvable: true,
    });
  }

  return {
    byNode,
    bySpanStart,
    byScopedDef,
    entriesAtSpan(from, to) {
      const bucket = bySpanStart.get(from);
      if (!bucket) return [];
      return bucket.filter((e) => e.end === to);
    },
  };
}

function indexOf(session) {
  let index = INDEXES.get(session);
  if (!index) {
    index = buildIndex(session);
    INDEXES.set(session, index);
  }
  return index;
}

// The entry for a node, or a loud failure. A node that is not in this session's
// parse is a programming error, not a lost selection: silently accepting it is
// exactly how a bare AST would bypass the session guard.
function entryFor(session, node, label) {
  if (!node || typeof node !== 'object' || node.type !== NODE.NODE) {
    throw identityError(IDENTITY_ERROR.NODE,
      `${label}: expected a VRML node instance (ast NODE.NODE) from this parse session`);
  }
  const entry = indexOf(session).byNode.get(node);
  if (!entry) {
    throw identityError(IDENTITY_ERROR.NODE,
      `${label}: this node does not belong to the supplied parse session; `
      + 'a node from another parse can never be compared by object identity');
  }
  return entry;
}

// A parse that hit a node budget or a depth cap did not see the whole document,
// so no document-wide uniqueness claim can be proven from it. Tier 2 depends on
// exactly such a claim, so it fails closed.
const parseIsIncomplete = (session) => {
  const p = session.parse;
  return !!(p && (p.truncated || p.depthCapped));
};

// ---------------------------------------------------------------------------
// Tier 0 -- current-parse selection
// ---------------------------------------------------------------------------

// The originating session AND the node behind a selection, held privately so a
// selection cannot be forged or serialized into one.
//
// The SESSION OBJECT is what authorizes, never `selection.sessionId`. Session ids
// come from a counter, and a counter can collide across processes or across a
// restarted module; comparing the displayed number let a selection made in one
// document resolve, with status `resolved`, to a node from a different parse
// entirely. Object identity cannot collide. See document-transaction.js.
const SELECTIONS = new WeakMap();

/**
 * Select a node within one parse session.
 *
 * Valid only while that exact session is the current parse. It is not identity
 * and must never be persisted; it exists so that holding a selection across a
 * reparse fails loudly rather than comparing nodes from two parses.
 *
 * @param {object} session A session from `createParseSession`.
 * @param {object} node A node instance from that session's tree.
 * @returns {{status:'created', anchor:object}}
 * @throws {Error} codes ETXSESSION, EIDENTITYNODE.
 */
function createCurrentSelection(session, node) {
  tx.assertParseSession(session, 'createCurrentSelection: session');
  entryFor(session, node, 'createCurrentSelection');
  const selection = Object.freeze({
    kind: ANCHOR_KIND.CURRENT,
    // DIAGNOSTIC ONLY. Never read by resolveCurrentSelection.
    sessionId: session.sessionId,
  });
  SELECTIONS.set(selection, { session, node });
  return created(selection);
}

/**
 * Resolve a current-parse selection against a parse session.
 *
 * Resolves only when `session` is the very session the selection was made in.
 * Any other session -- including a fresh parse of byte-identical text -- is a
 * safe loss, never a match.
 *
 * @returns {object} A frozen `resolved` / `refused` result.
 * @throws {Error} code ETXSESSION.
 */
function resolveCurrentSelection(selection, session) {
  tx.assertParseSession(session, 'resolveCurrentSelection: session');
  const bound = selection && typeof selection === 'object' ? SELECTIONS.get(selection) : undefined;
  if (!bound || selection.kind !== ANCHOR_KIND.CURRENT) {
    return refusedResult(IDENTITY_REASON.MALFORMED_ANCHOR);
  }
  // Object identity, not `selection.sessionId === session.sessionId`. See the
  // note on SELECTIONS above.
  if (bound.session !== session) {
    return refusedResult(IDENTITY_REASON.SESSION_CHANGED);
  }
  return resolvedResult(bound.node, IDENTITY_REASON.SAME_PARSE);
}

// ---------------------------------------------------------------------------
// Tier 1 -- transaction anchor
// ---------------------------------------------------------------------------

// The exact parse SESSION an anchor was created in. Private so the anchor stays a
// small, inert description and cannot be re-based onto another document by
// editing a property, and an object rather than a text or an id so that neither a
// counter collision nor a coincidentally equal document can stand in for the
// originating parse. The base text is read from the session, so the two can never
// drift apart.
const ANCHOR_ORIGIN = new WeakMap();

/**
 * Create a Tier 1 anchor for a node in an old parse session.
 *
 * Records the minimum evidence the proven contract needs: the node's outer
 * range, its type, its DEF name, its parent node type and its containing field,
 * plus the parse session it came from. No structural path, no field values, no
 * serialized summary of the node.
 *
 * @returns {{status:'created', anchor:object}|{status:'unsupported', reason:string}}
 * @throws {Error} codes ETXSESSION, EIDENTITYNODE.
 */
function createTransactionAnchor(session, node) {
  tx.assertParseSession(session, 'createTransactionAnchor: session');
  const entry = entryFor(session, node, 'createTransactionAnchor');
  if (entry.start === null || entry.end === null) {
    return unsupported(IDENTITY_REASON.NO_SOURCE_RANGE);
  }
  const anchor = Object.freeze({
    kind: ANCHOR_KIND.TRANSACTION,
    // DIAGNOSTIC ONLY. Never read by resolveTransactionAnchor.
    sessionId: session.sessionId,
    start: entry.start,
    end: entry.end,
    nodeType: entry.nodeType,
    defName: entry.defName,
    parentType: entry.parentType,
    containingField: entry.containingField,
  });
  ANCHOR_ORIGIN.set(anchor, session);
  return created(anchor);
}

/**
 * Resolve a Tier 1 anchor into a new parse session through one verified
 * transaction.
 *
 * Refuses unless ALL of the following hold:
 *   * the receipt was minted by `verifyTransaction` in this process;
 *   * it is bound to exactly the text the anchor was created against;
 *   * its result text is exactly the new session's text;
 *   * every edit in it is wholly before, wholly after, or STRICTLY INSIDE the
 *     selected node -- an edit that touches or crosses the node's boundary means
 *     the node may have been replaced, and offset arithmetic cannot tell "my
 *     node, edited" from "my node, replaced by a similar one";
 *   * the mapped range is non-empty;
 *   * exactly one node occupies that exact range with the same type, DEF name,
 *     parent type and containing field.
 *
 * The edit set comes from the receipt, never from the caller, so "all edits
 * belong to that exact transaction" is structural rather than checked.
 *
 * @returns {object} A frozen `resolved` / `ambiguous` / `refused` result.
 * @throws {Error} code ETXSESSION.
 */
function resolveTransactionAnchor(anchor, session, receipt) {
  tx.assertParseSession(session, 'resolveTransactionAnchor: session');
  const origin = anchor && typeof anchor === 'object' ? ANCHOR_ORIGIN.get(anchor) : undefined;
  if (!origin || anchor.kind !== ANCHOR_KIND.TRANSACTION) {
    return refusedResult(IDENTITY_REASON.MALFORMED_ANCHOR);
  }
  // Read from the originating session object, never from the anchor and never
  // from a session id.
  const baseText = origin.text;
  if (receipt === undefined || receipt === null) {
    return refusedResult(IDENTITY_REASON.NO_RECEIPT);
  }
  // Shape is not proof. Only a receipt this process minted through
  // verifyTransaction carries a binding at all; a hand-rolled
  // `{status:'verified'}` object, or one that survived a JSON round-trip, has
  // nothing behind it.
  if (!tx.isVerifiedReceipt(receipt)) {
    return refusedResult(IDENTITY_REASON.RECEIPT_NOT_ISSUED);
  }
  if (!tx.receiptBindsOldText(receipt, baseText)) {
    return refusedResult(IDENTITY_REASON.RECEIPT_NOT_BOUND_TO_ANCHOR);
  }
  if (!tx.receiptBindsNewText(receipt, session.text)) {
    return refusedResult(IDENTITY_REASON.RECEIPT_NOT_BOUND_TO_RESULT);
  }
  const edits = tx.receiptEdits(receipt);

  // The containment guard. Every one of the spike's zero wrong anchors for this
  // tier depends on it; it is preserved verbatim in behaviour.
  for (const e of edits) {
    const before = e.to <= anchor.start;
    const after = e.from >= anchor.end;
    const interior = e.from > anchor.start && e.to < anchor.end;
    if (!before && !after && !interior) {
      return refusedResult(IDENTITY_REASON.EDIT_TOUCHES_BOUNDARY);
    }
  }

  let mapped;
  try {
    // 'after' on the start and 'before' on the end map the node's INTERIOR:
    // text inserted exactly at the start pushes the node right, text inserted
    // exactly at the end stays outside it, and a span that swallowed the node
    // collapses to an empty range.
    mapped = edit.mapRange({ from: anchor.start, to: anchor.end }, edits, {
      startAffinity: edit.AFFINITY.AFTER,
      endAffinity: edit.AFFINITY.BEFORE,
    });
  } catch {
    return refusedResult(IDENTITY_REASON.MAPPING_REFUSED);
  }
  if (mapped.from >= mapped.to) {
    return refusedResult(IDENTITY_REASON.NODE_REMOVED);
  }

  const index = indexOf(session);
  const viable = index.entriesAtSpan(mapped.from, mapped.to).filter((cand) => (
    cand.nodeType === anchor.nodeType
    && cand.defName === anchor.defName
    && cand.parentType === anchor.parentType
    && cand.containingField === anchor.containingField
  ));
  if (viable.length === 0) return refusedResult(IDENTITY_REASON.NO_NODE_AT_SPAN);
  if (viable.length > 1) {
    return ambiguousResult(IDENTITY_REASON.SPAN_AMBIGUOUS, viable.length);
  }
  return resolvedResult(viable[0].node, IDENTITY_REASON.VERIFIED_SPAN);
}

// ---------------------------------------------------------------------------
// Tier 2 -- persistent DEF anchor
// ---------------------------------------------------------------------------

/**
 * Create a Tier 2 anchor for a node with a safely unique DEF name.
 *
 * Refuses -- and this is the normal case, not an exception -- for an anonymous
 * node, for a DEF name that is not unique within its provable scope, where an
 * unnamed PROTO makes the scope unprovable, and where the parse hit a node or
 * depth limit and so cannot prove uniqueness at all.
 *
 * The anchor is plain frozen data (kind, DEF name, node type, scope key), so a
 * caller may hold it across a reload. It contains no range, no path, no field
 * value and nothing that would have to be written into the document.
 *
 * @returns {{status:'created', anchor:object}|{status:'unsupported', reason:string}}
 * @throws {Error} codes ETXSESSION, EIDENTITYNODE.
 */
function createPersistentAnchor(session, node) {
  tx.assertParseSession(session, 'createPersistentAnchor: session');
  const entry = entryFor(session, node, 'createPersistentAnchor');
  if (parseIsIncomplete(session)) return unsupported(IDENTITY_REASON.PARSE_INCOMPLETE);
  if (entry.defName === null) return unsupported(IDENTITY_REASON.NO_DEF_NAME);
  if (!entry.scopeProvable) return unsupported(IDENTITY_REASON.SCOPE_NOT_PROVABLE);
  const bucket = indexOf(session).byScopedDef.get(scopedDefKey(entry.scopeKey, entry.defName)) || [];
  if (bucket.length !== 1) return unsupported(IDENTITY_REASON.DEF_NOT_UNIQUE);
  return created(Object.freeze({
    kind: ANCHOR_KIND.PERSISTENT,
    defName: entry.defName,
    nodeType: entry.nodeType,
    scopeKey: entry.scopeKey,
  }));
}

/**
 * Complete shape validation for a Tier 2 anchor, checked before any of its
 * fields is used for a lookup.
 *
 * A persistent anchor is deliberately plain, serializable, hand-constructible
 * data -- it has to survive a reload, so it cannot be branded by a WeakMap the
 * way a selection, a Tier 1 anchor or a receipt is. That is the documented
 * contract, and it means resolution treats every anchor as untrusted input:
 * shape is the only gate, so the gate has to be complete rather than
 * representative.
 *
 * Every field is required, and required to be a string of the right kind. A
 * caller-built anchor with a structurally valid shape DOES resolve -- that is
 * the contract, not an oversight. Anything malformed returns a structured
 * refusal and no node; nothing here throws, and nothing here trusts a field it
 * has not just checked.
 *
 * Unknown extra properties are ignored rather than rejected: only these four
 * fields are ever read, an anchor that gained a property in a round-trip through
 * a caller's state store is not thereby dangerous, and rejecting it would break
 * the reload the tier exists for. Anchors are likewise not required to be frozen
 * -- a value that came back from `JSON.parse` never is.
 */
function isPersistentAnchorShape(anchor) {
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) return false;
  if (anchor.kind !== ANCHOR_KIND.PERSISTENT) return false;
  if (typeof anchor.defName !== 'string' || anchor.defName === '') return false;
  if (typeof anchor.nodeType !== 'string' || anchor.nodeType === '') return false;
  if (typeof anchor.scopeKey !== 'string') return false;
  return true;
}

/**
 * Resolve a Tier 2 anchor against any parse session -- a reload, a reopen, an
 * externally changed file, or a reparse after edits nobody recorded.
 *
 * The order of the checks is the safety property:
 *   1. collect every node carrying that DEF name in that provable scope;
 *   2. none        -> safe loss;
 *   3. more than one -> AMBIGUOUS, decided on the NAME alone; node type is not
 *      used to narrow duplicates down to a survivor, because that is precisely
 *      how a confident wrong answer gets produced;
 *   4. exactly one -> only now is node type required to match.
 *
 * A renamed DEF resolves through nothing: not the old range, not a structure,
 * not field values. It is a safe loss until a separately approved explicit
 * rename operation supplies an identity transition.
 *
 * @returns {object} A frozen `resolved` / `ambiguous` / `refused` result.
 * @throws {Error} code ETXSESSION.
 */
function resolvePersistentAnchor(anchor, session) {
  tx.assertParseSession(session, 'resolvePersistentAnchor: session');
  if (!isPersistentAnchorShape(anchor)) {
    return refusedResult(IDENTITY_REASON.MALFORMED_ANCHOR);
  }
  if (parseIsIncomplete(session)) return refusedResult(IDENTITY_REASON.PARSE_INCOMPLETE);
  const bucket = indexOf(session).byScopedDef.get(scopedDefKey(anchor.scopeKey, anchor.defName)) || [];
  if (bucket.length === 0) return refusedResult(IDENTITY_REASON.DEF_NOT_FOUND);
  if (bucket.length > 1) {
    return ambiguousResult(IDENTITY_REASON.DEF_DUPLICATED, bucket.length);
  }
  const only = bucket[0];
  if (only.nodeType !== anchor.nodeType) return refusedResult(IDENTITY_REASON.TYPE_CHANGED);
  if (!only.scopeProvable) return refusedResult(IDENTITY_REASON.SCOPE_NOT_PROVABLE);
  if (only.scopeKey !== anchor.scopeKey) return refusedResult(IDENTITY_REASON.SCOPE_CHANGED);
  return resolvedResult(only.node, IDENTITY_REASON.UNIQUE_DEF);
}

module.exports = {
  IDENTITY_ERROR,
  IDENTITY_STATUS,
  ANCHOR_STATUS,
  IDENTITY_REASON,
  ANCHOR_KIND,
  CTX,
  createCurrentSelection,
  resolveCurrentSelection,
  createTransactionAnchor,
  resolveTransactionAnchor,
  createPersistentAnchor,
  resolvePersistentAnchor,
  isResolved,
  isAmbiguous,
  isRefused,
};
