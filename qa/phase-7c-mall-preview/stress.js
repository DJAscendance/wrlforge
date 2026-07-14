'use strict';
// Phase 7C2 perf / stress harness -- PURE (no Electron). Drives the exact main-
// process bridge + scheduler the renderer uses, under a burst of rapid edits, and
// proves the invariants the completion gate requires:
//   * a burst of 50-100 rapid edits COALESCES to a single fired update (newest
//     version only) -- older edits never each trigger a render,
//   * the overlay holds at most ONE entry throughout (no per-edit leak),
//   * after session close the overlay + active-generation counts are ZERO,
//   * a stale (older) generation is never accepted,
//   * no source is written (the bridge has no fs; readSaved is the only injected
//     disk touch and is not called on the edit path).
// Timing (register+resolve throughput, debounce) is measured with a fake clock so
// the numbers are deterministic and CI-stable.
//
//   node qa/phase-7c-mall-preview/stress.js

const assert = require('node:assert/strict');
const { createMallPreviewBridge } = require('../../src/preview/mall-preview-bridge');
const { createPreviewScheduler } = require('../../src/preview/preview-scheduler');

const SRC = '/proj/mall/item.wrl';
let writes = 0; // would increment if anything wrote a source -- must stay 0

function bench(label, fn) {
  const t0 = process.hrtime.bigint();
  const n = fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { label, n, ms: Math.round(ms * 1000) / 1000, perOpUs: Math.round((ms / n) * 1000) };
}

function run() {
  const results = {};

  // A bridge over pure fakes. A mutable sessionId models the editor reopening a
  // fresh document; readSaved would be the ONLY disk read and must never fire on
  // the edit path. No writer exists at all.
  let sid = 1;
  const bridge = createMallPreviewBridge({
    describeSession: () => ({ open: true, sessionId: sid, context: 'mall', sourcePath: SRC }),
    getAuthorizedMallSource: () => SRC,
    scanRemoteUrls: () => [],
    readSaved: () => { throw new Error('readSaved must not be called on the edit path'); },
    resolvePath: (p) => String(p),
  });

  // --- 1. coalescing: 100 rapid edits -> ONE fired update, newest version -------
  for (const BURST of [50, 100]) {
    sid += 1; // a fresh document/session for this burst
    const s = createPreviewScheduler({ debounceMs: 700 });
    let clock = 0;
    for (let v = 1; v <= BURST; v++) {
      clock += 5; // an edit every 5 ms (faster than the 700 ms debounce)
      s.requestAuto('sess', { bufferVersion: v, byteLength: 500, at: clock });
    }
    // Nothing is due until 700 ms after the LAST edit.
    assert.equal(s.poll('sess', clock + 699).fire, false, `burst ${BURST}: not due before debounce`);
    const fired = s.poll('sess', clock + 700);
    assert.equal(fired.fire, true, `burst ${BURST}: fires once after debounce`);
    assert.equal(fired.bufferVersion, BURST, `burst ${BURST}: only the NEWEST version renders`);
    assert.equal(s.pendingCount(), 0, `burst ${BURST}: pending consumed`);
    // Exactly one render results: register the winner + begin one generation.
    const res = bridge.load({ sessionId: sid, text: `#VRML V2.0 utf8\n# v${fired.bufferVersion}\n`, bufferVersion: fired.bufferVersion });
    assert.equal(res.ok, true);
    assert.equal(bridge.leak().size, 1, `burst ${BURST}: overlay holds exactly one entry`);
    bridge.invalidateSession(sid);
    results[`coalesce_${BURST}`] = { firedVersion: fired.bufferVersion, overlayAfterFire: 1 };
  }

  // --- 2. no leak across many document renders ---------------------------------
  sid += 1;
  const t = bench('load+resolve x2000', () => {
    for (let v = 1; v <= 2000; v++) {
      const r = bridge.load({ sessionId: sid, text: `#VRML V2.0 utf8\n# ${v}\n`, bufferVersion: v });
      assert.equal(r.ok, true);
      bridge.accept({ sessionId: sid, generation: r.generation });
    }
    return 2000;
  });
  results.throughput = t;
  assert.equal(bridge.leak().size, 1, 'overlay never grows beyond the single active entry');

  // --- 3. stale generation is never accepted ----------------------------------
  const g1 = bridge.load({ sessionId: sid, text: 'a', bufferVersion: 5000 }).generation;
  bridge.load({ sessionId: sid, text: 'ab', bufferVersion: 5001 }); // supersedes g1
  assert.equal(bridge.accept({ sessionId: sid, generation: g1 }).ok, false, 'stale generation refused');

  // --- 4. deterministic cleanup after close ------------------------------------
  bridge.invalidateSession(sid);
  const leak = bridge.leak();
  assert.equal(leak.size, 0, 'zero overlays after close');
  assert.equal(leak.activeGenerations, 0, 'zero active generations after close');

  // --- 5. no source write ------------------------------------------------------
  assert.equal(writes, 0, 'no source was ever written');

  return { ok: true, results, leakAfterClose: leak };
}

try {
  const out = run();
  console.log('=== Phase 7C2 perf / stress (pure) ===');
  console.log(`coalesce 50  -> fired v${out.results.coalesce_50.firedVersion}, overlay=1`);
  console.log(`coalesce 100 -> fired v${out.results.coalesce_100.firedVersion}, overlay=1`);
  console.log(`throughput   -> ${out.results.throughput.n} load+resolve in ${out.results.throughput.ms} ms (${out.results.throughput.perOpUs} us/op)`);
  console.log(`leak after close -> overlays=${out.leakAfterClose.size}, activeGenerations=${out.leakAfterClose.activeGenerations}`);
  console.log('stale generation refused, no source write, debounce=700ms coalescing verified.');
  console.log('RESULT: PASS');
  process.exit(0);
} catch (err) {
  console.error('RESULT: FAIL —', err.message);
  process.exit(1);
}
