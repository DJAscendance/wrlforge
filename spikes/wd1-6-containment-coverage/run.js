'use strict';
// WD1.6-C -- the reproducible containment-coverage driver.
//
//   node --max-old-space-size=6144 spikes/wd1-6-containment-coverage/run.js
//
// Flags: --files=N (cap discovered paths), --out=DIR, --no-corpus,
//        --controls-only, --quiet.
//
// Emits `out/coverage.json` (machine-readable, deterministic) and
// `out/metrics.md` (human-readable). `out/` is gitignored and regenerable -- the
// HARNESS is the durable artifact, not its output. P2C's lane learned that the
// hard way: a hard gate whose measurement cannot be rerun is an assertion, not
// evidence.
//
// EXIT CODE IS THE VERDICT. Non-zero when the partitions fail to reconcile, when
// an ILLEGAL is produced by anything other than an exclusion-complete rule, or
// when an adversarial control stops firing. A green run is a claim this script
// stakes its exit status on.

const fs = require('fs');
const path = require('path');

const sweep = require('./sweep');
const controls = require('./controls');

const { corpus, CS, CANDIDATE_KIND } = sweep;
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

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(2)}%` : 'n/a');

/** Sorted descending by count, then by key -- deterministic, no clock, no PRNG. */
function ranked(table, pick = (v) => v) {
  return Object.keys(table)
    .sort((a, b) => (pick(table[b]) - pick(table[a])) || (a < b ? -1 : 1))
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
      log(`  ... ${stats.parsedDocuments} documents, ${counters.placementsExamined} placements`);
    }
  }, { limit: opts.files });

  return { counters, stats, graphErrorIds, fingerprint: summary.fingerprint, discovery: summary };
}

function report(result, controlResult, opts) {
  const { counters, stats } = result;
  const total = counters.placementsExamined;
  const definitive = sweep.definitive(counters);
  const problems = sweep.reconcile(counters);

  const uncovered = ranked(counters.uncoveredFields, (v) => v.count)
    .map(([field, v]) => ({ field, count: v.count, examples: v.examples }));
  const illegalRules = Object.values(counters.illegalRules)
    .sort((a, b) => (b.count - a.count) || (a.field < b.field ? -1 : 1));

  return {
    lane: 'WD1.6-C',
    question: 'For actual child-node placements in SFNode/MFNode fields, how often '
      + 'can childLegality return a definitive LEGAL/ILLEGAL verdict?',
    unit: 'one child node written into one node-valued field of one parent node',
    corpusFingerprint: result.fingerprint,
    filesCap: opts.files || null,
    documents: stats,
    placements: {
      parentNodesExamined: counters.parentNodesExamined,
      fieldOccurrencesWithWrittenNodes: counters.fieldOccurrencesExamined,
      nodeValuedFieldOccurrences: counters.nodeValuedFieldOccurrences,
      placementsExamined: total,
      documentsWithPlacements: counters.documentsWithPlacements,
      documentsWithIllegal: counters.documentsWithIllegal,
      judgeErrors: counters.judgeErrors,
      judgeErrorExamples: counters.judgeErrorExamples,
    },
    byStatus: ranked(counters.byStatus),
    byReason: ranked(counters.byReason),
    byCandidateKind: ranked(counters.byCandidateKind),
    metadata: {
      covered: counters.metadataCovered,
      uncovered: counters.metadataUncovered,
      coveredPct: pct(counters.metadataCovered, total),
      exclusionCompleteRule: counters.exclusionCompleteRule,
      positiveOnlyRule: counters.positiveOnlyRule,
      uncoveredFields: uncovered,
    },
    definitiveCoverage: {
      numerator: definitive,
      denominator: total,
      ratio: pct(definitive, total),
      legal: counters.byStatus[CS.LEGAL] || 0,
      illegal: counters.byStatus[CS.ILLEGAL] || 0,
    },
    illegalRules,
    controls: controlResult,
    reconciliation: { problems, clean: problems.length === 0 },
    graphErrors: result.graphErrorIds,
  };
}

function markdown(r) {
  const L = [];
  L.push('# WD1.6-C -- containment coverage', '');
  L.push('> ' + r.question, '');
  L.push(`**Unit (denominator):** ${r.unit}.`, '');
  L.push('| input | count |', '| --- | ---: |');
  L.push(`| raw corpus paths | ${r.documents.rawPaths} |`);
  L.push(`| duplicate paths (same decoded text) | ${r.documents.duplicatePaths} |`);
  L.push(`| unique decoded documents | ${r.documents.uniqueDocuments} |`);
  L.push(`| parsed documents | ${r.documents.parsedDocuments} |`);
  L.push(`| damaged documents (${'syntax-error'}) | ${r.documents.damagedDocuments} |`);
  L.push(`| read errors | ${r.documents.readErrors} |`);
  L.push(`| scope-graph errors | ${r.documents.graphErrors} |`);
  L.push('', '| placement denominator | count |', '| --- | ---: |');
  for (const [k, v] of Object.entries(r.placements)) L.push(`| ${k} | ${v} |`);
  L.push('', `**Definitive coverage: ${r.definitiveCoverage.numerator} / `
    + `${r.definitiveCoverage.denominator} = ${r.definitiveCoverage.ratio}**`, '');
  L.push('| status | count | share |', '| --- | ---: | ---: |');
  for (const [k, v] of r.byStatus) L.push(`| ${k} | ${v} | ${pct(v, r.placements.placementsExamined)} |`);
  L.push('', '| status/reason | count |', '| --- | ---: |');
  for (const [k, v] of r.byReason) L.push(`| ${k} | ${v} |`);
  L.push('', '| candidate kind | count |', '| --- | ---: |');
  for (const [k, v] of r.byCandidateKind) L.push(`| ${k} | ${v} |`);
  L.push('', `**Metadata coverage: ${r.metadata.covered} / ${r.placements.placementsExamined} `
    + `= ${r.metadata.coveredPct}** (exclusion-complete rule ${r.metadata.exclusionCompleteRule}, `
    + `positive-only ${r.metadata.positiveOnlyRule})`, '');
  if (r.metadata.uncoveredFields.length) {
    L.push('| field with NO containment metadata | placements | example documents |', '| --- | ---: | --- |');
    for (const u of r.metadata.uncoveredFields) L.push(`| ${u.field} | ${u.count} | ${u.examples.join(', ')} |`);
    L.push('');
  }
  L.push('## ILLEGAL rule distribution', '');
  if (!r.illegalRules.length) L.push('_No ILLEGAL verdict was produced anywhere in the corpus._', '');
  else {
    L.push('| field | candidate | kind | rule | reason | count | example documents |',
      '| --- | --- | --- | --- | --- | ---: | --- |');
    for (const x of r.illegalRules) {
      L.push(`| ${x.field} | ${x.candidateType} | ${x.candidateKind} | ${x.rules.join('+')} `
        + `| ${x.reason} | ${x.count} | ${x.examples.join(', ')} |`);
    }
    L.push('');
  }
  L.push('## Harness controls', '');
  L.push(`Preconditions met: **${r.controls.allPreconditionsMet}**. `
    + `Mutants killed: **${r.controls.mutants.filter((m) => m.killed).length} / ${r.controls.mutants.length}**.`, '');
  L.push('| mutant | killed | detected by |', '| --- | --- | --- |');
  for (const m of r.controls.mutants) L.push(`| ${m.id} | ${m.killed} | ${m.detectedBy || '-'} |`);
  L.push('', `Reconciliation clean: **${r.reconciliation.clean}**.`, '');
  if (!r.reconciliation.clean) for (const p of r.reconciliation.problems) L.push(`- ${p}`);
  L.push('', `Corpus fingerprint: \`${r.corpusFingerprint || 'n/a'}\``, '');
  return L.join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = opts.quiet ? () => {} : (...a) => console.log(...a);

  log('WD1.6-C containment coverage');
  log('  controls ...');
  const controlResult = controls.run();
  log(`  controls: ${controlResult.mutants.filter((m) => m.killed).length}/${controlResult.mutants.length} `
    + `mutants killed, preconditions ${controlResult.allPreconditionsMet}`);

  let result = {
    counters: sweep.newCounters(),
    stats: {
      rawPaths: 0, uniqueDocuments: 0, parsedDocuments: 0,
      duplicatePaths: 0, readErrors: 0, graphErrors: 0, damagedDocuments: 0,
    },
    graphErrorIds: [],
    fingerprint: null,
  };
  if (opts.corpus) {
    log('  sweeping corpus ...');
    result = sweepCorpus(opts, log);
  }

  const r = report(result, controlResult, opts);
  fs.mkdirSync(opts.out, { recursive: true });
  fs.writeFileSync(path.join(opts.out, 'coverage.json'), `${JSON.stringify(r, null, 2)}\n`);
  fs.writeFileSync(path.join(opts.out, 'metrics.md'), `${markdown(r)}\n`);
  log(`  wrote ${path.relative(process.cwd(), opts.out)}/coverage.json and metrics.md`);

  const failures = [];
  if (!controlResult.allKilled) failures.push('an adversarial control did not fire');
  if (!controlResult.allPreconditionsMet) failures.push('the control fixture did not reach every branch');
  if (!r.reconciliation.clean) failures.push(...r.reconciliation.problems);
  if (opts.corpus && r.placements.placementsExamined === 0) failures.push('no placements were examined');
  if (r.placements.judgeErrors) failures.push(`childLegality threw on ${r.placements.judgeErrors} placements`);

  if (failures.length) {
    console.error('\nFAIL:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
    return;
  }
  log(`\nPASS -- definitive coverage ${r.definitiveCoverage.numerator} / `
    + `${r.definitiveCoverage.denominator} = ${r.definitiveCoverage.ratio}`);
}

if (require.main === module) main();
module.exports = { report, markdown, sweepCorpus, parseArgs };
