'use strict';
// VRML97 DEF/USE scope graph tests (Phase WD1.5-P1).
//
// The module's value is largely a NEGATIVE: it must never bind a reference to
// the wrong declaration. So most of what follows asserts a refusal, and every
// positive case proves WHICH declaration came back -- by object identity against
// the exact AST node located independently in the tree -- rather than merely
// that something did.
//
// Fixtures are authored here as string literals, original to this lane. Nothing
// under `spikes/` is imported: a production test that graded itself against the
// research prototype would be checking one implementation against another
// instead of against the standard.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { parse, ast } = require('../../src/vrml');
const sg = require('../../src/vrml/scope-graph');
const sym = require('../../src/vrml/symbols');

const { STATUS, REASON, SCOPE_KIND, SCOPE_ERROR } = sg;

const H = '#VRML V2.0 utf8\n';
const SRC = path.join(__dirname, '..', '..', 'src', 'vrml');

// --- helpers ---------------------------------------------------------------
//
// These locate things by walking the tree independently of the graph, so a test
// never proves the graph right using the graph's own index.

function build(source, opts) {
  const parsed = parse(source, opts);
  return { parsed, graph: sg.buildScopeGraph(parsed) };
}

/** Every AST `Use` node, in source order, found by an independent walk. */
function useNodes(parsed) {
  const out = [];
  ast.walk(parsed.tree, (n) => { if (n.type === ast.NODE.USE) out.push(n); });
  return out.sort((a, b) => a.range.start.offset - b.range.start.offset);
}

/** Every AST node carrying a DEF of `name`, in source order. */
function defNodes(parsed, name) {
  const out = [];
  ast.walk(parsed.tree, (n) => {
    if (n.type === ast.NODE.NODE && n.def === name) out.push(n);
  });
  return out.sort((a, b) => a.range.start.offset - b.range.start.offset);
}

/** Resolve the nth (1-based) USE of `name`. */
function resolveUse(parsed, graph, name, nth = 1) {
  const node = useNodes(parsed).filter((u) => u.name === name)[nth - 1];
  assert.ok(node, `fixture must contain USE ${name} #${nth}`);
  return sg.resolve(graph, node);
}

function expectStatus(res, status, reason) {
  assert.equal(res.status, status, `expected status ${status}, got ${res.status}/${res.reason}`);
  assert.equal(res.reason, reason, `expected reason ${reason}, got ${res.reason}`);
}

// Strip // and /* */ comments and string literals, so a source scan tests CODE
// rather than the prose that quotes the very words being banned.
function codeOnly(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (c === '/' && d === '/') { while (i < n && source[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < n && source[i] !== quote) { if (source[i] === '\\') i += 1; i += 1; }
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// ===========================================================================
// 1-10  Graph and scope identity
// ===========================================================================

test('scope: a document always owns a document DEF scope', () => {
  const { graph } = build(`${H}Group { }\n`);
  const doc = sg.documentScope(graph);
  assert.equal(doc.kind, SCOPE_KIND.DOCUMENT);
  assert.equal(sg.scopes(graph).length, 1);
  assert.equal(sg.scopes(graph)[0], doc);

  // Even a parse with no tree still has one, so no consumer has to null-check.
  const empty = sg.buildScopeGraph({
    tree: null, syntaxDiagnostics: [], truncated: false, depthCapped: false,
  });
  assert.equal(sg.documentScope(empty).kind, SCOPE_KIND.DOCUMENT);
});

test('scope: a PROTO body owns a DEF scope disjoint from the document', () => {
  const { graph } = build(`${H}PROTO P [ ] { Group { children [ DEF X Shape { } ] } }\nGroup { }\n`);
  const all = sg.scopes(graph);
  assert.equal(all.length, 2);
  const body = all[1];
  assert.equal(body.kind, SCOPE_KIND.PROTO_BODY);
  assert.equal(body.ownerName, 'P');
  // The whole structural rule (4.8.4), expressed as data.
  assert.equal(body.defParent, null, 'a PROTO body has NO node-name parent');
  assert.equal(body.typeParent, all[0], 'node-type lookup still points outward');
  assert.equal(sg.symbols(graph)[0].scope, body);
});

test('scope: separate PROTO bodies are distinct scope objects', () => {
  const { graph } = build(`${H}PROTO A [ ] { Group { } }\nPROTO B [ ] { Group { } }\nGroup { }\n`);
  const [, a, b] = sg.scopes(graph);
  assert.notEqual(a, b);
  assert.equal(a.defParent, null);
  assert.equal(b.defParent, null);
});

test('scope: nested PROTO bodies are disjoint from their enclosing body', () => {
  const { graph } = build(`${H}PROTO Outer [ ] {\n  Group { }\n`
    + `  PROTO Inner [ ] { Group { } }\n}\nGroup { }\n`);
  const [doc, outer, inner] = sg.scopes(graph);
  assert.equal(outer.ownerName, 'Outer');
  assert.equal(inner.ownerName, 'Inner');
  // Disjointness, not shadowing: the inner body does not see the outer body's
  // node names, so its defParent is null rather than `outer`.
  assert.equal(inner.defParent, null);
  assert.equal(outer.defParent, null);
  // Type lookup DOES nest, and that link is recorded for WD1.5-P2.
  assert.equal(inner.typeParent, outer);
  assert.equal(outer.typeParent, doc);
});

test('scope: two identically named PROTOs get two scopes', () => {
  const { graph } = build(`${H}PROTO P [ ] { Group { } }\nPROTO P [ ] { Group { } }\nGroup { }\n`);
  const [, a, b] = sg.scopes(graph);
  assert.equal(a.ownerName, 'P');
  assert.equal(b.ownerName, 'P');
  assert.notEqual(a, b, 'scope identity must not come from the name');
});

test('scope: names that would collide under a joined key stay distinct', () => {
  // WD1.4 reproduced a REAL wrong anchor from a `/`-joined scope key: the
  // tokenizer classifies identifiers by exclusion, so `PROTO A/B` and
  // `PROTO A { PROTO B }` spell the same joined string.
  const source = `${H}PROTO A/B [ ] { Group { children [ DEF Hit Shape { } USE Hit ] } }\n`
    + `PROTO A [ ] { PROTO B [ ] { Group { children [ DEF Hit Shape { } USE Hit ] } } Group { } }\n`
    + `Group { }\n`;
  const { parsed, graph } = build(source);
  const scopes = sg.scopes(graph);
  const named = scopes.filter((s) => s.kind === SCOPE_KIND.PROTO_BODY);
  assert.equal(named.length, 3, 'A/B, A and the nested B');
  assert.equal(new Set(named).size, 3);

  // Each USE binds the DEF in its OWN body, and the two bodies are different.
  const first = resolveUse(parsed, graph, 'Hit', 1);
  const second = resolveUse(parsed, graph, 'Hit', 2);
  expectStatus(first, STATUS.RESOLVED, REASON.OK);
  expectStatus(second, STATUS.RESOLVED, REASON.OK);
  assert.notEqual(first.symbol, second.symbol);
  assert.notEqual(first.symbol.scope, second.symbol.scope);
  assert.equal(first.symbol.node, defNodes(parsed, 'Hit')[0]);
  assert.equal(second.symbol.node, defNodes(parsed, 'Hit')[1]);
});

test('scope: unnamed recovered PROTO forms cannot collide', () => {
  const { graph } = build(`${H}PROTO [ ] { Group { } }\nPROTO [ ] { Group { } }\nGroup { }\n`);
  const bodies = sg.scopes(graph).filter((s) => s.kind === SCOPE_KIND.PROTO_BODY);
  assert.equal(bodies.length, 2);
  assert.notEqual(bodies[0], bodies[1]);
  for (const b of bodies) {
    assert.equal(b.ownerName, null);
    // A scope with no provable owner answers nothing.
    assert.equal(b.recovered, true);
  }
});

test('scope: defParent and typeParent match the committed model exactly', () => {
  const { graph } = build(`${H}PROTO Outer [ ] { PROTO Inner [ ] { Group { } } Group { } }\nGroup { }\n`);
  const [doc, outer, inner] = sg.scopes(graph);
  const table = sg.scopes(graph).map((s) => ({
    kind: s.kind,
    defParent: s.defParent === null ? null : s.defParent.index,
    typeParent: s.typeParent === null ? null : s.typeParent.index,
  }));
  assert.deepEqual(table, [
    { kind: 'document', defParent: null, typeParent: null },
    { kind: 'proto-body', defParent: null, typeParent: 0 },
    { kind: 'proto-body', defParent: null, typeParent: 1 },
  ]);
  assert.equal(doc.index, 0);
  assert.equal(outer.index, 1);
  assert.equal(inner.index, 2);
});

test('scope: nothing mutable is exposed', () => {
  const { parsed, graph } = build(`${H}Group { children [ DEF Ball Shape { } USE Ball ] }\n`);
  const scopes = sg.scopes(graph);
  const symbols = sg.symbols(graph);
  const references = sg.references(graph);
  const res = resolveUse(parsed, graph, 'Ball');

  for (const [label, v] of [['graph', graph], ['scopes[]', scopes], ['symbols[]', symbols],
    ['references[]', references], ['scope', scopes[0]], ['symbol', symbols[0]],
    ['reference', references[0]], ['resolution', res], ['evidence', res.evidence]]) {
    assert.equal(Object.isFrozen(v), true, `${label} must be frozen`);
  }
  // No Map, Set or internal index is reachable from the handle.
  assert.deepEqual(Object.keys(graph), []);
  for (const key of Object.keys(scopes[0])) {
    const v = scopes[0][key];
    assert.equal(v instanceof Map, false, `scope.${key} must not be a Map`);
    assert.equal(v instanceof Set, false, `scope.${key} must not be a Set`);
  }
  assert.equal(sg.isScopeGraph(graph), true);
  assert.equal(sg.isScopeGraph({}), false);
});

test('scope: projections from one graph are rejected by another', () => {
  // Byte-identical text, two parses. Every projection has the same SHAPE, so
  // only object membership can tell them apart -- and it must.
  const source = `${H}Group { children [ DEF Ball Shape { } USE Ball ] }\n`;
  const a = build(source);
  const b = build(source);

  const refA = sg.references(a.graph)[0];
  const symA = sg.symbols(a.graph)[0];
  assert.equal(sym.isUseReferenceShape(refA), true, 'the shape is valid on purpose');

  assert.throws(() => sg.resolve(b.graph, refA), (e) => e.code === SCOPE_ERROR.REFERENCE);
  assert.throws(() => sg.referencesTo(b.graph, symA), (e) => e.code === SCOPE_ERROR.SYMBOL);
  assert.throws(() => sg.defIsUniqueInScope(b.graph, symA), (e) => e.code === SCOPE_ERROR.SYMBOL);
  // The AST nodes are different objects too, so the node-keyed paths refuse.
  assert.throws(() => sg.resolve(b.graph, refA.node), (e) => e.code === SCOPE_ERROR.REFERENCE);
  assert.throws(() => sg.referencesTo(b.graph, symA.node), (e) => e.code === SCOPE_ERROR.SYMBOL);

  // And each graph still answers for itself.
  assert.equal(sg.resolve(a.graph, refA).symbol, symA);
});

// ===========================================================================
// 11-26  DEF / USE
// ===========================================================================

test('def/use: a top-level DEF binds a following USE', () => {
  const source = `${H}Group { children [\n  DEF Ball Shape { }\n  USE Ball\n] }\n`;
  const { parsed, graph } = build(source);
  const res = resolveUse(parsed, graph, 'Ball');
  expectStatus(res, STATUS.RESOLVED, REASON.OK);
  assert.equal(res.symbol.node, defNodes(parsed, 'Ball')[0]);
  assert.equal(res.candidateCount, 1);
});

test('def/use: USE before DEF has no binding (4.6.2 "preceding it")', () => {
  const source = `${H}Group { children [\n  USE Ball\n  DEF Ball Shape { }\n] }\n`;
  const { parsed, graph } = build(source);
  const res = resolveUse(parsed, graph, 'Ball');
  expectStatus(res, STATUS.INVALID, REASON.USE_BEFORE_DEF);
  assert.equal(res.symbol, null);
});

test('def/use: repeated DEF names in one scope are AMBIGUOUS, never ranked', () => {
  // 4.6.2 fully specifies the browser's answer -- the CLOSEST PRECEDING
  // declaration. This resolver deliberately does not implement it, because its
  // consumers are identity and rename, where picking the plausible candidate is
  // the exact failure the hard gate exists to prevent. The refusal is the
  // committed behaviour, not a gap in the implementation.
  const source = `${H}DEF Ball Shape { }\nDEF Ball Group { }\nGroup { children [ USE Ball ] }\n`;
  const { parsed, graph } = build(source);
  const res = resolveUse(parsed, graph, 'Ball');
  expectStatus(res, STATUS.AMBIGUOUS, REASON.DUPLICATE_DEF_IN_SCOPE);
  assert.equal(res.symbol, null, 'ambiguity must never carry a declaration');
  assert.equal(res.candidateCount, 2);
  // Both candidates are cited as evidence, in source order -- the caller gets
  // the facts without the resolver choosing between them.
  const decls = defNodes(parsed, 'Ball');
  assert.deepEqual(res.evidence.map((r) => r.start.offset),
    decls.map((d) => d.defRange.start.offset));
});

test('def/use: only PRECEDING duplicates count toward ambiguity', () => {
  // A discriminating case for the ordering rule: with the USE in the middle,
  // exactly one declaration precedes it, so the honest answer is a binding to
  // THAT one -- not ambiguity, and not the later declaration.
  const source = `${H}DEF Ball Shape { }\nGroup { children [ USE Ball ] }\nDEF Ball Group { }\n`;
  const { parsed, graph } = build(source);
  const res = resolveUse(parsed, graph, 'Ball');
  expectStatus(res, STATUS.RESOLVED, REASON.OK);
  assert.equal(res.symbol.node, defNodes(parsed, 'Ball')[0]);
  assert.notEqual(res.symbol.node, defNodes(parsed, 'Ball')[1]);
});

test('def/use: the same name in two PROTO bodies is not a duplicate', () => {
  const source = `${H}PROTO Left [ ] { Group { children [ DEF Pivot Transform { } USE Pivot ] } }\n`
    + `PROTO Right [ ] { Group { children [ DEF Pivot Transform { } USE Pivot ] } }\nGroup { }\n`;
  const { parsed, graph } = build(source);
  const first = resolveUse(parsed, graph, 'Pivot', 1);
  const second = resolveUse(parsed, graph, 'Pivot', 2);
  expectStatus(first, STATUS.RESOLVED, REASON.OK);
  expectStatus(second, STATUS.RESOLVED, REASON.OK);
  assert.equal(first.symbol.node, defNodes(parsed, 'Pivot')[0]);
  assert.equal(second.symbol.node, defNodes(parsed, 'Pivot')[1]);
  for (const s of sg.symbols(graph)) {
    assert.equal(sg.defIsUniqueInScope(graph, s).unique, true);
  }
});

test('def/use: a DEF inside a PROTO body is invisible outside it', () => {
  const source = `${H}PROTO Widget [ ] { Group { children [ DEF Inner Shape { } ] } }\n`
    + `Group { children [ USE Inner ] }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveUse(parsed, graph, 'Inner'),
    STATUS.UNRESOLVED, REASON.DEF_NOT_VISIBLE_ACROSS_PROTO_BOUNDARY);
});

test('def/use: a DEF outside a PROTO is invisible inside it', () => {
  const source = `${H}DEF Outer Shape { }\n`
    + `PROTO Widget [ ] { Group { children [ USE Outer ] } }\nGroup { }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveUse(parsed, graph, 'Outer'),
    STATUS.UNRESOLVED, REASON.DEF_NOT_VISIBLE_ACROSS_PROTO_BOUNDARY);
});

test('def/use: nested PROTO bodies do not see each other', () => {
  const source = `${H}PROTO Outer [ ] {\n`
    + `  Group { children [ DEF Hub Transform { } USE Hub ] }\n`
    + `  PROTO Inner [ ] { Group { children [ DEF Hub Transform { } USE Hub ] } }\n`
    + `}\nGroup { }\n`;
  const { parsed, graph } = build(source);
  const outer = resolveUse(parsed, graph, 'Hub', 1);
  const inner = resolveUse(parsed, graph, 'Hub', 2);
  expectStatus(outer, STATUS.RESOLVED, REASON.OK);
  expectStatus(inner, STATUS.RESOLVED, REASON.OK);
  assert.notEqual(outer.symbol.scope, inner.symbol.scope);
  assert.equal(outer.symbol.node, defNodes(parsed, 'Hub')[0]);
  assert.equal(inner.symbol.node, defNodes(parsed, 'Hub')[1]);
});

test('def/use: hyphenated names are ordinary names', () => {
  const source = `${H}Group { children [\n  DEF arm-left-ROT Transform { }\n  USE arm-left-ROT\n] }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveUse(parsed, graph, 'arm-left-ROT'), STATUS.RESOLVED, REASON.OK);
});

test('def/use: a name containing "/" is an ordinary name', () => {
  const source = `${H}DEF path/to/thing Transform { }\nGroup { children [ USE path/to/thing ] }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveUse(parsed, graph, 'path/to/thing'), STATUS.RESOLVED, REASON.OK);
});

test('def/use: names differing only by punctuation are different names', () => {
  const source = `${H}DEF arm_left Transform { }\nDEF arm-left Transform { }\n`
    + `Group { children [ USE arm-left ] }\n`;
  const { parsed, graph } = build(source);
  const res = resolveUse(parsed, graph, 'arm-left');
  expectStatus(res, STATUS.RESOLVED, REASON.OK);
  assert.equal(res.symbol.node, defNodes(parsed, 'arm-left')[0]);
});

test('def/use: an unknown vendor node type participates normally', () => {
  const source = `${H}Group { children [\n  DEF Vend BlaxxunAvatar { }\n  USE Vend\n] }\n`;
  const { parsed, graph } = build(source);
  const res = resolveUse(parsed, graph, 'Vend');
  expectStatus(res, STATUS.RESOLVED, REASON.OK);
  assert.equal(res.symbol.nodeType, 'BlaxxunAvatar');
});

test('def/use: duplicates of DIFFERENT node types are still ambiguous', () => {
  // Narrowing duplicates by node type and taking the survivor is precisely how
  // a confident wrong answer gets produced. Ambiguity is decided on the NAME
  // alone, before type is considered at all.
  const source = `${H}DEF Thing Shape { }\nDEF Thing Group { }\nGroup { children [ USE Thing ] }\n`;
  const { parsed, graph } = build(source);
  const res = resolveUse(parsed, graph, 'Thing');
  expectStatus(res, STATUS.AMBIGUOUS, REASON.DUPLICATE_DEF_IN_SCOPE);
  assert.equal(res.symbol, null);
});

test('def/use: a USE deep inside MFNode content resolves', () => {
  // A SECOND `DEF Ball` sits after the USE, so asserting the bound node is a
  // real discrimination rather than "the only DEF in the file": a resolver that
  // ignored ordering, or that reached for the later declaration, fails here.
  const source = `${H}Group { children [ DEF Ball Shape { } Transform { children [ Group { children [\n`
    + `  USE Ball\n] } ] } ] }\nDEF Ball Transform { }\n`;
  const { parsed, graph } = build(source);
  const decls = defNodes(parsed, 'Ball');
  assert.equal(decls.length, 2, 'the fixture must offer a wrong answer to pick');
  const res = resolveUse(parsed, graph, 'Ball');
  expectStatus(res, STATUS.RESOLVED, REASON.OK);
  assert.equal(res.symbol.node, decls[0]);
  assert.notEqual(res.symbol.node, decls[1]);
});

test('def/use: a USE inside a Script SFNode field resolves', () => {
  const source = `${H}DEF Ball Shape { }\n`
    + `DEF Logic Script {\n  field SFNode target USE Ball\n  url "x.js"\n}\n`;
  const { parsed, graph } = build(source);
  const res = resolveUse(parsed, graph, 'Ball');
  expectStatus(res, STATUS.RESOLVED, REASON.OK);
  assert.equal(res.symbol.node, defNodes(parsed, 'Ball')[0]);
});

test('def/use: a USE inside a Script MFNode field resolves', () => {
  const source = `${H}DEF Ball Shape { }\n`
    + `DEF Logic Script {\n  field MFNode targets [ USE Ball USE Ball ]\n  url "x.js"\n}\n`;
  const { parsed, graph } = build(source);
  for (const nth of [1, 2]) {
    const res = resolveUse(parsed, graph, 'Ball', nth);
    expectStatus(res, STATUS.RESOLVED, REASON.OK);
    assert.equal(res.symbol.node, defNodes(parsed, 'Ball')[0]);
  }
});

test('def/use: a Script referring to itself is NOT a forbidden cycle', () => {
  // 4.4.4 binds the TRANSFORMATION HIERARCHY, and a descendant of a Script is
  // explicitly outside it. This idiom appeared 489 times in the research
  // corpus; rejecting it would be a false positive on real, shipped content.
  const source = `${H}DEF Logic Script { field SFNode myself USE Logic\n`
    + `  eventOut SFTime fired\n  url "x.js" }\nGroup { }\n`;
  const { parsed, graph } = build(source);
  const res = resolveUse(parsed, graph, 'Logic');
  expectStatus(res, STATUS.RESOLVED, REASON.SELF_REFERENCE_OUTSIDE_TRANSFORMATION_HIERARCHY);
  assert.equal(res.symbol.node, defNodes(parsed, 'Logic')[0]);
});

test('def/use: a USE inside the grouping node it names IS a cycle', () => {
  // The discriminating twin of the Script case: same shape, but inside the
  // transformation hierarchy, where 4.4.4 does apply.
  const source = `${H}DEF Loop Group { children [ USE Loop ] }\n`;
  const { parsed, graph } = build(source);
  const res = resolveUse(parsed, graph, 'Loop');
  expectStatus(res, STATUS.INVALID, REASON.SELF_REFERENTIAL_USE);
  assert.equal(res.symbol, null);
});

test('def/use: a deleted declaration leaves its reference unresolved', () => {
  const before = build(`${H}Group { children [ DEF Ball Shape { } USE Ball ] }\n`);
  expectStatus(resolveUse(before.parsed, before.graph, 'Ball'), STATUS.RESOLVED, REASON.OK);
  // The graph is rebuilt from the new parse; nothing survives from the old one.
  const after = build(`${H}Group { children [ USE Ball ] }\n`);
  expectStatus(resolveUse(after.parsed, after.graph, 'Ball'),
    STATUS.UNRESOLVED, REASON.DEF_NOT_DECLARED_IN_SCOPE);
});

test('def/use: a renamed declaration is a safe loss, not a rebinding', () => {
  const after = build(`${H}Group { children [ DEF Sphere1 Shape { } USE Ball ] }\n`);
  const res = resolveUse(after.parsed, after.graph, 'Ball');
  expectStatus(res, STATUS.UNRESOLVED, REASON.DEF_NOT_DECLARED_IN_SCOPE);
  assert.equal(res.symbol, null, 'it must not fall back to the nearest declaration');
});

test('def/use: a USE the parse could not name is invalid, not resolved', () => {
  const { parsed, graph } = build(`${H}DEF Ball Shape { }\nGroup { children [ USE ] }\n`);
  const nameless = useNodes(parsed).filter((u) => u.name == null);
  assert.equal(nameless.length, 1, 'fixture must produce one unnamed USE');
  const res = sg.resolve(graph, nameless[0]);
  assert.equal(res.status, STATUS.INVALID);
  assert.equal(res.reason, REASON.MISSING_NAME);
  assert.equal(res.symbol, null);
});

test('def/use: foreign and unknown AST nodes are refused loudly', () => {
  const { parsed, graph } = build(`${H}Group { children [ DEF Ball Shape { } USE Ball ] }\n`);
  // A shape-valid forgery.
  const forged = Object.freeze({ kind: 'use', namespace: 'node-name', name: 'Ball' });
  assert.throws(() => sg.resolve(graph, forged), (e) => e.code === SCOPE_ERROR.REFERENCE);
  // A USE node that was never parsed.
  assert.throws(() => sg.resolve(graph, { type: 'Use', name: 'Ball' }),
    (e) => e.code === SCOPE_ERROR.REFERENCE);
  // A node from this parse that carries no reference at all.
  assert.throws(() => sg.resolve(graph, defNodes(parsed, 'Ball')[0]),
    (e) => e.code === SCOPE_ERROR.REFERENCE);
  for (const bad of [null, undefined, 0, 'Ball', [], {}]) {
    assert.throws(() => sg.resolve(graph, bad), (e) => e.code === SCOPE_ERROR.REFERENCE);
  }
  // And a graph that is not a graph.
  for (const bad of [null, undefined, 0, 'graph', {}, []]) {
    assert.throws(() => sg.resolve(bad, forged), (e) => e.code === SCOPE_ERROR.GRAPH);
  }
});

test('def/use: a malformed parse result is refused rather than assumed sound', () => {
  for (const bad of [null, undefined, 0, 'text', []]) {
    assert.throws(() => sg.buildScopeGraph(bad), (e) => e.code === SCOPE_ERROR.PARSE);
  }
  const good = { tree: null, syntaxDiagnostics: [], truncated: false, depthCapped: false };
  // Damage evidence is REQUIRED, never defaulted: a graph that cannot see the
  // diagnostics believes every scope is provable, which fails OPEN.
  assert.throws(() => sg.buildScopeGraph({ ...good, syntaxDiagnostics: undefined }),
    (e) => e.code === SCOPE_ERROR.PARSE);
  assert.throws(() => sg.buildScopeGraph({ ...good, truncated: undefined }),
    (e) => e.code === SCOPE_ERROR.PARSE);
  assert.throws(() => sg.buildScopeGraph({ ...good, depthCapped: 'no' }),
    (e) => e.code === SCOPE_ERROR.PARSE);
  // A foreign tree is not a document.
  assert.throws(() => sg.buildScopeGraph({ ...good, tree: { type: 'Node' } }),
    (e) => e.code === SCOPE_ERROR.PARSE);
});

test('def/use: a PROTO statement stored in node.fields still opens its scope', () => {
  // Annex A `nodeBodyElement` admits PROTO and ROUTE inside a node body, and the
  // parser collects them into `node.fields` alongside real fields -- only
  // interface declarations get their own array. Iterating `fields` as if every
  // entry were a field silently drops them; that cost the research spike 5,444
  // real ROUTEs. Here it would lose a whole DEF scope.
  const source = `${H}Group {\n`
    + `  PROTO Inner [ ] { Group { children [ DEF Knob Shape { } USE Knob ] } }\n`
    + `  children [ DEF Knob Transform { } USE Knob ]\n}\n`;
  const { parsed, graph } = build(source);

  const body = sg.scopes(graph).find((s) => s.kind === SCOPE_KIND.PROTO_BODY);
  assert.ok(body, 'the PROTO inside the node body must open a scope');
  assert.equal(body.ownerName, 'Inner');

  const decls = defNodes(parsed, 'Knob');
  assert.equal(decls.length, 2);
  // The inner USE binds the PROTO body's DEF; the outer USE binds the document
  // scope's. Two names, two scopes, and neither leaks into the other.
  const inner = resolveUse(parsed, graph, 'Knob', 1);
  const outer = resolveUse(parsed, graph, 'Knob', 2);
  expectStatus(inner, STATUS.RESOLVED, REASON.OK);
  expectStatus(outer, STATUS.RESOLVED, REASON.OK);
  assert.equal(inner.symbol.node, decls[0]);
  assert.equal(outer.symbol.node, decls[1]);
  assert.equal(inner.symbol.scope, body);
  assert.equal(outer.symbol.scope, sg.documentScope(graph));
});

test('def/use: a PROTO statement inside an MFNode array still opens its scope', () => {
  // Non-conforming per Annex A `mfnodeValue`, accepted by the parser as a
  // Cybertown/Blaxxun compatibility measure. Dropping it here would lose every
  // DEF inside the body -- classification is not a licence to stop traversing.
  const source = `${H}Group { children [\n`
    + `  PROTO Inner [ ] { Group { children [ DEF Knob Shape { } USE Knob ] } }\n`
    + `  DEF Knob Transform { }\n  USE Knob\n] }\n`;
  const { parsed, graph } = build(source);

  const body = sg.scopes(graph).find((s) => s.kind === SCOPE_KIND.PROTO_BODY);
  assert.ok(body, 'the PROTO inside the array must open a scope');
  const decls = defNodes(parsed, 'Knob');
  const inner = resolveUse(parsed, graph, 'Knob', 1);
  const outer = resolveUse(parsed, graph, 'Knob', 2);
  assert.equal(inner.symbol.node, decls[0]);
  assert.equal(inner.symbol.scope, body);
  assert.equal(outer.symbol.node, decls[1]);
  assert.equal(outer.symbol.scope, sg.documentScope(graph));
});

test('def/use: PROTO interface defaults are a documented, deliberate blind spot', () => {
  // Which scope owns a DEF written inside a PROTO's own interface default is an
  // interpretation question the committed standards model does not settle, so
  // P1 does not traverse there and the reference fails CLOSED. Pinned so the
  // limit stays deliberate rather than becoming an accident.
  const source = `${H}PROTO P [ field SFNode d DEF Hidden Shape { } ] { Group { children [ USE Hidden ] } }\n`
    + `Group { }\n`;
  const { parsed, graph } = build(source);
  assert.equal(sg.symbols(graph).filter((s) => s.name === 'Hidden').length, 0);
  const res = resolveUse(parsed, graph, 'Hidden');
  assert.equal(res.status, STATUS.UNRESOLVED, 'it must refuse, never bind');
  assert.equal(res.symbol, null);
});

// ===========================================================================
// 27-33  Recovery
// ===========================================================================

test('recovery: an unclosed PROTO must not manufacture a unique binding', () => {
  // THE regression. With the brace present this document is genuinely
  // ambiguous: two `DEF Foo` share the document scope. With it missing, the
  // PROTO body swallows the trailing statements, and because a PROTO body has
  // no defParent the absorbed scope is blind to the outer `DEF Foo` -- leaving
  // exactly one candidate. Returning it would be a confidently WRONG answer.
  const damaged = `${H}DEF Foo Group { }\nPROTO P [ ] {\n  Shape { }\n`
    + `DEF Foo Transform { }\nGroup { children [ USE Foo ] }\n`;
  const whole = `${H}DEF Foo Group { }\nPROTO P [ ] {\n  Shape { }\n}\n`
    + `DEF Foo Transform { }\nGroup { children [ USE Foo ] }\n`;

  const bad = build(damaged);
  const res = resolveUse(bad.parsed, bad.graph, 'Foo');
  expectStatus(res, STATUS.RECOVERED, REASON.SCOPE_RECOVERED);
  assert.equal(res.symbol, null);

  // The undamaged twin proves the refusal is about the DAMAGE, not about the
  // document being unbindable in principle.
  const ok = build(whole);
  expectStatus(resolveUse(ok.parsed, ok.graph, 'Foo'),
    STATUS.AMBIGUOUS, REASON.DUPLICATE_DEF_IN_SCOPE);
});

test('recovery: a damaged document scope withholds POSITIVE answers too', () => {
  const source = `${H}Group { children [ DEF Ball Shape { } USE Ball ] \nTransform { translation }\n`;
  const { parsed, graph } = build(source);
  assert.ok(parsed.syntaxDiagnostics.some((d) => d.severity === 'error'),
    'fixture must actually be damaged');
  assert.equal(sg.documentScope(graph).recovered, true);
  const res = resolveUse(parsed, graph, 'Ball');
  expectStatus(res, STATUS.RECOVERED, REASON.SCOPE_RECOVERED);
  assert.equal(res.symbol, null, 'a partial tree cannot prove which scope owns a name');
});

test('recovery: a damaged PROTO scope withholds negative answers too', () => {
  const source = `${H}PROTO Widget [ ] { Group { children [ USE Ghost\n`;
  const { parsed, graph } = build(source);
  const res = resolveUse(parsed, graph, 'Ghost');
  expectStatus(res, STATUS.RECOVERED, REASON.SCOPE_RECOVERED);
});

test('recovery: an unnamed PROTO fails closed with no diagnostic needed', () => {
  const source = `${H}PROTO [ ] { Group { children [ USE Ghost ] } }\nGroup { }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveUse(parsed, graph, 'Ghost'),
    STATUS.RECOVERED, REASON.PROTO_SCOPE_NOT_PROVABLE);
});

test('recovery: an empty PROTO body fails closed structurally', () => {
  // Annex A `protoBody` requires at least one node statement, so an empty body
  // is a truncated parse or invalid source either way.
  const { graph } = build(`${H}PROTO P [ ] { }\nGroup { }\n`);
  const body = sg.scopes(graph).find((s) => s.kind === SCOPE_KIND.PROTO_BODY);
  assert.equal(body.recovered, true);
  assert.equal(body.recoveredReason, REASON.PROTO_BODY_NOT_PROVABLE);
});

test('recovery: a damaged scope never falls back to an outer scope', () => {
  // The outer document scope holds a perfectly good `DEF Ball`. A resolver that
  // "helpfully" widened its search on failure would bind it -- which is the
  // cross-PROTO leak 4.8.4 forbids, arrived at by a different route.
  const source = `${H}DEF Ball Shape { }\nPROTO P [ ] { Group { children [ USE Ball\n`;
  const { parsed, graph } = build(source);
  const res = resolveUse(parsed, graph, 'Ball');
  assert.equal(res.status, STATUS.RECOVERED);
  assert.equal(res.symbol, null);
});

test('recovery: uniqueness is not asserted inside a recovered scope', () => {
  const source = `${H}PROTO P [ ] { Group { children [ DEF Only Shape { }\n`;
  const { graph } = build(source);
  const only = sg.symbols(graph).find((s) => s.name === 'Only');
  assert.ok(only, 'fixture must still produce the declaration');
  const u = sg.defIsUniqueInScope(graph, only);
  assert.equal(u.unique, false, 'a damaged scope declines to assert uniqueness');
  assert.notEqual(u.reason, REASON.DUPLICATE_DEF_IN_SCOPE);
  assert.equal([REASON.SCOPE_RECOVERED, REASON.PROTO_BODY_NOT_PROVABLE,
    REASON.PROTO_SCOPE_NOT_PROVABLE].includes(u.reason), true, `unexpected reason ${u.reason}`);
});

test('recovery: a hard parse cap makes EVERY lexical scope unprovable', () => {
  const source = `${H}PROTO P [ ] { Group { children [ DEF In Shape { } USE In ] } }\n`
    + `Group { children [ DEF Out Shape { } USE Out ] }\n`;
  const { parsed, graph } = build(source, { maxNodes: 3 });
  assert.equal(parsed.truncated, true, 'fixture must actually hit the cap');
  for (const s of sg.scopes(graph)) {
    assert.equal(s.recovered, true);
    assert.equal(s.recoveredReason, REASON.DOCUMENT_PARSE_INCOMPLETE);
  }
  for (const r of sg.resolutions(graph)) {
    assert.equal(r.status, STATUS.RECOVERED);
    assert.equal(r.reason, REASON.DOCUMENT_PARSE_INCOMPLETE);
    assert.equal(r.symbol, null);
  }
  const anySymbol = sg.symbols(graph)[0];
  if (anySymbol) {
    assert.deepEqual({ ...sg.defIsUniqueInScope(graph, anySymbol) },
      { unique: false, reason: REASON.DOCUMENT_PARSE_INCOMPLETE });
  }
});

test('recovery: damage no scope contains fails the WHOLE graph closed', () => {
  // Raised as a blocker by an external adversarial review. The reviewer's stated
  // cause -- diagnostics with a null or negative range -- does not occur: the
  // parser derives every range from a token, and 6,248 real files produced zero
  // of them. The MECHANISM is real though: an error lying outside `tree.range`
  // is contained by no scope, and simply dropping it would leave every scope
  // marked clean on the strength of damage the model just admitted it could not
  // place. Six real corpus files do it (a stray byte before the header).
  //
  // Driven through `buildScopeGraph`'s own contract -- the diagnostic list is an
  // INPUT to this module -- because no real source could be constructed where
  // the unattributable error is the ONLY damage signal; in all six corpus cases
  // a second, attributable diagnostic marked the document anyway.
  const source = `${H}PROTO P [ ] { Group { children [ DEF In Shape { } USE In ] } }\n`
    + `Group { children [ DEF Ball Shape { } USE Ball ] }\n`;
  const parsed = parse(source);
  assert.deepEqual(parsed.syntaxDiagnostics, [], 'the fixture itself must parse cleanly');

  // Undamaged: both USEs bind, in their own scopes.
  const clean = sg.buildScopeGraph(parsed);
  assert.equal(sg.documentScope(clean).recovered, false);
  for (const r of sg.resolutions(clean)) assert.equal(r.status, STATUS.RESOLVED);

  const beyond = parsed.tree.range.end.offset + 100;
  const outOfRange = {
    severity: 'error',
    code: 'VRML012',
    message: 'synthetic damage outside every scope',
    range: { start: { offset: beyond, line: 99, column: 1 },
      end: { offset: beyond + 1, line: 99, column: 2 } },
  };
  const noRange = {
    severity: 'error', code: 'VRML012', message: 'synthetic damage with no position', range: null,
  };

  for (const [label, diagnostic] of [['out of range', outOfRange], ['no range', noRange]]) {
    const graph = sg.buildScopeGraph({ ...parsed, syntaxDiagnostics: [diagnostic] });
    for (const s of sg.scopes(graph)) {
      assert.equal(s.recovered, true, `${label}: every scope must fail closed`);
      assert.equal(s.recoveredReason, REASON.SCOPE_RECOVERED);
    }
    for (const r of sg.resolutions(graph)) {
      assert.equal(r.status, STATUS.RECOVERED, `${label}: no confident binding may survive`);
      assert.equal(r.symbol, null);
    }
    // Including the PROTO body, which a document-scope-only fallback would miss
    // entirely -- a PROTO body has no defParent, so marking the document does
    // not protect anything inside one.
    const body = sg.scopes(graph).find((s) => s.kind === SCOPE_KIND.PROTO_BODY);
    assert.equal(body.recovered, true, `${label}: the PROTO body must fail closed too`);
  }
});

test('recovery: damage is attributed to the innermost scope, not the document', () => {
  // Without innermost attribution one stray error anywhere would mark the
  // document scope recovered and suppress every honest answer in the file.
  const source = `${H}PROTO P [ ] { Shape { geometry } }\n`
    + `Group { children [ DEF Ball Shape { } USE Ball ] }\n`;
  const { parsed, graph } = build(source);
  assert.ok(parsed.syntaxDiagnostics.some((d) => d.severity === 'error'),
    'fixture must carry a syntax error inside the PROTO');
  const doc = sg.documentScope(graph);
  const body = sg.scopes(graph).find((s) => s.kind === SCOPE_KIND.PROTO_BODY);
  assert.equal(body.recovered, true, 'the PROTO body owns the damage');
  assert.equal(doc.recovered, false, 'the clean sibling scope stays usable');
  expectStatus(resolveUse(parsed, graph, 'Ball'), STATUS.RESOLVED, REASON.OK);
});

// ===========================================================================
// 34-40  Queries
// ===========================================================================

test('query: referencesTo returns only authoritatively bound references', () => {
  const source = `${H}DEF Ball Shape { }\nGroup { children [ USE Ball USE Ball ] }\n`;
  const { parsed, graph } = build(source);
  const symbol = sg.symbolFor(graph, defNodes(parsed, 'Ball')[0]);
  const refs = sg.referencesTo(graph, symbol);
  assert.equal(refs.length, 2);
  assert.deepEqual(refs.map((r) => r.node), useNodes(parsed));
  // The AST node overload answers identically.
  assert.deepEqual(sg.referencesTo(graph, defNodes(parsed, 'Ball')[0]), refs);
});

test('query: referencesTo excludes unresolved, ambiguous and recovered references', () => {
  // Every non-`resolved` shape at once. Including any of them is how a rename
  // corrupts a document.
  const source = `${H}DEF Ball Shape { }\nGroup { children [ USE Ball ] }\n`
    + `DEF Ball Group { }\nGroup { children [ USE Ball ] }\n`
    + `Group { children [ USE Ghost ] }\n`;
  const { parsed, graph } = build(source);
  const first = sg.symbolFor(graph, defNodes(parsed, 'Ball')[0]);
  const second = sg.symbolFor(graph, defNodes(parsed, 'Ball')[1]);

  // USE #1 binds the first declaration; USE #2 is ambiguous and binds nothing.
  expectStatus(resolveUse(parsed, graph, 'Ball', 2), STATUS.AMBIGUOUS,
    REASON.DUPLICATE_DEF_IN_SCOPE);
  assert.equal(sg.referencesTo(graph, first).length, 1);
  assert.equal(sg.referencesTo(graph, second).length, 0);

  const total = sg.symbols(graph).reduce((n, s) => n + sg.referencesTo(graph, s).length, 0);
  assert.equal(total, 1, 'the ambiguous and unresolved references belong to no declaration');
});

test('query: defIsUniqueInScope checks the exact owning scope', () => {
  const source = `${H}DEF Ball Shape { }\n`
    + `PROTO P [ ] { Group { children [ DEF Ball Transform { } ] } }\nGroup { }\n`;
  const { parsed, graph } = build(source);
  const outer = sg.symbolFor(graph, defNodes(parsed, 'Ball')[0]);
  const inner = sg.symbolFor(graph, defNodes(parsed, 'Ball')[1]);
  assert.notEqual(outer.scope, inner.scope);
  // Two DEFs of one name, and BOTH are unique -- because uniqueness is a
  // per-scope question, and 4.8.4 makes these scopes disjoint.
  assert.deepEqual({ ...sg.defIsUniqueInScope(graph, outer) }, { unique: true, reason: 'ok' });
  assert.deepEqual({ ...sg.defIsUniqueInScope(graph, inner) }, { unique: true, reason: 'ok' });
});

test('query: uniqueness does not narrow by node type', () => {
  const source = `${H}DEF Thing Shape { }\nDEF Thing Group { }\nGroup { }\n`;
  const { parsed, graph } = build(source);
  for (const node of defNodes(parsed, 'Thing')) {
    const u = sg.defIsUniqueInScope(graph, sg.symbolFor(graph, node));
    assert.deepEqual({ ...u }, { unique: false, reason: REASON.DUPLICATE_DEF_IN_SCOPE });
  }
});

test('query: uniqueness never crosses a PROTO boundary in either direction', () => {
  const source = `${H}PROTO A [ ] { Group { children [ DEF Same Shape { } ] } }\n`
    + `PROTO B [ ] { Group { children [ DEF Same Shape { } ] } }\nGroup { }\n`;
  const { graph } = build(source);
  const syms = sg.symbols(graph).filter((s) => s.name === 'Same');
  assert.equal(syms.length, 2);
  assert.equal(new Set(syms.map((s) => s.scope)).size, 2);
  for (const s of syms) {
    assert.deepEqual({ ...sg.defIsUniqueInScope(graph, s) }, { unique: true, reason: 'ok' });
  }
});

test('query: a non-DEF input is refused rather than answered', () => {
  const { parsed, graph } = build(`${H}Group { children [ DEF Ball Shape { } USE Ball ] }\n`);
  const reference = sg.references(graph)[0];
  assert.throws(() => sg.defIsUniqueInScope(graph, reference),
    (e) => e.code === SCOPE_ERROR.SYMBOL);
  assert.throws(() => sg.referencesTo(graph, reference), (e) => e.code === SCOPE_ERROR.SYMBOL);
  // A node from this parse that declares nothing.
  const anonymous = [];
  ast.walk(parsed.tree, (n) => {
    if (n.type === ast.NODE.NODE && n.def == null) anonymous.push(n);
  });
  assert.ok(anonymous.length > 0);
  assert.throws(() => sg.referencesTo(graph, anonymous[0]), (e) => e.code === SCOPE_ERROR.SYMBOL);
});

test('query: every list is deterministic and source ordered', () => {
  // Interface defaults are visited before fields during construction while the
  // text interleaves them, so publication order is a real property, not an
  // accident of the traversal.
  const source = `${H}DEF A Shape { }\n`
    + `DEF S Script { field SFNode one DEF B Group { }\n  url "x.js" }\n`
    + `Group { children [ USE A DEF C Shape { } USE B USE C ] }\n`;
  const { parsed, graph } = build(source);

  const symbolOffsets = sg.symbols(graph).map((s) => s.declRange.start.offset);
  assert.deepEqual(symbolOffsets, [...symbolOffsets].sort((a, b) => a - b));
  assert.deepEqual(sg.symbols(graph).map((s) => s.name), ['A', 'S', 'B', 'C']);
  assert.deepEqual(sg.symbols(graph).map((s) => s.sourceOrder), [0, 1, 2, 3]);

  assert.deepEqual(sg.references(graph).map((r) => r.node), useNodes(parsed));
  assert.deepEqual(sg.references(graph).map((r) => r.sourceOrder), [0, 1, 2]);
  assert.deepEqual(sg.resolutions(graph).map((r) => r.reference), sg.references(graph));

  // Two builds over the same parse agree exactly.
  const again = sg.buildScopeGraph(parsed);
  assert.deepEqual(sg.symbols(again).map((s) => s.name), sg.symbols(graph).map((s) => s.name));
  assert.deepEqual(sg.resolutions(again).map((r) => `${r.status}/${r.reason}`),
    sg.resolutions(graph).map((r) => `${r.status}/${r.reason}`));
});

test('query: returned collections cannot mutate graph state', () => {
  const { parsed, graph } = build(`${H}DEF Ball Shape { }\nGroup { children [ USE Ball ] }\n`);
  const symbol = sg.symbolFor(graph, defNodes(parsed, 'Ball')[0]);

  for (const list of [sg.scopes(graph), sg.symbols(graph), sg.references(graph),
    sg.resolutions(graph), sg.referencesTo(graph, symbol)]) {
    assert.equal(Object.isFrozen(list), true);
    assert.throws(() => list.push(null), TypeError);
    assert.throws(() => { list[0] = null; }, TypeError);
  }
  // Each call hands back a FRESH array, so one caller cannot starve another.
  assert.notEqual(sg.symbols(graph), sg.symbols(graph));
  assert.deepEqual(sg.symbols(graph), sg.symbols(graph));
  assert.equal(sg.referencesTo(graph, symbol).length, 1, 'state survived the attempts');
});

// ===========================================================================
// Boundaries: banned behaviour, and non-integration
// ===========================================================================

test('boundary: no ranking, scoring or nearest-match appears in the code', () => {
  // Asserted on CODE with comments and string literals stripped, because the
  // header quotes 4.6.2's "closest node ... preceding it" in order to explain
  // why the rule is deliberately not implemented.
  for (const file of ['scope-graph.js', 'symbols.js']) {
    const code = codeOnly(fs.readFileSync(path.join(SRC, file), 'utf8'));
    for (const banned of ['score', 'closest', 'nearest', 'bestMatch', 'fuzzy', 'similar']) {
      assert.equal(code.includes(banned), false, `${file} must not contain '${banned}' in code`);
    }
    // Nor any of WD1.4's permanently rejected identity strategies.
    for (const banned of ['fingerprint', 'structuralPath', 'siblingIndex']) {
      assert.equal(code.includes(banned), false, `${file} must not contain '${banned}'`);
    }
  }
});

test('boundary: no non-resolved answer anywhere carries a declaration', () => {
  // The behavioural form of the hard gate, swept over every shape at once.
  const sources = [
    `${H}Group { children [ USE Ball DEF Ball Shape { } ] }\n`,
    `${H}DEF Ball Shape { }\nDEF Ball Group { }\nGroup { children [ USE Ball ] }\n`,
    `${H}PROTO P [ ] { Group { children [ DEF In Shape { } ] } }\nGroup { children [ USE In ] }\n`,
    `${H}Group { children [ USE Ghost ] }\n`,
    `${H}DEF Loop Group { children [ USE Loop ] }\n`,
    `${H}DEF Foo Group { }\nPROTO P [ ] {\n  Shape { }\nDEF Foo Transform { }\n`
      + `Group { children [ USE Foo ] }\n`,
    `${H}PROTO [ ] { Group { children [ USE Ghost ] } }\nGroup { }\n`,
  ];
  let nonResolved = 0;
  for (const source of sources) {
    const { graph } = build(source);
    for (const r of sg.resolutions(graph)) {
      if (r.status === STATUS.RESOLVED) {
        assert.ok(r.symbol, 'a resolved answer must name its declaration');
        continue;
      }
      nonResolved += 1;
      assert.equal(r.symbol, null, `${r.status}/${r.reason} must not carry a declaration`);
      assert.ok(typeof r.reason === 'string' && r.reason.length > 0,
        'every answer carries a stable reason');
    }
  }
  assert.ok(nonResolved >= 7, `expected every refusal shape to be exercised, saw ${nonResolved}`);
});

test('boundary: node identity does not import the scope graph', () => {
  // WD1.4's contract is accepted and unchanged. Identity integration is a
  // separate approved lane (WD1.5-P5) and must not arrive as a side effect.
  for (const file of ['node-identity.js', 'document-transaction.js', 'analyze.js',
    'parser.js', 'tokenizer.js', 'ast.js', 'source-map.js', 'edit.js']) {
    const code = fs.readFileSync(path.join(SRC, file), 'utf8');
    assert.equal(/require\(['"]\.\/scope-graph['"]\)/.test(code), false,
      `${file} must not require scope-graph`);
    assert.equal(/require\(['"]\.\/symbols['"]\)/.test(code), false,
      `${file} must not require symbols`);
  }
});

test('boundary: the scope graph is not exposed through the facade in P1', () => {
  // Facade exposure and diagnostics wiring are WD1.5-P4. Until then the only
  // way in is the module itself, which keeps the surface a decision rather than
  // a convenience.
  const facade = require('../../src/vrml');
  assert.equal('scopeGraph' in facade, false);
  assert.equal('symbols' in facade, false);
  assert.equal('buildScopeGraph' in facade, false);
});

test('boundary: the scope graph never mutates the parse result', () => {
  const source = `${H}PROTO P [ ] { Group { children [ DEF In Shape { } USE In ] } }\n`
    + `Group { children [ DEF Ball Shape { } USE Ball ] }\n`;
  const parsed = parse(source);
  const before = JSON.stringify(parsed.tree);
  const diagnosticsBefore = JSON.stringify(parsed.syntaxDiagnostics);
  const graph = sg.buildScopeGraph(parsed);
  sg.resolutions(graph);
  assert.equal(JSON.stringify(parsed.tree), before);
  assert.equal(JSON.stringify(parsed.syntaxDiagnostics), diagnosticsBefore);
  // Freezing a parser range would be a mutation of the parse result, so ranges
  // are shared read-only by contract rather than frozen.
  assert.equal(Object.isFrozen(parsed.tree), false);
});
