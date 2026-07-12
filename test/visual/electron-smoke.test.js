'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');

// VISUAL test -- launches the real Electron app. Excluded from `npm test`; runs
// only via `npm run test:visual` AND only when WRL_FORGE_ALLOW_VISUAL=1, so a
// routine test run can never open Electron windows. See docs/VISUAL_QA_SAFETY.md.
//
// main.js reports window/security state as one JSON line then quits itself (the
// WRL_FORGE_SMOKE_TEST hook). The `electron` npm package's main export is the
// path to its native binary -- no new dependency. Single, self-terminating spawn.
const allow = process.env.WRL_FORGE_ALLOW_VISUAL === '1';
const hasDisplay = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);

test('Electron launches, exposes the security posture, and exits cleanly', {
  timeout: 20_000,
  skip: !allow ? 'set WRL_FORGE_ALLOW_VISUAL=1 to run visual tests' : (!hasDisplay && 'no DISPLAY/WAYLAND_DISPLAY'),
}, async () => {
  const electronBinary = require('electron');
  const repoRoot = path.join(__dirname, '..', '..');

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

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      const line = stdout.split('\n').find((l) => l.startsWith('WRL_FORGE_SMOKE_TEST_RESULT '));
      if (!line) { reject(new Error(`No smoke-test result line found. Exit code ${code}. stdout:\n${stdout}`)); return; }
      resolve({ report: JSON.parse(line.slice('WRL_FORGE_SMOKE_TEST_RESULT '.length)), exitCode: code });
    });
  });

  assert.match(result.report.title, /^WRL Forge/);
  assert.equal(result.report.hasVrmlpadBridge, true);
  assert.equal(result.report.contextIsolation, true);
  assert.equal(result.report.nodeIntegration, false);
  assert.equal(result.report.hasPreviewCanvas, true, 'embedded preview canvas must exist');
  assert.equal(result.report.xiteLoaded, true, 'X_ITE engine must initialise');
  assert.equal(result.report.hasModeControls, true, 'Original/Fit controls must exist');
  assert.equal(result.report.hasCspMeta, true, 'Content-Security-Policy meta must be present');
  assert.equal(result.exitCode, 0);
});
