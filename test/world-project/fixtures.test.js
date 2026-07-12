'use strict';
// End-to-end resolution against the committed World Project fixtures, using the
// REAL filesystem (default deps). Also proves the resolver never mutates a
// project: every fixture file is byte-identical before and after scanning.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { detectPrimaries, scanProject } = require('../../src/world-project/project-loader');
const { summarize } = require('../../src/world-project/project-stats');

const FX = path.resolve(__dirname, '../fixtures/world');

function hashTree(dir) {
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, hashTree(p));
    else out[p] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  }
  return out;
}

test('mini: detects the primary and resolves 25 unique textures + nested WRL', () => {
  const d = detectPrimaries(path.join(FX, 'mini'));
  assert.equal(d.primary, path.join(FX, 'mini', 'world.wrl'));
  const scan = scanProject({ root: path.join(FX, 'mini'), primary: d.primary });
  const s = summarize(scan);
  assert.equal(s.primarySource, 'plain');
  assert.equal(s.totalWrlFiles, 2);
  assert.equal(s.uniqueTextures, 25, 'more than 20 textures fully represented');
  assert.equal(s.missing, 0);
  assert.equal(s.caseMismatches, 0);
  assert.equal(s.viewpoints, 2);
  assert.equal(s.inlineScripts, 1);
  // A real texture's header dimensions were read.
  const tex = scan.graph.assets.find((a) => a.kind === 'texture' && a.dimensions);
  assert.ok(tex && tex.dimensions.width > 0 && tex.dimensions.height > 0);
});

test('gz: gzip primary AND gzip nested child both resolve', () => {
  const scan = scanProject({ root: path.join(FX, 'gz'), primary: path.join(FX, 'gz', 'world.wrl') });
  const s = summarize(scan);
  assert.equal(s.primarySource, 'gzip');
  assert.equal(s.totalWrlFiles, 2);
  assert.equal(s.uniqueTextures, 1); // floor.png shared by primary + child
  assert.equal(s.missing, 0);
});

test('broken: surfaces missing, case-mismatch, remote, unsafe, inline script', () => {
  const scan = scanProject({ root: path.join(FX, 'broken'), primary: path.join(FX, 'broken', 'world.wrl') });
  const s = summarize(scan);
  assert.equal(s.missing, 1);
  assert.equal(s.caseMismatches, 1);
  assert.equal(s.remoteReferences, 2);
  assert.equal(s.unsafePaths, 2);
  assert.equal(s.inlineScripts, 1);
  assert.equal(s.uniqueTextures, 1); // only present.png is a real present asset
  // Findings never present the texture count as an error.
  assert.ok(!s.findings.some((f) => f.code === 'texture-count' && f.severity === 'error'));
});

test('scanning mutates nothing (fixtures are byte-identical before/after)', () => {
  const before = hashTree(FX);
  for (const proj of ['mini', 'gz', 'broken']) {
    scanProject({ root: path.join(FX, proj), primary: detectPrimaries(path.join(FX, proj)).primary || path.join(FX, proj, 'world.wrl') });
  }
  const after = hashTree(FX);
  assert.deepEqual(after, before);
});
