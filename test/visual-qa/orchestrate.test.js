'use strict';
// Unit test for the pure target-resolution helper in the Phase 7C4 Windows
// orchestrator. The orchestrator's main() shells out to a real Electron
// binary and is exercised by the Windows runbook itself, not here.

const test = require('node:test');
const assert = require('node:assert/strict');
const { electronBinaryForTarget } = require('../../qa/phase-7c-windows/orchestrate');

test('electronBinaryForTarget: source resolves to the dev Electron binary', () => {
  assert.equal(electronBinaryForTarget('source', undefined), require('electron'));
  assert.equal(electronBinaryForTarget(undefined, undefined), require('electron'));
});

test('electronBinaryForTarget: packaged targets prefer an explicit --exe over the default', () => {
  assert.equal(electronBinaryForTarget('win-unpacked', 'C:\\custom\\WRL Forge.exe'), 'C:\\custom\\WRL Forge.exe');
});
