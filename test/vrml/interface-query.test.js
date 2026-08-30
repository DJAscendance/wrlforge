'use strict';
// Effective-interface enumeration tests (Phase WD1.6-B).
//
// A SEPARATE FILE from `type-resolution.test.js` (P2A), `interface-is.test.js`
// (P2B) and `route-semantics.test.js` (P2C), for the reason each gave in turn:
// their value is partly that they did NOT change when this lane landed. B is a
// refactor of machinery all three depend on, so an unchanged predecessor suite
// is this lane's primary evidence.
//
// WHAT THIS FILE IS ACTUALLY PROVING. `effectiveInterfaceOf` must be an
// ENUMERATION of the shipped endpoint authority, not a second resolver. So the
// assertions come in two kinds:
//
//   1. shape and projection facts -- one declaration appears once, its written
//      names are separate, ambiguity survives, a frozen result is really frozen;
//   2. AGREEMENT -- for every name both paths answer, the projection says what
//      `IS`/ROUTE endpoint resolution says. A disagreement means two traversals
//      exist, whatever the first kind reports.
//
// Fixtures are string literals original to this lane; nothing under `spikes/`
// is imported.

const test = require('node:test');
const assert = require('node:assert/strict');

const { parse } = require('../../src/vrml');
const vrml = require('../../src/vrml');
const sg = require('../../src/vrml/scope-graph');
const nodeSchema = require('../../src/vrml/node-schema');
const { effectiveInterfaceOf } = require('../../src/vrml/interface-query');

const { STATUS, REASON, ACCESS, ENDPOINT_ORIGIN, BINDING_FORM, SCOPE_ERROR } = sg;

const H = '#VRML V2.0 utf8\n';

/** Parse, build, and project the node occurrence at `index` of the document. */
function project(text, index = 0) {
  const parsed = parse(H + text);
  const graph = sg.buildScopeGraph(parsed);
  const node = parsed.tree.statements[index];
  return { parsed, graph, node, iface: effectiveInterfaceOf(graph, node) };
}

/**
 * The first `Node` occurrence of a type anywhere in the tree, by an independent
 * walk over the AST's own keys -- never via the scope graph being tested.
 */
function firstNodeNamed(value, nodeType) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstNodeNamed(item, nodeType);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  if (value.type === 'Node' && value.nodeType === nodeType) return value;
  for (const key of ['statements', 'body', 'fields', 'interfaces', 'value', 'default']) {
    const found = firstNodeNamed(value[key], nodeType);
    if (found) return found;
  }
  return null;
}

const memberNamed = (iface, name) => iface.members.filter((m) => m.name === name);

// --- built-in nodes ---------------------------------------------------------

test('01 a built-in node enumerates its clause-6 interface, resolved and complete', () => {
  const { iface } = project('Transform { }\n');
  assert.equal(iface.nodeType, 'Transform');
  assert.equal(iface.sourceOrigin, ENDPOINT_ORIGIN.BUILTIN_SCHEMA);
  assert.equal(iface.status, STATUS.RESOLVED);
  assert.equal(iface.complete, true);
  assert.ok(iface.members.length > 0);
  for (const m of iface.members) {
    assert.equal(m.declarationOrigin, ENDPOINT_ORIGIN.BUILTIN_SCHEMA);
    assert.equal(m.declRange, null, 'a clause-6 field is declared nowhere in the file');
  }
});

test('02 built-in members are in ISO declaration order', () => {
  const { iface } = project('Transform { }\n');
  const orders = iface.members.map((m) => m.sourceOrder);
  assert.deepEqual(orders, orders.slice().sort((a, b) => a - b));
});

test('03 X3D-only fields are absent from a VRML97 interface', () => {
  const { iface } = project('Transform { }\n');
  // `bboxDisplay` is X3D-only: its `vrml97Declaration` is null.
  assert.equal(nodeSchema.getFieldSchema('Transform', 'bboxDisplay').vrml97Declaration, null);
  assert.equal(iface.byName.bboxDisplay, undefined);
  assert.equal(memberNamed(iface, 'bboxDisplay').length, 0);
  for (const m of iface.members) {
    assert.equal(nodeSchema.isFieldAllowed('Transform', m.name, 'vrml97'), true);
  }
});

test('04 enumeration and lookup use the SAME VRML97 gate', () => {
  // Every enumerated name must be acquirable, and every schema field the
  // acquisition path admits must be enumerated. A gap either way means the two
  // halves disagree about what a VRML97 interface contains.
  for (const nodeType of ['Transform', 'Shape', 'Script', 'TimeSensor']) {
    const { graph, node, iface } = project(`${nodeType} { }\n`);
    for (const name of Object.keys(iface.byName)) {
      const acquired = sg.acquireEndpointFor(graph, node, name);
      assert.equal(acquired.status, iface.byName[name].status, `${nodeType}.${name}`);
    }
    const declared = iface.members
      .filter((m) => m.declarationOrigin === ENDPOINT_ORIGIN.BUILTIN_SCHEMA)
      .map((m) => m.name).sort();
    const expected = Object.keys(nodeSchema.getNodeSchema(nodeType).fields)
      .filter((f) => nodeSchema.getFieldSchema(nodeType, f).vrml97Declaration).sort();
    assert.deepEqual(declared, expected, nodeType);
  }
});

test('05 constraints from WD1.6-A pass through verbatim, including absence', () => {
  const { iface } = project('Transform { }\n');
  const bboxCenter = memberNamed(iface, 'bboxCenter')[0];
  assert.equal(bboxCenter.constraints, nodeSchema.getFieldSchema('Transform', 'bboxCenter').constraints);
  assert.equal(bboxCenter.constraints.minSymbolic, '-infinity');
  const children = memberNamed(iface, 'children')[0];
  assert.deepEqual(children.constraints.acceptedNodeClasses, ['children']);
  // A field with no recorded constraint reports null -- which PERMITS, and is
  // never to be read as "unrestricted was proven".
  const noneOf = iface.members.filter((m) => m.constraints === null);
  assert.ok(noneOf.length > 0);
});

// --- one declaration, several written names ---------------------------------

test('06 an exposedField is ONE member with THREE written-name bindings', () => {
  const { iface } = project('Transform { }\n');
  const translation = memberNamed(iface, 'translation');
  assert.equal(translation.length, 1, 'one declaration appears exactly once');
  assert.equal(translation[0].access, ACCESS.EXPOSED_FIELD);
  assert.deepEqual(translation[0].bindings.map((b) => b.writtenName),
    ['translation', 'set_translation', 'translation_changed']);
});

test('07 each binding carries its OWN effective access and form', () => {
  const { iface } = project('Transform { }\n');
  const [base, input, output] = memberNamed(iface, 'translation')[0].bindings;
  assert.deepEqual(
    [base.effectiveAccess, input.effectiveAccess, output.effectiveAccess],
    [ACCESS.EXPOSED_FIELD, ACCESS.EVENT_IN, ACCESS.EVENT_OUT],
  );
  assert.deepEqual([base.form, input.form, output.form],
    [BINDING_FORM.DECLARED, BINDING_FORM.SET_ALIAS, BINDING_FORM.CHANGED_ALIAS]);
  assert.deepEqual([base.viaAlias, input.viaAlias, output.viaAlias], [false, true, true]);
});

test('08 byName resolves every written form to the SAME declaration', () => {
  const { iface } = project('Transform { }\n');
  const member = memberNamed(iface, 'translation')[0];
  for (const name of ['translation', 'set_translation', 'translation_changed']) {
    assert.equal(iface.byName[name].status, STATUS.RESOLVED);
    assert.equal(iface.byName[name].writtenName, name);
  }
  assert.equal(member.bindings.length, 3);
});

test('09 a non-exposedField declaration has exactly one binding', () => {
  const { iface } = project('Transform { }\n');
  assert.deepEqual(memberNamed(iface, 'addChildren')[0].bindings.map((b) => b.writtenName),
    ['addChildren']);
  assert.deepEqual(memberNamed(iface, 'bboxCenter')[0].bindings.map((b) => b.form),
    [BINDING_FORM.DECLARED]);
});

// --- Script -----------------------------------------------------------------

test('10 a Script enumerates its user declarations AND its clause-6 fields', () => {
  const { iface } = project('Script { field SFBool go TRUE eventOut SFTime t }\n');
  assert.equal(iface.sourceOrigin, ENDPOINT_ORIGIN.SCRIPT_INTERFACE);
  assert.equal(iface.status, STATUS.RESOLVED);
  assert.equal(iface.complete, true);
  assert.equal(memberNamed(iface, 'go')[0].declarationOrigin, ENDPOINT_ORIGIN.SCRIPT_INTERFACE);
  assert.equal(memberNamed(iface, 't')[0].declarationOrigin, ENDPOINT_ORIGIN.SCRIPT_INTERFACE);
  // Clause 6 still supplies the Script node's own fields.
  assert.equal(memberNamed(iface, 'directOutput')[0].declarationOrigin,
    ENDPOINT_ORIGIN.BUILTIN_SCHEMA);
  assert.equal(memberNamed(iface, 'mustEvaluate')[0].declarationOrigin,
    ENDPOINT_ORIGIN.BUILTIN_SCHEMA);
});

test('11 a Script user declaration is bound by object identity, not by name', () => {
  const { parsed, iface } = project('Script { field SFBool go TRUE }\n');
  const script = parsed.tree.statements[0];
  const decl = script.interfaces.find((i) => i.name === 'go');
  assert.ok(decl);
  assert.equal(iface.byName.go.member.declNode, decl);
  assert.equal(iface.byName.go.member, memberNamed(iface, 'go')[0],
    'a binding links to the PROJECTED member, not to the raw symbol');
});

test('12 SHADOWING IS PER NAME, and is the authority\'s answer, not a rule applied here', () => {
  // `field MFString url` occupies `url` only. The clause-6 `exposedField url`
  // therefore keeps `set_url` and `url_changed`. Both declarations are genuinely
  // reachable under different names, and the projection reports that rather than
  // picking a winner.
  const { graph, node, iface } = project('Script { field MFString url [] }\n');
  const urls = memberNamed(iface, 'url');
  assert.equal(urls.length, 2);
  const own = urls.find((m) => m.declarationOrigin === ENDPOINT_ORIGIN.SCRIPT_INTERFACE);
  const clause6 = urls.find((m) => m.declarationOrigin === ENDPOINT_ORIGIN.BUILTIN_SCHEMA);
  assert.deepEqual(own.bindings.map((b) => b.writtenName), ['url']);
  assert.deepEqual(clause6.bindings.map((b) => b.writtenName), ['set_url', 'url_changed']);
  assert.equal(iface.byName.url.member.access, ACCESS.FIELD, 'the declaration wins for `url`');
  // ... and that is exactly what the shipped authority says, independently.
  assert.equal(sg.acquireEndpointFor(graph, node, 'url').endpoint.origin,
    ENDPOINT_ORIGIN.SCRIPT_INTERFACE);
  assert.equal(sg.acquireEndpointFor(graph, node, 'set_url').endpoint.origin,
    ENDPOINT_ORIGIN.BUILTIN_SCHEMA);
});

test('13 a Script that declares nothing is a plain built-in source', () => {
  const { iface } = project('Script { }\n');
  assert.equal(iface.sourceOrigin, ENDPOINT_ORIGIN.BUILTIN_SCHEMA);
  assert.equal(iface.complete, true);
  assert.equal(memberNamed(iface, 'url').length, 1);
});

// --- PROTO ------------------------------------------------------------------

test('14 a PROTO instance enumerates its declared interface', () => {
  const { iface } = project(
    'PROTO P [ exposedField SFVec3f p 0 0 0 eventIn SFTime go ] { Group { } }\nP { }\n', 1,
  );
  assert.equal(iface.sourceOrigin, ENDPOINT_ORIGIN.PROTO_INTERFACE);
  assert.equal(iface.status, STATUS.RESOLVED);
  assert.equal(iface.complete, true);
  assert.deepEqual(iface.members.map((m) => m.name), ['p', 'go']);
  assert.deepEqual(Object.keys(iface.byName),
    ['p', 'set_p', 'p_changed', 'go']);
});

test('15 PROTO members bind to the declaration by object identity', () => {
  const { parsed, iface } = project(
    'PROTO P [ exposedField SFVec3f p 0 0 0 ] { Group { } }\nP { }\n', 1,
  );
  const decl = parsed.tree.statements[0].interfaces.find((i) => i.name === 'p');
  for (const name of ['p', 'set_p', 'p_changed']) {
    assert.equal(iface.byName[name].member.declNode, decl, name);
  }
});

test('16 a nested PROTO instance resolves in its own interface, not the outer one', () => {
  const text = 'PROTO Outer [ field SFBool outerOnly TRUE ] {\n'
    + '  PROTO Inner [ field SFBool innerOnly TRUE ] { Group { } }\n'
    + '  Inner { }\n}\nOuter { }\n';
  const parsed = parse(H + text);
  const graph = sg.buildScopeGraph(parsed);
  const inner = firstNodeNamed(parsed.tree.statements, 'Inner');
  assert.ok(inner);
  const iface = effectiveInterfaceOf(graph, inner);
  assert.equal(iface.status, STATUS.RESOLVED);
  assert.deepEqual(iface.members.map((m) => m.name), ['innerOnly']);
  assert.equal(iface.byName.outerOnly, undefined, '4.8.4: interfaces do not nest outward');
});

test('17 a PROTO instantiated BEFORE its declaration yields no interface', () => {
  // P2A's shipped rule, propagated rather than reinterpreted: an instance that
  // precedes its declaration is `invalid`, not merely unresolved. Enumeration
  // does not get to be more permissive than the authority it projects -- and
  // `invalid` is therefore a reachable top-level status.
  const { iface } = project('P { }\nPROTO P [ field SFBool a TRUE ] { Group { } }\n', 0);
  assert.equal(iface.status, STATUS.INVALID);
  assert.equal(iface.reason, REASON.PROTO_INSTANCE_BEFORE_DECLARATION);
  assert.equal(iface.complete, false);
  assert.equal(iface.members.length, 0);
  assert.deepEqual(Object.keys(iface.byName), []);
});

test('18 an ambiguous PROTO TYPE name yields no interface at all', () => {
  const { iface } = project(
    'PROTO P [ field SFBool a TRUE ] { Group { } }\n'
    + 'PROTO P [ field SFBool b TRUE ] { Group { } }\nP { }\n', 2,
  );
  assert.equal(iface.status, STATUS.AMBIGUOUS);
  assert.equal(iface.complete, false);
  assert.equal(iface.members.length, 0);
  assert.deepEqual(Object.keys(iface.byName), []);
});

test('19 an unresolved node type withholds every member', () => {
  const { iface } = project('NoSuchNodeType { }\n');
  assert.equal(iface.status, STATUS.UNRESOLVED);
  assert.equal(iface.complete, false);
  assert.equal(iface.members.length, 0);
});

// --- EXTERNPROTO ------------------------------------------------------------

test('20 an EXTERNPROTO is RESOLVED and NOT complete', () => {
  const { iface } = project(
    'EXTERNPROTO E [ eventIn SFTime go field SFBool flag ] "e.wrl"\nE { }\n', 1,
  );
  assert.equal(iface.sourceOrigin, ENDPOINT_ORIGIN.EXTERNPROTO_INTERFACE);
  assert.equal(iface.status, STATUS.RESOLVED, '4.9.2: what it declares IS authoritative');
  assert.equal(iface.complete, false, 'its silence about other members is unknowable');
  assert.deepEqual(iface.members.map((m) => m.name), ['go', 'flag']);
});

test('21 EXTERNPROTO incompleteness is never encoded as unresolved/invalid/empty', () => {
  const { iface } = project('EXTERNPROTO E [ eventIn SFTime go ] "e.wrl"\nE { }\n', 1);
  assert.notEqual(iface.status, STATUS.UNRESOLVED);
  assert.notEqual(iface.status, STATUS.INVALID);
  assert.notEqual(iface.status, STATUS.UNSUPPORTED);
  assert.ok(iface.members.length > 0);
  assert.equal(iface.byName.go.status, STATUS.RESOLVED);
});

test('22 a name absent from an EXTERNPROTO is absent from byName, not proven absent', () => {
  const { graph, node, iface } = project(
    'EXTERNPROTO E [ eventIn SFTime go ] "e.wrl"\nE { }\n', 1,
  );
  assert.equal(iface.byName.notDeclaredLocally, undefined);
  // `complete: false` is what stops that being read as "no such member": the
  // authority itself calls it UNSUPPORTED, never UNRESOLVED.
  assert.equal(iface.complete, false);
  assert.equal(sg.acquireEndpointFor(graph, node, 'notDeclaredLocally').status,
    STATUS.UNSUPPORTED);
});

test('23 no URL is loaded to answer any of it', () => {
  // A structural statement, not a promise: the module requires no I/O at all.
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../src/vrml/interface-query.js'), 'utf8',
  );
  assert.equal(/require\((['"])(fs|node:fs|http|https|net)\1\)/.test(src), false);
});

// --- ambiguity --------------------------------------------------------------

test('24 an ambiguous written name STAYS in byName and binds nothing', () => {
  // 4.3.5 prohibits `exposedField zzz` alongside an explicit `eventIn set_zzz`,
  // so neither declaration is "intended" and neither may be preferred.
  const { iface } = project(
    'PROTO P [ exposedField SFBool zzz TRUE eventIn SFBool set_zzz ] { Group { } }\nP { }\n', 1,
  );
  const binding = iface.byName.set_zzz;
  assert.ok(binding, 'ambiguous is NOT the same as absent');
  assert.equal(binding.status, STATUS.AMBIGUOUS);
  assert.equal(binding.reason, REASON.DUPLICATE_INTERFACE_MEMBER);
  assert.equal(binding.member, null, 'no candidate is preferred');
  assert.ok(binding.evidence.length > 1, 'both declarations are cited');
});

test('25 ambiguous and absent are distinguishable', () => {
  const { iface } = project(
    'PROTO P [ exposedField SFBool zzz TRUE eventIn SFBool set_zzz ] { Group { } }\nP { }\n', 1,
  );
  assert.equal(iface.byName.neverDeclared, undefined, 'absent -> no key');
  assert.equal(iface.byName.set_zzz.status, STATUS.AMBIGUOUS, 'ambiguous -> a key with a status');
});

test('26 ONE ambiguous alias does not poison the interface or its other members', () => {
  // `status`/`complete` are properties of the SOURCE. The node type and its
  // interface are fully known here, so the interface is trustworthy and
  // exhaustive even though one name within it binds nothing.
  const { iface } = project(
    'PROTO P [ exposedField SFBool zzz TRUE eventIn SFBool set_zzz field SFInt32 ok 0 ]'
    + ' { Group { } }\nP { }\n', 1,
  );
  assert.equal(iface.status, STATUS.RESOLVED);
  assert.equal(iface.complete, true, 'complete means exhaustive, not "every binding is usable"');
  assert.equal(memberNamed(iface, 'ok')[0].status, STATUS.RESOLVED);
  assert.equal(iface.byName.ok.status, STATUS.RESOLVED);
  assert.equal(iface.byName.set_zzz.status, STATUS.AMBIGUOUS);
});

test('27 a duplicate declaration appears in members and is reported ambiguous', () => {
  const { iface } = project(
    'PROTO P [ field SFBool dup TRUE field SFInt32 dup 0 ] { Group { } }\nP { }\n', 1,
  );
  assert.equal(memberNamed(iface, 'dup').length, 2, 'both declarations remain visible');
  for (const m of memberNamed(iface, 'dup')) assert.equal(m.status, STATUS.AMBIGUOUS);
  assert.equal(iface.byName.dup.status, STATUS.AMBIGUOUS);
  assert.equal(iface.byName.dup.member, null);
});

// --- recovery ---------------------------------------------------------------

test('28 a damaged interface withholds every answer, the POSITIVE ones included', () => {
  // Recovery moves scope boundaries, so a damaged interface can manufacture a
  // member as easily as it can lose one. Neither may be asserted.
  const { iface } = project('PROTO Bad [ field SFBool ] { Group { } }\nBad { }\n', 1);
  assert.equal(iface.status, STATUS.RECOVERED);
  assert.equal(iface.complete, false);
  assert.equal(iface.members.length, 0);
  assert.deepEqual(Object.keys(iface.byName), []);
});

// --- lifetime and error discipline ------------------------------------------

test('29 a non-occurrence is null; a foreign parse THROWS', () => {
  const { graph, parsed } = project('Transform { }\n');
  assert.equal(effectiveInterfaceOf(graph, null), null);
  assert.equal(effectiveInterfaceOf(graph, { type: 'Route' }), null);
  assert.equal(effectiveInterfaceOf(graph, parsed.tree), null);
  // A node occurrence from ANOTHER parse is a programming error and fails loudly
  // rather than degrading into `unresolved` (WD1.4's cross-document rule).
  const other = parse(`${H}Transform { }\n`);
  assert.throws(() => effectiveInterfaceOf(graph, other.tree.statements[0]),
    (e) => e.code === SCOPE_ERROR.PARSE);
});

test('30 a foreign graph handle throws ESCOPEGRAPH', () => {
  const { node } = project('Transform { }\n');
  assert.throws(() => effectiveInterfaceOf(Object.freeze({}), node),
    (e) => e.code === SCOPE_ERROR.GRAPH);
});

test('31 two graphs over one parse hand out independent projections', () => {
  const parsed = parse(`${H}Transform { }\n`);
  const a = effectiveInterfaceOf(sg.buildScopeGraph(parsed), parsed.tree.statements[0]);
  const b = effectiveInterfaceOf(sg.buildScopeGraph(parsed), parsed.tree.statements[0]);
  assert.notEqual(a, b, 'no cross-graph cache');
  assert.deepEqual(a.members.map((m) => m.name), b.members.map((m) => m.name));
});

// --- immutability -----------------------------------------------------------

test('32 the whole projection is frozen, at every depth', () => {
  const { iface } = project('Transform { }\n');
  assert.ok(Object.isFrozen(iface));
  assert.ok(Object.isFrozen(iface.members));
  assert.ok(Object.isFrozen(iface.byName));
  for (const m of iface.members) {
    assert.ok(Object.isFrozen(m));
    assert.ok(Object.isFrozen(m.bindings));
    for (const b of m.bindings) {
      assert.ok(Object.isFrozen(b));
      assert.ok(Object.isFrozen(b.evidence));
    }
  }
});

test('33 byName is genuinely read-only -- BEHAVIOURALLY, not just Object.isFrozen', () => {
  // `Object.freeze(new Map())` does NOT prevent `.set()`/`.delete()`, so a
  // frozen Map would be an immutability claim the runtime does not honour.
  // This asserts the mutation does not take effect, which a Map would fail.
  const { iface } = project('Transform { }\n');
  assert.equal(iface.byName instanceof Map, false);
  assert.equal(Object.getPrototypeOf(iface.byName), null);
  const before = iface.byName.translation;
  try { iface.byName.translation = 'clobbered'; } catch (e) { /* strict mode */ }
  try { iface.byName.injected = 'nope'; } catch (e) { /* strict mode */ }
  try { delete iface.byName.translation; } catch (e) { /* strict mode */ }
  assert.equal(iface.byName.translation, before);
  assert.equal(iface.byName.injected, undefined);
});

test('34 no Map or Set is reachable anywhere in the result', () => {
  const { iface } = project('Script { field SFBool go TRUE }\n');
  const seen = new Set();
  (function walk(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    assert.equal(value instanceof Map, false);
    assert.equal(value instanceof Set, false);
    for (const key of Object.keys(value)) {
      // Ranges and AST nodes are shared by reference and deliberately unfrozen;
      // they are not part of this projection's own structure.
      if (key === 'node' || key === 'declRange' || key === 'member') continue;
      walk(value[key]);
    }
  }(iface));
});

test('35 a null-prototype index is safe for adversarial identifiers', () => {
  const { iface } = project(
    'PROTO P [ field SFBool constructor TRUE field SFBool hasOwnProperty TRUE ]'
    + ' { Group { } }\nP { }\n', 1,
  );
  assert.equal(iface.byName.constructor.status, STATUS.RESOLVED);
  assert.equal(iface.byName.hasOwnProperty.status, STATUS.RESOLVED);
  assert.equal(iface.byName.toString, undefined, 'no inherited false positive');
});

// --- agreement with the shipped authority -----------------------------------

test('36 EVERY enumerated name agrees with the shipped endpoint authority', () => {
  const cases = [
    'Transform { }\n',
    'Script { field SFBool go TRUE eventOut SFTime t }\n',
    'Script { field MFString url [] }\n',
    'PROTO P [ exposedField SFVec3f p 0 0 0 eventIn SFTime go ] { Group { } }\nP { }\n',
    'EXTERNPROTO E [ eventIn SFTime go field SFBool f ] "e.wrl"\nE { }\n',
    'PROTO P [ exposedField SFBool zzz TRUE eventIn SFBool set_zzz ] { Group { } }\nP { }\n',
  ];
  let compared = 0;
  for (const text of cases) {
    const parsed = parse(H + text);
    const graph = sg.buildScopeGraph(parsed);
    for (const node of parsed.tree.statements) {
      const iface = effectiveInterfaceOf(graph, node);
      if (!iface) continue;
      for (const name of Object.keys(iface.byName)) {
        const binding = iface.byName[name];
        const acquired = sg.acquireEndpointFor(graph, node, name);
        assert.equal(binding.status, acquired.status, `${text} :: ${name} status`);
        assert.equal(binding.reason, acquired.reason, `${text} :: ${name} reason`);
        if (acquired.endpoint) {
          assert.equal(binding.effectiveAccess, acquired.endpoint.access, `${name} access`);
          assert.equal(binding.form, acquired.endpoint.form, `${name} form`);
          assert.equal(binding.viaAlias, acquired.endpoint.viaAlias, `${name} viaAlias`);
          // The projection publishes its OWN member; identity is compared
          // through the declaration the authority named.
          if (binding.member) {
            assert.equal(binding.member.declNode,
              acquired.endpoint.member ? acquired.endpoint.member.node : null, `${name} member`);
          }
        }
        compared += 1;
      }
    }
  }
  assert.ok(compared > 40, `expected a real comparison set, got ${compared}`);
});

test('37 the projection agrees with IS endpoint acquisition on the same node', () => {
  const text = 'PROTO P [ exposedField SFVec3f pos 0 0 0 ] {\n'
    + '  Transform { translation IS pos set_scale IS pos }\n}\nP { }\n';
  const parsed = parse(H + text);
  const graph = sg.buildScopeGraph(parsed);
  const host = firstNodeNamed(parsed.tree.statements, 'Transform');
  const iface = effectiveInterfaceOf(graph, host);
  let checked = 0;
  for (const ref of sg.isReferences(graph)) {
    const verdict = sg.isConnectionVerdict(graph, ref);
    if (!verdict.endpoint) continue;
    const binding = iface.byName[verdict.endpoint.name];
    assert.ok(binding, `IS endpoint ${verdict.endpoint.name} must be enumerated`);
    assert.equal(binding.effectiveAccess, verdict.endpoint.access);
    assert.equal(binding.status, STATUS.RESOLVED);
    checked += 1;
  }
  assert.equal(checked, 2);
});

test('38 the projection agrees with ROUTE endpoint acquisition on the same node', () => {
  const text = 'DEF T Transform { }\nDEF S TimeSensor { }\n'
    + 'ROUTE S.fraction_changed TO T.set_translation\n';
  const parsed = parse(H + text);
  const graph = sg.buildScopeGraph(parsed);
  let checked = 0;
  for (const ref of sg.routeEventReferences(graph)) {
    const endpoint = sg.routeEndpointFor(graph, ref);
    if (!endpoint) continue;
    const host = sg.resolveRouteNode(graph, sg.routeNodeReferences(graph)
      .find((n) => n.side === ref.side));
    if (!host || host.status !== STATUS.RESOLVED) continue;
    const iface = effectiveInterfaceOf(graph, host.symbol.node);
    const binding = iface.byName[endpoint.name];
    assert.ok(binding, `ROUTE endpoint ${endpoint.name} must be enumerated`);
    assert.equal(binding.effectiveAccess, endpoint.access);
    assert.equal(binding.form,
      endpoint.name === endpoint.effectiveName
        ? BINDING_FORM.DECLARED
        : (endpoint.name.startsWith('set_')
          ? BINDING_FORM.SET_ALIAS : BINDING_FORM.CHANGED_ALIAS));
    checked += 1;
  }
  assert.equal(checked, 2);
});

// --- facade -----------------------------------------------------------------

test('39 the facade publishes the consumer surface and nothing more', () => {
  assert.deepEqual(Object.keys(vrml.interfaceQuery).sort(), [
    'ACCESS', 'BINDING_FORM', 'ENDPOINT_ORIGIN', 'REASON', 'SCOPE_ERROR', 'STATUS',
    'buildScopeGraph', 'effectiveInterfaceOf',
    'isAmbiguous', 'isInvalid', 'isRecovered', 'isResolved', 'isUnresolved',
  ]);
  assert.ok(Object.isFrozen(vrml.interfaceQuery));
  // The substrate stays unpublished: consumers use the consumer layer.
  assert.equal(vrml.scopeGraph, undefined);
  assert.equal(vrml.symbols, undefined);
  assert.equal(vrml.interfaceQuery.resolveIs, undefined);
  assert.equal(vrml.interfaceQuery.acquireEndpointFor, undefined);
  assert.equal(vrml.interfaceQuery.interfaceSourceOf, undefined);
  // WD2-A's renderer reaches USE resolution through the bundled
  // `scopeGraph.resolve` re-export on the scene bridge, not through this
  // facade -- so `resolve` is NOT a published entry here. (The scope-graph
  // module still owns the function; the facade deliberately omits it.)
  assert.equal(vrml.interfaceQuery.resolve, undefined);
});

test('40 a consumer can do the whole job through the facade alone', () => {
  const q = vrml.interfaceQuery;
  const parsed = vrml.parse(`${H}Transform { }\n`);
  const graph = q.buildScopeGraph(parsed);
  const iface = q.effectiveInterfaceOf(graph, parsed.tree.statements[0]);
  assert.ok(q.isResolved(iface));
  assert.equal(iface.byName.set_translation.form, q.BINDING_FORM.SET_ALIAS);
});

// --- consumer proofs --------------------------------------------------------

test('41 P4-shaped consumer: classify a written name without a severity model', () => {
  const q = vrml.interfaceQuery;
  const parsed = vrml.parse(`${H}PROTO P [ exposedField SFBool zzz TRUE `
    + 'eventIn SFBool set_zzz field SFInt32 ok 0 ] { Group { } }\nP { }\n');
  const graph = q.buildScopeGraph(parsed);
  const iface = q.effectiveInterfaceOf(graph, parsed.tree.statements[1]);

  const classify = (name) => {
    const binding = iface.byName[name];
    if (!binding) return iface.complete ? 'no-such-name' : 'not-locally-declared';
    if (q.isAmbiguous(binding)) return 'ambiguous';
    if (!q.isResolved(binding)) return binding.status;
    return `${binding.member.access}:${binding.member.type}:${binding.effectiveAccess}`;
  };
  assert.equal(classify('ok'), 'field:SFInt32:field');
  assert.equal(classify('set_zzz'), 'ambiguous');
  assert.equal(classify('zzz_changed'), 'exposedField:SFBool:eventOut');
  assert.equal(classify('nothing'), 'no-such-name');
});

test('42 WD2-shaped consumer: one editable row per declaration, routes listed apart', () => {
  const q = vrml.interfaceQuery;
  const parsed = vrml.parse(`${H}Transform { }\n`);
  const graph = q.buildScopeGraph(parsed);
  const iface = q.effectiveInterfaceOf(graph, parsed.tree.statements[0]);

  // An inspector renders DECLARATIONS -- an exposedField is one row, not three.
  const editable = iface.members
    .filter((m) => m.access === q.ACCESS.FIELD || m.access === q.ACCESS.EXPOSED_FIELD)
    .map((m) => ({ label: m.name, type: m.type, constraints: m.constraints }));
  assert.equal(editable.filter((r) => r.label === 'translation').length, 1);
  assert.equal(editable.find((r) => r.label === 'bboxCenter').constraints.maxSymbolic, 'infinity');

  // A route picker enumerates WRITTEN NAMES, which is a different list.
  const routable = [];
  for (const m of iface.members) {
    for (const b of m.bindings) {
      if (b.effectiveAccess === q.ACCESS.EVENT_IN) routable.push(b.writtenName);
    }
  }
  assert.ok(routable.includes('set_translation'));
  assert.ok(routable.includes('addChildren'));
  assert.equal(routable.includes('bboxCenter'), false);

  // And an incomplete interface must be surfaced as such.
  const ext = vrml.parse(`${H}EXTERNPROTO E [ eventIn SFTime go ] "e.wrl"\nE { }\n`);
  const extIface = q.effectiveInterfaceOf(q.buildScopeGraph(ext), ext.tree.statements[1]);
  assert.equal(extIface.complete, false);
  assert.equal(extIface.status, STATUS.RESOLVED);
});
