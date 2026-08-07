'use strict';
// VRML97 interface members and `IS` binding tests (Phase WD1.5-P2B).
//
// A SEPARATE FILE from `scope-graph.test.js` (DEF/USE, P1) and
// `type-resolution.test.js` (node types, P2A), for the reason P2A gave: those
// files' value is partly that they did NOT change when this lane landed, so a
// predecessor regression shows up there as a failure rather than as a merge
// conflict in a file three lanes edit.
//
// As in P1/P2A, most of what follows asserts a REFUSAL, and every positive case
// proves WHICH declaration came back by object identity against the exact AST
// node located by an independent walk -- never merely that something did.
//
// Fixtures are authored here as string literals, original to this lane. Nothing
// under `spikes/` is imported: a production test graded against the research
// prototype would be checking one implementation against another instead of
// against ISO/IEC 14772-1.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const { parse, ast } = require('../../src/vrml');
const sg = require('../../src/vrml/scope-graph');
const sym = require('../../src/vrml/symbols');
const nodeSchema = require('../../src/vrml/node-schema');

const {
  STATUS, REASON, SCOPE_KIND, SCOPE_ERROR, SYMBOL_KIND, REFERENCE_KIND,
  NAMESPACE, ACCESS, ENDPOINT_ORIGIN, IS_FORM,
} = sg;

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

/** Every AST `Proto`/`ExternProto` declaring `name`, in source order. */
function declNodes(parsed, name) {
  const out = [];
  ast.walk(parsed.tree, (n) => {
    if ((n.type === ast.NODE.PROTO || n.type === ast.NODE.EXTERNPROTO)
      && n.name === name) out.push(n);
  });
  return out.sort((a, b) => a.range.start.offset - b.range.start.offset);
}

/** Every `InterfaceDecl` named `name`, in source order, found independently. */
function interfaceDecls(parsed, name) {
  const out = [];
  ast.walk(parsed.tree, (n) => {
    if (n.type === ast.NODE.INTERFACE && n.name === name) out.push(n);
  });
  return out.sort((a, b) => a.range.start.offset - b.range.start.offset);
}

/**
 * The `IS` reference whose DEFINITION-side (left-hand) name is `endpointName`.
 * Located through the graph's published list, then cross-checked against an
 * independent tree walk so the list itself is under test too.
 */
function isRefNamed(parsed, graph, endpointName, which = 0) {
  const fromGraph = sg.isReferences(graph).filter((r) => r.endpointName === endpointName);
  const fromTree = [];
  ast.walk(parsed.tree, (n) => {
    if (n.type === ast.NODE.FIELD && n.isBinding && n.value
      && n.value.type === ast.NODE.IS && n.name === endpointName) fromTree.push(n);
    if (n.type === ast.NODE.INTERFACE && n.is != null && n.name === endpointName) fromTree.push(n);
  });
  assert.equal(fromGraph.length, fromTree.length,
    `graph and independent walk disagree on how many IS bind ${endpointName}`);
  return fromGraph[which];
}

function expectIs(graph, reference, status, reason) {
  const res = sg.resolveIs(graph, reference);
  assert.equal(res.status, status, `expected ${status}, got ${res.status}/${res.reason}`);
  assert.equal(res.reason, reason, `expected ${reason}, got ${res.reason}`);
  return res;
}

function expectVerdict(graph, reference, status, reason) {
  const v = sg.isConnectionVerdict(graph, reference);
  assert.equal(v.status, status, `expected ${status}, got ${v.status}/${v.reason}`);
  assert.equal(v.reason, reason, `expected ${reason}, got ${v.reason}`);
  return v;
}

// Strip comments AND string literals, so a scan for a banned IDENTIFIER tests
// code rather than the prose that has to quote the very words being banned.
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
// 1-9  Declarations, ownership and uniqueness
// ===========================================================================

test('1 declarations: a PROTO interface yields all four access kinds, fully ranged', () => {
  const source = `${H}PROTO P [\n`
    + '  field SFInt32 count 3\n'
    + '  eventIn SFTime go\n'
    + '  eventOut SFBool done\n'
    + '  exposedField SFVec3f where 0 0 0\n'
    + '] { Group { } }\n';
  const { parsed, graph } = build(source);

  const members = sg.interfaceMembers(graph);
  assert.equal(members.length, 4);
  assert.deepEqual(members.map((m) => [m.name, m.access, m.fieldType, m.hasDefault]), [
    ['count', ACCESS.FIELD, 'SFInt32', true],
    ['go', ACCESS.EVENT_IN, 'SFTime', false],
    ['done', ACCESS.EVENT_OUT, 'SFBool', false],
    ['where', ACCESS.EXPOSED_FIELD, 'SFVec3f', true],
  ]);
  for (const m of members) {
    assert.equal(m.kind, SYMBOL_KIND.PROTO_INTERFACE_MEMBER);
    assert.equal(m.namespace, NAMESPACE.INTERFACE_MEMBER);
    assert.equal(m.scope.kind, SCOPE_KIND.PROTO_INTERFACE);
  }
  // Ranges are the parser's own, and they point at the name, not the line.
  const decl = interfaceDecls(parsed, 'count')[0];
  const member = sg.interfaceMemberFor(graph, decl);
  assert.equal(member, members[0], 'the AST lookup must return the same projection');
  assert.equal(source.slice(member.declRange.start.offset, member.declRange.end.offset), 'count');
  assert.equal(
    source.slice(member.range.start.offset, member.range.end.offset).startsWith('field'), true,
  );
});

test('2 declarations: an EXTERNPROTO interface declares members and carries no defaults', () => {
  const source = `${H}EXTERNPROTO E [\n`
    + '  field SFInt32 count\n'
    + '  exposedField SFBool flag\n'
    + '] [ "e.wrl" ]\n';
  const { parsed, graph } = build(source);

  const scopes = sg.interfaceScopes(graph);
  assert.equal(scopes.length, 1);
  assert.equal(scopes[0].kind, SCOPE_KIND.EXTERNPROTO_INTERFACE);
  assert.equal(scopes[0].ownerNode, declNodes(parsed, 'E')[0]);

  const members = sg.membersOf(graph, scopes[0]);
  assert.deepEqual(members.map((m) => [m.name, m.access, m.hasDefault]), [
    ['count', ACCESS.FIELD, false],
    ['flag', ACCESS.EXPOSED_FIELD, false],
  ]);
  // 4.9.2's subset rule governs ABSENCE only. It must not weaken what the
  // declaration positively states -- proven end-to-end by 28a.
  const typeDecl = sg.typeDeclFor(graph, declNodes(parsed, 'E')[0]);
  assert.equal(typeDecl.interfaceIsSubset, true);
});

test('3 declarations: a Script body declares the three legal restricted forms', () => {
  const source = `${H}DEF S Script {\n`
    + '  field SFBool run FALSE\n'
    + '  eventIn SFTime tick\n'
    + '  eventOut SFFloat out\n'
    + '  url "x.js"\n'
    + '}\n';
  const { parsed, graph } = build(source);

  const scopes = sg.interfaceScopes(graph);
  assert.equal(scopes.length, 1);
  assert.equal(scopes[0].kind, SCOPE_KIND.SCRIPT_INTERFACE);
  const members = sg.membersOf(graph, scopes[0]);
  assert.deepEqual(members.map((m) => [m.name, m.access]), [
    ['run', ACCESS.FIELD], ['tick', ACCESS.EVENT_IN], ['out', ACCESS.EVENT_OUT],
  ]);
  for (const m of members) assert.equal(m.kind, SYMBOL_KIND.SCRIPT_INTERFACE_MEMBER);
  // Script's own `url` is a clause-6 field, not a lexical declaration, so it is
  // NOT a member. Conflating the two would make every Script look like it
  // redeclared the standard's own interface.
  assert.equal(members.some((m) => m.name === 'url'), false);
  void parsed;
});

test('4 ownership: one name in two DISTINCT interfaces is not a duplicate', () => {
  const source = `${H}PROTO A [ field SFBool shared TRUE ] { Group { } }\n`
    + 'PROTO B [ field SFBool shared TRUE ] { Group { } }\n';
  const { parsed, graph } = build(source);

  const [a, b] = sg.interfaceMembers(graph);
  assert.notEqual(a.scope, b.scope, 'distinct interfaces are distinct scope OBJECTS');
  assert.equal(sg.interfaceMemberIsUniqueInScope(graph, a).unique, true);
  assert.equal(sg.interfaceMemberIsUniqueInScope(graph, b).unique, true);
  // Ownership is the scope OBJECT, never a name, a path or a joined key -- two
  // interfaces owned by same-named PROTOs would collide under any of those.
  assert.equal(sg.interfaceScopeFor(graph, declNodes(parsed, 'A')[0]), a.scope);
  assert.equal(sg.interfaceScopeFor(graph, declNodes(parsed, 'B')[0]), b.scope);
});

test('5 ownership: a duplicate name in ONE interface is ambiguous, with no pick', () => {
  const source = `${H}PROTO P [ field SFBool dup TRUE  eventIn SFTime dup ] {\n`
    + '  Group { }\n}\n';
  const { graph } = build(source);
  const members = sg.interfaceMembers(graph);
  assert.equal(members.length, 2);
  for (const m of members) {
    const u = sg.interfaceMemberIsUniqueInScope(graph, m);
    assert.equal(u.unique, false);
    assert.equal(u.reason, REASON.DUPLICATE_INTERFACE_MEMBER);
  }
});

test('6 namespaces: DEF X, PROTO X and field X coexist without colliding', () => {
  // The three-namespace rule in its most direct form. One shared name map would
  // make each of these report the others as a duplicate of itself.
  const source = `${H}PROTO X [ field SFBool X TRUE ] { DEF X Group { } }\nX { }\n`;
  const { parsed, graph } = build(source);

  const def = sg.symbols(graph).find((s) => s.name === 'X');
  const typeDecl = sg.typeDeclarations(graph).find((d) => d.name === 'X');
  const member = sg.interfaceMembers(graph).find((m) => m.name === 'X');

  assert.equal(def.namespace, NAMESPACE.NODE_NAME);
  assert.equal(typeDecl.namespace, NAMESPACE.NODE_TYPE);
  assert.equal(member.namespace, NAMESPACE.INTERFACE_MEMBER);
  assert.equal(sg.defIsUniqueInScope(graph, def).unique, true);
  assert.equal(sg.typeDeclIsUniqueInScope(graph, typeDecl).unique, true);
  assert.equal(sg.interfaceMemberIsUniqueInScope(graph, member).unique, true);
  void parsed;
});

test('7 ownership: nested PROTO interfaces stay separate', () => {
  const source = `${H}PROTO Outer [ field SFBool a TRUE ] {\n`
    + '  PROTO Inner [ field SFBool b TRUE ] { Group { } }\n'
    + '  Inner { }\n}\n';
  const { parsed, graph } = build(source);

  const outerIface = sg.interfaceScopeFor(graph, declNodes(parsed, 'Outer')[0]);
  const innerIface = sg.interfaceScopeFor(graph, declNodes(parsed, 'Inner')[0]);
  assert.notEqual(outerIface, innerIface);
  assert.deepEqual(sg.membersOf(graph, outerIface).map((m) => m.name), ['a']);
  assert.deepEqual(sg.membersOf(graph, innerIface).map((m) => m.name), ['b']);
  // An interface scope is reached by ownership, never by a chain: neither link
  // exists, so an outward walk is structurally impossible rather than forbidden.
  for (const s of [outerIface, innerIface]) {
    assert.equal(s.defParent, null);
    assert.equal(s.typeParent, null);
  }
});

test('8 declarations: an empty interface list, and a single-member one', () => {
  const source = `${H}PROTO Empty [ ] { Group { } }\n`
    + 'PROTO One [ field SFBool only TRUE ] { Group { } }\n';
  const { parsed, graph } = build(source);

  const emptyIface = sg.interfaceScopeFor(graph, declNodes(parsed, 'Empty')[0]);
  assert.equal(emptyIface.kind, SCOPE_KIND.PROTO_INTERFACE);
  assert.deepEqual(sg.membersOf(graph, emptyIface), []);
  // An empty list spans nothing, so it can own no range and nothing attributes
  // to it -- the enclosing body still fails closed for it (G2).
  assert.equal(emptyIface.ownerRange, null);

  const oneIface = sg.interfaceScopeFor(graph, declNodes(parsed, 'One')[0]);
  assert.deepEqual(sg.membersOf(graph, oneIface).map((m) => m.name), ['only']);
});

test('9 uniqueness: a damaged interface declines to assert uniqueness', () => {
  const clean = `${H}PROTO P [ field SFBool a TRUE ] { Group { } }\n`;
  // Damage INSIDE the interface list -- a trailing declaration the parse cannot
  // name. Damage in the BODY would leave the interface's member set perfectly
  // provable, so it would not exercise this at all.
  const damaged = `${H}PROTO P [ field SFBool a TRUE  eventIn SFTime ] { Group { } }\n`;
  const { graph: g1 } = build(clean);
  const { graph: g2 } = build(damaged);
  assert.equal(sg.interfaceScopes(g2)[0].recovered, true, 'fixture must damage the INTERFACE');

  const m1 = sg.interfaceMembers(g1)[0];
  assert.equal(sg.interfaceMemberIsUniqueInScope(g1, m1).unique, true);

  const m2 = sg.interfaceMembers(g2)[0];
  const u = sg.interfaceMemberIsUniqueInScope(g2, m2);
  // Declining to assert uniqueness, NOT asserting duplication -- P1/P2A's rule.
  assert.equal(u.unique, false);
  assert.notEqual(u.reason, REASON.DUPLICATE_INTERFACE_MEMBER);
});

// ===========================================================================
// 10-17  IS binding
// ===========================================================================

const HOST = 'PROTO Host [ field SFBool p FALSE ] { Group { } }\n';

test('10 binding: an IS in a nested PROTO body binds the INNERMOST interface', () => {
  // `shared` is declared in BOTH interfaces, so a resolver that walked outward
  // -- or that preferred the outer declaration -- would still return something.
  // This asserts WHICH, by object identity.
  const source = `${H}${HOST}PROTO Outer [ field SFBool shared TRUE ] {\n`
    + '  PROTO Inner [ field SFBool shared TRUE ] {\n'
    + '    Host { p IS shared }\n'
    + '  }\n  Inner { }\n}\n';
  const { parsed, graph } = build(source);

  const ref = isRefNamed(parsed, graph, 'p');
  const res = expectIs(graph, ref, STATUS.RESOLVED, REASON.OK);
  const innerIface = sg.interfaceScopeFor(graph, declNodes(parsed, 'Inner')[0]);
  assert.equal(res.symbol.scope, innerIface, 'must bind the INNERMOST interface');
  assert.equal(res.symbol.node, interfaceDecls(parsed, 'shared')[1]);
  assert.equal(ref.owner, innerIface);
});

test('11 binding: a member found only in an OUTER interface does not bind', () => {
  const source = `${H}${HOST}PROTO Outer [ field SFBool outerOnly TRUE ] {\n`
    + '  PROTO Inner [ field SFBool innerThing TRUE ] {\n'
    + '    Host { p IS outerOnly }\n'
    + '  }\n  Inner { }\n}\n';
  const { parsed, graph } = build(source);

  const ref = isRefNamed(parsed, graph, 'p');
  const res = expectIs(graph, ref, STATUS.UNRESOLVED, REASON.INTERFACE_MEMBER_NOT_DECLARED);
  // The outer hit is reported so a future diagnostic can EXPLAIN the refusal --
  // and it is non-binding by construction, not by convention.
  assert.equal(res.detail, REASON.MEMBER_FOUND_IN_OUTER_INTERFACE_ONLY);
  assert.equal(res.symbol, null, 'an explanatory detail must never become a binding');
  assert.equal(res.candidateCount, 0);
});

test('12 binding: a member of no interface at all is unresolved, with no detail', () => {
  const source = `${H}${HOST}PROTO P [ field SFBool real TRUE ] {\n`
    + '  Host { p IS nonexistent }\n}\n';
  const { parsed, graph } = build(source);
  const res = expectIs(graph, isRefNamed(parsed, graph, 'p'),
    STATUS.UNRESOLVED, REASON.INTERFACE_MEMBER_NOT_DECLARED);
  assert.equal(res.detail, null);
});

test('13 binding: an IS with no enclosing PROTO is invalid, not a parse failure', () => {
  // 4.3.6: only the body of a node statement inside a prototype definition may
  // contain IS statements. The corpus holds 102 of these; they are classified,
  // not rejected.
  const source = `${H}Transform { translation IS somewhere }\n`;
  const { parsed, graph } = build(source);
  assert.equal(parsed.syntaxDiagnostics.filter((d) => d.severity === 'error').length, 0,
    'this parses cleanly; it is a SEMANTIC refusal');
  const ref = isRefNamed(parsed, graph, 'translation');
  assert.equal(ref.owner, null);
  expectIs(graph, ref, STATUS.INVALID, REASON.IS_OUTSIDE_PROTO_BODY);
});

test('14 binding: an IS inside a Script inside a PROTO binds the PROTO interface', () => {
  // Entering a Script does NOT change the IS owner, and the corpus says this is
  // the dominant real shape.
  const source = `${H}PROTO P [ eventIn SFTime go ] {\n`
    + '  Group { children [ DEF S Script { eventIn SFTime tick IS go  url "x.js" } ] }\n}\n';
  const { parsed, graph } = build(source);

  const ref = isRefNamed(parsed, graph, 'tick');
  assert.equal(ref.form, IS_FORM.SCRIPT_INTERFACE);
  const res = expectIs(graph, ref, STATUS.RESOLVED, REASON.OK);
  assert.equal(res.symbol.scope, sg.interfaceScopeFor(graph, declNodes(parsed, 'P')[0]));
  // eventIn IS eventIn is a legal Table 4.4 cell, and the endpoint is the Script
  // declaration itself.
  const v = expectVerdict(graph, ref, STATUS.RESOLVED, REASON.OK);
  assert.equal(v.endpoint.origin, ENDPOINT_ORIGIN.SCRIPT_INTERFACE);
  assert.equal(v.endpoint.access, ACCESS.EVENT_IN);
});

test('15 aliases: set_zzz and zzz_changed bind an exposedField with the RIGHT access', () => {
  // The subtlest rule in the lane: expansion changes the EFFECTIVE access.
  // Binding `set_zzz` and then testing it as an exposedField would wrongly
  // accept a definition-side `field`.
  const source = `${H}PROTO Sink [ eventIn SFBool inEvt  eventOut SFBool outEvt ] { Group { } }\n`
    + 'PROTO P [ exposedField SFBool zzz FALSE ] {\n'
    + '  Sink { inEvt IS set_zzz  outEvt IS zzz_changed }\n}\n';
  const { parsed, graph } = build(source);
  const decl = interfaceDecls(parsed, 'zzz')[0];

  const setRef = isRefNamed(parsed, graph, 'inEvt');
  const setRes = expectIs(graph, setRef, STATUS.RESOLVED, REASON.OK);
  assert.equal(setRes.symbol.node, decl, 'the alias binds the ONE written declaration');
  assert.equal(setRes.detail, REASON.MEMBER_VIA_IMPLICIT_ALIAS);
  assert.equal(expectVerdict(graph, setRef, STATUS.RESOLVED, REASON.OK).declaredAccess,
    ACCESS.EVENT_IN, 'set_zzz is an eventIn for Table 4.4, not an exposedField');

  const chgRef = isRefNamed(parsed, graph, 'outEvt');
  assert.equal(expectIs(graph, chgRef, STATUS.RESOLVED, REASON.OK).symbol.node, decl);
  assert.equal(expectVerdict(graph, chgRef, STATUS.RESOLVED, REASON.OK).declaredAccess,
    ACCESS.EVENT_OUT);

  // Only ONE declaration exists; the aliases are a way of referring to it.
  assert.equal(sg.interfaceMembers(graph).filter((m) => m.scope === setRes.symbol.scope).length, 1);
  assert.equal(sg.isReferencesTo(graph, setRes.symbol).length, 2);
});

test('16 aliases: an explicit declaration colliding with an alias has NO winner', () => {
  // 4.3.5 prohibits the combination outright, so there is no author intent to
  // recover. Preferring the explicit declaration ("obviously what they meant")
  // is candidate ranking, and candidate ranking is the WD.md §7 failure mode.
  for (const [alias, explicit, otherAccess] of [
    ['set_zzz', 'eventIn SFBool set_zzz', ACCESS.EVENT_IN],
    ['zzz_changed', 'eventOut SFBool zzz_changed', ACCESS.EVENT_OUT],
  ]) {
    const source = `${H}PROTO Sink [ ${otherAccess} SFBool s ] { Group { } }\n`
      + `PROTO P [ exposedField SFBool zzz FALSE  ${explicit} ] {\n`
      + `  Sink { s IS ${alias} }\n}\n`;
    const { parsed, graph } = build(source);

    const ref = isRefNamed(parsed, graph, 's');
    const res = expectIs(graph, ref, STATUS.AMBIGUOUS, REASON.DUPLICATE_INTERFACE_MEMBER);
    assert.equal(res.candidateCount, 2);
    // NEITHER is returned. Not the explicit one, not the alias, not the first.
    assert.equal(res.symbol, null, `${alias}: no declaration may be preferred`);
    // The written name `zzz` is still unambiguous; only the collided effective
    // name is not -- so the whole interface is not condemned by one collision.
    const zzz = sg.interfaceMembers(graph).find((m) => m.name === 'zzz');
    assert.equal(sg.interfaceMemberIsUniqueInScope(graph, zzz).unique, false,
      'the exposedField occupies the collided name too, so it is not unique');
    // And the verdict inherits the refusal rather than inventing an endpoint.
    const v = expectVerdict(graph, ref, STATUS.AMBIGUOUS, REASON.DUPLICATE_INTERFACE_MEMBER);
    assert.equal(v.member, null);
    assert.equal(v.endpoint, null);
  }
});

test('17 damage: a malformed member name withholds every claim about its interface', () => {
  // A member the parse could not name cannot be indexed, so the interface's
  // member set is known to be short -- and a short set can prove neither
  // presence, nor absence, nor uniqueness.
  const source = `${H}${HOST}PROTO P [ field SFBool ] {\n  Host { p IS anything }\n}\n`;
  const { parsed, graph } = build(source);
  const ref = isRefNamed(parsed, graph, 'p');
  const res = sg.resolveIs(graph, ref);
  assert.equal(res.status, STATUS.RECOVERED, `expected recovered, got ${res.status}/${res.reason}`);
  assert.equal(res.symbol, null);
});

test('17b uniqueness: S19 -- unique within a PROTO, free between PROTOs', () => {
  const source = `${H}PROTO A [ field SFBool n TRUE  field SFBool n TRUE ] { Group { } }\n`
    + 'PROTO B [ field SFBool n TRUE ] { Group { } }\n';
  const { parsed, graph } = build(source);
  const inA = sg.interfaceMembers(graph).filter(
    (m) => m.scope === sg.interfaceScopeFor(graph, declNodes(parsed, 'A')[0]),
  );
  const inB = sg.interfaceMembers(graph).filter(
    (m) => m.scope === sg.interfaceScopeFor(graph, declNodes(parsed, 'B')[0]),
  );
  assert.equal(inA.length, 2);
  for (const m of inA) assert.equal(sg.interfaceMemberIsUniqueInScope(graph, m).unique, false);
  assert.equal(inB.length, 1);
  assert.equal(sg.interfaceMemberIsUniqueInScope(graph, inB[0]).unique, true);
});

// ===========================================================================
// 18-30  Endpoints and compatibility
// ===========================================================================

test('18 endpoint: a built-in field comes from the WD1.3 schema, direct hit', () => {
  const source = `${H}PROTO P [ exposedField SFVec3f where 0 0 0 ] {\n`
    + '  Transform { translation IS where }\n}\n';
  const { parsed, graph } = build(source);
  const v = expectVerdict(graph, isRefNamed(parsed, graph, 'translation'),
    STATUS.RESOLVED, REASON.OK);
  assert.equal(v.endpoint.origin, ENDPOINT_ORIGIN.BUILTIN_SCHEMA);
  assert.equal(v.endpoint.effectiveName, 'translation');
  assert.equal(v.endpoint.access, ACCESS.EXPOSED_FIELD);
  assert.equal(v.endpoint.type, 'SFVec3f');
});

test('19 endpoint: a built-in implicit alias resolves without touching the schema file', () => {
  // The schema records DECLARED names only, by design -- the aliases are a
  // clause-4.7 language rule, not an extra ISO declaration.
  assert.equal(nodeSchema.getFieldSchema('Transform', 'set_translation'), null,
    'the schema must NOT have been regenerated to add aliases');

  const source = `${H}PROTO P [ eventIn SFVec3f move ] {\n`
    + '  Transform { set_translation IS move }\n}\n';
  const { parsed, graph } = build(source);
  const v = expectVerdict(graph, isRefNamed(parsed, graph, 'set_translation'),
    STATUS.RESOLVED, REASON.OK);
  assert.equal(v.endpoint.origin, ENDPOINT_ORIGIN.BUILTIN_SCHEMA);
  assert.equal(v.endpoint.effectiveName, 'translation');
  assert.equal(v.endpoint.access, ACCESS.EVENT_IN, 'the alias is an eventIn, not an exposedField');
  assert.equal(v.endpoint.type, 'SFVec3f');
});

test('20 endpoint: an unknown field on a resolved built-in is reported as unknown', () => {
  const source = `${H}PROTO P [ field SFBool x TRUE ] {\n`
    + '  Transform { noSuchField IS x }\n}\n';
  const { parsed, graph } = build(source);
  const ref = isRefNamed(parsed, graph, 'noSuchField');
  expectIs(graph, ref, STATUS.RESOLVED, REASON.OK);
  expectVerdict(graph, ref, STATUS.UNRESOLVED, REASON.IS_ENDPOINT_UNKNOWN_FIELD);
});

test('21 endpoint: an X3D-only field is NOT a VRML97 endpoint', () => {
  // Chosen from the schema at run time rather than hard-coded, so the test
  // cannot rot when the schema is regenerated.
  let pick = null;
  for (const nodeName of nodeSchema.listNodeNames({ profile: 'vrml97' })) {
    for (const fieldName of nodeSchema.listFields(nodeName)) {
      const rec = nodeSchema.getFieldSchema(nodeName, fieldName);
      if (rec && !rec.vrml97Declaration) { pick = { nodeName, fieldName, rec }; break; }
    }
    if (pick) break;
  }
  assert.ok(pick, 'the schema must still carry X3D-only fields');

  const source = `${H}PROTO P [ field ${pick.rec.type} x ] {\n`
    + `  ${pick.nodeName} { ${pick.fieldName} IS x }\n}\n`;
  const { parsed, graph } = build(source);
  const ref = isRefNamed(parsed, graph, pick.fieldName);
  expectIs(graph, ref, STATUS.RESOLVED, REASON.OK);
  expectVerdict(graph, ref, STATUS.UNRESOLVED, REASON.IS_ENDPOINT_UNKNOWN_FIELD);
});

test('22 Table 4.4: all sixteen cells, each asserted individually', () => {
  // Rows are the prototype DEFINITION side, columns the DECLARATION side. The
  // matrix is asymmetric -- 7 legal of 16 -- so a transposed implementation
  // still passes on the diagonal and fails only on the exposedField row/column.
  // Every cell is therefore written out rather than derived.
  const LEGAL = {
    exposedField: {
      exposedField: true, field: true, eventIn: true, eventOut: true,
    },
    field: {
      exposedField: false, field: true, eventIn: false, eventOut: false,
    },
    eventIn: {
      exposedField: false, field: false, eventIn: true, eventOut: false,
    },
    eventOut: {
      exposedField: false, field: false, eventIn: false, eventOut: true,
    },
  };
  const kinds = [ACCESS.EXPOSED_FIELD, ACCESS.FIELD, ACCESS.EVENT_IN, ACCESS.EVENT_OUT];
  const dflt = (access) => (access === ACCESS.FIELD || access === ACCESS.EXPOSED_FIELD
    ? ' FALSE' : '');

  let legalCount = 0;
  let checked = 0;
  for (const defAccess of kinds) {
    for (const declAccess of kinds) {
      // A locally declared PROTO supplies the DEFINITION side, so the endpoint's
      // access kind is controlled exactly. Both sides are SFBool, so type
      // equality can never be what decides the cell.
      const source = `${H}PROTO Host [ ${defAccess} SFBool p${dflt(defAccess)} ] { Group { } }\n`
        + `PROTO P [ ${declAccess} SFBool q${dflt(declAccess)} ] {\n`
        + '  Host { p IS q }\n}\n';
      const { parsed, graph } = build(source);
      const ref = isRefNamed(parsed, graph, 'p');
      expectIs(graph, ref, STATUS.RESOLVED, REASON.OK);
      const v = sg.isConnectionVerdict(graph, ref);
      assert.equal(v.endpoint.access, defAccess);
      assert.equal(v.declaredAccess, declAccess);

      const expected = LEGAL[defAccess][declAccess];
      if (expected) {
        legalCount += 1;
        assert.equal(v.status, STATUS.RESOLVED,
          `definition ${defAccess} -> declaration ${declAccess} must be LEGAL,`
          + ` got ${v.status}/${v.reason}`);
      } else {
        assert.equal(v.status, STATUS.INVALID,
          `definition ${defAccess} -> declaration ${declAccess} must be ILLEGAL,`
          + ` got ${v.status}/${v.reason}`);
        assert.equal(v.reason, REASON.IS_ACCESS_INCOMPATIBLE);
      }
      checked += 1;
    }
  }
  assert.equal(checked, 16, 'every cell must be exercised');
  assert.equal(legalCount, 7, 'Table 4.4 has exactly seven legal cells');
});

test('23 compatibility: the three same-kind connections are legal on a built-in', () => {
  const source = `${H}PROTO P [\n`
    + '  field SFInt32 f 0\n  eventIn SFVec3f i\n  eventOut SFVec3f o\n'
    + '] {\n'
    + '  Group { children [\n'
    + '    Transform { set_translation IS i  translation_changed IS o }\n'
    + '    DEF S Script { field SFInt32 keep IS f  url "x.js" }\n'
    + '  ] }\n}\n';
  const { parsed, graph } = build(source);
  for (const name of ['set_translation', 'translation_changed', 'keep']) {
    expectVerdict(graph, isRefNamed(parsed, graph, name), STATUS.RESOLVED, REASON.OK);
  }
});

test('24 compatibility: a wrong access kind is invalid, with both sides as evidence', () => {
  const source = `${H}PROTO P [ eventIn SFVec3f justAnEvent ] {\n`
    + '  Transform { translation IS justAnEvent }\n}\n';
  const { parsed, graph } = build(source);
  // definition exposedField -> declaration eventIn is LEGAL (the exposedField
  // row is permissive), so use the direction that is not: a `field` endpoint.
  const v = expectVerdict(graph, isRefNamed(parsed, graph, 'translation'),
    STATUS.RESOLVED, REASON.OK);
  assert.equal(v.endpoint.access, ACCESS.EXPOSED_FIELD);

  const bad = `${H}PROTO Host [ field SFBool p FALSE ] { Group { } }\n`
    + 'PROTO P [ eventIn SFBool e ] {\n  Host { p IS e }\n}\n';
  const b = build(bad);
  const bv = expectVerdict(b.graph, isRefNamed(b.parsed, b.graph, 'p'),
    STATUS.INVALID, REASON.IS_ACCESS_INCOMPATIBLE);
  assert.equal(bv.endpoint.access, ACCESS.FIELD);
  assert.equal(bv.declaredAccess, ACCESS.EVENT_IN);
  assert.equal(bv.evidence.length, 2, 'both spans justify the call');
});

test('25 compatibility: type equality is EXACT -- no coercion, no SF/MF relation', () => {
  // 4.8.3's two worked counter-examples, in both directions.
  const cases = [
    ['SFColor', 'SFVec3f'], ['SFVec3f', 'SFColor'],
    ['SFColor', 'MFColor'], ['MFColor', 'SFColor'],
    ['SFInt32', 'SFFloat'], ['SFTime', 'SFFloat'],
  ];
  for (const [defType, declType] of cases) {
    const source = `${H}PROTO Host [ field ${defType} p ] { Group { } }\n`
      + `PROTO P [ field ${declType} q ] {\n  Host { p IS q }\n}\n`;
    const { parsed, graph } = build(source);
    const v = expectVerdict(graph, isRefNamed(parsed, graph, 'p'),
      STATUS.INVALID, REASON.IS_TYPE_MISMATCH);
    assert.equal(v.endpoint.type, defType);
    assert.equal(v.declaredType, declType);
  }
  // ... and the identical pair is compatible, so the rule is equality and not
  // blanket rejection.
  const ok = build(`${H}PROTO Host [ field SFColor p ] { Group { } }\n`
    + 'PROTO P [ field SFColor q ] {\n  Host { p IS q }\n}\n');
  expectVerdict(ok.graph, isRefNamed(ok.parsed, ok.graph, 'p'), STATUS.RESOLVED, REASON.OK);
});

test('25b compatibility: an unrecognised type token is unknown, never a silent pass', () => {
  // Both sides spell it identically, so a naive `a === b` would call it
  // compatible. Annex A's fieldType production says it is not a field type.
  const source = `${H}PROTO Host [ field SFNotAType p ] { Group { } }\n`
    + 'PROTO P [ field SFNotAType q ] {\n  Host { p IS q }\n}\n';
  const { parsed, graph } = build(source);
  expectVerdict(graph, isRefNamed(parsed, graph, 'p'), STATUS.UNRESOLVED, REASON.IS_TYPE_UNKNOWN);
});

test('25c authority: Annex A fieldType is a superset of every type the schema uses', () => {
  // Pins the relationship between the two authorities so they cannot drift.
  // The grammar answers "is this a legal field-type token"; the schema answers
  // "what type does THIS node's field have". MFTime is why they are not the
  // same set: it is a legal VRML97 field type that no clause-6 field uses.
  const code = fs.readFileSync(path.join(SRC, 'scope-graph.js'), 'utf8');
  const listed = new Set();
  const block = code.slice(code.indexOf('const VRML97_FIELD_TYPES'));
  for (const m of block.slice(0, block.indexOf(']')).matchAll(/'([SM]F[A-Za-z0-9]+)'/g)) {
    listed.add(m[1]);
  }
  assert.equal(listed.size, 20, 'Annex A gives exactly twenty field types');
  for (const nodeName of nodeSchema.listNodeNames({ profile: 'vrml97' })) {
    for (const fieldName of nodeSchema.listFields(nodeName, { profile: 'vrml97' })) {
      const rec = nodeSchema.getFieldSchema(nodeName, fieldName);
      if (!rec || !rec.vrml97Declaration) continue;
      assert.equal(listed.has(rec.type), true,
        `${nodeName}.${fieldName} has type ${rec.type}, absent from the grammar set`);
    }
  }
  assert.equal(listed.has('MFTime'), true, 'the one type no built-in field uses');
});

test('26 compatibility: SFNode/MFNode bind on the token alone; inner type is not checked', () => {
  // The standard imposes no constraint on the node type inside at the IS
  // boundary, and inventing one would be interpretation-grade.
  const source = `${H}PROTO P [ field SFNode thing NULL  field MFNode things [ ] ] {\n`
    + '  Group { children [ Shape { geometry IS thing } ] }\n'
    + '}\n';
  const { parsed, graph } = build(source);
  // `geometry` is SFNode on Shape and `thing` is SFNode: compatible on the token.
  expectVerdict(graph, isRefNamed(parsed, graph, 'geometry'), STATUS.RESOLVED, REASON.OK);

  const mismatched = `${H}PROTO P [ field MFNode things [ ] ] {\n`
    + '  Shape { geometry IS things }\n}\n';
  const m = build(mismatched);
  expectVerdict(m.graph, isRefNamed(m.parsed, m.graph, 'geometry'),
    STATUS.INVALID, REASON.IS_TYPE_MISMATCH);
});

test('27 endpoint: an unresolved node type loses the ENDPOINT, not the binding', () => {
  // The two questions are separable on purpose: collapsing them would throw
  // away a perfectly provable declaration-side answer.
  const source = `${H}PROTO P [ field SFBool x TRUE ] {\n`
    + '  VendorOnlyNode { someField IS x }\n}\n';
  const { parsed, graph } = build(source);
  const ref = isRefNamed(parsed, graph, 'someField');

  const res = expectIs(graph, ref, STATUS.RESOLVED, REASON.OK);
  assert.equal(res.symbol.name, 'x', 'the declaration side still binds');

  const v = expectVerdict(graph, ref, STATUS.UNRESOLVED, REASON.IS_ENDPOINT_NODE_TYPE_UNRESOLVED);
  assert.equal(v.endpoint, null);
  assert.equal(v.member, res.symbol, 'the proven half is still reported');
});

test('28a EXTERNPROTO: a LOCALLY DECLARED endpoint is acquired and checked', () => {
  const ext = 'EXTERNPROTO Ext [\n'
    + '  exposedField SFBool flag\n  eventIn SFTime go\n'
    + '] [ "ext.wrl" ]\n';
  // 4.9.2 makes the local declaration a PROTO interface declaration bar initial
  // values, so what it states is as usable as a PROTO's -- without loading it.
  const legal = `${H}${ext}PROTO P [ exposedField SFBool q FALSE ] {\n`
    + '  Ext { flag IS q }\n}\n';
  const a = build(legal);
  const av = expectVerdict(a.graph, isRefNamed(a.parsed, a.graph, 'flag'),
    STATUS.RESOLVED, REASON.OK);
  assert.equal(av.endpoint.origin, ENDPOINT_ORIGIN.EXTERNPROTO_INTERFACE);
  assert.equal(av.endpoint.access, ACCESS.EXPOSED_FIELD);
  assert.equal(av.endpoint.type, 'SFBool');
  assert.ok(av.endpoint.range, 'the endpoint points at the local declaration');

  // ... and it is genuinely USABLE, not merely non-null: an illegal pairing
  // against the same declaration must be REJECTED on its strength.
  const illegal = `${H}${ext}PROTO P [ field SFBool q FALSE ] {\n`
    + '  Ext { go IS q }\n}\n';
  const b = build(illegal);
  const bv = expectVerdict(b.graph, isRefNamed(b.parsed, b.graph, 'go'),
    STATUS.INVALID, REASON.IS_ACCESS_INCOMPATIBLE);
  assert.equal(bv.endpoint.origin, ENDPOINT_ORIGIN.EXTERNPROTO_INTERFACE);
  assert.equal(bv.endpoint.access, ACCESS.EVENT_IN);

  // A type error against a local EXTERNPROTO declaration is likewise decidable.
  const wrongType = `${H}${ext}PROTO P [ exposedField SFInt32 q 0 ] {\n`
    + '  Ext { flag IS q }\n}\n';
  const c = build(wrongType);
  expectVerdict(c.graph, isRefNamed(c.parsed, c.graph, 'flag'),
    STATUS.INVALID, REASON.IS_TYPE_MISMATCH);
});

test('28b EXTERNPROTO: a LOCALLY ABSENT endpoint is unsupported, never absent', () => {
  const source = `${H}EXTERNPROTO Ext [ exposedField SFBool flag ] [ "ext.wrl" ]\n`
    + 'PROTO P [ exposedField SFBool q FALSE ] {\n  Ext { notDeclaredLocally IS q }\n}\n';
  const { parsed, graph } = build(source);
  const ref = isRefNamed(parsed, graph, 'notDeclaredLocally');

  // The declaration side is untouched by the endpoint's unknowability.
  expectIs(graph, ref, STATUS.RESOLVED, REASON.OK);

  const v = sg.isConnectionVerdict(graph, ref);
  assert.equal(v.status, STATUS.UNSUPPORTED);
  assert.equal(v.reason, REASON.EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE);
  assert.equal(v.endpoint, null);
  // The distinction that matters: 4.9.2's interface is a SUBSET of the
  // implementation's, so silence is unknowable, not false.
  assert.notEqual(v.status, STATUS.UNRESOLVED);
  assert.notEqual(v.reason, REASON.IS_ENDPOINT_UNKNOWN_FIELD);

  // The same spelling on a PROTO -- where the declaration IS complete -- gives
  // the confident negative, proving the two are genuinely different answers and
  // not one answer relabelled.
  const asProto = `${H}PROTO Ext [ exposedField SFBool flag FALSE ] { Group { } }\n`
    + 'PROTO P [ exposedField SFBool q FALSE ] {\n  Ext { notDeclaredLocally IS q }\n}\n';
  const p = build(asProto);
  expectVerdict(p.graph, isRefNamed(p.parsed, p.graph, 'notDeclaredLocally'),
    STATUS.UNRESOLVED, REASON.IS_ENDPOINT_UNKNOWN_FIELD);
});

test('28c EXTERNPROTO: alias expansion applies to a locally declared exposedField', () => {
  const ext = 'EXTERNPROTO Ext [ exposedField SFBool flag ] [ "ext.wrl" ]\n';
  for (const [endpoint, access] of [['set_flag', ACCESS.EVENT_IN],
    ['flag_changed', ACCESS.EVENT_OUT]]) {
    const source = `${H}${ext}PROTO P [ ${access} SFBool q ] {\n`
      + `  Ext { ${endpoint} IS q }\n}\n`;
    const { parsed, graph } = build(source);
    const v = expectVerdict(graph, isRefNamed(parsed, graph, endpoint),
      STATUS.RESOLVED, REASON.OK);
    assert.equal(v.endpoint.origin, ENDPOINT_ORIGIN.EXTERNPROTO_INTERFACE);
    assert.equal(v.endpoint.effectiveName, 'flag');
    assert.equal(v.endpoint.access, access);
  }
  // An alias of a member that is NOT locally declared still answers 28b.
  const missing = `${H}${ext}PROTO P [ eventIn SFBool q ] {\n`
    + '  Ext { set_other IS q }\n}\n';
  const m = build(missing);
  expectVerdict(m.graph, isRefNamed(m.parsed, m.graph, 'set_other'),
    STATUS.UNSUPPORTED, REASON.EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE);
});

test('28d EXTERNPROTO: no URL is loaded, because no loader exists in the path', () => {
  // There is no loader to inject: this lane performs no I/O at all, so the
  // guarantee is proven structurally rather than by adding networking
  // infrastructure solely to assert it is unused.
  for (const file of ['scope-graph.js', 'symbols.js']) {
    const abs = path.join(SRC, file);
    // The REAL resolved dependency set, not a text scan -- a text scan would
    // trip over `require('src/vrml')` quoted inside an error message, and could
    // be fooled by a computed require.
    const loaded = require.cache[require.resolve(abs)];
    assert.ok(loaded, `${file} must already be loaded`);
    assert.deepEqual(loaded.children.map((c) => path.basename(c.filename)).sort(),
      file === 'symbols.js' ? [] : ['ast.js', 'node-schema.js', 'symbols.js'],
      `${file} must depend on nothing but its declared siblings`);
    const body = codeOnly(fs.readFileSync(abs, 'utf8'));
    for (const banned of ['fetch', 'XMLHttpRequest', 'readFile', 'readFileSync',
      'http', 'https', 'net', 'dns', 'child_process']) {
      assert.equal(new RegExp(`\\b${banned}\\b`).test(body), false,
        `${file} must not reference ${banned}`);
    }
    // The EXTERNPROTO's `url` field is never even read.
    assert.equal(/\.url\b/.test(body), false, `${file} must not read an EXTERNPROTO url`);
  }
});

test('29 S7: one endpoint bound twice is invalid; many endpoints to one member is not', () => {
  const source = `${H}PROTO P [ field SFVec3f a 0 0 0  field SFVec3f b 0 0 0 ] {\n`
    + '  Transform { translation IS a  translation IS b }\n}\n';
  const { parsed, graph } = build(source);
  const host = [];
  ast.walk(parsed.tree, (n) => { if (n.type === ast.NODE.NODE) host.push(n); });
  const issues = sg.nodeIsBindingIssues(graph, host[0]);
  assert.equal(issues.status, STATUS.RESOLVED);
  assert.equal(issues.issues.length, 1);
  assert.equal(issues.issues[0].reason, REASON.DUPLICATE_IS_FOR_ENDPOINT);
  assert.equal(issues.issues[0].endpointName, 'translation');

  // The CONVERSE is explicitly valid and must never be flagged: several
  // different endpoints mapping to ONE interface member is a standard idiom.
  const many = `${H}PROTO P [ field SFVec3f v 0 0 0 ] {\n`
    + '  Transform { translation IS v  scale IS v }\n}\n';
  const m = build(many);
  const mHost = [];
  ast.walk(m.parsed.tree, (n) => { if (n.type === ast.NODE.NODE) mHost.push(n); });
  assert.deepEqual(sg.nodeIsBindingIssues(m.graph, mHost[0]).issues, []);
});

test('30 S8: a field both valued and IS-bound is invalid', () => {
  const source = `${H}PROTO P [ field SFVec3f v 0 0 0 ] {\n`
    + '  Transform { translation 1 2 3  translation IS v }\n}\n';
  const { parsed, graph } = build(source);
  const host = [];
  ast.walk(parsed.tree, (n) => { if (n.type === ast.NODE.NODE) host.push(n); });
  const issues = sg.nodeIsBindingIssues(graph, host[0]);
  assert.equal(issues.issues.length, 1);
  assert.equal(issues.issues[0].reason, REASON.FIELD_VALUED_AND_IS);
  assert.equal(issues.issues[0].endpointName, 'translation');
  // The binding itself is untouched -- this is a property of the NODE.
  expectIs(graph, isRefNamed(parsed, graph, 'translation'), STATUS.RESOLVED, REASON.OK);
});

// ===========================================================================
// 31-36  Recovery, each with a byte-identical clean control
// ===========================================================================

test('31 recovery: a damaged interface list must not manufacture a duplicate', () => {
  // The clean control declares `dup` ONCE, so a confident duplicate claim here
  // would be entirely an artefact of the damage.
  const clean = `${H}${HOST}PROTO P [ field SFBool dup TRUE ] { Host { p IS dup } }\n`
    + 'PROTO Q [ field SFBool dup TRUE ] { Group { } }\n';
  const c = build(clean);
  expectIs(c.graph, isRefNamed(c.parsed, c.graph, 'p'), STATUS.RESOLVED, REASON.OK);

  // The unclosed `[` absorbs the following declarations into P's interface.
  const damaged = `${H}${HOST}PROTO P [ field SFBool dup TRUE { Host { p IS dup } }\n`
    + 'PROTO Q [ field SFBool dup TRUE ] { Group { } }\n';
  const d = build(damaged);
  assert.ok(d.parsed.syntaxDiagnostics.some((x) => x.severity === 'error'), 'fixture must damage');
  for (const ref of sg.isReferences(d.graph)) {
    const res = sg.resolveIs(d.graph, ref);
    assert.notEqual(res.status, STATUS.AMBIGUOUS,
      'a duplicate claim manufactured by recovery must be withheld');
    assert.equal(res.symbol, null, 'and no binding may be returned either');
  }
});

test('32 recovery: a truncated interface list must not manufacture an ABSENCE', () => {
  // Absence is an assertion too, and a short member set cannot prove one.
  const clean = `${H}${HOST}PROTO P [ field SFBool later TRUE ] { Host { p IS later } }\n`;
  const c = build(clean);
  expectIs(c.graph, isRefNamed(c.parsed, c.graph, 'p'), STATUS.RESOLVED, REASON.OK);

  // `later` is LOST -- the declaration keeps its type but loses its name -- so a
  // resolver that trusted the surviving member set would confidently report
  // "no such member". That negative is exactly as unprovable as a positive.
  const damaged = `${H}${HOST}PROTO P [ field SFBool ] { Host { p IS later } }\n`;
  const d = build(damaged);
  const res = sg.resolveIs(d.graph, isRefNamed(d.parsed, d.graph, 'p'));
  assert.equal(res.status, STATUS.RECOVERED,
    `absence must be withheld, got ${res.status}/${res.reason}`);
  assert.notEqual(res.reason, REASON.INTERFACE_MEMBER_NOT_DECLARED,
    'a manufactured absence must never be reported as a real one');
});

test('33 recovery: an unclosed body moving WHICH interface owns an IS is withheld', () => {
  // Written correctly, the `IS` sits at DOCUMENT level and has no enclosing
  // prototype at all, so the honest answer is `is-outside-proto-body`.
  const clean = `${H}${HOST}PROTO A [ field SFBool a TRUE ] { Group { } }\n`
    + 'Host { p IS a }\n';
  const c = build(clean);
  const cRef = isRefNamed(c.parsed, c.graph, 'p');
  assert.equal(cRef.owner, null);
  expectIs(c.graph, cRef, STATUS.INVALID, REASON.IS_OUTSIDE_PROTO_BODY);

  // Drop A's closing brace and the very same statement is absorbed into A's
  // body, so it now LOOKS like it sits inside a prototype whose interface
  // declares `a`. A resolver that trusted the moved boundary would answer
  // `resolved` -- a confident binding to a declaration the author never
  // connected it to, which is the one outcome the hard gate forbids.
  const damaged = `${H}${HOST}PROTO A [ field SFBool a TRUE ] { Group { }\n`
    + 'Host { p IS a }\n';
  const d = build(damaged);
  const dRef = isRefNamed(d.parsed, d.graph, 'p');
  assert.notEqual(dRef.owner, null, 'the damage really did move the boundary');
  const res = sg.resolveIs(d.graph, dRef);
  assert.equal(res.status, STATUS.RECOVERED,
    `owning interface is in doubt, got ${res.status}/${res.reason}`);
  assert.equal(res.symbol, null);
});

// A cap must be tripped by something OTHER than the construct under test: the
// parser abandons the subtree it caps on, so capping the `IS` itself would leave
// nothing to answer about and the assertions would pass vacuously.
const CAPPED_IS = (() => {
  let deep = 'Group { }';
  for (let i = 0; i < 8; i += 1) deep = `Group { children [ ${deep} ] }`;
  return `${H}${HOST}PROTO P [ field SFBool x TRUE ] { Host { p IS x } }\n${deep}\n`;
})();

test('34 recovery: a hard parse cap withholds every answer in the document', () => {
  const clean = build(CAPPED_IS);
  expectIs(clean.graph, isRefNamed(clean.parsed, clean.graph, 'p'), STATUS.RESOLVED, REASON.OK);

  const { parsed, graph } = build(CAPPED_IS, { maxDepth: 3 });
  assert.equal(parsed.depthCapped || parsed.truncated, true, 'fixture must hit a cap');

  const refs = sg.isReferences(graph);
  assert.ok(refs.length > 0, 'the IS must survive the cap, or this test proves nothing');
  for (const ref of refs) {
    const res = sg.resolveIs(graph, ref);
    assert.equal(res.status, STATUS.RECOVERED);
    assert.equal(res.reason, REASON.DOCUMENT_PARSE_INCOMPLETE);
  }
  const members = sg.interfaceMembers(graph);
  assert.ok(members.length > 0, 'and so must the members');
  for (const m of members) {
    assert.equal(sg.interfaceMemberIsUniqueInScope(graph, m).reason,
      REASON.DOCUMENT_PARSE_INCOMPLETE);
  }
});

test('35b invariant: an unprovable interface always has an unprovable body', () => {
  // This is what makes G3's REFERENCE-side check redundant today (see the note
  // in `interfaceChainWithholds`): a proto-body's range contains its own
  // interface list, so damage in the list marks both. Pinned here so that if the
  // containment ever stops holding, the suite says so rather than quietly
  // opening a gap that only G3 was covering.
  const sources = [
    `${H}PROTO P [ field SFBool ] { Group { } }\n`,
    `${H}PROTO P [ field SFBool a TRUE  eventIn SFTime ] { Group { } }\n`,
    `${H}PROTO P [ field SFBool a TRUE  field ] { Group { } }\n`,
  ];
  let sawOne = false;
  for (const source of sources) {
    const { parsed, graph } = build(source);
    for (const iface of sg.interfaceScopes(graph)) {
      if (!iface.recovered || iface.kind !== SCOPE_KIND.PROTO_INTERFACE) continue;
      sawOne = true;
      const body = sg.scopes(graph).find(
        (s) => s.kind === SCOPE_KIND.PROTO_BODY && s.ownerNode === iface.ownerNode,
      );
      assert.ok(body, 'the owning PROTO must have a body scope');
      assert.equal(body.recovered, true,
        'a damaged interface must imply a damaged body, or G3 becomes load-bearing');
    }
    void parsed;
  }
  assert.equal(sawOne, true, 'at least one fixture must actually damage an interface');
});

test('35 recovery: damage in an UNRELATED scope leaves a clean answer standing', () => {
  // Over-withholding is a real cost, so attribution must stay localized.
  const source = `${H}${HOST}PROTO Broken [ field SFBool z ] { Group { \n`
    + 'PROTO Fine [ field SFBool w TRUE ] { Host { p IS w } }\n';
  const { parsed, graph } = build(source);
  // `Fine` is absorbed by `Broken`, so THIS one is legitimately withheld; the
  // control below proves a genuinely unrelated sibling is not.
  void isRefNamed(parsed, graph, 'p');

  const sibling = `${H}${HOST}PROTO Broken [ field SFBool z ] { Group { } }\n`
    + 'PROTO Fine [ field SFBool w TRUE ] { Host { p IS w } }\n'
    + 'Group { children [ ] \n';
  const s = build(sibling);
  const fineIface = sg.interfaceScopeFor(s.graph, declNodes(s.parsed, 'Fine')[0]);
  assert.equal(fineIface.recovered, false, 'an undamaged interface stays provable');
});

test('36 mutation: every one of G1-G5 is load-bearing', () => {
  // A gate condition nobody can observe is ceremony. Each mutant removes ONE
  // condition from the compiled module and must change at least one outcome --
  // the same discipline P2A's mutant suite applied, run here inside the suite so
  // it cannot rot.
  const file = path.join(SRC, 'scope-graph.js');
  const original = fs.readFileSync(file, 'utf8');

  function mutateInFunction(source, fnName, from, to) {
    const start = source.indexOf(`function ${fnName}(`);
    assert.notEqual(start, -1, `${fnName} must exist`);
    const end = source.indexOf('\n}\n', start) + 3;
    const body = source.slice(start, end);
    const hits = body.split(from).length - 1;
    assert.equal(hits, 1, `"${from}" must appear exactly once in ${fnName}, saw ${hits}`);
    return source.slice(0, start) + body.replace(from, to) + source.slice(end);
  }

  function load(mutated) {
    assert.notEqual(mutated, original, 'the mutation must actually change the source');
    const m = new Module(file, null);
    m.filename = file;
    m.paths = Module._nodeModulePaths(path.dirname(file));
    m._compile(mutated, file);
    return m.exports;
  }

  const mutants = [
    // G1 -- a hard parse cap. The cap is tripped by a deep SIBLING so the IS
    // itself survives to be answered about.
    {
      gate: 'G1',
      mutate: (s) => mutateInFunction(s, 'interfaceChainWithholds',
        'state.documentIncomplete', 'false'),
      source: CAPPED_IS,
      opts: { maxDepth: 3 },
      // NOT the sole line of defence, and the mutation proves it: a hard cap
      // also makes `markRecovery` blanket-mark every scope, so G2 still
      // withholds. What G1 uniquely supplies is the PRECISE reason -- removing
      // it degrades `document-parse-incomplete` into the vaguer
      // `interface-not-provable-for-reference`. That is a real, observable loss
      // of diagnostic quality, but not a loss of safety, and saying otherwise
      // would overstate what this condition does.
      soleDefence: false,
    },
    // G2 -- the enclosing body scope. An unclosed PROTO body absorbs a
    // document-level statement, moving which interface the IS appears to be in.
    {
      gate: 'G2',
      mutate: (s) => mutateInFunction(s, 'interfaceChainWithholds',
        'reference.hostScope && reference.hostScope.recovered', 'false'),
      source: `${H}${HOST}PROTO A [ field SFBool a TRUE ] { Group { }\nHost { p IS a }\n`,
    },
    // G3 -- the CONSULTED interface scope, in `interfaceEndpoint`. This is where
    // the condition is independently observable: the damaged interface belongs
    // to a different PROTO, whose body has nothing to do with this reference, so
    // G2 does not cover it. Without it a damaged endpoint namespace would
    // manufacture a confident `is-endpoint-unknown-field`.
    {
      gate: 'G3',
      mutate: (s) => mutateInFunction(s, 'interfaceEndpoint',
        'ifaceScope.recovered)', 'false)'),
      source: `${H}PROTO Bad [ field SFBool ] { Group { } }\n`
        + 'PROTO P [ field SFBool q TRUE ] { Bad { someField IS q } }\n',
      compare: 'verdict',
    },
    // G4 -- the declaring script-interface of a Script-form IS. Observable
    // through its ABSENCE branch: a `… IS …` written in a NON-Script node's
    // interface list parses cleanly and has no interface scope to be answered
    // from, so nothing else withholds it.
    {
      gate: 'G4',
      mutate: (s) => mutateInFunction(s, 'interfaceChainWithholds',
        '!reference.hostInterfaceScope || reference.hostInterfaceScope.recovered', 'false'),
      source: `${H}PROTO P [ eventIn SFTime go ] {\n`
        + '  Group { children [ Transform { eventIn SFTime t IS go } ] }\n}\n',
    },
    // G5 is NOT mutated here -- see the dedicated test below. Removing its
    // status check alone changes no outcome, because P2A structurally cannot
    // hand back a symbol or a built-in reason on a non-resolved answer. That is
    // a finding, not an omission, and it is pinned rather than asserted away.
  ];

  const seen = new Set();
  for (const mutant of mutants) {
    const mutated = load(mutant.mutate(original));
    const read = (mod) => {
      const graph = mod.buildScopeGraph(parse(mutant.source, mutant.opts));
      return mod.isReferences(graph).map((r) => (mutant.compare === 'verdict'
        ? mod.isConnectionVerdict(graph, r)
        : mod.resolveIs(graph, r))).map((x) => `${x.status}/${x.reason}`);
    };

    const before = read(sg);
    const after = read(mutated);
    assert.ok(before.length > 0, `${mutant.gate}: the fixture must produce an IS to answer`);
    assert.notDeepEqual(after, before,
      `${mutant.gate}: removing this condition changed nothing, so it is not load-bearing`
      + ` (both answered ${JSON.stringify(before)})`);
    // ... and the UNMUTATED module must be the SAFE one of the two, so a mutant
    // that merely differs cannot be mistaken for a mutant that is caught.
    for (const answer of before) {
      assert.equal(answer.startsWith(STATUS.RECOVERED), true,
        `${mutant.gate}: the real gate must withhold, got ${answer}`);
    }
    // For a gate that is the SOLE line of defence, the mutant must actually stop
    // withholding -- otherwise "the answers differ" could be satisfied by a
    // cosmetic change while safety was never at stake.
    if (mutant.soleDefence !== false) {
      for (const answer of after) {
        assert.notEqual(answer.startsWith(STATUS.RECOVERED), true,
          `${mutant.gate}: the mutant must stop withholding, got ${answer}`);
      }
    }
    seen.add(mutant.gate);
  }
  assert.deepEqual([...seen].sort(), ['G1', 'G2', 'G3', 'G4']);
});

test('36b G5: the endpoint gate holds, and the invariant that makes it redundant', () => {
  // G5 says: acquire no endpoint unless P2A RESOLVED the containing node's type.
  // Mutating the status check alone changes nothing, because two structural
  // facts already cover it -- so the honest thing is to pin THOSE, not to invent
  // a fixture that makes the check look decisive.
  //
  //   1. `createResolution` drops the symbol on any non-resolved status, so the
  //      PROTO/EXTERNPROTO/Script path finds nothing to consult; and
  //   2. `node-type-is-builtin` is only ever returned WITH `resolved`, so the
  //      schema path is unreachable from an unproven type.
  //
  // If either ever changes, G5 becomes the live guard -- and this test fails
  // first, rather than a wrong endpoint reaching a consumer.
  const sources = [
    // unknown vendor type
    `${H}PROTO P [ field SFBool x TRUE ] { VendorOnlyNode { someField IS x } }\n`,
    // duplicate declaration -> ambiguous
    `${H}PROTO Dup [ field SFBool a TRUE ] { Group { } }\n`
      + 'PROTO Dup [ field SFBool a TRUE ] { Group { } }\n'
      + 'PROTO P [ field SFBool x TRUE ] { Dup { a IS x } }\n',
    // instance before declaration -> invalid
    `${H}PROTO P [ field SFBool x TRUE ] { Later { a IS x } }\n`
      + 'PROTO Later [ field SFBool a TRUE ] { Group { } }\n',
    // damaged type chain -> recovered
    `${H}Group { children [ Shape { }\n`
      + 'PROTO P [ field SFBool x TRUE ] { Transform { translation IS x } }\n',
  ];
  let checked = 0;
  for (const source of sources) {
    const { graph } = build(source);
    for (const typeRes of sg.typeResolutions(graph)) {
      if (typeRes.status === STATUS.RESOLVED) continue;
      assert.equal(typeRes.symbol, null,
        'a non-resolved type answer must carry no symbol, or G5 becomes load-bearing');
      assert.notEqual(typeRes.reason, REASON.NODE_TYPE_IS_BUILTIN,
        'node-type-is-builtin must only ever accompany `resolved`');
      checked += 1;
    }
    // Behaviourally: no endpoint is ever acquired from such a node.
    for (const ref of sg.isReferences(graph)) {
      const v = sg.isConnectionVerdict(graph, ref);
      if (v.status === STATUS.RESOLVED) continue;
      assert.equal(v.endpoint, null, 'no endpoint may survive an unproven node type');
    }
  }
  assert.ok(checked >= 4, `every non-resolved shape must be exercised, saw ${checked}`);
});

// ===========================================================================
// 37-40  Structural safety
// ===========================================================================

test('37 safety: a projection from another graph is rejected, even for identical text', () => {
  const source = `${H}${HOST}PROTO P [ field SFBool x TRUE ] { Host { p IS x } }\n`;
  const a = build(source);
  const b = build(source);

  const memberA = sg.interfaceMembers(a.graph)[0];
  const refA = sg.isReferences(a.graph)[0];
  const scopeA = sg.interfaceScopes(a.graph)[0];

  assert.throws(() => sg.resolveIs(b.graph, refA), (e) => e.code === SCOPE_ERROR.REFERENCE);
  assert.throws(() => sg.isConnectionVerdict(b.graph, refA),
    (e) => e.code === SCOPE_ERROR.REFERENCE);
  assert.throws(() => sg.interfaceMemberIsUniqueInScope(b.graph, memberA),
    (e) => e.code === SCOPE_ERROR.SYMBOL);
  assert.throws(() => sg.isReferencesTo(b.graph, memberA), (e) => e.code === SCOPE_ERROR.SYMBOL);
  assert.throws(() => sg.membersOf(b.graph, scopeA), (e) => e.code === SCOPE_ERROR.GRAPH);

  // A shape-valid forgery has nothing behind it either.
  const forged = Object.freeze({ kind: REFERENCE_KIND.IS, namespace: NAMESPACE.INTERFACE_MEMBER });
  assert.equal(sym.isIsReferenceShape(forged), true, 'the forgery is shape-valid on purpose');
  assert.throws(() => sg.resolveIs(a.graph, forged), (e) => e.code === SCOPE_ERROR.REFERENCE);
});

test('38 safety: every P2B projection is frozen and leaks no Map, Set or array', () => {
  const source = `${H}${HOST}PROTO P [ exposedField SFBool x FALSE ] { Host { p IS x } }\n`;
  const { parsed, graph } = build(source);

  const lists = [sg.interfaceScopes(graph), sg.interfaceMembers(graph),
    sg.isReferences(graph), sg.isResolutions(graph)];
  for (const list of lists) {
    assert.equal(Object.isFrozen(list), true);
    assert.throws(() => list.push(null), TypeError);
  }
  const ref = sg.isReferences(graph)[0];
  const objects = [sg.interfaceScopes(graph)[0], sg.interfaceMembers(graph)[0], ref,
    sg.resolveIs(graph, ref), sg.isConnectionVerdict(graph, ref)];
  for (const obj of objects) {
    assert.equal(Object.isFrozen(obj), true);
    for (const value of Object.values(obj)) {
      assert.equal(value instanceof Map, false, 'no Map may be reachable');
      assert.equal(value instanceof Set, false, 'no Set may be reachable');
      if (Array.isArray(value)) assert.equal(Object.isFrozen(value), true);
    }
  }
  const v = sg.isConnectionVerdict(graph, ref);
  assert.equal(Object.isFrozen(v.endpoint), true);
  assert.equal(Object.isFrozen(v.evidence), true);
  // A fresh array each call, so a caller cannot mutate the graph's own state.
  assert.notEqual(sg.interfaceMembers(graph), sg.interfaceMembers(graph));
  // The outward interface list is NOT published: it exists only to explain a
  // near-miss, and publishing it would publish the chain 4.8.4 denies.
  assert.equal('outerInterfaces' in ref, false);
  const issues = sg.nodeIsBindingIssues(graph, (() => {
    let found = null;
    ast.walk(parsed.tree, (n) => { if (!found && n.type === ast.NODE.NODE) found = n; });
    return found;
  })());
  assert.equal(Object.isFrozen(issues), true);
  assert.equal(Object.isFrozen(issues.issues), true);
});

test('39 safety: no rejected identity strategy reaches the interface resolver', () => {
  for (const file of ['scope-graph.js', 'symbols.js']) {
    const code = codeOnly(fs.readFileSync(path.join(SRC, file), 'utf8'));
    for (const banned of ['closest', 'nearest', 'bestMatch', 'best_match', 'fuzzy', 'similar',
      'score', 'ranking', 'rankBy', 'fingerprint', 'structuralPath', 'siblingIndex',
      'firstMatch', 'levenshtein', 'distance']) {
      assert.equal(new RegExp(banned, 'i').test(code), false,
        `${file} must not contain ${banned}`);
    }
  }
  // Behaviourally, not just lexically: a duplicate is refused rather than ranked,
  // and adding a SECOND identical declaration never turns a refusal into a pick.
  const source = `${H}${HOST}PROTO P [ field SFBool d TRUE  field SFBool d TRUE ] `
    + '{ Host { p IS d } }\n';
  const { parsed, graph } = build(source);
  const res = expectIs(graph, isRefNamed(parsed, graph, 'p'),
    STATUS.AMBIGUOUS, REASON.DUPLICATE_INTERFACE_MEMBER);
  assert.equal(res.symbol, null);
  assert.equal(res.candidateCount, 2);
});

test('40 determinism: two builds over one text agree exactly', () => {
  const source = `${H}${HOST}PROTO P [ exposedField SFBool a FALSE  field SFInt32 b 0 ] {\n`
    + '  Group { children [ Host { p IS a }\n'
    + '    DEF S Script { eventIn SFTime t IS tIn  url "x.js" } ] }\n}\n'
    + 'EXTERNPROTO E [ field SFBool q ] [ "e.wrl" ]\n';
  const a = build(source);
  const b = build(source);

  const shape = (g) => ({
    scopes: sg.interfaceScopes(g).map((s) => `${s.kind}:${s.ownerName}:${s.recovered}`),
    members: sg.interfaceMembers(g).map((m) => `${m.sourceOrder}:${m.access} ${m.name}`),
    refs: sg.isReferences(g).map((r) => `${r.sourceOrder}:${r.form}:${r.endpointName}:${r.name}`),
    answers: sg.isResolutions(g).map((r) => `${r.status}/${r.reason}`),
    verdicts: sg.isReferences(g).map(
      (r) => `${sg.isConnectionVerdict(g, r).status}/${sg.isConnectionVerdict(g, r).reason}`,
    ),
  });
  assert.deepEqual(shape(a.graph), shape(b.graph));
  // Source order is genuinely source order, not construction order.
  const offsets = sg.interfaceMembers(a.graph).map((m) => m.declRange.start.offset);
  assert.deepEqual(offsets.slice().sort((x, y) => x - y), offsets);
});

// ===========================================================================
// 41-42  Compatibility profile: classified, never normalized
// ===========================================================================

test('41 profile: a user exposedField in a Script body is declared AND classified', () => {
  // Annex A.3 admits no such declaration; the corpus holds 1,577 of them. Per
  // WD.md §9 it is preserved and tagged, never silently promoted into
  // conforming behaviour and never dropped.
  const source = `${H}DEF S Script { exposedField SFBool run FALSE  url "x.js" }\n`;
  const { parsed, graph } = build(source);
  const member = sg.interfaceMembers(graph)[0];
  assert.equal(member.name, 'run');
  assert.equal(member.access, ACCESS.EXPOSED_FIELD, 'recorded as written, not rewritten');
  assert.equal(member.detail, REASON.EXPOSED_FIELD_IN_SCRIPT_INTERFACE);
  assert.equal(member.scope.recovered, false, 'a compatibility shape is not damage');
  void parsed;
});

test('42 profile: an IS inside a PROTO interface LIST is classified, not bound', () => {
  // Annex A.2 gives an interface declaration no IS form at all; the corpus holds
  // 20. It is recorded on the member and mints no binding, because there is no
  // node body here for one to live in.
  const source = `${H}PROTO P [ exposedField SFColor diffColorLow IS diffColorLow ] {\n`
    + '  Group { }\n}\n';
  const { parsed, graph } = build(source);
  const member = sg.interfaceMembers(graph)[0];
  assert.equal(member.name, 'diffColorLow');
  assert.equal(member.detail, REASON.IS_IN_INTERFACE_DECLARATION_LIST);
  assert.equal(sg.isReferences(graph).length, 0, 'no IS reference is minted in an interface list');
  void parsed;
});

// ===========================================================================
// Lane boundary
// ===========================================================================

test('boundary: P2B still wires no consumer, and P2C did not change that', () => {
  for (const file of ['analyze.js', 'node-identity.js', 'document-transaction.js',
    'parser.js', 'tokenizer.js', 'ast.js', 'source-map.js', 'edit.js', 'index.js']) {
    const other = fs.readFileSync(path.join(SRC, file), 'utf8');
    assert.equal(/require\(['"]\.\/scope-graph['"]\)/.test(other), false,
      `${file} must not require scope-graph`);
  }
  const facade = require('../../src/vrml');
  for (const name of ['scopeGraph', 'buildScopeGraph', 'interfaceMembers', 'resolveIs',
    'isConnectionVerdict',
    // WD1.5-P2C is consumer-free on exactly the same terms as P2B. Landing the
    // ROUTE lane did not open the facade a crack for it.
    'routeReferences', 'resolveRouteNode', 'resolveRouteEndpoint', 'routeVerdict',
    'routesFrom', 'routesTo']) {
    assert.equal(name in facade, false, `${name} must not be exposed through the facade`);
  }
  // P2C's endpoint reuse is INTERNAL: `acquireEndpointOn` is shared by `IS` and
  // ROUTE inside this module and must not have become public surface to do it.
  for (const name of ['acquireEndpointOn', 'acquireEndpoint', 'interfaceEndpoint']) {
    assert.equal(name in sg, false, `${name} must stay module-private`);
    assert.equal(name in sym, false, `${name} must not be re-exported by symbols.js`);
  }
  // The parser and the committed schema are untouched inputs.
  assert.equal(sg.buildScopeGraph.length, 1);
});
