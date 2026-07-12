'use strict';
// Explicit, code-based case-mismatch verification across filesystem semantics
// (Phase 6A). The asset graph must flag an authored filename-case mismatch on a
// case-INSENSITIVE filesystem (Windows/macOS) just as it does on a case-sensitive
// one (Linux) — it must NOT rely on the local fs to catch it. Here we inject a
// case-insensitive `exists` (Windows-like: `exists('Stone.PNG')` is true when the
// disk holds `stone.png`) alongside a case-PRESERVING directory listing, and
// assert the mismatch is still detected. This is the guarantee the lane requires:
// "Do not assume Linux case-sensitive behavior will reproduce naturally on Windows."

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAssetGraph } = require('../../src/world-project/asset-graph');

// A tiny virtual project. `real` = exact-case paths on "disk"; `dirs` = the
// case-preserved directory listings; `caseInsensitive` toggles exists() semantics.
function vfs({ real, dirs, worldText, caseInsensitive }) {
  const realSet = new Set(real);
  const exists = (p) => caseInsensitive
    ? [...realSet].some((d) => d.toLowerCase() === p.toLowerCase())
    : realSet.has(p);
  return {
    exists,
    listDir: (d) => dirs[d] || [],
    readSource: (p) => {
      if (p === '/proj/world.wrl') return { text: worldText };
      throw new Error('ENOENT ' + p);
    },
    statSize: () => 42,
    readHead: () => null,
    projectRoot: '/proj',
  };
}

const WORLD_MISMATCH = '#VRML V2.0 utf8\n' +
  'Shape { appearance Appearance { texture ImageTexture { url "img/Stone.PNG" } } geometry Box {} }\n';
const WORLD_EXACT = '#VRML V2.0 utf8\n' +
  'Shape { appearance Appearance { texture ImageTexture { url "img/stone.png" } } geometry Box {} }\n';

const DIRS = { '/proj': ['world.wrl', 'img'], '/proj/img': ['stone.png'] };
const REAL = ['/proj/world.wrl', '/proj/img/stone.png'];

test('case mismatch is detected on a CASE-INSENSITIVE fs (Windows-like), not masked', () => {
  const deps = vfs({ real: REAL, dirs: DIRS, worldText: WORLD_MISMATCH, caseInsensitive: true });
  // Sanity: the injected exists() really is case-insensitive (Windows behavior).
  assert.equal(deps.exists('/proj/img/Stone.PNG'), true, 'precondition: exists() is case-insensitive');

  const g = buildAssetGraph('/proj/world.wrl', deps);
  assert.equal(g.stats.caseMismatches, 1, 'authored Stone.PNG vs disk stone.png flagged even though exists() said true');
  assert.equal(g.stats.missing, 0);
  assert.equal(g.assets.filter((a) => a.present).length, 0, 'a case-mismatched file is NOT counted present');
  const c = g.caseMismatches[0];
  assert.match(c.referenced, /Stone\.PNG$/);
  assert.equal(require('path').basename(c.actual), 'stone.png');
});

test('same mismatch is detected on a CASE-SENSITIVE fs (Linux-like) — identical result', () => {
  const deps = vfs({ real: REAL, dirs: DIRS, worldText: WORLD_MISMATCH, caseInsensitive: false });
  const g = buildAssetGraph('/proj/world.wrl', deps);
  assert.equal(g.stats.caseMismatches, 1);
  assert.equal(g.stats.missing, 0);
});

test('an EXACT-case reference is present on both fs semantics', () => {
  for (const caseInsensitive of [true, false]) {
    const deps = vfs({ real: REAL, dirs: DIRS, worldText: WORLD_EXACT, caseInsensitive });
    const g = buildAssetGraph('/proj/world.wrl', deps);
    assert.equal(g.stats.caseMismatches, 0, `exact case, caseInsensitive=${caseInsensitive}`);
    assert.equal(g.assets.filter((a) => a.present).length, 1);
  }
});

test('a truly MISSING reference is missing on both fs semantics (not a false case-hit)', () => {
  const world = '#VRML V2.0 utf8\n' +
    'Shape { appearance Appearance { texture ImageTexture { url "img/ghost.png" } } geometry Box {} }\n';
  for (const caseInsensitive of [true, false]) {
    const deps = vfs({ real: REAL, dirs: DIRS, worldText: world, caseInsensitive });
    const g = buildAssetGraph('/proj/world.wrl', deps);
    assert.equal(g.stats.missing, 1, `missing, caseInsensitive=${caseInsensitive}`);
    assert.equal(g.stats.caseMismatches, 0);
  }
});
