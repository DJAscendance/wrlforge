'use strict';
// WD1.4 spike -- metrics aggregation and report rendering.
//
// THROWAWAY PROTOTYPE. Pure over its inputs: cases in, aggregates and markdown
// out. Contains NO timing, NO timestamp, and NO absolute path, so its output is
// byte-identical across runs and across machines. Performance numbers live in a
// separate artifact precisely because they are not reproducible.

const { CLASS } = require('./oracle');
const { STRATEGIES, STRATEGY_LABELS } = require('./identity');
const { byCodepoint } = require('./corpus');

const CLASSES = [CLASS.CORRECT, CLASS.SAFE_LOSS, CLASS.AMBIGUOUS, CLASS.WRONG, CLASS.ORACLE_UNRESOLVED];

const emptyTally = () => ({ correct: 0, 'safe-loss': 0, ambiguous: 0, wrong: 0, 'oracle-unresolved': 0, total: 0 });

function bump(tally, klass) {
  tally[klass] += 1;
  tally.total += 1;
  return tally;
}

function slice(map, key) {
  if (!map.has(key)) map.set(key, emptyTally());
  return map.get(key);
}

const pct = (num, den) => (den === 0 ? '     n/a' : `${((num / den) * 100).toFixed(2).padStart(6)}%`);

// Cases whose oracle could not prove an expected node are excluded from every
// rate: counting them as either success or failure would misreport the
// strategy. They are reported separately and never silently dropped.
function rates(tally) {
  const scored = tally.total - tally['oracle-unresolved'];
  return {
    scored,
    provenSuccess: scored === 0 ? null : tally.correct / scored,
    safeRefusal: scored === 0 ? null : (tally['safe-loss'] + tally.ambiguous) / scored,
    wrongRate: scored === 0 ? null : tally.wrong / scored,
  };
}

/**
 * Aggregate every case into per-strategy tallies and slices.
 *
 * @param {object[]} cases Each `{strategy, klass, scenario, nodeType, group,
 *   sizeClass, hasUniqueDef, hasDef, duplicateDef, protoFile, protoScoped,
 *   hyphenDef, unknownNode, recovered, layer}`.
 */
function aggregate(cases) {
  const perStrategy = new Map();
  for (const id of STRATEGIES) {
    perStrategy.set(id, {
      id,
      label: STRATEGY_LABELS[id],
      overall: emptyTally(),
      byScenario: new Map(),
      byNodeType: new Map(),
      byGroup: new Map(),
      bySizeClass: new Map(),
      uniqueDef: emptyTally(),
      nonDef: emptyTally(),
      duplicateDef: emptyTally(),
      protoFile: emptyTally(),
      protoScoped: emptyTally(),
      hyphenDef: emptyTally(),
      unknownNode: emptyTally(),
      recovered: emptyTally(),
      identicalSibling: emptyTally(),
      layers: new Map(),
      unsupportedDescriptor: 0,
    });
  }

  for (const c of cases) {
    const s = perStrategy.get(c.strategy);
    if (!s) continue;
    bump(s.overall, c.klass);
    bump(slice(s.byScenario, c.scenario), c.klass);
    bump(slice(s.byNodeType, c.nodeType), c.klass);
    bump(slice(s.byGroup, c.group), c.klass);
    bump(slice(s.bySizeClass, c.sizeClass), c.klass);
    if (c.hasUniqueDef) bump(s.uniqueDef, c.klass);
    if (!c.hasDef) bump(s.nonDef, c.klass);
    if (c.duplicateDef) bump(s.duplicateDef, c.klass);
    if (c.protoFile) bump(s.protoFile, c.klass);
    if (c.protoScoped) bump(s.protoScoped, c.klass);
    if (c.hyphenDef) bump(s.hyphenDef, c.klass);
    if (c.unknownNode) bump(s.unknownNode, c.klass);
    if (c.recovered) bump(s.recovered, c.klass);
    if (c.identicalSibling) bump(s.identicalSibling, c.klass);
    if (c.unsupported) s.unsupportedDescriptor += 1;
    if (c.layer) {
      const key = `${c.layer}/${c.klass}`;
      s.layers.set(key, (s.layers.get(key) || 0) + 1);
    }
  }
  return perStrategy;
}

const sortedTally = (map, limit) => {
  const rows = [...map.entries()].sort((a, b) => (b[1].total - a[1].total) || byCodepoint(a[0], b[0]));
  return limit ? rows.slice(0, limit) : rows;
};

function serializeTallies(map, limit) {
  return sortedTally(map, limit).map(([key, tally]) => ({ key, ...tally, ...rates(tally) }));
}

/**
 * Turn aggregates into a plain JSON-serializable object. Key order is fixed and
 * every collection is explicitly sorted, so `JSON.stringify` of two runs is
 * byte-comparable.
 */
function serialize(perStrategy) {
  const out = [];
  for (const id of STRATEGIES) {
    const s = perStrategy.get(id);
    out.push({
      id: s.id,
      label: s.label,
      overall: { ...s.overall, ...rates(s.overall) },
      unsupportedDescriptor: s.unsupportedDescriptor,
      uniqueDef: { ...s.uniqueDef, ...rates(s.uniqueDef) },
      nonDef: { ...s.nonDef, ...rates(s.nonDef) },
      duplicateDef: { ...s.duplicateDef, ...rates(s.duplicateDef) },
      protoFile: { ...s.protoFile, ...rates(s.protoFile) },
      protoScoped: { ...s.protoScoped, ...rates(s.protoScoped) },
      hyphenDef: { ...s.hyphenDef, ...rates(s.hyphenDef) },
      unknownNode: { ...s.unknownNode, ...rates(s.unknownNode) },
      recovered: { ...s.recovered, ...rates(s.recovered) },
      identicalSibling: { ...s.identicalSibling, ...rates(s.identicalSibling) },
      byScenario: serializeTallies(s.byScenario),
      byNodeType: serializeTallies(s.byNodeType, 25),
      byGroup: serializeTallies(s.byGroup),
      bySizeClass: serializeTallies(s.bySizeClass),
      layers: [...s.layers.entries()].sort((a, b) => byCodepoint(a[0], b[0]))
        .map(([key, count]) => ({ key, count })),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function table(headers, rows) {
  const lines = [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`];
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}

function tallyRow(label, tally) {
  const r = rates(tally);
  return [
    label,
    String(tally.total),
    String(r.scored),
    String(tally.correct),
    String(tally['safe-loss']),
    String(tally.ambiguous),
    `**${tally.wrong}**`,
    String(tally['oracle-unresolved']),
    r.provenSuccess === null ? 'n/a' : `${(r.provenSuccess * 100).toFixed(1)}%`,
    r.safeRefusal === null ? 'n/a' : `${(r.safeRefusal * 100).toFixed(1)}%`,
  ];
}

const TALLY_HEADERS = ['slice', 'cases', 'scored', 'correct', 'safe-loss', 'ambiguous', 'WRONG', 'oracle-unresolved', 'proven-success', 'safe-refusal'];

function renderStrategySection(s) {
  const lines = [];
  lines.push(`### ${s.label}`);
  lines.push('');
  lines.push(table(TALLY_HEADERS, [
    tallyRow('overall', s.overall),
    tallyRow('selected node has a unique DEF', s.uniqueDef),
    tallyRow('selected node has no DEF', s.nonDef),
    tallyRow('selected node DEF is duplicated', s.duplicateDef),
    tallyRow('file contains PROTO', s.protoFile),
    tallyRow('node inside a PROTO body', s.protoScoped),
    tallyRow('hyphenated DEF name', s.hyphenDef),
    tallyRow('unknown / vendor node type', s.unknownNode),
    tallyRow('recovered (partial) parse', s.recovered),
    tallyRow('node has an identical twin in-file', s.identicalSibling),
  ]));
  lines.push('');
  lines.push('<details><summary>by edit scenario</summary>');
  lines.push('');
  lines.push(table(TALLY_HEADERS, sortedTally(s.byScenario).map(([k, t]) => tallyRow(k, t))));
  lines.push('');
  lines.push('</details>');
  lines.push('');
  lines.push('<details><summary>by corpus group / file size class / node type (top 25)</summary>');
  lines.push('');
  lines.push(table(TALLY_HEADERS, sortedTally(s.byGroup).map(([k, t]) => tallyRow(k, t))));
  lines.push('');
  lines.push(table(TALLY_HEADERS, sortedTally(s.bySizeClass).map(([k, t]) => tallyRow(k, t))));
  lines.push('');
  lines.push(table(TALLY_HEADERS, sortedTally(s.byNodeType, 25).map(([k, t]) => tallyRow(k, t))));
  lines.push('');
  lines.push('</details>');
  return lines.join('\n');
}

module.exports = {
  CLASSES,
  emptyTally,
  bump,
  rates,
  aggregate,
  serialize,
  serializeTallies,
  sortedTally,
  table,
  tallyRow,
  TALLY_HEADERS,
  renderStrategySection,
  pct,
};
