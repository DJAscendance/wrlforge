'use strict';
// WD1.7-C -- ISO 4.5.3 base propagation, instantiation-driven traversal, and
// cycle detection on the ratified `(decodedContentHash, selectedProtoName)`
// tuple against the ACTIVE STACK.

const test = require('node:test');
const assert = require('node:assert/strict');

const { parse } = require('../../src/vrml');
const {
  buildExternalDependencyGraph, TRAVERSAL_STATUS, RESOLUTION_STATUS,
} = require('../../src/proto-resolution');
const { H, makeArchive, cleanupArchives, library } = require('./fixture-archive');

test.after(cleanupArchives);

// Build a graph over `files`, rooted at the document stored at `rootPath`.
function graphOf(files, rootPath, opts = {}) {
  const { context } = makeArchive(files, opts.sources);
  const p = parse(files[rootPath]);
  return buildExternalDependencyGraph(p, {
    context,
    baseDocument: { sourceId: opts.sourceId || 'archive', path: rootPath },
    ...(opts.maxDepth === undefined ? {} : { maxDepth: opts.maxDepth }),
  });
}

const edgeFor = (g, name) => g.edges.find((e) => e.declarationName === name);
const nodeOf = (g, id) => g.nodes.find((n) => n.id === id);

// A prototype library whose implementation instantiates ONE external dependency.
const wrapper = (protoName, depType, depUrl) =>
  `${H}PROTO ${protoName} [] {\n  EXTERNPROTO ${depType} [] "${depUrl}"\n  Group { children [ ${depType} {} ] }\n}\n`;

// A world that declares and instantiates one external prototype.
const consumer = (typeName, url, extra = '') =>
  `${H}EXTERNPROTO ${typeName} [] "${url}"\n${extra}${typeName} {}\n`;

// --- ISO 4.5.3 / N12 base propagation ---------------------------------------

test('a top-level EXTERNPROTO resolves against the DECLARING file (N12 case 3)', () => {
  const files = {
    'worlds/main.wrl': consumer('Lib', '../lib/thing.wrl'),
    'lib/thing.wrl': library('Thing'),
  };
  const g = graphOf(files, 'worlds/main.wrl');
  const e = edgeFor(g, 'Lib');
  assert.equal(e.traversal, TRAVERSAL_STATUS.EXPANDED);
  assert.deepEqual(e.baseDocument, { sourceId: 'archive', path: 'worlds/main.wrl' });
  assert.equal(nodeOf(g, e.to).artifactPath, 'lib/thing.wrl');
});

test('an EXTERNPROTO inside a PROTO body resolves against the INSTANTIATING file (N12 case 1)', () => {
  // The decisive fixture. `dep.wrl` exists in BOTH directories, so a resolver
  // that used "the artifact this frame came from" would silently pick
  // `lib/dep.wrl` -- the copy sitting beside the library it is written in.
  const files = {
    'worlds/main.wrl': consumer('Outer', '../lib/outer.wrl'),
    'lib/outer.wrl': wrapper('Outer', 'Dep', 'dep.wrl'),
    'worlds/dep.wrl': library('WorldsDep'),
    'lib/dep.wrl': library('LibDep'),
  };
  const g = graphOf(files, 'worlds/main.wrl');
  const e = edgeFor(g, 'Dep');
  assert.equal(e.traversal, TRAVERSAL_STATUS.EXPANDED);
  assert.equal(e.declaringPrototypeName, 'Outer');
  assert.deepEqual(e.baseDocument, { sourceId: 'archive', path: 'worlds/main.wrl' },
    'the base is the instantiating file, not the declaring one');
  const target = nodeOf(g, e.to);
  assert.equal(target.artifactPath, 'worlds/dep.wrl');
  assert.equal(target.selectedProtoName, 'WorldsDep');
  assert.notEqual(target.selectedProtoName, 'LibDep');
});

test('the SAME library under a DIFFERENT instantiation base resolves to a different dependency', () => {
  const files = {
    'worlds/main.wrl': consumer('Outer', '../lib/outer.wrl'),
    'other/main.wrl': consumer('Outer', '../lib/outer.wrl'),
    'lib/outer.wrl': wrapper('Outer', 'Dep', 'dep.wrl'),
    'worlds/dep.wrl': library('WorldsDep'),
    'other/dep.wrl': library('OtherDep'),
  };
  const { context } = makeArchive(files);
  const build = (rootPath) => buildExternalDependencyGraph(parse(files[rootPath]), {
    context, baseDocument: { sourceId: 'archive', path: rootPath },
  });
  const a = build('worlds/main.wrl');
  const b = build('other/main.wrl');
  assert.equal(nodeOf(a, edgeFor(a, 'Dep').to).selectedProtoName, 'WorldsDep');
  assert.equal(nodeOf(b, edgeFor(b, 'Dep').to).selectedProtoName, 'OtherDep');
});

test('a declaration nested in a LOCAL prototype uses this document, not the parent', () => {
  // `Wrapper` is declared AND instantiated inside `worlds/main.wrl`, so N12 case
  // (1)'s "file in which the prototype is instantiated" is this same file.
  const files = {
    'worlds/main.wrl': `${H}PROTO Wrapper [] {\n  EXTERNPROTO Dep [] "dep.wrl"\n  Group { children [ Dep {} ] }\n}\nWrapper {}\n`,
    'worlds/dep.wrl': library('WorldsDep'),
  };
  const g = graphOf(files, 'worlds/main.wrl');
  const e = edgeFor(g, 'Dep');
  assert.equal(e.traversal, TRAVERSAL_STATUS.EXPANDED);
  assert.deepEqual(e.baseDocument, { sourceId: 'archive', path: 'worlds/main.wrl' });
  assert.deepEqual(e.via, ['Wrapper']);
});

test('missing instantiation context is WITHHELD, never resolved against the declaring file', () => {
  const files = {
    'lib/outer.wrl': wrapper('Outer', 'Dep', 'dep.wrl'),
    'lib/dep.wrl': library('LibDep'),
  };
  const { context } = makeArchive(files);
  const p = parse(files['lib/outer.wrl']);
  const g = buildExternalDependencyGraph(p, {
    context,
    baseDocument: { sourceId: 'archive', path: 'lib/outer.wrl' },
    root: p.tree.statements.find((s) => s.type === 'Proto'),
    // instantiationBase deliberately NOT supplied.
  });
  const e = edgeFor(g, 'Dep');
  assert.equal(e.traversal, TRAVERSAL_STATUS.CONTEXT_REQUIRED);
  assert.equal(e.baseDocument, null);
  assert.equal(e.resolution, null, 'no retrieval is attempted without a provable base');
  assert.equal(g.complete, false);
});

test('supplying the instantiation context resolves what was withheld', () => {
  const files = {
    'worlds/main.wrl': consumer('Outer', '../lib/outer.wrl'),
    'lib/outer.wrl': wrapper('Outer', 'Dep', 'dep.wrl'),
    'worlds/dep.wrl': library('WorldsDep'),
    'lib/dep.wrl': library('LibDep'),
  };
  const { context } = makeArchive(files);
  const p = parse(files['lib/outer.wrl']);
  const g = buildExternalDependencyGraph(p, {
    context,
    baseDocument: { sourceId: 'archive', path: 'lib/outer.wrl' },
    root: p.tree.statements.find((s) => s.type === 'Proto'),
    instantiationBase: { sourceId: 'archive', path: 'worlds/main.wrl' },
  });
  const e = edgeFor(g, 'Dep');
  assert.equal(e.traversal, TRAVERSAL_STATUS.EXPANDED);
  assert.equal(nodeOf(g, e.to).selectedProtoName, 'WorldsDep');
});

test('a URL-root-relative reference uses the base source’s namespace', () => {
  const files = {
    'worlds/main.wrl': consumer('Lib', '/lib/thing.wrl'),
    'lib/thing.wrl': library('Thing'),
  };
  const g = graphOf(files, 'worlds/main.wrl', { sources: [{ id: 'archive', prefix: 'http://h/' }] });
  assert.equal(edgeFor(g, 'Lib').traversal, TRAVERSAL_STATUS.EXPANDED);
  assert.equal(nodeOf(g, edgeFor(g, 'Lib').to).artifactPath, 'lib/thing.wrl');
});

test('an absolute http reference routes through an explicit mapping, and fails closed without one', () => {
  const files = {
    'worlds/main.wrl': consumer('Lib', 'http://h/lib/thing.wrl'),
    'lib/thing.wrl': library('Thing'),
  };
  const mapped = graphOf(files, 'worlds/main.wrl', { sources: [{ id: 'archive', prefix: 'http://h/' }] });
  assert.equal(edgeFor(mapped, 'Lib').traversal, TRAVERSAL_STATUS.EXPANDED);

  const unmapped = graphOf(files, 'worlds/main.wrl');
  const e = edgeFor(unmapped, 'Lib');
  assert.equal(e.traversal, TRAVERSAL_STATUS.NOT_RESOLVED);
  assert.equal(e.resolution.candidates[0].retrieval.status, 'NOT_RETRIEVED_BY_POLICY');
});

// --- cycles -----------------------------------------------------------------

test('a self-referencing chain is a cycle', () => {
  const files = {
    'main.wrl': consumer('A', 'a.wrl'),
    'a.wrl': wrapper('A', 'Self', 'a.wrl'),
  };
  const g = graphOf(files, 'main.wrl');
  assert.equal(g.cycles.length, 1);
  assert.equal(edgeFor(g, 'Self').traversal, TRAVERSAL_STATUS.DEPENDENCY_CYCLE);
  assert.equal(edgeFor(g, 'Self').resolution.status, RESOLUTION_STATUS.RESOLVED,
    'the target is still proven; only the descent stops');
});

test('a two-file mutual chain is a cycle', () => {
  const files = {
    'main.wrl': consumer('A', 'a.wrl'),
    'a.wrl': wrapper('A', 'ToB', 'b.wrl'),
    'b.wrl': wrapper('B', 'ToA', 'a.wrl'),
  };
  const g = graphOf(files, 'main.wrl');
  assert.equal(g.cycles.length, 1);
  assert.equal(edgeFor(g, 'ToB').traversal, TRAVERSAL_STATUS.EXPANDED);
  assert.equal(edgeFor(g, 'ToA').traversal, TRAVERSAL_STATUS.DEPENDENCY_CYCLE);
  assert.equal(g.cycles[0].chain.length, 3);
});

test('SAME DOCUMENT, DIFFERENT PROTO is NOT a cycle', () => {
  // WD1.7-A §10.1: one library routinely declares several prototypes, and this
  // is exactly what `#name` exists to serve. A content-hash-only key rejects it.
  const files = {
    'main.wrl': consumer('Alpha', 'lib.wrl#Alpha'),
    'lib.wrl': `${H}PROTO Alpha [] {\n  EXTERNPROTO ToBeta [] "lib.wrl#Beta"\n  Group { children [ ToBeta {} ] }\n}\n`
      + 'PROTO Beta [] { Group {} }\n',
  };
  const g = graphOf(files, 'main.wrl');
  assert.equal(g.cycles.length, 0);
  assert.equal(edgeFor(g, 'ToBeta').traversal, TRAVERSAL_STATUS.EXPANDED);
  const alpha = g.nodes.find((n) => n.selectedProtoName === 'Alpha');
  const beta = g.nodes.find((n) => n.selectedProtoName === 'Beta');
  assert.ok(alpha && beta);
  assert.equal(alpha.decodedContentHash, beta.decodedContentHash, 'one artifact, two prototypes');
  assert.notEqual(alpha.cycleKey, beta.cycleKey, 'the tuple must separate them');
});

test('SAME DOCUMENT, mutual PROTO reference IS a cycle', () => {
  const files = {
    'main.wrl': consumer('Alpha', 'lib.wrl#Alpha'),
    'lib.wrl': `${H}PROTO Alpha [] {\n  EXTERNPROTO ToBeta [] "lib.wrl#Beta"\n  Group { children [ ToBeta {} ] }\n}\n`
      + 'PROTO Beta [] {\n  EXTERNPROTO ToAlpha [] "lib.wrl#Alpha"\n  Group { children [ ToAlpha {} ] }\n}\n',
  };
  const g = graphOf(files, 'main.wrl');
  assert.equal(g.cycles.length, 1);
  assert.equal(edgeFor(g, 'ToBeta').traversal, TRAVERSAL_STATUS.EXPANDED);
  assert.equal(edgeFor(g, 'ToAlpha').traversal, TRAVERSAL_STATUS.DEPENDENCY_CYCLE);
});

test('a shared dependency reached twice is DAG reuse, not a cycle', () => {
  const files = {
    'main.wrl': `${H}EXTERNPROTO X [] "shared.wrl"\nEXTERNPROTO Y [] "shared.wrl"\n`
      + 'Group { children [ X {} , Y {} ] }\n',
    'shared.wrl': library('Shared'),
  };
  const g = graphOf(files, 'main.wrl');
  assert.equal(g.cycles.length, 0);
  assert.equal(edgeFor(g, 'X').traversal, TRAVERSAL_STATUS.EXPANDED);
  assert.equal(edgeFor(g, 'Y').traversal, TRAVERSAL_STATUS.REUSED);
  assert.equal(edgeFor(g, 'Y').to, edgeFor(g, 'X').to, 'reuse points at the SAME node');
  assert.equal(g.nodes.length, 2, 'the shared target is one node, not two');
});

test('a diamond through two wrappers is not a cycle, and each keeps its own context', () => {
  const files = {
    'main.wrl': `${H}EXTERNPROTO A [] "a.wrl"\nEXTERNPROTO B [] "b.wrl"\nGroup { children [ A {} , B {} ] }\n`,
    'a.wrl': wrapper('A', 'S', 'shared.wrl'),
    'b.wrl': wrapper('B', 'S', 'shared.wrl'),
    'shared.wrl': library('Shared'),
  };
  const g = graphOf(files, 'main.wrl');
  assert.equal(g.cycles.length, 0);
  const shared = g.edges.filter((e) => e.declarationName === 'S');
  assert.equal(shared.length, 2);
  assert.ok(shared.every((e) => e.traversal === TRAVERSAL_STATUS.EXPANDED));
  const targets = shared.map((e) => nodeOf(g, e.to));
  assert.equal(targets[0].cycleKey, targets[1].cycleKey, 'same artifact and same prototype');
  assert.notDeepEqual(targets[0].instantiationBase, targets[1].instantiationBase,
    'and different instantiation bases, which is why they are not collapsed');
});

test('the cycle key is content-based: identical artifacts at two paths share it, and provenance survives', () => {
  const same = library('Same');
  const files = {
    'main.wrl': `${H}EXTERNPROTO X [] "one/lib.wrl"\nEXTERNPROTO Y [] "two/lib.wrl"\n`
      + 'Group { children [ X {} , Y {} ] }\n',
    'one/lib.wrl': same,
    'two/lib.wrl': same,
  };
  const g = graphOf(files, 'main.wrl');
  const targets = [edgeFor(g, 'X'), edgeFor(g, 'Y')].map((e) => nodeOf(g, e.to));
  assert.equal(targets[0].cycleKey, targets[1].cycleKey, 'the key is not the path');
  assert.notEqual(targets[0].artifactPath, targets[1].artifactPath, 'location provenance is not erased');
  assert.equal(g.cycles.length, 0);
});

// --- traversal shape --------------------------------------------------------

test('a declared-but-never-instantiated EXTERNPROTO produces no edge', () => {
  const files = {
    'main.wrl': `${H}EXTERNPROTO Used [] "u.wrl"\nEXTERNPROTO Unused [] "x.wrl"\nUsed {}\n`,
    'u.wrl': library('U'),
    'x.wrl': library('X'),
  };
  const g = graphOf(files, 'main.wrl');
  assert.deepEqual(g.edges.map((e) => e.declarationName), ['Used']);
});

test('one declaration instantiated many times is one edge, with a count', () => {
  const files = {
    'main.wrl': `${H}EXTERNPROTO T [] "t.wrl"\nGroup { children [ T {} , T {} , T {} ] }\n`,
    't.wrl': library('T'),
  };
  const g = graphOf(files, 'main.wrl');
  assert.equal(g.edges.length, 1);
  assert.equal(g.edges[0].occurrences, 3);
});

test('an unresolvable dependency is an edge with its own reason, not a dropped one', () => {
  const files = { 'main.wrl': consumer('T', 'gone.wrl') };
  const g = graphOf(files, 'main.wrl');
  const e = edgeFor(g, 'T');
  assert.equal(e.traversal, TRAVERSAL_STATUS.NOT_RESOLVED);
  assert.equal(e.to, null);
  assert.equal(e.resolution.status, RESOLUTION_STATUS.NOT_ATTEMPTED);
  assert.equal(e.resolution.candidates[0].retrieval.status, 'NOT_FOUND');
  assert.equal(g.complete, true, 'a proven absence does not make the graph incomplete');
});

test('a three-deep chain expands fully when unbounded', () => {
  const files = {
    'main.wrl': consumer('A', 'a.wrl'),
    'a.wrl': wrapper('A', 'ToB', 'b.wrl'),
    'b.wrl': wrapper('B', 'ToC', 'c.wrl'),
    'c.wrl': library('C'),
  };
  const g = graphOf(files, 'main.wrl');
  assert.equal(g.maxDepth, null, 'no magic default depth is invented');
  assert.equal(g.complete, true);
  assert.deepEqual(g.nodes.map((n) => n.depth), [0, 1, 2, 3]);
});

test('an explicitly configured depth bound reports INCOMPLETE, never a resolved-and-complete graph', () => {
  const files = {
    'main.wrl': consumer('A', 'a.wrl'),
    'a.wrl': wrapper('A', 'ToB', 'b.wrl'),
    'b.wrl': wrapper('B', 'ToC', 'c.wrl'),
    'c.wrl': library('C'),
  };
  const g = graphOf(files, 'main.wrl', { maxDepth: 1 });
  assert.equal(g.complete, false);
  assert.equal(edgeFor(g, 'A').traversal, TRAVERSAL_STATUS.EXPANDED);
  assert.equal(edgeFor(g, 'ToB').traversal, TRAVERSAL_STATUS.DEPTH_LIMIT_EXCEEDED);
  assert.equal(edgeFor(g, 'ToB').resolution.status, RESOLUTION_STATUS.RESOLVED,
    'the bound stops the walk; it does not unprove the target');
  assert.equal(edgeFor(g, 'ToC'), undefined);
});

test('a cycle does NOT make the graph incomplete', () => {
  const g = graphOf({ 'main.wrl': consumer('A', 'a.wrl'), 'a.wrl': wrapper('A', 'Self', 'a.wrl') }, 'main.wrl');
  assert.equal(g.complete, true);
  assert.equal(g.cycles.length, 1);
});

test('the graph and every record in it is frozen', () => {
  const g = graphOf({ 'main.wrl': consumer('T', 't.wrl'), 't.wrl': library('T') }, 'main.wrl');
  assert.ok(Object.isFrozen(g));
  assert.ok(Object.isFrozen(g.nodes) && Object.isFrozen(g.edges) && Object.isFrozen(g.cycles));
  assert.ok(g.nodes.every((n) => Object.isFrozen(n)));
  assert.ok(g.edges.every((e) => Object.isFrozen(e)));
});

test('the graph builder validates its required inputs', () => {
  const { context } = makeArchive({ 'main.wrl': library('T') });
  const p = parse(library('T'));
  assert.throws(() => buildExternalDependencyGraph(p, { baseDocument: { sourceId: 'archive', path: 'main.wrl' } }), /context/);
  assert.throws(() => buildExternalDependencyGraph(p, { context }), /baseDocument is REQUIRED/);
  assert.throws(() => buildExternalDependencyGraph(p, { context, baseDocument: { sourceId: 'archive', path: 'main.wrl' }, maxDepth: -1 }), /maxDepth/);
  assert.throws(() => buildExternalDependencyGraph(p, { context, baseDocument: { sourceId: 'archive', path: 'main.wrl' }, root: {} }), /root/);
});
