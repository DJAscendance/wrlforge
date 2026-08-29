'use strict';
// WD1.6-C -- containment legality.
//
// One question, for a consumer that has to decide whether a node may occupy a
// node-valued field:
//
//   May this candidate legally occupy `parent.fieldName`?
//
// THIS MODULE IS NOT A RESOLVER AND NOT A VALIDATOR. It owns no lexical rule, no
// type resolution, no interface lookup and no diagnostic policy. Every fact it
// reasons from was produced by an existing authority:
//
//   * WD1.6-B `effectiveInterfaceOf` -- which field the parent actually has.
//   * WD1.5-P2A `interfaceSourceOf`  -- what a candidate's node type resolves to.
//   * WD1.5-P1  `resolve`            -- what a `USE` names.
//   * WD1.6-A   `node-schema`        -- the standards-derived acceptance metadata.
//
// What this module contributes is the JUDGEMENT: combining those facts into a
// status-bearing verdict, and -- far more importantly -- refusing to produce one
// when the facts do not support it.
//
// THE HARD RULE (WD.md §7, applied to containment):
//
//   `ILLEGAL` is a positive claim, exactly as `LEGAL` is. It is returned only
//   when a normative rule that is EXCLUSION-COMPLETE positively excludes a
//   candidate whose type is PROVEN. It is never the fallback branch. Missing
//   metadata, an unprovable candidate type, an EXTERNPROTO, a recovered PROTO
//   body and an unrepresented node class all return uncertainty instead.
//
// A false `ILLEGAL` would let a future scene tree refuse an edit the standard
// permits, silently, on the strength of a gap in this repository's metadata.
// That is the worst failure this module can have, and every branch below is
// arranged so that the uncertain answer is the cheap one to reach.
//
// STRICT VRML97 ONLY. No Cybertown, Mall, Blaxxun or X3D acceptance rules, and
// no compatibility-profile identifiers -- profile naming is WD1.6-D's to
// adjudicate. Legality here is observable on its own terms so a later profile
// layer can wrap it rather than dilute it.
//
// NO CREATION. C answers legality and produces no source text, no node, no
// default and no patch. Insertion is WD2's.
//
// Pure and browser-safe: no fs, no Electron, no renderer dependency.

const scopeGraph = require('./scope-graph');
const nodeSchema = require('./node-schema');
const interfaceQuery = require('./interface-query');
const { NODE } = require('./ast');

const {
  STATUS, REASON, ENDPOINT_ORIGIN,
  interfaceSourceOf, resolve, referenceFor,
} = scopeGraph;

const EMPTY = Object.freeze([]);

/**
 * The verdict vocabulary.
 *
 * The two terminal containment answers are new because no existing status means
 * them. Every UNCERTAIN value is `STATUS`'s own string, deliberately: a consumer
 * that already branches on a scope-graph status must not have to learn a second
 * spelling of `unresolved`, and `containment.test.js` pins the identity so the
 * two tables cannot drift apart.
 *
 * There is no boolean accessor and no `isAllowed()`. Five of these seven values
 * are not booleans, and offering a coercion is how uncertainty gets silently
 * spent as permission.
 */
const CONTAINMENT_STATUS = Object.freeze({
  /** Proven: a normative rule positively admits this candidate. */
  LEGAL: 'legal',
  /** Proven: an exclusion-complete normative rule positively excludes it. */
  ILLEGAL: 'illegal',
  /** The language is understood; THIS semantic fact is not represented here. */
  UNSUPPORTED: STATUS.UNSUPPORTED,
  /** Something that had to be proven could not be. */
  UNRESOLVED: STATUS.UNRESOLVED,
  /** More than one candidate answer; this module refuses to choose. */
  AMBIGUOUS: STATUS.AMBIGUOUS,
  /** The question itself is ill-formed -- caller error, not a legality claim. */
  INVALID: STATUS.INVALID,
  /** Parser recovery moved the boundaries the answer would have depended on. */
  RECOVERED: STATUS.RECOVERED,
});

const CONTAINMENT_REASON = Object.freeze({
  OK: 'ok',

  // --- the question is ill-formed (INVALID) -----------------------------
  /** `parent` is not a node occurrence in this graph's parse. */
  PARENT_NOT_A_NODE: 'parent-not-a-node',
  /** No field of that name is declared on the parent's effective interface. */
  FIELD_NOT_DECLARED: 'field-not-declared',
  /**
   * The name is an event alias (`set_zzz` / `zzz_changed`), not a declaration.
   *
   * 4.7 expansion gives an `exposedField` two extra names; neither of them is
   * child STORAGE, so asking about containment through one is a category error
   * rather than a fact about the child.
   */
  FIELD_NAME_IS_EVENT_ALIAS: 'field-name-is-event-alias',
  /** The declaration exists but is not SFNode/MFNode. Containment cannot apply. */
  FIELD_NOT_NODE_VALUED: 'field-not-node-valued',
  /** The candidate is not a node occurrence, a `USE`, or a type name. */
  CANDIDATE_NOT_A_NODE: 'candidate-not-a-node',

  // --- the parent side could not be proven ------------------------------
  /** WD1.6-B could not prove the parent's interface at all. */
  PARENT_INTERFACE_NOT_PROVABLE: 'parent-interface-not-provable',
  /** The written name has more than one declaration (4.3.5 prohibits it). */
  FIELD_BINDING_AMBIGUOUS: 'field-binding-ambiguous',

  // --- the metadata does not reach (UNSUPPORTED) ------------------------
  /**
   * The field is node-valued and WD1.6-A records no acceptance metadata for it.
   *
   * NOT "unrestricted" and NOT "forbidden". `constraints: null` is an absence of
   * representation, which is why this is `UNSUPPORTED` rather than either
   * terminal answer.
   */
  CONTAINMENT_METADATA_ABSENT: 'containment-metadata-absent',
  /**
   * The acceptance rule proves what IS accepted, not what is not.
   *
   * Absence from a positive-only list is not exclusion, so a non-matching
   * candidate is unproven rather than illegal. See `EXCLUSION_COMPLETE_RULES`.
   */
  ACCEPTANCE_RULE_NOT_EXCLUSION_COMPLETE: 'acceptance-rule-not-exclusion-complete',
  /**
   * The candidate is in neither the class nor its normative complement.
   *
   * ISO 4.6.5 lists 32 children nodes and 20 nodes "not valid as children" -- 52
   * of VRML97's 54. `FontStyle` and `PixelTexture` appear in neither list, so
   * for them the standard as mirrored here simply does not say.
   */
  CLASS_MEMBERSHIP_NOT_DETERMINED: 'class-membership-not-determined',
  /** 4.9: an EXTERNPROTO's implementation is not present, so 4.8.3 cannot run. */
  EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE: 'externproto-class-not-locally-verifiable',

  // --- the candidate side could not be proven ---------------------------
  /** P2A did not resolve the candidate's node type. Its own verdict is carried. */
  CANDIDATE_TYPE_NOT_PROVABLE: 'candidate-type-not-provable',
  /** A `USE` whose DEF P1 declined to bind. */
  CANDIDATE_USE_NOT_PROVABLE: 'candidate-use-not-provable',
  /** A bare type-name string that is not a clause-6 built-in. */
  CANDIDATE_TYPE_NAME_NOT_BUILTIN: 'candidate-type-name-not-builtin',
  /** Recovery moved the PROTO body's boundaries; its "first node" is not the author's. */
  PROTO_BODY_NOT_PROVABLE: 'proto-body-not-provable',
  /** 4.8.3 requires one or more nodes; this body has none to classify. */
  PROTO_BODY_HAS_NO_FIRST_NODE: 'proto-body-has-no-first-node',
  /** Class derivation re-entered a PROTO it was already deriving. */
  PROTO_CLASS_CYCLE: 'proto-class-cycle',

  // --- terminal verdicts ------------------------------------------------
  /** The candidate's type is in the field's exact accepted-type set. */
  ACCEPTED_EXACT_TYPE: 'accepted-exact-type',
  /** The candidate's type is a member of an accepted node class. */
  ACCEPTED_NODE_CLASS: 'accepted-node-class',
  /** A complete exact-type set does not contain the candidate's type. */
  EXCLUDED_BY_EXACT_TYPE_SET: 'excluded-by-exact-type-set',
  /** The candidate is in the accepted class's normative complement. */
  EXCLUDED_BY_NODE_CLASS: 'excluded-by-node-class',
});

/**
 * Which WD1.6-A acceptance rules can carry a NEGATIVE conclusion.
 *
 * This is the single most safety-critical table in the module, and it is
 * deliberately a whitelist keyed on the rule id WD1.6-A already emits -- not an
 * inference from the shape of the metadata, and not a per-field adjudication
 * kept here. A rule absent from this set still proves `LEGAL`; it simply cannot
 * prove `ILLEGAL`.
 *
 *   `table-4.3` -- ISO/IEC 14772-1, 4.6.5. Table 4.3 is titled "Nodes with
 *   SFNode or MFNode fields" and its third column is headed "Valid Node Types
 *   for Field". A cell is therefore a normative statement of WHICH node types
 *   are valid for that field, so a type absent from a present row's cell is not
 *   valid for it. (The table's ROW set is a separate matter and is NOT relied on
 *   here: the standard's own claim that it "lists all node types that reference
 *   other nodes through fields" is demonstrably incomplete -- `PointSet` has two
 *   SFNode fields and no row. Row incompleteness only ever produces a field with
 *   no metadata, which returns `UNSUPPORTED` regardless.)
 *
 *   `clause-6-sentence` -- POSITIVE-ONLY here, and the omission is deliberate.
 *   Its three current fields (`Appearance.textureTransform`, `PointSet.color`,
 *   `PointSet.coord`) were each read against the ISO mirror and each IS in fact
 *   exclusive ("shall contain a TextureTransform node"; "the results are
 *   undefined if the coord field specifies any other type of node"). But the
 *   rule ID is what the metadata carries, and the id covers four sentence
 *   TEMPLATES, one of which is indicative ("contains a X node") rather than
 *   mandatory. A future regeneration could therefore attach this id to a merely
 *   descriptive sentence, and this table would silently start proving negatives
 *   from it. Certifying exclusivity per field belongs in the generator's
 *   provenance, where it can be re-derived from the source text; asserting it
 *   here would be this module inventing a completeness fact. See the WD1.6-C
 *   report for the recommended A-extension.
 */
const EXCLUSION_COMPLETE_RULES = Object.freeze(['table-4.3']);

/**
 * The normative COMPLEMENT of an accepted node class -- membership in it
 * positively excludes.
 *
 * ISO 4.6.5 states two adjacent lists: "The following node types are children
 * nodes" and "The following node types are not valid as children nodes". The
 * second is an explicit prohibition, which is what makes exclusion provable for
 * this class; absence from the FIRST list would prove nothing.
 *
 * SCOPED TO THE CLASS THAT PAIRS WITH IT, ON PURPOSE. `notValidAsChildren` is
 * not a global veto: a `Box` is "not valid as a children node" and is
 * simultaneously the correct occupant of `Shape.geometry`. Inverting it into a
 * universal `ILLEGAL` for every SFNode/MFNode field is the exact defect WD.md §7
 * describes, and `containment.test.js` guards against it directly.
 */
const CLASS_COMPLEMENT = Object.freeze({ __proto__: null, children: 'notValidAsChildren' });

/** How a candidate's node type is realized. */
const CANDIDATE_KIND = Object.freeze({
  BUILTIN: 'builtin',
  PROTO: 'proto',
  EXTERNPROTO: 'externproto',
});

const freezeList = (values) => Object.freeze(values ? values.slice() : []);

function containmentError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// --- verdict construction ---------------------------------------------------

function createField(binding, member) {
  if (!member) return null;
  const type = member.type == null ? null : member.type;
  return Object.freeze({
    name: member.name,
    /** The written name the caller asked about; equals `name` unless aliased. */
    writtenName: binding ? binding.writtenName : member.name,
    type,
    /** `SFNode`/`MFNode` when node-valued, else `null`. Never inferred elsewhere. */
    arity: type === 'SFNode' || type === 'MFNode' ? type : null,
    access: member.access == null ? null : member.access,
    declarationOrigin: member.declarationOrigin,
  });
}

function createRequired(constraints) {
  if (!constraints) return null;
  const types = constraints.acceptedNodeTypes || null;
  const classes = constraints.acceptedNodeClasses || null;
  if (!types && !classes) return null;
  const rules = freezeList(constraints.rules);
  return Object.freeze({
    acceptedNodeTypes: types ? freezeList(types) : null,
    acceptedNodeClasses: classes ? freezeList(classes) : null,
    rules,
    /**
     * May a non-match support `ILLEGAL`?
     *
     * EVERY rule cited must be exclusion-complete, not merely one of them: a
     * record citing both a complete and a positive-only source knows less than
     * the complete one alone would suggest.
     */
    exclusionComplete: rules.length > 0
      && rules.every((id) => EXCLUSION_COMPLETE_RULES.includes(id)),
  });
}

function createCandidate(fields) {
  return Object.freeze({
    /** Exactly what the caller passed -- AST node, `USE`, or type-name string. */
    given: fields.given === undefined ? null : fields.given,
    /** The proven built-in type name legality is judged on, or `null`. */
    nodeType: fields.nodeType == null ? null : fields.nodeType,
    kind: fields.kind == null ? null : fields.kind,
    /** WD1.6-A class memberships of `nodeType`. Empty when unproven. */
    classes: freezeList(fields.classes),
    /**
     * 4.8.3 derivation chain, outermost first, ending at the built-in type.
     *
     * `['MyProto', 'Inner', 'Transform']` says: a `MyProto` instantiates as an
     * `Inner`, which instantiates as a `Transform`. Empty for a direct built-in.
     */
    derivation: freezeList(fields.derivation),
    status: fields.status,
    reason: fields.reason,
  });
}

function ruleSourceFor(required) {
  if (!required) return EMPTY;
  const out = [];
  for (const id of required.rules) {
    const record = nodeSchema.constraintRules[id];
    if (!record) continue;
    out.push(Object.freeze({
      id,
      standard: record.standard,
      clause: record.clause,
      description: record.description,
    }));
  }
  return Object.freeze(out);
}

function createVerdict(fields) {
  return Object.freeze({
    status: fields.status,
    reason: fields.reason,
    /** The parent AST node, by identity. Shared, never frozen -- it is the parse's. */
    parent: fields.parent === undefined ? null : fields.parent,
    field: fields.field || null,
    /** Convenience mirror of `field.arity`; `null` whenever the field is not node-valued. */
    arity: fields.field && fields.field.arity ? fields.field.arity : null,
    required: fields.required || null,
    candidate: fields.candidate || null,
    ruleSource: fields.ruleSource || EMPTY,
  });
}

// --- candidate type resolution ---------------------------------------------
//
// Every branch delegates. Nothing here reads a scope, walks a chain, or decides
// which of two declarations wins.

/**
 * P2A's verdict for one node occurrence, reduced to what containment needs.
 *
 * `interfaceSourceOf` is the SAME authority WD1.6-B enumerates through, so a
 * candidate can never be classified here in a way that contradicts the interface
 * a consumer would be shown for it.
 */
function classifyOccurrence(graph, astNode) {
  const source = interfaceSourceOf(graph, astNode);
  if (!source) return { kind: null, status: STATUS.INVALID, reason: CONTAINMENT_REASON.CANDIDATE_NOT_A_NODE };
  if (source.typeStatus !== STATUS.RESOLVED) {
    // P2A's OWN verdict, so `ambiguous` (two declarations) stays distinguishable
    // from `unresolved` (no such type). Neither ever becomes ILLEGAL.
    return { kind: null, status: source.typeStatus, reason: CONTAINMENT_REASON.CANDIDATE_TYPE_NOT_PROVABLE };
  }
  if (source.origin === ENDPOINT_ORIGIN.EXTERNPROTO_INTERFACE) {
    return {
      kind: CANDIDATE_KIND.EXTERNPROTO,
      status: STATUS.UNSUPPORTED,
      reason: CONTAINMENT_REASON.EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE,
      nodeType: source.nodeType,
    };
  }
  if (source.origin === ENDPOINT_ORIGIN.PROTO_INTERFACE) {
    return { kind: CANDIDATE_KIND.PROTO, status: STATUS.RESOLVED, nodeType: source.nodeType, decl: source.decl };
  }
  // BUILTIN_SCHEMA / SCRIPT_INTERFACE -- both are the clause-6 node `Script`
  // included. The interface origin differs; the node TYPE does not.
  return { kind: CANDIDATE_KIND.BUILTIN, status: STATUS.RESOLVED, nodeType: source.nodeType };
}

/**
 * The first NODE of a PROTO body -- ISO/IEC 14772-1, 4.8.3.
 *
 *   "A prototype definition consists of one or more nodes, nested PROTO
 *    statements, and ROUTE statements. The first node type determines how
 *    instantiations of the prototype can be used in a VRML file."
 *
 * "The first NODE", not the first statement: a leading `ROUTE` or nested `PROTO`
 * is skipped because 4.8.3 names them as separate body constituents. A leading
 * `USE` is returned as-is and resolved by the caller through P1 -- this function
 * classifies nothing.
 */
function firstBodyNode(protoAstNode) {
  const body = protoAstNode && Array.isArray(protoAstNode.body) ? protoAstNode.body : null;
  if (!body) return null;
  for (const statement of body) {
    if (!statement || typeof statement !== 'object') continue;
    if (statement.type === NODE.NODE || statement.type === NODE.USE) return statement;
  }
  return null;
}

/**
 * The PROTO_BODY scope a `Proto` declaration owns, or `null`.
 *
 * `scopeOf` answers for a DEF-bearing AST node, not for a declaration, so the
 * owner link is read off the graph's own published scope list instead. Cached
 * per graph because the corpus harness asks this of the same few declarations
 * many thousands of times; the cache is keyed on the opaque graph handle and
 * holds only objects that graph already owns.
 *
 * A LOOKUP, NOT A TRAVERSAL. It reads what `buildScopeGraph` recorded and
 * decides nothing.
 */
const BODY_SCOPE_INDEX = new WeakMap();

function protoBodyScopeFor(graph, protoAstNode) {
  let index = BODY_SCOPE_INDEX.get(graph);
  if (!index) {
    index = new WeakMap();
    for (const scope of scopeGraph.scopes(graph)) {
      if (scope.kind === scopeGraph.SCOPE_KIND.PROTO_BODY && scope.ownerNode) {
        index.set(scope.ownerNode, scope);
      }
    }
    BODY_SCOPE_INDEX.set(graph, index);
  }
  return index.get(protoAstNode) || null;
}

/**
 * Follow 4.8.3 until a built-in type is reached, or until something is unproven.
 *
 * The cycle guard is keyed on the PROTO DECLARATION, not on the type name: two
 * unrelated PROTOs may legitimately share a spelling in disjoint scopes (4.8.4),
 * and a name-keyed guard would call that a cycle. Re-entering a declaration this
 * walk is already inside is the actual cycle, and it withholds rather than
 * picking one of the two answers.
 */
function resolveCandidateType(graph, astNode) {
  const derivation = [];
  const seenDecls = new Set();
  let current = astNode;

  for (;;) {
    const info = classifyOccurrence(graph, current);
    if (info.kind !== CANDIDATE_KIND.PROTO) {
      return {
        kind: info.kind,
        nodeType: info.nodeType == null ? null : info.nodeType,
        status: info.status,
        reason: info.reason,
        derivation,
      };
    }

    derivation.push(info.nodeType);
    const decl = info.decl;
    if (!decl || seenDecls.has(decl)) {
      return {
        kind: CANDIDATE_KIND.PROTO,
        nodeType: null,
        status: STATUS.UNRESOLVED,
        reason: CONTAINMENT_REASON.PROTO_CLASS_CYCLE,
        derivation,
      };
    }
    seenDecls.add(decl);

    // Recovery moved the body's boundaries, so its "first node" may be a
    // statement the author never put there -- an unclosed PROTO absorbs whatever
    // follows it. An upfront gate, as everywhere else in this lane: a recovered
    // body withholds the positive answer too.
    const bodyScope = decl.node ? protoBodyScopeFor(graph, decl.node) : null;
    if (!decl.node || !bodyScope || bodyScope.recovered) {
      return {
        kind: CANDIDATE_KIND.PROTO,
        nodeType: null,
        status: STATUS.RECOVERED,
        reason: CONTAINMENT_REASON.PROTO_BODY_NOT_PROVABLE,
        derivation,
      };
    }

    const first = firstBodyNode(decl.node);
    if (!first) {
      return {
        kind: CANDIDATE_KIND.PROTO,
        nodeType: null,
        status: STATUS.UNRESOLVED,
        reason: CONTAINMENT_REASON.PROTO_BODY_HAS_NO_FIRST_NODE,
        derivation,
      };
    }

    const next = first.type === NODE.USE ? resolveUse(graph, first) : first;
    if (!next) {
      return {
        kind: CANDIDATE_KIND.PROTO,
        nodeType: null,
        status: STATUS.UNRESOLVED,
        reason: CONTAINMENT_REASON.CANDIDATE_USE_NOT_PROVABLE,
        derivation,
      };
    }
    current = next;
  }
}

/** P1's answer for one `USE`, or `null` when P1 declined to bind it. */
function resolveUse(graph, useAstNode) {
  if (!referenceFor(graph, useAstNode)) return null;
  const resolution = resolve(graph, useAstNode);
  if (!resolution || resolution.status !== STATUS.RESOLVED) return null;
  const symbol = resolution.symbol;
  return symbol && symbol.node ? symbol.node : null;
}

// --- acceptance -------------------------------------------------------------

/**
 * Judge a PROVEN type against a PRESENT acceptance rule.
 *
 * Exact types and classes are a UNION on the positive side: a candidate matching
 * either is accepted. On the negative side every present arm must independently
 * exclude, which is why exclusion is computed per arm and combined with `&&`.
 * No VRML97 field currently carries both arms (`containment.test.js` asserts
 * that), so the combination is unreachable today and is defined this way so that
 * it stays sound if WD1.6-A ever emits one.
 */
function judgeAcceptance(required, nodeType, classes) {
  const exactTypes = required.acceptedNodeTypes;
  const exactMatch = exactTypes ? exactTypes.includes(nodeType) : null;
  if (exactMatch) return { status: CONTAINMENT_STATUS.LEGAL, reason: CONTAINMENT_REASON.ACCEPTED_EXACT_TYPE };

  const classIds = required.acceptedNodeClasses;
  let classExcludes = null;
  let classUndetermined = false;
  if (classIds) {
    for (const id of classIds) {
      if (classes.includes(id)) {
        return { status: CONTAINMENT_STATUS.LEGAL, reason: CONTAINMENT_REASON.ACCEPTED_NODE_CLASS };
      }
    }
    // Not a member of any accepted class. Exclusion needs the class's normative
    // COMPLEMENT to say so; silence from the positive list proves nothing.
    classExcludes = false;
    for (const id of classIds) {
      const complement = CLASS_COMPLEMENT[id];
      if (complement && classes.includes(complement)) { classExcludes = true; break; }
    }
    if (!classExcludes) classUndetermined = true;
  }

  if (!required.exclusionComplete) {
    return {
      status: CONTAINMENT_STATUS.UNSUPPORTED,
      reason: CONTAINMENT_REASON.ACCEPTANCE_RULE_NOT_EXCLUSION_COMPLETE,
    };
  }

  // Every PRESENT arm must exclude. `exactMatch === false` means a complete
  // exact-type set was consulted and did not contain the candidate.
  const arms = [];
  if (exactTypes) arms.push({ excludes: exactMatch === false, reason: CONTAINMENT_REASON.EXCLUDED_BY_EXACT_TYPE_SET });
  if (classIds) arms.push({ excludes: classExcludes === true, reason: CONTAINMENT_REASON.EXCLUDED_BY_NODE_CLASS });
  if (arms.length && arms.every((arm) => arm.excludes)) {
    return { status: CONTAINMENT_STATUS.ILLEGAL, reason: arms[0].reason };
  }
  return {
    status: CONTAINMENT_STATUS.UNSUPPORTED,
    reason: classUndetermined
      ? CONTAINMENT_REASON.CLASS_MEMBERSHIP_NOT_DETERMINED
      : CONTAINMENT_REASON.ACCEPTANCE_RULE_NOT_EXCLUSION_COMPLETE,
  };
}

// --- the query --------------------------------------------------------------

/**
 * May `candidate` legally occupy `parentNode`'s `fieldName`?
 *
 * @param {object} graph A scope graph from `buildScopeGraph`.
 * @param {object} parentNode A `Node` occurrence from that graph's parse.
 * @param {string} fieldName The written field name, e.g. `children`.
 * @param {object|string} candidate A `Node` or `USE` occurrence from the same
 *   parse, or a clause-6 BUILT-IN type name as a string.
 *
 *   A bare string is accepted ONLY for a built-in, and that boundary is a
 *   safety property rather than an omission: a user-defined type name has no
 *   meaning without a lexical position (4.8.4 makes PROTO scopes disjoint, and
 *   4.8.1 makes instantiation-before-declaration invalid), so resolving
 *   `"MyProto"` would mean inventing an insertion context and picking one of
 *   possibly several declarations. WD2 owns insertion; when it can name a real
 *   position, the prospective-type question can be answered from it. Until then
 *   a user-defined string returns `UNRESOLVED`, never a guess.
 *
 * @returns {object} A frozen `ContainmentVerdict`. Never a boolean.
 * @throws {Error} `ESCOPEGRAPH` for a foreign graph, `ESCOPEPARSE` for a node
 *   from another parse -- WD1.4's rule: a cross-document mixup is a programming
 *   error and fails loudly rather than degrading into `unresolved`.
 */
function childLegality(graph, parentNode, fieldName, candidate) {
  const iface = interfaceQuery.effectiveInterfaceOf(graph, parentNode);
  if (!iface) {
    return createVerdict({
      status: CONTAINMENT_STATUS.INVALID,
      reason: CONTAINMENT_REASON.PARENT_NOT_A_NODE,
      parent: parentNode,
    });
  }
  if (typeof fieldName !== 'string' || !fieldName) {
    throw containmentError(scopeGraph.SCOPE_ERROR.REFERENCE,
      'childLegality: expected a field name string');
  }

  const base = { parent: parentNode };

  // The parent's interface is WD1.6-B's answer and only WD1.6-B's. Nothing below
  // consults the schema or a PROTO declaration in parallel to decide whether the
  // field exists -- two authorities for one question is how they drift.
  if (iface.status !== STATUS.RESOLVED) {
    return createVerdict({
      ...base,
      status: iface.status,
      reason: CONTAINMENT_REASON.PARENT_INTERFACE_NOT_PROVABLE,
    });
  }

  const binding = iface.byName[fieldName] || null;
  if (!binding) {
    // An EXTERNPROTO parent is `resolved` but never `complete` (4.9.2), so an
    // absent name is not proof the name does not exist.
    return createVerdict({
      ...base,
      status: iface.complete ? CONTAINMENT_STATUS.INVALID : CONTAINMENT_STATUS.UNSUPPORTED,
      reason: iface.complete
        ? CONTAINMENT_REASON.FIELD_NOT_DECLARED
        : CONTAINMENT_REASON.EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE,
    });
  }
  if (binding.viaAlias) {
    return createVerdict({
      ...base,
      status: CONTAINMENT_STATUS.INVALID,
      reason: CONTAINMENT_REASON.FIELD_NAME_IS_EVENT_ALIAS,
    });
  }
  if (binding.status !== STATUS.RESOLVED || !binding.member) {
    return createVerdict({
      ...base,
      status: binding.status === STATUS.RESOLVED ? STATUS.AMBIGUOUS : binding.status,
      reason: CONTAINMENT_REASON.FIELD_BINDING_AMBIGUOUS,
    });
  }

  const member = binding.member;
  const field = createField(binding, member);
  if (!field.arity) {
    // A category error, not a fact about the candidate. Using ILLEGAL here would
    // teach a consumer that the child was rejected.
    return createVerdict({
      ...base,
      status: CONTAINMENT_STATUS.INVALID,
      reason: CONTAINMENT_REASON.FIELD_NOT_NODE_VALUED,
      field,
    });
  }

  const required = createRequired(member.constraints);
  const ruleSource = ruleSourceFor(required);

  // Resolve the candidate even when the metadata is absent, so a consumer and
  // the coverage harness can see WHAT was being asked about. The verdict is the
  // metadata's either way.
  const resolved = resolveCandidate(graph, candidate);
  const candidateFacts = createCandidate({
    given: candidate,
    nodeType: resolved.nodeType,
    kind: resolved.kind,
    classes: resolved.nodeType ? nodeSchema.getNodeClasses(resolved.nodeType) : EMPTY,
    derivation: resolved.derivation,
    status: resolved.status,
    reason: resolved.reason || CONTAINMENT_REASON.OK,
  });

  if (!required) {
    return createVerdict({
      ...base,
      status: CONTAINMENT_STATUS.UNSUPPORTED,
      reason: CONTAINMENT_REASON.CONTAINMENT_METADATA_ABSENT,
      field,
      candidate: candidateFacts,
    });
  }
  if (resolved.status !== STATUS.RESOLVED || !resolved.nodeType) {
    return createVerdict({
      ...base,
      status: resolved.status,
      reason: resolved.reason,
      field,
      required,
      candidate: candidateFacts,
      ruleSource,
    });
  }

  const { status, reason } = judgeAcceptance(required, resolved.nodeType, candidateFacts.classes);
  return createVerdict({
    ...base, status, reason, field, required, candidate: candidateFacts, ruleSource,
  });
}

function resolveCandidate(graph, candidate) {
  if (typeof candidate === 'string') {
    if (nodeSchema.isVRML97Node(candidate)) {
      return { kind: CANDIDATE_KIND.BUILTIN, nodeType: candidate, status: STATUS.RESOLVED, derivation: EMPTY };
    }
    return {
      kind: null,
      nodeType: null,
      status: STATUS.UNRESOLVED,
      reason: CONTAINMENT_REASON.CANDIDATE_TYPE_NAME_NOT_BUILTIN,
      derivation: EMPTY,
    };
  }
  if (!candidate || typeof candidate !== 'object') {
    return {
      kind: null, nodeType: null, status: STATUS.INVALID,
      reason: CONTAINMENT_REASON.CANDIDATE_NOT_A_NODE, derivation: EMPTY,
    };
  }
  if (candidate.type === NODE.USE) {
    const target = resolveUse(graph, candidate);
    if (!target) {
      return {
        kind: null, nodeType: null, status: STATUS.UNRESOLVED,
        reason: CONTAINMENT_REASON.CANDIDATE_USE_NOT_PROVABLE, derivation: EMPTY,
      };
    }
    return resolveCandidateType(graph, target);
  }
  if (candidate.type !== NODE.NODE) {
    return {
      kind: null, nodeType: null, status: STATUS.INVALID,
      reason: CONTAINMENT_REASON.CANDIDATE_NOT_A_NODE, derivation: EMPTY,
    };
  }
  return resolveCandidateType(graph, candidate);
}

module.exports = {
  childLegality,
  CONTAINMENT_STATUS,
  CONTAINMENT_REASON,
  CANDIDATE_KIND,
  // Facade-private, consumed by the WD1.6-C coverage harness and its tests. Not
  // part of the published `src/vrml/index.js` surface.
  EXCLUSION_COMPLETE_RULES,
  CLASS_COMPLEMENT,
};
