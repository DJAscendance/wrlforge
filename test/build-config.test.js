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
