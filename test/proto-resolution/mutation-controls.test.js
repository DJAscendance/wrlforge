'use strict';
// WD1.7-C -- live mutation controls.
//
// A gate that has never been observed to fail is a comment. Each control below
// takes the REAL production source, applies one targeted defect, loads the
// result as a module, and proves the defect changes the answer in the exact way
// the corresponding production test forbids.
//
// Two properties make this evidence rather than decoration:
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

const { parse, protoTarget } = require('../../src/vrml');
const { makeArchive, cleanupArchives, library, H } = require('./fixture-archive');

const ROOT = path.join(__dirname, '..', '..');
const mutantDirs = [];

test.after(() => {
  cleanupArchives();
  for (const d of mutantDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/**
 * Load a one-defect copy of `relFile`. `edits` is a list of `[from, to]` string
 * substitutions, each of which MUST match exactly once.
 */
function loadMutant(relFile, edits) {
  const abs = path.join(ROOT, relFile);
  const dir = path.dirname(abs);
  let src = fs.readFileSync(abs, 'utf8');
  for (const [from, to] of edits) {
    const hits = src.split(from).length - 1;
    assert.equal(hits, 1, `mutation anchor must match exactly once in ${relFile}: ${JSON.stringify(from.slice(0, 60))}`);
    src = src.replace(from, to);
  }
  // Re-point every relative require at the real tree, so only the mutated module
  // itself differs from production.
  src = src.replace(/require\('(\.[^']*)'\)/g, (_m, rel) =>
    `require(${JSON.stringify(path.resolve(dir, rel))})`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-mutant-'));
  mutantDirs.push(tmp);
  const file = path.join(tmp, `${path.basename(relFile, '.js')}.mutant.js`);
  fs.writeFileSync(file, src, 'utf8');
  return require(file);
}

const wrapper = (protoName, depType, depUrl) =>
  `${H}PROTO ${protoName} [] {\n  EXTERNPROTO ${depType} [] "${depUrl}"\n  Group { children [ ${depType} {} ] }\n}\n`;
const consumer = (typeName, url) => `${H}EXTERNPROTO ${typeName} [] "${url}"\n${typeName} {}\n`;

function graphWith(mutantGraphModule, files, rootPath) {
  const { context } = makeArchive(files);
  const p = parse(files[rootPath]);
  return mutantGraphModule.buildExternalDependencyGraph(p, {
    context, baseDocument: { sourceId: 'archive', path: rootPath },
  });
}
const edgeFor = (g, name) => g.edges.find((e) => e.declarationName === name);
const nodeOf = (g, id) => g.nodes.find((n) => n.id === id);

// --- M1: include EXTERNPROTO in fragment-less target selection --------------

test('M1 -- including EXTERNPROTOs in N8 selection binds the wrong prototype', () => {
  const src = `${H}EXTERNPROTO VendorThing [] "vendor.wrl"\nPROTO ActualTarget [] { Group {} }\n`;
  assert.equal(protoTarget.selectPrototypeTarget(parse(src)).selectedProtoName, 'ActualTarget');

  const mutant = loadMutant('src/vrml/proto-target.js', [[
    "const topLevel = (tree.statements || []).filter((s) => s && s.type === NODE.PROTO);",
    "const topLevel = (tree.statements || []).filter((s) => s && (s.type === NODE.PROTO || s.type === NODE.EXTERNPROTO));",
  ]]);
  const got = mutant.selectPrototypeTarget(parse(src));
  assert.equal(got.selectedProtoName, 'VendorThing', 'the mutant must exhibit the defect');
  assert.notEqual(got.selectedProtoName, 'ActualTarget', 'and the production suite asserts the opposite');
});

// --- M2: first fragment-name match wins despite a duplicate -----------------

test('M2 -- taking the first duplicate resolves an ambiguous fragment confidently', () => {
  const src = `${H}PROTO Dup [] { Group {} }\nPROTO Dup [] { Shape {} }\n`;
  assert.equal(protoTarget.selectPrototypeTarget(parse(src), { fragment: 'Dup' }).status, 'TARGET_PROTO_AMBIGUOUS');

  const mutant = loadMutant('src/vrml/proto-target.js', [[
    '    if (matches.length > 1) {',
    '    if (false) {',
  ]]);
  const got = mutant.selectPrototypeTarget(parse(src), { fragment: 'Dup' });
  assert.equal(got.status, 'RESOLVED', 'the mutant must exhibit the defect');
  assert.equal(got.selectedProtoName, 'Dup');
});

// --- M3: stop the candidate walk on RETRIEVED instead of RESOLVED -----------

test('M3 -- stopping on RETRIEVED skips a later candidate that would have resolved', () => {
  const files = {
    'main.wrl': `${H}EXTERNPROTO T [] [ "a.wrl", "b.wrl" ]\nT {}\n`,
    'a.wrl': `${H}Group { children [ Shape {} ] }\n`,   // retrievable, but supplies no PROTO
    'b.wrl': library('B'),
  };
  const { context } = makeArchive(files);
  const p = parse(files['main.wrl']);
  const declaration = p.tree.statements.find((s) => s.type === 'ExternProto');
  const args = { context, baseDocument: { sourceId: 'archive', path: 'main.wrl' }, parseResult: p, declaration };

  const real = require('../../src/proto-resolution').resolveExternalPrototype(args);
  assert.equal(real.selectedCandidateIndex, 1);
  assert.equal(real.target.selectedProtoName, 'B');

  const mutant = loadMutant('src/proto-resolution/external-resolver.js', [[
    '    if (selected.status !== SELECTION_STATUS.RESOLVED) continue;',
    '    if (false) continue;',
  ]]);
  const got = mutant.resolveExternalPrototype(args);
  assert.equal(got.selectedCandidateIndex, 0, 'the mutant must stop at the merely-retrieved candidate');
  assert.equal(got.target.selectedProtoName, null, 'and hand back a target it never selected');
});

// --- M4: use decodedContentHash alone as the cycle key ----------------------

test('M4 -- a content-only cycle key reports same-file A -> B as a cycle', () => {
  const files = {
    'main.wrl': consumer('Alpha', 'lib.wrl#Alpha'),
    'lib.wrl': `${H}PROTO Alpha [] {\n  EXTERNPROTO ToBeta [] "lib.wrl#Beta"\n  Group { children [ ToBeta {} ] }\n}\n`
      + 'PROTO Beta [] { Group {} }\n',
  };
  const real = graphWith(require('../../src/proto-resolution'), files, 'main.wrl');
  assert.equal(real.cycles.length, 0);
  assert.equal(edgeFor(real, 'ToBeta').traversal, 'EXPANDED');

  const mutant = loadMutant('src/proto-resolution/dependency-graph.js', [[
    '  return `${decodedContentHash}${SEP}${selectedProtoName}`;',
    '  return `${decodedContentHash}`;',
  ]]);
  const got = graphWith(mutant, files, 'main.wrl');
  assert.equal(got.cycles.length, 1, 'the mutant must exhibit the false positive');
  assert.equal(edgeFor(got, 'ToBeta').traversal, 'DEPENDENCY_CYCLE');
});

// --- M5: a global visited-set instead of the active traversal stack ---------

test('M5 -- a global visited-set reports DAG reuse as a cycle', () => {
  const files = {
    'main.wrl': `${H}EXTERNPROTO X [] "shared.wrl"\nEXTERNPROTO Y [] "shared.wrl"\n`
      + 'Group { children [ X {} , Y {} ] }\n',
    'shared.wrl': library('Shared'),
  };
  const real = graphWith(require('../../src/proto-resolution'), files, 'main.wrl');
  assert.equal(real.cycles.length, 0);
  assert.equal(edgeFor(real, 'Y').traversal, 'REUSED');

  const mutant = loadMutant('src/proto-resolution/dependency-graph.js', [
    ['  const completed = new Map();       // memoKey -> node id',
      '  const completed = new Map(); const globalVisited = new Set();'],
    ['      if (frame.stack.includes(key)) {',
      '      if (globalVisited.has(key)) {'],
    ['      const childDocumentBase = frozenBase(target.base);',
      '      globalVisited.add(key);\n      const childDocumentBase = frozenBase(target.base);'],
  ]);
  const got = graphWith(mutant, files, 'main.wrl');
  assert.equal(got.cycles.length, 1, 'the mutant must exhibit the false positive');
  assert.equal(edgeFor(got, 'Y').traversal, 'DEPENDENCY_CYCLE');
});

// --- M6: force a nested dependency's base to the target artifact file -------

test('M6 -- basing a PROTO-body EXTERNPROTO on its declaring file picks the wrong artifact', () => {
  const files = {
    'worlds/main.wrl': consumer('Outer', '../lib/outer.wrl'),
    'lib/outer.wrl': wrapper('Outer', 'Dep', 'dep.wrl'),
    'worlds/dep.wrl': library('WorldsDep'),
    'lib/dep.wrl': library('LibDep'),
  };
  const real = graphWith(require('../../src/proto-resolution'), files, 'worlds/main.wrl');
  assert.equal(nodeOf(real, edgeFor(real, 'Dep').to).selectedProtoName, 'WorldsDep');

  const mutant = loadMutant('src/proto-resolution/dependency-graph.js', [[
    '      const base = ownedByFrameRoot ? frame.instantiationBase : frame.documentBase;',
    '      const base = frame.documentBase;',
  ]]);
  const got = graphWith(mutant, files, 'worlds/main.wrl');
  const target = nodeOf(got, edgeFor(got, 'Dep').to);
  assert.equal(target.selectedProtoName, 'LibDep', 'the mutant must exhibit the ISO 4.5.3 defect');
  assert.equal(target.artifactPath, 'lib/dep.wrl');
});

// --- M7: drop the interface-default completeness gate at the GRAPH -----------

test('M7 -- ignoring the reported coverage gap returns a false complete:true', () => {
  // The QA reproduction, verbatim. Production must refuse to call this graph
  // complete; a build that skips the withholding step returns exactly the false
  // answer the owner ruled out.
  const files = {
    'main.wrl': `${H}\nEXTERNPROTO DefaultDep [] "dep.wrl"\n\n`
      + 'PROTO Wrapper [\n  field SFNode thing DefaultDep {}\n] {\n  Group {}\n}\n\nWrapper {}\n',
    'dep.wrl': library('Dep'),
  };
  const real = graphWith(require('../../src/proto-resolution'), files, 'main.wrl');
  assert.equal(real.complete, false);
  assert.deepEqual(real.incompleteness.map((i) => i.reason), ['UNINDEXED_INTERFACE_DEFAULT']);

  const mutant = loadMutant('src/proto-resolution/dependency-graph.js', [[
    '    for (const gap of found.coverageGaps) {',
    '    for (const gap of []) {',
  ]]);
  const got = graphWith(mutant, files, 'main.wrl');
  assert.equal(got.complete, true, 'the mutant must exhibit the false completeness');
  assert.deepEqual(got.incompleteness, []);
  // And in BOTH, no edge is ever invented -- the defect is the claim, not the walk.
  assert.deepEqual(got.edges, []);
  assert.deepEqual(real.edges, []);
});

// --- M8: blind the PURE detector to the unindexed region --------------------

test('M8 -- a detector that reports no region leaves the graph with nothing to withhold on', () => {
  const src = `${H}EXTERNPROTO DefaultDep [] "dep.wrl"\n`
    + 'PROTO Wrapper [\n  field SFNode thing DefaultDep {}\n] { Group {} }\nWrapper {}\n';
  const p = parse(src);
  const graph = require('../../src/vrml').interfaceQuery.buildScopeGraph(p);
  assert.equal(protoTarget.prototypeDependencies(graph, p.tree).coverageGaps.length, 1);

  const mutant = loadMutant('src/vrml/proto-target.js', [[
    '    if (occurrences.length === 0) continue;',
    '    if (true) continue;',
  ]]);
  const got = mutant.prototypeDependencies(graph, p.tree);
  assert.deepEqual(got.coverageGaps, [], 'the mutant must exhibit the blind spot');
  // It also must not have replaced the gap with an invented dependency.
  assert.equal(got.references.filter((r) => r.typeName === 'DefaultDep').length, 0);
});

// --- M9: treat every withheld type binding as a complete answer -------------

test('M9 -- ignoring `declarationMayExist` hides a possibly-missing EXTERNPROTO edge', () => {
  const files = {
    'main.wrl': `${H}EXTERNPROTO Dup [] "a.wrl"\nEXTERNPROTO Dup [] "b.wrl"\nDup {}\n`,
    'a.wrl': library('A'),
    'b.wrl': library('B'),
  };
  const real = graphWith(require('../../src/proto-resolution'), files, 'main.wrl');
  assert.equal(real.complete, false);
  assert.deepEqual(real.incompleteness.map((i) => i.reason), ['TYPE_BINDING_WITHHELD']);

  const mutant = loadMutant('src/proto-resolution/dependency-graph.js', [[
    '      if (ref.kind !== protoTarget.DEPENDENCY_KIND.WITHHELD || !ref.declarationMayExist) continue;',
    '      continue;',
  ]]);
  const got = graphWith(mutant, files, 'main.wrl');
  assert.equal(got.complete, true, 'the mutant must exhibit the false completeness');
  assert.deepEqual(got.edges, [], 'and it still binds nothing -- it just stops saying so');
});

// --- the harness itself must be able to fail --------------------------------

test('a mutation anchor that no longer matches fails loudly', () => {
  assert.throws(
    () => loadMutant('src/vrml/proto-target.js', [['this string is not in the file', 'x']]),
    /mutation anchor must match exactly once/,
  );
});
