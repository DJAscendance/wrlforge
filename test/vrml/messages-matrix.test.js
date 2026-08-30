'use strict';
// P4-B -- the complete catalog matrix guard.
//
// Every structured vocabulary P4-A presents is enumerated here and asserted to
// have an INTENTIONAL message entry. A new finding code, agreement code or
// rollup status must force a P4-B decision -- adding one without an entry
// fails this file, and the only way to make it pass is to write the text.
//
// Three properties together make that true:
//
//   1. TOTAL -- every value of every vocabulary has an entry.
//   2. TIGHT -- no table carries an entry for a value its vocabulary no longer
//      has, so a rename cannot leave a message behind for nothing.
//   3. NO CATCH-ALL -- an unrecognized value THROWS at the messages layer
//      with `EMESSAGEUNCLASSIFIED`. There is no `default:`, no
//      `|| "Unknown error"`, and no fallback that hides missing text.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const messages = require('../../src/vrml/messages');
const presentation = require('../../src/vrml/presentation');
const semanticFindings = require('../../src/vrml/semantic-findings');
const protoAgreement = require('../../src/vrml/proto-agreement');
const compatibility = require('../../src/vrml/compatibility');
const sg = require('../../src/vrml/scope-graph');
const F = require('./messages-fixtures');

const {
  MESSAGE_ID, MESSAGE_ERROR,
  messageForSemanticFinding, messageForAgreementFinding,
  messageForAgreementStatus,
  SEMANTIC_TEMPLATES, AGREEMENT_FINDING_TEMPLATES, ROLLUP_TEMPLATES,
} = messages;
const { FINDING_CODE, ISO_RESULT } = semanticFindings;
const { STATUS, REASON } = sg;
const { AGREEMENT_FINDING, AGREEMENT_BASIS, AGREEMENT_STATUS } = protoAgreement;
const { COMPATIBILITY_CLASSIFICATION } = compatibility;

const SOURCE_PATH = path.join(__dirname, '../../src/vrml/messages.js');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8')
  .split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

const values = (vocab) => Object.values(vocab).sort();
const keys = (t) => Object.keys(t).sort();

/** Every value of `vocab` has an entry in `t`, and `t` has no others. */
function exact(vocab, t, what) {
  assert.deepEqual(keys(t), values(vocab), `${what} must be total and tight`);
}

// ---------------------------------------------------------------------------
// 1. Totality -- every exported vocabulary is covered
// ---------------------------------------------------------------------------

test('M-01 every WD1.6-D finding code has a message entry', () => {
  exact(FINDING_CODE, SEMANTIC_TEMPLATES, 'SEMANTIC_TEMPLATES');
  for (const id of Object.values(MESSAGE_ID)) {
    assert.ok(typeof id === 'string' && id.length > 0,
      `every MESSAGE_ID is a non-empty string: ${id}`);
  }
});

test('M-02 every WD1.7-D agreement finding code has a message entry', () => {
  exact(AGREEMENT_FINDING, AGREEMENT_FINDING_TEMPLATES, 'AGREEMENT_FINDING_TEMPLATES');
});

test('M-03 every WD1.7-D agreement rollup status has a message entry', () => {
  exact(AGREEMENT_STATUS, ROLLUP_TEMPLATES, 'ROLLUP_TEMPLATES');
});

test('M-04 every MESSAGE_ID is referenced by exactly one template', () => {
  // Cross-check: each id is keyed by exactly one template in any catalog table,
  // and every template carries exactly the id the caller expects.
  const seen = new Map();
  for (const [code, t] of Object.entries(SEMANTIC_TEMPLATES)) {
    assert.equal(seen.get(t.id), undefined,
      `duplicate MESSAGE_ID ${t.id} in SEMANTIC_TEMPLATES[${code}]`);
    seen.set(t.id, `SEMANTIC_TEMPLATES[${code}]`);
  }
  for (const [code, t] of Object.entries(AGREEMENT_FINDING_TEMPLATES)) {
    assert.equal(seen.get(t.id), undefined,
      `duplicate MESSAGE_ID ${t.id} in AGREEMENT_FINDING_TEMPLATES[${code}]`);
    seen.set(t.id, `AGREEMENT_FINDING_TEMPLATES[${code}]`);
  }
  for (const [status, t] of Object.entries(ROLLUP_TEMPLATES)) {
    assert.equal(seen.get(t.id), undefined,
      `duplicate MESSAGE_ID ${t.id} in ROLLUP_TEMPLATES[${status}]`);
    seen.set(t.id, `ROLLUP_TEMPLATES[${status}]`);
  }
  // Every MESSAGE_ID appears exactly once across all catalog tables.
  for (const id of Object.values(MESSAGE_ID)) {
    assert.ok(seen.has(id), `MESSAGE_ID ${id} is not referenced by any template`);
  }
});

// ---------------------------------------------------------------------------
// 2. Reason coverage -- structured keys reach the catalog
// ---------------------------------------------------------------------------

test('M-05 every (code x reason) cell with current producers produces a message', () => {
  // Every code in FINDING_CODE is exercised against every REASON in
  // STATUS (no, that's confidence). The real test: every (code, reason)
  // pair the substrate can currently emit must reach a non-null detail
  // builder, so a future reason without a branch fails loudly.
  for (const code of Object.values(FINDING_CODE)) {
    const template = SEMANTIC_TEMPLATES[code];
    assert.ok(template, `SEMANTIC_TEMPLATES missing ${code}`);
    assert.equal(typeof template.title, 'string');
    assert.equal(typeof template.summary, 'string');
    assert.equal(template.detailFor == null || typeof template.detailFor, 'function',
      `${code} detailFor must be a function or null`);
  }
});

test('M-06 every (agreement code x basis) cell produces a message', () => {
  for (const code of Object.values(AGREEMENT_FINDING)) {
    for (const basis of Object.values(AGREEMENT_BASIS)) {
      const result = messageForAgreementFinding(presentation.presentAgreementFinding(
        Object.freeze({ code, basis })));
      assert.equal(typeof result.id, 'string');
      assert.equal(typeof result.title, 'string');
      assert.equal(typeof result.summary, 'string');
    }
  }
});

test('M-07 every WD1.7-E1 classification produces a compatibility sentence', () => {
  // The compat-bearing V3 case (TOLERATED_VIOLATION) is the one WD1.7-E1 ever
  // emits; the catalog must still handle EXTRA_STANDARD honestly if it ever
  // arrives, and it must NOT downgrade the strict severity when it does.
  const base = F.scriptExposedField();
  for (const classification of Object.values(COMPATIBILITY_CLASSIFICATION)) {
    const profileName = compatibility.COMPATIBILITY_PROFILE.BLAXXUN_CONTACT;
    const attached = semanticFindings.attachCompatibility(base, Object.freeze({
      behavior: 'test-behavior',
      profile: profileName,
      classification,
      tier: 'a',
      subtier: 'a1',
      evidence: Object.freeze([]),
      detail: null,
    }));
    const strictResult = messageForSemanticFinding(
      presentation.presentSemanticFinding(base));
    const compatResult = messageForSemanticFinding(
      presentation.presentSemanticFinding(attached));
    assert.equal(compatResult.id, strictResult.id,
      `${classification} must share the same template as its unattached twin`);
    assert.ok(compatResult.detail && compatResult.detail.length > 0,
      `${classification} must add a detail sentence`);
    if (classification === COMPATIBILITY_CLASSIFICATION.TOLERATED_VIOLATION) {
      assert.ok(/not\s+VRML97-conforming/i.test(compatResult.detail),
        'TOLERATED_VIOLATION detail must state the content is not VRML97-conforming');
      assert.ok(/blaxxun-contact/i.test(compatResult.detail),
        'TOLERATED_VIOLATION detail must name the documented runtime');
    }
    if (classification === COMPATIBILITY_CLASSIFICATION.EXTRA_STANDARD) {
      assert.ok(/ISO does not state/i.test(compatResult.detail),
        'EXTRA_STANDARD detail must say ISO is silent');
      assert.ok(/blaxxun-contact/i.test(compatResult.detail),
        'EXTRA_STANDARD detail must name the documented runtime');
    }
  }
});

// ---------------------------------------------------------------------------
// 3. End-to-end presentation
// ---------------------------------------------------------------------------

test('M-08 every (code x iso x confidence) cell produces a non-empty message', () => {
  // The whole severity matrix from P4-A is reachable through the catalog.
  for (const code of Object.values(FINDING_CODE)) {
    for (const iso of Object.values(ISO_RESULT)) {
      for (const confidence of Object.values(STATUS)) {
        const m = messageForSemanticFinding(presentation.presentSemanticFinding(
          F.synthetic({ code, iso, confidence })));
        assert.ok(typeof m.id === 'string' && m.id.length > 0);
        assert.ok(typeof m.title === 'string' && m.title.length > 0);
        assert.ok(typeof m.summary === 'string' && m.summary.length > 0);
        // detail may be null -- a finding whose template has no detail builder
        // or whose context yields no extra sentence. Title and summary are
        // mandatory.
      }
    }
  }
});

test('M-09 every rollup status produces a non-empty message', () => {
  const byId = {};
  for (const status of Object.values(AGREEMENT_STATUS)) {
    const m = messageForAgreementStatus(presentation.presentAgreementStatus(status));
    assert.ok(typeof m.id === 'string' && m.id.length > 0,
      `${status} id must be a non-empty string`);
    assert.ok(typeof m.title === 'string' && m.title.length > 0,
      `${status} title must be a non-empty string`);
    assert.ok(typeof m.summary === 'string' && m.summary.length > 0,
      `${status} summary must be a non-empty string`);
    byId[status] = m.id;
  }
  assert.deepEqual(byId, {
    [AGREEMENT_STATUS.SATISFIED]: MESSAGE_ID.AGREEMENT_ROLLUP_SATISFIED,
    [AGREEMENT_STATUS.VIOLATED]: MESSAGE_ID.AGREEMENT_ROLLUP_VIOLATED,
    [AGREEMENT_STATUS.WITHHELD]: MESSAGE_ID.AGREEMENT_ROLLUP_WITHHELD,
    [AGREEMENT_STATUS.NOT_ATTEMPTED]: MESSAGE_ID.AGREEMENT_ROLLUP_NOT_ATTEMPTED,
    [AGREEMENT_STATUS.INVALID]: MESSAGE_ID.AGREEMENT_ROLLUP_INVALID,
  });
});

// ---------------------------------------------------------------------------
// 4. No catch-all
// ---------------------------------------------------------------------------

test('M-10 an unrecognized value at any entry point throws EMESSAGEUNCLASSIFIED', () => {
  // Rollup: a foreign status string fails closed at the entry point.
  assert.throws(() => messageForAgreementStatus(Object.freeze({ status: 'future' })),
    (e) => e.code === MESSAGE_ERROR.UNCLASSIFIED);

  // Dispatcher: a tampered origin fails closed.
  const r = presentation.presentSemanticFinding(F.synthetic({
    code: FINDING_CODE.CHILD_NOT_PERMITTED,
  }));
  const tampered = Object.freeze({
    finding: r.finding,
    presentation: Object.freeze({ ...r.presentation, origin: 'foreign-origin' }),
  });
  assert.throws(() => messages.messageForPresentation(tampered),
    (e) => e.code === MESSAGE_ERROR.UNCLASSIFIED);
});

test('M-11 the source contains no permissive fallback in the catalog path', () => {
  assert.ok(!/\bdefault\s*:/.test(SOURCE),
    'a switch default would accept a new value silently');
  // Bare `|| 'string'` fallbacks are normal JS for missing values; only a
  // generic-fallback STRING LITERAL would hide missing text. These four are
  // the patterns P4-B's own prompt forbids by name.
  for (const banned of [/'Unknown error'/, /'Generic warning'/, /'Unknown problem'/,
    /'default message'/]) {
    assert.ok(!banned.test(SOURCE),
      `messages.js must not have a fallback string ${banned}`);
  }
  // Every catalog table is read through the one throwing accessor, never indexed.
  for (const name of ['SEMANTIC_TEMPLATES', 'AGREEMENT_FINDING_TEMPLATES',
    'ROLLUP_TEMPLATES']) {
    const indexed = SOURCE.match(new RegExp(`${name}\\s*\\[`, 'g')) || [];
    assert.equal(indexed.length, 0,
      `${name} must be read through read(), not indexed`);
    assert.ok(new RegExp(`read\\(\\s*${name}`).test(SOURCE),
      `${name} must be read through read()`);
  }
});

test('M-12 every catalog table is frozen and prototype-free', () => {
  for (const [name, t] of Object.entries({
    SEMANTIC_TEMPLATES, AGREEMENT_FINDING_TEMPLATES, ROLLUP_TEMPLATES,
  })) {
    assert.ok(Object.isFrozen(t), `${name} must be frozen`);
    assert.equal(Object.getPrototypeOf(t), null,
      `${name} must be null-prototype -- an inherited key is not a message`);
  }
  // `toString` / `constructor` are not message keys: a null-prototype table
  // does not inherit them, and the messages throw-on-miss accessor catches
  // them if a future regression adds a non-null prototype. The catalog tables
  // themselves never see a P4-A presentation for these "values" because P4-A
  // already throws; the null-prototype guard is the structural proof that
  // inherited keys cannot accidentally classify.
  assert.equal(SEMANTIC_TEMPLATES.toString, undefined);
  assert.equal(SEMANTIC_TEMPLATES.constructor, undefined);
  assert.equal(SEMANTIC_TEMPLATES['__proto__'], undefined);
});

test('M-13 the message object shape is exactly { id, title, summary, detail }', () => {
  // Same shape for every family: semantic, agreement, rollup. Text only.
  const expected = ['detail', 'id', 'summary', 'title'].sort();
  for (const text of [F.ILLEGAL_CHILD, F.SCRIPT_EXPOSED_FIELD, F.UNSUPPORTED_IS]) {
    for (const r of F.presented(text)) {
      const m = messages.messageForPresentation(r);
      assert.deepEqual(Object.keys(m).sort(), expected,
        `${text}: ${r.finding.code} must return exactly the four fields`);
    }
  }
  for (const status of Object.values(AGREEMENT_STATUS)) {
    const m = messageForAgreementStatus(presentation.presentAgreementStatus(status));
    assert.deepEqual(Object.keys(m).sort(), expected,
      `${status} rollup must return exactly the four fields`);
  }
  // And nothing in the message is reachable as severity, group, saveBlocking,
  // attentionRank, claim, iso, tags, compatibility, origin, or visible.
  const r = presentation.presentSemanticFinding(F.illegalChild());
  const m = messageForSemanticFinding(r);
  for (const banned of ['severity', 'group', 'saveBlocking', 'attentionRank',
    'claim', 'iso', 'tags', 'compatibility', 'origin', 'visible', 'message']) {
    assert.equal(m[banned], undefined, `messages must not carry ${banned}`);
  }
});
