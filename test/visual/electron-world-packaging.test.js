'use strict';
// VISUAL integration test for the World Project packaging audit + review bundle
// (Phase 5A). Drives the REAL production app (Electron capture server) against the
// committed world fixtures and asserts the end-to-end packaging behavior through
// the actual world:packageAudit / world:buildReviewBundle paths: a clean world is
// READY with correct totals, a broken world is BLOCKED, an unused-file world
// reports (but never packages) its strays, and an ACTUAL deterministic bundle is
// written ONLY to the OS temp dir. Excluded from `npm test`; runs only via
// `npm run test:visual` AND WRL_FORGE_ALLOW_VISUAL=1.
//
// Uses ONE reused capture-server process orchestrated by VisualQaRunner
// (concurrency 1, launch cap, cooldown, timeout, graceful teardown, leak check).
// Read-only against fixtures; the only write is the QA bundle into the temp dir.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { VisualQaRunner } = require('../../qa/visual-qa/runner');
const { readZip } = require('../../src/world-project/zip-writer');

const repoRoot = path.join(__dirname, '..', '..');
const FX = path.join(repoRoot, 'test', 'fixtures', 'world');

const allow = process.env.WRL_FORGE_ALLOW_VISUAL === '1';
const hasDisplay = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
const skip = !allow ? 'set WRL_FORGE_ALLOW_VISUAL=1 to run visual tests' : (!hasDisplay && 'no display');

const worldJob = (id, proj, primary, extra) => ({
  id,
  world: { root: path.join(FX, proj), primary: path.join(FX, proj, primary || 'world.wrl') },
  size: '1080x840',
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

test('world packaging across fixtures in ONE reused Electron process', {
  timeout: 120_000,
  skip,
}, async (t) => {
  const before = hashTree(FX);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-p5a-test-'));
  const bundleDest = path.join(tmp, 'nested-review-bundle.zip');

  const realSpawn = () => spawn(require('electron'), ['.', '--no-sandbox'], {
    cwd: repoRoot,
    env: { ...process.env, WRL_FORGE_CAPTURE_SERVER: '1', WRL_FORGE_NO_EDITOR: '1', WRL_FORGE_SETTLE_MS: '1400' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const runner = new VisualQaRunner({ spawn: realSpawn, maxLaunches: 2, retriesPerLaunch: 1, captureTimeoutMs: 45000, log: () => {} });

  const jobs = [
    worldJob('ready', 'nested', 'world.wrl', { packageAudit: true }),
    worldJob('seventy', 'valid70', 'world.wrl', { packageAudit: true }),
    worldJob('unused', 'unused', 'world.wrl', { packageAudit: true }),
    worldJob('blocked', 'broken', 'world.wrl', { packageAudit: true }),
    worldJob('build', 'nested', 'world.wrl', { buildBundle: bundleDest }),
  ];
  let out;
  try {
    out = await runner.run(jobs);
  } finally {
    // keep tmp until after assertions; cleaned at the end
  }
  const byId = Object.fromEntries(out.map((r) => [r.id, r]));

  assert.deepEqual(runner.survivors(), [], 'no Electron process may survive the run');
  assert.equal(runner.launchesUsed <= 2, true);

  await t.test('clean world audits READY with correct totals', () => {
    const a = byId['ready'].packageAudit;
    assert.equal(a.status, 'ready');
    assert.equal(a.totals.totalFiles, 6);
    assert.equal(a.totals.wrlCount, 3);
    assert.equal(a.totals.uniqueTextureCount, 3);
    assert.deepEqual(a.blocking, []);
  });

  await t.test('70-texture world packages all textures', () => {
    const a = byId['seventy'].packageAudit;
    assert.equal(a.status, 'ready');
    assert.equal(a.totals.uniqueTextureCount, 71);
  });

  await t.test('unused-file world is NEEDS-REVIEW and reports strays not packaged', () => {
    const a = byId['unused'].packageAudit;
    assert.equal(a.status, 'needs-review');
    assert.equal(a.unused, 3);
  });

  await t.test('broken world is BLOCKED with the expected blocking codes', () => {
    const a = byId['blocked'].packageAudit;
    assert.equal(a.status, 'blocked');
    for (const code of ['missing-assets', 'case-mismatch', 'unsafe-path', 'remote-reference']) {
      assert.ok(a.blocking.includes(code), `blocking includes ${code}`);
    }
  });

  await t.test('an actual deterministic bundle is written and matches its manifest', () => {
    const b = byId['build'].bundle;
    assert.ok(b && b.outPath === bundleDest, 'bundle written to the temp destination');
    assert.ok(fs.existsSync(bundleDest));
    const entries = readZip(fs.readFileSync(bundleDest));
    const manifest = JSON.parse(entries.find((e) => e.name === 'MANIFEST.json').data.toString('utf8'));
    assert.equal(manifest.label, 'WRL Forge World Project Bundle');
    for (const mf of manifest.files) {
      const entry = entries.find((e) => e.name === 'project/' + mf.path);
      assert.ok(entry, `bundle has project/${mf.path}`);
      assert.equal(crypto.createHash('sha256').update(entry.data).digest('hex'), mf.sha256);
    }
  });

  await t.test('no fixture file was mutated by the packaging lane', () => {
    assert.deepEqual(hashTree(FX), before);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
});
