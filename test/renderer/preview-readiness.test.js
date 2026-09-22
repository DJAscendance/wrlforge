'use strict';
// Parse-error SEPARATION regression for the Mall preview controller.
//
// The Windows first-launch defect did not just break the preview -- it LIED
// about why: X_ITE's VRML parser caught a dead-WebGL-context throw and rewrote
// it as "Unexpected end of file", so the app told the user to fix a file that
// was perfectly valid, and Cybertown Fit silently reported "bounds unavailable".
//
// These are RUNTIME tests: renderer/preview.js is loaded under vm.runInContext
// with a DOM stub, the REAL readiness gate (src/preview/browser-readiness.js),
// and a stub X_ITE browser whose WebGL state the test scripts. They assert the
// contract that matters:
//
//   readiness failure -> initError, never parseError, never "Fix the file"
//   real parse error  -> parseError, last valid preview kept (unchanged)
//   a failed readiness attempt never poisons a later Refresh

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const R = require('../../src/preview/browser-readiness');

const LIVE = { lost: false, maxTextureSize: 16384 };
// The exact state measured on a Windows first launch from a fresh app directory.
const DEAD = { lost: true, maxTextureSize: null };

const FIXTURE_TEXT = '#VRML V2.0 utf8\nShape { geometry Box { size 2 2 2 } }\n';

// The X_ITE parser's real disguise: a WebGL failure dressed up as a document error.
const DISGUISED_PARSE_ERROR =
  '\nParser error at line 7:2\n  geometry Box { size 2 2 2 }\n ^\n' +
  'Unexpected end of file. At least one dimension (1 × 1) is greater than the maximum texture size (null px).\n';

function makeEl(tag, id) {
  return {
    tag, id, attributes: id ? [{ name: 'id', value: id }] : [],
    style: {}, className: '', textContent: '', innerHTML: '', disabled: false, checked: false,
    _listeners: {},
    setAttribute(n, v) { this.attributes.push({ name: n, value: String(v) }); if (n === 'id') this.id = v; },
    addEventListener(n, fn) { (this._listeners[n] = this._listeners[n] || []).push(fn); },
  };
}

// A stub X_ITE browser: `glState` is the live WebGL state the gate reads, and
// `parse` decides what createX3DFromString does.
function makeBrowser(glState, parse) {
  const b = {
    glState,
    baseURL: null,
    disposed: false,
    dispose() { this.disposed = true; },
    getContext() {
      if (!this.glState) return null;
      const s = this.glState;
      return {
        MAX_TEXTURE_SIZE: 0x0d33,
        isContextLost: () => s.lost === true,
        getParameter: () => s.maxTextureSize,
        getError: () => (s.lost === true ? R.CONTEXT_LOST_WEBGL : 0),
      };
    },
    async createX3DFromString(text) { return parse(text, b); },
    async replaceWorld() {},
  };
  return b;
}

// Load renderer/preview.js in a sandbox. `plan.browsers` is the queue of
// browsers handed out: index 0 is the initial canvas, each later entry is what a
// canvas replacement produces.
function loadPreview(plan) {
  const IDS = ['preview', 'previewStatus', 'guideControls', 'confidencePill', 'reqScale', 'maxScale',
    'propScale', 'offsets', 'boundsBody', 'centerLine', 'rules', 'previewWarnings',
    'modeOriginal', 'modeFit', 'refreshBtn'];
  const els = {};
  for (const id of IDS) els[id] = makeEl('div', id);

  const queue = plan.browsers.slice();
  els.preview.browser = queue.shift();
  const created = [];

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 2)),
    clearTimeout: () => {},
    Math: global.Math, Date: global.Date, Number: global.Number, JSON: global.JSON,
    Promise: global.Promise, Array: global.Array, Set: global.Set, Object: global.Object,
    String: global.String, Error: global.Error,
  };
  sandbox.document = {
    getElementById: (id) => els[id] || null,
    createElement: (tag) => {
      const e = makeEl(tag, null);
      created.push(e);
      return e;
    },
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  // The DOM swap the gate performs on a dead context.
  els.preview.replaceWith = function (next) {
    next.browser = queue.length ? queue.shift() : makeBrowser(DEAD, () => { throw new Error(DISGUISED_PARSE_ERROR); });
    next.replaceWith = els.preview.replaceWith;
    els.preview = next;
  };
  sandbox.window = sandbox;
  // The REAL gate, with its clock compressed so a timeout case costs
  // milliseconds instead of its production 8s deadline. Predicate, recovery and
  // error classification are untouched.
  sandbox.WrlBrowserReadiness = Object.assign({}, R, {
    acquireReadyBrowser: (deps) => R.acquireReadyBrowser(Object.assign({}, deps, {
      timeoutMs: 120, pollMs: 5, recreateDelayMs: 5, maxRecreates: 1,
    })),
  });
  sandbox.X3D = plan.X3D || (async () => {});
  sandbox.computeSceneBBox = () => ({ min: [-1, -1, -1], max: [1, 1, 1], confidence: 'exact', warnings: [] });
  sandbox.computeFit = require('../../src/preview/fit-math').computeFit;
  sandbox.buildGuidesVrml = () => '#VRML V2.0 utf8\n';
  sandbox.vrmlpad = { loadPreview: async () => ({ text: FIXTURE_TEXT, baseURL: 'file:///x/', wasGzipped: false, remoteUrls: [], sourcePath: '/x/i.wrl' }) };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'renderer', 'preview.js'), 'utf8'),
    sandbox, { filename: 'renderer/preview.js' });
  return { sandbox, els: () => els, api: sandbox.wrlPreview };
}

const okParse = () => ({});
const throwDisguised = () => { throw new Error(DISGUISED_PARSE_ERROR); };
const throwRealParse = () => { throw new Error('\nParser error at line 3:1\nExpected "}".\n'); };

// ---- readiness failure is NOT a parse error --------------------------------

test('dead WebGL context that cannot be recovered -> initError, and the file is never blamed', async () => {
  const dead = makeBrowser(DEAD, throwDisguised);
  const stillDead = makeBrowser(DEAD, throwDisguised);
  const { els, api } = loadPreview({ browsers: [dead, stillDead] });

  const res = await api.load();

  assert.equal(res.ok, false);
  assert.ok(res.initError, 'a readiness failure is reported as initError');
  assert.equal(res.parseError, undefined, 'a readiness failure is NEVER a parseError');
  assert.match(res.initError, /graphics context is not available/i);

  const status = els().previewStatus.textContent;
  assert.doesNotMatch(status, /Fix the file/i, 'never tells the user to fix a file that was not parsed');
  assert.doesNotMatch(status, /Unexpected end of file/i);
  assert.doesNotMatch(status, /Parse error/i);
  assert.match(status, /Refresh Preview to try again/i, 'offers the retry path instead of a relaunch');

  const warnings = els().previewWarnings.innerHTML;
  assert.match(warnings, /the document was not parsed/i);
  assert.equal(api.hasScene(), false, 'no scene was ever claimed');
});

test('a context lost between the gate and the parse is reclassified, not blamed on the file', async () => {
  // Passes the readiness predicate, then dies exactly when X_ITE parses --
  // producing X_ITE's disguised "Unexpected end of file" message.
  const flaky = makeBrowser({ ...LIVE }, (_t, b) => { b.glState = { ...DEAD }; throw new Error(DISGUISED_PARSE_ERROR); });
  const { els, api } = loadPreview({ browsers: [flaky] });

  const res = await api.load();

  assert.equal(res.ok, false);
  assert.ok(res.initError, 'a context that died during the parse is an init failure');
  assert.equal(res.parseError, undefined);
  assert.match(res.initError, /NOT read as invalid/i);
  assert.match(res.detail, /Unexpected end of file/, 'the raw X_ITE text is kept as detail, not as the verdict');
  assert.doesNotMatch(els().previewStatus.textContent, /Fix the file/i);
});

test('X3D() itself failing is an initialization failure, not a parse failure', async () => {
  const { els, api } = loadPreview({
    browsers: [makeBrowser(LIVE, okParse)],
    X3D: async () => { throw new Error("Couldn't create WebGL context."); },
  });
  const res = await api.load();
  assert.equal(res.ok, false);
  assert.match(res.initError, /engine failed to start/i);
  assert.equal(res.parseError, undefined);
  assert.doesNotMatch(els().previewStatus.textContent, /Parse error/i);
});

// ---- a genuinely malformed document still behaves exactly as before ---------

test('real parse error against a READY browser still reports parseError and keeps the last valid preview', async () => {
  let mode = 'ok';
  const browser = makeBrowser(LIVE, () => { if (mode === 'bad') throwRealParse(); return {}; });
  const { els, api } = loadPreview({ browsers: [browser] });

  const first = await api.load();
  assert.equal(first.ok, true, 'a valid document loads');
  assert.equal(api.hasScene(), true);

  mode = 'bad';
  const second = await api.load();
  assert.equal(second.ok, false);
  assert.ok(second.parseError, 'a malformed document IS a parse error');
  assert.equal(second.initError, undefined, 'and is never reclassified as an init failure');
  assert.match(els().previewStatus.textContent, /Parse error/);
  assert.match(els().previewStatus.textContent, /Fix the file and Refresh/);
  assert.equal(api.hasScene(), true, 'the last valid scene is still held');
});

// ---- retry safety ----------------------------------------------------------

test('a failed readiness attempt does not poison the next Refresh (no app restart needed)', async () => {
  const dead = makeBrowser(DEAD, throwDisguised);
  const stillDead = makeBrowser(DEAD, throwDisguised);
  const { els, api } = loadPreview({ browsers: [dead, stillDead] });

  const failed = await api.load();
  assert.ok(failed.initError);

  // The environment recovers: the next canvas replacement yields a live browser,
  // exactly what pressing Refresh Preview drives.
  els().preview.replaceWith = function (next) {
    next.browser = makeBrowser(LIVE, okParse);
    next.replaceWith = els().preview.replaceWith;
    els().preview = next;
  };

  const retried = await api.load();
  assert.equal(retried.ok, true, 'Refresh re-acquires a working browser without restarting');
  assert.equal(api.hasScene(), true);
  assert.match(els().previewStatus.textContent, /Preview loaded/);
});

test('the dead browser is disposed when its canvas is replaced', async () => {
  const dead = makeBrowser(DEAD, throwDisguised);
  const live = makeBrowser(LIVE, okParse);
  const { api } = loadPreview({ browsers: [dead, live] });
  const res = await api.load();
  assert.equal(res.ok, true, 'recovery via canvas replacement produces a working preview');
  assert.equal(dead.disposed, true, 'the dead context is released, not leaked');
});

// ---- ordering --------------------------------------------------------------

test('no parse is attempted against a dead context', async () => {
  const parsed = [];
  const dead = makeBrowser(DEAD, (t) => { parsed.push('dead'); throw new Error(DISGUISED_PARSE_ERROR); });
  const live = makeBrowser(LIVE, (t) => { parsed.push('live'); return {}; });
  const { api } = loadPreview({ browsers: [dead, live] });

  const res = await api.load();
  assert.equal(res.ok, true);
  assert.deepEqual(parsed, ['live'], 'the parser only ever ran against the ready browser');
});
