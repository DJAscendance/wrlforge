'use strict';
// Non-visual unit tests for the single-instance lock: a live holder blocks a
// second run, a dead holder's stale lock is reclaimed, and release only removes
// our own lock. Uses a temp lock path and injected liveness -- no real process.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquire } = require('../../qa/visual-qa/lock');

function tmpLock() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wrlqa-lock-')), 'visual-qa.lock');
}

test('acquires a free lock and writes our pid', () => {
  const lp = tmpLock();
  const release = acquire(lp, { pid: 4242, isAlive: () => false });
  assert.equal(JSON.parse(fs.readFileSync(lp, 'utf8')).pid, 4242);
  release();
  assert.equal(fs.existsSync(lp), false, 'release removes our lock');
});

test('rejects when a LIVE holder already owns the lock', () => {
  const lp = tmpLock();
  acquire(lp, { pid: 111, isAlive: () => true }); // holder 111, still alive
  assert.throws(
    () => acquire(lp, { pid: 222, isAlive: (pid) => pid === 111 }),
    (e) => e.code === 'ELOCKED'
  );
});

test('reclaims a STALE lock whose holder is dead', () => {
  const lp = tmpLock();
  // Simulate a crashed run: lock file names a pid that is no longer alive.
  fs.writeFileSync(lp, JSON.stringify({ pid: 999, at: 1 }));
  const release = acquire(lp, { pid: 333, isAlive: (pid) => pid !== 999 });
  assert.equal(JSON.parse(fs.readFileSync(lp, 'utf8')).pid, 333, 'stale lock reclaimed by us');
  release();
});

test('release does not delete a lock that was taken over by someone else', () => {
  const lp = tmpLock();
  const release = acquire(lp, { pid: 500, isAlive: () => false });
  // Another run overwrites the lock with its own pid.
  fs.writeFileSync(lp, JSON.stringify({ pid: 600, at: 2 }));
  release();
  assert.equal(fs.existsSync(lp), true, 'must not remove a lock we no longer own');
  assert.equal(JSON.parse(fs.readFileSync(lp, 'utf8')).pid, 600);
});

test('garbage lock content is treated as free', () => {
  const lp = tmpLock();
  fs.writeFileSync(lp, 'not-json');
  const release = acquire(lp, { pid: 777, isAlive: () => true });
  assert.equal(JSON.parse(fs.readFileSync(lp, 'utf8')).pid, 777);
  release();
});
