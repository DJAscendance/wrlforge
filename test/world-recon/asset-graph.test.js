'use strict';
// Non-visual unit tests for the bounded asset-graph builder. Uses an in-memory
// world (injected readSource/exists/listDir) -- no Electron, no real files.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildAssetGraph, kindOf } = require('../../qa/world-recon/asset-graph');

// Build injected deps from a plain map of absolute-path -> source text, plus a
// set of asset files that "exist" on disk.
function world(sources, assetFiles = []) {
  const norm = (p) => path.resolve(p);
  const src = new Map(Object.entries(sources).map(([k, v]) => [norm(k), v]));
  const files = new Set([...Object.keys(sources), ...assetFiles].map(norm));
  return {
    readSource: (p) => {
      if (!src.has(norm(p))) { const e = new Error('ENOENT'); throw e; }
      return { text: src.get(norm(p)) };
    },
    exists: (p) => files.has(norm(p)),
    listDir: (d) => [...files].filter((f) => path.dirname(f) === norm(d)).map((f) => path.basename(f)),
  };
}

test('kindOf classifies by extension', () => {
  assert.equal(kindOf('/w/a.wrl'), 'wrl');
  assert.equal(kindOf('/w/a.WRZ'), 'wrl');
  assert.equal(kindOf('/w/img/a.JPG'), 'texture');
  assert.equal(kindOf('/w/s/a.wav'), 'audio');
  assert.equal(kindOf('/w/m/a.mpg'), 'movie');
  assert.equal(kindOf('/w/readme.txt'), 'other');
});

test('resolves assets relative to each referring file and counts refs', () => {
  const deps = world({
    '/world/main.wrl': 'ImageTexture{ url "img/wall.jpg" } ImageTexture{ url "img/wall.jpg" } AudioClip{ url "sound/x.wav" }',
  }, ['/world/img/wall.jpg', '/world/sound/x.wav']);
  const g = buildAssetGraph('/world/main.wrl', deps);
  assert.equal(g.stats.wrlFiles, 1);
  assert.equal(g.stats.uniqueAssets, 2);
  assert.deepEqual(g.stats.byKind, { texture: 1, audio: 1 });
  const wall = g.assets.find((a) => a.path.endsWith('wall.jpg'));
  assert.equal(wall.refCount, 2, 'duplicate references are counted');
  assert.equal(g.stats.missing, 0);
});

test('follows nested Inline .wrl composition, resolving child-relative paths', () => {
  const deps = world({
    '/world/main.wrl': 'Inline{ url "sub/child.wrl" }',
    '/world/sub/child.wrl': 'ImageTexture{ url "tex/leaf.png" }',
  }, ['/world/sub/tex/leaf.png']);
  const g = buildAssetGraph('/world/main.wrl', deps);
  assert.equal(g.stats.wrlFiles, 2);
  assert.equal(g.stats.maxDepthSeen, 1);
  const leaf = g.assets.find((a) => a.path.endsWith('leaf.png'));
  assert.ok(leaf, 'child-relative texture resolved under the child dir');
  assert.ok(leaf.path.endsWith(path.join('sub', 'tex', 'leaf.png')));
});

test('is cycle-safe: mutually-inlining worlds terminate', () => {
  const deps = world({
    '/w/a.wrl': 'Inline{ url "b.wrl" }',
    '/w/b.wrl': 'Inline{ url "a.wrl" }',
  });
  const g = buildAssetGraph('/w/a.wrl', deps);
  assert.equal(g.stats.wrlFiles, 2, 'each wrl visited exactly once despite the cycle');
});

test('flags missing references without following them', () => {
  const deps = world({ '/w/main.wrl': 'ImageTexture{ url "img/gone.jpg" }' });
  const g = buildAssetGraph('/w/main.wrl', deps);
  assert.equal(g.stats.missing, 1);
  assert.ok(g.missing[0].path.endsWith('gone.jpg'));
  assert.equal(g.missing[0].kind, 'texture');
});

test('detects case-mismatch (exists only under a different case)', () => {
  const deps = world({ '/w/main.wrl': 'ImageTexture{ url "img/Wall.JPG" }' }, ['/w/img/wall.jpg']);
  const g = buildAssetGraph('/w/main.wrl', deps);
  assert.equal(g.stats.missing, 0, 'a case-only difference is not "missing"');
  assert.equal(g.stats.caseMismatches, 1);
  assert.ok(g.caseMismatches[0].actual.endsWith('wall.jpg'));
});

test('surfaces remote references but does not follow or count them as assets', () => {
  const deps = world({ '/w/main.wrl': 'ImageTexture{ url "http://x/y.png" } Inline{ url "local.wrl" }' },
    []);
  const g = buildAssetGraph('/w/main.wrl', deps);
  assert.equal(g.stats.remoteRefs, 1);
  assert.equal(g.remoteRefs[0].url, 'http://x/y.png');
  assert.ok(!g.assets.some((a) => a.path.includes('y.png')));
});

test('bounded: maxWrlNodes truncates a large graph', () => {
  const sources = {};
  for (let i = 0; i < 10; i++) sources[`/w/n${i}.wrl`] = `Inline{ url "n${i + 1}.wrl" }`;
  sources['/w/n10.wrl'] = '# leaf';
  const g = buildAssetGraph('/w/n0.wrl', { ...world(sources), maxWrlNodes: 4 });
  assert.equal(g.truncated, true);
  assert.equal(g.stats.wrlFiles, 4);
});

test('bounded: maxDepth stops descent', () => {
  const sources = {};
  for (let i = 0; i < 6; i++) sources[`/w/d${i}.wrl`] = `Inline{ url "d${i + 1}.wrl" }`;
  sources['/w/d6.wrl'] = '# leaf';
  const g = buildAssetGraph('/w/d0.wrl', { ...world(sources), maxDepth: 2 });
  assert.equal(g.depthCapped, true);
  assert.equal(g.stats.maxDepthSeen, 2);
});

test('records an unreadable .wrl node without aborting the walk', () => {
  const deps = world({ '/w/main.wrl': 'Inline{ url "broken.wrl" } ImageTexture{ url "img/ok.png" }' },
    ['/w/img/ok.png']);
  // broken.wrl is referenced but has no source entry -> readSource throws.
  const g = buildAssetGraph('/w/main.wrl', deps);
  const broken = g.wrlNodes.find((n) => n.path.endsWith('broken.wrl'));
  assert.ok(broken.unreadable, 'unreadable child is recorded');
  assert.ok(g.assets.some((a) => a.path.endsWith('ok.png')), 'walk continues past the unreadable node');
});
