'use strict';
// Lightweight packaging-config validation for CI (no electron download).
// Asserts package.json metadata + the electron-builder `build` block declare
// exactly the public-beta targets and canonical artifact names this release
// lane depends on. Fails fast with a clear message if a required target or name
// drifts, so a mis-named or missing artifact is caught before a release build.
//
// Version policy: package.json is the SINGLE authority for the application
// version. This script deliberately does NOT pin an expected version literal --
// an earlier revision hard-coded `1.3.0-beta.3`, so the release bump to
// beta.5 (commit 56b73a4) turned every CI run red until somebody remembered to
// edit this second copy of the version. Instead we validate the *relationships*
// that must hold: the version is well-formed semver, and package-lock.json's
// root application metadata mirrors package.json. electron-builder derives the
// artifact version from package.json, so no third copy exists to check.

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// Pure: takes the two manifests, returns a list of human-readable problems.
// Exported so test/build-config.test.js can drive it without spawning CI.
function validate(pkg, lock) {
  const problems = [];
  const req = (cond, msg) => { if (!cond) problems.push(msg); };

  // --- version truth: package.json is authoritative ---
  req(typeof pkg.version === 'string' && SEMVER.test(pkg.version),
    `package.json version must be valid semver (got ${JSON.stringify(pkg.version)})`);

  // --- package-lock root application metadata must mirror package.json ---
  // lockfileVersion 3 stores the root app name/version twice: at the top level
  // and again under packages[""]. Both are application metadata (not dependency
  // resolution), so both must track package.json.
  const rootPkg = (lock.packages && lock.packages['']) || {};
  req(lock.name === pkg.name,
    `package-lock.json "name" must match package.json (${pkg.name}), got ${JSON.stringify(lock.name)}`);
  req(lock.version === pkg.version,
    `package-lock.json "version" must match package.json (${pkg.version}), got ${JSON.stringify(lock.version)}`);
  req(rootPkg.name === pkg.name,
    `package-lock.json packages[""].name must match package.json (${pkg.name}), got ${JSON.stringify(rootPkg.name)}`);
  req(rootPkg.version === pkg.version,
    `package-lock.json packages[""].version must match package.json (${pkg.version}), got ${JSON.stringify(rootPkg.version)}`);
  req(rootPkg.license === pkg.license,
    `package-lock.json packages[""].license must match package.json (${pkg.license}), got ${JSON.stringify(rootPkg.license)}`);

  // --- top-level metadata ---
  req(pkg.author === 'Ryan Bundy (BassMekanik2000)', `author must be "Ryan Bundy (BassMekanik2000)" (got ${JSON.stringify(pkg.author)})`);
  req(pkg.license === 'GPL-3.0-or-later', `license must be GPL-3.0-or-later (got ${JSON.stringify(pkg.license)})`);
  req(pkg.homepage === 'https://wrlforge.com', `homepage must be https://wrlforge.com (got ${JSON.stringify(pkg.homepage)})`);

  const b = pkg.build || {};
  req(b.copyright === 'Copyright © 2026 Ryan Bundy (BassMekanik2000)', `build.copyright must be the Ryan Bundy (BassMekanik2000) copyright line (got ${JSON.stringify(b.copyright)})`);

  // --- Linux targets ---
  const linuxTargets = (b.linux && b.linux.target || []).map((t) => t.target);
  req(linuxTargets.includes('AppImage'), 'linux target AppImage missing');
  req(linuxTargets.includes('tar.gz'), 'linux target tar.gz missing');
  req(b.appImage && /WRL-Forge-\$\{version\}-linux-x64\.AppImage/.test(b.appImage.artifactName || ''), 'appImage.artifactName not canonical');

  // --- Windows targets ---
  // The Windows ZIP is assembled from win-unpacked in the release workflow (the
  // electron-builder `zip` target collided with the `msi` output name), so only
  // nsis/msi/portable are declared here.
  const winTargets = (b.win && b.win.target || []).map((t) => t.target);
  for (const t of ['nsis', 'msi', 'portable']) {
    req(winTargets.includes(t), `windows target ${t} missing`);
  }
  req(/WRL-Forge-Setup-\$\{version\}-x64\.exe/.test((b.nsis || {}).artifactName || ''), 'nsis.artifactName not canonical');
  req(/WRL-Forge-\$\{version\}-x64\.msi/.test((b.msi || {}).artifactName || ''), 'msi.artifactName not canonical');
  req(/WRL-Forge-Portable-\$\{version\}-x64\.exe/.test((b.portable || {}).artifactName || ''), 'portable.artifactName not canonical');

  // --- global artifactName (covers AppImage/tar.gz/zip via ${os}) ---
  req(/WRL-Forge-\$\{version\}-\$\{os\}-\$\{arch\}\.\$\{ext\}/.test(b.artifactName || ''), 'global build.artifactName not canonical');

  // --- required scripts ---
  for (const s of ['dist:linux', 'dist:windows', 'release:checksums', 'build:icons', 'build:editor', 'check']) {
    req(pkg.scripts && pkg.scripts[s], `npm script "${s}" missing`);
  }

  return problems;
}

module.exports = { validate, SEMVER };

if (require.main === module) {
  const pkg = require('../../package.json');
  const lock = require('../../package-lock.json');
  const problems = validate(pkg, lock);
  if (problems.length) {
    console.error('Packaging config validation FAILED:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log(`Packaging config OK: version ${pkg.version} (package.json authoritative, package-lock in sync), metadata, Linux + Windows targets, canonical artifact names, and release scripts all present.`);
}
