'use strict';
// Phase: Accessibility + Performance -- WD2-A pipeline perf measurement.
// The Phase 7B perf gate covers analyze() (parse + highlight + diagnostics +
// outline). This script measures the WD2-A pipeline that the renderer runs
// on top of analyze()'s parseResult:
//
//   parse -> scopeGraph -> sceneTree -> semanticFindings -> presentation
//
// The renderer does this work per keystroke (debounced alongside analyze),
// so the numbers MUST stay under the 250 ms debounce to keep typing
// responsive. This script records a before/after reading so any future
// regression shows up in this single artifact.

const fs = require('fs');
const path = require('path');

const vrml = require('../../src/vrml');
const scopeGraphMod = require('../../src/vrml/scope-graph');
const sceneTreeMod = require('../../src/vrml/scene-tree');
const semanticFindingsMod = require('../../src/vrml/semantic-findings');
const presentationMod = require('../../src/vrml/presentation');
const messagesMod = require('../../src/vrml/messages');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const profiles = [
  { name: 'small Mall item', text: read('test/fixtures/preview/def-use.wrl') },
  { name: 'representative World', text: read('test/fixtures/world/valid70/world.wrl') },
  { name: '~327KB file', text: read('test/fixtures/oversized.wrl') },
];

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function timeRun(label, fn, runs) {
  fn(); // warm up
  const times = [];
  let last;
  for (let i = 0; i < runs; i += 1) {
    const t0 = process.hrtime.bigint();
    last = fn();
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6);
  }
  return { label, median: median(times), min: Math.min(...times), max: Math.max(...times), result: last };
}

const DEBOUNCE_MS = 250;
const rows = [];

console.log('=== Phase: Accessibility + Performance -- WD2-A pipeline perf ===\n');
console.log('profile'.padEnd(26) + 'bytes'.padStart(10) + 'stage'.padEnd(28) + 'median'.padStart(11) + 'max'.padStart(9));

const memBefore = process.memoryUsage().heapUsed;
for (const p of profiles) {
  const runs = p.text.length > 200 * 1024 ? 6 : 20;
  // The full WD2-A pipeline, run end-to-end:
  const parsed = vrml.parse(p.text);
  // Stage 1: parse -- already paid for analyze() but we still pay it here.
  const parseRun = timeRun('parse', () => vrml.parse(p.text), runs);
  rows.push({ profile: p.name, stage: 'parse', bytes: p.text.length, median: parseRun.median, max: parseRun.max });
  console.log(
    p.name.padEnd(26) +
    String(p.text.length).padStart(10) +
    'parse'.padEnd(28) +
    (parseRun.median.toFixed(1) + 'ms').padStart(11) +
    (parseRun.max.toFixed(1) + 'ms').padStart(9),
  );

  // Stage 2: scope graph
  const graphRun = timeRun('scopeGraph', () => scopeGraphMod.buildScopeGraph(parsed), runs);
  rows.push({ profile: p.name, stage: 'scopeGraph', bytes: p.text.length, median: graphRun.median, max: graphRun.max });
  console.log(
    p.name.padEnd(26) +
    String(p.text.length).padStart(10) +
    'scopeGraph'.padEnd(28) +
    (graphRun.median.toFixed(1) + 'ms').padStart(11) +
    (graphRun.max.toFixed(1) + 'ms').padStart(9),
  );

  // Build resolver once so stage 3 measures only the tree walk.
  const graph = scopeGraphMod.buildScopeGraph(parsed);
  const useResolver = (useNode) => {
    const resolution = scopeGraphMod.resolve(graph, useNode);
    if (scopeGraphMod.isResolved(resolution) && resolution.symbol && resolution.symbol.node) {
      return { status: 'resolved', targetAstNode: resolution.symbol.node };
    }
    return { status: 'unresolved' };
  };

  // Stage 3: scene tree
  const treeRun = timeRun('sceneTree', () => sceneTreeMod.buildSceneTree(parsed, { useResolver }), runs);
  rows.push({ profile: p.name, stage: 'sceneTree', bytes: p.text.length, median: treeRun.median, max: treeRun.max });
  console.log(
    p.name.padEnd(26) +
    String(p.text.length).padStart(10) +
    'sceneTree'.padEnd(28) +
    (treeRun.median.toFixed(1) + 'ms').padStart(11) +
    (treeRun.max.toFixed(1) + 'ms').padStart(9),
  );

  // Stage 4: semantic findings
  const findingsRun = timeRun('findings', () => semanticFindingsMod.findingsForDocument(graph), runs);
  rows.push({ profile: p.name, stage: 'findings', bytes: p.text.length, median: findingsRun.median, max: findingsRun.max });
  console.log(
    p.name.padEnd(26) +
    String(p.text.length).padStart(10) +
    'findings'.padEnd(28) +
    (findingsRun.median.toFixed(1) + 'ms').padStart(11) +
    (findingsRun.max.toFixed(1) + 'ms').padStart(9),
  );

  // Stage 5: P4-A presentation ordering
  const raw = semanticFindingsMod.findingsForDocument(graph);
  const presRun = timeRun('presentation', () => presentationMod.presentDocumentFindings(raw), runs);
  rows.push({ profile: p.name, stage: 'presentation', bytes: p.text.length, median: presRun.median, max: presRun.max });
  console.log(
    p.name.padEnd(26) +
    String(p.text.length).padStart(10) +
    'presentation'.padEnd(28) +
    (presRun.median.toFixed(1) + 'ms').padStart(11) +
    (presRun.max.toFixed(1) + 'ms').padStart(9),
  );

  // End-to-end pipeline total -- what one keystroke pays when the editor
  // calls analyze() + the renderer's onAnalysis handler.
  const totalRun = timeRun('total', () => {
    const prs = vrml.parse(p.text);
    const g = scopeGraphMod.buildScopeGraph(prs);
    const ur = (n) => {
      const r = scopeGraphMod.resolve(g, n);
      return (scopeGraphMod.isResolved(r) && r.symbol && r.symbol.node)
        ? { status: 'resolved', targetAstNode: r.symbol.node }
        : { status: 'unresolved' };
    };
    sceneTreeMod.buildSceneTree(prs, { useResolver: ur });
    const r = semanticFindingsMod.findingsForDocument(g);
    return presentationMod.presentDocumentFindings(r);
  }, runs);
  rows.push({ profile: p.name, stage: 'TOTAL', bytes: p.text.length, median: totalRun.median, max: totalRun.max });
  console.log(
    p.name.padEnd(26) +
    String(p.text.length).padStart(10) +
    'TOTAL'.padEnd(28) +
    (totalRun.median.toFixed(1) + 'ms').padStart(11) +
    (totalRun.max.toFixed(1) + 'ms').padStart(9),
  );
  console.log('');
}
const memAfter = process.memoryUsage().heapUsed;

console.log('Gate: end-to-end TOTAL median < %dms debounce for every profile.', DEBOUNCE_MS);
console.log('Heap delta over the whole run: %sMB', ((memAfter - memBefore) / 1048576).toFixed(1));

fs.writeFileSync(path.join(__dirname, 'PERF.json'),
  JSON.stringify({
    debounceMs: DEBOUNCE_MS,
    rows,
    heapDeltaMB: (memAfter - memBefore) / 1048576,
    timestamp: new Date().toISOString(),
    commit: process.env.WRL_FORGE_COMMIT || 'unknown',
  }, null, 2),
);

const failed = rows.filter((r) => r.stage === 'TOTAL').some((r) => r.median >= DEBOUNCE_MS);
console.log(failed ? '\nRESULT: FAIL (a profile met/exceeded the debounce budget)' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);