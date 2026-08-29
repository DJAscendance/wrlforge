'use strict';
// WD1.7-D, orchestration half -- external semantic evidence for one EXTERNPROTO.
// NODE-SIDE.
//
// The layer that puts a PROVEN external target beside a STRICT-LOCAL answer
// without either one touching the other. It composes closed authorities and owns
// none of them:
//
//   WD1.7-C  (`src/proto-resolution`)  which artifact, which PROTO, which base.
//                                      The ONLY target selector and the ONLY
//                                      dependency traversal. D re-resolves
//                                      nothing.
//   WD1.7-D pure (`src/vrml`.protoAgreement)  ISO 4.9.2, over two parses.
//   WD1.6-C  (`src/vrml`.containment)   ISO 4.8.3, the ONE class authority.
//   WD1.6-B  (`src/vrml`.interfaceQuery) the scope graphs all of the above read.
//
// ---------------------------------------------------------------------------
// THE GOVERNING RULE
// ---------------------------------------------------------------------------
//
//   External evidence may ENRICH a strict-local semantic answer. It may never
//   silently MUTATE one.
//
// Structurally, not by promise. Nothing in `src/vrml` requires this directory,
// no WD1.6 query accepts a resolver context, and the strict-local class verdict
// this module reports is obtained by CALLING `protoImplementationClass` -- the
// same call, with the same arguments, that a caller holding no evidence at all
// would make. If the strict answer ever changed because an archive happened to
// be configured, that call would return something different, and it cannot: it
// has no way to reach the evidence.
//
// ---------------------------------------------------------------------------
// WHERE D STOPS
// ---------------------------------------------------------------------------
//
// It proves interface agreement and implementation class, and hands both on with
// their provenance. It does NOT retrieve, select a target, route a url, compute
// an ISO 4.5.3 base, decide UI severity, write a message, change a containment
// API, touch World Project packaging, or populate `compatibility` -- that slot is
// permanently `null` here and belongs to WD1.7-E, which is BLOCKED. No
// compatibility-profile identifier appears anywhere in this lane.
//
// AND IT REWRITES NOTHING. No EXTERNPROTO-to-PROTO substitution, no inlining, no
// url repair. Every AST handle it carries is a parse-lifetime projection of an
// operation's own parse, never a persistent identity (WD.md §2/§7).

const { interfaceQuery, containment, protoAgreement, ast } = require('../vrml');
const { RESOLUTION_STATUS, TRAVERSAL_STATUS } = require('../proto-resolution');

const { CONTAINMENT_STATUS, CONTAINMENT_REASON } = containment;
const { NODE } = ast;

const EMPTY = Object.freeze([]);

/** Was an external question ASKED at all? Orthogonal to what it answered. */
const ENRICHMENT_STATUS = Object.freeze({
  /** WD1.7-C proved a target, so both external questions were put to it. */
  ENRICHED: 'enriched',
  /**
   * WD1.7-C proved no target, so neither was. NOT a failure of the target and
   * NOT a claim about the local declaration -- C's own status says what happened.
   */
  NOT_ATTEMPTED: 'not-attempted',
  /** The question is ill-formed -- caller error, not an evidence claim. */
  INVALID: 'invalid',
});

/**
 * The vocabulary of an implementation-class answer.
 *
 * NOT A NEW SET OF MEANINGS. Every value is, by identity, a string one of the
 * closed authorities already uses: `PROVEN` is the scope graph's own
 * `STATUS.RESOLVED`, and the four uncertain values are `CONTAINMENT_STATUS`'s
 * own. They are gathered here because a class answer can carry EITHER -- 4.8.3
 * succeeding is a scope-graph `resolved`, 4.8.3 withholding is a containment
 * uncertainty -- and a consumer should branch on one import rather than learn
 * which table a given verdict came from. `external-enrichment.test.js` pins the
 * identities so the three tables cannot drift apart.
 *
 * `PROVEN` is spelled differently from `RESOLVED` on purpose: the string is the
 * same, but what it CLAIMS here is that a built-in node type was reached through
 * 4.8.3, which is a stronger statement than "a name bound".
 */
const EXTERNAL_CLASS_STATUS = Object.freeze({
  /** A built-in node type was reached. `nodeType` and `classes` are populated. */
  PROVEN: interfaceQuery.STATUS.RESOLVED,
  UNSUPPORTED: CONTAINMENT_STATUS.UNSUPPORTED,
  UNRESOLVED: CONTAINMENT_STATUS.UNRESOLVED,
  AMBIGUOUS: CONTAINMENT_STATUS.AMBIGUOUS,
  RECOVERED: CONTAINMENT_STATUS.RECOVERED,
  INVALID: CONTAINMENT_STATUS.INVALID,
});

/**
 * Why an EXTERNAL class proof stopped, when the reason is D's and not WD1.6-C's.
 *
 * The two tables are DISJOINT and both appear in `implementationClass.reason`:
 * a reason from `CONTAINMENT_REASON` means the 4.8.3 walk itself finished there,
 * and a reason from here means the walk reached an EXTERNPROTO and D could not
 * follow it with evidence it was actually given. `external-enrichment.test.js`
 * pins the disjointness so the two cannot collide by drift.
 */
const EXTERNAL_CLASS_REASON = Object.freeze({
  /**
   * The 4.8.3 walk reached an EXTERNPROTO and no dependency graph was supplied.
   * D does NOT resolve it -- there is exactly one resolver and one traversal in
   * this repository, and neither is here.
   */
  DEPENDENCY_GRAPH_NOT_SUPPLIED: 'dependency-graph-not-supplied',
  /**
   * A dependency graph was supplied but holds no node for the artifact/prototype
   * this proof reached -- it was built over a different document or root.
   */
  TARGET_NOT_IN_DEPENDENCY_GRAPH: 'target-not-in-dependency-graph',
  /**
   * More than one graph node carries this artifact and prototype, under
   * different ISO 4.5.3 bases. Their subtrees may legitimately differ, so
   * choosing one would be candidate ranking (WD.md §7).
   */
  DEPENDENCY_GRAPH_NODE_AMBIGUOUS: 'dependency-graph-node-ambiguous',
  /**
   * The graph enumerated no resolution-bearing edge for this declaration. C
   * withheld it -- an ISO 4.5.3 case (1) with no known instantiating file
   * produces exactly this shape -- so no external implementation is in evidence.
   */
  EXTERNAL_DEPENDENCY_NOT_PROVEN: 'external-dependency-not-proven',
  /** C enumerated the edge and its declaration did not resolve. C's status says why. */
  EXTERNAL_DEPENDENCY_NOT_RESOLVED: 'external-dependency-not-resolved',
  /**
   * C proved the target and stopped: the chain re-enters a prototype already on
   * its traversal stack. A cycle is a COMPLETE answer about the dependency and it
   * is NOT a node class -- reinterpreting it as one is how a loop becomes a
   * confident wrong verdict.
   */
  EXTERNAL_CLASS_CYCLE: 'external-class-cycle',
  /** An explicitly configured depth bound stopped C's walk short of this target. */
  EXTERNAL_DEPENDENCY_DEPTH_LIMITED: 'external-dependency-depth-limited',
});

const ENRICHMENT_REASON = Object.freeze({
  OK: 'ok',
  /** `declaration` is not an `ExternProto` AST node. */
  NOT_AN_EXTERNPROTO: 'not-an-externproto',
  /** `resolution` is not a WD1.7-C resolution record for `declaration`. */
  RESOLUTION_NOT_FOR_THIS_DECLARATION: 'resolution-not-for-this-declaration',
  /** C reported no proven target. Its own status/reason are carried verbatim. */
  NO_PROVEN_TARGET: 'no-proven-target',
});

function fail(msg) { throw new TypeError(`external prototype enrichment: ${msg}`); }

/**
 * An operation-scoped, disposable scope-graph cache.
 *
 * DERIVED, NOT STATE, and keyed by parse-result identity -- a scope graph is a
 * function of its parse alone. There is deliberately no module-level cache: a
 * global one would make a second call's answer depend on the first's, and it
 * would outlive the parse it projects.
 */
function createEnrichmentSession() {
  return { graphs: new WeakMap() };
}

function graphFor(session, parseResult) {
  if (!session) return interfaceQuery.buildScopeGraph(parseResult);
  const hit = session.graphs.get(parseResult);
  if (hit) return hit;
  const built = interfaceQuery.buildScopeGraph(parseResult);
  session.graphs.set(parseResult, built);
  return built;
}

// Two spans are the same span. Offsets only: a range's line/column are derived
// from the same offset and comparing them would add nothing but a way to differ.
function sameRange(a, b) {
  return !!a && !!b && !!a.start && !!b.start && !!a.end && !!b.end
    && a.start.offset === b.start.offset && a.end.offset === b.end.offset;
}

// The provenance of ONE external generation. WD1.7-A §9's fields, projected from
// C and never reinterpreted. Archive-relative paths only -- B's contract -- so no
// host absolute path can reach a report through here.
function provenanceOf(target) {
  return Object.freeze({
    evidenceSourceId: target.evidenceSourceId,
    artifactPath: target.artifactPath,
    retrievedBytesHash: target.retrievedBytesHash,
    decodedContentHash: target.decodedContentHash,
    wasGzipped: target.wasGzipped,
    selectedProtoName: target.selectedProtoName,
    selectionRule: target.selectionRule,
    selectionWasUnique: target.selectionWasUnique,
    declarationRange: target.declarationRange,
    base: target.base,
  });
}

// The resolution facts D keeps. A PROJECTION, not a copy: the full C record --
// every candidate, its retrieval and its selection -- stays the caller's, and
// duplicating it here would publish a second, drifting copy of C's evidence.
function projectResolution(resolution) {
  const winner = resolution.selectedCandidateIndex == null
    ? null
    : resolution.candidates[resolution.selectedCandidateIndex] || null;
  return Object.freeze({
    status: resolution.status,
    reason: resolution.reason,
    declarationName: resolution.declarationName,
    declarationRange: resolution.declarationRange,
    baseDocument: resolution.baseDocument,
    selectedCandidateIndex: resolution.selectedCandidateIndex,
    /** EXACTLY as authored, carried through C from the AST. */
    writtenUrl: winner ? winner.writtenUrl : null,
    candidateCount: resolution.candidates.length,
    target: resolution.target ? provenanceOf(resolution.target) : null,
  });
}

function classRecord(fields) {
  return Object.freeze({
    status: fields.status,
    reason: fields.reason,
    nodeType: fields.nodeType == null ? null : fields.nodeType,
    kind: fields.kind == null ? null : fields.kind,
    classes: Object.freeze(fields.classes ? fields.classes.slice() : []),
    /**
     * The 4.8.3 chain, outermost first, ending at the built-in type. Spans every
     * generation it crossed -- an externally proven class is still ONE 4.8.3
     * derivation, and splitting it per document would hide that.
     */
    derivation: Object.freeze(fields.derivation ? fields.derivation.slice() : []),
    /** One entry per external generation followed, in order. */
    provenance: Object.freeze(fields.provenance ? fields.provenance.slice() : []),
  });
}

// --- the external class proof ----------------------------------------------

// Every graph node carrying this artifact and this prototype. The pair IS the
// ratified recursion identity (WD1.7-A §10.1); it is compared field by field
// rather than rebuilt as a key, because a second key builder is a second
// identity waiting to disagree with C's.
function nodesFor(dependencyGraph, provenance) {
  return dependencyGraph.nodes.filter((n) => n.decodedContentHash === provenance.decodedContentHash
    && n.selectedProtoName === provenance.selectedProtoName);
}

function edgeFor(dependencyGraph, fromId, declarationRange) {
  return dependencyGraph.edges.filter((e) => e.from === fromId
    && e.resolution && sameRange(e.resolution.declarationRange, declarationRange));
}

/**
 * ISO 4.8.3 over a PROVEN external target, continued through C's proven edges.
 *
 * Generation 0 is the selected implementation itself. When its first body node
 * is an EXTERNPROTO, the strict-local walk cannot finish -- and D does not go and
 * look. It asks the dependency graph C already built which target that exact
 * declaration resolved to, and continues at THAT prototype. No url is read, no
 * candidate is chosen, no base is computed, and no second traversal exists.
 */
function externalImplementationClass(target, session, dependencyGraph) {
  const provenance = [];
  // ONE 4.8.3 derivation, accumulated ACROSS generations. Each generation's walk
  // contributes the prototype names it crossed before it stopped, so the chain a
  // consumer reads is the whole chain -- `['Wrapper', 'Base']` with a `nodeType`
  // of `Shape`, not the last document's fragment of it.
  const derivation = [];
  const visited = new Set();
  let parseResult = target.parseResult;
  let declaration = target.declaration;
  let nodeId = null;

  const withhold = (status, reason) => classRecord({ status, reason, provenance, derivation });

  if (dependencyGraph) {
    const matches = nodesFor(dependencyGraph, target);
    if (matches.length === 1) nodeId = matches[0].id;
    else if (matches.length > 1) {
      provenance.push(provenanceOf(target));
      return withhold(CONTAINMENT_STATUS.AMBIGUOUS,
        EXTERNAL_CLASS_REASON.DEPENDENCY_GRAPH_NODE_AMBIGUOUS);
    }
  }
  provenance.push(provenanceOf(target));

  for (;;) {
    // THE ONE CLASS AUTHORITY. WD1.6-C's own 4.8.3 derivation, unmodified, run
    // over the target's parse exactly as it would be run over a local one.
    const step = containment.protoImplementationClass(graphFor(session, parseResult), declaration);
    const stoppedAtExternal = step.reason === CONTAINMENT_REASON.EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE
      && !!step.externProtoDeclaration;
    if (!stoppedAtExternal) {
      return classRecord({
        status: step.status,
        reason: step.reason,
        nodeType: step.nodeType,
        kind: step.kind,
        classes: step.classes,
        derivation: derivation.concat(step.derivation),
        provenance,
      });
    }
    for (const name of step.derivation) derivation.push(name);

    if (!dependencyGraph) {
      return withhold(CONTAINMENT_STATUS.UNSUPPORTED,
        EXTERNAL_CLASS_REASON.DEPENDENCY_GRAPH_NOT_SUPPLIED);
    }
    if (nodeId === null) {
      return withhold(CONTAINMENT_STATUS.UNSUPPORTED,
        EXTERNAL_CLASS_REASON.TARGET_NOT_IN_DEPENDENCY_GRAPH);
    }

    // A CONTEXT_REQUIRED edge carries no resolution and therefore never matches
    // here: C withheld it rather than resolving against the wrong file, and the
    // honest external answer is the same withholding.
    const edges = edgeFor(dependencyGraph, nodeId, step.externProtoDeclaration.range);
    if (edges.length !== 1) {
      return withhold(CONTAINMENT_STATUS.UNRESOLVED,
        EXTERNAL_CLASS_REASON.EXTERNAL_DEPENDENCY_NOT_PROVEN);
    }
    const edge = edges[0];
    if (edge.traversal === TRAVERSAL_STATUS.DEPENDENCY_CYCLE) {
      return withhold(CONTAINMENT_STATUS.UNRESOLVED, EXTERNAL_CLASS_REASON.EXTERNAL_CLASS_CYCLE);
    }
    if (edge.traversal === TRAVERSAL_STATUS.DEPTH_LIMIT_EXCEEDED) {
      return withhold(CONTAINMENT_STATUS.UNRESOLVED,
        EXTERNAL_CLASS_REASON.EXTERNAL_DEPENDENCY_DEPTH_LIMITED);
    }
    if (edge.resolution.status !== RESOLUTION_STATUS.RESOLVED || !edge.resolution.target) {
      return withhold(CONTAINMENT_STATUS.UNRESOLVED,
        EXTERNAL_CLASS_REASON.EXTERNAL_DEPENDENCY_NOT_RESOLVED);
    }
    // C's graph is a DAG by construction -- a back edge to an ancestor is
    // detected as a cycle before it can become a REUSED edge. The guard is kept
    // anyway: a proof that cannot terminate is worse than one that withholds.
    if (edge.to === null || visited.has(edge.to)) {
      return withhold(CONTAINMENT_STATUS.UNRESOLVED, EXTERNAL_CLASS_REASON.EXTERNAL_CLASS_CYCLE);
    }
    visited.add(edge.to);

    const next = edge.resolution.target;
    provenance.push(provenanceOf(next));
    parseResult = next.parseResult;
    declaration = next.declaration;
    nodeId = edge.to;
  }
}

// --- the enrichment itself --------------------------------------------------

function enrichment(fields) {
  return Object.freeze({
    status: fields.status,
    reason: fields.reason,
    declarationName: fields.declarationName === undefined ? null : fields.declarationName,
    /**
     * WHAT THE STANDARD SAYS WITHOUT ANY OF THIS. Obtained by calling the WD1.6-C
     * authority with the arguments a caller holding no evidence would use, so it
     * is observably independent of whether an archive was configured. For an
     * EXTERNPROTO it is, and stays, `UNSUPPORTED` /
     * `EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE`.
     */
    strictLocal: fields.strictLocal || null,
    external: fields.external || null,
    /**
     * RESERVED, and always `null`. Whether an access difference or any other
     * observed shape belongs to a particular historical browser, a vendor
     * dialect or generic legacy authoring is an EVIDENCE question WD1.7-E owns,
     * and WD1.7-E is BLOCKED. D does not guess it, and no compatibility-profile
     * identifier is spelled anywhere in this lane.
     */
    compatibility: null,
  });
}

/**
 * External semantic evidence for ONE local EXTERNPROTO declaration.
 *
 * @param {object} params
 * @param {object} params.graph A scope graph over the DECLARING document, from
 *   `interfaceQuery.buildScopeGraph`.
 * @param {object} params.declaration The `ExternProto` AST node, from that parse.
 * @param {object} params.resolution The WD1.7-C resolution for that declaration,
 *   from `resolveExternalPrototype`. REQUIRED -- D never resolves a target.
 * @param {object} [params.dependencyGraph] A WD1.7-C dependency graph over the
 *   same document. Supplying it lets an external class proof continue through an
 *   EXTERNPROTO first body node; without it, that case is withheld.
 * @param {object} [params.session] An operation-scoped scope-graph cache.
 * @returns {object} A frozen enrichment record.
 */
function enrichExternalPrototype(params = {}) {
  const { graph, declaration, resolution, dependencyGraph = null, session } = params;
  if (!graph || typeof graph !== 'object') fail('graph must be a scope graph');
  if (!resolution || typeof resolution !== 'object') {
    fail('resolution is REQUIRED; D consumes WD1.7-C evidence and never resolves a target');
  }

  const strictLocal = Object.freeze({
    implementationClass: containment.protoImplementationClass(graph, declaration),
  });
  if (strictLocal.implementationClass.status === CONTAINMENT_STATUS.INVALID
    || !declaration || declaration.type !== NODE.EXTERNPROTO) {
    return enrichment({
      status: ENRICHMENT_STATUS.INVALID,
      reason: ENRICHMENT_REASON.NOT_AN_EXTERNPROTO,
      strictLocal,
    });
  }
  // The resolution must be ABOUT this declaration. C records the declaration's
  // own span, so this is an identity check on evidence rather than a name match.
  if (!sameRange(resolution.declarationRange, declaration.range)) {
    return enrichment({
      status: ENRICHMENT_STATUS.INVALID,
      reason: ENRICHMENT_REASON.RESOLUTION_NOT_FOR_THIS_DECLARATION,
      declarationName: declaration.name == null ? null : declaration.name,
      strictLocal,
    });
  }

  const declarationName = declaration.name == null ? null : declaration.name;
  const external = {
    resolution: projectResolution(resolution),
    interface: protoAgreement.notAttempted(declaration),
    implementationClass: classRecord({
      status: CONTAINMENT_STATUS.UNSUPPORTED,
      reason: EXTERNAL_CLASS_REASON.EXTERNAL_DEPENDENCY_NOT_PROVEN,
      provenance: EMPTY,
    }),
  };

  // ONLY `RESOLVED` supplies a target. Every other C outcome -- a parse failure,
  // a missing or ambiguous PROTO, a declaration never attempted -- leaves both
  // external questions unasked, and C's own evidence is preserved either way.
  if (resolution.status !== RESOLUTION_STATUS.RESOLVED || !resolution.target) {
    return enrichment({
      status: ENRICHMENT_STATUS.NOT_ATTEMPTED,
      reason: ENRICHMENT_REASON.NO_PROVEN_TARGET,
      declarationName,
      strictLocal,
      external: Object.freeze(external),
    });
  }

  const target = resolution.target;
  const targetGraph = graphFor(session, target.parseResult);

  // THE TWO QUESTIONS ARE INDEPENDENT, and answered independently. Interface
  // agreement needs the selected root target and nothing else -- not a complete
  // dependency graph, not a deeper generation -- so an unrelated incompleteness
  // elsewhere in C's walk does not withhold it. Class proof may need more, and
  // says so on its own record when it does.
  external.interface = protoAgreement.compareInterfaceAgreement(
    graph, declaration, targetGraph, target.declaration,
  );
  external.implementationClass = externalImplementationClass(target, session, dependencyGraph);

  return enrichment({
    status: ENRICHMENT_STATUS.ENRICHED,
    reason: ENRICHMENT_REASON.OK,
    declarationName,
    strictLocal,
    external: Object.freeze(external),
  });
}

module.exports = {
  enrichExternalPrototype,
  createEnrichmentSession,
  ENRICHMENT_STATUS,
  ENRICHMENT_REASON,
  EXTERNAL_CLASS_STATUS,
  EXTERNAL_CLASS_REASON,
};
