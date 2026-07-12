'use strict';
// Integration regression: proves the corrected Extrusion bounds feed through
// fit-math to a genuinely safer compliance decision. The pre-Phase-2B0 bounds
// under-reported width/depth, which let an oversized extrusion pass the 10m
// Cybertown size rule at full 125% scale (a dangerous false-compliance). With
// the fix, the true size is measured, the size rule fires, and the compliant
// scale is capped below the request.

const test = require('node:test');
const assert = require('node:assert/strict');
const { extrusionLocalBounds } = require('./extrusion-bounds');
const { computeFit } = require('./fit-math');

// The pre-fix approximation: raw cross-section half-diagonal expanded on all
// axes, ignoring `scale` entirely. Reproduced here to compare against.
function oldApproxBounds(crossSection, spine) {
  let r = 0;
  for (const p of crossSection) r = Math.max(r, Math.hypot(p[0], p[1]));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of spine) {
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], v[a] - r); max[a] = Math.max(max[a], v[a] + r); }
  }
  return { min, max };
}

test('corrected extrusion bounds cap the compliant scale where the old bug falsely passed at 125%', () => {
  // 2x2 cross-section scaled [6 6] -> TRUE width/depth 12m (exceeds 10m limit)
  // on a short spine y=0..2.
  const crossSection = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]];
  const spine = [[0, 0, 0], [0, 2, 0]];
  const scale = [[6, 6]];

  const corrected = extrusionLocalBounds({ crossSection, spine, scale, orientation: [] });
  const fitNew = computeFit({ min: corrected.min, max: corrected.max });
  const fitOld = computeFit(oldApproxBounds(crossSection, spine));

  // Old bounds: no size violation, scale stays at the full 125% request.
  assert.ok(!fitOld.violations.some((v) => v.includes('dimensions')), 'old approximation should (wrongly) see no size violation');
  assert.equal(fitOld.proposedAppliedScale, 1.25);

  // Corrected bounds: size rule fires and the compliant scale is capped below
  // the request (10 / 12 = 0.8333...).
  assert.ok(fitNew.violations.some((v) => v.includes('dimensions')), 'corrected bounds must flag the 12m size violation');
  assert.ok(Math.abs(fitNew.maxCompliantScale - 10 / 12) < 1e-4, `expected maxCompliant ~0.8333, got ${fitNew.maxCompliantScale}`);
  assert.ok(fitNew.proposedAppliedScale < fitOld.proposedAppliedScale,
    `corrected applied scale ${fitNew.proposedAppliedScale} must be smaller than the old ${fitOld.proposedAppliedScale}`);
});
