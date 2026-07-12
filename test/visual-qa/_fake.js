'use strict';
// Fake Electron child + liveness registry for driving VisualQaRunner in unit
// tests -- no real process, no window, no GPU. Models exactly the surface the
// runner touches: pid, stdin.write, stdout 'data', 'exit', kill(), exitCode.

const { EventEmitter } = require('events');

// Shared registry of "alive" pids so isAlive() reflects fake exits/kills.
function makeRegistry() {
  const alive = new Set();
  return {
    alive,
    isAlive: (pid) => alive.has(pid),
    spawnPid: (pid) => { alive.add(pid); },
    killPid: (pid) => { alive.delete(pid); },
  };
}

class FakeChild extends EventEmitter {
  constructor(pid, registry, behavior = {}) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.killed = false;
    this._registry = registry;
    this._behavior = behavior; // { neverReady, failJobIds:Set, dieOnKill, dieOnShutdown }
    registry.spawnPid(pid);

    const self = this;
    this.stdin = {
      writes: [],
      write(s) {
        this.writes.push(s);
        self._onStdin(s);
        return true;
      },
    };
    this.stdout = new EventEmitter();

    // Announce readiness on a later microtask, after the runner has attached its
    // READY listener (never synchronously inside spawn()).
    if (!behavior.neverReady) queueMicrotask(() => this._emitLine('WRL_FORGE_CAPTURE_READY'));
  }

  _emitLine(line) { this.stdout.emit('data', Buffer.from(line + '\n')); }

  _onStdin(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.cmd === 'shutdown') {
      if (this._behavior.dieOnShutdown !== false) queueMicrotask(() => this.exit(0));
      return;
    }
    // A job: succeed unless configured to fail this id.
    const fail = this._behavior.failJobIds && this._behavior.failJobIds.has(msg.id);
    queueMicrotask(() => {
      if (fail) this._emitLine(`WRL_FORGE_CAPTURE_ERR ${msg.id} synthetic-failure`);
      else this._emitLine(`WRL_FORGE_CAPTURE_OK ${msg.id} ${JSON.stringify({ out: msg.out || null })}`);
    });
  }

  kill(/* signal */) {
    this.killed = true;
    if (this._behavior.dieOnKill !== false) queueMicrotask(() => this.exit(143));
  }

  exit(code = 0) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this._registry.killPid(this.pid);
    this.emit('exit', code);
  }
}

// Build a spawn() that hands out scripted children in order. Each entry is a
// behavior object; pid = basePid + index.
function scriptedSpawn(registry, behaviors, basePid = 90000) {
  let i = 0;
  const spawned = [];
  const spawn = () => {
    const behavior = behaviors[Math.min(i, behaviors.length - 1)];
    const child = new FakeChild(basePid + i, registry, behavior);
    i += 1;
    spawned.push(child);
    return child;
  };
  spawn.spawned = spawned;
  return spawn;
}

module.exports = { makeRegistry, FakeChild, scriptedSpawn };
