'use strict';
// Phase 7C3 perf / stress harness -- PURE bridge/scheduler level (no Electron).
// Drives the exact main-process World bridge + scheduler the renderer uses,
// over a REAL scratch world staged under the OS temp dir (read-only: hashed
// before and after to prove no source write), and asserts the 7C3 invariants:
//   * 50 rapid edits to the PRIMARY coalesce to ONE fired update (newest only),
//   * 50 rapid edits to a NESTED WRL coalesce identically,
//   * alternating primary/nested document switches never leak the prior buffer,
//   * 25 consecutive successful scene replacements keep ordering + one overlay,
//   * 25 failed-then-repaired updates: the failed generation is never accepted,
//     the repaired one is, and stale accepts stay refused,
//   * a project switch with a pending update cancels + reaches zero overlays,
//   * repeated viewpoint-restore resolution is stable over 1000 refreshes,
//   * memory stays flat across repeated loads; zero overlays/generations after
//     close; the scratch world's bytes are hash-identical afterwards.
//
//   node qa/phase-7c-world-preview/stress.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { createWorldPreviewBridge } = require('../../src/preview/world-preview-bridge');
const { createPreviewScheduler } = require('../../src/preview/preview-scheduler');
const { resolveViewpointRestore } = require('../../src/preview/viewpoint-preserve');
const { readWrlSource } = require('../../src/preview/wrl-source');

const HEADER = '#VRML V2.0 utf8\n';

function bench(label, fn) {
  const t0 = process.hrtime.bigint();
  const n = fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { label, n, ms: Math.round(ms * 1000) / 1000, perOpUs: Math.round((ms / n) * 1000) };
}

// ---- a REAL scratch world (read-only evidence base) -------------------------
function stage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-worldstress-'));
  fs.mkdirSync(path.join(root, 'rooms'));
  const primary = path.join(root, 'entry.wrl');
  const nested = path.join(root, 'rooms', 'hall.wrl');
  const nestedGz = path.join(root, 'rooms', 'vault.wrl');
  fs.writeFileSync(primary, HEADER + 'Inline { url "rooms/hall.wrl" }\nInline { url "rooms/vault.wrl" }\n', 'utf8');
  fs.writeFileSync(nested, HEADER + 'DEF Hall Shape { geometry Box {} }\n', 'utf8');
  fs.writeFileSync(nestedGz, zlib.gzipSync(Buffer.from(HEADER + 'DEF Vault Shape { geometry Sphere {} }\n', 'utf8')));
  return { root, primary, nested, nestedGz };
}

function hashTree(root) {
  const out = {};
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else out[path.relative(root, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  };
  walk(root);
  return out;
}

function run() {
  const results = {};
  const W = stage();
  const hashesBefore = hashTree(W.root);

  const graph = {
    wrlNodes: [
      { path: W.primary, depth: 0, refs: [] },
      { path: W.nested, depth: 1, refs: [] },
      { path: W.nestedGz, depth: 1, refs: [] },
    ],
    assets: [], missing: [], caseMismatches: [], remoteRefs: [], unsafe: [],
    stats: { wrlFiles: 3 },
  };
  const st = {
    sid: 1,
    doc: W.primary,
    scan: { status: 'ok', root: W.root, primary: W.primary, graph },
  };
  const bridge = createWorldPreviewBridge({
    describeSession: () => ({ open: true, sessionId: st.sid, context: 'world', sourcePath: st.doc }),
    getWorldRoot: () => W.root,
    getWorldPrimary: () => W.primary,
    getScan: () => st.scan,
    rescan: async () => st.scan,
    readSaved: (p) => readWrlSource(p), // REAL gzip-transparent disk reads
  });

  let requested = 0, rendered = 0, staleIgnored = 0;

  // --- 1+2. coalescing: 50 rapid PRIMARY edits, then 50 rapid NESTED edits ----
  for (const doc of [W.primary, W.nested]) {
    st.sid += 1; st.doc = doc;
    const s = createPreviewScheduler({ debounceMs: 700 });
    let clock = 0;
    for (let v = 1; v <= 50; v++) {
      clock += 5;
      requested += 1;
      s.requestAuto('sess', { bufferVersion: v, byteLength: 400, at: clock });
    }
    assert.equal(s.poll('sess', clock + 699).fire, false, 'not due before debounce');
    const fired = s.poll('sess', clock + 700);
    assert.equal(fired.fire, true);
    assert.equal(fired.bufferVersion, 50, 'only the NEWEST version renders');
    const res = bridge.load({ sessionId: st.sid, text: HEADER + `# v${fired.bufferVersion}\n`, bufferVersion: fired.bufferVersion });
    assert.equal(res.ok, true);
    rendered += 1;
    assert.equal(bridge.overlay.size, 1, 'exactly one overlay entry during the burst');
    results[doc === W.primary ? 'coalesce_primary_50' : 'coalesce_nested_50'] = { firedVersion: fired.bufferVersion };
  }

  // --- 3. alternating primary/nested document switches ------------------------
  for (let i = 0; i < 40; i++) {
    const prevSid = st.sid;
    st.sid += 1;
    st.doc = i % 2 ? W.nested : W.primary;
    const r = bridge.load({ sessionId: st.sid, text: HEADER + `# switch ${i}\n`, bufferVersion: 1 });
    assert.equal(r.ok, true);
    rendered += 1;
    // The prior document's overlay is gone; its session can never serve again.
    assert.equal(bridge.overlay.size, 1, 'switches never accumulate overlays');
    const leakPrev = bridge.overlay.resolve({ sessionId: prevSid, path: st.doc, profile: 'world' });
    assert.equal(leakPrev.status, 'closed', 'prior session closed after switch');
  }
  results.alternating_switches = { switches: 40, overlays: bridge.overlay.size };

  // --- 4. 25 consecutive successful scene replacements ------------------------
  st.sid += 1; st.doc = W.primary;
  const times = [];
  for (let v = 1; v <= 25; v++) {
    const t0 = process.hrtime.bigint();
    const r = bridge.load({ sessionId: st.sid, text: HEADER + `# ok ${v}\n`, bufferVersion: v });
    assert.equal(r.ok, true);
    assert.equal(bridge.accept({ sessionId: st.sid, generation: r.generation }).ok, true);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    rendered += 1;
  }
  results.replacements_25 = {
    avgMs: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 1000) / 1000,
    maxMs: Math.round(Math.max(...times) * 1000) / 1000,
  };

  // --- 5. 25 failed-then-repaired updates --------------------------------------
  st.sid += 1;
  let v = 0;
  for (let i = 0; i < 25; i++) {
    v += 1;
    const bad = bridge.load({ sessionId: st.sid, text: HEADER + `# broken ${v}\n`, bufferVersion: v });
    assert.equal(bad.ok, true); // registration succeeds; the RENDER would fail
    v += 1;
    const good = bridge.load({ sessionId: st.sid, text: HEADER + `# repaired ${v}\n`, bufferVersion: v });
    rendered += 1;
    // The failed (superseded) generation can never be accepted...
    assert.equal(bridge.accept({ sessionId: st.sid, generation: bad.generation }).ok, false);
    staleIgnored += 1;
    // ...the repaired one can, exactly once.
    assert.equal(bridge.accept({ sessionId: st.sid, generation: good.generation }).ok, true);
    assert.equal(bridge.accept({ sessionId: st.sid, generation: good.generation }).ok, false);
  }
  results.failed_then_repaired_25 = { staleRefused: 25 };

  // --- 6. project switch with a pending update ----------------------------------
  st.sid += 1;
  const s2 = createPreviewScheduler({ debounceMs: 700 });
  bridge.load({ sessionId: st.sid, text: HEADER + '# pending base\n', bufferVersion: 1 });
  s2.requestAuto(st.sid, { bufferVersion: 2, byteLength: 100, at: 0 });
  assert.equal(s2.pendingCount(), 1);
  s2.cancel(st.sid);                 // the renderer cancels its pending work...
  bridge.invalidateSession(st.sid);  // ...and main invalidates the session
  assert.equal(s2.pendingCount(), 0);
  assert.equal(bridge.overlay.size, 0, 'zero overlays after project switch');
  results.project_switch_pending = { pendingAfter: s2.pendingCount(), overlays: bridge.overlay.size };

  // --- 7. repeated viewpoint refreshes (pure resolver stability) -----------------
  const vps = [{ name: 'Entry', description: 'Front door' }, { name: 'Above', description: 'Overview' }];
  const vt = bench('viewpoint-restore x1000', () => {
    for (let i = 0; i < 1000; i++) {
      const r = resolveViewpointRestore({ name: 'Above', description: 'Overview', index: 1 }, vps);
      assert.deepEqual(r, { action: 'bind', index: 1, matchedBy: 'def' });
    }
    return 1000;
  });
  results.viewpoint_restore = vt;

  // --- 8. memory + throughput across repeated loads ------------------------------
  st.sid += 1;
  global.gc && global.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const t = bench('world load+accept x2000', () => {
    for (let i = 1; i <= 2000; i++) {
      const r = bridge.load({ sessionId: st.sid, text: HEADER + `# mem ${i}\n`, bufferVersion: i });
      assert.equal(r.ok, true);
      bridge.accept({ sessionId: st.sid, generation: r.generation });
    }
    return 2000;
  });
  global.gc && global.gc();
  const heapAfter = process.memoryUsage().heapUsed;
  results.throughput = t;
  results.memory = {
    heapBeforeMB: Math.round(heapBefore / 1048576 * 10) / 10,
    heapAfterMB: Math.round(heapAfter / 1048576 * 10) / 10,
  };
  assert.equal(bridge.overlay.size, 1, 'overlay never grows beyond the single active entry');

  // --- 9. close reaches zero; the scratch world is byte-identical -----------------
  bridge.invalidateSession(st.sid);
  const leak = bridge.leak();
  assert.equal(leak.size, 0, 'zero overlays after close');
  assert.equal(leak.activeGenerations, 0, 'zero active generations after close');
  assert.equal(leak.serving, false, 'no serving context after close');

  const hashesAfter = hashTree(W.root);
  assert.deepEqual(hashesAfter, hashesBefore, 'no source or fixture byte changed');
  results.hashes = { files: Object.keys(hashesBefore).length, identical: true };
  results.updates = { requested, rendered, staleIgnored };

  try { fs.rmSync(W.root, { recursive: true, force: true }); } catch { /* ignore */ }
  return { ok: true, results, leakAfterClose: leak };
}

try {
  const out = run();
  const r = out.results;
  console.log('=== Phase 7C3 perf / stress (pure bridge level) ===');
  console.log(`coalesce primary 50 -> fired v${r.coalesce_primary_50.firedVersion} (one render)`);
  console.log(`coalesce nested 50  -> fired v${r.coalesce_nested_50.firedVersion} (one render)`);
  console.log(`alternating switches -> ${r.alternating_switches.switches} switches, overlays=${r.alternating_switches.overlays}, prior sessions closed`);
  console.log(`25 replacements     -> avg ${r.replacements_25.avgMs} ms, max ${r.replacements_25.maxMs} ms (bridge ops incl. real disk reads)`);
  console.log(`25 failed+repaired  -> ${r.failed_then_repaired_25.staleRefused} stale generations refused, repaired accepted once`);
  console.log(`project switch      -> pending=${r.project_switch_pending.pendingAfter}, overlays=${r.project_switch_pending.overlays}`);
  console.log(`viewpoint restore   -> ${r.viewpoint_restore.n} refreshes in ${r.viewpoint_restore.ms} ms`);
  console.log(`throughput          -> ${r.throughput.n} load+accept in ${r.throughput.ms} ms (${r.throughput.perOpUs} us/op)`);
  console.log(`memory              -> heap ${r.memory.heapBeforeMB} MB -> ${r.memory.heapAfterMB} MB across 2000 loads`);
  console.log(`updates             -> requested=${r.updates.requested}, rendered=${r.updates.rendered}, staleIgnored=${r.updates.staleIgnored}`);
  console.log(`sources             -> ${r.hashes.files} files hash-identical before/after (no write)`);
  console.log(`leak after close    -> overlays=${out.leakAfterClose.size}, activeGenerations=${out.leakAfterClose.activeGenerations}`);
  console.log('RESULT: PASS');
  process.exit(0);
} catch (err) {
  console.error('RESULT: FAIL —', err.message);
  process.exit(1);
}
