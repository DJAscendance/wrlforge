'use strict';
// Phase 7C3 -- editor-page script co-loading regression test.
//
// editor.html loads its app scripts as plain classic <script> tags, which share
// ONE global lexical scope: a top-level `const NAME` in one file collides with
// the same name in any other, rejecting the whole script at parse time. Phase
// 7C2 hit exactly this (`const API` in ui-state.js vs preview-state.js), and it
// is invisible to `node --check` (each file parses fine alone) and to CommonJS
// tests (module scope). This test replicates the browser semantics faithfully:
// every first-party script from editor.html is evaluated IN ORDER as a separate
// vm.Script against ONE shared context, so any global lexical collision (or a
// load-order dependency between the files' top-level code) fails here first.
//
// Third-party bundles (x_ite.min.js, the built CodeMirror bundle) are excluded:
// they are IIFE bundles that only assign window properties, and the built bundle
// is gitignored. Their absence is stubbed (window.WrlEditor / X3D untouched at
// load time by the app scripts below).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');

// The first-party scripts exactly as ordered in renderer/editor.html.
const EDITOR_PAGE_SCRIPTS = [
  'src/preview/extrusion-bounds.js',
  'src/preview/bbox-traversal.js',
  'src/preview/guides.js',
  'src/preview/fit-math.js',
  'src/editor/ui-state.js',
  'src/preview/preview-state.js',
  'src/preview/preview-scheduler.js',
  'src/preview/viewpoint-preserve.js',
  'src/editor/scene-selection.js',
  'renderer/scene-tree.js',
  'renderer/scene-inspector.js',
  'renderer/preview.js',
  'renderer/world-preview.js',
  'renderer/editor.js',
  'renderer/editor-preview.js',
];

test('editor.html script list matches this test\'s co-load order', () => {
  const html = fs.readFileSync(path.join(ROOT, 'renderer', 'editor.html'), 'utf8');
  const srcs = [...html.matchAll(/<script defer src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const firstParty = srcs
    .filter((s) => !s.includes('vendor/') && !s.includes('node_modules'))
    .map((s) => path.normalize(path.join('renderer', s)).split(path.sep).join('/'));
  assert.deepEqual(firstParty, EDITOR_PAGE_SCRIPTS,
    'update EDITOR_PAGE_SCRIPTS when editor.html adds/removes/reorders scripts');
});

function makeBrowserContext() {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, appendChild() {}, addEventListener() {} }),
      documentElement: { style: { setProperty() {} } },
    },
  };
  // Classic-script semantics: `window` IS the global object.
  sandbox.window = sandbox;
  sandbox.window.vrmlpad = { editor: {}, world: {}, goto: async () => {} };
  sandbox.window.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  vm.createContext(sandbox);
  return sandbox;
}

test('all editor-page scripts co-load in one shared global scope without collisions', () => {
  const ctx = makeBrowserContext();
  for (const rel of EDITOR_PAGE_SCRIPTS) {
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // A duplicate top-level lexical declaration throws HERE (SyntaxError at
    // script instantiation), exactly as it would in the real renderer.
    assert.doesNotThrow(
      () => vm.runInContext(source, ctx, { filename: rel }),
      (err) => { throw new Error(`${rel} failed to co-load: ${err && err.message}`); },
    );
  }
  // Every expected page-scope controller/namespace landed.
  for (const name of [
    'WrlEditorUI', 'WrlPreviewState', 'WrlPreviewScheduler', 'WrlViewpointPreserve',
    'WRLForgeSceneSelection', 'WRLForgeSceneTree', 'WRLForgeInspector',
    'wrlPreview', 'wrlWorldPreview', 'wrlEditorPreview', '__wrlEditor',
  ]) {
    assert.ok(ctx.window[name], `window.${name} missing after co-load`);
  }
});
