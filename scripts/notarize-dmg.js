'use strict';
// electron-builder `afterAllArtifactBuild` hook: sign, notarize and staple the
// macOS DMG.
//
// WHY THIS EXISTS
// ---------------
// electron-builder notarizes and staples the .app, then builds the DMG *around*
// the already-stapled bundle. That is enough for Gatekeeper -- the app carries
// its own ticket, so both the DMG and ZIP download paths are accepted offline.
// But the DMG container itself is left unsigned, so a direct assessment of it
// reports:
//
//   WRL-Forge-<version>-mac-arm64.dmg: rejected
//   source=no usable signature
//
// Signing + notarizing + stapling the DMG gives the container its own ticket, so
// it resolves on its own without a round trip to Apple.
//
// ORDERING IS THE WHOLE TRICK
// ---------------------------
// electron-builder's `dmg.sign` option defaults to false and its documentation
// warns that DMG signing "will lead to unwanted errors in combination with
// notarization requirements". That warning applies to signing the DMG *before*
// the enclosed app is notarized. This hook runs after every artifact is built,
// so the app inside is already signed, notarized and stapled by then.
//
// CREDENTIALS
// -----------
// Never read, logged or stored here. notarytool is handed the same environment
// electron-builder itself uses -- APPLE_KEYCHAIN_PROFILE (a
// `notarytool store-credentials` profile), APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD
// + APPLE_TEAM_ID, or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER.
// Only the *argument names* are ever constructed here; no value is printed.
//
// FAIL CLOSED
// -----------
// This hook used to warn-and-continue on every failure, on the reasoning that
// the app's own ticket already gates the user experience. Independent QA
// rejected that: it lets `npm run dist:mac` exit 0 while publishing a DMG that
// is not fully trusted, and a release pipeline cannot tell the difference.
//
// So: once the build contract says a macOS DMG is expected, EVERY trust stage is
// mandatory. Signing, notarization, stapling and credential availability each
// throw on failure, which rejects the hook promise and fails the build.
//
// The no-op path is deliberately narrow and is derived from
// `buildResult.platformToTargets`, not guessed from the artifact list: if no mac
// DMG target was requested this hook is simply not responsible for a DMG and
// returns cleanly. A missing DMG when one WAS requested is itself a failure.

const { spawnSync } = require('child_process');

const DEFAULT_IDENTITY = 'Developer ID Application';

// Does the build contract expect a macOS DMG? Derived from the targets
// electron-builder actually resolved, so a Linux- or Windows-only invocation is
// a genuine no-op while a mac DMG build can never take the no-op path.
function macDmgExpected(buildResult) {
  const platformToTargets = buildResult && buildResult.platformToTargets;
  if (!platformToTargets || typeof platformToTargets.forEach !== 'function') return false;
  let expected = false;
  platformToTargets.forEach((targets, platform) => {
    if (!platform || platform.name !== 'mac' || !targets) return;
    if (typeof targets.has === 'function' && targets.has('dmg')) expected = true;
  });
  return expected;
}

// Returns notarytool credential ARGUMENTS, never credential values to a log.
function notarizeArgs(env) {
  const e = env || process.env;
  if (e.APPLE_KEYCHAIN_PROFILE) {
    const args = ['--keychain-profile', e.APPLE_KEYCHAIN_PROFILE];
    if (e.APPLE_KEYCHAIN) args.push('--keychain', e.APPLE_KEYCHAIN);
    return args;
  }
  if (e.APPLE_ID && e.APPLE_APP_SPECIFIC_PASSWORD && e.APPLE_TEAM_ID) {
    return ['--apple-id', e.APPLE_ID, '--password', e.APPLE_APP_SPECIFIC_PASSWORD, '--team-id', e.APPLE_TEAM_ID];
  }
  if (e.APPLE_API_KEY && e.APPLE_API_KEY_ID && e.APPLE_API_ISSUER) {
    return ['--key', e.APPLE_API_KEY, '--key-id', e.APPLE_API_KEY_ID, '--issuer', e.APPLE_API_ISSUER];
  }
  return null;
}

// Injectable factory so the fail-closed contract is provable without running
// codesign/notarytool/stapler and without sending anything to Apple.
function createHook(deps) {
  const options = deps || {};
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const log = options.log || console;
  const run = options.run
    || ((cmd, args) => spawnSync(cmd, args, { stdio: 'inherit' }));

  const exec = (stage, cmd, args) => {
    const result = run(cmd, args) || {};
    if (result.status !== 0) {
      throw new Error(`notarize-dmg: ${stage} (exit ${result.status === undefined ? 'unknown' : result.status})`);
    }
  };

  return async function afterAllArtifactBuild(buildResult) {
    // Not responsible for a DMG in this invocation -- the only valid no-op.
    if (!macDmgExpected(buildResult)) return [];

    if (platform !== 'darwin') {
      throw new Error(
        'notarize-dmg: a macOS DMG is expected but the build host is not darwin, '
        + 'so codesign/notarytool/stapler are unavailable and the DMG cannot be trusted'
      );
    }

    const dmgs = ((buildResult && buildResult.artifactPaths) || []).filter((p) => p.endsWith('.dmg'));
    if (!dmgs.length) {
      throw new Error('notarize-dmg: the build contract expects a macOS DMG but none was produced');
    }

    const creds = notarizeArgs(env);
    if (!creds) {
      throw new Error(
        'notarize-dmg: notarization credentials are unavailable -- set APPLE_KEYCHAIN_PROFILE, '
        + 'or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, '
        + 'or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER'
      );
    }

    for (const dmg of dmgs) {
      log.log(`notarize-dmg: signing ${dmg}`);
      // No explicit identity: electron-builder already resolved one from the
      // keychain to sign the app, and codesign applies the same discovery rules.
      // CSC_NAME pins it when the host holds more than one Developer ID.
      const signArgs = ['--force', '--timestamp', '--sign', env.CSC_NAME || DEFAULT_IDENTITY];
      exec(`DMG code signing failed for ${dmg}`, 'codesign', [...signArgs, dmg]);

      log.log(`notarize-dmg: submitting ${dmg} to Apple`);
      exec(`DMG notarization failed for ${dmg}`, 'xcrun', ['notarytool', 'submit', dmg, ...creds, '--wait']);

      // Stapling is also the second, independent gate on notarization: the
      // ticket simply does not exist to staple unless Apple accepted the
      // submission, so a non-Accepted result cannot slip past as a success.
      exec(`DMG stapling failed for ${dmg}`, 'xcrun', ['stapler', 'staple', dmg]);

      log.log(`notarize-dmg: ${dmg} signed, notarized and stapled`);
    }
    return [];
  };
}

module.exports = createHook();
module.exports.createHook = createHook;
module.exports.macDmgExpected = macDmgExpected;
module.exports.notarizeArgs = notarizeArgs;
