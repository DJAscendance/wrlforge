'use strict';
// Tests the pure base-URL / path-confinement helpers used to resolve a WRL's
// relative textures against the source directory while preventing the
// read-only IPC channel from escaping the approved fixtures directory.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { safeResolve, dirUrl, fileDirUrl } = require('../../src/preview/texture-base');

// Use path.resolve (not path.join) so BASE carries a drive letter on Windows,
// matching what the product's safeResolve() -> path.resolve() produces. With a
// bare path.join path (no drive), the expected path.join(BASE, name) below would
// never equal the product's drive-qualified result on win32.
const BASE = path.resolve(path.sep, 'srv', 'wrl', 'fixtures');

test('safeResolve accepts a plain name in the base directory', () => {
  assert.equal(safeResolve(BASE, 'stone.wrl'), path.join(BASE, 'stone.wrl'));
});

test('safeResolve accepts a nested relative name', () => {
  assert.equal(safeResolve(BASE, path.join('tex', 'wood.wrl')), path.join(BASE, 'tex', 'wood.wrl'));
});

test('safeResolve rejects parent-directory traversal', () => {
  assert.equal(safeResolve(BASE, path.join('..', 'secret.wrl')), null);
  assert.equal(safeResolve(BASE, path.join('..', '..', 'etc', 'passwd')), null);
});

test('safeResolve rejects absolute paths and drive letters', () => {
  assert.equal(safeResolve(BASE, path.join(path.sep, 'etc', 'passwd')), null);
  assert.equal(safeResolve(BASE, 'C:\\Windows\\system32'), null);
});

test('safeResolve rejects empty / non-string names', () => {
  assert.equal(safeResolve(BASE, ''), null);
  assert.equal(safeResolve(BASE, null), null);
  assert.equal(safeResolve(BASE, undefined), null);
});

test('safeResolve rejects a name that resolves to the base directory itself', () => {
  assert.equal(safeResolve(BASE, '.'), null);
});

test('dirUrl produces a file:// URL with a trailing slash', () => {
  const url = dirUrl(BASE);
  assert.ok(url.startsWith('file:///'), `expected file:// URL, got ${url}`);
  assert.ok(url.endsWith('/'), 'base URL must end with a slash so relatives resolve as a directory');
});

test('dirUrl percent-encodes spaces and never yields a remote scheme', () => {
  const url = dirUrl(path.join(path.sep, 'srv', 'my items'));
  assert.match(url, /my%20items/);
  assert.ok(!/^https?:/.test(url), 'must never produce an http(s) base URL');
});

test('fileDirUrl returns the directory of the source file, not the file itself', () => {
  const url = fileDirUrl(path.join(BASE, 'item.wrl'));
  assert.ok(url.endsWith('/fixtures/'), `expected the containing dir, got ${url}`);
  assert.ok(!url.includes('item.wrl'), 'base URL must not include the filename');
});
