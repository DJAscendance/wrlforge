'use strict';
// WD1.4 spike -- CANDIDATE node-identity strategies.
//
// THROWAWAY PROTOTYPE. No production module requires this file, and this file
// requires no production module other than the read-only VRML AST helper and the
// WD1.2 patch algebra (both pure).
//
// ---------------------------------------------------------------------------
// INDEPENDENCE FROM THE ORACLE -- read this before changing anything here
// ---------------------------------------------------------------------------
//
// This module MUST NOT require ./oracle.js or ./scenarios.js, and MUST NOT be
// given any scenario expectation. Its whole contract is:
//
//   createDescriptor(strategy, originalIndex, entry)   <- original parse only
//   resolve(strategy, descriptor, newIndex, { edits }) <- new parse (+ the edit
//                                                        set, for strategy D)
//
// `edits` is the controlled edit truth the brief sanctions; it is NOT the
// answer. Nothing here is ever told which node the oracle expects, and nothing
// here can see the oracle's expected span or expected text. spikes/.../test.js
// asserts both the require-graph and the argument shape.
//
// ---------------------------------------------------------------------------
// THE ONLY RESULT STATUSES
// ---------------------------------------------------------------------------
//
//   'resolved'   the strategy claims a specific node in the NEW parse
//   'ambiguous'  more than one candidate survives; the strategy refuses to pick
//   'refused'    no candidate survives; the selection is safely lost
//
// A strategy may lose a selection. It may say it cannot prove identity. It may
// never confidently return a different node -- that is the hard gate the whole
// lane exists to test, and no strategy here contains a "pick the closest",
// "pick the first", or "pick the highest-scoring" branch.

const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { NODE } = require(path.join(REPO_ROOT, 'src', 'vrml', 'ast.js'));
const edit = require(path.join(REPO_ROOT, 'src', 'vrml', 'edit.js'));
// transaction.js is a pure verifier over (baseText, edits, newText). It knows
// nothing about the oracle, the expectation, or which node is correct -- importing
// it does not weaken the candidate/oracle independence asserted in test.js.
const transaction = require('./transaction');
const { HarnessError, HARNESS } = require('./session');

const STRATEGIES = Object.freeze(['A1', 'A2', 'B', 'C', 'D', 'E']);

const STRATEGY_LABELS = Object.freeze({
  A1: 'A1 unique DEF (flat document scope)',
  A2: 'A2 unique DEF (PROTO-lexical scope qualified)',
  B: 'B exact structural path',
  C: 'C structural path + strict fingerprint',
  D: 'D offset-assisted conservative resolution',
  E: 'E combined conservative (A2 -> B+C+D agreement)',
});

const STATUS = Object.freeze({ RESOLVED: 'resolved', AMBIGUOUS: 'ambiguous', REFUSED: 'refused' });

// Keys ast.walk does not descend into. Mirrored so this module's traversal
// produces exactly the parent/child relation the production walk produces.
const SKIPPED_KEYS = new Set(['range', 'type', 'leadingTrivia']);

// ---------------------------------------------------------------------------
// Index construction
// ---------------------------------------------------------------------------

// Sentinels for structural context that is not a field name. Distinct
// non-identifier strings so they can never collide with a real VRML field.
const CTX = Object.freeze({
  STATEMENT: '#statement',
  PROTO_BODY: '#proto-body',
  INTERFACE_DEFAULT: '#interface-default',
  ROOT: '#root',
  UNKNOWN: '#unknown',
});

function accessorSegment(key, index) {
  return index === null ? key : `${key}[${index}]`;
}

/**
 * Read a child through the accessor shape `pathTo`-style segments record.
 * `key` may be dotted with bracket indices for children nested inside untyped
 * holder objects (a ROUTE's `from`/`to`, for instance).
 */
function readAccessor(holder, key, index) {
  let cur = holder;
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return null;
    const match = /^([^[\]]+)(?:\[(\d+)\])?$/.exec(part);
    if (!match) return null;
    cur = cur[match[1]];
    if (match[2] !== undefined) {
      if (!Array.isArray(cur)) return null;
      cur = cur[Number(match[2])];
    }
  }
  if (index === null) return cur === undefined ? null : cur;
  if (!Array.isArray(cur)) return null;
  const item = cur[index];
  return item === undefined ? null : item;
}

// The structural context a node instance sits in, derived by walking up the
// typed-ancestor chain. Array nodes are transparent (an MFNode child's real
// context is the Field that holds the array).
function contextOf(ancestors) {
  let containingField = CTX.ROOT;
  let parentType = CTX.ROOT;
  const protoChain = [];

  let sawField = false;
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const a = ancestors[i];
    if (a.type === NODE.ARRAY) continue;
    if (!sawField) {
      if (a.type === NODE.FIELD) { containingField = a.name || CTX.UNKNOWN; sawField = true; continue; }
      if (a.type === NODE.DOCUMENT) { containingField = CTX.STATEMENT; sawField = true; continue; }
      if (a.type === NODE.PROTO) { containingField = CTX.PROTO_BODY; sawField = true; continue; }
      if (a.type === NODE.INTERFACE) { containingField = CTX.INTERFACE_DEFAULT; sawField = true; continue; }
      if (a.type === NODE.NODE) { containingField = CTX.UNKNOWN; sawField = true; }
    }
    break;
  }
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    if (ancestors[i].type === NODE.NODE) { parentType = ancestors[i].nodeType; break; }
    if (ancestors[i].type === NODE.DOCUMENT) { parentType = CTX.ROOT; break; }
  }
  for (const a of ancestors) {
    if (a.type === NODE.PROTO) protoChain.push(a.name == null ? '?' : a.name);
  }
  return { containingField, parentType, scopeKey: protoChain.join('/') };
}

// A node's direct child signature: the ordered node types (and USE targets) its
// fields hold. Direct children only -- a recursive signature would make every
// interior edit invalidate every ancestor's fingerprint.
function childSignature(node) {
  const parts = [];
  for (const field of node.fields) {
    const value = field.value;
    if (!value || typeof value !== 'object') continue;
    if (value.type === NODE.NODE) parts.push(value.nodeType);
    else if (value.type === NODE.USE) parts.push(`USE:${value.name}`);
    else if (value.type === NODE.ARRAY) {
      for (const item of value.items) {
        if (!item || typeof item !== 'object') continue;
        if (item.type === NODE.NODE) parts.push(item.nodeType);
        else if (item.type === NODE.USE) parts.push(`USE:${item.name}`);
        else if (item.type === NODE.PROTO) parts.push(`PROTO:${item.name}`);
      }
    }
  }
  return parts;
}

// The strict fingerprint. Deliberately STRUCTURE-ONLY: it carries no scalar
// field VALUES.
//
// Including values was considered and rejected. The candidate cannot know which
// values an edit is about to change, so a value-sensitive fingerprint would turn
// every ordinary "set translation" edit into a lost selection -- while adding no
// safety at all against the case that actually matters, two byte-identical
// sibling nodes, because identical siblings have identical values too.
function fingerprintOf(node, ctx) {
  return JSON.stringify([
    node.nodeType,
    node.def || '',
    ctx.parentType,
    ctx.containingField,
    ctx.scopeKey,
    node.fields.map((f) => f.name).join(','),        // ordered field-name signature
    node.interfaces.length,
    childSignature(node).join(','),                   // ordered child-type signature
    node.fields.length,                               // local arity
  ]);
}

/**
 * Build a candidate-resolution index over one parse result.
 *
 * Every entry describes one node INSTANCE (`NODE.NODE`); USE references, fields,
 * and value nodes are not selectable and are not indexed. The traversal mirrors
 * `ast.walk` exactly (same skipped keys, arrays transparent, untyped holders
 * entered) so a path recorded here addresses the same child the production walk
 * would report.
 */
function buildIndex(input) {
  // A SESSION IS REQUIRED -- see session.js. Accepting a bare parse result used to
  // be allowed, and an independent review showed that was a hole: two raw parses
  // of identical text both produced untagged results, `assertSameSession` let the
  // comparison through, and every strategy was reported as `wrong`. The invariant
  // is only real if there is no untagged path out of a real parse.
  if (!input || typeof input.sessionId !== 'string' || !input.parse) {
    throw new HarnessError(
      HARNESS.MISSING_SESSION,
      'buildIndex requires a parse session (session.createSession(text, parse(text))), not a bare parse result',
    );
  }
  const parseResult = input.parse;
  const sessionId = input.sessionId;
  const baseText = input.text;
  const tree = parseResult && parseResult.tree ? parseResult.tree : null;
  const entries = [];
  const byNode = new Map();
  const byDef = new Map();
  const byScopedDef = new Map();
  const byFingerprint = new Map();
  const byPathKey = new Map();
  const bySpan = new Map();

  const ancestors = [];
  const segs = [];

  function record(node) {
    const ctx = contextOf(ancestors);
    const range = node.range || null;
    const entry = {
      node,
      nodeType: node.nodeType,
      defName: node.def || null,
      parentType: ctx.parentType,
      containingField: ctx.containingField,
      scopeKey: ctx.scopeKey,
      depth: ancestors.length,
      path: segs.map((s) => ({ key: s.key, index: s.index })),
      pathKey: segs.map((s) => accessorSegment(s.key, s.index)).join('/'),
      fingerprint: fingerprintOf(node, ctx),
      start: range && range.start ? range.start.offset : null,
      end: range && range.end ? range.end.offset : null,
      incomplete: !!node.incomplete,
      order: entries.length,
    };
    entries.push(entry);
    byNode.set(node, entry);
    if (entry.defName !== null) {
      if (!byDef.has(entry.defName)) byDef.set(entry.defName, []);
      byDef.get(entry.defName).push(entry);
      const scoped = `${entry.scopeKey} ${entry.defName}`;
      if (!byScopedDef.has(scoped)) byScopedDef.set(scoped, []);
      byScopedDef.get(scoped).push(entry);
    }
    if (!byFingerprint.has(entry.fingerprint)) byFingerprint.set(entry.fingerprint, []);
    byFingerprint.get(entry.fingerprint).push(entry);
    // Paths are unique by construction (one accessor chain per tree position);
    // the map is still built defensively so a recovered parse cannot corrupt it.
    if (!byPathKey.has(entry.pathKey)) byPathKey.set(entry.pathKey, entry);
    if (entry.start !== null && entry.end !== null) {
      const spanKey = `${entry.start}:${entry.end}`;
      if (!bySpan.has(spanKey)) bySpan.set(spanKey, []);
      bySpan.get(spanKey).push(entry);
    }
  }

  function descend(container, prefix) {
    for (const key in container) {
      if (SKIPPED_KEYS.has(key)) continue;
      const value = container[key];
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
          const item = value[i];
          if (!item || typeof item !== 'object') continue;
          if (typeof item.type === 'string') enter(item, `${prefix}${key}`, i);
          else descend(item, `${prefix}${key}[${i}].`);
        }
        continue;
      }
      if (typeof value.type === 'string') enter(value, `${prefix}${key}`, null);
      else descend(value, `${prefix}${key}.`);
    }
  }

  function enter(node, key, index) {
    segs.push({ key, index });
    if (node.type === NODE.NODE) record(node);
    ancestors.push(node);
    descend(node, '');
    ancestors.pop();
    segs.pop();
  }

  if (tree) {
    // The Document root itself is never a selectable node instance.
    descend(tree, '');
  }

  function resolvePath(pathSegs) {
    let cur = tree;
    for (const seg of pathSegs) {
      if (!cur || typeof cur !== 'object') return null;
      cur = readAccessor(cur, seg.key, seg.index);
      if (!cur || typeof cur !== 'object' || typeof cur.type !== 'string') return null;
    }
    return cur;
  }

  return {
    sessionId,
    // Digest of the exact text this index was built from. A strategy-D anchor
    // records it, and D refuses any receipt minted for a different document.
    baseDigest: typeof baseText === 'string' ? transaction.digest(baseText) : undefined,
    tree,
    entries,
    byNode,
    byDef,
    byScopedDef,
    byFingerprint,
    byPathKey,
    bySpan,
    resolvePath,
    entryFor: (node) => byNode.get(node) || null,
  };
}

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

const unsupported = (reason) => ({ supported: false, reason });

function createDescriptor(strategy, originalIndex, entry) {
  switch (strategy) {
    case 'A1': {
      if (entry.defName === null) return unsupported('node has no DEF name');
      const peers = originalIndex.byDef.get(entry.defName) || [];
      if (peers.length !== 1) return unsupported('DEF name is not unique in the document');
      return { supported: true, kind: 'def-flat', def: entry.defName, nodeType: entry.nodeType };
    }
    case 'A2': {
      if (entry.defName === null) return unsupported('node has no DEF name');
      const scoped = `${entry.scopeKey} ${entry.defName}`;
      const peers = originalIndex.byScopedDef.get(scoped) || [];
      if (peers.length !== 1) return unsupported('DEF name is not unique within its PROTO-lexical scope');
      return {
        supported: true, kind: 'def-scoped', def: entry.defName,
        nodeType: entry.nodeType, scopeKey: entry.scopeKey,
      };
    }
    case 'B':
      return {
        supported: true, kind: 'path', path: entry.path, pathKey: entry.pathKey,
        nodeType: entry.nodeType, def: entry.defName,
      };
    case 'C': {
      const peers = originalIndex.byFingerprint.get(entry.fingerprint) || [];
      if (peers.length !== 1) return unsupported('fingerprint is not unique in the original document');
      return {
        supported: true, kind: 'path+fingerprint', path: entry.path,
        fingerprint: entry.fingerprint, nodeType: entry.nodeType, def: entry.defName,
      };
    }
    case 'D':
      if (entry.start === null || entry.end === null) return unsupported('node carries no usable range');
      if (typeof originalIndex.baseDigest !== 'string') {
        return unsupported('index carries no base-document digest; a D anchor cannot be bound to a document');
      }
      return {
        supported: true, kind: 'offset', start: entry.start, end: entry.end,
        nodeType: entry.nodeType, def: entry.defName,
        parentType: entry.parentType, containingField: entry.containingField,
        // The document this anchor was created against. Checked against the
        // receipt's baseDigest at resolve time.
        baseDigest: originalIndex.baseDigest,
      };
    case 'E': {
      const layers = {};
      for (const id of ['A2', 'B', 'C', 'D']) layers[id] = createDescriptor(id, originalIndex, entry);
      return { supported: true, kind: 'combined', layers };
    }
    default:
      throw new Error(`unknown strategy ${strategy}`);
  }
}

function createDescriptors(originalIndex, entry) {
  const out = {};
  for (const id of STRATEGIES) out[id] = createDescriptor(id, originalIndex, entry);
  return out;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

const refused = (reason) => ({ status: STATUS.REFUSED, node: null, reason });
const ambiguous = (reason, count) => ({ status: STATUS.AMBIGUOUS, node: null, reason, count });
const resolved = (entry, reason) => ({ status: STATUS.RESOLVED, node: entry.node, entry, reason });

// Shared by A1/A2. Ambiguity is decided on NAME matches alone, BEFORE the node
// type is considered: a duplicate DEF name is ambiguous even when only one of
// the duplicates has the right type. Narrowing by type first would be exactly
// the "resolve a duplicate by picking the plausible one" behaviour the brief
// forbids.
function resolveByDefBucket(bucket, descriptor) {
  if (bucket.length === 0) return refused('no DEF with that name in the new parse');
  if (bucket.length > 1) return ambiguous('DEF name is duplicated in the new parse', bucket.length);
  const only = bucket[0];
  if (only.nodeType !== descriptor.nodeType) return refused('DEF resolved but node type changed');
  return resolved(only, 'unique DEF');
}

/**
 * Resolve, then stamp the result with the index's parse session.
 *
 * The stamp is what lets `oracle.classify` refuse to compare nodes that came from
 * different parses -- see session.js. Wrapping here means every strategy,
 * including the ones E resolves internally, is tagged without each branch
 * remembering to do it.
 */
function resolve(strategy, descriptor, newIndex, ctx = {}) {
  const result = resolveInner(strategy, descriptor, newIndex, ctx);
  if (newIndex && newIndex.sessionId !== undefined && result && result.sessionId === undefined) {
    result.sessionId = newIndex.sessionId;
  }
  return result;
}

/**
 * The verified edit set strategy D is allowed to use, or null.
 *
 * Fails closed. A bare `ctx.edits` is NOT enough: an unverified edit set is
 * exactly the stale/foreign/partial input the transaction contract exists to
 * reject, and D's offset arithmetic cannot tell a truthful one from a lie.
 */
function verifiedEdits(ctx, descriptor) {
  const receipt = ctx.transaction;
  if (!receipt) return null;
  // Must have been minted by transaction.verify() in this process. A hand-rolled
  // `{status:'verified'}` object is not a proof of anything, and D used to trust
  // one purely on shape.
  if (!transaction.isIssued(receipt)) return null;
  if (receipt.status !== transaction.TX.VERIFIED) return null;
  if (!Array.isArray(receipt.edits)) return null;
  // Must be bound to the document the anchor came from. Without this a receipt
  // legitimately minted for file X licenses a re-anchor into file Y.
  if (descriptor && typeof descriptor.baseDigest === 'string'
    && receipt.baseDigest !== descriptor.baseDigest) return null;
  return receipt.edits;
}

function resolveInner(strategy, descriptor, newIndex, ctx = {}) {
  if (!descriptor || !descriptor.supported) {
    return refused(descriptor ? descriptor.reason : 'no descriptor');
  }
  switch (strategy) {
    case 'A1':
      return resolveByDefBucket(newIndex.byDef.get(descriptor.def) || [], descriptor);

    case 'A2': {
      const scoped = `${descriptor.scopeKey} ${descriptor.def}`;
      const bucket = newIndex.byScopedDef.get(scoped) || [];
      const result = resolveByDefBucket(bucket, descriptor);
      if (result.status === STATUS.RESOLVED && result.entry.scopeKey !== descriptor.scopeKey) {
        return refused('PROTO-lexical scope changed');
      }
      return result;
    }

    case 'B': {
      const node = newIndex.resolvePath(descriptor.path);
      if (!node) return refused('path does not resolve in the new parse');
      if (node.type !== NODE.NODE) return refused('path resolves to a non-node');
      if (node.nodeType !== descriptor.nodeType) return refused('path resolves to a different node type');
      const def = node.def || null;
      if (def !== descriptor.def) return refused('path resolves to a node with a different DEF name');
      const entry = newIndex.entryFor(node);
      if (!entry) return refused('resolved node is not in the new index');
      return resolved(entry, 'exact structural path');
    }

    case 'C': {
      const bucket = newIndex.byFingerprint.get(descriptor.fingerprint) || [];
      if (bucket.length === 0) return refused('fingerprint absent from the new parse');
      if (bucket.length > 1) return ambiguous('fingerprint is not unique in the new parse', bucket.length);
      const only = bucket[0];
      const pathNode = newIndex.resolvePath(descriptor.path);
      // The path is a corroborating constraint, never a tie-breaker. When it
      // resolves to a DIFFERENT node than the unique fingerprint, two pieces of
      // evidence disagree and the strategy refuses to choose between them.
      if (pathNode && pathNode !== only.node) {
        return ambiguous('structural path and unique fingerprint disagree', 2);
      }
      return resolved(only, 'unique fingerprint (path agrees or is silent)');
    }

    case 'D': {
      // TIER 1 GATE. D may only run against an edit set that has been proven to
      // connect the exact old canonical text to the exact new canonical text.
      // Without that receipt there is no safe re-anchoring here at all.
      const edits = verifiedEdits(ctx, descriptor);
      if (!edits) {
        const receipt = ctx.transaction;
        if (!receipt) return refused('no verified edit transaction supplied; offset-assisted resolution is not permitted');
        if (!transaction.isIssued(receipt)) {
          return refused('edit transaction was not issued by transaction.verify(); refusing an unverifiable receipt');
        }
        if (receipt.status !== transaction.TX.VERIFIED) {
          return refused(`edit transaction not verified (${receipt.reason || 'unknown'})`);
        }
        return refused('edit transaction is bound to a different base document than this anchor');
      }
      // Containment guard. Every edit must be wholly before the node, wholly
      // after it, or STRICTLY INTERIOR to it. An edit that touches or crosses a
      // boundary may have replaced the node itself, and no amount of offset
      // arithmetic can distinguish "my node, edited" from "my node, replaced by
      // a similar one" -- so this refuses instead of guessing.
      for (const e of edits) {
        const before = e.to <= descriptor.start;
        const after = e.from >= descriptor.end;
        const interior = e.from > descriptor.start && e.to < descriptor.end;
        if (!before && !after && !interior) return refused('an edit touches or crosses the node boundary');
      }
      let mapped;
      try {
        // 'after' on the start and 'before' on the end map the node's INTERIOR.
        // Text inserted exactly at the start therefore pushes the node right
        // (correct), text inserted exactly at the end stays outside it
        // (correct), and a span that swallows the node collapses to an empty
        // range (which the emptiness check below turns into a safe loss).
        mapped = edit.mapRange({ from: descriptor.start, to: descriptor.end }, edits, {
          startAffinity: edit.AFFINITY.AFTER,
          endAffinity: edit.AFFINITY.BEFORE,
        });
      } catch (err) {
        return refused(`offset mapping refused: ${err.code || 'error'}`);
      }
      if (mapped.from >= mapped.to) return refused('mapped range collapsed; the node was replaced or removed');
      const bucket = newIndex.bySpan.get(`${mapped.from}:${mapped.to}`) || [];
      const viable = bucket.filter((cand) => cand.nodeType === descriptor.nodeType
        && (cand.defName || null) === descriptor.def
        && cand.parentType === descriptor.parentType
        && cand.containingField === descriptor.containingField);
      if (viable.length === 0) return refused('no node occupies exactly the mapped span with matching context');
      if (viable.length > 1) return ambiguous('several nodes share the mapped span and context', viable.length);
      return resolved(viable[0], 'exact mapped span + type + parent + field agreement');
    }

    case 'E': {
      const layers = descriptor.layers;
      const detail = {};

      const a2 = resolve('A2', layers.A2, newIndex, ctx);
      detail.A2 = a2.status;
      if (layers.A2.supported) {
        if (a2.status === STATUS.RESOLVED) {
          return { ...a2, layer: 'def', detail, reason: 'layer 1: unique scoped DEF' };
        }
        if (a2.status === STATUS.AMBIGUOUS) {
          return { ...a2, layer: 'def', detail, reason: 'layer 1: DEF name duplicated' };
        }
        // A2 refused (the DEF is simply gone). Structural layers may still be
        // able to prove identity safely, so fall through rather than give up.
      }

      const b = resolve('B', layers.B, newIndex, ctx);
      const c = resolve('C', layers.C, newIndex, ctx);
      const d = resolve('D', layers.D, newIndex, ctx);
      detail.B = b.status; detail.C = c.status; detail.D = d.status;

      // Only a VERIFIED transaction makes D's opinion available; without one D
      // refuses and E must not require its agreement (it would never resolve).
      const haveEdits = verifiedEdits(ctx, layers.D) !== null;
      // DELIBERATE: the layers are compared by AST object identity (`===`), not by
      // span or fingerprint equality. All three resolved against the SAME newIndex,
      // hence the same parse session, so object identity is exactly the right test
      // and a look-alike cannot satisfy it. Note this is E's own internal check and
      // does not go through session.assertSameSession -- that guard runs later, in
      // oracle.classify, on whatever E returns.
      const agree = b.status === STATUS.RESOLVED
        && c.status === STATUS.RESOLVED
        && b.node === c.node
        && (!haveEdits || (d.status === STATUS.RESOLVED && d.node === b.node));

      if (agree) {
        return {
          status: STATUS.RESOLVED, node: b.node, entry: c.entry,
          layer: haveEdits ? 'structural+offset' : 'structural',
          detail,
          reason: 'layer 2: path, unique fingerprint and mapped span all name the same node',
        };
      }
      if (b.status === STATUS.AMBIGUOUS || c.status === STATUS.AMBIGUOUS || d.status === STATUS.AMBIGUOUS) {
        return { status: STATUS.AMBIGUOUS, node: null, layer: 'structural', detail, reason: 'layer 2: evidence is ambiguous' };
      }
      return { status: STATUS.REFUSED, node: null, layer: 'none', detail, reason: 'layer 2: evidence does not agree' };
    }

    default:
      throw new Error(`unknown strategy ${strategy}`);
  }
}

module.exports = {
  STRATEGIES,
  STRATEGY_LABELS,
  STATUS,
  CTX,
  buildIndex,
  fingerprintOf,
  createDescriptor,
  createDescriptors,
  resolve,
};
