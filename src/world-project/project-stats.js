'use strict';
// Pure summary derivation for the World Project workspace. Turns a scan result
// (asset graph + primary-file metadata) into the flat set of counts the Project
// Summary panel renders. No Electron, no fs.

const { classifyFindings } = require('./profile');

// scan: { root, primary, primaryGzip, graph, scanMs? }
function summarize(scan) {
  const g = scan.graph || { stats: {} };
  const s = g.stats || {};
  return {
    projectRoot: scan.root || null,
    primary: scan.primary || null,
    primarySource: scan.primaryGzip ? 'gzip' : 'plain',
    totalWrlFiles: s.wrlFiles || 0,
    totalReferences: s.totalRefs || 0,
    uniqueTextures: s.uniqueTextures || 0,
    totalLocalAssets: s.uniqueAssets || 0,
    missing: s.missing || 0,
    caseMismatches: s.caseMismatches || 0,
    remoteReferences: s.remoteRefs || 0,
    unsafePaths: s.unsafe || 0,
    dependencyCycles: s.cycles || 0,
    duplicateReferences: s.duplicateRefs || 0,
    inlineScripts: s.inlineScripts || 0,
    approxTotalBytes: s.approxTotalBytes || 0,
    viewpoints: s.viewpoints || 0,
    scripts: s.scripts || 0,
    truncated: !!g.truncated,
    depthCapped: !!g.depthCapped,
    findings: classifyFindings(g),
    scanMs: scan.scanMs != null ? scan.scanMs : null,
  };
}

module.exports = { summarize };
