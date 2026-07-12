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
// Known limitation: Extrusion is approximated (spine bbox expanded by the
// cross-section's local extent) rather than exactly swept -- see NOTES.md.

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

// Local-space bbox for a geometry node, before any transform is applied.
function localGeometryBox(geometry) {
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
      // Approximation, not an exact sweep: union of the spine's bbox expanded
      // by the cross-section's local (X,Z) extent at every spine point. This
      // over-estimates in the general case (e.g. large scale/orientation at a
      // single spine point) but never under-estimates for axis-aligned,
      // unscaled extrusions -- flagged as lower-confidence in NOTES.md.
      const spine = geometry.spine;
      const crossSection = geometry.crossSection;
      let csRadius = 0;
      for (let i = 0; i < crossSection.length; i++) {
        const p = crossSection[i];
        csRadius = Math.max(csRadius, Math.hypot(p[0], p[1]));
      }
      for (let i = 0; i < spine.length; i++) {
        const v = spine[i];
        unionPoint(box, [v[0] - csRadius, v[1] - csRadius, v[2] - csRadius]);
        unionPoint(box, [v[0] + csRadius, v[1] + csRadius, v[2] + csRadius]);
      }
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
function traverse(children, matrix, worldBox) {
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
      traverse(node.children, world, worldBox);
    } else if (type === 'Shape') {
      const localBox = localGeometryBox(node.geometry);
      unionBox(worldBox, transformCorners(localBox, matrix));
    } else if (node.children) {
      // Other grouping nodes (Group, Collision, StaticGroup, Switch, ...):
      // no additional transform, just recurse with the same world matrix.
      traverse(node.children, matrix, worldBox);
    }
  }
}

// scene: X3DScene (has .rootNodes). Returns { min:[x,y,z], max:[x,y,z] } or
// null if no bounded geometry was found.
function computeSceneBBox(scene) {
  const worldBox = identityBox();
  const identity = new X3D.SFMatrix4f();
  traverse(scene.rootNodes, identity, worldBox);
  return isFiniteBox(worldBox) ? worldBox : null;
}

// Exposed for the page script; not a Node/CommonJS module since this file
// runs directly in the browser context alongside the x_ite script tag.
window.computeSceneBBox = computeSceneBBox;
