'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { classifyReference, CATEGORY } = require('../../src/world-project/path-policy');

const ROOT = path.resolve('/proj');
const DIR = path.resolve('/proj/vrml');

test('a clean relative path within the project is local + resolvable', () => {
  const c = classifyReference('img/wall.jpg', DIR, ROOT);
  assert.equal(c.category, CATEGORY.LOCAL);
  assert.equal(c.resolvable, true);
  assert.equal(c.remote, false);
  assert.equal(c.resolved, path.resolve('/proj/vrml/img/wall.jpg'));
  assert.equal(c.projectRelative, 'vrml/img/wall.jpg');
});

test('a nested-directory relative path stays local', () => {
  const c = classifyReference('sub/deep/leaf.png', DIR, ROOT);
  assert.equal(c.category, CATEGORY.LOCAL);
  assert.equal(c.projectRelative, 'vrml/sub/deep/leaf.png');
});

test('.. that stays inside the root is still local', () => {
  const c = classifyReference('../shared/x.png', DIR, ROOT);
  assert.equal(c.category, CATEGORY.LOCAL);
  assert.equal(c.projectRelative, 'shared/x.png');
});

test('.. that escapes the root is a traversal (unsafe, not resolvable)', () => {
  const c = classifyReference('../../etc/passwd', DIR, ROOT);
  assert.equal(c.category, CATEGORY.TRAVERSAL);
  assert.equal(c.resolvable, false);
});

test('an absolute POSIX path is absolute-local (unsafe)', () => {
  const c = classifyReference('/etc/hosts', DIR, ROOT);
  assert.equal(c.category, CATEGORY.ABSOLUTE);
  assert.equal(c.resolvable, false);
});

test('a Windows drive path is absolute-local', () => {
  const c = classifyReference('C:\\textures\\x.png', DIR, ROOT);
  assert.equal(c.category, CATEGORY.ABSOLUTE);
});

test('http/https is remote-http', () => {
  assert.equal(classifyReference('http://x/y.png', DIR, ROOT).category, CATEGORY.REMOTE_HTTP);
  assert.equal(classifyReference('https://x/y.png', DIR, ROOT).category, CATEGORY.REMOTE_HTTP);
});

test('protocol-relative is remote-protocol', () => {
  const c = classifyReference('//cdn/y.png', DIR, ROOT);
  assert.equal(c.category, CATEGORY.REMOTE_PROTOCOL);
  assert.equal(c.remote, true);
});

test('other network schemes are remote-other', () => {
  assert.equal(classifyReference('ftp://h/z.wav', DIR, ROOT).category, CATEGORY.REMOTE_OTHER);
  assert.equal(classifyReference('ws://h/s', DIR, ROOT).category, CATEGORY.REMOTE_OTHER);
});

test('inline VRML/JS script pseudo-schemes are inline-script, not assets', () => {
  assert.equal(classifyReference('vrmlscript: function f(){}', DIR, ROOT).category, CATEGORY.INLINE_SCRIPT);
  assert.equal(classifyReference('javascript: g()', DIR, ROOT).category, CATEGORY.INLINE_SCRIPT);
});

test('empty / whitespace is malformed', () => {
  assert.equal(classifyReference('   ', DIR, ROOT).category, CATEGORY.MALFORMED);
});

test('file:// is treated as absolute-local', () => {
  const c = classifyReference('file:///proj/vrml/img/a.png', DIR, ROOT);
  assert.equal(c.category, CATEGORY.ABSOLUTE);
});
