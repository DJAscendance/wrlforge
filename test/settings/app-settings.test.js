'use strict';
// Read-only app settings (Phase 6A). Injectable readFile; no real fs.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadSettings, settingsPath, DEFAULT_SETTINGS } = require('../../src/settings/app-settings');

test('settingsPath joins under userData (cross-platform via path.join)', () => {
  assert.equal(settingsPath('/u/data'), path.join('/u/data', 'settings.json'));
});

test('missing file → defaults (no throw)', () => {
  const s = loadSettings('/u/data', { readFile: () => { throw new Error('ENOENT'); } });
  assert.deepEqual(s, DEFAULT_SETTINGS);
});

test('garbage JSON → defaults', () => {
  const s = loadSettings('/u/data', { readFile: () => 'not json {{' });
  assert.equal(s.editorCommand, null);
});

test('reads a trimmed editorCommand override', () => {
  const s = loadSettings('/u/data', { readFile: () => JSON.stringify({ editorCommand: '  C:/Tools/codium.cmd  ' }) });
  assert.equal(s.editorCommand, 'C:/Tools/codium.cmd');
});

test('ignores a non-string / empty editorCommand', () => {
  assert.equal(loadSettings('/u', { readFile: () => JSON.stringify({ editorCommand: 123 }) }).editorCommand, null);
  assert.equal(loadSettings('/u', { readFile: () => JSON.stringify({ editorCommand: '   ' }) }).editorCommand, null);
});
