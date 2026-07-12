'use strict';
// Read-only World Project recon CLI. No Electron, no rendering -- it only
// decompresses and lexically scans .wrl sources to report an asset graph.
//
//   node qa/world-recon/cli.js <root-world.wrl> [--json] [--max-nodes=N] [--max-depth=N]
//
// Default output is a human summary; --json emits the full graph for tooling.

const path = require('path');
const { buildAssetGraph } = require('./asset-graph');

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
    else pos.push(a);
  }
  return { flags, pos };
}

function main() {
  const { flags, pos } = parseArgs(process.argv.slice(2));
  const root = pos[0];
  if (!root) {
    console.error('usage: node qa/world-recon/cli.js <root-world.wrl> [--json] [--max-nodes=N] [--max-depth=N]');
    process.exit(2);
  }
  const opts = {};
  if (flags['max-nodes']) opts.maxWrlNodes = Number(flags['max-nodes']);
  if (flags['max-depth']) opts.maxDepth = Number(flags['max-depth']);

  const g = buildAssetGraph(root, opts);

  if (flags.json) {
    process.stdout.write(JSON.stringify(g, null, 2) + '\n');
    return;
  }

  const rel = (p) => path.relative(path.dirname(g.root), p) || path.basename(p);
  console.log(`World recon: ${g.root}`);
  console.log(`  .wrl files walked : ${g.stats.wrlFiles}${g.truncated ? ' (TRUNCATED at cap)' : ''}`);
  console.log(`  max nesting depth : ${g.stats.maxDepthSeen}${g.depthCapped ? ' (depth-capped)' : ''}`);
  console.log(`  unique assets     : ${g.stats.uniqueAssets}  ${JSON.stringify(g.stats.byKind)}`);
  console.log(`  total references  : ${g.stats.totalRefs}`);
  console.log(`  inline scripts    : ${g.stats.inlineScripts}`);
  console.log(`  remote references : ${g.stats.remoteRefs}`);
  console.log(`  MISSING           : ${g.stats.missing}`);
  console.log(`  CASE MISMATCHES   : ${g.stats.caseMismatches}`);
  if (g.missing.length) {
    console.log('\n  Missing references:');
    for (const m of g.missing.slice(0, 50)) console.log(`    - ${rel(m.path)}  (${m.kind}, ${m.refCount}x, from ${m.referencedBy.map(rel).join(', ')})`);
    if (g.missing.length > 50) console.log(`    ... and ${g.missing.length - 50} more`);
  }
  if (g.caseMismatches.length) {
    console.log('\n  Case mismatches (server-case-sensitive hazard):');
    for (const c of g.caseMismatches.slice(0, 50)) console.log(`    - referenced ${rel(c.referenced)} but on disk ${rel(c.actual)}`);
  }
  if (g.remoteRefs.length) {
    console.log('\n  Remote references (surfaced, not followed):');
    for (const r of [...new Set(g.remoteRefs.map((x) => x.url))].slice(0, 50)) console.log(`    - ${r}`);
  }
}

main();
