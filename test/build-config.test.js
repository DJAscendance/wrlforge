'use strict';
// Regression guard for .github/scripts/validate-build-config.js.
//
// The Ubuntu CI job failed for five commits because that script hard-coded
// `req(pkg.version === '1.3.0-beta.3', ...)` while package.json had moved to
// 1.3.0-beta.5. The repair makes package.json the single version authority and
// validates package-lock against it instead of against a literal. These tests
// prove the literal is gone and the relationship is enforced.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { validate } = require('../.github/scripts/validate-build-config.js');

const ROOT = path.join(__dirname, '..');
const realPkg = require('../package.json');
const realLock = require('../package-lock.json');

const clone = (o) => JSON.parse(JSON.stringify(o));

// A matching pkg/lock pair at an arbitrary version, so no test depends on
// whatever version the repository currently ships.
function pairAt(version) {
  const pkg = clone(realPkg);
  const lock = clone(realLock);
  pkg.version = version;
  lock.version = version;
  lock.packages[''].version = version;
  return { pkg, lock };
}

test('the real repository manifests pass validation', () => {
  assert.deepStrictEqual(validate(realPkg, realLock), []);
});

test('package.json is the version authority and package-lock mirrors it', () => {
  assert.strictEqual(realLock.version, realPkg.version);
  assert.strictEqual(realLock.packages[''].version, realPkg.version);
  assert.strictEqual(realLock.name, realPkg.name);
  assert.strictEqual(realLock.packages[''].name, realPkg.name);
});

test('the current intended version 1.4.0 passes', () => {
  const { pkg, lock } = pairAt('1.4.0');
  assert.deepStrictEqual(validate(pkg, lock), []);
});

test('no stale beta.3 constant controls the result', () => {
  // The old script only accepted 1.3.0-beta.3. Any self-consistent version must
  // now pass -- including beta.3 itself, which must not be *required*.
  for (const v of ['1.3.0-beta.3', '1.3.0-beta.5', '1.3.0-beta.9', '1.3.0', '2.0.0-rc.1', '10.20.30']) {
    const { pkg, lock } = pairAt(v);
    assert.deepStrictEqual(validate(pkg, lock), [], `version ${v} should pass when lock agrees`);
  }

  // And the literal must not appear in the script source at all.
  const src = fs.readFileSync(path.join(ROOT, '.github/scripts/validate-build-config.js'), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!code.includes('1.3.0-beta.3'),
    'validate-build-config.js must not pin a hard-coded expected version');
  assert.ok(!code.includes('1.3.0-beta.5'),
    'validate-build-config.js must not pin a hard-coded expected version');
});

test('a package-lock root version mismatch fails (the beta.3/beta.5 drift)', () => {
  const { pkg, lock } = pairAt('1.3.0-beta.5');
  lock.version = '1.3.0-beta.3';
  const problems = validate(pkg, lock);
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /package-lock\.json "version" must match package\.json \(1\.3\.0-beta\.5\), got "1\.3\.0-beta\.3"/);
});

test('a packages[""] version mismatch fails independently', () => {
  const { pkg, lock } = pairAt('1.3.0-beta.5');
  lock.packages[''].version = '1.3.0-beta.3';
  const problems = validate(pkg, lock);
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /packages\[""\]\.version must match package\.json/);
});

test('both lock version fields drifting reports both problems', () => {
  const { pkg, lock } = pairAt('1.3.0-beta.5');
  lock.version = '1.3.0-beta.3';
  lock.packages[''].version = '1.3.0-beta.3';
  assert.strictEqual(validate(pkg, lock).length, 2);
});

test('name and license drift between package.json and package-lock fails', () => {
  {
    const { pkg, lock } = pairAt('1.3.0-beta.5');
    lock.name = 'something-else';
    assert.match(validate(pkg, lock).join('\n'), /package-lock\.json "name" must match/);
  }
  {
    const { pkg, lock } = pairAt('1.3.0-beta.5');
    lock.packages[''].license = 'MIT';
    assert.match(validate(pkg, lock).join('\n'), /license must match package\.json/);
  }
});

test('a malformed version fails semver validation', () => {
  for (const bad of ['', 'beta.5', '1.3', 'v1.3.0', undefined, null, 5]) {
    const { pkg, lock } = pairAt('1.3.0-beta.5');
    pkg.version = bad;
    lock.version = bad;
    lock.packages[''].version = bad;
    assert.match(validate(pkg, lock).join('\n'), /must be valid semver/, `${JSON.stringify(bad)} should be rejected`);
  }
});

test('the preserved packaging invariants still fail when broken', () => {
  // The repair must not have weakened the existing artifact/target checks.
  const cases = [
    [(p) => { p.author = 'Someone Else'; }, /author must be/],
    [(p) => { p.license = 'MIT'; }, /license must be GPL-3\.0-or-later/],
    [(p) => { p.homepage = 'http://example.com'; }, /homepage must be/],
    [(p) => { p.build.copyright = 'nope'; }, /build\.copyright must be/],
    [(p) => { p.build.linux.target = [{ target: 'tar.gz' }]; }, /linux target AppImage missing/],
    [(p) => { p.build.linux.target = [{ target: 'AppImage' }]; }, /linux target tar\.gz missing/],
    [(p) => { p.build.appImage.artifactName = 'wrong.AppImage'; }, /appImage\.artifactName not canonical/],
    [(p) => { p.build.win.target = [{ target: 'nsis' }, { target: 'msi' }]; }, /windows target portable missing/],
    [(p) => { p.build.nsis.artifactName = 'wrong.exe'; }, /nsis\.artifactName not canonical/],
    [(p) => { p.build.msi.artifactName = 'wrong.msi'; }, /msi\.artifactName not canonical/],
    [(p) => { p.build.portable.artifactName = 'wrong.exe'; }, /portable\.artifactName not canonical/],
    [(p) => { p.build.artifactName = 'wrong'; }, /global build\.artifactName not canonical/],
    [(p) => { delete p.scripts.check; }, /npm script "check" missing/],
    [(p) => { delete p.scripts['build:editor']; }, /npm script "build:editor" missing/],
    [(p) => { delete p.scripts['dist:linux']; }, /npm script "dist:linux" missing/],
  ];

  for (const [mutate, expected] of cases) {
    const { pkg, lock } = pairAt('1.3.0-beta.5');
    mutate(pkg);
    assert.match(validate(pkg, lock).join('\n'), expected);
  }
});

test('validation is pure: it does not mutate the manifests it is given', () => {
  const { pkg, lock } = pairAt('1.3.0-beta.5');
  const pkgSnapshot = JSON.stringify(pkg);
  const lockSnapshot = JSON.stringify(lock);
  validate(pkg, lock);
  assert.strictEqual(JSON.stringify(pkg), pkgSnapshot);
  assert.strictEqual(JSON.stringify(lock), lockSnapshot);
});

// --- macOS Developer ID signing contract -------------------------------------
//
// WRL Forge 1.4.0's final three-platform RC was blocked because the macOS
// bundle carried no valid Developer ID seal: a downloaded copy is quarantined,
// and Gatekeeper reports "WRL Forge.app is damaged and can't be opened". The
// cause was configuration, not code -- `identity: null`, `hardenedRuntime:
// false`, `notarize: false`. These tests pin the corrected posture so it cannot
// silently revert to the developer-only one.

test('the shipped macOS config declares the signed public posture', () => {
  const mac = realPkg.build.mac;
  assert.strictEqual(mac.hardenedRuntime, true, 'Hardened Runtime must be on');
  assert.strictEqual(mac.notarize, true, 'notarization must be on');
  assert.ok(!('identity' in mac),
    'build.mac.identity must be absent so the Developer ID identity is discovered');
  assert.strictEqual(mac.entitlements, 'assets/entitlements.mac.plist');
  assert.strictEqual(mac.entitlementsInherit, 'assets/entitlements.mac.inherit.plist');
});

// Strip XML comment blocks only. Line-based filtering used to drop any indented
// line, which could hide a real forbidden entitlement from the assertion below.
function stripXmlComments(xml) {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

test('the declared entitlement plists exist and grant only the Electron minimum', () => {
  for (const rel of [realPkg.build.mac.entitlements, realPkg.build.mac.entitlementsInherit]) {
    const file = path.join(ROOT, rel);
    assert.ok(fs.existsSync(file), `${rel} must exist`);
    const xml = fs.readFileSync(file, 'utf8');

    // Required: V8 cannot run under Hardened Runtime without these two.
    assert.match(xml, /com\.apple\.security\.cs\.allow-jit/, `${rel} must allow JIT`);
    assert.match(xml, /com\.apple\.security\.cs\.allow-unsigned-executable-memory/,
      `${rel} must allow unsigned executable memory`);

    // Forbidden without a measured failure proving the need. get-task-allow in
    // particular makes the build un-notarizable.
    const body = stripXmlComments(xml);
    for (const forbidden of [
      'com.apple.security.cs.disable-library-validation',
      'com.apple.security.get-task-allow',
      'com.apple.security.app-sandbox',
    ]) {
      assert.ok(!body.includes(forbidden), `${rel} must not grant ${forbidden}`);
    }
  }
});

test('the entitlement comment strip ignores comments but keeps indented plist content', () => {
  const forbidden = 'com.apple.security.get-task-allow';
  const commented = `<dict>\n  <!--\n    <key>${forbidden}</key>\n    <true/>\n  -->\n  <key>com.apple.security.cs.allow-jit</key>\n  <true/>\n</dict>\n`;
  assert.ok(!stripXmlComments(commented).includes(forbidden),
    'a forbidden entitlement inside a comment must not be treated as granted');
  assert.ok(stripXmlComments(commented).includes('com.apple.security.cs.allow-jit'),
    'normal indented plist content must survive the strip');

  const granted = `<dict>\n  <key>${forbidden}</key>\n  <true/>\n</dict>\n`;
  assert.ok(stripXmlComments(granted).includes(forbidden),
    'a forbidden entitlement in normal indented XML must still be detected');
});

test('only the inherit plist carries com.apple.security.inherit', () => {
  const parent = fs.readFileSync(path.join(ROOT, realPkg.build.mac.entitlements), 'utf8');
  const child = fs.readFileSync(path.join(ROOT, realPkg.build.mac.entitlementsInherit), 'utf8');
  assert.match(child, /com\.apple\.security\.inherit/,
    'helper entitlements must inherit the parent runtime posture');
  assert.ok(!parent.includes('com.apple.security.inherit'),
    'the top-level app must not declare inherit');
});

test('regressing any part of the macOS signing posture fails validation', () => {
  const cases = [
    // The exact three settings that caused the 1.4.0 blocker.
    [(p) => { p.build.mac.identity = null; }, /must not disable signing/],
    [(p) => { p.build.mac.hardenedRuntime = false; }, /must enable hardenedRuntime/],
    [(p) => { delete p.build.mac.hardenedRuntime; }, /must enable hardenedRuntime/],
    [(p) => { p.build.mac.notarize = false; }, /must enable notarization/],
    [(p) => { delete p.build.mac.notarize; }, /must enable notarization/],
    // Entitlements are part of the contract, not an optional extra.
    [(p) => { delete p.build.mac.entitlements; }, /entitlements path not canonical/],
    [(p) => { delete p.build.mac.entitlementsInherit; }, /inherited entitlements path not canonical/],
    [(p) => { p.build.mac.entitlements = 'assets/wrong.plist'; }, /entitlements path not canonical/],
    [(p) => { p.build.mac.entitlementsInherit = 'assets/wrong.plist'; }, /inherited entitlements path not canonical/],
    // Pre-existing macOS rules must not have been weakened by the repair.
    [(p) => { p.build.mac.target = [{ target: 'zip', arch: ['arm64'] }]; }, /macOS target dmg missing/],
    [(p) => { p.build.mac.target = [{ target: 'dmg', arch: ['arm64'] }]; }, /macOS target zip missing/],
    [(p) => { p.build.mac.target = [{ target: 'dmg', arch: ['x64'] }, { target: 'zip', arch: ['arm64'] }]; }, /must include arm64/],
    [(p) => { p.build.mac.icon = 'assets/wrong.png'; }, /macOS icon path not canonical/],
    // The DMG trust hook is part of the signing posture: electron-builder does
    // not sign the DMG container itself, so losing this wiring silently ships a
    // DMG that assesses as "no usable signature".
    [(p) => { delete p.build.afterAllArtifactBuild; }, /afterAllArtifactBuild must wire/],
    [(p) => { p.build.afterAllArtifactBuild = 'scripts/something-else.js'; }, /afterAllArtifactBuild must wire/],
  ];

  for (const [mutate, expected] of cases) {
    const { pkg, lock } = pairAt('1.4.0');
    mutate(pkg);
    assert.match(validate(pkg, lock).join('\n'), expected);
  }
});

test('a literal Developer ID identity name is permitted, null is not', () => {
  // The contract forbids the "do not sign" switch, not pinning a specific
  // certificate -- a CI lane may need an explicit identity string.
  const { pkg, lock } = pairAt('1.4.0');
  pkg.build.mac.identity = 'Developer ID Application: Example (ABCDE12345)';
  assert.deepStrictEqual(validate(pkg, lock), []);

  const nulled = pairAt('1.4.0');
  nulled.pkg.build.mac.identity = null;
  assert.match(validate(nulled.pkg, nulled.lock).join('\n'), /must not disable signing/);
});

test('Linux and Windows signing rules are untouched by the macOS change', () => {
  // build-dist.js keeps Linux deterministically unsigned; the macOS repair must
  // not have leaked a signing posture into the other two platforms.
  const src = fs.readFileSync(path.join(ROOT, 'scripts/build-dist.js'), 'utf8');
  assert.match(src, /CSC_IDENTITY_AUTO_DISCOVERY/,
    'build-dist.js must still control signing discovery');
  assert.ok(!/^\s*const env = \{ \.\.\.process\.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' \};/m.test(src),
    'discovery must no longer be forced off unconditionally (that blocked macOS signing)');

  // Neither platform block gains mac-only signing keys.
  for (const plat of ['linux', 'win']) {
    for (const key of ['hardenedRuntime', 'notarize', 'entitlements', 'entitlementsInherit']) {
      assert.ok(!(key in (realPkg.build[plat] || {})),
        `build.${plat} must not declare macOS signing key ${key}`);
    }
  }
});
