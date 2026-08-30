'use strict';
// WD1.7-E1 -- live mutation controls.
//
// A gate that has never been observed to fail is a comment. Each control takes
// the REAL production source, applies one targeted defect, loads the result as a
// module, and proves the defect changes the answer in exactly the way the
// corresponding production test forbids.
//
// The harness is WD1.7-C's and WD1.7-D's, unchanged and for the same two
// reasons: every substitution must match EXACTLY ONCE, so a mutation that stops
// applying fails loudly instead of passing vacuously; and mutants are written to
// the OS temp directory with relative requires rewritten to absolute paths, so a
// mutant composes with the real, unmutated rest of the tree and never touches
// the repository.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parse } = require('../../src/vrml');
const sg = require('../../src/vrml/scope-graph');
const semanticFindings = require('../../src/vrml/semantic-findings');
const compatibility = require('../../src/vrml/compatibility');
const D = require('../../src/proto-enrichment');

const { FINDING_CODE, ISO_RESULT, findingsForDocument } = semanticFindings;
const { REASON } = sg;
const { VENDOR_BEHAVIOR, COMPATIBILITY_CLASSIFICATION } = compatibility;

const ROOT = path.join(__dirname, '..', '..');
const COMPAT = 'src/vrml/compatibility.js';
const FINDINGS = 'src/vrml/semantic-findings.js';
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-wd17e1-mutant-'));
  mutantDirs.push(tmp);
  const file = path.join(tmp, `${path.basename(relFile, '.js')}.mutant.js`);
  fs.writeFileSync(file, src, 'utf8');
  return file;
}

const loadMutant = (relFile, edits) => require(mutantSource(relFile, edits));

const H = '#VRML V2.0 utf8\n';
const findings = (text) => findingsForDocument(sg.buildScopeGraph(parse(H + text)));
const only = (text, code, reason) => {
  const hit = findings(text).filter((f) => f.code === code && f.reason === reason);
  assert.equal(hit.length, 1);
  return hit[0];
};

const SCRIPT_EXPOSED_FIELD = 'DEF S Script { exposedField SFBool go TRUE }\n';
const scriptFinding = () => only(SCRIPT_EXPOSED_FIELD,
  FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING,
  REASON.EXPOSED_FIELD_IN_SCRIPT_INTERFACE);

/** A real WD1.7-D `ACCESS_DIFFERS` finding, for the leak controls. */
function accessDiffersFinding() {
  const { interfaceQuery, protoAgreement } = require('../../src/vrml');
  const lp = parse(`${H}EXTERNPROTO X [field SFInt32 a] "lib.wrl#X"\n`);
  const tp = parse(`${H}PROTO X [exposedField SFInt32 a 0] { Group {} }\n`);
  const r = protoAgreement.compareInterfaceAgreement(
    interfaceQuery.buildScopeGraph(lp), lp.tree.statements.find((s) => s.type === 'ExternProto'),
    interfaceQuery.buildScopeGraph(tp), tp.tree.statements.find((s) => s.type === 'Proto'));
  const f = r.findings.find((x) => x.code === D.AGREEMENT_FINDING.ACCESS_DIFFERS);
  assert.ok(f, 'the control needs a real ACCESS_DIFFERS finding');
  return f;
}

// The one production mapping entry, quoted so every mutation that widens it has
// a single stable anchor.
const MAPPING_ANCHOR = `  [key(FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING,
    REASON.EXPOSED_FIELD_IN_SCRIPT_INTERFACE)]:
    VENDOR_BEHAVIOR.SCRIPT_INTERFACE_EXPOSED_FIELD,`;

// --- M1: prevalence becomes evidence ---------------------------------------

test('M1 -- a corpus-observed entry cannot even be loaded into the registry', () => {
  // The single most likely way this module rots: "the construct appears 46,945
  // times, so the vendor must have accepted it". Prevalence is Tier C and Tier C
  // may never support a named claim. The guard is a load-time THROW, so the
  // defective table cannot ship even if a test is deleted.
  assert.equal(compatibility.behaviorEvidence(VENDOR_BEHAVIOR.SCRIPT_INTERFACE_EXPOSED_FIELD).tier,
    compatibility.EVIDENCE_TIER.VENDOR_DOCUMENTED);

  assert.throws(() => loadMutant(COMPAT, [[
    '  tier: EVIDENCE_TIER.VENDOR_DOCUMENTED,\n  subtier: EVIDENCE_SUBTIER.DOCUMENTED,',
    '  tier: EVIDENCE_TIER.CORPUS_OBSERVED,\n  subtier: null,',
  ]]), /not supported by vendor-documented evidence/,
  'the mutant must exhibit the defect at load');
});

// --- M2: V1 leaks onto file-target WD1.7-D findings -------------------------

test('M2 -- the URN rule must not classify an ordinary file-target finding', () => {
  const d = accessDiffersFinding();
  assert.equal(compatibility.compatibilityFor(d), null);

  const mutant = loadMutant(COMPAT, [[
    `  if (!finding || typeof finding.code !== 'string' || typeof finding.reason !== 'string') {
    return null;
  }`,
    `  if (!finding || typeof finding.code !== 'string') return null;
  if (typeof finding.reason !== 'string') {
    return BEHAVIOR_EVIDENCE[VENDOR_BEHAVIOR.URN_NATIVE_NODE_INTERFACE_OVERRIDE];
  }`,
  ]]);
  const got = mutant.compatibilityFor(d);
  assert.ok(got, 'the mutant must exhibit the defect');
  assert.equal(got.behavior, VENDOR_BEHAVIOR.URN_NATIVE_NODE_INTERFACE_OVERRIDE);
  assert.notEqual(got, compatibility.compatibilityFor(d),
    'and the production suite asserts null for exactly this finding');
});

// --- M3: attaching compatibility rewrites the ISO axis ----------------------

test('M3 -- the slot-filling projection cannot be allowed to touch `iso`', () => {
  const f = scriptFinding();
  const record = compatibility.compatibilityFor(f);
  assert.equal(semanticFindings.attachCompatibility(f, record).iso, ISO_RESULT.PROHIBITED);

  const mutant = loadMutant(FINDINGS, [[
    '    iso: source.iso,\n    rule: source.rule,',
    '    iso: ISO_RESULT.NOT_STATED,\n    rule: null,',
  ]]);
  const got = mutant.attachCompatibility(f, record);
  assert.equal(got.iso, ISO_RESULT.NOT_STATED, 'the mutant must exhibit the defect');
  assert.equal(got.rule, null);
  assert.notEqual(got.iso, f.iso, 'and the production suite asserts the strict facts survive');
});

test('M3b -- nor any other strict field', () => {
  const f = scriptFinding();
  const record = compatibility.compatibilityFor(f);
  const mutant = loadMutant(FINDINGS, [[
    '    confidence: source.confidence,\n    reason: source.reason,',
    "    confidence: 'recovered',\n    reason: 'ok',",
  ]]);
  const got = mutant.attachCompatibility(f, record);
  assert.equal(got.reason, 'ok', 'the mutant must exhibit the defect');
  assert.notEqual(got.reason, f.reason);
  assert.notEqual(got.confidence, f.confidence);
});

// --- M4: a tolerated violation quietly becomes conforming -------------------

test('M4 -- a second construction path could downgrade a violation; there is none', () => {
  const f = scriptFinding();
  assert.equal(compatibility.withCompatibility(f).iso, ISO_RESULT.PROHIBITED);

  // The defect this control models is the whole reason `attachCompatibility`
  // exists: a projection that builds its OWN record can set anything it likes.
  const mutant = loadMutant(COMPAT, [[
    `function withCompatibility(finding) {
  return semanticFindings.attachCompatibility(finding, compatibilityFor(finding));
}`,
    `function withCompatibility(finding) {
  const attachment = compatibilityFor(finding);
  if (!attachment) return finding;
  const downgraded = attachment.classification
    === COMPATIBILITY_CLASSIFICATION.TOLERATED_VIOLATION;
  return Object.freeze({ ...finding,
    compatibility: attachment,
    iso: downgraded ? 'not-stated' : finding.iso });
}`,
  ]]);
  const got = mutant.withCompatibility(f);
  assert.equal(got.compatibility.classification,
    COMPATIBILITY_CLASSIFICATION.TOLERATED_VIOLATION);
  assert.equal(got.iso, 'not-stated', 'the mutant must exhibit the defect');
  assert.notEqual(got.iso, f.iso,
    'a runtime accepting a violation never makes the content conforming');
});

// --- M5: all parser recovery marked as the documented vendor behaviour ------

test('M5 -- unrelated recovery must not be swept into the node-value behaviour', () => {
  const recovered = `DEF T Transform { children [
    Shape { }
    ROUTE A.b TO C.d
    PROTO Local [ ] { Group {} }
  ] }\n`;
  const all = findings(recovered);
  assert.ok(all.length > 0);
  for (const f of all) assert.equal(compatibility.compatibilityFor(f), null);

  const mutant = loadMutant(COMPAT, [[
    `  const behavior = BEHAVIOR_BY_FINDING[key(finding.code, finding.reason)];
  return behavior ? BEHAVIOR_EVIDENCE[behavior] : null;`,
    `  const behavior = BEHAVIOR_BY_FINDING[key(finding.code, finding.reason)]
    || VENDOR_BEHAVIOR.NODE_VALUE_POSITION_STATEMENTS;
  return behavior ? BEHAVIOR_EVIDENCE[behavior] : null;`,
  ]]);
  const swept = all.filter((f) => mutant.compatibilityFor(f) !== null);
  assert.equal(swept.length, all.length, 'the mutant must exhibit the defect');
  assert.equal(mutant.compatibilityFor(all[0]).behavior,
    VENDOR_BEHAVIOR.NODE_VALUE_POSITION_STATEMENTS);
});

// --- M6: the extension-node registry blesses arbitrary unknown node names ---

test('M6 -- an unknown node type is not an extension node', () => {
  const unknown = only('NotAKnownNodeType { }\n',
    FINDING_CODE.NODE_TYPE_NOT_BOUND, REASON.NODE_TYPE_UNKNOWN);
  assert.equal(compatibility.compatibilityFor(unknown), null);

  // The documented capability is the URN MECHANISM. A document that writes a
  // bare name has not used it, and 25 documented names are not a wildcard.
  const mutant = loadMutant(COMPAT, [[
    MAPPING_ANCHOR,
    `${MAPPING_ANCHOR}
  [key(FINDING_CODE.NODE_TYPE_NOT_BOUND, REASON.NODE_TYPE_UNKNOWN)]:
    VENDOR_BEHAVIOR.URN_NATIVE_EXTENSION_NODES,`,
  ]]);
  const got = mutant.compatibilityFor(unknown);
  assert.ok(got, 'the mutant must exhibit the defect');
  assert.equal(got.behavior, VENDOR_BEHAVIOR.URN_NATIVE_EXTENSION_NODES);
});

// --- M7: a speculative profile identifier enters the public registry --------

test('M7 -- a deferred profile is not an enum member because a document names it', () => {
  assert.deepEqual(Object.keys(compatibility.COMPATIBILITY_PROFILE), ['BLAXXUN_CONTACT']);

  const mutant = loadMutant(COMPAT, [[
    "  /** blaxxun Contact 3D, the 4.x-5.x ActiveX VRML client. */\n  BLAXXUN_CONTACT: 'blaxxun-contact',",
    "  BLAXXUN_CONTACT: 'blaxxun-contact',\n  BLAXXUN_3D: 'blaxxun-3d',\n  GLVIEW: 'glview',",
  ]]);
  assert.deepEqual(Object.keys(mutant.COMPATIBILITY_PROFILE),
    ['BLAXXUN_CONTACT', 'BLAXXUN_3D', 'GLVIEW'], 'the mutant must exhibit the defect');
  assert.notDeepEqual(Object.keys(mutant.COMPATIBILITY_PROFILE),
    Object.keys(compatibility.COMPATIBILITY_PROFILE));
});

// --- M8: the record collapses into a boolean --------------------------------

test('M8 -- no boolean can express "forbidden by ISO and taken anyway"', () => {
  const c = compatibility.compatibilityFor(scriptFinding());
  assert.equal(c.compatible, undefined);

  const mutant = loadMutant(COMPAT, [[
    '    behavior: fields.behavior,\n    profile: fields.profile,',
    '    behavior: fields.behavior,\n    profile: fields.profile,\n    compatible: true,',
  ]]);
  const got = mutant.compatibilityFor(scriptFinding());
  assert.equal(got.compatible, true, 'the mutant must exhibit the defect');
  assert.ok(Object.keys(got).includes('compatible'));
  assert.ok(!Object.keys(c).includes('compatible'),
    'and the production suite asserts the exact key set');
});
