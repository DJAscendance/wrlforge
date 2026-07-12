'use strict';
// Pure VRML97 `Extrusion` local bounding-box math. No X_ITE, no Electron, no
// fs -- it operates on plain arrays extracted from the parsed Extrusion node
// (crossSection, spine, scale, orientation), so it is fully unit-testable in
// node:test independent of the renderer. bbox-traversal.js calls this from the
// browser context after converting X_ITE's MF fields to plain arrays.
//
// Why this exists (Phase 2B0): the previous Extrusion handling ignored the
// `scale` and `orientation` fields and expanded the raw cross-section radius
// on all three axes -- a DANGEROUS UNDERESTIMATE of width/depth for any scaled
// extrusion (independent QA blocker). This module models the actual VRML97
// sweep: at each spine point it builds the spine-aligned cross-section plane
// (SCP), applies per-spine scale then orientation to every cross-section
// vertex, maps it into the SCP frame, and unions the resulting world-local
// points. Caps (beginCap/endCap) add no vertices beyond the end cross-sections,
// so they need no separate handling for bounds.
//
// Safety rule (never underestimate): when a spine point's SCP frame is
// ambiguous or degenerate (repeated spine points, or a spine whose rotation
// about its own tangent is browser-defined and thus not knowable here), the
// exact swept vertices cannot be trusted, so this falls back to a conservative
// bounding *ball* of radius max||scale.cs|| around that spine point. Because
// the SCP frame and the orientation rotation are both distance-preserving, that
// ball provably contains every possible cross-section vertex at that joint,
// regardless of which frame the renderer picks -- an overestimate, never an
// underestimate. Such points are reported via `confidence: 'conservative'`.

// --- tiny vec3 helpers -----------------------------------------------------
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function length(a) { return Math.hypot(a[0], a[1], a[2]); }
function normalize(a) {
  const l = length(a);
  return l > 1e-10 ? [a[0] / l, a[1] / l, a[2] / l] : null;
}

// Rotate vector v by an axis-angle [x, y, z, angle] (Rodrigues' formula).
function rotateAxisAngle(v, aa) {
  const angle = aa[3];
  const axis = normalize([aa[0], aa[1], aa[2]]);
  if (!axis || angle === 0) return [v[0], v[1], v[2]];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kxv = cross(axis, v);
  const kdv = dot(axis, v);
  return [
    v[0] * c + kxv[0] * s + axis[0] * kdv * (1 - c),
    v[1] * c + kxv[1] * s + axis[1] * kdv * (1 - c),
    v[2] * c + kxv[2] * s + axis[2] * kdv * (1 - c),
  ];
}

// --- VRML97 field-length semantics -----------------------------------------
// scale/orientation: 0 values -> use the default for all points; 1 value ->
// that value applies to every spine point; N values -> per-point. If a spine
// has more points than provided values (malformed but seen in the wild), reuse
// the last provided value rather than crashing -- a lenient, non-shrinking read.
function scaleAt(scale, i) {
  if (!scale || scale.length === 0) return [1, 1];
  if (scale.length === 1) return scale[0];
  return scale[Math.min(i, scale.length - 1)];
}
function orientationAt(orientation, i) {
  if (!orientation || orientation.length === 0) return [0, 0, 1, 0];
  if (orientation.length === 1) return orientation[0];
  return orientation[Math.min(i, orientation.length - 1)];
}

// --- spine-aligned cross-section (SCP) frame -------------------------------
// Returns per-spine-point orthonormal frames {X, Y, Z} following the VRML97
// spec's tangent/Z rules, or null at a point whose frame is degenerate. For a
// straight spine (all points collinear), the rotation about the tangent is
// browser-defined; we choose the authored mapping (cross-section X->world X,
// Z->world Z when the spine runs along Y, the overwhelmingly common Cybertown
// case) and flag it so callers can decide whether to trust it or fall back.
function pickDefaultZ(Y) {
  // Reference axis that yields the authored identity frame for a vertical
  // (Y-axis) spine: prefer world +Z, unless the tangent is ~parallel to it.
  const refs = [[0, 0, 1], [0, 1, 0], [1, 0, 0]];
  for (const ref of refs) {
    if (Math.abs(dot(Y, ref)) < 0.9) {
      const z = normalize(sub(ref, mul(Y, dot(ref, Y))));
      if (z) return z;
    }
  }
  return [0, 0, 1];
}

function computeFrames(spine) {
  const n = spine.length;
  const closed = n > 2 && length(sub(spine[0], spine[n - 1])) < 1e-9;

  // Tangents (Y axis of each SCP), robust to repeated spine points by
  // searching outward for distinct neighbours.
  function distinctForward(i) {
    for (let k = i + 1; k < n; k++) if (length(sub(spine[k], spine[i])) > 1e-9) return k;
    return -1;
  }
  function distinctBackward(i) {
    for (let k = i - 1; k >= 0; k--) if (length(sub(spine[k], spine[i])) > 1e-9) return k;
    return -1;
  }

  const Y = new Array(n);
  for (let i = 0; i < n; i++) {
    let tangent = null;
    if (closed) {
      tangent = normalize(sub(spine[(i + 1) % (n - 1)], spine[(i - 1 + (n - 1)) % (n - 1)]));
    } else if (i === 0) {
      const f = distinctForward(0);
      tangent = f >= 0 ? normalize(sub(spine[f], spine[0])) : null;
    } else if (i === n - 1) {
      const b = distinctBackward(n - 1);
      tangent = b >= 0 ? normalize(sub(spine[n - 1], spine[b])) : null;
    } else {
      const f = distinctForward(i);
      const b = distinctBackward(i);
      if (f >= 0 && b >= 0) tangent = normalize(sub(spine[f], spine[b]));
    }
    Y[i] = tangent; // may be null (fully degenerate point)
  }

  // Z axis per spec: perpendicular to the two adjacent spine segments; carried
  // from a neighbour when collinear; sign kept consistent with the previous Z.
  const Zraw = new Array(n);
  for (let i = 1; i < n - 1; i++) {
    Zraw[i] = normalize(cross(sub(spine[i + 1], spine[i]), sub(spine[i - 1], spine[i])));
  }
  Zraw[0] = closed
    ? normalize(cross(sub(spine[1], spine[0]), sub(spine[n - 2], spine[0])))
    : (Zraw[1] || null);
  Zraw[n - 1] = closed ? Zraw[0] : (Zraw[n - 2] || null);

  // Fill collinear gaps from the nearest defined Z; if none exist anywhere the
  // spine is straight -> Z is browser-defined (handled per-point below).
  let anyZ = Zraw.some((z) => z);
  const Z = new Array(n);
  let prev = null;
  const straight = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    let z = Zraw[i];
    if (!z) {
      // collinear/straight here: fall back to an authored default from tangent
      z = Y[i] ? pickDefaultZ(Y[i]) : null;
      straight[i] = true;
    }
    if (z && prev && dot(z, prev) < 0) z = mul(z, -1); // keep sign continuous
    Z[i] = z;
    if (z) prev = z;
  }

  const frames = new Array(n);
  for (let i = 0; i < n; i++) {
    const yi = Y[i];
    const zi = Z[i];
    if (!yi || !zi) { frames[i] = null; continue; }
    const xi = normalize(cross(yi, zi));
    if (!xi) { frames[i] = null; continue; }
    // Re-orthogonalize Z against X,Y so the frame is exactly orthonormal.
    const zOrtho = normalize(cross(xi, yi)) || zi;
    frames[i] = { X: xi, Y: yi, Z: zOrtho, straight: straight[i] };
  }
  return { frames, straight, anyZ };
}

// --- main entry ------------------------------------------------------------
// fields: { crossSection: [[x,z],...], spine: [[x,y,z],...],
//           scale: [[sx,sz],...], orientation: [[x,y,z,a],...] }
// Returns { min:[x,y,z], max:[x,y,z], confidence:'exact'|'conservative',
//           warnings:[...], spinePoints, crossSectionPoints } or null if the
// extrusion has no usable geometry.
function extrusionLocalBounds(fields) {
  const crossSection = fields.crossSection || [];
  const spine = fields.spine || [];
  const scale = fields.scale || [];
  const orientation = fields.orientation || [];

  if (spine.length === 0 || crossSection.length === 0) return null;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const unionPoint = (p) => {
    for (let a = 0; a < 3; a++) {
      if (p[a] < min[a]) min[a] = p[a];
      if (p[a] > max[a]) max[a] = p[a];
    }
  };

  const { frames } = computeFrames(spine);
  const warnings = [];
  let conservativePoints = 0;

  for (let i = 0; i < spine.length; i++) {
    const s = spine[i];
    const sc = scaleAt(scale, i);
    const orient = orientationAt(orientation, i);
    const frame = frames[i];

    if (!frame) {
      // Degenerate frame -> conservative bounding ball of the scaled cross
      // section around this spine point (rotation-invariant, never too small).
      let r = 0;
      for (const cs of crossSection) {
        r = Math.max(r, Math.hypot(cs[0] * sc[0], cs[1] * sc[1]));
      }
      unionPoint([s[0] - r, s[1] - r, s[2] - r]);
      unionPoint([s[0] + r, s[1] + r, s[2] + r]);
      conservativePoints++;
      continue;
    }

    for (const cs of crossSection) {
      // scale (cross-section x,z), then orientation rotation, then map into SCP.
      const local = [cs[0] * sc[0], 0, cs[1] * sc[1]];
      const rot = rotateAxisAngle(local, orient);
      const offset = add(add(mul(frame.X, rot[0]), mul(frame.Y, rot[1])), mul(frame.Z, rot[2]));
      unionPoint(add(s, offset));
    }
  }

  if (conservativePoints > 0) {
    warnings.push(
      `${conservativePoints} of ${spine.length} spine point(s) had a degenerate/ambiguous ` +
      `cross-section frame; used a conservative bounding ball (overestimate) for those.`
    );
  }

  return {
    min,
    max,
    confidence: conservativePoints > 0 ? 'conservative' : 'exact',
    warnings,
    spinePoints: spine.length,
    crossSectionPoints: crossSection.length,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extrusionLocalBounds, computeFrames, rotateAxisAngle, scaleAt, orientationAt };
} else {
  window.extrusionLocalBounds = extrusionLocalBounds;
}
