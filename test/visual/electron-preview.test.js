'use strict';
// VISUAL integration test -- drives the REAL production app (Electron + embedded
// X_ITE) against fixed fixtures and asserts authoritative transform-aware bounds
// / fit / security behavior end-to-end. Excluded from `npm test`; runs only via
// `npm run test:visual` AND WRL_FORGE_ALLOW_VISUAL=1.
//
// Hardened after the 2026-07-12 launch-storm incident: instead of spawning one
// Electron process PER fixture (5 launches), it now drives ALL fixtures through
// ONE reused capture-server process, orchestrated by VisualQaRunner (concurrency
// 1, launch cap, cooldown, timeout, graceful teardown, leak check). The JSON job
// path is read-only (no .edit.wrl mutation), matching the previous harness.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { VisualQaRunner } = require('../../qa/visual-qa/runner');

const repoRoot = path.join(__dirname, '..', '..');
const FX = path.join(__dirname, '..', 'fixtures', 'preview');
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
const close = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

const allow = process.env.WRL_FORGE_ALLOW_VISUAL === '1';
const hasDisplay = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
const skip = !allow ? 'set WRL_FORGE_ALLOW_VISUAL=1 to run visual tests' : (!hasDisplay && 'no display');

// The five fixtures, each as a read-only JSON job with a stable id.
const FIXTURES = ['def-use.wrl', 'qa-extrusion-scale.wrl', 'gz-gzipped-twin.wrl', 'remote-texture.wrl', 'textured-missing.wrl'];

test('production preview across all fixtures in ONE reused Electron process', {
  timeout: 90_000,
  skip,
}, async (t) => {
  const before = md5(path.join(FX, 'def-use.wrl'));

  const realSpawn = () => spawn(require('electron'), ['.', '--no-sandbox'], {
    cwd: repoRoot,
    env: { ...process.env, WRL_FORGE_CAPTURE_SERVER: '1', WRL_FORGE_NO_EDITOR: '1' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const runner = new VisualQaRunner({
    spawn: realSpawn,
    maxLaunches: 2,
    retriesPerLaunch: 1,
    log: () => {},
  });

  const jobs = FIXTURES.map((f) => ({ id: f, fixture: path.join(FX, f), json: true }));
  const out = await runner.run(jobs);
  const byId = Object.fromEntries(out.map((r) => [r.id, r.debug]));

  // One process handled all five, and nothing leaked.
  assert.deepEqual(runner.survivors(), [], 'no Electron process may survive the run');
  assert.equal(runner.launchesUsed <= 2, true);

  await t.test('DEF/USE counts both occurrences with their own transforms', () => {
    const r = byId['def-use.wrl'];
    assert.equal(r.error, undefined, r.error);
    assert.ok(close(r.bbox.min[0], -1) && close(r.bbox.max[0], 6), `DEF/USE X span wrong: ${JSON.stringify(r.bbox)}`);
    assert.equal(r.bbox.confidence, 'exact');
    assert.equal(md5(path.join(FX, 'def-use.wrl')), before, 'fixture must be unmodified by preview');
  });

  await t.test('corrected Extrusion bounds are exact and cap scale below 125%', () => {
    const r = byId['qa-extrusion-scale.wrl'];
    assert.deepEqual(r.bbox.min.map((n) => Math.round(n)), [-3, -5, -3]);
    assert.deepEqual(r.bbox.max.map((n) => Math.round(n)), [3, 5, 3]);
    assert.equal(r.bbox.confidence, 'exact');
    assert.ok(close(r.fit.maxCompliantScale, 1), `maxCompliant ${r.fit.maxCompliantScale}`);
    assert.ok(close(r.fit.proposedAppliedScale, 1), `proposed ${r.fit.proposedAppliedScale}`);
    assert.ok(r.fit.proposedAppliedScale < r.fit.requestedScale, 'requested 125% must be reduced');
  });

  await t.test('gzip-compressed source loads and yields finite bounds', () => {
    const r = byId['gz-gzipped-twin.wrl'];
    assert.ok(close(r.bbox.min[0], -1.5) && close(r.bbox.max[1], 2) && close(r.bbox.max[2], 2.5),
      `gzip bounds wrong: ${JSON.stringify(r.bbox)}`);
    assert.equal(r.bbox.confidence, 'exact');
  });

  await t.test('remote texture URL is blocked, flagged, bounds still computed', () => {
    const r = byId['remote-texture.wrl'];
    assert.ok(r.remoteUrls.includes('http://example.com/texture.png'), 'remote url must be surfaced');
    assert.ok(r.textureWarnings.some((w) => /Failed to fetch|Couldn't load/i.test(w)), 'remote fetch must be refused');
    assert.ok(close(r.bbox.max[0], 1) && close(r.bbox.min[0], -1), 'bounds must survive a blocked texture');
  });

  await t.test('missing local texture warns without breaking bounds', () => {
    const r = byId['textured-missing.wrl'];
    assert.ok(r.textureWarnings.some((w) => /nope\.png/i.test(w)), 'missing texture must warn by name');
    assert.ok(close(r.bbox.max[0], 1), 'bounds must survive a missing texture');
  });
});
