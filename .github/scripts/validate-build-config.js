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

  // --- macOS targets (public distribution: Apple Silicon, Developer ID) ---
  // The public macOS build is signed with a Developer ID Application identity,
  // runs under Hardened Runtime, and is notarized + stapled. An unsigned or
  // ad-hoc-signed bundle is NOT shippable: a downloaded copy carries the
  // com.apple.quarantine attribute and Gatekeeper reports "WRL Forge.app is
  // damaged and can't be opened" (the 1.4.0 release blocker). These assertions
  // exist so that posture cannot silently regress to the old developer-only one.
  const mac = b.mac || {};
  const macTargets = (mac.target || []).map((t) => t.target);
  for (const t of ['dmg', 'zip']) {
    req(macTargets.includes(t), `macOS target ${t} missing`);
  }
  req(mac.icon === 'assets/generated/icons/macos/icon.png', 'macOS icon path not canonical');
  req(mac.hardenedRuntime === true, 'macOS build must enable hardenedRuntime (notarization is rejected without it)');
  req(mac.notarize === true, 'macOS build must enable notarization');
  // `identity: null` is electron-builder's explicit "do not sign" switch. It
  // must be absent entirely so the Developer ID identity is discovered from the
  // keychain / CSC_* environment.
  req(!('identity' in mac) || typeof mac.identity === 'string',
    'macOS build must not disable signing (build.mac.identity must be absent, or a literal identity name)');
  // Entitlements are part of the contract: Hardened Runtime denies the JIT and
  // unsigned-executable-memory that V8 requires, so both plists must be wired up.
  req(mac.entitlements === 'assets/entitlements.mac.plist', 'macOS entitlements path not canonical');
  req(mac.entitlementsInherit === 'assets/entitlements.mac.inherit.plist', 'macOS inherited entitlements path not canonical');
  // The DMG container is signed, notarized and stapled by this hook, not by
  // electron-builder (dmg.sign defaults to false). Without it a public DMG
  // assesses as "no usable signature"; the hook fails the build closed if any
  // trust stage fails, so losing the wiring silently loses that guarantee.
  req(b.afterAllArtifactBuild === 'scripts/notarize-dmg.js',
    'build.afterAllArtifactBuild must wire scripts/notarize-dmg.js (the DMG trust hook)');
  for (const target of (mac.target || [])) {
    req(Array.isArray(target.arch) && target.arch.includes('arm64'), `macOS target ${target.target || '<unknown>'} must include arm64`);
  }
  req(!b.extraResources, 'platform-specific resources must not be declared globally');
  req((b.extraFiles || []).every((entry) => !/linux|windows/i.test(entry.from || '')), 'platform-specific files must not be declared globally');

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
  req((b.win && b.win.extraResources || []).some((entry) => entry.from === 'assets/generated/icons/windows'), 'Windows alternate icons missing from win.extraResources');

  // --- global artifactName (covers AppImage/tar.gz/zip via ${os}) ---
  req(/WRL-Forge-\$\{version\}-\$\{os\}-\$\{arch\}\.\$\{ext\}/.test(b.artifactName || ''), 'global build.artifactName not canonical');

  // --- required scripts ---
  for (const s of ['dist:linux', 'dist:mac', 'dist:windows', 'release:checksums', 'build:icons', 'build:editor', 'check']) {
    req(pkg.scripts && pkg.scripts[s], `npm script "${s}" missing`);
  }

  return problems;
}

module.exports = { validate, SEMVER };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const pkg = require('../../package.json');
  const lock = require('../../package-lock.json');
  const problems = validate(pkg, lock);
  // validate() is pure (manifests in, problems out) so it stays unit-testable
  // without a filesystem. Existence of the entitlement plists is a real failure
  // mode the manifests cannot express, so it is checked here at the CLI edge.
  const repoRoot = path.join(__dirname, '..', '..');
  const hook = pkg.build && pkg.build.afterAllArtifactBuild;
  if (typeof hook === 'string' && !fs.existsSync(path.join(repoRoot, hook))) {
    problems.push(`build.afterAllArtifactBuild points at a missing file: ${hook}`);
  }
  for (const key of ['entitlements', 'entitlementsInherit']) {
    const rel = pkg.build && pkg.build.mac && pkg.build.mac[key];
    if (typeof rel === 'string' && !fs.existsSync(path.join(repoRoot, rel))) {
      problems.push(`build.mac.${key} points at a missing file: ${rel}`);
    }
  }
  if (problems.length) {
    console.error('Packaging config validation FAILED:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log(`Packaging config OK: version ${pkg.version} (package.json authoritative, package-lock in sync), metadata, Linux + macOS + Windows targets, canonical artifact names, and release scripts all present.`);
}
