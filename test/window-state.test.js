'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  windowStatePath,
  legacyWindowStatePath,
  isVisibleOnAnyDisplay,
} = require('../src/settings/window-state');

test('windowStatePath joins userData with the state filename', () => {
  const userData = path.join('home', 'user', '.config', 'wrl-forge');
  assert.equal(windowStatePath(userData), path.join(userData, 'window-state.json'));
});

test('legacyWindowStatePath points at the sibling vrmlpad directory', () => {
  const userData = path.join('home', 'user', '.config', 'wrl-forge');
  assert.equal(
    legacyWindowStatePath(userData),
    path.join('home', 'user', '.config', 'vrmlpad', 'window-state.json')
  );
});

const display = (x, y, width, height) => ({ workArea: { x, y, width, height } });

test('isVisibleOnAnyDisplay is true when bounds overlap a single display', () => {
  const bounds = { x: 100, y: 100, width: 900, height: 700 };
  const displays = [display(0, 0, 1920, 1080)];
  assert.equal(isVisibleOnAnyDisplay(bounds, displays), true);
});

test('isVisibleOnAnyDisplay is false when bounds are entirely off every display', () => {
  const bounds = { x: -5000, y: -5000, width: 900, height: 700 };
  const displays = [display(0, 0, 1920, 1080)];
  assert.equal(isVisibleOnAnyDisplay(bounds, displays), false);
});

test('isVisibleOnAnyDisplay checks all displays in a multi-monitor layout', () => {
  const bounds = { x: 2000, y: 0, width: 900, height: 700 };
  const displays = [display(0, 0, 1920, 1080), display(1920, 0, 1920, 1080)];
  assert.equal(isVisibleOnAnyDisplay(bounds, displays), true);
});

test('isVisibleOnAnyDisplay is false for bounds touching but not overlapping a display edge', () => {
  // A window whose left edge sits exactly at the display's right edge does not overlap
  // (the intersection check uses strict '<'/'>' comparisons).
  const bounds = { x: 1920, y: 0, width: 900, height: 700 };
  const displays = [display(0, 0, 1920, 1080)];
  assert.equal(isVisibleOnAnyDisplay(bounds, displays), false);
});
