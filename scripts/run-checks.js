'use strict';
// Cross-platform, shell-independent syntax/check gate (`npm run check`).
//
// The gate used to be one ~8.5K-character `&&` chain inside the `check` npm
// script: `npm test && node --check main.js && node --check <179 more files>`.
// npm runs lifecycle scripts on Windows through cmd.exe, which refuses a command
// line longer than 8191 characters -- so Windows CI died with "The command line
// is too long" before running a single check, while Linux/bash happened to
// tolerate it. The chain also had to grow by hand for every new first-party
// file, and had already drifted: 72 tracked first-party files were never added.
//
// This runner keeps the same real checks but discovers the file set in Node and
// spawns every step as its own short-argv process, so no long command line is
// ever constructed and new first-party files are covered automatically.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// Directory trees scanned for first-party JavaScript. Anything outside this set
// (notably node_modules/ and the archived spikes/ technical-spike material) is
// not ours to syntax-check.
const SCAN_ROOTS = ['src', 'test', 'renderer', 'scripts', 'qa', '.github/scripts'];

// First-party JavaScript sitting at the repository root (not recursed).
const ROOT_FILES = ['main.js', 'preload.js', 'validator.js'];

// Repo-relative posix directory prefixes pruned from discovery:
//  - renderer/vendor: generated CodeMirror bundle, written by `npm run build:editor`.
//  - src/editor/browser: ESM source. package.json is "type": "commonjs", so
//    `node --check` parses .js as CommonJS and would reject its `import`
//    statements. esbuild parses it during `npm run build:editor`, which the CI
//    workflow runs immediately before this gate, so its syntax is still covered.
const EXCLUDED_DIRS = new Set([
  'renderer/vendor',
  'src/editor/browser',
]);

// Pruned wherever it appears, at any depth.
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git']);

const SYNTAX_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);

// Recursively collect syntax-check targets, returned as repo-relative posix
// paths in stable sorted order so the inventory is deterministic everywhere.
function discoverSyntaxTargets(root = ROOT) {
  const found = [];

  for (const rel of ROOT_FILES) {
    if (fs.existsSync(path.join(root, rel))) found.push(rel);
  }

  const walk = (relDir) => {
    if (EXCLUDED_DIRS.has(relDir)) return;
    const absDir = path.join(root, relDir);
    if (!fs.existsSync(absDir)) return;
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
        walk(path.posix.join(relDir, entry.name));
      } else if (entry.isFile() && SYNTAX_EXTENSIONS.has(path.extname(entry.name))) {
        found.push(path.posix.join(relDir, entry.name));
      }
    }
  };

  for (const scanRoot of SCAN_ROOTS) walk(scanRoot);

  return [...new Set(found)].sort();
}

// The ordered step list. Every step is {name, args} launched as
// `process.execPath <args...>` -- no shell, no concatenated command string.
// Tests preserved from the old chain: the suite runs first, exactly as
// `npm test` did (package.json "test" is `node scripts/run-tests.js`, with no
// pre/post hooks), then every discovered file gets `node --check`.
function buildPlan(root = ROOT) {
  const targets = discoverSyntaxTargets(root);
  const plan = [{ name: 'tests (node --test via scripts/run-tests.js)', args: ['scripts/run-tests.js'] }];
  for (const rel of targets) plan.push({ name: `node --check ${rel}`, args: ['--check', rel] });
  return plan;
}

function main() {
  const plan = buildPlan();
  const syntaxCount = plan.length - 1;
  console.log(`run-checks: 1 test step + ${syntaxCount} syntax targets (no shell, longest argv ${Math.max(...plan.map((s) => s.args.join(' ').length))} chars)`);

  // Step 1 (the test suite) is the expensive gate and gated the old `&&` chain,
  // so a failure there stops the run immediately, same as before.
  const [testStep, ...syntaxSteps] = plan;
  const testRes = spawnSync(process.execPath, testStep.args, { stdio: 'inherit', cwd: ROOT });
  if (testRes.error) {
    console.error(`run-checks: failed to launch ${testStep.name}: ${testRes.error.message}`);
    process.exit(1);
  }
  if (testRes.status !== 0) {
    console.error(`run-checks: FAILED at ${testStep.name} (exit ${testRes.status})`);
    process.exit(testRes.status == null ? 1 : testRes.status);
  }

  // Syntax checks are cheap and independent, so report every offender in one
  // pass instead of stopping at the first -- still non-zero exit on any failure.
  const failures = [];
  for (const step of syntaxSteps) {
    const res = spawnSync(process.execPath, step.args, { stdio: ['ignore', 'inherit', 'inherit'], cwd: ROOT });
    if (res.error) {
      console.error(`run-checks: failed to launch ${step.name}: ${res.error.message}`);
      failures.push(step.name);
    } else if (res.status !== 0) {
      console.error(`run-checks: FAILED ${step.name} (exit ${res.status})`);
      failures.push(step.name);
    }
  }

  if (failures.length) {
    console.error(`run-checks: ${failures.length} syntax check(s) FAILED:\n  ` + failures.join('\n  '));
    process.exit(1);
  }

  console.log(`run-checks: OK -- tests passed and ${syntaxCount} files parsed cleanly.`);
}

module.exports = { discoverSyntaxTargets, buildPlan, SCAN_ROOTS, ROOT_FILES, EXCLUDED_DIRS, EXCLUDED_DIR_NAMES, SYNTAX_EXTENSIONS };

if (require.main === module) main();
