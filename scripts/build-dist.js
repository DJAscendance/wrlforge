'use strict';
// Platform-neutral unsigned electron-builder wrapper for public beta builds.
//
// `npm run dist:linux` routes through here to produce the Linux AppImage +
// tar.gz. It mirrors scripts/build-win.js: it guarantees the generated icon
// tree exists, forces code-signing discovery OFF so the labelled-unsigned beta
// stays deterministically unsigned, appends `--publish never`, and passes
// through any extra electron-builder args (e.g. `--linux --x64`).
//
//   node scripts/build-dist.js --linux --x64
//
// Windows artifacts are built via scripts/build-win.js (which additionally runs
// the Windows workspace guard); this wrapper is the cross-platform default used
// for Linux packaging. It works identically on any host shell because the env
// var is set in-process rather than as POSIX inline-env syntax.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const icons = require('./build-icons.js');

const passthrough = process.argv.slice(2);
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
const binName = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
const bin = path.join(__dirname, '..', 'node_modules', '.bin', binName);

// Icons must exist before packaging. Regenerate deterministically if the
// generated tree is missing (fresh checkout). Committed output makes this a
// no-op in practice.
const primaryDefault = path.join(__dirname, '..', 'assets', 'generated', 'icons', 'windows', icons.icoName(icons.PRIMARY_VARIANT));
if (!fs.existsSync(primaryDefault)) {
  console.log('build-dist: generated icons missing -> running build:icons');
  icons.generate();
}

const res = spawnSync(bin, [...passthrough, '--publish', 'never'], {
  stdio: 'inherit',
  env,
  cwd: path.join(__dirname, '..'),
  shell: process.platform === 'win32',
});
if (res.error) { console.error('build-dist: failed to launch electron-builder:', res.error.message); process.exit(1); }
process.exit(res.status == null ? 1 : res.status);
