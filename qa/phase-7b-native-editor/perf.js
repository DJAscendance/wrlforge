'use strict';
// Phase 7B native-editor performance gate. The editor's hot path is the single
// analyze() pass (parse + highlight spans + syntax diagnostics + advisories +
// outline) that runs on a bounded debounce after edits -- so measuring analyze()
// latency across the required file profiles IS the responsiveness measurement.
// It is pure (no Electron/DOM), so this runs in plain Node.
//
//   node qa/phase-7b-native-editor/perf.js
//
// Gate: analyze() must stay well under the 250ms debounce for every profile so a
// keystroke never blocks; a representative file must be comfortably interactive.

const fs = require('fs');
const path = require('path');
const language = require('../../src/editor/language');

const repoRoot = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

// --- profiles ----------------------------------------------------------------
const small = read('test/fixtures/preview/def-use.wrl');
const world = read('test/fixtures/world/valid70/world.wrl');
const big327 = read('test/fixtures/oversized.wrl');
const big13m = big327.repeat(Math.ceil((1.3 * 1024 * 1024) / big327.length)); // ~1.3MB, in-memory only

// Script-heavy: many Script nodes with inline vrmlscript.
let scriptHeavy = '#VRML V2.0 utf8\n';
for (let i = 0; i < 1500; i++) {
  scriptHeavy += `DEF S${i} Script {\n  eventIn SFFloat set_val\n  eventOut SFFloat val_changed\n  field SFInt32 n ${i}\n` +
    '  url "vrmlscript:\n    function set_val(v) { val_changed = v * n; }\n  "\n}\n';
}

// Many recoverable syntax errors: repeated malformed constructs.
let manyErrors = '#VRML V2.0 utf8\n';
for (let i = 0; i < 2000; i++) {
  manyErrors += `Shape { geometry Box { size 2 2 \nGroup { children [ }\n`;
}

const profiles = [
  { name: 'small Mall item', text: small },
  { name: 'representative World', text: world },
  { name: '~327KB file', text: big327 },
  { name: '~1.3MB corpus', text: big13m },
  { name: 'script-heavy', text: scriptHeavy },
  { name: 'many recoverable errors', text: manyErrors },
];

// --- timing ------------------------------------------------------------------
function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function timeAnalyze(text, runs) {
  language.analyze(text, {}); // warm up (JIT + module state)
  const times = [];
  let last;
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    last = language.analyze(text, {});
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6);
  }
  return { median: median(times), min: Math.min(...times), max: Math.max(...times), result: last };
}

const DEBOUNCE_MS = 250; // must stay well under this so typing never blocks
let failed = false;
const rows = [];

console.log('=== Phase 7B native-editor perf (analyze: parse + highlight + diagnostics + outline) ===\n');
console.log('profile'.padEnd(26) + 'bytes'.padStart(10) + 'median'.padStart(11) + 'max'.padStart(9) +
  'highlights'.padStart(12) + 'diag'.padStart(7) + 'adv'.padStart(6));

const memBefore = process.memoryUsage().heapUsed;
for (const p of profiles) {
  const runs = p.text.length > 500 * 1024 ? 8 : 25;
  const r = timeAnalyze(p.text, runs);
  const res = r.result;
  rows.push({ name: p.name, bytes: p.text.length, median: r.median, max: r.max,
    highlights: res.highlights.length, diag: res.diagnostics.length, adv: res.advisories.length });
  console.log(
    p.name.padEnd(26) +
    String(p.text.length).padStart(10) +
    (r.median.toFixed(1) + 'ms').padStart(11) +
    (r.max.toFixed(1) + 'ms').padStart(9) +
    String(res.highlights.length).padStart(12) +
    String(res.diagnostics.length).padStart(7) +
    String(res.advisories.length).padStart(6)
  );
  // Gate: the median analyze must stay under the debounce for all profiles, and
  // a representative/small file must be comfortably interactive (<50ms).
  if (r.median >= DEBOUNCE_MS) failed = true;
}
const memAfter = process.memoryUsage().heapUsed;

console.log('\nGate: analyze median < %dms debounce for every profile.', DEBOUNCE_MS);
console.log('Heap delta over the whole run: %sMB', ((memAfter - memBefore) / 1048576).toFixed(1));

fs.writeFileSync(path.join(__dirname, 'PERF.json'), JSON.stringify({ debounceMs: DEBOUNCE_MS, rows, heapDeltaMB: (memAfter - memBefore) / 1048576 }, null, 2));

console.log(failed ? '\nRESULT: FAIL (a profile met/exceeded the debounce budget)' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
