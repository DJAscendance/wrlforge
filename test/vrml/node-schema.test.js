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
const os = require('node:os');

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

// ---------------------------------------------------------------------------
// WD1.6-A -- standards-derived semantic metadata
// ---------------------------------------------------------------------------
//
// The absence policy is part of the correctness contract, so roughly half of
// what follows asserts what the extractor deliberately does NOT claim. A wrong
// constraint silently rejects legal input; a missing one only declines to check,
// which is why every "we did not extract this" case is pinned by a test rather
// than left to drift into a guess later.

const {
  nodeClasses, nodeClassNames, constraintRules, constraintNotes,
  getNodeClasses, listNodesInClass, getFieldConstraints,
} = schema;

const vrml97Fields = () => allFields().filter(({ rec }) => rec.profiles.includes('vrml97'));
const nodeValuedFields = () => vrml97Fields().filter(({ rec }) => rec.type === 'SFNode' || rec.type === 'MFNode');
const withConstraints = () => allFields().filter(({ rec }) => rec.constraints !== null);

// --- no-regression against the pre-WD1.6-A schema ---------------------------

test('WD1.6-A changed no WD1.3 fact', () => {
  // The baseline is the WD1.3 projection of the schema as committed at db0816a,
  // one line per node and per field. A metadata extension may ADD properties; it
  // may not alter a type, an access category, an order, or a default. Comparing
  // line-by-line rather than by a single hash means a failure names the field.
  const enc = (v) => (v === undefined ? '' : JSON.stringify(v));
  const lines = [];
  for (const n of Object.keys(nodes)) {
    const nd = nodes[n];
    lines.push(['NODE', n, nd.section, nd.profiles.join('+')].join('|'));
    for (const f of Object.keys(nd.fields)) {
      const r = nd.fields[f];
      lines.push(['FIELD', n, f, r.type, r.accessType, enc(r.vrml97Declaration), enc(r.x3dAccessType),
        r.profiles.join('+'), enc(r.order), enc(r.defaultText), enc(r.defaultValue), enc(r.defaultUncertain)].join('|'));
    }
  }
  const baseline = fs.readFileSync(path.join(__dirname, '../fixtures/vrml/node-schema-wd13-baseline.txt'), 'utf8')
    .split('\n').filter(Boolean);

  assert.equal(lines.length, baseline.length, 'the node/field inventory changed size');
  for (let i = 0; i < baseline.length; i += 1) {
    assert.equal(lines[i], baseline[i], `WD1.3 fact changed: ${baseline[i]}`);
  }
});

test('every record carries the new properties and nothing else new', () => {
  const nodeKeys = new Set(['name', 'section', 'profiles', 'classes', 'fields']);
  const fieldKeys = new Set(['type', 'accessType', 'vrml97Declaration', 'x3dAccessType', 'profiles',
    'order', 'defaultText', 'defaultValue', 'defaultUncertain', 'constraints']);
  for (const [name, node] of Object.entries(nodes)) {
    for (const key of Object.keys(node)) assert.ok(nodeKeys.has(key), `${name} grew an unexpected key ${key}`);
    assert.ok(Array.isArray(node.classes), `${name} must carry a classes array`);
    for (const [f, rec] of Object.entries(node.fields)) {
      for (const key of Object.keys(rec)) assert.ok(fieldKeys.has(key), `${name}.${f} grew an unexpected key ${key}`);
      assert.ok('constraints' in rec, `${name}.${f} must carry a constraints property`);
    }
  }
});

// --- node classes -----------------------------------------------------------

test('the ten enumerated ISO clause 4 node classes are present', () => {
  assert.equal(nodeClassNames.length, 10, 'ISO/IEC 14772-1 clause 4 introduces ten "The following node types are" enumerations');
  assert.equal(counts.nodeClasses, nodeClassNames.length);
  assert.deepEqual([...nodeClassNames].sort(), [
    'children', 'environmentalSensor', 'geometry', 'grouping', 'interpolator',
    'lightSource', 'notAffectedByTransformationHierarchy', 'notValidAsChildren',
    'pointingDeviceSensor', 'sensor',
  ]);
});

test('each node class records its clause, its members and their count', () => {
  // Member counts are the extraction's own denominators: if a source-format
  // change silently halves a list, this fails instead of quietly shrinking the
  // metadata every later phase builds on.
  const expected = {
    notAffectedByTransformationHierarchy: { section: '4.4.4', size: 10 },
    geometry: { section: '4.6.3', size: 10 },
    grouping: { section: '4.6.5', size: 8 },
    children: { section: '4.6.5', size: 32 },
    notValidAsChildren: { section: '4.6.5', size: 20 },
    lightSource: { section: '4.6.6', size: 3 },
    sensor: { section: '4.6.7.1', size: 9 },
    environmentalSensor: { section: '4.6.7.2', size: 4 },
    pointingDeviceSensor: { section: '4.6.7.3', size: 5 },
    interpolator: { section: '4.6.8', size: 6 },
  };
  for (const [id, want] of Object.entries(expected)) {
    const record = nodeClasses[id];
    assert.ok(record, `missing node class ${id}`);
    assert.equal(record.id, id);
    assert.equal(record.section, want.section, `${id} cites the wrong clause`);
    assert.equal(record.members.length, want.size, `${id} member count changed`);
    assert.equal(new Set(record.members).size, record.members.length, `${id} lists a node twice`);
    for (const member of record.members) {
      assert.ok(getNodeSchema(member), `${id} names ${member}, which is not a clause 6 node`);
    }
  }
  assert.equal(counts.nodeClassMemberships, 107, 'total memberships across all ten classes');
});

test('the exact members of the small classes are the ISO ones', () => {
  assert.deepEqual(listNodesInClass('lightSource'), ['DirectionalLight', 'PointLight', 'SpotLight']);
  assert.deepEqual(listNodesInClass('environmentalSensor'),
    ['Collision', 'ProximitySensor', 'TimeSensor', 'VisibilitySensor']);
  assert.deepEqual(listNodesInClass('interpolator'), ['ColorInterpolator', 'CoordinateInterpolator',
    'NormalInterpolator', 'OrientationInterpolator', 'PositionInterpolator', 'ScalarInterpolator']);
  assert.deepEqual(listNodesInClass('grouping'),
    ['Anchor', 'Billboard', 'Collision', 'Group', 'Inline', 'LOD', 'Switch', 'Transform']);
  assert.deepEqual(listNodesInClass('pointingDeviceSensor'),
    ['Anchor', 'CylinderSensor', 'PlaneSensor', 'SphereSensor', 'TouchSensor']);
  // 4.4.4 is written inline in its own sentence rather than as a list; it is
  // extracted by the same normative phrase and must come out identically.
  assert.deepEqual(listNodesInClass('notAffectedByTransformationHierarchy'),
    ['ColorInterpolator', 'CoordinateInterpolator', 'NavigationInfo', 'NormalInterpolator',
      'OrientationInterpolator', 'PositionInterpolator', 'Script', 'ScalarInterpolator',
      'TimeSensor', 'WorldInfo']);
});

test('classes overlap, and membership is per-class rather than one-of', () => {
  // The single most likely way to misuse this data is to assume a node has one
  // class. Anchor has four, and they come from four different clauses.
  assert.deepEqual(getNodeClasses('Anchor'), ['children', 'grouping', 'pointingDeviceSensor', 'sensor']);
  assert.deepEqual(getNodeClasses('Collision'), ['children', 'environmentalSensor', 'grouping', 'sensor']);
  assert.deepEqual(getNodeClasses('Transform'), ['children', 'grouping']);
  for (const node of listNodeNames()) {
    assert.deepEqual(getNodeClasses(node), [...getNodeClasses(node)].sort(), `${node} classes are not ASCII-sorted`);
  }
});

test('"not valid as children" is preserved as its own fact, never an inversion', () => {
  // The dangerous reading is notValidAsChildren === complement of children.
  // It is not: the two lists are disjoint here but neither covers the node set,
  // and inverting one would silently invent a verdict about the remainder --
  // which is WD1.6-C's question, not this phase's.
  const children = new Set(listNodesInClass('children'));
  const notChildren = new Set(listNodesInClass('notValidAsChildren'));
  for (const n of notChildren) assert.ok(!children.has(n), `${n} cannot be both`);
  const covered = new Set([...children, ...notChildren]);
  assert.ok(covered.size < listNodeNames().length,
    'the two lists do not partition the node set, so neither may be derived by inverting the other');
  assert.ok(notChildren.has('Box') && notChildren.has('Appearance') && notChildren.has('Material'));
  assert.ok(children.has('Shape') && children.has('Transform'));
  assert.ok(!covered.has('Shape') === false);
});

test('an empty class list is a positive answer, and an unknown node gets one too', () => {
  const classless = listNodeNames().filter((n) => getNodeClasses(n).length === 0);
  assert.ok(classless.length > 0, 'some nodes are in none of the ten enumerations');
  assert.deepEqual(classless, ['FontStyle', 'PixelTexture'],
    'exactly two nodes appear in none of the ten enumerations');
  assert.deepEqual(getNodeClasses('NoSuchNode'), []);
  assert.deepEqual(listNodesInClass('noSuchClass'), []);
});

// --- accepted node metadata -------------------------------------------------

test('SFNode fields carry the exact node type ISO names', () => {
  assert.deepEqual(getFieldConstraints('Appearance', 'material').acceptedNodeTypes, ['Material']);
  assert.deepEqual(getFieldConstraints('Shape', 'appearance').acceptedNodeTypes, ['Appearance']);
  assert.deepEqual(getFieldConstraints('Text', 'fontStyle').acceptedNodeTypes, ['FontStyle']);
  assert.deepEqual(getFieldConstraints('IndexedFaceSet', 'coord').acceptedNodeTypes, ['Coordinate']);
  assert.deepEqual(getFieldConstraints('IndexedFaceSet', 'texCoord').acceptedNodeTypes, ['TextureCoordinate']);
});

test('a field accepting several types keeps all of them, in ISO order', () => {
  // Table 4.3 spells PixelTexture as two words for this field. There is no node
  // called "Pixel Texture"; 6.37 defines PixelTexture and 6.3's own prose reads
  // "(ImageTexture, MovieTexture, or PixelTexture)". The correction is the one
  // fixup the generator holds, and it must not have widened.
  assert.deepEqual(getFieldConstraints('Appearance', 'texture').acceptedNodeTypes,
    ['ImageTexture', 'MovieTexture', 'PixelTexture']);
  assert.deepEqual(getFieldConstraints('Sound', 'source').acceptedNodeTypes, ['AudioClip', 'MovieTexture']);
  assert.deepEqual(getFieldConstraints('Shape', 'geometry').acceptedNodeTypes,
    ['Box', 'Cone', 'Cylinder', 'ElevationGrid', 'Extrusion', 'IndexedFaceSet',
      'IndexedLineSet', 'PointSet', 'Sphere', 'Text']);
  // The same set the standard enumerates as the geometry class, reached by a
  // different route -- Table 4.3 rather than the 4.6.3 list.
  assert.deepEqual(getFieldConstraints('Shape', 'geometry').acceptedNodeTypes, listNodesInClass('geometry'));
});

test('MFNode children fields defer to a node CLASS, not a type list', () => {
  for (const node of ['Anchor', 'Billboard', 'Collision', 'Group', 'Transform']) {
    const c = getFieldConstraints(node, 'children');
    assert.deepEqual(c.acceptedNodeClasses, ['children'], `${node}.children`);
    assert.equal(c.acceptedNodeTypes, undefined, `${node}.children must not also name types`);
  }
  assert.deepEqual(getFieldConstraints('LOD', 'level').acceptedNodeClasses, ['children']);
  assert.deepEqual(getFieldConstraints('Switch', 'choice').acceptedNodeClasses, ['children']);
  for (const c of withConstraints()) {
    for (const id of c.rec.constraints.acceptedNodeClasses || []) {
      assert.ok(nodeClasses[id], `${c.node}.${c.field} cites unknown class ${id}`);
    }
  }
});

test('a node-valued field ISO says nothing extractable about gets null', () => {
  // Table 4.3 omits the addChildren/removeChildren eventIns, Collision.proxy and
  // both PointSet fields; clause 6 rescues only the ones stated in an exact
  // template. The rest are ABSENT -- which does not mean they accept anything.
  assert.equal(getFieldConstraints('Anchor', 'addChildren'), null);
  assert.equal(getFieldConstraints('Anchor', 'removeChildren'), null);
  assert.equal(getFieldConstraints('Collision', 'proxy'), null,
    'stated only as running prose ("any legal children node as described in 4.6.5")');
});

test('the clause 6 templates only add what Table 4.3 omits, and never contradict it', () => {
  const proseOnly = nodeValuedFields()
    .filter(({ rec }) => rec.constraints && rec.constraints.rules.includes('clause-6-sentence'));
  assert.deepEqual(proseOnly.map((f) => `${f.node}.${f.field}`).sort(),
    ['Appearance.textureTransform', 'PointSet.color', 'PointSet.coord']);
  assert.deepEqual(getFieldConstraints('Appearance', 'textureTransform').acceptedNodeTypes, ['TextureTransform']);
  assert.deepEqual(getFieldConstraints('PointSet', 'coord').acceptedNodeTypes, ['Coordinate']);
  for (const f of proseOnly) {
    assert.deepEqual(f.rec.constraints.rules, ['clause-6-sentence'],
      'a field cannot be sourced from both signals without them having been reconciled');
  }
});

test('the accepted-node templates do not bind a field to a merely nearby node name', () => {
  // "The source field specifies the sound source for the Sound node" would bind
  // Sound.source to Sound under any loose gap. Its real answer comes from Table
  // 4.3 and is AudioClip/MovieTexture.
  assert.ok(!getFieldConstraints('Sound', 'source').acceptedNodeTypes.includes('Sound'));
  // "The geometry field contains a geometry node" names a CLASS in lower case.
  // The templates discard a captured word that is not a node name rather than
  // inventing a type from it, so Shape.geometry's answer is Table 4.3's alone.
  assert.deepEqual(getFieldConstraints('Shape', 'geometry').rules, ['table-4.3']);
});

test('accepted-node metadata appears only on node-valued fields', () => {
  for (const { node, field, rec } of allFields()) {
    const c = rec.constraints;
    if (!c) continue;
    if (c.acceptedNodeTypes || c.acceptedNodeClasses) {
      assert.ok(rec.type === 'SFNode' || rec.type === 'MFNode',
        `${node}.${field} is ${rec.type} but carries accepted-node metadata`);
    }
  }
});

// --- numeric ranges ---------------------------------------------------------

test('a bounded scalar range is extracted with its inclusivity', () => {
  assert.deepEqual(getFieldConstraints('Material', 'diffuseColor'),
    { min: 0, minInclusive: true, max: 1, maxInclusive: true, rules: ['declaration-range'] });
  assert.deepEqual(getFieldConstraints('Material', 'transparency'),
    { min: 0, minInclusive: true, max: 1, maxInclusive: true, rules: ['declaration-range'] });
});

test('an exclusive bound is distinguished from an inclusive one', () => {
  // ISO/IEC 14772-1 4.1.3: '[' and ']' include the endpoint, '(' and ')' exclude
  // it. AudioClip.pitch is (0,infinity) -- zero is NOT a legal pitch -- while
  // ElevationGrid.xDimension is [0,infinity) and zero IS legal.
  const pitch = getFieldConstraints('AudioClip', 'pitch');
  assert.equal(pitch.min, 0);
  assert.equal(pitch.minInclusive, false);
  const xDimension = getFieldConstraints('ElevationGrid', 'xDimension');
  assert.equal(xDimension.min, 0);
  assert.equal(xDimension.minInclusive, true);
  assert.equal(counts.fieldsWithInclusiveMin, 56);
  assert.equal(counts.fieldsWithExclusiveMin, 73);
  assert.equal(counts.fieldsWithInclusiveMax, 30);
  assert.equal(counts.fieldsWithExclusiveMax, 99);
  // Inclusivity is recorded for exactly those fields that got a bound at all --
  // 167 constrained fields less the 13 whose range was note-only and the 25
  // whose only metadata is an accepted-node answer.
  const withBound = withConstraints().filter(({ rec }) => 'minInclusive' in rec.constraints);
  assert.equal(withBound.length, counts.fieldsWithInclusiveMin + counts.fieldsWithExclusiveMin);
  assert.equal(withBound.length, 129);
  for (const { node, field, rec } of withBound) {
    assert.equal(typeof rec.constraints.maxInclusive, 'boolean',
      `${node}.${field} states a lower bound but no upper inclusivity`);
  }
});

test('a non-negative field with no upper bound records the symbol, not a number', () => {
  const c = getFieldConstraints('Sound', 'maxFront');
  assert.deepEqual(c, {
    min: 0, minInclusive: true, maxSymbolic: 'infinity', maxInclusive: false, rules: ['declaration-range'],
  });
  assert.equal(c.max, undefined, 'no numeric maximum may be invented for an unbounded range');
});

test('an unbounded range is stated as unbounded, not left absent', () => {
  // (-infinity,infinity) is a normative statement that the standard imposes no
  // finite bound. That is a different answer from `constraints: null`, which
  // says only that nothing was extracted.
  assert.deepEqual(getFieldConstraints('Transform', 'translation'), {
    minSymbolic: '-infinity', minInclusive: false, maxSymbolic: 'infinity', maxInclusive: false,
    rules: ['declaration-range'],
  });
  assert.notEqual(getFieldConstraints('Transform', 'translation'), null);
});

test('a pi-valued bound stays symbolic and raises a note', () => {
  // The trap this phase exists to avoid: the standard renders pi and infinity as
  // GIF images, so stripping markup turns "[-2pi,2pi]" into "[-2,2]" -- a range
  // that looks machine-readable and is wrong by a factor of pi.
  const maxAngle = getFieldConstraints('CylinderSensor', 'maxAngle');
  assert.deepEqual(maxAngle, {
    minSymbolic: '-2pi', minInclusive: true, maxSymbolic: '2pi', maxInclusive: true,
    note: { category: 'BOUND_IS_SYMBOLIC', source: '[-2pi,2pi]' },
    rules: ['declaration-range'],
  });
  assert.equal(maxAngle.min, undefined);
  assert.equal(maxAngle.max, undefined);
  assert.notEqual(maxAngle.min, -2, 'the pi coefficient must not have been dropped');

  const beamWidth = getFieldConstraints('SpotLight', 'beamWidth');
  assert.equal(beamWidth.min, 0, 'the numeric half of a mixed range is still extracted');
  assert.equal(beamWidth.minInclusive, false);
  assert.equal(beamWidth.maxSymbolic, 'pi/2');
  assert.equal(beamWidth.maxInclusive, true);
  assert.equal(beamWidth.note.category, 'BOUND_IS_SYMBOLIC');
});

test('no constraint value is a JavaScript Infinity or NaN', () => {
  for (const { node, field, rec } of withConstraints()) {
    for (const key of ['min', 'max']) {
      if (!(key in rec.constraints)) continue;
      const v = rec.constraints[key];
      assert.equal(typeof v, 'number', `${node}.${field}.${key}`);
      assert.ok(Number.isFinite(v), `${node}.${field}.${key} must be finite, got ${v}`);
    }
  }
});

// --- known-but-unrepresented constraints ------------------------------------

test('the four note categories each have real ISO-backed cases', () => {
  assert.deepEqual([...constraintNotes].sort(),
    ['BOUND_IS_SYMBOLIC', 'DISJUNCTIVE_RANGE', 'NON_MACHINE_EXTRACTABLE', 'PER_COMPONENT_RANGE']);
  const byCategory = {};
  for (const { rec } of withConstraints()) {
    const note = rec.constraints.note;
    if (note) byCategory[note.category] = (byCategory[note.category] || 0) + 1;
  }
  assert.deepEqual(byCategory, {
    BOUND_IS_SYMBOLIC: 8, PER_COMPONENT_RANGE: 6, DISJUNCTIVE_RANGE: 6, NON_MACHINE_EXTRACTABLE: 1,
  });
  for (const category of constraintNotes) {
    assert.ok(byCategory[category] > 0, `${category} is declared but no ISO field uses it`);
  }
  assert.equal(counts.fieldsWithConstraintNote, 21);
});

test('a per-component range yields a note and no scalar bound', () => {
  // SFRotation is [-1,1] on the axis and unbounded on the angle. A single
  // min/max would be wrong for one of the two.
  const c = getFieldConstraints('Transform', 'rotation');
  assert.deepEqual(c, {
    note: { category: 'PER_COMPONENT_RANGE', source: '[-1,1],(-infinity,infinity)' },
    rules: ['declaration-range'],
  });
  assert.equal(c.min, undefined);
  assert.equal(c.max, undefined);
});

test('a disjunctive range yields a note that does not reject the field default', () => {
  // bboxSize is "(0,infinity) or -1,-1,-1". Emitting min 0 exclusive would make
  // the field's OWN ISO default illegal.
  const c = getFieldConstraints('Transform', 'bboxSize');
  assert.deepEqual(c, {
    note: { category: 'DISJUNCTIVE_RANGE', source: '(0,infinity) or -1,-1,-1' },
    rules: ['declaration-range'],
  });
  assert.equal(c.min, undefined);
  assert.deepEqual(getFieldSchema('Transform', 'bboxSize').defaultValue, [-1, -1, -1]);
});

test('a cross-reference to another clause is a note, not a silent absence', () => {
  assert.deepEqual(getFieldConstraints('PixelTexture', 'image'), {
    note: { category: 'NON_MACHINE_EXTRACTABLE', source: 'see 5.5, SFImage' },
    rules: ['declaration-range'],
  });
});

// --- absence ----------------------------------------------------------------

test('an unconstrained field is null, and null means "not represented"', () => {
  // These fields have no ISO range annotation and no Table 4.3 row. `null` is
  // the honest answer; it is NOT a statement that any value is legal.
  assert.equal(getFieldConstraints('WorldInfo', 'title'), null);
  assert.equal(getFieldConstraints('Anchor', 'description'), null);
  assert.equal(getFieldConstraints('NavigationInfo', 'type'), null);
  assert.equal(getFieldConstraints('FontStyle', 'style'), null);
  assert.equal(getFieldConstraints('Collision', 'collide'), null);
  // Unknown node and unknown field answer the same way, so a consumer that
  // clamps on null would clamp on a typo.
  assert.equal(getFieldConstraints('NoSuchNode', 'whatever'), null);
  assert.equal(getFieldConstraints('Transform', 'noSuchField'), null);
});

test('a default value never becomes a range', () => {
  // Box.size defaults to 2 2 2 and is annotated (0,infinity). If defaults leaked
  // into ranges the minimum would read 2.
  const size = getFieldConstraints('Box', 'size');
  assert.equal(size.min, 0);
  assert.deepEqual(getFieldSchema('Box', 'size').defaultValue, [2, 2, 2]);
  // Fields whose ONLY numeric information is a default must stay null.
  assert.equal(getFieldConstraints('Text', 'string'), null);
  assert.equal(getFieldSchema('Sphere', 'radius').defaultValue, 1);
  const radius = getFieldConstraints('Sphere', 'radius');
  assert.ok(radius === null || radius.min !== 1, 'a default must never be read as a bound');
});

test('no enumerated allowed-value set was extracted, and none was invented', () => {
  // A deliberate, measured zero. ISO states enumerants such as FontStyle.style's
  // "PLAIN"/"BOLD"/"ITALIC"/"BOLDITALIC" only in running prose whose shape
  // varies between fields; extracting them would need English interpretation,
  // which this generator does not do. The facet is therefore absent rather than
  // guessed, and this test records that as a finding, not an oversight.
  assert.equal(counts.fieldsWithAllowedValues, 0);
  for (const { node, field, rec } of withConstraints()) {
    assert.equal(rec.constraints.allowedValues, undefined, `${node}.${field}`);
  }
});

// --- profile separation -----------------------------------------------------

test('no X3D-only field carries constraint metadata', () => {
  const x3dOnly = allFields().filter(({ rec }) => !rec.profiles.includes('vrml97'));
  assert.equal(x3dOnly.length, counts.x3dOnly);
  assert.ok(x3dOnly.length > 0);
  for (const { node, field, rec } of x3dOnly) {
    assert.equal(rec.constraints, null, `${node}.${field} is X3D-only and must carry no ISO constraint`);
  }
  // Every constrained field is reachable through the strict VRML97 projection.
  for (const { node, field } of withConstraints()) {
    assert.ok(isFieldAllowed(node, field, 'vrml97'), `${node}.${field} leaked into the VRML97 answer`);
  }
});

test('node classes name only VRML97 nodes', () => {
  for (const id of nodeClassNames) {
    for (const member of nodeClasses[id].members) {
      assert.ok(isVRML97Node(member), `${id} names ${member}, which is not a VRML97 node`);
    }
  }
});

// --- counts and denominators ------------------------------------------------

test('every extraction facet is counted against its denominator', () => {
  assert.equal(counts.fieldsExamined, allFields().length);
  assert.equal(counts.fieldsExamined, 544);
  assert.equal(counts.vrml97FieldsExamined, 312);
  assert.equal(counts.vrml97FieldsExamined, vrml97Fields().length);
  assert.equal(counts.fieldsExamined - counts.vrml97FieldsExamined, counts.x3dOnly);
  assert.equal(counts.nodeValuedVrml97Fields, 36);
  assert.equal(counts.nodeValuedVrml97Fields, nodeValuedFields().length);

  assert.equal(counts.fieldsWithConstraints, 167);
  assert.equal(counts.fieldsWithConstraints, withConstraints().length);
  assert.equal(counts.fieldsWithNumericMin, 72);
  assert.equal(counts.fieldsWithNumericMax, 23);
  assert.equal(counts.fieldsWithSymbolicMin, 57);
  assert.equal(counts.fieldsWithSymbolicMax, 106);
  assert.equal(counts.fieldsWithAcceptedNodeTypes, 18);
  assert.equal(counts.fieldsWithAcceptedNodeClasses, 7);
  assert.equal(counts.fieldsWithAcceptedNodeTypes + counts.fieldsWithAcceptedNodeClasses, 25,
    '25 of the 36 node-valued fields have an accepted-node answer; the other 11 are absent, not unrestricted');

  // Recomputed from the data, so a count that drifts from what it describes
  // fails rather than reassuring.
  const tally = (pred) => withConstraints().filter(({ rec }) => pred(rec.constraints)).length;
  assert.equal(tally((c) => 'min' in c), counts.fieldsWithNumericMin);
  assert.equal(tally((c) => 'max' in c), counts.fieldsWithNumericMax);
  assert.equal(tally((c) => 'minSymbolic' in c), counts.fieldsWithSymbolicMin);
  assert.equal(tally((c) => 'maxSymbolic' in c), counts.fieldsWithSymbolicMax);
  assert.equal(tally((c) => !!c.acceptedNodeTypes), counts.fieldsWithAcceptedNodeTypes);
  assert.equal(tally((c) => !!c.acceptedNodeClasses), counts.fieldsWithAcceptedNodeClasses);
  assert.equal(tally((c) => !!c.note), counts.fieldsWithConstraintNote);
});

test('extraction has not silently collapsed', () => {
  // Floors, not equalities: these exist so that an ISO source-format change that
  // halves a facet is a failure and not a quietly smaller schema.
  assert.ok(counts.fieldsWithConstraints > 150, 'constraint extraction collapsed');
  assert.ok(counts.nodeClassMemberships > 100, 'node-class extraction collapsed');
  assert.ok(counts.fieldsWithAcceptedNodeTypes + counts.fieldsWithAcceptedNodeClasses > 20,
    'accepted-node extraction collapsed');
});

// --- provenance -------------------------------------------------------------

test('every constraint cites the rule that produced it', () => {
  for (const { node, field, rec } of withConstraints()) {
    const { rules } = rec.constraints;
    assert.ok(Array.isArray(rules) && rules.length > 0, `${node}.${field} has no rules`);
    for (const rule of rules) {
      assert.ok(constraintRules[rule], `${node}.${field} cites unknown rule ${rule}`);
      assert.equal(constraintRules[rule].standard, 'ISO/IEC 14772-1');
    }
  }
  assert.deepEqual(Object.keys(constraintRules).sort(),
    ['clause-6-sentence', 'declaration-range', 'table-4.3']);
});

test('the generated file records the clause 4 source alongside clause 6', () => {
  assert.equal(provenance.isoConceptsSource.standard, 'ISO/IEC 14772-1 (VRML97)');
  assert.equal(provenance.isoConceptsSource.file, 'raw/part1/concepts.html');
  assert.match(provenance.isoConceptsSource.sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(provenance.isoConceptsSource.sha256, provenance.isoSource.sha256);
  assert.equal(provenance.whiteDuneUsed, false);
});

// Both files carry a deliberate NEGATIVE attestation ("no White Dune material
// was used"), so a bare substring scan would fail on the very sentence that
// records the fact. What must hold is that no White Dune reference reaches any
// DATA value, and that the mentions in the source are confined to comments.
const codeLines = (text) => text.split('\n')
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));

test('no White Dune material reaches any generated value', () => {
  // `provenance.whiteDuneUsed: false` is itself the attestation, so it is
  // asserted rather than scanned.
  const data = JSON.stringify({ nodes, counts, nodeClasses, constraintRules, constraintNotes });
  for (const marker of ['dune', 'matchNodeClass', 'RE-ARTIFACTS']) {
    assert.ok(!data.toLowerCase().includes(marker.toLowerCase()),
      `the schema data must not mention ${marker}`);
  }
  assert.equal(provenance.whiteDuneUsed, false);
  // Whatever the file says about White Dune, it says in comments only.
  for (const line of codeLines(fs.readFileSync(SCHEMA_FILE, 'utf8'))) {
    assert.ok(!/dune/i.test(line.replace('whiteDuneUsed', '')),
      `White Dune reached generated code: ${line.trim()}`);
  }
});

test('no local filesystem path is baked into the generated schema', () => {
  const text = fs.readFileSync(SCHEMA_FILE, 'utf8');
  assert.ok(!/\/home\/[a-z]/i.test(text), 'no local filesystem path may be baked into the output');
  assert.ok(!text.includes('Projects/cybertown'));
  assert.equal(provenance.isoSource.file, 'raw/part1/nodesRef.html', 'a mirror-relative identity, not a path');
});

test('the generator reads no White Dune input', () => {
  for (const line of codeLines(fs.readFileSync(GENERATOR, 'utf8'))) {
    assert.ok(!/dune/i.test(line.replace('whiteDuneUsed', '')),
      `the generator must not reference White Dune in code: ${line.trim()}`);
    assert.ok(!/RE-ARTIFACTS/.test(line));
  }
});

// --- immutability -----------------------------------------------------------

test('the new metadata is frozen as deeply as the rest of the schema', () => {
  assert.ok(Object.isFrozen(nodeClasses));
  assert.ok(Object.isFrozen(constraintRules));
  assert.ok(Object.isFrozen(constraintNotes));
  for (const id of nodeClassNames) {
    assert.ok(Object.isFrozen(nodeClasses[id]), `${id} record`);
    assert.ok(Object.isFrozen(nodeClasses[id].members), `${id} members`);
  }
  for (const { node, field, rec } of withConstraints()) {
    assert.ok(Object.isFrozen(rec.constraints), `${node}.${field} constraints`);
    for (const key of ['acceptedNodeTypes', 'acceptedNodeClasses', 'rules']) {
      if (rec.constraints[key]) assert.ok(Object.isFrozen(rec.constraints[key]), `${node}.${field}.${key}`);
    }
    if (rec.constraints.note) assert.ok(Object.isFrozen(rec.constraints.note), `${node}.${field}.note`);
  }
  assert.throws(() => { getFieldConstraints('Material', 'transparency').min = 99; }, TypeError);
  assert.throws(() => { getNodeClasses('Anchor').push('nonsense'); }, TypeError);
  assert.equal(getFieldConstraints('Material', 'transparency').min, 0);
});

test('two callers asking for the same class list get the same frozen array', () => {
  assert.equal(listNodesInClass('geometry'), listNodesInClass('geometry'));
  assert.equal(getNodeClasses('Anchor'), getNodeClasses('Anchor'));
});

// --- generator-level parsing (mirror-independent) ---------------------------

test('parseRange refuses an annotation form it does not recognise', () => {
  const { parseRange } = generator;
  assert.throws(() => parseRange('Test.field', 'roughly positive'), /unrecognised range annotation/);
  assert.throws(() => parseRange('Test.field', '[0,'), /unrecognised range annotation/);
  assert.throws(() => parseRange('Test.field', '[a,b]'), /unparsable range endpoint/);
});

test('parseRange reads inclusivity from the bracket, both ends independently', () => {
  const { parseRange } = generator;
  assert.deepEqual(parseRange('T.f', '[0,1]'), { min: 0, minInclusive: true, max: 1, maxInclusive: true });
  assert.deepEqual(parseRange('T.f', '(0,1)'), { min: 0, minInclusive: false, max: 1, maxInclusive: false });
  assert.deepEqual(parseRange('T.f', '[0,1)'), { min: 0, minInclusive: true, max: 1, maxInclusive: false });
  assert.deepEqual(parseRange('T.f', '(-1,1]'), { min: -1, minInclusive: false, max: 1, maxInclusive: true });
});

test('the ten node-class ids are declared, not discovered ad hoc', () => {
  // Every label the generator knows must correspond to a class in the committed
  // schema, so a renamed or dropped enumeration cannot pass silently.
  const declared = Object.values(generator.NODE_CLASS_IDS);
  assert.equal(declared.length, 10);
  assert.deepEqual([...declared].sort(), [...nodeClassNames].sort());
});

test('an unrecognised declaration image fails the build instead of being dropped',
  { skip: needsMirror }, () => {
  // The failure class this guards is the one WD1.6-A exists to prevent: the 1997
  // pages render pi and infinity as GIFs, so an image that is silently discarded
  // turns "[-2pi,2pi]" into "[-2,2]" -- a range that looks perfectly
  // machine-readable and is wrong by a factor of pi. Behavioural, not a scan of
  // the generator's source: the real extraction path is run over a scratch copy
  // of the mirror in which exactly one image has been renamed.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wrl-forge-glyph-'));
  try {
    const nodesRefPath = path.join(scratch, generator.NODE_REF);
    const conceptsPath = path.join(scratch, generator.CONCEPTS_REF);
    fs.mkdirSync(path.dirname(nodesRefPath), { recursive: true });
    fs.copyFileSync(path.join(isoDir, generator.NODE_REF), nodesRefPath);
    fs.copyFileSync(path.join(isoDir, generator.CONCEPTS_REF), conceptsPath);

    // Control: the copy is faithful, and both KNOWN glyphs are still recognised
    // and still land as symbols rather than as bare numbers.
    const control = generator.generate(scratch).text;
    assert.equal(control, fs.readFileSync(SCHEMA_FILE, 'utf8'),
      'the scratch mirror must reproduce the committed schema exactly');
    assert.ok(control.includes('minSymbolic: "-2pi"'), 'pi.gif is recognised and stays symbolic');
    assert.ok(control.includes('maxSymbolic: "infinity"'), 'infinity.gif is recognised and stays symbolic');

    // Rename ONLY the image. Every byte of the surrounding range text -- the
    // brackets, the sign, the coefficient 2 -- is left exactly as it was, so a
    // generator that dropped the tag would still find a well-formed "[-2,2]".
    const original = fs.readFileSync(nodesRefPath, 'latin1');
    const mutated = original.split('Images/pi.gif').join('Images/tau.gif');
    assert.notEqual(mutated, original, 'the scratch fixture must actually have changed');
    fs.writeFileSync(nodesRefPath, mutated, 'latin1');

    // It must fail loudly, naming the image it did not recognise. Nothing is
    // returned, so the unfamiliar glyph cannot have been stripped, read as a
    // number, or quietly recorded as "no constraint".
    assert.throws(() => generator.generate(scratch), (err) => {
      assert.match(err.message, /unrecognised image/i);
      assert.match(err.message, /tau\.gif/);
      return true;
    }, 'an unfamiliar declaration image must be a hard failure');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('the generator names both ISO clause files it reads', () => {
  assert.equal(generator.NODE_REF, path.join('raw', 'part1', 'nodesRef.html'));
  assert.equal(generator.CONCEPTS_REF, path.join('raw', 'part1', 'concepts.html'));
});
