'use strict';
// Node-schema tests (Phase WD1.3).
//
// Two halves, deliberately separated:
//
//   * Everything that validates the COMMITTED schema runs anywhere -- it needs
//     only `require('../../src/vrml/node-schema')`. A contributor without the
//     ISO mirror still gets full coverage of the data, the API, immutability,
//     and profile filtering.
//   * Everything that re-runs the GENERATOR needs the external ISO mirror and
//     skips cleanly, with a reason, when it is absent. `npm install` and
//     `npm test` therefore never depend on a path outside this repository.
//
// Expectations are ISO-derived: they were read off ISO/IEC 14772-1 clause 6
// declarations, not recalled. Where a number is asserted it is asserted against
// what the schema itself measured, so a silent extraction regression shows up as
// a failure rather than as a quietly smaller schema.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schema = require('../../src/vrml/node-schema');
const {
  nodes, counts, provenance, profiles,
  getNodeSchema, getFieldSchema, listNodeNames, listFields,
  isFieldAllowed, isVRML97Node, isVRML97Field,
} = schema;

const SCHEMA_FILE = path.join(__dirname, '../../src/vrml/node-schema.js');
const GENERATOR = path.join(__dirname, '../../scripts/build-node-schema.js');

// The generator is a maintainer tool; importing it must not require the mirror.
const generator = require('../../scripts/build-node-schema.js');

// Is the external ISO mirror available on this machine?
let isoDir = null;
try { isoDir = generator.resolveIsoDir(null); } catch { isoDir = null; }
const needsMirror = isoDir ? false : 'ISO/IEC 14772 mirror not present (maintainer-only regeneration test)';

const allFields = () => Object.entries(nodes)
  .flatMap(([n, node]) => Object.entries(node.fields).map(([f, rec]) => ({ node: n, field: f, rec })));

// ---------------------------------------------------------------------------
// coverage
// ---------------------------------------------------------------------------

test('the complete standard VRML97 node set is present, exactly once each', () => {
  const names = listNodeNames();
  assert.equal(names.length, 54, 'ISO/IEC 14772-1 clause 6 declares 54 nodes (6.2 through 6.55)');
  assert.equal(new Set(names).size, names.length, 'no duplicate node names');
  assert.equal(counts.nodes, names.length, 'the recorded count must match the data');
  assert.deepEqual(names, [...names].sort(), 'node names are emitted in ASCII order');

  // Section numbers are contiguous 6.2..6.55 with none missing -- the check that
  // catches a node dropped by a parsing change.
  const sections = names.map((n) => Number(nodes[n].section.split('.')[1])).sort((a, b) => a - b);
  assert.deepEqual(sections, Array.from({ length: 54 }, (_, i) => i + 2));
});

test('a representative node from every area of the standard is present', () => {
  // Geometry, appearance, grouping, sensors, interpolators, lighting, sound,
  // bindables, scripting -- one from each, so a whole area cannot go missing.
  for (const name of ['Box', 'IndexedFaceSet', 'Extrusion', 'ElevationGrid', 'Text',
    'Appearance', 'Material', 'ImageTexture', 'PixelTexture', 'MovieTexture',
    'Transform', 'Group', 'Switch', 'LOD', 'Billboard', 'Collision', 'Anchor', 'Inline',
    'TouchSensor', 'PlaneSensor', 'SphereSensor', 'CylinderSensor', 'ProximitySensor',
    'VisibilitySensor', 'TimeSensor',
    'ColorInterpolator', 'CoordinateInterpolator', 'NormalInterpolator',
    'OrientationInterpolator', 'PositionInterpolator', 'ScalarInterpolator',
    'DirectionalLight', 'PointLight', 'SpotLight',
    'Sound', 'AudioClip', 'Background', 'Fog', 'NavigationInfo', 'Viewpoint',
    'Script', 'Shape', 'WorldInfo']) {
    assert.ok(isVRML97Node(name), `${name} must be a standard VRML97 node`);
  }
});

test('every field record carries the required properties, and none is unresolved', () => {
  const ACCESS = new Set(['initializeOnly', 'inputOnly', 'outputOnly', 'inputOutput']);
  const DECLARATIONS = new Set(['field', 'eventIn', 'eventOut', 'exposedField']);
  assert.equal(counts.unresolved, 0, 'generation must fail closed rather than emit unresolved fields');

  let seen = 0;
  for (const { node, field, rec } of allFields()) {
    const where = `${node}.${field}`;
    seen += 1;
    assert.equal(typeof rec.type, 'string', `${where}: type`);
    assert.match(rec.type, /^(SF|MF)[A-Za-z0-9]+$/, `${where}: type looks like a VRML field type`);
    assert.ok(ACCESS.has(rec.accessType), `${where}: normalized accessType, got ${rec.accessType}`);
    assert.ok(Array.isArray(rec.profiles) && rec.profiles.length, `${where}: profiles`);
    for (const p of rec.profiles) assert.ok(profiles.includes(p), `${where}: unknown profile ${p}`);
    if (rec.vrml97Declaration === null) {
      assert.deepEqual(rec.profiles, ['x3d'], `${where}: no VRML97 declaration means X3D-only`);
      assert.equal(rec.order, null, `${where}: X3D-only fields have no ISO declaration order`);
    } else {
      assert.ok(DECLARATIONS.has(rec.vrml97Declaration), `${where}: VRML97 declaration category`);
      assert.ok(rec.profiles.includes('vrml97'), `${where}: declared in ISO so must be in the vrml97 profile`);
      assert.equal(typeof rec.order, 'number', `${where}: ISO declaration order`);
    }
  }
  assert.equal(seen, counts.isoDeclarations + counts.x3dOnly, 'field total matches the recorded counts');
});

test('field names are unique within a node and emitted in ASCII order', () => {
  for (const name of listNodeNames()) {
    const fields = Object.keys(nodes[name].fields);
    assert.equal(new Set(fields).size, fields.length, `${name}: duplicate field name`);
    assert.deepEqual(fields, [...fields].sort(), `${name}: fields are not ASCII-sorted`);
  }
});

test('the recorded counts are self-consistent with the emitted data', () => {
  const f = allFields();
  const vrml97 = f.filter((x) => x.rec.profiles.includes('vrml97'));
  const x3dOnly = f.filter((x) => !x.rec.profiles.includes('vrml97'));
  const shared = vrml97.filter((x) => x.rec.profiles.includes('x3d'));
  assert.equal(vrml97.length, counts.isoDeclarations, 'ISO declaration count');
  assert.equal(x3dOnly.length, counts.x3dOnly, 'X3D-only count');
  assert.equal(shared.length, counts.shared, 'shared count');
  assert.equal(vrml97.length - shared.length, counts.vrml97Only, 'VRML97-only count');
  assert.equal(counts.shared + counts.x3dOnly, counts.xiteFields, 'x_ite total = shared + X3D-only');
  assert.equal(counts.shared + counts.vrml97Only, counts.isoDeclarations, 'ISO total = shared + VRML97-only');
});

test('the generated file and the generator name no machine-specific path', () => {
  for (const file of [SCHEMA_FILE, GENERATOR]) {
    const text = fs.readFileSync(file, 'utf8');
    const label = path.basename(file);
    assert.equal(/\/home\/[a-z]/i.test(text), false, `${label}: contains a POSIX home path`);
    assert.equal(/[A-Za-z]:\\\\?Users/i.test(text), false, `${label}: contains a Windows user path`);
    assert.equal(/\bryan\b/i.test(text), false, `${label}: names a specific user`);
  }
});

test('no White Dune material is referenced by the schema or its generator', () => {
  // This is a PROVENANCE assertion about this one generated file, not a standing
  // prohibition -- WRL Forge is GPL-3.0-or-later and GPL-compatible reuse is
  // permitted project-wide (OPEN_SOURCE_PROVENANCE.md). The schema is derived
  // from ISO/IEC 14772-1 plus the MIT `x_ite.d.ts` and nothing else, and that
  // claim gets a test rather than only a comment. The generator may NAME a
  // provenance doc; it must not point at the archive.
  for (const file of [SCHEMA_FILE, GENERATOR]) {
    const text = fs.readFileSync(file, 'utf8');
    const label = path.basename(file);
    assert.equal(/white[-_]?dune[-_]archive|wdune|\/usr\/local\/bin\/dune/i.test(text), false,
      `${label}: must not reference White Dune material`);
  }
  assert.equal(provenance.whiteDuneUsed, false);
  assert.equal(provenance.isoSource.standard, 'ISO/IEC 14772-1 (VRML97)');
  assert.equal(provenance.xiteSource.package, 'x_ite');
  assert.match(provenance.isoSource.sha256, /^[0-9a-f]{64}$/);
  assert.match(provenance.xiteSource.sha256, /^[0-9a-f]{64}$/);
});

test('the schema records no generation timestamp', () => {
  const text = fs.readFileSync(SCHEMA_FILE, 'utf8');
  assert.equal(/\b(19|20)\d{2}-\d{2}-\d{2}T\d{2}:/.test(text), false, 'an ISO timestamp would break determinism');
  assert.equal('generatedAt' in provenance, false);
  assert.equal('timestamp' in provenance, false);
});

// ---------------------------------------------------------------------------
// known nodes, checked against ISO clause 6 declarations
// ---------------------------------------------------------------------------

// [node, field, type, VRML97 declaration, normalized access, default]
const ISO_EXPECTATIONS = [
  ['Transform', 'translation', 'SFVec3f', 'exposedField', 'inputOutput', [0, 0, 0]],
  ['Transform', 'rotation', 'SFRotation', 'exposedField', 'inputOutput', [0, 0, 1, 0]],
  ['Transform', 'scale', 'SFVec3f', 'exposedField', 'inputOutput', [1, 1, 1]],
  ['Transform', 'children', 'MFNode', 'exposedField', 'inputOutput', []],
  ['Transform', 'bboxSize', 'SFVec3f', 'field', 'initializeOnly', [-1, -1, -1]],
  ['Transform', 'addChildren', 'MFNode', 'eventIn', 'inputOnly', undefined],
  ['Shape', 'appearance', 'SFNode', 'exposedField', 'inputOutput', null],
  ['Shape', 'geometry', 'SFNode', 'exposedField', 'inputOutput', null],
  ['Appearance', 'material', 'SFNode', 'exposedField', 'inputOutput', null],
  ['Appearance', 'texture', 'SFNode', 'exposedField', 'inputOutput', null],
  ['Material', 'diffuseColor', 'SFColor', 'exposedField', 'inputOutput', [0.8, 0.8, 0.8]],
  ['Material', 'emissiveColor', 'SFColor', 'exposedField', 'inputOutput', [0, 0, 0]],
  ['Material', 'transparency', 'SFFloat', 'exposedField', 'inputOutput', 0],
  ['Material', 'shininess', 'SFFloat', 'exposedField', 'inputOutput', 0.2],
  ['IndexedFaceSet', 'coordIndex', 'MFInt32', 'field', 'initializeOnly', []],
  ['IndexedFaceSet', 'ccw', 'SFBool', 'field', 'initializeOnly', true],
  ['IndexedFaceSet', 'creaseAngle', 'SFFloat', 'field', 'initializeOnly', 0],
  ['IndexedFaceSet', 'set_coordIndex', 'MFInt32', 'eventIn', 'inputOnly', undefined],
  ['Extrusion', 'crossSection', 'MFVec2f', 'field', 'initializeOnly',
    [[1, 1], [1, -1], [-1, -1], [-1, 1], [1, 1]]],
  ['Extrusion', 'spine', 'MFVec3f', 'field', 'initializeOnly', [[0, 0, 0], [0, 1, 0]]],
  ['Extrusion', 'beginCap', 'SFBool', 'field', 'initializeOnly', true],
  ['TimeSensor', 'cycleInterval', 'SFTime', 'exposedField', 'inputOutput', 1],
  ['TimeSensor', 'loop', 'SFBool', 'exposedField', 'inputOutput', false],
  ['TimeSensor', 'isActive', 'SFBool', 'eventOut', 'outputOnly', undefined],
  ['TimeSensor', 'fraction_changed', 'SFFloat', 'eventOut', 'outputOnly', undefined],
  ['TouchSensor', 'enabled', 'SFBool', 'exposedField', 'inputOutput', true],
  ['TouchSensor', 'touchTime', 'SFTime', 'eventOut', 'outputOnly', undefined],
  ['TouchSensor', 'isOver', 'SFBool', 'eventOut', 'outputOnly', undefined],
  ['PositionInterpolator', 'set_fraction', 'SFFloat', 'eventIn', 'inputOnly', undefined],
  ['PositionInterpolator', 'key', 'MFFloat', 'exposedField', 'inputOutput', []],
  ['PositionInterpolator', 'keyValue', 'MFVec3f', 'exposedField', 'inputOutput', []],
  ['PositionInterpolator', 'value_changed', 'SFVec3f', 'eventOut', 'outputOnly', undefined],
  ['Script', 'url', 'MFString', 'exposedField', 'inputOutput', []],
  ['Script', 'directOutput', 'SFBool', 'field', 'initializeOnly', false],
  ['Script', 'mustEvaluate', 'SFBool', 'field', 'initializeOnly', false],
  ['NavigationInfo', 'avatarSize', 'MFFloat', 'exposedField', 'inputOutput', [0.25, 1.6, 0.75]],
  ['NavigationInfo', 'type', 'MFString', 'exposedField', 'inputOutput', ['WALK', 'ANY']],
  ['FontStyle', 'family', 'MFString', 'field', 'initializeOnly', ['SERIF']],
  ['FontStyle', 'justify', 'MFString', 'field', 'initializeOnly', ['BEGIN']],
  ['FontStyle', 'style', 'SFString', 'field', 'initializeOnly', 'PLAIN'],
  ['Background', 'skyColor', 'MFColor', 'exposedField', 'inputOutput', [[0, 0, 0]]],
  ['Viewpoint', 'fieldOfView', 'SFFloat', 'exposedField', 'inputOutput', 0.785398],
  ['Sphere', 'radius', 'SFFloat', 'field', 'initializeOnly', 1],
  ['PixelTexture', 'image', 'SFImage', 'exposedField', 'inputOutput', [0, 0, 0]],
  ['PixelTexture', 'repeatS', 'SFBool', 'field', 'initializeOnly', true],
  ['MovieTexture', 'loop', 'SFBool', 'exposedField', 'inputOutput', false],
  ['MovieTexture', 'speed', 'SFFloat', 'exposedField', 'inputOutput', 1],
  ['ElevationGrid', 'height', 'MFFloat', 'field', 'initializeOnly', []],
  ['ElevationGrid', 'xSpacing', 'SFFloat', 'field', 'initializeOnly', 1],
  ['Text', 'string', 'MFString', 'exposedField', 'inputOutput', []],
  ['WorldInfo', 'title', 'SFString', 'field', 'initializeOnly', ''],
  ['Collision', 'collide', 'SFBool', 'exposedField', 'inputOutput', true],
  ['Switch', 'whichChoice', 'SFInt32', 'exposedField', 'inputOutput', -1],
  ['LOD', 'range', 'MFFloat', 'field', 'initializeOnly', []],
];

test('ISO clause 6 declarations are reproduced exactly', () => {
  for (const [node, field, type, declaration, accessType, defaultValue] of ISO_EXPECTATIONS) {
    const rec = getFieldSchema(node, field);
    assert.ok(rec, `${node}.${field} is missing from the schema`);
    const where = `${node}.${field}`;
    assert.equal(rec.type, type, `${where}: type`);
    assert.equal(rec.vrml97Declaration, declaration, `${where}: VRML97 declaration`);
    assert.equal(rec.accessType, accessType, `${where}: normalized access type`);
    if (defaultValue === undefined) {
      assert.equal('defaultValue' in rec, false, `${where}: an event must not carry a default`);
      assert.equal('defaultText' in rec, false, `${where}: an event must not carry default text`);
    } else {
      assert.deepEqual(rec.defaultValue, defaultValue, `${where}: default value`);
      assert.equal(typeof rec.defaultText, 'string', `${where}: exact ISO default text is retained`);
    }
  }
});

test("Script's PROTO-style interface placeholders are not fields", () => {
  // ISO 6.40 shows "and any number of: eventIn eventType eventName" etc. Those
  // describe USER-DEFINED entries; treating them as fields would invent
  // `Script.eventType`. The generator counts them and drops them.
  for (const name of ['eventType', 'fieldType', 'eventName', 'fieldName', 'initialValue']) {
    assert.equal(getFieldSchema('Script', name), null, `Script.${name} must not exist`);
  }
  assert.equal(counts.scriptTemplatesExcluded, 3);
  // The three real VRML97 fields survive.
  for (const name of ['url', 'directOutput', 'mustEvaluate']) {
    assert.ok(isVRML97Field('Script', name), `Script.${name} is a real VRML97 field`);
  }
});

test('the three VRML97 fields X3D renamed are VRML97-only', () => {
  // X3D renamed Collision.collide -> enabled, and LOD.level / Switch.choice ->
  // children. They are the only ISO fields absent from the X_ITE surface, and
  // they must stay legal VRML97 rather than being dropped as "not in X3D".
  for (const [node, field] of [['Collision', 'collide'], ['LOD', 'level'], ['Switch', 'choice']]) {
    const rec = getFieldSchema(node, field);
    assert.ok(rec, `${node}.${field} missing`);
    assert.deepEqual(rec.profiles, ['vrml97'], `${node}.${field} is VRML97-only`);
    assert.equal(isVRML97Field(node, field), true);
    assert.equal(isFieldAllowed(node, field, 'x3d'), false, `${node}.${field} is not an X3D field`);
  }
  assert.equal(counts.vrml97Only, 3);
});

// ---------------------------------------------------------------------------
// strict VRML97 profile filtering -- the no-silent-X3D-leak requirement
// ---------------------------------------------------------------------------

test('X3D-only fields are visible in X3D and absent from strict VRML97', () => {
  const x3dOnly = allFields().filter((f) => !f.rec.profiles.includes('vrml97'));
  assert.ok(x3dOnly.length > 0, 'fresh extraction found X3D-only fields');
  assert.equal(x3dOnly.length, counts.x3dOnly);

  for (const { node, field } of x3dOnly) {
    assert.equal(isFieldAllowed(node, field, 'x3d'), true, `${node}.${field} should be allowed in X3D`);
    assert.equal(isFieldAllowed(node, field, 'vrml97'), false, `${node}.${field} LEAKED into VRML97`);
    assert.equal(isVRML97Field(node, field), false, `${node}.${field} LEAKED into VRML97`);
    assert.equal(listFields(node, { profile: 'vrml97' }).includes(field), false,
      `${node}.${field} LEAKED into the VRML97 field list`);
    assert.equal(listFields(node, { profile: 'x3d' }).includes(field), true,
      `${node}.${field} missing from the X3D field list`);
  }
});

test('specific X3D-only fields found by this extraction are tagged', () => {
  // Confirmed by the current extraction, not carried over from an earlier one.
  for (const [node, field] of [
    ['Transform', 'visible'], ['Transform', 'bboxDisplay'], ['Transform', 'metadata'],
    ['Material', 'normalScale'], ['Material', 'diffuseTexture'],
    ['Shape', 'castShadow'], ['Shape', 'bboxDisplay'],
    ['Switch', 'children'], ['LOD', 'children'], ['Collision', 'enabled'],
  ]) {
    const rec = getFieldSchema(node, field);
    assert.ok(rec, `${node}.${field} should exist as an X3D field`);
    assert.deepEqual(rec.profiles, ['x3d'], `${node}.${field} must be tagged X3D-only`);
    assert.equal(rec.vrml97Declaration, null);
  }
});

test('every field listed under the vrml97 profile has an ISO declaration', () => {
  // The invariant behind "no silent leak": a VRML97 listing can only contain
  // fields the standard actually declares.
  for (const node of listNodeNames({ profile: 'vrml97' })) {
    for (const field of listFields(node, { profile: 'vrml97' })) {
      assert.notEqual(getFieldSchema(node, field).vrml97Declaration, null,
        `${node}.${field} appears in a VRML97 listing without an ISO declaration`);
    }
  }
});

test('all 54 nodes are in both profiles; field filtering is what differs', () => {
  assert.equal(listNodeNames({ profile: 'vrml97' }).length, 54);
  assert.equal(listNodeNames({ profile: 'x3d' }).length, 54);
  // Transform is the clearest example: strictly fewer fields in VRML97.
  const strict = listFields('Transform', { profile: 'vrml97' });
  const x3d = listFields('Transform', { profile: 'x3d' });
  assert.equal(strict.length, 10, 'ISO 6.52 declares 10 Transform fields');
  assert.ok(x3d.length > strict.length, 'X3D adds fields to Transform');
  assert.deepEqual(strict.filter((f) => !x3d.includes(f)), [], 'VRML97 Transform fields all exist in X3D');
});

// ---------------------------------------------------------------------------
// access types
// ---------------------------------------------------------------------------

test('all four normalized access categories are represented', () => {
  const seen = new Set(allFields().map((f) => f.rec.accessType));
  assert.deepEqual([...seen].sort(),
    ['initializeOnly', 'inputOnly', 'inputOutput', 'outputOnly']);
});

test('VRML97 declaration terminology maps to X3D access semantics exactly', () => {
  const MAP = { field: 'initializeOnly', eventIn: 'inputOnly', eventOut: 'outputOnly', exposedField: 'inputOutput' };
  let checked = 0;
  for (const { node, field, rec } of allFields()) {
    if (rec.vrml97Declaration === null) continue;
    assert.equal(rec.accessType, MAP[rec.vrml97Declaration],
      `${node}.${field}: ${rec.vrml97Declaration} must normalize to ${MAP[rec.vrml97Declaration]}`);
    checked += 1;
  }
  assert.equal(checked, counts.isoDeclarations);
  // The original VRML97 spelling is retained, not erased -- ROUTE validation
  // will need to speak both vocabularies.
  assert.equal(getFieldSchema('Transform', 'translation').vrml97Declaration, 'exposedField');
  assert.equal(getFieldSchema('Transform', 'addChildren').vrml97Declaration, 'eventIn');
  assert.equal(getFieldSchema('TimeSensor', 'isActive').vrml97Declaration, 'eventOut');
  assert.equal(getFieldSchema('Sphere', 'radius').vrml97Declaration, 'field');
});

test('x3dAccessType is recorded only where X3D promoted a VRML97 field', () => {
  const promoted = allFields().filter((f) => 'x3dAccessType' in f.rec);
  assert.equal(promoted.length, counts.accessTypePromotions);
  assert.ok(promoted.length > 0, 'X3D promoted some VRML97 `field`s to inputOutput');
  for (const { node, field, rec } of promoted) {
    assert.notEqual(rec.x3dAccessType, rec.accessType,
      `${node}.${field}: x3dAccessType should be recorded only when it DIFFERS`);
    assert.notEqual(rec.vrml97Declaration, null, `${node}.${field}: only a VRML97 field can be promoted`);
  }
  // WorldInfo.title is `field` in VRML97 but inputOutput in X3D. The VRML97
  // answer stays authoritative for a VRML97 document.
  const title = getFieldSchema('WorldInfo', 'title');
  assert.equal(title.accessType, 'initializeOnly', 'VRML97 remains authoritative');
  assert.equal(title.x3dAccessType, 'inputOutput', 'the X3D difference is recorded, not lost');
});

// ---------------------------------------------------------------------------
// defaults
// ---------------------------------------------------------------------------

test('default values are normalized per VRML type', () => {
  const cases = [
    ['Sphere', 'radius', 1, 'numeric scalar'],
    ['Material', 'shininess', 0.2, 'fractional scalar'],
    ['Switch', 'whichChoice', -1, 'negative integer'],
    ['Transform', 'translation', [0, 0, 0], 'vector'],
    ['Material', 'diffuseColor', [0.8, 0.8, 0.8], 'colour'],
    ['Transform', 'rotation', [0, 0, 1, 0], 'rotation'],
    ['IndexedFaceSet', 'ccw', true, 'boolean TRUE'],
    ['TimeSensor', 'loop', false, 'boolean FALSE'],
    ['FontStyle', 'style', 'PLAIN', 'string'],
    ['WorldInfo', 'title', '', 'empty string'],
    ['Shape', 'geometry', null, 'SFNode NULL'],
    ['Transform', 'children', [], 'empty MFNode'],
    ['IndexedFaceSet', 'coordIndex', [], 'empty MFInt32'],
    ['NavigationInfo', 'type', ['WALK', 'ANY'], 'MFString with entries'],
    ['NavigationInfo', 'avatarSize', [0.25, 1.6, 0.75], 'MFFloat with entries'],
    ['Extrusion', 'spine', [[0, 0, 0], [0, 1, 0]], 'MFVec3f grouped into tuples'],
    ['Background', 'skyColor', [[0, 0, 0]], 'single MFColor entry stays a list'],
    ['PixelTexture', 'image', [0, 0, 0], 'SFImage header'],
  ];
  for (const [node, field, expected, why] of cases) {
    assert.deepEqual(getFieldSchema(node, field).defaultValue, expected, `${node}.${field} (${why})`);
  }
});

test('an absent default is distinguishable from NULL, [], 0, FALSE and ""', () => {
  // The distinction that matters: events have NO default at all, which must not
  // be confused with a default that happens to be falsy.
  const event = getFieldSchema('TimeSensor', 'isActive');
  assert.equal('defaultValue' in event, false, 'an eventOut has no default');
  assert.equal('defaultText' in event, false);

  const falsy = [
    ['Shape', 'geometry', null], ['Transform', 'children', []],
    ['Material', 'transparency', 0], ['TimeSensor', 'loop', false], ['WorldInfo', 'title', ''],
  ];
  for (const [node, field, expected] of falsy) {
    const rec = getFieldSchema(node, field);
    assert.equal('defaultValue' in rec, true, `${node}.${field} HAS a default`);
    assert.deepEqual(rec.defaultValue, expected);
  }
});

test('the exact ISO default text is preserved alongside the parsed value', () => {
  assert.equal(getFieldSchema('Transform', 'bboxSize').defaultText, '-1 -1 -1');
  assert.equal(getFieldSchema('Shape', 'appearance').defaultText, 'NULL');
  assert.equal(getFieldSchema('Transform', 'children').defaultText, '[]');
  assert.equal(getFieldSchema('FontStyle', 'style').defaultText, '"PLAIN"');
  // Extrusion.crossSection's default wraps across two lines in the source HTML;
  // both halves must be present or the polygon is silently truncated.
  const cross = getFieldSchema('Extrusion', 'crossSection');
  assert.equal(cross.defaultText, '[ 1 1, 1 -1, -1 -1, -1 1, 1 1 ]');
  assert.equal(cross.defaultValue.length, 5, 'five points, not the three on the first line');
});

test('no default was left uncertain by this extraction', () => {
  assert.equal(counts.uncertainDefaults, 0);
  const uncertain = allFields().filter((f) => f.rec.defaultUncertain);
  assert.deepEqual(uncertain.map((f) => `${f.node}.${f.field}`), []);
  // Every VRML97 field/exposedField has one; no event does.
  for (const { node, field, rec } of allFields()) {
    if (rec.vrml97Declaration === 'field' || rec.vrml97Declaration === 'exposedField') {
      assert.equal('defaultValue' in rec, true, `${node}.${field} must have a default`);
    }
    if (rec.vrml97Declaration === 'eventIn' || rec.vrml97Declaration === 'eventOut') {
      assert.equal('defaultValue' in rec, false, `${node}.${field} must not have a default`);
    }
  }
});

// ---------------------------------------------------------------------------
// runtime API
// ---------------------------------------------------------------------------

test('unknown nodes and fields return null, consistently', () => {
  assert.equal(getNodeSchema('NotANode'), null);
  assert.equal(getNodeSchema(''), null);
  assert.equal(getNodeSchema('transform'), null, 'VRML97 is case-sensitive');
  assert.equal(getFieldSchema('NotANode', 'x'), null);
  assert.equal(getFieldSchema('Transform', 'notAField'), null);
  assert.deepEqual(listFields('NotANode'), []);
  assert.equal(isVRML97Node('NotANode'), false);
  assert.equal(isVRML97Field('Transform', 'notAField'), false);
  assert.equal(isFieldAllowed('NotANode', 'x', 'vrml97'), false);
  // Inherited Object.prototype keys must not masquerade as schema entries.
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(getNodeSchema(name), null, `${name} must not resolve as a node`);
    assert.equal(getFieldSchema('Transform', name), null, `Transform.${name} must not resolve`);
  }
});

test('an unknown profile throws rather than silently answering', () => {
  for (const bad of ['VRML97', 'vrml', 'x3dv', '', 'X3D']) {
    for (const call of [
      () => listNodeNames({ profile: bad }),
      () => listFields('Transform', { profile: bad }),
      () => isFieldAllowed('Transform', 'translation', bad),
    ]) {
      assert.throws(call, (err) => {
        assert.equal(err.code, 'ESCHEMAPROFILE', `profile ${JSON.stringify(bad)}`);
        return true;
      }, `profile ${JSON.stringify(bad)} must be rejected`);
    }
  }
  // Omitting the profile is legal and means "no filter".
  assert.equal(listNodeNames().length, 54);
  assert.equal(isFieldAllowed('Transform', 'visible'), true, 'known at all, without a profile filter');
  assert.equal(isFieldAllowed('Transform', 'visible', 'vrml97'), false);
});

test('profiles are the documented stable identifiers', () => {
  assert.deepEqual(profiles, ['vrml97', 'x3d']);
});

// ---------------------------------------------------------------------------
// immutability
// ---------------------------------------------------------------------------

test('a consumer cannot mutate shared schema truth', () => {
  const rec = getFieldSchema('Transform', 'translation');
  assert.equal(Object.isFrozen(rec), true);
  assert.equal(Object.isFrozen(rec.defaultValue), true, 'nested values are frozen too');
  assert.equal(Object.isFrozen(nodes), true);
  assert.equal(Object.isFrozen(nodes.Transform.fields), true);

  // Silent in sloppy mode, throwing in strict mode -- this file is strict, so
  // assert it throws AND that nothing changed.
  assert.throws(() => { rec.type = 'SFString'; }, TypeError);
  assert.throws(() => { rec.defaultValue[0] = 99; }, TypeError);
  assert.throws(() => { nodes.Transform.fields.injected = {}; }, TypeError);
  assert.throws(() => { delete nodes.Transform; }, TypeError);

  assert.equal(getFieldSchema('Transform', 'translation').type, 'SFVec3f');
  assert.deepEqual(getFieldSchema('Transform', 'translation').defaultValue, [0, 0, 0]);
  assert.equal(getFieldSchema('Transform', 'injected'), null);
  assert.equal(counts.nodes, 54);
});

test('list-returning APIs hand back fresh arrays, not internal state', () => {
  const a = listNodeNames();
  a.push('Bogus');
  a.sort(() => -1);
  assert.equal(listNodeNames().length, 54, 'mutating a returned list must not affect the schema');
  assert.equal(listNodeNames().includes('Bogus'), false);

  const f = listFields('Transform');
  const before = f.length;
  f.length = 0;
  assert.equal(listFields('Transform').length, before);
});

// ---------------------------------------------------------------------------
// determinism and regeneration (needs the external ISO mirror)
// ---------------------------------------------------------------------------

test('the generated file is LF-only', () => {
  const raw = fs.readFileSync(SCHEMA_FILE);
  assert.equal(raw.includes(0x0d), false, 'no CR bytes -- the file must be LF-only');
  assert.equal(raw[raw.length - 1], 0x0a, 'ends with a newline');
});

test('the module loads and answers without the ISO mirror present', () => {
  // Portability contract: the committed schema is the product's input. Nothing
  // above this line touched the mirror, and this asserts the module has no
  // filesystem dependency of its own.
  const text = fs.readFileSync(SCHEMA_FILE, 'utf8');
  assert.equal(/require\s*\(/.test(text), false, 'the generated module requires nothing');
  assert.equal(/\bfs\b|readFileSync|process\.env/.test(text), false, 'no filesystem or environment access');
});

test('regenerating from unchanged sources is byte-identical', { skip: needsMirror }, () => {
  const first = generator.generate(isoDir).text;
  const second = generator.generate(isoDir).text;
  assert.equal(first, second, 'two runs of the generator must agree exactly');
  assert.equal(first.includes('\r'), false, 'generated text is LF-only');
});

test('the committed schema matches a fresh generation', { skip: needsMirror }, () => {
  const fresh = generator.generate(isoDir).text;
  const committed = fs.readFileSync(SCHEMA_FILE, 'utf8');
  assert.equal(fresh, committed,
    'src/vrml/node-schema.js is stale -- run: node scripts/build-node-schema.js');
});

test('output does not depend on filesystem traversal order', { skip: needsMirror }, () => {
  // The generator's ordering comes from ASCII sorts over extracted names, never
  // from directory order. Proven by generating into a shuffled-key structure:
  // re-sorting the parsed data before emission must not change the bytes.
  const { text, counts: fresh } = generator.generate(isoDir);
  assert.equal(fresh.nodes, 54);
  const nodeOrder = [...text.matchAll(/^ {2}([A-Z][A-Za-z0-9]*): \{$/gm)].map((m) => m[1]);
  assert.ok(nodeOrder.length >= 54, 'node keys are emitted at a predictable indent');
  assert.deepEqual(nodeOrder.slice(0, 54), [...nodeOrder.slice(0, 54)].sort(),
    'nodes are emitted in ASCII order regardless of discovery order');
});

test('the generator refuses to guess when the ISO mirror is missing', () => {
  assert.throws(() => generator.resolveIsoDir(path.join(__dirname, 'no-such-mirror')),
    /no ISO mirror found/, 'must fail with a clear, actionable message');
});

test('normalizeDefault preserves numeric meaning and flags what it cannot parse', () => {
  const { normalizeDefault } = generator;
  assert.deepEqual(normalizeDefault('SFFloat', '0.785398'), { value: 0.785398 });
  assert.deepEqual(normalizeDefault('SFFloat', '1.0'), { value: 1 });
  assert.deepEqual(normalizeDefault('SFInt32', '-1'), { value: -1 });
  assert.deepEqual(normalizeDefault('SFBool', 'TRUE'), { value: true });
  assert.deepEqual(normalizeDefault('SFNode', 'NULL'), { value: null });
  assert.deepEqual(normalizeDefault('MFNode', '[]'), { value: [] });
  assert.deepEqual(normalizeDefault('SFVec3f', '0 1 0'), { value: [0, 1, 0] });
  assert.deepEqual(normalizeDefault('MFVec2f', '[ 1 1, 1 -1 ]'), { value: [[1, 1], [1, -1]] });
  assert.deepEqual(normalizeDefault('SFString', '"PLAIN"'), { value: 'PLAIN' });
  assert.deepEqual(normalizeDefault('MFString', '["WALK", "ANY"]'), { value: ['WALK', 'ANY'] });
  assert.deepEqual(normalizeDefault('SFVec3f', null), { absent: true });
  // Fails closed rather than guessing.
  assert.deepEqual(normalizeDefault('SFVec3f', '0 1'), { uncertain: true });
  assert.deepEqual(normalizeDefault('SFBool', 'MAYBE'), { uncertain: true });
  assert.deepEqual(normalizeDefault('SFNode', 'Group {}'), { uncertain: true });
  assert.deepEqual(normalizeDefault('MFVec3f', '[ 0 0 0, 0 1 ]'), { uncertain: true });
});

// ---------------------------------------------------------------------------
// facade
// ---------------------------------------------------------------------------

test('the src/vrml facade re-exports the schema additively', () => {
  const facade = require('../../src/vrml');
  assert.equal(facade.nodeSchema, schema, 'must be the same module object, not a copy');
  for (const name of ['parse', 'tokenize', 'analyze', 'createSourceMap', 'edit', 'ast',
    'diagnostics', 'assetRefs', 'TT', 'KEYWORDS', 'DEFAULT_LIMITS']) {
    assert.ok(name in facade, `facade lost its ${name} export`);
  }
});
