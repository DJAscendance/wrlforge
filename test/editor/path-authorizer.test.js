'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { authorizeWorldReference, realpathInside, lexicallyInside } = require('../../src/editor/path-authorizer');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-auth-'));
}

test('authorizes an in-project WRL that is in the discovered set', () => {
  const root = tmpRoot();
  const primary = path.join(root, 'world.wrl');
  fs.writeFileSync(primary, '#VRML V2.0 utf8\n');
  const allowedWrl = new Set([primary]);

  const abs = authorizeWorldReference({ root, allowedWrl, ref: primary });
  assert.strictEqual(abs.ok, true);
  assert.strictEqual(abs.resolved, primary);

  const rel = authorizeWorldReference({ root, allowedWrl, ref: 'world.wrl' });
  assert.strictEqual(rel.ok, true, 'a project-relative ref resolves against the root');
  assert.strictEqual(rel.resolved, primary);
});

test('rejects when no world is open, or the ref is empty/garbage', () => {
  assert.strictEqual(authorizeWorldReference({ root: null, allowedWrl: new Set(), ref: 'x.wrl' }).reason, 'no-world-open');
  const root = tmpRoot();
  assert.strictEqual(authorizeWorldReference({ root, allowedWrl: new Set(), ref: '' }).reason, 'bad-ref');
  assert.strictEqual(authorizeWorldReference({ root, allowedWrl: new Set(), ref: '   ' }).reason, 'bad-ref');
  assert.strictEqual(authorizeWorldReference({ root, allowedWrl: new Set(), ref: 42 }).reason, 'bad-ref');
});

test('rejects a ../ traversal that escapes the project root', () => {
  const root = tmpRoot();
  const outside = path.join(path.dirname(root), 'secret.wrl');
  const res = authorizeWorldReference({ root, allowedWrl: new Set([outside]), ref: '../secret.wrl' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'outside-root');
});

test('rejects an in-root file that is NOT a discovered WRL node', () => {
  const root = tmpRoot();
  const stray = path.join(root, 'not-a-dep.wrl');
  fs.writeFileSync(stray, '#VRML V2.0 utf8\n');
  const res = authorizeWorldReference({ root, allowedWrl: new Set(), ref: 'not-a-dep.wrl' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'not-in-project');
});

test('rejects a symlink whose target escapes the root', () => {
  const root = tmpRoot();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-outside-'));
  const realTarget = path.join(outsideDir, 'real.wrl');
  fs.writeFileSync(realTarget, '#VRML V2.0 utf8\n');
  const link = path.join(root, 'link.wrl');
  try {
    fs.symlinkSync(realTarget, link);
  } catch {
    return; // platform without symlink permission -- skip (Windows non-admin)
  }
  // The link is lexically in-root and (say) in the discovered set, but its real
  // target is outside -> symlink-escape.
  const res = authorizeWorldReference({ root, allowedWrl: new Set([link]), ref: 'link.wrl' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'symlink-escape');
});

test('realpathInside / lexicallyInside confinement primitives', () => {
  const root = tmpRoot();
  const inside = path.join(root, 'a', 'b.wrl');
  assert.strictEqual(lexicallyInside(root, inside), true);
  assert.strictEqual(lexicallyInside(root, root), true, 'the root itself counts as inside');
  assert.strictEqual(lexicallyInside(root, path.join(path.dirname(root), 'x')), false);
  // realpathInside falls back to lexical for a not-yet-existing target.
  assert.strictEqual(realpathInside(root, inside), true);
});
