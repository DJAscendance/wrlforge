'use strict';
// Phase 7C4.1 — standalone workspace preflight, so shell-composed npm scripts
// (Windows builds) can refuse a UNC / network-drive / host-share workspace
// before electron-builder runs. On Linux this is a no-op and exits 0.
//
//   node qa/visual-qa/workspace-preflight.js [--label=build:win]

const path = require('path');
const { guardWindowsWorkspace } = require('./workspace-guard');
const { parseArgs } = require('./cli');

const repoRoot = path.join(__dirname, '..', '..');

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  guardWindowsWorkspace({ cwd: repoRoot, label: args.flags.label || 'preflight' });
  // guardWindowsWorkspace exits(2) on rejection; reaching here means OK.
  process.exit(0);
}
