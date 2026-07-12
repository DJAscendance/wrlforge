'use strict';
// Runs inside the X_ITE-loaded page (browser globals: X3D). Computes a
// world-space bounding box by walking the PARSED SCENE GRAPH and composing
// real transform matrices -- no regex or string scraping of VRML source,
// satisfying the "no regex geometry bounds" requirement.
//
// DEF/USE: X_ITE resolves USE references to the *same node object* during
// parsing (confirmed via X3DScene.getNamedNode in x_ite.d.ts). This
// traversal walks the tree STRUCTURE (each occurrence in a children array),
// not a deduplicated set of unique node objects, so a USE'd shape's geometry
// is correctly counted once per occurrence, each with its own accumulated
// world matrix -- exactly the behavior a trustworthy bounds tool needs.
//
// Extrusion (Phase 2B0): the local cross-section sweep -- including per-spine
// `scale` and `orientation`, which the earlier approximation ignored (a
// dangerous width/depth underestimate) -- is delegated to the pure
// `extrusionLocalBounds` in extrusion-bounds.js. That module is loaded before
// this one (see index.html) and exposes `window.extrusionLocalBounds`.

function identityBox() {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

function unionPoint(box, p) {
  box.min[0] = Math.min(box.min[0], p[0]);
  box.min[1] = Math.min(box.min[1], p[1]);
  box.min[2] = Math.min(box.min[2], p[2]);
  box.max[0] = Math.max(box.max[0], p[0]);
  box.max[1] = Math.max(box.max[1], p[1]);
  box.max[2] = Math.max(box.max[2], p[2]);
}

function unionBox(a, b) {
  if (!isFiniteBox(b)) return;
  unionPoint(a, b.min);
  unionPoint(a, b.max);
}

function isFiniteBox(box) {
  return Number.isFinite(box.min[0]) && Number.isFinite(box.max[0]);
}

// Convert an X_ITE MF field (MFVec2f/MFVec3f/MFRotation) into a plain array of
// number tuples. Elements are indexable (v[0], v[1], ...) in X_ITE; SFRotation
// also exposes .x/.y/.z/.angle. `size` is how many components to read.
function mfToArrays(field, size) {
  const out = [];
  if (!field) return out;
  for (let i = 0; i < field.length; i++) {
    const v = field[i];
    const tuple = [];
    for (let k = 0; k < size; k++) tuple.push(v[k]);
    out.push(tuple);
  }
  return out;
}

// Local-space bbox for a geometry node, before any transform is applied.
// `diag` (optional) collects extrusion confidence/warnings for the report.
function localGeometryBox(geometry, diag) {
  if (!geometry) return identityBox();
  const type = geometry.getNodeTypeName();
  const box = identityBox();

  switch (type) {
    case 'IndexedFaceSet':
    case 'IndexedLineSet':
    case 'PointSet':
    case 'TriangleSet':
    case 'TriangleFanSet':
    case 'TriangleStripSet': {
      const coord = geometry.coord;
      if (coord && coord.getNodeTypeName() === 'Coordinate') {
        const point = coord.point;
        for (let i = 0; i < point.length; i++) {
          const v = point[i];
          unionPoint(box, [v[0], v[1], v[2]]);
        }
      }
      return box;
    }
    case 'Box': {
      const s = geometry.size;
      unionPoint(box, [-s[0] / 2, -s[1] / 2, -s[2] / 2]);
      unionPoint(box, [s[0] / 2, s[1] / 2, s[2] / 2]);
      return box;
    }
    case 'Sphere': {
      const r = geometry.radius;
      unionPoint(box, [-r, -r, -r]);
      unionPoint(box, [r, r, r]);
      return box;
    }
    case 'Cylinder': {
      const r = geometry.radius;
      const h = geometry.height;
      unionPoint(box, [-r, -h / 2, -r]);
      unionPoint(box, [r, h / 2, r]);
      return box;
    }
    case 'Cone': {
      const r = Math.max(geometry.bottomRadius, 0);
      const h = geometry.height;
      unionPoint(box, [-r, -h / 2, -r]);
      unionPoint(box, [r, h / 2, r]);
      return box;
    }
    case 'Extrusion': {
      // Exact VRML97 cross-section sweep (accounts for scale + orientation),
      // via the pure extrusion-bounds.js module. Falls back to a conservative
      // overestimate for any degenerate/ambiguous spine point -- never a
      // width/depth underestimate (the pre-Phase-2B0 bug).
      const fields = {
        crossSection: mfToArrays(geometry.crossSection, 2),
        spine: mfToArrays(geometry.spine, 3),
        scale: mfToArrays(geometry.scale, 2),
        orientation: mfToArrays(geometry.orientation, 4),
      };
      const result = window.extrusionLocalBounds(fields);
      if (!result) return identityBox();
      if (diag) {
        diag.extrusionConfidence = diag.extrusionConfidence === 'conservative'
          ? 'conservative'
          : result.confidence;
        for (const w of result.warnings) diag.warnings.push('Extrusion: ' + w);
      }
      unionPoint(box, result.min);
      unionPoint(box, result.max);
      return box;
    }
    default:
      return identityBox();
  }
}

function transformCorners(box, matrix) {
  if (!isFiniteBox(box)) return identityBox();
  const [minX, minY, minZ] = box.min;
  const [maxX, maxY, maxZ] = box.max;
  const corners = [
    [minX, minY, minZ], [maxX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ],
    [minX, minY, maxZ], [maxX, minY, maxZ], [minX, maxY, maxZ], [maxX, maxY, maxZ],
  ];
  const out = identityBox();
  for (const c of corners) {
    const p = matrix.multVecMatrix(new X3D.SFVec3f(c[0], c[1], c[2]));
    unionPoint(out, [p[0], p[1], p[2]]);
  }
  return out;
}

function localMatrixForTransform(node) {
  const m = new X3D.SFMatrix4f();
  m.setTransform(node.translation, node.rotation, node.scale, node.scaleOrientation, node.center);
  return m;
}

// children: MFNode of X3DChildNodeProxy; matrix: accumulated world SFMatrix4f
function traverse(children, matrix, worldBox, diag) {
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (!node) continue;
    const type = node.getNodeTypeName();

    if (type === 'Transform') {
      const local = localMatrixForTransform(node);
      // X_ITE uses row-vector convention (multVecMatrix treats the point as a
      // row vector, p' = p * M). To apply the local transform before the
      // accumulated parent transform (p' = p * local * parent), that's
      // "local multiplied by parent on the right" -- multRight, not multLeft.
      const world = local.multRight(matrix);
      traverse(node.children, world, worldBox, diag);
    } else if (type === 'Shape') {
      const localBox = localGeometryBox(node.geometry, diag);
      unionBox(worldBox, transformCorners(localBox, matrix));
    } else if (node.children) {
      // Other grouping nodes (Group, Collision, StaticGroup, Switch, ...):
      // no additional transform, just recurse with the same world matrix.
      traverse(node.children, matrix, worldBox, diag);
    }
  }
}

// scene: X3DScene (has .rootNodes). Returns { min:[x,y,z], max:[x,y,z],
//   confidence, warnings } or null if no bounded geometry was found.
// `confidence` is 'exact' unless a conservative overestimate was used for any
// ambiguous Extrusion spine point.
function computeSceneBBox(scene) {
  const worldBox = identityBox();
  const diag = { warnings: [], extrusionConfidence: null };
  const identity = new X3D.SFMatrix4f();
  traverse(scene.rootNodes, identity, worldBox, diag);
  if (!isFiniteBox(worldBox)) return null;
  return {
    min: worldBox.min,
    max: worldBox.max,
    confidence: diag.extrusionConfidence === 'conservative' ? 'conservative' : 'exact',
    warnings: diag.warnings,
  };
}

// Exposed for the page script; not a Node/CommonJS module since this file
// runs directly in the browser context alongside the x_ite script tag.
window.computeSceneBBox = computeSceneBBox;
