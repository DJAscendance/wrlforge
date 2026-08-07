'use strict';
// WD1.5-P2C -- the PRODUCTION-PATH corpus sweep and the oracle differential.
//
// This module measures the real `src/vrml/scope-graph.js`: the real recovery
// gate, the real endpoint acquisition, the real reverse indexes. Nothing here
// reimplements a resolution rule -- reimplementing one and then comparing was
// exactly the weakness of the planning-era recon harness, whose figures could
// not afterwards be reconciled with the implementation's.
//
// It is loaded ONLY by `run.js`, and only AFTER `oracle.js`, so the oracle's
// load-time independence guard is meaningful. Requiring this module first would
// make that guard fire -- which is the intended, loud failure.
//
// READ-ONLY: every filesystem touch goes through `corpus.js`, which reads and
// never writes.

const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const corpus = require('./corpus');
const oracle = require('./oracle');

// The graded module. By the time this line runs, `oracle.js` has already
// asserted it was NOT loaded.
const sg = require(path.join(REPO_ROOT, 'src', 'vrml', 'scope-graph.js'));

const { STATUS, REASON, ROUTE_SIDE } = sg;

// ---------------------------------------------------------------------------
// Classification vocabulary
// ---------------------------------------------------------------------------

/**
 * A CONFIDENT answer is a definite lexical claim: "it is this declaration" or
 * "it is not declared here". Both are actionable, and both are wrong to make
 * over a scope whose boundaries may have moved.
 *
 * `ambiguous`, `unsupported` and `recovered` are all refusals -- they bind
 * nothing and assert nothing a consumer can act on -- so none of them can be a
 * confident-from-unprovable violation.
 */
function isConfident(res) {
  if (!res) return false;
  if (res.status !== STATUS.RESOLVED && res.status !== STATUS.UNRESOLVED) return false;
  // `missing-name` is a TOKEN fact -- "this reference has no name to look up" --
  // true whatever the surrounding scopes turn out to be. It sits ABOVE the
  // recovery gate in every namespace (P2A, P2B and P2C alike), so it is not a
  // claim about a scope and cannot be a claim from an unprovable one. Recorded
  // rather than assumed: the first sweep of this lane counted 10 such cases,
  // all `invalid/missing-name` on one truncated ROUTE.
  if (res.reason === REASON.MISSING_NAME) return false;
  return true;
}

/** Reasons that say, in one namespace or another, "this evidence is not provable". */
const UNPROVABLE_REASONS = new Set([
  REASON.SCOPE_RECOVERED,
  REASON.PROTO_SCOPE_NOT_PROVABLE,
  REASON.PROTO_BODY_NOT_PROVABLE,
  REASON.DOCUMENT_PARSE_INCOMPLETE,
  REASON.INTERFACE_SCOPE_NOT_PROVABLE,
  REASON.INTERFACE_NOT_PROVABLE_FOR_REFERENCE,
].filter(Boolean));

function dependsOnRecovery(res) {
  if (!res) return false;
  return res.status === STATUS.RECOVERED || UNPROVABLE_REASONS.has(res.reason);
}

function bump(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function tallyToObject(map) {
  const out = {};
  for (const k of [...map.keys()].sort()) out[k] = map.get(k);
  return out;
}

function sumValues(map) {
  let n = 0;
  for (const v of map.values()) n += v;
  return n;
}

// ---------------------------------------------------------------------------
// Per-document analysis
// ---------------------------------------------------------------------------

/**
 * Analyse one parsed document through the production path and, when the parse
 * is undamaged, against the independent oracle.
 *
 * @param {object} parsed  a production parse result
 * @param {object} acc     the accumulator (mutated)
 * @param {boolean} gradeable  whether the oracle may grade this document
 */
function analyseDocument(parsed, acc, gradeable, docId) {
  const graph = sg.buildScopeGraph(parsed);

  // PER-DOCUMENT, and that is not an optimisation. Scopes belong to one parse,
  // so folding the invariant at the end of each document is exactly equivalent
  // to folding it at the end of the sweep -- and an accumulator keyed by scope
  // OBJECTS across 4,465 documents pins every scope of every document in memory
  // until the run ends, which exhausted a 6 GB heap on the first full attempt.
  const scopeState = new Map();

  const oracleRecords = gradeable ? oracle.expectations(parsed) : [];
  const oracleByAst = new Map();
  for (const rec of oracleRecords) oracleByAst.set(rec.astRoute, rec);

  corpus.forEachRoute(parsed.tree, (astRoute) => {
    acc.totalRoutes += 1;

    let refs;
    try {
      refs = {
        srcNode: sg.routeNodeReferenceFor(graph, astRoute, ROUTE_SIDE.SOURCE),
        dstNode: sg.routeNodeReferenceFor(graph, astRoute, ROUTE_SIDE.DESTINATION),
        srcEvt: sg.routeEventReferenceFor(graph, astRoute, ROUTE_SIDE.SOURCE),
        dstEvt: sg.routeEventReferenceFor(graph, astRoute, ROUTE_SIDE.DESTINATION),
      };
    } catch (err) {
      // A ROUTE the production path refuses to project at all. §10 requires the
      // audit to FAIL rather than quietly drop it.
      acc.unprojectedRoutes += 1;
      if (acc.unprojectedSamples.length < 25) {
        acc.unprojectedSamples.push({ id: docId, message: String(err && err.message).slice(0, 160) });
      }
      return;
    }
    if (!refs.srcNode || !refs.dstNode || !refs.srcEvt || !refs.dstEvt) {
      acc.unprojectedRoutes += 1;
      if (acc.unprojectedSamples.length < 25) {
        acc.unprojectedSamples.push({ id: docId, message: 'no projection for this ROUTE' });
      }
      return;
    }

    const res = {
      srcNode: sg.resolveRouteNode(graph, refs.srcNode),
      dstNode: sg.resolveRouteNode(graph, refs.dstNode),
      srcEvt: sg.resolveRouteEndpoint(graph, refs.srcEvt),
      dstEvt: sg.resolveRouteEndpoint(graph, refs.dstEvt),
    };
    const verdict = sg.routeVerdict(graph, astRoute);

    // ---- Complete partitions (§10). Every ROUTE lands in exactly one bucket
    // of each of the five questions, keyed `status/reason`, so the buckets are
    // arithmetically reconcilable against `totalRoutes`.
    bump(acc.partition.sourceNode, `${res.srcNode.status}/${res.srcNode.reason}`);
    bump(acc.partition.destNode, `${res.dstNode.status}/${res.dstNode.reason}`);
    bump(acc.partition.sourceEndpoint, `${res.srcEvt.status}/${res.srcEvt.reason}`);
    bump(acc.partition.destEndpoint, `${res.dstEvt.status}/${res.dstEvt.reason}`);
    bump(acc.partition.compatibility, `${verdict.status}/${verdict.reason}`);

    // ---- Direction / type detectors
    if (res.srcEvt.reason === REASON.ROUTE_SOURCE_NOT_AN_EVENT_OUT) acc.directionInvalidSource += 1;
    if (res.dstEvt.reason === REASON.ROUTE_DEST_NOT_AN_EVENT_IN) acc.directionInvalidDest += 1;
    if (verdict.reason === REASON.ROUTE_TYPE_MISMATCH) {
      acc.typeMismatch += 1;
      if (acc.typeMismatchSamples.length < 25) {
        acc.typeMismatchSamples.push({ id: docId, offset: astRoute.range.start.offset });
      }
    }
    if (verdict.reason === REASON.ROUTE_TYPE_UNKNOWN) acc.typeUnknown += 1;

    // ---- Endpoint origins and shorthand usage
    for (const [key, ref] of [['source', refs.srcEvt], ['destination', refs.dstEvt]]) {
      const ep = sg.routeEndpointFor(graph, ref);
      if (!ep) continue;
      bump(acc.endpointOrigin[key], ep.origin);
      if (ep.name !== ep.effectiveName) bump(acc.aliasUse, key);
    }

    // ---- G: does THIS ROUTE's own answer rest on unprovable evidence?
    const anyRecovery = dependsOnRecovery(res.srcNode) || dependsOnRecovery(res.dstNode)
      || dependsOnRecovery(res.srcEvt) || dependsOnRecovery(res.dstEvt)
      || verdict.status === STATUS.RECOVERED;
    const anyUnsupported = res.srcEvt.status === STATUS.UNSUPPORTED
      || res.dstEvt.status === STATUS.UNSUPPORTED;
    if (anyRecovery) acc.routesDependingOnRecovery += 1;
    if (anyUnsupported) acc.routesDependingOnUnsupported += 1;
    if (anyRecovery || anyUnsupported) acc.routesDependingOnUnprovable += 1;

    // ---- Confident-from-unprovable, checked as a PER-SCOPE invariant.
    //
    // Recovery is a whole-scope property: a damaged scope withholds EVERY
    // lexical answer, positive included. So a scope that produced any
    // `recovered` answer and also a confident one is self-contradictory, and
    // that is checkable without trusting either the oracle or the resolver's
    // own account of which scopes it marked recovered.
    const scopeKey = refs.srcNode.scope;
    if (scopeKey) {
      let st = scopeState.get(scopeKey);
      if (!st) { st = { recovered: 0, confident: [] }; scopeState.set(scopeKey, st); }
      for (const r of [res.srcNode, res.dstNode, res.srcEvt, res.dstEvt]) {
        if (r.status === STATUS.RECOVERED) st.recovered += 1;
        else if (isConfident(r)) st.confident.push(r.reason);
      }
    }

    // ---- The oracle differential
    if (!gradeable) { acc.routesNotGraded += 1; return; }
    const exp = oracleByAst.get(astRoute);
    if (!exp) {
      // The oracle walk did not reach a ROUTE the production path projected.
      // That is a harness defect, not a resolver finding, and must be loud.
      acc.oracleMissedRoutes += 1;
      if (acc.oracleMissedSamples.length < 25) acc.oracleMissedSamples.push({ id: docId });
      return;
    }
    acc.routesGraded += 1;

    compareNode(acc, docId, 'source', res.srcNode, exp.source.node);
    compareNode(acc, docId, 'destination', res.dstNode, exp.destination.node);
    compareEndpoint(acc, docId, 'source', res.srcEvt, sg.routeEndpointFor(graph, refs.srcEvt),
      exp.source.endpoint);
    compareEndpoint(acc, docId, 'destination', res.dstEvt, sg.routeEndpointFor(graph, refs.dstEvt),
      exp.destination.endpoint);
  });

  foldConfidentFromUnprovable(acc, docId, scopeState);
}

/**
 * Fold one document's per-scope evidence into the running violation count.
 *
 * A scope that produced any `recovered` answer must produce no CONFIDENT one:
 * recovery is a whole-scope property, so the combination is self-contradictory
 * and is checkable without trusting either the oracle or the resolver's own
 * account of which scopes it marked recovered.
 */
function foldConfidentFromUnprovable(acc, docId, scopeState) {
  for (const st of scopeState.values()) {
    if (st.recovered === 0 || st.confident.length === 0) continue;
    acc.confidentFromUnprovable += st.confident.length;
    for (const reason of st.confident) {
      if (acc.confidentFromUnprovableSamples.length < 25) {
        acc.confidentFromUnprovableSamples.push({ id: docId, reason });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The differential
// ---------------------------------------------------------------------------
//
// THE HARD GATE, restated (WD.md §7): an answer may be LOST and it may be
// declared UNPROVABLE. It may never confidently be a DIFFERENT one.
//
// So the comparison is deliberately asymmetric:
//   * production refuses where the oracle binds  -> AGREEMENT (a safe refusal)
//   * production binds where the oracle binds    -> must be the SAME declaration
//   * production binds where the oracle does not -> WRONG BINDING, strictly
//   * the oracle abstains                        -> UNCOMPARABLE, counted by reason

function compareNode(acc, docId, side, res, expect) {
  if (expect.verdict === oracle.EXPECT.ABSTAIN) {
    acc.nodeUncomparable += 1;
    bump(acc.nodeAbstainReasons, expect.why);
    return;
  }
  acc.nodeCompared += 1;

  const bound = res.status === STATUS.RESOLVED ? res.symbol : null;
  if (!bound) {
    // A refusal. Never a wrong binding, whatever the oracle expected.
    acc.nodeSafeRefusals += (expect.verdict === oracle.EXPECT.BINDS ? 1 : 0);
    acc.nodeAgreed += 1;
    return;
  }
  if (expect.verdict === oracle.EXPECT.NO_BINDING) {
    acc.nodeWrong += 1;
    recordWrong(acc.nodeWrongSamples, {
      id: docId, side, kind: 'node', why: expect.why, boundName: bound.name,
    });
    return;
  }
  if (bound.node !== expect.decl.node) {
    acc.nodeWrong += 1;
    recordWrong(acc.nodeWrongSamples, {
      id: docId, side, kind: 'node', why: 'bound-a-different-declaration',
      boundOffset: bound.node && bound.node.range && bound.node.range.start.offset,
      expectedOffset: expect.decl.offset,
    });
    return;
  }
  acc.nodeAgreed += 1;
}

function compareEndpoint(acc, docId, side, res, endpoint, expect) {
  if (expect.verdict === oracle.EXPECT.ABSTAIN) {
    acc.endpointUncomparable += 1;
    bump(acc.endpointAbstainReasons, expect.why);
    return;
  }
  acc.endpointCompared += 1;

  // An endpoint the resolver ACQUIRED but then judged directionally unusable is
  // still a binding claim about which member the author named, so it is graded.
  // Only a genuinely absent endpoint counts as a refusal.
  const bound = endpoint || null;
  if (!bound) {
    acc.endpointSafeRefusals += (expect.verdict === oracle.EXPECT.BINDS ? 1 : 0);
    acc.endpointAgreed += 1;
    return;
  }
  if (expect.verdict === oracle.EXPECT.NO_BINDING) {
    acc.endpointWrong += 1;
    recordWrong(acc.endpointWrongSamples, {
      id: docId, side, kind: 'endpoint', why: expect.why,
      bound: `${bound.effectiveName}:${bound.access}:${bound.type}`,
    });
    return;
  }
  const want = expect.endpoint;
  if (bound.effectiveName !== want.declaredName || bound.access !== want.access
    || bound.type !== want.type) {
    acc.endpointWrong += 1;
    recordWrong(acc.endpointWrongSamples, {
      id: docId, side, kind: 'endpoint', why: 'bound-a-different-member',
      bound: `${bound.effectiveName}:${bound.access}:${bound.type}`,
      expected: `${want.declaredName}:${want.access}:${want.type}`,
    });
    return;
  }
  acc.endpointAgreed += 1;
}

function recordWrong(list, rec) {
  if (list.length < 50) list.push(rec);
}

// ---------------------------------------------------------------------------
// Accumulator
// ---------------------------------------------------------------------------

function newAccumulator() {
  return {
    totalRoutes: 0,
    unprojectedRoutes: 0,
    unprojectedSamples: [],
    partition: {
      sourceNode: new Map(),
      destNode: new Map(),
      sourceEndpoint: new Map(),
      destEndpoint: new Map(),
      compatibility: new Map(),
    },
    directionInvalidSource: 0,
    directionInvalidDest: 0,
    typeMismatch: 0,
    typeMismatchSamples: [],
    typeUnknown: 0,
    endpointOrigin: { source: new Map(), destination: new Map() },
    aliasUse: new Map(),
    routesDependingOnRecovery: 0,
    routesDependingOnUnsupported: 0,
    routesDependingOnUnprovable: 0,
    confidentFromUnprovable: 0,
    confidentFromUnprovableSamples: [],
    // oracle
    routesGraded: 0,
    routesNotGraded: 0,
    oracleMissedRoutes: 0,
    oracleMissedSamples: [],
    nodeCompared: 0,
    nodeAgreed: 0,
    nodeWrong: 0,
    nodeSafeRefusals: 0,
    nodeUncomparable: 0,
    nodeAbstainReasons: new Map(),
    nodeWrongSamples: [],
    endpointCompared: 0,
    endpointAgreed: 0,
    endpointWrong: 0,
    endpointSafeRefusals: 0,
    endpointUncomparable: 0,
    endpointAbstainReasons: new Map(),
    endpointWrongSamples: [],
  };
}

/** The sweep-wide total, already folded per document. */
function finaliseConfidentFromUnprovable(acc) {
  return { count: acc.confidentFromUnprovable, samples: acc.confidentFromUnprovableSamples };
}

module.exports = {
  sg,
  isConfident,
  dependsOnRecovery,
  newAccumulator,
  analyseDocument,
  finaliseConfidentFromUnprovable,
  tallyToObject,
  sumValues,
  bump,
};
