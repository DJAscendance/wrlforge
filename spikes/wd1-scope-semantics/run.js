'use strict';
// WD1.5 spike -- driver.
//
//   node spikes/wd1-scope-semantics/run.js                 # full run
//   node spikes/wd1-scope-semantics/run.js --quick         # authored cases only
//   node spikes/wd1-scope-semantics/run.js --files=40      # small corpus sample
//
// Flags: --files=N, --chars=N, --out=DIR, --no-corpus, --no-perf, --quick.
//
// DETERMINISM. One recorded seed, no clock, no PRNG, no locale collation, no
// absolute path in any artifact, and no timestamp in a deterministic artifact.
// `out/results.json` and `out/metrics.md` are byte-comparable across runs;
// `out/perf.json` holds wall-clock figures and is deliberately excluded.

const fs = require('fs');
const path = require('path');

const scopeModel = require('./scope-model');
const { CASES } = require('./cases');
const corpus = require('./corpus');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { parse } = require(path.join(REPO_ROOT, 'src', 'vrml'));

const SEED = 'WD15-scope-semantics-2026';

const { STATUS, REFERENCE_KIND } = scopeModel;

// ---------------------------------------------------------------------------
// Authored-case grading
// ---------------------------------------------------------------------------

// Attach the reference's `role` to its resolution so a ROUTE expectation can
// name the side it means. The resolver has no reason to carry it; grading does.
function resolutionsWithRole(graph) {
  const roleByRef = new Map(graph.references.map((r) => [r.id, r.role || null]));
  return graph.resolutions.map((r) => ({ ...r, role: roleByRef.get(r.referenceId) || null }));
}

function pick(resolutions, want) {
  const matches = resolutions.filter((r) => r.kind === want.ref
    && (r.name === (want.name === undefined ? r.name : want.name))
    && (want.role == null || r.role === want.role));
  return matches[(want.nth || 1) - 1] || null;
}

/**
 * Grade one authored case. Returns a deterministic record; never throws on a
 * mismatch -- a disagreement is data, not a crash.
 */
function gradeCase(testCase) {
  const checks = [];

  const runOne = (source, expectations, label) => {
    const parseResult = parse(source);
    const graph = scopeModel.buildScopeGraph(parseResult);
    const resolutions = resolutionsWithRole(graph);

    for (const want of expectations || []) {
      const got = pick(resolutions, want);
      checks.push({
        case: testCase.id,
        variant: label,
        what: `${want.ref}:${want.name === null ? '<null>' : want.name}#${want.nth || 1}${want.role ? `:${want.role}` : ''}`,
        expected: `${want.status}/${want.reason}`,
        actual: got ? `${got.status}/${got.reason}` : 'MISSING',
        pass: !!got && got.status === want.status && got.reason === want.reason,
      });
    }

    for (const want of (label === 'before' ? testCase.findings : null) || []) {
      const count = graph.findings.filter((f) => f.code === want.code).length;
      checks.push({
        case: testCase.id,
        variant: label,
        what: `finding:${want.code}`,
        expected: `count=${want.count}`,
        actual: `count=${count}`,
        pass: count === want.count,
      });
    }

    if (label === 'before' && testCase.symbolExpect) {
      const want = testCase.symbolExpect;
      const syms = graph.symbols.filter((s) => s.kind === want.kind && s.name === want.name);
      const scopes = new Set(syms.map((s) => s.scopeId));
      checks.push({
        case: testCase.id,
        variant: label,
        what: `symbols:${want.kind}:${want.name}`,
        expected: `count=${want.count},scopes=${want.distinctScopes}`,
        actual: `count=${syms.length},scopes=${scopes.size}`,
        pass: syms.length === want.count && scopes.size === want.distinctScopes,
      });
    }
  };

  runOne(testCase.source, testCase.expect, 'before');
  if (testCase.after) runOne(testCase.after, testCase.expectAfter, 'after');

  return {
    id: testCase.id,
    group: testCase.group,
    title: testCase.title,
    cite: testCase.cite,
    grade: testCase.grade,
    checks,
    pass: checks.every((c) => c.pass),
  };
}

function runAuthoredCases() {
  return CASES.map(gradeCase);
}

// ---------------------------------------------------------------------------
// Differential against the production analyzer, on the authored cases
// ---------------------------------------------------------------------------

// The authored cases carry independently written truth, so this table says who
// is RIGHT -- unlike the corpus differential, which only counts disagreements.
function authoredDifferential() {
  const rows = [];
  for (const testCase of CASES) {
    const parseResult = parse(testCase.source);
    const graph = scopeModel.buildScopeGraph(parseResult);
    const resolutions = resolutionsWithRole(graph);

    const prodDupNames = new Set((parseResult.duplicateDefs || []).map((d) => d.name));
    const scopedDupNames = new Set();
    for (const scope of graph.scopes) {
      for (const [name, list] of scope.defs) if (list.length > 1) scopedDupNames.add(name);
    }

    for (const want of testCase.expect || []) {
      if (want.ref !== 'use' && want.ref !== 'route-node') continue;
      const got = pick(resolutions, want);
      if (!got) continue;

      let production = null;
      if (want.ref === 'use') {
        const u = (parseResult.uses || []).find((x) => x.name === want.name);
        if (u) production = u.resolved ? 'resolved' : 'unresolved';
      } else {
        const r = (parseResult.routes || [])
          .find((x) => (want.role === 'source' ? x.from && x.from.node : x.to && x.to.node) === want.name);
        if (r) {
          production = (want.role === 'source' ? r.resolvedFrom : r.resolvedTo) ? 'resolved' : 'unresolved';
        }
      }
      if (production === null) continue;

      const expectedResolved = want.status === 'resolved';
      const productionResolved = production === 'resolved';
      const prototypeResolved = got.status === STATUS.RESOLVED;
      if (productionResolved === expectedResolved && prototypeResolved === expectedResolved) continue;

      rows.push({
        case: testCase.id,
        ref: `${want.ref}:${want.name}${want.role ? `:${want.role}` : ''}`,
        expected: `${want.status}/${want.reason}`,
        production: production,
        prototype: `${got.status}/${got.reason}`,
        productionCorrect: productionResolved === expectedResolved,
        prototypeCorrect: prototypeResolved === expectedResolved,
        sortKey: `${testCase.id}|${want.ref}|${want.name}|${want.role || ''}`,
      });
    }

    for (const want of testCase.findings || []) {
      if (want.code !== 'duplicate-def-in-scope') continue;
      const names = new Set([...prodDupNames, ...scopedDupNames]);
      for (const name of [...names].sort(scopeModel.byCodepoint)) {
        const prod = prodDupNames.has(name);
        const proto = scopedDupNames.has(name);
        if (prod === proto) continue;
        rows.push({
          case: testCase.id,
          ref: `duplicate-def:${name}`,
          expected: `count=${want.count}`,
          production: prod ? 'duplicate' : 'not-duplicate',
          prototype: proto ? 'duplicate' : 'not-duplicate',
          productionCorrect: prod === (want.count > 0),
          prototypeCorrect: proto === (want.count > 0),
          sortKey: `${testCase.id}|duplicate-def|${name}|`,
        });
      }
    }
  }
  return rows.sort((a, b) => scopeModel.byCodepoint(a.sortKey, b.sortKey));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function sortedEntries(map) {
  return [...map.entries()].sort((a, b) => scopeModel.byCodepoint(a[0], b[0]));
}

function table(headers, rows) {
  const out = [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`];
  for (const row of rows) out.push(`| ${row.join(' | ')} |`);
  return out.join('\n');
}

function renderMetrics(results) {
  const lines = [];
  lines.push('# WD1.5 scope semantics -- run metrics');
  lines.push('');
  lines.push(`Seed: \`${SEED}\`. Deterministic artifact: no timestamp, no timing, no absolute path.`);
  lines.push('');

  const cases = results.authored;
  const passed = cases.filter((c) => c.pass).length;
  lines.push('## Authored expected-truth cases');
  lines.push('');
  lines.push(`${passed}/${cases.length} cases pass. `
    + `${cases.reduce((n, c) => n + c.checks.filter((x) => x.pass).length, 0)}`
    + `/${cases.reduce((n, c) => n + c.checks.length, 0)} individual checks pass.`);
  lines.push('');
  lines.push(table(['case', 'group', 'grade', 'title', 'result'],
    cases.map((c) => [c.id, c.group, c.grade, c.title, c.pass ? 'pass' : '**FAIL**'])));
  lines.push('');

  const failing = cases.flatMap((c) => c.checks.filter((x) => !x.pass));
  if (failing.length) {
    lines.push('### Failing checks');
    lines.push('');
    lines.push(table(['case', 'variant', 'reference', 'expected', 'actual'],
      failing.map((f) => [f.case, f.variant, f.what, f.expected, f.actual])));
    lines.push('');
  }

  lines.push('## Current analyzer vs prototype, graded against authored truth');
  lines.push('');
  if (results.authoredDifferential.length === 0) {
    lines.push('No disagreements on the authored cases.');
  } else {
    lines.push(table(['case', 'reference', 'expected', 'production', 'prototype', 'production right?', 'prototype right?'],
      results.authoredDifferential.map((r) => [
        r.case, r.ref, r.expected, r.production, r.prototype,
        r.productionCorrect ? 'yes' : '**no**', r.prototypeCorrect ? 'yes' : '**no**',
      ])));
  }
  lines.push('');

  if (results.corpus) {
    const c = results.corpus;
    lines.push('## Corpus inventory');
    lines.push('');
    lines.push(`Corpus fingerprint \`${c.fingerprint.slice(0, 16)}\` `
      + '(sha256 over every discovered `id:size`; the roots are external trees, so a '
      + 'changed fingerprint means the INPUT changed, not that the analysis is unstable).');
    lines.push('');
    lines.push(`Discovered ${c.discovered} files across ${c.groups.length} groups; `
      + `analysed ${c.files}; skipped ${c.skippedTotal}; `
      + `${c.charsParsed} characters parsed.`);
    if (c.budgetExhausted || c.fileCapReached) {
      lines.push('');
      lines.push('> **Coverage is NOT exhaustive.** '
        + `${c.fileCapReached ? 'The file cap was reached. ' : ''}`
        + `${c.budgetExhausted ? 'The character budget was exhausted. ' : ''}`
        + 'Files are interleaved round-robin across groups, so truncation trims '
        + "every group's tail evenly rather than deleting whole groups.");
    }
    lines.push('');
    lines.push(table(['group', 'discovered', 'analysed', 'chars'],
      c.groups.map((g) => [g.id, String(g.discovered),
        String((c.perGroup[g.id] || {}).files || 0), String((c.perGroup[g.id] || {}).chars || 0)])));
    lines.push('');
    lines.push('### Skip reasons');
    lines.push('');
    lines.push(table(['reason', 'files'], c.skipReasons.map(([k, v]) => [k, String(v)])));
    lines.push('');
    lines.push('### Totals');
    lines.push('');
    lines.push(table(['metric', 'value'], c.totals.map(([k, v]) => [k, String(v)])));
    lines.push('');
    lines.push('### Resolution status by reference kind');
    lines.push('');
    lines.push(table(['kind/status', 'count'], c.byStatus.map(([k, v]) => [k, String(v)])));
    lines.push('');
    lines.push('### Resolution reasons');
    lines.push('');
    lines.push(table(['kind/reason', 'count'], c.byReason.map(([k, v]) => [k, String(v)])));
    lines.push('');
    lines.push('### Compatibility constructs observed');
    lines.push('');
    lines.push(c.compat.length
      ? table(['construct', 'occurrences'], c.compat.map(([k, v]) => [k, String(v)]))
      : 'None observed in the sampled corpus.');
    lines.push('');
    lines.push('### Scope findings');
    lines.push('');
    lines.push(c.findings.length
      ? table(['finding', 'occurrences'], c.findings.map(([k, v]) => [k, String(v)]))
      : 'None.');
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { files: undefined, chars: undefined, out: path.join(__dirname, 'out'), corpus: true, perf: true };
  for (const a of argv) {
    if (a === '--quick') { args.corpus = false; args.perf = false; }
    else if (a === '--no-corpus') args.corpus = false;
    else if (a === '--no-perf') args.perf = false;
    else if (a.startsWith('--files=')) args.files = Number(a.slice(8));
    else if (a.startsWith('--chars=')) args.chars = Number(a.slice(8));
    else if (a.startsWith('--out=')) args.out = path.resolve(a.slice(6));
  }
  return args;
}

function measurePerf() {
  const fixtures = [
    'test/fixtures/preview/real-smartcar-lite.wrl',
    'test/fixtures/world/valid70/world.wrl',
    'test/fixtures/oversized.wrl',
  ];
  // The repo fixtures are geometry-heavy and scope-light (one of them has no DEF
  // at all), so on their own they say nothing about scope-graph cost. This
  // synthetic document is the opposite: many scopes, many symbols, many
  // references. Generated here rather than committed -- it is a measurement
  // input, not a fixture.
  const synthetic = (() => {
    const out = ['#VRML V2.0 utf8'];
    for (let i = 0; i < 200; i += 1) {
      out.push(`PROTO P${i} [ exposedField SFVec3f t${i} 0 0 0 ] {`);
      out.push(`  Transform { translation IS t${i} children [ DEF Hub${i} Group { } USE Hub${i} ] }`);
      out.push('}');
    }
    for (let i = 0; i < 2000; i += 1) out.push(`DEF N${i} Transform { children [ Shape { geometry Box { } } ] }`);
    for (let i = 0; i < 2000; i += 1) out.push(`Group { children [ USE N${i} ] }`);
    out.push('DEF Clock TimeSensor { }');
    for (let i = 0; i < 2000; i += 1) out.push(`ROUTE Clock.fraction_changed TO N${i}.set_translation`);
    return `${out.join('\n')}\n`;
  })();

  const rows = [];
  const inputs = fixtures
    .map((rel) => ({ label: rel, abs: path.join(REPO_ROOT, rel) }))
    .filter((f) => fs.existsSync(f.abs))
    .map((f) => ({ label: f.label, text: fs.readFileSync(f.abs, 'utf8') }));
  inputs.push({ label: 'synthetic scope-heavy (200 PROTO, 4000 DEF/USE, 2000 ROUTE)', text: synthetic });

  for (const { label: rel, text } of inputs) {
    const t0 = process.hrtime.bigint();
    const parseResult = parse(text);
    const t1 = process.hrtime.bigint();
    let graph = null;
    for (let i = 0; i < 5; i += 1) graph = scopeModel.buildScopeGraph(parseResult);
    const t2 = process.hrtime.bigint();
    rows.push({
      fixture: rel,
      chars: text.length,
      parseMs: Number(t1 - t0) / 1e6,
      scopeMsPerBuild: Number(t2 - t1) / 1e6 / 5,
      scopes: graph.scopes.length,
      symbols: graph.symbols.length,
      references: graph.references.length,
    });
  }
  return rows;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });

  const authored = runAuthoredCases();
  const results = { seed: SEED, authored, authoredDifferential: authoredDifferential(), corpus: null };

  if (args.corpus) {
    const raw = corpus.analyseCorpus({
      maxFiles: args.files === undefined ? 100000 : args.files,
      charBudget: args.chars === undefined ? 1024 * 1024 * 1024 : args.chars,
    });
    const skipReasons = new Map();
    for (const s of raw.skipped) skipReasons.set(s.reason, (skipReasons.get(s.reason) || 0) + 1);
    const perGroup = {};
    for (const [k, v] of raw.perGroup) perGroup[k] = v;
    results.corpus = {
      discovered: raw.discovered,
      fingerprint: raw.fingerprint,
      groups: raw.groups.map((g) => ({ id: g.id, discovered: g.discovered, present: g.present })),
      files: raw.files.length,
      recoveredFiles: raw.files.filter((f) => f.recovered).length,
      skippedTotal: raw.skipped.length,
      skipReasons: sortedEntries(skipReasons),
      perGroup,
      totals: sortedEntries(raw.totals),
      byStatus: sortedEntries(raw.byStatus),
      byReason: sortedEntries(raw.byReason),
      compat: sortedEntries(raw.compat),
      findings: sortedEntries(raw.findings),
      charsParsed: raw.charsParsed,
      budgetExhausted: raw.budgetExhausted,
      fileCapReached: raw.fileCapReached,
    };
  }

  fs.writeFileSync(path.join(args.out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  fs.writeFileSync(path.join(args.out, 'metrics.md'), `${renderMetrics(results)}\n`);
  if (args.perf) {
    fs.writeFileSync(path.join(args.out, 'perf.json'), `${JSON.stringify({ node: process.version, rows: measurePerf() }, null, 2)}\n`);
  }

  const passed = authored.filter((c) => c.pass).length;
  process.stdout.write(`WD1.5: ${passed}/${authored.length} authored cases pass`);
  if (results.corpus) {
    process.stdout.write(`; corpus ${results.corpus.files} files, ${results.corpus.charsParsed} chars`);
  }
  process.stdout.write(`\nartifacts: ${path.relative(REPO_ROOT, args.out)}\n`);
}

if (require.main === module) main();

module.exports = { SEED, gradeCase, runAuthoredCases, authoredDifferential, renderMetrics, resolutionsWithRole };
