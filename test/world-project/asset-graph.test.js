'use strict';
// Enriched production asset-graph coverage (injected fs -- no real files). The
// recon-level behavior (nested Inline, cycles, missing, case, remote, bounds,
// unreadable) is already covered by test/world-recon; this focuses on the Phase
// 4A enrichment: per-reference records, sizes/dimensions, scene counts, unsafe
// paths, duplicate detection, and large-texture-set handling.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildAssetGraph } = require('../../src/world-project/asset-graph');

// sources: absPath -> text. present: absPath -> { bytes?, dims? } for assets.
function world(sources, present = {}) {
  const norm = (p) => path.resolve(p);
  const src = new Map(Object.entries(sources).map(([k, v]) => [norm(k), v]));
  const files = new Set([...Object.keys(sources), ...Object.keys(present)].map(norm));
  const meta = new Map(Object.entries(present).map(([k, v]) => [norm(k), v]));
  return {
    readSource: (p) => { if (!src.has(norm(p))) throw new Error('ENOENT'); return { text: src.get(norm(p)) }; },
    exists: (p) => files.has(norm(p)),
    listDir: (d) => [...files].filter((f) => path.dirname(f) === norm(d)).map((f) => path.basename(f)),
    statSize: (p) => (meta.get(norm(p)) && meta.get(norm(p)).bytes) != null ? meta.get(norm(p)).bytes : (src.has(norm(p)) ? src.get(norm(p)).length : null),
    readHead: (p) => {
      const m = meta.get(norm(p));
      if (!m || !m.dims) return null;
      const b = Buffer.alloc(24);
      b.writeUInt32BE(0x89504e47, 0); b.write('IHDR', 12, 'ascii');
      b.writeUInt32BE(m.dims.width, 16); b.writeUInt32BE(m.dims.height, 20);
      return b;
    },
  };
}

test('produces occurrence-level reference records with node type + field', () => {
  const g = buildAssetGraph('/w/main.wrl', world(
    { '/w/main.wrl': 'ImageTexture { url "img/a.png" } AudioClip { url "s/b.wav" }' },
    { '/w/img/a.png': { bytes: 100, dims: { width: 64, height: 32 } }, '/w/s/b.wav': { bytes: 2048 } }
  ));
  assert.equal(g.references.length, 2);
  const tex = g.references.find((r) => r.kind === 'texture');
  assert.equal(tex.nodeType, 'ImageTexture');
  assert.equal(tex.field, 'url');
  assert.equal(tex.status, 'present');
  assert.equal(tex.bytes, 100);
  assert.deepEqual(tex.dimensions, { width: 64, height: 32 });
  assert.equal(tex.exactCase, true);
});

test('counts viewpoints and scripts, and sums approx bytes', () => {
  const g = buildAssetGraph('/w/main.wrl', world(
    { '/w/main.wrl': 'Viewpoint {} Viewpoint {} Script { url "vrmlscript: x()" } ImageTexture { url "t.png" }' },
    { '/w/t.png': { bytes: 500 } }
  ));
  assert.equal(g.stats.viewpoints, 2);
  assert.equal(g.stats.scripts, 1);
  assert.equal(g.stats.inlineScripts, 1);
  // approx bytes = primary wrl length + present texture bytes
  assert.equal(g.stats.approxTotalBytes, g.wrlNodes[0].bytes + 500);
});

test('flags absolute paths and root traversal as unsafe (not assets)', () => {
  const g = buildAssetGraph('/w/vrml/main.wrl', {
    ...world({ '/w/vrml/main.wrl': 'ImageTexture { url "/etc/hosts" } ImageTexture { url "../../out.png" }' }),
    projectRoot: path.resolve('/w/vrml'),
  });
  assert.equal(g.stats.unsafe, 2);
  assert.equal(g.stats.uniqueAssets, 0);
  const cats = g.unsafe.map((u) => u.category).sort();
  assert.deepEqual(cats, ['absolute-local', 'traversal']);
});

test('marks duplicate references', () => {
  const g = buildAssetGraph('/w/main.wrl', world(
    { '/w/main.wrl': 'ImageTexture { url "t.png" } ImageTexture { url "t.png" }' },
    { '/w/t.png': { bytes: 10 } }
  ));
  assert.equal(g.stats.uniqueTextures, 1);
  assert.equal(g.stats.totalRefs, 2);
  assert.equal(g.stats.duplicateRefs, 1);
});

test('reports a dependency cycle without infinite recursion', () => {
  const g = buildAssetGraph('/w/a.wrl', world({
    '/w/a.wrl': 'Inline { url "b.wrl" }',
    '/w/b.wrl': 'Inline { url "a.wrl" }',
  }));
  assert.equal(g.stats.wrlFiles, 2);
  assert.equal(g.stats.cycles, 1);
  assert.equal(g.cycles[0].to, path.resolve('/w/a.wrl'));
});

test('handles MORE THAN 20 unique textures with no truncation', () => {
  let body = '';
  for (let i = 0; i < 24; i++) body += `ImageTexture { url "img/t${i}.png" }\n`;
  const present = {};
  for (let i = 0; i < 24; i++) present[`/w/img/t${i}.png`] = { bytes: 10 + i };
  const g = buildAssetGraph('/w/main.wrl', world({ '/w/main.wrl': body }, present));
  assert.equal(g.stats.uniqueTextures, 24);
  assert.equal(g.stats.missing, 0);
  assert.equal(g.truncated, false);
  assert.equal(g.assets.filter((a) => a.kind === 'texture').length, 24);
});

test('handles at least 70 unique textures without dropping any', () => {
  let body = '';
  const present = {};
  for (let i = 0; i < 70; i++) { body += `ImageTexture { url "img/t${i}.png" }\n`; present[`/w/img/t${i}.png`] = { bytes: 1 }; }
  const g = buildAssetGraph('/w/main.wrl', world({ '/w/main.wrl': body }, present));
  assert.equal(g.stats.uniqueTextures, 70);
  assert.equal(g.references.filter((r) => r.status === 'present').length, 70);
  assert.equal(g.truncated, false);
});

test('unique-texture count is independent of authored-reference count', () => {
  let body = '';
  for (let i = 0; i < 30; i++) body += 'ImageTexture { url "img/shared.png" }\n'; // 30 refs, 1 file
  const g = buildAssetGraph('/w/main.wrl', world({ '/w/main.wrl': body }, { '/w/img/shared.png': { bytes: 5 } }));
  assert.equal(g.stats.uniqueTextures, 1);
  assert.equal(g.stats.totalRefs, 30);
});

test('an empty url string yields no reference at all (dropped by the lexer)', () => {
  const g = buildAssetGraph('/w/main.wrl', world({ '/w/main.wrl': 'ImageTexture { url "" }' }));
  assert.equal(g.stats.totalRefs, 0);
  assert.equal(g.stats.uniqueAssets, 0);
  assert.equal(g.stats.malformed, 0);
});
