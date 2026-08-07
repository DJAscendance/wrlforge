'use strict';
// VRML97 scope graph: DEF/USE (Phase WD1.5-P1) + node types (Phase WD1.5-P2A)
// + interface members and `IS` (Phase WD1.5-P2B).
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
// declared in an enclosing scope). P2A walks it for node types.
//
// P2B adds a THIRD namespace whose scopes have NEITHER link. 4.8.3/4.8.4 give an
// `IS` exactly one interface to consult -- the innermost enclosing prototype's
// -- and are silent on any outer one, so an interface is an OWNERSHIP scope with
// no chain at all. The reference carries its owner, fixed on descent; nothing
// searches for it. ROUTE endpoints remain WD1.5-P2C.
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
    // WD1.5-P2B. Interface scopes are held in their OWN array, deliberately not
    // appended to `this.scopes`. Two reasons, both load-bearing:
    //
    //   * `scopes(graph)` keeps meaning exactly what it meant in P1/P2A -- the
    //     lexical DEF/type regions -- so no existing caller's counts change.
    //   * `markRecovery` attributes each syntax error to the INNERMOST scope
    //     containing it. Letting interface scopes compete in that computation
    //     would make an interface the innermost match for damage inside an
    //     interface list, so the enclosing DEF scope would stop being marked
    //     recovered and a USE that answered `recovered` under P1 would start
    //     answering confidently. That is a LOOSENING of a safety property, in
    //     the one direction this lane may never move. Interface scopes get their
    //     own, purely ADDITIVE attribution pass instead.
    this.interfaceScopes = [];
    this.members = [];
    this.isRefs = [];
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

  // --- WD1.5-P2B -----------------------------------------------------------

  /**
   * Open an interface scope for a `Proto`, `ExternProto` or `Script`.
   *
   * `ownerRange` is the UNION OF THE MEMBER DECLARATIONS, not the owning
   * construct's range. Using the PROTO's range would put the whole body inside
   * the interface scope, so body damage would mark the interface unprovable and
   * vice versa -- two independent facts collapsed into one. An empty interface
   * list yields `null`, which `contains()` never matches, so nothing attributes
   * to it; the enclosing body scope still fails closed for it (G2).
   */
  addInterfaceScope(kind, ownerNode, decls) {
    let start = null;
    let end = null;
    for (const decl of decls || []) {
      if (!decl || !decl.range) continue;
      if (start === null || offsetOf(decl.range) < start.start.offset) start = decl.range;
      if (end === null || endOffsetOf(decl.range) > end.end.offset) end = decl.range;
    }
    const scope = {
      index: this.interfaceScopes.length,
      kind,
      ownerRange: (start && end) ? { start: start.start, end: end.end } : null,
      ownerName: (ownerNode && ownerNode.name != null) ? ownerNode.name : null,
      ownerNode: ownerNode || null,
      recovered: false,
      recoveredReason: null,
    };
    this.interfaceScopes.push(scope);
    return scope;
  }

  addMember(kind, decl, ifaceScope, detail) {
    const declRange = decl.nameRange || decl.range;
    this.members.push({
      kind,
      name: decl.name == null ? null : decl.name,
      access: decl.access == null ? null : decl.access,
      fieldType: decl.fieldType == null ? null : decl.fieldType,
      node: decl,
      interfaceScopeIndex: ifaceScope.index,
      declRange,
      range: decl.range || null,
      hasDefault: !!decl.default,
      detail: detail || null,
      sortOffset: offsetOf(declRange),
      sortName: decl.name == null ? '' : String(decl.name),
    });
    // A member the parse could not name cannot be indexed, and an interface
    // whose member set is incomplete cannot answer ANY lexical question about
    // itself -- not presence, not absence, not uniqueness. Fail the whole scope
    // closed rather than answer from a set known to be short. Corpus cost: 0.
    if (decl.name == null) {
      ifaceScope.recovered = true;
      ifaceScope.recoveredReason = REASON.INTERFACE_SCOPE_NOT_PROVABLE;
    }
  }

  addIsRef(fields) {
    this.isRefs.push({
      name: fields.name == null ? null : fields.name,
      form: fields.form,
      node: fields.node,
      hostNode: fields.hostNode || null,
      // The innermost enclosing PROTO interface, FIXED ON DESCENT. Never found
      // by a containment test or an ancestor walk.
      ownerInterface: fields.ownerInterface || null,
      // Diagnostic only, and deliberately NOT published on the frozen
      // projection: it feeds the non-binding `member-found-in-outer-interface-
      // only` detail and nothing else. An interface scope has no parent link, so
      // this list is the only outward view that exists and it can never bind.
      outerInterfaces: fields.outerInterfaces ? fields.outerInterfaces.slice() : [],
      hostScopeIndex: fields.hostScope.index,
      hostInterfaceScope: fields.hostInterfaceScope || null,
      range: fields.range || null,
      endpointName: fields.endpointName == null ? null : fields.endpointName,
      endpointRange: fields.endpointRange || null,
      offset: offsetOf(fields.range || null),
      detail: fields.detail || null,
      sortOffset: offsetOf(fields.range || fields.endpointRange || null),
      sortName: fields.name == null ? '' : String(fields.name),
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

// Collect one interface list's members (WD1.5-P2B).
//
// Compatibility-profile shapes are CLASSIFIED here and carried as non-binding
// `detail`, never as a status and never normalized away (WD.md §9): the member
// is declared either way, and a consumer that ignores the detail is correct.
function addInterfaceMembers(b, kind, decls, ifaceScope, isScriptBody) {
  for (const decl of decls || []) {
    if (!decl || decl.type !== NODE.INTERFACE) continue;
    let detail = null;
    if (!isScriptBody && decl.is != null) {
      // Annex A.2 gives a PROTO/EXTERNPROTO `interfaceDeclaration` no `IS` form
      // at all. Corpus: 20. Recorded, not accepted as a binding -- no `IS`
      // reference is minted for it, because there is no node body here for one
      // to live in.
      detail = REASON.IS_IN_INTERFACE_DECLARATION_LIST;
    } else if (isScriptBody && decl.access === sym.ACCESS.EXPOSED_FIELD) {
      // Annex A.3 admits only `restrictedInterfaceDeclaration` in a script body,
      // and 6.40 confirms it. Corpus: 1,577 -- real Cybertown content, kept.
      detail = REASON.EXPOSED_FIELD_IN_SCRIPT_INTERFACE;
    }
    b.addMember(kind, decl, ifaceScope, detail);
  }
}

function visitExternProto(b, ext, ctx) {
  b.addTypeDecl(sym.SYMBOL_KIND.EXTERNPROTO_DECL, ext, ctx.scope);
  // 4.9.2 makes an EXTERNPROTO interface a PROTO interface bar initial values,
  // so it owns a real interface scope and its members are real declarations.
  // NO `IS` ever resolves IN one -- it has no body for an `IS` to sit in -- but
  // it IS consulted as an endpoint namespace for instances of the type (§8/§9).
  const iface = b.addInterfaceScope(sym.SCOPE_KIND.EXTERNPROTO_INTERFACE, ext, ext.interfaces);
  addInterfaceMembers(b, sym.SYMBOL_KIND.PROTO_INTERFACE_MEMBER, ext.interfaces, iface, false);
}

function visitProto(b, proto, ctx) {
  b.addTypeDecl(sym.SYMBOL_KIND.PROTO_DECL, proto, ctx.scope);
  const iface = b.addInterfaceScope(sym.SCOPE_KIND.PROTO_INTERFACE, proto, proto.interfaces);
  addInterfaceMembers(b, sym.SYMBOL_KIND.PROTO_INTERFACE_MEMBER, proto.interfaces, iface, false);
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
  //
  // `isOwner` is REPLACED, not pushed onto a chain a lookup could walk: 4.8.4
  // says an `IS` in a nested prototype's implementation refers to the INNERMOST
  // prototype's declarations, and is silent on the outer case. Silence fails
  // closed (WD.md §7), and it costs nothing -- 0 of the corpus's 27,756 `IS`
  // statements would need an outward walk. `outerInterfaces` is carried for one
  // purpose only: a NON-BINDING detail that explains an outer-only near-miss.
  visitStatements(b, proto.body, {
    scope: body,
    insideScript: ctx.insideScript,
    isOwner: iface,
    outerInterfaces: ctx.isOwner
      ? (ctx.outerInterfaces || []).concat([ctx.isOwner])
      : (ctx.outerInterfaces || []),
  });
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
    // Entering a Script does NOT change the `IS` owner. 4.8.3/4.8.4 put an `IS`
    // inside a Script inside a PROTO body on the ENCLOSING PROTO's interface,
    // and the corpus confirms that is the dominant real shape.
    isOwner: ctx.isOwner,
    outerInterfaces: ctx.outerInterfaces,
  };

  // A Script's own `restrictedInterfaceDeclaration` set is a real interface
  // (Annex A.3), so it owns a scope and its members are real declarations.
  //
  // Only a Script gets one. A declaration in `node.interfaces` on any other node
  // type is non-conforming (corpus: 0) and is NOT accepted as a Script-
  // equivalent interface; a `IS` written in such a list therefore cannot prove
  // its owning interface scope and fails closed at G4 rather than being answered
  // from a scope this lane declined to mint.
  let scriptIface = null;
  if (node.nodeType === 'Script' && node.interfaces && node.interfaces.length > 0) {
    scriptIface = b.addInterfaceScope(sym.SCOPE_KIND.SCRIPT_INTERFACE, node, node.interfaces);
    addInterfaceMembers(b, sym.SYMBOL_KIND.SCRIPT_INTERFACE_MEMBER,
      node.interfaces, scriptIface, true);
  }

  // A node's own interface declarations (Script, per 6.40) may carry default
  // values containing nodes. The owning scope is not in doubt here -- it is the
  // scope the node itself sits in -- so these ARE traversed.
  for (const decl of node.interfaces || []) {
    if (!decl) continue;
    // Annex A.3's three `… IS …` forms. The DEFINITION-side endpoint is the
    // declaration itself (its own name, access and type); the DECLARATION-side
    // name is looked up in the enclosing PROTO's interface.
    if (decl.type === NODE.INTERFACE && (decl.is != null || decl.isRange)) {
      b.addIsRef({
        name: decl.is,
        form: sym.IS_FORM.SCRIPT_INTERFACE,
        node: decl,
        hostNode: node,
        ownerInterface: ctx.isOwner || null,
        outerInterfaces: ctx.outerInterfaces,
        hostScope: ctx.scope,
        hostInterfaceScope: scriptIface,
        range: decl.isRange || null,
        endpointName: decl.name,
        endpointRange: decl.nameRange || decl.range,
      });
    }
    if (decl.default) visitValue(b, decl.default, inner);
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
    // `fieldId IS interfaceId` binds an interface member, not a node name -- so
    // it contributes nothing to DEF/USE (unchanged from P1) and one `IS`
    // reference to the interface-member namespace (WD1.5-P2B).
    if (field.isBinding && field.value && field.value.type === NODE.IS) {
      b.addIsRef({
        name: field.value.name,
        form: sym.IS_FORM.NODE_BODY,
        node: field,
        hostNode: node,
        ownerInterface: ctx.isOwner || null,
        outerInterfaces: ctx.outerInterfaces,
        hostScope: ctx.scope,
        // Carried so a node-body `IS` on a Script can consult the Script's own
        // declarations for its endpoint before falling back to clause 6.
        hostInterfaceScope: scriptIface,
        range: field.value.nameRange || null,
        endpointName: field.name,
        endpointRange: field.nameRange || field.range,
      });
      continue;
    }
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
    for (const scope of b.scopes.concat(b.interfaceScopes)) {
      scope.recovered = true;
      scope.recoveredReason = REASON.DOCUMENT_PARSE_INCOMPLETE;
    }
    return;
  }
  // WD1.5-P2B: a SECOND, INDEPENDENT pass over interface scopes, run before the
  // P1 pass and sharing no state with it.
  //
  // It is deliberately NOT an "innermost containing scope" competition. An
  // interface scope's range is a strict subset of its owning construct's, so
  // entering it into P1's competition would displace the enclosing DEF scope as
  // the innermost match and UN-mark it -- turning a `recovered` USE answer back
  // into a confident one. Attributing damage to BOTH is purely additive: it can
  // only turn `resolved` into `recovered`, never the reverse.
  for (const d of b.syntaxDiagnostics) {
    if (!d || d.severity !== 'error' || !d.range) continue;
    for (const scope of b.interfaceScopes) {
      if (!scope.ownerRange || !contains(scope.ownerRange, d.range)) continue;
      if (scope.recovered) continue;
      scope.recovered = true;
      scope.recoveredReason = REASON.INTERFACE_SCOPE_NOT_PROVABLE;
    }
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
      for (const scope of b.scopes.concat(b.interfaceScopes)) {
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
// Interface members and IS (WD1.5-P2B)
// ---------------------------------------------------------------------------

/**
 * Annex A.2's `fieldType` production, verbatim -- the twenty tokens the grammar
 * admits as a field type.
 *
 * THIS IS NOT A SECOND FIELD-TYPE TABLE. The WD1.3 schema is authority for what
 * type a given NODE'S FIELD has, and stays so; this answers the different
 * question of which tokens are legal field types at all, which only the grammar
 * can answer. They cannot be the same table: `MFTime` is a legal VRML97 field
 * type that no clause-6 built-in field happens to use, so a set derived from the
 * schema would be 19 tokens and would report a perfectly legal `field MFTime`
 * member as `is-type-unknown`. `interface-is.test.js` pins the containment
 * relation (every schema type is in this set) so the two cannot drift apart.
 */
const VRML97_FIELD_TYPES = new Set([
  'MFColor', 'MFFloat', 'MFInt32', 'MFNode', 'MFRotation', 'MFString', 'MFTime',
  'MFVec2f', 'MFVec3f', 'SFBool', 'SFColor', 'SFFloat', 'SFImage', 'SFInt32',
  'SFNode', 'SFRotation', 'SFString', 'SFTime', 'SFVec2f', 'SFVec3f',
]);

/**
 * ISO/IEC 14772-1 4.8.3 Table 4.4 -- the legal `IS` access-kind mappings.
 *
 * DIRECTIONAL, and asymmetric: 7 legal cells of 16. Outer key is the PROTOTYPE
 * DEFINITION side (the left-hand endpoint on the node); inner key is the
 * DECLARATION side (the right-hand interface member). Transposing it still
 * "works" on the diagonal and fails only on the `exposedField` row and column,
 * which is exactly why every one of the sixteen cells is tested individually.
 *
 * The prose of 4.8.3 agrees independently in both directions: "an exposedField
 * in the prototype interface may be associated only with an exposedField in the
 * prototype definition" is the `exposedField` COLUMN, and "an exposedField in
 * the prototype definition may be associated with either a field, eventIn,
 * eventOut or exposedField in the prototype interface" is the ROW.
 *
 * One table, one place, consulted once. It is applied to EFFECTIVE access after
 * alias expansion: a `set_zzz` is an eventIn here, whatever it was declared as.
 */
const IS_ACCESS_MATRIX = Object.freeze({
  exposedField: Object.freeze({
    exposedField: true, field: true, eventIn: true, eventOut: true,
  }),
  field: Object.freeze({
    exposedField: false, field: true, eventIn: false, eventOut: false,
  }),
  eventIn: Object.freeze({
    exposedField: false, field: false, eventIn: true, eventOut: false,
  }),
  eventOut: Object.freeze({
    exposedField: false, field: false, eventIn: false, eventOut: true,
  }),
});

/**
 * The effective names one declaration occupies -- 4.7 and 4.8.2.
 *
 * `exposedField zzz` is EQUIVALENT to `field zzz` + `eventIn set_zzz` +
 * `eventOut zzz_changed`, so it occupies three effective names and each carries
 * its OWN effective access. Getting that last part wrong is the subtlest
 * available bug in this lane: binding `set_zzz` and then testing it as an
 * `exposedField` would wrongly accept a definition-side `field`.
 *
 * Generated on demand into the private index, never written into a symbol and
 * never into the document -- they are a rule about how a declaration may be
 * REFERRED TO, not additional declarations.
 */
function effectiveEntriesOf(member) {
  if (member.name == null) return [];
  const entries = [{
    member, effectiveName: member.name, effectiveAccess: member.access, viaAlias: false,
  }];
  if (member.access === sym.ACCESS.EXPOSED_FIELD) {
    entries.push({
      member,
      effectiveName: `set_${member.name}`,
      effectiveAccess: sym.ACCESS.EVENT_IN,
      viaAlias: true,
    });
    entries.push({
      member,
      effectiveName: `${member.name}_changed`,
      effectiveAccess: sym.ACCESS.EVENT_OUT,
      viaAlias: true,
    });
  }
  return entries;
}

/** Split `set_X` / `X_changed` into its base name and the access it denotes. */
function aliasBaseOf(name) {
  if (typeof name !== 'string') return null;
  if (name.startsWith('set_') && name.length > 4) {
    return { base: name.slice(4), access: sym.ACCESS.EVENT_IN };
  }
  if (name.endsWith('_changed') && name.length > 8) {
    return { base: name.slice(0, -8), access: sym.ACCESS.EVENT_OUT };
  }
  return null;
}

/** Every entry for `effectiveName` in one interface scope. Never a chain walk. */
function membersIn(state, ifaceScope, effectiveName) {
  const table = state.membersByInterfaceScope.get(ifaceScope);
  if (!table) return [];
  return table.get(effectiveName) || [];
}

// --- the recovery proof gate -----------------------------------------------
//
// P2A's binding lesson, applied BEFORE any branch exists rather than after:
// prove the whole relevant chain ONCE, UP FRONT. A per-branch guard is one
// `return` away from a leak, and P2A leaked exactly that way -- the branches
// that were wrapped were safe and the ones that were not silently were not.
//
// What a damaged construct must never manufacture, and why each sits BELOW this
// gate rather than being special-cased above it:
//
//   * a POSITIVE binding      -- a moved boundary can invent the only match;
//   * a NEGATIVE "no such member" -- a truncated interface list LOSES members,
//                                so absence is unprovable, not false;
//   * a DUPLICATE/ambiguity claim -- an unclosed `[` absorbs a declaration that
//                                was never in this interface, manufacturing one;
//   * an access or type verdict, a uniqueness assertion, or the identity of the
//     owning interface.
//
// The negative and ambiguous ones are the part that is easy to get wrong: both
// bind nothing, which makes them look safe to let stand. They are still
// ASSERTIONS, and recovery is capable of fabricating either.
//
// G1-G4 gate the declaration-side binding. G5 additionally gates the endpoint
// and the compatibility verdicts (`acquireEndpoint`), so a provable binding
// SURVIVES an unprovable endpoint -- they are two questions and only one of them
// may be lost.
function interfaceChainWithholds(state, reference) {
  // G1 -- a hard parse cap aborts the tree, so no scope anywhere is provable.
  if (state.documentIncomplete) {
    return result(reference, STATUS.RECOVERED, REASON.DOCUMENT_PARSE_INCOMPLETE);
  }
  // G2 -- the enclosing body. An unclosed body absorbs the statements after it,
  // which moves WHICH interface an `IS` belongs to. That makes even the
  // `is-outside-proto-body` answer below unsayable, so this is checked whether
  // or not an owning interface was found.
  if (reference.hostScope && reference.hostScope.recovered) {
    return result(reference, STATUS.RECOVERED,
      REASON.INTERFACE_NOT_PROVABLE_FOR_REFERENCE);
  }
  // G3 -- the owning interface itself. An unclosed `[` absorbs following
  // statements into the interface list and manufactures members.
  //
  // MEASURED AS SUBSUMED BY G2 TODAY, AND KEPT ANYWAY. A proto-body scope's
  // `ownerRange` is the whole `Proto` node, which CONTAINS its own interface
  // list, so every diagnostic that marks an interface unprovable also marks the
  // body unprovable and G2 fires first. No fixture reaches this branch, which is
  // why the mutation suite exercises G3 where it IS independently observable --
  // `interfaceEndpoint`, whose interface belongs to a DIFFERENT declaration
  // whose body has nothing to do with this reference.
  //
  // It is retained rather than deleted because the redundancy is a property of
  // that containment, not of the rule: narrow a proto-body's `ownerRange`, or
  // change attribution, and this becomes the live guard. The containment is
  // pinned by test (`interface-is.test.js`, "G3 is subsumed"), so if it ever
  // stops holding the suite says so rather than silently opening a gap.
  if (reference.owner && reference.owner.recovered) {
    return result(reference, STATUS.RECOVERED,
      reference.owner.recoveredReason || REASON.INTERFACE_SCOPE_NOT_PROVABLE);
  }
  // G4 -- the DECLARING side of a Script-form `IS`: same fabrication hazard, and
  // an absent script interface (a `… IS …` written in a non-Script node's
  // interface list) is likewise unprovable rather than answerable.
  if (reference.form === sym.IS_FORM.SCRIPT_INTERFACE
    && (!reference.hostInterfaceScope || reference.hostInterfaceScope.recovered)) {
    return result(reference, STATUS.RECOVERED,
      (reference.hostInterfaceScope && reference.hostInterfaceScope.recoveredReason)
        || REASON.INTERFACE_SCOPE_NOT_PROVABLE);
  }
  return null;
}

/**
 * The DECLARATION-side (right-hand) lookup of one `IS`.
 *
 * Resolution order is §7.3's, and the gate is step 3 so nothing below it is
 * reachable from a damaged construct:
 *
 *   1. graph ownership / projection validity   (`resolveIs`, before this)
 *   2. is there a right-hand name at all?      -- a token fact, not lexical
 *   3. THE GATE                                -- if it withholds, full stop
 *   4. is there an enclosing PROTO interface?
 *   5. member lookup over EFFECTIVE names
 */
function resolveIsReference(state, reference) {
  // Step 2. True whatever the surrounding scopes turn out to be.
  if (reference.name == null) {
    return result(reference, STATUS.INVALID, REASON.IS_TARGET_NAME_MISSING);
  }
  // Step 3.
  const withheld = interfaceChainWithholds(state, reference);
  if (withheld) return withheld;

  // Step 4. 4.3.6 is explicit: only the body of a node statement inside a
  // prototype definition may contain `IS` statements. Corpus: 102 -- real,
  // non-conforming, Cybertown-authored content, and a first-class classified
  // answer rather than a parse failure.
  const owner = reference.owner;
  if (!owner) {
    return result(reference, STATUS.INVALID, REASON.IS_OUTSIDE_PROTO_BODY);
  }

  // Step 5. Over EFFECTIVE names, in the INNERMOST interface only.
  const entries = membersIn(state, owner, reference.name);

  // Decided on the name ALONE, before type or access is looked at -- the same
  // rule P1/P2A use for DEF and type names, for the same reason. This is also
  // where an `exposedField zzz` + explicit `eventIn set_zzz` collision lands:
  // 4.3.5 prohibits that combination outright, so there is no author intent to
  // recover and NEITHER declaration is preferred. No first-match, no
  // source-order, no explicit-beats-alias, no ranking of any kind.
  if (entries.length > 1) {
    return result(reference, STATUS.AMBIGUOUS, REASON.DUPLICATE_INTERFACE_MEMBER, {
      candidateCount: entries.length,
      evidence: entries.map((e) => e.member.declRange),
    });
  }

  if (entries.length === 1) {
    const entry = entries[0];
    state.isEntryByReference.set(reference, entry);
    return result(reference, STATUS.RESOLVED, REASON.OK, {
      symbol: entry.member,
      candidateCount: 1,
      evidence: [entry.member.declRange],
      detail: entry.viaAlias ? REASON.MEMBER_VIA_IMPLICIT_ALIAS : null,
    });
  }

  // Not declared in the innermost interface. If an OUTER interface happens to
  // declare it, say so as a NON-BINDING detail -- the status stays `unresolved`
  // and `createResolution` drops any symbol on a non-resolved answer, so this
  // cannot become a binding however it is read.
  const outers = state.outerInterfacesByIsReference.get(reference) || [];
  let detail = null;
  for (const outer of outers) {
    if (membersIn(state, outer, reference.name).length > 0) {
      detail = REASON.MEMBER_FOUND_IN_OUTER_INTERFACE_ONLY;
      break;
    }
  }
  return result(reference, STATUS.UNRESOLVED, REASON.INTERFACE_MEMBER_NOT_DECLARED, { detail });
}

// --- endpoint acquisition --------------------------------------------------
//
// Per 4.3.6 the left-hand name is one from THE NODE'S OWN public interface, so
// which namespace answers is decided by the containing node, never by the PROTO.
// Four origins, one shared lookup path for the three interface-backed ones.

const endpointOutcome = (endpoint, status, reason, evidence) => ({
  endpoint: endpoint || null, status, reason, evidence: evidence || [],
});

/**
 * A clause-6 built-in field, with 4.7's implicit aliases applied at LOOKUP time.
 *
 * The committed schema records DECLARED interface names only, so
 * `getFieldSchema('Transform','set_translation')` is `null` by design -- the
 * aliases are a language rule, not an extra ISO declaration, and the schema must
 * NOT be regenerated to add them.
 *
 * X3D-only leakage is closed by the same test that finds the field: a record
 * whose `vrml97Declaration` is `null` is X3D-only and is not a VRML97 endpoint
 * at all. There are 232 such fields.
 */
function builtinEndpoint(nodeType, name) {
  const direct = nodeSchema.getFieldSchema(nodeType, name);
  if (direct && direct.vrml97Declaration) {
    return {
      effectiveName: name, access: direct.vrml97Declaration, type: direct.type, viaAlias: false,
    };
  }
  const alias = aliasBaseOf(name);
  if (alias) {
    const base = nodeSchema.getFieldSchema(nodeType, alias.base);
    if (base && base.vrml97Declaration === sym.ACCESS.EXPOSED_FIELD) {
      return {
        effectiveName: alias.base, access: alias.access, type: base.type, viaAlias: true,
      };
    }
  }
  return null;
}

/**
 * One lookup shared by all three interface-backed endpoint namespaces.
 *
 * The EXTERNPROTO difference is confined to the MISS branch, and that is the
 * whole of §9's positive/absence split:
 *
 *   * a member the declaration DOES state is positive local information --
 *     4.9.2 makes an EXTERNPROTO interface a PROTO interface bar initial values,
 *     so its name, access kind and type are as authoritative as a PROTO's, and
 *     compatibility proceeds from them WITHOUT loading anything;
 *   * a member ABSENT from it is where 4.9.2's subset rule bites: the
 *     declaration may be a strict subset of the implementation's, so absence is
 *     UNKNOWABLE, not false. `unsupported`, never `unresolved`.
 *
 * Under no circumstance is the EXTERNPROTO's URL fetched, loaded or followed to
 * decide either branch. This module performs no I/O of any kind.
 */
function interfaceEndpoint(state, ifaceScope, name, isExtern) {
  if (!ifaceScope) {
    return endpointOutcome(null, STATUS.RECOVERED, REASON.INTERFACE_SCOPE_NOT_PROVABLE);
  }
  if (ifaceScope.recovered) {
    return endpointOutcome(null, STATUS.RECOVERED,
      ifaceScope.recoveredReason || REASON.INTERFACE_SCOPE_NOT_PROVABLE);
  }
  const entries = membersIn(state, ifaceScope, name);
  if (entries.length > 1) {
    return endpointOutcome(null, STATUS.AMBIGUOUS, REASON.DUPLICATE_INTERFACE_MEMBER,
      entries.map((e) => e.member.declRange));
  }
  if (entries.length === 0) {
    return isExtern
      ? endpointOutcome(null, STATUS.UNSUPPORTED,
        REASON.EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE)
      : endpointOutcome(null, STATUS.UNRESOLVED, REASON.IS_ENDPOINT_UNKNOWN_FIELD);
  }
  const entry = entries[0];
  return endpointOutcome({
    // The DECLARATION the written name denotes, so `set_flag` reports `flag` --
    // matching the built-in path, where the schema record found is likewise the
    // base field. `endpoint.name` already carries the written spelling, so
    // echoing it here would say nothing.
    effectiveName: entry.member.name,
    access: entry.effectiveAccess,
    type: entry.member.fieldType,
    range: entry.member.declRange,
    viaAlias: entry.viaAlias,
  }, STATUS.RESOLVED, REASON.OK);
}

function acquireEndpoint(state, reference) {
  const name = reference.endpointName;
  if (name == null) {
    return endpointOutcome(null, STATUS.INVALID, REASON.MISSING_NAME);
  }

  // The Script form needs no lookup at all: `field SFBool run IS go` DECLARES
  // its own endpoint, so the declaration is the endpoint. G4 has already proven
  // the declaring interface.
  if (reference.form === sym.IS_FORM.SCRIPT_INTERFACE) {
    const decl = reference.node;
    const out = endpointOutcome({
      effectiveName: name,
      access: decl.access == null ? null : decl.access,
      type: decl.fieldType == null ? null : decl.fieldType,
      range: reference.endpointRange,
      viaAlias: false,
    }, STATUS.RESOLVED, REASON.OK);
    out.origin = sym.ENDPOINT_ORIGIN.SCRIPT_INTERFACE;
    return out;
  }

  // G5 -- the containing node's TYPE must be resolved by P2A, or the endpoint
  // namespace is a guess. Every non-`resolved` P2A outcome lands here, and no
  // access or type verdict is returned; the declaration-side binding still
  // stands on its own.
  const hostNode = reference.hostNode;
  const typeRef = hostNode ? state.typeReferenceByAstNode.get(hostNode) : null;
  const typeRes = typeRef ? state.resolutionByReference.get(typeRef) : null;
  if (!typeRes || typeRes.status !== STATUS.RESOLVED) {
    return endpointOutcome(null, STATUS.UNRESOLVED, REASON.IS_ENDPOINT_NODE_TYPE_UNRESOLVED);
  }

  if (typeRes.reason === REASON.NODE_TYPE_IS_BUILTIN) {
    // A Script's USER declarations are part of that instance's public interface
    // and are consulted before clause 6. This is the P2A precedent -- a lexical
    // declaration outranks the schema -- not candidate ranking: the two are
    // different namespaces, not two candidates in one.
    if (hostNode.nodeType === 'Script' && reference.hostInterfaceScope) {
      const own = interfaceEndpoint(state, reference.hostInterfaceScope, name, false);
      if (own.status !== STATUS.UNRESOLVED) {
        if (own.endpoint) own.origin = sym.ENDPOINT_ORIGIN.SCRIPT_INTERFACE;
        return own;
      }
      // A miss falls through to Script's own clause-6 fields (`url`,
      // `directOutput`, `mustEvaluate`), which are schema facts.
    }
    const found = builtinEndpoint(hostNode.nodeType, name);
    if (!found) {
      return endpointOutcome(null, STATUS.UNRESOLVED, REASON.IS_ENDPOINT_UNKNOWN_FIELD);
    }
    const out = endpointOutcome({
      effectiveName: found.effectiveName,
      access: found.access,
      type: found.type,
      range: reference.endpointRange,
      viaAlias: found.viaAlias,
    }, STATUS.RESOLVED, REASON.OK);
    out.origin = sym.ENDPOINT_ORIGIN.BUILTIN_SCHEMA;
    return out;
  }

  // Resolved to a local PROTO or EXTERNPROTO declaration.
  const decl = typeRes.symbol;
  if (!decl) {
    return endpointOutcome(null, STATUS.UNRESOLVED, REASON.IS_ENDPOINT_NODE_TYPE_UNRESOLVED);
  }
  const isExtern = decl.kind === sym.SYMBOL_KIND.EXTERNPROTO_DECL;
  const iface = state.interfaceScopeByAstNode.get(decl.node) || null;
  const out = interfaceEndpoint(state, iface, name, isExtern);
  out.origin = isExtern
    ? sym.ENDPOINT_ORIGIN.EXTERNPROTO_INTERFACE
    : sym.ENDPOINT_ORIGIN.PROTO_INTERFACE;
  return out;
}

const verdict = (reference, status, reason, extra) => sym.createIsVerdict({
  reference,
  status,
  reason,
  member: (extra && extra.member) || null,
  endpoint: (extra && extra.endpoint) || null,
  declaredAccess: extra ? extra.declaredAccess : null,
  declaredType: extra ? extra.declaredType : null,
  detail: (extra && extra.detail) || null,
  evidence: (extra && extra.evidence) || [],
});

/**
 * §7.1's second half: may these two actually be connected?
 *
 * Kept SEPARATE from the declaration-side binding on purpose. The endpoint can
 * be unknowable while the binding is perfectly provable, and collapsing them
 * would throw away a good answer; conversely a failed binding makes
 * compatibility unaskable, because there is nothing to be compatible WITH.
 */
function computeIsVerdict(state, reference) {
  const rhs = state.isResolutionByReference.get(reference);
  if (!rhs || rhs.status !== STATUS.RESOLVED) {
    return verdict(reference, rhs ? rhs.status : STATUS.UNRESOLVED,
      rhs ? rhs.reason : REASON.INTERFACE_MEMBER_NOT_DECLARED,
      { detail: rhs ? rhs.detail : null, evidence: rhs ? rhs.evidence : [] });
  }
  const entry = state.isEntryByReference.get(reference);
  const member = rhs.symbol;
  const declaredAccess = entry ? entry.effectiveAccess : null;
  const declaredType = member.fieldType;
  const base = {
    member, declaredAccess, declaredType, detail: rhs.detail,
  };

  const acquired = acquireEndpoint(state, reference);
  if (acquired.status !== STATUS.RESOLVED || !acquired.endpoint) {
    return verdict(reference, acquired.status, acquired.reason, {
      ...base, evidence: acquired.evidence,
    });
  }
  const endpoint = sym.createEndpoint({
    origin: acquired.origin,
    name: reference.endpointName,
    effectiveName: acquired.endpoint.effectiveName,
    access: acquired.endpoint.access,
    type: acquired.endpoint.type,
    range: acquired.endpoint.range,
  });
  const withEndpoint = { ...base, endpoint };
  const evidence = [reference.endpointRange, member.declRange];

  // Table 4.4, on EFFECTIVE access on both sides.
  const row = IS_ACCESS_MATRIX[endpoint.access];
  if (!row || declaredAccess == null || !(declaredAccess in row)) {
    return verdict(reference, STATUS.UNRESOLVED, REASON.IS_ENDPOINT_UNKNOWN_FIELD, {
      ...withEndpoint, evidence,
    });
  }
  if (!row[declaredAccess]) {
    return verdict(reference, STATUS.INVALID, REASON.IS_ACCESS_INCOMPATIBLE, {
      ...withEndpoint, evidence,
    });
  }

  // 4.8.3: EXACT type-token equality. No promotion, no coercion, no SF<->MF
  // relationship, no default-value influence, and for SFNode/MFNode no
  // inspection of the node type inside -- the standard imposes no such
  // constraint at the `IS` boundary and inventing one would be
  // interpretation-grade.
  const a = endpoint.type;
  const bType = declaredType;
  if (a == null || bType == null || !VRML97_FIELD_TYPES.has(a) || !VRML97_FIELD_TYPES.has(bType)) {
    return verdict(reference, STATUS.UNRESOLVED, REASON.IS_TYPE_UNKNOWN, {
      ...withEndpoint, evidence,
    });
  }
  if (a !== bType) {
    return verdict(reference, STATUS.INVALID, REASON.IS_TYPE_MISMATCH, {
      ...withEndpoint, evidence,
    });
  }
  return verdict(reference, STATUS.RESOLVED, REASON.OK, { ...withEndpoint, evidence });
}

/**
 * 4.8.3's two per-NODE multiplicity rules (S7/S8).
 *
 * Properties of a node, not of one reference, so they are their own query. An
 * `IS` whose right-hand side binds perfectly can still sit in a node that breaks
 * these, and corrupting the binding to say so would lose the good answer.
 */
function computeNodeIsIssues(state, node) {
  if (state.documentIncomplete) {
    return sym.createNodeIsIssues({
      status: STATUS.RECOVERED, reason: REASON.DOCUMENT_PARSE_INCOMPLETE, issues: [],
    });
  }
  const scope = state.scopeByAstNode.get(node) || null;
  if (scope && scope.recovered) {
    return sym.createNodeIsIssues({
      status: STATUS.RECOVERED,
      reason: scope.recoveredReason || REASON.SCOPE_RECOVERED,
      issues: [],
    });
  }
  const bound = new Map();
  const valued = new Map();
  for (const field of node.fields || []) {
    if (!field || field.type !== NODE.FIELD || field.name == null) continue;
    const target = (field.isBinding && field.value && field.value.type === NODE.IS)
      ? bound : valued;
    const list = target.get(field.name);
    if (list) list.push(field);
    else target.set(field.name, [field]);
  }
  const issues = [];
  for (const [name, fields] of bound) {
    // 4.8.3: results are undefined if one field/eventIn/eventOut of a node in
    // the definition is associated with MORE THAN ONE interface member.
    //
    // NOT the converse. Several DIFFERENT endpoints mapping to ONE interface
    // member is explicitly valid and must never be flagged -- inverting this
    // rule would reject a standard idiom.
    if (fields.length > 1) {
      issues.push({
        reason: REASON.DUPLICATE_IS_FOR_ENDPOINT,
        endpointName: name,
        evidence: fields.map((f) => f.nameRange || f.range),
      });
    }
    // 4.8.3: results are undefined if a field is both given an initial value and
    // associated by `IS`.
    const alsoValued = valued.get(name);
    if (alsoValued) {
      issues.push({
        reason: REASON.FIELD_VALUED_AND_IS,
        endpointName: name,
        evidence: [...alsoValued, ...fields].map((f) => f.nameRange || f.range),
      });
    }
  }
  issues.sort((x, y) => {
    const ax = offsetOf(x.evidence[0]);
    const ay = offsetOf(y.evidence[0]);
    if (ax !== ay) return ax - ay;
    return byCodepoint(x.reason, y.reason);
  });
  return sym.createNodeIsIssues({ status: STATUS.RESOLVED, reason: REASON.OK, issues });
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
    visitStatements(b, tree.statements, {
      scope: documentScopeRecord, insideScript: false, isOwner: null, outerInterfaces: [],
    });
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

  // Interface scopes (WD1.5-P2B). No parent link of either sort, so they need no
  // ordering constraint against each other -- an interface is an OWNERSHIP
  // scope, not a link in a chain something walks.
  const interfaceScopeList = b.interfaceScopes.map((rec) => sym.createScope({
    kind: rec.kind,
    defParent: null,
    typeParent: null,
    ownerRange: rec.ownerRange,
    ownerName: rec.ownerName,
    ownerNode: rec.ownerNode,
    recovered: rec.recovered,
    recoveredReason: rec.recoveredReason,
    index: rec.index,
  }, graph));

  // Source order is the published order, and it is NOT construction order: a
  // node's interface defaults are visited before its fields, while in the text
  // the two interleave. Sort first, then number.
  b.symbols.sort(byPosition);
  b.members.sort(byPosition);
  b.isRefs.sort(byPosition);
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

  // --- interface-member namespace (WD1.5-P2B) ------------------------------

  const interfaceMemberList = b.members.map((rec, i) => sym.createInterfaceMemberSymbol({
    kind: rec.kind,
    name: rec.name,
    access: rec.access,
    fieldType: rec.fieldType,
    node: rec.node,
    scope: interfaceScopeList[rec.interfaceScopeIndex],
    declRange: rec.declRange,
    range: rec.range,
    hasDefault: rec.hasDefault,
    sourceOrder: i,
    detail: rec.detail,
  }, graph));

  const isReferenceList = b.isRefs.map((rec, i) => sym.createIsReference({
    name: rec.name,
    form: rec.form,
    node: rec.node,
    hostNode: rec.hostNode,
    owner: rec.ownerInterface ? interfaceScopeList[rec.ownerInterface.index] : null,
    hostScope: scopes[rec.hostScopeIndex],
    hostInterfaceScope: rec.hostInterfaceScope
      ? interfaceScopeList[rec.hostInterfaceScope.index] : null,
    range: rec.range,
    endpointName: rec.endpointName,
    endpointRange: rec.endpointRange,
    sourceOrder: i,
    offset: rec.offset,
    detail: rec.detail,
  }, graph));

  // A THIRD, SEPARATE name map. Sharing `defsByScope` or `typeDeclsByScope`
  // would make `DEF Ball`, `PROTO Ball` and `field SFBool Ball` collide, which
  // is the exact conflation the three-namespace rule exists to prevent.
  //
  // Keyed by EFFECTIVE name, so 4.7's implicit aliases are found by the same
  // lookup as a written name and an alias/explicit collision shows up as what it
  // is -- two entries under one name -- rather than as a precedence question.
  const membersByInterfaceScope = new Map(interfaceScopeList.map((s) => [s, new Map()]));
  const memberByAstNode = new WeakMap();
  for (const m of interfaceMemberList) {
    if (!memberByAstNode.has(m.node)) memberByAstNode.set(m.node, m);
    const table = membersByInterfaceScope.get(m.scope);
    for (const entry of effectiveEntriesOf(m)) {
      const list = table.get(entry.effectiveName);
      if (list) list.push(entry);
      else table.set(entry.effectiveName, [entry]);
    }
  }

  const interfaceScopeByAstNode = new WeakMap();
  for (const s of interfaceScopeList) {
    if (s.ownerNode && !interfaceScopeByAstNode.has(s.ownerNode)) {
      interfaceScopeByAstNode.set(s.ownerNode, s);
    }
  }

  const isReferenceByAstNode = new WeakMap();
  for (const r of isReferenceList) isReferenceByAstNode.set(r.node, r);

  // Kept OFF the frozen reference: an interface scope has no parent link, and
  // this list exists solely to explain an outer-only near-miss as a non-binding
  // detail. Publishing it would be publishing the outward chain 4.8.4 denies.
  const outerInterfacesByIsReference = new Map();
  b.isRefs.forEach((rec, i) => {
    outerInterfacesByIsReference.set(isReferenceList[i],
      rec.outerInterfaces.map((s) => interfaceScopeList[s.index]));
  });

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
    // interface-member namespace (WD1.5-P2B)
    interfaceScopeList,
    interfaceMemberList,
    isReferenceList,
    membersByInterfaceScope,
    memberByAstNode,
    interfaceScopeByAstNode,
    isReferenceByAstNode,
    outerInterfacesByIsReference,
    isResolutionByReference: new Map(),
    isEntryByReference: new Map(),
    isVerdictByReference: new Map(),
    isReferencesByMember: new Map(),
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

  // `IS` resolution runs LAST because its endpoint half consults P2A's answers
  // for the containing node's type (G5), which must already be computed.
  for (const reference of isReferenceList) {
    const res = resolveIsReference(state, reference);
    state.isResolutionByReference.set(reference, res);
    // Only an AUTHORITATIVE binding is indexed -- P1's rule, unchanged. An
    // ambiguous, invalid, unresolved or recovered reference is not "probably
    // this member", and including it is how a future rename corrupts a document.
    if (res.status === STATUS.RESOLVED && res.symbol) {
      const list = state.isReferencesByMember.get(res.symbol);
      if (list) list.push(reference);
      else state.isReferencesByMember.set(res.symbol, [reference]);
    }
  }
  for (const reference of isReferenceList) {
    state.isVerdictByReference.set(reference, computeIsVerdict(state, reference));
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


// --- interface-member namespace (WD1.5-P2B) --------------------------------
//
// A THIRD set of accessors, exactly as P2A added a second rather than folding
// node types into P1's lists. `symbols`/`references`/`resolutions` stay DEF/USE
// and `typeDeclarations`/`typeReferences`/`typeResolutions` stay node-type;
// neither changes meaning or count because this lane landed.

/** Every interface scope, in construction order. A fresh frozen array. */
function interfaceScopes(graph) {
  return Object.freeze(internalsOf(graph, 'interfaceScopes').interfaceScopeList.slice());
}

/** Every interface member declaration, source-ordered. A fresh frozen array. */
function interfaceMembers(graph) {
  return Object.freeze(internalsOf(graph, 'interfaceMembers').interfaceMemberList.slice());
}

/** Every `IS` reference, source-ordered. A fresh frozen array. */
function isReferences(graph) {
  return Object.freeze(internalsOf(graph, 'isReferences').isReferenceList.slice());
}

/** Every `IS` declaration-side answer, in `isReferences` order. Frozen, fresh. */
function isResolutions(graph) {
  const state = internalsOf(graph, 'isResolutions');
  return Object.freeze(state.isReferenceList.map((r) => state.isResolutionByReference.get(r)));
}

/**
 * The interface scope an AST `Proto` / `ExternProto` / `Script` owns, or `null`.
 *
 * Narrowly named rather than folded into `scopeOf`, which stays lexical: a
 * `Proto` node owns BOTH a proto-body DEF scope and a proto-interface scope, so
 * an overloaded accessor would have to guess which was meant.
 */
function interfaceScopeFor(graph, astNode) {
  const state = internalsOf(graph, 'interfaceScopeFor');
  if (!astNode || typeof astNode !== 'object') return null;
  return state.interfaceScopeByAstNode.get(astNode) || null;
}

/** The member an AST `InterfaceDecl` declares, or `null`. A lookup, not a resolution. */
function interfaceMemberFor(graph, astNode) {
  const state = internalsOf(graph, 'interfaceMemberFor');
  if (!astNode || typeof astNode !== 'object') return null;
  return state.memberByAstNode.get(astNode) || null;
}

/** The `IS` reference an AST `Field`/`InterfaceDecl` makes, or `null`. */
function isReferenceFor(graph, astNode) {
  const state = internalsOf(graph, 'isReferenceFor');
  if (!astNode || typeof astNode !== 'object') return null;
  return state.isReferenceByAstNode.get(astNode) || null;
}

/**
 * Every member of one interface scope, source-ordered. A fresh frozen array.
 *
 * WRITTEN declarations only. The implicit `set_`/`_changed` aliases are not
 * members and are not listed here; they exist in the lookup index because 4.7
 * says a declaration may be REFERRED TO by them, which is a different fact from
 * there being three declarations.
 */
function membersOf(graph, interfaceScope) {
  const state = internalsOf(graph, 'membersOf');
  assertMember(state, interfaceScope, sym.isInterfaceScopeShape, SCOPE_ERROR.GRAPH,
    'membersOf', 'an interface scope from this graph');
  return Object.freeze(state.interfaceMemberList.filter((m) => m.scope === interfaceScope));
}

function coerceIsReference(state, referenceOrNode, label) {
  let reference = referenceOrNode;
  if (referenceOrNode && typeof referenceOrNode === 'object'
    && (referenceOrNode.type === NODE.FIELD || referenceOrNode.type === NODE.INTERFACE)) {
    reference = state.isReferenceByAstNode.get(referenceOrNode);
    if (!reference) {
      throw scopeError(SCOPE_ERROR.REFERENCE,
        `${label}: this node carries no IS reference in this graph's parse`);
    }
  }
  return assertMember(state, reference, sym.isIsReferenceShape, SCOPE_ERROR.REFERENCE,
    label, 'an IS reference from this graph');
}

/**
 * The DECLARATION-side binding of one `IS` -- which interface member does the
 * right-hand name denote?
 *
 * Deliberately NOT the compatibility question; see `isConnectionVerdict`.
 *
 * @returns {object} A frozen resolution -- a status, a stable reason, and a
 *   symbol only when the status is `resolved`.
 * @throws {Error} codes ESCOPEGRAPH, ESCOPEREF.
 */
function resolveIs(graph, referenceOrNode) {
  const state = internalsOf(graph, 'resolveIs');
  const reference = coerceIsReference(state, referenceOrNode, 'resolveIs');
  return state.isResolutionByReference.get(reference);
}

/**
 * May this `IS` connection actually be made -- Table 4.4 and 4.8.3's type rule?
 *
 * @returns {object} A frozen verdict. `endpoint.origin` says which of the four
 *   namespaces supplied the definition side; a consumer asking whether an
 *   EXTERNPROTO member was locally declared reads THAT, never the status.
 * @throws {Error} codes ESCOPEGRAPH, ESCOPEREF.
 */
function isConnectionVerdict(graph, referenceOrNode) {
  const state = internalsOf(graph, 'isConnectionVerdict');
  const reference = coerceIsReference(state, referenceOrNode, 'isConnectionVerdict');
  return state.isVerdictByReference.get(reference);
}

/**
 * Is this member's name unique within its OWN interface scope?
 *
 * Judged over EFFECTIVE names, so `exposedField zzz` alongside an explicit
 * `eventIn set_zzz` is correctly non-unique (4.3.5 prohibits the combination).
 * The same spelling in a DIFFERENT interface -- including a nested PROTO's -- is
 * not a duplicate at all: different scope, different namespace instance.
 *
 * A damaged interface answers `{unique:false}` with the recovery reason. That is
 * declining to assert uniqueness, not asserting duplication -- P1/P2A's rule.
 *
 * @returns {{unique:boolean, reason:string}} Frozen.
 * @throws {Error} codes ESCOPEGRAPH, ESCOPESYMBOL.
 */
function interfaceMemberIsUniqueInScope(graph, memberOrNode) {
  const state = internalsOf(graph, 'interfaceMemberIsUniqueInScope');
  let member = memberOrNode;
  if (memberOrNode && typeof memberOrNode === 'object' && memberOrNode.type === NODE.INTERFACE) {
    member = state.memberByAstNode.get(memberOrNode);
    if (!member) {
      throw scopeError(SCOPE_ERROR.SYMBOL,
        'interfaceMemberIsUniqueInScope: this declaration carries no member in this graph\'s parse');
    }
  }
  assertMember(state, member, sym.isInterfaceMemberShape, SCOPE_ERROR.SYMBOL,
    'interfaceMemberIsUniqueInScope', 'an interface member from this graph');
  if (state.documentIncomplete) {
    return sym.createUniqueness(false, REASON.DOCUMENT_PARSE_INCOMPLETE);
  }
  if (member.scope.recovered) {
    return sym.createUniqueness(false,
      member.scope.recoveredReason || REASON.INTERFACE_SCOPE_NOT_PROVABLE);
  }
  for (const entry of effectiveEntriesOf(member)) {
    if (membersIn(state, member.scope, entry.effectiveName).length !== 1) {
      return sym.createUniqueness(false, REASON.DUPLICATE_INTERFACE_MEMBER);
    }
  }
  return sym.createUniqueness(true, REASON.OK);
}

/**
 * 4.8.3's per-node `IS` multiplicity rules (S7/S8) for one AST `Node`.
 *
 * @returns {object} Frozen `{status, reason, issues[]}`.
 * @throws {Error} code ESCOPEGRAPH.
 */
function nodeIsBindingIssues(graph, nodeAstNode) {
  const state = internalsOf(graph, 'nodeIsBindingIssues');
  if (!nodeAstNode || typeof nodeAstNode !== 'object' || nodeAstNode.type !== NODE.NODE) {
    throw scopeError(SCOPE_ERROR.REFERENCE, 'nodeIsBindingIssues: expected a Node AST node');
  }
  return computeNodeIsIssues(state, nodeAstNode);
}

/**
 * Every `IS` that AUTHORITATIVELY binds to one interface member.
 *
 * Only `resolved` references appear -- P1's rule, for P1's reason.
 *
 * @throws {Error} codes ESCOPEGRAPH, ESCOPESYMBOL.
 */
function isReferencesTo(graph, memberOrNode) {
  const state = internalsOf(graph, 'isReferencesTo');
  let member = memberOrNode;
  if (memberOrNode && typeof memberOrNode === 'object' && memberOrNode.type === NODE.INTERFACE) {
    member = state.memberByAstNode.get(memberOrNode);
    if (!member) {
      throw scopeError(SCOPE_ERROR.SYMBOL,
        'isReferencesTo: this declaration carries no member in this graph\'s parse');
    }
  }
  assertMember(state, member, sym.isInterfaceMemberShape, SCOPE_ERROR.SYMBOL,
    'isReferencesTo', 'an interface member from this graph');
  return Object.freeze((state.isReferencesByMember.get(member) || []).slice());
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
  ACCESS: sym.ACCESS,
  ENDPOINT_ORIGIN: sym.ENDPOINT_ORIGIN,
  IS_FORM: sym.IS_FORM,
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
  // interface-member namespace (WD1.5-P2B)
  interfaceScopes,
  interfaceMembers,
  isReferences,
  isResolutions,
  interfaceScopeFor,
  interfaceMemberFor,
  isReferenceFor,
  membersOf,
  resolveIs,
  isConnectionVerdict,
  interfaceMemberIsUniqueInScope,
  nodeIsBindingIssues,
  isReferencesTo,
};
