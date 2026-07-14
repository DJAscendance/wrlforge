'use strict';
// Generate SHA-256 checksums for the published release binaries.
//
//   node scripts/release-checksums.js
//
// Scans the electron-builder output directory (release/) for the canonical
// public-beta artifacts and writes SHA256SUMS-<version>.txt next to them in the
// standard `<sha256>  <filename>` coreutils format (two spaces), so a user can
// verify with `sha256sum -c` (Linux) or `Get-FileHash` (Windows). Only the
// published distributable archives/installers are hashed -- unpacked build
// trees, blockmaps, and yaml metadata are skipped.
//
// This runs per-platform (Linux emits the .AppImage/.tar.gz lines; Windows the
// .exe/.msi/.zip lines). The final combined manifest for the GitHub release is
// assembled by concatenating both platforms' outputs in the release evidence
// step; each line is independently verifiable.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const version = require('../package.json').version;
const releaseDir = path.join(__dirname, '..', 'release');

// Extensions that represent a published, user-downloadable artifact.
const PUBLISHED = /\.(AppImage|tar\.gz|exe|msi|zip)$/i;
// Never hash intermediate/unpacked outputs or builder metadata.
const SKIP = /(\.blockmap$|\.yml$|\.yaml$|^builder-|unpacked)/i;

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function main() {
  if (!fs.existsSync(releaseDir)) {
    console.error(`release-checksums: no release/ directory found -- run a dist build first`);
    process.exit(1);
  }
  const files = fs.readdirSync(releaseDir)
    .filter((f) => PUBLISHED.test(f) && !SKIP.test(f))
    .sort();
  if (files.length === 0) {
    console.error('release-checksums: no published artifacts found in release/');
    process.exit(1);
  }
  const lines = files.map((f) => {
    const digest = sha256(path.join(releaseDir, f));
    const size = fs.statSync(path.join(releaseDir, f)).size;
    console.log(`${digest}  ${f}  (${size} bytes)`);
    return `${digest}  ${f}`;
  });
  const out = path.join(releaseDir, `SHA256SUMS-${version}.txt`);
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log(`\nWrote ${out} (${files.length} artifact(s))`);
}

main();
