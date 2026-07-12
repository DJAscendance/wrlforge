'use strict';
// The World Project profile must stay SEPARATE from Mall Item rules: none of the
// mall-only constraints may be applied, and the historical ~20-texture figure
// must never be presented as a current server rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFindings, CONFIDENCE, MALL_ONLY_RULES } = require('../../src/world-project/profile');

function graphWith(stats, extra = {}) {
  return { stats: { uniqueTextures: 0, missing: 0, caseMismatches: 0, unsafe: 0, cycles: 0, remoteRefs: 0, ...stats }, ...extra };
}

test('enumerates the Mall-only rules that must NOT apply to worlds', () => {
  for (const r of ['one-texture-limit', 'ground-y--1.75', 'center-x-0', 'max-z-+1', 'bounds-10x10x10', 'no-inline', 'gzip-80kb-cap']) {
    assert.ok(MALL_ONLY_RULES.includes(r), `${r} should be listed as mall-only`);
  }
});

test('a large texture count never produces an error and is tagged historical', () => {
  const findings = classifyFindings(graphWith({ uniqueTextures: 70 }));
  const tex = findings.find((f) => f.code === 'texture-count');
  assert.ok(tex);
  assert.equal(tex.severity, 'info');
  assert.equal(tex.confidence, CONFIDENCE.HISTORICAL);
  assert.ok(!findings.some((f) => f.severity === 'error'), 'a clean 70-texture world has no errors');
});

test('missing / case / unsafe are runtime-warning errors', () => {
  const findings = classifyFindings(graphWith({ missing: 2, caseMismatches: 1, unsafe: 3 }));
  for (const code of ['missing-assets', 'case-mismatch', 'unsafe-path']) {
    const f = findings.find((x) => x.code === code);
    assert.equal(f.severity, 'error');
    assert.equal(f.confidence, CONFIDENCE.RUNTIME_WARNING);
  }
});

test('remote references are surfaced with UNKNOWN confidence, not fetched', () => {
  const f = classifyFindings(graphWith({ remoteRefs: 1 })).find((x) => x.code === 'remote-reference');
  assert.equal(f.severity, 'warning');
  assert.equal(f.confidence, CONFIDENCE.UNKNOWN);
});

test('cycles are reported as a bounded-traversal warning', () => {
  const f = classifyFindings(graphWith({ cycles: 1 })).find((x) => x.code === 'dependency-cycle');
  assert.equal(f.severity, 'warning');
});
