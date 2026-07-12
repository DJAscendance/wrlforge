'use strict';
// Primary-world detection and scan orchestration (injected fs -- no real tree).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { detectPrimaries, scanProject } = require('../../src/world-project/project-loader');

function loaderDeps(sources, sizes = {}) {
  const norm = (p) => path.resolve(p);
  const src = new Map(Object.entries(sources).map(([k, v]) => [norm(k), v]));
  return {
    collectWrl: () => [...src.keys()],
    readSource: (p) => { if (!src.has(norm(p))) throw new Error('ENOENT'); return { text: src.get(norm(p)), wasGzipped: /GZIP/.test(src.get(norm(p))) }; },
    statSize: (p) => (sizes[p] != null ? sizes[p] : (src.get(norm(p)) || '').length),
  };
}

test('detects a single primary when one file inlines the others', () => {
  const d = detectPrimaries('/proj', loaderDeps({
    '/proj/world.wrl': 'Inline { url "parts/a.wrl" } Inline { url "parts/b.wrl" }',
    '/proj/parts/a.wrl': '# a',
    '/proj/parts/b.wrl': '# b',
  }));
  assert.equal(d.ambiguous, false);
  assert.equal(d.empty, false);
  assert.equal(d.primary, path.resolve('/proj/world.wrl'));
});

test('reports ambiguity when several files are unreferenced', () => {
  const d = detectPrimaries('/proj', loaderDeps({
    '/proj/alpha.wrl': '# nothing',
    '/proj/beta.wrl': '# nothing',
  }));
  assert.equal(d.ambiguous, true);
  assert.equal(d.primary, null);
  assert.equal(d.candidates.length, 2);
});

test('prefers a conventionally-named primary in the sort order', () => {
  const d = detectPrimaries('/proj', loaderDeps({
    '/proj/zzz.wrl': '# a',
    '/proj/index.wrl': '# b',
  }));
  assert.equal(d.ambiguous, true); // still asks, but index.wrl ranks first
  assert.equal(path.basename(d.candidates[0].path), 'index.wrl');
  assert.ok(d.candidates[0].preferred);
});

test('empty when no .wrl files exist', () => {
  const d = detectPrimaries('/proj', loaderDeps({}));
  assert.equal(d.empty, true);
  assert.equal(d.candidates.length, 0);
});

test('fully-linked set (every file inlined) falls back to offering all', () => {
  const d = detectPrimaries('/proj', loaderDeps({
    '/proj/a.wrl': 'Inline { url "b.wrl" }',
    '/proj/b.wrl': 'Inline { url "a.wrl" }',
  }));
  assert.equal(d.candidates.length, 2);
  assert.equal(d.ambiguous, true);
});

test('scanProject reports gzip primary and scan time', () => {
  const now = (() => { let t = 1000; return () => (t += 5); })();
  const scan = scanProject({ root: '/proj', primary: '/proj/world.wrl' }, {
    now,
    readSource: (p) => ({ text: 'GZIP ImageTexture { url "img/a.png" }', wasGzipped: true }),
    exists: () => true,
    listDir: () => ['a.png'],
    statSize: () => 42,
    readHead: () => null,
  });
  assert.equal(scan.primaryGzip, true);
  assert.equal(scan.status, 'ok');
  assert.ok(scan.scanMs >= 0);
  assert.equal(scan.graph.stats.uniqueTextures, 1);
});

test('scanProject flags an unreadable primary without throwing', () => {
  const scan = scanProject({ root: '/proj', primary: '/proj/world.wrl' }, {
    readSource: () => { throw new Error('gzip magic but failed to inflate'); },
    exists: () => false,
    listDir: () => [],
  });
  assert.equal(scan.status, 'primary-unreadable');
  assert.match(scan.error, /inflate/);
});
