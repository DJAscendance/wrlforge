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
const fs = require('fs');
const path = require('path');
const icons = require('./build-icons.js');

const passthrough = process.argv.slice(2);
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
const binName = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
const bin = path.join(__dirname, '..', 'node_modules', '.bin', binName);

// Icons must exist before packaging. Regenerate deterministically if the
// generated tree is missing (e.g. a fresh checkout) so a build never packages
// with a stale or absent icon. Committed output makes this a no-op in practice.
const primaryDefault = path.join(__dirname, '..', 'assets', 'generated', 'icons', 'windows', icons.icoName(icons.PRIMARY_VARIANT));
if (!fs.existsSync(primaryDefault)) {
  console.log('build-win: generated icons missing -> running build:icons');
  icons.generate();
}

// WRL_FORGE_ICON selects which approved variant becomes THIS build's executable
// identity (cyan | cyan-transparent | yellow | yellow-transparent). Default is
// cyan opaque. All four variants ship inside the app regardless, so users can
// repoint their own shortcut afterwards. Unknown values fall back to cyan.
const sel = icons.resolvePrimaryIcon(process.env.WRL_FORGE_ICON);
const iconOverride = sel.isDefault ? [] : [`--config.win.icon=${sel.relPath}`];
if (!sel.isDefault) console.log(`build-win: WRL_FORGE_ICON=${sel.variant} -> exe icon ${sel.relPath}`);

const res = spawnSync(bin, [...passthrough, ...iconOverride, '--publish', 'never'], {
  stdio: 'inherit',
  env,
  cwd: path.join(__dirname, '..'),
  shell: process.platform === 'win32', // .cmd shims need a shell on Windows
});
if (res.error) { console.error('build-win: failed to launch electron-builder:', res.error.message); process.exit(1); }
process.exit(res.status == null ? 1 : res.status);
