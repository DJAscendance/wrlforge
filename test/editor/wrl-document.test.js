'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const doc = require('../../src/editor/wrl-document');

const WRL = '#VRML V2.0 utf8\nGroup { children [] }\n';

test('formatFromGzip maps the wasGzipped flag', () => {
  assert.strictEqual(doc.formatFromGzip(true), doc.FORMAT.GZIP);
  assert.strictEqual(doc.formatFromGzip(false), doc.FORMAT.PLAIN);
});

test('createDocument starts clean with baseline == text', () => {
  const d = doc.createDocument({ sourcePath: '/x.wrl', text: WRL, format: doc.FORMAT.PLAIN, stat: null });
  assert.strictEqual(d.text, WRL);
  assert.strictEqual(d.baseline, WRL);
  assert.strictEqual(doc.isDirty(d), false);
});

test('createDocument rejects an unknown format', () => {
  assert.throws(() => doc.createDocument({ sourcePath: '/x', text: '', format: 'brotli' }), /Unknown WRL document format/);
});

test('withText derives dirty state from the buffer, and clears when reverted', () => {
  let d = doc.createDocument({ sourcePath: '/x.wrl', text: WRL, format: doc.FORMAT.PLAIN });
  d = doc.withText(d, WRL + '# edit\n');
  assert.strictEqual(doc.isDirty(d), true);
  d = doc.withText(d, WRL); // revert to exactly the baseline
  assert.strictEqual(doc.isDirty(d), false, 'reverting to baseline text is not dirty');
});

test('markSynced adopts the buffer as the new baseline and updates the stat', () => {
  let d = doc.createDocument({ sourcePath: '/x.wrl', text: WRL, format: doc.FORMAT.PLAIN, stat: { hash: 'a' } });
  d = doc.withText(d, WRL + '# saved\n');
  d = doc.markSynced(d, { text: d.text, stat: { hash: 'b' } });
  assert.strictEqual(doc.isDirty(d), false);
  assert.strictEqual(d.baseline, WRL + '# saved\n');
  assert.strictEqual(d.stat.hash, 'b');
});

test('markSynced with disk text (reload) resets both baseline and buffer', () => {
  let d = doc.createDocument({ sourcePath: '/x.wrl', text: WRL, format: doc.FORMAT.PLAIN });
  d = doc.withText(d, 'garbage edits');
  d = doc.markSynced(d, { text: WRL, stat: { hash: 'c' } });
  assert.strictEqual(d.text, WRL);
  assert.strictEqual(doc.isDirty(d), false);
});

test('withSource repoints path/format (Save As) with the buffer as baseline', () => {
  let d = doc.createDocument({ sourcePath: '/a.wrl', text: WRL, format: doc.FORMAT.GZIP });
  d = doc.withText(d, WRL + '# as\n');
  d = doc.withSource(d, { sourcePath: '/b.wrl', format: doc.FORMAT.PLAIN, stat: { hash: 'z' } });
  assert.strictEqual(d.sourcePath, '/b.wrl');
  assert.strictEqual(d.format, doc.FORMAT.PLAIN);
  assert.strictEqual(d.baseline, WRL + '# as\n');
  assert.strictEqual(doc.isDirty(d), false, 'a freshly saved-as buffer is clean');
});
