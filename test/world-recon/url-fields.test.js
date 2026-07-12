'use strict';
// Non-visual unit tests for the World-recon URL extractor. Pure string parsing --
// no Electron, no filesystem.

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractUrlValues, classifyUrls, isRemote, isInlineScript } = require('../../qa/world-recon/url-fields');

test('captures a single-quoted url value', () => {
  assert.deepEqual(extractUrlValues('Inline{ url "crater4.wrl" }'), ['crater4.wrl']);
});

test('captures ALL entries of an MFString array, even across newlines', () => {
  const text = 'ImageTexture{\n url [\n  "img/a.jpg"\n  "img/b.jpg"\n  "img/c.jpg"\n ]\n}';
  assert.deepEqual(extractUrlValues(text), ['img/a.jpg', 'img/b.jpg', 'img/c.jpg']);
});

test('matches url fields case-insensitively incl. *Url suffix forms', () => {
  const text = 'Background{ Url "img/sky.jpg" } Foo{ frontUrl "img/f.jpg" }';
  assert.deepEqual(extractUrlValues(text), ['img/sky.jpg', 'img/f.jpg']);
});

test('does not match identifiers that merely contain "url"', () => {
  // `curl` / a bare word without a following quoted value must not register.
  assert.deepEqual(extractUrlValues('DEF curly Transform{} # no url value here'), []);
});

test('classifyUrls separates local from remote and de-dupes', () => {
  const text = [
    'url "img/wall.jpg"',
    'url "img/wall.jpg"',                 // dup local
    'url "http://example.com/x.png"',
    'url "//cdn.example.com/y.png"',      // protocol-relative -> remote
    'url "ftp://host/z.wav"',
  ].join('\n');
  const r = classifyUrls(text);
  assert.deepEqual(r.local, ['img/wall.jpg']);
  assert.deepEqual(r.remote.sort(), ['//cdn.example.com/y.png', 'ftp://host/z.wav', 'http://example.com/x.png'].sort());
});

test('isRemote treats scheme-less relative paths as local', () => {
  assert.equal(isRemote('img/a.jpg'), false);
  assert.equal(isRemote('sound/engine.wav'), false);
  assert.equal(isRemote('https://x/y'), true);
  assert.equal(isRemote('//x/y'), true);
});

test('inline VRML/JS Script code is neither remote nor local', () => {
  const script = 'vrmlscript:\nfunction go(){ x = 1; }';
  assert.equal(isInlineScript(script), true);
  assert.equal(isRemote(script), false, 'inline script must not count as a remote reference');
  assert.equal(isInlineScript('javascript: foo()'), true);
  assert.equal(isInlineScript('ecmascript: bar()'), true);
  assert.equal(isInlineScript('script.js'), false, 'an external .js file is not inline script');
  const c = classifyUrls('Script{ url "javascript: f()" } ImageTexture{ url "img/a.jpg" }');
  assert.deepEqual(c.local, ['img/a.jpg']);
  assert.deepEqual(c.remote, []);
  assert.deepEqual(c.inlineScripts, ['javascript: f()']);
});
