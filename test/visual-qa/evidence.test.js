'use strict';
// Unit tests for qa/visual-qa/evidence.js's fixture-hashing and evidence-writing
// helpers -- no Electron, no spawn. These are the pieces Phase 7C4's Windows
// runbook relies on to prove no committed fixture was mutated by a QA run.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const evidence = require('../../qa/visual-qa/evidence');

function mkFixtureRoot(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-evidence-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

test('hashFixtures hashes every file under a root, keyed by posix-style relative path', () => {
  const root = mkFixtureRoot({ 'a.wrl': 'hello', 'nested/b.wrl': 'world' });
  const manifest = evidence.hashFixtures([root]);
  assert.deepEqual(Object.keys(manifest).sort(), ['a.wrl', 'nested/b.wrl']);
  assert.equal(manifest['a.wrl'], evidence.hashFile(path.join(root, 'a.wrl')));
});

test('hashFixtures silently skips a root that does not exist', () => {
  const manifest = evidence.hashFixtures([path.join(os.tmpdir(), 'wrlforge-does-not-exist-xyz')]);
  assert.deepEqual(manifest, {});
});

test('diffFixtureHashes reports only files whose hash changed, added, or removed', () => {
  const before = { 'a.wrl': 'h1', 'b.wrl': 'h2' };
  const after = { 'a.wrl': 'h1', 'b.wrl': 'h2-changed', 'c.wrl': 'h3' };
  const changed = evidence.diffFixtureHashes(before, after);
  const files = changed.map((c) => c.file).sort();
  assert.deepEqual(files, ['b.wrl', 'c.wrl']);
});

test('writeRunEvidence: GO verdict and no fixture-mutation warning when hashes are unchanged', () => {
  const root = mkFixtureRoot({ 'a.wrl': 'hello' });
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-evidence-out-'));
  const hashes = evidence.hashFixtures([root]);
  const { verdict, fixtureChanges } = evidence.writeRunEvidence(outDir, {
    title: 'test run',
    environment: { platform: 'win32' },
    results: { failed: false },
    fixtureHashesBefore: hashes,
    fixtureHashesAfter: hashes,
  });
  assert.equal(verdict, 'GO');
  assert.deepEqual(fixtureChanges, []);
  assert.ok(fs.existsSync(path.join(outDir, 'RESULTS.md')));
  assert.ok(fs.existsSync(path.join(outDir, 'results.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'environment.json')));
  const md = fs.readFileSync(path.join(outDir, 'RESULTS.md'), 'utf8');
  assert.match(md, /Verdict: GO/);
});

test('writeRunEvidence: NO-GO verdict when a committed fixture hash changed', () => {
  const root = mkFixtureRoot({ 'a.wrl': 'hello' });
  const before = evidence.hashFixtures([root]);
  fs.writeFileSync(path.join(root, 'a.wrl'), 'mutated!');
  const after = evidence.hashFixtures([root]);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-evidence-out-'));
  const { verdict, fixtureChanges } = evidence.writeRunEvidence(outDir, {
    title: 'test run',
    environment: { platform: 'win32' },
    results: { failed: false },
    fixtureHashesBefore: before,
    fixtureHashesAfter: after,
  });
  assert.equal(verdict, 'NO-GO');
  assert.equal(fixtureChanges.length, 1);
  assert.equal(fixtureChanges[0].file, 'a.wrl');
  const md = fs.readFileSync(path.join(outDir, 'RESULTS.md'), 'utf8');
  assert.match(md, /FIXTURE MUTATION DETECTED/);
});

test('writeRunEvidence: NO-GO verdict when results.failed is true, even with unchanged fixtures', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-evidence-out-'));
  const { verdict } = evidence.writeRunEvidence(outDir, {
    environment: { platform: 'win32' },
    results: { failed: true },
  });
  assert.equal(verdict, 'NO-GO');
});
