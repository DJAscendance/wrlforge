'use strict';
// WD1.7-D (pure) -- ISO 4.9.2 interface agreement.
//
// The properties under test, in order of how much damage getting them wrong
// would do:
//
//   1. THE DIRECTION. `local ⊆ target`. A target superset is CONFORMING.
//   2. DECLARATIONS, NOT ALIASES. An `exposedField zzz` is ONE member, never
//      three, and a conforming target is never asked to declare `set_zzz`.
//   3. ACCESS IS NOT AN ISO 4.9.2 RULE. A category difference is an observation
//      carrying `NOT_SPECIFIED_BY_ISO_4_9_2`, never a violation.
//   4. UNCERTAINTY IS NOT ABSENCE. A recovered or duplicated declaration
//      withholds; it never becomes `MEMBER_MISSING` and never becomes
//      `SATISFIED`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parse, interfaceQuery, protoAgreement } = require('../../src/vrml');

const {
  compareInterfaceAgreement, notAttempted,
  AGREEMENT_STATUS, MEMBER_STATUS, AGREEMENT_FINDING, AGREEMENT_BASIS, AGREEMENT_REASON,
} = protoAgreement;

const H = '#VRML V2.0 utf8\n';

function sideOf(src, type) {
  const p = parse(src);
  const graph = interfaceQuery.buildScopeGraph(p);
  const declaration = p.tree.statements.find((s) => s.type === type);
  return { p, graph, declaration };
}

/** `localInterface` and `targetInterface` are the bracketed declaration lists. */
function compare(localInterface, targetInterface, body = 'Group {}') {
  const local = sideOf(`${H}EXTERNPROTO X [${localInterface}] "lib.wrl#X"\n`, 'ExternProto');
  const target = sideOf(`${H}PROTO X [${targetInterface}] { ${body} }\n`, 'Proto');
  return {
    result: compareInterfaceAgreement(local.graph, local.declaration, target.graph, target.declaration),
    local,
    target,
  };
}

const codes = (r) => r.findings.map((f) => f.code);
const byName = (r, name) => r.members.find((m) => m.name === name);

// --- the direction ----------------------------------------------------------

test('an exact subset is satisfied', () => {
  const { result } = compare('field SFInt32 a', 'field SFInt32 a 0');
  assert.equal(result.status, AGREEMENT_STATUS.SATISFIED);
  assert.equal(result.reason, AGREEMENT_REASON.OK);
  assert.deepEqual(codes(result), []);
  assert.equal(result.members.length, 1);
  assert.equal(byName(result, 'a').status, MEMBER_STATUS.SATISFIED);
});

test('an EMPTY local interface is vacuously satisfied -- the empty set is a subset', () => {
  const { result } = compare('', 'field SFInt32 a 0');
  assert.equal(result.status, AGREEMENT_STATUS.SATISFIED);
  assert.deepEqual(result.members, []);
  assert.equal(result.targetOnlyMemberCount, 1);
});

test('a target SUPERSET is conforming -- the extra member is not a finding', () => {
  const { result } = compare('field SFInt32 a', 'field SFInt32 a 0 field SFString extra ""');
  assert.equal(result.status, AGREEMENT_STATUS.SATISFIED);
  assert.deepEqual(codes(result), [], 'ISO 4.9.2 makes local ⊆ target the CONFORMING shape');
  assert.equal(result.targetOnlyMemberCount, 1);
  assert.equal(result.local.declaredMemberCount, 1);
  assert.equal(result.target.declaredMemberCount, 2);
});

test('a member the target does not declare is a 4.9.2 violation', () => {
  const { result } = compare('field SFInt32 a field SFInt32 b', 'field SFInt32 a 0');
  assert.equal(result.status, AGREEMENT_STATUS.VIOLATED);
  assert.equal(result.reason, AGREEMENT_REASON.MEMBER_VIOLATES_ISO_4_9_2);
  assert.deepEqual(codes(result), [AGREEMENT_FINDING.MEMBER_MISSING]);
  assert.equal(result.findings[0].name, 'b');
  assert.equal(result.findings[0].basis, AGREEMENT_BASIS.ISO_4_9_2);
  assert.equal(byName(result, 'a').status, MEMBER_STATUS.SATISFIED);
  assert.equal(byName(result, 'b').status, MEMBER_STATUS.VIOLATED);
  assert.equal(byName(result, 'b').targetDeclaration, null);
});

test('a matching name with a different declared type is a 4.9.2 violation', () => {
  const { result } = compare('field SFInt32 a', 'field SFString a ""');
  assert.equal(result.status, AGREEMENT_STATUS.VIOLATED);
  assert.deepEqual(codes(result), [AGREEMENT_FINDING.TYPE_MISMATCH]);
  const f = result.findings[0];
  assert.equal(f.localType, 'SFInt32');
  assert.equal(f.targetType, 'SFString');
  assert.equal(f.basis, AGREEMENT_BASIS.ISO_4_9_2);
});

test('type comparison is EXACT token equality -- no SF<->MF relationship', () => {
  const { result } = compare('field MFInt32 a', 'field SFInt32 a 0');
  assert.deepEqual(codes(result), [AGREEMENT_FINDING.TYPE_MISMATCH]);
});

test('every problem is preserved -- comparison does not stop at the first', () => {
  const { result } = compare(
    'field SFInt32 a field SFInt32 gone exposedField SFString c',
    'field SFString a "" field SFString c ""',
  );
  assert.equal(result.status, AGREEMENT_STATUS.VIOLATED);
  assert.deepEqual(codes(result).sort(), [
    AGREEMENT_FINDING.ACCESS_DIFFERS, AGREEMENT_FINDING.MEMBER_MISSING, AGREEMENT_FINDING.TYPE_MISMATCH,
  ].sort());
  assert.equal(result.members.length, 3);
});

test('declaration ORDER does not decide agreement', () => {
  const a = compare('field SFInt32 a field SFString b', 'field SFInt32 a 0 field SFString b ""');
  const b = compare('field SFString b field SFInt32 a', 'field SFString b "" field SFInt32 a 0');
  const c = compare('field SFInt32 a field SFString b', 'field SFString b "" field SFInt32 a 0');
  for (const r of [a, b, c]) assert.equal(r.result.status, AGREEMENT_STATUS.SATISFIED);
  // Source order is still RECORDED -- it is evidence, it is just not a rule.
  assert.deepEqual(a.result.members.map((m) => [m.name, m.sourceOrder]), [['a', 0], ['b', 1]]);
  assert.deepEqual(b.result.members.map((m) => [m.name, m.sourceOrder]), [['b', 0], ['a', 1]]);
});

// --- declarations, not alias-expanded bindings ------------------------------

test('an exposedField is ONE declared member, not three (ISO 4.7 is not 4.9.2)', () => {
  const { result } = compare('exposedField SFVec3f position', 'exposedField SFVec3f position 0 0 0');
  assert.equal(result.status, AGREEMENT_STATUS.SATISFIED);
  assert.equal(result.members.length, 1, 'exactly one declared-member comparison');
  assert.deepEqual(result.members.map((m) => m.name), ['position']);
  for (const alias of ['set_position', 'position_changed']) {
    assert.equal(byName(result, alias), undefined, `${alias} is a WRITTEN NAME, not a declaration`);
    assert.ok(!codes(result).length, `${alias} must not be demanded of the target`);
  }
});

test('the comparator never asks the target to declare an alias as a member', () => {
  // The target declares ONLY the base name. A comparator that expanded aliases
  // would report `set_position` and `position_changed` missing.
  const { result } = compare(
    'exposedField SFVec3f position exposedField SFRotation rotation',
    'exposedField SFVec3f position 0 0 0 exposedField SFRotation rotation 0 0 1 0',
  );
  assert.equal(result.status, AGREEMENT_STATUS.SATISFIED);
  assert.deepEqual(codes(result), []);
  assert.equal(result.members.length, 2);
});

test('a local `field` against a target `exposedField` of the same name is NOT missing', () => {
  const { result } = compare('field SFInt32 a', 'exposedField SFInt32 a 0');
  assert.ok(!codes(result).includes(AGREEMENT_FINDING.MEMBER_MISSING));
  assert.equal(byName(result, 'a').status, MEMBER_STATUS.SATISFIED);
});

// --- access categories (WD1.7-A U7) -----------------------------------------

test('an access-only difference satisfies 4.9.2 and is its own observation', () => {
  const { result } = compare('field SFInt32 a', 'exposedField SFInt32 a 0');
  assert.equal(result.status, AGREEMENT_STATUS.SATISFIED, '4.9.2 names names and types only');
  assert.deepEqual(codes(result), [AGREEMENT_FINDING.ACCESS_DIFFERS]);
  const f = result.findings[0];
  assert.equal(f.basis, AGREEMENT_BASIS.NOT_SPECIFIED_BY_ISO_4_9_2);
  assert.equal(f.localAccess, 'field');
  assert.equal(f.targetAccess, 'exposedField');
});

test('the access observation is SYMMETRIC -- neither ordering is the conforming one', () => {
  const forward = compare('field SFInt32 a', 'exposedField SFInt32 a 0').result;
  const reverse = compare('exposedField SFInt32 a', 'field SFInt32 a 0').result;
  assert.equal(forward.status, AGREEMENT_STATUS.SATISFIED);
  assert.equal(reverse.status, AGREEMENT_STATUS.SATISFIED);
  assert.deepEqual(codes(forward), [AGREEMENT_FINDING.ACCESS_DIFFERS]);
  assert.deepEqual(codes(reverse), [AGREEMENT_FINDING.ACCESS_DIFFERS]);
  assert.equal(reverse.findings[0].localAccess, 'exposedField');
  assert.equal(reverse.findings[0].targetAccess, 'field');
});

test('eventIn vs field and eventOut vs exposedField are observations, not verdicts', () => {
  for (const [l, t] of [['eventIn SFInt32 a', 'field SFInt32 a 0'],
    ['eventOut SFInt32 a', 'exposedField SFInt32 a 0'],
    ['eventIn SFInt32 a', 'eventOut SFInt32 a']]) {
    const { result } = compare(l, t);
    assert.equal(result.status, AGREEMENT_STATUS.SATISFIED, `${l} / ${t}`);
    assert.deepEqual(codes(result), [AGREEMENT_FINDING.ACCESS_DIFFERS], `${l} / ${t}`);
    assert.equal(result.findings[0].basis, AGREEMENT_BASIS.NOT_SPECIFIED_BY_ISO_4_9_2);
  }
});

test('an access difference is reported ALONGSIDE a type mismatch, not instead of it', () => {
  const { result } = compare('field SFInt32 a', 'exposedField SFString a ""');
  assert.equal(result.status, AGREEMENT_STATUS.VIOLATED, 'the TYPE decides the status');
  assert.deepEqual(codes(result).sort(),
    [AGREEMENT_FINDING.ACCESS_DIFFERS, AGREEMENT_FINDING.TYPE_MISMATCH].sort());
});

test('no finding is ever labelled conforming, illegal or compatible', () => {
  const { result } = compare('field SFInt32 a', 'exposedField SFString a ""');
  for (const f of result.findings) {
    assert.deepEqual(Object.keys(f).sort(), [
      'basis', 'code', 'localAccess', 'localType', 'name', 'targetAccess', 'targetType',
    ]);
    assert.ok([AGREEMENT_BASIS.ISO_4_9_2, AGREEMENT_BASIS.NOT_SPECIFIED_BY_ISO_4_9_2].includes(f.basis));
  }
});

// --- uncertainty is not absence ---------------------------------------------

test('a DUPLICATE target member withholds -- it never becomes MEMBER_MISSING', () => {
  const { result } = compare('field SFInt32 a', 'field SFInt32 a 0 field SFString a ""');
  assert.equal(result.status, AGREEMENT_STATUS.WITHHELD);
  assert.equal(result.reason, AGREEMENT_REASON.MEMBER_WITHHELD);
  assert.deepEqual(codes(result), [], 'no finding may be manufactured from ambiguity');
  const m = byName(result, 'a');
  assert.equal(m.status, MEMBER_STATUS.WITHHELD);
  assert.equal(m.reason, AGREEMENT_REASON.TARGET_MEMBER_AMBIGUOUS);
  assert.equal(m.targetDeclaration, null, 'neither duplicate may be picked');
});

test('a duplicate LOCAL member withholds too -- there is no single obligation', () => {
  const { result } = compare('field SFInt32 a field SFString a', 'field SFInt32 a 0');
  assert.equal(result.status, AGREEMENT_STATUS.WITHHELD);
  for (const m of result.members) {
    assert.equal(m.status, MEMBER_STATUS.WITHHELD);
    assert.equal(m.reason, AGREEMENT_REASON.LOCAL_MEMBER_AMBIGUOUS);
  }
});

test('a RECOVERED target interface withholds -- absence is not proven', () => {
  const local = sideOf(`${H}EXTERNPROTO X [ field SFInt32 a ] "lib.wrl"\n`, 'ExternProto');
  const target = sideOf(`${H}PROTO X [ field SFInt32 ] { Group {} }\n`, 'Proto');
  const r = compareInterfaceAgreement(local.graph, local.declaration, target.graph, target.declaration);
  assert.equal(r.status, AGREEMENT_STATUS.WITHHELD);
  assert.equal(r.reason, AGREEMENT_REASON.TARGET_INTERFACE_NOT_PROVABLE);
  assert.deepEqual(r.findings, [], 'a damaged target must not produce MEMBER_MISSING');
  assert.equal(r.target.provable, false);
  assert.ok(r.target.provableReason);
});

test('a RECOVERED local interface withholds the positive answer too', () => {
  const local = sideOf(`${H}EXTERNPROTO X [ field SFInt32 ] "lib.wrl"\n`, 'ExternProto');
  const target = sideOf(`${H}PROTO X [ field SFInt32 a 0 ] { Group {} }\n`, 'Proto');
  const r = compareInterfaceAgreement(local.graph, local.declaration, target.graph, target.declaration);
  assert.equal(r.status, AGREEMENT_STATUS.WITHHELD);
  assert.equal(r.reason, AGREEMENT_REASON.LOCAL_INTERFACE_NOT_PROVABLE);
  assert.equal(r.local.provable, false);
  assert.deepEqual(r.members, []);
});

test('a field-type token outside Annex A.2 withholds on whichever side carries it', () => {
  const a = compare('field SFWeird a', 'field SFInt32 a 0').result;
  assert.equal(a.status, AGREEMENT_STATUS.WITHHELD);
  assert.equal(byName(a, 'a').reason, AGREEMENT_REASON.LOCAL_MEMBER_NOT_PROVABLE);

  const b = compare('field SFInt32 a', 'field SFWeird a 0').result;
  assert.equal(b.status, AGREEMENT_STATUS.WITHHELD);
  assert.equal(byName(b, 'a').reason, AGREEMENT_REASON.TARGET_MEMBER_NOT_PROVABLE);
  assert.deepEqual(codes(b), [], 'an unknown token is not a type mismatch');
});

test('a PROVEN violation stands beside a withheld member; SATISFIED does not', () => {
  const { result } = compare(
    'field SFInt32 gone field SFWeird unknowable',
    'field SFInt32 other 0',
  );
  assert.equal(result.status, AGREEMENT_STATUS.VIOLATED,
    'a proven violation is not unproven by another member\'s uncertainty');
  assert.equal(byName(result, 'gone').status, MEMBER_STATUS.VIOLATED);
  assert.equal(byName(result, 'unknowable').status, MEMBER_STATUS.WITHHELD);
});

test('names are compared EXACTLY -- no case folding and no fuzzy match', () => {
  const { result } = compare('field SFInt32 Alpha', 'field SFInt32 alpha 0');
  assert.equal(result.status, AGREEMENT_STATUS.VIOLATED);
  assert.deepEqual(codes(result), [AGREEMENT_FINDING.MEMBER_MISSING]);
});

// --- ill-formed questions ---------------------------------------------------

test('a non-EXTERNPROTO local side is INVALID, not a verdict', () => {
  const local = sideOf(`${H}PROTO X [] { Group {} }\n`, 'Proto');
  const target = sideOf(`${H}PROTO X [] { Group {} }\n`, 'Proto');
  const r = compareInterfaceAgreement(local.graph, local.declaration, target.graph, target.declaration);
  assert.equal(r.status, AGREEMENT_STATUS.INVALID);
  assert.equal(r.reason, AGREEMENT_REASON.LOCAL_NOT_AN_EXTERNPROTO);
});

test('a non-PROTO target side is INVALID -- 4.9.2 compares against a DEFINITION', () => {
  const local = sideOf(`${H}EXTERNPROTO X [] "l.wrl"\n`, 'ExternProto');
  const target = sideOf(`${H}EXTERNPROTO X [] "l.wrl"\n`, 'ExternProto');
  const r = compareInterfaceAgreement(local.graph, local.declaration, target.graph, target.declaration);
  assert.equal(r.status, AGREEMENT_STATUS.INVALID);
  assert.equal(r.reason, AGREEMENT_REASON.TARGET_NOT_A_PROTO);
});

test('a declaration from ANOTHER parse is INVALID -- never answered from the wrong tree', () => {
  const a = sideOf(`${H}EXTERNPROTO X [ field SFInt32 a ] "l.wrl"\n`, 'ExternProto');
  const b = sideOf(`${H}EXTERNPROTO X [ field SFInt32 a ] "l.wrl"\n`, 'ExternProto');
  const target = sideOf(`${H}PROTO X [ field SFInt32 a 0 ] { Group {} }\n`, 'Proto');
  // Byte-identical source, DIFFERENT parse. Identity, not text, decides.
  const r = compareInterfaceAgreement(a.graph, b.declaration, target.graph, target.declaration);
  assert.equal(r.status, AGREEMENT_STATUS.INVALID);
});

test('a non-graph argument throws rather than degrading into a verdict', () => {
  const local = sideOf(`${H}EXTERNPROTO X [] "l.wrl"\n`, 'ExternProto');
  assert.throws(() => compareInterfaceAgreement({}, local.declaration, {}, local.declaration),
    (e) => e.code === 'ESCOPEGRAPH');
});

test('notAttempted is a record, not an answer', () => {
  const local = sideOf(`${H}EXTERNPROTO X [ field SFInt32 a ] "l.wrl"\n`, 'ExternProto');
  const r = notAttempted(local.declaration);
  assert.equal(r.status, AGREEMENT_STATUS.NOT_ATTEMPTED);
  assert.equal(r.reason, AGREEMENT_REASON.NO_PROVEN_TARGET);
  assert.deepEqual(r.members, []);
  assert.deepEqual(r.findings, []);
  assert.equal(r.target, null);
  assert.equal(r.local.declaration, local.declaration);
});

// --- shape, lifetime and boundary -------------------------------------------

test('every owned record is frozen; the AST handles are the parser\'s own', () => {
  const { result, local, target } = compare('field SFInt32 a', 'field SFInt32 a 0');
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.members) && Object.isFrozen(result.findings));
  for (const m of result.members) assert.ok(Object.isFrozen(m) && Object.isFrozen(m.findings));
  assert.equal(result.local.declaration, local.declaration);
  assert.equal(result.target.declaration, target.declaration);
  const m = byName(result, 'a');
  assert.equal(m.localDeclaration, local.declaration.interfaces[0]);
  assert.equal(m.targetDeclaration, target.declaration.interfaces[0]);
  assert.ok(!Object.isFrozen(m.localDeclaration), 'an AST node belongs to its parse, not to us');
});

test('nothing survives a reparse -- there is no persistent identity here', () => {
  const src = `${H}EXTERNPROTO X [ field SFInt32 a ] "l.wrl"\n`;
  const one = sideOf(src, 'ExternProto');
  const two = sideOf(src, 'ExternProto');
  assert.notEqual(one.declaration, two.declaration);
  const target = sideOf(`${H}PROTO X [ field SFInt32 a 0 ] { Group {} }\n`, 'Proto');
  const r = compareInterfaceAgreement(one.graph, one.declaration, target.graph, target.declaration);
  assert.equal(r.members[0].localDeclaration, one.declaration.interfaces[0]);
  assert.notEqual(r.members[0].localDeclaration, two.declaration.interfaces[0]);
});

test('NO PRESENTATION POLICY: no severity, message, colour or visibility', () => {
  const { result } = compare('field SFInt32 a field SFString b', 'exposedField SFInt32 a 0');
  const seen = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    for (const k of Object.keys(v)) {
      assert.ok(!['severity', 'message', 'level', 'colour', 'color', 'visible', 'icon', 'blocking'].includes(k),
        `a finding must not carry presentation policy (found ${k})`);
      walk(v[k]);
    }
  };
  // The AST handles are the parser's and are excluded -- they are the document.
  walk({ status: result.status, reason: result.reason, findings: result.findings });
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'vrml', 'proto-agreement.js'), 'utf8');
  for (const forbidden of ['severity', 'toDiagnostic', 'makeDiagnostic']) {
    assert.ok(!src.replace(/^\s*\/\/.*$/gm, '').includes(forbidden), `source must not contain ${forbidden}`);
  }
});

test('NO COMPATIBILITY PROFILE is named -- that is WD1.7-E, and it is blocked', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'vrml', 'proto-agreement.js'), 'utf8');
  for (const forbidden of ['blaxxun', 'Blaxxun', 'GLView', 'cybertown', 'Cybertown', 'legacy-vrml']) {
    assert.ok(!src.includes(forbidden), `source must not name ${forbidden}`);
  }
  assert.deepEqual(Object.keys(AGREEMENT_BASIS).sort(), ['ISO_4_9_2', 'NOT_SPECIFIED_BY_ISO_4_9_2']);
});

test('PURE AND BROWSER-SAFE: no capability, no retrieval, no orchestration', () => {
  const file = path.join(__dirname, '..', '..', 'src', 'vrml', 'proto-agreement.js');
  const code = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const cap of ['fs', 'node:fs', 'zlib', 'crypto', 'http', 'https', 'net', 'child_process', 'electron', 'os', 'path']) {
    assert.ok(!code.includes(`require('${cap}')`), `must not require ${cap}`);
  }
  for (const forbidden of ['proto-resolution', 'proto-enrichment', 'external-proto']) {
    assert.ok(!code.includes(forbidden), `must not reach ${forbidden}`);
  }
  // Its ONLY member source is the declaration authority; the alias index is not
  // imported, so distinction 1 cannot be violated by a future edit.
  assert.ok(code.includes('membersOf'));
  assert.ok(!code.includes('writtenNamesFor'), 'the alias authority must stay out of 4.9.2');
  assert.ok(!code.includes('effectiveInterfaceOf'), 'declarations, not effective bindings');
});

test('no second field-type table -- Annex A.2 is asked, not re-derived', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'vrml', 'proto-agreement.js'), 'utf8');
  for (const forbidden of ['SFVec3f\', \'', 'new Set([', 'MFTime']) {
    assert.ok(!code.includes(forbidden), `must not carry its own type set (found ${forbidden})`);
  }
  assert.ok(code.includes('isFieldTypeToken'));
});

test('the status tables are disjoint and INVALID is the scope graph\'s own value', () => {
  assert.equal(AGREEMENT_STATUS.INVALID, interfaceQuery.STATUS.INVALID);
  assert.deepEqual(Object.keys(AGREEMENT_STATUS).sort(),
    ['INVALID', 'NOT_ATTEMPTED', 'SATISFIED', 'VIOLATED', 'WITHHELD']);
  assert.deepEqual(Object.keys(AGREEMENT_FINDING).sort(),
    ['ACCESS_DIFFERS', 'MEMBER_MISSING', 'TYPE_MISMATCH']);
  for (const forbidden of ['ERROR', 'WARNING', 'OK', 'CONFORMING', 'ILLEGAL', 'COMPATIBLE']) {
    assert.ok(!(forbidden in AGREEMENT_STATUS), `${forbidden} is not an agreement status`);
    assert.ok(!(forbidden in AGREEMENT_FINDING), `${forbidden} is not a finding code`);
  }
});
