'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeFit, DEFAULT_RULES } = require('../../src/preview/fit-math');

const EPS = 1e-6;
const close = (actual, expected, eps = EPS) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${actual} ~= ${expected}`);

// Every non-degenerate case should satisfy the three hard placement rules
// after the proposed fit is applied, regardless of the specific input.
function assertProposedCompliant(fit, rules = DEFAULT_RULES) {
  const [pMinX, pMinY] = fit.proposed.min;
  const [pMaxX, pMaxY, pMaxZ] = fit.proposed.max;
  close((pMinX + pMaxX) / 2, rules.centerX, 1e-6);
  close(pMinY, rules.groundY, 1e-6);
  assert.ok(pMaxZ <= rules.maxZ + 1e-6, `proposed max Z ${pMaxZ} exceeds limit ${rules.maxZ}`);
  fit.proposed.dims.forEach((d) => {
    assert.ok(d <= rules.maxDim + 1e-6, `proposed dim ${d} exceeds maxDim ${rules.maxDim}`);
  });
}

test('already-compliant item: no violations, default 125% scale still proposed', () => {
  const bbox = { min: [-0.5, -1.75, -1], max: [0.5, 0.25, 1] };
  const fit = computeFit(bbox);
  assert.deepEqual(fit.violations, []);
  close(fit.requestedScale, 1.25);
  close(fit.proposedAppliedScale, 1.25);
  assertProposedCompliant(fit);
});

test('off-center item is reported as a violation and recentered', () => {
  const bbox = { min: [3, -1.75, -1], max: [4, 0.25, 1] };
  const fit = computeFit(bbox);
  assert.ok(fit.violations.some((v) => v.includes('center X')));
  assertProposedCompliant(fit);
});

test('item floating above ground is reported as a violation and pulled down', () => {
  const bbox = { min: [-0.5, 5, -1], max: [0.5, 7, 1] };
  const fit = computeFit(bbox);
  assert.ok(fit.violations.some((v) => v.includes('min Y')));
  assert.ok(fit.offset.y < 0, 'expected a downward (negative) Y offset');
  assertProposedCompliant(fit);
});

test('item sunk below the target ground is reported as a violation and lifted up', () => {
  const bbox = { min: [-0.5, -10, -1], max: [0.5, -8, 1] };
  const fit = computeFit(bbox);
  assert.ok(fit.violations.some((v) => v.includes('min Y')));
  assert.ok(fit.offset.y > 0, 'expected an upward (positive) Y offset');
  assertProposedCompliant(fit);
});

test('item extending beyond Z = +1 is flagged and pulled back to the limit', () => {
  const bbox = { min: [-0.5, -1.75, -1], max: [0.5, 0.25, 5] };
  const fit = computeFit(bbox);
  assert.ok(fit.violations.some((v) => v.includes('max Z')));
  assertProposedCompliant(fit);
});

test('item larger than 10m caps proposedAppliedScale below the 125% request', () => {
  const bbox = { min: [-10, -1.75, -1], max: [10, 0.25, 1] }; // 20m wide
  const fit = computeFit(bbox);
  assert.ok(fit.violations.some((v) => v.includes('dimensions')));
  close(fit.maxCompliantScale, 10 / 20); // 0.5
  close(fit.proposedAppliedScale, 0.5);
  assert.ok(fit.proposedAppliedScale < fit.requestedScale);
  assertProposedCompliant(fit);
});

test('zero-size axis (flat plane) does not divide by zero and still produces a finite scale', () => {
  const bbox = { min: [-1, -1.75, 0], max: [1, 0.25, 0] }; // zero depth
  const fit = computeFit(bbox);
  assert.ok(Number.isFinite(fit.proposedAppliedScale));
  assertProposedCompliant(fit);
});

test('entirely negative coordinates are still centered and grounded correctly', () => {
  const bbox = { min: [-5, -5, -5], max: [-3, -3, -3] };
  const fit = computeFit(bbox);
  assertProposedCompliant(fit);
});

test('nested-transform-resolved bbox (arbitrary world-space offset) fits the same as a local one', () => {
  // Represents a bbox already produced by composing a chain of nested Transform
  // translate/scale nodes -- fit-math is agnostic to how it got here.
  const bbox = { min: [8, 3, -2], max: [12, 7, 2] };
  const fit = computeFit(bbox);
  close(fit.proposedAppliedScale, 1.25); // well within the 10m cap (dims are 4x4x4)
  assertProposedCompliant(fit);
});

test('rotated-geometry AABB (wider than the object\'s unrotated footprint) still fits safely', () => {
  // A rotated object's axis-aligned bounding box is typically larger than its
  // unrotated local bbox (e.g. a 1x1 square rotated 45 degrees has an AABB
  // width of ~1.41). fit-math only sees the final AABB, so this is exercised
  // the same way as any other bbox -- the rotation-awareness itself lives in
  // how X_ITE (or the traversal code) produces this bbox, not in fit-math.
  const bbox = { min: [-1.41, -1.75, -1.41], max: [1.41, 0.25, 1.41] };
  const fit = computeFit(bbox);
  assertProposedCompliant(fit);
});

test('custom rules override the Cybertown Mall Item defaults', () => {
  const bbox = { min: [0, 0, 0], max: [2, 2, 2] };
  const fit = computeFit(bbox, { groundY: 0, centerX: 5, maxZ: 100, maxDim: 100, requestedScalePct: 100 });
  assertProposedCompliant(fit, { groundY: 0, centerX: 5, maxZ: 100, maxDim: 100 });
});
