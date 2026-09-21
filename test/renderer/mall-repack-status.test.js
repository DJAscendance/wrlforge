'use strict';
// Lane B B2 -- the Mall Repack button must report what actually happened.
//
// The defect this guards against is the worst kind a save button can have: the
// old `doRepack()` set 'Saved ✓' unconditionally, so a refused or failed write
// still looked like a success. These are RUNTIME tests -- renderer.js is loaded
// under `vm.runInContext` with a DOM stub and the real click handler is fired,
// so they exercise the same code the renderer runs rather than a source scan.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const { MALL_UPLOAD_MAX_BYTES } = require('../../validator');

// A measured-and-passing Mall size payload; each test overrides what it cares about.
const SIZE_PAYLOAD = {
  textBytes: 100,
  artifactBytes: 72820,
  artifactIsGzip: true,
  artifactMatchesText: true,
  predictedRepackBytes: 87366,
  sizeAuthority: 'measured',
  sizeStatus: 'pass',
  sizeReason: 'measured',
  mallUploadMaxBytes: MALL_UPLOAD_MAX_BYTES,
  results: [],
};

// ---- minimal DOM stub ------------------------------------------------------

function makeEl(tag) {
  return {
    tag,
    children: [],
    attrs: {},
    style: {},
    dataset: {},
    _listeners: {},
    className: '',
    _classes: new Set(),
    textContent: '',
    innerHTML: '',
    checked: true,
    disabled: false,
    get classList() {
      const set = this._classes;
      return {
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        toggle: (c, force) => {
          const on = force === undefined ? !set.has(c) : !!force;
          if (on) set.add(c); else set.delete(c);
          return on;
        },
        contains: (c) => set.has(c),
      };
    },
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(name, fn) { (this._listeners[name] = this._listeners[name] || []).push(fn); },
    removeEventListener() {},
    focus() {},
    click() { return this.dispatch('click'); },
    async dispatch(name, evt = {}) {
      for (const fn of this._listeners[name] || []) await fn(evt);
    },
  };
}

const IDS = [
  'openBtn', 'checkBtn', 'repackBtn', 'editorBtn', 'vscodiumBtn', 'refreshBtn',
  'toggleGzip', 'empty', 'loaded', 'mallPath', 'editFile', 'revealMall',
  'revealEdit', 'textSize', 'artifactSize', 'predictedSize', 'sizeVerdict',
  'textStat', 'artifactStat', 'predictedStat', 'sizeNote', 'results',
  'editorMsg', 'worldBtn',
];

// Build a sandbox whose `repack` bridge resolves (or rejects with) whatever the
// test supplies, then load renderer.js into it.
function loadRenderer(repackImpl) {
  const els = {};
  for (const id of IDS) { els[id] = makeEl('div'); els[id].attrs.id = id; }

  const queue = [];
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn, ms) => { queue.push({ fn, ms }); return queue.length; },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    Math: global.Math,
    Date: global.Date,
    Number: global.Number,
    JSON: global.JSON,
    Promise: global.Promise,
    __queue: queue,
  };
  sandbox.document = {
    elementsById: els,
    getElementById: (id) => els[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => makeEl(tag),
    addEventListener: () => {},
    body: makeEl('body'),
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  sandbox.localStorage = { getItem: () => null, setItem: () => {} };
  // A real open payload: `state` is a top-level `let` inside the renderer's own
  // lexical scope, so a test cannot assign it from outside the vm. Driving the
  // real open flow is both the only way in and the more faithful test.
  const OPEN_PAYLOAD = { ...SIZE_PAYLOAD, mallPath: '/x/item.wrl', editFile: '/x/item.edit.wrl' };
  sandbox.vrmlpad = {
    openMall: () => Promise.resolve(OPEN_PAYLOAD),
    repack: repackImpl,
    check: () => Promise.resolve({ ...SIZE_PAYLOAD }),
    revealInFolder: () => Promise.resolve(),
    goto: () => Promise.resolve({}),
    openInEditor: () => Promise.resolve({ editorStatus: null }),
    editor: { openMall: () => Promise.resolve({}) },
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'renderer', 'renderer.js'), 'utf8'),
    sandbox, { filename: 'renderer/renderer.js' });

  return { sandbox, els };
}

// Open a file through the real handler so the renderer's own `state` is set,
// then clear the results the open populated so each assertion sees only what
// the repack rendered.
async function openFile(els) {
  await els.openBtn.dispatch('click');
  els.results.children = [];
}

async function clickRepack(repackImpl) {
  const { sandbox, els } = loadRenderer(repackImpl);
  await openFile(els);
  await els.repackBtn.dispatch('click');
  return { sandbox, els, label: els.repackBtn.textContent };
}

// ---- the three outcomes ----------------------------------------------------

test('B2 renderer: a preserved gzip repack shows "Already saved ✓"', async () => {
  const { label, els } = await clickRepack(() => Promise.resolve({
    ...SIZE_PAYLOAD, mallPath: '/x/item.wrl',
    saved: true, preserved: true, writtenBytes: 0, backup: null, errorCode: null,
    message: 'Already saved — the existing gzip artifact already matches this text, so nothing was rewritten.',
  }));

  assert.equal(label, 'Already saved ✓',
    'a no-op must not claim a write happened');
  const rows = els.results.children.map((c) => c.innerHTML).join('\n');
  assert.match(rows, /Repack/, 'the outcome is stated in the existing results area');
  assert.match(rows, /nothing was rewritten/);
});

test('B2 renderer: a real write shows "Saved ✓"', async () => {
  const { label, els } = await clickRepack(() => Promise.resolve({
    ...SIZE_PAYLOAD, mallPath: '/x/item.wrl',
    saved: true, preserved: false, writtenBytes: 4321, backup: '/x/item.wrl.bak-t', errorCode: null,
    message: null,
  }));

  assert.equal(label, 'Saved ✓');
  const rows = els.results.children.map((c) => c.innerHTML).join('\n');
  assert.doesNotMatch(rows, /Repack refused/, 'a successful write shows no refusal row');
});

test('B2 renderer: an ESIZE refusal shows "Not saved" with candidate, limit and overage', async () => {
  const candidate = MALL_UPLOAD_MAX_BYTES + 1234;
  const { label, els } = await clickRepack(() => Promise.resolve({
    ...SIZE_PAYLOAD, mallPath: '/x/item.wrl',
    sizeStatus: 'stale', sizeReason: 'stale-artifact', sizeAuthority: 'none',
    saved: false, preserved: false, writtenBytes: 0, backup: null,
    errorCode: 'ESIZE',
    candidateBytes: candidate, maxBytes: MALL_UPLOAD_MAX_BYTES, overBytes: 1234,
    message: 'Not saved — the repacked candidate is over the Mall upload limit. The existing file was not changed.',
  }));

  assert.equal(label, 'Not saved', 'a refused write must never read as success');

  const rows = els.results.children.map((c) => c.innerHTML).join('\n');
  assert.match(rows, /Repack refused \(ESIZE\)/);
  assert.match(rows, new RegExp(candidate.toLocaleString().replace(/,/g, ',')),
    'the exact candidate byte count is shown');
  assert.match(rows, /81,290 B limit/, 'the exact limit is shown');
  assert.match(rows, /by 1,234 B/, 'the exact overage is shown');
  assert.match(rows, /existing file was not changed/);
  // Lane A owns the "measured upload artifact" wording; a candidate is not one.
  assert.doesNotMatch(rows, /measured in the gzip upload artifact/);
});

test('B2 renderer: a generic save failure shows "Not saved"', async () => {
  const { label, els } = await clickRepack(() => Promise.resolve({
    ...SIZE_PAYLOAD, mallPath: '/x/item.wrl',
    saved: false, preserved: false, writtenBytes: 0, backup: null,
    errorCode: 'ESAVE',
    candidateBytes: null, maxBytes: null, overBytes: null,
    message: 'Not saved — simulated disk-full',
  }));

  assert.equal(label, 'Not saved');
  const rows = els.results.children.map((c) => c.innerHTML).join('\n');
  assert.match(rows, /Repack refused \(ESAVE\)/);
  assert.match(rows, /disk-full/);
});

test('B2 renderer: an IPC rejection still shows "Not saved", never a success label', async () => {
  const { label } = await clickRepack(() => Promise.reject(new Error('ipc exploded')));
  assert.equal(label, 'Not saved');
});

test('B2 renderer: the polled check payload adds no repack outcome row', async () => {
  // mall:check returns no `errorCode`/`saved` keys at all -- the outcome row
  // must stay absent so polling never manufactures a save result.
  const { sandbox, els } = loadRenderer(() => Promise.resolve({ ...SIZE_PAYLOAD }));
  await openFile(els);
  sandbox.renderResults({ ...SIZE_PAYLOAD });
  assert.deepEqual(els.results.children, [], 'a plain validation payload renders no outcome row');
});
