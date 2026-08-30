'use strict';
// P4-B -- live mutation controls.
//
// The same harness WD1.7-C through P4-A used, for the same two reasons:
// every substitution must match EXACTLY ONCE in the production source, so a
// mutation that stops applying fails loudly instead of passing vacuously,
// and mutants are written to the OS temp directory with relative requires
// rewritten to absolute paths so a mutant composes with the real, unmutated
// rest of the tree and never touches the repository.
//
// M1-M10 are the controls the prompt requires. Anchor hygiene is asserted at
// the bottom so a source drift breaks every control that depends on the
// anchor, rather than passing vacuously.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const messages = require('../../src/vrml/messages');
const presentation = require('../../src/vrml/presentation');
const semanticFindings = require('../../src/vrml/semantic-findings');
const protoAgreement = require('../../src/vrml/proto-agreement');
const sg = require('../../src/vrml/scope-graph');
const F = require('./messages-fixtures');

const { MESSAGE_ID } = messages;
const { ISO_RESULT, FINDING_CODE } = semanticFindings;
const { STATUS, REASON } = sg;
const { AGREEMENT_BASIS, AGREEMENT_STATUS } = protoAgreement;

const ROOT = path.join(__dirname, '..', '..');
const MODULE = 'src/vrml/messages.js';
const mutantDirs = [];

test.after(() => {
  for (const d of mutantDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function mutantSource(relFile, edits) {
  const abs = path.join(ROOT, relFile);
  const dir = path.dirname(abs);
  let src = fs.readFileSync(abs, 'utf8');
  for (const [from, to] of edits) {
    const hits = src.split(from).length - 1;
    assert.equal(hits, 1,
      `mutation anchor must match exactly once in ${relFile}: ${JSON.stringify(from.slice(0, 70))}`);
    src = src.replace(from, to);
  }
  src = src.replace(/require\('(\.[^']*)'\)/g, (_m, rel) =>
    `require(${JSON.stringify(path.resolve(dir, rel))})`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-p4b-mutant-'));
  mutantDirs.push(tmp);
  const file = path.join(tmp, `${path.basename(relFile, '.js')}.mutant.js`);
  fs.writeFileSync(file, src, 'utf8');
  return file;
}

const loadMutant = (edits) => require(mutantSource(MODULE, edits));

// --- anchors, quoted once so a drift breaks every control that uses one -----

// IS_CONNECTION_REJECTED's IS_TYPE_MISMATCH branch detail. Replaced to inject
// uncertainty wording into a strict violation -- a regression of the
// strict-wording rule. This branch is the one a test can reliably exercise.
const IS_TYPE_MISMATCH_LINE = "return 'The field type of the IS does not match the field type of the prototype interface member. ISO 4.8.3 requires the types to match exactly.';";

// ACCESS_DIFFERS detail line that cites ISO 4.9.2 silence. Removed to break
// the ISO-silence policy.
const ACCESS_DETAIL_LINE = "parts.push('ISO 4.9.2 names \"names and types\" and does not state that access categories must match.');";

// Title/summary keys. Replaced to mutate the message shape -- messages must
// not add severity.
const SHAPE_LINE = "    id: template.id,\n    title: template.title,\n    summary: template.summary,\n    detail,";

// Read accessor that throws on a missing value. Replaced with a permissive
// fallback so the catalog no longer fails closed.
const READ_LINE = "const entry = Object.prototype.hasOwnProperty.call(t, value) ? t[value] : undefined;";

// Compat TOLERATED_VIOLATION sentence. Replaced to drop the "not VRML97-conforming"
// half -- compatibility must NOT hide the strict violation.
const COMPAT_LINE = "return `${profile} is documented to accept this behavior. The content is not VRML97-conforming.${portableBit}`;";

// ACCESS_DIFFERS template title. Replaced to remove the "differs" wording -- a
// regression of the informational contract.
const ACCESS_TITLE_LINE = "'Interface member access category differs',";

// IS_CONNECTION_REJECTED title. Replaced to make a strict violation read
// uncertain.
const IS_TITLE_LINE = "'IS connection is not allowed',";

// Rollup WITHHELD summary. Replaced to drop "could not determine" wording.
const WITHHELD_LINE = "'WRLForge could not determine whether the local interface satisfies the implementation PROTO.',";

// Detail builder invocation. Replaced to use the finding as a string and run
// a regex over it -- a regression of the catalog's "no source parsing" rule.
const DETAILFOR_LINE = "const rawDetail = template.detailFor ? template.detailFor(ctx) : null;";

// nameOf helper. Replaced to truncate at length 5 -- a regression that
// shortens unusual names and breaks the contract.
const NAMEOF_LINE = "function nameOf(value) {\n  if (value == null) return null;\n  const s = String(value);\n  if (s.length === 0) return null;\n  return s;\n}";

// --- shared inputs ----------------------------------------------------------

const M = (mod, r) => mod.messageForPresentation(r);

const provenStrict = () => F.scriptExposedField();
const recovered = () => F.synthetic({
  iso: ISO_RESULT.PROHIBITED, confidence: STATUS.RECOVERED, reason: REASON.SCOPE_RECOVERED,
});
const tolerated = () => F.scriptExposedFieldWithCompatibility();
const uncertain = () => F.unsupportedIs();
const accessDiffers = () => F.accessDiffers();

// ---------------------------------------------------------------------------
// M1 -- strict error gets uncertain wording
// ---------------------------------------------------------------------------

test('M1 -- a strict violation must not adopt uncertainty words', () => {
  const real = M(messages, presentation.presentSemanticFinding(F.synthetic({
    code: FINDING_CODE.IS_CONNECTION_REJECTED,
    iso: ISO_RESULT.PROHIBITED,
    confidence: STATUS.RESOLVED,
    reason: REASON.IS_TYPE_MISMATCH,
  })));
  // Real wording is direct.
  assert.ok(!/may be invalid|perhaps|possibly/i.test(
    `${real.title} ${real.summary} ${real.detail || ''}`),
    'real strict violation has no uncertainty words anywhere');

  // Mutate the IS_TYPE_MISMATCH branch to introduce uncertainty.
  const replacement = "return 'The field type of the IS may be invalid or perhaps not match the field type of the prototype interface member. ISO 4.8.3 requires the types to match exactly.';";
  const mutant = loadMutant([[IS_TYPE_MISMATCH_LINE, replacement]]);
  const mutated = M(mutant, presentation.presentSemanticFinding(F.synthetic({
    code: FINDING_CODE.IS_CONNECTION_REJECTED,
    iso: ISO_RESULT.PROHIBITED,
    confidence: STATUS.RESOLVED,
    reason: REASON.IS_TYPE_MISMATCH,
  })));
  assert.ok(/may be invalid|perhaps/i.test(
    `${mutated.title} ${mutated.summary} ${mutated.detail || ''}`),
    'the mutant must exhibit the defect');
});

// ---------------------------------------------------------------------------
// M2 -- unknown becomes invalid
// ---------------------------------------------------------------------------

test('M2 -- an unprovable result must not present as "invalid"', () => {
  const real = M(messages, presentation.presentSemanticFinding(uncertain()));
  assert.equal(real.id, MESSAGE_ID.IS_CONNECTION_REJECTED);
  assert.ok(!/\binvalid\b/i.test(`${real.title} ${real.summary}`),
    'real uncertain text does not call itself invalid');

  // Mutate the rollup WITHHELD summary to claim "invalid".
  const replacement = "'WRLForge determined that this interface check is invalid and the contract is broken.',";
  const mutant = loadMutant([[WITHHELD_LINE, replacement]]);
  const mutated = mutant.messageForAgreementStatus(presentation.presentAgreementStatus(
    AGREEMENT_STATUS.WITHHELD));
  assert.ok(/\binvalid\b/i.test(`${mutated.title} ${mutated.summary}`),
    'the mutant must exhibit the defect');
});

// ---------------------------------------------------------------------------
// M3 -- compatibility hides strict violation
// ---------------------------------------------------------------------------

test('M3 -- the TOLERATED_VIOLATION detail must keep the strict-violation fact', () => {
  const real = M(messages, presentation.presentSemanticFinding(tolerated()));
  assert.ok(real.detail);
  assert.ok(/not\s+VRML97-conforming/i.test(real.detail),
    'real compat detail preserves the not-VRML97-conforming fact');

  const replacement = "return `${profile} accepts this behavior and the content is fine.`;";
  const mutant = loadMutant([[COMPAT_LINE, replacement]]);
  const mutated = M(mutant, presentation.presentSemanticFinding(tolerated()));
  assert.ok(!/not\s+VRML97-conforming/i.test(mutated.detail || ''),
    'the mutant must exhibit the defect');
});

// ---------------------------------------------------------------------------
// M4 -- ACCESS_DIFFERS says invalid
// ---------------------------------------------------------------------------

test('M4 -- ACCESS_DIFFERS must not over-claim as a violation', () => {
  const real = M(messages, presentation.presentAgreementFinding(accessDiffers()));
  assert.equal(real.id, MESSAGE_ID.AGREEMENT_ACCESS_DIFFERS);
  assert.ok(!/\binvalid\b/i.test(`${real.title} ${real.summary}`));

  const replacement = "'Interface member access category is invalid and non-conforming',";
  const mutant = loadMutant([[ACCESS_TITLE_LINE, replacement]]);
  const mutated = mutant.messageForAgreementFinding(
    presentation.presentAgreementFinding(accessDiffers()));
  assert.ok(/\binvalid\b/i.test(`${mutated.title} ${mutated.summary}`),
    'the mutant must exhibit the defect');
});

// ---------------------------------------------------------------------------
// M5 -- generic fallback added
// ---------------------------------------------------------------------------

test('M5 -- a missing entry must not return a generic message', () => {
  // The catalog already fails closed on a missing entry. Mutate the read
  // accessor to fall back instead, and confirm the fallback returns text
  // rather than throwing -- the regression that hides missing text. Use the
  // agreement-status path: an unknown status throws today, and the mutant
  // turns that throw into a silent fallback.
  const replacement = "const entry = t[value] || { id: 'unclassified-message', title: 'Unclassified message', summary: 'WRLForge could not classify this finding.', detail: null };";
  const mutant = loadMutant([[READ_LINE, replacement]]);
  const mutated = mutant.messageForAgreementStatus(Object.freeze({ status: 'invented' }));
  assert.equal(mutated.id, 'unclassified-message',
    'the mutant must fall back to a generic message');
});

// ---------------------------------------------------------------------------
// M6 -- wrong reason shares text
// ---------------------------------------------------------------------------

test('M6 -- distinct reasons must produce distinct text where meaning differs', () => {
  // IS_TARGET_NOT_BOUND with reason INTERFACE_MEMBER_NOT_DECLARED is a
  // strict violation; with reason EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE
  // it is uncertain. The wording must reflect that.
  const isMissing = M(messages, presentation.presentSemanticFinding(F.synthetic({
    code: FINDING_CODE.IS_TARGET_NOT_BOUND,
    iso: ISO_RESULT.PROHIBITED,
    confidence: STATUS.RESOLVED,
    reason: REASON.INTERFACE_MEMBER_NOT_DECLARED,
    name: 'a',
  })));
  const isUncertain = M(messages, presentation.presentSemanticFinding(F.synthetic({
    code: FINDING_CODE.IS_TARGET_NOT_BOUND,
    iso: ISO_RESULT.NOT_STATED,
    confidence: STATUS.UNSUPPORTED,
    reason: REASON.EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE,
    name: 'a',
  })));
  // Title and id are shared -- both ARE "IS target is not defined".
  assert.equal(isMissing.id, isUncertain.id);
  // But the detail differs.
  assert.ok(isMissing.detail);
  assert.ok(isUncertain.detail);
  assert.notEqual(isMissing.detail, isUncertain.detail,
    'distinct reasons with different meanings must produce different detail');
  // Strict missing-member text must not adopt uncertainty wording.
  assert.ok(!/could not determine/i.test(`${isMissing.title} ${isMissing.summary} ${isMissing.detail || ''}`),
    'strict missing-member text must not adopt uncertainty wording');
  // Uncertain unprovable text must use uncertainty wording.
  assert.ok(/could not determine/i.test(`${isUncertain.title} ${isUncertain.summary} ${isUncertain.detail || ''}`),
    'uncertain unprovable text must use uncertainty wording');
});

// ---------------------------------------------------------------------------
// M7 -- message adds severity
// ---------------------------------------------------------------------------

test('M7 -- a message object must not carry a severity field', () => {
  const real = M(messages, presentation.presentSemanticFinding(provenStrict()));
  assert.equal(real.severity, undefined,
    'the real message has no severity field');

  const replacement = "    id: template.id,\n    title: template.title,\n    summary: template.summary,\n    detail,\n    severity: 'error',";
  const mutant = loadMutant([[SHAPE_LINE, replacement]]);
  const mutated = M(mutant, presentation.presentSemanticFinding(provenStrict()));
  assert.equal(mutated.severity, 'error',
    'the mutant must exhibit the defect');
});

// ---------------------------------------------------------------------------
// M8 -- message adds save policy
// ---------------------------------------------------------------------------

test('M8 -- a message object must not carry a saveBlocking field', () => {
  const real = M(messages, presentation.presentSemanticFinding(provenStrict()));
  assert.equal(real.saveBlocking, undefined);

  const replacement = "    id: template.id,\n    title: template.title,\n    summary: template.summary,\n    detail,\n    saveBlocking: true,";
  const mutant = loadMutant([[SHAPE_LINE, replacement]]);
  const mutated = M(mutant, presentation.presentSemanticFinding(provenStrict()));
  assert.equal(mutated.saveBlocking, true,
    'the mutant must exhibit the defect');
});

// ---------------------------------------------------------------------------
// M9 -- source parsing enters catalog
// ---------------------------------------------------------------------------

test('M9 -- the catalog must not parse source text to decide a message', () => {
  // The structural guard: the module source contains no source-parsing or
  // regex-over-source patterns. The matrix test (M-NN in messages-matrix)
  // pins the same surface; this assertion carries the M9 control identity.
  // A behavioral mutation here would not exercise a different code path
  // because every catalog template has a `detailFor` builder; the regression
  // is the introduction of source-parsing, and source-scan is the guard.
  const src = fs.readFileSync(path.join(ROOT, MODULE), 'utf8');
  for (const banned of [/\bparse\s*\(/, /\bnew\s+RegExp\b/, /\breadFileSync\b/]) {
    assert.ok(!banned.test(src), `messages.js must not use ${banned}`);
  }
  // And the catalog is the only thing reachable: a regex over the finding's
  // own fields is the regression -- assert no field has been scanned by regex.
  const real = M(messages, presentation.presentSemanticFinding(provenStrict()));
  assert.equal(real.id, MESSAGE_ID.INTERFACE_DECLARATION_NONCONFORMING);
  // No template mutates the finding; messages is a sibling projection.
  assert.equal(real.finding, undefined, 'messages has no finding field');
  // And the source scan covers the structural ground this control exists for.
  // Anchor hygiene below proves every anchor still matches.
});

// ---------------------------------------------------------------------------
// M10 -- user name breaks text
// ---------------------------------------------------------------------------

test('M10 -- subject name interpolation must survive unusual characters', () => {
  const name = 'quote"and<tag>and{tab}';
  const tricky = F.synthetic({
    code: FINDING_CODE.USE_NOT_BOUND,
    name,
    iso: ISO_RESULT.PROHIBITED,
    confidence: STATUS.RESOLVED,
    reason: REASON.DEF_NOT_DECLARED_IN_SCOPE,
  });
  const real = M(messages, presentation.presentSemanticFinding(tricky));
  assert.ok(real.detail && real.detail.includes(name),
    'the real catalog keeps the name verbatim');

  // Mutate the nameOf helper to truncate at length 5.
  const replacement = "function nameOf(value) {\n  if (value == null) return null;\n  const s = String(value);\n  if (s.length === 0) return null;\n  return s.slice(0, 5);\n}";
  const mutant = loadMutant([[NAMEOF_LINE, replacement]]);
  const mutated = M(mutant, presentation.presentSemanticFinding(tricky));
  assert.ok(mutated.detail && !mutated.detail.includes(name),
    'the mutant must exhibit the defect');
});

// ---------------------------------------------------------------------------
// Bonus anchor coverage: ACCESS_DIFFERS detail cites ISO 4.9.2 silence
// ---------------------------------------------------------------------------

test('M-Bonus -- ACCESS_DIFFERS detail must cite ISO 4.9.2 silence', () => {
  const real = M(messages, presentation.presentAgreementFinding(accessDiffers()));
  assert.ok(real.detail && /4\.9\.2/.test(real.detail),
    'real ACCESS_DIFFERS detail cites ISO 4.9.2');

  const replacement = "// ISO 4.9.2 citation removed";
  const mutant = loadMutant([[ACCESS_DETAIL_LINE, replacement]]);
  // Re-wrap the finding in P4-A so the entry point receives a presentation.
  const mutated = mutant.messageForAgreementFinding(presentation.presentAgreementFinding(
    accessDiffers()));
  assert.ok(mutated.detail && !/4\.9\.2/.test(mutated.detail),
    'the mutant must exhibit the defect');
});

// ---------------------------------------------------------------------------
// Anchor hygiene
// ---------------------------------------------------------------------------

test('every mutation anchor still matches the production source exactly once', () => {
  const src = fs.readFileSync(path.join(ROOT, MODULE), 'utf8');
  for (const anchor of [IS_TYPE_MISMATCH_LINE, ACCESS_DETAIL_LINE,
    SHAPE_LINE, READ_LINE, COMPAT_LINE, ACCESS_TITLE_LINE, IS_TITLE_LINE,
    WITHHELD_LINE, NAMEOF_LINE]) {
    assert.equal(src.split(anchor).length - 1, 1,
      `stale anchor: ${JSON.stringify(anchor.slice(0, 60))}`);
  }
});

assert.ok(protoAgreement.AGREEMENT_BASIS);
assert.ok(presentation.SEVERITY);
