'use strict';
// WD1.6-B -- projection-equivalence measurement.
//
// THE CLAIM: `effectiveInterfaceOf` reaches a node's interface through the SAME
// code the shipped `IS` (P2B) and ROUTE (P2C) endpoint resolutions reach it
// through. §5.4 of the WD1.6 plan states that as a design rule; this measures it.
//
// READ-ONLY, boundary-guarded, deterministic. Corpus conventions are P2C's and
// are inherited by REUSING its module rather than by restating it:
// `spikes/wd1-route-semantics/corpus.js` supplies discovery, the forbidden-path
// guard that THROWS, the sanitized `group:relative/path` identifiers, and the
// canonical de-duplication by DECODED text (a `.wrz` and its `.wrl` twin are one
// document; byte-dedup overcounted an earlier sweep by ~32%).
//
// EVERY FIGURE IS REPORTED WITH ITS DENOMINATOR. A bare percentage is unusable,
// and this lane's predecessor earned a `BLOCKED -- EVIDENCE INSUFFICIENT` for
// evidence that could not be re-run.
//
//   node --max-old-space-size=6144 spikes/wd1-6-interface-projection/run.js
//   node spikes/wd1-6-interface-projection/run.js --files=200 --quiet
//
// Exit code IS the verdict: non-zero on any mismatch.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const corpus = require(path.join(REPO_ROOT, 'spikes', 'wd1-route-semantics', 'corpus.js'));
const sg = require(path.join(REPO_ROOT, 'src', 'vrml', 'scope-graph.js'));
const { effectiveInterfaceOf } = require(path.join(REPO_ROOT, 'src', 'vrml', 'interface-query.js'));
const { lookupNameFor, compareEndpoint, compareAcquisition } = require('./compare.js');

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`));
const has = (name) => args.includes(`--${name}`);
const limit = flag('files') ? Number(flag('files').split('=')[1]) : 0;
const outDir = flag('out') ? flag('out').split('=')[1] : path.join(__dirname, 'out');
const quiet = has('quiet');

const counts = {
  documentsExamined: 0,
  documentsFailedToParse: 0,
  rawPathsDiscovered: 0,
  nodeOccurrencesTotal: 0,
  nodeOccurrencesProjected: 0,
  declarationMembersEnumerated: 0,
  writtenNameBindingsEnumerated: 0,
  bindingsComparedToAuthority: 0,
  isComparisons: 0,
  routeComparisons: 0,
  mismatches: 0,
};
const uncomparable = new Map();
const mismatches = [];

const note = (reason) => uncomparable.set(reason, (uncomparable.get(reason) || 0) + 1);

/**
 * Every `Node` occurrence, by an EXHAUSTIVE independent walk.
 *
 * Deliberately generic rather than a hand-picked key list. A curated list is
 * how this count first went wrong -- it silently missed occurrences and made the
 * projected figure EXCEED the total, which is the denominator equivalent of a
 * silent skip. Only range-bearing leaves are pruned, and a `seen` set keeps the
 * walk finite if the tree ever shares a subobject.
 */
const RANGE_KEYS = new Set(['range', 'nameRange', 'typeRange', 'defRange', 'declRange']);

function forEachNode(value, fn, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) forEachNode(item, fn, seen);
    return;
  }
  if (value.type === 'Node') fn(value);
  for (const key of Object.keys(value)) {
    if (RANGE_KEYS.has(key)) continue;
    forEachNode(value[key], fn, seen);
  }
}

const record = (id, kind, name, cmp) => {
  counts.mismatches += 1;
  if (mismatches.length < 50) {
    mismatches.push({
      id, kind, name, field: cmp.field, expected: String(cmp.expected), actual: String(cmp.actual),
    });
  }
};

function projectionFor(cache, graph, node) {
  if (cache.has(node)) return cache.get(node);
  const iface = effectiveInterfaceOf(graph, node);
  cache.set(node, iface);
  if (iface) {
    counts.nodeOccurrencesProjected += 1;
    counts.declarationMembersEnumerated += iface.members.length;
    for (const m of iface.members) counts.writtenNameBindingsEnumerated += m.bindings.length;
  }
  return iface;
}

function examine(id, parsed) {
  let graph;
  try {
    graph = sg.buildScopeGraph(parsed);
  } catch (err) {
    counts.documentsFailedToParse += 1;
    note(`graph-build-failed:${String(err && err.message).slice(0, 60)}`);
    return;
  }
  counts.documentsExamined += 1;
  forEachNode(parsed.tree, () => { counts.nodeOccurrencesTotal += 1; });

  const cache = new Map();

  // --- IS endpoints (P2B) ---------------------------------------------------
  for (const ref of sg.isReferences(graph)) {
    // The Script form DECLARES its own endpoint -- there is no lookup on a node
    // to agree or disagree with, so it is uncomparable BY CONSTRUCTION.
    if (ref.form === sg.IS_FORM.SCRIPT_INTERFACE) { note('is:script-form-declares-its-own-endpoint'); continue; }
    if (!ref.hostNode) { note('is:no-host-node'); continue; }
    const verdict = sg.isConnectionVerdict(graph, ref);
    if (!verdict.endpoint) { note(`is:no-endpoint-acquired:${verdict.status}`); continue; }
    const iface = projectionFor(cache, graph, ref.hostNode);
    if (!iface) { note('is:host-not-a-node-occurrence'); continue; }
    const cmp = compareEndpoint(iface.byName[verdict.endpoint.name], verdict.endpoint);
    counts.isComparisons += 1;
    if (!cmp.ok) record(id, 'is', verdict.endpoint.name, cmp);
  }

  // --- ROUTE endpoints (P2C) ------------------------------------------------
  for (const ref of sg.routeEventReferences(graph)) {
    const endpoint = sg.routeEndpointFor(graph, ref);
    if (!endpoint) { note('route:no-endpoint-acquired'); continue; }
    const nodeRef = ref.nodeReference;
    if (!nodeRef) { note('route:no-paired-node-reference'); continue; }
    const nodeRes = sg.resolveRouteNode(graph, nodeRef);
    if (!nodeRes || nodeRes.status !== sg.STATUS.RESOLVED || !nodeRes.symbol) {
      note('route:node-half-unresolved'); continue;
    }
    const iface = projectionFor(cache, graph, nodeRes.symbol.node);
    if (!iface) { note('route:target-not-a-node-occurrence'); continue; }
    const resolution = sg.resolveRouteEndpoint(graph, ref);
    const name = lookupNameFor(endpoint.name, ref.side, resolution && resolution.detail);
    const cmp = compareEndpoint(iface.byName[name], endpoint);
    counts.routeComparisons += 1;
    if (!cmp.ok) record(id, 'route', name, cmp);
  }

  // --- projection vs the shared authority itself ----------------------------
  //
  // The third leg: without it a pass could mean the authority agrees with
  // itself. Run over every node already projected above, so it costs nothing
  // extra in traversal and covers exactly the comparable population.
  for (const [node, iface] of cache) {
    if (!iface) continue;
    for (const name of Object.keys(iface.byName)) {
      const acquired = sg.acquireEndpointFor(graph, node, name);
      const cmp = compareAcquisition(iface.byName[name], acquired);
      counts.bindingsComparedToAuthority += 1;
      if (!cmp.ok) record(id, 'authority', name, cmp);
    }
  }
}

function main() {
  const discovered = corpus.discover({});
  counts.rawPathsDiscovered = discovered.entries.length;

  const swept = corpus.sweepPaths((rec) => {
    if (!rec.ok || !rec.first || !rec.parsed) return;
    examine(rec.id, rec.parsed);
  }, limit ? { limit } : {});

  const denominators = {
    inputFingerprint: discovered.fingerprint,
    rawPathsDiscovered: counts.rawPathsDiscovered,
    rawPathsSwept: swept ? swept.read + swept.readErrors : null,
    uniqueDecodedDocuments: counts.documentsExamined,
    limitApplied: limit || null,
  };

  const report = {
    lane: 'WD1.6-B projection equivalence',
    denominators,
    counts,
    uncomparable: [...uncomparable.entries()]
      .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
      .map(([reason, count]) => ({ reason, count })),
    mismatchSamples: mismatches,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'equivalence.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'equivalence.md'), render(report));

  if (!quiet) process.stdout.write(render(report));
  return counts.mismatches === 0 ? 0 : 1;
}

function render(report) {
  const c = report.counts;
  const d = report.denominators;
  const totalComparisons = c.isComparisons + c.routeComparisons + c.bindingsComparedToAuthority;
  const lines = [
    '# WD1.6-B -- projection equivalence',
    '',
    '## Denominators',
    '',
    `- raw paths discovered: ${d.rawPathsDiscovered}`,
    `- unique decoded documents examined: ${d.uniqueDecodedDocuments}`,
    `- input fingerprint: ${d.inputFingerprint}`,
    `- limit applied: ${d.limitApplied === null ? 'none' : d.limitApplied}`,
    '',
    '## Enumeration',
    '',
    `- node occurrences in those documents: ${c.nodeOccurrencesTotal}`,
    `- node occurrences projected: ${c.nodeOccurrencesProjected}`,
    `- declaration members enumerated: ${c.declarationMembersEnumerated}`,
    `- written-name bindings enumerated: ${c.writtenNameBindingsEnumerated}`,
    '',
    '## Comparisons',
    '',
    `- IS endpoints compared: ${c.isComparisons}`,
    `- ROUTE endpoints compared: ${c.routeComparisons}`,
    `- bindings compared to the shared authority: ${c.bindingsComparedToAuthority}`,
    `- TOTAL comparisons: ${totalComparisons}`,
    `- **MISMATCHES: ${c.mismatches} / ${totalComparisons}**`,
    '',
    '## Uncomparable (counted, never silently dropped)',
    '',
  ];
  for (const u of report.uncomparable) lines.push(`- ${u.reason}: ${u.count}`);
  if (report.mismatchSamples.length) {
    lines.push('', '## Mismatch samples', '');
    for (const m of report.mismatchSamples) {
      lines.push(`- ${m.id} [${m.kind}] ${m.name}: ${m.field} expected=${m.expected} actual=${m.actual}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

if (require.main === module) process.exit(main());
module.exports = { forEachNode };
