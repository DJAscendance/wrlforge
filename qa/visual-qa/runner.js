'use strict';
// VisualQaRunner -- the single sanctioned driver for WRL Forge visual QA.
//
// Why this exists: the July 12 incident was a GNOME Shell compositor SIGSEGV
// triggered by a storm of Electron launches (one process per screenshot, no
// throttle, no teardown, no accounting). This runner makes that class of failure
// structurally impossible:
//   * concurrency EXACTLY 1  -- a second run() while one is active throws
//   * ONE reused Electron process drives ALL jobs (capture-server mode)
//   * hard launch cap        -- total spawns (incl. retries) can never exceed it
//   * cooldown               -- enforced delay between successive launches
//   * bounded retries        -- a failed launch retries at most N times
//   * readiness + per-job timeouts, graceful shutdown, awaited exit
//   * exact PID tracking + post-run leak check (fail if anything survives)
//   * structured lifecycle logging for every step
//
// Everything the runner touches (spawn, sleep, clock, liveness) is injectable,
// so the whole control surface is unit-tested with fake child processes -- no
// real Electron, no windows, no GPU. See test/visual-qa/runner.test.js.

const READY = 'WRL_FORGE_CAPTURE_READY';
const OK = 'WRL_FORGE_CAPTURE_OK';
const ERR = 'WRL_FORGE_CAPTURE_ERR';

const DEFAULTS = {
  maxLaunches: 2,        // total Electron spawns allowed across the whole run
  retriesPerLaunch: 1,   // extra attempts after the first (each counts vs the cap)
  cooldownMs: 1500,      // minimum gap between one launch exiting and the next
  readyTimeoutMs: 20000, // wait for the READY line after spawn
  captureTimeoutMs: 30000,// wait for one job's OK/ERR line
  shutdownGraceMs: 8000, // wait for graceful exit before escalating to SIGTERM
  killGraceMs: 5000,     // wait for exit after SIGTERM before declaring a leak
};

class VisualQaRunner {
  constructor(opts = {}) {
    this.spawn = opts.spawn;                       // required: (jobsCount) => child
    if (typeof this.spawn !== 'function') throw new Error('VisualQaRunner requires a spawn function');
    this.log = opts.log || (() => {});
    this.sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now || (() => Date.now());
    this.isAlive = opts.isAlive || require('./lock').defaultIsAlive;
    // Escalation primitive for _forceCleanup. Platform-aware by default: POSIX
    // gets the original single-pid SIGTERM; Windows gets a targeted process-TREE
    // kill (taskkill /PID <pid> /T /F), since Electron spawns helper/renderer
    // children that a bare TerminateProcess on the main pid would orphan.
    // Still never process-name-wide (no /IM) -- only the one tracked pid's tree.
    this.killChild = opts.killChild || killerFor(process.platform);
    // Job-delivery transport. Default (POSIX): newline-JSON over the child's
    // stdin. Windows overrides these because a GUI-subsystem electron.exe gets an
    // immediately-ended process.stdin (Phase 7C5) -- there jobs are pre-written to
    // a file the server reads (prepareJobs) and the per-job/shutdown stdin writes
    // become no-ops (the server self-quits after the last job). See transport.js.
    this.prepareJobs = opts.prepareJobs || (() => {});
    this.writeJob = opts.writeJob || ((child, job) => { child.stdin.write(JSON.stringify(job) + '\n'); });
    this.requestShutdown = opts.requestShutdown || ((child) => {
      try { child.stdin.write(JSON.stringify({ cmd: 'shutdown' }) + '\n'); } catch { /* stdin may be gone */ }
    });
    this.cfg = { ...DEFAULTS, ...pick(opts, Object.keys(DEFAULTS)) };

    this._active = false;      // concurrency==1 guard
    this.launchesUsed = 0;     // total spawns performed (incl. retries)
    this.tracked = new Set();  // PIDs we have ever spawned and must account for
  }

  _emit(event, fields) {
    this.log({ event, ts: this.now(), ...fields });
  }

  // Drive every job through ONE reused Electron process, with retries.
  async run(jobs) {
    if (this._active) throw new Error('VisualQaRunner is already running (concurrency is 1)');
    if (!Array.isArray(jobs) || jobs.length === 0) throw new Error('run() needs at least one job');
    this._active = true;
    this._emit('run:start', { jobs: jobs.length, cfg: this.cfg });
    try {
      const results = await this._withRetries(jobs);
      this._emit('run:done', { jobs: jobs.length, launchesUsed: this.launchesUsed });
      return results;
    } finally {
      this._active = false;
    }
  }

  async _withRetries(jobs) {
    let attempt = 0;
    let lastErr;
    // attempts allowed = 1 + retriesPerLaunch, each also bounded by the cap.
    while (attempt <= this.cfg.retriesPerLaunch) {
      if (this.launchesUsed >= this.cfg.maxLaunches) {
        const e = new Error(`launch cap reached (${this.launchesUsed}/${this.cfg.maxLaunches}) -- refusing to spawn again`);
        e.code = 'ECAP';
        throw e;
      }
      if (this.launchesUsed > 0) {
        this._emit('cooldown', { ms: this.cfg.cooldownMs });
        await this.sleep(this.cfg.cooldownMs);
      }
      attempt += 1;
      this.launchesUsed += 1;
      const launchNo = this.launchesUsed;
      try {
        return await this._oneLaunch(jobs, launchNo, attempt);
      } catch (err) {
        lastErr = err;
        // A cap/leak failure is terminal -- retrying can't help and must not
        // spawn again. Only transient launch/job failures retry.
        if (err.code === 'ECAP' || err.code === 'ELEAK') throw err;
        this._emit('launch:failed', { launchNo, attempt, error: String(err.message || err) });
        if (attempt <= this.cfg.retriesPerLaunch) {
          this._emit('retry:scheduled', { nextAttempt: attempt + 1 });
          continue;
        }
      }
    }
    throw lastErr || new Error('visual QA run failed');
  }

  async _oneLaunch(jobs, launchNo, attempt) {
    // Deliver jobs out-of-band before spawning where the transport needs it
    // (Windows file transport writes the batch the server will read at startup).
    this.prepareJobs(jobs);
    const child = this.spawn(jobs.length);
    const pid = child.pid;
    this.tracked.add(pid);
    this._emit('launch', { launchNo, attempt, pid, jobs: jobs.length });

    const reader = lineReader(child);
    try {
      await this._await(reader, (l) => l === READY, this.cfg.readyTimeoutMs, `ready(pid ${pid})`);
      this._emit('ready', { pid });

      const results = [];
      for (const job of jobs) {
        const t0 = this.now();
        this._emit('capture:start', { pid, id: job.id, fixture: job.fixture, mode: job.mode, out: job.out });
        this.writeJob(child, job);
        const line = await this._await(
          reader,
          (l) => l.startsWith(OK + ' ' + job.id + ' ') || l.startsWith(ERR + ' ' + job.id + ' '),
          this.cfg.captureTimeoutMs,
          `capture ${job.id}(pid ${pid})`
        );
        if (line.startsWith(ERR)) {
          throw new Error(`capture ${job.id} failed: ${line.slice((ERR + ' ' + job.id + ' ').length)}`);
        }
        const payload = safeJson(line.slice((OK + ' ' + job.id + ' ').length));
        this._emit('capture:done', { pid, id: job.id, ms: this.now() - t0, payload });
        results.push({ id: job.id, ...payload });
      }

      await this._shutdown(child, pid);
      this._assertGone(pid);
      return results;
    } catch (err) {
      // Any failure path still tears the process down and accounts for the PID.
      await this._forceCleanup(child, pid);
      this._assertGone(pid);
      throw err;
    } finally {
      reader.dispose();
    }
  }

  // Graceful: ask the server to quit, await its own exit within the grace window.
  async _shutdown(child, pid) {
    this._emit('shutdown:request', { pid });
    this.requestShutdown(child);
    const exited = await this._awaitExit(child, this.cfg.shutdownGraceMs);
    if (!exited) {
      this._emit('shutdown:timeout', { pid, graceMs: this.cfg.shutdownGraceMs });
      await this._forceCleanup(child, pid);
    } else {
      this._emit('exit', { pid, code: child.exitCode, graceful: true });
    }
  }

  // Escalation, never process-name-wide: kill the ONE tracked pid (and, on
  // Windows, its process tree), await exit.
  async _forceCleanup(child, pid) {
    if (!this.isAlive(pid)) return;
    this._emit('terminate', { pid });
    this.killChild(child, pid);
    const exited = await this._awaitExit(child, this.cfg.killGraceMs);
    this._emit(exited ? 'exit' : 'terminate:timeout', { pid, code: child.exitCode, graceful: false });
  }

  // Post-condition: the tracked pid must be gone. If not, it's a leak -> fail.
  _assertGone(pid) {
    const alive = this.isAlive(pid);
    this._emit('leak:check', { pid, alive });
    if (alive) {
      const e = new Error(`Electron process ${pid} is still alive after teardown -- possible leak`);
      e.code = 'ELEAK';
      throw e;
    }
    this.tracked.delete(pid);
  }

  // Final accounting the caller can assert on: any tracked pid still alive.
  survivors() {
    return [...this.tracked].filter((pid) => this.isAlive(pid));
  }

  _await(reader, match, timeoutMs, what) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reader.off(onLine);
        const e = new Error(`timeout waiting for ${what} after ${timeoutMs}ms`);
        e.code = 'ETIMEOUT';
        reject(e);
      }, timeoutMs);
      function onLine(line) {
        if (!match(line)) return;
        clearTimeout(timer);
        reader.off(onLine);
        resolve(line);
      }
      reader.on(onLine);
    });
  }

  _awaitExit(child, timeoutMs) {
    if (child.exitCode !== null && child.exitCode !== undefined) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { child.removeListener('exit', onExit); resolve(false); }, timeoutMs);
      const onExit = () => { clearTimeout(timer); resolve(true); };
      child.once('exit', onExit);
    });
  }
}

// --- tiny line reader over a child's stdout (handles partial chunks) ---------
function lineReader(child) {
  const listeners = new Set();
  let buf = '';
  const onData = (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      for (const fn of [...listeners]) fn(line);
    }
  };
  child.stdout.on('data', onData);
  return {
    on: (fn) => listeners.add(fn),
    off: (fn) => listeners.delete(fn),
    dispose: () => { listeners.clear(); child.stdout.removeListener('data', onData); },
  };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

// Pure factory so the platform choice is unit-testable without touching the
// real process.platform: pass a platform string explicitly to get the kill
// function that platform would use. `spawnSync` is injectable for tests.
function killerFor(platform, spawnSync = require('child_process').spawnSync) {
  if (platform === 'win32') {
    return (_child, pid) => {
      try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* best effort */ }
    };
  }
  return (child) => {
    try { child.kill('SIGTERM'); } catch { /* already dead */ }
  };
}

module.exports = { VisualQaRunner, DEFAULTS, READY, OK, ERR, killerFor };
