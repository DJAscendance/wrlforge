'use strict';
// Real-fixture + gzip + performance tests (Phase 7A). Confirms the parser runs on
// plain and gzip sources through the production loader, that real Mall and World
// samples parse without syntax errors, and that parse time scales sanely (no
// obvious quadratic blow-up) with a reported measurement.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('../../src/vrml');
const { readWrlSource } = require('../../src/preview/wrl-source');

const F = (p) => path.join(__dirname, '../fixtures', p);
const syntaxErrs = (r) => r.syntaxDiagnostics.filter((d) => d.severity === 'error');

test('minimal valid VRML97 parses with no errors', () => {
  const r = parse(readWrlSource(F('vrml/minimal.wrl')).text);
  assert.equal(syntaxErrs(r).length, 0);
  assert.equal(r.tree.statements[0].nodeType, 'WorldInfo');
});

test('real permission-safe Mall-shaped sample parses clean', () => {
  const r = parse(readWrlSource(F('vrml/mall-item.wrl')).text, { profile: 'mall' });
  assert.equal(syntaxErrs(r).length, 0, JSON.stringify(syntaxErrs(r)));
  assert.ok(r.defs.some((d) => d.name === 'Crate'));
});

test('real permission-safe World-shaped sample parses clean', () => {
  const r = parse(readWrlSource(F('vrml/world-sample.wrl')).text, { profile: 'world' });
  assert.equal(syntaxErrs(r).length, 0, JSON.stringify(syntaxErrs(r)));
  assert.ok(r.assetRefs.some((a) => a.value === 'img/floor.png'));
});

test('actual production Mall + World fixtures parse without syntax errors', () => {
  const files = [
    'valid-plain.wrl', 'preview/def-use.wrl', 'preview/real-smartcar-lite.wrl',
    'world/small/world.wrl', 'world/nested/world.wrl', 'world/mini/world.wrl',
  ];
  for (const f of files) {
    const r = parse(readWrlSource(F(f)).text);
    assert.equal(syntaxErrs(r).length, 0, `${f}: ${JSON.stringify(syntaxErrs(r))}`);
  }
});

test('gzip and plain sources parse to identical trees', () => {
  const gz = parse(readWrlSource(F('vrml/valid-gzip.wrl')).text);
  const plain = parse(readWrlSource(F('vrml/plain-twin.wrl')).text);
  assert.equal(JSON.stringify(gz.tree), JSON.stringify(plain.tree));
  assert.equal(syntaxErrs(gz).length, 0);
});

test('CRLF fixture parses with correct DEF/USE + asset ref', () => {
  const r = parse(readWrlSource(F('vrml/crlf.wrl')).text);
  assert.equal(syntaxErrs(r).length, 0);
  assert.ok(r.defs.some((d) => d.name === 'Panel'));
  assert.equal(r.uses[0].resolved, true);
  assert.ok(r.assetRefs.some((a) => a.value === 'panel.png'));
});

test('a large gzip World fixture parses under the node cap', () => {
  const r = parse(readWrlSource(F('world/valid70/world.wrl')).text, { profile: 'world' });
  assert.equal(syntaxErrs(r).length, 0);
  // 70+ unique textures should all surface as local refs.
  const local = r.assetRefs.filter((a) => a.kind === 'local');
  assert.ok(local.length >= 70, `expected >=70 local refs, got ${local.length}`);
});

test('performance: parse time is roughly linear in input size', () => {
  // Build progressively larger synthetic worlds; assert time grows sub-quadratically.
  const unit = 'Shape { appearance Appearance { texture ImageTexture { url "t.png" } } geometry Box { size 1 2 3 } }\n';
  const measure = (reps) => {
    const src = '#VRML V2.0 utf8\n' + unit.repeat(reps);
    const t0 = process.hrtime.bigint();
    const r = parse(src);
    const t1 = process.hrtime.bigint();
    return { ms: Number(t1 - t0) / 1e6, bytes: src.length, tokens: r.tokens.length, diags: r.diagnostics.length };
  };
  const small = measure(500);
  const big = measure(4000); // 8x the work
  // If parsing were quadratic, 8x input would be ~64x time. Allow generous slack
  // for GC/JIT noise but reject clear quadratic behavior.
  const ratio = big.ms / Math.max(small.ms, 0.05);
  assert.ok(ratio < 40, `parse time ratio ${ratio.toFixed(1)} suggests super-linear scaling`);
  assert.equal(big.diags, 0);
});
