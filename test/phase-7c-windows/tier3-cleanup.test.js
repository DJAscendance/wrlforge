'use strict';
// Tier-3 cleanup robustness regression test (Phase: Cross Platform Beta
// final QA enablement pass).
//
// The prior independent-QA finding "failed Windows install validation left a
// Start Menu shortcut" was caused by qa/phase-7c-windows/tier3-smoke.ps1
// aborting mid-run when the capture-server step crashed, leaving the
// uninstall step unreached. The fix wraps the install + capture phase in a
// PowerShell try/finally so the uninstall always runs.
//
// This test asserts the structural shape of the fix: a PowerShell try block
// that includes the install + capture phase, and a finally block that calls
// the uninstaller. It does NOT spawn a real NSIS install on a real
// Windows VM (sanctioned-environment work belongs on the Win11 guest, not
// in a Linux unit test). It DOES prove the script was corrected so a
// future run cannot regress to the prior uninstall-after-abort shape.
//
// We read the file via plain fs (the file is PowerShell text, not
// JavaScript), so no PowerShell host is required.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'qa', 'phase-7c-windows', 'tier3-smoke.ps1');

test('regression: tier3-smoke.ps1 wraps install + capture in try/finally', () => {
  const text = fs.readFileSync(SCRIPT, 'utf8');
  // The fix requires a try block before the capture-server call and a finally
  // block that calls the uninstaller. If either is missing, the prior bug
  // (Start Menu shortcut leftover on capture failure) returns.
  assert.match(text, /\btry\s*\{[\s\S]*silent per-user install[\s\S]*capture-server smoke[\s\S]*\}\s*finally\s*\{[\s\S]*Uninstall WRL Forge\.exe[\s\S]*uninstall/i,
    'tier3-smoke.ps1 must wrap install + capture in try/finally with uninstall in the finally');
});

test('regression: tier3-smoke.ps1 catches the capture-server throw so the script does not bail', () => {
  const text = fs.readFileSync(SCRIPT, 'utf8');
  // The capture step is wrapped in its own try/catch so a launcher error
  // (process-singleton lock conflict, etc.) is logged as a step but does
  // not propagate out of the try block. This is what lets the finally
  // block always run.
  assert.match(text, /try\s*\{[\s\S]*capture-server[\s\S]*\}\s*catch\s*\{[\s\S]*\$script:smokeOk\s*=\s*\$false/s,
    'tier3-smoke.ps1 must try/catch the capture-server invocation');
});

test('regression: tier3-smoke.ps1 reports cleanup state in the summary', () => {
  const text = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(text, /shortcutRemovedAfterUninstall/);
  assert.match(text, /exeRemovedAfterUninstall/);
});