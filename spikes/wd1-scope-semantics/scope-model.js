'use strict';
// WD1.5 spike -- prototype VRML97 scope + symbol model.
//
// THROWAWAY RESEARCH PROTOTYPE. Nothing under `src/`, `renderer/`, `test/` or
// `qa/` requires this file, and nothing here is wired into the application. It
// exists to answer one question:
//
//   What scope and symbol semantics does WRL Forge need, and can the CURRENT
//   parser/AST prove them?
//
// READ-ONLY over the production parse result. It never mutates a tree, never
// re-parses, never writes a file, and never re-implements the tokenizer or the
// parser. It imports `src/vrml` (parse result shapes), `src/vrml/ast.js` (the
// NODE discriminators only) and `src/vrml/node-schema.js` (WD1.3 field data).
//
// STANDARDS-FIRST. Every rule below cites ISO/IEC 14772-1 and carries an
// explicit CONFIDENCE grade (see `standards-model.md`):
//   * `normative-explicit` -- a direct sentence of the standard says this.
//   * `normative-derived`  -- follows from the Annex A grammar plus a clause.
//   * `interpretation`     -- a reasonable reading; the standard does not say it
//                             in so many words. The model FAILS CLOSED on these.
// Cybertown/Blaxxun permissiveness is never promoted into a language rule; it is
// classified separately (see `COMPAT` below).
//
// ---------------------------------------------------------------------------
// THE ONE RULE THIS MODEL DELIBERATELY DOES NOT IMPLEMENT
// ---------------------------------------------------------------------------
//
// ISO/IEC 14772-1 4.6.2 says: "If multiple nodes are given the same name, each
// USE statement refers to the closest node with the given name preceding it".
// That is a fully specified, deterministic language rule -- not a heuristic --
// and it is recorded as such in `standards-model.md`.
//
// This resolver still returns `ambiguous` for that case and does NOT pick the
// closest declaration. The reason is that the resolver's consumers are identity,
// rename and refactoring, where WD1.4's hard gate applies: a tool may lose a
// target, it may report that it cannot prove a target, it may never confidently
// act on the WRONG one. Implementing "closest preceding" here would put a
// ranking function on the exact code path WD1.4 banned ranking from.
//
// A future *runtime-semantics* query ("which node would a browser bind?") is a
// separate, explicitly labelled API -- see `REPORT.md` and the plan document. It
// is not this function, and it must never feed identity.

const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { NODE } = require(path.join(REPO_ROOT, 'src', 'vrml', 'ast.js'));
const nodeSchema = require(path.join(REPO_ROOT, 'src', 'vrml', 'node-schema.js'));

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

// A scope is a lexical region that OWNS a namespace. Note that VRML97 does not
// have one namespace per region: a PROTO body owns node names AND node type
// names, and those two namespaces have DIFFERENT parent links (see `Scope`).
const SCOPE_KIND = Object.freeze({
  DOCUMENT: 'document',
  PROTO_BODY: 'proto-body',
  PROTO_INTERFACE: 'proto-interface',
  EXTERNPROTO_INTERFACE: 'externproto-interface',
  SCRIPT_INTERFACE: 'script-interface',
});

// The three namespaces. Conflating any two of them is the single most common way
// to get VRML97 scope wrong, so they are named rather than implied.
const NAMESPACE = Object.freeze({
  NODE_NAME: 'node-name', // DEF names; USE and ROUTE endpoints look here
  NODE_TYPE: 'node-type', // PROTO/EXTERNPROTO declaration names
  INTERFACE_MEMBER: 'interface-member', // PROTO interface + Script interface members
});

const SYMBOL_KIND = Object.freeze({
  NODE_DEF: 'node-def',
  PROTO_DECL: 'proto-decl',
  EXTERNPROTO_DECL: 'externproto-decl',
  PROTO_INTERFACE_MEMBER: 'proto-interface-member',
  SCRIPT_INTERFACE_MEMBER: 'script-interface-member',
});

const REFERENCE_KIND = Object.freeze({
  USE: 'use',
  NODE_TYPE: 'node-type', // a node instance naming its type
  IS: 'is',
  ROUTE_NODE: 'route-node',
  ROUTE_EVENT: 'route-event',
});

// Resolution outcomes. `recovered` is distinct from `unresolved` on purpose:
// "I looked and it is not there" is a different claim from "the parse is too
// damaged for absence to mean anything".
const STATUS = Object.freeze({
  RESOLVED: 'resolved',
  UNRESOLVED: 'unresolved',
  AMBIGUOUS: 'ambiguous',
  INVALID: 'invalid',
  UNSUPPORTED: 'unsupported',
  RECOVERED: 'recovered',
});

// Stable reason identifiers. These are the strings a production diagnostics
// layer and a production identity layer would branch on; they never change
// meaning once published.
const REASON = Object.freeze({
  OK: 'ok',

  // node-name namespace
  DEF_NOT_DECLARED_IN_SCOPE: 'def-not-declared-in-scope',
  USE_BEFORE_DEF: 'use-before-def',
  DEF_NOT_VISIBLE_ACROSS_PROTO_BOUNDARY: 'def-not-visible-across-proto-boundary',
  DUPLICATE_DEF_IN_SCOPE: 'duplicate-def-in-scope',
  SELF_REFERENTIAL_USE: 'self-referential-use',
  SELF_REFERENCE_OUTSIDE_TRANSFORMATION_HIERARCHY: 'self-reference-outside-transformation-hierarchy',
  MISSING_NAME: 'missing-name',

  // node-type namespace
  NODE_TYPE_IS_BUILTIN: 'node-type-is-builtin',
  NODE_TYPE_UNKNOWN: 'node-type-unknown',
  PROTO_INSTANCE_BEFORE_DECLARATION: 'proto-instance-before-declaration',
  DUPLICATE_PROTO_DECLARATION: 'duplicate-proto-declaration',
  PROTO_SHADOWS_BUILTIN: 'proto-shadows-builtin',
  RECURSIVE_PROTO_INSTANCE: 'recursive-proto-instance',

  // interface-member namespace
  IS_OUTSIDE_PROTO_BODY: 'is-outside-proto-body',
  IS_MEMBER_NOT_DECLARED: 'is-member-not-declared',
  IS_TYPE_MISMATCH: 'is-type-mismatch',
  IS_ACCESS_MISMATCH: 'is-access-mismatch',
  IS_DUPLICATE_BINDING: 'is-duplicate-binding',
  IS_WITH_INITIAL_VALUE: 'is-with-initial-value',
  IS_DEFINITION_SIDE_UNKNOWN: 'is-definition-side-unknown',
  DUPLICATE_INTERFACE_MEMBER: 'duplicate-interface-member',
  EXPOSED_FIELD_ALIAS_COLLISION: 'exposed-field-alias-collision',
  SCRIPT_EXPOSED_FIELD: 'script-exposed-field',
  INTERFACE_DECL_OUTSIDE_SCRIPT: 'interface-declaration-outside-script',

  // ROUTE
  ROUTE_ENDPOINT_FORWARD_REFERENCE: 'route-endpoint-forward-reference',
  ROUTE_EVENT_NOT_DECLARED: 'route-event-not-declared',
  ROUTE_EVENT_TYPE_MISMATCH: 'route-event-type-mismatch',
  ROUTE_EVENT_DIRECTION_INVALID: 'route-event-direction-invalid',
  ROUTE_ENDPOINT_INTERFACE_UNKNOWN: 'route-endpoint-interface-unknown',
  ROUTE_ENDPOINT_UNRESOLVED: 'route-endpoint-unresolved',
  DUPLICATE_ROUTE: 'duplicate-route',
  EXTERNPROTO_INTERFACE_IS_SUBSET: 'externproto-interface-is-subset',

  // recovery / provability
  DOCUMENT_PARSE_INCOMPLETE: 'document-parse-incomplete',
  SCOPE_RECOVERED: 'scope-recovered',
  PROTO_SCOPE_NOT_PROVABLE: 'proto-scope-not-provable',
  PROTO_BODY_NOT_PROVABLE: 'proto-body-not-provable',
});

// Behaviour that real Cybertown/Blaxxun content relies on and strict VRML97 does
// not permit. Classified, never silently normalised into the language rules.
const COMPAT = Object.freeze({
  PROTO_IN_MFNODE_ARRAY: 'compat/proto-statement-inside-mfnode-array',
  ROUTE_IN_MFNODE_ARRAY: 'compat/route-statement-inside-mfnode-array',
  INTERFACE_DECL_OUTSIDE_SCRIPT: 'compat/interface-declaration-outside-script',
  SCRIPT_EXPOSED_FIELD: 'compat/exposed-field-in-script-node',
  HYPHEN_IDENTIFIER: 'compat/hyphen-or-plus-in-identifier',
  DELIMITER_IN_IDENTIFIER: 'compat/unusual-character-in-identifier',
  // The dominant real-world IS shape in the Cybertown corpus: a PROTO whose
  // interface declares EVERYTHING as `exposedField`, then binds an `eventIn`,
  // `eventOut` or `field` of a definition node to it. ISO/IEC 14772-1 4.8.3 is
  // explicit that "an exposedField in the prototype interface may be associated
  // only with an exposedField in the prototype definition", so this is
  // non-conforming -- but it is also harmless in practice (an exposedField
  // supplies both an eventIn and an eventOut), and the entire Cybertown avatar
  // system is built on it. Classified, never silently normalised into the rule.
  EVENT_BOUND_TO_EXPOSED_FIELD_DECLARATION: 'compat/event-bound-to-exposedfield-declaration',
});

// ISO/IEC 14772-1 Table 4.4 -- rows are the access type of the member in the
// PROTO *definition* (the node inside the body), columns are the access type of
// the member in the PROTO *declaration* (the interface). `true` == legal.
const IS_ACCESS_MATRIX = Object.freeze({
  exposedField: Object.freeze({ exposedField: true, field: true, eventIn: true, eventOut: true }),
  field: Object.freeze({ exposedField: false, field: true, eventIn: false, eventOut: false }),
  eventIn: Object.freeze({ exposedField: false, field: false, eventIn: true, eventOut: false }),
  eventOut: Object.freeze({ exposedField: false, field: false, eventIn: false, eventOut: true }),
});

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function offsetOf(range) {
  return range && range.start ? range.start.offset : -1;
}
function endOffsetOf(range) {
  return range && range.end ? range.end.offset : -1;
}
function byCodepoint(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
// Deterministic ordering for every emitted list: source position first, then a
// stable tiebreak so two constructs at the same offset never swap between runs.
function byPosition(a, b) {
  const ao = a.sortOffset;
  const bo = b.sortOffset;
  if (ao !== bo) return ao - bo;
  const ak = `${a.sortKind}|${a.sortName}`;
  const bk = `${b.sortKind}|${b.sortName}`;
  return byCodepoint(ak, bk);
}
function contains(outer, inner) {
  if (!outer || !inner) return false;
  return offsetOf(outer) <= offsetOf(inner) && endOffsetOf(inner) <= endOffsetOf(outer);
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

class Builder {
  constructor(parseResult, options) {
    this.parse = parseResult;
    this.options = options || {};
    this.scopes = [];
    this.symbols = [];
    this.references = [];
    this.notes = []; // structural observations that are not reference resolutions
    this.nextScope = 0;
    this.nextSymbol = 0;
    this.nextRef = 0;
    // Hard parse caps make the whole tree unprovable, not just one region.
    this.documentIncomplete = !!(parseResult && (parseResult.truncated || parseResult.depthCapped));
    this.syntaxDiagnostics = (parseResult && parseResult.syntaxDiagnostics) || [];
  }

  addScope(kind, ownerRange, extra) {
    const scope = {
      id: `s${this.nextScope}`,
      index: this.nextScope,
      kind,
      // Node-name (DEF/USE) lookup parent. `null` on a PROTO body: ISO/IEC
      // 14772-1 4.8.4 makes a PROTO's DEF/USE scope SEPARATE from the rest of
      // the scene, in both directions. This is disjointness, not shadowing.
      defParent: null,
      // Node-type (PROTO/EXTERNPROTO) lookup parent. A nested PROTO declaration
      // is local to its enclosing prototype (4.8.4), so type lookup DOES walk
      // outward. Grade: normative-derived.
      typeParent: null,
      ownerRange: ownerRange || null,
      ownerName: (extra && extra.ownerName) || null,
      ownerNodeType: (extra && extra.ownerNodeType) || null,
      // A scope whose extent the parse cannot vouch for. Absence proves nothing
      // inside one of these.
      recovered: false,
      recoveredReason: null,
      defs: new Map(), // name -> symbol[]
      types: new Map(), // name -> symbol[]
      members: new Map(), // name -> symbol[]   (interface scopes only)
      aliases: new Map(), // derived set_x / x_changed -> exposedField symbol
    };
    this.nextScope += 1;
    this.scopes.push(scope);
    return scope;
  }

  addSymbol(kind, namespace, name, declRange, scope, extra) {
    const sym = {
      id: `y${this.nextSymbol}`,
      kind,
      namespace,
      name,
      declRange: declRange || null,
      scopeId: scope.id,
      // The offset from which the symbol becomes visible to a reference.
      // For a DEF that is the name token (4.6.2 "preceding it"); for a PROTO it
      // is the END of the declaration (4.8.4 "after the completion of the
      // prototype definition").
      visibleFrom: (extra && extra.visibleFrom != null) ? extra.visibleFrom : offsetOf(declRange),
      node: (extra && extra.node) || null,
      access: (extra && extra.access) || null,
      fieldType: (extra && extra.fieldType) || null,
      interfaceScopeId: (extra && extra.interfaceScopeId) || null,
      bodyScopeId: (extra && extra.bodyScopeId) || null,
      typeScopeId: (extra && extra.typeScopeId) || null,
      ownerNode: (extra && extra.ownerNode) || null,
      sortOffset: offsetOf(declRange),
      sortKind: kind,
      sortName: name == null ? '' : String(name),
    };
    this.nextSymbol += 1;
    this.symbols.push(sym);

    const table = namespace === NAMESPACE.NODE_NAME ? scope.defs
      : namespace === NAMESPACE.NODE_TYPE ? scope.types
        : scope.members;
    if (name != null) {
      if (!table.has(name)) table.set(name, []);
      table.get(name).push(sym);
    }
    return sym;
  }

  addReference(kind, name, range, scope, extra) {
    const ref = {
      id: `r${this.nextRef}`,
      kind,
      name,
      range: range || null,
      scopeId: scope.id,
      offset: offsetOf(range),
      sortOffset: offsetOf(range),
      sortKind: kind,
      sortName: name == null ? '' : String(name),
      ...(extra || {}),
    };
    this.nextRef += 1;
    this.references.push(ref);
    return ref;
  }

  note(code, message, range, extra) {
    this.notes.push({
      code,
      message,
      range: range || null,
      sortOffset: offsetOf(range),
      sortKind: code,
      sortName: (extra && extra.name) || '',
      ...(extra || {}),
    });
  }

  // A scope is recovered when the document was truncated/depth-capped, when the
  // construct is structurally unusable (unnamed PROTO, PROTO with no body
  // statement), or when a syntax error lands inside it.
  //
  // Each error diagnostic is attributed to the INNERMOST scope containing it,
  // not to every enclosing one. Without that, a single stray error anywhere in a
  // file would mark the document scope recovered and suppress every honest
  // "not declared" answer in the whole document. Where several scopes share the
  // same owning construct (a PROTO's interface and body both span the PROTO
  // statement) all of them are marked -- the construct is damaged as a unit.
  markRecovery() {
    if (this.documentIncomplete) {
      for (const scope of this.scopes) {
        scope.recovered = true;
        scope.recoveredReason = REASON.DOCUMENT_PARSE_INCOMPLETE;
      }
      return;
    }
    for (const d of this.syntaxDiagnostics) {
      if (d.severity !== 'error' || !d.range) continue;
      let best = null;
      for (const scope of this.scopes) {
        if (!scope.ownerRange || !contains(scope.ownerRange, d.range)) continue;
        const span = endOffsetOf(scope.ownerRange) - offsetOf(scope.ownerRange);
        if (best === null || span < best) best = span;
      }
      if (best === null) continue;
      for (const scope of this.scopes) {
        if (!scope.ownerRange || !contains(scope.ownerRange, d.range)) continue;
        if (endOffsetOf(scope.ownerRange) - offsetOf(scope.ownerRange) !== best) continue;
        if (scope.recovered) continue;
        scope.recovered = true;
        scope.recoveredReason = REASON.SCOPE_RECOVERED;
      }
    }
  }
}

// --- traversal ------------------------------------------------------------

// `ctx` carries exactly the containment facts a scope decision needs. It is
// rebuilt (never mutated) on descent, so a sibling can never see a cousin's
// context.
function childCtx(ctx, patch) {
  return { ...ctx, ...patch };
}

function declareInterfaceMembers(b, decls, scope, kind, ownerNode) {
  for (const decl of decls || []) {
    if (!decl || decl.type !== NODE.INTERFACE) continue;
    const sym = b.addSymbol(kind, NAMESPACE.INTERFACE_MEMBER, decl.name, decl.nameRange || decl.range, scope, {
      access: decl.access,
      fieldType: decl.fieldType,
      node: decl,
      ownerNode: ownerNode || null,
    });
    // 4.8.2: `exposedField zzz` is equivalent to a field `zzz`, an eventIn
    // `set_zzz` and an eventOut `zzz_changed`. Those aliases are part of the
    // namespace even though they are not written down.
    if (decl.access === 'exposedField' && decl.name) {
      scope.aliases.set(`set_${decl.name}`, { symbol: sym, role: 'eventIn' });
      scope.aliases.set(`${decl.name}_changed`, { symbol: sym, role: 'eventOut' });
    }
  }
}

function visitStatements(b, statements, ctx) {
  for (const stmt of statements || []) visitStatement(b, stmt, ctx);
}

function visitStatement(b, stmt, ctx) {
  if (!stmt || typeof stmt.type !== 'string') return;
  switch (stmt.type) {
    case NODE.NODE: return visitNode(b, stmt, ctx);
    case NODE.USE: return visitUse(b, stmt, ctx);
    case NODE.ROUTE: return visitRoute(b, stmt, ctx);
    case NODE.PROTO: return visitProto(b, stmt, ctx);
    case NODE.EXTERNPROTO: return visitExternProto(b, stmt, ctx);
    default: return undefined;
  }
}

function visitProto(b, proto, ctx) {
  const scope = ctx.scope;
  // The declaration name lives in the ENCLOSING type namespace and becomes
  // visible only after the whole declaration (4.8.4).
  const declSym = b.addSymbol(SYMBOL_KIND.PROTO_DECL, NAMESPACE.NODE_TYPE, proto.name,
    proto.nameRange || proto.range, scope, {
      visibleFrom: endOffsetOf(proto.range),
      node: proto,
    });

  const ifaceScope = b.addScope(SCOPE_KIND.PROTO_INTERFACE, proto.range, { ownerName: proto.name });
  declareInterfaceMembers(b, proto.interfaces, ifaceScope, SYMBOL_KIND.PROTO_INTERFACE_MEMBER, proto);

  const bodyScope = b.addScope(SCOPE_KIND.PROTO_BODY, proto.range, { ownerName: proto.name });
  bodyScope.defParent = null; // 4.8.4: disjoint, in BOTH directions.
  bodyScope.typeParent = scope.id;

  declSym.interfaceScopeId = ifaceScope.id;
  declSym.bodyScopeId = bodyScope.id;

  // Fail closed where the parse cannot prove the construct.
  if (proto.name == null) {
    bodyScope.recovered = true;
    bodyScope.recoveredReason = REASON.PROTO_SCOPE_NOT_PROVABLE;
    ifaceScope.recovered = true;
    ifaceScope.recoveredReason = REASON.PROTO_SCOPE_NOT_PROVABLE;
    b.note(REASON.PROTO_SCOPE_NOT_PROVABLE, 'PROTO declaration has no provable name', proto.range);
  }
  // Annex A: `protoBody ::= protoStatements rootNodeStatement statements` -- a
  // conforming PROTO body contains at least one node statement. An empty body is
  // therefore either a truncated parse or invalid source; either way the body
  // scope cannot be trusted to be complete.
  if (!proto.body || proto.body.length === 0) {
    bodyScope.recovered = true;
    bodyScope.recoveredReason = REASON.PROTO_BODY_NOT_PROVABLE;
    b.note(REASON.PROTO_BODY_NOT_PROVABLE, 'PROTO body contains no node statement', proto.range,
      { name: proto.name || '' });
  }

  checkInterfaceUniqueness(b, proto.interfaces, ifaceScope, proto, false);

  visitStatements(b, proto.body, childCtx(ctx, {
    scope: bodyScope,
    protoStack: ctx.protoStack.concat([{ decl: declSym, interfaceScopeId: ifaceScope.id, bodyScopeId: bodyScope.id }]),
    containerNode: null,
    containerField: null,
  }));
}

function visitExternProto(b, ext, ctx) {
  const scope = ctx.scope;
  const declSym = b.addSymbol(SYMBOL_KIND.EXTERNPROTO_DECL, NAMESPACE.NODE_TYPE, ext.name,
    ext.nameRange || ext.range, scope, {
      visibleFrom: endOffsetOf(ext.range),
      node: ext,
    });
  const ifaceScope = b.addScope(SCOPE_KIND.EXTERNPROTO_INTERFACE, ext.range, { ownerName: ext.name });
  declareInterfaceMembers(b, ext.interfaces, ifaceScope, SYMBOL_KIND.PROTO_INTERFACE_MEMBER, ext);
  declSym.interfaceScopeId = ifaceScope.id;
  if (ext.name == null) {
    ifaceScope.recovered = true;
    ifaceScope.recoveredReason = REASON.PROTO_SCOPE_NOT_PROVABLE;
  }
  checkInterfaceUniqueness(b, ext.interfaces, ifaceScope, ext, true);
}

// 4.3.5: interface member names shall be unique within one PROTO statement, and
// an exposedField `zzz` forbids `set_zzz` / `zzz_changed` in the same interface.
function checkInterfaceUniqueness(b, decls, ifaceScope, owner, isExtern) {
  const seen = new Map();
  const exposed = new Set();
  for (const decl of decls || []) {
    if (!decl || decl.name == null) continue;
    if (seen.has(decl.name)) {
      b.note(REASON.DUPLICATE_INTERFACE_MEMBER,
        `Interface member '${decl.name}' declared more than once`, decl.nameRange || decl.range,
        { name: decl.name, scopeId: ifaceScope.id, extern: !!isExtern });
    } else {
      seen.set(decl.name, decl);
    }
    if (decl.access === 'exposedField') exposed.add(decl.name);
  }
  for (const name of [...exposed].sort(byCodepoint)) {
    for (const alias of [`set_${name}`, `${name}_changed`]) {
      if (seen.has(alias)) {
        b.note(REASON.EXPOSED_FIELD_ALIAS_COLLISION,
          `'${alias}' collides with the implicit event of exposedField '${name}'`,
          (seen.get(alias).nameRange || seen.get(alias).range),
          { name: alias, scopeId: ifaceScope.id });
      }
    }
  }
  void owner;
}

function visitUse(b, use, ctx) {
  b.addReference(REFERENCE_KIND.USE, use.name, use.nameRange || use.range, ctx.scope, {
    containerField: ctx.containerField,
    // 4.4.4: only the TRANSFORMATION HIERARCHY must be acyclic, and "a
    // descendant of a Script node is not part of the transformation hierarchy".
    // A USE under a Script therefore cannot be proven to close a forbidden
    // cycle, so the self-reference rule must not fire on it.
    insideScript: !!ctx.insideScript,
    node: use,
  });
}

function visitRoute(b, route, ctx) {
  const from = route.from || {};
  const to = route.to || {};
  const nodeFrom = b.addReference(REFERENCE_KIND.ROUTE_NODE, from.node, from.nodeRange || route.range, ctx.scope, {
    role: 'source', routeRange: route.range, node: route,
  });
  const nodeTo = b.addReference(REFERENCE_KIND.ROUTE_NODE, to.node, to.nodeRange || route.range, ctx.scope, {
    role: 'destination', routeRange: route.range, node: route,
  });
  b.addReference(REFERENCE_KIND.ROUTE_EVENT, from.event, from.eventRange || route.range, ctx.scope, {
    role: 'source', endpointRefId: nodeFrom.id, routeRange: route.range, node: route,
  });
  b.addReference(REFERENCE_KIND.ROUTE_EVENT, to.event, to.eventRange || route.range, ctx.scope, {
    role: 'destination', endpointRefId: nodeTo.id, routeRange: route.range, node: route,
  });
}

function visitNode(b, node, ctx) {
  const scope = ctx.scope;

  if (node.def != null) {
    b.addSymbol(SYMBOL_KIND.NODE_DEF, NAMESPACE.NODE_NAME, node.def, node.defRange || node.range, scope, {
      node,
      typeScopeId: scope.id,
      visibleFrom: offsetOf(node.defRange || node.range),
    });
  }

  b.addReference(REFERENCE_KIND.NODE_TYPE, node.nodeType, node.typeRange || node.range, scope, {
    node,
    containerField: ctx.containerField,
  });

  // A Script node owns its own interface namespace (6.40 / Annex A
  // `scriptBodyElement`). Any OTHER node carrying interface declarations is
  // outside strict VRML97 -- recorded as compatibility, not promoted to a rule.
  let interfaceScope = null;
  if (node.interfaces && node.interfaces.length > 0) {
    const isScript = node.nodeType === 'Script';
    interfaceScope = b.addScope(SCOPE_KIND.SCRIPT_INTERFACE, node.range, {
      ownerName: node.def || null, ownerNodeType: node.nodeType,
    });
    declareInterfaceMembers(b, node.interfaces, interfaceScope, SYMBOL_KIND.SCRIPT_INTERFACE_MEMBER, node);
    checkInterfaceUniqueness(b, node.interfaces, interfaceScope, node, false);
    if (!isScript) {
      b.note(REASON.INTERFACE_DECL_OUTSIDE_SCRIPT,
        `Interface declarations inside a non-Script '${node.nodeType}' body`, node.range,
        { compat: COMPAT.INTERFACE_DECL_OUTSIDE_SCRIPT, name: node.nodeType });
    }
    for (const decl of node.interfaces) {
      // 6.40: "With the exception of the url field, exposedFields are not
      // allowed in Script nodes."
      if (isScript && decl && decl.access === 'exposedField' && decl.name !== 'url') {
        b.note(REASON.SCRIPT_EXPOSED_FIELD,
          `exposedField '${decl.name}' is not allowed in a Script node`, decl.nameRange || decl.range,
          { compat: COMPAT.SCRIPT_EXPOSED_FIELD, name: decl.name || '' });
      }
    }
  }

  const inner = childCtx(ctx, {
    containerNode: node,
    scriptInterfaceScopeId: interfaceScope ? interfaceScope.id : null,
    insideScript: ctx.insideScript || node.nodeType === 'Script',
  });

  // Interface declarations may themselves carry an `IS` (Annex A: `eventIn type
  // name IS name`) and a default value that can contain nodes.
  for (const decl of node.interfaces || []) {
    if (!decl) continue;
    if (decl.is != null) {
      b.addReference(REFERENCE_KIND.IS, decl.is, decl.isRange || decl.range, scope, {
        node: decl,
        definitionOwner: node,
        definitionMemberName: decl.name,
        definitionAccess: decl.access,
        definitionFieldType: decl.fieldType,
        definitionInterfaceScopeId: interfaceScope ? interfaceScope.id : null,
        protoStack: ctx.protoStack,
        form: 'interface-decl',
      });
    }
    if (decl.default) visitValue(b, decl.default, childCtx(inner, { containerField: decl.name }));
  }

  const fieldsByName = new Map();
  for (const field of node.fields || []) {
    if (!field) continue;
    // 4.3.3 / 4.10.2: a node body may contain ROUTE, PROTO and EXTERNPROTO
    // statements as well as fields, and the parser collects all of them into
    // `node.fields` (only interface declarations get their own array). Treating
    // every entry as a field silently dropped 5,444 real ROUTEs in the corpus --
    // their endpoints then looked "unmatched" rather than resolved.
    if (field.type === NODE.ROUTE || field.type === NODE.PROTO || field.type === NODE.EXTERNPROTO) {
      visitStatement(b, field, inner);
      continue;
    }
    if (field.name != null) {
      if (!fieldsByName.has(field.name)) fieldsByName.set(field.name, []);
      fieldsByName.get(field.name).push(field);
    }
    if (field.isBinding && field.value && field.value.type === NODE.IS) {
      b.addReference(REFERENCE_KIND.IS, field.value.name, field.value.nameRange || field.range, scope, {
        node: field,
        definitionOwner: node,
        definitionMemberName: field.name,
        definitionAccess: null, // resolved from the node's own interface at resolve time
        definitionFieldType: null,
        definitionInterfaceScopeId: interfaceScope ? interfaceScope.id : null,
        protoStack: ctx.protoStack,
        form: 'node-body',
      });
      continue;
    }
    visitValue(b, field.value, childCtx(inner, { containerField: field.name }));
  }

  // 4.8.3: results are undefined if a field is both given an initial value and
  // associated by IS; 4.7: results are undefined for repeated field statements.
  for (const [name, list] of [...fieldsByName.entries()].sort((a, bb) => byCodepoint(a[0], bb[0]))) {
    if (list.length < 2) continue;
    const hasIs = list.some((f) => f.isBinding);
    const hasValue = list.some((f) => !f.isBinding);
    if (hasIs && hasValue) {
      b.note(REASON.IS_WITH_INITIAL_VALUE,
        `Field '${name}' has both an initial value and an IS binding`, list[1].range, { name });
    }
  }
}

function visitValue(b, value, ctx) {
  if (!value || typeof value.type !== 'string') return;
  switch (value.type) {
    case NODE.NODE: return visitNode(b, value, ctx);
    case NODE.USE: return visitUse(b, value, ctx);
    case NODE.ROUTE: {
      // Lenient parser path: a ROUTE inside an MFNode array.
      b.note(REASON.OK, 'ROUTE statement inside an MFNode array', value.range,
        { compat: COMPAT.ROUTE_IN_MFNODE_ARRAY });
      return visitRoute(b, value, ctx);
    }
    case NODE.PROTO: {
      b.note(REASON.OK, 'PROTO statement inside an MFNode array', value.range,
        { compat: COMPAT.PROTO_IN_MFNODE_ARRAY });
      return visitProto(b, value, ctx);
    }
    case NODE.EXTERNPROTO: {
      b.note(REASON.OK, 'EXTERNPROTO statement inside an MFNode array', value.range,
        { compat: COMPAT.PROTO_IN_MFNODE_ARRAY });
      return visitExternProto(b, value, ctx);
    }
    case NODE.ARRAY: {
      for (const item of value.items || []) visitValue(b, item, ctx);
      return undefined;
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function makeResolution(ref, status, reason, extra) {
  return Object.freeze({
    referenceId: ref.id,
    kind: ref.kind,
    name: ref.name == null ? null : ref.name,
    range: ref.range,
    scopeId: ref.scopeId,
    status,
    reason,
    // Never a symbol on a non-resolved status -- the WD1.4 rule, kept.
    symbolId: status === STATUS.RESOLVED && extra && extra.symbolId ? extra.symbolId : null,
    candidateCount: extra && extra.candidateCount != null ? extra.candidateCount : 0,
    // Source evidence for a diagnostics layer: the ranges that justify the call.
    evidence: Object.freeze((extra && extra.evidence) || []),
    detail: (extra && extra.detail) || null,
    compat: (extra && extra.compat) || null,
    sortOffset: ref.sortOffset,
    sortKind: ref.sortKind,
    sortName: ref.sortName,
  });
}

class ScopeGraph {
  constructor(builder) {
    this.scopes = builder.scopes;
    this.byId = new Map(this.scopes.map((s) => [s.id, s]));
    this.symbols = builder.symbols.slice().sort(byPosition);
    this.symbolsById = new Map(this.symbols.map((s) => [s.id, s]));
    this.references = builder.references.slice().sort(byPosition);
    this.notes = builder.notes.slice().sort(byPosition);
    this.documentIncomplete = builder.documentIncomplete;
    this.resolutions = [];
    this._resolutionByRef = new Map();
  }

  scope(id) {
    return this.byId.get(id) || null;
  }

  // Walk the node-name chain. A PROTO body has `defParent === null`, so this
  // terminates there -- that IS the 4.8.4 rule, expressed structurally.
  lookupDef(scopeId, name, beforeOffset) {
    const out = [];
    let cur = this.scope(scopeId);
    while (cur) {
      const list = cur.defs.get(name);
      if (list) for (const sym of list) if (sym.visibleFrom < beforeOffset) out.push(sym);
      cur = cur.defParent ? this.scope(cur.defParent) : null;
    }
    return out;
  }

  // Every DEF of `name` visible in the chain regardless of position -- used only
  // to distinguish "declared later" from "never declared".
  lookupDefAnyPosition(scopeId, name) {
    const out = [];
    let cur = this.scope(scopeId);
    while (cur) {
      const list = cur.defs.get(name);
      if (list) out.push(...list);
      cur = cur.defParent ? this.scope(cur.defParent) : null;
    }
    return out;
  }

  // Is `name` declared anywhere in the document's node-name space, but outside
  // the chain reachable from `scopeId`? Answers "you crossed a PROTO boundary".
  declaredOutsideChain(scopeId, name) {
    const inChain = new Set();
    let cur = this.scope(scopeId);
    while (cur) {
      inChain.add(cur.id);
      cur = cur.defParent ? this.scope(cur.defParent) : null;
    }
    return this.symbols.some((s) => s.kind === SYMBOL_KIND.NODE_DEF && s.name === name && !inChain.has(s.scopeId));
  }

  lookupType(scopeId, name, beforeOffset) {
    const out = [];
    let cur = this.scope(scopeId);
    while (cur) {
      const list = cur.types.get(name);
      if (list) for (const sym of list) if (beforeOffset == null || sym.visibleFrom <= beforeOffset) out.push(sym);
      cur = cur.typeParent ? this.scope(cur.typeParent) : null;
    }
    return out;
  }

  lookupTypeAnyPosition(scopeId, name) {
    return this.lookupType(scopeId, name, null);
  }

  scopeIsRecovered(scopeId) {
    const s = this.scope(scopeId);
    return !!(s && s.recovered);
  }

  resolutionFor(refId) {
    return this._resolutionByRef.get(refId) || null;
  }
}

// A POSITIVE lexical resolution inside a damaged scope is not trustworthy
// either, and an earlier revision of this model wrongly assumed it was.
//
// The reasoning that failed: "a partial tree can prove presence". It can prove a
// declaration EXISTS -- it cannot prove which SCOPE that declaration belongs to,
// and scope membership is the entire question a USE asks. Parser recovery moves
// scope boundaries: an unclosed PROTO swallows every following top-level
// statement into its body, so the absorbed scope sees a declaration set that
// never existed and, because a PROTO body has no `defParent`, is also blind to
// the real outer declarations.
//
// Demonstrated, not hypothesised:
//
//   DEF Foo Group { }              <- stays in document scope
//   PROTO P [ ] { Shape { }        <- brace never closed
//   DEF Foo Transform { }          <- absorbed into P's body
//   Group { children [ USE Foo ] } <- absorbed into P's body
//
// With the brace present this is `ambiguous` (two DEF Foo in document scope).
// With it missing, the absorbed body holds exactly ONE Foo and the old code
// returned `resolved` bound to the Transform -- a confidently wrong answer, the
// one outcome WD1.4's hard gate forbids.
//
// So a lexical resolution is downgraded whenever the scope it was decided in, or
// the scope holding the declaration it found, could not be proven. Schema facts
// (a built-in node type, a built-in field) are NOT lexical and are left alone.
function guardLexical(graph, ref, resolution, symbolId) {
  if (resolution.status !== STATUS.RESOLVED) return resolution;
  if (graph.documentIncomplete) {
    return makeResolution(ref, STATUS.RECOVERED, REASON.DOCUMENT_PARSE_INCOMPLETE);
  }
  if (graph.scopeIsRecovered(ref.scopeId)) {
    const s = graph.scope(ref.scopeId);
    return makeResolution(ref, STATUS.RECOVERED, s.recoveredReason || REASON.SCOPE_RECOVERED);
  }
  const sym = symbolId ? graph.symbolsById.get(symbolId) : null;
  if (sym && graph.scopeIsRecovered(sym.scopeId)) {
    const s = graph.scope(sym.scopeId);
    return makeResolution(ref, STATUS.RECOVERED, s.recoveredReason || REASON.SCOPE_RECOVERED);
  }
  return resolution;
}

// A negative finding inside a damaged scope is downgraded too: absence cannot be
// proven from a partial tree either.
function downgradeIfRecovered(graph, ref, status, reason, extra) {
  if (status !== STATUS.UNRESOLVED) return makeResolution(ref, status, reason, extra);
  if (graph.documentIncomplete) {
    return makeResolution(ref, STATUS.RECOVERED, REASON.DOCUMENT_PARSE_INCOMPLETE, extra);
  }
  if (graph.scopeIsRecovered(ref.scopeId)) {
    const s = graph.scope(ref.scopeId);
    return makeResolution(ref, STATUS.RECOVERED, s.recoveredReason || REASON.SCOPE_RECOVERED, extra);
  }
  return makeResolution(ref, status, reason, extra);
}

function resolveUse(graph, ref) {
  if (ref.name == null) return makeResolution(ref, STATUS.INVALID, REASON.MISSING_NAME);
  const candidates = graph.lookupDef(ref.scopeId, ref.name, ref.offset);
  if (candidates.length > 1) {
    return makeResolution(ref, STATUS.AMBIGUOUS, REASON.DUPLICATE_DEF_IN_SCOPE, {
      candidateCount: candidates.length,
      evidence: candidates.map((c) => c.declRange),
    });
  }
  if (candidates.length === 1) {
    const sym = candidates[0];
    // 4.4.4: "The transformation hierarchy shall be a directed acyclic graph;
    // results are undefined if a node in the transformation hierarchy is its own
    // ancestor." A USE inside the very node it names makes the node its own
    // ancestor -- but ONLY inside the transformation hierarchy. Script
    // descendants are explicitly outside it (4.4.4), and `DEF S Script { field
    // SFNode myself USE S }` is a standard idiom, so the rule must not fire
    // there. The corpus found 489 of them; firing on those would be a false
    // positive, which is the exact failure mode this lane exists to prevent.
    if (sym.node && contains(sym.node.range, ref.range)) {
      if (ref.insideScript) {
        return guardLexical(graph, ref, makeResolution(ref, STATUS.RESOLVED,
          REASON.SELF_REFERENCE_OUTSIDE_TRANSFORMATION_HIERARCHY, {
            symbolId: sym.id, candidateCount: 1, evidence: [sym.declRange],
          }), sym.id);
      }
      return makeResolution(ref, STATUS.INVALID, REASON.SELF_REFERENTIAL_USE, {
        evidence: [sym.declRange],
      });
    }
    return guardLexical(graph, ref, makeResolution(ref, STATUS.RESOLVED, REASON.OK, {
      symbolId: sym.id, candidateCount: 1, evidence: [sym.declRange],
    }), sym.id);
  }
  const later = graph.lookupDefAnyPosition(ref.scopeId, ref.name);
  if (later.length > 0) {
    return makeResolution(ref, STATUS.INVALID, REASON.USE_BEFORE_DEF, {
      candidateCount: later.length, evidence: later.map((c) => c.declRange),
    });
  }
  if (graph.declaredOutsideChain(ref.scopeId, ref.name)) {
    return downgradeIfRecovered(graph, ref, STATUS.UNRESOLVED,
      REASON.DEF_NOT_VISIBLE_ACROSS_PROTO_BOUNDARY, { candidateCount: 0 });
  }
  return downgradeIfRecovered(graph, ref, STATUS.UNRESOLVED, REASON.DEF_NOT_DECLARED_IN_SCOPE);
}

function resolveNodeType(graph, ref) {
  if (ref.name == null) return makeResolution(ref, STATUS.INVALID, REASON.MISSING_NAME);
  // A node type name is BOTH a schema lookup and, potentially, a lexical symbol.
  // They are different questions and are answered separately, never merged.
  const declaredHere = graph.lookupType(ref.scopeId, ref.name, ref.offset);
  const declaredAnywhere = graph.lookupTypeAnyPosition(ref.scopeId, ref.name);
  const builtin = nodeSchema.isVRML97Node(ref.name);

  // 4.8.4 states two separate rules: instantiate only after the definition
  // completes, and never inside the definition itself. An instance inside its
  // own body satisfies neither, and the recursion rule is the specific and
  // useful diagnosis -- so it is checked BEFORE the ordering rule, which would
  // otherwise always win (a declaration is never "complete" inside itself).
  const enclosing = declaredAnywhere.filter((sym) => sym.node && contains(sym.node.range, ref.range));
  if (enclosing.length > 0) {
    return makeResolution(ref, STATUS.INVALID, REASON.RECURSIVE_PROTO_INSTANCE, {
      evidence: enclosing.map((s) => s.declRange),
    });
  }

  if (declaredHere.length > 1) {
    return makeResolution(ref, STATUS.AMBIGUOUS, REASON.DUPLICATE_PROTO_DECLARATION, {
      candidateCount: declaredHere.length, evidence: declaredHere.map((c) => c.declRange),
    });
  }
  if (declaredHere.length === 1) {
    const sym = declaredHere[0];
    return guardLexical(graph, ref, makeResolution(ref, STATUS.RESOLVED, REASON.OK, {
      symbolId: sym.id, candidateCount: 1, evidence: [sym.declRange],
      detail: builtin ? REASON.PROTO_SHADOWS_BUILTIN : null,
    }), sym.id);
  }
  if (declaredAnywhere.length > 0) {
    return makeResolution(ref, STATUS.INVALID, REASON.PROTO_INSTANCE_BEFORE_DECLARATION, {
      candidateCount: declaredAnywhere.length, evidence: declaredAnywhere.map((c) => c.declRange),
    });
  }
  if (builtin) {
    return makeResolution(ref, STATUS.RESOLVED, REASON.NODE_TYPE_IS_BUILTIN, { candidateCount: 0 });
  }
  return downgradeIfRecovered(graph, ref, STATUS.UNRESOLVED, REASON.NODE_TYPE_UNKNOWN);
}

// What interface does this node instance expose? Returns a provider or null.
function interfaceProviderFor(graph, node, scopeId, offset) {
  if (!node) return null;
  if (node.nodeType === 'Script' || (node.interfaces && node.interfaces.length > 0)) {
    const own = graph.scopes.find((s) => s.kind === SCOPE_KIND.SCRIPT_INTERFACE && s.ownerRange === node.range);
    if (own) return { kind: 'declared', scope: own, subset: false };
  }
  const decls = graph.lookupType(scopeId, node.nodeType, offset);
  if (decls.length === 1 && decls[0].interfaceScopeId) {
    return {
      kind: 'declared',
      scope: graph.scope(decls[0].interfaceScopeId),
      subset: decls[0].kind === SYMBOL_KIND.EXTERNPROTO_DECL,
    };
  }
  if (decls.length > 1) return { kind: 'ambiguous' };
  if (nodeSchema.isVRML97Node(node.nodeType)) return { kind: 'schema', nodeType: node.nodeType, subset: false };
  return null;
}

// Look one member up in a declared interface, honouring the exposedField
// aliases and the 4.10.2 set_/_changed shorthand.
function lookupMember(scope, name) {
  if (!scope || name == null) return null;
  const direct = scope.members.get(name);
  if (direct && direct.length === 1) {
    return { access: direct[0].access, fieldType: direct[0].fieldType, symbol: direct[0], via: 'direct' };
  }
  if (direct && direct.length > 1) return { ambiguous: true, count: direct.length };
  const alias = scope.aliases.get(name);
  if (alias) {
    return { access: alias.role, fieldType: alias.symbol.fieldType, symbol: alias.symbol, via: `alias:${alias.role}` };
  }
  // 4.10.2 shorthand in the other direction: routing to `zzz` may bind `set_zzz`.
  for (const [candidate, via] of [[`set_${name}`, 'shorthand:set_'], [`${name}_changed`, 'shorthand:_changed']]) {
    const list = scope.members.get(candidate);
    if (list && list.length === 1) {
      return { access: list[0].access, fieldType: list[0].fieldType, symbol: list[0], via };
    }
  }
  return null;
}

function lookupSchemaMember(nodeType, name) {
  const direct = nodeSchema.getFieldSchema(nodeType, name);
  if (direct) return { access: direct.vrml97Declaration, fieldType: direct.type, via: 'direct' };
  if (typeof name !== 'string') return null;
  if (name.startsWith('set_')) {
    const base = nodeSchema.getFieldSchema(nodeType, name.slice(4));
    if (base && base.vrml97Declaration === 'exposedField') {
      return { access: 'eventIn', fieldType: base.type, via: 'alias:eventIn' };
    }
  }
  if (name.endsWith('_changed')) {
    const base = nodeSchema.getFieldSchema(nodeType, name.slice(0, -8));
    if (base && base.vrml97Declaration === 'exposedField') {
      return { access: 'eventOut', fieldType: base.type, via: 'alias:eventOut' };
    }
  }
  for (const [candidate, via] of [[`set_${name}`, 'shorthand:set_'], [`${name}_changed`, 'shorthand:_changed']]) {
    const alt = nodeSchema.getFieldSchema(nodeType, candidate);
    if (alt) return { access: alt.vrml97Declaration, fieldType: alt.type, via };
  }
  return null;
}

function memberOfProvider(graph, provider, name) {
  if (!provider) return null;
  if (provider.kind === 'schema') return lookupSchemaMember(provider.nodeType, name);
  if (provider.kind === 'declared') return lookupMember(provider.scope, name);
  return null;
}

function resolveIs(graph, ref) {
  if (ref.name == null) return makeResolution(ref, STATUS.INVALID, REASON.MISSING_NAME);
  const stack = ref.protoStack || [];
  // 4.3.6 / 4.8.3: IS is only meaningful inside a prototype definition.
  if (stack.length === 0) {
    return makeResolution(ref, STATUS.INVALID, REASON.IS_OUTSIDE_PROTO_BODY);
  }
  // 4.8.4: a nested prototype's IS statements refer to the INNERMOST prototype's
  // declarations.
  const innermost = stack[stack.length - 1];
  const ifaceScope = graph.scope(innermost.interfaceScopeId);
  if (!ifaceScope) return makeResolution(ref, STATUS.UNSUPPORTED, REASON.PROTO_SCOPE_NOT_PROVABLE);
  if (ifaceScope.recovered) {
    return makeResolution(ref, STATUS.RECOVERED, ifaceScope.recoveredReason || REASON.SCOPE_RECOVERED);
  }

  const declared = ifaceScope.members.get(ref.name);
  if (declared && declared.length > 1) {
    return makeResolution(ref, STATUS.AMBIGUOUS, REASON.DUPLICATE_INTERFACE_MEMBER, {
      candidateCount: declared.length, evidence: declared.map((d) => d.declRange),
    });
  }
  const target = lookupMember(ifaceScope, ref.name);
  if (!target || target.ambiguous) {
    return downgradeIfRecovered(graph, ref, STATUS.UNRESOLVED, REASON.IS_MEMBER_NOT_DECLARED);
  }

  // Definition side: what access/type does the member have on the node inside
  // the PROTO body? For an interface-declaration form the parser already told
  // us; for the node-body form we must ask the node's own interface.
  let defAccess = ref.definitionAccess;
  let defType = ref.definitionFieldType;
  if (defAccess == null) {
    const provider = interfaceProviderFor(graph, ref.definitionOwner, ref.scopeId, ref.offset);
    const member = memberOfProvider(graph, provider, ref.definitionMemberName);
    if (!member || member.ambiguous) {
      return makeResolution(ref, STATUS.UNSUPPORTED, REASON.IS_DEFINITION_SIDE_UNKNOWN, {
        evidence: [target.symbol ? target.symbol.declRange : null].filter(Boolean),
        detail: ref.definitionMemberName || null,
      });
    }
    defAccess = member.access;
    defType = member.fieldType;
  }

  const evidence = [target.symbol ? target.symbol.declRange : null].filter(Boolean);
  if (defType && target.fieldType && defType !== target.fieldType) {
    return makeResolution(ref, STATUS.INVALID, REASON.IS_TYPE_MISMATCH, {
      evidence, detail: `${defType} IS ${target.fieldType}`,
    });
  }
  const row = IS_ACCESS_MATRIX[defAccess];
  const column = target.via.startsWith('alias:') ? target.via.slice(6) : target.access;
  if (row && column && row[column] === false) {
    return makeResolution(ref, STATUS.INVALID, REASON.IS_ACCESS_MISMATCH, {
      evidence,
      detail: `${defAccess} IS ${column}`,
      // Strict status stays `invalid`; the compat tag is what lets a
      // compatibility profile downgrade it without the core rule changing.
      compat: column === 'exposedField' ? COMPAT.EVENT_BOUND_TO_EXPOSED_FIELD_DECLARATION : null,
    });
  }
  if (!row) {
    return makeResolution(ref, STATUS.UNSUPPORTED, REASON.IS_DEFINITION_SIDE_UNKNOWN, { evidence });
  }
  return guardLexical(graph, ref, makeResolution(ref, STATUS.RESOLVED, REASON.OK, {
    symbolId: target.symbol ? target.symbol.id : null, candidateCount: 1, evidence,
  }), target.symbol ? target.symbol.id : null);
}

function resolveRouteNode(graph, ref) {
  if (ref.name == null) return makeResolution(ref, STATUS.INVALID, REASON.MISSING_NAME);
  // 4.10.2: "Nodes referenced in a ROUTE statement shall be defined before the
  // ROUTE statement." The boundary is the ROUTE statement, not the name token.
  const before = offsetOf(ref.routeRange);
  const candidates = graph.lookupDef(ref.scopeId, ref.name, before);
  if (candidates.length > 1) {
    return makeResolution(ref, STATUS.AMBIGUOUS, REASON.DUPLICATE_DEF_IN_SCOPE, {
      candidateCount: candidates.length, evidence: candidates.map((c) => c.declRange),
    });
  }
  if (candidates.length === 1) {
    return guardLexical(graph, ref, makeResolution(ref, STATUS.RESOLVED, REASON.OK, {
      symbolId: candidates[0].id, candidateCount: 1, evidence: [candidates[0].declRange],
    }), candidates[0].id);
  }
  const anyPos = graph.lookupDefAnyPosition(ref.scopeId, ref.name);
  if (anyPos.length > 0) {
    return makeResolution(ref, STATUS.INVALID, REASON.ROUTE_ENDPOINT_FORWARD_REFERENCE, {
      candidateCount: anyPos.length, evidence: anyPos.map((c) => c.declRange),
    });
  }
  if (graph.declaredOutsideChain(ref.scopeId, ref.name)) {
    return downgradeIfRecovered(graph, ref, STATUS.UNRESOLVED,
      REASON.DEF_NOT_VISIBLE_ACROSS_PROTO_BOUNDARY);
  }
  return downgradeIfRecovered(graph, ref, STATUS.UNRESOLVED, REASON.DEF_NOT_DECLARED_IN_SCOPE);
}

function resolveRouteEvent(graph, ref) {
  if (ref.name == null) return makeResolution(ref, STATUS.INVALID, REASON.MISSING_NAME);
  const endpoint = graph.resolutionFor(ref.endpointRefId);
  if (!endpoint || endpoint.status !== STATUS.RESOLVED) {
    return makeResolution(ref, STATUS.UNSUPPORTED, REASON.ROUTE_ENDPOINT_UNRESOLVED, {
      detail: endpoint ? endpoint.reason : null,
    });
  }
  const sym = graph.symbolsById.get(endpoint.symbolId);
  const provider = interfaceProviderFor(graph, sym && sym.node, sym ? sym.scopeId : ref.scopeId, ref.offset);
  if (!provider || provider.kind === 'ambiguous') {
    return makeResolution(ref, STATUS.UNSUPPORTED, REASON.ROUTE_ENDPOINT_INTERFACE_UNKNOWN, {
      detail: sym && sym.node ? sym.node.nodeType : null,
    });
  }
  const member = memberOfProvider(graph, provider, ref.name);
  if (!member || member.ambiguous) {
    // 4.9.2: an EXTERNPROTO interface is declared as a SUBSET of the real one,
    // so a name missing from it is unprovable, not wrong.
    if (provider.subset) {
      return makeResolution(ref, STATUS.UNSUPPORTED, REASON.EXTERNPROTO_INTERFACE_IS_SUBSET);
    }
    return downgradeIfRecovered(graph, ref, STATUS.UNRESOLVED, REASON.ROUTE_EVENT_NOT_DECLARED, {
      detail: sym && sym.node ? sym.node.nodeType : null,
    });
  }

  // 4.10.2: routes go from an eventOut to an eventIn only.
  const effective = member.via.startsWith('alias:') ? member.via.slice(6)
    : member.via.startsWith('shorthand:') ? member.access : member.access;
  const wantsOut = ref.role === 'source';
  const ok = effective === 'exposedField'
    || (wantsOut ? effective === 'eventOut' : effective === 'eventIn');
  if (!ok) {
    return makeResolution(ref, STATUS.INVALID, REASON.ROUTE_EVENT_DIRECTION_INVALID, {
      detail: `${ref.role}:${effective}`,
    });
  }
  const resolved = makeResolution(ref, STATUS.RESOLVED, REASON.OK, {
    symbolId: member.symbol ? member.symbol.id : null,
    candidateCount: 1,
    detail: member.fieldType || null,
  });
  // A schema hit is a clause-6 fact about a built-in node and does not depend on
  // any scope, so it is not guarded. A declared interface IS scope evidence.
  if (provider.kind !== 'declared') return resolved;
  return guardLexical(graph, ref, resolved, member.symbol ? member.symbol.id : null);
}

// ROUTE type agreement is a property of the PAIR, so it is checked after both
// endpoints have resolved rather than inside either one.
function checkRouteTypes(graph) {
  const out = [];
  const events = graph.references.filter((r) => r.kind === REFERENCE_KIND.ROUTE_EVENT);
  const byRoute = new Map();
  for (const ref of events) {
    const key = `${offsetOf(ref.routeRange)}`;
    if (!byRoute.has(key)) byRoute.set(key, {});
    byRoute.get(key)[ref.role] = ref;
  }
  for (const key of [...byRoute.keys()].sort((a, b) => Number(a) - Number(b))) {
    const pair = byRoute.get(key);
    if (!pair.source || !pair.destination) continue;
    const rs = graph.resolutionFor(pair.source.id);
    const rd = graph.resolutionFor(pair.destination.id);
    if (!rs || !rd || rs.status !== STATUS.RESOLVED || rd.status !== STATUS.RESOLVED) continue;
    if (rs.detail && rd.detail && rs.detail !== rd.detail) {
      out.push({
        code: REASON.ROUTE_EVENT_TYPE_MISMATCH,
        message: `ROUTE type mismatch: ${rs.detail} -> ${rd.detail}`,
        range: pair.source.routeRange,
        sortOffset: offsetOf(pair.source.routeRange),
        sortKind: REASON.ROUTE_EVENT_TYPE_MISMATCH,
        sortName: `${rs.detail}->${rd.detail}`,
      });
    }
  }
  return out;
}

// 4.10.2: "Redundant routing is ignored" -- a repeat is not an error, but it is
// worth surfacing. Duplicate identity is per DEF-scope, not per document.
function checkDuplicateRoutes(graph) {
  const out = [];
  const seen = new Set();
  // Indexed rather than searched: a naive `find` inside this loop is quadratic
  // in the number of ROUTEs, and real worlds carry thousands.
  const refById = new Map(graph.references.map((r) => [r.id, r]));
  const destByRoute = new Map();
  for (const r of graph.references) {
    if (r.kind === REFERENCE_KIND.ROUTE_EVENT && r.role === 'destination') {
      destByRoute.set(offsetOf(r.routeRange), r);
    }
  }
  const events = graph.references.filter((r) => r.kind === REFERENCE_KIND.ROUTE_EVENT && r.role === 'source');
  for (const src of events) {
    const dst = destByRoute.get(offsetOf(src.routeRange));
    if (!dst) continue;
    const srcNode = refById.get(src.endpointRefId);
    const dstNode = refById.get(dst.endpointRefId);
    if (!srcNode || !dstNode || srcNode.name == null || dstNode.name == null) continue;
    const key = [src.scopeId, srcNode.name, src.name, dstNode.name, dst.name].join(' ');
    if (seen.has(key)) {
      out.push({
        code: REASON.DUPLICATE_ROUTE,
        message: `Duplicate ROUTE ${srcNode.name}.${src.name} TO ${dstNode.name}.${dst.name}`,
        range: src.routeRange,
        sortOffset: offsetOf(src.routeRange),
        sortKind: REASON.DUPLICATE_ROUTE,
        sortName: key,
      });
    } else {
      seen.add(key);
    }
  }
  return out;
}

// 4.8.1: node type names shall be unique in each VRML file; results are
// undefined if a prototype shares a name with a built-in or an earlier one in
// the same scope. Reported per declaring scope, never document-wide.
function checkTypeDeclarations(graph) {
  const out = [];
  for (const scope of graph.scopes) {
    for (const name of [...scope.types.keys()].sort(byCodepoint)) {
      const list = scope.types.get(name);
      if (list.length > 1) {
        for (const dup of list.slice(1)) {
          out.push({
            code: REASON.DUPLICATE_PROTO_DECLARATION,
            message: `Node type '${name}' declared more than once in this scope`,
            range: dup.declRange,
            sortOffset: offsetOf(dup.declRange),
            sortKind: REASON.DUPLICATE_PROTO_DECLARATION,
            sortName: name,
          });
        }
      }
      if (nodeSchema.isVRML97Node(name)) {
        out.push({
          code: REASON.PROTO_SHADOWS_BUILTIN,
          message: `Prototype '${name}' has the same name as a built-in node type`,
          range: list[0].declRange,
          sortOffset: offsetOf(list[0].declRange),
          sortKind: REASON.PROTO_SHADOWS_BUILTIN,
          sortName: name,
        });
      }
    }
  }
  return out;
}

// Duplicate DEF in ONE scope is legal VRML97 (4.6.2 defines the outcome), so it
// is an advisory about shadowing -- not an error, and never reported across a
// PROTO boundary.
function checkDuplicateDefs(graph) {
  const out = [];
  for (const scope of graph.scopes) {
    for (const name of [...scope.defs.keys()].sort(byCodepoint)) {
      const list = scope.defs.get(name);
      if (list.length < 2) continue;
      for (const dup of list.slice(1)) {
        out.push({
          code: REASON.DUPLICATE_DEF_IN_SCOPE,
          message: `DEF '${name}' shadows an earlier DEF in the same scope`,
          range: dup.declRange,
          sortOffset: offsetOf(dup.declRange),
          sortKind: REASON.DUPLICATE_DEF_IN_SCOPE,
          sortName: name,
        });
      }
    }
  }
  return out;
}

// IS bindings must be unique per (node, member) -- 4.8.3.
function checkDuplicateIsBindings(graph) {
  const out = [];
  const seen = new Map();
  for (const ref of graph.references) {
    if (ref.kind !== REFERENCE_KIND.IS) continue;
    if (!ref.definitionOwner || ref.definitionMemberName == null) continue;
    const key = `${offsetOf(ref.definitionOwner.range)} ${ref.definitionMemberName}`;
    if (seen.has(key)) {
      out.push({
        code: REASON.IS_DUPLICATE_BINDING,
        message: `'${ref.definitionMemberName}' has more than one IS binding on this node`,
        range: ref.range,
        sortOffset: offsetOf(ref.range),
        sortKind: REASON.IS_DUPLICATE_BINDING,
        sortName: ref.definitionMemberName,
      });
    } else {
      seen.set(key, ref);
    }
  }
  return out;
}

/**
 * Build a read-only scope graph over a production parse result.
 *
 * @param {object} parseResult From `require('src/vrml').parse(text)`.
 * @returns {ScopeGraph} Deterministically ordered; never mutates the input.
 */
function buildScopeGraph(parseResult, options = {}) {
  const b = new Builder(parseResult, options);
  const documentScope = b.addScope(SCOPE_KIND.DOCUMENT,
    parseResult && parseResult.tree ? parseResult.tree.range : null, { ownerName: null });
  const ctx = {
    scope: documentScope,
    protoStack: [],
    containerNode: null,
    containerField: null,
    scriptInterfaceScopeId: null,
    insideScript: false,
  };
  if (parseResult && parseResult.tree) visitStatements(b, parseResult.tree.statements, ctx);
  b.markRecovery();

  const graph = new ScopeGraph(b);

  // Resolution order matters exactly once: a ROUTE event depends on its own
  // endpoint's resolution, so endpoints are resolved first.
  const ordered = graph.references.slice().sort((x, y) => {
    const rank = (r) => (r.kind === REFERENCE_KIND.ROUTE_EVENT ? 1 : 0);
    if (rank(x) !== rank(y)) return rank(x) - rank(y);
    return byPosition(x, y);
  });
  for (const ref of ordered) {
    let res;
    switch (ref.kind) {
      case REFERENCE_KIND.USE: res = resolveUse(graph, ref); break;
      case REFERENCE_KIND.NODE_TYPE: res = resolveNodeType(graph, ref); break;
      case REFERENCE_KIND.IS: res = resolveIs(graph, ref); break;
      case REFERENCE_KIND.ROUTE_NODE: res = resolveRouteNode(graph, ref); break;
      case REFERENCE_KIND.ROUTE_EVENT: res = resolveRouteEvent(graph, ref); break;
      default: res = makeResolution(ref, STATUS.UNSUPPORTED, REASON.OK); break;
    }
    graph._resolutionByRef.set(ref.id, res);
  }
  graph.resolutions = graph.references
    .map((r) => graph._resolutionByRef.get(r.id))
    .filter(Boolean)
    .sort(byPosition);

  graph.findings = []
    .concat(graph.notes)
    .concat(checkDuplicateDefs(graph))
    .concat(checkTypeDeclarations(graph))
    .concat(checkDuplicateIsBindings(graph))
    .concat(checkDuplicateRoutes(graph))
    .concat(checkRouteTypes(graph))
    .sort(byPosition);

  return graph;
}

/**
 * Every reference that resolves to one declaration. The building block a rename
 * or a "find all references" feature would use.
 */
function referencesTo(graph, symbolId) {
  return graph.resolutions
    .filter((r) => r.status === STATUS.RESOLVED && r.symbolId === symbolId)
    .slice()
    .sort(byPosition);
}

/**
 * The scope-aware answer to "is this DEF name uniquely mine?" -- the query
 * WD1.4 Tier 2 approximates from PROTO nesting alone.
 */
function defIsUniqueInScope(graph, symbolId) {
  const sym = graph.symbolsById.get(symbolId);
  if (!sym || sym.kind !== SYMBOL_KIND.NODE_DEF) return { unique: false, reason: REASON.MISSING_NAME };
  if (graph.documentIncomplete) return { unique: false, reason: REASON.DOCUMENT_PARSE_INCOMPLETE };
  const scope = graph.scope(sym.scopeId);
  if (!scope) return { unique: false, reason: REASON.PROTO_SCOPE_NOT_PROVABLE };
  if (scope.recovered) return { unique: false, reason: scope.recoveredReason || REASON.SCOPE_RECOVERED };
  const list = scope.defs.get(sym.name) || [];
  return list.length === 1
    ? { unique: true, reason: REASON.OK }
    : { unique: false, reason: REASON.DUPLICATE_DEF_IN_SCOPE };
}

module.exports = {
  SCOPE_KIND,
  NAMESPACE,
  SYMBOL_KIND,
  REFERENCE_KIND,
  STATUS,
  REASON,
  COMPAT,
  IS_ACCESS_MATRIX,
  buildScopeGraph,
  referencesTo,
  defIsUniqueInScope,
  byCodepoint,
};
