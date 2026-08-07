'use strict';
// WD1.5-P2C -- the reproducible corpus audit driver.
//
//   node --max-old-space-size=6144 spikes/wd1-route-semantics/run.js
//
// Flags: --files=N (cap discovered paths), --out=DIR, --no-corpus, --controls-only,
//        --quiet.
//
// Emits `out/audit.json` (machine-readable, deterministic) and `out/metrics.md`
// (human-readable). `out/` is gitignored and regenerable -- the HARNESS is the
// durable artifact, not its output.
//
// EXIT CODE is the verdict. Non-zero when any hard gate fails, when the
// partitions do not reconcile arithmetically, or when an adversarial control
// stops firing. A green run is therefore a claim the script itself is willing
// to stake its exit status on.

// =========================================================================
// LOAD ORDER IS EVIDENCE. The oracle must be required BEFORE anything that
// pulls in the production ROUTE resolver, so that its load-time guard is
// checking a real precondition rather than a foregone one. Moving this line
// below the `sweep` require makes the guard throw -- deliberately.
// =========================================================================
const oracle = require('./oracle');

const fs = require('fs');
const path = require('path');
const corpus = require('./corpus');
const sweep = require('./sweep'); // pulls in src/vrml/scope-graph.js
const controls = require('./controls');

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

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = opts.quiet ? () => {} : (...a) => console.log(...a);

  // ---- Adversarial controls first: if the detectors cannot fire, no corpus
  // zero that follows means anything, so there is no point measuring one.
  log('running adversarial controls...');
  const controlResult = controls.runControls();
  for (const r of controlResult.results) {
    log(`  ${r.passed ? 'fires' : 'DID NOT FIRE'}  ${r.id}${r.error ? ` (${r.error})` : ''}`);
  }
  if (!controlResult.allPassed) {
    log('\nA detector stopped firing. Corpus zero-counts are NOT evidence until this is fixed.');
  }

  const report = {
    lane: 'WD1.5-P2C',
    what: 'ROUTE endpoint resolution -- reproducible read-only corpus audit',
    // No timestamp, no timing, no absolute path: two runs over an unchanged
    // corpus must be byte-identical.
    controls: controlResult,
  };

  if (opts.corpus) {
    log('\nsweeping corpus (read-only, boundary-guarded)...');
    Object.assign(report, runCorpus(opts, log));
  }

  const failures = collectFailures(report);
  report.hardGates = {
    wrongNodeBindings: report.oracle ? report.oracle.wrongNodeBindings : null,
    wrongEndpointBindings: report.oracle ? report.oracle.wrongEndpointBindings : null,
    confidentFromUnprovable: report.safety ? report.safety.confidentFromUnprovable : null,
    unprojectedRoutes: report.routes ? report.routes.unprojectedRoutes : null,
    allControlsFired: controlResult.allPassed,
  };
  report.failures = failures;
  report.verdict = failures.length === 0 ? 'PASS' : 'FAIL';

  fs.mkdirSync(opts.out, { recursive: true });
  fs.writeFileSync(path.join(opts.out, 'audit.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(opts.out, 'metrics.md'), renderMarkdown(report));

  log(`\nwrote ${path.relative(process.cwd(), path.join(opts.out, 'audit.json'))}`);
  log(`wrote ${path.relative(process.cwd(), path.join(opts.out, 'metrics.md'))}`);
  log(`\nVERDICT: ${report.verdict}`);
  for (const f of failures) log(`  FAIL: ${f}`);

  process.exitCode = failures.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// The corpus pass
// ---------------------------------------------------------------------------

function runCorpus(opts, log) {
  const acc = sweep.newAccumulator();

  // Damage matrix: every definition, over BOTH denominators, for files AND for
  // the ROUTEs they contain. This grid is what makes the historical 576/212 and
  // 36,472/11,173 question answerable instead of assertable.
  const zero = () => Object.fromEntries(corpus.DAMAGE_DEF_NAMES.map((n) => [n, 0]));
  const damage = {
    rawPathsWithDamage: zero(),
    uniqueDocsWithDamage: zero(),
    routesInDamagedRawPaths: zero(),
    routesInDamagedUniqueDocs: zero(),
  };

  let rawRoutes = 0;
  let uniqueRoutes = 0;
  let uniqueDocsWithRouteRelevantRecovery = 0;
  let uniqueDocsAnalysed = 0;
  let uniqueDocsGraded = 0;
  let seenPaths = 0;
  const buildErrors = [];

  const summary = corpus.sweepPaths((rec) => {
    seenPaths += 1;

    if (rec.damage) {
      for (const def of corpus.DAMAGE_DEF_NAMES) {
        if (!rec.damage[def]) continue;
        damage.rawPathsWithDamage[def] += 1;
        damage.routesInDamagedRawPaths[def] += rec.routeCount;
        if (rec.first) {
          damage.uniqueDocsWithDamage[def] += 1;
          damage.routesInDamagedUniqueDocs[def] += rec.routeCount;
        }
      }
    }
    rawRoutes += rec.routeCount;
    if (!rec.first) return;
    uniqueRoutes += rec.routeCount;

    if (!rec.parsed) return;
    const gradeable = !rec.damage[corpus.CANONICAL_DAMAGE];
    const recoveryBefore = acc.routesDependingOnRecovery;
    try {
      sweep.analyseDocument(rec.parsed, acc, gradeable, rec.id);
    } catch (err) {
      buildErrors.push({ id: rec.id, message: String(err && err.message).slice(0, 200) });
      return;
    }
    uniqueDocsAnalysed += 1;
    if (gradeable) uniqueDocsGraded += 1;
    if (acc.routesDependingOnRecovery > recoveryBefore) uniqueDocsWithRouteRelevantRecovery += 1;
  }, opts.files ? { limit: opts.files } : {});

  const confident = sweep.finaliseConfidentFromUnprovable(acc);

  log(`  discovered ${summary.rawDiscoveredPaths} paths, ${summary.uniqueDecodedDocuments} unique decoded documents`);
  log(`  ${acc.totalRoutes} ROUTEs analysed through the production path`);

  return {
    corpusFingerprint: summary.fingerprint,
    discovery: {
      groups: summary.groups.map((g) => ({
        id: g.id, present: g.present, discovered: g.discovered,
      })),
      rawDiscoveredPaths: summary.rawDiscoveredPaths,
      rawPathsRead: summary.rawPathsRead,
      rawReadOrParseErrors: summary.rawReadErrors,
      readErrorSample: summary.readErrorIds.slice(0, 20),
      duplicateContentPaths: summary.duplicateContentPaths,
      uniqueDecodedDocuments: summary.uniqueDecodedDocuments,
      uniqueDocumentsAnalysed: uniqueDocsAnalysed,
      uniqueDocumentsGradedByOracle: uniqueDocsGraded,
      dedupeRule: 'sha256 over the UTF-8 bytes of the DECODED source text, after readWrlSource',
      buildErrors,
    },
    damageMetrics: {
      definitions: {
        'syntax-error': 'truncated OR depthCapped OR any syntaxDiagnostic of severity=error',
        'syntax-any': 'truncated OR depthCapped OR any syntaxDiagnostic of any severity',
        'any-diagnostic': 'truncated OR depthCapped OR any diagnostic at all, INCLUDING analyze.js VRML040-VRML044 advisories',
      },
      canonical: corpus.CANONICAL_DAMAGE,
      ...damage,
      uniqueDocsWithRouteRelevantRecovery,
    },
    routes: {
      totalRoutesRawPaths: rawRoutes,
      totalRoutesUniqueDocs: uniqueRoutes,
      totalRoutesAnalysed: acc.totalRoutes,
      unprojectedRoutes: acc.unprojectedRoutes,
      unprojectedSamples: acc.unprojectedSamples.slice(0, 20),
      routesDependingOnRecovery: acc.routesDependingOnRecovery,
      routesDependingOnUnsupported: acc.routesDependingOnUnsupported,
      routesDependingOnUnprovable: acc.routesDependingOnUnprovable,
    },
    partitions: {
      sourceNode: sweep.tallyToObject(acc.partition.sourceNode),
      destinationNode: sweep.tallyToObject(acc.partition.destNode),
      sourceEndpoint: sweep.tallyToObject(acc.partition.sourceEndpoint),
      destinationEndpoint: sweep.tallyToObject(acc.partition.destEndpoint),
      compatibility: sweep.tallyToObject(acc.partition.compatibility),
    },
    partitionSums: {
      sourceNode: sweep.sumValues(acc.partition.sourceNode),
      destinationNode: sweep.sumValues(acc.partition.destNode),
      sourceEndpoint: sweep.sumValues(acc.partition.sourceEndpoint),
      destinationEndpoint: sweep.sumValues(acc.partition.destEndpoint),
      compatibility: sweep.sumValues(acc.partition.compatibility),
      expected: acc.totalRoutes - acc.unprojectedRoutes,
    },
    verdicts: {
      directionInvalidSource: acc.directionInvalidSource,
      directionInvalidDestination: acc.directionInvalidDest,
      typeMismatch: acc.typeMismatch,
      typeMismatchSamples: acc.typeMismatchSamples,
      typeUnknown: acc.typeUnknown,
      endpointOriginSource: sweep.tallyToObject(acc.endpointOrigin.source),
      endpointOriginDestination: sweep.tallyToObject(acc.endpointOrigin.destination),
      aliasOrShorthandUse: sweep.tallyToObject(acc.aliasUse),
    },
    safety: {
      confidentFromUnprovable: confident.count,
      confidentFromUnprovableSamples: confident.samples,
      rule: 'a scope that produced any `recovered` answer must produce no confident '
        + '(resolved / unresolved) answer; `missing-name` is a token fact above the gate '
        + 'and is excluded',
    },
    oracle: {
      independence: 'oracle.js throws at load if scope-graph.js or symbols.js is already '
        + 'in require.cache; run.js loads it first; test.js re-proves it in a clean child process',
      gradedOnly: `documents with no ${corpus.CANONICAL_DAMAGE} damage`,
      routesGraded: acc.routesGraded,
      routesNotGraded: acc.routesNotGraded,
      oracleMissedRoutes: acc.oracleMissedRoutes,
      oracleMissedSamples: acc.oracleMissedSamples,
      nodeComparisons: acc.nodeCompared,
      nodeAgreements: acc.nodeAgreed,
      wrongNodeBindings: acc.nodeWrong,
      wrongNodeBindingSamples: acc.nodeWrongSamples,
      nodeSafeRefusals: acc.nodeSafeRefusals,
      nodeUncomparable: acc.nodeUncomparable,
      nodeAbstainReasons: sweep.tallyToObject(acc.nodeAbstainReasons),
      endpointComparisons: acc.endpointCompared,
      endpointAgreements: acc.endpointAgreed,
      wrongEndpointBindings: acc.endpointWrong,
      wrongEndpointBindingSamples: acc.endpointWrongSamples,
      endpointSafeRefusals: acc.endpointSafeRefusals,
      endpointUncomparable: acc.endpointUncomparable,
      endpointAbstainReasons: sweep.tallyToObject(acc.endpointAbstainReasons),
    },
  };
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

function collectFailures(report) {
  const out = [];
  if (!report.controls.allPassed) {
    const dead = report.controls.results.filter((r) => !r.passed).map((r) => r.id);
    out.push(`adversarial controls did not fire: ${dead.join(', ')}`);
  }
  if (!report.routes) return out;

  if (report.routes.unprojectedRoutes > 0) {
    out.push(`${report.routes.unprojectedRoutes} parsed ROUTEs were not projected by the production path `
      + '-- an unclassified ROUTE could hide an unprovable one');
  }
  if (report.oracle.oracleMissedRoutes > 0) {
    out.push(`${report.oracle.oracleMissedRoutes} ROUTEs the resolver projected were not reached by the oracle walk`);
  }
  // §10: every question's buckets must sum to the ROUTE total, or a ROUTE has
  // silently escaped classification.
  const expected = report.partitionSums.expected;
  for (const [name, sum] of Object.entries(report.partitionSums)) {
    if (name === 'expected') continue;
    if (sum !== expected) {
      out.push(`partition '${name}' sums to ${sum}, expected ${expected} -- a ROUTE is unclassified`);
    }
  }
  if (report.oracle.wrongNodeBindings > 0) {
    out.push(`${report.oracle.wrongNodeBindings} WRONG NODE BINDINGS`);
  }
  if (report.oracle.wrongEndpointBindings > 0) {
    out.push(`${report.oracle.wrongEndpointBindings} WRONG ENDPOINT BINDINGS`);
  }
  if (report.safety.confidentFromUnprovable > 0) {
    out.push(`${report.safety.confidentFromUnprovable} confident answers from an unprovable scope`);
  }
  if (report.discovery.buildErrors.length > 0) {
    out.push(`${report.discovery.buildErrors.length} documents threw while building the scope graph`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function table(obj) {
  const keys = Object.keys(obj).sort();
  if (!keys.length) return '_(none)_\n';
  let s = '| key | count |\n| --- | ---: |\n';
  for (const k of keys) s += `| \`${k}\` | ${obj[k]} |\n`;
  return s;
}

function renderMarkdown(r) {
  let s = '# WD1.5-P2C — reproducible ROUTE-semantics corpus audit\n\n';
  s += 'Generated by `spikes/wd1-route-semantics/run.js`. Deterministic: no clock, no PRNG,\n';
  s += 'no absolute path, no timing figure.\n\n';
  s += `**Verdict: ${r.verdict}**\n\n`;
  if (r.failures.length) for (const f of r.failures) s += `- FAIL: ${f}\n`;

  s += '\n## Adversarial controls\n\n| control | detector | fires |\n| --- | --- | --- |\n';
  for (const c of r.controls.results) {
    s += `| \`${c.id}\` | ${c.detector} | ${c.passed ? 'yes' : '**NO**'} |\n`;
  }
  if (!r.discovery) return s;

  s += `\n## Corpus\n\n- input fingerprint: \`${r.corpusFingerprint}\`\n`;
  s += `- de-duplication: ${r.discovery.dedupeRule}\n`;
  for (const [k, v] of Object.entries(r.discovery)) {
    if (typeof v === 'number') s += `- ${k}: **${v}**\n`;
  }

  s += '\n## Damage metrics — every definition, both denominators\n\n';
  for (const [k, v] of Object.entries(r.damageMetrics.definitions)) s += `- \`${k}\`: ${v}\n`;
  s += `\ncanonical definition (gates the oracle): \`${r.damageMetrics.canonical}\`\n\n`;
  s += '| definition | raw paths | unique docs | ROUTEs in damaged raw paths | ROUTEs in damaged unique docs |\n';
  s += '| --- | ---: | ---: | ---: | ---: |\n';
  for (const def of Object.keys(r.damageMetrics.definitions)) {
    s += `| \`${def}\` | ${r.damageMetrics.rawPathsWithDamage[def]} `
      + `| ${r.damageMetrics.uniqueDocsWithDamage[def]} `
      + `| ${r.damageMetrics.routesInDamagedRawPaths[def]} `
      + `| ${r.damageMetrics.routesInDamagedUniqueDocs[def]} |\n`;
  }
  s += `\n- unique documents with ROUTE-relevant recovery: **${r.damageMetrics.uniqueDocsWithRouteRelevantRecovery}**\n`;
  s += `- ROUTEs whose OWN answer rests on recovery: **${r.routes.routesDependingOnRecovery}**\n`;
  s += `- ROUTEs whose OWN answer rests on an unsupported EXTERNPROTO: **${r.routes.routesDependingOnUnsupported}**\n`;
  s += `- ROUTEs whose OWN answer rests on either: **${r.routes.routesDependingOnUnprovable}**\n`;

  s += `\n## ROUTE totals\n\n- raw-path denominator: **${r.routes.totalRoutesRawPaths}**\n`;
  s += `- unique-document denominator (canonical): **${r.routes.totalRoutesUniqueDocs}**\n`;
  s += `- analysed through the production path: **${r.routes.totalRoutesAnalysed}**\n`;
  s += `- unprojected (must be 0): **${r.routes.unprojectedRoutes}**\n`;

  s += '\n## Complete partitions\n\n';
  for (const [name, part] of Object.entries(r.partitions)) {
    s += `### ${name} (sums to ${r.partitionSums[name]})\n\n${table(part)}\n`;
  }

  s += '\n## Direction and type\n\n';
  s += `- source direction invalid: **${r.verdicts.directionInvalidSource}**\n`;
  s += `- destination direction invalid: **${r.verdicts.directionInvalidDestination}**\n`;
  s += `- type mismatch: **${r.verdicts.typeMismatch}**\n`;
  s += `- type unknown: **${r.verdicts.typeUnknown}**\n`;
  s += `\nendpoint origin (source):\n\n${table(r.verdicts.endpointOriginSource)}\n`;
  s += `endpoint origin (destination):\n\n${table(r.verdicts.endpointOriginDestination)}\n`;
  s += `alias/shorthand bindings (written name != declared member):\n\n${table(r.verdicts.aliasOrShorthandUse)}\n`;

  s += '\n## Oracle differential\n\n';
  s += `${r.oracle.independence}\n\n`;
  s += `- graded documents: **${r.discovery.uniqueDocumentsGradedByOracle}** (${r.oracle.gradedOnly})\n`;
  s += `- ROUTEs graded: **${r.oracle.routesGraded}**, not graded: ${r.oracle.routesNotGraded}\n`;
  s += `- node comparisons: **${r.oracle.nodeComparisons}**, agreements: ${r.oracle.nodeAgreements}\n`;
  s += `- **wrong node bindings: ${r.oracle.wrongNodeBindings}**\n`;
  s += `- node safe refusals (production declined where the oracle would bind): ${r.oracle.nodeSafeRefusals}\n`;
  s += `- node uncomparable: ${r.oracle.nodeUncomparable}\n\n${table(r.oracle.nodeAbstainReasons)}\n`;
  s += `- endpoint comparisons: **${r.oracle.endpointComparisons}**, agreements: ${r.oracle.endpointAgreements}\n`;
  s += `- **wrong endpoint bindings: ${r.oracle.wrongEndpointBindings}**\n`;
  s += `- endpoint safe refusals: ${r.oracle.endpointSafeRefusals}\n`;
  s += `- endpoint uncomparable: ${r.oracle.endpointUncomparable}\n\n${table(r.oracle.endpointAbstainReasons)}\n`;
  s += `\n- **confident conclusions from an unprovable scope: ${r.safety.confidentFromUnprovable}**\n`;
  s += `  (${r.safety.rule})\n`;
  return s;
}

if (require.main === module) main();

module.exports = { main, runCorpus, collectFailures, renderMarkdown, oracle };
