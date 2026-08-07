'use strict';
// VRML97 node-type (PROTO / EXTERNPROTO) resolution tests (Phase WD1.5-P2A).
//
// A SEPARATE FILE from `scope-graph.test.js` on purpose. That file is the DEF/USE
// suite, and its value is partly that it did not change when this lane landed --
// a P1 regression shows up there as a failure rather than as a merge conflict in
// a file both lanes edit. The two namespaces are kept apart in the code, in the
// API and here.
//
// As in P1, most of what follows asserts a REFUSAL, and every positive case
// proves WHICH declaration came back by object identity against the exact AST
// node located by an independent walk -- never merely that something did.
//
// Fixtures are authored here as string literals, original to this lane. Nothing
// under `spikes/` is imported: a production test graded against the research
// prototype would be checking one implementation against another instead of
// against the standard.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { parse, ast } = require('../../src/vrml');
const sg = require('../../src/vrml/scope-graph');
const sym = require('../../src/vrml/symbols');
const nodeSchema = require('../../src/vrml/node-schema');

const { STATUS, REASON, SCOPE_KIND, SCOPE_ERROR, SYMBOL_KIND, NAMESPACE } = sg;

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

/** Every AST node instance, in source order, found by an independent walk. */
function instanceNodes(parsed) {
  const out = [];
  ast.walk(parsed.tree, (n) => { if (n.type === ast.NODE.NODE) out.push(n); });
  return out.sort((a, b) => a.range.start.offset - b.range.start.offset);
}

/** Every AST `Proto`/`ExternProto` declaring `name`, in source order. */
function declNodes(parsed, name) {
  const out = [];
  ast.walk(parsed.tree, (n) => {
    if ((n.type === ast.NODE.PROTO || n.type === ast.NODE.EXTERNPROTO) && n.name === name) out.push(n);
  });
  return out.sort((a, b) => a.range.start.offset - b.range.start.offset);
}

/** Resolve the nth (1-based) instance of type `name`. */
function resolveType(parsed, graph, name, nth = 1) {
  const node = instanceNodes(parsed).filter((n) => n.nodeType === name)[nth - 1];
  assert.ok(node, `fixture must contain a ${name} instance #${nth}`);
  const reference = sg.typeReferenceFor(graph, node);
  assert.ok(reference, `the graph must hold a type reference for ${name} #${nth}`);
  return sg.resolve(graph, reference);
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

// Strip ONLY comments, keeping string literals intact.
//
// `codeOnly` above also removes string literals, which is right when the banned
// word would be a bare identifier but WRONG for a scan that looks for a
// hard-coded `'Transform'`: a real hard-coded table lives inside string literals,
// so stripping them would make the check vacuous and pass the exact thing it
// exists to catch.
function withoutComments(source) {
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
      out += c;
      i += 1;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') { out += source[i]; i += 1; }
        out += source[i];
        i += 1;
      }
      out += quote;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// ===========================================================================
// 1-4  Namespace separation
// ===========================================================================

test('namespace: a DEF name and a PROTO type name may share one spelling', () => {
  // The three-namespace rule (4.6.2 vs 4.8.1) in its most direct form. A single
  // shared name map would make these two collide, and each would then be
  // reported as a duplicate of the other.
  const source = `${H}PROTO Ball [ ] { Sphere { } }\n`
    + `Group { children [ DEF Ball Ball { } USE Ball ] }\n`;
  const { parsed, graph } = build(source);

  const decls = sg.typeDeclarations(graph);
  assert.equal(decls.length, 1);
  assert.equal(decls[0].namespace, NAMESPACE.NODE_TYPE);
  const defs = sg.symbols(graph).filter((s) => s.name === 'Ball');
  assert.equal(defs.length, 1);
  assert.equal(defs[0].namespace, NAMESPACE.NODE_NAME);

  // Both resolve, each in its own namespace, neither ambiguous.
  expectStatus(resolveType(parsed, graph, 'Ball'), STATUS.RESOLVED, REASON.OK);
  const use = [];
  ast.walk(parsed.tree, (n) => { if (n.type === ast.NODE.USE) use.push(n); });
  expectStatus(sg.resolve(graph, use[0]), STATUS.RESOLVED, REASON.OK);

  assert.equal(sg.typeDeclIsUniqueInScope(graph, decls[0]).unique, true);
  assert.equal(sg.defIsUniqueInScope(graph, defs[0]).unique, true);
});

test('namespace: field names never enter the type namespace', () => {
  const source = `${H}Transform { translation 1 2 3 children [ Shape { } ] }\n`;
  const { graph } = build(source);
  const names = sg.typeReferences(graph).map((r) => r.name);
  assert.deepEqual(names, ['Transform', 'Shape']);
  assert.equal(names.includes('translation'), false);
  assert.equal(names.includes('children'), false);
  assert.equal(sg.typeDeclarations(graph).length, 0);
});

test('namespace: interface member names never enter the type namespace', () => {
  // P2A declares NO interface members at all -- that is P2B. What matters here
  // is only that they are not mistaken for type declarations.
  const source = `${H}PROTO P [ field SFNode geometry NULL\n`
    + `  eventIn SFBool set_on\n  exposedField SFColor tint 1 1 1 ] { Box { } }\nP { }\n`;
  const { parsed, graph } = build(source);
  assert.deepEqual(sg.typeDeclarations(graph).map((d) => d.name), ['P']);
  expectStatus(resolveType(parsed, graph, 'P'), STATUS.RESOLVED, REASON.OK);
});

test('namespace: a built-in resolves through the schema, not a lexical lookup', () => {
  const { parsed, graph } = build(`${H}Group { children [ Shape { } ] }\n`);
  const res = resolveType(parsed, graph, 'Shape');
  expectStatus(res, STATUS.RESOLVED, REASON.NODE_TYPE_IS_BUILTIN);
  // A schema fact names no declaration and no scope owns it.
  assert.equal(res.symbol, null);
  assert.equal(res.candidateCount, 0);
  assert.equal(sg.typeDeclarations(graph).length, 0);
  assert.equal(nodeSchema.isVRML97Node('Shape'), true);
});

// ===========================================================================
// 5-17  Basic PROTO resolution
// ===========================================================================

test('proto: a declaration followed by an instance binds that exact declaration', () => {
  const source = `${H}PROTO Cube [ ] { Box { } }\nShape { geometry Cube { } }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'Cube');
  expectStatus(res, STATUS.RESOLVED, REASON.OK);
  // Object identity against the declaration found by an independent walk.
  assert.equal(res.symbol.node, declNodes(parsed, 'Cube')[0]);
  assert.equal(res.symbol.kind, SYMBOL_KIND.PROTO_DECL);
  assert.equal(res.symbol.isExtern, false);
});

test('proto: an instance before the declaration is invalid, not resolved', () => {
  // 4.8.4 -- instantiable only AFTER the completion of the definition. There is
  // no forward reference, and answering `resolved` here would be a confidently
  // wrong binding of exactly the kind the hard gate forbids.
  const source = `${H}Shape { geometry Cube { } }\nPROTO Cube [ ] { Box { } }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'Cube');
  expectStatus(res, STATUS.INVALID, REASON.PROTO_INSTANCE_BEFORE_DECLARATION);
  assert.equal(res.symbol, null);
});

test('proto: an instance of a prototype inside its own body is invalid', () => {
  // 4.8.4 -- "recursive prototypes are illegal". Checked BEFORE the ordering
  // rule, which would otherwise always win: a definition is never complete
  // inside itself.
  const source = `${H}PROTO Rec [ ] { Group { children [ Rec { } ] } }\nGroup { }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'Rec');
  expectStatus(res, STATUS.INVALID, REASON.RECURSIVE_PROTO_INSTANCE);
  assert.equal(res.symbol, null);
  assert.equal(res.evidence.length, 1);
});

test('proto: a declaration becomes visible at its END, not at its name', () => {
  // 4.8.4 says "after the completion of the prototype definition" -- a DIFFERENT
  // rule from 4.6.2's DEF visibility, which starts at the name token. The two
  // almost always agree, because an instance sitting between a declaration's
  // name and its closing brace is enclosed by it and the recursion rule answers
  // first. Almost is not always, so the boundary is pinned directly.
  const source = `${H}PROTO Cube [ ] { Box { } }\nShape { geometry Cube { } }\n`;
  const { parsed, graph } = build(source);
  const decl = sg.typeDeclFor(graph, declNodes(parsed, 'Cube')[0]);
  const declAst = declNodes(parsed, 'Cube')[0];
  assert.equal(decl.visibleFrom, declAst.range.end.offset);
  assert.notEqual(decl.visibleFrom, declAst.range.start.offset);
  // An instance beginning exactly at the declaration's end is legal: `<=`, not
  // `<`, because completion is the whole requirement.
  const ref = sg.typeReferenceFor(graph, instanceNodes(parsed).find((n) => n.nodeType === 'Cube'));
  assert.ok(ref.offset >= decl.visibleFrom);
});

test('proto: mutual recursion is answered by the ordering rule, not by guessing', () => {
  // A cannot instantiate B before B's declaration completes; B may instantiate
  // A, whose declaration is complete and which does not enclose it. Neither
  // answer is a nearest-declaration pick: both fall straight out of 4.8.4.
  const source = `${H}PROTO A [ ] { B { } }\nPROTO B [ ] { A { } }\nGroup { }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveType(parsed, graph, 'B'), STATUS.INVALID,
    REASON.PROTO_INSTANCE_BEFORE_DECLARATION);
  const back = resolveType(parsed, graph, 'A');
  expectStatus(back, STATUS.RESOLVED, REASON.OK);
  assert.equal(back.symbol.node, declNodes(parsed, 'A')[0]);
});

test('proto: duplicate declarations in one scope are ambiguous, never narrowed', () => {
  const source = `${H}PROTO Cube [ ] { Box { } }\nPROTO Cube [ ] { Sphere { } }\n`
    + `Shape { geometry Cube { } }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'Cube');
  expectStatus(res, STATUS.AMBIGUOUS, REASON.DUPLICATE_PROTO_DECLARATION);
  assert.equal(res.symbol, null);
  assert.equal(res.candidateCount, 2);
  for (const d of sg.typeDeclarations(graph)) {
    const u = sg.typeDeclIsUniqueInScope(graph, d);
    assert.equal(u.unique, false);
    assert.equal(u.reason, REASON.DUPLICATE_PROTO_DECLARATION);
  }
});

test('proto: duplicates with structurally different bodies stay ambiguous', () => {
  // The bodies differ in field count, node type and interface -- none of which
  // may be used to pick a winner. Ambiguity is decided on the NAME ALONE.
  const source = `${H}PROTO Thing [ ] { Box { size 1 1 1 } }\n`
    + `PROTO Thing [ field SFBool on TRUE ] { Group { children [ Sphere { } Cone { } ] } }\n`
    + `Thing { }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveType(parsed, graph, 'Thing'), STATUS.AMBIGUOUS,
    REASON.DUPLICATE_PROTO_DECLARATION);
});

test('proto: a reference inside an ordinary node field resolves', () => {
  const source = `${H}PROTO Skin [ ] { Material { } }\n`
    + `Shape { appearance Appearance { material Skin { } } }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'Skin');
  expectStatus(res, STATUS.RESOLVED, REASON.OK);
  assert.equal(res.symbol.node, declNodes(parsed, 'Skin')[0]);
});

test('proto: a reference inside MFNode content resolves', () => {
  const source = `${H}PROTO Knob [ ] { Sphere { } }\n`
    + `Group { children [ Transform { children [ Knob { } ] } ] }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'Knob');
  expectStatus(res, STATUS.RESOLVED, REASON.OK);
  assert.equal(res.symbol.node, declNodes(parsed, 'Knob')[0]);
});

test('proto: a reference inside a PROTO body sees the enclosing declaration', () => {
  // Rule P6: 4.8.4 restricts where a nested declaration is VISIBLE without
  // blinding a nested body to its enclosing ones. Type lookup walks OUTWARD --
  // the opposite of DEF/USE, which stops dead at the same boundary.
  const source = `${H}PROTO Knob [ ] { Sphere { } }\n`
    + `PROTO Panel [ ] { Group { children [ Knob { } ] } }\nGroup { }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'Knob');
  expectStatus(res, STATUS.RESOLVED, REASON.OK);
  assert.equal(res.symbol.node, declNodes(parsed, 'Knob')[0]);
  // And the reference really is inside the PROTO body scope, not the document.
  assert.equal(res.reference.scope.kind, SCOPE_KIND.PROTO_BODY);
});

test('proto: an undeclared ProtoInstance name is unresolved, not invented', () => {
  const source = `${H}Shape { geometry NeverDeclared { } }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'NeverDeclared');
  expectStatus(res, STATUS.UNRESOLVED, REASON.NODE_TYPE_UNKNOWN);
  assert.equal(res.symbol, null);
});

test('proto: a hyphenated type name is an ordinary name', () => {
  // Annex A `IdRestChars` admits `-` after the first character, so this is
  // CONFORMING VRML97, not a compatibility item.
  const source = `${H}PROTO arm-left [ ] { Box { } }\nShape { geometry arm-left { } }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'arm-left');
  expectStatus(res, STATUS.RESOLVED, REASON.OK);
  assert.equal(res.symbol.node, declNodes(parsed, 'arm-left')[0]);
});

test('proto: a type name containing "/" cannot collide with a nested one', () => {
  // Annex A defines `Id` by EXCLUSION, so `/` is legal inside an identifier.
  // WD1.4 found a real wrong anchor from a `/`-joined scope key, because
  // `PROTO A/B` and `PROTO A { PROTO B }` spell the same joined string. Scopes
  // are object identities here, so the two cannot meet.
  const flat = `${H}PROTO A/B [ ] { Box { } }\nShape { geometry A/B { } }\n`;
  const nested = `${H}PROTO A [ ] { PROTO B [ ] { Box { } } Shape { geometry B { } } }\nGroup { }\n`;

  const one = build(flat);
  assert.deepEqual(sg.typeDeclarations(one.graph).map((d) => d.name), ['A/B']);
  expectStatus(resolveType(one.parsed, one.graph, 'A/B'), STATUS.RESOLVED, REASON.OK);

  const two = build(nested);
  assert.deepEqual(sg.typeDeclarations(two.graph).map((d) => d.name), ['A', 'B']);
  const inner = resolveType(two.parsed, two.graph, 'B');
  expectStatus(inner, STATUS.RESOLVED, REASON.OK);
  assert.equal(inner.symbol.node, declNodes(two.parsed, 'B')[0]);
  // The nested B is owned by A's body scope, never by the document scope.
  assert.equal(inner.symbol.scope.kind, SCOPE_KIND.PROTO_BODY);
});

test('proto: a vendor node type is preserved and explicitly unresolved', () => {
  // Unknown types must survive as a first-class answer. Turning one into a
  // parse error, or silently treating it as a built-in, would break the real
  // Cybertown corpus, where vendor types are common.
  const source = `${H}Group { children [ DEF Vend BlaxxunAvatar { } USE Vend ] }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveType(parsed, graph, 'BlaxxunAvatar'), STATUS.UNRESOLVED,
    REASON.NODE_TYPE_UNKNOWN);
  // And it still participates in DEF/USE exactly as a standard type does.
  const uses = [];
  ast.walk(parsed.tree, (n) => { if (n.type === ast.NODE.USE) uses.push(n); });
  expectStatus(sg.resolve(graph, uses[0]), STATUS.RESOLVED, REASON.OK);
});

// ===========================================================================
// 18-25  Nested and disjoint type scopes
// ===========================================================================

test('scope: a nested declaration is usable inside its enclosing body', () => {
  const source = `${H}PROTO Outer [ ] {\n  PROTO Knob [ ] { Sphere { } }\n`
    + `  Shape { geometry Knob { } }\n}\nGroup { }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'Knob');
  expectStatus(res, STATUS.RESOLVED, REASON.OK);
  assert.equal(res.symbol.node, declNodes(parsed, 'Knob')[0]);
});

test('scope: the same nested name in two outer PROTOs does not collide', () => {
  const source = `${H}PROTO A [ ] { PROTO Knob [ ] { Sphere { } } Shape { geometry Knob { } } }\n`
    + `PROTO B [ ] { PROTO Knob [ ] { Box { } } Shape { geometry Knob { } } }\nGroup { }\n`;
  const { parsed, graph } = build(source);
  const inA = resolveType(parsed, graph, 'Knob', 1);
  const inB = resolveType(parsed, graph, 'Knob', 2);
  expectStatus(inA, STATUS.RESOLVED, REASON.OK);
  expectStatus(inB, STATUS.RESOLVED, REASON.OK);
  // Each binds ITS OWN declaration -- proven by identity, not by count.
  assert.equal(inA.symbol.node, declNodes(parsed, 'Knob')[0]);
  assert.equal(inB.symbol.node, declNodes(parsed, 'Knob')[1]);
  assert.notEqual(inA.symbol, inB.symbol);
  assert.notEqual(inA.symbol.scope, inB.symbol.scope);
  for (const d of sg.typeDeclarations(graph).filter((s) => s.name === 'Knob')) {
    assert.equal(sg.typeDeclIsUniqueInScope(graph, d).unique, true);
  }
});

test('scope: a nested declaration does not escape its containing type scope', () => {
  const source = `${H}PROTO Outer [ ] { PROTO Knob [ ] { Sphere { } } Shape { } }\n`
    + `Shape { geometry Knob { } }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveType(parsed, graph, 'Knob'), STATUS.UNRESOLVED, REASON.NODE_TYPE_UNKNOWN);
});

test('scope: one outer PROTO cannot see another outer PROTO\'s nested declaration', () => {
  const source = `${H}PROTO A [ ] { PROTO Knob [ ] { Sphere { } } Shape { } }\n`
    + `PROTO B [ ] { Shape { geometry Knob { } } }\nGroup { }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveType(parsed, graph, 'Knob'), STATUS.UNRESOLVED, REASON.NODE_TYPE_UNKNOWN);
});

test('scope: type visibility follows typeParent exactly', () => {
  const source = `${H}PROTO Knob [ ] { Sphere { } }\n`
    + `PROTO Panel [ ] { Group { children [ Knob { } ] } }\nGroup { }\n`;
  const { graph } = build(source);
  const body = sg.scopes(graph).find((s) => s.kind === SCOPE_KIND.PROTO_BODY
    && s.ownerName === 'Panel');
  assert.equal(body.typeParent, sg.documentScope(graph));
  // The chain is exactly one step long and ends at the document scope.
  assert.equal(body.typeParent.typeParent, null);
});

test('scope: defParent is never consulted for a type lookup', () => {
  // A PROTO body has `defParent === null` (4.8.4 disjointness) yet still sees
  // enclosing TYPE declarations. If type lookup walked `defParent` it would
  // terminate immediately and this would answer `unresolved`.
  const source = `${H}PROTO Knob [ ] { Sphere { } }\n`
    + `PROTO Panel [ ] { Group { children [ DEF Inner Knob { } ] } }\n`
    + `Group { children [ DEF Outer Shape { } ] }\n`;
  const { parsed, graph } = build(source);
  const body = sg.scopes(graph).find((s) => s.ownerName === 'Panel');
  assert.equal(body.defParent, null);
  assert.notEqual(body.typeParent, null);
  expectStatus(resolveType(parsed, graph, 'Knob'), STATUS.RESOLVED, REASON.OK);
});

test('scope: scope identity does not depend on declaration names', () => {
  // Two PROTOs with the SAME name produce two DISTINCT scope objects. A scope
  // keyed by name -- or by a delimiter-joined path of names -- would merge them.
  const source = `${H}PROTO P [ ] { PROTO Q [ ] { Box { } } Shape { geometry Q { } } }\n`
    + `PROTO P [ ] { PROTO Q [ ] { Sphere { } } Shape { geometry Q { } } }\nGroup { }\n`;
  const { parsed, graph } = build(source);
  const bodies = sg.scopes(graph).filter((s) => s.kind === SCOPE_KIND.PROTO_BODY);
  assert.equal(bodies.length, 4);
  assert.equal(new Set(bodies).size, 4);
  // Each nested Q binds inside its own P, even though both Ps are called P.
  const first = resolveType(parsed, graph, 'Q', 1);
  const second = resolveType(parsed, graph, 'Q', 2);
  assert.equal(first.symbol.node, declNodes(parsed, 'Q')[0]);
  assert.equal(second.symbol.node, declNodes(parsed, 'Q')[1]);
  // The two outer Ps ARE a duplicate of each other, in the document scope.
  const ps = sg.typeDeclarations(graph).filter((d) => d.name === 'P');
  assert.equal(ps.length, 2);
  assert.equal(sg.typeDeclIsUniqueInScope(graph, ps[0]).unique, false);
});

test('scope: an unnamed PROTO cannot create a scope or a name collision', () => {
  const source = `${H}PROTO [ ] { Box { } }\nPROTO [ ] { Sphere { } }\nGroup { }\n`;
  const { graph } = build(source);
  const unnamed = sg.typeDeclarations(graph).filter((d) => d.name === null);
  assert.equal(unnamed.length, 2);
  // A nameless declaration enters no name map, so it can neither be found nor
  // collide -- and its own body scope fails closed structurally.
  for (const body of sg.scopes(graph).filter((s) => s.kind === SCOPE_KIND.PROTO_BODY)) {
    assert.equal(body.ownerName, null);
    assert.equal(body.recovered, true);
    assert.equal(body.recoveredReason, REASON.PROTO_SCOPE_NOT_PROVABLE);
  }
  for (const d of unnamed) {
    assert.equal(sg.typeDeclIsUniqueInScope(graph, d).unique, false);
  }
});

// ===========================================================================
// 26-32  EXTERNPROTO
// ===========================================================================

test('externproto: a declaration followed by an instance binds it', () => {
  const source = `${H}EXTERNPROTO Gold [ ] "materials.wrl#Gold"\n`
    + `Shape { appearance Appearance { material Gold { } } }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'Gold');
  expectStatus(res, STATUS.RESOLVED, REASON.OK);
  assert.equal(res.symbol.kind, SYMBOL_KIND.EXTERNPROTO_DECL);
  assert.equal(res.symbol.isExtern, true);
  assert.equal(res.symbol.node, declNodes(parsed, 'Gold')[0]);
});

test('externproto: an instance before the declaration is invalid', () => {
  const source = `${H}Shape { appearance Appearance { material Gold { } } }\n`
    + `EXTERNPROTO Gold [ ] "materials.wrl#Gold"\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveType(parsed, graph, 'Gold'), STATUS.INVALID,
    REASON.PROTO_INSTANCE_BEFORE_DECLARATION);
});

test('externproto: duplicate declarations are ambiguous', () => {
  const source = `${H}EXTERNPROTO Gold [ ] "a.wrl#Gold"\n`
    + `EXTERNPROTO Gold [ ] "b.wrl#Gold"\nGold { }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveType(parsed, graph, 'Gold'), STATUS.AMBIGUOUS,
    REASON.DUPLICATE_PROTO_DECLARATION);
});

test('externproto: a PROTO and an EXTERNPROTO of one name are duplicates', () => {
  // 4.8.1 + 4.9.1 -- both declare into the node-type namespace. The duplicate is
  // NOT resolved by preferring one KIND over the other; that would be exactly
  // the narrowing the hard gate forbids.
  const source = `${H}PROTO Gold [ ] { Material { } }\n`
    + `EXTERNPROTO Gold [ ] "materials.wrl#Gold"\nGold { }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveType(parsed, graph, 'Gold'), STATUS.AMBIGUOUS,
    REASON.DUPLICATE_PROTO_DECLARATION);
  const kinds = sg.typeDeclarations(graph).map((d) => d.kind).sort();
  assert.deepEqual(kinds, [SYMBOL_KIND.EXTERNPROTO_DECL, SYMBOL_KIND.PROTO_DECL].sort());
  for (const d of sg.typeDeclarations(graph)) {
    assert.equal(sg.typeDeclIsUniqueInScope(graph, d).unique, false);
  }
});

test('externproto: the url is never read, resolved or followed', () => {
  // P2A answers the declaration NAME and nothing else. A remote or relative URL
  // is data on the AST node, never an input to resolution.
  const source = `${H}EXTERNPROTO Gold [ ] [ "http://example.invalid/m.wrl#Gold" "m.wrl#Gold" ]\n`
    + `Gold { }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveType(parsed, graph, 'Gold'), STATUS.RESOLVED, REASON.OK);
  const decl = sg.typeDeclarations(graph)[0];
  // No URL, no fetched interface, no external parse result is retained.
  assert.equal('url' in decl, false);
  assert.equal('interfaces' in decl, false);
  assert.equal('members' in decl, false);
  // The module reaches for no network or filesystem capability at all.
  const code = fs.readFileSync(path.join(SRC, 'scope-graph.js'), 'utf8');
  for (const banned of ['require(\'fs\')', 'require("fs")', 'fetch(', 'XMLHttpRequest', 'http']) {
    assert.equal(code.includes(banned), false, `scope-graph.js must not reference ${banned}`);
  }
});

test('externproto: P2A claims no interface knowledge', () => {
  // 4.9.2 -- an EXTERNPROTO interface is a SUBSET of the real implementation's,
  // so local silence about a member is UNKNOWABLE, never authoritative absence.
  // The flag exists so a later lane cannot mistake one for the other.
  const source = `${H}EXTERNPROTO Gold [ field SFColor tint 1 1 1 ] "m.wrl#Gold"\n`
    + `PROTO Local [ field SFColor tint 1 1 1 ] { Material { } }\nGold { }\nLocal { }\n`;
  const { graph } = build(source);
  const [ext, local] = sg.typeDeclarations(graph);
  assert.equal(ext.interfaceIsSubset, true);
  assert.equal(local.interfaceIsSubset, false);
  // Neither carries members: interface declarations are WD1.5-P2B.
  for (const d of sg.typeDeclarations(graph)) {
    for (const absent of ['interfaces', 'members', 'fields', 'events']) {
      assert.equal(absent in d, false, `a P2A type symbol must not carry ${absent}`);
    }
  }
});

test('externproto: a resolved answer reports the declaration kind correctly', () => {
  const source = `${H}PROTO A [ ] { Box { } }\nEXTERNPROTO B [ ] "b.wrl#B"\nA { }\nB { }\n`;
  const { parsed, graph } = build(source);
  assert.equal(resolveType(parsed, graph, 'A').symbol.kind, SYMBOL_KIND.PROTO_DECL);
  assert.equal(resolveType(parsed, graph, 'B').symbol.kind, SYMBOL_KIND.EXTERNPROTO_DECL);
});

// ===========================================================================
// 33-37  Built-in interaction
// ===========================================================================

test('builtin: an ordinary built-in resolves through the committed schema', () => {
  const { parsed, graph } = build(`${H}Transform { children [ Shape { } ] }\n`);
  for (const name of ['Transform', 'Shape']) {
    expectStatus(resolveType(parsed, graph, name), STATUS.RESOLVED, REASON.NODE_TYPE_IS_BUILTIN);
  }
});

test('builtin: an X3D-only type does not silently become a VRML97 built-in', () => {
  // The committed WD1.3 schema carries 54 nodes, ALL of them shared VRML97/X3D;
  // its X3D-only content is 232 FIELDS, not nodes. So an X3D node name that is
  // not in VRML97 is simply unknown here -- which is the correct strict answer,
  // and is reached without P2A holding a second list of its own.
  const { parsed, graph } = build(`${H}Group { children [ MetadataString { } ] }\n`);
  assert.equal(nodeSchema.isVRML97Node('MetadataString'), false);
  assert.equal(nodeSchema.getNodeSchema('MetadataString'), null);
  expectStatus(resolveType(parsed, graph, 'MetadataString'), STATUS.UNRESOLVED,
    REASON.NODE_TYPE_UNKNOWN);
  // The schema's own accounting, asserted rather than assumed.
  assert.equal(nodeSchema.listNodeNames({ profile: 'vrml97' }).length,
    nodeSchema.listNodeNames().length);
});

test('builtin: a local declaration with a built-in spelling wins, and is flagged', () => {
  // 4.8.1 calls this undefined behaviour. The lexical declaration is what the
  // file actually says, so it takes the binding; the collision is reported as a
  // `detail`, which never changes the status, the reason or the declaration.
  const source = `${H}PROTO Box [ ] { Sphere { } }\nShape { geometry Box { } }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'Box');
  expectStatus(res, STATUS.RESOLVED, REASON.OK);
  assert.equal(res.detail, REASON.PROTO_SHADOWS_BUILTIN);
  assert.equal(res.symbol.node, declNodes(parsed, 'Box')[0]);
});

test('builtin: duplicate declarations are not narrowed using built-in status', () => {
  // One duplicate shadows a built-in and the other does not. A resolver that
  // used built-in status as a tiebreak would return one of them; there is no
  // tiebreak, so the answer is ambiguous.
  const source = `${H}PROTO Box [ ] { Sphere { } }\nPROTO Box [ ] { Cone { } }\nBox { }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'Box');
  expectStatus(res, STATUS.AMBIGUOUS, REASON.DUPLICATE_PROTO_DECLARATION);
  assert.equal(res.symbol, null);
  assert.equal(res.detail, null);
});

test('builtin: an unknown vendor name is not confused with a missing declaration', () => {
  // Both answer `unresolved / node-type-unknown`, and that is deliberate: P2A
  // cannot tell "a vendor extension" from "a PROTO the author forgot to write",
  // and inventing a distinction it cannot prove would be a guess. What it CAN
  // prove -- that a declaration exists but is not yet visible -- gets its own
  // status, and that separation is what matters.
  const vendor = build(`${H}Group { children [ BlaxxunAvatar { } ] }\n`);
  const missing = build(`${H}Group { children [ Forgotten { } ] }\n`);
  const later = build(`${H}Group { children [ Later { } ] }\nPROTO Later [ ] { Box { } }\n`);
  expectStatus(resolveType(vendor.parsed, vendor.graph, 'BlaxxunAvatar'),
    STATUS.UNRESOLVED, REASON.NODE_TYPE_UNKNOWN);
  expectStatus(resolveType(missing.parsed, missing.graph, 'Forgotten'),
    STATUS.UNRESOLVED, REASON.NODE_TYPE_UNKNOWN);
  expectStatus(resolveType(later.parsed, later.graph, 'Later'),
    STATUS.INVALID, REASON.PROTO_INSTANCE_BEFORE_DECLARATION);
});

// ===========================================================================
// 38-44  Recovery -- the hard gate
// ===========================================================================

test('recovery: a damaged document type scope withholds local answers', () => {
  const source = `${H}PROTO Q [ ] { Box { } }\nGroup { children [ ] }\n)\nQ { }\n`;
  const { parsed, graph } = build(source);
  assert.ok(parsed.syntaxDiagnostics.some((d) => d.severity === 'error'),
    'fixture must actually produce a syntax error');
  assert.equal(sg.documentScope(graph).recovered, true);
  expectStatus(resolveType(parsed, graph, 'Q'), STATUS.RECOVERED, REASON.SCOPE_RECOVERED);
});

test('recovery: a damaged PROTO type scope withholds local answers', () => {
  // The P1 absorption failure, in the node-type namespace. An unclosed PROTO
  // swallows the following statements, so the absorbed body sees a declaration
  // set that never existed. A partial tree can prove a declaration EXISTS; it
  // cannot prove WHICH SCOPE owns it, and that is the whole question.
  const source = `${H}PROTO Q [ ] { Box { } }\nPROTO P [ ] { Shape { }\nQ { }\n`;
  const { parsed, graph } = build(source);
  const absorbed = sg.scopes(graph).find((s) => s.ownerName === 'P');
  assert.equal(absorbed.recovered, true);
  expectStatus(resolveType(parsed, graph, 'Q'), STATUS.RECOVERED, REASON.SCOPE_RECOVERED);
});

test('recovery: a surviving declaration does not resolve from a damaged scope', () => {
  // The declaration is intact and visible in the chain; the answer is still
  // withheld, because the scope that would own the binding is unprovable. A
  // positive result is exactly as untrustworthy as a negative one here.
  const source = `${H}PROTO Q [ ] { Box { } }\nPROTO P [ ] { Shape { }\nQ { }\n`;
  const { parsed, graph } = build(source);
  const decl = sg.typeDeclarations(graph).find((d) => d.name === 'Q');
  assert.ok(decl, 'the declaration must still be present in the partial tree');
  const res = resolveType(parsed, graph, 'Q');
  assert.equal(res.status, STATUS.RECOVERED);
  assert.equal(res.symbol, null);
  // And it is excluded from the declaration's authoritative reference list.
  assert.equal(sg.referencesTo(graph, decl).length, 0);
});

test('recovery: a clean scope cannot borrow a declaration from a damaged one', () => {
  // BOTH ends of the binding must be provable, not just the reference's end.
  // Here the reference sits in an undamaged PROTO body and the declaration it
  // would bind lives in the damaged DOCUMENT scope it reaches through
  // `typeParent`. Trusting that would be trusting a scope the model has already
  // admitted it cannot prove -- so the answer is withheld from the far side too.
  const source = `${H}PROTO Knob [ ] { Sphere { } }\n`
    + `Group { children [ ) ] }\n`
    + `PROTO Clean [ ] { Group { children [ Knob { } ] } }\n`;
  const { parsed, graph } = build(source);
  const clean = sg.scopes(graph).find((s) => s.ownerName === 'Clean');
  assert.equal(sg.documentScope(graph).recovered, true, 'the declaration side must be damaged');
  assert.equal(clean.recovered, false, 'the reference side must be undamaged');
  const res = resolveType(parsed, graph, 'Knob');
  expectStatus(res, STATUS.RECOVERED, REASON.SCOPE_RECOVERED);
  assert.equal(res.symbol, null);
});

test('recovery: damage does not leak a nested declaration outward', () => {
  const source = `${H}PROTO Outer [ ] { PROTO Knob [ ] { Sphere { } } Shape { }\n`
    + `Knob { }\n`;
  const { parsed, graph } = build(source);
  const knobDecl = sg.typeDeclarations(graph).find((d) => d.name === 'Knob');
  // The nested declaration still belongs to Outer's body, never to the document.
  assert.equal(knobDecl.scope.kind, SCOPE_KIND.PROTO_BODY);
  assert.notEqual(knobDecl.scope, sg.documentScope(graph));
  const res = resolveType(parsed, graph, 'Knob');
  assert.equal(res.symbol, null);
  assert.ok([STATUS.RECOVERED, STATUS.UNRESOLVED].includes(res.status),
    `expected a withheld answer, got ${res.status}/${res.reason}`);
});

test('recovery: a hard parse cap withholds every lexical type answer', () => {
  const source = `${H}PROTO Q [ ] { Box { } }\n`
    + `Group { children [ Group { children [ Group { children [ Q { } ] } ] } ] }\n`;
  const { parsed, graph } = build(source, { maxDepth: 2 });
  assert.equal(parsed.depthCapped || parsed.truncated, true, 'fixture must hit a cap');
  const res = resolveType(parsed, graph, 'Q');
  expectStatus(res, STATUS.RECOVERED, REASON.DOCUMENT_PARSE_INCOMPLETE);
  for (const d of sg.typeDeclarations(graph)) {
    const u = sg.typeDeclIsUniqueInScope(graph, d);
    assert.equal(u.unique, false);
    assert.equal(u.reason, REASON.DOCUMENT_PARSE_INCOMPLETE);
  }
});

test('recovery: schema authority survives, occurrence binding does not', () => {
  // The two claims a built-in spelling can carry, and why only one survives
  // damage:
  //
  //   * "`Group` is a clause-6 built-in SPELLING" -- no scope dependency, still
  //     authoritative, answered by the committed schema and by nothing else.
  //   * "THIS occurrence denotes the built-in" -- asserts that no `PROTO Group`
  //     is in scope, which 4.8.1 expressly permits. That is a lexical absence
  //     claim, and a capped parse cannot support it.
  //
  // The WD1.5 plan's §7 "schema resolutions are exempt" carve-out is about the
  // first claim only; P2A originally applied it to the second.
  const source = `${H}PROTO Q [ ] { Box { } }\n`
    + `Group { children [ Group { children [ Group { children [ Q { } Shape { } ] } ] } ] }\n`;
  const { parsed, graph } = build(source, { maxDepth: 2 });
  expectStatus(resolveType(parsed, graph, 'Group'),
    STATUS.RECOVERED, REASON.DOCUMENT_PARSE_INCOMPLETE);
  expectStatus(resolveType(parsed, graph, 'Q'),
    STATUS.RECOVERED, REASON.DOCUMENT_PARSE_INCOMPLETE);
  // ...and the schema itself is untouched by any of it.
  assert.equal(nodeSchema.isVRML97Node('Group'), true);
  assert.equal(nodeSchema.isVRML97Node('Q'), false);
});

test('recovery: a built-in spelling in a damaged scope withholds the binding', () => {
  // The damaged scope is exactly where a shadowing `PROTO Transform` would live.
  // Returning `resolved / node-type-is-builtin` here is a confident claim that
  // no such declaration exists, made from a tree that cannot show one.
  const source = `${H}Group { children [ Shape { }\nTransform { }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveType(parsed, graph, 'Transform'),
    STATUS.RECOVERED, REASON.SCOPE_RECOVERED);
  assert.equal(nodeSchema.isVRML97Node('Transform'), true,
    'the schema fact is unaffected by the surrounding damage');
});

test('recovery: a clean scope whose typeParent chain is damaged withholds too', () => {
  // The case a scope-local guard cannot see. `Inner`'s own body scope parses
  // clean, so checking only "is MY scope recovered?" is satisfied -- but a type
  // lookup WALKS OUTWARD (4.8.4 P6) into the damaged document scope, and a
  // `PROTO Transform` there would have won. A DEF lookup has no equivalent
  // exposure: `defParent` is null on a proto body, so it never leaves its scope.
  const source = `${H}Group { children [ Shape { }\n`
    + `PROTO Inner [ ] { Transform { } }\nInner { }\n`;
  const { parsed, graph } = build(source);
  const inner = sg.scopes(graph).find((s) => s.ownerName === 'Inner');
  assert.equal(inner.recovered, false,
    'the inner scope really is provable -- that is what makes this the hard case');
  expectStatus(resolveType(parsed, graph, 'Transform'),
    STATUS.RECOVERED, REASON.SCOPE_RECOVERED);
});

test('recovery: an unknown type from a damaged chain is not a confident absence', () => {
  // Same hole, negative side. `node-type-unknown` says "declared nowhere in the
  // chain"; if any link in that chain is unprovable, it is not established.
  const source = `${H}Group { children [ Shape { }\n`
    + `PROTO Inner [ ] { VendorThing { } }\nInner { }\n`;
  const { parsed, graph } = build(source);
  const inner = sg.scopes(graph).find((s) => s.ownerName === 'Inner');
  assert.equal(inner.recovered, false);
  expectStatus(resolveType(parsed, graph, 'VendorThing'),
    STATUS.RECOVERED, REASON.SCOPE_RECOVERED);
});

test('recovery: a moved scope boundary cannot manufacture false recursion', () => {
  // `contains` is measured against a declaration's RANGE, and an unclosed body
  // extends that range over statements it never held. Clean, this is an ordinary
  // binding; one brace short, the absorbed `Transform { }` lands inside
  // `Transform`'s range and an unguarded check calls valid code illegal.
  const clean = `${H}PROTO Transform [ ] { Group { } }\n`
    + `PROTO Inner [ ] { Transform { } }\nInner { }\n`;
  const damaged = `${H}PROTO Transform [ ] { Group { \n`
    + `PROTO Inner [ ] { Transform { } }\nInner { }\n`;

  const a = build(clean);
  const ok = resolveType(a.parsed, a.graph, 'Transform');
  expectStatus(ok, STATUS.RESOLVED, REASON.OK);
  assert.equal(ok.symbol.node, declNodes(a.parsed, 'Transform')[0],
    'undamaged, it binds to the local prototype');

  const b = build(damaged);
  const res = resolveType(b.parsed, b.graph, 'Transform');
  assert.notEqual(res.reason, REASON.RECURSIVE_PROTO_INSTANCE,
    'recovery must not invent a recursion diagnosis for valid source');
  assert.equal(res.status, STATUS.RECOVERED);
  assert.equal(res.symbol, null);
});

test('recovery: a clean sibling scope stays usable when damage is attributable', () => {
  // Errors are attributed to the INNERMOST containing scope. Without that, one
  // stray error would suppress every honest answer in the file -- so a clean
  // sibling PROTO must keep answering, and only the damaged one must not.
  const source = `${H}PROTO Knob [ ] { Sphere { } }\n`
    + `PROTO Clean [ ] { Group { children [ Knob { } ] } }\n`
    + `PROTO Broken [ ] { Group { children [ Knob { } ) ] } }\nGroup { }\n`;
  const { parsed, graph } = build(source);
  const clean = sg.scopes(graph).find((s) => s.ownerName === 'Clean');
  const broken = sg.scopes(graph).find((s) => s.ownerName === 'Broken');
  assert.equal(clean.recovered, false, 'the undamaged sibling must stay provable');
  assert.equal(broken.recovered, true, 'the damaged scope must fail closed');
  expectStatus(resolveType(parsed, graph, 'Knob', 1), STATUS.RESOLVED, REASON.OK);
  expectStatus(resolveType(parsed, graph, 'Knob', 2), STATUS.RECOVERED, REASON.SCOPE_RECOVERED);
});

// ===========================================================================
// 45-55  Queries, safety and P1 non-regression
// ===========================================================================

test('query: references to a PROTO declaration are source ordered', () => {
  const source = `${H}PROTO Knob [ ] { Sphere { } }\n`
    + `Group { children [ Knob { } Transform { children [ Knob { } ] } Knob { } ] }\n`;
  const { parsed, graph } = build(source);
  const decl = sg.typeDeclFor(graph, declNodes(parsed, 'Knob')[0]);
  const refs = sg.referencesTo(graph, decl);
  assert.equal(refs.length, 3);
  const offsets = refs.map((r) => r.range.start.offset);
  assert.deepEqual(offsets.slice().sort((a, b) => a - b), offsets);
  assert.deepEqual(refs.map((r) => r.sourceOrder).slice().sort((a, b) => a - b),
    refs.map((r) => r.sourceOrder));
  // The AST-node form is accepted too, and answers identically.
  assert.deepEqual(sg.referencesTo(graph, declNodes(parsed, 'Knob')[0]), refs);
});

test('query: references to an EXTERNPROTO declaration are source ordered', () => {
  const source = `${H}EXTERNPROTO Gold [ ] "m.wrl#Gold"\n`
    + `Group { children [ Shape { appearance Appearance { material Gold { } } } Gold { } ] }\n`;
  const { parsed, graph } = build(source);
  const decl = sg.typeDeclFor(graph, declNodes(parsed, 'Gold')[0]);
  const refs = sg.referencesTo(graph, decl);
  assert.equal(refs.length, 2);
  const offsets = refs.map((r) => r.range.start.offset);
  assert.deepEqual(offsets.slice().sort((a, b) => a - b), offsets);
});

test('query: only authoritative bindings appear in a declaration reference list', () => {
  const source = `${H}Knob { }\n`
    + `PROTO Knob [ ] { Sphere { } }\nPROTO Knob [ ] { Box { } }\n`
    + `Group { children [ Knob { } ] }\n`;
  const { parsed, graph } = build(source);
  // Both references are ambiguous, including the one written before either
  // declaration: duplicates are judged over the whole scope, so the earlier
  // reference is not "valid but early", it is inside a file whose binding for
  // `Knob` 4.8.1 leaves undefined. Neither binds anything.
  const total = sg.typeDeclarations(graph)
    .reduce((n, d) => n + sg.referencesTo(graph, d).length, 0);
  assert.equal(total, 0);
  const statuses = sg.typeResolutions(graph)
    .filter((r) => r.reference.name === 'Knob').map((r) => r.status);
  assert.deepEqual(statuses, [STATUS.AMBIGUOUS, STATUS.AMBIGUOUS]);
  for (const r of sg.typeResolutions(graph)) {
    if (r.status !== STATUS.RESOLVED) assert.equal(r.symbol, null);
  }
});

// --- duplicate timing ------------------------------------------------------
//
// One policy, stated once: a duplicate is judged over every same-name
// declaration the type chain owns, never over "those visible from here". These
// six pin that the reference's POSITION never changes the verdict, and that the
// three queries that can see a duplicate all give the same account of it.

test('duplicates: a reference between the two declarations is still ambiguous', () => {
  const source = `${H}PROTO P [ ] { Box { } }\nP { }\nPROTO P [ ] { Cone { } }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'P');
  expectStatus(res, STATUS.AMBIGUOUS, REASON.DUPLICATE_PROTO_DECLARATION);
  assert.equal(res.candidateCount, 2);
  assert.equal(res.symbol, null, 'position must not be allowed to pick a winner');
});

test('duplicates: a reference after both declarations is ambiguous', () => {
  const source = `${H}PROTO P [ ] { Box { } }\nPROTO P [ ] { Cone { } }\nP { }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveType(parsed, graph, 'P'),
    STATUS.AMBIGUOUS, REASON.DUPLICATE_PROTO_DECLARATION);
});

test('duplicates: a reference before both declarations is ambiguous', () => {
  const source = `${H}P { }\nPROTO P [ ] { Box { } }\nPROTO P [ ] { Cone { } }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveType(parsed, graph, 'P'),
    STATUS.AMBIGUOUS, REASON.DUPLICATE_PROTO_DECLARATION);
});

test('duplicates: a PROTO and an EXTERNPROTO of one name do not narrow by kind', () => {
  const source = `${H}PROTO P [ ] { Box { } }\nEXTERNPROTO P [ ] "x.wrl#P"\nP { }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'P');
  expectStatus(res, STATUS.AMBIGUOUS, REASON.DUPLICATE_PROTO_DECLARATION);
  assert.equal(res.candidateCount, 2);
  const kinds = sg.typeDeclarations(graph).map((d) => d.kind);
  assert.deepEqual(kinds, [SYMBOL_KIND.PROTO_DECL, SYMBOL_KIND.EXTERNPROTO_DECL],
    'the two kinds really are different -- and that difference must not break the tie');
});

test('duplicates: all three queries agree over one duplicate', () => {
  const source = `${H}PROTO P [ ] { Box { } }\nP { }\nPROTO P [ ] { Cone { } }\n`;
  const { parsed, graph } = build(source);
  // resolve: ambiguous.
  expectStatus(resolveType(parsed, graph, 'P'),
    STATUS.AMBIGUOUS, REASON.DUPLICATE_PROTO_DECLARATION);
  for (const decl of sg.typeDeclarations(graph)) {
    // typeDeclIsUniqueInScope: not unique, same reason id.
    const u = sg.typeDeclIsUniqueInScope(graph, decl);
    assert.equal(u.unique, false);
    assert.equal(u.reason, REASON.DUPLICATE_PROTO_DECLARATION);
    // referencesTo: nothing bound, so nothing listed.
    assert.deepEqual(sg.referencesTo(graph, decl), []);
  }
});

test('duplicates: a same-name declaration in a nested scope is not a duplicate of it', () => {
  // 4.8.4 P5 makes a nested prototype local to its enclosing prototype, so these
  // two `Knob`s are separate declarations in separate scopes -- each unique
  // WHERE IT IS. `typeDeclIsUniqueInScope` asks about one scope, and must not be
  // confused by the other.
  const source = `${H}PROTO Knob [ ] { Sphere { } }\n`
    + `PROTO Outer [ ] { PROTO Knob [ ] { Box { } } Shape { } }\nGroup { }\n`;
  const { graph } = build(source);
  for (const decl of sg.typeDeclarations(graph)) {
    assert.equal(sg.typeDeclIsUniqueInScope(graph, decl).unique, true,
      `${decl.name} is unique within its own scope`);
  }
});

// --- ambiguity is a claim, and claims need a proven scope -------------------
//
// An `ambiguous` answer binds nothing, which is why the plan lets DEF ambiguity
// stand under damage. A TYPE ambiguity is different: it asserts that two
// declarations of one name share a scope, and parser recovery can merge scopes
// that the author kept apart. So it sits below the recovery gate with every other
// lexical claim. The control case at the end proves the gate did not simply
// disable duplicate detection.

test('recovery: damaged same-scope duplicates withhold rather than claim ambiguity', () => {
  const source = `${H}Group { children [ Shape { }\n`
    + `PROTO P [ ] { Box { } }\nPROTO P [ ] { Cone { } }\nP { }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'P');
  expectStatus(res, STATUS.RECOVERED, REASON.SCOPE_RECOVERED);
  assert.equal(res.symbol, null);
  assert.equal(res.candidateCount, 0, 'no duplicate count may leak out of a damaged scope');
  assert.deepEqual(res.evidence, [], 'nor any duplicate evidence');
  assert.equal(res.detail, null);
});

test('recovery: a duplicate manufactured by recovery is never reported as one', () => {
  // The case that makes ambiguity-under-damage unsafe rather than merely useless.
  // Written correctly, these two `Knob`s are in DIFFERENT scopes -- one nested in
  // `Outer`, one at the document level -- and `Knob { }` binds the document one.
  // Remove `Outer`'s closing brace and its body swallows the rest of the file, so
  // both declarations AND the reference land in one scope. The duplicate is an
  // artefact of recovery; the author never wrote it.
  const clean = `${H}PROTO Outer [ ] { PROTO Knob [ ] { Box { } } Shape { } }\n`
    + `PROTO Knob [ ] { Cone { } }\nKnob { }\n`;
  const damaged = `${H}PROTO Outer [ ] { PROTO Knob [ ] { Box { } } Shape { }\n`
    + `PROTO Knob [ ] { Cone { } }\nKnob { }\n`;

  const a = build(clean);
  const ok = resolveType(a.parsed, a.graph, 'Knob');
  expectStatus(ok, STATUS.RESOLVED, REASON.OK);
  assert.equal(ok.symbol.node, declNodes(a.parsed, 'Knob')[1],
    'undamaged, the two declarations are in different scopes and this binds the outer one');

  const b = build(damaged);
  const declScopes = sg.typeDeclarations(b.graph)
    .filter((d) => d.name === 'Knob').map((d) => d.scope);
  assert.equal(declScopes[0], declScopes[1],
    'recovery really did merge them into one scope -- that is what makes this the hard case');
  const res = resolveType(b.parsed, b.graph, 'Knob');
  assert.notEqual(res.reason, REASON.DUPLICATE_PROTO_DECLARATION,
    'a fabricated duplicate must never be reported as a duplicate');
  expectStatus(res, STATUS.RECOVERED, REASON.SCOPE_RECOVERED);
  assert.equal(res.symbol, null);
});

test('recovery: a clean scope crossing a damaged one claims no ambiguity', () => {
  const source = `${H}Group { children [ Shape { }\n`
    + `PROTO P [ ] { Box { } }\nPROTO P [ ] { Cone { } }\n`
    + `PROTO Inner [ ] { P { } }\n`;
  const { parsed, graph } = build(source);
  const inner = sg.scopes(graph).find((s) => s.ownerName === 'Inner');
  assert.equal(inner.recovered, false, 'the reference sits in a provable scope');
  const res = resolveType(parsed, graph, 'P');
  expectStatus(res, STATUS.RECOVERED, REASON.SCOPE_RECOVERED);
  assert.equal(res.candidateCount, 0);
});

test('recovery: a parse cap withholds ambiguity as well as everything else', () => {
  const source = `${H}PROTO P [ ] { Box { } }\nPROTO P [ ] { Cone { } }\n`
    + `Group { children [ Group { children [ Group { children [ P { } ] } ] } ] }\n`;
  const { parsed, graph } = build(source, { maxDepth: 2 });
  const res = resolveType(parsed, graph, 'P');
  expectStatus(res, STATUS.RECOVERED, REASON.DOCUMENT_PARSE_INCOMPLETE);
  assert.equal(res.symbol, null);
  assert.equal(res.candidateCount, 0);
});

test('recovery: an unplaceable diagnostic withholds ambiguity everywhere', () => {
  // Damage the model cannot attribute to any scope fails the whole graph closed,
  // so even a duplicate in an otherwise untouched scope is not asserted.
  const source = `${H}PROTO P [ ] { Box { } }\nPROTO P [ ] { Cone { } }\nP { }\n} ] }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'P');
  assert.equal(res.status, STATUS.RECOVERED);
  assert.notEqual(res.reason, REASON.DUPLICATE_PROTO_DECLARATION);
  assert.equal(res.candidateCount, 0);
});

test('recovery: legitimate ambiguity in a provable scope still reports', () => {
  // The control. If this ever goes `recovered`, the gate has stopped being a
  // recovery guard and started being a way to never answer.
  const source = `${H}PROTO P [ ] { Box { } }\nPROTO P [ ] { Cone { } }\nP { }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'P');
  expectStatus(res, STATUS.AMBIGUOUS, REASON.DUPLICATE_PROTO_DECLARATION);
  assert.equal(res.candidateCount, 2);
  assert.equal(res.symbol, null);
  assert.equal(res.evidence.length, 2, 'a provable duplicate still shows its evidence');
});

test('recovery: every query withholds together over one damaged duplicate', () => {
  const source = `${H}Group { children [ Shape { }\n`
    + `PROTO P [ ] { Box { } }\nPROTO P [ ] { Cone { } }\nP { }\n`;
  const { parsed, graph } = build(source);

  expectStatus(resolveType(parsed, graph, 'P'), STATUS.RECOVERED, REASON.SCOPE_RECOVERED);

  for (const decl of sg.typeDeclarations(graph)) {
    const u = sg.typeDeclIsUniqueInScope(graph, decl);
    assert.equal(u.unique, false, 'uniqueness is declined, not decided');
    assert.notEqual(u.reason, REASON.DUPLICATE_PROTO_DECLARATION,
      'and it must decline for the RECOVERY reason, not assert a duplicate');
    assert.deepEqual(sg.referencesTo(graph, decl), [],
      'nothing withheld may be listed as an authoritative binding');
  }

  // The projections handed back are still the graph's own, and still frozen.
  const res = sg.typeResolutions(graph).find((r) => r.reference.name === 'P');
  assert.ok(Object.isFrozen(res));
  assert.throws(() => { res.status = STATUS.RESOLVED; }, TypeError);
});

// --- recursion -------------------------------------------------------------

test('recursion: a prototype instantiated inside its own body is refused', () => {
  const source = `${H}PROTO P [ ] { P { } }\nP { }\n`;
  const { parsed, graph } = build(source);
  const inner = resolveType(parsed, graph, 'P', 1);
  expectStatus(inner, STATUS.INVALID, REASON.RECURSIVE_PROTO_INSTANCE);
  assert.equal(inner.symbol, null);
  // The instantiation AFTER the definition completes is ordinary and legal.
  expectStatus(resolveType(parsed, graph, 'P', 2), STATUS.RESOLVED, REASON.OK);
});

test('recursion: self-reference is diagnosed as recursion, not as being early', () => {
  // Both 4.8.4 rules are broken at once, and the ordering rule would always win
  // if it were tested first -- a definition is never complete inside itself. The
  // specific diagnosis is the useful one.
  const source = `${H}PROTO P [ ] { Group { children [ P { } ] } }\nGroup { }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveType(parsed, graph, 'P'),
    STATUS.INVALID, REASON.RECURSIVE_PROTO_INSTANCE);
});

test('recursion: mutual recursion where the first declaration is complete', () => {
  const source = `${H}PROTO A [ ] { Box { } }\nPROTO B [ ] { A { } }\nB { }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'A');
  expectStatus(res, STATUS.RESOLVED, REASON.OK);
  assert.equal(res.symbol.node, declNodes(parsed, 'A')[0],
    'a completed prototype used by a later one is an ordinary binding');
});

test('recursion: a forward reference to a later prototype is refused, not bound', () => {
  const source = `${H}PROTO A [ ] { B { } }\nPROTO B [ ] { Box { } }\nA { }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'B', 1);
  expectStatus(res, STATUS.INVALID, REASON.PROTO_INSTANCE_BEFORE_DECLARATION);
  assert.equal(res.symbol, null, 'the later declaration must not be handed back');
});

test('recursion: an inner prototype recursing does not reach the enclosing same name', () => {
  // The dangerous shape: `P` names both an outer declaration and the inner one
  // the reference sits inside. Picking the outer one would be a confident WRONG
  // binding; the containment check must win first.
  const source = `${H}PROTO P [ ] { Box { } }\n`
    + `PROTO Outer [ ] { PROTO P [ ] { P { } } Shape { } }\nGroup { }\n`;
  const { parsed, graph } = build(source);
  const res = resolveType(parsed, graph, 'P', 1);
  assert.equal(res.symbol, null, 'must never bind the enclosing declaration');
  assert.notEqual(res.status, STATUS.RESOLVED);
  assert.ok(res.reason === REASON.RECURSIVE_PROTO_INSTANCE
    || res.reason === REASON.DUPLICATE_PROTO_DECLARATION,
  `refused for a stated reason, got ${res.reason}`);
});

test('recursion: recursion is decided by containment, never by name order', () => {
  // Two prototypes, the second instantiating the first from inside its own body.
  // Only the reference genuinely enclosed by its own declaration is recursive.
  const source = `${H}PROTO A [ ] { A { } }\nPROTO B [ ] { A { } }\nB { }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveType(parsed, graph, 'A', 1),
    STATUS.INVALID, REASON.RECURSIVE_PROTO_INSTANCE);
  expectStatus(resolveType(parsed, graph, 'A', 2), STATUS.RESOLVED, REASON.OK);
});

// --- built-in spelling redeclared later ------------------------------------

test('builtin: an occurrence before a later same-spelling PROTO is refused', () => {
  // 4.8.1 leaves the result undefined when a prototype takes a built-in's name.
  // The committed plan establishes no answer for it, so this fails closed rather
  // than picking either reading -- and it must not claim `node-type-is-builtin`,
  // which would assert the file's own declaration away.
  const source = `${H}Transform { }\nPROTO Transform [ ] { Group { } }\nTransform { }\n`;
  const { parsed, graph } = build(source);
  const early = resolveType(parsed, graph, 'Transform', 1);
  assert.notEqual(early.reason, REASON.NODE_TYPE_IS_BUILTIN);
  expectStatus(early, STATUS.INVALID, REASON.PROTO_INSTANCE_BEFORE_DECLARATION);
  assert.equal(early.symbol, null);
  // After the declaration completes, the local prototype wins -- and says so.
  const late = resolveType(parsed, graph, 'Transform', 2);
  expectStatus(late, STATUS.RESOLVED, REASON.OK);
  assert.equal(late.detail, REASON.PROTO_SHADOWS_BUILTIN);
  assert.equal(late.symbol.node, declNodes(parsed, 'Transform')[0]);
});

test('builtin: the same holds for EXTERNPROTO', () => {
  const source = `${H}Shape { }\nEXTERNPROTO Shape [ ] "x.wrl#Shape"\nShape { }\n`;
  const { parsed, graph } = build(source);
  expectStatus(resolveType(parsed, graph, 'Shape', 1),
    STATUS.INVALID, REASON.PROTO_INSTANCE_BEFORE_DECLARATION);
  const late = resolveType(parsed, graph, 'Shape', 2);
  expectStatus(late, STATUS.RESOLVED, REASON.OK);
  assert.equal(late.symbol.kind, SYMBOL_KIND.EXTERNPROTO_DECL);
  assert.equal(late.detail, REASON.PROTO_SHADOWS_BUILTIN);
});

test('query: type uniqueness is asked of exactly one scope', () => {
  const source = `${H}PROTO Knob [ ] { Sphere { } }\n`
    + `PROTO Outer [ ] { PROTO Knob [ ] { Box { } } Shape { } }\nGroup { }\n`;
  const { graph } = build(source);
  const [outerKnob, outer, nestedKnob] = sg.typeDeclarations(graph);
  assert.equal(outerKnob.name, 'Knob');
  assert.equal(outer.name, 'Outer');
  assert.equal(nestedKnob.name, 'Knob');
  // Two declarations of `Knob`, in two different scopes -- both unique.
  assert.equal(sg.typeDeclIsUniqueInScope(graph, outerKnob).unique, true);
  assert.equal(sg.typeDeclIsUniqueInScope(graph, nestedKnob).unique, true);
  assert.notEqual(outerKnob.scope, nestedKnob.scope);
});

test('query: uniqueness does not walk out through typeParent', () => {
  // The nested declaration would be a duplicate only if the query followed the
  // lookup chain. It asks about ONE scope, so it does not.
  const source = `${H}PROTO Knob [ ] { Sphere { } }\n`
    + `PROTO Outer [ ] { PROTO Knob [ ] { Box { } } Shape { geometry Knob { } } }\nGroup { }\n`;
  const { parsed, graph } = build(source);
  const nested = sg.typeDeclFor(graph, declNodes(parsed, 'Knob')[1]);
  assert.equal(nested.scope.kind, SCOPE_KIND.PROTO_BODY);
  assert.equal(sg.typeDeclIsUniqueInScope(graph, nested).unique, true);
  // Lookup, however, DOES walk the chain -- and finding both is ambiguity.
  expectStatus(resolveType(parsed, graph, 'Knob'), STATUS.AMBIGUOUS,
    REASON.DUPLICATE_PROTO_DECLARATION);
});

test('safety: a projection from another graph is rejected', () => {
  const source = `${H}PROTO Knob [ ] { Sphere { } }\nKnob { }\n`;
  const a = build(source);
  const b = build(source); // byte-identical text, a DIFFERENT parse
  const declA = sg.typeDeclarations(a.graph)[0];
  const refA = sg.typeReferences(a.graph)[0];

  assert.throws(() => sg.referencesTo(b.graph, declA), (e) => e.code === SCOPE_ERROR.SYMBOL);
  assert.throws(() => sg.typeDeclIsUniqueInScope(b.graph, declA),
    (e) => e.code === SCOPE_ERROR.SYMBOL);
  assert.throws(() => sg.resolve(b.graph, refA), (e) => e.code === SCOPE_ERROR.REFERENCE);
  // Nor by AST node: the tree belongs to the other parse.
  assert.throws(() => sg.referencesTo(b.graph, declA.node), (e) => e.code === SCOPE_ERROR.SYMBOL);
  assert.equal(sg.typeDeclFor(b.graph, declA.node), null);
  assert.equal(sg.typeReferenceFor(b.graph, refA.node), null);
});

test('safety: byte-identical parses remain separate graphs', () => {
  const source = `${H}PROTO Knob [ ] { Sphere { } }\nKnob { }\n`;
  const a = build(source);
  const b = build(source);
  assert.notEqual(a.graph, b.graph);
  assert.notEqual(sg.typeDeclarations(a.graph)[0], sg.typeDeclarations(b.graph)[0]);
  // Same answers, different objects -- determinism without shared identity.
  assert.deepEqual(sg.typeResolutions(a.graph).map((r) => `${r.status}/${r.reason}`),
    sg.typeResolutions(b.graph).map((r) => `${r.status}/${r.reason}`));
});

test('safety: a shape-valid forgery is rejected', () => {
  const { parsed, graph } = build(`${H}PROTO Knob [ ] { Sphere { } }\nKnob { }\n`);
  const real = sg.typeDeclarations(graph)[0];
  // Every published field copied, plus attacker-controlled extras. Shape is not
  // proof: membership is object identity in a private WeakMap and nothing else.
  const forged = Object.freeze({ ...real, trusted: true, owner: graph });
  assert.throws(() => sg.referencesTo(graph, forged), (e) => e.code === SCOPE_ERROR.SYMBOL);
  assert.throws(() => sg.typeDeclIsUniqueInScope(graph, forged),
    (e) => e.code === SCOPE_ERROR.SYMBOL);

  const forgedRef = Object.freeze({ ...sg.typeReferences(graph)[0], trusted: true });
  assert.throws(() => sg.resolve(graph, forgedRef), (e) => e.code === SCOPE_ERROR.REFERENCE);

  // A serialized-and-reconstructed projection is a forgery too.
  const revived = JSON.parse(JSON.stringify({
    kind: real.kind, namespace: real.namespace, name: real.name,
  }));
  assert.throws(() => sg.referencesTo(graph, revived), (e) => e.code === SCOPE_ERROR.SYMBOL);

  for (const bad of [null, undefined, 0, 'Knob', [], {}, () => {}]) {
    assert.throws(() => sg.referencesTo(graph, bad), (e) => e.code === SCOPE_ERROR.SYMBOL);
    assert.throws(() => sg.typeDeclIsUniqueInScope(graph, bad),
      (e) => e.code === SCOPE_ERROR.SYMBOL);
  }
  for (const bad of [null, undefined, 0, 'graph', {}, []]) {
    assert.throws(() => sg.typeDeclarations(bad), (e) => e.code === SCOPE_ERROR.GRAPH);
    assert.throws(() => sg.typeReferences(bad), (e) => e.code === SCOPE_ERROR.GRAPH);
    assert.throws(() => sg.typeResolutions(bad), (e) => e.code === SCOPE_ERROR.GRAPH);
    assert.throws(() => sg.typeDeclFor(bad, parsed.tree), (e) => e.code === SCOPE_ERROR.GRAPH);
    assert.throws(() => sg.typeReferenceFor(bad, parsed.tree), (e) => e.code === SCOPE_ERROR.GRAPH);
  }
});

test('safety: a malformed parse result is refused before any type answer', () => {
  const good = { tree: null, syntaxDiagnostics: [], truncated: false, depthCapped: false };
  for (const bad of [null, undefined, 0, 'text', [], { ...good, truncated: undefined }]) {
    assert.throws(() => sg.buildScopeGraph(bad), (e) => e.code === SCOPE_ERROR.PARSE);
  }
  const graph = sg.buildScopeGraph(good);
  assert.deepEqual(sg.typeDeclarations(graph), []);
  assert.deepEqual(sg.typeReferences(graph), []);
});

test('safety: returned collections and records cannot mutate graph state', () => {
  const { graph } = build(`${H}PROTO Knob [ ] { Sphere { } }\nKnob { }\nKnob { }\n`);
  for (const list of [sg.typeDeclarations(graph), sg.typeReferences(graph),
    sg.typeResolutions(graph)]) {
    assert.equal(Object.isFrozen(list), true);
    assert.throws(() => { list.push('x'); }, TypeError);
  }
  // A fresh array each call, so a caller cannot retain and edit the internal one.
  assert.notEqual(sg.typeDeclarations(graph), sg.typeDeclarations(graph));
  assert.deepEqual(sg.typeDeclarations(graph), sg.typeDeclarations(graph));

  const decl = sg.typeDeclarations(graph)[0];
  assert.equal(Object.isFrozen(decl), true);
  assert.throws(() => { decl.name = 'Other'; }, TypeError);
  const res = sg.typeResolutions(graph)[0];
  assert.equal(Object.isFrozen(res), true);
  assert.throws(() => { res.status = STATUS.RESOLVED; }, TypeError);
  assert.equal(Object.isFrozen(res.evidence), true);
  const refs = sg.referencesTo(graph, decl);
  assert.equal(Object.isFrozen(refs), true);
  assert.equal(sg.referencesTo(graph, decl).length, refs.length);
});

test('non-regression: DEF/USE behaviour is unchanged by the type namespace', () => {
  // The P1 answers, re-asserted from this side of the boundary. If a type
  // declaration or reference had leaked into the node-name maps, at least one of
  // these would move.
  const cases = [
    [`${H}Group { children [ DEF Ball Shape { } USE Ball ] }\n`, STATUS.RESOLVED, REASON.OK],
    [`${H}Group { children [ USE Ball DEF Ball Shape { } ] }\n`,
      STATUS.INVALID, REASON.USE_BEFORE_DEF],
    [`${H}DEF Ball Shape { }\nDEF Ball Group { }\nGroup { children [ USE Ball ] }\n`,
      STATUS.AMBIGUOUS, REASON.DUPLICATE_DEF_IN_SCOPE],
    [`${H}PROTO P [ ] { Group { children [ DEF In Shape { } ] } }\n`
      + `Group { children [ USE In ] }\n`,
      STATUS.UNRESOLVED, REASON.DEF_NOT_VISIBLE_ACROSS_PROTO_BOUNDARY],
    [`${H}Group { children [ USE Ghost ] }\n`,
      STATUS.UNRESOLVED, REASON.DEF_NOT_DECLARED_IN_SCOPE],
    [`${H}DEF Loop Group { children [ USE Loop ] }\n`,
      STATUS.INVALID, REASON.SELF_REFERENTIAL_USE],
  ];
  for (const [source, status, reason] of cases) {
    const { parsed, graph } = build(source);
    const uses = [];
    ast.walk(parsed.tree, (n) => { if (n.type === ast.NODE.USE) uses.push(n); });
    const res = sg.resolve(graph, uses[0]);
    expectStatus(res, status, reason);
    // A DEF/USE answer never carries the node-type namespace's `detail`.
    assert.equal(res.detail, null);
  }
});

test('non-regression: a DEF symbol is never reachable through a type query', () => {
  const { parsed, graph } = build(`${H}PROTO Ball [ ] { Sphere { } }\n`
    + `Group { children [ DEF Ball Ball { } ] }\n`);
  const defNode = instanceNodes(parsed).find((n) => n.def === 'Ball');
  // The DEF'd node is a type REFERENCE, never a type DECLARATION.
  assert.equal(sg.typeDeclFor(graph, defNode), null);
  assert.ok(sg.typeReferenceFor(graph, defNode));
  // And the DEF symbol is not accepted where a type declaration is required.
  const defSymbol = sg.symbolFor(graph, defNode);
  assert.throws(() => sg.typeDeclIsUniqueInScope(graph, defSymbol),
    (e) => e.code === SCOPE_ERROR.SYMBOL);
  // Conversely a type declaration is not accepted by the DEF uniqueness query.
  const decl = sg.typeDeclarations(graph)[0];
  assert.throws(() => sg.defIsUniqueInScope(graph, decl), (e) => e.code === SCOPE_ERROR.SYMBOL);
});

// ===========================================================================
// Boundaries: rejected behaviour, determinism, non-integration
// ===========================================================================

test('boundary: no ranking, scoring or nearest-match reaches the type resolver', () => {
  // Asserted on CODE with comments and string literals stripped, because the
  // headers quote the very rules being refused in order to explain the refusal.
  for (const file of ['scope-graph.js', 'symbols.js']) {
    const code = codeOnly(fs.readFileSync(path.join(SRC, file), 'utf8'));
    for (const banned of ['score', 'closest', 'nearest', 'bestMatch', 'fuzzy', 'similar',
      'fingerprint', 'structuralPath', 'siblingIndex']) {
      assert.equal(code.includes(banned), false, `${file} must not contain '${banned}' in code`);
    }
    // A scope must never be keyed by a joined string, a delimiter or a hash.
    for (const banned of ['scopeKey', 'scopePath', 'join(\'/\')', 'join("/")']) {
      assert.equal(code.includes(banned), false, `${file} must not contain '${banned}'`);
    }
  }
});

test('boundary: duplicates are never narrowed by kind, shape or built-in status', () => {
  // The behavioural form of the same refusal, swept over every narrowing a
  // resolver might be tempted by. Each pair differs in a way that would let a
  // tiebreak pick a winner; none does.
  const sources = [
    // differing declaration kind
    `${H}PROTO G [ ] { Material { } }\nEXTERNPROTO G [ ] "g.wrl#G"\nG { }\n`,
    // one shadows a built-in
    `${H}PROTO Box [ ] { Sphere { } }\nPROTO Box [ ] { Cone { } }\nBox { }\n`,
    // differing body shape and interface
    `${H}PROTO T [ ] { Box { } }\nPROTO T [ field SFBool on TRUE ] { Group { } }\nT { }\n`,
    // three of them
    `${H}PROTO M [ ] { Box { } }\nPROTO M [ ] { Cone { } }\nPROTO M [ ] { Sphere { } }\nM { }\n`,
  ];
  for (const source of sources) {
    const { graph } = build(source);
    const res = sg.typeResolutions(graph).find((r) => r.status === STATUS.AMBIGUOUS);
    assert.ok(res, `expected ambiguity for:\n${source}`);
    assert.equal(res.reason, REASON.DUPLICATE_PROTO_DECLARATION);
    assert.equal(res.symbol, null);
    assert.ok(res.candidateCount >= 2);
  }
});

test('boundary: every type answer carries a status and a stable reason', () => {
  const sources = [
    `${H}PROTO A [ ] { Box { } }\nA { }\n`,
    `${H}A { }\nPROTO A [ ] { Box { } }\n`,
    `${H}PROTO A [ ] { Box { } }\nPROTO A [ ] { Cone { } }\nA { }\n`,
    `${H}Unknown { }\n`,
    `${H}PROTO R [ ] { Group { children [ R { } ] } }\nGroup { }\n`,
    `${H}PROTO Q [ ] { Box { } }\nPROTO P [ ] { Shape { }\nQ { }\n`,
    `${H}Group { }\n`,
  ];
  const seen = new Set();
  for (const source of sources) {
    const { graph } = build(source);
    for (const r of sg.typeResolutions(graph)) {
      assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
      assert.ok(Object.values(STATUS).includes(r.status));
      if (r.status !== STATUS.RESOLVED) assert.equal(r.symbol, null);
      else if (r.reason === REASON.NODE_TYPE_IS_BUILTIN) assert.equal(r.symbol, null);
      else assert.ok(r.symbol, 'a resolved local answer must name its declaration');
      seen.add(`${r.status}/${r.reason}`);
    }
  }
  // Every refusal shape this lane can produce is actually exercised above.
  for (const shape of [`${STATUS.RESOLVED}/${REASON.OK}`,
    `${STATUS.RESOLVED}/${REASON.NODE_TYPE_IS_BUILTIN}`,
    `${STATUS.INVALID}/${REASON.PROTO_INSTANCE_BEFORE_DECLARATION}`,
    `${STATUS.INVALID}/${REASON.RECURSIVE_PROTO_INSTANCE}`,
    `${STATUS.AMBIGUOUS}/${REASON.DUPLICATE_PROTO_DECLARATION}`,
    `${STATUS.UNRESOLVED}/${REASON.NODE_TYPE_UNKNOWN}`,
    `${STATUS.RECOVERED}/${REASON.SCOPE_RECOVERED}`]) {
    assert.equal(seen.has(shape), true, `expected ${shape} to be exercised`);
  }
});

test('boundary: two builds over one parse agree exactly', () => {
  const source = `${H}PROTO Knob [ ] { Sphere { } }\n`
    + `PROTO Outer [ ] { PROTO Knob [ ] { Box { } } Knob { } }\nKnob { }\nUnknown { }\n`;
  const parsed = parse(source);
  const one = sg.buildScopeGraph(parsed);
  const two = sg.buildScopeGraph(parsed);
  assert.deepEqual(sg.typeResolutions(one).map((r) => `${r.reference.name}=${r.status}/${r.reason}`),
    sg.typeResolutions(two).map((r) => `${r.reference.name}=${r.status}/${r.reason}`));
  assert.deepEqual(sg.typeDeclarations(one).map((d) => `${d.kind}:${d.name}:${d.sourceOrder}`),
    sg.typeDeclarations(two).map((d) => `${d.kind}:${d.name}:${d.sourceOrder}`));
});

test('boundary: the type resolver never mutates the parse result', () => {
  const source = `${H}PROTO Knob [ ] { Sphere { } }\nEXTERNPROTO G [ ] "g.wrl#G"\n`
    + `Group { children [ Knob { } G { } ] }\n`;
  const parsed = parse(source);
  const before = JSON.stringify(parsed.tree);
  const graph = sg.buildScopeGraph(parsed);
  sg.typeResolutions(graph);
  sg.typeDeclarations(graph);
  assert.equal(JSON.stringify(parsed.tree), before);
});

test('boundary: P2A wires no consumer and holds no second built-in list', () => {
  // The schema is the sole authority. A hard-coded node-name table in the
  // resolver would drift silently the next time the schema is regenerated.
  // Scanned as CODE, not prose. WD1.5-P2B's endpoint section has to EXPLAIN why
  // `getFieldSchema('Transform','set_translation')` is null by design, and a
  // scan that reads comments would fail on the explanation of the very rule it
  // is enforcing. The invariant itself is unchanged: no built-in may be named in
  // executable code.
  const code = withoutComments(fs.readFileSync(path.join(SRC, 'scope-graph.js'), 'utf8'));
  for (const builtin of ['Transform', 'Appearance', 'IndexedFaceSet', 'Billboard']) {
    assert.equal(code.includes(`'${builtin}'`), false,
      `scope-graph.js must not name the built-in ${builtin}`);
  }
  assert.equal(/require\(['"]\.\/node-schema['"]\)/.test(code), true,
    'the committed schema must be the authority');

  // Still no consumer, and still no facade exposure: those are WD1.5-P4.
  for (const file of ['analyze.js', 'node-identity.js', 'document-transaction.js',
    'parser.js', 'tokenizer.js', 'ast.js', 'source-map.js', 'edit.js', 'index.js']) {
    const other = fs.readFileSync(path.join(SRC, file), 'utf8');
    assert.equal(/require\(['"]\.\/scope-graph['"]\)/.test(other), false,
      `${file} must not require scope-graph`);
  }
  const facade = require('../../src/vrml');
  for (const name of ['scopeGraph', 'buildScopeGraph', 'typeDeclarations', 'typeResolutions']) {
    assert.equal(name in facade, false, `${name} must not be exposed through the facade in P2A`);
  }
});

test('boundary: ROUTE is absent, not stubbed -- and P2A\'s own lists did not grow', () => {
  // WD1.5-P2B landed the interface-member namespace, so the interface and `IS`
  // kinds are now built and pinned as present in `symbols.test.js`. ROUTE is
  // still P2C's, and publishing either endpoint kind today would advertise
  // support that does not exist.
  for (const later of ['route-node', 'route-event']) {
    assert.equal(Object.values(sym.REFERENCE_KIND).includes(later), false);
  }

  // The half of this test that matters MORE after P2B than before: P2A's three
  // lists must still contain exactly what they contained, with the third
  // namespace held entirely apart. If interface members had leaked into
  // `symbols` or `typeDeclarations`, every existing caller's counts would have
  // changed silently.
  const source = `${H}PROTO Mover [ field SFVec3f offset 0 0 0 ] {\n`
    + `  DEF T Transform { translation IS offset }\n}\n`
    + `DEF C TimeSensor { }\nDEF S Script { eventOut SFTime fired url "x.js" }\n`
    + `Mover { }\nROUTE C.cycleTime TO S.fired\n`;
  const { graph } = build(source);
  for (const s of sg.symbols(graph)) assert.equal(s.namespace, NAMESPACE.NODE_NAME);
  for (const d of sg.typeDeclarations(graph)) assert.equal(d.namespace, NAMESPACE.NODE_TYPE);
  for (const r of sg.typeReferences(graph)) assert.equal(r.namespace, NAMESPACE.NODE_TYPE);
  for (const r of sg.references(graph)) assert.equal(r.namespace, NAMESPACE.NODE_NAME);
  // ... and the interface members that DO exist are in the third namespace only.
  const members = sg.interfaceMembers(graph);
  assert.equal(members.length, 2, 'PROTO `offset` and Script `fired`');
  for (const m of members) assert.equal(m.namespace, NAMESPACE.INTERFACE_MEMBER);
  // `scopes()` keeps its P1/P2A meaning: lexical regions only, no interfaces.
  for (const s of sg.scopes(graph)) {
    assert.equal(['document', 'proto-body'].includes(s.kind), true,
      `scopes() must stay lexical, saw ${s.kind}`);
  }
  assert.equal(sg.interfaceScopes(graph).length, 2);
  // No ROUTE projection of any kind exists yet.
  assert.equal('routeReferences' in sg, false);
  assert.equal('resolveRoute' in sg, false);
});
