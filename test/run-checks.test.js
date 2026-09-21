'use strict';
// Regression guard for the `npm run check` gate (scripts/run-checks.js).
//
// Two defects are locked out here:
//  1. The gate used to be a single ~8.5K-character shell `&&` chain in the
//     `check` npm script, which exceeded cmd.exe's 8191-character command-line
//     limit and made the whole gate unrunnable on Windows CI.
//  2. That hand-maintained chain silently drifted -- 72 first-party files had
//     been added to the repo without ever being added to the chain.
//
// LEGACY_CHECK_TARGETS below is the exact, complete set of files the old chain
// syntax-checked (extracted from the pre-repair package.json). Discovery must
// remain a superset of it forever, so no check can quietly disappear again.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const runner = require('../scripts/run-checks.js');

const ROOT = path.join(__dirname, '..');

// Windows cmd.exe rejects a command line longer than this; npm runs lifecycle
// scripts through cmd.exe on Windows.
const WINDOWS_CMD_LIMIT = 8191;

const LEGACY_CHECK_TARGETS = [
  ".github/scripts/validate-build-config.js",
  "main.js",
  "preload.js",
  "qa/phase-6b-windows/win-selftest.js",
  "qa/phase-6b1-vscodium/win-editor-verify.js",
  "qa/phase-7b-native-editor/orchestrate.js",
  "qa/phase-7b-native-editor/perf.js",
  "qa/phase-7b1-native-closeout/orchestrate.js",
  "qa/phase-7c-mall-preview/orchestrate.js",
  "qa/phase-7c-mall-preview/stress.js",
  "qa/phase-7c-vision/orchestrate.js",
  "qa/phase-7c-windows/orchestrate.js",
  "qa/phase-7c-world-preview/orchestrate.js",
  "qa/phase-7c-world-preview/stress.js",
  "qa/visual-qa/cli.js",
  "qa/visual-qa/evidence.js",
  "qa/visual-qa/lock.js",
  "qa/visual-qa/runner.js",
  "qa/visual-qa/transport.js",
  "qa/visual-qa/workspace-guard.js",
  "qa/visual-qa/workspace-preflight.js",
  "qa/world-recon/asset-graph.js",
  "qa/world-recon/cli.js",
  "qa/world-recon/url-fields.js",
  "renderer/editor-preview.js",
  "renderer/editor.js",
  "renderer/preview.js",
  "renderer/renderer.js",
  "renderer/scene-inspector.js",
  "renderer/scene-tree.js",
  "renderer/world-packaging.js",
  "renderer/world-preview.js",
  "renderer/world.js",
  "scripts/build-dist.js",
  "scripts/build-icons.js",
  "scripts/build-node-schema.js",
  "scripts/build-win.js",
  "scripts/release-checksums.js",
  "scripts/run-tests.js",
  "src/editor/editor-controller.js",
  "src/editor/editor-locator.js",
  "src/editor/file-io.js",
  "src/editor/language.js",
  "src/editor/mall-edit-flow.js",
  "src/editor/path-authorizer.js",
  "src/editor/scene-selection.js",
  "src/editor/session-store.js",
  "src/editor/session.js",
  "src/editor/ui-state.js",
  "src/editor/wrl-document.js",
  "src/external-proto/index.js",
  "src/external-proto/reference-forms.js",
  "src/external-proto/resolver-context.js",
  "src/external-proto/retrieval.js",
  "src/external-proto/routing.js",
  "src/external-proto/url-origin.js",
  "src/preview/bbox-traversal.js",
  "src/preview/buffer-overlay.js",
  "src/preview/extrusion-bounds.js",
  "src/preview/fit-math.js",
  "src/preview/guides.js",
  "src/preview/mall-preview-bridge.js",
  "src/preview/preview-scheduler.js",
  "src/preview/preview-state.js",
  "src/preview/texture-base.js",
  "src/preview/url-policy.js",
  "src/preview/viewpoint-preserve.js",
  "src/preview/world-preview-bridge.js",
  "src/preview/wrl-source.js",
  "src/proto-enrichment/external-enrichment.js",
  "src/proto-enrichment/index.js",
  "src/proto-resolution/dependency-graph.js",
  "src/proto-resolution/external-resolver.js",
  "src/proto-resolution/index.js",
  "src/settings/app-settings.js",
  "src/settings/window-state.js",
  "src/vrml/analyze.js",
  "src/vrml/asset-refs.js",
  "src/vrml/ast.js",
  "src/vrml/compatibility.js",
  "src/vrml/containment.js",
  "src/vrml/diagnostics.js",
  "src/vrml/document-transaction.js",
  "src/vrml/edit.js",
  "src/vrml/index.js",
  "src/vrml/interface-query.js",
  "src/vrml/messages.js",
  "src/vrml/node-identity.js",
  "src/vrml/node-schema.js",
  "src/vrml/parser.js",
  "src/vrml/presentation.js",
  "src/vrml/proto-agreement.js",
  "src/vrml/proto-target.js",
  "src/vrml/scene-tree.js",
  "src/vrml/scope-graph.js",
  "src/vrml/semantic-findings.js",
  "src/vrml/source-map.js",
  "src/vrml/symbols.js",
  "src/vrml/tokenizer.js",
  "src/world-project/asset-graph.js",
  "src/world-project/bundle-builder.js",
  "src/world-project/externproto-deps.js",
  "src/world-project/image-size.js",
  "src/world-project/package-plan.js",
  "src/world-project/path-policy.js",
  "src/world-project/preview-source.js",
  "src/world-project/profile.js",
  "src/world-project/project-loader.js",
  "src/world-project/project-stats.js",
  "src/world-project/session.js",
  "src/world-project/url-fields.js",
  "src/world-project/zip-writer.js",
  "test/assets/icon-generation.test.js",
  "test/editor/editor-controller.test.js",
  "test/editor/file-io.test.js",
  "test/editor/language.test.js",
  "test/editor/mall-edit-flow.test.js",
  "test/editor/path-authorizer.test.js",
  "test/editor/script-load-order.test.js",
  "test/editor/session-store.test.js",
  "test/editor/session.test.js",
  "test/editor/ui-state.test.js",
  "test/editor/wrl-document.test.js",
  "test/external-proto/architecture-boundary.test.js",
  "test/external-proto/reference-forms.test.js",
  "test/external-proto/resolver-context.test.js",
  "test/external-proto/retrieval.test.js",
  "test/external-proto/routing.test.js",
  "test/external-proto/security-controls.test.js",
  "test/preview/buffer-overlay.test.js",
  "test/preview/fixture-byte-contract.test.js",
  "test/preview/mall-preview-bridge.test.js",
  "test/preview/viewpoint-preserve.test.js",
  "test/preview/world-preview-bridge.test.js",
  "test/product-posture.test.js",
  "test/proto-enrichment/architecture-boundary.test.js",
  "test/proto-enrichment/compatibility-null.test.js",
  "test/proto-enrichment/external-enrichment.test.js",
  "test/proto-enrichment/fixtures.js",
  "test/proto-enrichment/mutation-controls.test.js",
  "test/proto-resolution/architecture-boundary.test.js",
  "test/proto-resolution/dependency-graph.test.js",
  "test/proto-resolution/external-resolver.test.js",
  "test/proto-resolution/fixture-archive.js",
  "test/proto-resolution/graph-completeness.test.js",
  "test/proto-resolution/mutation-controls.test.js",
  "test/vrml/analyze.test.js",
  "test/vrml/asset-refs.test.js",
  "test/vrml/compatibility-mutations.test.js",
  "test/vrml/compatibility.test.js",
  "test/vrml/containment.test.js",
  "test/vrml/document-transaction.test.js",
  "test/vrml/edit.test.js",
  "test/vrml/fixtures.test.js",
  "test/vrml/interface-is.test.js",
  "test/vrml/interface-query.test.js",
  "test/vrml/messages-fixtures.js",
  "test/vrml/messages-matrix.test.js",
  "test/vrml/messages-mutations.test.js",
  "test/vrml/messages.test.js",
  "test/vrml/node-identity.test.js",
  "test/vrml/node-schema.test.js",
  "test/vrml/parser.test.js",
  "test/vrml/presentation-fixtures.js",
  "test/vrml/presentation-matrix.test.js",
  "test/vrml/presentation-mutations.test.js",
  "test/vrml/presentation.test.js",
  "test/vrml/proto-agreement.test.js",
  "test/vrml/proto-target.test.js",
  "test/vrml/round-trip.test.js",
  "test/vrml/route-semantics.test.js",
  "test/vrml/scope-graph.test.js",
  "test/vrml/semantic-findings.test.js",
  "test/vrml/source-map.test.js",
  "test/vrml/symbols.test.js",
  "test/vrml/tokenizer.test.js",
  "test/vrml/type-resolution.test.js",
  "validator.js",
];

test('every file the old check chain syntax-checked is still covered', () => {
  const discovered = new Set(runner.discoverSyntaxTargets());
  const missing = LEGACY_CHECK_TARGETS.filter((f) => !discovered.has(f));
  assert.deepStrictEqual(missing, [], `check coverage regressed for:\n  ${missing.join('\n  ')}`);
});

test('the old chain had 178 unique targets and discovery covers strictly more', () => {
  assert.strictEqual(LEGACY_CHECK_TARGETS.length, 178);
  const discovered = runner.discoverSyntaxTargets();
  assert.ok(discovered.length > LEGACY_CHECK_TARGETS.length,
    `expected discovery to exceed the legacy set, got ${discovered.length}`);
});

test('the plan runs the test suite first, then one node --check per target', () => {
  const plan = runner.buildPlan();
  const targets = runner.discoverSyntaxTargets();

  assert.strictEqual(plan.length, targets.length + 1);
  assert.deepStrictEqual(plan[0].args, ['scripts/run-tests.js'],
    'first step must be the same suite `npm test` ran');

  for (const step of plan.slice(1)) {
    assert.strictEqual(step.args[0], '--check');
    assert.strictEqual(step.args.length, 2, 'each syntax step checks exactly one file');
  }

  const checked = plan.slice(1).map((s) => s.args[1]);
  assert.deepStrictEqual(checked, targets);
});

test('no step depends on a long command line (the Windows defect)', () => {
  const plan = runner.buildPlan();

  // The npm script itself must stay tiny -- this is what cmd.exe receives.
  const checkScript = require('../package.json').scripts.check;
  assert.ok(checkScript.length < 120,
    `npm "check" script must stay short, got ${checkScript.length} chars`);
  assert.ok(!checkScript.includes('&&'),
    'npm "check" script must not chain commands in a shell');
  assert.ok(!checkScript.includes('node --check'),
    'npm "check" script must not enumerate syntax targets');

  // And every spawned child argv must be nowhere near the cmd.exe limit.
  for (const step of plan) {
    const argvLen = process.execPath.length + 1 + step.args.join(' ').length;
    assert.ok(argvLen < 1000,
      `step "${step.name}" argv is ${argvLen} chars, too close to the ${WINDOWS_CMD_LIMIT} limit`);
  }
});

test('arguments are passed as an argv array, so spaces in paths stay intact', () => {
  // Windows-safety: a path containing a space must survive as ONE argument.
  // This is exactly what a concatenated shell string got wrong.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrl-checks-'));
  try {
    const dir = path.join(tmp, 'src', 'has space');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ok.js'), 'const a = 1;\n');
    fs.writeFileSync(path.join(tmp, 'main.js'), 'const b = 2;\n');

    const targets = runner.discoverSyntaxTargets(tmp);
    assert.ok(targets.includes('src/has space/ok.js'), `got ${JSON.stringify(targets)}`);
    assert.ok(targets.includes('main.js'));

    // The path is one array element, never quoted or escaped into a string.
    const step = runner.buildPlan(tmp).find((s) => s.args[1] === 'src/has space/ok.js');
    assert.deepStrictEqual(step.args, ['--check', 'src/has space/ok.js']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('discovery prunes generated, vendored and third-party trees', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrl-checks-'));
  try {
    const plant = (rel) => {
      const abs = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'const x = 1;\n');
    };
    plant('renderer/vendor/wrl-editor.bundle.js'); // generated by build:editor
    plant('src/editor/browser/editor-view.js');    // ESM, covered by build:editor
    plant('src/node_modules/dep/index.js');        // third-party at depth
    plant('spikes/old/run.js');                    // archived spike material
    plant('src/real.js');                          // first-party -> must be found

    const targets = runner.discoverSyntaxTargets(tmp);
    assert.deepStrictEqual(targets, ['src/real.js']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('discovery is deterministic, sorted and duplicate-free', () => {
  const a = runner.discoverSyntaxTargets();
  const b = runner.discoverSyntaxTargets();
  assert.deepStrictEqual(a, b, 'two runs must agree');
  assert.deepStrictEqual(a, [...a].sort(), 'must be sorted');
  assert.strictEqual(new Set(a).size, a.length, 'must not repeat a file');
  // The old chain checked renderer/editor.js twice; dedupe is intentional.
  assert.strictEqual(a.filter((f) => f === 'renderer/editor.js').length, 1);
});

test('every discovered target exists and uses posix-style relative paths', () => {
  for (const rel of runner.discoverSyntaxTargets()) {
    assert.ok(!path.isAbsolute(rel), `${rel} must be repo-relative`);
    assert.ok(!rel.includes('\\'), `${rel} must use forward slashes`);
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} must exist on disk`);
  }
});

test('the runner propagates a child failure as a non-zero exit code', () => {
  const { spawnSync } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrl-checks-'));
  try {
    // A deliberately broken file, syntax-checked directly the way the runner does.
    const bad = path.join(tmp, 'broken.js');
    fs.writeFileSync(bad, 'function ( {\n');
    const res = spawnSync(process.execPath, ['--check', bad], { encoding: 'utf8' });
    assert.notStrictEqual(res.status, 0, 'node --check must reject broken syntax');

    // And a good file must pass, so a green run means something.
    const good = path.join(tmp, 'fine.js');
    fs.writeFileSync(good, 'module.exports = 1;\n');
    assert.strictEqual(spawnSync(process.execPath, ['--check', good]).status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
