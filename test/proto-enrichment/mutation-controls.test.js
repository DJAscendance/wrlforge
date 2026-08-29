'use strict';
// WD1.7-D -- live mutation controls.
//
// A gate that has never been observed to fail is a comment. Each control takes
// the REAL production source, applies one targeted defect, loads the result as a
// module, and proves the defect changes the answer in exactly the way the
// corresponding production test forbids.
//
// Two properties make this evidence rather than decoration, and both are
// inherited from WD1.7-C's harness deliberately:
//
//   * The mutation is applied to the CURRENT file, and every substitution must
//     match EXACTLY ONCE. A mutation that silently stops applying -- because the
//     line it targets was reworded -- fails loudly instead of passing vacuously.
//   * Mutants are written to the OS temp directory and never touch the
//     repository. Relative requires are rewritten to absolute paths so the
//     mutant composes with the real, unmutated rest of the tree.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parse, interfaceQuery, containment, protoAgreement } = require('../../src/vrml');
const D = require('../../src/proto-enrichment');
const { H, scenario, cleanupArchives } = require('./fixtures');

const ROOT = path.join(__dirname, '..', '..');
const mutantDirs = [];

test.after(() => {
  cleanupArchives();
  for (const d of mutantDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function loadMutant(relFile, edits) {
  const abs = path.join(ROOT, relFile);
  const dir = path.dirname(abs);
  let src = fs.readFileSync(abs, 'utf8');
  for (const [from, to] of edits) {
    const hits = src.split(from).length - 1;
    assert.equal(hits, 1, `mutation anchor must match exactly once in ${relFile}: ${JSON.stringify(from.slice(0, 70))}`);
    src = src.replace(from, to);
  }
  src = src.replace(/require\('(\.[^']*)'\)/g, (_m, rel) =>
    `require(${JSON.stringify(path.resolve(dir, rel))})`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-wd17d-mutant-'));
  mutantDirs.push(tmp);
  const file = path.join(tmp, `${path.basename(relFile, '.js')}.mutant.js`);
  fs.writeFileSync(file, src, 'utf8');
  return require(file);
}

// A local/target pair, ready for either the real comparator or a mutant one.
function pair(localInterface, targetInterface, body = 'Group {}') {
  const lp = parse(`${H}EXTERNPROTO X [${localInterface}] "lib.wrl#X"\n`);
  const tp = parse(`${H}PROTO X [${targetInterface}] { ${body} }\n`);
  return {
    localGraph: interfaceQuery.buildScopeGraph(lp),
    localDecl: lp.tree.statements.find((s) => s.type === 'ExternProto'),
    targetGraph: interfaceQuery.buildScopeGraph(tp),
    targetDecl: tp.tree.statements.find((s) => s.type === 'Proto'),
  };
}
const run = (mod, p) =>
  mod.compareInterfaceAgreement(p.localGraph, p.localDecl, p.targetGraph, p.targetDecl);
const codes = (r) => r.findings.map((f) => f.code).sort();

const { AGREEMENT_STATUS, MEMBER_STATUS, AGREEMENT_FINDING, AGREEMENT_BASIS } = protoAgreement;
const AGREEMENT = 'src/vrml/proto-agreement.js';

// --- M1: reverse the ISO 4.9.2 subset direction -----------------------------

test('M1 -- rejecting an extra TARGET member inverts ISO 4.9.2', () => {
  const p = pair('field SFInt32 a', 'field SFInt32 a 0 field SFString extra ""');
  const real = run(protoAgreement, p);
  assert.equal(real.status, AGREEMENT_STATUS.SATISFIED);
  assert.equal(real.targetOnlyMemberCount, 1);

  const mutant = loadMutant(AGREEMENT, [[
    'const anyViolated = members.some((m) => m.status === MEMBER_STATUS.VIOLATED);',
    'const anyViolated = targetOnly > 0 || members.some((m) => m.status === MEMBER_STATUS.VIOLATED);',
  ]]);
  const got = run(mutant, p);
  assert.equal(got.status, AGREEMENT_STATUS.VIOLATED, 'the mutant must exhibit the defect');
  assert.notEqual(got.status, real.status, 'and the production suite asserts the opposite');
});

// --- M2: a missing local member reported as satisfied ------------------------

test('M2 -- accepting a member the target does not declare hides a 4.9.2 error', () => {
  const p = pair('field SFInt32 a field SFInt32 b', 'field SFInt32 a 0');
  const real = run(protoAgreement, p);
  assert.equal(real.status, AGREEMENT_STATUS.VIOLATED);
  assert.deepEqual(codes(real), [AGREEMENT_FINDING.MEMBER_MISSING]);

  const mutant = loadMutant(AGREEMENT, [[
    `      findings.push(finding);
      members.push(createMember({
        ...base,
        status: MEMBER_STATUS.VIOLATED,
        reason: AGREEMENT_REASON.MEMBER_VIOLATES_ISO_4_9_2,
        findings: [finding],
      }));
      return;`,
    `      members.push(createMember({ ...base, status: MEMBER_STATUS.SATISFIED, reason: AGREEMENT_REASON.OK }));
      return;`,
  ]]);
  const got = run(mutant, p);
  assert.equal(got.status, AGREEMENT_STATUS.SATISFIED, 'the mutant must exhibit the defect');
  assert.deepEqual(got.findings, []);
});

// --- M3: a declared field-type mismatch ignored ------------------------------

test('M3 -- ignoring a declared type difference hides the other 4.9.2 error', () => {
  const p = pair('field SFInt32 a', 'field SFString a ""');
  const real = run(protoAgreement, p);
  assert.equal(real.status, AGREEMENT_STATUS.VIOLATED);
  assert.deepEqual(codes(real), [AGREEMENT_FINDING.TYPE_MISMATCH]);

  const mutant = loadMutant(AGREEMENT, [[
    'if (lm.fieldType !== tm.fieldType) {',
    'if (false && lm.fieldType !== tm.fieldType) {',
  ]]);
  const got = run(mutant, p);
  assert.equal(got.status, AGREEMENT_STATUS.SATISFIED, 'the mutant must exhibit the defect');
  assert.deepEqual(codes(got), []);
});

// --- M4: an access difference promoted to a normative violation --------------

test('M4 -- promoting an access difference to an ISO violation invents U7', () => {
  const p = pair('field SFInt32 a', 'exposedField SFInt32 a 0');
  const real = run(protoAgreement, p);
  assert.equal(real.status, AGREEMENT_STATUS.SATISFIED);
  assert.equal(real.findings[0].basis, AGREEMENT_BASIS.NOT_SPECIFIED_BY_ISO_4_9_2);

  const mutant = loadMutant(AGREEMENT, [[
    `        code: AGREEMENT_FINDING.ACCESS_DIFFERS,
        basis: AGREEMENT_BASIS.NOT_SPECIFIED_BY_ISO_4_9_2,`,
    `        code: AGREEMENT_FINDING.ACCESS_DIFFERS,
        basis: AGREEMENT_BASIS.ISO_4_9_2,`,
  ]]);
  const got = run(mutant, p);
  assert.equal(got.status, AGREEMENT_STATUS.VIOLATED, 'the mutant must exhibit the defect');
  assert.notEqual(got.status, real.status,
    'ISO 4.9.2 names names and types only -- the production suite asserts SATISFIED');
});

// --- M5: alias-expanded bindings compared instead of declarations ------------

test('M5 -- demanding set_/_changed as target DECLARATIONS confuses 4.7 with 4.9.2', () => {
  const p = pair('exposedField SFVec3f position', 'exposedField SFVec3f position 0 0 0');
  const real = run(protoAgreement, p);
  assert.equal(real.status, AGREEMENT_STATUS.SATISFIED);
  assert.equal(real.members.length, 1, 'one DECLARATION, one comparison');

  const mutant = loadMutant(AGREEMENT, [[
    '  localIface.members.forEach((lm, index) => {',
    `  localIface.members.flatMap((m) => (m.access === 'exposedField'
    ? [m, { ...m, name: \`set_\${m.name}\` }, { ...m, name: \`\${m.name}_changed\` }]
    : [m])).forEach((lm, index) => {`,
  ]]);
  const got = run(mutant, p);
  assert.equal(got.status, AGREEMENT_STATUS.VIOLATED, 'the mutant must exhibit the defect');
  assert.equal(got.members.length, 3);
  assert.deepEqual(got.findings.map((f) => f.name).sort(), ['position_changed', 'set_position']);
});

// --- M6: an ambiguous target member resolved by taking the first -------------

test('M6 -- letting the first duplicate target member win is candidate ranking', () => {
  const p = pair('field SFInt32 a', 'field SFInt32 a 0 field SFString a ""');
  const real = run(protoAgreement, p);
  assert.equal(real.status, AGREEMENT_STATUS.WITHHELD);
  assert.equal(real.members[0].status, MEMBER_STATUS.WITHHELD);
  assert.equal(real.members[0].targetDeclaration, null);

  const mutant = loadMutant(AGREEMENT, [[
    `    const targetCount = targetCounts.get(lm.name) || 0;
    if (targetCount > 1) {
      withhold(AGREEMENT_REASON.TARGET_MEMBER_AMBIGUOUS);
      return;
    }`,
    '    const targetCount = targetCounts.get(lm.name) || 0;',
  ]]);
  const got = run(mutant, p);
  assert.equal(got.status, AGREEMENT_STATUS.SATISFIED, 'the mutant must exhibit the defect');
  assert.ok(got.members[0].targetDeclaration, 'it silently picked one of two');
});

// --- M7: a SECOND first-body-node rule --------------------------------------

test('M7 -- moving the 4.8.3 first-body-node rule moves BOTH answers together', () => {
  // The point of this control is not merely that the class changes. It is that
  // ONE edit changes the occurrence-side verdict (`childLegality`, WD1.6-C) and
  // the declaration-side verdict (`protoImplementationClass`, consumed by D) in
  // the SAME way. If D had built a second derivation, only one would move.
  const src = `${H}PROTO Thing [] { Transform {} Shape {} }\nGroup { children [ Thing {} ] }\n`;
  const p = parse(src);
  const graph = interfaceQuery.buildScopeGraph(p);
  const decl = p.tree.statements.find((s) => s.type === 'Proto');
  const group = p.tree.statements.find((s) => s.type === 'Node');
  const child = group.fields[0].value.items[0];

  const realClass = containment.protoImplementationClass(graph, decl);
  const realChild = containment.childLegality(graph, group, 'children', child);
  assert.equal(realClass.nodeType, 'Transform');
  assert.equal(realChild.candidate.nodeType, 'Transform');

  const mutant = loadMutant('src/vrml/containment.js', [[
    `    if (statement.type === NODE.NODE || statement.type === NODE.USE) return statement;
  }
  return null;`,
    `    if (statement.type === NODE.NODE || statement.type === NODE.USE) last = statement;
  }
  return last;`,
  ], [
    'function firstBodyNode(protoAstNode) {',
    'function firstBodyNode(protoAstNode) {\n  let last = null;',
  ]]);
  // A fresh parse for the mutant: a scope graph is bound to its own parse by
  // object identity, and handing one module another's is the WD1.4 mixup.
  const mp = parse(src);
  const mgraph = interfaceQuery.buildScopeGraph(mp);
  const mdecl = mp.tree.statements.find((s) => s.type === 'Proto');
  const mgroup = mp.tree.statements.find((s) => s.type === 'Node');
  const mchild = mgroup.fields[0].value.items[0];

  const mutClass = mutant.protoImplementationClass(mgraph, mdecl);
  const mutChild = mutant.childLegality(mgraph, mgroup, 'children', mchild);
  assert.equal(mutClass.nodeType, 'Shape', 'the mutant must exhibit the defect');
  assert.equal(mutChild.candidate.nodeType, 'Shape', 'and it must move the OTHER entry point too');
  assert.notEqual(mutClass.nodeType, realClass.nodeType);
});

// --- M8: external evidence mutating a strict-local result -------------------

test('M8 -- letting external evidence overwrite the strict answer is caught', () => {
  const files = {
    'lib.wrl': `${H}PROTO Thing [] { Transform {} }\n`,
    'main.wrl': `${H}EXTERNPROTO Thing [] "lib.wrl"\nThing {}\n`,
  };
  const s = scenario(files, 'main.wrl');
  const args = {
    graph: s.graph, declaration: s.declaration, resolution: s.resolution,
    dependencyGraph: s.dependencyGraph,
  };
  const real = D.enrichExternalPrototype(args);
  assert.equal(real.strictLocal.implementationClass.status, D.EXTERNAL_CLASS_STATUS.UNSUPPORTED);
  assert.equal(real.strictLocal.implementationClass.nodeType, 'Thing');

  const mutant = loadMutant('src/proto-enrichment/external-enrichment.js', [[
    `  return enrichment({
    status: ENRICHMENT_STATUS.ENRICHED,
    reason: ENRICHMENT_REASON.OK,
    declarationName,
    strictLocal,`,
    `  return enrichment({
    status: ENRICHMENT_STATUS.ENRICHED,
    reason: ENRICHMENT_REASON.OK,
    declarationName,
    strictLocal: Object.freeze({ implementationClass: external.implementationClass }),`,
  ]]);
  const got = mutant.enrichExternalPrototype(args);
  assert.equal(got.strictLocal.implementationClass.status, D.EXTERNAL_CLASS_STATUS.PROVEN,
    'the mutant must exhibit the defect');
  assert.equal(got.strictLocal.implementationClass.nodeType, 'Transform');
  assert.notEqual(got.strictLocal.implementationClass.status,
    real.strictLocal.implementationClass.status,
    'the production suite asserts the strict answer is unchanged by evidence');
});

test('M8b -- the WD1.6 queries themselves cannot be reached from external evidence', () => {
  // The structural half of M8: even a caller who WANTS to enrich a strict query
  // has no argument through which to do it. `childLegality` and
  // `protoImplementationClass` take a graph and AST nodes -- there is no
  // evidence, context or resolver parameter to pass.
  assert.equal(containment.childLegality.length, 4);
  assert.equal(containment.protoImplementationClass.length, 2);
  const src = `${H}EXTERNPROTO Thing [] "lib.wrl"\nGroup { children [ Thing {} ] }\n`;
  const p = parse(src);
  const graph = interfaceQuery.buildScopeGraph(p);
  const group = p.tree.statements.find((s) => s.type === 'Node');
  const child = group.fields[0].value.items[0];
  const before = containment.childLegality(graph, group, 'children', child);
  // Run a full enrichment over the SAME declaration, then re-ask.
  const s = scenario({
    'lib.wrl': `${H}PROTO Thing [] { Transform {} }\n`,
    'main.wrl': src,
  }, 'main.wrl');
  D.enrichExternalPrototype({
    graph: s.graph, declaration: s.declaration, resolution: s.resolution,
    dependencyGraph: s.dependencyGraph,
  });
  const after = containment.childLegality(graph, group, 'children', child);
  assert.equal(after.status, before.status);
  assert.equal(after.reason, before.reason);
  assert.equal(after.status, containment.CONTAINMENT_STATUS.UNSUPPORTED);
  assert.equal(after.reason, containment.CONTAINMENT_REASON.EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE);
});
