'use strict';
// WD1.5 spike -- corpus discovery and scope inventory.
//
// READ-ONLY. Opens files for reading only. Never writes, moves, copies, renames
// or deletes a corpus file, and never copies corpus content into this
// repository. Corpus roots outside the repo are read in place.
//
// DISCOVERY IS NOT REIMPLEMENTED. The committed WD1.4 spike already solved
// deterministic, boundary-guarded, symlink-refusing, group-interleaved discovery
// over exactly the roots this lane is told to use. This module `require`s it
// read-only and adds only what WD1.5 needs -- a scope-oriented inventory. The
// WD1.4 spike is not modified, and nothing here writes into it.
//
// BOUNDARY. WD1.4's `FORBIDDEN_MARKERS` guard (white-dune, white_dune,
// RE-ARTIFACTS, blaxxun-cs-RE, Downloads, node_modules) is inherited by using
// its `discover()`. `assertAllowed` below is a second, independent check on
// every path this module opens, so a future change to either side cannot
// silently widen the boundary.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const wd14 = require(path.join(REPO_ROOT, 'spikes', 'wd1-node-identity', 'corpus.js'));
const { readWrlSource } = require(path.join(REPO_ROOT, 'src', 'preview', 'wrl-source.js'));
const { parse } = require(path.join(REPO_ROOT, 'src', 'vrml'));
const scopeModel = require('./scope-model');

const FORBIDDEN_MARKERS = [
  'white-dune', 'white_dune', 'RE-ARTIFACTS', 'blaxxun-cs-RE', 'Downloads', 'node_modules',
];

function assertAllowed(absPath) {
  for (const marker of FORBIDDEN_MARKERS) {
    if (String(absPath).includes(marker)) {
      throw new Error(`WD1.5 corpus boundary violation: refusing to touch ${marker} path`);
    }
  }
}

const SKIP_REASON = Object.freeze({
  OVER_SIZE_CAP: 'over-size-cap',
  DUPLICATE_CONTENT: 'duplicate-content',
  READ_ERROR: 'read-error',
  GZIP_ERROR: 'gzip-error',
  DECODE_EMPTY: 'decode-empty',
  PARSE_ERROR: 'parse-error',
  SCOPE_ERROR: 'scope-build-error',
  BUDGET_EXHAUSTED: 'char-budget-exhausted',
});

const { STATUS, REFERENCE_KIND, SYMBOL_KIND, SCOPE_KIND } = scopeModel;

// Characters that are legal in a WRL Forge identifier but would be surprising in
// hand-authored strict content. Reported, never rejected.
const UNUSUAL_ID = /[^A-Za-z0-9_+-]/;

function bump(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

/**
 * Summarise one document's scope graph. Pure: takes a parse result and a graph,
 * returns counters. Shares no logic with the resolver it is measuring.
 */
function summarize(parseResult, graph) {
  const s = {
    defs: 0,
    uses: 0,
    routes: 0,
    protoDecls: 0,
    externProtoDecls: 0,
    nestedProtoDecls: 0,
    protoBodyScopes: 0,
    interfaceDecls: 0,
    scriptInterfaceDecls: 0,
    isRefs: 0,
    nodeTypeRefs: 0,
    protoInstances: 0,
    unknownNodeTypes: 0,
    duplicateDefNamesInScope: 0,
    hyphenIdentifiers: 0,
    slashIdentifiers: 0,
    unusualIdentifiers: 0,
    scopeKeyCollisionCandidates: 0,
    nodeTypeRecoveredFromVrml1: 0,
    nodeTypeRecoveredFromVrml2: 0,
    recoveredScopes: 0,
    documentIncomplete: parseResult.truncated || parseResult.depthCapped ? 1 : 0,
    recovered: parseResult.syntaxDiagnostics.length > 0 ? 1 : 0,
  };

  // Header version matters more than it looks. `.wrl` is also the extension of
  // VRML 1.0, a DIFFERENT language (Separator/fields, not Group/exposedField),
  // which a VRML97 parser cannot read and must not pretend to. Counting these
  // separately keeps a handful of wrong-language files from being read as
  // evidence that the VRML97 parser recovers badly.
  const headerVersion = parseResult.tree && parseResult.tree.header
    ? parseResult.tree.header.version : null;
  s.headerVrml1 = headerVersion === 'V1.0' ? 1 : 0;
  s.headerVrml2 = headerVersion === 'V2.0' ? 1 : 0;
  s.headerOtherOrMissing = (headerVersion === 'V1.0' || headerVersion === 'V2.0') ? 0 : 1;
  s.recoveredVrml2 = (s.headerVrml2 === 1 && s.recovered === 1) ? 1 : 0;
  s.recoveredVrml1 = (s.headerVrml1 === 1 && s.recovered === 1) ? 1 : 0;
  const byStatus = new Map();
  const byReason = new Map();
  const compat = new Map();
  const findings = new Map();

  for (const scope of graph.scopes) {
    if (scope.recovered) s.recoveredScopes += 1;
    if (scope.kind === SCOPE_KIND.PROTO_BODY) s.protoBodyScopes += 1;
    for (const [, list] of scope.defs) if (list.length > 1) s.duplicateDefNamesInScope += 1;
  }
  for (const sym of graph.symbols) {
    switch (sym.kind) {
      case SYMBOL_KIND.NODE_DEF: s.defs += 1; break;
      case SYMBOL_KIND.PROTO_DECL: s.protoDecls += 1; break;
      case SYMBOL_KIND.EXTERNPROTO_DECL: s.externProtoDecls += 1; break;
      case SYMBOL_KIND.PROTO_INTERFACE_MEMBER: s.interfaceDecls += 1; break;
      case SYMBOL_KIND.SCRIPT_INTERFACE_MEMBER: s.scriptInterfaceDecls += 1; break;
      default: break;
    }
    if (sym.kind === SYMBOL_KIND.PROTO_DECL) {
      const scope = graph.scope(sym.scopeId);
      if (scope && scope.kind === SCOPE_KIND.PROTO_BODY) s.nestedProtoDecls += 1;
    }
    if (typeof sym.name === 'string') {
      if (sym.name.includes('-')) s.hyphenIdentifiers += 1;
      if (sym.name.includes('/')) s.slashIdentifiers += 1;
      if (UNUSUAL_ID.test(sym.name)) s.unusualIdentifiers += 1;
    }
  }
  // A "scope-key collision candidate" is a PROTO whose own name contains a
  // character a naive joined scope key might use as a separator. WD1.4 proved
  // this class produces real wrong anchors when scopes are identified by string.
  for (const sym of graph.symbols) {
    if (sym.kind !== SYMBOL_KIND.PROTO_DECL) continue;
    if (typeof sym.name === 'string' && /[/\\.:|>#]/.test(sym.name)) s.scopeKeyCollisionCandidates += 1;
  }
  for (const ref of graph.references) {
    switch (ref.kind) {
      case REFERENCE_KIND.USE: s.uses += 1; break;
      case REFERENCE_KIND.IS: s.isRefs += 1; break;
      case REFERENCE_KIND.NODE_TYPE: s.nodeTypeRefs += 1; break;
      case REFERENCE_KIND.ROUTE_NODE: s.routes += 0.5; break;
      default: break;
    }
  }
  s.routes = Math.round(s.routes);
  for (const res of graph.resolutions) {
    bump(byStatus, `${res.kind}/${res.status}`);
    bump(byReason, `${res.kind}/${res.reason}`);
    if (res.compat) bump(compat, res.compat);
    if (res.kind === REFERENCE_KIND.NODE_TYPE) {
      if (res.status === STATUS.RESOLVED && res.reason === 'ok') s.protoInstances += 1;
      if (res.reason === 'node-type-unknown') s.unknownNodeTypes += 1;
      if (res.status === STATUS.RECOVERED) {
        if (s.headerVrml1 === 1) s.nodeTypeRecoveredFromVrml1 += 1;
        else s.nodeTypeRecoveredFromVrml2 += 1;
      }
    }
  }
  for (const f of graph.findings) {
    if (f.compat) bump(compat, f.compat);
    if (f.code) bump(findings, f.code);
  }
  return { stats: s, byStatus, byReason, compat, findings };
}

/**
 * Discover, read, de-duplicate, parse and scope-analyse the corpus.
 *
 * Streaming: text, parse tree and scope graph are released as soon as counters
 * are taken. Retaining them exhausts the heap on this corpus.
 *
 * @param {object} [options]
 * @param {number} [options.maxFiles] Cap on analysed files (after de-dup).
 * @param {number} [options.maxFileChars] Decoded-length cap per file.
 * @param {number} [options.charBudget] Total decoded characters to analyse.
 */
function analyseCorpus(options = {}) {
  const maxFiles = options.maxFiles === undefined ? 100000 : options.maxFiles;
  const maxFileChars = options.maxFileChars === undefined ? 4 * 1024 * 1024 : options.maxFileChars;
  const charBudget = options.charBudget === undefined ? 1024 * 1024 * 1024 : options.charBudget;

  const { groups, entries } = wd14.discover();
  const ordered = wd14.interleaveByGroup(entries);

  // The corpus roots are external workspace trees that change independently of
  // this repository, so the INPUT set is not frozen even though the analysis is
  // deterministic. This fingerprint makes drift visible: if it changes, the
  // totals legitimately changed with it, and a byte-comparison of two runs taken
  // either side of the drift is meaningless rather than a determinism failure.
  // Observed for real during this lane -- 14,204 discovered files became 14,205
  // between two runs.
  const fingerprint = crypto.createHash('sha256')
    .update(entries.map((e) => `${e.id}:${e.size}`).join('\n'))
    .digest('hex');

  const files = [];
  const skipped = [];
  const seenHash = new Map();
  const totals = new Map();
  const byStatus = new Map();
  const byReason = new Map();
  const compat = new Map();
  const findings = new Map();
  const perGroup = new Map();
  let charsParsed = 0;
  let budgetExhausted = false;
  let fileCapReached = false;

  for (const entry of ordered) {
    if (files.length >= maxFiles) { fileCapReached = true; break; }
    assertAllowed(entry.abs);

    if (entry.size > maxFileChars * 2 && !/\.(wrz|gz)$/i.test(entry.id)) {
      skipped.push({ id: entry.id, group: entry.group, reason: SKIP_REASON.OVER_SIZE_CAP });
      continue;
    }
    let raw;
    try {
      raw = fs.readFileSync(entry.abs);
    } catch (err) {
      skipped.push({ id: entry.id, group: entry.group, reason: SKIP_REASON.READ_ERROR, detail: err.code || 'unknown' });
      continue;
    }
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    if (seenHash.has(hash)) {
      skipped.push({ id: entry.id, group: entry.group, reason: SKIP_REASON.DUPLICATE_CONTENT, duplicateOf: seenHash.get(hash) });
      continue;
    }
    seenHash.set(hash, entry.id);

    let source;
    try {
      source = readWrlSource(entry.abs);
    } catch (err) {
      skipped.push({ id: entry.id, group: entry.group, reason: SKIP_REASON.GZIP_ERROR, detail: String(err.message).slice(0, 100) });
      continue;
    }
    const text = source.text;
    if (!text || text.length === 0) {
      skipped.push({ id: entry.id, group: entry.group, reason: SKIP_REASON.DECODE_EMPTY });
      continue;
    }
    if (text.length > maxFileChars) {
      skipped.push({ id: entry.id, group: entry.group, reason: SKIP_REASON.OVER_SIZE_CAP, chars: text.length });
      continue;
    }
    if (charsParsed + text.length > charBudget) {
      budgetExhausted = true;
      skipped.push({ id: entry.id, group: entry.group, reason: SKIP_REASON.BUDGET_EXHAUSTED, chars: text.length });
      continue;
    }

    let parseResult;
    try {
      parseResult = parse(text);
    } catch (err) {
      skipped.push({ id: entry.id, group: entry.group, reason: SKIP_REASON.PARSE_ERROR, detail: String(err.message).slice(0, 100) });
      continue;
    }
    let graph;
    try {
      graph = scopeModel.buildScopeGraph(parseResult);
    } catch (err) {
      skipped.push({ id: entry.id, group: entry.group, reason: SKIP_REASON.SCOPE_ERROR, detail: String(err.message).slice(0, 100) });
      continue;
    }
    charsParsed += text.length;

    const summary = summarize(parseResult, graph);
    const differential = compareWithProductionAnalyzer(parseResult, graph);

    for (const [k, v] of Object.entries(summary.stats)) bump(totals, k, v);
    for (const [k, v] of summary.byStatus) bump(byStatus, k, v);
    for (const [k, v] of summary.byReason) bump(byReason, k, v);
    for (const [k, v] of summary.compat) bump(compat, k, v);
    for (const [k, v] of summary.findings) bump(findings, k, v);
    for (const [k, v] of differential) bump(totals, `diff.${k}`, v);

    if (!perGroup.has(entry.group)) perGroup.set(entry.group, { files: 0, chars: 0 });
    const g = perGroup.get(entry.group);
    g.files += 1;
    g.chars += text.length;

    files.push({ id: entry.id, group: entry.group, chars: text.length, recovered: summary.stats.recovered === 1 });
  }

  return {
    groups, files, skipped, totals, byStatus, byReason, compat, findings, perGroup,
    charsParsed, budgetExhausted, fileCapReached,
    discovered: entries.length,
    fingerprint,
  };
}

/**
 * Differential: where does the CURRENT production analyzer disagree with the
 * prototype? Read-only on both sides; neither is treated as ground truth here --
 * these are counted observations, and the authored cases decide who is right.
 */
function compareWithProductionAnalyzer(parseResult, graph) {
  const out = new Map();

  // 1. Production reports a duplicate DEF; the prototype finds the two names in
  //    different scopes (a cross-PROTO false positive).
  const prodDuplicateNames = new Set((parseResult.duplicateDefs || []).map((d) => d.name));
  const scopedDuplicateNames = new Set();
  for (const scope of graph.scopes) {
    for (const [name, list] of scope.defs) if (list.length > 1) scopedDuplicateNames.add(name);
  }
  for (const name of prodDuplicateNames) {
    if (!scopedDuplicateNames.has(name)) bump(out, 'duplicate-def-only-production');
  }
  for (const name of scopedDuplicateNames) {
    if (!prodDuplicateNames.has(name)) bump(out, 'duplicate-def-only-prototype');
  }

  // 2. Production resolves a USE that the prototype refuses, and vice versa.
  //    Production's `uses[].range` spans the whole USE statement; the prototype
  //    anchors on the name token, which starts later. Matched by containment via
  //    binary search over a sorted offset array -- a linear scan per USE is
  //    quadratic on DEF/USE-heavy worlds.
  const useOffsets = [];
  const useByOffset = new Map();
  for (const res of graph.resolutions) {
    if (res.kind !== REFERENCE_KIND.USE) continue;
    const off = res.range && res.range.start ? res.range.start.offset : -1;
    useOffsets.push(off);
    if (!useByOffset.has(off)) useByOffset.set(off, res);
  }
  useOffsets.sort((a, b) => a - b);
  const firstAtOrAfter = (target) => {
    let lo = 0;
    let hi = useOffsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (useOffsets[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo < useOffsets.length ? useOffsets[lo] : null;
  };
  for (const u of parseResult.uses || []) {
    const start = u.range && u.range.start ? u.range.start.offset : -1;
    const end = u.range && u.range.end ? u.range.end.offset : -1;
    const hit = firstAtOrAfter(start);
    const mine = hit != null && hit <= end ? useByOffset.get(hit) : null;
    if (!mine) { bump(out, 'use-unmatched'); continue; }
    const mineOk = mine.status === STATUS.RESOLVED;
    if (u.resolved && !mineOk) bump(out, `use-production-resolves-prototype-${mine.status}`);
    if (!u.resolved && mineOk) bump(out, 'use-prototype-resolves-production-unresolved');
  }

  // 3. ROUTE endpoints. Matched by SOURCE OFFSET, never by array index: the
  //    production analyzer's `routes` come from a generic `ast.walk` while the
  //    prototype's come from a structured traversal, and the two orders diverge
  //    around PROTO bodies. An index-based pairing silently compared unrelated
  //    endpoints and reported 10,888 phantom mismatches on this corpus.
  const routeNodeByOffset = new Map();
  for (const r of graph.resolutions) {
    if (r.kind !== REFERENCE_KIND.ROUTE_NODE) continue;
    const off = r.range && r.range.start ? r.range.start.offset : -1;
    if (!routeNodeByOffset.has(off)) routeNodeByOffset.set(off, r);
  }
  for (const r of parseResult.routes || []) {
    for (const [side, endpoint] of [['From', r.from], ['To', r.to]]) {
      if (!endpoint || !endpoint.nodeRange) continue;
      const mine = routeNodeByOffset.get(endpoint.nodeRange.start.offset);
      if (!mine) { bump(out, 'route-endpoint-unmatched'); continue; }
      const prodOk = !!r[`resolved${side}`];
      const mineOk = mine.status === STATUS.RESOLVED;
      if (prodOk && !mineOk) bump(out, `route-production-resolves-prototype-${mine.status}`);
      if (!prodOk && mineOk) bump(out, 'route-prototype-resolves-production-unresolved');
    }
  }
  return out;
}

module.exports = {
  FORBIDDEN_MARKERS,
  SKIP_REASON,
  assertAllowed,
  analyseCorpus,
  summarize,
  compareWithProductionAnalyzer,
  byCodepoint: wd14.byCodepoint,
};
