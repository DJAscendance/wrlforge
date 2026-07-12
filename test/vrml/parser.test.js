'use strict';
// Parser tests (Phase 7A): every top-level construct, nested nodes/arrays, PROTO
// + IS, Script declarations, recovery, safety limits, determinism.

const test = require('node:test');
const assert = require('node:assert');
const { parse } = require('../../src/vrml/parser');
const { NODE } = require('../../src/vrml/ast');
const { CODE } = require('../../src/vrml/diagnostics');

const codes = (r) => r.diagnostics.map((d) => d.code);
const errCodes = (r) => r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);

test('header parsed; missing header is a non-fatal diagnostic', () => {
  const ok = parse('#VRML V2.0 utf8\nWorldInfo {}');
  assert.equal(ok.tree.header.type, NODE.HEADER);
  assert.ok(!codes(ok).includes(CODE.MISSING_HEADER));

  const missing = parse('WorldInfo {}');
  assert.equal(missing.tree.header, null);
  assert.ok(codes(missing).includes(CODE.MISSING_HEADER));
  // Still produced a usable tree.
  assert.equal(missing.tree.statements[0].nodeType, 'WorldInfo');
});

test('non-standard header is a warning, not an error', () => {
  const r = parse('#VRML V1.0 ascii\nWorldInfo {}');
  assert.ok(codes(r).includes(CODE.INVALID_HEADER));
  assert.equal(errCodes(r).length, 0);
});

test('canonical header encoding is case-sensitive (utf8 accepted, UTF8 flagged)', () => {
  const ok = parse('#VRML V2.0 utf8\nWorldInfo {}');
  assert.ok(!codes(ok).includes(CODE.INVALID_HEADER));

  const upper = parse('#VRML V2.0 UTF8\nWorldInfo {}');
  assert.ok(codes(upper).includes(CODE.INVALID_HEADER));
  // Non-fatal: a usable partial tree is still produced.
  assert.equal(errCodes(upper).length, 0);
  assert.equal(upper.tree.statements[0].nodeType, 'WorldInfo');
});

test('hyphenated DEF/event names parse and route correctly (Phase 7A1)', () => {
  const r = parse('#VRML V2.0 utf8\nDEF phb_left-COORD Coordinate {}\nDEF house3mini-ROT-INTERP OrientationInterpolator {}\nROUTE house3mini-ROT-INTERP.value_changed TO phb_left-COORD.set_point');
  assert.equal(errCodes(r).length, 0, JSON.stringify(errCodes(r)));
  assert.ok(r.tree.statements.some((s) => s.def === 'phb_left-COORD'));
  const route = r.tree.statements.find((s) => s.type === NODE.ROUTE);
  assert.equal(route.from.node, 'house3mini-ROT-INTERP');
  assert.equal(route.to.node, 'phb_left-COORD');
});

test('multiline inline Script source parses; content after is unaffected (Phase 7A1)', () => {
  const src = '#VRML V2.0 utf8\nDEF S Script {\n  eventOut SFVec3f out\n  url "vrmlscript:\n    function f(){ out = new SFVec3f(0,1,0); }\n  "\n}\nDEF After Transform { translation 5 0 0 }';
  const r = parse(src);
  assert.equal(errCodes(r).length, 0, JSON.stringify(errCodes(r)));
  const script = r.tree.statements.find((s) => s.def === 'S');
  const url = script.fields.find((f) => f.name === 'url');
  assert.match(url.value.value, /^vrmlscript:/);
  assert.ok(url.value.value.includes('\n'));
  // Valid content after the multiline string still parses.
  assert.ok(r.tree.statements.some((s) => s.def === 'After'));
});

test('node with fields and nested SFNode', () => {
  const r = parse('#VRML V2.0 utf8\nShape { appearance Appearance { material Material {} } geometry Box { size 1 2 3 } }');
  const shape = r.tree.statements[0];
  assert.equal(shape.nodeType, 'Shape');
  const app = shape.fields.find((f) => f.name === 'appearance');
  assert.equal(app.value.type, NODE.NODE);
  assert.equal(app.value.nodeType, 'Appearance');
  const geom = shape.fields.find((f) => f.name === 'geometry');
  const size = geom.value.fields.find((f) => f.name === 'size');
  assert.equal(size.value.type, NODE.NUMBERS);
  assert.deepEqual(size.value.values.map((v) => v.value), [1, 2, 3]);
});

test('MF array values: numbers, strings, and nodes', () => {
  const r = parse('#VRML V2.0 utf8\nX { nums [ 0 1 2 -1 ] strs [ "a" "b" ] kids [ Box {} Sphere {} ] }');
  const f = (n) => r.tree.statements[0].fields.find((x) => x.name === n).value;
  assert.deepEqual(f('nums').items.map((i) => i.value), [0, 1, 2, -1]);
  assert.deepEqual(f('strs').items.map((i) => i.value), ['a', 'b']);
  assert.deepEqual(f('kids').items.map((i) => i.nodeType), ['Box', 'Sphere']);
});

test('DEF and USE', () => {
  const r = parse('#VRML V2.0 utf8\nDEF Ball Shape {} Group { children [ USE Ball ] }');
  const def = r.tree.statements[0];
  assert.equal(def.def, 'Ball');
  assert.equal(def.nodeType, 'Shape');
  const use = r.tree.statements[1].fields[0].value.items[0];
  assert.equal(use.type, NODE.USE);
  assert.equal(use.name, 'Ball');
});

test('ROUTE ... TO ...', () => {
  const r = parse('#VRML V2.0 utf8\nROUTE A.x_changed TO B.set_x');
  const route = r.tree.statements[0];
  assert.equal(route.type, NODE.ROUTE);
  assert.deepEqual([route.from.node, route.from.event], ['A', 'x_changed']);
  assert.deepEqual([route.to.node, route.to.event], ['B', 'set_x']);
});

test('PROTO with interface declarations and IS bindings', () => {
  const r = parse('#VRML V2.0 utf8\nPROTO P [ field SFColor c 1 0 0 eventIn SFFloat s exposedField SFBool v TRUE ] { Shape { appearance Appearance { material Material { diffuseColor IS c } } geometry Box {} } }');
  const proto = r.tree.statements[0];
  assert.equal(proto.type, NODE.PROTO);
  assert.equal(proto.name, 'P');
  assert.equal(proto.interfaces.length, 3);
  assert.deepEqual(proto.interfaces.map((i) => i.access), ['field', 'eventIn', 'exposedField']);
  assert.equal(proto.interfaces[0].fieldType, 'SFColor');
  // IS binding inside the body.
  const mat = proto.body[0].fields.find((f) => f.name === 'appearance').value
    .fields.find((f) => f.name === 'material').value;
  const diffuse = mat.fields.find((f) => f.name === 'diffuseColor');
  assert.equal(diffuse.isBinding, true);
  assert.equal(diffuse.value.type, NODE.IS);
  assert.equal(diffuse.value.name, 'c');
});

test('EXTERNPROTO captures interface and URLs', () => {
  const r = parse('#VRML V2.0 utf8\nEXTERNPROTO W [ field SFColor c ] [ "w.wrl#W" "http://h/w.wrl#W" ]');
  const ep = r.tree.statements[0];
  assert.equal(ep.type, NODE.EXTERNPROTO);
  assert.equal(ep.name, 'W');
  assert.equal(ep.interfaces[0].default, null); // EXTERNPROTO interfaces have no defaults
  assert.deepEqual(ep.url.items.map((i) => i.value), ['w.wrl#W', 'http://h/w.wrl#W']);
});

test('Script interface + inline code + url', () => {
  const r = parse('#VRML V2.0 utf8\nScript { eventIn SFBool go eventOut SFFloat out field SFInt32 n 0 url "vrmlscript: function go(v){}" }');
  const script = r.tree.statements[0];
  assert.equal(script.nodeType, 'Script');
  assert.equal(script.interfaces.length, 3);
  const url = script.fields.find((f) => f.name === 'url');
  assert.match(url.value.value, /^vrmlscript:/);
});

test('ROUTE/PROTO embedded in an MFNode array parse (Cybertown lenient, Phase 7A1)', () => {
  // Real Cybertown worlds put ROUTE/PROTO statements directly inside children[...].
  const r = parse('#VRML V2.0 utf8\nGroup { children [\n  DEF C TimeSensor { loop TRUE }\n  DEF M Material {}\n  ROUTE C.fraction_changed TO M.set_transparency\n  DEF S Shape { geometry Box {} }\n] }');
  assert.equal(errCodes(r).length, 0, JSON.stringify(errCodes(r)));
  const items = r.tree.statements[0].fields[0].value.items;
  const route = items.find((i) => i.type === NODE.ROUTE);
  assert.ok(route, 'embedded ROUTE is an array item');
  assert.equal(route.from.node, 'C');
  assert.equal(route.to.node, 'M');
  assert.ok(items.some((i) => i.def === 'S'));
  // The embedded ROUTE is still indexed and resolved by the semantic pass.
  const idx = require('../../src/vrml').parse('#VRML V2.0 utf8\nGroup { children [\n  DEF C TimeSensor { loop TRUE }\n  DEF M Material {}\n  ROUTE C.fraction_changed TO M.set_transparency\n  DEF S Shape { geometry Box {} }\n] }');
  assert.equal(idx.routes.length, 1);
  assert.equal(idx.routes[0].resolvedFrom, true);
  assert.equal(idx.routes[0].resolvedTo, true);
});

test('Script interface members can be IS-mapped (Phase 7A1)', () => {
  const r = parse('#VRML V2.0 utf8\nPROTO Net [ eventIn SFBool wire ] {\n  DEF S Script {\n    eventIn SFBool boolFromServer IS wire\n    field SFInt32 counter 0\n    url "vrmlscript: function boolFromServer(v){}"\n  }\n}');
  assert.equal(errCodes(r).length, 0, JSON.stringify(errCodes(r)));
  const script = r.tree.statements[0].body.find((s) => s.def === 'S');
  const mapped = script.interfaces.find((i) => i.name === 'boolFromServer');
  assert.equal(mapped.access, 'eventIn');
  assert.equal(mapped.is, 'wire');
  const plain = script.interfaces.find((i) => i.name === 'counter');
  assert.equal(plain.is, null);
  assert.equal(plain.default.type, NODE.NUMBERS);
});

test('NULL as an SFNode value', () => {
  const r = parse('#VRML V2.0 utf8\nCollision { proxy NULL }');
  const proxy = r.tree.statements[0].fields[0];
  assert.equal(proxy.value.type, NODE.NULL);
});

test('every AST node has a source span', () => {
  const r = parse('#VRML V2.0 utf8\nDEF A Transform { translation 1 2 3 children [ Shape { geometry Box {} } ] }\nROUTE A.x TO A.y');
  const { walk } = require('../../src/vrml/ast');
  let count = 0;
  walk(r.tree, (n) => {
    count += 1;
    assert.ok(n.range && n.range.start && n.range.end, `${n.type} must have a range`);
    assert.equal(typeof n.range.start.offset, 'number');
  });
  assert.ok(count > 5);
});

// --- recovery ---

test('one malformed field does not destroy the rest of the file', () => {
  const r = parse('#VRML V2.0 utf8\nShape { geometry Box { size } }\nDEF After Transform { translation 5 0 0 }');
  assert.deepEqual(errCodes(r), [CODE.EXPECTED_FIELD_VALUE]);
  assert.ok(r.tree.statements.some((s) => s.def === 'After'));
});

test('unclosed brace is reported and parsing terminates', () => {
  const r = parse('#VRML V2.0 utf8\nShape { geometry Box {');
  assert.ok(codes(r).includes(CODE.UNCLOSED_BRACE));
});

test('unclosed bracket is reported', () => {
  const r = parse('#VRML V2.0 utf8\nX { pts [ 0 1 2 }');
  assert.ok(codes(r).includes(CODE.UNCLOSED_BRACKET));
});

// --- safety limits ---

test('maximum depth is bounded with a diagnostic, no crash', () => {
  const deep = '#VRML V2.0 utf8\n' + 'Group { children [ '.repeat(50) + 'Shape {}' + ' ] }'.repeat(50);
  const r = parse(deep, { maxDepth: 10 });
  assert.ok(codes(r).includes(CODE.MAX_DEPTH));
  assert.ok(r.depthCapped);
});

test('node count is bounded with a diagnostic, no crash', () => {
  const many = '#VRML V2.0 utf8\nGroup { children [ ' + 'Shape {} '.repeat(500) + ' ] }';
  const r = parse(many, { maxNodes: 20 });
  assert.ok(codes(r).includes(CODE.MAX_NODES));
  assert.ok(r.truncated);
});

test('deeply nested and unbalanced input never hangs', () => {
  const bomb = '#VRML V2.0 utf8\n' + '['.repeat(5000) + '{'.repeat(5000);
  const r = parse(bomb, { maxDepth: 256, maxNodes: 100000 });
  assert.ok(Array.isArray(r.tree.statements));
});

// --- determinism ---

test('parsing is deterministic (same input -> identical tree + diagnostics)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../fixtures/vrml/proto.wrl'), 'utf8');
  const a = parse(src);
  const b = parse(src);
  const strip = (r) => JSON.stringify({ tree: r.tree, diagnostics: r.diagnostics });
  assert.equal(strip(a), strip(b));
});
