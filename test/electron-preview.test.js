'use strict';
// Drives the REAL production app (Electron + embedded X_ITE) against fixed
// fixtures via the WRL_FORGE_PREVIEW_FIXTURE hook in main.js, and asserts the
// authoritative transform-aware bounds / fit / security behavior end-to-end.
// This is where "the preview actually renders and computes correctly" is proven
// -- unit tests alone cannot claim that (no X_ITE in node:test).
//
// Requires a display (X11/Wayland). Skips (does not fail) when headless.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const repoRoot = path.join(__dirname, '..');
const FX = path.join(__dirname, 'fixtures', 'preview');
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

function runPreview(fixtureName) {
  const electronBinary = require('electron');
  const fixturePath = path.join(FX, fixtureName);
  return new Promise((resolve, reject) => {
    const child = spawn(electronBinary, ['.', '--no-sandbox'], {
      cwd: repoRoot,
      env: { ...process.env, WRL_FORGE_PREVIEW_FIXTURE: fixturePath },
    });
    let stdout = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`timeout on ${fixtureName}`)); }, 25_000);
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('exit', () => {
      clearTimeout(timer);
      const line = stdout.split('\n').find((l) => l.startsWith('WRL_FORGE_PREVIEW_RESULT '));
      if (!line) return reject(new Error(`no preview result for ${fixtureName}. stdout:\n${stdout}`));
      resolve(JSON.parse(line.slice('WRL_FORGE_PREVIEW_RESULT '.length)));
    });
  });
}

const hasDisplay = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
const close = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

test('production preview: DEF/USE counts both occurrences with their own transforms', { timeout: 30_000, skip: !hasDisplay && 'no display' }, async () => {
  const before = md5(path.join(FX, 'def-use.wrl'));
  const r = await runPreview('def-use.wrl');
  assert.equal(r.error, undefined, r.error);
  // DEF at origin (X:[-1,1]) + USE under translation 5 0 0 (X:[4,6]) -> union X:[-1,6].
  assert.ok(close(r.bbox.min[0], -1) && close(r.bbox.max[0], 6), `DEF/USE X span wrong: ${JSON.stringify(r.bbox)}`);
  assert.equal(r.bbox.confidence, 'exact');
  assert.equal(md5(path.join(FX, 'def-use.wrl')), before, 'fixture must be unmodified by preview');
});

test('production preview: corrected Extrusion bounds are exact and cap scale below 125%', { timeout: 30_000, skip: !hasDisplay && 'no display' }, async () => {
  const r = await runPreview('qa-extrusion-scale.wrl');
  assert.deepEqual(r.bbox.min.map((n) => Math.round(n)), [-3, -5, -3]);
  assert.deepEqual(r.bbox.max.map((n) => Math.round(n)), [3, 5, 3]);
  assert.equal(r.bbox.confidence, 'exact');
  // 10m tall -> max compliant scale 1.0, so the 125% request must NOT be applied.
  assert.ok(close(r.fit.maxCompliantScale, 1), `maxCompliant ${r.fit.maxCompliantScale}`);
  assert.ok(close(r.fit.proposedAppliedScale, 1), `proposed ${r.fit.proposedAppliedScale}`);
  assert.ok(r.fit.proposedAppliedScale < r.fit.requestedScale, 'requested 125% must be reduced');
});

test('production preview: gzip-compressed source loads and yields finite bounds', { timeout: 30_000, skip: !hasDisplay && 'no display' }, async () => {
  const r = await runPreview('gz-gzipped-twin.wrl');
  // Box { size 3 4 5 } -> [-1.5,-2,-2.5]..[1.5,2,2.5].
  assert.ok(close(r.bbox.min[0], -1.5) && close(r.bbox.max[1], 2) && close(r.bbox.max[2], 2.5),
    `gzip bounds wrong: ${JSON.stringify(r.bbox)}`);
  assert.equal(r.bbox.confidence, 'exact');
});

test('production preview: remote texture URL is blocked, flagged, bounds still computed', { timeout: 30_000, skip: !hasDisplay && 'no display' }, async () => {
  const r = await runPreview('remote-texture.wrl');
  assert.ok(r.remoteUrls.includes('http://example.com/texture.png'), 'remote url must be surfaced');
  assert.ok(r.textureWarnings.some((w) => /Failed to fetch|Couldn't load/i.test(w)), 'remote fetch must be refused');
  // The item still bounds correctly despite the blocked texture.
  assert.ok(close(r.bbox.max[0], 1) && close(r.bbox.min[0], -1), 'bounds must survive a blocked texture');
});

test('production preview: missing local texture warns without breaking bounds', { timeout: 30_000, skip: !hasDisplay && 'no display' }, async () => {
  const r = await runPreview('textured-missing.wrl');
  assert.ok(r.textureWarnings.some((w) => /nope\.png/i.test(w)), 'missing texture must warn by name');
  assert.ok(close(r.bbox.max[0], 1), 'bounds must survive a missing texture');
});
