'use strict';
// WD1.6-C -- adversarial controls for the coverage harness.
//
// A coverage script that only counts is not evidence: if a broken
// `childLegality` produced the same report, the report proves nothing. Each
// control below substitutes a MUTATED judge for the real one over a fixed
// in-repository document and asserts that the harness's own counters move in a
// specific, named way.
//
// The mutants are the six failure modes WD1.6-C is arranged to prevent. They run
// through `sweepDocument`'s injected `judge`, so no production file is edited,
// nothing is written, and a control cannot leave a mutation behind.

const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { parse } = require(path.join(REPO_ROOT, 'src', 'vrml'));
const sweep = require('./sweep');

const { CS, newCounters, sweepDocument, definitive } = sweep;
const containment = require(path.join(REPO_ROOT, 'src', 'vrml', 'containment.js'));
const { CONTAINMENT_REASON: CR, CANDIDATE_KIND } = containment;

// One document exercising every branch the controls need: a legal child, an
// illegal child, an unrepresented class, an absent-metadata field, a
// positive-only rule that MATCHES, a positive-only rule that MISSES, an
// EXTERNPROTO candidate and a recovered PROTO body.
//
// The positive-only MISS earns its place: without it, `PointSet.color` is only
// ever reached by a candidate the rule accepts, and the mutant that ignores
// exclusion completeness passes through the harness unnoticed. It survived a
// first draft of this fixture for exactly that reason.
const FIXTURE = [
  '#VRML V2.0 utf8',
  'EXTERNPROTO E [] ["e.wrl"]',
  'PROTO Broken [] {}',
  'Transform {',
  '  children [',
  '    Shape { geometry PointSet { color Color {} coord Coordinate {} } }',
  '    Shape { geometry PointSet { color Material {} } }',
  '    Box {}',
  '    FontStyle {}',
  '    E {}',
  '    Broken {}',
  '  ]',
  '}',
  'Collision { proxy Shape {} }',
  '',
].join('\n');

/** Wrap the real judge, rewriting only the verdicts a mutant is about. */
function mutate(fn) {
  return (graph, parent, field, candidate) => fn(containment.childLegality(graph, parent, field, candidate));
}

const asStatus = (v, status) => Object.freeze({ ...v, status });

const MUTANTS = [
  {
    id: 'metadata-absent-becomes-legal',
    describe: 'an unrepresented containment fact reported as permission',
    judge: mutate((v) => (v.arity && !v.required ? asStatus(v, CS.LEGAL) : v)),
  },
  {
    id: 'metadata-absent-becomes-illegal',
    describe: 'an unrepresented containment fact reported as refusal',
    judge: mutate((v) => (v.arity && !v.required ? asStatus(v, CS.ILLEGAL) : v)),
  },
  {
    id: 'externproto-becomes-illegal',
    describe: 'a locally unverifiable node class reported as refusal',
    judge: mutate((v) => (v.candidate && v.candidate.kind === CANDIDATE_KIND.EXTERNPROTO
      ? asStatus(v, CS.ILLEGAL) : v)),
  },
  {
    id: 'exclusion-completeness-ignored',
    describe: 'a positive-only rule used to prove a negative',
    judge: mutate((v) => (v.reason === CR.ACCEPTANCE_RULE_NOT_EXCLUSION_COMPLETE
      ? asStatus(v, CS.ILLEGAL) : v)),
  },
  {
    id: 'class-gap-becomes-illegal',
    describe: 'a node in neither ISO children list reported as refusal',
    judge: mutate((v) => (v.reason === CR.CLASS_MEMBERSHIP_NOT_DETERMINED
      ? asStatus(v, CS.ILLEGAL) : v)),
  },
  {
    id: 'proto-recovery-gate-bypassed',
    describe: 'a parser-recovered PROTO body classified confidently',
    judge: mutate((v) => (v.reason === CR.PROTO_BODY_NOT_PROVABLE
      ? asStatus(v, CS.LEGAL) : v)),
  },
  {
    id: 'legal-flipped-to-illegal',
    describe: 'a proven-legal placement refused',
    judge: mutate((v) => (v.status === CS.LEGAL ? asStatus(v, CS.ILLEGAL) : v)),
  },
  {
    id: 'illegal-flipped-to-legal',
    describe: 'a proven-illegal placement permitted',
    judge: mutate((v) => (v.status === CS.ILLEGAL ? asStatus(v, CS.LEGAL) : v)),
  },
];

function baseline() {
  const parsed = parse(FIXTURE);
  const counters = newCounters();
  sweepDocument(parsed, 'control:fixture', counters);
  return counters;
}

/** A signature the mutants must perturb: statuses plus the headline numerator. */
function signature(counters) {
  return JSON.stringify({
    status: Object.keys(counters.byStatus).sort().map((k) => [k, counters.byStatus[k]]),
    definitive: definitive(counters),
    reconcileClean: sweep.reconcile(counters).length === 0,
  });
}

function run() {
  const base = baseline();
  const baseSig = signature(base);
  const results = [];

  // The fixture must actually reach every branch, or a mutant would be "killed"
  // by a document that never exercises it.
  const preconditions = {
    hasLegal: (base.byStatus[CS.LEGAL] || 0) > 0,
    hasIllegal: (base.byStatus[CS.ILLEGAL] || 0) > 0,
    hasMetadataAbsent: base.metadataUncovered > 0,
    hasPositiveOnly: base.positiveOnlyRule > 0,
    // Distinct from the above, and the distinction is load-bearing: a
    // positive-only rule that always MATCHES never reaches the branch where
    // exclusion completeness is what withholds the answer.
    hasPositiveOnlyMiss: Object.keys(base.byReason)
      .some((k) => k.endsWith(CR.ACCEPTANCE_RULE_NOT_EXCLUSION_COMPLETE)),
    hasExternproto: (base.byCandidateKind[CANDIDATE_KIND.EXTERNPROTO] || 0) > 0,
    hasClassGap: Object.keys(base.byReason).some((k) => k.endsWith(CR.CLASS_MEMBERSHIP_NOT_DETERMINED)),
    hasRecoveredProto: Object.keys(base.byReason).some((k) => k.endsWith(CR.PROTO_BODY_NOT_PROVABLE)),
  };

  for (const mutant of MUTANTS) {
    const parsed = parse(FIXTURE);
    const counters = newCounters();
    sweepDocument(parsed, 'control:fixture', counters, mutant.judge);
    const sig = signature(counters);
    const problems = sweep.reconcile(counters);
    results.push({
      id: mutant.id,
      describe: mutant.describe,
      // KILLED means the harness's reported numbers changed, OR its own
      // reconciliation refused the run. Either way the mutant cannot pass
      // through this harness unnoticed.
      killed: sig !== baseSig || problems.length > 0,
      detectedBy: sig !== baseSig ? 'counters-changed' : (problems.length ? 'reconciliation' : null),
      reconcileProblems: problems,
    });
  }

  return {
    fixtureLines: FIXTURE.split('\n').length,
    preconditions,
    baseline: {
      placements: base.placementsExamined,
      byStatus: { ...base.byStatus },
      byCandidateKind: { ...base.byCandidateKind },
      definitive: definitive(base),
    },
    mutants: results,
    allKilled: results.every((r) => r.killed),
    allPreconditionsMet: Object.values(preconditions).every(Boolean),
  };
}

module.exports = { FIXTURE, MUTANTS, run, baseline, signature };
