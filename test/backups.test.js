'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { backupPath } = require('../src/files/backups');

test('backupPath appends a deterministic timestamp suffix using the injected clock', () => {
  const fixedClock = () => new Date('2026-07-11T12:00:00.000Z');
  const result = backupPath('/items/chair.wrl', fixedClock);
  assert.equal(result, '/items/chair.wrl.bak-2026-07-11T12-00-00-000Z');
});

test('backupPath replaces every colon and dot in the ISO timestamp', () => {
  const fixedClock = () => new Date('2026-01-05T03:04:05.678Z');
  const result = backupPath('world.wrl', fixedClock);
  assert.doesNotMatch(result.replace('world.wrl.bak-', ''), /[:.]/);
});

test('backupPath defaults to the real clock when none is injected', () => {
  const result = backupPath('chair.wrl');
  assert.match(result, /^chair\.wrl\.bak-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
});
