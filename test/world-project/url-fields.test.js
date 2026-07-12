'use strict';
// Production World Project URL-field extraction: node-type + field-name capture
// on top of the value extraction already covered by test/world-recon.
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractUrlRefs, extractUrlValues, nodeTypeBefore } = require('../../src/world-project/url-fields');

test('extractUrlRefs captures node type and field name per reference', () => {
  const text = 'Appearance { texture ImageTexture { url "img/a.jpg" } }';
  const refs = extractUrlRefs(text);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].nodeType, 'ImageTexture');
  assert.equal(refs[0].field, 'url');
  assert.equal(refs[0].value, 'img/a.jpg');
});

test('attributes nested nodes correctly (brace-depth aware)', () => {
  const text = 'Background { frontUrl "sky/f.jpg" } Inline { url "sub/child.wrl" }';
  const refs = extractUrlRefs(text);
  assert.deepEqual(refs.map((r) => [r.nodeType, r.field, r.value]), [
    ['Background', 'frontUrl', 'sky/f.jpg'],
    ['Inline', 'url', 'sub/child.wrl'],
  ]);
});

test('MFString array keeps the node type for every entry', () => {
  const text = 'MovieTexture {\n url [\n "a.mpg"\n "b.mpg"\n ]\n}';
  const refs = extractUrlRefs(text);
  assert.equal(refs.length, 2);
  assert.ok(refs.every((r) => r.nodeType === 'MovieTexture' && r.field === 'url'));
  assert.deepEqual(refs.map((r) => r.value), ['a.mpg', 'b.mpg']);
});

test('extractUrlValues stays value-only (recon back-compat)', () => {
  assert.deepEqual(extractUrlValues('Inline{ url "x.wrl" }'), ['x.wrl']);
});

test('nodeTypeBefore returns null when there is no enclosing node', () => {
  assert.equal(nodeTypeBefore('url "loose.jpg"', 0), null);
});
