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
// than implied, even though WD1.5-P1 populates only the first:
//
//   node name        -- DEF names; USE and ROUTE endpoints look here.
//   node type        -- PROTO / EXTERNPROTO declaration names.
//   interface member -- PROTO and Script field/eventIn/eventOut/exposedField.
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
// P1 implements DEF/USE only. The constant tables below are therefore NOT all
// the same shape, deliberately:
//
//   * SCOPE_KIND / SYMBOL_KIND / REFERENCE_KIND list ONLY what P1 constructs.
//     Publishing a `proto-interface` scope kind that nothing ever creates would
//     advertise support that does not exist. WD1.5-P2 adds the remaining kinds
//     from the committed plan (§3) additively.
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
});

/** Declaration kinds P1 constructs. */
const SYMBOL_KIND = Object.freeze({
  NODE_DEF: 'node-def',
});

/** Reference kinds P1 constructs. */
const REFERENCE_KIND = Object.freeze({
  USE: 'use',
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

  // --- recovery / provability ------------------------------------------
  /** A hard parse cap fired: no lexical scope in the document is provable. */
  DOCUMENT_PARSE_INCOMPLETE: 'document-parse-incomplete',
  /** A syntax error lands inside this scope, so its extent is unprovable. */
  SCOPE_RECOVERED: 'scope-recovered',
  /** A PROTO the parse could not name owns this scope. */
  PROTO_SCOPE_NOT_PROVABLE: 'proto-scope-not-provable',
  /** Annex A `protoBody` requires >= 1 node statement; this body has none. */
  PROTO_BODY_NOT_PROVABLE: 'proto-body-not-provable',

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

const isScopeShape = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && (v.kind === SCOPE_KIND.DOCUMENT || v.kind === SCOPE_KIND.PROTO_BODY);
const isDefSymbolShape = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && v.kind === SYMBOL_KIND.NODE_DEF && v.namespace === NAMESPACE.NODE_NAME;
const isUseReferenceShape = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && v.kind === REFERENCE_KIND.USE && v.namespace === NAMESPACE.NODE_NAME;

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
  STATUS,
  REASON,
  scopeError,
  brand,
  ownerOf,
  belongsTo,
  createScope,
  createDefSymbol,
  createUseReference,
  createResolution,
  createUniqueness,
  isScopeShape,
  isDefSymbolShape,
  isUseReferenceShape,
  isResolved,
  isUnresolved,
  isAmbiguous,
  isInvalid,
  isRecovered,
};
