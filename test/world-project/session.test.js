'use strict';
// The ProjectSession's refresh-safety contract: candidate-validated primary
// selection, single-flight scanning, keep-last-good-on-error, and supersession.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ProjectSession } = require('../../src/world-project/session');

test('choosePrimary rejects a path that is not a detected candidate', () => {
  const s = new ProjectSession({ scanProject: async () => ({ status: 'ok' }) });
  s.open({ root: '/p', candidates: [{ path: '/p/a.wrl' }], ambiguous: true });
  assert.throws(() => s.choosePrimary('/p/evil.wrl'), /not among/);
  assert.equal(s.choosePrimary('/p/a.wrl').primary, '/p/a.wrl');
});

test('scan requires a selected primary', async () => {
  const s = new ProjectSession({ scanProject: async () => ({}) });
  s.open({ root: '/p', candidates: [], ambiguous: true });
  await assert.rejects(() => s.scan(), (e) => e.code === 'ENOPRIMARY');
});

test('overlapping scans are refused (single-flight)', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = new ProjectSession({ scanProject: async () => { await gate; return { status: 'ok', graph: {} }; } });
  s.open({ root: '/p', primary: '/p/a.wrl', candidates: [{ path: '/p/a.wrl' }] });
  const first = s.scan();
  await assert.rejects(() => s.scan(), (e) => e.code === 'EBUSY');
  release();
  await first;
  // After it settles, a new scan is allowed again.
  const second = await s.scan();
  assert.equal(second.status, 'ok');
});

test('a failed rescan keeps the last good result (marked stale)', async () => {
  let calls = 0;
  const s = new ProjectSession({
    scanProject: async () => { calls += 1; if (calls === 2) throw new Error('parse boom'); return { status: 'ok', graph: { stats: {} }, primary: '/p/a.wrl' }; },
  });
  s.open({ root: '/p', primary: '/p/a.wrl', candidates: [{ path: '/p/a.wrl' }] });
  const good = await s.scan();
  assert.equal(good.status, 'ok');
  const afterFail = await s.scan();
  assert.equal(afterFail.stale, true);
  assert.match(afterFail.error, /parse boom/);
  assert.equal(afterFail.primary, '/p/a.wrl');
});

test('first-ever scan failure with no prior result rejects', async () => {
  const s = new ProjectSession({ scanProject: async () => { throw new Error('boom'); } });
  s.open({ root: '/p', primary: '/p/a.wrl', candidates: [{ path: '/p/a.wrl' }] });
  await assert.rejects(() => s.scan(), /boom/);
});
