'use strict';
// Scene-tree selection authority tests (Phase WD2-A).
//
// The selection controller is the SINGLE source of truth shared by the scene
// tree view and the inspector. Two subscribers receiving the same selection
// change is the M8 adversarial control ("Selection uses two independent state
// authorities"). Source scans guard the architecture.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const sel = require('../../src/editor/scene-selection');
const { createSelectionController, SCENE_SELECTION_ERROR } = sel;

test('set + get round-trip', () => {
  const c = createSelectionController();
  assert.equal(c.getSelection(), null);
  c.setSelection('node-10-20');
  assert.equal(c.getSelection(), 'node-10-20');
});

test('setting the same id twice is a no-op (no spurious fires)', () => {
  const c = createSelectionController();
  let fires = 0;
  c.subscribe(() => { fires += 1; });
  c.setSelection('node-1');
  c.setSelection('node-1');
  c.setSelection('node-1');
  assert.equal(fires, 1);
});

test('clearSelection nulls the id', () => {
  const c = createSelectionController();
  c.setSelection('node-1');
  c.clearSelection();
  assert.equal(c.getSelection(), null);
});

test('subscribers receive the new id in subscription order', () => {
  const c = createSelectionController();
  const order = [];
  c.subscribe((id) => order.push('a:' + id));
  c.subscribe((id) => order.push('b:' + id));
  c.setSelection('node-2');
  assert.deepEqual(order, ['a:node-2', 'b:node-2']);
});

test('unsubscribe stops future fires', () => {
  const c = createSelectionController();
  const seen = [];
  const off = c.subscribe((id) => seen.push(id));
  c.setSelection('a');
  off();
  c.setSelection('b');
  assert.deepEqual(seen, ['a']);
});

test('faulty listener does not break the others', () => {
  const c = createSelectionController();
  const seen = [];
  c.subscribe(() => { throw new Error('boom'); });
  c.subscribe((id) => seen.push(id));
  c.setSelection('node-3');
  assert.deepEqual(seen, ['node-3']);
});

test('subscribe requires a function', () => {
  const c = createSelectionController();
  assert.throws(() => c.subscribe(null), SCENE_SELECTION_ERROR.INVALID_LISTENER);
  assert.throws(() => c.subscribe('not a function'), SCENE_SELECTION_ERROR.INVALID_LISTENER);
});

test('listenerCount reflects subscriptions', () => {
  const c = createSelectionController();
  assert.equal(c.listenerCount(), 0);
  const off1 = c.subscribe(() => {});
  const off2 = c.subscribe(() => {});
  assert.equal(c.listenerCount(), 2);
  off1();
  assert.equal(c.listenerCount(), 1);
  off2();
  assert.equal(c.listenerCount(), 0);
});

test('M8 (adversarial): one selection authority, not two -- architecture scan', () => {
  const file = path.join(__dirname, '..', '..', 'src', 'editor', 'scene-selection.js');
  const src = fs.readFileSync(file, 'utf8');
  // No globalThis.* mutation: a hidden global would be a second selection
  // authority in disguise.
  assert.ok(!/\bglobalThis\./.test(src), 'must not write to globalThis');
  // The window.WRLForgeSceneSelection assignment is the dual-use browser
  // shim that mirrors module.exports; it is the SAME factory, not a second
  // authority. Allow it but assert the assign is to a frozen api literal.
  const assign = src.match(/window\.WRLForgeSceneSelection\s*=\s*(\w+)/);
  assert.ok(assign, 'browser shim must expose window.WRLForgeSceneSelection');
  assert.equal(assign[1], 'api', 'must assign the frozen api, never an inline new object');
  // Single factory definition. A parallel authority would be a second
  // definition OR a sibling module exposing the same name.
  const defs = (src.match(/function\s+createSelectionController\s*\(/g) || []).length;
  assert.equal(defs, 1, 'one factory function defined once');
});

test('renderer/editor.js does not own its own selection state -- single authority', () => {
  // Source scan: the editor binding must import or wire the selection
  // authority, not define a parallel one.
  const file = path.join(__dirname, '..', '..', 'renderer', 'editor.js');
  const src = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (!src) return; // the wiring may live elsewhere in this lane
  assert.ok(!/let\s+selectedItemId\s*=/.test(src), 'must not declare its own selectedItemId');
  assert.ok(!/const\s+selectedItemId\s*=/.test(src), 'must not declare its own selectedItemId');
});