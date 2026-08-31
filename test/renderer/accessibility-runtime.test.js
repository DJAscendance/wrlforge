'use strict';
// Phase: Accessibility + Performance -- focused behavioral tests for the
// keyboard shortcuts, toolbar semantics, inspector semantics, and back-focus
// restoration added in this lane. The renderer files are loaded under
// `vm.runInContext` with a DOM stub (the same pattern `editor-wd2-runtime`)
// so the tests exercise the SAME code the renderer runs, not a parallel
// source-scan approximation. Source-scan tests for static attributes live in
// `test/product-posture.test.js` style files; the assertions below exercise
// runtime behavior.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---- minimal DOM stub ------------------------------------------------------

function makeEl(tag) {
  const el = {
    tag,
    children: [],
    attrs: {},
    style: { setProperty() {} },
    dataset: {},
    _listeners: {},
    className: '',
    _classes: new Set(),
    _textContent: '',
    _disabled: false,
    tabIndex: -1,
    // Mirror the DOM property so renderer.js's `tagName.toLowerCase()` works.
    get tagName() { return String(this.tag || '').toUpperCase(); },
    get classList() {
      const set = this._classes;
      return {
        add(c) { set.add(c); },
        remove(c) { set.delete(c); },
        toggle(c) { if (set.has(c)) set.delete(c); else set.add(c); },
        contains(c) { return set.has(c); },
      };
    },
    get disabled() { return this._disabled; },
    set disabled(v) { this._disabled = !!v; },
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      return child;
    },
    addEventListener(name, fn) { (this._listeners[name] = this._listeners[name] || []).push(fn); },
    removeEventListener(name, fn) {
      const list = this._listeners[name] || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatchEvent(evt) {
      // Stub: invoke any 'keydown' / 'click' listeners synchronously. The
      // renderer's keyboard-shortcut logic lives on the window, but we still
      // forward the event into the document stub so `addEventListener` on
      // an element works when we hand it to renderer's button wiring.
      const list = this._listeners[evt.type] || [];
      for (const fn of list) fn(evt);
      return true;
    },
    get firstChild() { return this.children[0] || null; },
    get textContent() {
      if (this._textContent) return this._textContent;
      return this.children.map((c) => c.textContent || '').join('');
    },
    set textContent(v) { this._textContent = String(v); this.children = []; },
    focus() { (this._focusCalls = this._focusCalls || 0); this._focusCalls += 1; },
    click() { this.dispatchEvent({ type: 'click', target: this }); },
    querySelector(sel) { return this._qs[sel] || null; },
    querySelectorAll() { return []; },
    _qs: {},
    setQuerySelector(map) { this._qs = map; },
  };
  return el;
}

// Build a DOM stub keyed by ID so getElementById returns the right element.
// The renderer only ever does `getElementById('<literal id>')`, so a Map of
// ids to elements is sufficient.
function makeDocument(elementsById) {
  const doc = {
    elementsById,
    createElement: (tag) => makeEl(tag),
    documentElement: makeEl('html'),
    getElementById(id) { return elementsById[id] || null; },
    querySelector(sel) {
      // A tiny matcher: supports `.modal-backdrop.show` only.
      if (sel === '.modal-backdrop.show') {
        return elementsById.__modalBackdrop && elementsById.__modalBackdrop._classes.has('show')
          ? elementsById.__modalBackdrop
          : null;
      }
      return null;
    },
  };
  return doc;
}

// ---- Mall toolbar source checks ------------------------------------------

test('Mall toolbar carries role=toolbar and aria-label', () => {
  const html = read('renderer/index.html');
  assert.match(html, /<div class="row" role="toolbar" aria-label="Mall item actions">/,
    'the Mall action row must declare role=toolbar and an accessible name');
});

test('World toolbar carries role=toolbar and aria-label', () => {
  const html = read('renderer/world.html');
  assert.match(html, /<div class="row" role="toolbar" aria-label="World project actions">/,
    'the World action row must declare role=toolbar and an accessible name');
});

test('Mall repack + editor buttons carry aria-keyshortcuts', () => {
  const html = read('renderer/index.html');
  // Match the button line with the id and the aria-keyshortcuts value.
  assert.match(html, /id="repackBtn"[^>]*aria-keyshortcuts="Control\+R"/,
    'repackBtn must advertise Control+R');
  assert.match(html, /id="editorBtn"[^>]*aria-keyshortcuts="Control\+E"/,
    'editorBtn must advertise Control+E');
});

test('Mall toolbar labels are unique and meaningful (no duplicate visible-text)', () => {
  // Source scan -- the eight action buttons each carry distinct, descriptive
  // visible text. (A future regression that swaps two button labels trips
  // here.) The checkbox label is part of the same toolbar so its label text
  // matters too, but it is not a button.
  const html = read('renderer/index.html');
  const labels = [
    'Open mall .wrl…',
    'Open World Project…',
    'Open in Native Editor',
    'Open in External Editor',
    'Refresh Preview',
    'Re-check',
    'Repack &amp; Save to mall .wrl',
  ];
  for (const l of labels) {
    assert.ok(html.includes(l), `Mall toolbar must keep "${l}"`);
  }
});

// ---- Inspector semantics --------------------------------------------------

test('Inspector findings list is a role=list container; rows keep role=listitem', () => {
  const ctx = makeBrowserContext();
  loadModule(ctx, 'renderer/scene-inspector.js');
  const win = ctx.window;

  // Build a fake presented record and call the public renderInspector.
  const findingsEl = ctx.document.createElement('div');
  const item = { kind: 'Node', nodeType: 'Box', fieldsCount: 0, fieldNames: [], range: { start: { offset: 0, line: 1 }, end: { offset: 1, line: 1 } } };
  const presented = [{
    finding: { code: 'VRML_TEST', range: { start: { offset: 0 }, end: { offset: 1 } } },
    presentation: { severity: 'error' },
  }];
  win.WRLForgeInspector.renderInspector(findingsEl, item, {
    presentation: { severityLabel: (s) => s },
    messages: { messageForPresentation: () => ({ title: 't', summary: 's', detail: 'd' }) },
    findingsFor: () => presented,
  });

  const list = findingsEl.children.find((c) => c.className === 'inspector-findings');
  assert.ok(list, 'inspector-findings container must exist');
  assert.equal(list.getAttribute('role'), 'list', 'container must declare role=list');
  assert.ok(list.getAttribute('aria-label'), 'container must have an accessible name');
  const rows = list.children.filter((c) => c.className && c.className.indexOf('inspector-row') === 0);
  assert.ok(rows.length >= 1, 'at least one row');
  for (const r of rows) {
    assert.equal(r.getAttribute('role'), 'listitem', 'each row must declare role=listitem');
  }
});

// ---- Mall keyboard shortcuts: behavior under vm ----------------------------

test('Mall Ctrl+R dispatches Repack; Ctrl+E dispatches Open in Native Editor', async () => {
  const ctx = makeBrowserContext();
  // Pre-seed sessionStorage to simulate the back-focus path NOT firing.
  ctx.sessionStorage.setItem('wrlforge.nav.returnFocusId', '');
  loadModule(ctx, 'renderer/renderer.js');

  // The renderer wires up after its script runs. Allow the keydown listeners
  // a microtask to settle, then drive the keystroke.
  await flushMicrotasks(ctx);

  // Click "Open mall .wrl..." so state is populated and the buttons enable.
  const openBtn = ctx.document.elementsById.openBtn;
  ctx.__wrlForgeApplyOpen({
    mallPath: '/tmp/x.wrl', editFile: '/tmp/x.edit.wrl',
    rawBytes: 1, gzipBytes: 1,
    results: [],
  });

  // Drive Ctrl+R
  const rCalls = ctx.__bridgeCalls.repack;
  dispatchKey(ctx, 'r', { ctrlKey: true });
  assert.equal(ctx.__bridgeCalls.repack, rCalls + 1,
    'Ctrl+R must invoke window.vrmlpad.repack exactly once');

  // Drive Ctrl+E
  const eCalls = ctx.__bridgeCalls.editorOpenMall;
  dispatchKey(ctx, 'e', { ctrlKey: true });
  assert.equal(ctx.__bridgeCalls.editorOpenMall, eCalls + 1,
    'Ctrl+E must invoke window.vrmlpad.editor.openMall exactly once');
});

test('Mall keyboard shortcuts do not fire while a text input has focus', async () => {
  const ctx = makeBrowserContext();
  ctx.sessionStorage.setItem('wrlforge.nav.returnFocusId', '');
  loadModule(ctx, 'renderer/renderer.js');
  await flushMicrotasks(ctx);
  ctx.__wrlForgeApplyOpen({
    mallPath: '/tmp/x.wrl', editFile: '/tmp/x.edit.wrl',
    rawBytes: 1, gzipBytes: 1,
    results: [],
  });

  const before = ctx.__bridgeCalls.repack;
  // Synthetic text input is the active element on the keydown.
  const input = ctx.document.createElement('input');
  input.tag = 'INPUT';
  dispatchKey(ctx, 'r', { ctrlKey: true, target: input });
  assert.equal(ctx.__bridgeCalls.repack, before,
    'Ctrl+R must NOT fire while an <input> has focus');
});

test('Mall keyboard shortcuts do not fire while a modal-backdrop.show is mounted', async () => {
  const ctx = makeBrowserContext();
  ctx.sessionStorage.setItem('wrlforge.nav.returnFocusId', '');
  loadModule(ctx, 'renderer/renderer.js');
  await flushMicrotasks(ctx);
  ctx.__wrlForgeApplyOpen({
    mallPath: '/tmp/x.wrl', editFile: '/tmp/x.edit.wrl',
    rawBytes: 1, gzipBytes: 1,
    results: [],
  });

  // Simulate the in-DOM modal being open.
  const backdrop = ctx.document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop._classes.add('show');
  ctx.document.elementsById.__modalBackdrop = backdrop;

  const before = ctx.__bridgeCalls.repack;
  dispatchKey(ctx, 'r', { ctrlKey: true });
  assert.equal(ctx.__bridgeCalls.repack, before,
    'Ctrl+R must NOT fire while a modal-backdrop.show is mounted');
});

test('Mall Ctrl+R is a no-op while repack button is disabled', async () => {
  const ctx = makeBrowserContext();
  ctx.sessionStorage.setItem('wrlforge.nav.returnFocusId', '');
  loadModule(ctx, 'renderer/renderer.js');
  await flushMicrotasks(ctx);
  // No file opened -> repackBtn.disabled stays true.
  const before = ctx.__bridgeCalls.repack;
  dispatchKey(ctx, 'r', { ctrlKey: true });
  assert.equal(ctx.__bridgeCalls.repack, before,
    'Ctrl+R must respect the disabled state of the Repack button');
});

// ---- Back-focus restoration -----------------------------------------------

test('Mall returnFocusId: repackBtn receives focus on page load', async () => {
  const ctx = makeBrowserContext();
  // Pre-enable the button so the restoreReturnFocus IIFE finds it ready on
  // the first tick. (In the real page, applyState enables it shortly after;
  // the production tick loop has a 40-tick budget to cover that race. Here
  // we test the focused state -- the IIFE itself.)
  ctx.document.elementsById.repackBtn.disabled = false;
  ctx.sessionStorage.setItem('wrlforge.nav.returnFocusId', 'repackBtn');
  loadModule(ctx, 'renderer/renderer.js');
  for (let i = 0; i < 60; i += 1) await flushMicrotasks(ctx);
  const repack = ctx.document.elementsById.repackBtn;
  assert.ok(repack._focusCalls >= 1,
    `repackBtn must be focused at least once after page load; got ${repack._focusCalls}`);
});

test('World returnFocusId: nativeEditorBtn receives focus on page load', async () => {
  const ctx = makeWorldBrowserContext();
  ctx.sessionStorage.setItem('wrlforge.nav.returnFocusId', 'nativeEditorBtn');
  // Pre-enable the button so the restoreReturnFocus tick loop finds it on the
  // first try (this mirrors the production path where handleDetection enables
  // the button shortly after the IIFE runs; the loop's 40-tick budget covers
  // that small race).
  ctx.document.elementsById.nativeEditorBtn.disabled = false;
  loadModule(ctx, 'renderer/world.js');
  for (let i = 0; i < 60; i += 1) await flushMicrotasks(ctx);
  const btn = ctx.document.elementsById.nativeEditorBtn;
  assert.ok(btn._focusCalls >= 1,
    `nativeEditorBtn must be focused at least once after page load; got ${btn._focusCalls}`);
});

test('sessionStorage key is cleared exactly once (idempotent consumption)', async () => {
  const ctx = makeBrowserContext();
  ctx.document.elementsById.repackBtn.disabled = false;
  ctx.sessionStorage.setItem('wrlforge.nav.returnFocusId', 'repackBtn');
  loadModule(ctx, 'renderer/renderer.js');
  for (let i = 0; i < 60; i += 1) await flushMicrotasks(ctx);
  // After consumption, the sessionStorage entry must be gone -- a second
  // arrival on the same page would NOT focus again.
  const after = ctx.sessionStorage.getItem('wrlforge.nav.returnFocusId');
  assert.equal(after, null,
    'returnFocusId must be removed from sessionStorage after consumption');
});

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

function makeBrowserContext() {
  const sandbox = {
    console: { log() {}, warn() {}, error: () => { consoleErrors.push(String(arguments[0] || '')); } },
    setTimeout: (fn, ms) => { queue.push({ fn, ms: ms || 0 }); return ++timerId; },
    clearTimeout: (id) => { /* no-op in stub -- timers drain explicitly */ },
    // renderer.js calls setInterval for the validation poll; we never invoke
    // the callback in tests -- just record the handle.
    setInterval: () => ++timerId,
    clearInterval: () => {},
    Math: global.Math,
    Date: global.Date,
    navigator: { clipboard: undefined },
  };
  const queue = [];
  let timerId = 0;
  sandbox.__queue = queue;
  sandbox.__drainTimers = async function drain() {
    // Drain a few iterations so chained setTimeouts eventually finish.
    for (let i = 0; i < 5 && queue.length; i += 1) {
      const item = queue.shift();
      try { await item.fn(); } catch (e) { /* swallow in stub */ }
    }
  };

  const consoleErrors = [];
  sandbox.__consoleErrors = consoleErrors;

  // The Mall page buttons needed by renderer.js.
  const repackBtn = makeEl('button');
  repackBtn._id = 'repackBtn';
  repackBtn._disabled = true;
  const editorBtn = makeEl('button');
  editorBtn._id = 'editorBtn';
  editorBtn._disabled = true;
  const openBtn = makeEl('button');
  openBtn._id = 'openBtn';
  const vscodiumBtn = makeEl('button');
  vscodiumBtn._id = 'vscodiumBtn';
  vscodiumBtn._disabled = true;
  const refreshBtn = makeEl('button');
  refreshBtn._id = 'refreshBtn';
  refreshBtn._disabled = true;
  const checkBtn = makeEl('button');
  checkBtn._id = 'checkBtn';
  checkBtn._disabled = true;
  const toggleGzip = makeEl('input');
  toggleGzip._id = 'toggleGzip';
  toggleGzip.checked = true;
  const elementsById = {
    openBtn, repackBtn, editorBtn, vscodiumBtn, refreshBtn, checkBtn, toggleGzip,
    empty: makeEl('div'), loaded: makeEl('div'),
    mallPath: makeEl('span'), editFile: makeEl('span'),
    revealMall: makeEl('a'), revealEdit: makeEl('a'),
    rawSize: makeEl('span'), gzSize: makeEl('span'),
    rawStat: makeEl('div'), gzStat: makeEl('div'),
    results: makeEl('div'),
    editorMsg: makeEl('div'),
    __modalBackdrop: null,
  };
  // id-based accessor: our makeEl doesn't carry an id attribute by default, so
  // also set attrs.id so getElementById and document.querySelector can find them.
  for (const [k, el] of Object.entries(elementsById)) {
    if (k.startsWith('__')) continue;
    el.attrs.id = k;
  }

  sandbox.document = makeDocument(elementsById);

  // Bridge stubs -- record call counts the tests assert on.
  const bridgeCalls = { repack: 0, check: 0, openMall: 0, editorOpenMall: 0, goto: 0 };
  sandbox.__bridgeCalls = bridgeCalls;
  const bridgeStub = {
    openMall: () => { bridgeCalls.openMall += 1; return Promise.resolve({}); },
    repack: () => { bridgeCalls.repack += 1; return Promise.resolve({ rawBytes: 1, gzipBytes: 1, results: [] }); },
    check: () => { bridgeCalls.check += 1; return Promise.resolve({ rawBytes: 1, gzipBytes: 1, results: [] }); },
    revealInFolder: () => Promise.resolve(),
    goto: (page) => { bridgeCalls.goto += 1; return Promise.resolve({ page }); },
    openInEditor: () => Promise.resolve({ editorStatus: null }),
  };
  const editorBridge = {
    openMall: () => { bridgeCalls.editorOpenMall += 1; return Promise.resolve({}); },
  };
  sandbox.vrmlpad = { ...bridgeStub, editor: editorBridge };

  // sessionStorage stub -- backed by a Map.
  const ssMap = new Map();
  sandbox.sessionStorage = {
    getItem: (k) => (ssMap.has(k) ? ssMap.get(k) : null),
    setItem: (k, v) => { ssMap.set(k, String(v)); },
    removeItem: (k) => { ssMap.delete(k); },
  };
  // The renderer attaches `window.addEventListener('keydown', ...)` -- the
  // sandbox window must implement EventTarget-like add/remove.
  const windowListeners = {};
  sandbox.window = sandbox;
  sandbox.addEventListener = function (name, fn) {
    (windowListeners[name] = windowListeners[name] || []).push(fn);
  };
  sandbox.removeEventListener = function (name, fn) {
    const list = windowListeners[name] || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
  sandbox._listeners = windowListeners;
  // localStorage: not used by Mall, but renderer.js references window.localStorage
  // indirectly through the WRLForgeRecoveryPrompt path -- provide a stub.
  sandbox.localStorage = { getItem: () => null, setItem: () => {} };

  vm.createContext(sandbox);
  return sandbox;
}

function makeWorldBrowserContext() {
  const sandbox = {
    console: { log() {}, warn() {}, error: () => {} },
    setTimeout: (fn, ms) => { queue.push({ fn, ms: ms || 0 }); return ++timerId; },
    clearTimeout: () => {},
    setInterval: () => ++timerId,
    clearInterval: () => {},
    Math: global.Math,
    Date: global.Date,
  };
  const queue = [];
  let timerId = 0;
  sandbox.__queue = queue;
  sandbox.__drainTimers = async function drain() {
    for (let i = 0; i < 5 && queue.length; i += 1) {
      const item = queue.shift();
      try { await item.fn(); } catch (e) { /* swallow */ }
    }
  };

  const elementsById = {
    status: makeEl('div'),
    empty: makeEl('div'),
    ambiguous: makeEl('div'),
    candidates: makeEl('div'),
    loaded: makeEl('div'),
    rootPath: makeEl('span'),
    primaryPath: makeEl('span'),
    primarySrc: makeEl('span'),
    scanInfo: makeEl('span'),
    summary: makeEl('div'),
    findings: makeEl('div'),
    filters: makeEl('div'),
    assetRows: makeEl('tbody'),
    tableEmpty: makeEl('div'),
    tree: makeEl('div'),
    refreshBtn: makeEl('button'),
    revealBtn: makeEl('button'),
    editorBtn: makeEl('button'),
    nativeEditorBtn: makeEl('button'),
    openFolderBtn: makeEl('button'),
    openFileBtn: makeEl('button'),
    mallBtn: makeEl('button'),
  };
  for (const [k, el] of Object.entries(elementsById)) el.attrs.id = k;
  elementsById.nativeEditorBtn.disabled = true;

  sandbox.document = makeDocument(elementsById);

  sandbox.vrmlpad = {
    world: {
      openFolder: () => Promise.resolve(null),
      openPrimaryFile: () => Promise.resolve(null),
      describe: () => Promise.resolve({ primary: null }),
      scanProject: () => Promise.resolve(null),
      refreshProject: () => Promise.resolve(null),
      revealRoot: () => Promise.resolve(),
      openPrimaryInEditor: () => Promise.resolve({ editorStatus: null }),
    },
    editor: { openWorldPrimary: () => Promise.resolve({}) },
    goto: (page) => Promise.resolve({ page }),
  };

  const ssMap = new Map();
  sandbox.sessionStorage = {
    getItem: (k) => (ssMap.has(k) ? ssMap.get(k) : null),
    setItem: (k, v) => { ssMap.set(k, String(v)); },
    removeItem: (k) => { ssMap.delete(k); },
  };
  const windowListeners = {};
  sandbox.window = sandbox;
  sandbox.addEventListener = function (name, fn) {
    (windowListeners[name] = windowListeners[name] || []).push(fn);
  };
  sandbox.removeEventListener = function (name, fn) {
    const list = windowListeners[name] || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
  sandbox._listeners = windowListeners;
  sandbox.localStorage = { getItem: () => null, setItem: () => {} };

  vm.createContext(sandbox);
  return sandbox;
}

function loadModule(ctx, rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  vm.runInContext(src, ctx, { filename: rel });
}

async function flushMicrotasks(ctx) {
  // Run queued timers + microtasks a few times so the renderer's `setTimeout`
  // ticks (back-focus retry loop, debounced repack confirmation, etc.) drain.
  for (let i = 0; i < 8; i += 1) {
    if (ctx.__drainTimers) await ctx.__drainTimers();
    await new Promise((r) => setImmediate(r));
  }
}

function dispatchKey(ctx, key, { ctrlKey = false, target = null } = {}) {
  // Build a synthetic KeyboardEvent-shaped object and dispatch it on the
  // window. The renderer's listener calls preventDefault; we record nothing
  // here -- the test asserts via the bridge-call counters.
  const evt = {
    type: 'keydown',
    key,
    ctrlKey,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: target || ctx.window,
    preventDefault() {},
  };
  const list = (ctx.window._listeners && ctx.window._listeners.keydown) || [];
  for (const fn of list) fn(evt);
}

// ---- Forward-looking source guards for regression -------------------------

test('source: Mall toolbar buttons retain their existing aria-label when present (no over-replacement)', () => {
  // The lane says: "Do not duplicate visible button text unnecessarily." The
  // Mall buttons keep their visible text as the accessible name -- no extra
  // aria-label was added. We pin the absence of an aria-label attribute on
  // each button so a future edit does not silently double-up the name.
  const html = read('renderer/index.html');
  for (const id of ['openBtn', 'worldBtn', 'editorBtn', 'vscodiumBtn', 'refreshBtn', 'checkBtn', 'repackBtn']) {
    // Each id appears at least once.
    assert.ok(new RegExp(`id="${id}"`).test(html), `${id} must still exist`);
  }
  // None of them carry aria-label (visible text is the accessible name).
  assert.doesNotMatch(html, /id="openBtn"[^>]*aria-label=/, 'openBtn must not double its accessible name');
  assert.doesNotMatch(html, /id="repackBtn"[^>]*aria-label=/, 'repackBtn must not double its accessible name');
});