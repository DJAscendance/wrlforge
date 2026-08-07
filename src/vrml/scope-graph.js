'use strict';
// VRML97 scope graph: DEF/USE (Phase WD1.5-P1) + node types (Phase WD1.5-P2A).
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
const nodeSchema = require('./node-schema');

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
    this.typeDecls = [];
    this.typeRefs = [];
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

  addTypeDecl(kind, decl, scope) {
    const declRange = decl.nameRange || decl.range;
    this.typeDecls.push({
      kind,
      name: decl.name == null ? null : decl.name,
      node: decl,
      scopeIndex: scope.index,
      declRange,
      visibleFrom: endOffsetOf(decl.range),
      sortOffset: offsetOf(declRange),
      sortName: decl.name == null ? '' : String(decl.name),
    });
  }

  addTypeRef(node, scope) {
    const range = node.typeRange || node.range;
    this.typeRefs.push({
      name: node.nodeType == null ? null : node.nodeType,
      node,
      scopeIndex: scope.index,
      range,
      offset: offsetOf(range),
      sortOffset: offsetOf(range),
      sortName: node.nodeType == null ? '' : String(node.nodeType),
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
    case NODE.EXTERNPROTO: visitExternProto(b, stmt, ctx); return;
    // A ROUTE contributes route-node / route-event references, which are P2.
    // An EXTERNPROTO declares a node TYPE and has no body, so it owns no
    // DEF/USE scope and (4.9.1) carries no field defaults to descend into.
    case NODE.ROUTE:
    case NODE.EXTERNPROTO:
    default:
  }
}

function visitExternProto(b, ext, ctx) {
  b.addTypeDecl(sym.SYMBOL_KIND.EXTERNPROTO_DECL, ext, ctx.scope);
}

function visitProto(b, proto, ctx) {
  b.addTypeDecl(sym.SYMBOL_KIND.PROTO_DECL, proto, ctx.scope);
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
  b.addTypeRef(node, ctx.scope);

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
    case NODE.EXTERNPROTO: visitExternProto(b, value, ctx); return;
    case NODE.ROUTE: return;
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
// --- node-type lookup ------------------------------------------------------
//
// The SECOND, INDEPENDENT chain. Node names walk `defParent` (which is `null` on
// a PROTO body -- 4.8.4 disjointness); node types walk `typeParent`, which
// points OUTWARD, because 4.8.4 restricts where a nested declaration is VISIBLE
// without blinding the nested body to its enclosing declarations (rule P6).
//
// `defParent` is never consulted here, and `typeParent` is never consulted by
// the DEF/USE walk. Two namespaces, two chains, no shared map.
function typeChainOf(scope) {
  const out = [];
  let cur = scope;
  while (cur) {
    out.push(cur);
    cur = cur.typeParent;
  }
  return out;
}

function typeDeclsIn(state, scope, name) {
  const table = state.typeDeclsByScope.get(scope);
  if (!table) return [];
  return table.get(name) || [];
}

// Declarations of `name` visible at `beforeOffset`. `<=` rather than `<`,
// because `visibleFrom` is the declaration's END: an instance may begin at the
// very next character, and 4.8.4 asks only that the definition be COMPLETE.
function lookupType(state, scope, name, beforeOffset) {
  const out = [];
  for (const s of typeChainOf(scope)) {
    for (const d of typeDeclsIn(state, s, name)) {
      if (beforeOffset == null || d.visibleFrom <= beforeOffset) out.push(d);
    }
  }
  return out;
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
  detail: extra && extra.detail ? extra.detail : null,
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
//
// DEF ONLY. The node-type namespace withholds ambiguity as well -- a duplicate
// TYPE claim is an assertion recovery can fabricate by merging scopes. See
// `typeChainWithholds`.
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

// The same rule, widened to the shape a NODE TYPE lookup actually has.
//
// `guardLexical`/`downgradeIfRecovered` above check the reference's own scope and
// (for a positive) the found declaration's scope. That is exactly right for a
// USE: `defParent` is null on a proto body, so a DEF lookup never leaves its own
// scope and there is no third scope to worry about.
//
// A type lookup is different in kind. It WALKS OUTWARD along `typeParent`
// (4.8.4 P6), so its answer depends on every scope in that chain -- including
// ones it never had to read because it found an answer first, or because it
// found none at all. Any unprovable link can hold a same-name declaration that
// would have changed the answer:
//
//   Group { children [ Shape { }     <- brace never closed: document scope damaged
//   PROTO Inner [ ] { Transform { } } <- Inner's OWN body scope parses clean
//
// `Transform` inside `Inner` sits in a provably clean scope, so a guard that
// looks only at that scope is satisfied -- yet the answer it returns ("built-in")
// is a claim that NO `PROTO Transform` shadows it, and the damaged document scope
// is precisely where such a declaration would live. 4.8.1 lets a prototype take a
// built-in's spelling, and this module honours that (see `resolveNodeType`), so
// "is a built-in spelling" and "this occurrence denotes the built-in" are two
// different claims. The first is a clause-6 schema fact with no scope dependency
// and stays authoritative -- `nodeSchema.isVRML97Node` answers it, unguarded, for
// any caller. The second is a lexical absence claim and fails closed here.
//
// The plan's §7 "schema resolutions are exempt" carve-out was written about the
// first claim. Applying it to the second let three unprovable answers through:
// a confident built-in occurrence, a confident `node-type-unknown`, and a
// `recursive-proto-instance` manufactured entirely by a moved scope boundary.
// Returns a `recovered` result when the chain cannot be proven, or null when it
// can. Called ONCE, BEFORE any lexical question is asked -- see `resolveNodeType`.
//
// Ambiguity is guarded too, and that is the part worth being explicit about. An
// `ambiguous` answer binds nothing, which makes it tempting to let it stand under
// damage; the plan says exactly that for DEF. But it is still an ASSERTION --
// "two or more declarations of this name exist in the scope you asked about" --
// and recovery is capable of manufacturing precisely that. An unclosed body
// absorbs the statements after it, so two declarations written in DIFFERENT
// scopes can end up in one, and the resolver would report a duplicate that the
// author never wrote. Withholding costs a diagnosis; asserting invents one.
function typeChainWithholds(state, reference) {
  if (state.documentIncomplete) {
    return result(reference, STATUS.RECOVERED, REASON.DOCUMENT_PARSE_INCOMPLETE);
  }
  for (const scope of typeChainOf(reference.scope)) {
    if (!scope.recovered) continue;
    return result(reference, STATUS.RECOVERED, scope.recoveredReason || REASON.SCOPE_RECOVERED);
  }
  return null;
}


// A node type name asks TWO different questions that must never be merged:
//
//   * a LEXICAL one -- is there a PROTO/EXTERNPROTO declaration of this name
//     visible from here? That is scope-dependent, and fails closed when the
//     scope cannot be proven.
//   * a SCHEMA one -- is this SPELLING one of clause 6's built-in node types?
//     That is a fact about the standard with no scope dependency at all,
//     answered by the committed WD1.3 schema and by nothing else. It stays
//     authoritative in a damaged document; call `nodeSchema.isVRML97Node` for it.
//
// Every status this function returns below the guard is a LEXICAL answer. Even
// `node-type-is-builtin` is lexical, because 4.8.1 lets a prototype take a
// built-in's spelling: saying this occurrence IS the built-in asserts that no
// such declaration is in scope.
//
// PRECEDENCE. Recovery dominates, and it is asked ONCE, UP FRONT, rather than
// being applied to each branch afterwards:
//
//   1. graph ownership and projection validity        (`resolve`, before this)
//   2. is the name token even there?                  -- a token fact, not lexical
//   3. is the document complete and the whole
//      `typeParent` chain provable?                   -- if not, `recovered`, full stop
//   4. only then: recursion, duplicates, ordering,
//      local declarations, built-ins, unknown names
//
// Structuring it as a gate rather than as a wrapper per branch is the point. A
// per-branch guard is one `return` away from a leak, and the first version of
// this lane leaked exactly that way -- the branches that were wrapped were safe
// and the ones that were not silently were not.
function resolveNodeType(state, reference) {
  // Step 2. Not a lexical claim: it reports that this reference has no name to
  // look up, which is true whatever the surrounding scopes turn out to be.
  if (reference.name == null) {
    return result(reference, STATUS.INVALID, REASON.MISSING_NAME);
  }
  // Step 3. The gate. Nothing below runs unless the chain is proven.
  const withheld = typeChainWithholds(state, reference);
  if (withheld) return withheld;

  const scope = reference.scope;
  const visible = lookupType(state, scope, reference.name, reference.offset);
  const anywhere = lookupType(state, scope, reference.name, null);
  const builtin = nodeSchema.isVRML97Node(reference.name);

  // 4.8.4 states two separate rules -- instantiate only after the definition
  // completes, AND never inside the definition itself. An instance within its
  // own declaration breaks both, and recursion is the specific and useful
  // diagnosis, so it is tested FIRST: the ordering rule would otherwise always
  // win, since a definition is never "complete" inside itself.
  //
  // Safe only because of the gate above: containment is measured against a
  // declaration's RANGE, and an unclosed body extends that range over statements
  // it never contained. `PROTO Transform [ ] { Group { } }` + `PROTO Inner [ ] {
  // Transform { } }` binds normally; drop one brace and the absorbed `Inner`
  // lands inside `Transform`'s range, which would read as illegal recursion in
  // valid source.
  const enclosing = anywhere.filter((d) => d.node && contains(d.node.range, reference.range));
  if (enclosing.length > 0) {
    return result(reference, STATUS.INVALID, REASON.RECURSIVE_PROTO_INSTANCE, {
      candidateCount: enclosing.length,
      evidence: enclosing.map((d) => d.declRange),
    });
  }

  // 4.8.1 makes duplicate type names undefined behaviour. Decided on the NAME
  // ALONE -- never narrowed by declaration kind, by built-in status, by body
  // shape or by which one is written where. Narrowing duplicates and taking the
  // survivor is exactly how a confident wrong answer gets produced.
  //
  // Judged over EVERY same-name declaration the chain owns -- not merely those
  // already visible at this offset. 4.8.1 makes the whole file's binding for that
  // name undefined the moment a second declaration of it exists, so a reference
  // sitting between the two is not in a well-defined document that happens to
  // have a problem later; it is in an undefined one. Binding it confidently to
  // the first declaration would also disagree with `typeDeclIsUniqueInScope`,
  // which has always answered over the whole scope -- and two queries giving
  // different accounts of the same duplicate is how a caller ends up trusting the
  // wrong one. Deliberately conservative, and it refuses rather than ranks.
  //
  // Only reachable with the chain proven. `ambiguous` binds nothing, but it does
  // ASSERT that a duplicate exists, and recovery can fabricate one out of two
  // declarations the author put in different scopes -- so it sits below the gate
  // with every other lexical claim.
  if (anywhere.length > 1) {
    return result(reference, STATUS.AMBIGUOUS, REASON.DUPLICATE_PROTO_DECLARATION, {
      candidateCount: anywhere.length,
      evidence: anywhere.map((d) => d.declRange),
    });
  }

  if (visible.length === 1) {
    const symbol = visible[0];
    // A local declaration outranks the schema even when it takes a built-in's
    // spelling: 4.8.1 calls that undefined, and the lexical declaration is the
    // thing actually written in this file. Recorded as `detail`, so a consumer
    // can surface it without the binding itself changing.
    // No separate declaration-side check is needed: `lookupType` only ever
    // returns declarations owned by scopes in this reference's own chain, and the
    // gate has already proven every one of them.
    return result(reference, STATUS.RESOLVED, REASON.OK, {
      symbol, candidateCount: 1, evidence: [symbol.declRange],
      detail: builtin ? REASON.PROTO_SHADOWS_BUILTIN : null,
    });
  }

  // Declared in a visible scope, but only later -- 4.8.4 admits no forward
  // reference to a prototype. This asserts no EARLIER declaration exists, which
  // only the proven chain above makes sayable.
  if (anywhere.length > 0) {
    return result(reference, STATUS.INVALID, REASON.PROTO_INSTANCE_BEFORE_DECLARATION, {
      candidateCount: anywhere.length,
      evidence: anywhere.map((d) => d.declRange),
    });
  }

  // Clause 6 says `Transform` is a built-in SPELLING, and that fact is exempt
  // from recovery -- but it is answered by `nodeSchema.isVRML97Node`, not here.
  // What THIS branch returns is the further claim that this OCCURRENCE denotes
  // the built-in, i.e. that no local declaration shadows it. 4.8.1 permits such a
  // declaration and the branch above honours it, so that claim is lexical and
  // lives below the gate like the rest.
  if (builtin) {
    return result(reference, STATUS.RESOLVED, REASON.NODE_TYPE_IS_BUILTIN);
  }

  // Neither built-in nor declared. A vendor node type lands here and is
  // PRESERVED as a first-class answer -- not an error, not a parse failure, and
  // not silently promoted into either of the other two buckets.
  return result(reference, STATUS.UNRESOLVED, REASON.NODE_TYPE_UNKNOWN);
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
  b.typeDecls.sort(byPosition);
  b.typeRefs.sort(byPosition);

  const symbols = b.symbols.map((rec, i) => sym.createDefSymbol({
    name: rec.name,
    node: rec.node,
    scope: scopes[rec.scopeIndex],
    declRange: rec.declRange,
    sourceOrder: i,
    nodeType: rec.nodeType,
    visibleFrom: rec.visibleFrom,
  }, graph));

  const typeDeclarations = b.typeDecls.map((rec, i) => sym.createTypeDeclSymbol({
    kind: rec.kind,
    name: rec.name,
    node: rec.node,
    scope: scopes[rec.scopeIndex],
    declRange: rec.declRange,
    sourceOrder: i,
    visibleFrom: rec.visibleFrom,
  }, graph));

  const typeReferences = b.typeRefs.map((rec, i) => sym.createNodeTypeReference({
    name: rec.name,
    node: rec.node,
    scope: scopes[rec.scopeIndex],
    range: rec.range,
    sourceOrder: i,
    offset: rec.offset,
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

  // A SEPARATE name map for the node-type namespace. Sharing `defsByScope`
  // would make `DEF Ball` and `PROTO Ball` collide, which is precisely the
  // conflation the three-namespace rule exists to prevent.
  const typeDeclsByScope = new Map(scopes.map((s) => [s, new Map()]));
  const typeDeclByAstNode = new WeakMap();
  for (const d of typeDeclarations) {
    if (d.name == null) continue;
    const table = typeDeclsByScope.get(d.scope);
    const list = table.get(d.name);
    if (list) list.push(d);
    else table.set(d.name, [d]);
    if (!typeDeclByAstNode.has(d.node)) typeDeclByAstNode.set(d.node, d);
  }

  const referenceByAstNode = new WeakMap();
  for (const r of references) referenceByAstNode.set(r.node, r);

  const typeReferenceByAstNode = new WeakMap();
  for (const r of typeReferences) typeReferenceByAstNode.set(r.node, r);

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
    typeDeclarations,
    typeReferences,
    typeDeclsByScope,
    typeDeclByAstNode,
    typeReferenceByAstNode,
    scopeByAstNode,
    documentIncomplete: b.documentIncomplete,
    resolutionByReference: new Map(),
    referencesBySymbol: new Map(),
  };

  const bind = (reference, res) => {
    state.resolutionByReference.set(reference, res);
    // Only an AUTHORITATIVE binding is indexed. An ambiguous, invalid,
    // unresolved or recovered reference is not "probably this declaration";
    // including it is how a rename corrupts a document.
    if (res.status === STATUS.RESOLVED && res.symbol) {
      const list = state.referencesBySymbol.get(res.symbol);
      if (list) list.push(reference);
      else state.referencesBySymbol.set(res.symbol, [reference]);
    }
  };

  for (const reference of references) bind(reference, resolveUse(state, reference));
  for (const reference of typeReferences) bind(reference, resolveNodeType(state, reference));

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

// --- node-type namespace (WD1.5-P2A) ---------------------------------------
//
// SEPARATE ACCESSORS, NOT A MERGED LIST. `symbols`, `references` and
// `resolutions` keep meaning exactly what they meant in P1 -- DEF declarations,
// USE references, USE answers -- and the node-type namespace gets its own three.
// Folding both namespaces into one list would silently change every existing
// caller's counts and would put two unrelated kinds of name in one sequence.

/** Every PROTO/EXTERNPROTO declaration, source-ordered. A fresh frozen array. */
function typeDeclarations(graph) {
  return Object.freeze(internalsOf(graph, 'typeDeclarations').typeDeclarations.slice());
}

/** Every node-type reference, source-ordered. A fresh frozen array. */
function typeReferences(graph) {
  return Object.freeze(internalsOf(graph, 'typeReferences').typeReferences.slice());
}

/** Every node-type answer, in the source order of its reference. Frozen, fresh. */
function typeResolutions(graph) {
  const state = internalsOf(graph, 'typeResolutions');
  return Object.freeze(state.typeReferences.map((r) => state.resolutionByReference.get(r)));
}

/**
 * The declaration an AST `Proto`/`ExternProto` node makes, or `null`.
 *
 * A lookup, not a resolution. Narrowly named rather than folded into
 * `symbolFor`, which stays DEF-only: one AST node can carry both a DEF and a
 * type reference, so an overloaded accessor would have to guess which was meant.
 */
function typeDeclFor(graph, astNode) {
  const state = internalsOf(graph, 'typeDeclFor');
  if (!astNode || typeof astNode !== 'object') return null;
  return state.typeDeclByAstNode.get(astNode) || null;
}

/** The node-type reference an AST `Node` makes, or `null`. A lookup, not a resolution. */
function typeReferenceFor(graph, astNode) {
  const state = internalsOf(graph, 'typeReferenceFor');
  if (!astNode || typeof astNode !== 'object') return null;
  return state.typeReferenceByAstNode.get(astNode) || null;
}

/**
 * Is this type name unique within its OWN type scope?
 *
 * Scope-aware and chain-free: the same nested `PROTO Knob` in two different
 * outer prototypes is not a duplicate (4.8.4 P5), and an enclosing declaration
 * of the same name is a different scope's business. Declaration KIND never
 * narrows the question either -- a `PROTO Gold` and an `EXTERNPROTO Gold` in one
 * scope are two declarations of one type name (4.8.1 + 4.9.1).
 *
 * A damaged scope answers `{unique:false}` with the recovery reason: declining
 * to assert uniqueness, not asserting duplication.
 *
 * @returns {{unique:boolean, reason:string}} Frozen.
 * @throws {Error} codes ESCOPEGRAPH, ESCOPESYMBOL.
 */
function typeDeclIsUniqueInScope(graph, symbolOrNode) {
  const state = internalsOf(graph, 'typeDeclIsUniqueInScope');
  const symbol = coerceTypeDecl(state, symbolOrNode, 'typeDeclIsUniqueInScope');
  if (state.documentIncomplete) {
    return sym.createUniqueness(false, REASON.DOCUMENT_PARSE_INCOMPLETE);
  }
  const scope = symbol.scope;
  if (scope.recovered) {
    return sym.createUniqueness(false, scope.recoveredReason || REASON.SCOPE_RECOVERED);
  }
  const list = typeDeclsIn(state, scope, symbol.name);
  return list.length === 1
    ? sym.createUniqueness(true, REASON.OK)
    : sym.createUniqueness(false, REASON.DUPLICATE_PROTO_DECLARATION);
}

function coerceTypeDecl(state, symbolOrNode, label) {
  let symbol = symbolOrNode;
  if (symbolOrNode && typeof symbolOrNode === 'object'
    && (symbolOrNode.type === NODE.PROTO || symbolOrNode.type === NODE.EXTERNPROTO)) {
    symbol = state.typeDeclByAstNode.get(symbolOrNode);
    if (!symbol) {
      throw scopeError(SCOPE_ERROR.SYMBOL,
        `${label}: this declaration carries no provable type name in this graph's parse`);
    }
  }
  return assertMember(state, symbol, sym.isTypeDeclSymbolShape, SCOPE_ERROR.SYMBOL,
    label, 'a PROTO/EXTERNPROTO declaration from this graph');
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
  const shapeOk = (v) => sym.isUseReferenceShape(v) || sym.isNodeTypeReferenceShape(v);
  assertMember(state, reference, shapeOk, SCOPE_ERROR.REFERENCE,
    'resolve', 'a USE or node-type reference from this graph');
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
  const isTypeSide = !!symbolOrNode && typeof symbolOrNode === 'object'
    && (sym.isTypeDeclSymbolShape(symbolOrNode)
      || symbolOrNode.type === NODE.PROTO || symbolOrNode.type === NODE.EXTERNPROTO);
  const symbol = isTypeSide
    ? coerceTypeDecl(state, symbolOrNode, 'referencesTo')
    : coerceSymbol(state, symbolOrNode, 'referencesTo');
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
  // node-type namespace (WD1.5-P2A)
  typeDeclarations,
  typeReferences,
  typeResolutions,
  typeDeclFor,
  typeReferenceFor,
  typeDeclIsUniqueInScope,
};
