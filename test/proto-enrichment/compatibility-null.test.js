'use strict';
// WD1.7-E1 -- the WD1.7-D file-target gate.
//
// The highest-value regression in this lane, and the one most likely to rot.
//
// E0 opened blaxxun interactive's shipped authoring documentation and found one
// rule that speaks directly to external prototype interfaces: a built-in reached
// through the vendor's URN mechanism is instantiated with the NATIVE node's
// interface, and the locally declared EXTERNPROTO interface is not the one used.
//
// That rule covers a reference form WRL Forge deliberately never retrieves. It
// says nothing whatever about an EXTERNPROTO whose target is an ordinary `.wrl`
// file -- which is the only kind WD1.7-D ever produces a record for. So the one
// documented rule applies exactly and only where there is no finding to attach
// it to, and `MEMBER_MISSING`, `TYPE_MISMATCH` and `ACCESS_DIFFERS` against a
// file target stay `compatibility: null` -- NOT EVALUATED -- permanently on
// current evidence.
//
// The two ways that could quietly stop being true are the two things asserted
// here: the URN rule leaking sideways onto file targets, and corpus prevalence
// (5.56% access drift, 59 missing members) being read as acceptance. Neither is
// evidence. Only recorded execution of the named runtime would be, and that is a
// separate authorized lane that has not run.

const test = require('node:test');
const assert = require('node:assert/strict');

const D = require('../../src/proto-enrichment');
const compatibility = require('../../src/vrml/compatibility');
const { scenario, cleanupArchives, H } = require('./fixtures');

const {
  enrichExternalPrototype, createEnrichmentSession,
  AGREEMENT_STATUS, AGREEMENT_FINDING, AGREEMENT_BASIS,
} = D;

test.after(cleanupArchives);

const world = (iface, url, extra = '') =>
  `${H}EXTERNPROTO Thing [${iface}] "${url}"\n${extra}Thing {}\n`;

function enrich(files, rootPath, opts = {}) {
  const s = scenario(files, rootPath, opts);
  return enrichExternalPrototype({
    graph: s.graph,
    declaration: s.declaration,
    resolution: s.resolution,
    dependencyGraph: s.dependencyGraph,
    session: createEnrichmentSession(),
  });
}

/** One scenario per WD1.7-D finding kind, each against an ordinary file target. */
const CASES = {
  [AGREEMENT_FINDING.MEMBER_MISSING]: {
    target: 'field SFInt32 a 0',
    local: 'field SFInt32 a field SFFloat gone',
    basis: AGREEMENT_BASIS.ISO_4_9_2,
    status: AGREEMENT_STATUS.VIOLATED,
  },
  [AGREEMENT_FINDING.TYPE_MISMATCH]: {
    target: 'field SFString a ""',
    local: 'field SFInt32 a',
    basis: AGREEMENT_BASIS.ISO_4_9_2,
    status: AGREEMENT_STATUS.VIOLATED,
  },
  [AGREEMENT_FINDING.ACCESS_DIFFERS]: {
    target: 'exposedField SFInt32 a 0',
    local: 'field SFInt32 a',
    // ISO 4.9.2 names "names and types" and is SILENT on access categories, so
    // WD1.7-D reports the drift WITHOUT calling the agreement violated. E1 must
    // not turn that silence into a compatibility claim either -- U7 is
    // unspecified, not tolerated.
    basis: AGREEMENT_BASIS.NOT_SPECIFIED_BY_ISO_4_9_2,
    status: AGREEMENT_STATUS.SATISFIED,
  },
};

function resultFor(code) {
  const c = CASES[code];
  return enrich({
    'lib.wrl': `${H}PROTO Thing [ ${c.target} ] { Group {} }\n`,
    'main.wrl': world(c.local, 'lib.wrl'),
  }, 'main.wrl');
}

// ---------------------------------------------------------------------------
// Q3 -- the three file-target findings, one test each so a failure names itself
// ---------------------------------------------------------------------------

for (const code of Object.keys(CASES)) {
  test(`Q3 ${code} against a file target stays compatibility: null`, () => {
    const result = resultFor(code);
    const iface = result.external.interface;

    // The finding really is the one this case is named for -- otherwise the
    // null assertion below would be vacuously true about something else.
    const found = iface.findings.find((f) => f.code === code);
    assert.ok(found, `${code} must actually be produced by this scenario`);
    assert.equal(found.basis, CASES[code].basis, 'the strict basis is unchanged');
    assert.equal(iface.status, CASES[code].status, 'the strict status is unchanged');

    // And the enrichment record's reserved slot is still NOT EVALUATED.
    assert.equal(result.compatibility, null,
      `${code} must not be classified: no vendor documentation addresses file targets`);

    // A D finding is not even SHAPED like something the registry can key on --
    // it carries no `reason`, so the lookup cannot accidentally hit.
    assert.equal(compatibility.compatibilityFor(found), null);
    assert.equal(found.reason, undefined);
  });
}

test('Q3 a CONFORMING file target is equally unclassified', () => {
  // Guarding only the violations would let a later change classify the happy
  // path instead. `null` is the answer for every file target, not a penalty.
  const result = enrich({
    'lib.wrl': `${H}PROTO Thing [ field SFInt32 a 0 ] { Transform {} }\n`,
    'main.wrl': world('field SFInt32 a', 'lib.wrl'),
  }, 'main.wrl');
  assert.equal(result.external.interface.status, AGREEMENT_STATUS.SATISFIED);
  assert.equal(result.compatibility, null);
});

// ---------------------------------------------------------------------------
// The two failure modes, asserted directly rather than left to inference
// ---------------------------------------------------------------------------

test('the URN interface rule cannot reach a file-target finding', () => {
  // V1 is real, documented twice, and classified EXTRA_STANDARD -- and it is
  // about the vendor URN mechanism. The registry must hold it WITHOUT any route
  // from it to a WD1.7-D record.
  const urn = compatibility.behaviorEvidence(
    compatibility.VENDOR_BEHAVIOR.URN_NATIVE_NODE_INTERFACE_OVERRIDE);
  assert.ok(urn, 'the URN behaviour is registered');
  assert.equal(urn.classification, compatibility.COMPATIBILITY_CLASSIFICATION.EXTRA_STANDARD);

  assert.ok(compatibility.registryOnlyBehaviors().includes(
    compatibility.VENDOR_BEHAVIOR.URN_NATIVE_NODE_INTERFACE_OVERRIDE),
  'the URN behaviour has no finding consumer and must stay registry-only');

  for (const code of Object.keys(CASES)) {
    const iface = resultFor(code).external.interface;
    for (const f of iface.findings) {
      assert.equal(compatibility.compatibilityFor(f), null);
    }
  }
});

test('no WD1.7-D finding code appears in the compatibility mapping at all', () => {
  const mapped = Object.keys(compatibility.BEHAVIOR_BY_FINDING);
  for (const code of Object.values(AGREEMENT_FINDING)) {
    for (const k of mapped) {
      assert.ok(!k.includes(code), `${code} must not key a compatibility mapping`);
    }
  }
});

test('WD1.7-D still names no profile, and E1 did not change that', () => {
  // E1's module is the ONLY place a profile identifier lives. If D ever learns
  // one, the strict/compatibility layering has been merged by accident.
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../../src/proto-enrichment/external-enrichment.js'), 'utf8');
  for (const profile of compatibility.profiles()) {
    assert.ok(!src.includes(profile), `external-enrichment.js must not name ${profile}`);
  }
});
