'use strict';
// WD1.7-E1 -- earned compatibility profiles.
//
// The lane fills the third axis WD1.6-D reserved. Every test here exists to
// keep one of four promises:
//
//   1. A profile identifier is EARNED by a citable artifact. Prevalence,
//      authorship and plausibility grant no membership.
//   2. Attaching one cannot change a single strict fact.
//   3. A documented behaviour with no corresponding structured observation
//      stays REGISTRY-ONLY. No finding is invented to display it.
//   4. `null` still means NOT EVALUATED, and there is no boolean anywhere.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parse } = require('../../src/vrml');
const sg = require('../../src/vrml/scope-graph');
const semanticFindings = require('../../src/vrml/semantic-findings');
const compatibility = require('../../src/vrml/compatibility');

const { FINDING_CODE, ISO_RESULT, findingsForDocument } = semanticFindings;
const { REASON, STATUS } = sg;
const {
  COMPATIBILITY_PROFILE, COMPATIBILITY_CLASSIFICATION, EVIDENCE_TIER,
  EVIDENCE_SUBTIER, EVIDENCE_KIND, VENDOR_BEHAVIOR,
  compatibilityFor, withCompatibility,
} = compatibility;

const H = '#VRML V2.0 utf8\n';
const SOURCE_PATH = path.join(__dirname, '../../src/vrml/compatibility.js');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');
const codeOnly = (src) => src.split('\n')
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n');
const CODE = codeOnly(SOURCE);

/** Every finding for one document, in the substrate's own order. */
function findings(text) {
  return findingsForDocument(sg.buildScopeGraph(parse(H + text)));
}
const one = (text, code, reason) => {
  const hit = findings(text).filter((f) => f.code === code
    && (reason === undefined || f.reason === reason));
  assert.equal(hit.length, 1, `expected exactly one ${code}/${reason} in the fixture`);
  return hit[0];
};

// The exact construct the vendor documented: an `exposedField` in a Script
// node's interface, which Annex A.3 and 6.40 both exclude.
const SCRIPT_EXPOSED_FIELD = 'DEF S Script { exposedField SFBool go TRUE }\n';
// The SAME finding code, a DIFFERENT reason: an `IS` in an interface
// DECLARATION list. Non-conforming, real, and documented by nobody.
const IS_IN_DECLARATION = 'PROTO P [ field SFInt32 outer 0 ]\n'
  + '{ Group { children [ ] } }\n'
  + 'PROTO Q [ field SFInt32 inner IS outer ] { Group {} }\n';

// ---------------------------------------------------------------------------
// 1. The profile registry -- earned names only
// ---------------------------------------------------------------------------

test('exactly one profile is earned, and it is the vendor-documented product', () => {
  assert.deepEqual(compatibility.profiles(), ['blaxxun-contact']);
  assert.equal(COMPATIBILITY_PROFILE.BLAXXUN_CONTACT, 'blaxxun-contact');
  assert.deepEqual(Object.keys(COMPATIBILITY_PROFILE), ['BLAXXUN_CONTACT']);
});

test('M7-adjacent -- no speculative profile identifier is registered', () => {
  // Each of these names something real or something once used in this project.
  // None has an evidenced consumer, and a document mentioning a name is not
  // membership. The bare vendor name is the worst of them: it spans two
  // implementations with OPPOSITE posture on the constructs at issue.
  for (const speculative of ['blaxxun-3d', 'glview', 'blaxxun', 'cybertown',
    'cybertown-compat', 'legacy-vrml', 'legacy-cybertown']) {
    assert.equal(compatibility.profileContract(speculative), null,
      `${speculative} must not be an earned profile`);
    assert.ok(!compatibility.profiles().includes(speculative));
  }
});

test('the profile contract answers all five questions a public profile must', () => {
  const c = compatibility.profileContract(COMPATIBILITY_PROFILE.BLAXXUN_CONTACT);
  assert.equal(c.vendor, 'blaxxun interactive');
  assert.equal(c.product, 'blaxxun Contact 3D');
  assert.equal(c.versionFamily, '4.x-5.x');
  assert.ok(c.definedBy.length >= 2, 'named in more than one shipped generation');
  assert.equal(c.behaviors.length, 5);
  assert.ok(c.falsifiedBy.includes('absence'));
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.definedBy) && Object.isFrozen(c.behaviors));
});

test('every registered behaviour is vendor-documented and cites an artifact', () => {
  for (const behavior of Object.values(VENDOR_BEHAVIOR)) {
    const record = compatibility.behaviorEvidence(behavior);
    assert.ok(record, `${behavior} is registered`);
    assert.equal(record.profile, COMPATIBILITY_PROFILE.BLAXXUN_CONTACT);
    assert.equal(record.tier, EVIDENCE_TIER.VENDOR_DOCUMENTED);
    assert.equal(record.subtier, EVIDENCE_SUBTIER.DOCUMENTED,
      'documented is not executed -- nothing here has been reproduced by running the product');
    assert.ok(record.evidence.length >= 1);
    assert.ok(Object.values(COMPATIBILITY_CLASSIFICATION).includes(record.classification));
    for (const e of record.evidence) {
      assert.equal(e.kind, EVIDENCE_KIND.VENDOR_DOCUMENTATION);
      assert.equal(e.root, compatibility.REFERENCE_ROOT);
      assert.ok(e.path && !path.isAbsolute(e.path), 'a reference key, never a host path');
      assert.ok(e.generation && e.claim && e.vendor && e.product);
    }
  }
});

test('the two classifications stay apart -- ISO silence is not ISO tolerance', () => {
  const silent = [VENDOR_BEHAVIOR.URN_NATIVE_NODE_INTERFACE_OVERRIDE,
    VENDOR_BEHAVIOR.URN_NATIVE_EXTENSION_NODES];
  const forbidden = [VENDOR_BEHAVIOR.NODE_VALUE_POSITION_STATEMENTS,
    VENDOR_BEHAVIOR.SCRIPT_INTERFACE_EXPOSED_FIELD,
    VENDOR_BEHAVIOR.CREATE_VRML_FROM_STRING_TOP_LEVEL_PROTOS];
  for (const b of silent) {
    assert.equal(compatibility.behaviorEvidence(b).classification,
      COMPATIBILITY_CLASSIFICATION.EXTRA_STANDARD);
  }
  for (const b of forbidden) {
    assert.equal(compatibility.behaviorEvidence(b).classification,
      COMPATIBILITY_CLASSIFICATION.TOLERATED_VIOLATION);
  }
  assert.notEqual(COMPATIBILITY_CLASSIFICATION.EXTRA_STANDARD,
    COMPATIBILITY_CLASSIFICATION.TOLERATED_VIOLATION);
});

// ---------------------------------------------------------------------------
// 2. Q1 -- the one behaviour that maps to a real structured observation
// ---------------------------------------------------------------------------

test('Q1 the Script exposedField finding earns the profile', () => {
  const strict = one(SCRIPT_EXPOSED_FIELD,
    FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING,
    REASON.EXPOSED_FIELD_IN_SCRIPT_INTERFACE);
  assert.equal(strict.compatibility, null, 'the substrate still evaluates nothing');

  const projected = withCompatibility(strict);
  const c = projected.compatibility;
  assert.ok(c, 'the projection attaches the earned record');
  assert.equal(c.profile, COMPATIBILITY_PROFILE.BLAXXUN_CONTACT);
  assert.equal(c.behavior, VENDOR_BEHAVIOR.SCRIPT_INTERFACE_EXPOSED_FIELD);
  assert.equal(c.classification, COMPATIBILITY_CLASSIFICATION.TOLERATED_VIOLATION);
  assert.equal(c.tier, EVIDENCE_TIER.VENDOR_DOCUMENTED);
  assert.equal(c.subtier, EVIDENCE_SUBTIER.DOCUMENTED);
  assert.equal(c.evidence.length, 1);
});

test('Q1 attaching a profile changes NOTHING about the strict finding', () => {
  const strict = one(SCRIPT_EXPOSED_FIELD,
    FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING,
    REASON.EXPOSED_FIELD_IN_SCRIPT_INTERFACE);
  const projected = withCompatibility(strict);

  // The ISO axis is the one that matters: the runtime accepted it, the standard
  // still forbids it, and the finding still says so.
  assert.equal(strict.iso, ISO_RESULT.PROHIBITED);
  assert.equal(projected.iso, ISO_RESULT.PROHIBITED);
  assert.equal(projected.confidence, STATUS.RESOLVED);

  // Field by field, so a future addition to the record cannot slip through a
  // whole-object comparison that silently ignores it.
  for (const field of ['code', 'iso', 'confidence', 'reason', 'detail']) {
    assert.equal(projected[field], strict[field], `${field} must be carried verbatim`);
  }
  for (const field of ['subject', 'range', 'rule']) {
    assert.equal(projected[field], strict[field], `${field} must be the SAME object`);
  }

  // `evidence` is the one strict field that is NOT shared by identity: the one
  // constructor hands every finding a FRESH frozen copy, so two findings can
  // never share a mutable array. Equal by value, deliberately not by reference.
  assert.deepEqual(projected.evidence, strict.evidence);
  assert.ok(Object.isFrozen(projected.evidence));

  // And the whole record differs in exactly those two places, one of which is
  // the slot this lane exists to fill.
  assert.deepEqual(Object.keys(projected).sort(), Object.keys(strict).sort());
  const differing = Object.keys(strict).filter((k) => projected[k] !== strict[k]);
  assert.deepEqual(differing.sort(), ['compatibility', 'evidence']);
});

test('the input finding is never mutated -- the projection is a new record', () => {
  const strict = one(SCRIPT_EXPOSED_FIELD,
    FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING,
    REASON.EXPOSED_FIELD_IN_SCRIPT_INTERFACE);
  const projected = withCompatibility(strict);
  assert.notEqual(projected, strict);
  assert.equal(strict.compatibility, null, 'the caller-owned record is untouched');
  assert.ok(Object.isFrozen(projected));
  assert.throws(() => { 'use strict'; projected.iso = ISO_RESULT.NOT_STATED; }, TypeError);
  assert.throws(() => { 'use strict'; projected.compatibility = null; }, TypeError);
});

test('the emitted record is frozen all the way down', () => {
  const c = withCompatibility(one(SCRIPT_EXPOSED_FIELD,
    FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING,
    REASON.EXPOSED_FIELD_IN_SCRIPT_INTERFACE)).compatibility;
  assert.ok(Object.isFrozen(c));
  assert.ok(Object.isFrozen(c.evidence));
  for (const e of c.evidence) assert.ok(Object.isFrozen(e));
  assert.throws(() => { 'use strict'; c.classification = 'anything'; }, TypeError);
});

// ---------------------------------------------------------------------------
// 3. Q2 / Q4 -- everything else stays NOT EVALUATED
// ---------------------------------------------------------------------------

test('Q2 a different nonconforming interface declaration stays null', () => {
  // Same FINDING CODE, different REASON. Keying on the code alone would
  // classify this, and no vendor documentation says a word about it.
  const other = one(IS_IN_DECLARATION,
    FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING,
    REASON.IS_IN_INTERFACE_DECLARATION_LIST);
  assert.equal(other.iso, ISO_RESULT.PROHIBITED, 'it really is nonconforming');
  assert.equal(compatibilityFor(other), null);
  assert.equal(withCompatibility(other), other, 'and the finding is handed back unchanged');
});

test('Q2 an ordinary field in a Script interface produces nothing to classify', () => {
  const all = findings('DEF S Script { field SFBool go TRUE }\n');
  for (const f of all) assert.equal(compatibilityFor(f), null);
});

test('Q4 statements in node-value position earn no classification today', () => {
  // The documented behaviour is real and registered. But the parser accepts the
  // construct SILENTLY -- no diagnostic, no finding -- so there is nothing to
  // attach it to, and marking unrelated findings from the same document would
  // be compatibility-by-proximity.
  const recovered = `DEF T Transform { children [
    Shape { }
    ROUTE A.b TO C.d
    PROTO Local [ ] { Group {} }
  ] }\n`;
  const all = findings(recovered);
  assert.ok(all.length > 0, 'the fixture really does produce findings');
  for (const f of all) {
    assert.equal(compatibilityFor(f), null,
      `${f.code}/${f.reason} must not be classified as a documented vendor behaviour`);
  }
  assert.ok(compatibility.registryOnlyBehaviors()
    .includes(VENDOR_BEHAVIOR.NODE_VALUE_POSITION_STATEMENTS));
});

test('a whole document classifies at most the constructs the evidence names', () => {
  const mixed = SCRIPT_EXPOSED_FIELD + IS_IN_DECLARATION + 'Shape { geometry Box {} }\n';
  const classified = findings(mixed)
    .map(withCompatibility)
    .filter((f) => f.compatibility !== null);
  assert.equal(classified.length, 1);
  assert.equal(classified[0].reason, REASON.EXPOSED_FIELD_IN_SCRIPT_INTERFACE);
});

test('a foreign or malformed object is answered null, never guessed at', () => {
  for (const junk of [null, undefined, {}, { code: 'x' }, { reason: 'y' },
    { code: 1, reason: 2 }, 'exposed-field-in-script-interface']) {
    assert.equal(compatibilityFor(junk), null);
  }
});

// ---------------------------------------------------------------------------
// 4. Q5 -- registry-only behaviours, present as evidence, absent as findings
// ---------------------------------------------------------------------------

test('Q5 four documented behaviours are registry-only and mint no finding', () => {
  assert.deepEqual(compatibility.mappedBehaviors(),
    [VENDOR_BEHAVIOR.SCRIPT_INTERFACE_EXPOSED_FIELD]);
  // The returned arrays are FROZEN and already in a deterministic order, so a
  // consumer cannot sort them in place -- asserted here rather than worked
  // around, because an in-place sort is exactly how a shared table gets
  // rewritten by a caller.
  const registryOnly = compatibility.registryOnlyBehaviors();
  assert.ok(Object.isFrozen(registryOnly) && Object.isFrozen(compatibility.mappedBehaviors()));
  assert.throws(() => { registryOnly.sort(); }, TypeError);
  assert.deepEqual(registryOnly, [
    VENDOR_BEHAVIOR.CREATE_VRML_FROM_STRING_TOP_LEVEL_PROTOS,
    VENDOR_BEHAVIOR.NODE_VALUE_POSITION_STATEMENTS,
    VENDOR_BEHAVIOR.URN_NATIVE_EXTENSION_NODES,
    VENDOR_BEHAVIOR.URN_NATIVE_NODE_INTERFACE_OVERRIDE,
  ]);

  // Registry-only means the EVIDENCE is fully queryable. It is not a stub.
  for (const b of compatibility.registryOnlyBehaviors()) {
    const r = compatibility.behaviorEvidence(b);
    assert.ok(r.evidence.length >= 1 && r.evidence[0].claim.length > 20);
  }

  // And the mapping table really does hold exactly one route into production.
  assert.equal(Object.keys(compatibility.BEHAVIOR_BY_FINDING).length, 1);
});

test('M6-adjacent -- the extension-node registry blesses no bare node name', () => {
  // 25 documented type names, and NOT a licence to treat an unknown spelling as
  // an extension. The documented capability is the URN mechanism; a document
  // that writes the name directly has not used it.
  assert.equal(compatibility.URN_EXTENSION_NODE_TYPES.length, 25);
  assert.ok(compatibility.URN_EXTENSION_NODE_TYPES.includes('BspTree'));

  for (const type of ['BspTree', 'Occlusion', 'Layer3D', 'NotAKnownNodeType']) {
    const f = one(`${type} { }\n`, FINDING_CODE.NODE_TYPE_NOT_BOUND);
    assert.equal(f.reason, REASON.NODE_TYPE_UNKNOWN);
    assert.equal(f.iso, ISO_RESULT.PROHIBITED);
    assert.equal(compatibilityFor(f), null,
      `${type} written bare has not used the documented mechanism`);
  }
});

// ---------------------------------------------------------------------------
// 5. Boundaries -- no boolean, no presentation, no detection, no filesystem
// ---------------------------------------------------------------------------

test('M8-adjacent -- there is no boolean anywhere in the result model', () => {
  const c = withCompatibility(one(SCRIPT_EXPOSED_FIELD,
    FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING,
    REASON.EXPOSED_FIELD_IN_SCRIPT_INTERFACE)).compatibility;
  assert.deepEqual(Object.keys(c).sort(),
    ['behavior', 'classification', 'detail', 'evidence', 'profile', 'subtier', 'tier']);
  for (const [k, v] of Object.entries(c)) {
    assert.notEqual(typeof v, 'boolean', `${k} must not be a boolean`);
  }
  for (const banned of ['compatible', 'isCompatible', 'supported', 'ok', 'valid']) {
    assert.equal(c[banned], undefined);
    assert.equal(compatibility[banned], undefined);
  }
  assert.ok(!/\bcompatible\s*:/.test(CODE), 'no `compatible:` field may exist');
  assert.ok(!/isCompatible/.test(CODE));
});

test('no presentation policy -- P4 still owns severity and message', () => {
  const c = withCompatibility(one(SCRIPT_EXPOSED_FIELD,
    FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING,
    REASON.EXPOSED_FIELD_IN_SCRIPT_INTERFACE)).compatibility;
  for (const banned of ['severity', 'warning', 'error', 'colour', 'color', 'message',
    'saveBlocking', 'visible', 'visibility', 'ordering', 'suppression', 'toast',
    'recommendation', 'importance']) {
    assert.equal(c[banned], undefined, `${banned} must not be on a compatibility record`);
  }
  for (const banned of [/severity/i, /saveBlocking/i, /suppress/i, /\bcolou?r\b/i, /toast/i]) {
    assert.ok(!banned.test(CODE), `compatibility.js code names ${banned}`);
  }
});

test('no runtime detection -- the profile is evidence, not a browser sniff', () => {
  for (const banned of [/getName/, /userAgent/i, /navigator/i, /ActiveX/i,
    /process\.platform/, /\bdetect[A-Z]/]) {
    assert.ok(!banned.test(CODE), `compatibility.js code names ${banned}`);
  }
});

test('browser-safe -- no filesystem, and no research tree is ever read', () => {
  const required = [...CODE.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(required.sort(), ['./scope-graph', './semantic-findings']);
  for (const banned of [/require\('node:/, /\bfs\./, /zlib/, /child_process/,
    /crypto/, /https?:\/\//, /__dirname/, /readFile/]) {
    assert.ok(!banned.test(CODE), `compatibility.js code uses ${banned}`);
  }
  // An evidence path is a KEY. Nothing resolves it, and no host path appears.
  assert.ok(!/\/home\//.test(SOURCE), 'no host-absolute path may be recorded');
  assert.ok(!/~\/Projects/.test(SOURCE));
});

test('the lane stays consumer-free -- nothing is published on the vrml facade', () => {
  // P1, P2A, P2B, P2C and D each landed internal first. E1 does the same: the
  // facade surface is unchanged, so no production code path can have started
  // depending on a profile name in this lane.
  const vrml = require('../../src/vrml');
  assert.equal(vrml.compatibility, undefined);
  const facade = codeOnly(fs.readFileSync(path.join(__dirname, '../../src/vrml/index.js'), 'utf8'));
  for (const banned of [/blaxxun/i, /glview/i, /legacy-vrml/i, /cybertown-compat/i]) {
    assert.ok(!banned.test(facade), `index.js code names ${banned}`);
  }
});

test('the finding constructor stays the single authority', () => {
  // `attachCompatibility` is the ONLY new way to obtain a finding, and it has no
  // parameter through which a strict field could be supplied.
  assert.equal(semanticFindings.attachCompatibility.length, 2);
  const sfCode = codeOnly(fs.readFileSync(
    path.join(__dirname, '../../src/vrml/semantic-findings.js'), 'utf8'));
  assert.equal((sfCode.match(/function createFinding\(/g) || []).length, 1);
  assert.equal((sfCode.match(/return Object\.freeze\(\{\n\s*\/\*\* `FINDING_CODE/g) || []).length, 0);
  // And it does not know what a profile is.
  for (const banned of [/blaxxun/i, /glview/i, /extra-standard/i, /tolerated-violation/i]) {
    assert.ok(!banned.test(sfCode), `semantic-findings.js code names ${banned}`);
  }
});

test('attachCompatibility hands back the input when there is nothing to attach', () => {
  const f = one(IS_IN_DECLARATION, FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING,
    REASON.IS_IN_INTERFACE_DECLARATION_LIST);
  assert.equal(semanticFindings.attachCompatibility(f, null), f);
  assert.equal(semanticFindings.attachCompatibility(f, undefined), f);
});

test('WD1.6-D is untouched -- findingsForDocument still evaluates nothing', () => {
  for (const text of [SCRIPT_EXPOSED_FIELD, IS_IN_DECLARATION,
    'DEF A Group {} USE B\n', 'Shape { geometry Box {} }\n']) {
    for (const f of findings(text)) {
      assert.equal(f.compatibility, null,
        'the substrate must keep answering NOT EVALUATED until a consumer asks');
    }
  }
});

test('the lane adds no runtime dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['x_ite']);
});

test('every new source file is covered by the npm run check syntax gate', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  for (const f of ['src/vrml/compatibility.js', 'test/vrml/compatibility.test.js',
    'test/vrml/compatibility-mutations.test.js',
    'test/proto-enrichment/compatibility-null.test.js']) {
    assert.ok(pkg.scripts.check.includes(`node --check ${f}`), `${f} must be in the syntax gate`);
  }
});
