'use strict';
// P4-A -- the complete matrix guard.
//
// The architecture gate WD2 depends on. Every structured vocabulary the
// semantic substrate exports is enumerated here and asserted to have an
// INTENTIONAL P4 policy. A future finding code, status, ISO result, agreement
// basis or compatibility classification therefore cannot reach a consumer
// wearing a severity nobody chose: adding one to its own module fails this
// file, and the only way to make it pass is to adjudicate it.
//
// The three properties, together, are what make that true:
//
//   1. TOTAL -- every value of every vocabulary has an entry.
//   2. TIGHT -- no table carries an entry for a value its vocabulary no longer
//      has, so a rename cannot leave a policy behind that answers for nothing.
//   3. NO CATCH-ALL -- an unrecognized value THROWS. There is no `default:`,
//      no `|| SEVERITY.WARNING`, and no table read that is not `classify`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const presentation = require('../../src/vrml/presentation');
const semanticFindings = require('../../src/vrml/semantic-findings');
const compatibility = require('../../src/vrml/compatibility');
const protoAgreement = require('../../src/vrml/proto-agreement');
const diagnostics = require('../../src/vrml/diagnostics');
const sg = require('../../src/vrml/scope-graph');
const F = require('./presentation-fixtures');

const {
  SEVERITY, CLAIM, CONFIDENCE_CLASS, FILTER_TAG, FINDING_GROUP, PRESENTATION_ERROR,
  presentSemanticFinding, presentAgreementFinding, presentAgreementStatus,
  CLAIM_BY_ISO, SEVERITY_BY_CLAIM, CONFIDENCE_CLASS_BY_STATUS, GROUP_BY_FINDING_CODE,
  GROUP_BY_AGREEMENT_CODE, ISO_BY_AGREEMENT_BASIS, COMPATIBILITY_PRESENTATION,
  AGREEMENT_STATUS_PRESENTATION, SEVERITY_RANK, STRICTNESS_RANK, CONFIDENCE_RANK,
} = presentation;
const { ISO_RESULT, FINDING_CODE } = semanticFindings;
const { STATUS } = sg;
const { AGREEMENT_FINDING, AGREEMENT_BASIS, AGREEMENT_STATUS } = protoAgreement;
const { COMPATIBILITY_CLASSIFICATION } = compatibility;

const CODE = fs.readFileSync(path.join(__dirname, '../../src/vrml/presentation.js'), 'utf8')
  .split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

const values = (vocab) => Object.values(vocab).sort();
const keys = (t) => Object.keys(t).sort();

/** Every value of `vocab` has an entry in `t`, and `t` has no others. */
function exact(vocab, t, what) {
  assert.deepEqual(keys(t), values(vocab), `${what} must be total and tight`);
}

// ---------------------------------------------------------------------------
// 1. Totality -- every exported vocabulary is adjudicated
// ---------------------------------------------------------------------------

test('M-01 every WD1.6-D finding code has a group', () => {
  exact(FINDING_CODE, GROUP_BY_FINDING_CODE, 'GROUP_BY_FINDING_CODE');
  for (const group of Object.values(GROUP_BY_FINDING_CODE)) {
    assert.ok(Object.values(FINDING_GROUP).includes(group));
  }
});

test('M-02 every ISO result is classified, ranked and tagged', () => {
  exact(ISO_RESULT, CLAIM_BY_ISO, 'CLAIM_BY_ISO');
  exact(ISO_RESULT, STRICTNESS_RANK, 'STRICTNESS_RANK');
  // Each row is total over the confidence class.
  for (const iso of Object.values(ISO_RESULT)) {
    exact(CONFIDENCE_CLASS, CLAIM_BY_ISO[iso], `CLAIM_BY_ISO[${iso}]`);
  }
  // Rule-source tagging is total, asserted through behaviour.
  const tags = new Set();
  for (const iso of Object.values(ISO_RESULT)) {
    const p = presentSemanticFinding(F.synthetic({ iso })).presentation;
    const found = p.tags.filter((t) => t === FILTER_TAG.STRICT_ISO
      || t === FILTER_TAG.NOT_SPECIFIED_BY_ISO);
    assert.equal(found.length, 1, `${iso} must carry exactly one rule-source tag`);
    tags.add(found[0]);
  }
  assert.deepEqual([...tags].sort(),
    [FILTER_TAG.NOT_SPECIFIED_BY_ISO, FILTER_TAG.STRICT_ISO].sort());
});

test('M-03 every substrate status is classified and ranked', () => {
  exact(STATUS, CONFIDENCE_CLASS_BY_STATUS, 'CONFIDENCE_CLASS_BY_STATUS');
  exact(STATUS, CONFIDENCE_RANK, 'CONFIDENCE_RANK');
  for (const cls of Object.values(CONFIDENCE_CLASS_BY_STATUS)) {
    assert.ok(Object.values(CONFIDENCE_CLASS).includes(cls));
  }
});

test('M-04 every claim has a severity, and every severity has a rank', () => {
  exact(CLAIM, SEVERITY_BY_CLAIM, 'SEVERITY_BY_CLAIM');
  exact(diagnostics.SEVERITY, SEVERITY_RANK, 'SEVERITY_RANK');
  for (const severity of Object.values(SEVERITY_BY_CLAIM)) {
    assert.ok(Object.values(SEVERITY).includes(severity));
  }
  // P4 emits three of the four repository severities; `hint` is ranked so the
  // orderer is total, but no policy row produces it.
  assert.deepEqual(values(SEVERITY_BY_CLAIM),
    [SEVERITY.ERROR, SEVERITY.INFO, SEVERITY.WARNING].sort());
});

test('M-05 every WD1.7-D agreement vocabulary is adjudicated', () => {
  exact(AGREEMENT_FINDING, GROUP_BY_AGREEMENT_CODE, 'GROUP_BY_AGREEMENT_CODE');
  exact(AGREEMENT_BASIS, ISO_BY_AGREEMENT_BASIS, 'ISO_BY_AGREEMENT_BASIS');
  exact(AGREEMENT_STATUS, AGREEMENT_STATUS_PRESENTATION, 'AGREEMENT_STATUS_PRESENTATION');
  for (const iso of Object.values(ISO_BY_AGREEMENT_BASIS)) {
    assert.ok(Object.values(ISO_RESULT).includes(iso), 'one strictness vocabulary, not two');
  }
  for (const row of Object.values(AGREEMENT_STATUS_PRESENTATION)) {
    assert.ok(Object.values(CLAIM).includes(row.claim));
    assert.equal(typeof row.attention, 'boolean');
  }
});

test('M-06 every WD1.7-E1 compatibility classification is adjudicated', () => {
  exact(COMPATIBILITY_CLASSIFICATION, COMPATIBILITY_PRESENTATION, 'COMPATIBILITY_PRESENTATION');
  for (const row of Object.values(COMPATIBILITY_PRESENTATION)) {
    assert.equal(typeof row.tolerated, 'boolean');
    assert.equal(row.portable, false, 'no classification is portable');
  }
});

// ---------------------------------------------------------------------------
// 2. The cross product presents, and every cell is intentional
// ---------------------------------------------------------------------------

test('M-07 every (code x iso x confidence) cell presents without a fallback', () => {
  const seen = new Map();
  for (const code of Object.values(FINDING_CODE)) {
    for (const iso of Object.values(ISO_RESULT)) {
      for (const confidence of Object.values(STATUS)) {
        const p = presentSemanticFinding(F.synthetic({ code, iso, confidence })).presentation;
        assert.ok(Object.values(SEVERITY).includes(p.severity));
        assert.ok(Object.values(CLAIM).includes(p.claim));
        assert.equal(p.saveBlocking, false);
        assert.equal(p.visible, true);
        seen.set(`${iso} ${confidence}`, p.severity);
      }
    }
  }
  // The whole severity matrix, written out. A change to any cell is a change to
  // this literal -- which is the point: it is the policy, not a derivation.
  assert.deepEqual(Object.fromEntries([...seen].sort()), {
    'not-stated ambiguous': SEVERITY.WARNING,
    'not-stated invalid': SEVERITY.WARNING,
    'not-stated recovered': SEVERITY.WARNING,
    'not-stated resolved': SEVERITY.INFO,
    'not-stated unresolved': SEVERITY.WARNING,
    'not-stated unsupported': SEVERITY.WARNING,
    'prohibited ambiguous': SEVERITY.ERROR,
    'prohibited invalid': SEVERITY.ERROR,
    'prohibited recovered': SEVERITY.ERROR,
    'prohibited resolved': SEVERITY.ERROR,
    'prohibited unresolved': SEVERITY.ERROR,
    'prohibited unsupported': SEVERITY.ERROR,
    'undefined ambiguous': SEVERITY.ERROR,
    'undefined invalid': SEVERITY.ERROR,
    'undefined recovered': SEVERITY.ERROR,
    'undefined resolved': SEVERITY.ERROR,
    'undefined unresolved': SEVERITY.ERROR,
    'undefined unsupported': SEVERITY.ERROR,
  });
});

test('M-08 every (agreement code x basis) cell presents, and every rollup status', () => {
  for (const code of Object.values(AGREEMENT_FINDING)) {
    for (const basis of Object.values(AGREEMENT_BASIS)) {
      const p = presentAgreementFinding(Object.freeze({ code, basis })).presentation;
      assert.ok(Object.values(SEVERITY).includes(p.severity));
      assert.equal(p.confidence.status, null);
      assert.equal(p.confidence.class, CONFIDENCE_CLASS.CONCLUSIVE);
      assert.equal(p.saveBlocking, false);
    }
  }
  const bySeverity = {};
  for (const status of Object.values(AGREEMENT_STATUS)) {
    const p = presentAgreementStatus(status);
    assert.ok(Object.values(SEVERITY).includes(p.severity));
    assert.equal(p.visible, true);
    bySeverity[status] = p.severity;
  }
  // Written out for the same reason the matrix above is: only a VIOLATED rollup
  // is an error, and no uncertainty status may become one.
  assert.deepEqual(bySeverity, {
    [AGREEMENT_STATUS.SATISFIED]: SEVERITY.INFO,
    [AGREEMENT_STATUS.VIOLATED]: SEVERITY.ERROR,
    [AGREEMENT_STATUS.WITHHELD]: SEVERITY.WARNING,
    [AGREEMENT_STATUS.NOT_ATTEMPTED]: SEVERITY.WARNING,
    [AGREEMENT_STATUS.INVALID]: SEVERITY.WARNING,
  });
});

test('M-09 every compatibility classification presents on a real finding', () => {
  const base = F.scriptExposedField();
  for (const classification of Object.values(COMPATIBILITY_CLASSIFICATION)) {
    const attached = semanticFindings.attachCompatibility(base, Object.freeze({
      behavior: 'test-behavior',
      profile: 'test-profile',
      classification,
      tier: 'a',
      subtier: 'a1',
      evidence: Object.freeze([]),
      detail: null,
    }));
    const p = presentSemanticFinding(attached).presentation;
    // The strict severity is the SAME as the unattached finding's, always.
    assert.equal(p.severity, presentSemanticFinding(base).presentation.severity);
    assert.equal(p.compatibility.classification, classification);
    assert.equal(p.compatibility.portable, false);
    assert.equal(p.compatibility.downgradesSeverity, false);
    assert.ok(p.tags.includes(FILTER_TAG.COMPATIBILITY));
  }
});

// ---------------------------------------------------------------------------
// 3. No catch-all
// ---------------------------------------------------------------------------

test('M-10 an unrecognized value in any axis throws rather than defaulting', () => {
  const unclassified = (fn) => assert.throws(fn,
    (e) => e.code === PRESENTATION_ERROR.UNCLASSIFIED);
  unclassified(() => presentSemanticFinding(F.synthetic({ code: 'future-code' })));
  unclassified(() => presentSemanticFinding(F.synthetic({ iso: 'future-iso' })));
  unclassified(() => presentSemanticFinding(F.synthetic({ confidence: 'future-status' })));
  unclassified(() => presentAgreementFinding(Object.freeze({
    code: 'future-agreement-code', basis: AGREEMENT_BASIS.ISO_4_9_2,
  })));
  unclassified(() => presentAgreementFinding(Object.freeze({
    code: AGREEMENT_FINDING.MEMBER_MISSING, basis: 'future-basis',
  })));
  unclassified(() => presentAgreementStatus('future-status'));
  unclassified(() => presentSemanticFinding(semanticFindings.attachCompatibility(
    F.scriptExposedField(),
    Object.freeze({ profile: 'p', classification: 'future-classification' }))));
});

test('M-11 the source contains no permissive fallback in the policy path', () => {
  assert.ok(!/\bdefault\s*:/.test(CODE), 'a switch default would accept a new value silently');
  for (const banned of [/\|\|\s*SEVERITY\./, /\|\|\s*CLAIM\./, /\?\?\s*SEVERITY\./,
    /\|\|\s*FINDING_GROUP\./, /\|\|\s*CONFIDENCE_CLASS\./]) {
    assert.ok(!banned.test(CODE), `presentation.js must not fall back with ${banned}`);
  }
  // Every policy table is read through the one throwing accessor, never indexed.
  for (const name of ['CLAIM_BY_ISO', 'SEVERITY_BY_CLAIM', 'CONFIDENCE_CLASS_BY_STATUS',
    'GROUP_BY_FINDING_CODE', 'GROUP_BY_AGREEMENT_CODE', 'ISO_BY_AGREEMENT_BASIS',
    'COMPATIBILITY_PRESENTATION', 'AGREEMENT_STATUS_PRESENTATION', 'SEVERITY_RANK',
    'STRICTNESS_RANK', 'CONFIDENCE_RANK', 'SEVERITY_TAG', 'RULE_SOURCE_TAG']) {
    const indexed = CODE.match(new RegExp(`${name}\\s*\\[`, 'g')) || [];
    assert.equal(indexed.length, 0, `${name} must be read through classify(), not indexed`);
    assert.ok(new RegExp(`classify\\((classify\\()?\\s*${name}`).test(CODE),
      `${name} must be read through classify()`);
  }
});

test('M-12 every policy table is frozen and prototype-free', () => {
  for (const [name, t] of Object.entries({
    CLAIM_BY_ISO, SEVERITY_BY_CLAIM, CONFIDENCE_CLASS_BY_STATUS, GROUP_BY_FINDING_CODE,
    GROUP_BY_AGREEMENT_CODE, ISO_BY_AGREEMENT_BASIS, COMPATIBILITY_PRESENTATION,
    AGREEMENT_STATUS_PRESENTATION, SEVERITY_RANK, STRICTNESS_RANK, CONFIDENCE_RANK,
  })) {
    assert.ok(Object.isFrozen(t), `${name} must be frozen`);
    assert.equal(Object.getPrototypeOf(t), null,
      `${name} must be null-prototype -- an inherited key is not a policy`);
  }
  // A null prototype is the guard: `toString` is not a classified value.
  assert.throws(() => presentSemanticFinding(F.synthetic({ code: 'toString' })),
    (e) => e.code === PRESENTATION_ERROR.UNCLASSIFIED);
  assert.throws(() => presentSemanticFinding(F.synthetic({ code: 'constructor' })),
    (e) => e.code === PRESENTATION_ERROR.UNCLASSIFIED);
});
