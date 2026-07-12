'use strict';
// Pure Cybertown Mall Item fit calculation. No Electron, no X_ITE, no fs --
// takes an already transform-resolved world-space bounding box and produces
// a proposed non-destructive fit. Mirrors validator.js's purity convention.
//
// This module does not know or care how the bbox was obtained -- that's the
// spike's rendering-layer concern (see NOTES.md). Decoupling the two means
// this fit math is fully testable against synthetic bboxes even if the
// X_ITE bounding-box extraction turns out to need more work.

const DEFAULT_RULES = {
  groundY: -1.75,
  centerX: 0,
  maxZ: 1,
  maxDim: 10,
  requestedScalePct: 125,
};

// bbox: { min: [x, y, z], max: [x, y, z] } in mall (world) space, already
// reflecting any Transform translate/scale/rotate chain up to this object's root.
function computeFit(bbox, rules = {}) {
  const opts = { ...DEFAULT_RULES, ...rules };
  const [minX, minY, minZ] = bbox.min;
  const [maxX, maxY, maxZ] = bbox.max;

  const dims = [maxX - minX, maxY - minY, maxZ - minZ];
  const center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];

  const requestedScale = opts.requestedScalePct / 100;

  // How much can we scale the *current* geometry (about its own center) before
  // any dimension exceeds maxDim? A zero-size axis never constrains scale.
  const largestDim = Math.max(...dims.filter((d) => Number.isFinite(d) && d > 0), 0);
  const maxScaleForSize = largestDim > 0 ? opts.maxDim / largestDim : Infinity;

  // After scaling, the ground/Z placement is evaluated relative to the item's
  // own local extents around its center, since the proposed offset repositions
  // the *scaled* geometry to satisfy ground/center/Z-limit rules independently
  // of the size constraint -- scale and position are orthogonal here by design
  // (matches the task spec: report both a max-compliant scale for size, and
  // separately an offset that satisfies ground/center/Z placement).
  const proposedAppliedScale = Math.min(requestedScale, maxScaleForSize);

  // Offset needed so the *proposed-scale* geometry satisfies:
  //   min-Y rests at groundY, X is centered at centerX, max-Z <= opts.maxZ.
  const scaledMinY = minY * proposedAppliedScale;
  const scaledMaxZ = maxZ * proposedAppliedScale;
  const scaledCenterX = center[0] * proposedAppliedScale;

  const offset = {
    x: opts.centerX - scaledCenterX,
    y: opts.groundY - scaledMinY,
    z: Math.min(0, opts.maxZ - scaledMaxZ),
  };

  // A generous-but-not-sloppy epsilon: real bboxes derived from rendered
  // scene-graph transform matrices (see spikes/xite-mall-fit) carry ordinary
  // floating-point noise on the order of 1e-6 to 1e-7, which the tighter
  // 1e-9 tolerance used for the earlier synthetic-bbox unit tests would
  // wrongly flag as a placement violation.
  const EPS = 1e-4;
  const violations = [];
  if (dims.some((d) => d > opts.maxDim + EPS)) {
    violations.push(`dimensions ${dims.map((d) => d.toFixed(3)).join(' x ')} exceed max ${opts.maxDim}`);
  }
  if (Math.abs(minY - opts.groundY) > EPS) {
    violations.push(`min Y ${minY.toFixed(3)} is not at ground ${opts.groundY}`);
  }
  if (Math.abs(center[0] - opts.centerX) > EPS) {
    violations.push(`center X ${center[0].toFixed(3)} is not at ${opts.centerX}`);
  }
  if (maxZ > opts.maxZ + EPS) {
    violations.push(`max Z ${maxZ.toFixed(3)} exceeds limit ${opts.maxZ}`);
  }

  return {
    original: {
      min: bbox.min,
      max: bbox.max,
      dims,
      center,
    },
    requestedScale,
    maxCompliantScale: maxScaleForSize,
    proposedAppliedScale,
    offset,
    proposed: {
      min: [
        minX * proposedAppliedScale + offset.x,
        minY * proposedAppliedScale + offset.y,
        minZ * proposedAppliedScale + offset.z,
      ],
      max: [
        maxX * proposedAppliedScale + offset.x,
        maxY * proposedAppliedScale + offset.y,
        maxZ * proposedAppliedScale + offset.z,
      ],
      dims: dims.map((d) => d * proposedAppliedScale),
    },
    violations,
    rules: opts,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeFit, DEFAULT_RULES };
} else {
  window.computeFit = computeFit;
  window.DEFAULT_FIT_RULES = DEFAULT_RULES;
}
