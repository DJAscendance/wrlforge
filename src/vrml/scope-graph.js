'use strict';
// VRML97 DEF/USE scope graph (Phase WD1.5-P1).
//
// PURE and browser-safe: requires only `src/vrml/ast.js` (the NODE type
// discriminators) and `src/vrml/symbols.js` (the taxonomy and the frozen
// projection shapes). No fs, no Electron, no crypto, no CodeMirror, no parser,
// no node schema -- DEF/USE resolution is a purely lexical question and needs no
// schema at all. READ-ONLY over a parse result: it never mutates a tree, never
// re-parses, never writes, and never freezes anything the parser owns.
//
// NO PRODUCTION CONSUMER IS WIRED TO THIS MODULE. `analyze.js`, the diagnostics
// table, node identity, the editor, the renderer, the validator and the World
// scanner all run unchanged on their own code paths. Wiring any of them is a
// separate approved lane (WD1.5-P4 / P5).
//
// ---------------------------------------------------------------------------
// THE HARD GATE, INHERITED FROM WD1.4 AND NOT REOPENED
// ---------------------------------------------------------------------------
//
// A reference may be LOST. A reference may be reported AMBIGUOUS. This module
// may say a scope is too damaged to answer. It may NEVER confidently bind a
// reference to the WRONG declaration.
//
// Downstream of that, and absent from this file by construction: first-match,
// closest-match, nearest-range, structural-path identity, fingerprinting, fuzzy
// matching, scoring and ranking of any kind. `test/vrml/scope-graph.test.js`
// asserts their absence by source scan AND by behaviour.
//
// INCLUDING ONE RULE THE STANDARD STATES AND THIS RESOLVER REFUSES.
// ISO/IEC 14772-1 4.6.2: "If multiple nodes are given the same name, each USE
// statement refers to the closest node with the given name preceding it." That
// is a fully specified, deterministic language rule -- not a heuristic -- and it
// is recorded as normative-explicit in the committed standards model. This
// resolver still returns `ambiguous` and does NOT implement it, because its
// consumers are identity, rename and refactoring, where silently rebinding the
// other `DEF Ball` is precisely the failure the gate exists to prevent. If
// viewer fidelity ever needs the browser's answer it belongs in a separately
// named `languageSemantics` query that never feeds identity, rename or
// navigation. See spikes/wd1-scope-semantics/REPORT.md §7.
//
// ---------------------------------------------------------------------------
// THE ONE STRUCTURAL RULE
// ---------------------------------------------------------------------------
//
// ISO/IEC 14772-1 4.8.4: a PROTO establishes a DEF/USE scope SEPARATE from the
// rest of the scene and from any nested PROTO, in BOTH directions. That is
// DISJOINTNESS, NOT SHADOWING -- a PROTO body's node-name lookup has no parent
// and simply stops. It is expressed structurally: `defParent === null` on every
// proto-body scope, so the lookup walk terminates there because there is
// nowhere to go, not because a special case says so.
//
// `typeParent` still points outward (a nested body may instantiate a type
// declared in an enclosing scope). P1 records that link and implements NO type
// lookup through it; node types, PROTO declarations, EXTERNPROTO, IS, ROUTE and
// Script interfaces are WD1.5-P2.
//
// ---------------------------------------------------------------------------
// KNOWN, DELIBERATE LIMITS OF P1
// ---------------------------------------------------------------------------
//
// 1. A PROTO's INTERFACE DEFAULT VALUES are not traversed, so a DEF written
//    inside `PROTO P [ field SFNode d DEF X Shape {} ] { ... }` is invisible and
//    a USE of it answers `unresolved`. Which scope owns such a declaration is an
//    interpretation question the committed standards model does not settle, and
//    interpretation-grade behaviour fails closed. A node's own interface
//    defaults ARE traversed (the owning scope is not in doubt there). Pinned by
//    test so the limit stays deliberate.
// 2. Recovery attribution is coarser than the research prototype's, because P1
//    creates no interface scopes. A syntax error inside a Script or EXTERNPROTO
//    interface is attributed to the enclosing DEF scope instead. That is
//    strictly MORE conservative -- it can only turn `resolved` into `recovered`,
//    never the reverse.

const { NODE } = require('./ast');
const sym = require('./symbols');

const {
  SCOPE_ERROR, SCOPE_KIND, STATUS, REASON, scopeError,
} = sym;

// ---------------------------------------------------------------------------
// Private state
// ---------------------------------------------------------------------------
//
// A graph's public handle is an inert frozen object. Everything real -- scopes,
// symbols, references, resolutions and the lookup indexes -- lives here, keyed
// by that handle. Consumers therefore cannot reach a Map, a Set or an internal
// array to mutate it, and cannot forge a handle by matching a shape.
const INTERNALS = new WeakMap();

function internalsOf(graph, label) {
  const state = (graph && typeof graph === 'object') ? INTERNALS.get(graph) : undefined;
  if (!state) {
    throw scopeError(SCOPE_ERROR.GRAPH,
      `${label}: expected a scope graph from buildScopeGraph()`);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Range helpers
// ---------------------------------------------------------------------------

const offsetOf = (range) => (range && range.start ? range.start.offset : -1);
const endOffsetOf = (range) => (range && range.end ? range.end.offset : -1);

function contains(outer, inner) {
  if (!outer || !inner) return false;
  return offsetOf(outer) <= offsetOf(inner) && endOffsetOf(inner) <= endOffsetOf(outer);
}

// Codepoint order, never `localeCompare`: collation is locale-dependent and this
// ordering is part of the module's determinism contract.
function byCodepoint(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// Source position first, then a stable tiebreak so two constructs starting at
// the same offset never swap between runs.
function byPosition(a, b) {
  if (a.sortOffset !== b.sortOffset) return a.sortOffset - b.sortOffset;
  return byCodepoint(a.sortName, b.sortName);
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

class Builder {
  constructor(parseResult) {
    this.scopes = [];
    this.symbols = [];
    this.references = [];
    // A hard parse cap did not merely damage a region: the tree is genuinely
    // aborted, so NO lexical scope in the document is provable. This matches
    // WD1.4 Tier 2's `document-parse-incomplete`.
    this.documentIncomplete = !!(parseResult.truncated || parseResult.depthCapped);
    this.syntaxDiagnostics = parseResult.syntaxDiagnostics;
  }

  addScope(kind, ownerRange, extra) {
    const scope = {
      index: this.scopes.length,
      kind,
      // `null` on a PROTO body -- 4.8.4, and the whole structural rule.
      defParentIndex: (extra && extra.defParentIndex != null) ? extra.defParentIndex : null,
      // Points outward. Recorded for P2; P1 never walks it.
      typeParentIndex: (extra && extra.typeParentIndex != null) ? extra.typeParentIndex : null,
      ownerRange: ownerRange || null,
      ownerName: (extra && extra.ownerName != null) ? extra.ownerName : null,
      ownerNode: (extra && extra.ownerNode) || null,
      recovered: false,
      recoveredReason: null,
    };
    this.scopes.push(scope);
    return scope;
  }

  addDef(node, scope) {
    const declRange = node.defRange || node.range;
    this.symbols.push({
      name: node.def,
      node,
      scopeIndex: scope.index,
      declRange,
      nodeType: node.nodeType == null ? null : node.nodeType,
      // 4.6.2 "preceding it" -- a DEF becomes visible at its own name token.
      visibleFrom: offsetOf(declRange),
      sortOffset: offsetOf(declRange),
      sortName: node.def == null ? '' : String(node.def),
    });
  }

  addUse(use, scope, insideScript) {
    const range = use.nameRange || use.range;
    this.references.push({
      name: use.name == null ? null : use.name,
      node: use,
      scopeIndex: scope.index,
      range,
      offset: offsetOf(range),
      insideScript: !!insideScript,
      sortOffset: offsetOf(range),
      sortName: use.name == null ? '' : String(use.name),
    });
  }
}

// --- traversal -------------------------------------------------------------
//
// `ctx` carries exactly the containment facts a DEF/USE decision needs, and is
// rebuilt rather than mutated on descent so a sibling can never observe a
// cousin's context.

function visitStatements(b, statements, ctx) {
  for (const stmt of statements || []) visitStatement(b, stmt, ctx);
}

function visitStatement(b, stmt, ctx) {
  if (!stmt || typeof stmt.type !== 'string') return;
  switch (stmt.type) {
    case NODE.NODE: visitNode(b, stmt, ctx); return;
    case NODE.USE: b.addUse(stmt, ctx.scope, ctx.insideScript); return;
    case NODE.PROTO: visitProto(b, stmt, ctx); return;
    // A ROUTE contributes route-node / route-event references, which are P2.
    // An EXTERNPROTO declares a node TYPE and has no body, so it owns no
    // DEF/USE scope and (4.9.1) carries no field defaults to descend into.
    case NODE.ROUTE:
    case NODE.EXTERNPROTO:
    default:
  }
}

function visitProto(b, proto, ctx) {
  // A PROTO body owns a DEF scope with NO defParent. `typeParent` points at the
  // enclosing scope for P2's benefit and is never walked here.
  const body = b.addScope(SCOPE_KIND.PROTO_BODY, proto.range, {
    defParentIndex: null,
    typeParentIndex: ctx.scope.index,
    ownerName: proto.name == null ? null : proto.name,
    ownerNode: proto,
  });

  // Fail closed where the parse cannot prove the construct at all. Neither of
  // these needs a diagnostic: they are structural.
  if (proto.name == null) {
    body.recovered = true;
    body.recoveredReason = REASON.PROTO_SCOPE_NOT_PROVABLE;
  }
  // Annex A `protoBody ::= protoStatements rootNodeStatement statements`: a
  // conforming body holds at least one node statement. An empty one is a
  // truncated parse or invalid source; either way the body scope cannot be
  // trusted to be complete. Checked independently of the name, and second, so
  // the more specific structural reason is the one reported -- matching the
  // committed research model exactly.
  if (!proto.body || proto.body.length === 0) {
    body.recovered = true;
    body.recoveredReason = REASON.PROTO_BODY_NOT_PROVABLE;
  }

  // Interface defaults are deliberately NOT descended into -- see the header,
  // limit 1. `insideScript` is carried through rather than reset, matching the
  // committed model: a PROTO statement can appear inside a node body, and the
  // model treats "lexically under a Script" as the condition 4.4.4 turns on.
  visitStatements(b, proto.body, { scope: body, insideScript: ctx.insideScript });
}

function visitNode(b, node, ctx) {
  if (node.def != null) b.addDef(node, ctx.scope);

  // 4.4.4 excludes a Script's descendants from the transformation hierarchy, so
  // the acyclicity rule must not fire below one. This is carried DOWN rather
  // than recomputed by walking ancestors back up.
  const inner = {
    scope: ctx.scope,
    insideScript: ctx.insideScript || node.nodeType === 'Script',
  };

  // A node's own interface declarations (Script, per 6.40) may carry default
  // values containing nodes. The owning scope is not in doubt here -- it is the
  // scope the node itself sits in -- so these ARE traversed.
  for (const decl of node.interfaces || []) {
    if (decl && decl.default) visitValue(b, decl.default, inner);
  }

  for (const field of node.fields || []) {
    if (!field) continue;
    // Annex A `nodeBodyElement` admits ROUTE and PROTO statements inside a node
    // body, and the parser collects them into `node.fields` -- only interface
    // declarations get their own array. Iterating `fields` as if every entry
    // were a field silently drops them; that cost the research spike 5,444 real
    // ROUTEs before it was caught. Dispatch on `type`.
    if (field.type === NODE.ROUTE || field.type === NODE.PROTO
      || field.type === NODE.EXTERNPROTO) {
      visitStatement(b, field, inner);
      continue;
    }
    // `fieldId IS interfaceId` binds an interface member, not a node name.
    if (field.isBinding && field.value && field.value.type === NODE.IS) continue;
    visitValue(b, field.value, inner);
  }
}

function visitValue(b, value, ctx) {
  if (!value || typeof value.type !== 'string') return;
  switch (value.type) {
    case NODE.NODE: visitNode(b, value, ctx); return;
    case NODE.USE: b.addUse(value, ctx.scope, ctx.insideScript); return;
    // Non-conforming inside an MFNode array (Annex A `mfnodeValue` admits only
    // node statements), accepted by the parser as a Cybertown/Blaxxun
    // compatibility measure. Classified there, honoured here: a PROTO in an
    // array still opens a real body scope, and dropping it would lose every
    // DEF inside it.
    case NODE.PROTO: visitProto(b, value, ctx); return;
    case NODE.ROUTE:
    case NODE.EXTERNPROTO: return;
    case NODE.ARRAY: {
      for (const item of value.items || []) visitValue(b, item, ctx);
      return;
    }
    default:
  }
}

// --- recovery --------------------------------------------------------------

// A scope is recovered when the document hit a hard parse cap, when the
// construct is structurally unusable, or when a syntax error lands inside it.
//
// Each error is attributed to the INNERMOST scope containing it, never to every
// enclosing one. Without that, a single stray error anywhere in a file would
// mark the document scope recovered and suppress every honest "not declared"
// answer in the whole document.
function markRecovery(b) {
  if (b.documentIncomplete) {
    for (const scope of b.scopes) {
      scope.recovered = true;
      scope.recoveredReason = REASON.DOCUMENT_PARSE_INCOMPLETE;
    }
    return;
  }
  for (const d of b.syntaxDiagnostics) {
    if (!d || d.severity !== 'error') continue;
    let best = null;
    if (d.range) {
      for (const scope of b.scopes) {
        if (!scope.ownerRange || !contains(scope.ownerRange, d.range)) continue;
        const span = endOffsetOf(scope.ownerRange) - offsetOf(scope.ownerRange);
        if (best === null || span < best) best = span;
      }
    }
    // An error NO scope contains -- one lying outside `tree.range`, or one with
    // no range at all. "Innermost containing scope" has no answer here, and
    // dropping it would leave every scope marked clean on the strength of
    // damage the model just admitted it cannot place. Unlocalized damage is
    // unlocalized: the whole graph fails closed, exactly as a hard parse cap
    // does. Measured cost on the 6,248-file corpus: 6 diagnostics in 6 files,
    // every one of which was already recovered through a second, attributable
    // diagnostic -- so zero resolution outcomes change. This is a structural
    // hazard closed at nil cost, the same call the lane made for `/`-joined
    // scope keys, which likewise had zero corpus instances.
    if (best === null) {
      for (const scope of b.scopes) {
        if (scope.recovered) continue;
        scope.recovered = true;
        scope.recoveredReason = REASON.SCOPE_RECOVERED;
      }
      continue;
    }
    for (const scope of b.scopes) {
      if (!scope.ownerRange || !contains(scope.ownerRange, d.range)) continue;
      if (endOffsetOf(scope.ownerRange) - offsetOf(scope.ownerRange) !== best) continue;
      // A structurally recovered scope keeps its more specific reason.
      if (scope.recovered) continue;
      scope.recovered = true;
      scope.recoveredReason = REASON.SCOPE_RECOVERED;
    }
  }
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

// Walk the node-name chain. A PROTO body has `defParent === null`, so this
// terminates there -- that IS rule D5, expressed structurally rather than as a
// special case. In P1 no scope kind sets a non-null `defParent`, so the walk is
// always one step; it is written as a walk anyway so the invariant is enforced
// by the data rather than by the loop.
function chainOf(state, scope) {
  const out = [];
  let cur = scope;
  while (cur) {
    out.push(cur);
    cur = cur.defParent;
  }
  void state;
  return out;
}

function defsIn(state, scope, name) {
  const table = state.defsByScope.get(scope);
  if (!table) return [];
  return table.get(name) || [];
}

// Declarations of `name` visible from `beforeOffset` -- 4.6.2's "preceding it".
function lookupDef(state, scope, name, beforeOffset) {
  const out = [];
  for (const s of chainOf(state, scope)) {
    for (const d of defsIn(state, s, name)) {
      if (d.visibleFrom < beforeOffset) out.push(d);
    }
  }
  return out;
}

// Every declaration of `name` in the chain regardless of position. Used only to
// tell "declared later" from "never declared here".
function lookupDefAnyPosition(state, scope, name) {
  const out = [];
  for (const s of chainOf(state, scope)) out.push(...defsIn(state, s, name));
  return out;
}

// Is `name` declared somewhere in the document, but OUTSIDE the chain reachable
// from this scope? That is the "you crossed a PROTO boundary" answer.
//
// Indexed rather than searched: scanning every symbol per unresolved reference
// is quadratic, and real worlds carry hundreds of thousands of declarations.
function declaredOutsideChain(state, scope, name) {
  const owners = state.scopesByDefName.get(name);
  if (!owners) return false;
  const inChain = new Set(chainOf(state, scope));
  for (const owner of owners) if (!inChain.has(owner)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

const result = (reference, status, reason, extra) => sym.createResolution({
  reference,
  status,
  reason,
  symbol: extra && extra.symbol ? extra.symbol : null,
  candidateCount: extra && extra.candidateCount != null ? extra.candidateCount : 0,
  evidence: extra && extra.evidence ? extra.evidence : [],
});

// A POSITIVE lexical answer from a damaged scope is not trustworthy either.
//
// The reasoning that fails: "a partial tree can prove presence". It can prove a
// declaration EXISTS -- it cannot prove WHICH SCOPE owns it, and scope
// membership is the entire question a USE asks. Parser recovery MOVES scope
// boundaries: an unclosed PROTO swallows every following top-level statement
// into its body, so the absorbed scope sees a declaration set that never existed
// and, because a PROTO body has no `defParent`, is simultaneously blind to the
// real outer ones.
//
// Demonstrated, not hypothesised:
//
//   DEF Foo Group { }              <- stays in document scope
//   PROTO P [ ] { Shape { }        <- brace never closed
//   DEF Foo Transform { }          <- absorbed into P's body
//   Group { children [ USE Foo ] } <- absorbed into P's body
//
// With the brace present the honest answer is `ambiguous` (two `DEF Foo` in the
// document scope). With it missing, the absorbed body holds exactly ONE `Foo`,
// and a resolver that trusts positives returns one confident binding -- a
// confidently WRONG answer, the one outcome the hard gate forbids.
//
// So a lexical resolution is downgraded whenever the scope it was decided in, OR
// the scope holding the declaration it found, could not be proven. Ambiguity is
// left standing: it binds nothing, so it cannot be confidently wrong.
function guardLexical(state, reference, resolution, symbol) {
  if (resolution.status !== STATUS.RESOLVED) return resolution;
  if (state.documentIncomplete) {
    return result(reference, STATUS.RECOVERED, REASON.DOCUMENT_PARSE_INCOMPLETE);
  }
  const here = reference.scope;
  if (here && here.recovered) {
    return result(reference, STATUS.RECOVERED, here.recoveredReason || REASON.SCOPE_RECOVERED);
  }
  const there = symbol ? symbol.scope : null;
  if (there && there.recovered) {
    return result(reference, STATUS.RECOVERED, there.recoveredReason || REASON.SCOPE_RECOVERED);
  }
  return resolution;
}

// A NEGATIVE finding from a damaged scope is withheld for the same reason:
// absence cannot be proven from a partial tree either.
function downgradeIfRecovered(state, reference, status, reason, extra) {
  if (status !== STATUS.UNRESOLVED) return result(reference, status, reason, extra);
  if (state.documentIncomplete) {
    return result(reference, STATUS.RECOVERED, REASON.DOCUMENT_PARSE_INCOMPLETE, extra);
  }
  const here = reference.scope;
  if (here && here.recovered) {
    return result(reference, STATUS.RECOVERED,
      here.recoveredReason || REASON.SCOPE_RECOVERED, extra);
  }
  return result(reference, status, reason, extra);
}

function resolveUse(state, reference) {
  if (reference.name == null) {
    return result(reference, STATUS.INVALID, REASON.MISSING_NAME);
  }
  const scope = reference.scope;
  const candidates = lookupDef(state, scope, reference.name, reference.offset);

  // Ambiguity is decided on the NAME ALONE, before node type is considered.
  // Narrowing duplicates by type and taking the survivor is exactly how a
  // confident wrong answer gets produced.
  if (candidates.length > 1) {
    return result(reference, STATUS.AMBIGUOUS, REASON.DUPLICATE_DEF_IN_SCOPE, {
      candidateCount: candidates.length,
      evidence: candidates.map((c) => c.declRange),
    });
  }

  if (candidates.length === 1) {
    const symbol = candidates[0];
    // 4.4.4: "The transformation hierarchy shall be a directed acyclic graph;
    // results are undefined if a node in the transformation hierarchy is its own
    // ancestor." A USE inside the very node it names makes the node its own
    // ancestor -- but ONLY within the transformation hierarchy. 4.4.4 also puts
    // a Script's descendants outside it, and `DEF S Script { field SFNode me
    // USE S }` is a standard idiom. Firing there produced 489 false positives on
    // real content in the research lane.
    if (symbol.node && contains(symbol.node.range, reference.range)) {
      if (reference.insideScript) {
        return guardLexical(state, reference, result(reference, STATUS.RESOLVED,
          REASON.SELF_REFERENCE_OUTSIDE_TRANSFORMATION_HIERARCHY, {
            symbol, candidateCount: 1, evidence: [symbol.declRange],
          }), symbol);
      }
      return result(reference, STATUS.INVALID, REASON.SELF_REFERENTIAL_USE, {
        evidence: [symbol.declRange],
      });
    }
    return guardLexical(state, reference, result(reference, STATUS.RESOLVED, REASON.OK, {
      symbol, candidateCount: 1, evidence: [symbol.declRange],
    }), symbol);
  }

  // Declared in this scope, but only after the reference -- 4.6.2 requires a
  // PRECEDING declaration, so there is no binding.
  const later = lookupDefAnyPosition(state, scope, reference.name);
  if (later.length > 0) {
    return result(reference, STATUS.INVALID, REASON.USE_BEFORE_DEF, {
      candidateCount: later.length,
      evidence: later.map((c) => c.declRange),
    });
  }

  // 4.8.4, in both directions: declared, but behind a PROTO boundary.
  if (declaredOutsideChain(state, scope, reference.name)) {
    return downgradeIfRecovered(state, reference, STATUS.UNRESOLVED,
      REASON.DEF_NOT_VISIBLE_ACROSS_PROTO_BOUNDARY, { candidateCount: 0 });
  }
  return downgradeIfRecovered(state, reference, STATUS.UNRESOLVED,
    REASON.DEF_NOT_DECLARED_IN_SCOPE);
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

// A parse result is required WHOLE, not merely tree-shaped.
//
// `syntaxDiagnostics`, `truncated` and `depthCapped` are the only evidence a
// scope has that it cannot be trusted. A caller passing `{tree}` alone would get
// a graph that believes every scope is provable -- fail-OPEN, and exactly the
// state that manufactures a confident binding out of damaged text. So they are
// required rather than defaulted.
function assertParseResult(parseResult, label) {
  if (!parseResult || typeof parseResult !== 'object' || Array.isArray(parseResult)) {
    throw scopeError(SCOPE_ERROR.PARSE,
      `${label}: expected a parse result from require('src/vrml').parse()`);
  }
  const tree = parseResult.tree;
  if (tree != null && (typeof tree !== 'object' || tree.type !== NODE.DOCUMENT)) {
    throw scopeError(SCOPE_ERROR.PARSE,
      `${label}: parseResult.tree must be a ${NODE.DOCUMENT} node or null`);
  }
  if (!Array.isArray(parseResult.syntaxDiagnostics)) {
    throw scopeError(SCOPE_ERROR.PARSE,
      `${label}: parseResult.syntaxDiagnostics must be an array; recovery cannot `
      + 'be proven without it, and a scope that cannot prove damage fails open');
  }
  if (typeof parseResult.truncated !== 'boolean' || typeof parseResult.depthCapped !== 'boolean') {
    throw scopeError(SCOPE_ERROR.PARSE,
      `${label}: parseResult.truncated and parseResult.depthCapped must be booleans`);
  }
}

// A projection is accepted only when THIS graph minted it. Shape is not proof:
// a projection from a different parse of byte-identical text has the same shape
// and must never resolve here.
function assertMember(state, projection, shapeOk, code, label, what) {
  if (!shapeOk(projection)) {
    throw scopeError(code, `${label}: expected ${what}`);
  }
  if (!sym.belongsTo(projection, state.owner)) {
    throw scopeError(code,
      `${label}: this ${what} was not created by this scope graph; a projection `
      + 'from another graph can never be resolved here, even for identical text');
  }
  return projection;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a DEF/USE scope graph over one parse result.
 *
 * Deterministic, read-only, and rebuilt from scratch per parse -- there is no
 * incremental maintenance and none may be added (WD1.5 plan §11).
 *
 * @param {object} parseResult From `require('./src/vrml').parse(text)`. Needs
 *   `tree`, `syntaxDiagnostics`, `truncated` and `depthCapped`.
 * @returns {object} An opaque frozen graph handle.
 * @throws {Error} code ESCOPEPARSE.
 */
function buildScopeGraph(parseResult) {
  assertParseResult(parseResult, 'buildScopeGraph');

  const b = new Builder(parseResult);
  const tree = parseResult.tree || null;
  const documentScopeRecord = b.addScope(SCOPE_KIND.DOCUMENT, tree ? tree.range : null, {
    defParentIndex: null,
    typeParentIndex: null,
    ownerName: null,
    ownerNode: tree,
  });
  if (tree) {
    visitStatements(b, tree.statements, { scope: documentScopeRecord, insideScript: false });
  }
  markRecovery(b);

  // The graph handle doubles as the owner token every projection is branded
  // with. It is minted first so scopes can be branded as they are frozen.
  const graph = Object.freeze({});

  // Scopes are frozen in construction order, so a parent is always already
  // frozen when a child needs to point at it.
  const scopes = [];
  for (const rec of b.scopes) {
    scopes.push(sym.createScope({
      kind: rec.kind,
      defParent: rec.defParentIndex == null ? null : scopes[rec.defParentIndex],
      typeParent: rec.typeParentIndex == null ? null : scopes[rec.typeParentIndex],
      ownerRange: rec.ownerRange,
      ownerName: rec.ownerName,
      ownerNode: rec.ownerNode,
      recovered: rec.recovered,
      recoveredReason: rec.recoveredReason,
      index: rec.index,
    }, graph));
  }

  // Source order is the published order, and it is NOT construction order: a
  // node's interface defaults are visited before its fields, while in the text
  // the two interleave. Sort first, then number.
  b.symbols.sort(byPosition);
  b.references.sort(byPosition);

  const symbols = b.symbols.map((rec, i) => sym.createDefSymbol({
    name: rec.name,
    node: rec.node,
    scope: scopes[rec.scopeIndex],
    declRange: rec.declRange,
    sourceOrder: i,
    nodeType: rec.nodeType,
    visibleFrom: rec.visibleFrom,
  }, graph));

  const references = b.references.map((rec, i) => sym.createUseReference({
    name: rec.name,
    node: rec.node,
    scope: scopes[rec.scopeIndex],
    range: rec.range,
    sourceOrder: i,
    offset: rec.offset,
    insideScript: rec.insideScript,
  }, graph));

  // Lookup indexes, all private. Built from the sorted symbol list, so every
  // candidate list is already in source order and no caller has to sort one.
  const defsByScope = new Map(scopes.map((s) => [s, new Map()]));
  const scopesByDefName = new Map();
  const symbolByAstNode = new WeakMap();
  for (const s of symbols) {
    if (s.name == null) continue;
    const table = defsByScope.get(s.scope);
    const list = table.get(s.name);
    if (list) list.push(s);
    else table.set(s.name, [s]);
    const owners = scopesByDefName.get(s.name);
    if (owners) owners.add(s.scope);
    else scopesByDefName.set(s.name, new Set([s.scope]));
    // First DEF wins the AST-node mapping; a node carries at most one DEF, so
    // there is never a second.
    if (!symbolByAstNode.has(s.node)) symbolByAstNode.set(s.node, s);
  }

  const referenceByAstNode = new WeakMap();
  for (const r of references) referenceByAstNode.set(r.node, r);

  const scopeByAstNode = new WeakMap();
  for (const s of scopes) if (s.ownerNode) scopeByAstNode.set(s.ownerNode, s);
  for (const s of symbols) if (!scopeByAstNode.has(s.node)) scopeByAstNode.set(s.node, s.scope);
  for (const r of references) if (!scopeByAstNode.has(r.node)) scopeByAstNode.set(r.node, r.scope);

  const state = {
    owner: graph,
    documentScope: scopes[0],
    scopes,
    symbols,
    references,
    defsByScope,
    scopesByDefName,
    symbolByAstNode,
    referenceByAstNode,
    scopeByAstNode,
    documentIncomplete: b.documentIncomplete,
    resolutionByReference: new Map(),
    referencesBySymbol: new Map(),
  };

  for (const reference of references) {
    const res = resolveUse(state, reference);
    state.resolutionByReference.set(reference, res);
    if (res.status === STATUS.RESOLVED && res.symbol) {
      const list = state.referencesBySymbol.get(res.symbol);
      if (list) list.push(reference);
      else state.referencesBySymbol.set(res.symbol, [reference]);
    }
  }

  INTERNALS.set(graph, state);
  return graph;
}

/** The document's own DEF scope. Always present, even for an empty parse. */
function documentScope(graph) {
  return internalsOf(graph, 'documentScope').documentScope;
}

/** Every scope, in construction order (document first). A fresh frozen array. */
function scopes(graph) {
  return Object.freeze(internalsOf(graph, 'scopes').scopes.slice());
}

/** Every DEF declaration, source-ordered. A fresh frozen array. */
function symbols(graph) {
  return Object.freeze(internalsOf(graph, 'symbols').symbols.slice());
}

/** Every USE reference, source-ordered. A fresh frozen array. */
function references(graph) {
  return Object.freeze(internalsOf(graph, 'references').references.slice());
}

/** Every resolution, in the source order of its reference. A fresh frozen array. */
function resolutions(graph) {
  const state = internalsOf(graph, 'resolutions');
  return Object.freeze(state.references.map((r) => state.resolutionByReference.get(r)));
}

/**
 * Resolve one reference.
 *
 * Accepts a `Reference` this graph minted, or the `Use` AST node behind one.
 * Resolutions are computed once at build time; this is a lookup, not a rerun.
 *
 * @returns {object} A frozen resolution -- always a status and a stable reason,
 *   and a symbol only when the status is `resolved`.
 * @throws {Error} codes ESCOPEGRAPH, ESCOPEREF.
 */
function resolve(graph, referenceOrNode) {
  const state = internalsOf(graph, 'resolve');
  let reference = referenceOrNode;
  if (referenceOrNode && typeof referenceOrNode === 'object'
    && referenceOrNode.type === NODE.USE) {
    reference = state.referenceByAstNode.get(referenceOrNode);
    if (!reference) {
      throw scopeError(SCOPE_ERROR.REFERENCE,
        'resolve: this USE node does not belong to this graph\'s parse');
    }
  }
  assertMember(state, reference, sym.isUseReferenceShape, SCOPE_ERROR.REFERENCE,
    'resolve', 'a USE reference from this graph');
  return state.resolutionByReference.get(reference);
}

/**
 * Every reference that AUTHORITATIVELY resolves to one declaration -- the
 * building block a rename or a find-all-references feature would use.
 *
 * Only `resolved` references appear. An ambiguous, invalid, unresolved or
 * recovered reference is not "probably this one"; it is a reference this module
 * declines to bind, and including it is how a rename corrupts a document.
 *
 * @param {object} symbolOrNode A DEF symbol from this graph, or its `Node`.
 * @returns {ReadonlyArray} Source-ordered, frozen, and a fresh array each call.
 * @throws {Error} codes ESCOPEGRAPH, ESCOPESYMBOL.
 */
function referencesTo(graph, symbolOrNode) {
  const state = internalsOf(graph, 'referencesTo');
  const symbol = coerceSymbol(state, symbolOrNode, 'referencesTo');
  return Object.freeze((state.referencesBySymbol.get(symbol) || []).slice());
}

/**
 * Is this DEF name unique within its OWN scope?
 *
 * Scope-aware by construction: a name repeated in a different PROTO body is not
 * a duplicate (4.8.4), and node type never narrows the question -- two DEFs of
 * one name are two DEFs whatever they declare.
 *
 * A damaged scope answers `{unique:false}` with the recovery reason. It is not
 * asserting non-uniqueness; it is declining to assert uniqueness, which is the
 * direction that fails closed for every consumer of this query.
 *
 * @returns {{unique:boolean, reason:string}} Frozen.
 * @throws {Error} codes ESCOPEGRAPH, ESCOPESYMBOL.
 */
function defIsUniqueInScope(graph, symbolOrNode) {
  const state = internalsOf(graph, 'defIsUniqueInScope');
  const symbol = coerceSymbol(state, symbolOrNode, 'defIsUniqueInScope');
  if (state.documentIncomplete) {
    return sym.createUniqueness(false, REASON.DOCUMENT_PARSE_INCOMPLETE);
  }
  const scope = symbol.scope;
  if (scope.recovered) {
    return sym.createUniqueness(false, scope.recoveredReason || REASON.SCOPE_RECOVERED);
  }
  const list = defsIn(state, scope, symbol.name);
  return list.length === 1
    ? sym.createUniqueness(true, REASON.OK)
    : sym.createUniqueness(false, REASON.DUPLICATE_DEF_IN_SCOPE);
}

function coerceSymbol(state, symbolOrNode, label) {
  let symbol = symbolOrNode;
  if (symbolOrNode && typeof symbolOrNode === 'object' && symbolOrNode.type === NODE.NODE) {
    symbol = state.symbolByAstNode.get(symbolOrNode);
    if (!symbol) {
      throw scopeError(SCOPE_ERROR.SYMBOL,
        `${label}: this node carries no DEF in this graph's parse`);
    }
  }
  return assertMember(state, symbol, sym.isDefSymbolShape, SCOPE_ERROR.SYMBOL,
    label, 'a DEF symbol from this graph');
}

/**
 * The DEF scope an AST node sits in, or `null` when this graph holds no scope
 * projection for it.
 *
 * A lookup, not a resolution: `null` means "this graph has no such projection",
 * never "not declared". Only `resolve` answers a language question.
 */
function scopeOf(graph, astNode) {
  const state = internalsOf(graph, 'scopeOf');
  if (!astNode || typeof astNode !== 'object') return null;
  return state.scopeByAstNode.get(astNode) || null;
}

/** The DEF symbol an AST `Node` declares, or `null`. A lookup, not a resolution. */
function symbolFor(graph, astNode) {
  const state = internalsOf(graph, 'symbolFor');
  if (!astNode || typeof astNode !== 'object') return null;
  return state.symbolByAstNode.get(astNode) || null;
}

/** The reference an AST `Use` node makes, or `null`. A lookup, not a resolution. */
function referenceFor(graph, astNode) {
  const state = internalsOf(graph, 'referenceFor');
  if (!astNode || typeof astNode !== 'object') return null;
  return state.referenceByAstNode.get(astNode) || null;
}

/** Is this an opaque graph handle from `buildScopeGraph`? */
function isScopeGraph(value) {
  return !!value && typeof value === 'object' && INTERNALS.has(value);
}

module.exports = {
  // constants, re-exported so a consumer branches on one import
  SCOPE_ERROR: sym.SCOPE_ERROR,
  NAMESPACE: sym.NAMESPACE,
  SCOPE_KIND: sym.SCOPE_KIND,
  SYMBOL_KIND: sym.SYMBOL_KIND,
  REFERENCE_KIND: sym.REFERENCE_KIND,
  STATUS: sym.STATUS,
  REASON: sym.REASON,
  // predicates
  isResolved: sym.isResolved,
  isUnresolved: sym.isUnresolved,
  isAmbiguous: sym.isAmbiguous,
  isInvalid: sym.isInvalid,
  isRecovered: sym.isRecovered,
  isScopeGraph,
  // construction and queries
  buildScopeGraph,
  documentScope,
  scopes,
  symbols,
  references,
  resolutions,
  resolve,
  referencesTo,
  defIsUniqueInScope,
  scopeOf,
  symbolFor,
  referenceFor,
};
