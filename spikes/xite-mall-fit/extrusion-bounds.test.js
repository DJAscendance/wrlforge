'use strict';
// Pure unit tests for the VRML97 Extrusion bounding-box math. These run with
// no Electron and no X_ITE -- they exercise extrusionLocalBounds() directly on
// plain field arrays, so the expected bounds below are all derived by hand
// (see each case's comment) and independently cross-checked against X_ITE's
// own generated-mesh bounds in qa/phase-2b0-extrusion-loading (all EXACT).
//
// Parent-transform composition (translate/scale/rotate around an extrusion) is
// covered end-to-end through X_ITE in the fixture runs, not here -- this module
// is purely the LOCAL cross-section sweep.

const test = require('node:test');
const assert = require('node:assert/strict');
const { extrusionLocalBounds } = require('./extrusion-bounds');

const TOL = 1e-4;
function assertBounds(res, emin, emax) {
  assert.ok(res, 'expected a bounds result, got null');
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(res.min[i] - emin[i]) <= TOL, `min[${i}] ${res.min[i]} != ${emin[i]}`);
    assert.ok(Math.abs(res.max[i] - emax[i]) <= TOL, `max[${i}] ${res.max[i]} != ${emax[i]}`);
  }
}
// A closed 2x2 square cross-section (corners at +/-1 in the cross-section plane).
const SQUARE = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]];
// A wide/shallow rectangle: x half-extent 2, z half-extent 0.5.
const RECT = [[-2, -0.5], [2, -0.5], [2, 0.5], [-2, 0.5], [-2, -0.5]];

test('default extrusion (no scale/orientation): raw cross-section along the spine', () => {
  // 2x2 square, spine y=0..4 -> X:[-1,1] Y:[0,4] Z:[-1,1].
  const res = extrusionLocalBounds({ crossSection: SQUARE, spine: [[0, 0, 0], [0, 4, 0]], scale: [], orientation: [] });
  assertBounds(res, [-1, 0, -1], [1, 4, 1]);
  assert.equal(res.confidence, 'exact');
});

test('single uniform scale value is reused for every spine point', () => {
  // scale [2 2] grows +/-1 to +/-2. Spine y=0..3.
  const res = extrusionLocalBounds({ crossSection: SQUARE, spine: [[0, 0, 0], [0, 3, 0]], scale: [[2, 2]], orientation: [] });
  assertBounds(res, [-2, 0, -2], [2, 3, 2]);
});

test('per-spine scale: widest joint governs the width/depth', () => {
  // scale 1,1 / 2,2 / 1,1 across three joints -> widest is +/-2 at the middle.
  const res = extrusionLocalBounds({
    crossSection: SQUARE, spine: [[0, 0, 0], [0, 2, 0], [0, 4, 0]],
    scale: [[1, 1], [2, 2], [1, 1]], orientation: [],
  });
  assertBounds(res, [-2, 0, -2], [2, 4, 2]);
});

test('orientation about the spine rotates the cross-section in its own plane', () => {
  // RECT (2 x 0.5) rotated 45deg about Y -> square AABB of half-extent
  // (2+0.5)/sqrt(2) = 1.76777.
  const e = (2 + 0.5) / Math.SQRT2;
  const res = extrusionLocalBounds({ crossSection: RECT, spine: [[0, 0, 0], [0, 4, 0]], scale: [], orientation: [[0, 1, 0, Math.PI / 4]] });
  assertBounds(res, [-e, 0, -e], [e, 4, e]);
});

test('multiple orientation values: union spans the widest of each joint', () => {
  // RECT at 0deg (x=+/-2), 45deg (within), 90deg (z=+/-2) -> X:[-2,2] Z:[-2,2].
  const res = extrusionLocalBounds({
    crossSection: RECT, spine: [[0, 0, 0], [0, 2, 0], [0, 4, 0]],
    scale: [], orientation: [[0, 1, 0, 0], [0, 1, 0, Math.PI / 4], [0, 1, 0, Math.PI / 2]],
  });
  assertBounds(res, [-2, 0, -2], [2, 4, 2]);
});

test('combined scale and orientation compose in the correct order', () => {
  // RECT scaled x2 (to 4 x 1) then rotated 45deg -> half-extent (4+1)/sqrt2.
  const e = (4 + 1) / Math.SQRT2;
  const res = extrusionLocalBounds({ crossSection: RECT, spine: [[0, 0, 0], [0, 4, 0]], scale: [[2, 2]], orientation: [[0, 1, 0, Math.PI / 4]] });
  assertBounds(res, [-e, 0, -e], [e, 4, e]);
});

test('entirely negative spine coordinates are handled', () => {
  // 2x2 square, spine descending y=-1..-5 -> X:[-1,1] Y:[-5,-1] Z:[-1,1].
  const res = extrusionLocalBounds({ crossSection: SQUARE, spine: [[0, -1, 0], [0, -5, 0]], scale: [], orientation: [] });
  assertBounds(res, [-1, -5, -1], [1, -1, 1]);
});

test('realistic car-like rounded profile with taper (matches X_ITE mesh oracle)', () => {
  // Expected values captured from X_ITE's own generated-mesh bounds (see
  // qa/phase-2b0-extrusion-loading/oracle-raw.json): X:[-1.8,1.8] Y:[0,3] Z:[-0.7,0.7].
  const res = extrusionLocalBounds({
    crossSection: [[-1.8, -0.4], [-1.5, -0.7], [1.5, -0.7], [1.8, -0.4], [1.8, 0.4], [1.2, 0.7], [-1.2, 0.7], [-1.8, 0.4], [-1.8, -0.4]],
    spine: [[0, 0, 0], [0, 1.5, 0], [0, 3, 0]], scale: [[1, 1], [0.95, 0.95], [0.85, 0.85]], orientation: [],
  });
  assertBounds(res, [-1.8, 0, -0.7], [1.8, 3, 0.7]);
});

test('QA blocker fixture: scaled extrusion yields the TRUE 6x6 cross-section bounds', () => {
  // 2x2 cross-section, scale [3 3], spine y=-5..5 -> X:[-3,3] Y:[-5,5] Z:[-3,3].
  const res = extrusionLocalBounds({ crossSection: SQUARE, spine: [[0, -5, 0], [0, 5, 0]], scale: [[3, 3]], orientation: [] });
  assertBounds(res, [-3, -5, -3], [3, 5, 3]);
});

test('REGRESSION: the old scale-ignoring approximation underestimated; the fix does not', () => {
  // Reproduce the pre-Phase-2B0 algorithm inline: raw cross-section half-
  // diagonal, expanded on all axes, ignoring scale.
  const crossSection = SQUARE, spine = [[0, -5, 0], [0, 5, 0]], scale = [[3, 3]];
  let csRadius = 0;
  for (const p of crossSection) csRadius = Math.max(csRadius, Math.hypot(p[0], p[1]));
  const oldMaxX = spine.reduce((m, v) => Math.max(m, v[0] + csRadius), -Infinity); // = 1.4142
  assert.ok(oldMaxX < 1.5, `sanity: old algo underestimates (got ${oldMaxX})`);

  const res = extrusionLocalBounds({ crossSection, spine, scale, orientation: [] });
  // The corrected width/depth must reflect the 3x scale (true half-width 3),
  // which is strictly larger than the old 1.4142 underestimate.
  assert.ok(res.max[0] >= 3 - TOL, `corrected max X ${res.max[0]} must be >= 3`);
  assert.ok(res.min[0] <= -3 + TOL, `corrected min X ${res.min[0]} must be <= -3`);
  assert.ok(res.max[2] >= 3 - TOL, `corrected max Z ${res.max[2]} must be >= 3`);
  assert.ok(res.max[0] > oldMaxX + 1, 'corrected bounds must exceed the old underestimate');
});

test('field-length: fewer scale values than spine points reuses the last (no crash, non-shrinking)', () => {
  // 3 spine points but only 2 scale values -> last (2,2) reused for joint 3.
  const res = extrusionLocalBounds({
    crossSection: SQUARE, spine: [[0, 0, 0], [0, 2, 0], [0, 4, 0]],
    scale: [[1, 1], [2, 2]], orientation: [],
  });
  // widest is 2,2 (reused at the top joint) -> +/-2.
  assertBounds(res, [-2, 0, -2], [2, 4, 2]);
});

test('degenerate repeated spine point falls back to a conservative overestimate (never smaller)', () => {
  // First two spine points coincide -> that joint has no definable tangent.
  const res = extrusionLocalBounds({
    crossSection: SQUARE, spine: [[0, 0, 0], [0, 0, 0], [0, 3, 0]], scale: [], orientation: [],
  });
  assert.equal(res.confidence, 'conservative');
  assert.ok(res.warnings.length >= 1, 'expected a conservative-fallback warning');
  // The true side-wall reaches +/-1 in X/Z; the conservative ball must NOT be
  // smaller than that (it is larger: sqrt(2) ~ 1.414).
  assert.ok(res.max[0] >= 1 - TOL && res.min[0] <= -1 + TOL, 'must not underestimate width');
  assert.ok(res.max[2] >= 1 - TOL && res.min[2] <= -1 + TOL, 'must not underestimate depth');
});

test('zero and negative scale values do not crash and stay correctly bounded', () => {
  // scale [0 2]: cross-section collapses to a line in X but keeps +/-2 in Z.
  const zero = extrusionLocalBounds({ crossSection: SQUARE, spine: [[0, 0, 0], [0, 2, 0]], scale: [[0, 2]], orientation: [] });
  assertBounds(zero, [0, 0, -2], [0, 2, 2]);
  // scale [-2 -2]: mirrors the cross-section; magnitude bounds are still +/-2.
  const neg = extrusionLocalBounds({ crossSection: SQUARE, spine: [[0, 0, 0], [0, 2, 0]], scale: [[-2, -2]], orientation: [] });
  assertBounds(neg, [-2, 0, -2], [2, 2, 2]);
});

test('empty spine or cross-section returns null (no geometry)', () => {
  assert.equal(extrusionLocalBounds({ crossSection: SQUARE, spine: [], scale: [], orientation: [] }), null);
  assert.equal(extrusionLocalBounds({ crossSection: [], spine: [[0, 0, 0], [0, 1, 0]], scale: [], orientation: [] }), null);
});
