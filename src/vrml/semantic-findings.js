'use strict';
// Structured semantic findings (Phase WD1.6-D).
//
// The LAST sub-lane of WD1.6, and the narrowest: it introduces no semantics at
// all. Every fact it reports was already decided by P1/P2A/P2B/P2C, WD1.6-B or
// WD1.6-C; this module reads those verdicts and re-expresses them in ONE record
// shape a downstream consumer can enumerate, filter and route without knowing
// which of six queries produced any given answer.
//
// ---------------------------------------------------------------------------
// THE ONE THING THIS MODULE IS FOR
// ---------------------------------------------------------------------------
//
//   semantic truth / evidence  ->  SemanticFinding  ->  consumer policy  ->  UI
//                                  ^^^^^^^^^^^^^^^
//                                  this module, and only this
//
// It owns the middle. It does NOT own severity, message wording, visibility,
// suppression, grouping, icons, colours, notification, compatibility-mode UI, or
// whether an authoring action is allowed. Those are a later lane's (P4's, WD2's)
// decisions, and every one of them is UNREACHABLE from here: a finding carries
// no `severity`, no `message`, no `visible` and no presentation hint, and this
// module exports no function that would produce one. `test/vrml/
// semantic-findings.test.js` asserts that by source scan AND by behaviour,
// because prose in a comment does not prevent a well-meaning future edit.
//
// There is deliberately NO `toDiagnostic` adapter here. The plan (§8.1) proposed
// one, and the only policy-free version possible is a re-spelling of
// `diagnostics.makeDiagnostic(severity, code, message, range)` in which the
// caller supplies severity AND message -- i.e. it adds nothing but a place for a
// future default to grow, and it would force THIS lane to answer a question it
// must not: whether a finding code belongs in the same code universe as
// `diagnostics.CODE`'s `VRML0xx` strings. The plan explicitly authorises the
// alternative that was taken: the adaptation is demonstrated as a REFERENCE
// CONSUMER in the test file, and the production adapter belongs to P4.
//
// ---------------------------------------------------------------------------
// NO SECOND RESOLVER. NOT ONE.
// ---------------------------------------------------------------------------
//
// Every producer below reads a verdict and copies its `status`, its `reason` and
// its `detail` VERBATIM. Nothing here walks a scope, ranks candidates, expands
// an alias, derives a node class, compares two field types, or decides what a
// name denotes. If this module and the substrate ever disagree, the substrate is
// right and the derivation has a bug -- which is why `confidence` is the
// substrate's own STATUS rather than a value computed here.
//
// The one traversal that IS here is purely syntactic: `forEachSceneNode` finds
// the (parent, field, child) placements a document actually writes, so that
// WD1.6-C can be ASKED about them. It decides nothing; `childLegality` decides
// everything. Its shape -- scene-graph roots and node-valued fields only, never
// `ast.walk` -- is inherited from WD1.6-C's committed corpus harness for the
// reason recorded there: `ast.walk` descends into a PROTO interface
// declaration's DEFAULT VALUE, and a node written there is not a placement in
// the scene graph. P2A indexes no type reference for it, so asking WD1.6-B about
// it throws `ESCOPEPARSE`. That boundary is inherited, not widened.
//
// ---------------------------------------------------------------------------
// THE TWO AXES THAT MUST NEVER MERGE
// ---------------------------------------------------------------------------
//
//   iso         -- what ISO/IEC 14772-1 says about the construct.
//   confidence  -- how sure the substrate is that it read the construct right.
//
// They are orthogonal and both are always present. "The standard forbids this"
// and "we could prove what is written" are different claims, and a
// `PROHIBITED` finding whose `confidence` is `recovered` is one a consumer
// should probably suppress -- expressible only because both fields exist.
//
// A THIRD axis is RESERVED and currently always `null`: `compatibility`. Whether
// a given historical construct is strict VRML97, Blaxxun-specific,
// GLView-specific, Cybertown-specific or generic legacy VRML is an EVIDENCE
// question that has not been settled, and WD1.6-D does not guess it. No
// compatibility-profile identifier appears anywhere in this module or its public
// API. When a later lane establishes one from evidence, it fills this slot; it
// may never rewrite `iso`, because `iso` is computed from the reason alone by a
// table this module owns and nothing else can reach.
//
// ---------------------------------------------------------------------------
// LIFETIME
// ---------------------------------------------------------------------------
//
// A finding is a DERIVED, DISPOSABLE projection over ONE parse and ONE scope
// graph, exactly like a scope, a symbol or a containment verdict (WD.md §2). It
// is frozen, it holds the parser's own AST nodes and ranges by identity, and it
// has no identity of its own that survives a reparse. Nothing here is written
// into a document, cached across parses, or given a printable id. Holding a
// finding across a reparse is the WD1.4 cross-document mistake in a new costume.

const ast = require('./ast');
const scopeGraph = require('./scope-graph');
const containment = require('./containment');

const { STATUS, REASON, SCOPE_ERROR } = scopeGraph;
const { CONTAINMENT_STATUS } = containment;
const { NODE } = ast;

const EMPTY = Object.freeze([]);
const STANDARD = 'ISO/IEC 14772-1';

// ---------------------------------------------------------------------------
// What the standard says
// ---------------------------------------------------------------------------

/**
 * The ISO axis: what ISO/IEC 14772-1 says about the construct a finding is
 * about. NOT "is the file conforming" -- 7.2.1 answers that, and BOTH terminal
 * values below are conformance failures under it (7.2.1(2)-(3) for a violated
 * relationship, 7.2.1(7) for behaviour described as undefined). The distinction
 * kept here is WHICH NORMATIVE FORM the standard used, because that is what a
 * future compatibility argument turns on: "the standard declines to define this"
 * and "the standard forbids this" are different starting points.
 *
 * FAIL-CLOSED IN ONE DIRECTION ONLY. `NOT_STATED` is the weak claim and is
 * always safe; the two terminal values are positive claims about the standard
 * and are made only where a normative sentence in the repository's ISO mirror
 * supports them. An unmapped reason therefore falls back to `NOT_STATED`, never
 * to a violation -- and a test asserts the table is nonetheless total for every
 * reason a producer here can emit, so the fallback is a guard rather than a
 * shrug.
 */
const ISO_RESULT = Object.freeze({
  /**
   * A normative sentence states a requirement this construct violates -- a
   * `shall`, a "may not", a "may ... only", or an explicit "illegal"/"error".
   */
  PROHIBITED: 'prohibited',
  /** A normative sentence states that the results of this construct are undefined. */
  UNDEFINED: 'undefined',
  /**
   * This finding asserts NOTHING about the standard. Either the substrate could
   * not determine the facts, or no normative sentence in the mirrored standard
   * covers the construct. `rule` is always `null`.
   */
  NOT_STATED: 'not-stated',
});

/**
 * A citation. FACTS ONLY -- a standard, a clause and a WRL Forge-authored
 * description of what the clause is being cited FOR. No ISO prose is copied
 * here, the same rule WD1.3's schema extraction follows. Shaped to match
 * `nodeSchema.constraintRules` so there is one citation shape in `src/vrml/`.
 */
function citation(clause, description) {
  return Object.freeze({ standard: STANDARD, clause, description });
}

const CITE = Object.freeze({
  // 4.4.4 -- "results are undefined if a node in the transformation hierarchy is
  // its own ancestor".
  SELF_ANCESTOR: citation('4.4.4', 'a node in the transformation hierarchy may not be its own ancestor'),
  // 4.6.2 -- USE and ROUTE reference "a node given a name using the DEF keyword
  // ... later in the same file", within the stated name scope.
  DEF_USE: citation('4.6.2', 'a USE or ROUTE name denotes a preceding DEF within its name scope'),
  // 4.8.1 -- "Node type names shall be unique in each VRML file."
  TYPE_NAME_UNIQUE: citation('4.8.1', 'node type names shall be unique in each VRML file'),
  // 4.8.1 -- "The results are undefined if a prototype is given the same name as
  // a built-in node type or a previously defined prototype in the same scope."
  TYPE_NAME_SHADOWS: citation('4.8.1', 'a prototype taking a built-in node type name leaves the results undefined'),
  // 4.3.6 -- an IS statement names a member "from the node's public interface"
  // and a member "from the prototype's interface declaration", in the body of a
  // node statement "that is inside a prototype definition".
  IS_SYNTAX: citation('4.3.6', 'an IS statement names a member of the node interface and of the prototype interface, inside a prototype definition'),
  // 4.3.5 -- the PROTO interface declaration syntax an `exposedField zzz`
  // alongside an explicit `set_zzz`/`zzz_changed` violates.
  PROTO_INTERFACE_SYNTAX: citation('4.3.5', 'one PROTO interface declaration per effective member name'),
  // 4.8.3 -- "IS statements shall refer to fields or events defined in the
  // prototype declaration", Table 4.4 ("no denotes an error"), and the exact
  // type-match rule ("it is illegal to associate an SFColor with an SFVec3f").
  PROTO_IS_SEMANTICS: citation('4.8.3', 'IS statements shall refer to a declared interface member of a matching access and exact type'),
  // 4.8.3 -- the two multiplicity sentences, both "results are undefined".
  PROTO_IS_MULTIPLICITY: citation('4.8.3', 'one node member associated by more than one IS, or valued and IS-associated, leaves the results undefined'),
  // 4.8.4 -- "Nodes given a name by a DEF construct inside the prototype may not
  // be referenced in a USE construct outside of the prototype's scope", and the
  // converse.
  PROTO_SCOPE: citation('4.8.4', 'a PROTO establishes a DEF/USE name scope separate from the rest of the scene'),
  // 4.8.4 -- "A prototype may be instantiated in a file anywhere after the
  // completion of the prototype definition."
  PROTO_INSTANTIATION_ORDER: citation('4.8.4', 'a prototype may be instantiated only after its definition completes'),
  // 4.8.4 -- "recursive prototypes are illegal".
  PROTO_RECURSION: citation('4.8.4', 'a prototype may not be instantiated inside its own implementation'),
  // 4.10.2 -- "Nodes referenced in a ROUTE statement shall be defined before the
  // ROUTE statement."
  ROUTE_NODE_ORDER: citation('4.10.2', 'nodes referenced in a ROUTE shall be defined before the ROUTE statement'),
  // 4.10.2 -- "Routes may be established only from eventOuts to eventIns", and
  // the endpoint names the browser looks for.
  ROUTE_ENDPOINTS: citation('4.10.2', 'a ROUTE connects an existing eventOut to an existing eventIn'),
  // 4.10.2 -- "The types of the eventIn and the eventOut shall match exactly."
  ROUTE_TYPES: citation('4.10.2', 'the types of a ROUTE\'s eventIn and eventOut shall match exactly'),
  // A.2 -- the `interfaceDeclaration` production, which has no `IS` form.
  GRAMMAR_INTERFACE: citation('A.2', 'the interfaceDeclaration grammar production admits no IS form'),
  // A.3 -- a script body admits only `restrictedInterfaceDeclaration`.
  GRAMMAR_SCRIPT_INTERFACE: citation('A.3', 'a Script body admits only restrictedInterfaceDeclaration'),
  // 7.2.1(5) -- "No nodes appear in the VRML file other than those specified in
  // ISO/IEC 14772-1 ... or those defined by the PROTO or EXTERNPROTO entities."
  KNOWN_NODE_TYPES: citation('7.2.1', 'a node type is built-in or defined by a PROTO/EXTERNPROTO in the file'),
});

const stated = (iso, rule) => Object.freeze({ iso, rule });
const notStated = Object.freeze({ iso: ISO_RESULT.NOT_STATED, rule: null });

/**
 * reason -> what the standard says. THE ONLY PLACE the ISO axis is decided.
 *
 * Keyed on the substrate's own `REASON`, because that is the value that carries
 * the semantic claim; the finding code says WHICH question was asked, and the
 * reason says what the answer was. One reason means one thing wherever it is
 * returned -- `def-not-declared-in-scope` is the same 4.6.2 fact for a USE and
 * for a ROUTE (P2C reuses it deliberately), so it is classified once.
 *
 * EVERY entry is either `notStated` or carries a clause. There is no entry that
 * claims the standard forbids something without saying where.
 *
 * DELIBERATE UNDER-CLAIMS, recorded so they are visibly a decision:
 * `duplicate-def-in-scope` is `NOT_STATED` because 4.6.2 DEFINES that binding
 * (closest preceding) and it is WRL Forge, not the standard, that declines to
 * rank (WD.md §8.1); `is-type-unknown` and `route-type-unknown` are
 * `NOT_STATED` because an unidentifiable type token is a gap in what was read,
 * not a claim about the document; every recovery, EXTERNPROTO and
 * type-unresolved reason is `NOT_STATED` for the same reason.
 */
const ISO_BY_REASON = Object.freeze(Object.assign(Object.create(null), {
  [REASON.OK]: notStated,

  // --- node names (P1, and P2C's reuse of them) -------------------------
  [REASON.DEF_NOT_DECLARED_IN_SCOPE]: stated(ISO_RESULT.PROHIBITED, CITE.DEF_USE),
  [REASON.USE_BEFORE_DEF]: stated(ISO_RESULT.PROHIBITED, CITE.DEF_USE),
  [REASON.DEF_NOT_VISIBLE_ACROSS_PROTO_BOUNDARY]: stated(ISO_RESULT.PROHIBITED, CITE.PROTO_SCOPE),
  [REASON.DUPLICATE_DEF_IN_SCOPE]: notStated,
  [REASON.SELF_REFERENTIAL_USE]: stated(ISO_RESULT.UNDEFINED, CITE.SELF_ANCESTOR),
  [REASON.SELF_REFERENCE_OUTSIDE_TRANSFORMATION_HIERARCHY]: notStated,
  [REASON.MISSING_NAME]: notStated,
  [REASON.ROUTE_NODE_NOT_DEFINED_BEFORE_ROUTE]: stated(ISO_RESULT.PROHIBITED, CITE.ROUTE_NODE_ORDER),

  // --- node types (P2A) --------------------------------------------------
  [REASON.NODE_TYPE_IS_BUILTIN]: notStated,
  [REASON.NODE_TYPE_UNKNOWN]: stated(ISO_RESULT.PROHIBITED, CITE.KNOWN_NODE_TYPES),
  [REASON.PROTO_INSTANCE_BEFORE_DECLARATION]: stated(ISO_RESULT.PROHIBITED, CITE.PROTO_INSTANTIATION_ORDER),
  [REASON.DUPLICATE_PROTO_DECLARATION]: stated(ISO_RESULT.PROHIBITED, CITE.TYPE_NAME_UNIQUE),
  [REASON.PROTO_SHADOWS_BUILTIN]: stated(ISO_RESULT.UNDEFINED, CITE.TYPE_NAME_SHADOWS),
  [REASON.RECURSIVE_PROTO_INSTANCE]: stated(ISO_RESULT.PROHIBITED, CITE.PROTO_RECURSION),

  // --- recovery / provability -------------------------------------------
  [REASON.DOCUMENT_PARSE_INCOMPLETE]: notStated,
  [REASON.SCOPE_RECOVERED]: notStated,
  [REASON.PROTO_SCOPE_NOT_PROVABLE]: notStated,
  [REASON.PROTO_BODY_NOT_PROVABLE]: notStated,

  // --- interface members and IS (P2B) -----------------------------------
  [REASON.INTERFACE_MEMBER_NOT_DECLARED]: stated(ISO_RESULT.PROHIBITED, CITE.PROTO_IS_SEMANTICS),
  [REASON.DUPLICATE_INTERFACE_MEMBER]: stated(ISO_RESULT.PROHIBITED, CITE.PROTO_INTERFACE_SYNTAX),
  [REASON.IS_OUTSIDE_PROTO_BODY]: stated(ISO_RESULT.PROHIBITED, CITE.IS_SYNTAX),
  [REASON.IS_TARGET_NAME_MISSING]: notStated,
  [REASON.IS_ACCESS_INCOMPATIBLE]: stated(ISO_RESULT.PROHIBITED, CITE.PROTO_IS_SEMANTICS),
  [REASON.IS_TYPE_MISMATCH]: stated(ISO_RESULT.PROHIBITED, CITE.PROTO_IS_SEMANTICS),
  [REASON.IS_TYPE_UNKNOWN]: notStated,
  [REASON.DUPLICATE_IS_FOR_ENDPOINT]: stated(ISO_RESULT.UNDEFINED, CITE.PROTO_IS_MULTIPLICITY),
  [REASON.FIELD_VALUED_AND_IS]: stated(ISO_RESULT.UNDEFINED, CITE.PROTO_IS_MULTIPLICITY),
  [REASON.IS_ENDPOINT_NODE_TYPE_UNRESOLVED]: notStated,
  [REASON.IS_ENDPOINT_UNKNOWN_FIELD]: stated(ISO_RESULT.PROHIBITED, CITE.IS_SYNTAX),
  [REASON.EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE]: notStated,
  [REASON.INTERFACE_SCOPE_NOT_PROVABLE]: notStated,
  [REASON.INTERFACE_NOT_PROVABLE_FOR_REFERENCE]: notStated,
  [REASON.MEMBER_FOUND_IN_OUTER_INTERFACE_ONLY]: notStated,
  [REASON.MEMBER_VIA_IMPLICIT_ALIAS]: notStated,
  [REASON.EXPOSED_FIELD_IN_SCRIPT_INTERFACE]: stated(ISO_RESULT.PROHIBITED, CITE.GRAMMAR_SCRIPT_INTERFACE),
  [REASON.IS_IN_INTERFACE_DECLARATION_LIST]: stated(ISO_RESULT.PROHIBITED, CITE.GRAMMAR_INTERFACE),

  // --- ROUTE endpoints (P2C) --------------------------------------------
  [REASON.ROUTE_ENDPOINT_NODE_TYPE_UNRESOLVED]: notStated,
  [REASON.ROUTE_ENDPOINT_UNKNOWN_FIELD]: stated(ISO_RESULT.PROHIBITED, CITE.ROUTE_ENDPOINTS),
  [REASON.ROUTE_SOURCE_NOT_AN_EVENT_OUT]: stated(ISO_RESULT.PROHIBITED, CITE.ROUTE_ENDPOINTS),
  [REASON.ROUTE_DEST_NOT_AN_EVENT_IN]: stated(ISO_RESULT.PROHIBITED, CITE.ROUTE_ENDPOINTS),
  [REASON.ROUTE_TYPE_MISMATCH]: stated(ISO_RESULT.PROHIBITED, CITE.ROUTE_TYPES),
  [REASON.ROUTE_TYPE_UNKNOWN]: notStated,
  [REASON.ROUTE_ENDPOINT_VIA_SHORTHAND]: notStated,
  [REASON.ROUTE_ENDPOINT_VIA_IMPLICIT_ALIAS]: notStated,

  // --- query answers ----------------------------------------------------
  // Not producible by anything below -- it is what a uniqueness or
  // reference-index query answers when handed the wrong kind of object, and no
  // resolution ever carries it. Classified anyway so the table is TOTAL over
  // `REASON` and a future addition to that table has to be classified here
  // rather than silently falling through `isoFor`.
  [REASON.NOT_A_DEF_SYMBOL]: notStated,
}));

/**
 * The ISO axis for one reason. Unmapped falls back to the WEAKEST claim.
 *
 * This is the one branch in the module where a future omission could go
 * unnoticed, and it is aimed so that the omission costs a finding its ISO claim
 * rather than manufacturing one. `test/vrml/semantic-findings.test.js` asserts
 * the table is total over every reason the producers below can emit.
 */
function isoFor(reason) {
  const entry = ISO_BY_REASON[reason];
  return entry || notStated;
}

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/**
 * Stable finding codes -- WHICH SEMANTIC QUESTION failed, one code per question
 * the substrate actually answers. Never a severity, never a UI category, never
 * a message.
 *
 * The code is deliberately NOT a respelling of `REASON`. A finding carries BOTH:
 * the code says which of the substrate's queries produced it, and `reason` is
 * that query's own answer, verbatim. Minting one code per reason would be a
 * second taxonomy for facts `symbols.js` already names, and would have to be
 * kept in step with it forever.
 *
 * Values are stable strings; consumers, tests and docs key off them. Adding is
 * allowed, changing is not.
 */
const FINDING_CODE = Object.freeze({
  /** Which DEF does this USE name? (P1) */
  USE_NOT_BOUND: 'use-not-bound',
  /** Which type does this node instance name? (P2A) */
  NODE_TYPE_NOT_BOUND: 'node-type-not-bound',
  /** A local declaration takes a built-in node type's spelling. (P2A detail) */
  NODE_TYPE_SHADOWS_BUILTIN: 'node-type-shadows-builtin',
  /** Which interface member does this `IS`'s right-hand name denote? (P2B) */
  IS_TARGET_NOT_BOUND: 'is-target-not-bound',
  /** May this `IS` connection be made -- Table 4.4 and the exact-type rule? (P2B) */
  IS_CONNECTION_REJECTED: 'is-connection-rejected',
  /** 4.8.3's per-node `IS` multiplicity rules. (P2B) */
  IS_BINDING_ISSUE: 'is-binding-issue',
  /** The interface DECLARATION itself is outside Annex A's grammar. (P2B) */
  INTERFACE_DECLARATION_NONCONFORMING: 'interface-declaration-nonconforming',
  /** Which DEF does this ROUTE endpoint's node name denote? (P2C) */
  ROUTE_NODE_NOT_BOUND: 'route-node-not-bound',
  /** Which event does this ROUTE endpoint name, and can it serve its side? (P2C) */
  ROUTE_ENDPOINT_NOT_BOUND: 'route-endpoint-not-bound',
  /** May this whole ROUTE be connected -- the exact-type rule? (P2C) */
  ROUTE_CONNECTION_REJECTED: 'route-connection-rejected',
  /** May this child occupy this node-valued field? (WD1.6-C) */
  CHILD_NOT_PERMITTED: 'child-not-permitted',
});

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/**
 * What a finding is ABOUT. Frozen; every member nullable; NO KIND TABLE -- the
 * `code` is the discriminator, and a parallel `SUBJECT_KIND` enum would be a
 * second name for the same distinction.
 *
 * `node`, `reference` and `symbol` are the parser's / the graph's OWN objects,
 * held by identity and shared, never copied and never frozen here (freezing a
 * parse result would mutate the caller's input -- `symbols.js` records the same
 * contract). Their lifetime is this parse. There is NO structural path, NO
 * sibling index, NO fingerprint and NO hidden id: losing a subject after a
 * reparse is acceptable, returning the wrong one is not (WD.md §7).
 */
function createSubject(fields) {
  return Object.freeze({
    /** The AST node the finding is about. */
    node: fields.node || null,
    /** The enclosing node, where the finding is about a relationship. Else `null`. */
    parent: fields.parent || null,
    /** The graph's reference projection, where one exists. */
    reference: fields.reference || null,
    /** The graph's declaration projection, where one exists. */
    symbol: fields.symbol || null,
    /** The written name at issue, or `null`. */
    name: fields.name == null ? null : fields.name,
  });
}

/**
 * One structured semantic finding. FROZEN.
 *
 * Deliberately ABSENT, and asserted absent by test: `severity`, `message`,
 * `visible`, and any presentation hint / recommendation / importance /
 * suppression field. A consumer that wants any of those decides them itself.
 */
function createFinding(fields) {
  return Object.freeze({
    /** `FINDING_CODE.*` -- which semantic question this answers. */
    code: fields.code,
    subject: fields.subject,
    /**
     * The exact source span. The PARSER'S OWN `{start,end}` object, shared and
     * NOT frozen -- same contract as every other projection in `src/vrml/`.
     * Non-null whenever the underlying authority reported one.
     */
    range: fields.range || null,
    /** `ISO_RESULT.*` -- what the standard says. Never computed from `confidence`. */
    iso: fields.iso,
    /** The citation behind `iso`, or `null` when `iso` is `NOT_STATED`. */
    rule: fields.rule || null,
    /**
     * RESERVED. Always `null` in WD1.6-D.
     *
     * The slot a later, evidence-backed lane fills with a compatibility
     * attribution. `null` means NOT EVALUATED -- not "no profile accepts this",
     * and not "this is strict VRML97". Filling it may never change `iso`: the
     * ISO axis is derived from the reason by `ISO_BY_REASON` and from nothing
     * else, so an acceptance can sit beside the ISO fact but cannot rewrite it.
     */
    compatibility: fields.compatibility || null,
    /** `STATUS.*`, the substrate's own status, VERBATIM. Never recomputed here. */
    confidence: fields.confidence,
    /** The substrate's own `REASON` / `CONTAINMENT_REASON`, VERBATIM. */
    reason: fields.reason,
    /** The substrate's own non-binding `detail`, VERBATIM, or `null`. */
    detail: fields.detail == null ? null : fields.detail,
    /** The substrate's own evidence ranges, VERBATIM. Frozen, fresh. */
    evidence: Object.freeze(fields.evidence ? fields.evidence.slice() : []),
  });
}

/**
 * Build a finding from a code, a subject and a verdict-shaped answer.
 *
 * ONE construction path, so `iso` cannot be supplied by a producer: it is looked
 * up from the answer's own reason, here, every time. A producer that wanted to
 * assert a different ISO result would have to change the table, which is the
 * point.
 */
function finding(code, subject, range, answer) {
  const iso = isoFor(answer.reason);
  return createFinding({
    code,
    subject,
    range,
    iso: iso.iso,
    rule: iso.rule,
    compatibility: null,
    confidence: answer.status,
    reason: answer.reason,
    detail: answer.detail,
    evidence: answer.evidence,
  });
}

/**
 * Re-emit an existing finding with its reserved third-axis slot filled, and
 * NOTHING else changed.
 *
 * This exists so that the evidence-backed lane that fills that slot does not
 * become a SECOND finding-construction path. It cannot: every strict field is
 * copied VERBATIM from the finding it is handed, `createFinding` remains the
 * only constructor, and there is no parameter through which `iso`, `rule`,
 * `confidence`, `reason`, `detail`, `evidence`, `code`, `subject` or `range`
 * could be supplied. A caller that wanted a different ISO result would still
 * have to change `ISO_BY_REASON`, which is the property WD1.6-D bought.
 *
 * The input is NOT mutated -- findings are frozen, and the projection is a new
 * frozen record. Handing back the input unchanged when there is nothing to
 * attach keeps `null` meaning exactly what it meant before.
 *
 * NO PROFILE NAME, NO EVIDENCE TABLE AND NO CLASSIFICATION LIVES HERE. This
 * module still does not know what a profile is; it only knows that the slot is
 * opaque to it. Naming one is the evidence lane's job, in the evidence lane's
 * own module.
 *
 * @param {object} source A finding produced by this module.
 * @param {object|null} attachment The opaque record to place in the slot.
 * @returns {object} A new frozen finding, or `source` when `attachment` is null.
 */
function attachCompatibility(source, attachment) {
  if (attachment == null) return source;
  return createFinding({
    code: source.code,
    subject: source.subject,
    range: source.range,
    iso: source.iso,
    rule: source.rule,
    compatibility: attachment,
    confidence: source.confidence,
    reason: source.reason,
    detail: source.detail,
    evidence: source.evidence,
  });
}

/** A reference's own name span, falling back to the statement that carries it. */
function rangeOf(reference) {
  if (!reference) return null;
  return reference.range || (reference.node ? reference.node.range : null) || null;
}

// ---------------------------------------------------------------------------
// The syntactic placement traversal
// ---------------------------------------------------------------------------

/** Every node written directly into one field's value, in source order. */
function placementsIn(fieldValue) {
  if (!fieldValue || typeof fieldValue !== 'object') return EMPTY;
  if (fieldValue.type === NODE.NODE || fieldValue.type === NODE.USE) return [fieldValue];
  if (fieldValue.type === NODE.ARRAY && Array.isArray(fieldValue.items)) {
    return fieldValue.items.filter((i) => i
      && (i.type === NODE.NODE || i.type === NODE.USE));
  }
  return EMPTY;
}

/**
 * Every SCENE-GRAPH node occurrence, in source order -- deliberately NOT
 * `ast.walk`. See the module header: a node inside a PROTO interface
 * declaration's DEFAULT VALUE is not a placement in the scene graph, P2A indexes
 * no type reference for it, and WD1.6-B throws `ESCOPEPARSE` on it. Inherited
 * from WD1.6-C's committed corpus harness, where it ran over 8,246 documents
 * with zero throws.
 */
function forEachSceneNode(tree, visit) {
  const walkStatements = (statements) => {
    if (!Array.isArray(statements)) return;
    for (const statement of statements) {
      if (!statement || typeof statement !== 'object') continue;
      if (statement.type === NODE.NODE) walkNode(statement);
      else if (statement.type === NODE.PROTO) walkStatements(statement.body);
    }
  };
  const walkNode = (node) => {
    visit(node);
    if (!Array.isArray(node.fields)) return;
    for (const field of node.fields) {
      if (!field || typeof field !== 'object') continue;
      // A node body's ROUTE and PROTO statements land in `fields` too (WD.md §8).
      // Dispatch on `type`, never on position.
      if (field.type === NODE.PROTO) { walkStatements(field.body); continue; }
      if (field.type !== NODE.FIELD) continue;
      for (const child of placementsIn(field.value)) {
        if (child.type === NODE.NODE) walkNode(child);
      }
    }
  };
  walkStatements(tree && tree.statements);
}

// ---------------------------------------------------------------------------
// Producers
// ---------------------------------------------------------------------------
//
// WHAT PRODUCES A FINDING, AND WHAT DELIBERATELY DOES NOT.
//
// A finding is emitted when the substrate's answer about something the document
// ACTUALLY WRITES is either a positive problem or an answer it could not prove.
// A clean success produces nothing: `findingsForDocument` is not a log of every
// semantic operation, and a surface that reported every `resolved`/`ok`/`LEGAL`
// answer would bury the ones that matter under the ones that do not.
//
// Three DE-DUPLICATION rules, each structural rather than a reason list, because
// two findings for one underlying fact is the failure mode a consumer cannot
// undo:
//
//   1. `IS_CONNECTION_REJECTED` is emitted only when the `IS` target RESOLVED.
//      `computeIsVerdict` mirrors a failed right-hand resolution verbatim, so
//      without this gate every unbound `IS` would be reported twice.
//   2. `ROUTE_ENDPOINT_NOT_BOUND` is emitted only when its paired NODE reference
//      resolved. `resolveRouteEndpoint` propagates the node's status unchanged.
//   3. `ROUTE_CONNECTION_REJECTED` is emitted only when all four of the ROUTE's
//      sub-answers resolved -- i.e. the only remaining question was the
//      exact-type comparison, which nothing else reports. `routeVerdict`
//      otherwise mirrors the earliest failing sub-answer.
//
// CONTAINMENT IS THE ONE PRODUCER THAT FILTERS ON STATUS, and the reasoning is
// worth not re-deriving. `childLegality` withholds a verdict for two kinds of
// reason, and neither is a fact about the document:
//
//   * `UNSUPPORTED` (`containment-metadata-absent`,
//     `acceptance-rule-not-exclusion-complete`, `class-membership-not-
//     determined`) is a fact about WHAT WRL FORGE REPRESENTS. WD1.6-C measured
//     it at 64,220 of 2,234,200 corpus placements, 79% of them one PROTO's
//     user-declared fields. Reporting it per placement would tell an author
//     about the tool, repeatedly, in their document.
//   * `UNRESOLVED` / `AMBIGUOUS` / `RECOVERED` on a candidate restate a P1 or
//     P2A failure that `USE_NOT_BOUND` or `NODE_TYPE_NOT_BOUND` already reports
//     at the same source position -- rule 1's failure mode with extra steps.
//   * `INVALID` (`field-not-declared`, `field-not-node-valued`,
//     `field-name-is-event-alias`) is a fact about a field NAME, and WD1.6-D
//     would only ever see it for fields whose value happens to be a node.
//     Reporting "unknown field" for exactly the node-valued half of a document's
//     unknown fields is a partial signal, worse than none; a whole-document
//     unknown-field check is its own lane.
//
// So containment contributes `ILLEGAL` only -- the one containment answer that
// is provable, about the document, and reported nowhere else.

function useFindings(graph, out) {
  const references = scopeGraph.references(graph);
  const resolutions = scopeGraph.resolutions(graph);
  for (let i = 0; i < references.length; i += 1) {
    const reference = references[i];
    const answer = resolutions[i];
    if (!answer || answer.status === STATUS.RESOLVED) continue;
    out.push(finding(FINDING_CODE.USE_NOT_BOUND, createSubject({
      node: reference.node, reference, name: reference.name,
    }), rangeOf(reference), answer));
  }
}

function nodeTypeFindings(graph, out) {
  const references = scopeGraph.typeReferences(graph);
  const resolutions = scopeGraph.typeResolutions(graph);
  for (let i = 0; i < references.length; i += 1) {
    const reference = references[i];
    const answer = resolutions[i];
    if (!answer) continue;
    const subject = createSubject({
      node: reference.node, reference, symbol: answer.symbol, name: reference.name,
    });
    if (answer.status !== STATUS.RESOLVED) {
      out.push(finding(FINDING_CODE.NODE_TYPE_NOT_BOUND, subject, rangeOf(reference), answer));
      continue;
    }
    // A resolved binding carrying 4.8.1's shadowing observation. The BINDING is
    // correct and stays correct; what is reported is the standard's own
    // "results are undefined", which is why the detail becomes its own code
    // rather than degrading the answer it rides on.
    if (answer.detail === REASON.PROTO_SHADOWS_BUILTIN) {
      out.push(finding(FINDING_CODE.NODE_TYPE_SHADOWS_BUILTIN, subject, rangeOf(reference), {
        status: answer.status, reason: answer.detail, detail: null, evidence: answer.evidence,
      }));
    }
  }
}

function isFindings(graph, out) {
  const references = scopeGraph.isReferences(graph);
  const resolutions = scopeGraph.isResolutions(graph);
  const hosts = [];
  const seenHosts = new Set();
  for (let i = 0; i < references.length; i += 1) {
    const reference = references[i];
    const answer = resolutions[i];
    if (reference.hostNode && !seenHosts.has(reference.hostNode)) {
      seenHosts.add(reference.hostNode);
      hosts.push(reference.hostNode);
    }
    if (!answer) continue;
    const subject = createSubject({
      node: reference.node,
      parent: reference.hostNode,
      reference,
      symbol: answer.symbol,
      name: reference.name,
    });
    if (answer.status !== STATUS.RESOLVED) {
      out.push(finding(FINDING_CODE.IS_TARGET_NOT_BOUND, subject, rangeOf(reference), answer));
      continue;
    }
    // De-duplication rule 1. Only a RESOLVED target makes the connection verdict
    // a claim of its own rather than a mirror of the resolution above.
    const verdict = scopeGraph.isConnectionVerdict(graph, reference);
    if (!verdict || verdict.status === STATUS.RESOLVED) continue;
    // The whole `IS` statement, not just one of its two names: an access or type
    // rejection is a fact about the pair.
    const range = (reference.node && reference.node.range) || rangeOf(reference);
    out.push(finding(FINDING_CODE.IS_CONNECTION_REJECTED, createSubject({
      node: reference.node,
      parent: reference.hostNode,
      reference,
      symbol: verdict.member,
      name: reference.endpointName,
    }), range, verdict));
  }

  // 4.8.3's per-NODE multiplicity rules. Asked once per node that hosts an `IS`,
  // and only there -- the question is meaningless for a node that hosts none.
  for (const host of hosts) {
    const issues = scopeGraph.nodeIsBindingIssues(graph, host);
    if (!issues || issues.status !== STATUS.RESOLVED) continue;
    for (const issue of issues.issues) {
      out.push(finding(FINDING_CODE.IS_BINDING_ISSUE, createSubject({
        node: host, name: issue.endpointName,
      }), issue.evidence[0] || host.range, {
        status: issues.status, reason: issue.reason, detail: null, evidence: issue.evidence,
      }));
    }
  }
}

function interfaceDeclarationFindings(graph, out) {
  for (const member of scopeGraph.interfaceMembers(graph)) {
    if (!member.detail) continue;
    out.push(finding(FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING, createSubject({
      node: member.node, symbol: member, name: member.name,
    }), member.range || member.declRange, {
      // A declaration's classified observation is not a resolution: the member
      // IS declared, and P2B binds through it normally. `resolved` is the
      // substrate's own reading and is carried unchanged.
      status: STATUS.RESOLVED, reason: member.detail, detail: null, evidence: EMPTY,
    }));
  }
}

function routeFindings(graph, out) {
  const nodeAnswerByReference = new Map();
  for (const reference of scopeGraph.routeNodeReferences(graph)) {
    const answer = scopeGraph.resolveRouteNode(graph, reference);
    nodeAnswerByReference.set(reference, answer);
    if (!answer || answer.status === STATUS.RESOLVED) continue;
    out.push(finding(FINDING_CODE.ROUTE_NODE_NOT_BOUND, createSubject({
      node: reference.node, reference, name: reference.name,
    }), rangeOf(reference), answer));
  }

  const eventAnswerByReference = new Map();
  for (const reference of scopeGraph.routeEventReferences(graph)) {
    const answer = scopeGraph.resolveRouteEndpoint(graph, reference);
    eventAnswerByReference.set(reference, answer);
    if (!answer || answer.status === STATUS.RESOLVED) continue;
    // De-duplication rule 2.
    const paired = nodeAnswerByReference.get(reference.nodeReference);
    if (!paired || paired.status !== STATUS.RESOLVED) continue;
    out.push(finding(FINDING_CODE.ROUTE_ENDPOINT_NOT_BOUND, createSubject({
      node: reference.node, reference, name: reference.name,
    }), rangeOf(reference), answer));
  }

  // De-duplication rule 3. `routeReferences` groups per ROUTE as source-node,
  // destination-node, source-event, destination-event -- a documented reading
  // order, used here only to pair the four answers with their statement.
  const grouped = scopeGraph.routeReferences(graph);
  for (let i = 0; i + 3 < grouped.length; i += 4) {
    const [srcNode, dstNode, srcEvent, dstEvent] = grouped.slice(i, i + 4);
    const allResolved = [
      nodeAnswerByReference.get(srcNode), nodeAnswerByReference.get(dstNode),
      eventAnswerByReference.get(srcEvent), eventAnswerByReference.get(dstEvent),
    ].every((a) => a && a.status === STATUS.RESOLVED);
    if (!allResolved) continue;
    const verdict = scopeGraph.routeVerdict(graph, srcNode.node);
    if (!verdict || verdict.status === STATUS.RESOLVED) continue;
    out.push(finding(FINDING_CODE.ROUTE_CONNECTION_REJECTED, createSubject({
      node: verdict.node,
    }), verdict.node ? verdict.node.range : null, verdict));
  }
}

function containmentFindings(graph, tree, out) {
  forEachSceneNode(tree, (node) => {
    if (!Array.isArray(node.fields)) return;
    for (const field of node.fields) {
      if (!field || field.type !== NODE.FIELD || field.name == null) continue;
      for (const candidate of placementsIn(field.value)) {
        const verdict = containment.childLegality(graph, node, field.name, candidate);
        if (verdict.status !== CONTAINMENT_STATUS.ILLEGAL) continue;
        // WD1.6-C's OWN citation, carried through. D mints no containment rule
        // of its own and has no table entry for these reasons: the verdict knows
        // which normative rule excluded the candidate, and re-deriving it here
        // would be a second authority for the same fact.
        const rule = verdict.ruleSource && verdict.ruleSource.length
          ? Object.freeze({
            standard: verdict.ruleSource[0].standard,
            clause: verdict.ruleSource[0].clause,
            description: verdict.ruleSource[0].description,
          })
          : null;
        out.push(createFinding({
          code: FINDING_CODE.CHILD_NOT_PERMITTED,
          subject: createSubject({
            node: candidate, parent: node, name: field.name,
          }),
          range: candidate.range || null,
          iso: ISO_RESULT.PROHIBITED,
          rule,
          compatibility: null,
          confidence: STATUS.RESOLVED,
          reason: verdict.reason,
          detail: null,
          evidence: EMPTY,
        }));
      }
    }
  });
}

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

// A range is the parser's `{start:{offset,line,column}, end:{...}}`; the ORDER
// key is the byte offset, the same accessor shape `scope-graph.js` uses. A
// finding with no range sorts last rather than first, so an unanchored answer
// never displaces an anchored one.
const offsetOf = (range) => (range && range.start ? range.start.offset : Infinity);
const endOf = (range) => (range && range.end ? range.end.offset : Infinity);
const byCodepoint = (a, b) => {
  const x = a == null ? '' : String(a);
  const y = b == null ? '' : String(b);
  return x < y ? -1 : (x > y ? 1 : 0);
};

/**
 * Every semantic finding in one document. Frozen, fresh, DETERMINISTIC.
 *
 * Source-ordered by span start, then span end, then code, then reason, then
 * name -- a total order with no clock, no PRNG and no dependence on producer
 * execution order, so two runs over one graph return identical arrays.
 *
 * @param {object} graph A scope graph from `buildScopeGraph`.
 * @returns {ReadonlyArray<object>} Frozen findings; empty when nothing is wrong.
 * @throws {Error} `ESCOPEGRAPH` for anything that is not a scope graph from this
 *   module's own `buildScopeGraph` -- WD1.4's rule, unchanged: a foreign or
 *   cross-document object is a programming error and fails loudly rather than
 *   degrading into an empty answer.
 */
function findingsForDocument(graph) {
  if (!scopeGraph.isScopeGraph(graph)) {
    const err = new Error('findingsForDocument: expected a scope graph from buildScopeGraph');
    err.code = SCOPE_ERROR.GRAPH;
    throw err;
  }
  const out = [];
  useFindings(graph, out);
  nodeTypeFindings(graph, out);
  isFindings(graph, out);
  interfaceDeclarationFindings(graph, out);
  routeFindings(graph, out);
  // The document tree, reached through the graph's OWN document scope, so a
  // caller cannot hand this query a tree from a different parse than the graph.
  const documentScope = scopeGraph.documentScope(graph);
  containmentFindings(graph, documentScope ? documentScope.ownerNode : null, out);

  out.sort((a, b) => {
    const sa = offsetOf(a.range);
    const sb = offsetOf(b.range);
    if (sa !== sb) return sa - sb;
    const ea = endOf(a.range);
    const eb = endOf(b.range);
    if (ea !== eb) return ea - eb;
    return byCodepoint(a.code, b.code)
      || byCodepoint(a.reason, b.reason)
      || byCodepoint(a.subject.name, b.subject.name);
  });
  return Object.freeze(out);
}

module.exports = {
  ISO_RESULT,
  FINDING_CODE,
  findingsForDocument,
  // The slot-filling projection. Internal: deliberately NOT on the facade, so
  // the lane that uses it stays consumer-free exactly like P1/P2A/P2B/P2C.
  attachCompatibility,
  // Internal, for this lane's own tests: the ISO classification table and the
  // producer-reachable reason set. NOT published on `src/vrml/index.js`.
  ISO_BY_REASON,
};
