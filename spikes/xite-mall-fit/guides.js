'use strict';
// Pure VRML97-text generator for non-exported Cybertown Mall Item preview
// guides. Never written into the user's .wrl -- the spike only ever loads
// this text into a second, separate X_ITE scene layered over the fixture
// (see index.html), so there is no path by which guide geometry could reach
// a real file even by mistake.
function buildGuidesVrml(rules) {
  const { groundY, centerX, maxZ, maxDim } = rules;
  const half = maxDim / 2;

  return `#VRML V2.0 utf8
WorldInfo { title "WRL Forge preview guides (non-exported)" }

# Ground plane at Y = groundY
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
}

# Center axis line at X = centerX
Shape {
  appearance Appearance { material Material { emissiveColor 0.9 0.9 0.2 } }
  geometry IndexedLineSet {
    coord Coordinate { point [ ${centerX} ${groundY} -${half}, ${centerX} ${groundY + maxDim} -${half} ] }
    coordIndex [ 0 1 -1 ]
  }
}

# Z = maxZ limit plane
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
}

# maxDim x maxDim x maxDim wireframe bounding cage, centered at (centerX, groundY + half, 0)
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
}
`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildGuidesVrml };
} else {
  window.buildGuidesVrml = buildGuidesVrml;
}
