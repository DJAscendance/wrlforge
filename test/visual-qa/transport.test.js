'use strict';
// Phase 7C5: the platform-aware capture-server job transport + the runner hooks
// it plugs into. POSIX keeps the historical stdin path; Windows delivers jobs via
// a file because a GUI-subsystem electron.exe has an immediately-ended stdin.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeCaptureTransport } = require('../../qa/visual-qa/transport');
const { VisualQaRunner } = require('../../qa/visual-qa/runner');
const { makeRegistry, FakeChild } = require('./_fake');

test('POSIX transport is a no-op: stdin defaults, no jobs file, no env', () => {
  for (const plat of ['linux', 'darwin']) {
    const t = makeCaptureTransport(plat);
    assert.equal(t.jobsFile, null);
    assert.deepEqual(t.env, {});
    assert.deepEqual(t.runnerOpts, {});
    assert.doesNotThrow(() => t.cleanup());
  }
});

test('win32 transport delivers jobs via a file and makes stdin writes no-ops', () => {
  const fakeFs = {
    made: [], wrote: [], removed: [],
    mkdtempSync(p) { this.made.push(p); return p + 'XYZ'; },
    writeFileSync(f, d) { this.wrote.push([f, d]); },
    rmSync(d) { this.removed.push(d); },
  };
  const fakeOs = { tmpdir: () => '/tmp' };
  const t = makeCaptureTransport('win32', { fs: fakeFs, os: fakeOs, path });

  assert.ok(t.jobsFile.endsWith(path.join('XYZ', 'jobs.json')), 'jobs file under the temp dir');
  assert.equal(t.env.WRL_FORGE_CAPTURE_JOBS_FILE, t.jobsFile, 'env points the server at the jobs file');

  // prepareJobs writes the batch as JSON to the jobs file.
  t.runnerOpts.prepareJobs([{ id: 'a' }, { id: 'b' }]);
  assert.equal(fakeFs.wrote.length, 1);
  assert.equal(fakeFs.wrote[0][0], t.jobsFile);
  assert.deepEqual(JSON.parse(fakeFs.wrote[0][1]), [{ id: 'a' }, { id: 'b' }]);

  // writeJob / requestShutdown must NOT touch stdin (they are no-ops on Windows).
  const child = { stdin: { write() { throw new Error('stdin must not be used on the file transport'); } } };
  assert.doesNotThrow(() => t.runnerOpts.writeJob(child, { id: 'a' }));
  assert.doesNotThrow(() => t.runnerOpts.requestShutdown(child));

  t.cleanup();
  assert.equal(fakeFs.removed.length, 1, 'cleanup removes the temp dir');
});

test('runner uses prepareJobs/writeJob/requestShutdown hooks instead of hardcoded stdin', async () => {
  const reg = makeRegistry();
  const calls = { prepare: 0, prepared: null, writes: [], shutdowns: 0 };
  const spawned = [];
  const spawn = () => { const c = new FakeChild(70000 + spawned.length, reg); spawned.push(c); return c; };

  const runner = new VisualQaRunner({
    spawn,
    isAlive: reg.isAlive,
    sleep: () => Promise.resolve(),
    log: () => {},
    killChild: (c) => c.kill(),
    readyTimeoutMs: 50, captureTimeoutMs: 50, shutdownGraceMs: 50, killGraceMs: 50,
    // File-transport-style hooks: deliver out-of-band, never via stdin.
    prepareJobs: (jobs) => { calls.prepare += 1; calls.prepared = jobs; },
    writeJob: (child, job) => { calls.writes.push(job.id); queueMicrotask(() => child._emitLine(`WRL_FORGE_CAPTURE_OK ${job.id} {}`)); },
    requestShutdown: (child) => { calls.shutdowns += 1; queueMicrotask(() => child.exit(0)); },
  });

  const jobs = [{ id: 'j0' }, { id: 'j1' }];
  const results = await runner.run(jobs);

  assert.equal(results.length, 2);
  assert.equal(calls.prepare, 1, 'prepareJobs called once before spawn');
  assert.deepEqual(calls.prepared, jobs, 'prepareJobs received the full batch');
  assert.deepEqual(calls.writes, ['j0', 'j1'], 'writeJob used per job');
  assert.equal(calls.shutdowns, 1, 'requestShutdown used for teardown');
  assert.equal(spawned[0].stdin.writes.length, 0, 'child stdin never written on the file transport');
  assert.deepEqual(runner.survivors(), [], 'no survivors');
});
