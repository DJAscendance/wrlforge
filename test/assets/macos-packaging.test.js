'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const pkg = require(path.join(ROOT, 'package.json'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('macOS packaging is an unsigned Apple Silicon DMG + ZIP build', () => {
  const mac = pkg.build.mac;
  assert.ok(mac, 'build.mac configuration missing');
  assert.equal(mac.identity, null);
  assert.equal(mac.hardenedRuntime, false);
  assert.equal(mac.notarize, false);
  assert.equal(mac.category, 'public.app-category.graphics-design');
  // Only the configured path is asserted here. The generated file's existence,
  // decode, 1024px dimensions and deterministic regeneration are owned by
  // test/assets/icon-generation.test.js, which runs them alongside the generator
  // that rebuilds that tree.
  assert.equal(mac.icon, 'assets/generated/icons/macos/icon.png');

  const targets = new Map(mac.target.map((entry) => [entry.target, entry.arch]));
  assert.deepEqual(targets.get('dmg'), ['arm64']);
  assert.deepEqual(targets.get('zip'), ['arm64']);

  const globalExtras = pkg.build.extraFiles.map((entry) => entry.from);
  assert.deepEqual(globalExtras, ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'OPEN_SOURCE_PROVENANCE.md']);
  assert.equal(pkg.build.extraResources, undefined, 'Windows icon alternatives must not leak into macOS');
  assert.ok(pkg.build.linux.extraFiles.some((entry) => entry.from === 'scripts/install-linux-shortcut.sh'));
  assert.ok(pkg.build.win.extraResources.some((entry) => entry.from === 'assets/generated/icons/windows'));
});

test('dist:mac uses the unsigned cross-platform wrapper and never publishes', () => {
  const command = pkg.scripts['dist:mac'];
  assert.match(command, /npm run build:icons/);
  assert.match(command, /npm run build:editor/);
  assert.match(command, /node scripts\/build-dist\.js --mac --arm64/);
  assert.doesNotMatch(command, /CSC_IDENTITY_AUTO_DISCOVERY=/, 'script must not use shell-specific inline env');

  const wrapper = read('scripts/build-dist.js');
  assert.match(wrapper, /CSC_IDENTITY_AUTO_DISCOVERY/);
  assert.match(wrapper, /--publish['"\s,]+never/);
});

test('macOS lifecycle accepts Finder file-open and keeps the app alive without windows', () => {
  const main = read('main.js');
  assert.match(main, /app\.on\(['"]open-file['"]/);
  assert.match(main, /process\.platform !== ['"]darwin['"]\) app\.quit\(\)/);

  const association = pkg.build.fileAssociations.find((entry) => entry.mimeType === 'model/vrml');
  assert.ok(association, 'VRML file association missing');
  assert.deepEqual([...association.ext].sort(), ['wrl', 'wrz']);
  assert.equal(association.role, 'Editor');
});
