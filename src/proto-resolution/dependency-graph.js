'use strict';
// WD1.7-C, traversal half -- the external prototype dependency graph.
//
// Follows ACTUAL INSTANTIATIONS, not declarations. A document that declares an
// EXTERNPROTO it never instantiates has no semantic dependency on it: 4.8.3
// realizes an implementation where the prototype is INSTANTIATED, so the
// reachable set is the one the type resolver proves, not the one a scan of
// declarations produces. (WD1.7-B2's package plan deliberately keeps the
// broader, conservative DECLARATION inventory for a different purpose -- it must
// bundle fallback artifacts a viewer might reach for. Both are correct; they
// answer different questions, and neither may be rewritten into the other.)
//
//   selected implementation
//        -> WD1.5-P2A type resolution           (the ONLY type authority)
//        -> node occurrence binds an EXTERNPROTO declaration
//        -> `external-resolver.js` resolves it  (the ONLY retrieval path)
//        -> an edge, and a new frame to expand
//
// THREE THINGS THIS MODULE OWNS, and nothing else:
//
//  1. ISO 4.5.3/N12 BASE PROPAGATION. The hard part, and the reason C exists at
//     all: an EXTERNPROTO written inside a prototype definition resolves against
//     the file where THAT PROTOTYPE IS INSTANTIATED. Which file that is depends
//     on which prototype it is, so the base is computed per declaration from its
//     OWNING prototype -- never from "the artifact this frame came from".
//  2. CYCLE DETECTION on the ratified `(decodedContentHash, selectedProtoName)`
//     tuple, against the ACTIVE STACK only.
//  3. An explicit, status-bearing depth bound that is OFF by default.
//  4. THE COMPLETENESS CONTRACT. `graph.complete` is a claim, and this module is
//     the only place entitled to make it -- so every condition that falsifies it
//     is named in `INCOMPLETENESS_REASON` and carries its own evidence, and the
//     boolean is DERIVED from that list rather than assigned. Two of those
//     conditions are inherited limits rather than failures here: P2A does not
//     index PROTO interface default values, and P2A sometimes withholds a type
//     binding without proving the name undeclared. In both, a dependency may
//     exist that nothing in C can see. C does not go and look -- that is the
//     second type resolver the whole lane refuses to become -- it declines to
//     claim exhaustiveness. FALSE INCOMPLETENESS IS PREFERABLE TO FALSE
//     COMPLETENESS, and the choice is deliberate in both directions.
//
// WHAT IT DOES NOT DO: it selects no target (that is the pure layer), retrieves
// nothing (that is WD1.7-B), resolves no type name (that is P2A), compares no
// interface (that is WD1.7-D) and classifies no compatibility (WD1.7-E, blocked).

const { interfaceQuery, protoTarget, ast } = require('../vrml');
const {
  RESOLUTION_STATUS,
  createResolutionSession,
  resolveExternalPrototype,
} = require('./external-resolver');

const { NODE } = ast;

// What happened to an edge AFTER its declaration was resolved. Kept separate
// from RESOLUTION_STATUS on purpose: "the target was proven" and "we walked into
// it" are different facts, and a proven target inside a cycle is still proven.
const TRAVERSAL_STATUS = Object.freeze({
  /** Resolved and expanded; a new graph node was created for the target. */
  EXPANDED: 'EXPANDED',
  /**
   * Resolved, and it is the SAME target under the SAME bases as one already
   * expanded elsewhere in the graph. A DAG edge, NOT a cycle -- WD1.7-A §10.1
   * boundary 1: re-entering a tuple already COMPLETED is reuse, not recursion.
   */
  REUSED: 'REUSED',
  /**
   * Resolved, and the tuple is already on the ACTIVE traversal stack. The target
   * is proven; the walk stops rather than recursing forever.
   */
  DEPENDENCY_CYCLE: 'DEPENDENCY_CYCLE',
  /**
   * Resolved, and an explicitly configured depth bound stopped the walk. The
   * graph is reported INCOMPLETE -- a safety cap may never manufacture
   * completeness (WD1.7-C brief §32).
   */
  DEPTH_LIMIT_EXCEEDED: 'DEPTH_LIMIT_EXCEEDED',
  /**
   * ISO 4.5.3/N12 case (1) applies and the instantiating file is not known in
   * this traversal. Withheld -- resolving against the declaring file instead
   * would be a confident wrong answer.
   */
  CONTEXT_REQUIRED: 'CONTEXT_REQUIRED',
  /** The declaration did not resolve. Its own status/reason say why. */
  NOT_RESOLVED: 'NOT_RESOLVED',
});

// WHY `complete` IS FALSE. One reason per thing that stopped this traversal from
// answering exhaustively, each carrying its own derived evidence.
//
// `complete` is a claim about the WALK, not about the document, and it means:
//
//   Every dependency-bearing region this traversal REACHED was enumerable with
//   the semantic authorities C consumes, and every edge it enumerated was either
//   followed to its end or terminated by a complete answer of its own.
//
// The four ways that fails split cleanly in two. The first two leave an edge
// PRESENT in the graph but its subtree unwalked; the last two mean an edge may
// be MISSING altogether. Both are fatal to exhaustiveness, so both live here --
// but they are named apart because a consumer repairing the first supplies
// context or raises a bound, while a consumer facing the second cannot repair it
// at all from inside C.
//
// A CYCLE IS NOT ON THIS LIST, and a definitively unresolved declaration is not
// either. Detecting a recursive chain is a complete and correct answer about it,
// and an edge that carries its own `NOT_RESOLVED` reason was enumerated, not
// omitted.
const INCOMPLETENESS_REASON = Object.freeze({
  /** ISO 4.5.3/N12 case (1) with no known instantiating file. Edge present, subtree unwalked. */
  CONTEXT_REQUIRED: 'CONTEXT_REQUIRED',
  /** An explicitly configured bound stopped the walk. Edge present, subtree unwalked. */
  DEPTH_LIMIT_EXCEEDED: 'DEPTH_LIMIT_EXCEEDED',
  /**
   * A prototype this traversal reached carries a node occurrence inside an
   * interface DEFAULT VALUE, and WD1.5-P2A does not index that region (its
   * documented limit 1). C creates no second resolver for it, so it cannot know
   * whether a dependency hides there -- and says so rather than reporting an
   * exhaustive walk it did not perform. Deliberately conservative: it fires even
   * when the occurrence would have turned out to be a built-in, because C has no
   * authoritative binding for that position and a false `complete: true` is the
   * worse error.
   */
  UNINDEXED_INTERFACE_DEFAULT: 'UNINDEXED_INTERFACE_DEFAULT',
  /**
   * P2A reached a node occurrence and withheld its binding without proving that
   * no declaration of the name exists -- recovery, a duplicate declaration, a
   * forward reference, a missing name token. One of those declarations could be
   * an EXTERNPROTO, so an edge may be missing. A vendor spelling P2A proved
   * undeclared does NOT land here: that is a complete answer.
   */
  TYPE_BINDING_WITHHELD: 'TYPE_BINDING_WITHHELD',
});

function fail(msg) { throw new TypeError(`external dependency graph: ${msg}`); }

// THE RATIFIED RECURSION IDENTITY (WD1.7-A §10.1, correction F1).
//
// NUL-separated for the same reason WD1.4's scope keys are: a separator that can
// occur inside either component makes two different pairs collide, and a VRML
// identifier is far freer than it looks. Content hash ALONE is wrong -- one
// library routinely declares several prototypes, and `shared.wrl#Alpha ->
// shared.wrl#Beta` is a conforming reference, not a loop. Path alone is wrong
// the other way -- two archive paths holding identical bytes are one artifact.
const SEP = '\u0000';
function cycleKeyOf(decodedContentHash, selectedProtoName) {
  return `${decodedContentHash}${SEP}${selectedProtoName}`;
}

// A frame is reused only when the target AND both of its base contexts match.
// Collapsing on content alone would erase exactly what WD1.7-A §15.2 forbids
// erasing: two byte-identical libraries reached through different locations
// resolve their OWN relative references differently, so their subtrees can
// legitimately diverge.
function memoKeyOf(cycleKey, documentBase, instantiationBase) {
  // A base is two NUL-joined components; the absent marker is one, so it can
  // never be confused with a real `sourceId`/`path` pair however they are spelled.
  const b = (x) => (x ? `${x.sourceId}${SEP}${x.path}` : 'none');
  return `${cycleKey}${SEP}${b(documentBase)}${SEP}${b(instantiationBase)}`;
}

function frozenBase(b) {
  return b ? Object.freeze({ sourceId: b.sourceId, path: b.path }) : null;
}

/**
 * Build the external prototype dependency graph reachable from one document.
 *
 * @param {object} parseResult The root document's parse.
 * @param {object} options
 * @param {object} options.context A frozen WD1.7-B `ResolverContext`.
 * @param {{sourceId: string, path: string}} options.baseDocument Where the root
 *   document itself lives. ISO 4.5.3 case (3) for its top-level statements.
 * @param {object} [options.root] A `Document` (default: `parseResult.tree`) or a
 *   `Proto` AST node, when only one implementation's dependencies are wanted.
 * @param {{sourceId: string, path: string}} [options.instantiationBase] Required
 *   only for a `Proto` root, and only to answer ISO 4.5.3 case (1) for
 *   declarations inside THAT prototype. Absent, such declarations are withheld
 *   as `CONTEXT_REQUIRED` rather than resolved against the wrong file.
 * @param {number|null} [options.maxDepth] OFF by default. WD1.7-A ratified no
 *   magic maximum and this lane invents none: cycles already terminate through
 *   the active-stack key, so a bound is resource protection, not correctness.
 *   When set, reaching it produces `DEPTH_LIMIT_EXCEEDED` and `complete: false`.
 * @param {object} [deps] B's injectable fs surface, passed straight through.
 * @returns {object} A frozen graph.
 */
function buildExternalDependencyGraph(parseResult, options = {}, deps = {}) {
  const { context, baseDocument, maxDepth = null } = options;
  if (!context || typeof context !== 'object') fail('options.context must be a ResolverContext');
  if (!baseDocument || typeof baseDocument !== 'object') fail('options.baseDocument is REQUIRED (ISO 4.5.3/N12)');
  if (maxDepth !== null && (!Number.isInteger(maxDepth) || maxDepth < 0)) {
    fail('options.maxDepth must be null or a non-negative integer');
  }
  const root = options.root || (parseResult && parseResult.tree) || null;
  if (!root || (root.type !== NODE.DOCUMENT && root.type !== NODE.PROTO)) {
    fail(`options.root must be a ${NODE.DOCUMENT} or ${NODE.PROTO} AST node`);
  }

  const session = createResolutionSession();
  const graphCache = new Map();      // parseResult -> scope graph, this operation only
  const scopeGraphFor = (pr) => {
    let g = graphCache.get(pr);
    if (!g) { g = interfaceQuery.buildScopeGraph(pr); graphCache.set(pr, g); }
    return g;
  };

  const nodes = [];
  const edges = [];
  const cycles = [];
  const completed = new Map();       // memoKey -> node id
  // Structured, not a boolean. `complete` is DERIVED from this list, so a future
  // reason cannot be added without also becoming visible evidence.
  const incompleteness = [];
  const withhold = (reason, at, evidence) => {
    incompleteness.push(Object.freeze({ reason, at, evidence: Object.freeze(evidence) }));
  };

  const addNode = (fields) => {
    const id = nodes.length;
    nodes.push(Object.freeze({ id, ...fields }));
    return id;
  };

  const rootId = addNode({
    kind: 'root',
    depth: 0,
    documentBase: frozenBase(baseDocument),
    instantiationBase: frozenBase(options.instantiationBase),
    cycleKey: null,
    evidenceSourceId: null,
    artifactPath: null,
    decodedContentHash: null,
    retrievedBytesHash: null,
    wasGzipped: null,
    selectedProtoName: root.type === NODE.PROTO ? (root.name == null ? null : root.name) : null,
    selectionRule: null,
  });

  const queue = [{
    nodeId: rootId,
    parseResult,
    root,
    documentBase: frozenBase(baseDocument),
    instantiationBase: frozenBase(options.instantiationBase),
    depth: 0,
    stack: Object.freeze([]),
  }];

  while (queue.length > 0) {
    const frame = queue.shift();
    const graph = scopeGraphFor(frame.parseResult);
    const found = protoTarget.prototypeDependencies(graph, frame.root);

    // THE INHERITED SEMANTIC BOUNDARY, carried through rather than papered over.
    // The pure layer reports every prototype IT reached whose interface defaults
    // hold a node occurrence P2A does not index. C invents no edge for them --
    // that would need a name lookup it is not entitled to perform -- so the only
    // honest thing left is to stop claiming the walk was exhaustive. The gap
    // record is passed through verbatim as the evidence; C adds only where in the
    // graph it was reached.
    for (const gap of found.coverageGaps) {
      withhold(INCOMPLETENESS_REASON.UNINDEXED_INTERFACE_DEFAULT, frame.nodeId, gap);
    }

    // The same rule one level down. A `WITHHELD` occurrence P2A could not bind AND
    // could not prove undeclared may be an EXTERNPROTO instantiation whose edge is
    // simply absent from `byDeclaration` below. Grouped by written name so a type
    // used forty times reports once, with a count -- the same shape as an edge,
    // and for the same reason.
    const unprovable = new Map();
    for (const ref of found.references) {
      if (ref.kind !== protoTarget.DEPENDENCY_KIND.WITHHELD || !ref.declarationMayExist) continue;
      const seen = unprovable.get(ref.typeName);
      if (seen) { seen.occurrences += 1; continue; }
      unprovable.set(ref.typeName, { ref, occurrences: 1 });
    }
    for (const { ref, occurrences } of unprovable.values()) {
      withhold(INCOMPLETENESS_REASON.TYPE_BINDING_WITHHELD, frame.nodeId, {
        writtenTypeName: ref.typeName,
        range: ref.range,
        via: ref.via,
        occurrences,
        resolutionStatus: ref.resolutionStatus,
        resolutionReason: ref.resolutionReason,
      });
    }

    // ONE EDGE PER DECLARATION, not per instantiation. A library instantiated
    // forty times is one dependency; the count is kept because it is provenance,
    // and the FIRST occurrence supplies the span because source order is the only
    // non-arbitrary choice.
    const byDeclaration = new Map();
    for (const ref of found.references) {
      if (ref.kind !== protoTarget.DEPENDENCY_KIND.EXTERNPROTO) continue;
      const existing = byDeclaration.get(ref.declaration);
      if (existing) { existing.occurrences += 1; continue; }
      byDeclaration.set(ref.declaration, { ref, occurrences: 1 });
    }

    for (const { ref, occurrences } of byDeclaration.values()) {
      // ---- ISO 4.5.3 / N12, the whole of it ------------------------------
      //
      // case (1) "the file in which the prototype is instantiated, if the
      //          statement is part of a prototype definition"
      // case (3) "otherwise the file the statement was read from"
      //
      // The owning prototype decides which applies, and WHICH prototype it is
      // decides which file. If the owner is THIS FRAME'S root, the frame was
      // entered by instantiating it from somewhere else, and that somewhere is
      // `instantiationBase`. Any other owner is a prototype declared AND
      // instantiated inside this frame's own document, so the file is this
      // document. Defaulting either way to "the artifact this frame came from"
      // is the ISO 4.5.3 mistake -- it is right for one case and wrong for the
      // other, which is why it cannot be a constant.
      const ownedByFrameRoot = ref.declaringPrototype != null && ref.declaringPrototype === frame.root;
      const base = ownedByFrameRoot ? frame.instantiationBase : frame.documentBase;

      const edgeBase = {
        from: frame.nodeId,
        declarationName: ref.typeName,
        declarationRange: ref.range,
        declaringPrototypeName: ref.declaringPrototype ? (ref.declaringPrototype.name == null ? null : ref.declaringPrototype.name) : null,
        via: ref.via,
        occurrences,
        baseDocument: base,
      };

      if (!base) {
        edges.push(Object.freeze({ ...edgeBase, traversal: TRAVERSAL_STATUS.CONTEXT_REQUIRED, resolution: null, to: null }));
        withhold(INCOMPLETENESS_REASON.CONTEXT_REQUIRED, frame.nodeId, {
          declarationName: ref.typeName,
          declaringPrototypeName: edgeBase.declaringPrototypeName,
          range: ref.range,
          via: ref.via,
        });
        continue;
      }

      const res = resolveExternalPrototype({
        context, baseDocument: base, parseResult: frame.parseResult, declaration: ref.declaration, session,
      }, deps);

      if (res.status !== RESOLUTION_STATUS.RESOLVED) {
        edges.push(Object.freeze({ ...edgeBase, traversal: TRAVERSAL_STATUS.NOT_RESOLVED, resolution: res, to: null }));
        continue;
      }

      const target = res.target;
      const key = cycleKeyOf(target.decodedContentHash, target.selectedProtoName);

      // ACTIVE STACK ONLY. A global visited-set here would report shared
      // dependencies as cycles and silently drop half a legitimate DAG.
      if (frame.stack.includes(key)) {
        const chain = Object.freeze(frame.stack.concat([key]));
        cycles.push(Object.freeze({ cycleKey: key, chain, at: frame.nodeId, declarationName: ref.typeName }));
        edges.push(Object.freeze({ ...edgeBase, traversal: TRAVERSAL_STATUS.DEPENDENCY_CYCLE, resolution: res, to: null, cycleKey: key }));
        continue;
      }

      // The child's own document base is where ITS artifact was retrieved from,
      // and its instantiation base is THIS document -- the file that declared the
      // EXTERNPROTO and therefore the file the target prototype is instantiated
      // in. That single assignment is what makes the two-base fixture resolve
      // `worlds/dep.wrl` rather than the copy sitting beside the library.
      const childDocumentBase = frozenBase(target.base);
      const childInstantiationBase = frame.documentBase;
      const memo = memoKeyOf(key, childDocumentBase, childInstantiationBase);
      const already = completed.get(memo);
      if (already !== undefined) {
        edges.push(Object.freeze({ ...edgeBase, traversal: TRAVERSAL_STATUS.REUSED, resolution: res, to: already, cycleKey: key }));
        continue;
      }

      if (maxDepth !== null && frame.depth + 1 > maxDepth) {
        edges.push(Object.freeze({ ...edgeBase, traversal: TRAVERSAL_STATUS.DEPTH_LIMIT_EXCEEDED, resolution: res, to: null, cycleKey: key }));
        withhold(INCOMPLETENESS_REASON.DEPTH_LIMIT_EXCEEDED, frame.nodeId, {
          declarationName: ref.typeName,
          range: ref.range,
          via: ref.via,
          depth: frame.depth + 1,
          maxDepth,
        });
        continue;
      }

      const childId = addNode({
        kind: 'external-target',
        depth: frame.depth + 1,
        documentBase: childDocumentBase,
        instantiationBase: childInstantiationBase,
        cycleKey: key,
        evidenceSourceId: target.evidenceSourceId,
        artifactPath: target.artifactPath,
        decodedContentHash: target.decodedContentHash,
        retrievedBytesHash: target.retrievedBytesHash,
        wasGzipped: target.wasGzipped,
        selectedProtoName: target.selectedProtoName,
        selectionRule: target.selectionRule,
      });
      completed.set(memo, childId);
      edges.push(Object.freeze({ ...edgeBase, traversal: TRAVERSAL_STATUS.EXPANDED, resolution: res, to: childId, cycleKey: key }));
      queue.push({
        nodeId: childId,
        parseResult: target.parseResult,
        root: target.declaration,
        documentBase: childDocumentBase,
        instantiationBase: childInstantiationBase,
        depth: frame.depth + 1,
        stack: Object.freeze(frame.stack.concat([key])),
      });
    }
  }

  return Object.freeze({
    root: rootId,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    cycles: Object.freeze(cycles),
    /**
     * Every condition that stopped this traversal from answering exhaustively,
     * in discovery order, each `{ reason, at, evidence }`. Empty on a complete
     * graph. See `INCOMPLETENESS_REASON` for what each one means and for the two
     * things that are deliberately NOT on it.
     */
    incompleteness: Object.freeze(incompleteness),
    /**
     * DERIVED, never set: `incompleteness.length === 0`.
     *
     * `true` means no dependency-bearing region this traversal reached is known
     * to lie outside the semantic authorities C consumes, AND no traversal,
     * context or resource condition stopped it short. It does NOT mean the
     * document is well-formed, that every declaration resolved, or that no cycle
     * exists -- a cycle is a complete answer, and an edge carrying its own
     * `NOT_RESOLVED` reason was enumerated rather than omitted.
     */
    complete: incompleteness.length === 0,
    maxDepth,
  });
}

module.exports = {
  TRAVERSAL_STATUS,
  INCOMPLETENESS_REASON,
  buildExternalDependencyGraph,
  // Internal, exported for focused tests only -- not part of the public facade.
  _internals: Object.freeze({ cycleKeyOf, memoKeyOf }),
};
