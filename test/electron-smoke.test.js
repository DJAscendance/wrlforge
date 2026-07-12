'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');

// Launches the real app via the installed Electron binary, in a mode where
// main.js reports window/security state as one JSON line then quits itself
// (see the WRL_FORGE_SMOKE_TEST hook in main.js). No new dependency: the
// `electron` npm package's main export is the path to its native binary.
//
// Requires a display (X11/Wayland) or Xvfb. Skips rather than fails when
// neither is available, since this environment may be headless.
test('Electron launches, exposes the security posture, and exits cleanly', { timeout: 20_000 }, async (t) => {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    t.skip('no DISPLAY/WAYLAND_DISPLAY available in this environment');
    return;
  }

  const electronBinary = require('electron');
  const repoRoot = path.join(__dirname, '..');

  const result = await new Promise((resolve, reject) => {
    const child = spawn(electronBinary, ['.', '--no-sandbox'], {
      cwd: repoRoot,
      env: { ...process.env, WRL_FORGE_SMOKE_TEST: '1' },
    });

    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Electron smoke test timed out waiting for a result line'));
    }, 15_000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      const line = stdout.split('\n').find((l) => l.startsWith('WRL_FORGE_SMOKE_TEST_RESULT '));
      if (!line) {
        reject(new Error(`No smoke-test result line found. Exit code ${code}. stdout:\n${stdout}`));
        return;
      }
      resolve({ report: JSON.parse(line.slice('WRL_FORGE_SMOKE_TEST_RESULT '.length)), exitCode: code });
    });
  });

  assert.match(result.report.title, /^WRL Forge/);
  assert.equal(result.report.hasVrmlpadBridge, true);
  assert.equal(result.report.contextIsolation, true);
  assert.equal(result.report.nodeIntegration, false);
  // Phase 2B1 preview surface: container present, X_ITE engine initialised,
  // Original/Fit controls present, and the CSP meta tag in effect.
  assert.equal(result.report.hasPreviewCanvas, true, 'embedded preview canvas must exist');
  assert.equal(result.report.xiteLoaded, true, 'X_ITE engine must initialise');
  assert.equal(result.report.hasModeControls, true, 'Original/Fit controls must exist');
  assert.equal(result.report.hasCspMeta, true, 'Content-Security-Policy meta must be present');
  assert.equal(result.exitCode, 0);
});
