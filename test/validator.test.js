'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { validate, gzipSize } = require('../validator');

const fixturesDir = path.join(__dirname, 'fixtures');
const readFixture = (name) => fs.readFileSync(path.join(fixturesDir, name), 'utf8');

test('gzipSize returns the gzip-compressed byte length of a string', () => {
  const text = 'hello world';
  const expected = zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 }).length;
  assert.equal(gzipSize(text), expected);
});

test('valid-plain.wrl passes all hard checks', () => {
  const result = validate(readFixture('valid-plain.wrl'));
  assert.equal(result.ok, true);
});

test('bad-header.wrl fails the header check', () => {
  const result = validate(readFixture('bad-header.wrl'));
  assert.equal(result.ok, false);
  const headerCheck = result.results.find((r) => r.name.startsWith('Header is'));
  assert.equal(headerCheck.pass, false);
});

test('no-worldinfo.wrl fails the WorldInfo check', () => {
  const result = validate(readFixture('no-worldinfo.wrl'));
  assert.equal(result.ok, false);
  const worldInfoCheck = result.results.find((r) => r.name === 'WorldInfo present');
  assert.equal(worldInfoCheck.pass, false);
});

test('oversized.wrl fails the gzip size check', () => {
  const result = validate(readFixture('oversized.wrl'));
  assert.equal(result.ok, false);
  const sizeCheck = result.results.find((r) => r.name.startsWith('Gzip size under'));
  assert.equal(sizeCheck.pass, false);
  assert.ok(result.gzipBytes >= 80 * 1024);
});

test('forbidden-node.wrl fails the forbidden-nodes check', () => {
  const result = validate(readFixture('forbidden-node.wrl'));
  assert.equal(result.ok, false);
  const forbiddenCheck = result.results.find((r) => r.name.startsWith('No forbidden nodes'));
  assert.equal(forbiddenCheck.pass, false);
  assert.match(forbiddenCheck.detail, /Sound/);
});

test('external-url.wrl fails the external-URL check', () => {
  const result = validate(readFixture('external-url.wrl'));
  assert.equal(result.ok, false);
  const urlCheck = result.results.find((r) => r.name.startsWith('No external URLs'));
  assert.equal(urlCheck.pass, false);
});

test('multi-texture.wrl fails the at-most-one-texture check', () => {
  const result = validate(readFixture('multi-texture.wrl'));
  assert.equal(result.ok, false);
  const textureCheck = result.results.find((r) => r.name.startsWith('At most one texture'));
  assert.equal(textureCheck.pass, false);
});

test('bad-texture-ext.wrl fails the texture-format soft check but does not fail overall', () => {
  const result = validate(readFixture('bad-texture-ext.wrl'));
  const extCheck = result.results.find((r) => r.name.startsWith('Texture format is'));
  assert.equal(extCheck.pass, false);
  assert.equal(extCheck.severity, 'soft');
  // Soft-check failures don't flip the overall ok flag.
  assert.equal(result.ok, true);
});

test('def-use-mismatch.wrl fails the DEF/USE integrity check', () => {
  const result = validate(readFixture('def-use-mismatch.wrl'));
  assert.equal(result.ok, false);
  const defUseCheck = result.results.find((r) => r.name.startsWith('Every USE'));
  assert.equal(defUseCheck.pass, false);
  assert.match(defUseCheck.detail, /MissingDef/);
});
