'use strict';
// WD1.6-D -- structured semantic findings over the real corpus.
//
// THE QUESTIONS THIS ANSWERS, and their denominators, stated before any number:
//
//   Q1  Over real authored documents, does `findingsForDocument` ever THROW?
//       Denominator: unique decoded documents parsed.
//   Q2  Does every finding's ISO classification come from the committed table,
//       rather than from `isoFor`'s weak-claim fallback?
//       Denominator: findings produced.
//   Q3  Does any finding CONTRADICT the verdict it was projected from -- a
//       different status, reason or detail than the substrate returns when the
//       same authority is re-asked?
//       Denominator: findings whose subject carries a re-askable reference.
//   Q4  Does any finding carry a presentation field?
//       Denominator: findings produced.
//
// Q2's static half is already proven by `test/vrml/semantic-findings.test.js`
// (the table is total over `REASON`). What a corpus adds is the DYNAMIC half:
// whether real content produces reasons the table classifies as `NOT_STATED`
// by accident of omission rather than by decision. That is why the fallback is
// counted separately from the classification.
//
// This lane deliberately does NOT re-measure P2B's or P2C's binding correctness.
// Those were graded at zero wrong bindings over 23,246 `IS` statements and
// 245,540 ROUTEs, and D projects those verdicts verbatim; re-deriving them
// through a new accessor would spend a corpus run to re-learn a known fact.
// What is genuinely new here is the PROJECTION and the finding SURFACE.
//
// READ-ONLY, boundary-guarded, deterministic. Discovery, decoding, decoded-text
// de-duplication and the forbidden-path guard are P2C's committed
// `spikes/wd1-route-semantics/corpus.js`, reused UNMODIFIED -- the same
// arrangement WD1.6-C used. Nothing here writes to a corpus tree, copies corpus
// content into this repository, or reads a White Dune path: the inherited guard
// THROWS on one rather than skipping it.
//
// NOT A VALIDATOR. A corpus finding is a measurement, not a verdict on the
// document. Real Cybertown content is non-conforming in places that were
// adjudicated normatively correct in earlier lanes (P2B's 1,481 Table 4.4
// violations among them), so distributions are reported for reading, never
// gated on.

const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const corpus = require(path.join(REPO_ROOT, 'spikes', 'wd1-route-semantics', 'corpus.js'));
const sg = require(path.join(REPO_ROOT, 'src', 'vrml', 'scope-graph.js'));
const semanticFindings = require(path.join(REPO_ROOT, 'src', 'vrml', 'semantic-findings.js'));

const { FINDING_CODE, ISO_BY_REASON } = semanticFindings;
const { STATUS } = sg;

const MAX_EXAMPLES = 5;

// The whole key set a finding is allowed to have. Anything else -- a severity, a
// message, a visibility flag -- is a presentation field arriving in the semantic
// record, and is counted as a defect rather than reported as a distribution.
const ALLOWED_KEYS = Object.freeze([
  'code', 'compatibility', 'confidence', 'detail', 'evidence', 'iso', 'range', 'reason', 'rule', 'subject',
].sort());

function newCounters() {
  return {
    findings: 0,
    documentsWithFindings: 0,
    maxFindingsInOneDocument: 0,
    maxFindingsDocumentId: null,
    byCode: Object.create(null),
    byIso: Object.create(null),
    byConfidence: Object.create(null),
    byCodeReason: Object.create(null),
    // --- the four gated defect counters, each zero on a clean run ------------
    queryThrows: 0,
    queryThrowExamples: [],
    isoFallbacks: 0,
    isoFallbackExamples: [],
    isoMismatches: 0,
    isoMismatchExamples: [],
    contradictions: 0,
    contradictionExamples: [],
    shapeViolations: 0,
    shapeViolationExamples: [],
    compatibilityPopulated: 0,
    // --- re-check denominator -----------------------------------------------
    recheckable: 0,
    unrangedFindings: 0,
  };
}

const bump = (table, key) => { table[key] = (table[key] || 0) + 1; };
const push = (list, item) => { if (list.length < MAX_EXAMPLES) list.push(item); };

/** Re-ask the SAME authority the finding was projected from, or `null`. */
function reQuery(graph, finding) {
  const ref = finding.subject.reference;
  if (!ref) return null;
  switch (finding.code) {
    case FINDING_CODE.USE_NOT_BOUND:
    case FINDING_CODE.NODE_TYPE_NOT_BOUND:
      return sg.resolve(graph, ref);
    case FINDING_CODE.IS_TARGET_NOT_BOUND:
      return sg.resolveIs(graph, ref);
    case FINDING_CODE.IS_CONNECTION_REJECTED:
      return sg.isConnectionVerdict(graph, ref);
    case FINDING_CODE.ROUTE_NODE_NOT_BOUND:
      return sg.resolveRouteNode(graph, ref);
    case FINDING_CODE.ROUTE_ENDPOINT_NOT_BOUND:
      return sg.resolveRouteEndpoint(graph, ref);
    default:
      return null;
  }
}

/**
 * One document's findings, audited.
 *
 * `produce` is injected so `controls.js` can substitute a MUTATED producer and
 * prove the gates actually move. A harness whose numbers a broken implementation
 * would not change is a passive counter, not evidence.
 */
function sweepDocument(parsed, docId, counters, produce = semanticFindings.findingsForDocument) {
  let graph;
  try {
    graph = sg.buildScopeGraph(parsed);
  } catch (err) {
    return { graphError: String(err && err.message).slice(0, 200) };
  }

  let findings;
  try {
    findings = produce(graph);
  } catch (err) {
    counters.queryThrows += 1;
    push(counters.queryThrowExamples, {
      id: docId, code: err && err.code ? err.code : null,
      message: String(err && err.message).slice(0, 200),
    });
    return { findings: 0 };
  }

  if (findings.length) {
    counters.documentsWithFindings += 1;
    if (findings.length > counters.maxFindingsInOneDocument) {
      counters.maxFindingsInOneDocument = findings.length;
      counters.maxFindingsDocumentId = docId;
    }
  }

  for (const f of findings) {
    counters.findings += 1;
    bump(counters.byCode, f.code);
    bump(counters.byIso, f.iso);
    bump(counters.byConfidence, f.confidence);
    bump(counters.byCodeReason, `${f.code}/${f.reason}`);
    if (!f.range || !f.range.start) counters.unrangedFindings += 1;
    if (f.compatibility !== null) counters.compatibilityPopulated += 1;

    // Q4 -- shape.
    const keys = Object.keys(f).sort();
    if (keys.length !== ALLOWED_KEYS.length || keys.some((k, i) => k !== ALLOWED_KEYS[i])) {
      counters.shapeViolations += 1;
      push(counters.shapeViolationExamples, { id: docId, code: f.code, keys });
    }

    // Q2 -- ISO classification provenance. Containment carries WD1.6-C's own
    // citation and is deliberately absent from the table, so it is excluded from
    // the fallback denominator rather than counted as a miss.
    if (f.code !== FINDING_CODE.CHILD_NOT_PERMITTED) {
      const entry = ISO_BY_REASON[f.reason];
      if (!entry) {
        counters.isoFallbacks += 1;
        push(counters.isoFallbackExamples, { id: docId, code: f.code, reason: f.reason });
      } else if (entry.iso !== f.iso || entry.rule !== f.rule) {
        counters.isoMismatches += 1;
        push(counters.isoMismatchExamples, {
          id: docId, code: f.code, reason: f.reason, got: f.iso, expected: entry.iso,
        });
      }
    }

    // Q3 -- does the projection contradict its source?
    const answer = reQuery(graph, f);
    if (!answer) continue;
    counters.recheckable += 1;
    const detail = answer.detail == null ? null : answer.detail;
    if (answer.status !== f.confidence || answer.reason !== f.reason || detail !== f.detail) {
      counters.contradictions += 1;
      push(counters.contradictionExamples, {
        id: docId,
        code: f.code,
        finding: { status: f.confidence, reason: f.reason, detail: f.detail },
        authority: { status: answer.status, reason: answer.reason, detail },
      });
    }
  }

  return { findings: findings.length };
}

/** Every partition must reconcile to the finding total or the run is void. */
function reconcile(counters) {
  const problems = [];
  const sum = (table) => Object.values(table).reduce((a, b) => a + b, 0);
  if (sum(counters.byCode) !== counters.findings) problems.push('byCode does not sum to findings');
  if (sum(counters.byIso) !== counters.findings) problems.push('byIso does not sum to findings');
  if (sum(counters.byConfidence) !== counters.findings) problems.push('byConfidence does not sum to findings');
  if (sum(counters.byCodeReason) !== counters.findings) problems.push('byCodeReason does not sum to findings');
  for (const status of Object.keys(counters.byConfidence)) {
    if (!Object.values(STATUS).includes(status)) problems.push(`confidence ${status} is not a STATUS`);
  }
  return problems;
}

module.exports = { corpus, newCounters, sweepDocument, reconcile, reQuery, ALLOWED_KEYS };
