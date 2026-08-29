'use strict';
// WD1.7-C, orchestration half -- ONE EXTERNPROTO declaration, resolved.
//
// The layer that may finally say RESOLVED. It composes three authorities and
// owns none of them:
//
//   WD1.7-B  (`src/external-proto`)  retrieval: classification, routing, exact
//                                    case, containment, gzip, bounds. Reached
//                                    ONLY through its public facade.
//   the parser (`src/vrml`.parse)    the sole syntax authority for the target.
//   WD1.7-C pure (`src/vrml`.protoTarget)   ISO 4.9.3 selection over that parse.
//
// It adds exactly one thing of its own: the ISO 4.5.2/N11 CANDIDATE WALK.
//
//     candidate 0 -> retrieve -> parse -> select -> RESOLVED?  stop.
//                 -> anything else                          -> candidate 1 ...
//
// RETRIEVED IS NOT RESOLVED, and this module is the only place the difference
// can be closed. `RETRIEVED` means bytes were obtained under a configured
// policy; `RESOLVED` additionally means those bytes parsed as VRML and ISO 4.9.3
// selected exactly one PROTO from them. A candidate that retrieves cleanly and
// then fails selection is NOT the answer, and the walk continues past it --
// WD1.7-A §15.3 lists exactly which outcomes are non-terminal, and every one of
// them is.
//
// NODE-SIDE, because retrieval is. Nothing here is browser-safe and nothing here
// is reachable from `require('src/vrml')`; the direction is one-way.
//
// THE BASE DOCUMENT IS A REQUIRED INPUT, never inferred (ISO 4.5.3/N12). This
// module does not compute one -- computing it needs instantiation context, which
// is `dependency-graph.js`'s job. Making it an argument is what stops a
// PROTO-body declaration from being quietly resolved against its declaring file.

const { parse } = require('../vrml');
const { protoTarget } = require('../vrml');
const {
  retrieveExternalCandidate,
  RETRIEVAL_STATUS,
} = require('../external-proto');

const { SELECTION_STATUS, SELECTION_RULE } = protoTarget;

// Resolution statuses -- about MEANING. WD1.7-A §10's RESOLUTION set, minus
// `DEPENDENCY_CYCLE`, which is a property of a traversal rather than of one
// declaration and therefore lives on the graph edge (`dependency-graph.js`).
// Retrieval statuses (`RETRIEVED`, `NOT_FOUND`, ...) are WD1.7-B's and are
// carried per candidate, never folded into these.
const RESOLUTION_STATUS = Object.freeze({
  /** A unique artifact parsed, and 4.9.3 selected exactly one PROTO from it. */
  RESOLVED: 'RESOLVED',
  TARGET_PARSE_FAILED: 'TARGET_PARSE_FAILED',
  TARGET_PROTO_NOT_FOUND: 'TARGET_PROTO_NOT_FOUND',
  TARGET_PROTO_AMBIGUOUS: 'TARGET_PROTO_AMBIGUOUS',
  /**
   * The semantic question was never asked, because no candidate ever produced an
   * artifact to ask it about -- or because the declaration itself is not
   * provable. NOT a failure of the target: nothing about a target was
   * established. WD1.7-A §10.
   */
  NOT_ATTEMPTED: 'NOT_ATTEMPTED',
});

const RESOLUTION_REASON = Object.freeze({
  OK: 'ok',
  /**
   * Parser recovery touched the EXTERNPROTO statement, so its url list is not
   * provable. Withheld rather than resolved against a list recovery may have
   * manufactured -- the same gate WD1.7-B2 applies for the same reason.
   */
  DECLARATION_UNPROVABLE: 'declaration-unprovable',
  /** The declaration is intact and its url list is provably empty. */
  NO_CANDIDATES: 'no-candidates',
  /** Every candidate failed at RETRIEVAL, so nothing was ever parsed. */
  NO_CANDIDATE_RETRIEVED: 'no-candidate-retrieved',
});

function fail(msg) { throw new TypeError(`external prototype resolution: ${msg}`); }

/**
 * An operation-scoped, disposable parse cache.
 *
 * DERIVED, NOT STATE. Keyed by decoded content identity, so one artifact reached
 * through two archive locations is parsed once -- but note carefully what is and
 * is not shared: the PARSE may be shared because it is a function of the text
 * alone; the RETRIEVAL and BASE provenance may not, because ISO 4.5.3 resolves
 * the target's own relative references against *its* base and two identical
 * copies can sit under different ones (WD1.7-A §15.2).
 *
 * There is deliberately no module-level cache. A global one would outlive the
 * configuration it was built under and would make a second call's answer depend
 * on the first's.
 */
function createResolutionSession() {
  return { parses: new Map() };
}

function parseTargetCached(session, decodedContentHash, text) {
  if (!session) return parse(text);
  const hit = session.parses.get(decodedContentHash);
  if (hit) return hit;
  const parsed = parse(text);
  session.parses.set(decodedContentHash, parsed);
  return parsed;
}

// The retrieval facts a candidate keeps. B's own vocabulary, projected rather
// than reinterpreted: no status is renamed and no reason is flattened.
function projectRetrieval(r) {
  return Object.freeze({
    status: r.status,
    reason: r.reason,
    form: r.reference.form,
    /** Carried verbatim from B. Interpreted HERE, by 4.9.3, and nowhere else. */
    fragment: r.reference.fragment,
    target: r.target,
    requestedPath: r.requestedPath,
    consideredSourceIds: r.consideredSourceIds,
    evidenceSourceId: r.artifact ? r.artifact.evidenceSourceId : null,
    artifactPath: r.artifact ? r.artifact.artifactPath : null,
    retrievedBytesHash: r.artifact ? r.artifact.retrievedBytesHash : null,
    decodedContentHash: r.artifact ? r.artifact.decodedContentHash : null,
    wasGzipped: r.artifact ? r.artifact.wasGzipped : null,
    utf8Valid: r.artifact ? r.artifact.utf8Valid : null,
    /** Every source that answered, so equivalent-content provenance survives. */
    matches: r.matches,
  });
}

// The selection facts a candidate keeps. AST handles are NOT copied down here --
// only the winning candidate's target carries them, and only for this parse.
function projectSelection(s) {
  return Object.freeze({
    status: s.status,
    reason: s.reason,
    rule: s.rule,
    fragment: s.fragment,
    selectedProtoName: s.selectedProtoName,
    declarationRange: s.declarationRange,
    matches: s.matches,
    topLevelProtoCount: s.topLevelProtoCount,
  });
}

function candidateRecord(fields) {
  return Object.freeze({
    index: fields.index,
    /** EXACTLY as authored. Never trimmed, re-spelled or normalised. */
    writtenUrl: fields.writtenUrl,
    range: fields.range || null,
    /**
     * `false` for a candidate the 4.5.2 walk never reached, because an earlier
     * one already RESOLVED. It is NOT given a failure status it never earned.
     */
    evaluated: !!fields.evaluated,
    retrieval: fields.retrieval || null,
    /** `null` when retrieval never produced bytes to select from. */
    selection: fields.selection || null,
  });
}

function resolution(fields) {
  return Object.freeze({
    status: fields.status,
    reason: fields.reason,
    /** The local EXTERNPROTO's declared type name, and its spans. */
    declarationName: fields.declarationName == null ? null : fields.declarationName,
    declarationRange: fields.declarationRange || null,
    /** ISO 4.5.3/N12 -- what the candidate urls were resolved against. */
    baseDocument: fields.baseDocument || null,
    /** The winning candidate's index, or `null`. */
    selectedCandidateIndex: fields.selectedCandidateIndex === undefined ? null : fields.selectedCandidateIndex,
    /** EVERY written candidate, in authored order, with its own outcome. */
    candidates: Object.freeze(fields.candidates || []),
    /** The proven target, or `null`. See `targetRecord`. */
    target: fields.target || null,
  });
}

// The proof WD1.7-D consumes instead of selecting the target a second time.
function targetRecord(fields) {
  return Object.freeze({
    /** Where the bytes came from, under a NAMED configuration. */
    evidenceSourceId: fields.evidenceSourceId,
    artifactPath: fields.artifactPath,
    retrievedBytesHash: fields.retrievedBytesHash,
    decodedContentHash: fields.decodedContentHash,
    wasGzipped: fields.wasGzipped,
    /** Which PROTO, and under which of 4.9.3's two rules. */
    selectedProtoName: fields.selectedProtoName,
    selectionRule: fields.selectionRule,
    /**
     * The §7 hard gate made explicit: a selection is only ever reported when it
     * was unique. Kept as a field because WD1.7-A §9 names it, and because a
     * consumer should be able to read the guarantee rather than infer it.
     */
    selectionWasUnique: true,
    declarationRange: fields.declarationRange,
    /**
     * The base document the TARGET's own relative references resolve against
     * (ISO 4.5.3 case 3). Derived from where the artifact was actually
     * retrieved, which is why identical content from two roots is NOT collapsed.
     */
    base: fields.base,
    /**
     * PARSE-LIFETIME ONLY, both of these. `parseResult` is this operation's
     * parse of the target text and `declaration` is a node inside it. They are
     * derived, disposable projections -- not persistent identity, not a document
     * handle, not written anywhere (WD.md §2/§7). A consumer that keeps them
     * past the operation keeps a stale tree, not an identity.
     */
    parseResult: fields.parseResult,
    declaration: fields.declaration,
  });
}

/**
 * Resolve ONE EXTERNPROTO declaration to its ISO 4.9.3 target.
 *
 * @param {object} params
 * @param {object} params.context A frozen `ResolverContext` from WD1.7-B.
 * @param {{sourceId: string, path: string}} params.baseDocument REQUIRED.
 *   ISO 4.5.3/N12 -- never inferred here.
 * @param {object} params.parseResult The parse the declaration belongs to.
 * @param {object} params.declaration An `ExternProto` AST node from that parse.
 * @param {object} [params.session] An operation-scoped parse cache.
 * @param {object} [deps] B's injectable fs surface, passed straight through.
 * @returns {object} A frozen resolution record.
 */
function resolveExternalPrototype(params = {}, deps = {}) {
  const { context, baseDocument, parseResult, declaration, session } = params;
  if (!context || typeof context !== 'object') fail('context must be a ResolverContext');
  if (!baseDocument || typeof baseDocument !== 'object') {
    fail('baseDocument is REQUIRED (ISO 4.5.3/N12); it is never inferred');
  }
  // Reading the declaration is the PARSER's job, reached through the pure layer.
  // No regex, no brace scan, no textual url extraction anywhere in this lane.
  const decl = protoTarget.externProtoCandidates(parseResult, declaration);
  const base = { declarationName: decl.name, declarationRange: decl.range, baseDocument };

  if (decl.damaged) {
    return resolution({ ...base, status: RESOLUTION_STATUS.NOT_ATTEMPTED, reason: RESOLUTION_REASON.DECLARATION_UNPROVABLE });
  }
  if (decl.candidates.length === 0) {
    return resolution({ ...base, status: RESOLUTION_STATUS.NOT_ATTEMPTED, reason: RESOLUTION_REASON.NO_CANDIDATES });
  }

  const candidates = [];
  let winner = null;

  for (const c of decl.candidates) {
    if (winner) {
      // WD1.7-C brief §17: once a candidate RESOLVES, the ISO preference list is
      // satisfied and later entries are NOT semantically evaluated. They keep
      // their place and their written spelling, and they are NOT given an
      // invented failure status.
      candidates.push(candidateRecord({ index: c.index, writtenUrl: c.writtenUrl, range: c.range, evaluated: false }));
      continue;
    }
    const r = retrieveExternalCandidate({
      context, baseDocument, writtenUrl: c.writtenUrl, candidateIndex: c.index,
    }, deps);
    const retrieval = projectRetrieval(r);

    if (r.status !== RETRIEVAL_STATUS.RETRIEVED) {
      // Non-terminal by contract (WD1.7-A §15.3). The walk continues, and the
      // per-candidate reason is preserved rather than folded into a summary.
      candidates.push(candidateRecord({ index: c.index, writtenUrl: c.writtenUrl, range: c.range, evaluated: true, retrieval }));
      continue;
    }

    const targetParse = parseTargetCached(session, r.artifact.decodedContentHash, r.text);
    const selected = protoTarget.selectPrototypeTarget(targetParse, { fragment: r.reference.fragment });
    candidates.push(candidateRecord({
      index: c.index, writtenUrl: c.writtenUrl, range: c.range, evaluated: true,
      retrieval, selection: projectSelection(selected),
    }));

    if (selected.status !== SELECTION_STATUS.RESOLVED) continue;

    winner = {
      index: c.index,
      target: targetRecord({
        evidenceSourceId: r.artifact.evidenceSourceId,
        artifactPath: r.artifact.artifactPath,
        retrievedBytesHash: r.artifact.retrievedBytesHash,
        decodedContentHash: r.artifact.decodedContentHash,
        wasGzipped: r.artifact.wasGzipped,
        selectedProtoName: selected.selectedProtoName,
        selectionRule: selected.rule,
        declarationRange: selected.declarationRange,
        base: Object.freeze({ sourceId: r.artifact.evidenceSourceId, path: r.artifact.artifactPath }),
        parseResult: targetParse,
        declaration: selected.declaration,
      }),
    };
  }

  if (winner) {
    return resolution({ ...base, status: RESOLUTION_STATUS.RESOLVED, reason: RESOLUTION_REASON.OK, selectedCandidateIndex: winner.index, candidates, target: winner.target });
  }

  // NO WINNER. The reported status is the FIRST semantically evaluated
  // candidate's, because ISO 4.5.2's order is a statement of PREFERENCE: the
  // most-preferred candidate that actually produced a document is the one whose
  // failure the author most needs to see. Every other outcome is still in
  // `candidates`, so nothing is lost by choosing a headline.
  const firstSemantic = candidates.find((c) => c.selection);
  if (firstSemantic) {
    return resolution({ ...base, status: firstSemantic.selection.status, reason: firstSemantic.selection.reason, candidates });
  }
  return resolution({ ...base, status: RESOLUTION_STATUS.NOT_ATTEMPTED, reason: RESOLUTION_REASON.NO_CANDIDATE_RETRIEVED, candidates });
}

module.exports = {
  RESOLUTION_STATUS,
  RESOLUTION_REASON,
  SELECTION_STATUS,
  SELECTION_RULE,
  createResolutionSession,
  resolveExternalPrototype,
};
