'use strict';
// P4-B -- diagnostic message catalog.
//
// Ten independent policy fixtures (Q1-Q10) plus the architecture assertions
// that keep messages a TEXT PROJECTION over the P4-A presentation, not a
// re-derivation of its facts. The matrix guard lives in
// `messages-matrix.test.js` and the live mutation controls in
// `messages-mutations.test.js`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vrml = require('../../src/vrml');
const messages = require('../../src/vrml/messages');
const presentation = require('../../src/vrml/presentation');
const semanticFindings = require('../../src/vrml/semantic-findings');
const compatibility = require('../../src/vrml/compatibility');
const protoAgreement = require('../../src/vrml/proto-agreement');
const sg = require('../../src/vrml/scope-graph');
const F = require('./messages-fixtures');

const {
  MESSAGE_ID, MESSAGE_ERROR,
  messageForSemanticFinding, messageForAgreementFinding,
  messageForAgreementStatus, messageForPresentation,
} = messages;
const { ISO_RESULT, FINDING_CODE } = semanticFindings;
const { STATUS, REASON } = sg;
const { AGREEMENT_STATUS, AGREEMENT_FINDING, AGREEMENT_BASIS } = protoAgreement;

const SOURCE_PATH = path.join(__dirname, '../../src/vrml/messages.js');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');
/** The module's CODE, with comment lines removed -- the header discusses the
 * concepts several scans below assert are absent from the implementation. */
const CODE = SOURCE.split('\n')
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

const M = (r) => messageForPresentation(r);

// ---------------------------------------------------------------------------
// 1. Architecture -- one authority, browser-safe, no policy drift
// ---------------------------------------------------------------------------

test('01 the module is browser-safe and adds no runtime dependency', () => {
  for (const banned of [/require\('node:/, /require\('fs'\)/, /require\('path'\)/,
    /require\('zlib'\)/, /require\('crypto'\)/, /require\('child_process'\)/,
    /\belectron\b/, /\bdocument\./, /\bwindow\./, /\bfetch\(/]) {
    assert.ok(!banned.test(CODE), `messages.js must not reference ${banned}`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['x_ite']);
});

test('02 the facade publishes the contract and withholds the catalog tables', () => {
  assert.deepEqual(Object.keys(vrml.messages).sort(), [
    'MESSAGE_ERROR', 'MESSAGE_ID',
    'messageForAgreementFinding', 'messageForAgreementStatus',
    'messageForPresentation', 'messageForSemanticFinding',
  ]);
  assert.ok(Object.isFrozen(vrml.messages));
  // The catalog tables stay on the module: they are the reasoning, not the
  // contract, and exposing them would invite a consumer to read by indexed key
  // rather than through the throwing accessor.
  for (const internal of ['SEMANTIC_TEMPLATES', 'AGREEMENT_FINDING_TEMPLATES',
    'ROLLUP_TEMPLATES']) {
    assert.equal(vrml.messages[internal], undefined, `${internal} is reasoning, not contract`);
  }
});

test('03 messages are text only -- they never carry severity, group, saveBlocking or rank', () => {
  const result = M(presentation.presentSemanticFinding(F.illegalChild()));
  for (const banned of ['severity', 'group', 'saveBlocking', 'attentionRank',
    'claim', 'iso', 'tags', 'compatibility', 'origin', 'visible']) {
    assert.equal(result[banned], undefined, `messages must not carry ${banned}`);
  }
  assert.deepEqual(Object.keys(result).sort(), ['detail', 'id', 'summary', 'title']);
  assert.ok(typeof result.id === 'string');
  assert.ok(typeof result.title === 'string');
  assert.ok(typeof result.summary === 'string');
  assert.ok(result.detail === null || typeof result.detail === 'string');
  assert.ok(Object.isFrozen(result));
});

test('04 the catalog never invents a fact -- P4-A presentation fields are the only inputs', () => {
  // No source-text parsing, no string regex over user content, no file/path
  // sniffing to decide what message to use. Only P4-A's structured fields.
  for (const banned of [/\bparse\s*\(/, /\bnew\s+RegExp\b/, /\bregex\b/i,
    /\breadFileSync\b/, /\bexistsSync\b/]) {
    assert.ok(!banned.test(CODE), `messages.js must not ${banned}`);
  }
  // And no `Object.assign` over a presentation result or a finding -- the
  // message is a sibling projection, not a copy.
  assert.ok(!/Object\.assign\(\s*\{\}\s*,\s*(finding|presentation)/.test(CODE));
});

test('05 a foreign or malformed record fails loudly rather than producing a default', () => {
  for (const bad of [null, undefined, 42, 'finding', [], {}]) {
    assert.throws(() => messageForSemanticFinding(bad),
      (e) => e.code === MESSAGE_ERROR.SHAPE, `${JSON.stringify(bad)} must throw`);
    assert.throws(() => messageForAgreementFinding(bad),
      (e) => e.code === MESSAGE_ERROR.SHAPE);
  }
  // Rollup status takes its own shape (no `finding`); a foreign string throws
  // at the messages layer with the documented code.
  assert.throws(() => messageForAgreementStatus(Object.freeze({ status: 'invented' })),
    (e) => e.code === MESSAGE_ERROR.UNCLASSIFIED);
  // A bare presentation result whose origin is unrecognized also throws
  // EMESSAGEUNCLASSIFIED. The matrix test (M-NN) guarantees that no current
  // P4-A code escapes messages -- if one ever does, this test fails loudly.
  const foreign = presentation.presentSemanticFinding(F.synthetic({
    code: FINDING_CODE.CHILD_NOT_PERMITTED,
  }));
  const tampered = Object.freeze({ ...foreign, presentation: Object.freeze({
    ...foreign.presentation, origin: 'foreign-origin',
  }) });
  assert.throws(() => messageForPresentation(tampered),
    (e) => e.code === MESSAGE_ERROR.UNCLASSIFIED);
});

// ---------------------------------------------------------------------------
// 2. Q1-Q10 -- the policy fixtures
// ---------------------------------------------------------------------------

test('Q1 a proven strict violation produces direct wording without uncertainty', () => {
  const r = presentation.presentSemanticFinding(F.illegalChild());
  const m = messageForSemanticFinding(r);
  assert.equal(m.id, MESSAGE_ID.CHILD_NOT_PERMITTED);
  assert.equal(r.presentation.severity, presentation.SEVERITY.ERROR);
  // Direct wording, not uncertainty words.
  assert.ok(!/may be|maybe|could be|possibly/i.test(`${m.title} ${m.summary} ${m.detail || ''}`),
    'strict violation text must not hedge');
  // No recovered sentence on a conclusive finding.
  assert.equal(m.detail && /recovered/i.test(m.detail), false);
  assert.ok(!/invalid/i.test(m.summary) || /not permitted/i.test(m.summary));
});

test('Q2 a recovered strict violation keeps its proven wording; detail adds recovery note', () => {
  // Synthetic: a recovered strict violation (PROHIBITED + recovered).
  const recovered = F.synthetic({
    iso: ISO_RESULT.PROHIBITED,
    confidence: STATUS.RECOVERED,
    reason: REASON.SCOPE_RECOVERED,
  });
  const r = presentation.presentSemanticFinding(recovered);
  const m = messageForSemanticFinding(r);
  // Same severity (P4-A's contract).
  assert.equal(r.presentation.severity, presentation.SEVERITY.ERROR);
  // Title and summary stay direct -- the strict wording is unchanged.
  assert.ok(!/may be|maybe|could be|possibly/i.test(`${m.title} ${m.summary}`),
    'recovered text must keep direct wording in title and summary');
  // The detail (when present) is allowed to mention recovery.
  assert.ok(m.detail && /recovered/i.test(m.detail),
    'recovered detail may mention recovery');
});

test('Q3 a tolerated compatibility attachment preserves both facts in the detail', () => {
  const r = presentation.presentSemanticFinding(F.scriptExposedFieldWithCompatibility());
  const m = messageForSemanticFinding(r);
  // Strict severity unchanged (P4-A's contract).
  assert.equal(r.presentation.severity, presentation.SEVERITY.ERROR);
  assert.equal(r.presentation.claim, presentation.CLAIM.VIOLATION);
  // Title and summary stay direct.
  assert.ok(!/maybe|possibly/i.test(`${m.title} ${m.summary}`));
  // Detail carries BOTH facts: not VRML97-conforming AND blaxxun Contact
  // accepts the behavior. The portable wording ("not portable VRML97") IS
  // required by §17, so "not portable" is allowed; bare "portable" is not.
  assert.ok(m.detail);
  assert.ok(/not\s+VRML97-conforming/i.test(m.detail),
    'detail must say the content is not VRML97-conforming');
  assert.ok(/blaxxun-contact/i.test(m.detail),
    'detail must name the documented runtime');
  assert.ok(/accept/i.test(m.detail),
    'detail must state the runtime accepts the behavior');
  for (const banned of [/\bsafe\b/, /(?<!not )\bportable\b/, /\bvalid\b/, /\bfixed\b/,
    /\bsupported everywhere\b/]) {
    assert.ok(!banned.test(m.detail),
      `detail must not over-claim: ${banned}`);
  }
});

test('Q4 ACCESS_DIFFERS is informational: it explains ISO 4.9.2 silence without claiming a violation', () => {
  const r = presentation.presentAgreementFinding(F.accessDiffers());
  const m = messageForAgreementFinding(r);
  assert.equal(r.presentation.severity, presentation.SEVERITY.INFO);
  assert.equal(r.presentation.claim, presentation.CLAIM.OBSERVATION);
  assert.equal(m.id, MESSAGE_ID.AGREEMENT_ACCESS_DIFFERS);
  assert.ok(m.detail);
  assert.ok(/4\.9\.2/.test(m.detail),
    'detail must cite the clause that is silent on access categories');
  for (const banned of [/\binvalid\b/, /\bnon-conforming\b/, /\bcompatibility/i,
    /\bblaxxun/i, /\bportable\b/, /\bfixed\b/]) {
    assert.ok(!banned.test(m.detail),
      'ACCESS_DIFFERS detail must not over-claim or mention compatibility');
  }
});

test('Q4b unsupported and withheld findings say "could not determine" -- never "invalid"', () => {
  const r = presentation.presentSemanticFinding(F.unsupportedIs());
  const m = messageForSemanticFinding(r);
  assert.equal(r.presentation.severity, presentation.SEVERITY.WARNING);
  assert.equal(r.presentation.claim, presentation.CLAIM.UNDETERMINED);
  assert.ok(m.detail && /could not determine/i.test(m.detail),
    'uncertain findings must use uncertainty wording');
  for (const banned of [/\binvalid\b/, /\bnon-conforming\b/]) {
    assert.ok(!banned.test(`${m.title} ${m.summary}`),
      'uncertain text must not call itself invalid');
  }

  // Agreement rollup: WITHHELD is also "could not determine".
  const rollup = messageForAgreementStatus(presentation.presentAgreementStatus(
    AGREEMENT_STATUS.WITHHELD));
  assert.equal(rollup.id, MESSAGE_ID.AGREEMENT_ROLLUP_WITHHELD);
  assert.ok(/Interface check withheld/.test(rollup.title));
  assert.ok(/could not determine/i.test(rollup.summary));
  // And it does NOT claim a per-member error.
  assert.ok(!/member/i.test(rollup.summary.toLowerCase()) || /interface check/i.test(rollup.summary.toLowerCase()));
});

test('Q5 MEMBER_MISSING names the local member and explains ISO 4.9.2', () => {
  const r = presentation.presentAgreementFinding(F.memberMissing());
  const m = messageForAgreementFinding(r);
  assert.equal(m.id, MESSAGE_ID.AGREEMENT_MEMBER_MISSING);
  assert.ok(m.detail);
  assert.ok(/4\.9\.2/.test(m.detail), 'detail must cite ISO 4.9.2');
  // The member name is the local declaration's name, not a guessed label.
  const f = F.memberMissing();
  assert.ok(f.name != null);
  assert.ok(m.detail.includes(f.name),
    'detail must include the local member name when available');
});

test('Q6 TYPE_MISMATCH shows the local and target types when both are available', () => {
  const r = presentation.presentAgreementFinding(F.typeMismatch());
  const m = messageForAgreementFinding(r);
  assert.equal(m.id, MESSAGE_ID.AGREEMENT_TYPE_MISMATCH);
  const f = F.typeMismatch();
  assert.ok(m.detail);
  assert.ok(m.detail.includes(f.localType),
    'detail must include the local type when available');
  assert.ok(m.detail.includes(f.targetType),
    'detail must include the target type when available');
});

test('Q7 agreement rollups use rollup wording, not per-member error wording', () => {
  const rollups = [
    [AGREEMENT_STATUS.SATISFIED, MESSAGE_ID.AGREEMENT_ROLLUP_SATISFIED,
      /Interface check passed/i, null],
    [AGREEMENT_STATUS.VIOLATED, MESSAGE_ID.AGREEMENT_ROLLUP_VIOLATED,
      /Interface check failed/i, null],
    [AGREEMENT_STATUS.WITHHELD, MESSAGE_ID.AGREEMENT_ROLLUP_WITHHELD,
      /Interface check withheld/i, /could not determine/i],
    [AGREEMENT_STATUS.NOT_ATTEMPTED, MESSAGE_ID.AGREEMENT_ROLLUP_NOT_ATTEMPTED,
      /Interface check not attempted/i, /no implementation/i],
    [AGREEMENT_STATUS.INVALID, MESSAGE_ID.AGREEMENT_ROLLUP_INVALID,
      /Interface check invalid/i, null],
  ];
  for (const [status, id, titleRe, detailRe] of rollups) {
    const m = messageForAgreementStatus(presentation.presentAgreementStatus(status));
    assert.equal(m.id, id);
    assert.ok(titleRe.test(m.title),
      `${status} title must match ${titleRe}`);
    if (detailRe) {
      assert.ok(m.detail && detailRe.test(m.detail),
        `${status} detail must match ${detailRe}`);
    }
  }
  // Rollups never claim a new per-member error -- the title is about the check.
  for (const [status] of rollups) {
    const m = messageForAgreementStatus(presentation.presentAgreementStatus(status));
    assert.ok(!/member\s+(is|missing|differ)/i.test(`${m.title} ${m.summary}`),
      `${status} rollup must not look like a per-member finding`);
  }
});

test('Q8 unusual subject names stay readable as plain strings', () => {
  // The catalog returns plain strings only -- no HTML, no DOM construction, no
  // string escaping that would mangle what the user actually wrote. The text is
  // safe for a plain-text consumer (WD2); an HTML consumer is WD2's problem,
  // not P4-B's, because the message itself contains no markup.
  const tricky = F.synthetic({
    code: FINDING_CODE.USE_NOT_BOUND,
    name: 'weird "name" with <script> and control',
    iso: ISO_RESULT.PROHIBITED,
    confidence: STATUS.RESOLVED,
    reason: REASON.DEF_NOT_DECLARED_IN_SCOPE,
  });
  const r = presentation.presentSemanticFinding(tricky);
  const m = messageForSemanticFinding(r);
  // The name survives intact -- no character mangling, no length loss.
  assert.ok(m.detail && m.detail.includes('weird'),
    'unusual name characters must survive verbatim');
  // Result shape is plain strings: nothing else can leak into a consumer.
  assert.ok(typeof m.title === 'string');
  assert.ok(typeof m.summary === 'string');
  assert.ok(typeof m.detail === 'string' || m.detail === null);
  // And no DOM/HTML construction lives in the module.
  for (const banned of [/\binnerHTML\b/, /\bcreateElement\b/, /\bdocument\./]) {
    assert.ok(!banned.test(CODE), `messages.js must not use ${banned}`);
  }
});

test('Q9 an empty or null subject name never produces "undefined" or "null" in user text', () => {
  const nameless = F.synthetic({
    code: FINDING_CODE.NODE_TYPE_NOT_BOUND,
    name: null,
    iso: ISO_RESULT.PROHIBITED,
    confidence: STATUS.RESOLVED,
    reason: REASON.NODE_TYPE_UNKNOWN,
  });
  const m = messageForSemanticFinding(presentation.presentSemanticFinding(nameless));
  assert.ok(!/undefined|null/.test(`${m.title} ${m.summary} ${m.detail || ''}`),
    'missing names must not surface as the literal string "undefined" or "null"');
});

test('Q10 unknown message input fails closed with EMESSAGEUNCLASSIFIED', () => {
  // A bare presentation result whose origin is unrecognized fails closed at
  // the dispatcher; the matrix test (M-NN) guarantees that no current P4-A
  // code escapes messages, so any future addition must be adjudicated here.
  const foreign = presentation.presentSemanticFinding(F.synthetic({
    code: FINDING_CODE.CHILD_NOT_PERMITTED,
  }));
  const tampered = Object.freeze({ ...foreign, presentation: Object.freeze({
    ...foreign.presentation, origin: 'foreign-origin',
  }) });
  assert.throws(() => messageForPresentation(tampered),
    (e) => e.code === MESSAGE_ERROR.UNCLASSIFIED);

  // A rollup with a foreign status string fails closed at its own entry point.
  assert.throws(() => messageForAgreementStatus(Object.freeze({ status: 'future' })),
    (e) => e.code === MESSAGE_ERROR.UNCLASSIFIED);
});

// ---------------------------------------------------------------------------
// 3. End-to-end through the dispatcher
// ---------------------------------------------------------------------------

test('06 messageForPresentation dispatches on origin and handles a full document', () => {
  // ILLEGAL_CHILD + SCRIPT_EXPOSED_FIELD give both a semantic finding and a
  // compatibility-bearing semantic finding through the same projection path.
  const list = F.presented(`${F.ILLEGAL_CHILD}\n${F.SCRIPT_EXPOSED_FIELD}`);
  assert.ok(list.length >= 2);
  for (const r of list) {
    const m = M(r);
    assert.ok(typeof m.id === 'string' && typeof m.title === 'string');
    assert.ok(typeof m.summary === 'string');
    assert.ok(m.detail === null || typeof m.detail === 'string');
  }
  // The script finding's message must mention blaxxun-contact.
  const script = list.find((r) => r.finding.code === FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING);
  assert.ok(script);
  const scriptMsg = M(script);
  assert.ok(scriptMsg.detail && /blaxxun-contact/.test(scriptMsg.detail));
});

test('07 every message result is frozen and free of presentation fields', () => {
  for (const text of [F.ILLEGAL_CHILD, F.SCRIPT_EXPOSED_FIELD, F.UNSUPPORTED_IS]) {
    for (const r of F.presented(text)) {
      const m = M(r);
      assert.ok(Object.isFrozen(m));
      assert.deepEqual(Object.keys(m).sort(), ['detail', 'id', 'summary', 'title']);
    }
  }
});
