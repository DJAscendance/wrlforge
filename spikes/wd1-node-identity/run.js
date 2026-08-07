'use strict';
// WD1.4 spike -- driver.
//
// THROWAWAY PROTOTYPE / ARCHITECTURAL GATE. Answers exactly one question:
//
//   Can WRL Forge preserve node selection across realistic edits with ZERO
//   wrong anchors?
//
//   node spikes/wd1-node-identity/run.js [--files=N] [--nodes=N] [--seed=HEX]
//                                        [--out=DIR] [--no-perf] [--quick]
//
// Writes, under `--out` (default `spikes/wd1-node-identity/out`):
//
//   results.json   DETERMINISTIC. No timing, no timestamp, no absolute path.
//   metrics.md     DETERMINISTIC. The same numbers, human-readable.
//   perf.json      NOT deterministic (wall-clock and heap figures) and therefore
//                  deliberately excluded from the repeatability comparison.
//
// Read-only with respect to the corpus: it opens corpus files for reading and
// every edit is applied to an in-memory string. No corpus file is ever written.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { parse } = require(path.join(REPO_ROOT, 'src', 'vrml'));
const edit = require(path.join(REPO_ROOT, 'src', 'vrml', 'edit.js'));
const { NODE, walk } = require(path.join(REPO_ROOT, 'src', 'vrml', 'ast.js'));

const corpus = require('./corpus');
const identity = require('./identity');
const oracle = require('./oracle');
const scenarios = require('./scenarios');
const report = require('./report');
const session = require('./session');
const transaction = require('./transaction');

// The one seed for the whole spike. It is a constant, not a clock read, and it
// is recorded in every artifact.
const SEED = 'WD14-node-identity-2026';

const DEFAULTS = {
  files: 180,
  nodes: 6,
  maxScenarioFileChars: 2 * 1024 * 1024,
  maxFileChars: 4 * 1024 * 1024,
  charBudget: 220 * 1024 * 1024,
  out: path.join(__dirname, 'out'),
  perf: true,
};

function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  for (const arg of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'files') opts.files = Number(value);
    else if (key === 'nodes') opts.nodes = Number(value);
    else if (key === 'out') opts.out = path.resolve(value);
    else if (key === 'no-perf') opts.perf = false;
    else if (key === 'quick') { opts.files = 20; opts.charBudget = 24 * 1024 * 1024; }
  }
  return opts;
}

// Deterministic, machine-independent sampling key. A content-addressed sort
// beats a PRNG here: it needs no traversal state, so the sample cannot shift
// because a directory listing came back in a different order.
const sampleKey = (id) => crypto.createHash('sha256').update(`${SEED}|${id}`).digest('hex');

/**
 * Choose the files scenarios run against: proportional per corpus group, sorted
 * by the deterministic sample key, capped by size so a single multi-megabyte
 * file cannot consume the whole run.
 */
function sampleFiles(files, limit, maxChars) {
  const eligible = files.filter((f) => f.chars <= maxChars && f.stats.nodeInstances > 0);
  // Spike-authored fixtures are ALWAYS sampled, outside the draw and outside the
  // limit. They exist to cover shapes the real corpus does not contain -- S22's
  // PROTO-in-MFNode-array had zero occurrences in the sampled corpus -- so leaving
  // their inclusion to a deterministic-but-arbitrary draw would defeat the point.
  // They are tiny, so this does not meaningfully shift any aggregate.
  const forced = eligible.filter((f) => f.authored);
  const drawn = eligible.filter((f) => !f.authored);
  const groups = new Map();
  for (const f of drawn) {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(f);
  }
  const groupIds = [...groups.keys()].sort(corpus.byCodepoint);
  const picked = [];
  // One pass reserving a proportional quota, then a round-robin top-up so small
  // groups (the repo's own fixtures) are never squeezed out entirely.
  const quotas = new Map();
  for (const gid of groupIds) {
    const share = Math.max(1, Math.round((groups.get(gid).length / Math.max(1, drawn.length)) * limit));
    quotas.set(gid, share);
  }
  for (const gid of groupIds) {
    const ordered = [...groups.get(gid)].sort((a, b) => corpus.byCodepoint(sampleKey(a.id), sampleKey(b.id)));
    picked.push(...ordered.slice(0, quotas.get(gid)));
  }
  const sampled = picked
    .sort((a, b) => corpus.byCodepoint(sampleKey(a.id), sampleKey(b.id)))
    .slice(0, limit);
  return [...forced, ...sampled].sort((a, b) => corpus.byCodepoint(a.id, b.id));
}

// Fewer selected nodes in bigger files: every scenario costs a full reparse, so
// this keeps the run bounded without excluding large files from the evidence.
function nodesForFile(file, base) {
  if (file.chars > 512 * 1024) return Math.min(base, 2);
  if (file.chars > 64 * 1024) return Math.min(base, 4);
  return base;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = (msg) => process.stderr.write(`${msg}\n`);

  log('WD1.4 spike: discovering corpus...');
  const discovered = corpus.discover();
  log(`  ${discovered.entries.length} VRML files across ${discovered.groups.length} groups`);

  log('WD1.4 spike: reading, de-duplicating and parsing...');
  const loaded = corpus.load(discovered.entries, {
    maxFileChars: opts.maxFileChars,
    charBudget: opts.charBudget,
  });
  log(`  ${loaded.files.length} unique parseable files, ${loaded.skipped.length} skipped`);

  const inventory = corpus.inventory(discovered.groups, loaded.files, loaded.skipped, loaded.globalTypeCounts);

  log('WD1.4 spike: running edit scenarios...');
  const sampled = sampleFiles(loaded.files, opts.files, opts.maxScenarioFileChars);
  const cases = [];
  const wrongAnchors = [];
  const scenarioCoverage = new Map();
  const parseHealth = { worsened: 0, improved: 0, unchanged: 0 };
  const receiptStats = { verified: 0 };
  let selectedNodeCount = 0;
  let scenarioCount = 0;

  for (const file of sampled) {
    // One file's text and tree are held at a time and released with the loop
    // iteration -- see corpus.load's streaming note.
    let materialized;
    try {
      materialized = corpus.materialize(file);
    } catch {
      continue;
    }
    const { text, parse: fileParse } = materialized;
    // One session per parse. Everything derived from this parse inherits its id,
    // and oracle.classify refuses to compare across sessions -- see session.js.
    const baseSession = session.createSession(text, fileParse, file.id);
    const originalIndex = identity.buildIndex(baseSession);
    if (originalIndex.entries.length === 0) continue;
    const facts = scenarios.documentFacts(fileParse);
    const chosen = scenarios.selectNodes(originalIndex, nodesForFile(file, opts.nodes));
    const sizeClass = corpus.sizeClass(file.chars);
    const protoFile = file.stats.protoCount > 0;

    for (const { entry, category } of chosen) {
      if (entry.start === null || entry.end === null) continue;
      selectedNodeCount += 1;
      const descriptors = identity.createDescriptors(originalIndex, entry);
      const defPeers = entry.defName === null ? [] : (originalIndex.byDef.get(entry.defName) || []);
      const flags = {
        hasDef: entry.defName !== null,
        hasUniqueDef: defPeers.length === 1,
        duplicateDef: defPeers.length > 1,
        protoFile,
        protoScoped: entry.scopeKey !== '',
        hyphenDef: entry.defName !== null && entry.defName.includes('-'),
        unknownNode: !corpus.VRML97_NODE_TYPES.has(entry.nodeType),
        recovered: file.recovered,
        identicalSibling: (originalIndex.byFingerprint.get(entry.fingerprint) || []).length > 1,
      };

      const built = scenarios.buildScenarios({
        text, file, parseResult: fileParse, index: originalIndex, facts, entry,
      });

      for (const scenario of built) {
        let newText;
        try {
          newText = edit.applyEdits(text, scenario.edits);
        } catch {
          continue; // an edit set WD1.2 refuses is not a valid scenario
        }
        let newParse;
        try {
          newParse = parse(newText);
        } catch {
          continue;
        }
        scenarioCount += 1;
        scenarioCoverage.set(scenario.id, (scenarioCoverage.get(scenario.id) || 0) + 1);

        const before = fileParse.syntaxDiagnostics.length;
        const after = newParse.syntaxDiagnostics.length;
        if (after > before) parseHealth.worsened += 1;
        else if (after < before) parseHealth.improved += 1;
        else parseHealth.unchanged += 1;

        // One session shared by the index and the oracle. Parsing twice here would
        // silently report every strategy as a wrong anchor.
        const newSession = session.createSession(newText, newParse, `${file.id}#${scenario.id}`);
        const newIndex = identity.buildIndex(newSession);
        const oracleResult = oracle.establish(scenario.expectation, newSession, entry.nodeType);

        // TIER 1 RECEIPT. Strategy D is only permitted to run against an edit set
        // proven to connect this exact base text to this exact new text.
        const receipt = transaction.verify({
          baseText: text,
          anchorBaseText: text,
          edits: scenario.edits,
          newText,
        });
        if (receipt.status !== transaction.TX.VERIFIED) {
          // The harness generated both texts from these edits, so a rejection here
          // is a harness bug, not a finding. Surface it rather than scoring it.
          throw new Error(`WD1.4 harness: self-generated transaction failed verification `
            + `(${receipt.reason}) for ${file.id} ${scenario.id}`);
        }
        receiptStats.verified += 1;

        for (const sid of identity.STRATEGIES) {
          const result = identity.resolve(sid, descriptors[sid], newIndex, {
            edits: scenario.edits,
            transaction: receipt,
          });
          const klass = oracle.classify(oracleResult, result);
          cases.push({
            strategy: sid,
            klass,
            scenario: scenario.id,
            nodeType: entry.nodeType,
            group: file.group,
            sizeClass,
            layer: result.layer || null,
            unsupported: !descriptors[sid].supported,
            ...flags,
          });
          if (klass === oracle.CLASS.WRONG) {
            wrongAnchors.push({
              corpus: file.id,
              group: file.group,
              scenario: scenario.id,
              scenarioTags: scenario.tags,
              selectionCategory: category,
              strategy: sid,
              strategyLabel: identity.STRATEGY_LABELS[sid],
              original: {
                nodeType: entry.nodeType,
                def: entry.defName,
                parentType: entry.parentType,
                containingField: entry.containingField,
                scopeKey: entry.scopeKey,
                pathKey: entry.pathKey,
                start: entry.start,
                end: entry.end,
              },
              expected: oracleResult.status === oracle.ORACLE.DELETED
                ? { deleted: true, reason: oracleResult.reason }
                : oracle.describeNode(oracleResult.node, newText),
              selected: oracle.describeNode(result.node, newText),
              whyAccepted: result.reason || null,
              layerDetail: result.detail || null,
            });
          }
        }
      }
    }
  }

  log(`  ${scenarioCount} scenarios over ${selectedNodeCount} selected nodes -> ${cases.length} cases`);

  const perStrategy = report.aggregate(cases);
  const strategies = report.serialize(perStrategy);

  // S22 is reported on its own rather than only inside aggregate totals: it
  // executed zero times in the first full run, so its coverage is a finding in its
  // own right and must stay visible.
  const s22 = strategies.map((s) => {
    const row = s.byScenario.find((x) => x.key.startsWith('S22')) || null;
    return {
      strategy: s.id,
      total: row ? row.total : 0,
      correct: row ? row.correct : 0,
      'safe-loss': row ? row['safe-loss'] : 0,
      ambiguous: row ? row.ambiguous : 0,
      wrong: row ? row.wrong : 0,
      'oracle-unresolved': row ? row['oracle-unresolved'] : 0,
    };
  });

  // Wrong anchors are sorted by a stable composite key, never by discovery
  // order, and NONE are dropped.
  wrongAnchors.sort((a, b) => corpus.byCodepoint(
    `${a.strategy}|${a.scenario}|${a.corpus}|${a.original.pathKey}|${a.original.start}`,
    `${b.strategy}|${b.scenario}|${b.corpus}|${b.original.pathKey}|${b.original.start}`,
  ));

  const results = {
    spike: 'WD1.4 stable node identity prototype',
    seed: SEED,
    configuration: {
      files: opts.files,
      nodesPerFile: opts.nodes,
      maxScenarioFileChars: opts.maxScenarioFileChars,
      maxFileChars: opts.maxFileChars,
      charBudget: opts.charBudget,
    },
    corpus: {
      groups: inventory.groups,
      totals: inventory.totals,
      skipReasons: inventory.skipReasons,
      unknownNodeTypes: inventory.unknownNodeTypes.slice(0, 40),
      nodeTypesTop: inventory.nodeTypes.slice(0, 40),
      largestByBytes: inventory.largestByBytes,
      largestByNodes: inventory.largestByNodes,
      budgetExhausted: loaded.budgetExhausted,
    },
    run: {
      sampledFiles: sampled.length,
      selectedNodes: selectedNodeCount,
      scenariosExecuted: scenarioCount,
      cases: cases.length,
      parseHealth,
      verifiedTransactions: receiptStats.verified,
      scenarioCoverage: [...scenarioCoverage.entries()]
        .sort((a, b) => corpus.byCodepoint(a[0], b[0]))
        .map(([id, count]) => ({ id, count })),
      scenariosDefined: scenarios.SCENARIOS.map((s) => s.id),
      sampledFileIds: sampled.map((f) => f.id),
    },
    strategies,
    s22ProtoInMfnodeArray: s22,
    wrongAnchors,
    wrongAnchorTotal: wrongAnchors.length,
  };

  fs.mkdirSync(opts.out, { recursive: true });
  fs.writeFileSync(path.join(opts.out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  fs.writeFileSync(path.join(opts.out, 'metrics.md'), renderMetrics(results, perStrategy));

  if (opts.perf) {
    log('WD1.4 spike: performance measurements...');
    fs.writeFileSync(path.join(opts.out, 'perf.json'), `${JSON.stringify(measurePerformance(loaded.files), null, 2)}\n`);
  }

  for (const s of strategies) {
    log(`  ${s.id}: correct=${s.overall.correct} safe-loss=${s.overall['safe-loss']} `
      + `ambiguous=${s.overall.ambiguous} WRONG=${s.overall.wrong} unresolved=${s.overall['oracle-unresolved']}`);
  }
  log(`  total wrong anchors: ${wrongAnchors.length}`);
  log(`Wrote ${path.join(opts.out, 'results.json')}`);
}

// ---------------------------------------------------------------------------
// Deterministic markdown
// ---------------------------------------------------------------------------

function renderMetrics(results, perStrategy) {
  const lines = [];
  lines.push('# WD1.4 node-identity spike — machine-generated metrics');
  lines.push('');
  lines.push('> Generated by `spikes/wd1-node-identity/run.js`. Deterministic: no timing, no');
  lines.push('> timestamp, no absolute path. Do not hand-edit — re-run the spike instead.');
  lines.push('');
  lines.push(`Seed: \`${results.seed}\``);
  lines.push('');
  lines.push('## Corpus inventory');
  lines.push('');
  lines.push(report.table(
    ['group', 'in repo', 'discovered', 'discovered bytes', 'parsed', 'plain', 'gzip', 'recovered', 'chars parsed', 'AST nodes', 'node instances'],
    results.corpus.groups.map((g) => [
      g.id, g.inRepo ? 'yes' : 'no', String(g.discovered), String(g.discoveredBytes),
      String(g.parsed), String(g.plain), String(g.gzip), String(g.recovered),
      String(g.chars), String(g.astNodes), String(g.nodeInstances),
    ]),
  ));
  lines.push('');
  const t = results.corpus.totals;
  lines.push(report.table(['metric', 'value'], [
    ['files parsed', String(t.parsed)],
    ['plain-text files', String(t.plain)],
    ['gzip files', String(t.gzip)],
    ['recovered / partial parses', String(t.recovered)],
    ['node-budget truncated parses', String(t.truncated)],
    ['depth-capped parses', String(t.depthCapped)],
    ['characters parsed', String(t.chars)],
    ['AST nodes', String(t.astNodes)],
    ['node instances', String(t.nodeInstances)],
    ['DEF count', String(t.defCount)],
    ['unique DEF names (summed per file)', String(t.uniqueDefCount)],
    ['USE count', String(t.useCount)],
    ['ROUTE count', String(t.routeCount)],
    ['files containing PROTO', String(t.filesWithProto)],
    ['files containing EXTERNPROTO', String(t.filesWithExternProto)],
    ['files containing ROUTE', String(t.filesWithRoute)],
    ['files with duplicate DEF names', String(t.filesWithDuplicateDefs)],
    ['duplicate DEF names (distinct, summed)', String(t.duplicateDefNameOccurrences)],
    ['files with unknown / vendor node types', String(t.filesWithUnknownNodes)],
    ['files with hyphenated DEF names', String(t.filesWithHyphenDefs)],
    ['hyphenated DEF occurrences', String(t.hyphenDefNames)],
  ]));
  lines.push('');
  lines.push('### Skipped files, by reason');
  lines.push('');
  lines.push(report.table(['reason', 'files'], results.corpus.skipReasons.map((s) => [s.reason, String(s.count)])));
  lines.push('');
  lines.push('### Largest parsed files');
  lines.push('');
  lines.push(report.table(['by bytes', 'chars', 'AST nodes'],
    results.corpus.largestByBytes.map((f) => [f.id, String(f.chars), String(f.astNodes)])));
  lines.push('');
  lines.push(report.table(['by AST nodes', 'chars', 'AST nodes'],
    results.corpus.largestByNodes.map((f) => [f.id, String(f.chars), String(f.astNodes)])));
  lines.push('');
  lines.push('### Unknown / vendor node types encountered');
  lines.push('');
  lines.push(report.table(['node type', 'occurrences'],
    results.corpus.unknownNodeTypes.map((n) => [n.type, String(n.count)])));
  lines.push('');
  lines.push('## Run');
  lines.push('');
  lines.push(report.table(['metric', 'value'], [
    ['sampled files', String(results.run.sampledFiles)],
    ['selected nodes', String(results.run.selectedNodes)],
    ['scenarios executed', String(results.run.scenariosExecuted)],
    ['strategy cases', String(results.run.cases)],
    ['reparses with MORE syntax diagnostics', String(results.run.parseHealth.worsened)],
    ['reparses with FEWER syntax diagnostics', String(results.run.parseHealth.improved)],
    ['reparses with unchanged syntax diagnostics', String(results.run.parseHealth.unchanged)],
  ]));
  lines.push('');
  lines.push('### Scenario coverage');
  lines.push('');
  lines.push(report.table(['scenario', 'executions'],
    results.run.scenarioCoverage.map((s) => [s.id, String(s.count)])));
  lines.push('');
  lines.push('## Strategy results');
  lines.push('');
  lines.push(report.table(
    ['strategy', 'cases', 'scored', 'correct', 'safe-loss', 'ambiguous', 'WRONG', 'oracle-unresolved', 'proven-success', 'safe-refusal'],
    results.strategies.map((s) => [
      s.id, String(s.overall.total), String(s.overall.scored), String(s.overall.correct),
      String(s.overall['safe-loss']), String(s.overall.ambiguous), `**${s.overall.wrong}**`,
      String(s.overall['oracle-unresolved']),
      s.overall.provenSuccess === null ? 'n/a' : `${(s.overall.provenSuccess * 100).toFixed(1)}%`,
      s.overall.safeRefusal === null ? 'n/a' : `${(s.overall.safeRefusal * 100).toFixed(1)}%`,
    ]),
  ));
  lines.push('');
  for (const id of identity.STRATEGIES) {
    lines.push(report.renderStrategySection(perStrategy.get(id)));
    lines.push('');
  }
  lines.push('## Combined strategy E — which layer resolved each case');
  lines.push('');
  const e = results.strategies.find((s) => s.id === 'E');
  lines.push(report.table(['layer/outcome', 'cases'], e.layers.map((l) => [l.key, String(l.count)])));
  lines.push('');
  lines.push('## Scenario S22 — PROTO inside an MFNode array (reported separately)');
  lines.push('');
  lines.push('S22 executed ZERO times in the first full run: the sampled corpus contained no');
  lines.push('PROTO declaration directly inside an MFNode array. `spike-authored` supplies one.');
  lines.push('');
  lines.push(report.table(
    ['strategy', 'cases', 'correct', 'safe-loss', 'ambiguous', 'WRONG', 'oracle-unresolved'],
    results.s22ProtoInMfnodeArray.map((r) => [
      r.strategy, String(r.total), String(r.correct), String(r['safe-loss']),
      String(r.ambiguous), `**${r.wrong}**`, String(r['oracle-unresolved']),
    ]),
  ));
  lines.push('');
  lines.push('## Wrong anchors');
  lines.push('');
  lines.push(`Total: **${results.wrongAnchorTotal}**`);
  lines.push('');
  if (results.wrongAnchorTotal === 0) {
    lines.push('No strategy returned a different node than the oracle established.');
  } else {
    const byStrategyScenario = new Map();
    for (const w of results.wrongAnchors) {
      const key = `${w.strategy} | ${w.scenario}`;
      byStrategyScenario.set(key, (byStrategyScenario.get(key) || 0) + 1);
    }
    lines.push('### Wrong anchors by strategy and scenario');
    lines.push('');
    lines.push(report.table(['strategy | scenario', 'wrong anchors'],
      [...byStrategyScenario.entries()].sort((a, b) => corpus.byCodepoint(a[0], b[0]))
        .map(([k, v]) => [k, String(v)])));
    lines.push('');
    lines.push('### Every wrong anchor');
    lines.push('');
    lines.push('Complete list. `results.json` carries the same records with full detail.');
    lines.push('');
    lines.push(report.table(
      ['#', 'strategy', 'scenario', 'corpus id', 'orig type', 'orig DEF', 'parent', 'field', 'expected', 'selected', 'why accepted'],
      results.wrongAnchors.map((w, i) => [
        String(i + 1), w.strategy, w.scenario, w.corpus,
        w.original.nodeType, w.original.def === null ? '—' : w.original.def,
        w.original.parentType, w.original.containingField,
        w.expected && w.expected.deleted ? 'node deleted'
          : `${w.expected ? w.expected.nodeType : '?'}@${w.expected ? w.expected.start : '?'}`,
        w.selected ? `${w.selected.nodeType}@${w.selected.start}` : '—',
        w.whyAccepted || '—',
      ]),
    ));
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Performance (NOT part of the deterministic artifact)
// ---------------------------------------------------------------------------

function measureOne(file) {
  const { text } = corpus.materialize(file);
  const t0 = process.hrtime.bigint();
  const parsed = parse(text);
  const t1 = process.hrtime.bigint();
  const heapBefore = process.memoryUsage().heapUsed;
  const index = identity.buildIndex(session.createSession(text, parsed, file.id));
  const t2 = process.hrtime.bigint();
  const heapAfter = process.memoryUsage().heapUsed;

  const entry = index.entries[Math.floor(index.entries.length / 2)] || index.entries[0];
  if (!entry) return null;
  const t3 = process.hrtime.bigint();
  const descriptors = identity.createDescriptors(index, entry);
  const t4 = process.hrtime.bigint();

  // Re-anchor against a reparse of a trivially edited document, so the measured
  // work is a real re-anchor and not a lookup in the index it came from.
  const edits = [{ from: entry.start, to: entry.start, insert: '\n' }];
  const newText = edit.applyEdits(text, edits);
  const t5 = process.hrtime.bigint();
  const newParse = parse(newText);
  const newIndex = identity.buildIndex(session.createSession(newText, newParse, `${file.id}#perf`));
  const t6 = process.hrtime.bigint();
  const receipt = transaction.verify({ baseText: text, anchorBaseText: text, edits, newText });
  for (const sid of identity.STRATEGIES) {
    identity.resolve(sid, descriptors[sid], newIndex, { edits, transaction: receipt });
  }
  const t7 = process.hrtime.bigint();

  const ms = (a, b) => Number(b - a) / 1e6;
  return {
    id: file.id,
    chars: file.chars,
    astNodes: file.stats.astNodes,
    nodeInstances: file.stats.nodeInstances,
    defCount: file.stats.defCount,
    useCount: file.stats.useCount,
    protoCount: file.stats.protoCount,
    parseMs: Number(ms(t0, t1).toFixed(3)),
    indexBuildMs: Number(ms(t1, t2).toFixed(3)),
    indexHeapDeltaBytes: heapAfter - heapBefore,
    descriptorCreateMs: Number(ms(t3, t4).toFixed(3)),
    reparseAndIndexMs: Number(ms(t5, t6).toFixed(3)),
    reanchorAllStrategiesMs: Number(ms(t6, t7).toFixed(3)),
    editApplyMs: Number(ms(t4, t5).toFixed(3)),
  };
}

function measurePerformance(files) {
  const pick = (label, chooser) => {
    const f = chooser();
    return f ? { label, ...measureOne(f) } : { label, unavailable: true };
  };
  const sortedByChars = [...files].sort((a, b) => a.chars - b.chars);
  const byNodes = [...files].sort((a, b) => b.stats.astNodes - a.stats.astNodes);
  const textureHeavy = [...files]
    .filter((f) => f.stats.imageTextureCount >= 20)
    .sort((a, b) => b.stats.imageTextureCount - a.stats.imageTextureCount);
  const protoHeavy = [...files].sort((a, b) => b.stats.protoCount - a.stats.protoCount);
  const defUseHeavy = [...files].sort((a, b) => (b.stats.defCount + b.stats.useCount) - (a.stats.defCount + a.stats.useCount));

  return {
    note: 'Wall-clock and heap figures. NOT deterministic; excluded from the repeatability comparison.',
    node: process.version,
    measurements: [
      pick('median-size parseable file', () => sortedByChars[Math.floor(sortedByChars.length / 2)]),
      pick('largest parseable file by bytes', () => sortedByChars[sortedByChars.length - 1]),
      pick('largest parseable file by AST-node count', () => byNodes[0]),
      pick('texture-heavy Cybertown world (>=20 ImageTexture)', () => textureHeavy[0]),
      pick('PROTO-heavy file', () => protoHeavy[0]),
      pick('DEF/USE-heavy file', () => defUseHeavy[0]),
    ],
  };
}

if (require.main === module) {
  main();
}

module.exports = { sampleFiles, nodesForFile, SEED, measureOne, measurePerformance };
