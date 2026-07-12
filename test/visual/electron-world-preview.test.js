'use strict';
// VISUAL integration test for the World Project embedded preview (Phase 4B).
// Drives the REAL production app (Electron + embedded X_ITE + wrlworld:// scheme)
// against the committed world fixtures and asserts the end-to-end preview
// behavior: scenes render, nested-Inline viewpoints are discovered, gzip nested
// WRL loads, missing/case/remote/unsafe references are surfaced but never loaded,
// and >=70 textures work. Excluded from `npm test`; runs only via
// `npm run test:visual` AND WRL_FORGE_ALLOW_VISUAL=1.
//
// Uses ONE reused capture-server process orchestrated by VisualQaRunner
// (concurrency 1, launch cap, cooldown, timeout, graceful teardown, leak check).
// Read-only: it points the confined world scan at fixtures and never mutates one.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { VisualQaRunner } = require('../../qa/visual-qa/runner');

const repoRoot = path.join(__dirname, '..', '..');
const FX = path.join(repoRoot, 'test', 'fixtures', 'world');

const allow = process.env.WRL_FORGE_ALLOW_VISUAL === '1';
const hasDisplay = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
const skip = !allow ? 'set WRL_FORGE_ALLOW_VISUAL=1 to run visual tests' : (!hasDisplay && 'no display');

const worldJob = (id, proj, primary, extra) => ({
  id,
  world: { root: path.join(FX, proj), primary: path.join(FX, proj, primary || 'world.wrl') },
  preview: true,
  size: '1000x760',
  ...extra,
});

const hashTree = (dir) => {
  const out = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '_generate.js') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) Object.assign(out, hashTree(p));
    else out[p] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  }
  return out;
};

test('world preview across fixtures in ONE reused Electron process', {
  timeout: 120_000,
  skip,
}, async (t) => {
  const before = hashTree(FX);

  const realSpawn = () => spawn(require('electron'), ['.', '--no-sandbox'], {
    cwd: repoRoot,
    env: { ...process.env, WRL_FORGE_CAPTURE_SERVER: '1', WRL_FORGE_NO_EDITOR: '1', WRL_FORGE_SETTLE_MS: '1500' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const runner = new VisualQaRunner({ spawn: realSpawn, maxLaunches: 2, retriesPerLaunch: 1, captureTimeoutMs: 45000, log: () => {} });

  const jobs = [
    worldJob('nested', 'nested'),
    worldJob('gz', 'gz'),
    worldJob('seventy', 'valid70'),
    worldJob('broken', 'broken'),
  ];
  const out = await runner.run(jobs);
  const byId = Object.fromEntries(out.map((r) => [r.id, r.preview]));

  assert.deepEqual(runner.survivors(), [], 'no Electron process may survive the run');
  assert.equal(runner.launchesUsed <= 2, true);

  await t.test('nested Inline renders and discovers nested viewpoints', () => {
    const r = byId['nested'];
    assert.equal(r.haveValidScene, true);
    // "Panel" is authored INSIDE the nested Inline child -> proves per-file
    // resolution + EnableInlineViewpoints discovery.
    assert.deepEqual(r.viewpoints, ['Front', 'Top', 'Panel']);
    assert.equal(r.counts.presentAssets, 3);
  });

  await t.test('gzip primary + gzip nested Inline both render', () => {
    const r = byId['gz'];
    assert.equal(r.haveValidScene, true);
    assert.equal(r.wasGzipped, true);
    assert.equal(r.counts.wrlFiles, 2);
  });

  await t.test('at least 70 textures render with none missing', () => {
    const r = byId['seventy'];
    assert.equal(r.haveValidScene, true);
    assert.equal(r.counts.uniqueTextures, 71);
    assert.equal(r.counts.missing, 0);
    assert.deepEqual(r.missingAssets, []);
  });

  await t.test('missing/case/remote/unsafe surfaced, never loaded', () => {
    const r = byId['broken'];
    assert.equal(r.haveValidScene, true, 'scene still renders around bad refs');
    assert.ok(r.remoteUrls.includes('http://example.com/remote.png'));
    assert.ok(r.missingAssets.some((m) => /missing\.jpg$/.test(m)));
    const w = r.runtimeWarnings.join(' ');
    assert.match(w, /img\/missing\.jpg.*Not Found/, 'missing texture refused via scheme');
    assert.match(w, /Present\.PNG.*Not Found/, 'case-mismatch texture refused via scheme');
    assert.match(w, /etc\/hosts.*Not Found/, 'absolute path clamped + refused');
  });

  await t.test('no fixture file was mutated by the preview', () => {
    assert.deepEqual(hashTree(FX), before);
  });
});
