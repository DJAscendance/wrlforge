'use strict';
// Cross-platform unsigned Windows build wrapper (Phase 7C5).
//
// The build:win / build:win:portable npm scripts previously set the signing
// guard with POSIX inline-env syntax (`CSC_IDENTITY_AUTO_DISCOVERY=false
// electron-builder ...`). That works when cross-building on Linux (bash) but
// cmd.exe -- the shell npm uses on Windows -- does not understand it, so a
// NATIVE Windows build failed with "'CSC_IDENTITY_AUTO_DISCOVERY' is not
// recognized". This wrapper sets the env var in-process (identical on every
// platform) and then runs electron-builder, so `npm run build:win` works both
// cross-built on Linux and locally on Windows.
//
// CSC_IDENTITY_AUTO_DISCOVERY=false ensures no ambient code-signing certificate
// on the build host is ever picked up -- the labelled-unsigned beta stays
// deterministically unsigned (empty PE certificate table). --publish never is
// always appended. Extra args (e.g. `--win`, `--win portable`) pass through.
//
//   node scripts/build-win.js --win
//   node scripts/build-win.js --win portable

const { spawnSync } = require('child_process');
const path = require('path');

const passthrough = process.argv.slice(2);
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
const binName = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
const bin = path.join(__dirname, '..', 'node_modules', '.bin', binName);

const res = spawnSync(bin, [...passthrough, '--publish', 'never'], {
  stdio: 'inherit',
  env,
  cwd: path.join(__dirname, '..'),
  shell: process.platform === 'win32', // .cmd shims need a shell on Windows
});
if (res.error) { console.error('build-win: failed to launch electron-builder:', res.error.message); process.exit(1); }
process.exit(res.status == null ? 1 : res.status);
