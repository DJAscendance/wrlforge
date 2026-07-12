'use strict';
// Non-visual unit tests for qa/visual-qa/cli.js's pure helpers (arg parsing,
// the Windows session-present gate, and packaged-target exe resolution).
// No Electron, no spawn, no display -- safe for the default `npm test` gate.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, checkSessionPresent, resolveExeForTarget } = require('../../qa/visual-qa/cli');

test('parseArgs splits --key=value flags, bare boolean flags, and positionals', () => {
  const args = parseArgs(['jobs.json', '--max=3', '--allow-headed', '--target=win-unpacked']);
  assert.deepEqual(args.positional, ['jobs.json']);
  assert.equal(args.flags.max, '3');
  assert.equal(args.flags['allow-headed'], true);
  assert.equal(args.flags.target, 'win-unpacked');
});

test('checkSessionPresent: non-Windows still requires DISPLAY or WAYLAND_DISPLAY', () => {
  const calls = [];
  const exit = (code) => { calls.push(code); throw new Error('exit'); };
  const origExit = process.exit;
  process.exit = exit;
  try {
    assert.throws(() => checkSessionPresent(parseArgs([]), 'linux', {}));
    assert.deepEqual(calls, [2]);
  } finally {
    process.exit = origExit;
  }
});

test('checkSessionPresent: non-Windows passes with DISPLAY set, no exit', () => {
  const origExit = process.exit;
  process.exit = () => { throw new Error('must not exit'); };
  try {
    checkSessionPresent(parseArgs([]), 'linux', { DISPLAY: ':0' });
  } finally {
    process.exit = origExit;
  }
});

test('checkSessionPresent: win32 refuses without --allow-headed (no DISPLAY concept to check)', () => {
  const calls = [];
  const origExit = process.exit;
  process.exit = (code) => { calls.push(code); throw new Error('exit'); };
  try {
    assert.throws(() => checkSessionPresent(parseArgs([]), 'win32', {}));
    assert.deepEqual(calls, [2]);
  } finally {
    process.exit = origExit;
  }
});

test('checkSessionPresent: win32 passes with --allow-headed, no exit', () => {
  const origExit = process.exit;
  process.exit = () => { throw new Error('must not exit'); };
  try {
    checkSessionPresent(parseArgs(['--allow-headed']), 'win32', {});
  } finally {
    process.exit = origExit;
  }
});

test('resolveExeForTarget: win-unpacked resolves under release/win-unpacked', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-cli-test-'));
  const exe = resolveExeForTarget('win-unpacked', root);
  assert.equal(exe, path.join(root, 'release', 'win-unpacked', 'WRL Forge.exe'));
});

test('resolveExeForTarget: portable finds a *portable*.exe under release/', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-cli-test-'));
  const releaseDir = path.join(root, 'release');
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(releaseDir, 'WRL Forge-1.2.0-beta.2-portable.exe'), '');
  const exe = resolveExeForTarget('portable', root);
  assert.equal(exe, path.join(releaseDir, 'WRL Forge-1.2.0-beta.2-portable.exe'));
});

test('resolveExeForTarget: portable returns null when release/ is absent or has no match', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-cli-test-'));
  assert.equal(resolveExeForTarget('portable', root), null);
});

test('resolveExeForTarget: installed has no fixed default', () => {
  assert.equal(resolveExeForTarget('installed', '/anywhere'), null);
});
