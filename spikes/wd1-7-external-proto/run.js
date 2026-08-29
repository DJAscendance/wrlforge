'use strict';
// WD1.7-A -- the reproducible EXTERNPROTO evidence driver.
//
//   node --max-old-space-size=6144 spikes/wd1-7-external-proto/run.js
//
// Flags: --files=N (cap discovered paths), --out=DIR, --controls-only, --quiet.
//
// Emits `out/evidence.json` (deterministic, machine-readable) and
// `out/metrics.md`. `out/` is gitignored and regenerable -- the HARNESS is the
// durable artifact, not its output.
//
// EXIT CODE IS THE VERDICT. Non-zero when a control stops firing, when the
// partitions fail to reconcile arithmetically, or when the boundary guard is
// not demonstrably live. A green run is a claim this script stakes its exit
// status on.
//
// DISCOVERY IS NOT REIMPLEMENTED. `corpus.discover()` is P2C's committed module,
// which inherits WD1.4's forbidden-path guard. This driver reads bytes itself
// (rather than through `sweepPaths`) for exactly one reason: Q7 needs the
// `wasGzipped` fact that `sweepPaths` does not surface, and inferring
// compression from an extension is the very thing Q7 exists to test.

const fs = require('fs');
const path = require('path');
const sweep = require('./sweep');
const controls = require('./controls');

const { corpus, extract, subsetCheck } = sweep;
const { readWrlSource } = require('../../src/preview/wrl-source');
const { parse } = require('../../src/vrml');

const OUT_DEFAULT = path.join(__dirname, 'out');

function parseArgs(argv) {
  const opts = { out: OUT_DEFAULT, files: 0, controlsOnly: false, quiet: false };
  for (const arg of argv) {
    if (arg.startsWith('--files=')) opts.files = Number(arg.slice(8)) || 0;
    else if (arg.startsWith('--out=')) opts.out = path.resolve(arg.slice(6));
    else if (arg === '--controls-only') opts.controlsOnly = true;
    else if (arg === '--quiet') opts.quiet = true;
    else throw new Error(`unknown flag: ${arg}`);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = opts.quiet ? () => {} : (...a) => console.log(...a);

  // ---- controls first. A sweep whose controls have gone quiet proves nothing.
  const controlReport = controls.run();
  log(`controls: ${controlReport.passed}/${controlReport.total} fired`);
  if (controlReport.failures.length) {
    for (const f of controlReport.failures) console.error(`CONTROL FAILED: ${f}`);
    process.exitCode = 1;
    return;
  }
  if (opts.controlsOnly) { log('controls-only: done'); return; }

  // ---- discovery
  const discovered = corpus.discover();
  const entries = opts.files ? discovered.entries.slice(0, opts.files) : discovered.entries;
  log(`discovered ${discovered.entries.length} paths (fingerprint ${discovered.fingerprint.slice(0, 16)})`);
  log(`sweeping ${entries.length} paths`);

  const c = sweep.newCounters();
  c.rawPaths = entries.length;

  // contentHash -> index entry (one parse per unique decoded document)
  const index = new Map();
  // probe key -> Set of contentHash
  const byKey = new Map();
  // contentHash -> first id, for reporting
  const firstId = new Map();
  // documents that declare EXTERNPROTOs: [{ id, contentHash, decls }]
  const consumers = [];
  const seen = new Set();

  for (const e of entries) {
    corpus.assertAllowed(e.abs);
    let src;
    try {
      src = readWrlSource(e.abs);
    } catch {
      c.readErrors += 1;
      continue;
    }
    // ---- Q7: compression signalling, measured per RAW PATH.
    const ext = path.extname(e.id).toLowerCase();
    const extSaysGzip = ext === '.wrz' || ext === '.gz' || ext === '.x3dz';
    if (src.wasGzipped) c.gzipByMagic += 1;
    if (extSaysGzip) c.gzipExtension += 1;
    if (src.wasGzipped && !extSaysGzip) c.gzipMagicButPlainExtension += 1;
    if (!src.wasGzipped && extSaysGzip) c.plainMagicButGzipExtension += 1;

    const hash = corpus.contentIdentity(src.text);
    const isFirst = !seen.has(hash);

    if (isFirst) {
      seen.add(hash);
      firstId.set(hash, e.id);
      c.uniqueDocs += 1;
      const parsed = parse(src.text);
      const entry = sweep.indexEntryFor(parsed);
      index.set(hash, entry);
      if (entry.selectable.length) c.docsWithTopLevelProto += 1;
      // ---- Q4: does "excluding EXTERNPROTOs" change the selected name?
      if (entry.firstAnyProto && entry.firstAnyProto.isExtern && entry.firstSelectable) {
        c.docsWhereExcludingExternProtoMatters += 1;
      }
      const decls = extract.externProtosOf(parsed);
      if (decls.length) {
        c.uniqueDocsWithExternProto += 1;
        c.externProtoDeclsUniqueDocs += decls.length;
        consumers.push({ id: e.id, hash, decls });
      }
    }

    // ---- Q1 raw-path denominators: replayed onto every path sharing content.
    const entry = index.get(hash);
    const declCount = isFirst
      ? (consumers.length && consumers[consumers.length - 1].hash === hash
        ? consumers[consumers.length - 1].decls.length : 0)
      : declCountFor(consumers, hash);
    if (declCount > 0) c.rawPathsWithExternProto += 1;
    c.externProtoDecls += declCount;

    // ---- the probe index is keyed on every path suffix of every RAW path, so
    // a reference written against one archived capture can find content stored
    // under another. Keys map to CONTENT hashes, so two captures of the same
    // bytes are one target, not an ambiguity.
    const segs = e.id.split(':').pop().split('/').filter(Boolean);
    for (let i = 0; i < segs.length; i += 1) {
      const key = segs.slice(i).join('/').toLowerCase();
      let set = byKey.get(key);
      if (!set) { set = new Set(); byKey.set(key, set); }
      set.add(hash);
    }
    void entry;
  }

  // ---- Q2/Q3/Q5/Q6 over the written candidates
  const formExamples = Object.create(null);
  const deadExamples = [];
  const ambiguousExamples = [];
  const subsetProblemExamples = [];

  for (const consumer of consumers) {
    for (const decl of consumer.decls) {
      if (!decl.urlWritten) c.declsWithNoUrl += 1;
      else if (decl.candidates.length === 0) c.declsWithEmptyList += 1;
      else if (decl.urlIsArray) c.declsWithArray += 1;
      else c.declsWithSingleString += 1;
      if (decl.candidates.length > c.candidatesPerDeclMax) {
        c.candidatesPerDeclMax = decl.candidates.length;
      }

      for (const cand of decl.candidates) {
        c.candidates += 1;
        sweep.bump(c.byForm, cand.form);
        if (!formExamples[cand.form]) formExamples[cand.form] = cand.raw.slice(0, 160);
        sweep.bump(c.byExtension, cand.extension === null ? '(n/a)' : (cand.extension || '(none)'));
        if (cand.hasFragment && cand.fragment) c.withFragment += 1;
        else if (cand.hasFragment) c.withEmptyFragment += 1;
        else c.withoutFragment += 1;
        if (cand.percentEncoded) c.percentEncoded += 1;
        if (cand.query !== null) c.withQuery += 1;

        // ---- Q5: the GENEROUS retrieval probe (never a resolution rule).
        const keys = sweep.probeKeys(cand);
        if (!keys.length) { c.probeNotProbeable += 1; continue; }
        let hit = null;
        let hitKey = null;
        for (const key of keys) {
          const set = byKey.get(key);
          if (set && set.size) { hit = set; hitKey = key; break; }
        }
        if (!hit) {
          c.probeNotFound += 1;
          if (deadExamples.length < 25) {
            deadExamples.push({ from: consumer.id, name: decl.name, raw: cand.raw.slice(0, 160) });
          }
          continue;
        }
        if (hit.size > 1) {
          c.probeResolvedAmbiguous += 1;
          if (ambiguousExamples.length < 25) {
            ambiguousExamples.push({
              from: consumer.id, name: decl.name, raw: cand.raw.slice(0, 160), distinctTargets: hit.size,
            });
          }
          continue;
        }
        c.probeResolvedUnique += 1;
        // case agreement, reported separately from resolvability
        const exact = sweep.probeKeys(cand).includes(hitKey)
          && cand.locatorPath.toLowerCase().endsWith(hitKey);
        if (exact && cand.locatorPath.endsWith(hitKey)) c.probeCaseExact += 1;
        else c.probeCaseDiffered += 1;

        // ---- Q6: the 4.9.2 subset check against the single found target.
        const targetHash = [...hit][0];
        const target = index.get(targetHash);
        if (!target) continue;
        const wanted = cand.fragment || target.firstSelectable;
        if (!wanted) continue;
        const targetMembers = target.protoInterfaces[wanted];
        if (!targetMembers) {
          c.subsetTargetHasNoSuchProto += 1;
          continue;
        }
        c.subsetChecked += 1;
        const problems = subsetCheck(decl.iface.names, targetMembers);
        if (!problems.length) { c.subsetSatisfied += 1; continue; }
        if (problems.some((p) => p.kind === 'member-missing')) c.subsetMemberMissing += 1;
        if (problems.some((p) => p.kind === 'type-mismatch')) c.subsetTypeMismatch += 1;
        if (problems.some((p) => p.kind === 'access-differs')) c.subsetAccessMismatch += 1;
        if (subsetProblemExamples.length < 25) {
          subsetProblemExamples.push({
            from: consumer.id,
            name: decl.name,
            target: `${firstId.get(targetHash)}#${wanted}`,
            problems: problems.slice(0, 6),
          });
        }
      }
    }
  }

  // ---- arithmetic reconciliation. A partition that does not sum is a bug in
  // the measurement, and the exit code says so rather than a footnote.
  const failures = [];
  const formSum = Object.values(c.byForm).reduce((a, b) => a + b, 0);
  if (formSum !== c.candidates) failures.push(`form partition ${formSum} != candidates ${c.candidates}`);
  const fragSum = c.withFragment + c.withEmptyFragment + c.withoutFragment;
  if (fragSum !== c.candidates) failures.push(`fragment partition ${fragSum} != candidates ${c.candidates}`);
  const probeSum = c.probeResolvedUnique + c.probeResolvedAmbiguous + c.probeNotFound + c.probeNotProbeable;
  if (probeSum !== c.candidates) failures.push(`probe partition ${probeSum} != candidates ${c.candidates}`);

  const report = {
    lane: 'WD1.7-A',
    policy: sweep.GENEROUS_PROBE_POLICY,
    input: {
      discoveredPaths: discovered.entries.length,
      sweptPaths: entries.length,
      fingerprint: discovered.fingerprint,
      groups: discovered.groups.map((g) => ({
        id: g.id, present: g.present, discovered: g.discovered, inRepo: g.inRepo,
      })),
    },
    counters: c,
    formExamples,
    deadExamples,
    ambiguousExamples,
    subsetProblemExamples,
    controls: controlReport,
    reconciliation: { ok: failures.length === 0, failures },
  };

  fs.mkdirSync(opts.out, { recursive: true });
  fs.writeFileSync(path.join(opts.out, 'evidence.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(opts.out, 'metrics.md'), renderMetrics(report));
  log(`wrote ${path.join(opts.out, 'evidence.json')}`);
  log(renderMetrics(report));

  if (failures.length) {
    for (const f of failures) console.error(`RECONCILIATION FAILED: ${f}`);
    process.exitCode = 1;
  }
}

function declCountFor(consumers, hash) {
  for (let i = consumers.length - 1; i >= 0; i -= 1) {
    if (consumers[i].hash === hash) return consumers[i].decls.length;
  }
  return 0;
}

function pct(n, d) {
  if (!d) return 'n/a';
  return `${((n / d) * 100).toFixed(2)}% (${n}/${d})`;
}

function renderMetrics(r) {
  const c = r.counters;
  const lines = [];
  lines.push('# WD1.7-A -- EXTERNPROTO corpus evidence', '');
  lines.push(`Input fingerprint: \`${r.input.fingerprint}\``);
  lines.push(`Discovered paths: ${r.input.discoveredPaths} · swept: ${r.input.sweptPaths}`, '');
  lines.push('## Q1 -- reach', '');
  lines.push(`- unique decoded documents: ${c.uniqueDocs} (read errors ${c.readErrors})`);
  lines.push(`- unique docs declaring EXTERNPROTO: ${pct(c.uniqueDocsWithExternProto, c.uniqueDocs)}`);
  lines.push(`- raw paths declaring EXTERNPROTO: ${pct(c.rawPathsWithExternProto, c.rawPaths)}`);
  lines.push(`- EXTERNPROTO declarations (unique docs): ${c.externProtoDeclsUniqueDocs}`);
  lines.push(`- EXTERNPROTO declarations (raw paths): ${c.externProtoDecls}`);
  lines.push(`- written URL candidates: ${c.candidates} (max per decl ${c.candidatesPerDeclMax})`);
  lines.push(`- decls: array ${c.declsWithArray} · single string ${c.declsWithSingleString} · empty list ${c.declsWithEmptyList} · no url ${c.declsWithNoUrl}`, '');
  lines.push('## Q2 -- reference forms (denominator: candidates)', '');
  lines.push('| form | count | share | example |', '|---|---:|---:|---|');
  for (const k of Object.keys(c.byForm).sort()) {
    lines.push(`| \`${k}\` | ${c.byForm[k]} | ${pct(c.byForm[k], c.candidates)} | \`${(r.formExamples[k] || '').replace(/\|/g, '\\|')}\` |`);
  }
  lines.push('', '## Q3 -- fragment usage (denominator: candidates)', '');
  lines.push(`- with \`#name\` fragment: ${pct(c.withFragment, c.candidates)}`);
  lines.push(`- with empty \`#\`: ${c.withEmptyFragment}`);
  lines.push(`- without fragment (positional 4.9.3 rule decides): ${pct(c.withoutFragment, c.candidates)}`);
  lines.push(`- percent-encoded: ${c.percentEncoded} · with query string: ${c.withQuery}`);
  lines.push('', '| locator extension | count |', '|---|---:|');
  for (const k of Object.keys(c.byExtension).sort()) lines.push(`| \`${k}\` | ${c.byExtension[k]} |`);
  lines.push('', '## Q4 -- does "excluding EXTERNPROTOs" change the answer?', '');
  lines.push(`- unique docs with >=1 top-level PROTO: ${pct(c.docsWithTopLevelProto, c.uniqueDocs)}`);
  lines.push(`- docs whose FIRST prototype statement is an EXTERNPROTO but which also`);
  lines.push(`  declare a PROTO (so the exclusion changes the selected name):`);
  lines.push(`  ${pct(c.docsWhereExcludingExternProtoMatters, c.docsWithTopLevelProto)}`);
  lines.push('', '## Q5 -- generous retrieval probe (UPPER BOUND, not resolution)', '');
  if (r.input.sweptPaths < r.input.discoveredPaths) {
    lines.push('');
    lines.push(`> **CAPPED RUN -- Q5 and Q6 are NOT comparable to a full run.** The probe`);
    lines.push(`> index is built from the same ${r.input.sweptPaths} swept paths, so a target`);
    lines.push(`> that exists in the other ${r.input.discoveredPaths - r.input.sweptPaths} discovered paths`);
    lines.push('> counts as "not found". Only a full sweep bounds dead references.');
    lines.push('');
  }
  lines.push(`- unique target found: ${pct(c.probeResolvedUnique, c.candidates)}`);
  lines.push(`- AMBIGUOUS (>1 semantically distinct target): ${pct(c.probeResolvedAmbiguous, c.candidates)}`);
  lines.push(`- not found anywhere in the archive: ${pct(c.probeNotFound, c.candidates)}`);
  lines.push(`- not probeable (no path segments, e.g. \`urn:\`): ${pct(c.probeNotProbeable, c.candidates)}`);
  lines.push(`- of the unique hits: case-exact ${c.probeCaseExact} · case differed ${c.probeCaseDiffered}`);
  lines.push('', '## Q6 -- ISO 4.9.2 subset check (LOCAL must be a subset of TARGET)', '');
  lines.push(`- target found but named PROTO absent from it: ${c.subsetTargetHasNoSuchProto}`);
  lines.push(`- checked: ${c.subsetChecked}`);
  lines.push(`- subset satisfied: ${pct(c.subsetSatisfied, c.subsetChecked)}`);
  lines.push(`- declared member MISSING from target (4.9.2 error): ${pct(c.subsetMemberMissing, c.subsetChecked)}`);
  lines.push(`- declared member type MISMATCH (4.9.2 error): ${pct(c.subsetTypeMismatch, c.subsetChecked)}`);
  lines.push(`- declared member ACCESS differs (ISO silent -- reported, not judged): ${pct(c.subsetAccessMismatch, c.subsetChecked)}`);
  lines.push('', '## Q7 -- compression signalling (denominator: raw paths)', '');
  lines.push(`- gzip by magic bytes: ${pct(c.gzipByMagic, c.rawPaths)}`);
  lines.push(`- gzip-signalling extension (.wrz/.gz/.x3dz): ${pct(c.gzipExtension, c.rawPaths)}`);
  lines.push(`- **gzip content behind a plain \`.wrl\` name**: ${pct(c.gzipMagicButPlainExtension, c.rawPaths)}`);
  lines.push(`- plain content behind a gzip name: ${pct(c.plainMagicButGzipExtension, c.rawPaths)}`);
  lines.push('', `Reconciliation: ${r.reconciliation.ok ? 'OK' : `FAILED -- ${r.reconciliation.failures.join('; ')}`}`);
  lines.push(`Controls: ${r.controls.passed}/${r.controls.total} fired`, '');
  return lines.join('\n');
}

if (require.main === module) main();
module.exports = { renderMetrics };
