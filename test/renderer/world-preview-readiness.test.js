'use strict';
// Focused World-preview coverage for the SAME bounded X_ITE readiness gate.
//
// The World lane reaches createX3DFromString() through the same X_ITE surface as
// the Mall lane, so the same dead-context failure disguises itself the same way
// ("Unexpected end of file" against a valid world). These tests prove the World
// lane classifies it as an initialization failure and stays retry-safe. No Mall
// rule, fit, bound, or World Project policy is involved.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const R = require('../../src/preview/browser-readiness');

const LIVE = { lost: false, maxTextureSize: 16384 };
const DEAD = { lost: true, maxTextureSize: null };
const DISGUISED = '\nParser error at line 2:1\n ^\nUnexpected end of file. At least one dimension (1 × 1) is greater than the maximum texture size (null px).\n';

const PAYLOAD = {
  status: 'ok',
  text: '#VRML V2.0 utf8\nWorldInfo { title "w" }\n',
  baseURL: 'wrlworld://p/',
  wasGzipped: false,
  primaryRel: 'world.wrl',
  counts: { presentAssets: 1, missing: 0, caseMismatches: 0 },
  remoteUrls: [], missingAssets: [],
};

function makeEl(tag, id) {
  return {
    tag, id, attributes: id ? [{ name: 'id', value: id }] : [],
    style: {}, textContent: '', innerHTML: '', disabled: false, value: '',
    _listeners: {},
    setAttribute(n, v) { this.attributes.push({ name: n, value: String(v) }); if (n === 'id') this.id = v; },
    addEventListener(n, fn) { (this._listeners[n] = this._listeners[n] || []).push(fn); },
    appendChild() {},
  };
}

function makeBrowser(glState, parse) {
  const b = {
    glState, baseURL: null, disposed: false,
    dispose() { this.disposed = true; },
    setBrowserOption() {},
    getActiveLayer() { return null; },
    getActiveNavigationInfo() { return null; },
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

function loadWorldPreview(plan) {
  const IDS = ['wpStatus', 'wpStale', 'wpCanvas', 'wpViewpoint', 'wpLoadedMissing', 'wpPrimary',
    'wpWarnings', 'wpRefresh', 'wpReset', 'wpNav'];
  const els = {};
  for (const id of IDS) els[id] = makeEl('div', id);
  const queue = plan.browsers.slice();
  els.wpCanvas.browser = queue.shift();

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
    createElement: (tag) => makeEl(tag, null),
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  els.wpCanvas.replaceWith = function (next) {
    next.browser = queue.length ? queue.shift() : makeBrowser(DEAD, () => { throw new Error(DISGUISED); });
    next.replaceWith = els.wpCanvas.replaceWith;
    els.wpCanvas = next;
  };
  sandbox.window = sandbox;
  sandbox.WrlBrowserReadiness = Object.assign({}, R, {
    acquireReadyBrowser: (deps) => R.acquireReadyBrowser(Object.assign({}, deps, {
      timeoutMs: 120, pollMs: 5, recreateDelayMs: 5, maxRecreates: 1,
    })),
  });
  sandbox.X3D = async () => {};
  sandbox.vrmlpad = { world: { loadPreview: async () => (plan.payload || PAYLOAD) } };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'renderer', 'world-preview.js'), 'utf8'),
    sandbox, { filename: 'renderer/world-preview.js' });
  return { els: () => els, api: sandbox.wrlWorldPreview };
}

const okParse = () => ({});
const throwDisguised = () => { throw new Error(DISGUISED); };

test('World: an unrecoverable dead context -> initError, and the world is never blamed', async () => {
  const { els, api } = loadWorldPreview({ browsers: [makeBrowser(DEAD, throwDisguised), makeBrowser(DEAD, throwDisguised)] });
  const res = await api.load();
  assert.equal(res.ok, false);
  assert.ok(res.initError);
  assert.equal(res.parseError, undefined, 'never reported as a parse error');
  const status = els().wpStatus.textContent;
  assert.doesNotMatch(status, /Fix the world/i);
  assert.doesNotMatch(status, /Parse error/i);
  assert.match(status, /Refresh to try again/i);
});

test('World: a context that dies during the parse is reclassified, not blamed on the world', async () => {
  const flaky = makeBrowser({ ...LIVE }, (_t, b) => { b.glState = { ...DEAD }; throw new Error(DISGUISED); });
  const { els, api } = loadWorldPreview({ browsers: [flaky] });
  const res = await api.load();
  assert.ok(res.initError);
  assert.equal(res.parseError, undefined);
  assert.match(res.initError, /NOT read as invalid/i);
  assert.doesNotMatch(els().wpStatus.textContent, /Fix the world/i);
});

test('World: canvas replacement recovers a dead context and the world loads', async () => {
  const dead = makeBrowser(DEAD, throwDisguised);
  const { api } = loadWorldPreview({ browsers: [dead, makeBrowser(LIVE, okParse)] });
  const res = await api.load();
  assert.equal(res.ok, true);
  assert.equal(dead.disposed, true, 'the dead context is released');
});

test('World: a genuinely unparseable world still reports parseError against a ready browser', async () => {
  let bad = false;
  const browser = makeBrowser(LIVE, () => { if (bad) throw new Error('\nParser error at line 3:1\nExpected "}".\n'); return {}; });
  const { els, api } = loadWorldPreview({ browsers: [browser] });
  const first = await api.load();
  assert.equal(first.ok, true);
  bad = true;
  const second = await api.load();
  assert.equal(second.ok, false);
  assert.ok(second.parseError);
  assert.equal(second.initError, undefined);
  assert.match(els().wpStatus.textContent, /Parse error/);
  assert.match(els().wpStatus.textContent, /keeping last valid preview/);
});

test('World: validateText separates a dead context from rejected text', async () => {
  const flaky = makeBrowser({ ...LIVE }, (_t, b) => { b.glState = { ...DEAD }; throw new Error(DISGUISED); });
  const { api } = loadWorldPreview({ browsers: [flaky] });
  const res = await api.validateText('#VRML V2.0 utf8\n');
  assert.equal(res.ok, false);
  assert.ok(res.initError, 'a dead context is an init failure, not "nested text rejected"');
  assert.equal(res.error, undefined);
});

test('World: a failed readiness attempt does not poison a later Refresh', async () => {
  const { els, api } = loadWorldPreview({ browsers: [makeBrowser(DEAD, throwDisguised), makeBrowser(DEAD, throwDisguised)] });
  const failed = await api.load();
  assert.ok(failed.initError);
  els().wpCanvas.replaceWith = function (next) {
    next.browser = makeBrowser(LIVE, okParse);
    next.replaceWith = els().wpCanvas.replaceWith;
    els().wpCanvas = next;
  };
  const retried = await api.load();
  assert.equal(retried.ok, true);
});
