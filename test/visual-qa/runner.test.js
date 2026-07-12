'use strict';
// Non-visual unit tests for the visual-QA orchestrator. These prove the
// anti-launch-storm guarantees with fake child processes -- no Electron, no
// display -- so they run in the default `npm test` gate.

const test = require('node:test');
const assert = require('node:assert/strict');
const { VisualQaRunner } = require('../../qa/visual-qa/runner');
const { makeRegistry, scriptedSpawn } = require('./_fake');

// Fast, deterministic config: tiny timeouts, instant sleeps that record delays.
function fastRunner(spawn, registry, over = {}) {
  const cooldowns = [];
  const logs = [];
  const runner = new VisualQaRunner({
    spawn,
    isAlive: registry.isAlive,
    sleep: (ms) => { cooldowns.push(ms); return Promise.resolve(); },
    log: (r) => logs.push(r),
    readyTimeoutMs: 50,
    captureTimeoutMs: 50,
    shutdownGraceMs: 50,
    killGraceMs: 50,
    cooldownMs: 1500,
    maxLaunches: 2,
    retriesPerLaunch: 1,
    ...over,
  });
  return { runner, cooldowns, logs };
}

const jobs = (n) => Array.from({ length: n }, (_, i) => ({ id: `j${i}`, fixture: `/x/${i}.wrl`, out: `/tmp/${i}.png` }));

test('reuses ONE process for many jobs and leaves nothing alive', async () => {
  const reg = makeRegistry();
  const spawn = scriptedSpawn(reg, [{}]);
  const { runner } = fastRunner(spawn, reg);
  const results = await runner.run(jobs(3));
  assert.equal(results.length, 3);
  assert.equal(spawn.spawned.length, 1, 'exactly one Electron process for all 3 jobs');
  assert.equal(runner.launchesUsed, 1);
  assert.deepEqual(runner.survivors(), [], 'no tracked pid may survive');
  // The single child received 3 job writes + 1 shutdown.
  assert.equal(spawn.spawned[0].stdin.writes.filter((w) => w.includes('shutdown')).length, 1);
});

test('concurrency is exactly 1: a second run() while active throws', async () => {
  const reg = makeRegistry();
  const spawn = scriptedSpawn(reg, [{}]);
  const { runner } = fastRunner(spawn, reg);
  const p = runner.run(jobs(2));
  await assert.rejects(() => runner.run(jobs(1)), /already running \(concurrency is 1\)/);
  await p;
});

test('enforces a cooldown between successive launches', async () => {
  const reg = makeRegistry();
  // First launch fails its job -> retry -> second launch. Cooldown must precede it.
  const spawn = scriptedSpawn(reg, [{ failJobIds: new Set(['j0']) }, {}]);
  const { runner, cooldowns } = fastRunner(spawn, reg);
  await runner.run(jobs(1));
  assert.equal(runner.launchesUsed, 2);
  assert.deepEqual(cooldowns, [1500], 'exactly one 1500ms cooldown before the retry launch');
});

test('hard launch cap: never spawns beyond maxLaunches', async () => {
  const reg = makeRegistry();
  // Every launch fails, retries allowed high, but cap=2 must stop spawning at 2.
  const spawn = scriptedSpawn(reg, [{ failJobIds: new Set(['j0']) }]);
  const { runner } = fastRunner(spawn, reg, { maxLaunches: 2, retriesPerLaunch: 10 });
  await assert.rejects(() => runner.run(jobs(1)), /synthetic-failure|launch cap/);
  assert.equal(spawn.spawned.length, 2, 'cap holds spawns to 2 despite 10 retries allowed');
  assert.equal(runner.launchesUsed, 2);
  assert.deepEqual(runner.survivors(), []);
});

test('bounded retry: a transient launch failure recovers on the next launch', async () => {
  const reg = makeRegistry();
  const spawn = scriptedSpawn(reg, [{ failJobIds: new Set(['j0']) }, {}]);
  const { runner, logs } = fastRunner(spawn, reg);
  const results = await runner.run(jobs(1));
  assert.equal(results.length, 1);
  assert.equal(runner.launchesUsed, 2);
  assert.ok(logs.some((l) => l.event === 'retry:scheduled'), 'a retry must be logged');
});

test('readiness timeout tears the process down and reports no leak', async () => {
  const reg = makeRegistry();
  const spawn = scriptedSpawn(reg, [{ neverReady: true, dieOnKill: true }]);
  const { runner, logs } = fastRunner(spawn, reg, { retriesPerLaunch: 0 });
  await assert.rejects(() => runner.run(jobs(1)), /timeout waiting for ready/);
  assert.ok(spawn.spawned[0].killed, 'the stuck child must be SIGTERM-ed');
  assert.deepEqual(runner.survivors(), [], 'terminated child must not survive');
  assert.ok(logs.some((l) => l.event === 'terminate'));
});

test('leak detection: a child that refuses to die fails the run with ELEAK', async () => {
  const reg = makeRegistry();
  // Never dies on shutdown OR kill -> stays in the alive registry -> leak.
  const spawn = scriptedSpawn(reg, [{ dieOnShutdown: false, dieOnKill: false }]);
  const { runner } = fastRunner(spawn, reg, { retriesPerLaunch: 1 });
  await assert.rejects(() => runner.run(jobs(1)), (e) => e.code === 'ELEAK');
  assert.equal(spawn.spawned.length, 1, 'a leak is terminal -- no retry spawn');
  assert.deepEqual(runner.survivors(), [spawn.spawned[0].pid], 'the leaked pid is reported');
});

test('never spawns for an empty job list', async () => {
  const reg = makeRegistry();
  const spawn = scriptedSpawn(reg, [{}]);
  const { runner } = fastRunner(spawn, reg);
  await assert.rejects(() => runner.run([]), /at least one job/);
  assert.equal(spawn.spawned.length, 0);
});
