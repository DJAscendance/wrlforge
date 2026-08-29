'use strict';
// WD1.6-D -- the reproducible findings-projection driver.
//
//   node --max-old-space-size=6144 spikes/wd1-6-findings-coverage/run.js
//
// Flags: --files=N (cap discovered paths), --out=DIR, --no-corpus,
//        --controls-only, --quiet.
//
// Emits `out/findings.json` (machine-readable, deterministic) and
// `out/metrics.md` (human-readable). `out/` is gitignored and regenerable -- the
// HARNESS is the durable artifact, not its output. WD1.5-P2C's lane learned that
// the hard way: a hard gate whose measurement cannot be rerun is an assertion,
// not evidence.
//
// EXIT CODE IS THE VERDICT. Non-zero when the query throws on real content, when
// a finding contradicts the authority it was projected from, when an ISO
// classification did not come from the committed table, when a presentation
// field appears, when the partitions fail to reconcile, or when an adversarial
// control stops firing. A green run is a claim this script stakes its exit
// status on.

const fs = require('fs');
const path = require('path');

const sweep = require('./sweep');
const controls = require('./controls');

const { corpus } = sweep;
const OUT_DEFAULT = path.join(__dirname, 'out');

function parseArgs(argv) {
  const opts = { out: OUT_DEFAULT, files: 0, corpus: true, controlsOnly: false, quiet: false };
  for (const arg of argv) {
    if (arg.startsWith('--files=')) opts.files = Number(arg.slice(8)) || 0;
    else if (arg.startsWith('--out=')) opts.out = path.resolve(arg.slice(6));
    else if (arg === '--no-corpus') opts.corpus = false;
    else if (arg === '--controls-only') { opts.controlsOnly = true; opts.corpus = false; }
    else if (arg === '--quiet') opts.quiet = true;
    else throw new Error(`unknown flag: ${arg}`);
  }
  return opts;
}

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(4)}%` : 'n/a');

/** Descending by count, then by key -- deterministic, no clock, no PRNG. */
function ranked(table) {
  return Object.keys(table)
    .sort((a, b) => (table[b] - table[a]) || (a < b ? -1 : 1))
    .map((k) => [k, table[k]]);
}

function sweepCorpus(opts, log) {
  const counters = sweep.newCounters();
  const stats = {
    rawPaths: 0,
    uniqueDocuments: 0,
    parsedDocuments: 0,
    duplicatePaths: 0,
    readErrors: 0,
    graphErrors: 0,
    damagedDocuments: 0,
  };
  const graphErrorIds = [];

  const summary = corpus.sweepPaths((record) => {
    stats.rawPaths += 1;
    if (!record.ok) { stats.readErrors += 1; return; }
    if (!record.first) { stats.duplicatePaths += 1; return; }
    stats.uniqueDocuments += 1;
    if (!record.parsed) return;
    stats.parsedDocuments += 1;
    if (record.damage && record.damage[corpus.CANONICAL_DAMAGE]) stats.damagedDocuments += 1;
    const outcome = sweep.sweepDocument(record.parsed, record.id, counters);
    if (outcome && outcome.graphError) {
      stats.graphErrors += 1;
      if (graphErrorIds.length < 10) graphErrorIds.push({ id: record.id, message: outcome.graphError });
    }
    if (!opts.quiet && stats.parsedDocuments % 500 === 0) {
      log(`  ... ${stats.parsedDocuments} documents, ${counters.findings} findings`);
    }
  }, { limit: opts.files });

  return { counters, stats, graphErrorIds, fingerprint: summary.fingerprint };
}

function report(result, controlResult, opts) {
  const { counters, stats } = result;
  return {
    lane: 'WD1.6-D',
    questions: {
      Q1: 'Does findingsForDocument ever throw on real authored content?',
      Q2: 'Does every ISO classification come from the committed table rather than the fallback?',
      Q3: 'Does any finding contradict the verdict it was projected from?',
      Q4: 'Does any finding carry a presentation field?',
    },
    unit: 'one structured semantic finding over one unique decoded document',
    corpusFingerprint: result.fingerprint,
    filesCap: opts.files || null,
    documents: stats,
    findings: {
      total: counters.findings,
      documentsWithFindings: counters.documentsWithFindings,
      documentsWithNoFindings: stats.parsedDocuments - counters.documentsWithFindings,
      maxInOneDocument: counters.maxFindingsInOneDocument,
      maxInOneDocumentId: counters.maxFindingsDocumentId,
      unranged: counters.unrangedFindings,
    },
    gates: {
      queryThrows: counters.queryThrows,
      queryThrowExamples: counters.queryThrowExamples,
      isoFallbacks: counters.isoFallbacks,
      isoFallbackExamples: counters.isoFallbackExamples,
      isoMismatches: counters.isoMismatches,
      isoMismatchExamples: counters.isoMismatchExamples,
      contradictions: counters.contradictions,
      contradictionExamples: counters.contradictionExamples,
      recheckDenominator: counters.recheckable,
      shapeViolations: counters.shapeViolations,
      shapeViolationExamples: counters.shapeViolationExamples,
      compatibilityPopulated: counters.compatibilityPopulated,
      reconciliation: sweep.reconcile(counters),
    },
    byCode: ranked(counters.byCode),
    byIso: ranked(counters.byIso),
    byConfidence: ranked(counters.byConfidence),
    byCodeReason: ranked(counters.byCodeReason),
    controls: controlResult,
  };
}

function markdown(r) {
  const L = [];
  L.push('# WD1.6-D -- structured semantic findings over the real corpus', '');
  L.push('Read-only, boundary-guarded, deterministic. Discovery/decoding/de-duplication are');
  L.push('`spikes/wd1-route-semantics/corpus.js`, reused unmodified.', '');
  L.push(`Corpus input fingerprint: \`${r.corpusFingerprint}\``);
  if (r.filesCap) L.push(`**Capped run:** first ${r.filesCap} discovered paths.`);
  L.push('', '## Denominators', '', '| quantity | count |', '| --- | ---: |');
  for (const [k, v] of Object.entries(r.documents)) L.push(`| ${k} | ${v} |`);
  for (const [k, v] of Object.entries(r.findings)) L.push(`| ${k} | ${v} |`);
  L.push('', '## Gates (every one must be zero)', '', '| gate | count | of |', '| --- | ---: | ---: |');
  L.push(`| query throws | ${r.gates.queryThrows} | ${r.documents.parsedDocuments} documents |`);
  L.push(`| ISO fallbacks | ${r.gates.isoFallbacks} | ${r.findings.total} findings |`);
  L.push(`| ISO mismatches | ${r.gates.isoMismatches} | ${r.findings.total} findings |`);
  L.push(`| contradictions | ${r.gates.contradictions} | ${r.gates.recheckDenominator} re-checked |`);
  L.push(`| shape violations | ${r.gates.shapeViolations} | ${r.findings.total} findings |`);
  L.push(`| compatibility populated | ${r.gates.compatibilityPopulated} | ${r.findings.total} findings |`);
  const tables = [['by code', r.byCode], ['by ISO result', r.byIso],
    ['by confidence', r.byConfidence], ['by code/reason', r.byCodeReason]];
  for (const [title, rows] of tables) {
    L.push('', `## Findings ${title}`, '', '| key | count | share |', '| --- | ---: | ---: |');
    for (const [k, v] of rows) L.push(`| \`${k}\` | ${v} | ${pct(v, r.findings.total)} |`);
  }
  L.push('', '## Adversarial controls', '');
  L.push('| mutant | gate | honest | mutated | caught | defect |');
  L.push('| --- | --- | ---: | ---: | :-: | --- |');
  for (const c of r.controls.results) {
    L.push(`| \`${c.name}\` | ${c.gate} | ${c.baseline} | ${c.mutated} | ${c.caught ? 'yes' : 'NO'} | ${c.defect} |`);
  }
  return `${L.join('\n')}\n`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = (m) => { if (!opts.quiet) process.stdout.write(`${m}\n`); };

  log('WD1.6-D findings projection sweep');
  log('  controls...');
  const controlResult = controls.runControls();
  for (const c of controlResult.results) {
    log(`    ${c.caught ? 'CAUGHT ' : 'MISSED '} ${c.name} (${c.gate}: ${c.baseline} -> ${c.mutated})`);
  }

  let result = {
    counters: sweep.newCounters(), stats: {
      rawPaths: 0, uniqueDocuments: 0, parsedDocuments: 0,
      duplicatePaths: 0, readErrors: 0, graphErrors: 0, damagedDocuments: 0,
    }, graphErrorIds: [], fingerprint: null,
  };
  if (opts.corpus) {
    log('  corpus sweep...');
    result = sweepCorpus(opts, log);
  }

  const r = report(result, controlResult, opts);
  fs.mkdirSync(opts.out, { recursive: true });
  fs.writeFileSync(path.join(opts.out, 'findings.json'), `${JSON.stringify(r, null, 2)}\n`);
  fs.writeFileSync(path.join(opts.out, 'metrics.md'), markdown(r));
  log(`  wrote ${path.join(opts.out, 'findings.json')} and metrics.md`);

  const failures = [];
  for (const c of controlResult.results) if (!c.caught) failures.push(`control ${c.name} stopped firing`);
  if (r.gates.queryThrows) failures.push(`findingsForDocument threw on ${r.gates.queryThrows} documents`);
  if (r.gates.isoFallbacks) failures.push(`${r.gates.isoFallbacks} findings hit the ISO fallback`);
  if (r.gates.isoMismatches) failures.push(`${r.gates.isoMismatches} findings disagree with the ISO table`);
  if (r.gates.contradictions) failures.push(`${r.gates.contradictions} findings contradict their authority`);
  if (r.gates.shapeViolations) failures.push(`${r.gates.shapeViolations} findings carry an unexpected field`);
  if (r.gates.compatibilityPopulated) failures.push('a compatibility profile was populated');
  for (const p of r.gates.reconciliation) failures.push(p);
  if (opts.corpus && r.documents.parsedDocuments === 0) failures.push('no documents were parsed');

  if (failures.length) {
    process.stdout.write(`\nFAIL\n${failures.map((f) => `  - ${f}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`\nPASS -- ${r.findings.total} findings over ${r.documents.parsedDocuments} documents; all gates zero\n`);
}

main();
