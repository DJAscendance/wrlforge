'use strict';
// Semantic index tests (Phase 7A): DEF/USE resolution, duplicate DEF, ROUTE
// indexing and endpoint resolution, stable diagnostic codes.

const test = require('node:test');
const assert = require('node:assert');
const { parse } = require('../../src/vrml');
const { CODE } = require('../../src/vrml/diagnostics');

const semCodes = (r) => r.semanticDiagnostics.map((d) => d.code);

test('DEF declarations are indexed', () => {
  const r = parse('#VRML V2.0 utf8\nDEF A Shape {} DEF B Transform { children [ USE A ] }');
  assert.deepEqual(r.defs.map((d) => d.name).sort(), ['A', 'B']);
  assert.ok(r.defsByName.has('A'));
});

test('duplicate DEF is flagged with a related span to the first', () => {
  const r = parse('#VRML V2.0 utf8\nDEF X Shape {} DEF X Sphere {}');
  const dup = r.semanticDiagnostics.find((d) => d.code === CODE.DUPLICATE_DEF);
  assert.ok(dup);
  assert.ok(dup.related && dup.related[0].range);
  assert.equal(r.duplicateDefs.length, 1);
});

test('unresolved USE is flagged; resolved USE is not', () => {
  const bad = parse('#VRML V2.0 utf8\nGroup { children [ USE Ghost ] }');
  assert.ok(semCodes(bad).includes(CODE.UNRESOLVED_USE));
  assert.equal(bad.uses[0].resolved, false);

  const good = parse('#VRML V2.0 utf8\nDEF G Shape {} Group { children [ USE G ] }');
  assert.ok(!semCodes(good).includes(CODE.UNRESOLVED_USE));
  assert.equal(good.uses[0].resolved, true);
});

test('ROUTE endpoints are indexed and resolved against DEFs', () => {
  const r = parse('#VRML V2.0 utf8\nDEF A TimeSensor {} DEF B Transform {}\nROUTE A.fraction_changed TO B.set_scale');
  assert.equal(r.routes.length, 1);
  assert.equal(r.routes[0].resolvedFrom, true);
  assert.equal(r.routes[0].resolvedTo, true);
});

test('dangling ROUTE endpoints are flagged (source and target codes distinct)', () => {
  const r = parse('#VRML V2.0 utf8\nDEF A TimeSensor {}\nROUTE A.x TO Ghost.y\nROUTE Nobody.z TO A.w');
  assert.ok(semCodes(r).includes(CODE.UNRESOLVED_ROUTE_TARGET));
  assert.ok(semCodes(r).includes(CODE.UNRESOLVED_ROUTE_SOURCE));
});

test('duplicate ROUTE is a warning', () => {
  const r = parse('#VRML V2.0 utf8\nDEF A TimeSensor {} DEF B Transform {}\nROUTE A.x TO B.y\nROUTE A.x TO B.y');
  assert.ok(semCodes(r).includes(CODE.DUPLICATE_ROUTE));
});

test('syntax and semantic diagnostics are separable', () => {
  const r = parse('#VRML V2.0 utf8\nGroup { children [ USE Ghost ] }');
  assert.equal(r.syntaxDiagnostics.length, 0);
  assert.ok(r.semanticDiagnostics.length >= 1);
});
