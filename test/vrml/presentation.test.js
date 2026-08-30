'use strict';
// P4-A -- semantic findings presentation policy.
//
// Ten independent policy fixtures (Q1-Q10) plus the architecture assertions
// that keep presentation a SIBLING of the evidence rather than a rewrite of it.
// The matrix guard lives in `presentation-matrix.test.js` and the live mutation
// controls in `presentation-mutations.test.js`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vrml = require('../../src/vrml');
const presentation = require('../../src/vrml/presentation');
const semanticFindings = require('../../src/vrml/semantic-findings');
const compatibility = require('../../src/vrml/compatibility');
const protoAgreement = require('../../src/vrml/proto-agreement');
const sg = require('../../src/vrml/scope-graph');
const F = require('./presentation-fixtures');

const {
  SEVERITY, CLAIM, CONFIDENCE_CLASS, FINDING_ORIGIN, FINDING_GROUP, FILTER_TAG,
  PRESENTATION_ERROR,
  presentSemanticFinding, presentAgreementFinding, presentAgreementStatus,
  presentDocumentFindings, orderPresentations,
} = presentation;
const { ISO_RESULT, FINDING_CODE } = semanticFindings;
const { STATUS, REASON } = sg;
const { AGREEMENT_STATUS, AGREEMENT_FINDING } = protoAgreement;

const SOURCE_PATH = path.join(__dirname, '../../src/vrml/presentation.js');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');
/** The module's CODE, with comment lines removed -- the header discusses the
 * concepts several scans below assert are absent from the implementation. */
const CODE = SOURCE.split('\n')
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

const P = (finding) => presentSemanticFinding(finding).presentation;

// ---------------------------------------------------------------------------
// 1. Architecture -- one authority, browser-safe, no semantic reinterpretation
// ---------------------------------------------------------------------------

test('01 the module is browser-safe and adds no runtime dependency', () => {
  for (const banned of [/require\('node:/, /require\('fs'\)/, /require\('path'\)/,
    /require\('zlib'\)/, /require\('crypto'\)/, /require\('child_process'\)/,
    /\belectron\b/, /\bdocument\./, /\bwindow\./, /\bfetch\(/]) {
    assert.ok(!banned.test(CODE), `presentation.js must not reference ${banned}`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['x_ite']);
});

test('02 severity is the repository severity, by identity -- not a second copy', () => {
  assert.equal(presentation.SEVERITY, vrml.diagnostics.SEVERITY);
  assert.equal(vrml.presentation.SEVERITY, vrml.diagnostics.SEVERITY);
});

test('03 the facade publishes the contract and withholds the policy tables', () => {
  assert.deepEqual(Object.keys(vrml.presentation).sort(), [
    'CLAIM', 'CONFIDENCE_CLASS', 'FILTER_TAG', 'FINDING_GROUP', 'FINDING_ORIGIN',
    'PRESENTATION_ERROR', 'SEVERITY', 'orderPresentations', 'presentAgreementFinding',
    'presentAgreementStatus', 'presentDocumentFindings', 'presentSemanticFinding',
  ]);
  assert.ok(Object.isFrozen(vrml.presentation));
  for (const internal of ['CLAIM_BY_ISO', 'SEVERITY_BY_CLAIM', 'CONFIDENCE_CLASS_BY_STATUS',
    'GROUP_BY_FINDING_CODE', 'ISO_BY_AGREEMENT_BASIS', 'SEVERITY_RANK', 'CONFIDENCE_RANK']) {
    assert.equal(vrml.presentation[internal], undefined, `${internal} is reasoning, not contract`);
  }
  // WD1.7-E1's posture is untouched: the registry is still not on the facade.
  assert.equal(vrml.compatibility, undefined);
});

test('04 P4 names no compatibility profile and mints no semantic vocabulary', () => {
  // Every compatibility value it presents is read from the attached record or
  // imported from WD1.7-E1's own table; nothing is spelled here.
  for (const banned of [/blaxxun/i, /glview/i, /'tolerated-violation'/, /'extra-standard'/]) {
    assert.ok(!banned.test(CODE), `presentation.js code names ${banned}`);
  }
  // And no second ISO / status / agreement-basis vocabulary: every one of those
  // values is imported. (`FILTER_TAG.RECOVERED` is spelled here on purpose --
  // it is a filter tag a UI keys off, and its value coinciding with the status
  // it is derived from is the point, not a duplicate table.)
  for (const banned of [/'prohibited'/, /'not-stated'/, /'undefined'/, /'resolved'/,
    /'unresolved'/, /'ambiguous'/, /'unsupported'/, /'iso-4\.9\.2'/,
    /'not-specified-by-iso-4\.9\.2'/, /'satisfied'/, /'withheld'/, /'not-attempted'/]) {
    assert.ok(!banned.test(CODE), `presentation.js code re-spells ${banned}`);
  }
});

test('05 a foreign or malformed record fails loudly rather than presenting a default', () => {
  for (const bad of [null, undefined, 42, 'finding', [], {}]) {
    assert.throws(() => presentSemanticFinding(bad),
      (e) => e.code === PRESENTATION_ERROR.SHAPE, `${JSON.stringify(bad)} must throw`);
    assert.throws(() => presentAgreementFinding(bad),
      (e) => e.code === PRESENTATION_ERROR.SHAPE);
  }
  assert.throws(() => presentDocumentFindings(null),
    (e) => e.code === PRESENTATION_ERROR.SHAPE);
  assert.throws(() => orderPresentations('nope'),
    (e) => e.code === PRESENTATION_ERROR.SHAPE);
  // An unclassified vocabulary value is a policy gap, not a default.
  assert.throws(() => presentSemanticFinding(F.synthetic({ code: 'invented-code' })),
    (e) => e.code === PRESENTATION_ERROR.UNCLASSIFIED);
  assert.throws(() => presentSemanticFinding(F.synthetic({ iso: 'invented-iso' })),
    (e) => e.code === PRESENTATION_ERROR.UNCLASSIFIED);
  assert.throws(() => presentSemanticFinding(F.synthetic({ confidence: 'invented-status' })),
    (e) => e.code === PRESENTATION_ERROR.UNCLASSIFIED);
  assert.throws(() => presentAgreementStatus('invented-status'),
    (e) => e.code === PRESENTATION_ERROR.UNCLASSIFIED);
});

// ---------------------------------------------------------------------------
// 2. Q1-Q10 -- the policy fixtures
// ---------------------------------------------------------------------------

test('Q1 a proven strict violation presents at the highest semantic severity', () => {
  const f = F.illegalChild();
  assert.equal(f.iso, ISO_RESULT.PROHIBITED);
  assert.equal(f.confidence, STATUS.RESOLVED);
  const p = P(f);
  assert.equal(p.severity, SEVERITY.ERROR);
  assert.equal(p.claim, CLAIM.VIOLATION);
  assert.equal(p.group, FINDING_GROUP.SCENE_STRUCTURE);
  assert.equal(p.origin, FINDING_ORIGIN.SEMANTIC);
  assert.equal(p.attentionRank, 0);
  assert.deepEqual([...p.tags],
    [FILTER_TAG.ERRORS, FILTER_TAG.CONCLUSIVE, FILTER_TAG.STRICT_ISO]);
});

test('Q2 an earned compatibility attachment does not change the primary severity', () => {
  const strict = F.scriptExposedField();
  const tolerated = F.scriptExposedFieldWithCompatibility();
  assert.equal(strict.compatibility, null);
  assert.equal(tolerated.compatibility.classification,
    compatibility.COMPATIBILITY_CLASSIFICATION.TOLERATED_VIOLATION);

  const a = P(strict);
  const b = P(tolerated);
  // Identical on every dimension a downgrade would touch.
  assert.equal(b.severity, a.severity);
  assert.equal(b.severity, SEVERITY.ERROR);
  assert.equal(b.claim, a.claim);
  assert.equal(b.claim, CLAIM.VIOLATION);
  assert.equal(b.attentionRank, a.attentionRank);
  assert.equal(b.visible, true);
  assert.equal(b.iso, a.iso);

  // The attachment is an ANNOTATION beside it.
  assert.equal(a.compatibility, null);
  assert.equal(b.compatibility.profile, tolerated.compatibility.profile);
  assert.equal(b.compatibility.tolerated, true);
  assert.equal(b.compatibility.portable, false, 'tolerated is not portable');
  assert.equal(b.compatibility.downgradesSeverity, false);
  assert.equal(b.compatibility.evidenceTier, tolerated.compatibility.tier);
  assert.equal(b.compatibility.evidenceSubtier, tolerated.compatibility.subtier);
  assert.ok(b.tags.includes(FILTER_TAG.COMPATIBILITY));
  assert.ok(b.tags.includes(FILTER_TAG.ERRORS));
});

test('Q3 ACCESS_DIFFERS is a non-error observation, filterable on its own', () => {
  const f = F.accessDiffers();
  assert.equal(f.basis, protoAgreement.AGREEMENT_BASIS.NOT_SPECIFIED_BY_ISO_4_9_2);
  const p = presentAgreementFinding(f).presentation;
  assert.notEqual(p.severity, SEVERITY.ERROR);
  assert.equal(p.severity, SEVERITY.INFO);
  assert.equal(p.claim, CLAIM.OBSERVATION);
  assert.equal(p.iso, ISO_RESULT.NOT_STATED);
  assert.equal(p.origin, FINDING_ORIGIN.INTERFACE_AGREEMENT);
  assert.equal(p.group, FINDING_GROUP.EXTERNAL_INTERFACE);
  assert.equal(p.compatibility, null, 'WD1.7-D file targets stay NOT EVALUATED');
  assert.deepEqual([...p.tags],
    [FILTER_TAG.INFORMATION, FILTER_TAG.CONCLUSIVE, FILTER_TAG.NOT_SPECIFIED_BY_ISO]);

  // Its 4.9.2 sibling in the same family IS an error -- the split is the basis.
  const missing = presentAgreementFinding(F.memberMissing()).presentation;
  assert.equal(missing.severity, SEVERITY.ERROR);
  assert.equal(missing.claim, CLAIM.VIOLATION);
});

test('Q4 unsupported and withheld present as uncertainty, never as proven invalidity', () => {
  const unsupported = F.unsupportedIs();
  assert.equal(unsupported.confidence, STATUS.UNSUPPORTED);
  const p = P(unsupported);
  assert.equal(p.severity, SEVERITY.WARNING);
  assert.equal(p.claim, CLAIM.UNDETERMINED);
  assert.notEqual(p.claim, CLAIM.VIOLATION);
  assert.equal(p.confidence.class, CONFIDENCE_CLASS.INCONCLUSIVE);
  assert.ok(p.tags.includes(FILTER_TAG.INCONCLUSIVE));
  assert.ok(p.tags.includes(FILTER_TAG.WARNINGS));

  // The WD1.7-D rollup: `withheld` produces NO finding, so the status is where
  // "could not be determined" reaches a consumer.
  const withheld = presentAgreementStatus(AGREEMENT_STATUS.WITHHELD);
  assert.equal(withheld.severity, SEVERITY.WARNING);
  assert.equal(withheld.claim, CLAIM.UNDETERMINED);
  assert.equal(withheld.attention, true);
  assert.equal(withheld.saveBlocking, false);
  // And a satisfied comparison is not an item to show.
  assert.equal(presentAgreementStatus(AGREEMENT_STATUS.SATISFIED).attention, false);
  // A violated rollup keeps the strict severity its findings carry.
  assert.equal(presentAgreementStatus(AGREEMENT_STATUS.VIOLATED).severity, SEVERITY.ERROR);
});

test('Q5 a recovered strict violation keeps its proven twin\'s severity', () => {
  const proven = F.synthetic({ iso: ISO_RESULT.PROHIBITED, confidence: STATUS.RESOLVED });
  const recovered = F.synthetic({
    iso: ISO_RESULT.PROHIBITED,
    confidence: STATUS.RECOVERED,
    reason: REASON.SCOPE_RECOVERED,
  });
  const a = P(proven);
  const b = P(recovered);
  assert.equal(a.severity, SEVERITY.ERROR);
  assert.equal(b.severity, a.severity, 'confidence must not mutate severity');
  assert.equal(b.claim, a.claim);
  assert.equal(b.iso, a.iso);

  // The difference lands where it belongs -- metadata, not severity.
  assert.equal(a.confidence.recovered, false);
  assert.equal(b.confidence.recovered, true);
  assert.equal(b.confidence.status, STATUS.RECOVERED);
  assert.ok(b.attentionRank > a.attentionRank, 'recovered ranks lower');
  assert.ok(b.tags.includes(FILTER_TAG.RECOVERED));
  assert.ok(b.tags.includes(FILTER_TAG.INCONCLUSIVE), 'recovered is additional, not instead');
  assert.ok(b.tags.includes(FILTER_TAG.ERRORS));

  // Every confidence value, against the same ISO axis: severity never moves.
  for (const status of Object.values(STATUS)) {
    assert.equal(P(F.synthetic({ iso: ISO_RESULT.PROHIBITED, confidence: status })).severity,
      SEVERITY.ERROR, `${status} must not change a prohibited finding's severity`);
    assert.equal(P(F.synthetic({ iso: ISO_RESULT.UNDEFINED, confidence: status })).severity,
      SEVERITY.ERROR, `${status} must not change an undefined-results finding's severity`);
  }
});

test('Q6 two equal findings at different ranges keep source order', () => {
  const list = presentDocumentFindings(F.findings(F.TWO_UNBOUND_USES));
  assert.equal(list.length, 2);
  assert.equal(list[0].finding.code, list[1].finding.code);
  assert.equal(list[0].presentation.attentionRank, list[1].presentation.attentionRank);
  assert.ok(list[0].finding.range.start.offset < list[1].finding.range.start.offset);

  // Synthetic equals, presented out of order, come back in source order.
  const a = F.synthetic({ range: F.span(50, 60) });
  const b = F.synthetic({ range: F.span(10, 20) });
  const ordered = presentDocumentFindings([a, b]);
  assert.equal(ordered[0].finding, b);
  assert.equal(ordered[1].finding, a);
});

test('Q7 a range-less finding sorts last within its rank and never throws', () => {
  const anchored = F.synthetic({ range: F.span(80, 90), name: 'anchored' });
  const unanchored = F.synthetic({ range: null, name: 'unanchored' });
  const ordered = presentDocumentFindings([unanchored, anchored]);
  assert.equal(ordered[0].finding, anchored);
  assert.equal(ordered[1].finding, unanchored);
  assert.equal(ordered[1].presentation.severity, SEVERITY.ERROR);

  // Two range-less findings still order deterministically, and both survive.
  const x = F.synthetic({ range: null, name: 'b' });
  const y = F.synthetic({ range: null, name: 'a' });
  const pair = presentDocumentFindings([x, y]);
  assert.equal(pair.length, 2);
  assert.deepEqual(pair.map((r) => r.finding.subject.name), ['a', 'b']);
  assert.deepEqual(presentDocumentFindings([y, x]).map((r) => r.finding.subject.name),
    ['a', 'b'], 'ordering must not depend on input order');
});

test('Q8 two identical-code findings at distinct ranges are both preserved', () => {
  const raw = F.findings(F.TWO_UNBOUND_USES);
  assert.equal(raw.length, 2);
  assert.equal(raw[0].code, raw[1].code);
  assert.equal(raw[0].reason, raw[1].reason);
  assert.equal(raw[0].subject.name, raw[1].subject.name);
  const list = presentDocumentFindings(raw);
  assert.equal(list.length, 2, 'two occurrences are two findings');
  const offsets = list.map((r) => r.finding.range.start.offset);
  assert.notEqual(offsets[0], offsets[1]);
  // And the originals are still there, by identity.
  assert.deepEqual(new Set(list.map((r) => r.finding)), new Set(raw));
});

test('Q9 no semantic finding ever blocks an ordinary Save', () => {
  const documents = [F.ILLEGAL_CHILD, F.SCRIPT_EXPOSED_FIELD, F.UNSUPPORTED_IS,
    F.TWO_UNBOUND_USES, F.RECOVERED_DOCUMENT, F.CLEAN];
  let seen = 0;
  for (const text of documents) {
    for (const r of presentDocumentFindings(F.projected(text))) {
      assert.equal(r.presentation.saveBlocking, false);
      assert.equal(r.presentation.visible, true);
      seen += 1;
    }
  }
  assert.ok(seen > 0, 'the assertion needs findings to assert about');
  // Every synthetic axis combination too -- including the worst case.
  for (const iso of Object.values(ISO_RESULT)) {
    for (const status of Object.values(STATUS)) {
      assert.equal(P(F.synthetic({ iso, confidence: status })).saveBlocking, false);
    }
  }
  for (const f of [F.accessDiffers(), F.memberMissing()]) {
    assert.equal(presentAgreementFinding(f).presentation.saveBlocking, false);
  }
  for (const status of Object.values(AGREEMENT_STATUS)) {
    assert.equal(presentAgreementStatus(status).saveBlocking, false);
  }
  // And there is no export gate here at all -- it stays with the profiles that
  // own it (`src/world-project/package-plan.js`, `validator.js`).
  assert.equal(P(F.illegalChild()).exportBlocking, undefined);
  assert.ok(!/exportBlocking/.test(CODE));
});

test('Q10 registry-only profile evidence produces no standalone diagnostic', () => {
  // WD1.7-E1 documents five vendor behaviours and maps ONE to an observation.
  // The other four have nothing to attach to, and P4 must not invent an item
  // for them: it has no function that takes a profile or a behaviour at all.
  assert.ok(compatibility.registryOnlyBehaviors().length >= 4);
  for (const name of Object.keys(vrml.presentation)) {
    assert.ok(!/profile|behavio|registry|evidence/i.test(name),
      `P4 exposes no profile-driven entry point (${name})`);
  }
  // A document exhibiting a registry-only behaviour yields exactly the findings
  // the substrate emits -- no extra compatibility item.
  const withRoute = 'Group { children [ ROUTE A.b TO C.d ] }\n';
  const raw = F.findings(withRoute);
  const shown = presentDocumentFindings(raw.map(compatibility.withCompatibility));
  assert.equal(shown.length, raw.length);
  for (const r of shown) assert.equal(r.presentation.compatibility, null);
});

// ---------------------------------------------------------------------------
// 3. Presentation is a sibling projection, never a rewrite
// ---------------------------------------------------------------------------

const SEMANTIC_KEYS = ['code', 'compatibility', 'confidence', 'detail', 'evidence',
  'iso', 'range', 'reason', 'rule', 'subject'];

test('06 the finding is carried by identity and is not mutated', () => {
  for (const text of [F.ILLEGAL_CHILD, F.SCRIPT_EXPOSED_FIELD, F.UNSUPPORTED_IS,
    F.RECOVERED_DOCUMENT]) {
    for (const finding of F.projected(text)) {
      const before = SEMANTIC_KEYS.map((k) => finding[k]);
      const result = presentSemanticFinding(finding);
      assert.equal(result.finding, finding, 'the finding must be the input, by identity');
      assert.ok(Object.isFrozen(result.finding));
      assert.deepEqual(SEMANTIC_KEYS.map((k) => finding[k]), before);
      assert.deepEqual(Object.keys(finding).sort(), SEMANTIC_KEYS);
    }
  }
});

test('07 the presentation is frozen and carries no semantic field of its own', () => {
  const p = P(F.scriptExposedFieldWithCompatibility());
  assert.ok(Object.isFrozen(p));
  assert.ok(Object.isFrozen(p.tags));
  assert.ok(Object.isFrozen(p.confidence));
  assert.ok(Object.isFrozen(p.compatibility));
  assert.deepEqual(Object.keys(p).sort(), [
    'attentionRank', 'claim', 'compatibility', 'confidence', 'group', 'iso',
    'origin', 'saveBlocking', 'severity', 'tags', 'visible',
  ]);
  // It does NOT re-spell the evidence: a consumer reads those from `finding`.
  for (const semantic of ['reason', 'rule', 'code', 'range', 'detail', 'evidence',
    'basis', 'subject', 'message', 'title']) {
    assert.equal(p[semantic], undefined, `${semantic} belongs to the finding, not the policy`);
  }
});

test('08 P4 cannot construct or re-emit a finding', () => {
  // The one construction path stays WD1.6-D's, and P4 has no access to it.
  assert.equal(presentation.attachCompatibility, undefined);
  assert.ok(!/createFinding|attachCompatibility/.test(CODE));
  assert.ok(!/Object\.assign\(\s*\{\}\s*,\s*finding/.test(CODE));
  // And it never writes through a finding reference.
  assert.ok(!/\bfinding\.[A-Za-z]+\s*=[^=]/.test(CODE), 'P4 must not assign to a finding field');
});

test('09 P4-A owns no message text -- prose is deferred to P4-B', () => {
  for (const banned of [/\bmessage\b\s*:/, /\btitle\b\s*:/, /\bsummary\b\s*:/,
    /\bdescription\b\s*:/]) {
    assert.ok(!banned.test(CODE), `presentation.js must not carry ${banned} yet`);
  }
});

// ---------------------------------------------------------------------------
// 4. Ordering and visibility
// ---------------------------------------------------------------------------

test('10 ordering is deterministic and independent of input order', () => {
  const raw = F.projected(F.RECOVERED_DOCUMENT)
    .concat(F.projected(F.ILLEGAL_CHILD))
    .concat(F.projected(F.SCRIPT_EXPOSED_FIELD));
  const forward = presentDocumentFindings(raw).map((r) => r.presentation.attentionRank);
  const reverse = presentDocumentFindings([...raw].reverse())
    .map((r) => r.presentation.attentionRank);
  assert.deepEqual(reverse, forward);
  for (let i = 1; i < forward.length; i += 1) assert.ok(forward[i - 1] <= forward[i]);
  // Proven errors surface before recovered warnings.
  assert.equal(forward[0], 0);
  assert.ok(forward[forward.length - 1] >= 100);
});

test('11 severity dominates attention rank absolutely', () => {
  const worstError = P(F.synthetic({
    iso: ISO_RESULT.NOT_STATED, confidence: STATUS.RECOVERED,
  }));
  assert.equal(worstError.severity, SEVERITY.WARNING);
  const bestWarning = worstError.attentionRank;
  for (const status of Object.values(STATUS)) {
    const error = P(F.synthetic({ iso: ISO_RESULT.PROHIBITED, confidence: status }));
    assert.equal(error.severity, SEVERITY.ERROR);
    assert.ok(error.attentionRank < bestWarning,
      'no confidence value may lift a warning above an error');
  }
});

test('12 every category is visible by default -- nothing is suppressed', () => {
  for (const iso of Object.values(ISO_RESULT)) {
    for (const status of Object.values(STATUS)) {
      const p = P(F.synthetic({ iso, confidence: status }));
      assert.equal(p.visible, true, `${iso}/${status} must be visible by default`);
    }
  }
  for (const status of Object.values(AGREEMENT_STATUS)) {
    assert.equal(presentAgreementStatus(status).visible, true);
  }
  // No hidden/suppressed/dismissed concept exists to regress into.
  for (const banned of [/hidden/i, /suppress/i, /dismiss/i, /\bmute\b/i]) {
    assert.ok(!banned.test(CODE), `presentation.js must not know about ${banned}`);
  }
});

test('13 presentDocumentFindings preserves count and returns a frozen array', () => {
  const raw = F.projected(F.RECOVERED_DOCUMENT);
  const list = presentDocumentFindings(raw);
  assert.equal(list.length, raw.length);
  assert.ok(Object.isFrozen(list));
  assert.equal(presentDocumentFindings([]).length, 0);
  // The input array is not mutated or reordered in place.
  const input = [...raw];
  presentDocumentFindings(input);
  assert.deepEqual(input, [...raw]);
});

test('14 orderPresentations is the one ordering authority and mixes both families', () => {
  const mixed = [
    presentAgreementFinding(F.accessDiffers()),
    presentSemanticFinding(F.illegalChild()),
    presentAgreementFinding(F.memberMissing()),
  ];
  const ordered = orderPresentations(mixed);
  assert.equal(ordered.length, 3);
  const severities = ordered.map((r) => r.presentation.severity);
  assert.deepEqual(severities, [SEVERITY.ERROR, SEVERITY.ERROR, SEVERITY.INFO]);
  assert.ok(Object.isFrozen(ordered));
  // The one sort lives in one function: `presentDocumentFindings` delegates.
  assert.equal((CODE.match(/\.sort\(/g) || []).length, 1);
});

test('15 the finding code is grouped, and every group value is reachable', () => {
  const groups = new Set(Object.values(presentation.GROUP_BY_FINDING_CODE));
  for (const g of Object.values(presentation.GROUP_BY_AGREEMENT_CODE)) groups.add(g);
  assert.deepEqual([...groups].sort(), Object.values(FINDING_GROUP).sort());
  assert.equal(presentation.GROUP_BY_FINDING_CODE[FINDING_CODE.ROUTE_NODE_NOT_BOUND],
    FINDING_GROUP.EVENT_ROUTING);
  assert.equal(presentation.GROUP_BY_AGREEMENT_CODE[AGREEMENT_FINDING.ACCESS_DIFFERS],
    FINDING_GROUP.EXTERNAL_INTERFACE);
});

test('16 every new source file is covered by the npm run check syntax gate', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  for (const f of ['src/vrml/presentation.js', 'test/vrml/presentation-fixtures.js',
    'test/vrml/presentation.test.js', 'test/vrml/presentation-matrix.test.js',
    'test/vrml/presentation-mutations.test.js']) {
    assert.ok(pkg.scripts.check.includes(`node --check ${f}`), `${f} must be in the syntax gate`);
  }
});
