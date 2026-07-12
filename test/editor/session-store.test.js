'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../../src/editor/session-store');

function tmpUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-store-'));
}

test('save/load round-trips a record; load returns null when absent', () => {
  const ud = tmpUserData();
  assert.strictEqual(store.loadSession(ud), null, 'no file yet');
  const record = { sourcePath: '/tmp/x.wrl', context: 'mall', profile: 'mall-item', root: null, format: 'plain' };
  assert.strictEqual(store.saveSession(ud, record), true);
  assert.deepStrictEqual(store.loadSession(ud), record);
});

test('load tolerates garbage / missing sourcePath', () => {
  const ud = tmpUserData();
  fs.writeFileSync(store.sessionStorePath(ud), 'not json{{');
  assert.strictEqual(store.loadSession(ud), null);
  fs.writeFileSync(store.sessionStorePath(ud), JSON.stringify({ context: 'mall' }));
  assert.strictEqual(store.loadSession(ud), null, 'a record without sourcePath is rejected');
});

test('clearSession forgets the record', () => {
  const ud = tmpUserData();
  store.saveSession(ud, { sourcePath: '/tmp/x.wrl', context: 'mall' });
  assert.ok(store.loadSession(ud));
  assert.strictEqual(store.clearSession(ud), true);
  assert.strictEqual(store.loadSession(ud), null);
  assert.strictEqual(store.clearSession(ud), true, 'clearing an already-absent record is a no-op success');
});

test('validateRestore: bad record and missing file', () => {
  assert.strictEqual(store.validateRestore(null).reason, 'bad-record');
  assert.strictEqual(store.validateRestore({}).reason, 'bad-record');
  assert.strictEqual(store.validateRestore({ sourcePath: '/no/such/file-xyz.wrl', context: 'mall' }).reason, 'missing');
});

test('validateRestore: a mall document only needs to still exist', () => {
  const dir = tmpUserData();
  const f = path.join(dir, 'item.wrl');
  fs.writeFileSync(f, '#VRML V2.0 utf8\n');
  assert.deepStrictEqual(store.validateRestore({ sourcePath: f, context: 'mall' }), { ok: true });
});

test('validateRestore: a world document must stay inside its recorded root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-wroot-'));
  const inside = path.join(root, 'world.wrl');
  fs.writeFileSync(inside, '#VRML V2.0 utf8\n');

  assert.deepStrictEqual(store.validateRestore({ sourcePath: inside, context: 'world', root }), { ok: true });

  // Root moved/deleted.
  assert.strictEqual(store.validateRestore({ sourcePath: inside, context: 'world', root: '/gone-root-xyz' }).reason, 'moved-root');

  // File exists but sits outside the recorded root -> outside-context.
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-other-'));
  const outside = path.join(other, 'elsewhere.wrl');
  fs.writeFileSync(outside, '#VRML V2.0 utf8\n');
  assert.strictEqual(store.validateRestore({ sourcePath: outside, context: 'world', root }).reason, 'outside-context');
});
