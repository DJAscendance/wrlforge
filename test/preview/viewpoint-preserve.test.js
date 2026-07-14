'use strict';
// Phase 7C3 -- pure viewpoint-preservation resolver tests. The locked priority:
// DEF match -> unique description match -> previous index -> first -> default,
// with duplicate descriptions explicitly never relied on.

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveViewpointRestore } = require('../../src/preview/viewpoint-preserve');

const vp = (name, description) => ({ name, description });

test('exact DEF-name match wins, regardless of position', () => {
  const r = resolveViewpointRestore(
    { name: 'Entry', description: 'Front door', index: 0 },
    [vp('Above', 'Overview'), vp('Entry', 'Front door'), vp('Back', null)],
  );
  assert.deepEqual(r, { action: 'bind', index: 1, matchedBy: 'def' });
});

test('DEF match works even when the description changed', () => {
  const r = resolveViewpointRestore(
    { name: 'Entry', description: 'Old label', index: 0 },
    [vp('Entry', 'Renamed label')],
  );
  assert.deepEqual(r, { action: 'bind', index: 0, matchedBy: 'def' });
});

test('description fallback when the DEF was renamed', () => {
  const r = resolveViewpointRestore(
    { name: 'OldDef', description: 'Front door', index: 2 },
    [vp('A', 'Overview'), vp('NewDef', 'Front door')],
  );
  assert.deepEqual(r, { action: 'bind', index: 1, matchedBy: 'description' });
});

test('duplicate descriptions are never relied on: falls through to the index', () => {
  const r = resolveViewpointRestore(
    { name: null, description: 'Room', index: 1 },
    [vp(null, 'Room'), vp(null, 'Room'), vp(null, 'Other')],
  );
  assert.deepEqual(r, { action: 'bind', index: 1, matchedBy: 'index' });
});

test('previous index used when still valid and nothing else matches', () => {
  const r = resolveViewpointRestore(
    { name: 'Gone', description: 'Also gone', index: 2 },
    [vp('X', 'x'), vp('Y', 'y'), vp('Z', 'z')],
  );
  assert.deepEqual(r, { action: 'bind', index: 2, matchedBy: 'index' });
});

test('removed viewpoint with an out-of-range index falls back to the FIRST viewpoint', () => {
  const r = resolveViewpointRestore(
    { name: 'Gone', description: null, index: 5 },
    [vp('X', 'x'), vp('Y', 'y')],
  );
  assert.deepEqual(r, { action: 'bind', index: 0, matchedBy: 'first' });
});

test('no viewpoints in the new scene: X_ITE default view (bind nothing)', () => {
  const r = resolveViewpointRestore({ name: 'Entry', description: 'e', index: 0 }, []);
  assert.deepEqual(r, { action: 'none', matchedBy: 'default' });
});

test('nothing captured before: the new scene\'s own default binding stands', () => {
  assert.deepEqual(resolveViewpointRestore(null, [vp('A', 'a')]), { action: 'none', matchedBy: 'default' });
  assert.deepEqual(resolveViewpointRestore(undefined, []), { action: 'none', matchedBy: 'default' });
});

test('empty-string identities never match (only real names/descriptions count)', () => {
  const r = resolveViewpointRestore(
    { name: '', description: '', index: 0 },
    [vp('', ''), vp('A', 'a')],
  );
  assert.deepEqual(r, { action: 'bind', index: 0, matchedBy: 'index' });
});

test('unique description among many viewpoints resolves to the right one', () => {
  const list = [];
  for (let i = 0; i < 20; i++) list.push(vp('VP' + i, i === 13 ? 'The one' : 'Filler'));
  const r = resolveViewpointRestore({ name: 'Missing', description: 'The one', index: 0 }, list);
  assert.deepEqual(r, { action: 'bind', index: 13, matchedBy: 'description' });
});
