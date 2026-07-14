'use strict';
// Phase 7C4.1 — unit tests for the Windows workspace isolation guard. Pure and
// injected (platform/env/driveType), so they run deterministically on any host
// with no real Windows, no network drive, and no child_process.

const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../qa/visual-qa/workspace-guard');

const win = (extra = {}) => ({ platform: 'win32', env: {}, driveType: () => 'Fixed', ...extra });

test('local C:\\Projects\\wrlforge is accepted', () => {
  const c = G.classifyWorkspace('C:\\Projects\\wrlforge', win());
  assert.equal(c.ok, true);
  assert.equal(c.kind, 'ok');
});

test('UNC path is rejected', () => {
  const c = G.classifyWorkspace('\\\\host.lan\\Data\\wrlforge', win());
  assert.equal(c.ok, false);
  // \\host.lan\... is both a UNC path and a host-share; UNC is checked first.
  assert.equal(c.kind, 'unc');
});

test('forward-slash UNC path is also rejected', () => {
  const c = G.classifyWorkspace('//host.lan/Data/wrlforge', win());
  assert.equal(c.ok, false);
  assert.equal(c.kind, 'unc');
});

test('host-share is rejected even via a mapped letter whose path names the host', () => {
  const c = G.classifyWorkspace('Z:\\host.lan\\wrlforge', win({ driveType: () => 'Fixed' }));
  assert.equal(c.ok, false);
  assert.equal(c.kind, 'host-share');
});

test('mapped network drive is rejected', () => {
  const c = G.classifyWorkspace('Z:\\wrlforge', win({ driveType: () => 'Network' }));
  assert.equal(c.ok, false);
  assert.equal(c.kind, 'network-drive');
});

test('extra host-share marker from WRL_FORGE_HOST_SHARE is honoured', () => {
  const c = G.classifyWorkspace('Q:\\corp-nas\\wrlforge', win({ env: { WRL_FORGE_HOST_SHARE: 'corp-nas' } }));
  assert.equal(c.ok, false);
  assert.equal(c.kind, 'host-share');
});

test('a Fixed drive that is not a host share is accepted', () => {
  const c = G.classifyWorkspace('D:\\dev\\wrlforge', win({ driveType: () => 'Fixed' }));
  assert.equal(c.ok, true);
});

test('a failed drive probe (Unknown) does not falsely block a local-looking path', () => {
  const c = G.classifyWorkspace('C:\\Projects\\wrlforge', win({ driveType: () => 'Unknown' }));
  assert.equal(c.ok, true);
});

test('Linux paths are never blocked', () => {
  const c = G.classifyWorkspace('/home/ryan/Projects/cybertown/wrlforge', { platform: 'linux' });
  assert.equal(c.ok, true);
  assert.equal(c.kind, 'non-windows');
});

test('assertLocalWorkspace throws the exact message with a diagnostic classification', () => {
  assert.throws(
    () => G.assertLocalWorkspace('\\\\host.lan\\Data', win()),
    (err) => {
      assert.equal(err.message, G.WORKSPACE_MESSAGE);
      assert.equal(err.code, 'ENETWORKWORKSPACE');
      assert.equal(err.classification.kind, 'unc');
      return true;
    },
  );
});

test('assertLocalWorkspace returns the classification when the workspace is local', () => {
  const c = G.assertLocalWorkspace('C:\\Projects\\wrlforge', win());
  assert.equal(c.ok, true);
});

test('guardWindowsWorkspace prints the message and exits 2 on rejection', () => {
  const errs = [];
  const exits = [];
  G.guardWindowsWorkspace({
    cwd: 'Z:\\wrlforge', platform: 'win32', env: {}, driveType: () => 'Network',
    error: (m) => errs.push(m), exit: (c) => exits.push(c), label: 'qa:windows',
  });
  assert.deepEqual(exits, [2]);
  assert.ok(errs.some((m) => m.includes(G.WORKSPACE_MESSAGE)));
  assert.ok(errs.some((m) => m.includes('[qa:windows]')));
  assert.ok(errs.some((m) => /network-mapped/.test(m)));
});

test('guardWindowsWorkspace is a silent pass on an accepted workspace', () => {
  const errs = [];
  const exits = [];
  const c = G.guardWindowsWorkspace({
    cwd: 'C:\\Projects\\wrlforge', platform: 'win32', env: {}, driveType: () => 'Fixed',
    error: (m) => errs.push(m), exit: (code) => exits.push(code),
  });
  assert.equal(c.ok, true);
  assert.deepEqual(exits, []);
  assert.deepEqual(errs, []);
});

test('the explicit host-share evidence destination case: only allowlisted evidence files export', () => {
  const files = [
    'RESULTS.md',
    'results.json',
    'environment.json',
    'shots/editor-dark.png',
    'node_modules/x_ite/index.js',
    '.git/config',
    'src/main.js',
    'test/fixtures/world/world.wrl',
    'item.edit.wrl',
    'world.wrl.bak',
    'release/win-unpacked/WRL Forge.exe',
    'renderer/vendor/wrl-editor.bundle.js',
  ];
  const { allowed, denied } = G.filterEvidenceExport(files);
  assert.deepEqual(allowed.sort(), ['RESULTS.md', 'environment.json', 'results.json', 'shots/editor-dark.png'].sort());
  const deniedPaths = denied.map((d) => d.path);
  for (const bad of [
    'node_modules/x_ite/index.js', '.git/config', 'src/main.js',
    'test/fixtures/world/world.wrl', 'item.edit.wrl', 'world.wrl.bak',
    'release/win-unpacked/WRL Forge.exe', 'renderer/vendor/wrl-editor.bundle.js',
  ]) {
    assert.ok(deniedPaths.includes(bad), `expected ${bad} to be denied`);
  }
});

test('windows binaries export only when explicitly requested', () => {
  // A bare binary in an evidence subdir is denied by default, allowed on opt-in.
  assert.ok(G.deniedEvidenceReason('smoke/installer.exe'));
  assert.equal(G.isDeniedEvidenceEntry('smoke/installer.exe'), true);
  assert.equal(G.deniedEvidenceReason('smoke/installer.exe', { allowBinaries: true }), null);
  // allowBinaries does NOT override a denied directory (e.g. release/ intermediate).
  assert.ok(G.deniedEvidenceReason('release/win-unpacked/app.exe', { allowBinaries: true }));
});
