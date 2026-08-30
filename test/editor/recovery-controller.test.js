'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RecoveryController } = require('../../src/editor/recovery-controller');
const store = require('../../src/editor/recovery-store');

function tmpUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-recctrl-'));
}

// Wait long enough for any in-flight debounce timer (test debounceMs = 50).
function tick(ms) { return new Promise((r) => setTimeout(r, ms)); }

test('recordDirtyState debounces and writes once per quiet period', async () => {
  const ud = tmpUserData();
  const log = [];
  let now = 0;
  const c = new RecoveryController({
    userDataPath: ud,
    debounceMs: 50,
    openSession: () => ({ ok: true, restored: true }),
    log: (e) => log.push(e),
    now: () => { now += 1; return 1700000000000 + now; },
  });
  for (let i = 0; i < 8; i += 1) c.recordDirtyState({ buffer: 'edit ' + i, sourcePath: '/x.wrl', baseline: '', activeWorkspace: 'editor' });
  // Within the debounce window only one timer is armed; forceFlush writes it.
  c.forceFlush();
  const after = store.loadRecovery(ud);
  assert.strictEqual(after.ok, true);
  assert.strictEqual(after.record.buffer, 'edit 7', 'last write wins');
  assert.deepStrictEqual(log, [], 'log is silent on successful flush');
  c.recordClear();
});

test('recordDirtyState with debounceMs:0 is synchronous', () => {
  const ud = tmpUserData();
  const c = new RecoveryController({
    userDataPath: ud, debounceMs: 0, openSession: () => ({}),
  });
  c.recordDirtyState({ buffer: 'sync write', sourcePath: '/x.wrl', baseline: 'a', activeWorkspace: 'editor' });
  const r = store.loadRecovery(ud);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.record.buffer, 'sync write');
  c.recordClear();
});

test('recordClear drops any pending in-flight snapshot AND removes the file', async () => {
  const ud = tmpUserData();
  const c = new RecoveryController({
    userDataPath: ud, debounceMs: 200, openSession: () => ({}),
  });
  c.recordDirtyState({ buffer: 'pending', sourcePath: '/x.wrl', baseline: '', activeWorkspace: 'editor' });
  // Pending, not yet flushed.
  assert.strictEqual(c.hasPending(), true);
  c.recordClear();
  assert.strictEqual(c.hasPending(), false);
  // Either way, the file is gone.
  const r = store.loadRecovery(ud);
  assert.strictEqual(r.ok, false);
});

test('readRecovery surfaces the record (or returns found:false)', () => {
  const ud = tmpUserData();
  const c = new RecoveryController({ userDataPath: ud, openSession: () => ({}) });
  const r0 = c.readRecovery();
  assert.strictEqual(r0.found, false);
  store.saveRecovery(ud, store.makeRecord({
    sourcePath: '/x.wrl', context: 'mall', profile: 'mall-item',
    root: null, format: 'plain', baseline: '', buffer: 'dirty',
    dirty: true, activeWorkspace: 'editor',
  }));
  const r1 = c.readRecovery();
  assert.strictEqual(r1.found, true);
  assert.strictEqual(r1.record.buffer, 'dirty');
  c.recordClear();
});

test('a real Source-bearing adopt KEEPS the snapshot (Phase Beta 2 correction B3)', () => {
  const ud = tmpUserData();
  store.saveRecovery(ud, store.makeRecord({
    sourcePath: '/x.wrl', context: 'mall', profile: 'mall-item',
    root: null, format: 'plain', baseline: 'a',
    buffer: 'a edit', dirty: true, activeWorkspace: 'editor',
  }));
  const calls = [];
  const c = new RecoveryController({
    userDataPath: ud,
    openSession: (rec) => { calls.push(rec); return { open: true, restored: true, activeWorkspace: 'editor' }; },
  });
  const r = c.readRecovery();
  const adopted = c.adoptRecovery(r.record);
  assert.strictEqual(adopted.ok, true);
  assert.strictEqual(adopted.sourceRecovered, true);
  assert.strictEqual(adopted.activeWorkspace, 'editor');
  assert.strictEqual(calls.length, 1, 'openSession invoked exactly once');
  // CORRECTION: the snapshot is NOT cleared on adopt. Only Save, Discard,
  // or explicit Start Fresh clear it. Recovery survives the adopt so an
  // immediate second crash still has work to recover.
  assert.strictEqual(store.loadRecovery(ud).ok, true, 'snapshot is preserved across adopt');
  // Subsequent recordDirtyState calls update it (newest text wins).
  c.recordDirtyState({ buffer: 'a newer edit', sourcePath: '/x.wrl', baseline: 'a', activeWorkspace: 'editor' });
  c.forceFlush();
  const reread = store.loadRecovery(ud);
  assert.strictEqual(reread.ok, true);
  assert.strictEqual(reread.record.buffer, 'a newer edit');
  c.recordClear();
});

test('a Source-less (unsaved) recover KEEPS the snapshot (Phase Beta 2 correction)', () => {
  const ud = tmpUserData();
  store.saveRecovery(ud, store.makeRecord({
    sourcePath: null, context: 'generic', profile: 'generic',
    root: null, format: 'plain', baseline: '',
    buffer: 'unsaved first-pass text', dirty: true, activeWorkspace: 'editor',
  }));
  let openCalled = 0;
  const c = new RecoveryController({
    userDataPath: ud,
    openSession: () => { openCalled += 1; return { ok: true }; },
  });
  const r = c.readRecovery();
  const adopted = c.adoptRecovery(r.record);
  assert.strictEqual(adopted.ok, true);
  assert.strictEqual(adopted.sourceRecovered, false);
  assert.strictEqual(adopted.buffer, 'unsaved first-pass text');
  assert.strictEqual(openCalled, 0, 'no source -- openSession is NOT called');
  // CORRECTION: the snapshot survives adopt.
  assert.strictEqual(store.loadRecovery(ud).ok, true);
  c.recordClear();
});

test('a malformed snapshot is rejected at validate, NOT adopted, NOT cleared (so the user can re-decide)', () => {
  const ud = tmpUserData();
  fs.writeFileSync(store.recoveryStorePath(ud), JSON.stringify({ schemaVersion: 999 }));
  const c = new RecoveryController({ userDataPath: ud, openSession: () => ({ ok: true }) });
  const r = c.readRecovery();
  assert.strictEqual(r.found, false);
  assert.strictEqual(r.reason, 'schema-mismatch');
  const adopted = c.adoptRecovery(r.record);
  assert.strictEqual(adopted.ok, false);
  // File is still on disk: readRecovery validated it as bad.
  assert.ok(fs.existsSync(store.recoveryStorePath(ud)));
});

test('readRecovery logs and suppresses a corrupt JSON file (does not throw)', () => {
  const ud = tmpUserData();
  fs.writeFileSync(store.recoveryStorePath(ud), '{this is not json');
  const log = [];
  const c = new RecoveryController({
    userDataPath: ud, openSession: () => ({}),
    log: (e) => log.push(e),
  });
  const r = c.readRecovery();
  assert.strictEqual(r.found, false);
  assert.strictEqual(r.reason, 'bad-json');
  assert.deepStrictEqual(log, [{ event: 'recovery-load-skipped', reason: 'bad-json' }]);
});

test('abnormal-failure equivalent: a Save failure keeps the snapshot available on next launch', async () => {
  const ud = tmpUserData();
  const c = new RecoveryController({ userDataPath: ud, debounceMs: 0, openSession: () => ({}) });
  c.recordDirtyState({ buffer: 'important edit', sourcePath: '/x.wrl', baseline: 'a', activeWorkspace: 'editor' });
  // Simulate a Save that fails: the snapshot is INTENTIONALLY kept.
  // (Production wires this through main.js's editor:save IPC handler.)
  assert.strictEqual(store.loadRecovery(ud).ok, true, 'snapshot survives a failed Save');
  // On a successful next Save, the snapshot WOULD be cleared (we test it here).
  c.recordClear();
  assert.strictEqual(store.loadRecovery(ud).ok, false);
});

test('abnormal-failure equivalent: a renderer reload leaves the snapshot; the next mount restores it (and keeps it active for a second crash)', async () => {
  const ud = tmpUserData();
  const c1 = new RecoveryController({ userDataPath: ud, debounceMs: 0, openSession: () => ({ ok: true }) });
  c1.recordDirtyState({ buffer: 'unsaved key-strokes', sourcePath: '/x.wrl', baseline: 'a', activeWorkspace: 'editor' });
  c1.forceFlush();
  // Simulated renderer kill: a NEW controller instance reads the same file.
  const c2 = new RecoveryController({ userDataPath: ud, openSession: (rec) => ({ ok: true, activeWorkspace: 'editor', info: { sourcePath: rec.sourcePath } }) });
  const r = c2.readRecovery();
  assert.strictEqual(r.found, true);
  const adopted = c2.adoptRecovery(r.record);
  assert.strictEqual(adopted.ok, true);
  // CORRECTION (B3): the snapshot survives the adopt. Only Save / Discard
  // / explicit Start Fresh clear it. A renderer reload mid-edit or an
  // immediate second crash must still find the work.
  assert.strictEqual(store.loadRecovery(ud).ok, true, 'snapshot stays active across adopt');
});

test('explicit discard is honored on Start Fresh (no restore)', async () => {
  const ud = tmpUserData();
  const c = new RecoveryController({ userDataPath: ud, debounceMs: 0, openSession: () => ({}) });
  c.recordDirtyState({ buffer: 'user discarded', sourcePath: '/x.wrl', baseline: '', activeWorkspace: 'editor' });
  assert.strictEqual(store.loadRecovery(ud).ok, true);
  c.recordClear();
  assert.strictEqual(store.loadRecovery(ud).ok, false);
  // A subsequent read by a new controller sees nothing.
  const c2 = new RecoveryController({ userDataPath: ud, openSession: () => ({}) });
  assert.strictEqual(c2.readRecovery().found, false);
});

test('debounceMs=0 plus rapid pings still produces a snapshot (only the last payload matters)', () => {
  const ud = tmpUserData();
  const c = new RecoveryController({ userDataPath: ud, debounceMs: 0, openSession: () => ({}) });
  c.recordDirtyState({ buffer: 'one', sourcePath: '/a.wrl', baseline: '', activeWorkspace: 'editor' });
  c.recordDirtyState({ buffer: 'two', sourcePath: '/a.wrl', baseline: '', activeWorkspace: 'editor' });
  c.recordDirtyState({ buffer: 'three', sourcePath: '/a.wrl', baseline: '', activeWorkspace: 'editor' });
  const r = store.loadRecovery(ud);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.record.buffer, 'three');
  c.recordClear();
});

test('recordDirtyState with a missing userDataPath short-circuits without throwing', () => {
  const c = new RecoveryController({ userDataPath: null, openSession: () => ({}) });
  const r = c.recordDirtyState({ buffer: 'x', sourcePath: '/x', baseline: '', activeWorkspace: 'editor' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-userdata');
});

test('recordClear with a missing userDataPath returns ok:false (not a throw)', () => {
  const c = new RecoveryController({ userDataPath: null, openSession: () => ({}) });
  const r = c.recordClear();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-userdata');
});

test('recordDirtyState with a bad payload is rejected without throwing', () => {
  const ud = tmpUserData();
  const c = new RecoveryController({ userDataPath: ud, openSession: () => ({}) });
  const r1 = c.recordDirtyState(null);
  assert.strictEqual(r1.ok, false);
  const r2 = c.recordDirtyState({ sourcePath: '/x' }); // no buffer
  assert.strictEqual(r2.ok, false);
  c.recordClear();
});

test('debounce window collapses with rapid edits; forceFlush honors the latest pending payload', async () => {
  const ud = tmpUserData();
  const c = new RecoveryController({ userDataPath: ud, debounceMs: 100, openSession: () => ({}) });
  c.recordDirtyState({ buffer: 'a', sourcePath: '/x.wrl', baseline: '', activeWorkspace: 'editor' });
  await tick(20);
  c.recordDirtyState({ buffer: 'b', sourcePath: '/x.wrl', baseline: '', activeWorkspace: 'editor' });
  await tick(20);
  c.recordDirtyState({ buffer: 'c', sourcePath: '/x.wrl', baseline: '', activeWorkspace: 'editor' });
  c.forceFlush();
  const r = store.loadRecovery(ud);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.record.buffer, 'c');
  c.recordClear();
});

test('sanity: dirty=false on a record still saves it (Start Fresh handles removal)', () => {
  const ud = tmpUserData();
  const c = new RecoveryController({ userDataPath: ud, debounceMs: 0, openSession: () => ({}) });
  c.recordDirtyState({ buffer: 'saved and clean', sourcePath: '/x.wrl', baseline: 'saved and clean', dirty: false, activeWorkspace: 'editor' });
  const r = store.loadRecovery(ud);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.record.dirty, false);
  c.recordClear();
});
