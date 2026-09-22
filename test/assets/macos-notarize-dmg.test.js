'use strict';

// Fail-closed contract for the macOS DMG trust hook.
//
// Independent QA rejected the hook's original warn-and-continue design
// (MACOS_RELEASE_TRUST_FAILURE_CAN_FAIL_OPEN): `npm run dist:mac` could exit 0
// while shipping a DMG that was not signed, not notarized or not stapled.
//
// Every command is injected, so each trust stage is proven to reject without
// running codesign, contacting Apple, or submitting anything bad to notarytool.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createHook, macDmgExpected, notarizeArgs } = require('../../scripts/notarize-dmg.js');

const DMG = '/tmp/out/WRL-Forge-1.4.0-mac-arm64.dmg';
const ZIP = '/tmp/out/WRL-Forge-1.4.0-mac-arm64.zip';

const macPlatform = { name: 'mac' };
const linuxPlatform = { name: 'linux' };

// Mirrors electron-builder's BuildResult: platformToTargets is a
// Map<Platform, Map<targetName, Target>>.
function buildResult({ targets = ['dmg', 'zip'], platform = macPlatform, artifactPaths = [DMG, ZIP] } = {}) {
  const targetMap = new Map(targets.map((t) => [t, { name: t }]));
  return {
    outDir: '/tmp/out',
    artifactPaths,
    platformToTargets: new Map([[platform, targetMap]]),
    configuration: {},
  };
}

const CREDS = { APPLE_KEYCHAIN_PROFILE: 'test-profile' };
const silent = { log() {}, warn() {}, error() {} };

// A recorder that succeeds everywhere except the named stage.
function recorder(failAt) {
  const calls = [];
  const run = (cmd, args) => {
    const stage = cmd === 'codesign' ? 'codesign' : args[0];
    calls.push({ cmd, stage, args });
    return { status: stage === failAt ? 1 : 0 };
  };
  return { run, calls };
}

const hookWith = (run, extra = {}) => createHook({
  run, env: { ...CREDS }, platform: 'darwin', log: silent, ...extra,
});

test('a successful trust sequence resolves and runs all three stages in order', async () => {
  const { run, calls } = recorder(null);
  const result = await hookWith(run)(buildResult());
  assert.deepEqual(result, []);
  assert.deepEqual(calls.map((c) => c.stage), ['codesign', 'notarytool', 'stapler']);
  // The ZIP is electron-builder's job, not this hook's.
  assert.ok(calls.every((c) => !c.args.includes(ZIP)), 'hook must not touch the ZIP');
});

test('codesign failure rejects the hook and fails the build', async () => {
  const { run, calls } = recorder('codesign');
  await assert.rejects(
    hookWith(run)(buildResult()),
    /DMG code signing failed/,
  );
  // It must stop there -- never notarize or staple an unsigned DMG.
  assert.deepEqual(calls.map((c) => c.stage), ['codesign']);
});

test('notarization failure rejects the hook and fails the build', async () => {
  const { run, calls } = recorder('notarytool');
  await assert.rejects(
    hookWith(run)(buildResult()),
    /DMG notarization failed/,
  );
  assert.deepEqual(calls.map((c) => c.stage), ['codesign', 'notarytool']);
});

test('stapling failure rejects the hook and fails the build', async () => {
  const { run, calls } = recorder('stapler');
  await assert.rejects(
    hookWith(run)(buildResult()),
    /DMG stapling failed/,
  );
  assert.deepEqual(calls.map((c) => c.stage), ['codesign', 'notarytool', 'stapler']);
});

test('missing credentials reject instead of silently skipping notarization', async () => {
  const { run, calls } = recorder(null);
  await assert.rejects(
    createHook({ run, env: {}, platform: 'darwin', log: silent })(buildResult()),
    /notarization credentials are unavailable/,
  );
  assert.equal(calls.length, 0, 'must not sign a DMG it cannot notarize');
});

test('a required DMG missing from the artifacts rejects', async () => {
  const { run } = recorder(null);
  await assert.rejects(
    hookWith(run)(buildResult({ artifactPaths: [ZIP] })),
    /expects a macOS DMG but none was produced/,
  );
});

test('a mac DMG build on a non-darwin host rejects rather than shipping untrusted', async () => {
  const { run } = recorder(null);
  await assert.rejects(
    hookWith(run, { platform: 'linux' })(buildResult()),
    /build host is not darwin/,
  );
});

test('an error never contains a credential value', async () => {
  const { run } = recorder('notarytool');
  const env = { APPLE_ID: 'someone@example.com', APPLE_APP_SPECIFIC_PASSWORD: 'abcd-efgh-ijkl-mnop', APPLE_TEAM_ID: 'PV35EC2TRY' };
  await assert.rejects(
    createHook({ run, env, platform: 'darwin', log: silent })(buildResult()),
    (err) => {
      assert.ok(!err.message.includes('abcd-efgh-ijkl-mnop'), 'error leaked the app-specific password');
      return true;
    },
  );
});

// --- the narrow, legitimate no-op paths -------------------------------------

test('a build with no mac DMG target is a clean no-op', async () => {
  const { run, calls } = recorder(null);
  const result = await hookWith(run)(buildResult({ platform: linuxPlatform, targets: ['AppImage'], artifactPaths: ['/tmp/out/app.AppImage'] }));
  assert.deepEqual(result, []);
  assert.equal(calls.length, 0);
});

test('a mac zip-only build is a clean no-op', async () => {
  const { run, calls } = recorder(null);
  const result = await hookWith(run)(buildResult({ targets: ['zip'], artifactPaths: [ZIP] }));
  assert.deepEqual(result, []);
  assert.equal(calls.length, 0);
});

test('a no-op is decided by the requested targets, not by the artifact list', async () => {
  // A stray .dmg in artifactPaths must not make the hook responsible for it,
  // and a requested dmg target must not be excused by a missing artifact.
  const { run, calls } = recorder(null);
  await hookWith(run)(buildResult({ targets: ['zip'], artifactPaths: [DMG, ZIP] }));
  assert.equal(calls.length, 0, 'unrequested dmg must not be signed');

  await assert.rejects(
    hookWith(run)(buildResult({ targets: ['dmg'], artifactPaths: [ZIP] })),
    /none was produced/,
  );
});

test('macDmgExpected tolerates a malformed or absent build result', () => {
  assert.equal(macDmgExpected(undefined), false);
  assert.equal(macDmgExpected({}), false);
  assert.equal(macDmgExpected({ platformToTargets: null }), false);
});

// --- credentials ------------------------------------------------------------

test('notarizeArgs supports all three credential methods and none otherwise', () => {
  assert.deepEqual(notarizeArgs({ APPLE_KEYCHAIN_PROFILE: 'p' }), ['--keychain-profile', 'p']);
  assert.deepEqual(notarizeArgs({ APPLE_KEYCHAIN_PROFILE: 'p', APPLE_KEYCHAIN: '/k' }),
    ['--keychain-profile', 'p', '--keychain', '/k']);
  assert.deepEqual(notarizeArgs({ APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'b', APPLE_TEAM_ID: 'c' }),
    ['--apple-id', 'a', '--password', 'b', '--team-id', 'c']);
  assert.deepEqual(notarizeArgs({ APPLE_API_KEY: 'k', APPLE_API_KEY_ID: 'i', APPLE_API_ISSUER: 's' }),
    ['--key', 'k', '--key-id', 'i', '--issuer', 's']);
  assert.equal(notarizeArgs({}), null);
  // A partial Apple ID set is not a credential method -- it must not fall
  // through into a half-populated command line.
  assert.equal(notarizeArgs({ APPLE_ID: 'a', APPLE_TEAM_ID: 'c' }), null);
});

test('CSC_NAME pins the signing identity, otherwise Developer ID Application', async () => {
  let signed;
  const run = (cmd, args) => {
    if (cmd === 'codesign') signed = args[args.indexOf('--sign') + 1];
    return { status: 0 };
  };
  await createHook({ run, env: { ...CREDS }, platform: 'darwin', log: silent })(buildResult());
  assert.equal(signed, 'Developer ID Application');

  await createHook({ run, env: { ...CREDS, CSC_NAME: 'Developer ID Application: Wayne Bundy (PV35EC2TRY)' }, platform: 'darwin', log: silent })(buildResult());
  assert.equal(signed, 'Developer ID Application: Wayne Bundy (PV35EC2TRY)');
});

test('the hook module is directly callable by electron-builder', () => {
  const hook = require('../../scripts/notarize-dmg.js');
  assert.equal(typeof hook, 'function');
  assert.equal(typeof hook.createHook, 'function');
});

test('the hook source contains no warn-and-continue trust path', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'scripts', 'notarize-dmg.js'), 'utf8');
  // `continue` as a STATEMENT inside the artifact loop was exactly the
  // fail-open bug. Match the statement, not the word, so prose about it in the
  // header comment does not trip the scan.
  assert.ok(!/^\s*continue\s*;/m.test(src), 'a `continue` in the trust loop reintroduces fail-open');
  assert.ok(!/console\.warn\s*\(/.test(src), 'trust failures must throw, not warn');
});
