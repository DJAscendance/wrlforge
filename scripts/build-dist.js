'use strict';
// Platform-neutral unsigned electron-builder wrapper for public beta builds.
//
// `npm run dist:linux` and `npm run dist:mac` route through here. It mirrors
// scripts/build-win.js: it guarantees the generated icon tree exists, appends
// `--publish never`, and passes through any extra electron-builder args (e.g.
// `--linux --x64` or `--mac --arm64`).
//
// Code-signing posture is PER-PLATFORM and deliberately asymmetric:
//
//   Linux  -- CSC_IDENTITY_AUTO_DISCOVERY is forced OFF. Linux artifacts are
//             deterministically unsigned; a stray keychain/CSC_* variable on a
//             developer machine must never silently sign them.
//   macOS  -- discovery is left ALONE so electron-builder can find the
//             Developer ID Application identity in the keychain. The public
//             macOS build is Developer ID signed, Hardened Runtime, notarized
//             and stapled; forcing discovery off here was the root cause of the
//             1.4.0 "WRL Forge.app is damaged and can't be opened" blocker.
//
// Notarization credentials are never read or stored by this wrapper. They are
// supplied to electron-builder purely through the environment -- the supported
// choices are APPLE_KEYCHAIN_PROFILE (a `notarytool store-credentials` profile,
// preferred locally), APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or
// APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER.
//
//   node scripts/build-dist.js --linux --x64
//   node scripts/build-dist.js --mac --arm64
//
// Windows artifacts are built via scripts/build-win.js (which additionally runs
// the Windows workspace guard). This wrapper works identically on any host shell
// because the env var is set in-process rather than as POSIX inline-env syntax.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const icons = require('./build-icons.js');

const passthrough = process.argv.slice(2);

// Signing discovery is decided by the TARGET platform, not the host. A macOS
// build must be allowed to reach the keychain; everything else stays forcibly
// unsigned. `--mac` is how npm run dist:mac selects the platform; absent any
// explicit platform flag electron-builder targets the host, so a bare
// invocation on darwin is a macOS build too.
const explicitPlatform = passthrough.some((a) => /^--(mac|linux|win)$/.test(a));
const isMacBuild = passthrough.includes('--mac')
  || (!explicitPlatform && process.platform === 'darwin');

const env = { ...process.env };
if (!isMacBuild) {
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
}
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
