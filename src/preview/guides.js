'use strict';
// Pure VRML97-text generator for non-exported Cybertown Mall Item preview
// guides. Never written into the user's .wrl -- callers only ever load this
// text into a SEPARATE X_ITE scene layered with the item (see the renderer /
// the spike index.html), so there is no path by which guide geometry could
// reach a real file even by mistake.
//
// buildGuidesVrml(rules, opts?) returns a full VRML document. opts selects which
// guides to emit (all on by default, so the Phase 2A spike's
// `buildGuidesVrml(rules)` call is unchanged) and can add a wireframe box around
// the item's proposed world bounds:
//   opts = { ground, center, zlimit, cage, itemBox, itemBBox: {min:[x,y,z], max:[x,y,z]} }
function buildGuidesVrml(rules, opts = {}) {
  const show = {
    ground: true, center: true, zlimit: true, cage: true, itemBox: false,
    ...opts,
  };
  const { groundY, centerX, maxZ, maxDim } = rules;
  const half = maxDim / 2;
  const pieces = [];

  if (show.ground) {
    pieces.push(`# Ground plane at Y = groundY
Transform {
  translation ${centerX} ${groundY} 0
  children [
    Shape {
      appearance Appearance { material Material { diffuseColor 0.2 0.5 0.2 transparency 0.7 } }
      geometry IndexedFaceSet {
        coord Coordinate { point [ -${half} 0 -${half}, ${half} 0 -${half}, ${half} 0 ${half}, -${half} 0 ${half} ] }
        coordIndex [ 0 1 2 3 -1 ]
        solid FALSE
      }
    }
  ]
}`);
  }

  if (show.center) {
    pieces.push(`# Center axis line at X = centerX
Shape {
  appearance Appearance { material Material { emissiveColor 0.9 0.9 0.2 } }
  geometry IndexedLineSet {
    coord Coordinate { point [ ${centerX} ${groundY} -${half}, ${centerX} ${groundY + maxDim} -${half} ] }
    coordIndex [ 0 1 -1 ]
  }
}`);
  }

  if (show.zlimit) {
    pieces.push(`# Z = maxZ limit plane
Transform {
  translation ${centerX} ${groundY + half} ${maxZ}
  children [
    Shape {
      appearance Appearance { material Material { diffuseColor 0.7 0.2 0.2 transparency 0.8 } }
      geometry IndexedFaceSet {
        coord Coordinate { point [ -${half} -${half} 0, ${half} -${half} 0, ${half} ${half} 0, -${half} ${half} 0 ] }
        coordIndex [ 0 1 2 3 -1 ]
        solid FALSE
      }
    }
  ]
}`);
  }

  if (show.cage) {
    pieces.push(`# maxDim x maxDim x maxDim wireframe bounding cage, centered at (centerX, groundY + half, 0)
Transform {
  translation ${centerX} ${groundY + half} 0
  children [
    Shape {
      appearance Appearance { material Material { emissiveColor 0.4 0.7 0.9 } }
      geometry IndexedLineSet {
        coord Coordinate {
          point [
            -${half} -${half} -${half}, ${half} -${half} -${half}, ${half} ${half} -${half}, -${half} ${half} -${half},
            -${half} -${half} ${half}, ${half} -${half} ${half}, ${half} ${half} ${half}, -${half} ${half} ${half}
          ]
        }
        coordIndex [
          0 1 2 3 0 -1,
          4 5 6 7 4 -1,
          0 4 -1, 1 5 -1, 2 6 -1, 3 7 -1
        ]
      }
    }
  ]
}`);
  }

  if (show.itemBox && opts.itemBBox && opts.itemBBox.min && opts.itemBBox.max) {
    const [ax, ay, az] = opts.itemBBox.min;
    const [bx, by, bz] = opts.itemBBox.max;
    pieces.push(`# Item bounding box (proposed world bounds) -- white wireframe
Shape {
  appearance Appearance { material Material { emissiveColor 1 1 1 } }
  geometry IndexedLineSet {
    coord Coordinate {
      point [
        ${ax} ${ay} ${az}, ${bx} ${ay} ${az}, ${bx} ${by} ${az}, ${ax} ${by} ${az},
        ${ax} ${ay} ${bz}, ${bx} ${ay} ${bz}, ${bx} ${by} ${bz}, ${ax} ${by} ${bz}
      ]
    }
    coordIndex [
      0 1 2 3 0 -1,
      4 5 6 7 4 -1,
      0 4 -1, 1 5 -1, 2 6 -1, 3 7 -1
    ]
  }
}`);
  }

  return `#VRML V2.0 utf8
WorldInfo { title "WRL Forge preview guides (non-exported)" }

${pieces.join('\n\n')}
`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildGuidesVrml };
} else {
  window.buildGuidesVrml = buildGuidesVrml;
}
