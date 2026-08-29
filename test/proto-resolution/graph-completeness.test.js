'use strict';
// WD1.7-C -- the `graph.complete` contract, and the two ways an edge can be
// MISSING rather than merely unwalked.
//
// QA finding F-WD17C-01: a dependency written only inside a PROTO interface
// DEFAULT value sits outside WD1.5-P2A's indexing boundary, so C cannot see it.
// C does not go and look -- a private lookup there is the second type authority
// this lane exists to refuse -- so the correction is to stop claiming the walk
// was exhaustive. Owner adjudication: C may not knowingly return a false
// `complete: true`.
//
// Every assertion below therefore comes in a pair: NO INVENTED EDGE, and NO
// FALSE COMPLETENESS. Either one alone is the wrong fix.

const test = require('node:test');
const assert = require('node:assert/strict');

const { parse } = require('../../src/vrml');
const {
  buildExternalDependencyGraph, INCOMPLETENESS_REASON, TRAVERSAL_STATUS, RESOLUTION_STATUS,
} = require('../../src/proto-resolution');
const { H, makeArchive, cleanupArchives, library } = require('./fixture-archive');

test.after(cleanupArchives);

function graphOf(files, rootPath, opts = {}) {
  const { context } = makeArchive(files, opts.sources);
  const p = parse(files[rootPath]);
  return buildExternalDependencyGraph(p, {
    context,
    baseDocument: { sourceId: opts.sourceId || 'archive', path: rootPath },
    ...(opts.root ? { root: opts.root(p) } : {}),
    ...(opts.maxDepth === undefined ? {} : { maxDepth: opts.maxDepth }),
  });
}

const reasons = (g) => g.incompleteness.map((i) => i.reason);
const only = (g, reason) => g.incompleteness.filter((i) => i.reason === reason);
const wrapper = (protoName, depType, depUrl) =>
  `${H}PROTO ${protoName} [] {\n  EXTERNPROTO ${depType} [] "${depUrl}"\n  Group { children [ ${depType} {} ] }\n}\n`;
const consumer = (typeName, url) => `${H}EXTERNPROTO ${typeName} [] "${url}"\n${typeName} {}\n`;

// --- the QA reproduction, verbatim ------------------------------------------

const QA_FIXTURE = `${H}
EXTERNPROTO DefaultDep [] "dep.wrl"

PROTO Wrapper [
  field SFNode thing DefaultDep {}
] {
  Group {}
}

Wrapper {}
`;

test('F-WD17C-01 -- an interface-default dependency is not invented, and completeness is withheld', () => {
  const g = graphOf({ 'main.wrl': QA_FIXTURE, 'dep.wrl': library('Dep') }, 'main.wrl');

  // 1. C invents no edge. `DefaultDep` is never instantiated anywhere P2A can
  //    see, so no dependency is manufactured for it by a private name lookup.
  assert.deepEqual(g.edges.map((e) => e.declarationName), [],
    'no dependency edge may be invented for an unindexed occurrence');
  assert.equal(g.nodes.length, 1, 'nothing was retrieved for it either');

  // 2. And C stops claiming the walk was exhaustive. This is the correction.
  assert.equal(g.complete, false);
  assert.deepEqual(reasons(g), [INCOMPLETENESS_REASON.UNINDEXED_INTERFACE_DEFAULT]);

  // 3. With enough structured evidence to explain WHY, and where.
  const [record] = g.incompleteness;
  assert.equal(record.at, g.root, 'the graph node whose region raised it');
  assert.equal(record.evidence.gap, 'unindexed-interface-default');
  assert.equal(record.evidence.prototypeName, 'Wrapper');
  assert.equal(record.evidence.memberAccess, 'field');
  assert.equal(record.evidence.memberFieldType, 'SFNode');
  assert.equal(record.evidence.memberName, 'thing');
  assert.equal(record.evidence.writtenTypeName, 'DefaultDep');
  assert.equal(record.evidence.occurrenceCount, 1);
  assert.deepEqual(record.evidence.via, ['Wrapper']);
  assert.ok(record.evidence.defaultRange.start.offset < record.evidence.defaultRange.end.offset);
  assert.ok(Object.isFrozen(record) && Object.isFrozen(record.evidence));
});

test('an MFNode interface default withholds completeness the same way', () => {
  const src = `${H}EXTERNPROTO A [] "a.wrl"\n`
    + 'PROTO Wrapper [\n  field MFNode things [ A {} , Group {} ]\n] { Group {} }\n'
    + 'Wrapper {}\n';
  const g = graphOf({ 'main.wrl': src, 'a.wrl': library('A') }, 'main.wrl');
  assert.deepEqual(g.edges, [], 'no manual type resolution is performed for the region');
  assert.equal(g.complete, false);
  assert.deepEqual(reasons(g), [INCOMPLETENESS_REASON.UNINDEXED_INTERFACE_DEFAULT]);
  assert.equal(g.incompleteness[0].evidence.occurrenceCount, 2);
});

test('a built-in-only node default still withholds -- C has no binding for that position', () => {
  const src = `${H}PROTO Wrapper [\n  field SFNode thing Group {}\n] { Group {} }\nWrapper {}\n`;
  const g = graphOf({ 'main.wrl': src }, 'main.wrl');
  assert.deepEqual(g.edges, [], 'and no external dependency is invented for a built-in either');
  assert.equal(g.complete, false, 'false incompleteness is preferable to false completeness');
  assert.equal(g.incompleteness[0].evidence.writtenTypeName, 'Group');
});

test('PRIMITIVE interface defaults leave a graph complete', () => {
  const src = `${H}PROTO P [\n  field SFFloat amount 1\n  field SFString label "hello"\n`
    + '  exposedField SFBool on TRUE\n] { Group {} }\nP {}\n';
  const g = graphOf({ 'main.wrl': src }, 'main.wrl');
  assert.equal(g.complete, true, 'having an interface default is not itself a gap');
  assert.deepEqual(g.incompleteness, []);
});

// --- reachability: the gate follows the dependency walk's own boundary -------

test('an UNREACHED prototype’s interface default does not poison this traversal', () => {
  const src = `${H}EXTERNPROTO Dep [] "d.wrl"\n`
    + 'PROTO Used [] { Group {} }\n'
    + 'PROTO Unused [\n  field SFNode thing Dep {}\n] { Group {} }\n'
    + 'Used {}\n';
  const g = graphOf({ 'main.wrl': src, 'd.wrl': library('D') }, 'main.wrl');
  assert.equal(g.complete, true);
  assert.deepEqual(g.incompleteness, []);
});

test('a REACHED local prototype’s interface default DOES withhold completeness', () => {
  const src = `${H}EXTERNPROTO Dep [] "d.wrl"\n`
    + 'PROTO Helper [\n  field SFNode thing Dep {}\n] { Group {} }\n'
    + 'PROTO Outer [] { Helper {} }\n'
    + 'Outer {}\n';
  const g = graphOf({ 'main.wrl': src, 'd.wrl': library('D') }, 'main.wrl');
  assert.equal(g.complete, false);
  assert.equal(g.incompleteness[0].evidence.prototypeName, 'Helper');
  assert.deepEqual(g.incompleteness[0].evidence.via, ['Outer', 'Helper']);
});

test('a gap inside a RETRIEVED target is attributed to that target’s graph node', () => {
  const files = {
    'main.wrl': consumer('Lib', 'lib.wrl'),
    'lib.wrl': `${H}PROTO Lib [\n  field SFNode thing Group {}\n] { Group {} }\n`,
  };
  const g = graphOf(files, 'main.wrl');
  assert.equal(g.edges[0].traversal, TRAVERSAL_STATUS.EXPANDED, 'the target itself still resolves');
  assert.equal(g.complete, false);
  const [record] = g.incompleteness;
  assert.equal(record.reason, INCOMPLETENESS_REASON.UNINDEXED_INTERFACE_DEFAULT);
  assert.equal(record.at, g.edges[0].to, 'attributed to the target, not to the root');
  assert.equal(record.evidence.prototypeName, 'Lib');
});

// --- the second false-completeness case: a withheld type binding -------------

test('a DUPLICATE declaration withholds completeness -- one of them could be an EXTERNPROTO', () => {
  const src = `${H}EXTERNPROTO Dup [] "a.wrl"\nEXTERNPROTO Dup [] "b.wrl"\nDup {}\n`;
  const g = graphOf({ 'main.wrl': src, 'a.wrl': library('A'), 'b.wrl': library('B') }, 'main.wrl');
  assert.deepEqual(g.edges, [], 'P2A bound nothing, so C binds nothing');
  assert.equal(g.complete, false);
  const [record] = only(g, INCOMPLETENESS_REASON.TYPE_BINDING_WITHHELD);
  assert.equal(record.evidence.writtenTypeName, 'Dup');
  assert.equal(record.evidence.occurrences, 1);
  assert.equal(record.evidence.resolutionStatus, 'ambiguous');
});

test('a vendor node type P2A proved undeclared leaves the graph COMPLETE', () => {
  // The common corpus shape. P2A proved the chain and found zero declarations of
  // the name, so nothing is hiding and the enumeration really is exhaustive.
  const src = `${H}EXTERNPROTO Dep [] "d.wrl"\nGroup { children [ Dep {} , SomeVendorNode {} ] }\n`;
  const g = graphOf({ 'main.wrl': src, 'd.wrl': library('D') }, 'main.wrl');
  assert.equal(g.edges[0].traversal, TRAVERSAL_STATUS.EXPANDED);
  assert.equal(g.complete, true);
});

test('repeated withheld occurrences of one name report once, with a count', () => {
  const src = `${H}EXTERNPROTO Dup [] "a.wrl"\nEXTERNPROTO Dup [] "b.wrl"\n`
    + 'Group { children [ Dup {} , Dup {} , Dup {} ] }\n';
  const g = graphOf({ 'main.wrl': src, 'a.wrl': library('A'), 'b.wrl': library('B') }, 'main.wrl');
  const records = only(g, INCOMPLETENESS_REASON.TYPE_BINDING_WITHHELD);
  assert.equal(records.length, 1);
  assert.equal(records[0].evidence.occurrences, 3);
});

// --- §21 completeness regression matrix -------------------------------------

test('MATRIX -- a fully resolved graph is COMPLETE', () => {
  const files = {
    'main.wrl': consumer('A', 'a.wrl'),
    'a.wrl': wrapper('A', 'ToB', 'b.wrl'),
    'b.wrl': library('B'),
  };
  const g = graphOf(files, 'main.wrl');
  assert.equal(g.complete, true);
  assert.deepEqual(g.incompleteness, []);
  assert.deepEqual(g.nodes.map((n) => n.depth), [0, 1, 2]);
});

test('MATRIX -- CONTEXT_REQUIRED is INCOMPLETE, with the declaration named', () => {
  const files = { 'lib/outer.wrl': wrapper('Outer', 'Dep', 'dep.wrl'), 'lib/dep.wrl': library('LibDep') };
  const g = graphOf(files, 'lib/outer.wrl', {
    root: (p) => p.tree.statements.find((s) => s.type === 'Proto'),
  });
  assert.equal(g.complete, false);
  assert.deepEqual(reasons(g), [INCOMPLETENESS_REASON.CONTEXT_REQUIRED]);
  assert.equal(g.incompleteness[0].evidence.declarationName, 'Dep');
  assert.equal(g.incompleteness[0].evidence.declaringPrototypeName, 'Outer');
});

test('MATRIX -- DEPTH_LIMIT_EXCEEDED is INCOMPLETE, with the bound recorded', () => {
  const files = {
    'main.wrl': consumer('A', 'a.wrl'),
    'a.wrl': wrapper('A', 'ToB', 'b.wrl'),
    'b.wrl': library('B'),
  };
  const g = graphOf(files, 'main.wrl', { maxDepth: 1 });
  assert.equal(g.complete, false);
  assert.deepEqual(reasons(g), [INCOMPLETENESS_REASON.DEPTH_LIMIT_EXCEEDED]);
  assert.equal(g.incompleteness[0].evidence.maxDepth, 1);
  assert.equal(g.incompleteness[0].evidence.depth, 2);
});

test('MATRIX -- a CYCLE is a complete answer and stays COMPLETE', () => {
  const g = graphOf({ 'main.wrl': consumer('A', 'a.wrl'), 'a.wrl': wrapper('A', 'Self', 'a.wrl') }, 'main.wrl');
  assert.equal(g.cycles.length, 1);
  assert.equal(g.complete, true);
  assert.deepEqual(g.incompleteness, []);
});

test('MATRIX -- a definitively NOT_RESOLVED edge stays COMPLETE: it was enumerated, not omitted', () => {
  const g = graphOf({ 'main.wrl': consumer('T', 'gone.wrl') }, 'main.wrl');
  assert.equal(g.edges[0].traversal, TRAVERSAL_STATUS.NOT_RESOLVED);
  assert.equal(g.edges[0].resolution.status, RESOLUTION_STATUS.NOT_ATTEMPTED);
  assert.equal(g.complete, true);
  assert.deepEqual(g.incompleteness, []);
});

test('MATRIX -- several conditions accumulate; every one is recorded', () => {
  const src = `${H}EXTERNPROTO Dup [] "a.wrl"\nEXTERNPROTO Dup [] "b.wrl"\n`
    + 'PROTO Wrapper [\n  field SFNode thing Group {}\n] { Group { children [ Dup {} ] } }\n'
    + 'Wrapper {}\n';
  const g = graphOf({ 'main.wrl': src, 'a.wrl': library('A'), 'b.wrl': library('B') }, 'main.wrl');
  assert.equal(g.complete, false);
  assert.deepEqual(reasons(g).sort(), [
    INCOMPLETENESS_REASON.TYPE_BINDING_WITHHELD,
    INCOMPLETENESS_REASON.UNINDEXED_INTERFACE_DEFAULT,
  ]);
});

// --- shape ------------------------------------------------------------------

test('`complete` is exactly the emptiness of `incompleteness`, and both are frozen', () => {
  const src = `${H}PROTO Wrapper [\n  field SFNode thing Group {}\n] { Group {} }\nWrapper {}\n`;
  const g = graphOf({ 'main.wrl': src }, 'main.wrl');
  assert.equal(g.complete, g.incompleteness.length === 0);
  assert.ok(Object.isFrozen(g.incompleteness));
  assert.ok(g.incompleteness.every((i) => Object.isFrozen(i)));
  // Derived evidence only -- ranges and names, never a hidden persistent id.
  for (const i of g.incompleteness) {
    assert.deepEqual(Object.keys(i).sort(), ['at', 'evidence', 'reason']);
    assert.ok(!('id' in i.evidence) && !('nodeId' in i.evidence) && !('sessionId' in i.evidence));
  }
});
