'use strict';
// VRML97 lexical symbol taxonomy and immutable projections (Phase WD1.5-P1).
//
// PURE and browser-safe: no `require` at all. No fs, no Electron, no crypto, no
// CodeMirror, no parser, no schema. It defines the vocabulary and the frozen
// shapes that `src/vrml/scope-graph.js` hands out, and nothing else.
//
// ---------------------------------------------------------------------------
// WHAT A SCOPE GRAPH IS, AND IS NOT
// ---------------------------------------------------------------------------
//
// The exact source-text buffer remains the canonical document (WD.md §2). A
// scope graph is a DERIVED, DISPOSABLE projection over one parse -- like tokens,
// the AST, the source map and the semantic index. Nothing here is written into a
// document, persisted, given an identity that survives a reparse, or maintained
// incrementally. Rebuild it from each parse; that is measured as affordable and
// is the accepted design (WD1_5_SCOPE_SEMANTICS_PLAN.md §11).
//
// ---------------------------------------------------------------------------
// THREE NAMESPACES, NOT ONE
// ---------------------------------------------------------------------------
//
// ISO/IEC 14772-1 has three distinct lexical name spaces, and conflating any two
// of them is the single most common way to get VRML97 scope wrong (see
// spikes/wd1-scope-semantics/standards-model.md §1). They are named here rather
// than implied. WD1.5-P1 populated the first, P2A the second and P2B the third,
// each in SEPARATE tables and SEPARATE lookup maps -- a `DEF Ball`, a
// `PROTO Ball` and a `field SFBool Ball` are three unrelated declarations that
// happen to share a spelling, and none is a duplicate of another:
//
//   node name        -- DEF names; USE and ROUTE endpoints look here.
//   node type        -- PROTO / EXTERNPROTO declaration names.
//   interface member -- PROTO/EXTERNPROTO/Script field/eventIn/eventOut/
//                       exposedField declarations; `IS` looks here.
//
// Built-in node type names and built-in field names are NOT lexical symbols at
// all: they are clause-6 schema lookups (WD1.3, `src/vrml/node-schema.js`).
// `Transform` is declared nowhere in a file, so asking a scope graph to "resolve"
// it is a category error. Never merge the two.
//
// ---------------------------------------------------------------------------
// WHAT P1 PUBLISHES, AND WHY THE TABLES DIFFER IN COMPLETENESS
// ---------------------------------------------------------------------------
//
// P1 implemented DEF/USE; P2A adds PROTO/EXTERNPROTO type names. The constant
// tables below are therefore NOT all the same shape, deliberately:
//
//   * SCOPE_KIND / SYMBOL_KIND / REFERENCE_KIND list ONLY what is constructed
//     TODAY. Publishing a kind that nothing ever creates would advertise support
//     that does not exist. P2A added `proto-decl`, `externproto-decl` and
//     `node-type`; P2B added the three interface SCOPE kinds, the two interface
//     MEMBER kinds and the `is` reference kind; P2C adds `route-node` and
//     `route-event`, both of which it constructs. The table is now COMPLETE --
//     every kind WD1.5 designed is built, so a kind added from here on needs a
//     lane that actually mints it.
//     NOTE: P2A creates NO new scope KIND. A type scope is not a new region --
//     it is the existing `document`/`proto-body` scope viewed through its
//     `typeParent` link, which is the second, independent parent chain.
//   * NAMESPACE lists ALL THREE, because the whole purpose of the constant is to
//     keep them apart; the two P1 does not populate have to be VISIBLE as
//     distinct-and-absent, not invisible.
//   * STATUS lists ALL SIX committed statuses even though P1 never returns
//     `unsupported`, because STATUS is the table a consumer writes a `switch`
//     over. Truncating it now would make every such switch silently incomplete
//     when P2 lands.
//   * REASON lists only reasons P1 can actually return.
//
// Every value is STABLE: consumers, tests and docs key off these strings, so a
// published value never changes meaning. Adding is allowed; changing is not.

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

// A malformed input, a foreign object, or an object from a different graph is a
// PROGRAMMING ERROR, not a lost lookup, and is reported loudly. Silently
// accepting one is exactly how a symbol from document A would resolve against
// document B -- the cross-document failure WD1.4 already paid for once.
const SCOPE_ERROR = Object.freeze({
  /** A scope graph was required and something else was supplied. */
  GRAPH: 'ESCOPEGRAPH',
  /** A parse result was required and something else was supplied. */
  PARSE: 'ESCOPEPARSE',
  /** A reference (or an AST node carrying one) was required. */
  REFERENCE: 'ESCOPEREF',
  /** A declaration symbol (or an AST node carrying one) was required. */
  SYMBOL: 'ESCOPESYMBOL',
});

function scopeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

/**
 * The three VRML97 lexical namespaces. P1 populates NODE_NAME only; the other
 * two are declared so they can never be conflated with it.
 */
const NAMESPACE = Object.freeze({
  NODE_NAME: 'node-name',
  NODE_TYPE: 'node-type',
  INTERFACE_MEMBER: 'interface-member',
});

/**
 * Scope kinds P1 constructs. A scope is a lexical region that OWNS a namespace.
 */
const SCOPE_KIND = Object.freeze({
  DOCUMENT: 'document',
  PROTO_BODY: 'proto-body',

  // --- interface scopes (WD1.5-P2B) ------------------------------------
  //
  // An interface is a scope in the INTERFACE_MEMBER namespace, and it carries
  // NEITHER `defParent` NOR `typeParent`. It is an OWNERSHIP scope, not an
  // outward lexical chain: there is nowhere to walk to, so an `IS` cannot leak
  // into an enclosing interface no matter what a future edit does. That is the
  // same structural technique P1 used for 4.8.4 disjointness, and the reason no
  // "nearest enclosing interface" search exists anywhere in this lane.
  /** A `PROTO`'s interface list. The ONLY scope an `IS` ever resolves in. */
  PROTO_INTERFACE: 'proto-interface',
  /**
   * An `EXTERNPROTO`'s interface list. No `IS` is ever lexically inside one --
   * it has no body -- but it IS consulted as an endpoint namespace (4.9.2).
   */
  EXTERNPROTO_INTERFACE: 'externproto-interface',
  /** A `Script` instance's own `restrictedInterfaceDeclaration` set (Annex A.3). */
  SCRIPT_INTERFACE: 'script-interface',
});

/**
 * VRML97 access kinds. The four categories of 4.3.5, spelled exactly as the
 * parser and the WD1.3 schema's `vrml97Declaration` spell them.
 *
 * NOT the X3D spelling. `node-schema.js` also carries `accessType`
 * (`inputOnly`/`outputOnly`/`initializeOnly`/`inputOutput`); using it here would
 * create a second access vocabulary that has to be kept in step with this one.
 * There is one mapping, it lives in the schema, and this lane reads only the
 * VRML97 side of it.
 */
const ACCESS = Object.freeze({
  FIELD: 'field',
  EVENT_IN: 'eventIn',
  EVENT_OUT: 'eventOut',
  EXPOSED_FIELD: 'exposedField',
});

/**
 * Where an `IS` connection's DEFINITION-side endpoint came from (WD1.5-P2B).
 *
 * Four origins, kept explicit in the returned record because they answer
 * different questions about how much is locally known. In particular
 * `externproto-interface` is a FULLY POPULATED positive endpoint like the other
 * three: 4.9.2 makes an EXTERNPROTO interface declaration a PROTO interface
 * declaration bar initial values, so what it declares locally is authoritative.
 * A consumer asking "was this locally declared?" reads `origin`; it must never
 * infer that from the status.
 */
const ENDPOINT_ORIGIN = Object.freeze({
  BUILTIN_SCHEMA: 'builtin-schema',
  PROTO_INTERFACE: 'proto-interface',
  EXTERNPROTO_INTERFACE: 'externproto-interface',
  SCRIPT_INTERFACE: 'script-interface',
});

/**
 * The two syntactic hosts an `IS` has (Annex A.3). Syntactically identical
 * (`Id IS Id`, S16); the distinction is which side supplies the endpoint.
 */
const IS_FORM = Object.freeze({
  /** `fieldId IS interfaceId` in a node body. Endpoint = the node's interface. */
  NODE_BODY: 'node-body',
  /** `field T n IS n` in a Script body. Endpoint = the declaration itself. */
  SCRIPT_INTERFACE: 'script-interface',
});

/**
 * Declaration kinds P1/P2A construct.
 *
 * `node-def` lives in the NODE_NAME namespace; the two declaration kinds P2A
 * adds live in NODE_TYPE. They are never mixed in one table at lookup time --
 * see the namespace note above -- and a symbol always carries its `namespace`
 * so a consumer cannot infer the wrong one from the kind alone.
 */
const SYMBOL_KIND = Object.freeze({
  NODE_DEF: 'node-def',
  PROTO_DECL: 'proto-decl',
  EXTERNPROTO_DECL: 'externproto-decl',

  // --- interface-member namespace (WD1.5-P2B) --------------------------
  //
  // One abstract shape, TWO kinds, and never one table. A Script's
  // `field SFBool run` and its enclosing PROTO's `field SFBool run` are two
  // unrelated declarations in two unrelated scopes that happen to share a
  // spelling; the OWNING SCOPE KIND tells a PROTO member from an EXTERNPROTO
  // one, so no third symbol kind is needed for that.
  PROTO_INTERFACE_MEMBER: 'proto-interface-member',
  SCRIPT_INTERFACE_MEMBER: 'script-interface-member',
});

/** Reference kinds P1/P2A/P2B/P2C construct. */
const REFERENCE_KIND = Object.freeze({
  USE: 'use',
  /** A node instance naming its type: `Transform { }`, `MyProto { }`. */
  NODE_TYPE: 'node-type',
  /** The DECLARATION-side (right-hand) name of an `IS` (WD1.5-P2B). */
  IS: 'is',

  // --- ROUTE endpoints (WD1.5-P2C) --------------------------------------
  //
  // A ROUTE contributes FOUR references, in two pairs, and they are deliberately
  // two KINDS rather than one. The node half is a NODE_NAME lookup -- 4.6.2 names
  // ROUTE beside USE in the DEF/USE clause, so it is the same namespace under the
  // same scoping rule. The event half is not a lexical lookup at all: once the
  // node is known, the event name is answered by that node's PUBLIC INTERFACE,
  // which is a schema fact for a built-in and an interface-scope fact for a
  // PROTO/EXTERNPROTO/Script. Merging them would let a lost NODE masquerade as a
  // missing EVENT, which is the one thing §7 of the plan forbids.
  /** A ROUTE's source or destination NODE name. NODE_NAME namespace. */
  ROUTE_NODE: 'route-node',
  /** A ROUTE's source or destination EVENT name. No lexical namespace. */
  ROUTE_EVENT: 'route-event',
});

/**
 * Which end of a ROUTE a reference sits on (WD1.5-P2C).
 *
 * The two sides are NOT symmetric at the event level: 4.10.2 routes only from an
 * eventOut to an eventIn, and its base-name fallback is direction-specific
 * (`zzz_changed` for a source, `set_zzz` for a destination). Every ROUTE query
 * therefore takes a side, and no code path infers one from the other.
 */
const ROUTE_SIDE = Object.freeze({
  SOURCE: 'source',
  DESTINATION: 'destination',
});

/**
 * Resolution outcomes -- the full committed taxonomy.
 *
 * `recovered` is distinct from `unresolved` on purpose: "I looked and it is not
 * there" is a different claim from "the parse is too damaged for absence, or
 * presence, to mean anything".
 *
 * P1 never returns `unsupported`; it is published because it is part of the
 * committed status table a consumer branches on.
 */
const STATUS = Object.freeze({
  RESOLVED: 'resolved',
  UNRESOLVED: 'unresolved',
  AMBIGUOUS: 'ambiguous',
  INVALID: 'invalid',
  UNSUPPORTED: 'unsupported',
  RECOVERED: 'recovered',
});

/**
 * Stable reason identifiers. Exactly the set P1 can return.
 */
const REASON = Object.freeze({
  OK: 'ok',

  // --- node-name namespace ---------------------------------------------
  /** No preceding declaration of that name is visible in this scope. */
  DEF_NOT_DECLARED_IN_SCOPE: 'def-not-declared-in-scope',
  /** A declaration of that name exists in this scope, but only AFTER the USE. */
  USE_BEFORE_DEF: 'use-before-def',
  /** Declared, but in a scope 4.8.4 makes disjoint from this one. */
  DEF_NOT_VISIBLE_ACROSS_PROTO_BOUNDARY: 'def-not-visible-across-proto-boundary',
  /** More than one preceding declaration; the tool refuses to choose. */
  DUPLICATE_DEF_IN_SCOPE: 'duplicate-def-in-scope',
  /** A USE inside the very node it names, within the transformation hierarchy. */
  SELF_REFERENTIAL_USE: 'self-referential-use',
  /** The same shape under a Script, where 4.4.4 does not reach -- legal. */
  SELF_REFERENCE_OUTSIDE_TRANSFORMATION_HIERARCHY: 'self-reference-outside-transformation-hierarchy',
  /** The parse could not recover a name for this reference at all. */
  MISSING_NAME: 'missing-name',

  // --- node-type namespace (WD1.5-P2A) ---------------------------------
  /**
   * The type is a clause-6 built-in. This is a SCHEMA fact, not a lexical one:
   * `Transform` is declared nowhere in the file, so no symbol accompanies it
   * and no scope owns it.
   */
  NODE_TYPE_IS_BUILTIN: 'node-type-is-builtin',
  /** Neither a built-in nor a visible PROTO/EXTERNPROTO declaration. */
  NODE_TYPE_UNKNOWN: 'node-type-unknown',
  /** 4.8.4 -- instantiable only AFTER the declaration completes. */
  PROTO_INSTANCE_BEFORE_DECLARATION: 'proto-instance-before-declaration',
  /** 4.8.1 -- node type names shall be unique; the tool refuses to choose. */
  DUPLICATE_PROTO_DECLARATION: 'duplicate-proto-declaration',
  /**
   * A local declaration takes a built-in's spelling. 4.8.1 says results are
   * undefined; the lexical declaration still wins the binding, so this is
   * carried as `detail` on a `resolved` answer, never as a status of its own.
   */
  PROTO_SHADOWS_BUILTIN: 'proto-shadows-builtin',
  /** 4.8.4 -- "recursive prototypes are illegal". */
  RECURSIVE_PROTO_INSTANCE: 'recursive-proto-instance',

  // --- recovery / provability ------------------------------------------
  /** A hard parse cap fired: no lexical scope in the document is provable. */
  DOCUMENT_PARSE_INCOMPLETE: 'document-parse-incomplete',
  /** A syntax error lands inside this scope, so its extent is unprovable. */
  SCOPE_RECOVERED: 'scope-recovered',
  /** A PROTO the parse could not name owns this scope. */
  PROTO_SCOPE_NOT_PROVABLE: 'proto-scope-not-provable',
  /** Annex A `protoBody` requires >= 1 node statement; this body has none. */
  PROTO_BODY_NOT_PROVABLE: 'proto-body-not-provable',

  // --- interface-member namespace (WD1.5-P2B) ---------------------------
  /** No member of that EFFECTIVE name in the innermost enclosing interface. */
  INTERFACE_MEMBER_NOT_DECLARED: 'interface-member-not-declared',
  /**
   * Two or more members share one EFFECTIVE name in one interface. Includes the
   * 4.3.5 case an author cannot have intended -- `exposedField zzz` alongside an
   * explicit `eventIn set_zzz` -- which the standard prohibits outright, so
   * neither declaration is the "right" one and NEITHER is returned.
   */
  DUPLICATE_INTERFACE_MEMBER: 'duplicate-interface-member',
  /** 4.3.6 / 4.8.3 -- an `IS` with no enclosing prototype definition. */
  IS_OUTSIDE_PROTO_BODY: 'is-outside-proto-body',
  /** The parse recovered no declaration-side name to look up. */
  IS_TARGET_NAME_MISSING: 'is-target-name-missing',

  // --- IS compatibility (WD1.5-P2B) -------------------------------------
  /** A `no` cell of Table 4.4, judged on EFFECTIVE access. */
  IS_ACCESS_INCOMPATIBLE: 'is-access-incompatible',
  /** 4.8.3 -- the two field-type tokens are not equal. No coercion exists. */
  IS_TYPE_MISMATCH: 'is-type-mismatch',
  /** A field-type token neither side can identify; never a silent pass. */
  IS_TYPE_UNKNOWN: 'is-type-unknown',
  /** 4.8.3 -- one definition-side endpoint associated by `IS` more than once. */
  DUPLICATE_IS_FOR_ENDPOINT: 'duplicate-is-for-endpoint',
  /** 4.8.3 -- a field both given an initial value and associated by `IS`. */
  FIELD_VALUED_AND_IS: 'field-valued-and-is',

  // --- IS endpoint availability (WD1.5-P2B) -----------------------------
  /** P2A did not `resolve` the containing node's type, so the endpoint is a guess. */
  IS_ENDPOINT_NODE_TYPE_UNRESOLVED: 'is-endpoint-node-type-unresolved',
  /**
   * A resolved built-in, PROTO or Script interface genuinely has no such
   * field/event, even after implicit-alias expansion. NEVER used for an
   * EXTERNPROTO: its declaration may be a strict subset of the implementation's,
   * so local silence is not absence.
   */
  IS_ENDPOINT_UNKNOWN_FIELD: 'is-endpoint-unknown-field',
  /**
   * 4.9.2 -- the effective member is ABSENT from the local EXTERNPROTO
   * declaration. The implementation is not loaded and never will be here, so
   * absence is unknowable rather than false. A member the EXTERNPROTO DOES
   * declare resolves positively and never reaches this reason.
   */
  EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE: 'externproto-interface-not-locally-verifiable',

  // --- interface recovery (WD1.5-P2B) -----------------------------------
  /** G3/G4 -- an interface's extent is unprovable, so its member set is too. */
  INTERFACE_SCOPE_NOT_PROVABLE: 'interface-scope-not-provable',
  /** G2 -- the enclosing body is unprovable, so WHICH interface owns this is in doubt. */
  INTERFACE_NOT_PROVABLE_FOR_REFERENCE: 'interface-not-provable-for-reference',

  // --- non-binding detail (WD1.5-P2B) -----------------------------------
  //
  // Carried as `detail`, exactly as P2A carries `proto-shadows-builtin`: an
  // observation about an answer that is otherwise complete. It NEVER changes the
  // status, the reason or the bound symbol, and a consumer that ignores it is
  // correct. Per WD.md §9 a compatibility-profile shape is classified and
  // preserved here -- never promoted into a language rule, never normalized away.
  /** §6 Q5 -- the name exists, but only in an OUTER interface. Explanatory only. */
  MEMBER_FOUND_IN_OUTER_INTERFACE_ONLY: 'member-found-in-outer-interface-only',
  /** The binding came from 4.7/4.8.2 `set_`/`_changed` alias expansion. */
  MEMBER_VIA_IMPLICIT_ALIAS: 'member-via-implicit-alias',
  /** Annex A.3 admits no user `exposedField` in a Script body. Corpus: 1,577. */
  EXPOSED_FIELD_IN_SCRIPT_INTERFACE: 'exposed-field-in-script-interface',
  /** Annex A.2 gives an interface DECLARATION no `IS` form at all. Corpus: 20. */
  IS_IN_INTERFACE_DECLARATION_LIST: 'is-in-interface-declaration-list',

  // --- ROUTE endpoints (WD1.5-P2C) --------------------------------------
  //
  // Reasons that already say the right thing are REUSED rather than respelled --
  // a ROUTE naming an undeclared node answers `def-not-declared-in-scope`, the
  // same fact a USE reports, because it IS the same fact in the same namespace
  // (4.6.2). Only the genuinely ROUTE-specific claims get new spellings.
  /**
   * 4.10.2 -- "nodes referenced in a ROUTE statement shall be defined before the
   * ROUTE statement". A declaration of this name exists in this very scope, but
   * only AFTER the ROUTE. ROUTE's analogue of `use-before-def`, and a DIFFERENT
   * fact from `def-not-declared-in-scope`: one says the author wrote it later,
   * the other says they never wrote it here at all.
   */
  ROUTE_NODE_NOT_DEFINED_BEFORE_ROUTE: 'route-node-not-defined-before-route',
  /** P2A did not `resolve` the target node's type, so its interface is a guess. */
  ROUTE_ENDPOINT_NODE_TYPE_UNRESOLVED: 'route-endpoint-node-type-unresolved',
  /**
   * The resolved interface genuinely has no such endpoint -- after BOTH 4.7 alias
   * expansion AND 4.10.2's base-name fallback. NEVER used for an EXTERNPROTO,
   * whose local silence is unknowable rather than absent (4.9.2).
   */
  ROUTE_ENDPOINT_UNKNOWN_FIELD: 'route-endpoint-unknown-field',
  /**
   * 4.10.2 -- "routes may be established only from eventOuts to eventIns". The
   * source endpoint exists but its EFFECTIVE access can supply no eventOut, so it
   * cannot drive a ROUTE. Distinct from `route-endpoint-unknown-field`: the name
   * was found, and the failure is directional rather than lexical.
   */
  ROUTE_SOURCE_NOT_AN_EVENT_OUT: 'route-source-not-an-event-out',
  /** 4.10.2, the other direction -- the destination can accept no eventIn. */
  ROUTE_DEST_NOT_AN_EVENT_IN: 'route-dest-not-an-event-in',
  /** 4.10.2 -- "the types shall match exactly". No coercion, no SF<->MF. */
  ROUTE_TYPE_MISMATCH: 'route-type-mismatch',
  /** A field-type token one side cannot identify. Never a silent pass. */
  ROUTE_TYPE_UNKNOWN: 'route-type-unknown',

  // --- non-binding detail (WD1.5-P2C) -----------------------------------
  //
  // Both are `detail`, on an otherwise complete `resolved` answer. Neither
  // changes the status, the reason or the bound endpoint.
  /**
   * 4.10.2's ROUTE-ONLY base-name fallback fired: the written spelling supplied
   * no directionally usable event, so `set_<name>` / `<name>_changed` was tried
   * and bound. This is the hook §11.3 of the plan asks for -- the one place a
   * consumer can see that the author's spelling was not the one that resolved.
   */
  ROUTE_ENDPOINT_VIA_SHORTHAND: 'route-endpoint-via-shorthand',
  /** The binding came from 4.7/4.8.2 `set_`/`_changed` alias EXPANSION. */
  ROUTE_ENDPOINT_VIA_IMPLICIT_ALIAS: 'route-endpoint-via-implicit-alias',

  // --- query answers ----------------------------------------------------
  /** A uniqueness or reference query was handed something that is not a DEF. */
  NOT_A_DEF_SYMBOL: 'not-a-def-symbol',
});

// ---------------------------------------------------------------------------
// Graph membership
// ---------------------------------------------------------------------------
//
// Every projection this module mints is branded with the OPAQUE OWNER TOKEN of
// the graph that built it, held in a module-private WeakMap. Shape is not proof:
// a hand-rolled `{kind:'node-def', name:'Ball'}`, or a projection from a
// DIFFERENT parse of BYTE-IDENTICAL text, has nothing behind it and is rejected.
//
// This is the same lesson WD1.4 records for parse sessions: object identity
// cannot collide, and a printable id can. Nothing here compares an id, a name,
// a hash or a path to decide membership.
const OWNER = new WeakMap();

/** Brand a frozen projection as belonging to one graph. Internal to this lane. */
function brand(projection, owner) {
  if (owner === undefined || owner === null) {
    throw scopeError(SCOPE_ERROR.GRAPH, 'brand: an owner token is required');
  }
  OWNER.set(projection, owner);
  return projection;
}

/** The owner token behind a projection, or `undefined` for anything unbranded. */
function ownerOf(projection) {
  if (!projection || typeof projection !== 'object') return undefined;
  return OWNER.get(projection);
}

/** Was `projection` minted by the graph behind `owner`? */
function belongsTo(projection, owner) {
  if (owner === undefined || owner === null) return false;
  return ownerOf(projection) === owner;
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------
//
// NOTE ON RANGES. A `range` is the PARSER'S OWN {start,end} object, shared and
// not copied. It is deliberately NOT frozen: freezing it would mutate the parse
// result, and this module never mutates its input. Treat a range as read-only by
// contract, exactly as every other consumer of a parse result does.
//
// NOTE ON AST NODES. `symbol.node` and `reference.node` are the parser's own AST
// nodes, for the same reason and under the same contract. A resolved result has
// to be able to say WHICH declaration it found, and the AST node is that answer.

/**
 * A lexical region owning a namespace.
 *
 * TWO INDEPENDENT PARENT LINKS, because VRML97's namespaces nest differently:
 *
 *   defParent  -- node names. `null` on a PROTO body. ISO/IEC 14772-1 4.8.4
 *                 makes a PROTO's DEF/USE scope separate from the rest of the
 *                 scene AND from nested PROTOs, in BOTH directions. This is
 *                 DISJOINTNESS, NOT SHADOWING: lookup stops, it does not
 *                 continue outward.
 *   typeParent -- node types. Points outward, because a nested body may still
 *                 instantiate a type declared in an enclosing scope (4.8.4).
 *                 P1 records the link and implements NO type lookup through it.
 *
 * A scope is an IDENTITY, never a string. WD1.4 reproduced a real wrong anchor
 * from a `/`-joined scope key: the tokenizer classifies identifiers by
 * exclusion, so `PROTO A/B` and `PROTO A { PROTO B }` spell the same joined key.
 * Nothing here derives a scope's identity from a name, a path, a delimiter-joined
 * string or a hash -- the object IS the identity.
 */
function createScope(fields, owner) {
  return brand(Object.freeze({
    kind: fields.kind,
    /** Node-name lookup parent. Always `null` on a PROTO body -- rule D5. */
    defParent: fields.defParent || null,
    /** Node-type lookup parent. Recorded for WD1.5-P2; unused by P1. */
    typeParent: fields.typeParent || null,
    /** The construct that owns this scope (document tree, or the PROTO). */
    ownerRange: fields.ownerRange || null,
    /** The PROTO's name, or `null` for the document scope / an unnamed PROTO. */
    ownerName: fields.ownerName == null ? null : fields.ownerName,
    /** The AST node that owns this scope (`Document` or `Proto`). */
    ownerNode: fields.ownerNode || null,
    /** True when this scope's extent could not be proven. See REASON. */
    recovered: !!fields.recovered,
    recoveredReason: fields.recoveredReason || null,
    /** Construction order. Diagnostic only; never an identity. */
    index: fields.index,
  }), owner);
}

/**
 * A DEF declaration.
 *
 * Records only the evidence resolution needs. No structural path, no
 * fingerprint, no sibling index, no serialized summary, no field values -- every
 * one of those is a rejected WD1.4 strategy (WD.md §7) and none may return.
 */
function createDefSymbol(fields, owner) {
  return brand(Object.freeze({
    kind: SYMBOL_KIND.NODE_DEF,
    namespace: NAMESPACE.NODE_NAME,
    name: fields.name,
    /** The `Node` AST node carrying the DEF. */
    node: fields.node,
    /** The owning DEF scope object. */
    scope: fields.scope,
    /** The DEF name's own span. */
    declRange: fields.declRange || null,
    /** Source-ordered position among this graph's symbols. */
    sourceOrder: fields.sourceOrder,
    /** The declared node's type token, where the parse recovered one. */
    nodeType: fields.nodeType == null ? null : fields.nodeType,
    /** Offset from which the declaration is visible -- 4.6.2 "preceding it". */
    visibleFrom: fields.visibleFrom,
  }), owner);
}

/**
 * A USE reference.
 */
function createUseReference(fields, owner) {
  return brand(Object.freeze({
    kind: REFERENCE_KIND.USE,
    namespace: NAMESPACE.NODE_NAME,
    name: fields.name == null ? null : fields.name,
    /** The `Use` AST node. */
    node: fields.node,
    /** The DEF scope this reference is looked up in. */
    scope: fields.scope,
    /** The referenced name's own span. */
    range: fields.range || null,
    /** Source-ordered position among this graph's references. */
    sourceOrder: fields.sourceOrder,
    offset: fields.offset,
    /**
     * Is this reference lexically under a Script node? 4.4.4 excludes a Script's
     * descendants from the transformation hierarchy, so the acyclicity rule --
     * and therefore `self-referential-use` -- must not fire there.
     */
    insideScript: !!fields.insideScript,
  }), owner);
}

/**
 * A `PROTO` or `EXTERNPROTO` declaration -- a NODE_TYPE symbol (WD1.5-P2A).
 *
 * Deliberately thin. It records the evidence type resolution needs and nothing
 * else: no interface members (that is P2B), no body summary, no declaration
 * subtree copy, no structural path, and none of WD1.4's rejected identity
 * strategies. The declaration AST node is retained because a resolved answer
 * has to be able to say WHICH declaration it found.
 *
 * `visibleFrom` is the END offset of the whole declaration, not its name --
 * 4.8.4 makes a prototype instantiable "after the completion of the prototype
 * definition", which is a different rule from 4.6.2's DEF visibility and must
 * not be copied from it.
 */
function createTypeDeclSymbol(fields, owner) {
  const kind = fields.kind;
  return brand(Object.freeze({
    kind,
    namespace: NAMESPACE.NODE_TYPE,
    name: fields.name == null ? null : fields.name,
    /** The `Proto` or `ExternProto` AST node. */
    node: fields.node,
    /** The owning TYPE scope object (the scope the declaration is written in). */
    scope: fields.scope,
    /** The declared name's own span. */
    declRange: fields.declRange || null,
    /** Source-ordered position among this graph's type declarations. */
    sourceOrder: fields.sourceOrder,
    /** `true` for EXTERNPROTO. A kind convenience, not a second source of truth. */
    isExtern: kind === SYMBOL_KIND.EXTERNPROTO_DECL,
    /**
     * 4.9.2: an EXTERNPROTO interface is a SUBSET of the real implementation's,
     * so a member absent from the declaration is UNKNOWABLE locally, never
     * "not there". P2A declares no interface members at all; this flag exists
     * so a later lane cannot mistake local silence for authoritative absence.
     */
    interfaceIsSubset: kind === SYMBOL_KIND.EXTERNPROTO_DECL,
    /** 4.8.4 "after the completion of the definition" -- the declaration's end. */
    visibleFrom: fields.visibleFrom,
  }), owner);
}

/**
 * A node instance naming its type -- a NODE_TYPE reference (WD1.5-P2A).
 *
 * VRML97 has no distinct `ProtoInstance` syntax: a prototype instance IS a node
 * statement whose type token happens to name a declared prototype. So exactly
 * one of these is minted per `Node`, and which kind of thing the name denotes is
 * the question resolution answers rather than a fact the parser supplies.
 */
function createNodeTypeReference(fields, owner) {
  return brand(Object.freeze({
    kind: REFERENCE_KIND.NODE_TYPE,
    namespace: NAMESPACE.NODE_TYPE,
    name: fields.name == null ? null : fields.name,
    /** The `Node` AST node whose type token this is. */
    node: fields.node,
    /** The TYPE scope this reference is looked up in. */
    scope: fields.scope,
    /** The type token's own span. */
    range: fields.range || null,
    /** Source-ordered position among this graph's type references. */
    sourceOrder: fields.sourceOrder,
    offset: fields.offset,
  }), owner);
}

/**
 * One PROTO / EXTERNPROTO / Script interface member (WD1.5-P2B).
 *
 * A member's WRITTEN name and access are recorded here and nowhere else. The
 * EFFECTIVE names 4.7/4.8.2 give an `exposedField` (`set_zzz`, `zzz_changed`)
 * are NOT stored: they are generated on demand into the graph's private member
 * index, because they are a language rule about how a declaration may be
 * REFERRED TO, not additional declarations. Writing them here would put three
 * symbols where the author wrote one, and a rename would then have three
 * declarations to "fix".
 */
function createInterfaceMemberSymbol(fields, owner) {
  return brand(Object.freeze({
    kind: fields.kind,
    namespace: NAMESPACE.INTERFACE_MEMBER,
    /** The name as written. Never an alias. */
    name: fields.name == null ? null : fields.name,
    /** `field` / `eventIn` / `eventOut` / `exposedField`, as written. */
    access: fields.access == null ? null : fields.access,
    /** The declared field-type token, or `null` when the parse recovered none. */
    fieldType: fields.fieldType == null ? null : fields.fieldType,
    /** The `InterfaceDecl` AST node. */
    node: fields.node,
    /** The owning interface scope OBJECT -- an identity, never a name or a key. */
    scope: fields.scope,
    /** The member name's own span. */
    declRange: fields.declRange || null,
    /** The whole declaration's span. */
    range: fields.range || null,
    /** Does the declaration carry a default value? PROTO/Script only (4.9.1). */
    hasDefault: !!fields.hasDefault,
    /** Source-ordered position among this graph's interface members. */
    sourceOrder: fields.sourceOrder,
    /** A classified compatibility-profile observation, or `null`. Non-binding. */
    detail: fields.detail == null ? null : fields.detail,
  }), owner);
}

/**
 * The declaration-side (right-hand) name of one `IS` (WD1.5-P2B).
 *
 * ONE reference per `IS`, answering ONE question: which interface member does
 * the right-hand name denote? The definition-side endpoint and the Table 4.4
 * verdict are deliberately a SEPARATE query (`isConnectionVerdict`), because the
 * endpoint can be unknowable while this binding is perfectly provable, and
 * collapsing the two would throw away a good answer.
 *
 * `owner` is the innermost enclosing `proto-interface` scope, FIXED STRUCTURALLY
 * during descent. It is not found by a containment test, a nearest-enclosing
 * search or an ancestor walk -- recovery moves ranges, and searching over moved
 * ranges is how P2A first produced a wrong answer.
 */
function createIsReference(fields, owner) {
  return brand(Object.freeze({
    kind: REFERENCE_KIND.IS,
    namespace: NAMESPACE.INTERFACE_MEMBER,
    /** The right-hand (interface member) name. */
    name: fields.name == null ? null : fields.name,
    /** `node-body` or `script-interface` -- which side supplies the endpoint. */
    form: fields.form,
    /** The `Field` or `InterfaceDecl` AST node carrying the `IS`. */
    node: fields.node,
    /** The `Node` AST node whose body hosts it, or `null` at document level. */
    hostNode: fields.hostNode || null,
    /** The innermost enclosing PROTO interface scope, or `null`. */
    owner: fields.owner || null,
    /** The enclosing lexical (document / proto-body) scope. */
    hostScope: fields.hostScope || null,
    /** For the Script form, the declaring `script-interface` scope. */
    hostInterfaceScope: fields.hostInterfaceScope || null,
    /** The right-hand name's own span. */
    range: fields.range || null,
    /** The definition-side (left-hand) name as written. */
    endpointName: fields.endpointName == null ? null : fields.endpointName,
    /** The definition-side name's own span. */
    endpointRange: fields.endpointRange || null,
    /** Source-ordered position among this graph's `IS` references. */
    sourceOrder: fields.sourceOrder,
    offset: fields.offset,
    /** A classified compatibility-profile observation, or `null`. Non-binding. */
    detail: fields.detail == null ? null : fields.detail,
  }), owner);
}

/**
 * One end of a ROUTE's NODE half -- a NODE_NAME reference (WD1.5-P2C).
 *
 * ISO/IEC 14772-1 4.6.2: "A node given a name using DEF may be referenced by
 * name later in the same file with USE or ROUTE statements." ROUTE node names
 * are therefore the SAME namespace under the SAME scoping rule as USE, which is
 * what lets P2C reuse P1's DEF tables wholesale instead of building a second
 * lookup. Nothing about ROUTE gets its own visibility exception, in either
 * direction across a PROTO boundary (4.8.4).
 *
 * `scope` is the ROUTE statement's own enclosing DEF scope, FIXED ON DESCENT.
 * It is never recovered afterwards by an innermost-containment search: parser
 * recovery MOVES ranges, and searching over moved ranges is precisely how a
 * confident wrong binding gets produced (WD.md §7).
 */
function createRouteNodeReference(fields, owner) {
  return brand(Object.freeze({
    kind: REFERENCE_KIND.ROUTE_NODE,
    namespace: NAMESPACE.NODE_NAME,
    /** The node name as written, or `null` where the parse recovered none. */
    name: fields.name == null ? null : fields.name,
    /** `source` or `destination`. */
    side: fields.side,
    /** The `Route` AST node. Both sides share it; `side` tells them apart. */
    node: fields.node,
    /** The DEF scope this reference is looked up in. */
    scope: fields.scope,
    /** The node name's own span. */
    range: fields.range || null,
    /** Source-ordered position among this graph's ROUTE references. */
    sourceOrder: fields.sourceOrder,
    /**
     * 4.10.2's "defined before the ROUTE statement" boundary -- the ROUTE
     * STATEMENT's own start offset, not the name token's. Both endpoints of one
     * ROUTE share it, because the clause scopes the rule to the statement.
     */
    offset: fields.offset,
  }), owner);
}

/**
 * One end of a ROUTE's EVENT half (WD1.5-P2C).
 *
 * NOT a lexical namespace reference, and `namespace` is `null` to say so out
 * loud. An event name is not resolved in a SCOPE: once the node half has bound a
 * declaration, the event is answered by that node's PUBLIC INTERFACE -- clause 6
 * for a built-in, an interface scope for a PROTO/EXTERNPROTO/Script. That is the
 * same asymmetry P2B records for an `IS` definition-side name.
 *
 * It carries its paired `nodeReference` so a consumer never has to re-derive
 * which node the event sits on -- and so the two questions stay separately
 * answerable: an event whose node did not resolve is NOT evaluated at all, and
 * must never come back as "unknown field".
 */
function createRouteEventReference(fields, owner) {
  return brand(Object.freeze({
    kind: REFERENCE_KIND.ROUTE_EVENT,
    /** Deliberately `null`: an event name is an interface fact, not a lexical one. */
    namespace: null,
    /** The event name as written -- possibly an exposedField base name (4.10.2). */
    name: fields.name == null ? null : fields.name,
    /** `source` or `destination`. */
    side: fields.side,
    /** The `Route` AST node. */
    node: fields.node,
    /** The paired `route-node` reference this endpoint sits on. */
    nodeReference: fields.nodeReference || null,
    /** The enclosing lexical DEF scope, carried for the recovery gate. */
    scope: fields.scope,
    /** The event name's own span. */
    range: fields.range || null,
    sourceOrder: fields.sourceOrder,
    offset: fields.offset,
  }), owner);
}

/**
 * The answer to a whole ROUTE -- may these two endpoints actually be connected?
 *
 * Deliberately NOT a `createResolution`, for the reason `createIsVerdict` gives:
 * a resolution answers "which declaration does this name denote" and this
 * answers "may these two be connected". One shape would let a consumer mistake a
 * compatibility verdict for a binding.
 *
 * `side` names WHICH end defeated the verdict, so `source-node-unresolved` and
 * `destination-node-unresolved` are distinguishable without re-running either
 * sub-question. It is `null` on `ok` and on a whole-ROUTE recovery.
 */
function createRouteVerdict(fields) {
  return Object.freeze({
    status: fields.status,
    reason: fields.reason,
    /** The `Route` AST node this answers. */
    node: fields.node,
    /** `source`, `destination`, or `null`. */
    side: fields.side == null ? null : fields.side,
    /** The source endpoint record, or `null` when unavailable. */
    sourceEndpoint: fields.sourceEndpoint || null,
    /** The destination endpoint record, or `null` when unavailable. */
    destinationEndpoint: fields.destinationEndpoint || null,
    evidence: Object.freeze(fields.evidence ? fields.evidence.slice() : []),
  });
}

/**
 * The answer to an `IS` CONNECTION question -- §7.1's second half (WD1.5-P2B).
 *
 * Deliberately NOT a `createResolution`: a resolution answers "which declaration
 * does this name denote", and this answers "may these two be connected". Giving
 * them one shape would let a consumer treat a compatibility verdict as a binding.
 */
function createIsVerdict(fields) {
  return Object.freeze({
    status: fields.status,
    reason: fields.reason,
    /** The `IS` reference this answers. */
    reference: fields.reference,
    /** The bound interface member, or `null` when the RHS did not resolve. */
    member: fields.member || null,
    /** The definition-side endpoint, or `null` when unavailable. */
    endpoint: fields.endpoint || null,
    /** The member's EFFECTIVE access after alias expansion, or `null`. */
    declaredAccess: fields.declaredAccess == null ? null : fields.declaredAccess,
    /** The member's declared field type, or `null`. */
    declaredType: fields.declaredType == null ? null : fields.declaredType,
    detail: fields.detail == null ? null : fields.detail,
    evidence: Object.freeze(fields.evidence ? fields.evidence.slice() : []),
  });
}

/** One definition-side endpoint record. See ENDPOINT_ORIGIN. */
function createEndpoint(fields) {
  return Object.freeze({
    origin: fields.origin,
    /** The endpoint name as written on the node, e.g. `set_translation`. */
    name: fields.name == null ? null : fields.name,
    /**
     * The name of the DECLARATION that name denotes, e.g. `translation`. Equal
     * to `name` unless 4.7 alias expansion was applied. It is the declaration's
     * name rather than the written one because `name` already carries the
     * written spelling; repeating it here would say nothing.
     */
    effectiveName: fields.effectiveName == null ? null : fields.effectiveName,
    /** The EFFECTIVE VRML97 access kind Table 4.4 is applied to. */
    access: fields.access == null ? null : fields.access,
    /** The field-type token. */
    type: fields.type == null ? null : fields.type,
    range: fields.range || null,
  });
}

/**
 * The S7/S8 answer for one node (WD1.5-P2B).
 *
 * A property of a NODE, not of a single `IS`, so it is its own query rather than
 * being folded into a reference's resolution -- an `IS` whose RHS binds
 * perfectly can still sit in a node that violates 4.8.3's multiplicity rules,
 * and corrupting the binding to say so would lose the good answer.
 */
function createNodeIsIssues(fields) {
  return Object.freeze({
    status: fields.status,
    reason: fields.reason,
    issues: Object.freeze((fields.issues || []).map((issue) => Object.freeze({
      reason: issue.reason,
      /** The definition-side endpoint name the issue is about. */
      endpointName: issue.endpointName,
      evidence: Object.freeze(issue.evidence ? issue.evidence.slice() : []),
    }))),
  });
}

/**
 * The outcome of one reference lookup.
 *
 * EVERY result is explicit: a status, a stable reason, and a symbol ONLY when
 * the status is `resolved`. Nothing returns a bare node, and nothing returns a
 * bare `null`. That is WD1.4's hard gate expressed in the type: a tool may lose
 * a target and may say it cannot prove one; it may never confidently return a
 * different one.
 */
function createResolution(fields) {
  const status = fields.status;
  return Object.freeze({
    status,
    reason: fields.reason,
    /** The reference this answers. */
    reference: fields.reference,
    /** The declaration -- `null` unless `status === 'resolved'`. */
    symbol: status === STATUS.RESOLVED && fields.symbol ? fields.symbol : null,
    /** How many declarations were in play. 0 when none were. */
    candidateCount: fields.candidateCount == null ? 0 : fields.candidateCount,
    /**
     * A secondary observation about an answer that is otherwise complete --
     * currently only `proto-shadows-builtin`. It NEVER changes the status, the
     * reason or the bound declaration; a consumer that ignores it is correct.
     * `null` on every P1 (DEF/USE) answer.
     */
    detail: fields.detail == null ? null : fields.detail,
    /** Declaration spans that justify the call, source-ordered. */
    evidence: Object.freeze(fields.evidence ? fields.evidence.slice() : []),
  });
}

/** The answer to a scope-aware DEF uniqueness question. */
function createUniqueness(unique, reason) {
  return Object.freeze({ unique: !!unique, reason });
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------
//
// SHAPE-ONLY. These say what an object looks like, never which graph it came
// from -- membership is `belongsTo`, and only `belongsTo` may authorize a
// lookup. Keeping the two apart is deliberate: a shape test that doubled as an
// authorization test is precisely how a projection from another document would
// get in.

const SCOPE_KINDS = new Set(Object.values(SCOPE_KIND));
const INTERFACE_SCOPE_KINDS = new Set([
  SCOPE_KIND.PROTO_INTERFACE, SCOPE_KIND.EXTERNPROTO_INTERFACE, SCOPE_KIND.SCRIPT_INTERFACE,
]);

const isScopeShape = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && SCOPE_KINDS.has(v.kind);
/** Narrower than `isScopeShape`: an interface scope only. */
const isInterfaceScopeShape = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && INTERFACE_SCOPE_KINDS.has(v.kind);
const isInterfaceMemberShape = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && (v.kind === SYMBOL_KIND.PROTO_INTERFACE_MEMBER
    || v.kind === SYMBOL_KIND.SCRIPT_INTERFACE_MEMBER)
  && v.namespace === NAMESPACE.INTERFACE_MEMBER;
const isIsReferenceShape = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && v.kind === REFERENCE_KIND.IS && v.namespace === NAMESPACE.INTERFACE_MEMBER;
const isDefSymbolShape = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && v.kind === SYMBOL_KIND.NODE_DEF && v.namespace === NAMESPACE.NODE_NAME;
const isUseReferenceShape = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && v.kind === REFERENCE_KIND.USE && v.namespace === NAMESPACE.NODE_NAME;
const isTypeDeclSymbolShape = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && (v.kind === SYMBOL_KIND.PROTO_DECL || v.kind === SYMBOL_KIND.EXTERNPROTO_DECL)
  && v.namespace === NAMESPACE.NODE_TYPE;
const isNodeTypeReferenceShape = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && v.kind === REFERENCE_KIND.NODE_TYPE && v.namespace === NAMESPACE.NODE_TYPE;
const ROUTE_SIDES = new Set(Object.values(ROUTE_SIDE));
const isRouteNodeReferenceShape = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && v.kind === REFERENCE_KIND.ROUTE_NODE && v.namespace === NAMESPACE.NODE_NAME
  && ROUTE_SIDES.has(v.side);
// `namespace === null` is part of the SHAPE, not an omission: an event name is
// answered by a node's interface, never looked up in a lexical scope, and a
// projection claiming otherwise is not a route-event.
const isRouteEventReferenceShape = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && v.kind === REFERENCE_KIND.ROUTE_EVENT && v.namespace === null
  && ROUTE_SIDES.has(v.side);

/** Did a lookup prove exactly one declaration? */
const isResolved = (r) => !!r && r.status === STATUS.RESOLVED;
/** Did it prove the name is not declared here? */
const isUnresolved = (r) => !!r && r.status === STATUS.UNRESOLVED;
/** Did it find more than one candidate and refuse to choose? */
const isAmbiguous = (r) => !!r && r.status === STATUS.AMBIGUOUS;
/** Is the construct itself against the language rules? */
const isInvalid = (r) => !!r && r.status === STATUS.INVALID;
/** Did a damaged scope make every lexical answer untrustworthy? */
const isRecovered = (r) => !!r && r.status === STATUS.RECOVERED;

module.exports = {
  SCOPE_ERROR,
  NAMESPACE,
  SCOPE_KIND,
  SYMBOL_KIND,
  REFERENCE_KIND,
  ACCESS,
  ENDPOINT_ORIGIN,
  IS_FORM,
  ROUTE_SIDE,
  STATUS,
  REASON,
  scopeError,
  brand,
  ownerOf,
  belongsTo,
  createScope,
  createDefSymbol,
  createUseReference,
  createTypeDeclSymbol,
  createNodeTypeReference,
  createInterfaceMemberSymbol,
  createIsReference,
  createIsVerdict,
  createRouteNodeReference,
  createRouteEventReference,
  createRouteVerdict,
  createEndpoint,
  createNodeIsIssues,
  createResolution,
  createUniqueness,
  isScopeShape,
  isInterfaceScopeShape,
  isDefSymbolShape,
  isUseReferenceShape,
  isTypeDeclSymbolShape,
  isNodeTypeReferenceShape,
  isInterfaceMemberShape,
  isIsReferenceShape,
  isRouteNodeReferenceShape,
  isRouteEventReferenceShape,
  isResolved,
  isUnresolved,
  isAmbiguous,
  isInvalid,
  isRecovered,
};
