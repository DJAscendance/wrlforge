'use strict';
// Span-patch algebra tests (Phase WD1.2).
//
// The module's whole value is that it refuses ambiguity and never touches a byte
// it was not told to touch, so most of what follows is about the boundaries: what
// is legal at a seam, what is rejected, and in exactly which order a legal set
// lands. Where a test asserts an offset it derives it from the text (indexOf) so
// the case keeps testing the boundary it names even if the fixture text changes.
//
// The generated section at the bottom is deterministic: a fixed-seed PRNG, a
// bounded number of cases, and an independent reference implementation of
// application (highest-offset-first splicing) to check the linear one against.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const edit = require('../../src/vrml/edit');
const {
  AFFINITY, EDIT_ERROR,
  createEdit, replaceSpan, insertAt, removeSpan,
  validateEdits, applyEdits, mapOffset, mapRange,
} = edit;

// Assert a call throws with an exact structured code.
function throwsCode(fn, code, message) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof Error, `${message}: expected an Error`);
    assert.equal(err.code, code, `${message}: wrong error code (message was: ${err.message})`);
    return true;
  }, message);
}

const SIMPLE = '#VRML V2.0 utf8\nWorldInfo { title "Hi" }\n';

// ---------------------------------------------------------------------------
// purity
// ---------------------------------------------------------------------------

test('the module is pure: it requires nothing at all', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/vrml/edit.js'), 'utf8');
  // No fs, no Electron, no CodeMirror, no parser, no source map -- and no
  // require() of anything else either, which is the simplest way to keep it so.
  const requires = src.match(/require\s*\(/g) || [];
  assert.deepEqual(requires, [], 'src/vrml/edit.js must not require any module');
  assert.equal(/\bprocess\.|\bDate\.now|Math\.random/.test(src), false,
    'must not read the environment, the clock, or randomness');
});

test('the src/vrml facade re-exports the algebra additively', () => {
  const facade = require('../../src/vrml');
  assert.equal(facade.edit, edit, 'must be the same module object, not a wrapper');
  for (const name of ['parse', 'tokenize', 'analyze', 'createSourceMap', 'ast', 'diagnostics',
    'assetRefs', 'TT', 'KEYWORDS', 'DEFAULT_LIMITS']) {
    assert.ok(name in facade, `facade lost its ${name} export`);
  }
});

// ---------------------------------------------------------------------------
// construction
// ---------------------------------------------------------------------------

test('createEdit builds a frozen edit carrying exactly {from, to, insert}', () => {
  const insertion = createEdit(3, 3, 'x');
  assert.deepEqual(Object.keys(insertion).sort(), ['from', 'insert', 'to']);
  assert.equal(Object.isFrozen(insertion), true);
  assert.deepEqual({ ...insertion }, { from: 3, to: 3, insert: 'x' });

  assert.deepEqual({ ...createEdit(1, 4, '') }, { from: 1, to: 4, insert: '' });
  assert.deepEqual({ ...createEdit(1, 4, 'yz') }, { from: 1, to: 4, insert: 'yz' });
});

test('createEdit rejects malformed offsets and inserts with EEDITSHAPE', () => {
  const bad = [
    [-1, 0, 'x', 'negative from'],
    [0, -1, 'x', 'negative to'],
    [1.5, 2, 'x', 'fractional from'],
    [0, 2.5, 'x', 'fractional to'],
    [NaN, 0, 'x', 'NaN from'],
    [Infinity, Infinity, 'x', 'non-finite offsets'],
    ['0', 1, 'x', 'string from -- never coerced'],
    [null, 1, 'x', 'null from'],
    [undefined, 1, 'x', 'missing from'],
    [5, 2, 'x', 'from greater than to'],
    [0, 1, 42, 'numeric insert'],
    [0, 1, null, 'null insert'],
    [0, 1, undefined, 'missing insert'],
    [0, 1, ['x'], 'array insert'],
  ];
  for (const [from, to, insert, why] of bad) {
    throwsCode(() => createEdit(from, to, insert), EDIT_ERROR.SHAPE, why);
  }
});

test('insertAt, removeSpan and replaceSpan build the expected edits', () => {
  assert.deepEqual({ ...insertAt(7, 'abc') }, { from: 7, to: 7, insert: 'abc' });
  assert.deepEqual({ ...removeSpan({ from: 2, to: 6 }) }, { from: 2, to: 6, insert: '' });
  assert.deepEqual({ ...replaceSpan({ from: 2, to: 6 }, 'Q') }, { from: 2, to: 6, insert: 'Q' });
  assert.equal(Object.isFrozen(replaceSpan({ from: 0, to: 0 }, '')), true);
});

test('range-taking helpers accept a source-map rangeOf() span verbatim', () => {
  // The intended WD1.1 -> WD1.2 idiom: take a node's exact span off the source
  // map and patch it, with no reshaping in between.
  const { parse, createSourceMap } = require('../../src/vrml');
  const map = createSourceMap(parse(SIMPLE));
  const node = map.nodeAt(SIMPLE.indexOf('WorldInfo'));
  const range = map.rangeOf(node);
  assert.equal(typeof range.start.offset, 'number');

  const replaced = applyEdits(SIMPLE, [replaceSpan(range, 'Group { }')]);
  assert.equal(replaced, '#VRML V2.0 utf8\nGroup { }\n');
  assert.equal(applyEdits(SIMPLE, [removeSpan(range)]), '#VRML V2.0 utf8\n\n');
});

test('malformed ranges are rejected with EEDITRANGE, never inferred', () => {
  const bad = [
    [null, 'null'],
    ['0,3', 'a string'],
    [[0, 3], 'an array'],
    [{}, 'an empty object'],
    [{ start: 0, end: 3 }, 'positional shape with bare numbers'],
    [{ from: 0 }, 'missing to'],
    [{ from: '0', to: 3 }, 'string offset'],
    [{ from: 1.5, to: 3 }, 'fractional offset'],
    [{ from: -1, to: 3 }, 'negative offset'],
    [{ from: 5, to: 2 }, 'inverted range'],
    [{ start: { offset: 5 }, end: { offset: 2 } }, 'inverted positional range'],
  ];
  for (const [range, why] of bad) {
    throwsCode(() => replaceSpan(range, 'x'), EDIT_ERROR.RANGE, `replaceSpan: ${why}`);
    throwsCode(() => removeSpan(range), EDIT_ERROR.RANGE, `removeSpan: ${why}`);
    throwsCode(() => mapRange(range, []), EDIT_ERROR.RANGE, `mapRange: ${why}`);
  }
});

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

test('validateEdits returns a frozen canonical order and leaves the input alone', () => {
  const a = { from: 10, to: 12, insert: 'B' };
  const b = { from: 2, to: 2, insert: 'A' };
  const input = [a, b];
  const snapshot = JSON.stringify(input);

  const canonical = validateEdits(SIMPLE, input);
  assert.equal(Object.isFrozen(canonical), true);
  assert.equal(canonical.every(Object.isFrozen), true);
  assert.deepEqual(canonical.map((e) => e.insert), ['A', 'B'], 'sorted by `from` ascending');

  assert.equal(JSON.stringify(input), snapshot, 'caller array/objects must not be mutated');
  assert.equal(input[0], a, 'caller array must not be reordered');
});

test('validateEdits rejects non-string text and non-array edit lists', () => {
  throwsCode(() => validateEdits(null, []), EDIT_ERROR.SHAPE, 'null text');
  throwsCode(() => validateEdits(Buffer.from('x'), []), EDIT_ERROR.SHAPE, 'buffer text');
  throwsCode(() => validateEdits(SIMPLE, null), EDIT_ERROR.SHAPE, 'null edits');
  throwsCode(() => validateEdits(SIMPLE, insertAt(0, 'x')), EDIT_ERROR.SHAPE, 'a bare edit, not a list');
  throwsCode(() => validateEdits(SIMPLE, [null]), EDIT_ERROR.SHAPE, 'a null edit');
  throwsCode(() => validateEdits(SIMPLE, [[0, 0, 'x']]), EDIT_ERROR.SHAPE, 'a tuple instead of an edit');
});

test('an edit carrying an unexpected key is rejected, not silently narrowed', () => {
  // {from, to, text} is the typo this catches: `insert` would be undefined and a
  // lenient reader would produce a deletion the caller never asked for.
  throwsCode(() => validateEdits(SIMPLE, [{ from: 0, to: 1, text: 'x' }]),
    EDIT_ERROR.SHAPE, 'text instead of insert');
  throwsCode(() => validateEdits(SIMPLE, [{ from: 0, to: 1, insert: 'x', note: 'why' }]),
    EDIT_ERROR.SHAPE, 'an extra key');
});

test('bounds are checked against the text, and only there', () => {
  const text = 'abcdef'; // length 6
  assert.doesNotThrow(() => validateEdits(text, [insertAt(6, 'x')]), 'insertion at end is in bounds');
  assert.doesNotThrow(() => validateEdits(text, [replaceSpan({ from: 0, to: 6 }, 'x')]));
  throwsCode(() => validateEdits(text, [insertAt(7, 'x')]), EDIT_ERROR.BOUNDS, 'past the end');
  throwsCode(() => validateEdits(text, [replaceSpan({ from: 5, to: 7 }, 'x')]), EDIT_ERROR.BOUNDS, 'span past the end');
  throwsCode(() => validateEdits('', [insertAt(1, 'x')]), EDIT_ERROR.BOUNDS, 'past the end of empty text');
  assert.doesNotThrow(() => validateEdits('', [insertAt(0, 'x')]), 'offset 0 is in bounds for empty text');

  // mapOffset takes no text, so it cannot and does not bounds-check.
  assert.equal(mapOffset(9999, [insertAt(0, 'ab')]), 10001);
});

test('errors carry the caller-array index of the offending edit', () => {
  const edits = [insertAt(0, 'a'), { from: 0, to: 1, insert: 5 }];
  assert.throws(() => validateEdits(SIMPLE, edits), (err) => {
    assert.equal(err.code, EDIT_ERROR.SHAPE);
    assert.equal(err.index, 1, 'index is the position in the caller array');
    return true;
  });

  // ...even when canonical order differs from caller order.
  const overlapping = [replaceSpan({ from: 10, to: 20 }, 'x'), replaceSpan({ from: 12, to: 14 }, 'y')];
  assert.throws(() => validateEdits(SIMPLE, overlapping), (err) => {
    assert.equal(err.code, EDIT_ERROR.OVERLAP);
    assert.equal(err.index, 1);
    assert.equal(err.otherIndex, 0);
    return true;
  });
});

// ---------------------------------------------------------------------------
// overlap, adjacency and same-offset policy
// ---------------------------------------------------------------------------

test('adjacent half-open edits are legal and apply in source order', () => {
  const text = 'abcdefgh';
  const out = applyEdits(text, [
    replaceSpan({ from: 3, to: 5 }, '..'),
    replaceSpan({ from: 0, to: 3 }, 'ABC'),
  ]);
  assert.equal(out, 'ABC..fgh');

  // adjacent deletions
  assert.equal(applyEdits(text, [removeSpan({ from: 0, to: 3 }), removeSpan({ from: 3, to: 5 })]), 'fgh');
  // a zero-length span abutting another edit is an insertion, not an overlap
  assert.equal(applyEdits(text, [replaceSpan({ from: 0, to: 3 }, 'X'), insertAt(3, '-')]), 'X-defgh');
});

test('overlapping spans fail closed with EEDITOVERLAP', () => {
  const cases = [
    [[replaceSpan({ from: 0, to: 4 }, 'x'), replaceSpan({ from: 2, to: 6 }, 'y')], 'partial overlap'],
    [[replaceSpan({ from: 0, to: 10 }, 'x'), replaceSpan({ from: 2, to: 3 }, 'y')], 'nested span'],
    [[replaceSpan({ from: 0, to: 4 }, 'x'), replaceSpan({ from: 0, to: 4 }, 'x')], 'the same span twice'],
    [[removeSpan({ from: 1, to: 5 }), removeSpan({ from: 1, to: 5 })], 'duplicate deletions'],
    [[replaceSpan({ from: 0, to: 4 }, 'x'), replaceSpan({ from: 0, to: 9 }, 'y')], 'shared start'],
    [[replaceSpan({ from: 2, to: 9 }, 'x'), replaceSpan({ from: 5, to: 9 }, 'y')], 'shared end'],
    // A nested span far from its container: caught only because the running
    // maximum end is tracked, not just the previous neighbour.
    [[replaceSpan({ from: 0, to: 20 }, 'x'), replaceSpan({ from: 1, to: 2 }, 'y'),
      replaceSpan({ from: 15, to: 16 }, 'z')], 'a second nested span'],
  ];
  for (const [edits, why] of cases) {
    throwsCode(() => applyEdits(SIMPLE, edits), EDIT_ERROR.OVERLAP, why);
    throwsCode(() => applyEdits(SIMPLE, edits.slice().reverse()), EDIT_ERROR.OVERLAP, `${why} (reversed)`);
  }
});

test('an insertion strictly inside a replaced or deleted span is rejected', () => {
  throwsCode(() => applyEdits(SIMPLE, [replaceSpan({ from: 2, to: 8 }, 'x'), insertAt(5, '!')]),
    EDIT_ERROR.OVERLAP, 'insertion inside a replacement');
  throwsCode(() => applyEdits(SIMPLE, [removeSpan({ from: 2, to: 8 }), insertAt(5, '!')]),
    EDIT_ERROR.OVERLAP, 'insertion inside a deletion');
  throwsCode(() => applyEdits(SIMPLE, [insertAt(3, '!'), replaceSpan({ from: 2, to: 8 }, 'x')]),
    EDIT_ERROR.OVERLAP, 'order of the caller array does not matter');
});

test('insertion at a span boundary is legal, and its side is explicit', () => {
  const text = 'abcdefgh';
  // at the START of a replacement: the insertion lands BEFORE the replacement.
  assert.equal(applyEdits(text, [replaceSpan({ from: 2, to: 5 }, 'XYZ'), insertAt(2, '<')]), 'ab<XYZfgh');
  // at the END of a replacement: AFTER it.
  assert.equal(applyEdits(text, [replaceSpan({ from: 2, to: 5 }, 'XYZ'), insertAt(5, '>')]), 'abXYZ>fgh');
  // both at once, plus caller order shuffled
  assert.equal(applyEdits(text, [insertAt(5, '>'), replaceSpan({ from: 2, to: 5 }, 'XYZ'), insertAt(2, '<')]),
    'ab<XYZ>fgh');
  // the same at a deletion's boundaries
  assert.equal(applyEdits(text, [removeSpan({ from: 2, to: 5 }), insertAt(2, '<')]), 'ab<fgh');
  assert.equal(applyEdits(text, [removeSpan({ from: 2, to: 5 }), insertAt(5, '>')]), 'ab>fgh');
  // an insertion between two adjacent replacements lands between them
  assert.equal(applyEdits(text, [
    replaceSpan({ from: 0, to: 3 }, '111'), insertAt(3, '-'), replaceSpan({ from: 3, to: 6 }, '222'),
  ]), '111-222gh');
});

test('two insertions at the same offset fail closed with EEDITAMBIGUOUS', () => {
  // The alternative would be to let the caller's array order decide which text
  // comes first, which is exactly the kind of accidental semantics this module
  // refuses. One edit inserting 'ab' says what two edits cannot.
  throwsCode(() => applyEdits(SIMPLE, [insertAt(4, 'a'), insertAt(4, 'b')]),
    EDIT_ERROR.AMBIGUOUS, 'different text at the same offset');
  throwsCode(() => applyEdits(SIMPLE, [insertAt(4, 'a'), insertAt(4, 'a')]),
    EDIT_ERROR.AMBIGUOUS, 'identical duplicated insertions');
  throwsCode(() => applyEdits(SIMPLE, [insertAt(0, ''), insertAt(0, '')]),
    EDIT_ERROR.AMBIGUOUS, 'duplicate empty insertions');
  throwsCode(() => mapOffset(0, [insertAt(4, 'a'), insertAt(4, 'b')]),
    EDIT_ERROR.AMBIGUOUS, 'mapping through an ambiguous set is refused too');

  // Insertions at DIFFERENT offsets are of course fine, even one apart.
  assert.equal(applyEdits('abcd', [insertAt(1, 'X'), insertAt(2, 'Y')]), 'aXbYcd');
});

// ---------------------------------------------------------------------------
// application
// ---------------------------------------------------------------------------

test('an empty edit list returns the exact original string', () => {
  assert.equal(applyEdits(SIMPLE, []), SIMPLE);
  assert.equal(applyEdits('', []), '');
  assert.deepEqual(validateEdits(SIMPLE, []), []);
});

test('a single edit changes only its declared target', () => {
  const text = 'abcdef';
  assert.equal(applyEdits(text, [insertAt(0, '>>')]), '>>abcdef', 'insertion at document start');
  assert.equal(applyEdits(text, [insertAt(6, '<<')]), 'abcdef<<', 'insertion at document end');
  assert.equal(applyEdits(text, [insertAt(3, '-')]), 'abc-def', 'insertion in the middle');
  assert.equal(applyEdits(text, [removeSpan({ from: 2, to: 4 })]), 'abef', 'deletion');
  assert.equal(applyEdits(text, [replaceSpan({ from: 2, to: 4 }, 'ZZZZ')]), 'abZZZZef', 'replacement');
  assert.equal(applyEdits(text, [insertAt(3, '')]), text, 'an empty insertion is a no-op');
  assert.equal(applyEdits(text, [replaceSpan({ from: 0, to: 6 }, '')]), '', 'deleting everything');
  assert.equal(applyEdits('', [insertAt(0, 'new')]), 'new', 'insertion into an empty document');
});

test('output is independent of the caller\'s ordering, and repeatable', () => {
  const text = '0123456789';
  const edits = [
    replaceSpan({ from: 8, to: 10 }, 'END'),
    insertAt(0, '<'),
    removeSpan({ from: 2, to: 4 }),
    replaceSpan({ from: 5, to: 6 }, 'FIVE'),
  ];
  //  '<' + '01' + [2,4) gone + '4' + 'FIVE' for '5' + '67' + 'END' for '89'
  const expected = '<014FIVE67END';
  const orders = [
    edits,
    edits.slice().reverse(),
    [edits[2], edits[0], edits[3], edits[1]],
    [edits[3], edits[2], edits[1], edits[0]],
  ];
  for (const order of orders) {
    assert.equal(applyEdits(text, order), expected);
    assert.equal(applyEdits(text, order), expected, 'and again -- deterministic across runs');
  }
});

test('a set is validated completely before anything is produced', () => {
  const text = 'abcdef';
  const edits = [replaceSpan({ from: 0, to: 2 }, 'OK'), replaceSpan({ from: 3, to: 99 }, 'BAD')];
  throwsCode(() => applyEdits(text, edits), EDIT_ERROR.BOUNDS, 'atomic failure');
  assert.equal(text, 'abcdef', 'the source string is untouched');
  // Nothing partial escaped: the valid prefix edit was not applied anywhere.
  assert.equal(applyEdits(text, []), 'abcdef');
});

test('inputs are never mutated by any entry point', () => {
  const text = 'abcdef';
  const one = createEdit(1, 2, 'X');
  const edits = [one, insertAt(4, 'Y')];
  const before = JSON.stringify(edits);

  applyEdits(text, edits);
  validateEdits(text, edits);
  mapOffset(3, edits);
  mapRange({ from: 0, to: 5 }, edits);

  assert.equal(JSON.stringify(edits), before);
  assert.equal(edits[0], one);
  assert.equal(text, 'abcdef');
});

// ---------------------------------------------------------------------------
// exact preservation outside edited spans
// ---------------------------------------------------------------------------

test('CRLF, LF, tabs, trailing whitespace and a missing final newline survive exactly', () => {
  const text = '#VRML V2.0 utf8\r\n'
    + 'Transform {\r\n'
    + '\ttranslation 0 0 0   \r\n' // trailing spaces before CRLF
    + '\tchildren [\n' // a lone LF in an otherwise CRLF file
    + '\t\tShape { }\n'
    + '\t]\r\n'
    + '}'; // no final newline
  const at0 = text.indexOf('0 0 0');
  const out = applyEdits(text, [replaceSpan({ from: at0, to: at0 + 5 }, '1 2 3')]);

  assert.equal(out, text.replace('0 0 0', '1 2 3'));
  assert.equal(out.split('\r\n').length, text.split('\r\n').length, 'CRLF count unchanged');
  assert.equal(out.includes('\t\tShape { }\n'), true, 'the lone LF line is untouched');
  assert.equal(out.includes('   \r\n'), true, 'trailing whitespace is untouched');
  assert.equal(out.endsWith('}'), true, 'still no final newline');
});

test('comments and commas-as-whitespace outside the edit are untouched', () => {
  const text = '#VRML V2.0 utf8\n'
    + '# a leading comment\n'
    + 'Transform {\n'
    + '  translation 1, 2, 3   # why this offset matters\n'
    + '  scale 1 1 1\n'
    + '}\n';
  const scale = text.indexOf('1 1 1');
  const out = applyEdits(text, [replaceSpan({ from: scale, to: scale + 5 }, '2 2 2')]);

  assert.equal(out, text.replace('scale 1 1 1', 'scale 2 2 2'));
  assert.equal(out.includes('# a leading comment\n'), true);
  assert.equal(out.includes('translation 1, 2, 3   # why this offset matters'), true,
    'commas as whitespace and the trailing comment are byte-identical');
});

test('numeric spelling and unknown syntax outside the edit are not normalised', () => {
  const text = '#VRML V2.0 utf8\n'
    + 'DEF Odd VendorThing {\n'
    + '  a 1.500\n' // trailing zeros
    + '  b +0.25\n' // explicit plus
    + '  c 1e3\n' // exponent
    + '  d 0x1F\n' // hex, legal SFInt32 spelling
    + '  e .5\n' // leading dot
    + '  target "keep me"\n'
    + '}\n';
  const target = text.indexOf('"keep me"');
  const out = applyEdits(text, [replaceSpan({ from: target, to: target + '"keep me"'.length }, '"changed"')]);

  assert.equal(out, text.replace('"keep me"', '"changed"'));
  for (const spelling of ['1.500', '+0.25', '1e3', '0x1F', '.5', 'VendorThing']) {
    assert.equal(out.includes(spelling), true, `${spelling} must be preserved verbatim`);
  }
});

test('UTF-16 code units are the offset unit, matching JavaScript and CodeMirror', () => {
  // U+1F680 ROCKET is a surrogate pair: two code units, one code point.
  const text = 'a\u{1F680}b';
  assert.equal(text.length, 4, 'the emoji occupies offsets 1 and 2');
  assert.equal(applyEdits(text, [insertAt(3, 'X')]), 'a\u{1F680}Xb', 'insert after the pair');
  assert.equal(applyEdits(text, [insertAt(1, 'X')]), 'aX\u{1F680}b', 'insert before the pair');
  assert.equal(applyEdits(text, [removeSpan({ from: 1, to: 3 })]), 'ab', 'delete the whole pair');

  // A three-emoji string: an edit past them must count 2 units each.
  const many = '\u{1F680}\u{1F680}\u{1F680}end';
  assert.equal(many.indexOf('end'), 6);
  assert.equal(applyEdits(many, [replaceSpan({ from: 6, to: 9 }, 'END')]), '\u{1F680}\u{1F680}\u{1F680}END');
  assert.equal(mapOffset(9, [insertAt(0, '\u{1F680}')]), 11, 'shifts by two code units, not one');
});

// ---------------------------------------------------------------------------
// realistic VRML97 edits
// ---------------------------------------------------------------------------

const SCENE = '#VRML V2.0 utf8\n'
  + '# WRL Forge test scene\n'
  + 'DEF Body Transform {\n'
  + '  translation 0 0 0\n'
  + '  rotation 0 1 0 0\n'
  + '  children [\n'
  + '    Shape {\n'
  + '      appearance Appearance {\n'
  + '        material Material {\n'
  + '          diffuseColor 0.8 0.2 0.2\n'
  + '          transparency 0\n'
  + '        }\n'
  + '      }\n'
  + '      geometry Box { size 2 2 2 }\n'
  + '    }\n'
  + '  ]\n'
  + '}\n';

// Replace the exact span of `needle` and assert every other byte is identical.
function patch(text, needle, replacement) {
  const from = text.indexOf(needle);
  assert.notEqual(from, -1, `fixture must contain ${JSON.stringify(needle)}`);
  const out = applyEdits(text, [replaceSpan({ from, to: from + needle.length }, replacement)]);
  assert.equal(out.slice(0, from), text.slice(0, from), 'text before the span is identical');
  assert.equal(out.slice(from + replacement.length), text.slice(from + needle.length),
    'text after the span is identical');
  return out;
}

test('replacing a Transform.translation value touches nothing else', () => {
  const out = patch(SCENE, '0 0 0', '1.5 0 -3');
  assert.equal(out.includes('  translation 1.5 0 -3\n'), true);
  assert.equal(out.includes('  rotation 0 1 0 0\n'), true, 'the sibling field is untouched');
  assert.equal(out.includes('# WRL Forge test scene\n'), true, 'the comment is untouched');
});

test('replacing a Transform.rotation value touches nothing else', () => {
  const out = patch(SCENE, 'rotation 0 1 0 0', 'rotation 0 1 0 1.5708');
  assert.equal(out.includes('  rotation 0 1 0 1.5708\n'), true);
  assert.equal(out.includes('  translation 0 0 0\n'), true);
});

test('inserting a field into a Transform keeps the existing fields byte-identical', () => {
  const anchor = SCENE.indexOf('  rotation');
  const out = applyEdits(SCENE, [insertAt(anchor, '  scale 2 2 2\n')]);
  assert.equal(out, SCENE.replace('  rotation', '  scale 2 2 2\n  rotation'));
  assert.equal(out.slice(0, anchor), SCENE.slice(0, anchor));
});

test('deleting a complete field span removes exactly that line', () => {
  const line = '  rotation 0 1 0 0\n';
  const from = SCENE.indexOf(line);
  const out = applyEdits(SCENE, [removeSpan({ from, to: from + line.length })]);
  assert.equal(out, SCENE.replace(line, ''));
  assert.equal(out.includes('rotation'), false);
  assert.equal(out.includes('  translation 0 0 0\n'), true);
});

test('changing Material.diffuseColor and transparency together is one atomic patch', () => {
  const color = SCENE.indexOf('0.8 0.2 0.2');
  const transparency = SCENE.indexOf('transparency 0') + 'transparency '.length;
  const out = applyEdits(SCENE, [
    replaceSpan({ from: transparency, to: transparency + 1 }, '0.35'),
    replaceSpan({ from: color, to: color + '0.8 0.2 0.2'.length }, '0 0.5 1'),
  ]);
  assert.equal(out, SCENE.replace('0.8 0.2 0.2', '0 0.5 1').replace('transparency 0', 'transparency 0.35'));
  assert.equal(out.includes('      geometry Box { size 2 2 2 }\n'), true, 'geometry untouched');
});

test('inserting a comment preserves the indentation around it', () => {
  const anchor = SCENE.indexOf('    Shape {');
  const out = applyEdits(SCENE, [insertAt(anchor, '    # the visible part\n')]);
  assert.equal(out.includes('  children [\n    # the visible part\n    Shape {\n'), true);
  assert.equal(out.length, SCENE.length + '    # the visible part\n'.length);
});

test('a patched scene still parses, and the parser sees the new value', () => {
  // Not a syntax check by this module -- it never parses -- but proof that the
  // idiom composes with the WD1.1 read side.
  const { parse, createSourceMap } = require('../../src/vrml');
  const out = patch(SCENE, '0 0 0', '1.5 0 -3');
  const result = parse(out);
  assert.equal(result.diagnostics.filter((d) => d.severity === 'error').length, 0);
  const map = createSourceMap(result);
  assert.ok(map.nodeAt(out.indexOf('Transform')), 'the Transform is still there');
});

// ---------------------------------------------------------------------------
// offset mapping
// ---------------------------------------------------------------------------

test('mapOffset validates its offset and affinity', () => {
  throwsCode(() => mapOffset(-1, []), EDIT_ERROR.SHAPE, 'negative offset');
  throwsCode(() => mapOffset(1.5, []), EDIT_ERROR.SHAPE, 'fractional offset');
  throwsCode(() => mapOffset(NaN, []), EDIT_ERROR.SHAPE, 'NaN offset');
  for (const bad of ['BEFORE', 'left', '', null, 0, true]) {
    throwsCode(() => mapOffset(0, [], bad), EDIT_ERROR.AFFINITY, `affinity ${JSON.stringify(bad)}`);
  }
  assert.equal(mapOffset(5, []), 5, 'no edits, no movement');
  assert.equal(mapOffset(0, []), 0, 'document start');
});

test('mapOffset through an insertion', () => {
  const edits = [insertAt(5, 'abc')]; // n = 3
  assert.equal(mapOffset(0, edits), 0, 'document start is unaffected');
  assert.equal(mapOffset(4, edits), 4, 'before the insertion');
  assert.equal(mapOffset(5, edits, AFFINITY.BEFORE), 5, 'at the insertion, before');
  assert.equal(mapOffset(5, edits, AFFINITY.AFTER), 8, 'at the insertion, after');
  assert.equal(mapOffset(5, edits), 5, "default affinity is 'before'");
  assert.equal(mapOffset(6, edits), 9, 'after the insertion');
  assert.equal(mapOffset(0, [insertAt(0, 'ab')], AFFINITY.AFTER), 2, 'insertion at document start');
});

test('mapOffset through a replacement', () => {
  const edits = [replaceSpan({ from: 4, to: 8 }, 'XY')]; // n = 2, delta = -2
  assert.equal(mapOffset(3, edits), 3, 'before the span');
  assert.equal(mapOffset(4, edits, AFFINITY.BEFORE), 4, 'at `from`: replacement start');
  assert.equal(mapOffset(4, edits, AFFINITY.AFTER), 6, 'at `from`, after: replacement end');
  assert.equal(mapOffset(6, edits, AFFINITY.BEFORE), 4, 'inside: replacement start');
  assert.equal(mapOffset(6, edits, AFFINITY.AFTER), 6, 'inside: replacement end');
  // `to` is NOT interior -- the range is half-open -- so it simply shifts, and
  // both affinities agree.
  assert.equal(mapOffset(8, edits, AFFINITY.BEFORE), 6, 'at `to`, before');
  assert.equal(mapOffset(8, edits, AFFINITY.AFTER), 6, 'at `to`, after');
  assert.equal(mapOffset(20, edits), 18, 'well after the span');
});

test('mapOffset through a deletion collapses both affinities', () => {
  const edits = [removeSpan({ from: 4, to: 8 })];
  assert.equal(mapOffset(3, edits), 3);
  for (const affinity of [AFFINITY.BEFORE, AFFINITY.AFTER]) {
    assert.equal(mapOffset(4, edits, affinity), 4, `at from (${affinity})`);
    assert.equal(mapOffset(6, edits, affinity), 4, `inside deleted text (${affinity})`);
    assert.equal(mapOffset(8, edits, affinity), 4, `at to (${affinity})`);
  }
  assert.equal(mapOffset(9, edits), 5, 'after the deletion');
});

test('mapOffset accumulates multiple preceding edits and ignores following ones', () => {
  const edits = [
    insertAt(0, '##'), //           +2
    replaceSpan({ from: 4, to: 6 }, 'LONGER'), // +4
    removeSpan({ from: 10, to: 15 }), //         -5
    insertAt(30, '!!'), //          after the probe: irrelevant
  ];
  assert.equal(mapOffset(0, edits), 0, 'document start, before affinity');
  assert.equal(mapOffset(0, edits, AFFINITY.AFTER), 2);
  assert.equal(mapOffset(3, edits), 5, 'one preceding edit');
  assert.equal(mapOffset(7, edits), 13, 'two preceding edits');
  assert.equal(mapOffset(20, edits), 21, 'three preceding edits');
  assert.equal(mapOffset(29, edits), 30, 'still before the last edit');
  assert.equal(mapOffset(31, edits), 34, 'past all four');
});

test('mapOffset on an empty source and at document end', () => {
  assert.equal(mapOffset(0, []), 0, 'empty source, no edits');
  assert.equal(mapOffset(0, [insertAt(0, 'abc')], AFFINITY.BEFORE), 0);
  assert.equal(mapOffset(0, [insertAt(0, 'abc')], AFFINITY.AFTER), 3);
  const end = SIMPLE.length;
  assert.equal(mapOffset(end, [insertAt(end, 'tail')], AFFINITY.BEFORE), end);
  assert.equal(mapOffset(end, [insertAt(end, 'tail')], AFFINITY.AFTER), end + 4);
});

test('at a coincident insertion and span start, the insertion resolves first', () => {
  // Documented consequence of canonical order: an 'after' offset at p lands
  // between the inserted text and the replacement that also starts at p.
  const edits = [insertAt(5, 'ab'), replaceSpan({ from: 5, to: 9 }, 'ZZZZZZ')];
  assert.equal(applyEdits('0123456789', edits), '01234abZZZZZZ9');
  assert.equal(mapOffset(5, edits, AFFINITY.BEFORE), 5);
  assert.equal(mapOffset(5, edits, AFFINITY.AFTER), 7, 'past the insertion, at the replacement start');
  assert.equal(mapOffset(7, edits, AFFINITY.BEFORE), 7, 'interior of the replacement, shifted by the insertion');
  assert.equal(mapOffset(7, edits, AFFINITY.AFTER), 13);
  assert.equal(mapOffset(9, edits), 13, 'at `to`');
});

test('mapping is monotonic outside replaced interiors', () => {
  const edits = [
    insertAt(2, 'xx'),
    replaceSpan({ from: 6, to: 10 }, 'Y'),
    removeSpan({ from: 14, to: 18 }),
    insertAt(22, 'zzzz'),
  ];
  for (const affinity of [AFFINITY.BEFORE, AFFINITY.AFTER]) {
    let previous = -1;
    for (let offset = 0; offset <= 30; offset += 1) {
      const mapped = mapOffset(offset, edits, affinity);
      assert.ok(mapped >= previous, `mapping must be non-decreasing at ${offset} (${affinity})`);
      previous = mapped;
    }
  }
});

// ---------------------------------------------------------------------------
// range mapping
// ---------------------------------------------------------------------------

test('mapRange defaults to start before / end after and returns a frozen range', () => {
  const range = mapRange({ from: 2, to: 6 }, []);
  assert.deepEqual({ ...range }, { from: 2, to: 6 });
  assert.equal(Object.isFrozen(range), true);
  throwsCode(() => mapRange({ from: 0, to: 1 }, [], { startAffinity: 'x' }),
    EDIT_ERROR.AFFINITY, 'bad start affinity');
  throwsCode(() => mapRange({ from: 0, to: 1 }, [], { endAffinity: 'x' }),
    EDIT_ERROR.AFFINITY, 'bad end affinity');
});

test('mapRange: ranges wholly before or after an edit', () => {
  const edits = [replaceSpan({ from: 10, to: 12 }, 'ABCD')]; // delta +2
  assert.deepEqual({ ...mapRange({ from: 2, to: 6 }, edits) }, { from: 2, to: 6 }, 'before');
  assert.deepEqual({ ...mapRange({ from: 14, to: 18 }, edits) }, { from: 16, to: 20 }, 'after');
});

test('mapRange: an insertion inside, at the start of, and at the end of a range', () => {
  const range = { from: 4, to: 10 };
  assert.deepEqual({ ...mapRange(range, [insertAt(7, 'xx')]) }, { from: 4, to: 12 },
    'an insertion inside grows the range');
  assert.deepEqual({ ...mapRange(range, [insertAt(4, 'xx')]) }, { from: 4, to: 12 },
    'an insertion at the start is absorbed by the default start affinity');
  assert.deepEqual({ ...mapRange(range, [insertAt(4, 'xx')], { startAffinity: AFFINITY.AFTER }) },
    { from: 6, to: 12 }, "...unless the caller asks for 'after'");
  assert.deepEqual({ ...mapRange(range, [insertAt(10, 'xx')]) }, { from: 4, to: 12 },
    'an insertion at the end is absorbed by the default end affinity');
  assert.deepEqual({ ...mapRange(range, [insertAt(10, 'xx')], { endAffinity: AFFINITY.BEFORE }) },
    { from: 4, to: 10 }, "...unless the caller asks for 'before'");
});

test('mapRange: replacements inside, straddling, and around a range', () => {
  const range = { from: 10, to: 20 };
  assert.deepEqual({ ...mapRange(range, [replaceSpan({ from: 12, to: 14 }, 'XYZZY')]) },
    { from: 10, to: 23 }, 'a replacement fully inside');
  assert.deepEqual({ ...mapRange(range, [replaceSpan({ from: 5, to: 12 }, 'Z')]) },
    { from: 5, to: 14 }, 'a replacement crossing the start');
  assert.deepEqual({ ...mapRange(range, [replaceSpan({ from: 18, to: 25 }, 'Z')]) },
    { from: 10, to: 19 }, 'a replacement crossing the end');
  assert.deepEqual({ ...mapRange(range, [replaceSpan({ from: 5, to: 25 }, 'ZZZ')]) },
    { from: 5, to: 8 }, 'a replacement swallowing the range: it covers the new text');
  assert.deepEqual({ ...mapRange({ from: 12, to: 14 }, [replaceSpan({ from: 10, to: 20 }, 'ZZZ')]) },
    { from: 10, to: 13 }, 'a range fully inside replaced text');
});

test('mapRange: deletions crossing an endpoint and covering the whole range', () => {
  const range = { from: 10, to: 20 };
  assert.deepEqual({ ...mapRange(range, [removeSpan({ from: 5, to: 12 })]) }, { from: 5, to: 13 },
    'deletion crossing the start');
  assert.deepEqual({ ...mapRange(range, [removeSpan({ from: 18, to: 25 })]) }, { from: 10, to: 18 },
    'deletion crossing the end');
  assert.deepEqual({ ...mapRange(range, [removeSpan({ from: 5, to: 25 })]) }, { from: 5, to: 5 },
    'deletion covering the whole range collapses it');
  assert.deepEqual({ ...mapRange(range, [removeSpan({ from: 10, to: 20 })]) }, { from: 10, to: 10 },
    'deletion of exactly the range collapses it');
});

test('mapRange: a collapsed cursor', () => {
  const cursor = { from: 6, to: 6 };
  assert.deepEqual({ ...mapRange(cursor, []) }, { from: 6, to: 6 }, 'no edits');
  assert.deepEqual({ ...mapRange(cursor, [insertAt(3, 'ab')]) }, { from: 8, to: 8 }, 'insertion before it');
  assert.deepEqual({ ...mapRange(cursor, [insertAt(9, 'ab')]) }, { from: 6, to: 6 }, 'insertion after it');
  // With the selection-shaped defaults, text inserted AT a cursor becomes a
  // selection of that text -- pass matching affinities to keep it a cursor.
  assert.deepEqual({ ...mapRange(cursor, [insertAt(6, 'ab')]) }, { from: 6, to: 8 });
  assert.deepEqual({ ...mapRange(cursor, [insertAt(6, 'ab')], { endAffinity: AFFINITY.BEFORE }) },
    { from: 6, to: 6 }, 'both before: the cursor stays put');
  assert.deepEqual({ ...mapRange(cursor, [insertAt(6, 'ab')], { startAffinity: AFFINITY.AFTER }) },
    { from: 8, to: 8 }, 'both after: the cursor follows the inserted text');
  assert.deepEqual({ ...mapRange(cursor, [removeSpan({ from: 4, to: 9 })]) }, { from: 4, to: 4 },
    'a deletion around it');
});

test('mapRange: multiple edits, and an inverted result is reported not hidden', () => {
  const edits = [insertAt(0, '##'), removeSpan({ from: 8, to: 12 }), replaceSpan({ from: 20, to: 22 }, 'ZZZZ')];
  assert.deepEqual({ ...mapRange({ from: 4, to: 16 }, edits) }, { from: 6, to: 14 });
  // +2 (insertion) -4 (deletion) +2 (replacement) nets to zero at the far end.
  assert.deepEqual({ ...mapRange({ from: 0, to: 30 }, edits) }, { from: 0, to: 30 });

  // start 'after' + end 'before' at a collapsed cursor on an insertion pulls the
  // endpoints past each other. Never silently swapped or clamped.
  throwsCode(
    () => mapRange({ from: 6, to: 6 }, [insertAt(6, 'abc')],
      { startAffinity: AFFINITY.AFTER, endAffinity: AFFINITY.BEFORE }),
    EDIT_ERROR.INVERTED, 'inverted mapped range',
  );
});

test('a mapped range never comes back inverted across a sweep of edit sets', () => {
  const sets = [
    [],
    [insertAt(5, 'abc')],
    [removeSpan({ from: 4, to: 9 })],
    [replaceSpan({ from: 4, to: 9 }, 'X')],
    [insertAt(0, 'a'), removeSpan({ from: 3, to: 7 }), replaceSpan({ from: 9, to: 12 }, 'YYYY')],
  ];
  for (const edits of sets) {
    for (let from = 0; from <= 14; from += 1) {
      for (let to = from; to <= 14; to += 1) {
        const mapped = mapRange({ from, to }, edits);
        assert.ok(mapped.from <= mapped.to, `[${from},${to}) mapped to [${mapped.from},${mapped.to})`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// deterministic generated cases
// ---------------------------------------------------------------------------
//
// Fixed seed, bounded count, no dependency. Each case prints its own seed and
// edit set on failure so a red run is reproducible from the message alone.

// mulberry32 -- a small, well-known deterministic PRNG. Seeded per case so a
// failing case can be re-run in isolation.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CORPUS = [
  '#VRML V2.0 utf8\n',
  '# comment with, commas and\ttabs   \n',
  'DEF A Transform {\n',
  '  translation 1.500 -0.25 +3\n',
  '  children [ Shape { geometry Box { size 1 1 1 } } ]\n',
  '}\r\n',
  'WorldInfo { title "\u{1F680} rocket" }\n',
  '\n',
  '\t\t\n',
];

function buildText(next) {
  const lines = [];
  const count = 6 + Math.floor(next() * 8);
  for (let i = 0; i < count; i += 1) lines.push(CORPUS[Math.floor(next() * CORPUS.length)]);
  return lines.join('');
}

// Generate a legal, non-overlapping edit set. The cursor always advances by at
// least one offset between edits, so no two insertions can share an offset and
// no insertion can land inside a span.
function buildEdits(next, text) {
  const edits = [];
  let cursor = 0;
  const target = 1 + Math.floor(next() * 5);
  while (edits.length < target && cursor < text.length) {
    const from = cursor + Math.floor(next() * Math.max(1, Math.floor((text.length - cursor) / 3)));
    if (from >= text.length) break;
    const kind = next();
    const insert = next() < 0.5 ? '' : 'NEW'.slice(0, 1 + Math.floor(next() * 3));
    if (kind < 0.34) {
      edits.push(insertAt(from, insert || 'X'));
      cursor = from + 1;
    } else {
      const to = Math.min(text.length, from + 1 + Math.floor(next() * 6));
      edits.push(kind < 0.67 ? removeSpan({ from, to }) : replaceSpan({ from, to }, insert || 'Y'));
      cursor = to + 1;
    }
  }
  return edits;
}

function shuffle(next, items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The independent oracle: apply from the highest source offset to the lowest,
// splicing one edit at a time. Slower and written differently from the module's
// single linear pass, so agreement is evidence, not tautology.
function referenceApply(text, edits) {
  const order = edits.slice().sort((a, b) => {
    if (a.from !== b.from) return b.from - a.from;
    const ai = a.from === a.to ? 0 : 1;
    const bi = b.from === b.to ? 0 : 1;
    if (ai !== bi) return bi - ai;
    return b.to - a.to;
  });
  let out = text;
  for (const e of order) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}

test('generated: caller order is irrelevant, output is deterministic, inputs are untouched', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const next = rng(seed);
    const text = buildText(next);
    const edits = buildEdits(next, text);
    const context = `seed ${seed}: ${JSON.stringify(edits)}`;
    const snapshot = JSON.stringify(edits);

    const expected = applyEdits(text, edits);
    assert.equal(applyEdits(text, edits), expected, `repeat run differs -- ${context}`);
    assert.equal(referenceApply(text, edits), expected,
      `highest-offset-first reference disagrees -- ${context}`);

    for (let k = 0; k < 4; k += 1) {
      const shuffled = shuffle(next, edits);
      assert.equal(applyEdits(text, shuffled), expected, `caller order changed the output -- ${context}`);
    }
    assert.equal(JSON.stringify(edits), snapshot, `inputs were mutated -- ${context}`);
    assert.equal(text, buildText(rng(seed)), 'the source string was mutated');
  }
});

// Walk the untouched gaps: the text before the first edit, between each pair,
// and after the last. Each must appear verbatim in the output at the position
// mapOffset predicts -- which cross-checks application and mapping against each
// other rather than against a restatement of either.
test('generated: untouched regions land exactly where mapOffset says they do', () => {
  for (let seed = 2000; seed <= 2200; seed += 1) {
    const next = rng(seed);
    const text = buildText(next);
    const edits = buildEdits(next, text);
    const context = `seed ${seed}: ${JSON.stringify(edits)}`;
    const out = applyEdits(text, edits);
    const canonical = validateEdits(text, edits);

    const gaps = [];
    let cursor = 0;
    for (const e of canonical) { gaps.push([cursor, e.from]); cursor = e.to; }
    gaps.push([cursor, text.length]);

    for (const [start, end] of gaps) {
      if (start >= end) continue;
      const mappedStart = mapOffset(start, edits, AFFINITY.AFTER);
      const mappedEnd = mapOffset(end, edits, AFFINITY.BEFORE);
      assert.equal(out.slice(mappedStart, mappedEnd), text.slice(start, end),
        `untouched region [${start},${end}) moved or changed -- ${context}`);
    }
  }
});

test('generated: offset mapping is monotonic and never negative', () => {
  for (let seed = 3000; seed <= 3100; seed += 1) {
    const next = rng(seed);
    const text = buildText(next);
    const edits = buildEdits(next, text);
    const out = applyEdits(text, edits);
    const context = `seed ${seed}: ${JSON.stringify(edits)}`;

    for (const affinity of [AFFINITY.BEFORE, AFFINITY.AFTER]) {
      let previous = -1;
      for (let offset = 0; offset <= text.length; offset += 1) {
        const mapped = mapOffset(offset, edits, affinity);
        assert.ok(mapped >= previous, `not monotonic at ${offset} (${affinity}) -- ${context}`);
        assert.ok(mapped >= 0 && mapped <= out.length,
          `mapped ${offset} to ${mapped}, outside [0,${out.length}] -- ${context}`);
        previous = mapped;
      }
    }
  }
});

test('generated: a deliberately overlapping pair is always rejected', () => {
  for (let seed = 4000; seed <= 4200; seed += 1) {
    const next = rng(seed);
    const text = buildText(next);
    if (text.length < 12) continue;
    const from = Math.floor(next() * (text.length - 10));
    const to = from + 2 + Math.floor(next() * 6);
    const span = replaceSpan({ from, to }, 'X');
    // Something that must conflict: a nested span, or an insertion strictly inside.
    const conflicting = next() < 0.5
      ? replaceSpan({ from: from + 1, to: to - 1 >= from + 1 ? to - 1 : to }, 'Y')
      : insertAt(from + 1, 'Y');
    const context = `seed ${seed}: ${JSON.stringify([span, conflicting])}`;
    throwsCode(() => applyEdits(text, [span, conflicting]), EDIT_ERROR.OVERLAP, context);
    throwsCode(() => applyEdits(text, [conflicting, span]), EDIT_ERROR.OVERLAP, `${context} (reversed)`);
  }
});
