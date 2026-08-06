'use strict';
// Source-map tests (Phase WD1.1): offset -> token / AST-node lookup, boundary
// semantics, ancestry ordering, and the read-only guarantee.
//
// Boundary behaviour is the point of this module, so the boundary cases are
// asserted from ranges the parser actually produced rather than from hardcoded
// offsets -- a hardcoded offset would silently stop testing the boundary the day
// a fixture gains a character.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parse } = require('../../src/vrml');
const { createSourceMap } = require('../../src/vrml/source-map');
const { NODE } = require('../../src/vrml/ast');
const { readWrlSource } = require('../../src/preview/wrl-source');

const F = (p) => path.join(__dirname, '../fixtures', p);
const load = (p) => readWrlSource(F(p)).text;
const mapOf = (text) => ({ text, map: createSourceMap(parse(text)) });
const types = (nodes) => nodes.map((n) => n.type);
const start = (map, node) => map.rangeOf(node).start.offset;
const end = (map, node) => map.rangeOf(node).end.offset;

// A small scene used wherever a test needs precise, readable geometry.
const SIMPLE = '#VRML V2.0 utf8\nWorldInfo { title "Hi" }\n';
const NESTED = '#VRML V2.0 utf8\nDEF Root Transform {\n  children [\n    Shape { geometry Box { size 1 2 3 } }\n  ]\n}\n';

// --- construction -----------------------------------------------------------

test('createSourceMap requires a parse result and exposes a frozen read-only API', () => {
  const map = createSourceMap(parse(SIMPLE));
  assert.deepEqual(Object.keys(map).sort(), ['nodeAt', 'nodesAt', 'pathTo', 'rangeOf', 'tokenAt']);
  assert.equal(Object.isFrozen(map), true);
  for (const bad of [null, undefined, 'text', 42, true]) {
    assert.throws(() => createSourceMap(bad), TypeError, `should reject ${JSON.stringify(bad)}`);
  }
});

test('the src/vrml facade re-exports createSourceMap without disturbing what was there', () => {
  const facade = require('../../src/vrml');
  assert.equal(facade.createSourceMap, createSourceMap, 'must be the same function, not a wrapper');
  // Purely additive: every pre-existing export is still present. `parse()` must
  // not start building a map either -- the map stays opt-in and lazy.
  for (const name of ['parse', 'tokenize', 'analyze', 'ast', 'diagnostics', 'assetRefs',
    'TT', 'KEYWORDS', 'DEFAULT_LIMITS']) {
    assert.ok(name in facade, `facade lost its ${name} export`);
  }
  assert.equal('sourceMap' in facade.parse(SIMPLE), false, 'parse() must not build a source map');
});

test('accepts the low-level parser result as well as the facade result', () => {
  // src/vrml/parser.parse() returns { tree, tokens, ... }; the facade returns a
  // superset. Both must work, so a caller that already has one need not reparse.
  const low = require('../../src/vrml/parser').parse(SIMPLE);
  const map = createSourceMap(low);
  assert.equal(map.nodeAt(SIMPLE.indexOf('WorldInfo')).nodeType, 'WorldInfo');
});

// --- offsets and half-open ranges -------------------------------------------

test('offsets are zero-based: offset 0 is the first character', () => {
  const { map } = mapOf(SIMPLE);
  const tok = map.tokenAt(0);
  assert.equal(tok.type, 'header');
  assert.equal(map.rangeOf(tok).start.offset, 0);
  assert.equal(map.rangeOf(tok).start.line, 1);
  assert.equal(map.rangeOf(tok).start.column, 1);
});

test('token lookup is half-open: start is inside, end is not', () => {
  const { text, map } = mapOf(SIMPLE);
  const at = text.indexOf('WorldInfo');
  const tok = map.tokenAt(at);
  const { start: s, end: e } = map.rangeOf(tok);
  assert.equal(s.offset, at);

  assert.equal(map.tokenAt(s.offset), tok, 'offset exactly at the start is inside');
  assert.equal(map.tokenAt(s.offset + 1), tok, 'offset inside is inside');
  assert.equal(map.tokenAt(e.offset - 1), tok, 'last offset of the lexeme is inside');
  assert.notEqual(map.tokenAt(e.offset), tok, 'offset exactly at the end is NOT inside (half-open)');
});

test('inclusiveEnd opts into a closed range, and half-open matches still win', () => {
  const { text, map } = mapOf(SIMPLE);
  const worldInfo = map.tokenAt(text.indexOf('WorldInfo'));
  const e = map.rangeOf(worldInfo).end.offset;

  // The character after `WorldInfo` is a space, so nothing contains `e` by the
  // default rule -- inclusiveEnd fills exactly that gap.
  assert.equal(map.tokenAt(e), null);
  assert.equal(map.tokenAt(e, { inclusiveEnd: true }), worldInfo);

  // Where a token DOES contain the offset half-open, inclusiveEnd must not
  // override it with the preceding token.
  const brace = text.indexOf('{');
  assert.equal(map.tokenAt(brace, { inclusiveEnd: true }), map.tokenAt(brace));
  assert.equal(map.tokenAt(brace).type, 'lbrace');
});

test('node lookup is half-open at exact node boundaries', () => {
  const { text, map } = mapOf(NESTED);
  const box = map.nodeAt(text.indexOf('Box'));
  assert.equal(box.nodeType, 'Box');
  const s = start(map, box);
  const e = end(map, box);

  assert.equal(map.nodeAt(s), box, 'offset at the node start is inside');
  assert.equal(map.nodeAt(e - 1), box, 'last offset of the node is inside');

  // The offset just past a nested node belongs to whatever still spans it --
  // here the enclosing Shape, which closes two characters later. inclusiveEnd
  // must NOT override that: a half-open hit always wins, so the option can only
  // ever fill a gap, never reinterpret a live containment.
  const after = map.nodeAt(e);
  assert.notEqual(after, box, 'offset at the node end is NOT inside the node');
  assert.equal(after.nodeType, 'Shape', 'it belongs to the still-open parent');
  assert.equal(map.nodeAt(e, { inclusiveEnd: true }), after, 'inclusiveEnd does not override a half-open hit');
});

test('inclusiveEnd reaches a node only where nothing contains the offset half-open', () => {
  // The one such place in a well-formed file is the very end of the document.
  const { text, map } = mapOf(NESTED);
  assert.equal(map.nodeAt(text.length), null);
  const closed = map.nodeAt(text.length, { inclusiveEnd: true });
  assert.equal(closed.type, NODE.DOCUMENT);
  assert.equal(end(map, closed), text.length);
});

test('adjacent sibling nodes sharing a boundary resolve to exactly one of them', () => {
  // No whitespace between the two statements, so the seam is a shared offset.
  const { map } = mapOf('#VRML V2.0 utf8\nA{}B{}\n');
  const doc = map.nodeAt(16);
  assert.equal(doc.nodeType, 'A');
  const seam = end(map, doc);
  const after = map.nodeAt(seam);
  assert.equal(after.nodeType, 'B', 'the seam belongs to the LATER sibling');
  assert.equal(start(map, after), seam);
  // And with inclusiveEnd the half-open winner is still preferred.
  assert.equal(map.nodeAt(seam, { inclusiveEnd: true }), after);
});

// --- trivia ------------------------------------------------------------------

test('offsets inside leading whitespace belong to no token by default', () => {
  const { text, map } = mapOf(SIMPLE);
  const space = text.indexOf('WorldInfo') - 1; // the newline after the header
  assert.equal(map.tokenAt(space), null);
  assert.equal(map.tokenAt(space, { trivia: 'following' }).lexeme, 'WorldInfo');
});

test('offsets inside a comment map to the following token only when asked', () => {
  const text = load('vrml/comments.wrl');
  const map = createSourceMap(parse(text));
  const inComment = text.indexOf('A leading comment');
  assert.equal(map.tokenAt(inComment), null, 'a comment is trivia, not a token');
  assert.equal(map.tokenAt(inComment, { trivia: 'following' }).lexeme, 'WorldInfo');
  // The comment sits between the header and the first statement, so the
  // innermost node spanning it is the Document.
  assert.equal(map.nodeAt(inComment).type, NODE.DOCUMENT);
});

test('a comma used as VRML whitespace is trivia, not a token', () => {
  const text = load('vrml/route.wrl');
  const map = createSourceMap(parse(text));
  const comma = text.indexOf('0 1 0 0,') + 7;
  assert.equal(text[comma], ',');
  assert.equal(map.tokenAt(comma), null);
  assert.equal(map.tokenAt(comma, { trivia: 'following' }).type, 'number');
  // Structurally the comma is inside the keyValue array.
  assert.equal(map.nodeAt(comma).type, NODE.ARRAY);
});

test('trailing trivia at end of file maps to the EOF token', () => {
  const { text, map } = mapOf(SIMPLE); // ends with a newline
  const lastNewline = text.length - 1;
  assert.equal(text[lastNewline], '\n');
  assert.equal(map.tokenAt(lastNewline), null);
  assert.equal(map.tokenAt(lastNewline, { trivia: 'following' }).type, 'eof');
});

test('an unknown trivia mode is rejected rather than silently ignored', () => {
  const { map } = mapOf(SIMPLE);
  assert.throws(() => map.tokenAt(0, { trivia: 'leading' }), TypeError);
  assert.throws(() => map.tokenAt(0, { trivia: true }), TypeError);
});

test("with trivia:'following' every offset in the file resolves to exactly one token", () => {
  // The direct consequence of the Part A round-trip contract: trivia + lexeme
  // spans partition the source, so no offset can fall through a crack.
  for (const rel of ['vrml/minimal.wrl', 'vrml/comments.wrl', 'vrml/proto.wrl',
    'vrml/route.wrl', 'vrml/crlf.wrl', 'vrml/nested.wrl', 'vrml/recovery.wrl']) {
    const text = load(rel);
    const map = createSourceMap(parse(text));
    for (let offset = 0; offset < text.length; offset += 1) {
      assert.ok(map.tokenAt(offset, { trivia: 'following' }) !== null,
        `${rel}: offset ${offset} (${JSON.stringify(text[offset])}) resolved to no token`);
    }
    assert.equal(map.tokenAt(text.length, { trivia: 'following' }), null, `${rel}: EOF offset is past the end`);
  }
});

// --- invalid and edge offsets ------------------------------------------------

test('invalid offsets return null and never throw', () => {
  const { text, map } = mapOf(SIMPLE);
  const bad = [-1, -100, text.length, text.length + 1, 1e9, 1.5, -0.5, NaN, Infinity, -Infinity,
    undefined, null, '4', {}, []];
  for (const offset of bad) {
    assert.equal(map.tokenAt(offset), null, `tokenAt(${String(offset)})`);
    assert.equal(map.tokenAt(offset, { trivia: 'following' }), null, `tokenAt(${String(offset)}, following)`);
    assert.equal(map.nodeAt(offset), null, `nodeAt(${String(offset)})`);
    assert.deepEqual(map.nodesAt(offset), [], `nodesAt(${String(offset)})`);
  }
});

test('the end-of-file offset is outside every span, but inclusiveEnd reaches the Document', () => {
  const { text, map } = mapOf(SIMPLE);
  assert.equal(map.nodeAt(text.length), null);
  assert.equal(map.tokenAt(text.length, { trivia: 'following' }), null);
  assert.equal(map.nodeAt(text.length, { inclusiveEnd: true }).type, NODE.DOCUMENT);
  // One past the true end stays null even with inclusiveEnd.
  assert.equal(map.nodeAt(text.length + 1, { inclusiveEnd: true }), null);
});

test('empty and minimally parsed documents build a usable, empty map', () => {
  for (const text of ['', '   \n\t\n  ', '#VRML V2.0 utf8', '\n\n']) {
    const map = createSourceMap(parse(text));
    assert.equal(map.tokenAt(-1), null);
    for (let offset = 0; offset <= text.length; offset += 1) {
      assert.doesNotThrow(() => map.nodeAt(offset));
      assert.doesNotThrow(() => map.tokenAt(offset, { trivia: 'following' }));
      assert.doesNotThrow(() => map.nodesAt(offset));
    }
  }
  // A header-only file: the header IS covered, and nothing follows it.
  const headerOnly = '#VRML V2.0 utf8';
  const map = createSourceMap(parse(headerOnly));
  assert.equal(map.nodeAt(0).type, NODE.HEADER);
  assert.equal(map.nodeAt(headerOnly.length), null);
});

test('offsets before the #VRML header are outside the Document range', () => {
  // The Document begins AT the header, so leading blank lines are covered by no
  // node at all. Documented rather than special-cased.
  const text = '\n\n#VRML V2.0 utf8\nWorldInfo {}\n';
  const map = createSourceMap(parse(text));
  assert.equal(map.nodeAt(0), null);
  assert.equal(map.nodeAt(1), null);
  assert.equal(map.nodeAt(2).type, NODE.HEADER, 'the header itself is covered');
  // The tokenizer still attaches those bytes as the header token's trivia.
  assert.equal(map.tokenAt(0, { trivia: 'following' }).type, 'header');
});

// --- structural coverage -----------------------------------------------------

test('the header is a node and sits directly under the Document', () => {
  const { map } = mapOf(SIMPLE);
  assert.deepEqual(types(map.nodesAt(3)), [NODE.HEADER, NODE.DOCUMENT]);
  assert.deepEqual(map.pathTo(map.nodeAt(3)).map((s) => s.key), [null, 'header']);
});

test('a simple primitive scene resolves node, field, and value offsets', () => {
  const text = load('vrml/minimal.wrl');
  const map = createSourceMap(parse(text));
  assert.equal(map.nodeAt(text.indexOf('WorldInfo')).nodeType, 'WorldInfo');
  assert.equal(map.nodeAt(text.indexOf('title')).type, NODE.FIELD);
  assert.equal(map.nodeAt(text.indexOf('"Minimal"')).type, NODE.STRING);
});

test('nested Transform / Shape / geometry resolves to the innermost node', () => {
  const text = load('vrml/nested.wrl');
  const map = createSourceMap(parse(text));
  assert.equal(map.nodeAt(text.indexOf('Sphere')).nodeType, 'Sphere');
  assert.equal(map.nodeAt(text.indexOf('radius')).type, NODE.FIELD);
  // Two Transforms are nested; the inner one must win at its own offset.
  const inner = text.indexOf('Transform', text.indexOf('Transform') + 1);
  assert.equal(map.nodeAt(inner).nodeType, 'Transform');
  assert.ok(map.nodesAt(inner).filter((n) => n.nodeType === 'Transform').length === 2,
    'the outer Transform must still appear in the ancestry');
});

test('DEF covers its node and USE is its own node', () => {
  const text = load('vrml/def-use.wrl');
  const map = createSourceMap(parse(text));
  const defAt = text.indexOf('DEF Ball');
  const defd = map.nodeAt(defAt);
  assert.equal(defd.nodeType, 'Shape');
  assert.equal(defd.def, 'Ball', 'the DEF keyword is inside the range of the node it names');
  assert.equal(start(map, defd), defAt);

  const useAt = text.indexOf('USE Ball');
  assert.equal(map.nodeAt(useAt).type, NODE.USE);
  assert.equal(map.nodeAt(useAt).name, 'Ball');
});

test('PROTO interfaces and IS bindings are addressable', () => {
  const text = load('vrml/proto.wrl');
  const map = createSourceMap(parse(text));
  const decl = map.nodeAt(text.indexOf('field SFColor boxColor'));
  assert.equal(decl.type, NODE.INTERFACE);
  assert.equal(decl.name, 'boxColor');

  const isAt = text.indexOf('IS boxColor');
  assert.equal(map.nodeAt(isAt).type, NODE.IS);
  assert.ok(types(map.nodesAt(isAt)).includes(NODE.PROTO), 'IS resolves inside its PROTO');
  assert.deepEqual(types(map.nodesAt(isAt)).slice(0, 2), [NODE.IS, NODE.FIELD]);
});

test('EXTERNPROTO declarations are addressable', () => {
  const text = load('vrml/externproto.wrl');
  const map = createSourceMap(parse(text));
  const at = text.indexOf('EXTERNPROTO');
  assert.equal(map.nodeAt(at).type, NODE.EXTERNPROTO);
});

test('ROUTE statements resolve, and their endpoints are not separate AST nodes', () => {
  const text = load('vrml/route.wrl');
  const map = createSourceMap(parse(text));
  const at = text.indexOf('ROUTE Clock.fraction_changed');
  const route = map.nodeAt(at);
  assert.equal(route.type, NODE.ROUTE);
  // The parser records endpoints as plain data (no `type`), so the deepest node
  // at an endpoint name is the ROUTE itself -- documented, not accidental.
  assert.equal(map.nodeAt(text.indexOf('fraction_changed')), route);
  assert.deepEqual(types(map.nodesAt(at)), [NODE.ROUTE, NODE.DOCUMENT]);
});

test('CRLF sources keep exact ranges, and rangeOf slices the original text back', () => {
  const text = load('vrml/crlf.wrl');
  assert.ok(text.includes('\r\n'), 'fixture must really contain CRLF');
  const map = createSourceMap(parse(text));
  const node = map.nodeAt(text.indexOf('DEF Panel'));
  const r = map.rangeOf(node);
  assert.equal(text.slice(r.start.offset, r.end.offset).startsWith('DEF Panel Shape {'), true);
  assert.equal(text.slice(r.start.offset, r.end.offset).endsWith('}'), true);
  // Line numbers count a CRLF pair once.
  assert.equal(r.start.line, 4);
});

test('unknown / vendor-extension nodes and fields are addressable like any other', () => {
  const text = '#VRML V2.0 utf8\nblaxxun_Vendor { weird-Field+Name 1 }\nDEF phb_left-COORD Coordinate { point [ 0 0 0 ] }\n';
  const map = createSourceMap(parse(text));
  assert.equal(map.nodeAt(text.indexOf('blaxxun_Vendor')).nodeType, 'blaxxun_Vendor');
  assert.equal(map.nodeAt(text.indexOf('weird-Field+Name')).name, 'weird-Field+Name');
  assert.equal(map.nodeAt(text.indexOf('Coordinate')).def, 'phb_left-COORD');
});

test('a recovered / partial AST still maps cleanly', () => {
  const text = load('vrml/recovery.wrl');
  const result = parse(text);
  assert.ok(result.diagnostics.some((d) => d.severity === 'error'), 'fixture must really be malformed');
  const map = createSourceMap(result);

  // The malformed field (`size` with no value) is still addressable...
  const bad = map.nodeAt(text.indexOf('size }'));
  assert.equal(bad.type, NODE.FIELD);
  assert.equal(bad.name, 'size');
  // ...and recovery let the parser continue, so later statements map too.
  assert.equal(map.nodeAt(text.indexOf('DEF After')).nodeType, 'Transform');
  assert.equal(map.nodeAt(text.indexOf('"after.png"')).type, NODE.STRING);
});

test('badly unbalanced source does not break lookup anywhere in the file', () => {
  for (const text of [
    '#VRML V2.0 utf8\nTransform { children [ Shape {\n',
    '#VRML V2.0 utf8\nA { b } } ] TO\n',
    '#VRML V2.0 utf8\nA { url "never closed\n',
  ]) {
    const map = createSourceMap(parse(text));
    for (let offset = 0; offset <= text.length; offset += 1) {
      assert.doesNotThrow(() => map.nodesAt(offset), `offset ${offset}`);
      const deepest = map.nodeAt(offset);
      if (deepest) assert.equal(map.nodesAt(offset)[0], deepest);
    }
  }
});

// --- ancestry, ordering, determinism ----------------------------------------

test('nodesAt is ordered deepest-first and ends at the Document root', () => {
  const { text, map } = mapOf(NESTED);
  const chain = map.nodesAt(text.indexOf('size 1') + 5);
  assert.deepEqual(types(chain), [
    NODE.NUMBER, NODE.NUMBERS, NODE.FIELD, NODE.NODE, NODE.FIELD, NODE.NODE,
    NODE.ARRAY, NODE.FIELD, NODE.NODE, NODE.DOCUMENT,
  ]);
  assert.equal(chain[0], map.nodeAt(text.indexOf('size 1') + 5));
  assert.equal(chain[chain.length - 1].type, NODE.DOCUMENT);
});

test('pathTo is ordered root-first and names the property holding each node', () => {
  const { text, map } = mapOf(NESTED);
  const segments = map.pathTo(map.nodeAt(text.indexOf('size 1') + 5));
  assert.equal(segments[0].type, NODE.DOCUMENT);
  assert.deepEqual(segments.map((s) => s.depth), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(segments.map((s) => s.key), [
    null, 'statements', 'fields', 'value', 'items', 'fields', 'value', 'fields', 'value', 'values',
  ]);
  assert.deepEqual(segments.map((s) => s.index), [null, 0, 0, null, 0, 0, null, 0, null, 0]);
  assert.equal(segments[0].key, null, 'the root segment has no accessor');
});

test('nodesAt reversed is exactly pathTo (the two orderings agree)', () => {
  const text = load('vrml/nested.wrl');
  const map = createSourceMap(parse(text));
  for (let offset = 0; offset < text.length; offset += 1) {
    const deepest = map.nodeAt(offset);
    if (!deepest) continue;
    const outward = map.nodesAt(offset).slice().reverse();
    const downward = map.pathTo(deepest).map((s) => s.node);
    assert.deepEqual(outward, downward, `offset ${offset}`);
  }
});

test('the deepest node is a strict descendant of every other node in its chain', () => {
  const text = load('vrml/def-use.wrl');
  const map = createSourceMap(parse(text));
  for (let offset = 0; offset < text.length; offset += 1) {
    const chain = map.nodesAt(offset);
    for (let i = 0; i + 1 < chain.length; i += 1) {
      const child = map.rangeOf(chain[i]);
      const parent = map.rangeOf(chain[i + 1]);
      assert.ok(child.start.offset >= parent.start.offset && child.end.offset <= parent.end.offset,
        `offset ${offset}: ${chain[i].type} escapes its parent ${chain[i + 1].type}`);
    }
  }
});

test('deepest-node selection is deterministic across repeated and rebuilt lookups', () => {
  const text = load('vrml/proto.wrl');
  const first = createSourceMap(parse(text));
  const second = createSourceMap(parse(text));
  for (let offset = 0; offset < text.length; offset += 1) {
    const a = first.nodeAt(offset);
    assert.equal(first.nodeAt(offset), a, `repeat lookup drifted at ${offset}`);
    const b = second.nodeAt(offset);
    assert.equal(a === null, b === null, `nullness differs at ${offset}`);
    if (a) {
      assert.equal(a.type, b.type, `type differs at ${offset}`);
      assert.deepEqual(first.rangeOf(a), second.rangeOf(b), `range differs at ${offset}`);
    }
  }
});

test('pathTo rejects a node that is not part of this parse', () => {
  const { map } = mapOf(SIMPLE);
  const other = createSourceMap(parse(NESTED));
  assert.equal(map.pathTo(other.nodeAt(NESTED.indexOf('Box'))), null, 'a node from another parse is rejected');
  assert.equal(map.pathTo({ type: 'Node', range: null }), null, 'a fabricated node is rejected');
  assert.equal(map.pathTo(null), null);
  assert.equal(map.pathTo(undefined), null);
});

// --- rangeOf -----------------------------------------------------------------

test('rangeOf returns the exact source span for both tokens and nodes', () => {
  const { text, map } = mapOf(NESTED);
  const node = map.nodeAt(text.indexOf('Box'));
  const r = map.rangeOf(node);
  assert.equal(text.slice(r.start.offset, r.end.offset), 'Box { size 1 2 3 }');

  const tok = map.tokenAt(text.indexOf('Box'));
  const tr = map.rangeOf(tok);
  assert.equal(text.slice(tr.start.offset, tr.end.offset), 'Box');
});

test('rangeOf hands back a copy, so a caller cannot corrupt the parse result', () => {
  const { text, map } = mapOf(NESTED);
  const node = map.nodeAt(text.indexOf('Box'));
  const before = node.range.start.offset;
  const r = map.rangeOf(node);
  assert.notEqual(r, node.range, 'must not be the parse result’s own object');
  r.start.offset = -999;
  r.end = null;
  assert.equal(node.range.start.offset, before, 'the AST range is unchanged');
  assert.deepEqual(map.rangeOf(node).start.offset, before, 'a fresh copy is unaffected');
});

test('rangeOf returns null for anything without a usable range', () => {
  const { map } = mapOf(SIMPLE);
  for (const bad of [null, undefined, {}, { range: null }, { range: {} },
    { range: { start: {}, end: {} } }, 'text', 7]) {
    assert.equal(map.rangeOf(bad), null, `rangeOf(${JSON.stringify(bad)})`);
  }
});

// --- the read-only guarantee -------------------------------------------------

test('building a map and querying it mutates nothing in the parse result', () => {
  const text = load('vrml/proto.wrl');
  const result = parse(text);
  const snapshot = JSON.stringify(result);

  const map = createSourceMap(result);
  for (let offset = -5; offset <= text.length + 5; offset += 1) {
    map.tokenAt(offset);
    map.tokenAt(offset, { trivia: 'following', inclusiveEnd: true });
    map.nodeAt(offset, { inclusiveEnd: true });
    const chain = map.nodesAt(offset);
    if (chain.length) map.pathTo(chain[0]);
    map.rangeOf(chain[0]);
  }

  assert.equal(JSON.stringify(result), snapshot, 'the parse result changed');
});

// --- corpus sweep ------------------------------------------------------------

test('every real fixture upholds the map invariants at every offset', () => {
  const fixtures = [
    'vrml/minimal.wrl', 'vrml/mall-item.wrl', 'vrml/world-sample.wrl', 'vrml/def-use.wrl',
    'vrml/proto.wrl', 'vrml/externproto.wrl', 'vrml/route.wrl', 'vrml/comments.wrl',
    'vrml/crlf.wrl', 'vrml/nested.wrl', 'vrml/numbers.wrl', 'vrml/escapes.wrl',
    'vrml/script.wrl', 'vrml/multiline-script.wrl', 'vrml/multiline-script-crlf.wrl',
    'vrml/recovery.wrl', 'vrml/malformed-brace.wrl', 'vrml/malformed-bracket.wrl',
    'vrml/duplicate-def.wrl', 'vrml/unresolved-use.wrl', 'vrml/unterminated-string.wrl',
    'vrml/invalid-number.wrl', 'vrml/invalid-route.wrl', 'vrml/mfstring-urls.wrl',
    'preview/def-use.wrl', 'preview/real-smartcar-lite.wrl',
    'world/small/world.wrl', 'world/nested/world.wrl', 'world/mini/world.wrl',
    'world/valid70/world.wrl',
  ];
  let offsetsChecked = 0;

  for (const rel of fixtures) {
    const text = load(rel);
    const map = createSourceMap(parse(text));
    // Sampling keeps this sweep fast on the big World fixtures while still
    // hitting every construct; small files are covered exhaustively.
    const step = text.length > 4000 ? 7 : 1;
    for (let offset = 0; offset < text.length; offset += step) {
      offsetsChecked += 1;
      const deepest = map.nodeAt(offset);
      const chain = map.nodesAt(offset);

      if (deepest === null) {
        assert.deepEqual(chain, [], `${rel}@${offset}: chain must be empty when nodeAt is null`);
      } else {
        assert.equal(chain[0], deepest, `${rel}@${offset}: chain must start at the deepest node`);
        assert.equal(chain[chain.length - 1].type, NODE.DOCUMENT, `${rel}@${offset}: chain must end at the Document`);
        const r = map.rangeOf(deepest);
        assert.ok(offset >= r.start.offset && offset < r.end.offset,
          `${rel}@${offset}: the returned node does not contain the offset`);
        const segments = map.pathTo(deepest);
        assert.equal(segments.length, chain.length, `${rel}@${offset}: path and chain disagree on depth`);
        assert.equal(segments[segments.length - 1].node, deepest);
      }

      // Every offset resolves to a token once trivia is included (Part A).
      const tok = map.tokenAt(offset, { trivia: 'following' });
      assert.ok(tok !== null, `${rel}@${offset}: no token`);
      const own = map.tokenAt(offset);
      if (own !== null) {
        const tr = map.rangeOf(own);
        assert.ok(offset >= tr.start.offset && offset < tr.end.offset,
          `${rel}@${offset}: the returned token does not contain the offset`);
      }
    }
  }
  console.log(`  source-map: ${fixtures.length} fixtures, ${offsetsChecked} offsets checked`);
  assert.ok(offsetsChecked > 10000, `expected a substantial sweep, checked ${offsetsChecked}`);
});
