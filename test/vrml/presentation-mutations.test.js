'use strict';
// P4-A -- live mutation controls.
//
// A gate that has never been observed to fail is a comment. Each control takes
// the REAL production source, applies one targeted defect, loads the result as a
// module, and proves the defect changes the answer in exactly the way the
// corresponding production test forbids.
//
// The harness is WD1.7-C's, WD1.7-D's and WD1.7-E1's, unchanged and for the same
// two reasons: every substitution must match EXACTLY ONCE, so a mutation that
// stops applying fails loudly instead of passing vacuously; and mutants are
// written to the OS temp directory with relative requires rewritten to absolute
// paths, so a mutant composes with the real, unmutated rest of the tree and
// never touches the repository.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const presentation = require('../../src/vrml/presentation');
const semanticFindings = require('../../src/vrml/semantic-findings');
const protoAgreement = require('../../src/vrml/proto-agreement');
const sg = require('../../src/vrml/scope-graph');
const F = require('./presentation-fixtures');

const { SEVERITY, FILTER_TAG } = presentation;
const { ISO_RESULT } = semanticFindings;
const { STATUS, REASON } = sg;

const ROOT = path.join(__dirname, '..', '..');
const MODULE = 'src/vrml/presentation.js';
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-p4a-mutant-'));
  mutantDirs.push(tmp);
  const file = path.join(tmp, `${path.basename(relFile, '.js')}.mutant.js`);
  fs.writeFileSync(file, src, 'utf8');
  return file;
}

const loadMutant = (edits) => require(mutantSource(MODULE, edits));

// --- the anchors, quoted once so a drift breaks every control that uses one --

const SEVERITY_LINE = "  const severity = classify(SEVERITY_BY_CLAIM, claim, 'claim');";

const PROHIBITED_ROW = `  [ISO_RESULT.PROHIBITED]: table({
    [CONFIDENCE_CLASS.CONCLUSIVE]: CLAIM.VIOLATION,
    [CONFIDENCE_CLASS.INCONCLUSIVE]: CLAIM.VIOLATION,
  }),`;

const NOT_STATED_ROW = `  [ISO_RESULT.NOT_STATED]: table({
    [CONFIDENCE_CLASS.CONCLUSIVE]: CLAIM.OBSERVATION,
    [CONFIDENCE_CLASS.INCONCLUSIVE]: CLAIM.UNDETERMINED,
  }),`;

const VISIBLE_LINE = `    /** ALWAYS true. No semantic category is hidden before the user filters. */
    visible: true,`;

const SAVE_LINE = `    /** ALWAYS false. Rule 4 -- a semantic finding never blocks an ordinary Save. */
    saveBlocking: false,`;

const ACCESS_BASIS_LINE = '  [AGREEMENT_BASIS.NOT_SPECIFIED_BY_ISO_4_9_2]: ISO_RESULT.NOT_STATED,';

const RESULT_LINE = '  return Object.freeze({ finding, presentation: Object.freeze(presentation) });';

const DOCUMENT_LINE = '  return orderPresentations(findings.map(presentSemanticFinding));';

const SORT_CHAIN = `  indexed.sort((a, b) => (a.rank - b.rank)
    || (a.start - b.start)
    || (a.end - b.end)
    || byCodepoint(a.origin, b.origin)
    || byCodepoint(a.code, b.code)
    || byCodepoint(a.reason, b.reason)
    || byCodepoint(a.name, b.name)
    || (a.index - b.index));`;

// --- shared inputs ----------------------------------------------------------

const tolerated = () => F.scriptExposedFieldWithCompatibility();
const recoveredViolation = () => F.synthetic({
  iso: ISO_RESULT.PROHIBITED, confidence: STATUS.RECOVERED, reason: REASON.SCOPE_RECOVERED,
});
const unsupported = () => F.unsupportedIs();
const P = (mod, finding) => mod.presentSemanticFinding(finding).presentation;

// ---------------------------------------------------------------------------
// M1 -- compatibility downgrades a strict violation
// ---------------------------------------------------------------------------

test('M1 -- an evidence-backed profile may not discount a strict severity', () => {
  assert.equal(P(presentation, tolerated()).severity, SEVERITY.ERROR);

  const mutant = loadMutant([[SEVERITY_LINE,
    `  let severity = classify(SEVERITY_BY_CLAIM, claim, 'claim');
  if (fields.compatibility) severity = SEVERITY.WARNING;`]]);
  assert.equal(P(mutant, tolerated()).severity, SEVERITY.WARNING,
    'the mutant must exhibit the defect');
  // ...and the strict twin is untouched, which is what makes it a DOWNGRADE
  // rather than a policy change: the same construct, two answers.
  assert.equal(P(mutant, F.scriptExposedField()).severity, SEVERITY.ERROR);
});

// ---------------------------------------------------------------------------
// M2 -- recovered confidence downgrades a strict violation
// ---------------------------------------------------------------------------

test('M2 -- confidence may not mutate the severity of a normative violation', () => {
  assert.equal(P(presentation, recoveredViolation()).severity, SEVERITY.ERROR);

  const mutant = loadMutant([[PROHIBITED_ROW,
    `  [ISO_RESULT.PROHIBITED]: table({
    [CONFIDENCE_CLASS.CONCLUSIVE]: CLAIM.VIOLATION,
    [CONFIDENCE_CLASS.INCONCLUSIVE]: CLAIM.UNDETERMINED,
  }),`]]);
  assert.equal(P(mutant, recoveredViolation()).severity, SEVERITY.WARNING,
    'the mutant must exhibit the defect');
  // 86.96% of the corpus carries `recovered`; the defect would retire most of
  // the substrate's errors, so the proven twin must stay put to prove it.
  assert.equal(P(mutant, F.illegalChild()).severity, SEVERITY.ERROR);
});

// ---------------------------------------------------------------------------
// M3 -- recovered findings hidden by default
// ---------------------------------------------------------------------------

test('M3 -- a recovered finding may not be suppressed before the user filters', () => {
  const real = P(presentation, recoveredViolation());
  assert.equal(real.visible, true);
  assert.ok(real.tags.includes(FILTER_TAG.RECOVERED), 'it is tagged, not hidden');

  const mutant = loadMutant([[VISIBLE_LINE, '    visible: !recovered,']]);
  assert.equal(P(mutant, recoveredViolation()).visible, false,
    'the mutant must exhibit the defect');
  assert.equal(P(mutant, F.illegalChild()).visible, true);
});

// ---------------------------------------------------------------------------
// M4 -- a semantic finding blocks an ordinary Save
// ---------------------------------------------------------------------------

test('M4 -- no semantic finding may block an ordinary Save', () => {
  assert.equal(P(presentation, F.illegalChild()).saveBlocking, false);

  const mutant = loadMutant([[SAVE_LINE, '    saveBlocking: severity === SEVERITY.ERROR,']]);
  assert.equal(P(mutant, F.illegalChild()).saveBlocking, true,
    'the mutant must exhibit the defect');
  // An author with a broken document must still be able to save it, which is
  // exactly the case the defect breaks.
  assert.equal(P(mutant, recoveredViolation()).saveBlocking, true);
});

// ---------------------------------------------------------------------------
// M5 -- ACCESS_DIFFERS becomes a strict error
// ---------------------------------------------------------------------------

test('M5 -- an ISO-silent observation may not be presented as a violation', () => {
  const real = presentation.presentAgreementFinding(F.accessDiffers()).presentation;
  assert.equal(real.severity, SEVERITY.INFO);

  const mutant = loadMutant([[ACCESS_BASIS_LINE,
    '  [AGREEMENT_BASIS.NOT_SPECIFIED_BY_ISO_4_9_2]: ISO_RESULT.PROHIBITED,']]);
  assert.equal(mutant.presentAgreementFinding(F.accessDiffers()).presentation.severity,
    SEVERITY.ERROR, 'the mutant must exhibit the defect');
  // 4.9.2 names "names and types" and is silent on access categories (WD1.7-A
  // U7); the mutant asserts a requirement the standard does not state.
  assert.equal(mutant.presentAgreementFinding(F.memberMissing()).presentation.severity,
    SEVERITY.ERROR);
});

// ---------------------------------------------------------------------------
// M6 -- an unprovable answer becomes a proven error
// ---------------------------------------------------------------------------

test('M6 -- "could not determine" may not be presented as "known invalid"', () => {
  const real = P(presentation, unsupported());
  assert.equal(real.severity, SEVERITY.WARNING);
  assert.equal(real.claim, presentation.CLAIM.UNDETERMINED);

  const mutant = loadMutant([[NOT_STATED_ROW,
    `  [ISO_RESULT.NOT_STATED]: table({
    [CONFIDENCE_CLASS.CONCLUSIVE]: CLAIM.OBSERVATION,
    [CONFIDENCE_CLASS.INCONCLUSIVE]: CLAIM.VIOLATION,
  }),`]]);
  const mutated = P(mutant, unsupported());
  assert.equal(mutated.severity, SEVERITY.ERROR, 'the mutant must exhibit the defect');
  assert.equal(mutated.claim, presentation.CLAIM.VIOLATION);
});

// ---------------------------------------------------------------------------
// M7 -- a compatibility attachment creates a second diagnostic
// ---------------------------------------------------------------------------

test('M7 -- compatibility annotates one finding; it never adds a second item', () => {
  const list = presentation.presentDocumentFindings([tolerated()]);
  assert.equal(list.length, 1);
  assert.ok(list[0].presentation.compatibility);

  const mutant = loadMutant([[DOCUMENT_LINE,
    `  const shown = [];
  for (const f of findings) {
    shown.push(presentSemanticFinding(f));
    if (f.compatibility) shown.push(presentSemanticFinding(f));
  }
  return orderPresentations(shown);`]]);
  assert.equal(mutant.presentDocumentFindings([tolerated()]).length, 2,
    'the mutant must exhibit the defect');
  assert.equal(mutant.presentDocumentFindings([F.scriptExposedField()]).length, 1);
});

// ---------------------------------------------------------------------------
// M8 -- ordering stops being deterministic
// ---------------------------------------------------------------------------

test('M8 -- ordering may not depend on the producer\'s emission order', () => {
  const raw = F.projected(F.RECOVERED_DOCUMENT)
    .concat(F.projected(F.ILLEGAL_CHILD))
    .concat(F.projected(F.TWO_UNBOUND_USES));
  const key = (mod, list) => mod.presentDocumentFindings(list)
    .map((r) => `${r.presentation.attentionRank}:${r.finding.code}:${r.finding.reason}`);
  assert.deepEqual(key(presentation, [...raw].reverse()), key(presentation, raw));

  const mutant = loadMutant([[SORT_CHAIN, '  indexed.sort((a, b) => (a.rank - b.rank));']]);
  assert.notDeepEqual(key(mutant, [...raw].reverse()), key(mutant, raw),
    'the mutant must exhibit the defect');
});

// ---------------------------------------------------------------------------
// M9 -- P4 rewrites the underlying finding
// ---------------------------------------------------------------------------

test('M9 -- the finding is carried by identity and never re-emitted', () => {
  const input = F.illegalChild();
  const real = presentation.presentSemanticFinding(input);
  assert.equal(real.finding, input);
  assert.equal(real.finding.iso, ISO_RESULT.PROHIBITED);

  const mutant = loadMutant([[RESULT_LINE,
    `  return Object.freeze({
    finding: Object.freeze(Object.assign({}, finding, { iso: ISO_RESULT.NOT_STATED })),
    presentation: Object.freeze(presentation),
  });`]]);
  const mutated = mutant.presentSemanticFinding(input);
  assert.notEqual(mutated.finding, input, 'the mutant must exhibit the defect');
  assert.equal(mutated.finding.iso, ISO_RESULT.NOT_STATED);
  // The real input is untouched even by the mutant -- findings are frozen, and
  // the defect is that the CONSUMER is handed a rewritten copy.
  assert.equal(input.iso, ISO_RESULT.PROHIBITED);
});

// ---------------------------------------------------------------------------
// M10 -- P4 de-duplicates separate occurrences
// ---------------------------------------------------------------------------

test('M10 -- two source locations stay two findings', () => {
  const raw = F.findings(F.TWO_UNBOUND_USES);
  assert.equal(raw.length, 2);
  assert.equal(presentation.presentDocumentFindings(raw).length, 2);

  const mutant = loadMutant([[DOCUMENT_LINE,
    `  const seen = new Set();
  const shown = [];
  for (const f of findings) {
    const k = f.code + '\\u0000' + f.reason;
    if (seen.has(k)) continue;
    seen.add(k);
    shown.push(presentSemanticFinding(f));
  }
  return orderPresentations(shown);`]]);
  assert.equal(mutant.presentDocumentFindings(raw).length, 1,
    'the mutant must exhibit the defect');
});

// ---------------------------------------------------------------------------
// Anchor hygiene
// ---------------------------------------------------------------------------

test('every mutation anchor still matches the production source exactly once', () => {
  const src = fs.readFileSync(path.join(ROOT, MODULE), 'utf8');
  for (const anchor of [SEVERITY_LINE, PROHIBITED_ROW, NOT_STATED_ROW, VISIBLE_LINE,
    SAVE_LINE, ACCESS_BASIS_LINE, RESULT_LINE, DOCUMENT_LINE, SORT_CHAIN]) {
    assert.equal(src.split(anchor).length - 1, 1,
      `stale anchor: ${JSON.stringify(anchor.slice(0, 60))}`);
  }
});

// `protoAgreement` is imported so the fixtures' agreement path is exercised
// against the real module rather than a mutant's copy of it.
assert.ok(protoAgreement.AGREEMENT_BASIS);
