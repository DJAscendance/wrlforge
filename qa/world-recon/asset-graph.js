'use strict';
// World Project asset-graph recon (read-only, bounded, cycle-safe).
//
// Given a root world .wrl, walk its local references -- following nested Inline /
// EXTERNPROTO .wrl files -- and produce a dependency graph plus diagnostics:
//   * every referenced local asset (texture / audio / movie / other), resolved
//     relative to the referencing file's own directory,
//   * missing references (target does not exist on disk),
//   * case mismatches (target exists only under a different case -- would break
//     on a case-sensitive server even though the author's FS is case-insensitive),
//   * remote references (surfaced, not followed).
//
// Bounded on purpose (Phase 3 risk note: inline graphs can be large or cyclic):
// traversal is capped by maxWrlNodes and maxDepth, and a visited-set makes cycles
// safe. All of fs, the source reader, and dir listing are injectable so the whole
// thing is unit-tested without touching a real world tree.
//
// This is RECON tooling, not the production resolver (that is Phase 4). It does
// not import or modify validator.js or any Mall Item rules.

const fs = require('fs');
const path = require('path');
const { readWrlSource } = require('../../src/preview/wrl-source');
const { extractUrlValues, isRemote, isInlineScript } = require('./url-fields');

const WRL_EXT = new Set(['.wrl', '.wrz']);
const TEXTURE_EXT = new Set(['.jpg', '.jpeg', '.gif', '.png', '.bmp', '.tga']);
const AUDIO_EXT = new Set(['.wav', '.mp3', '.mid', '.midi', '.au', '.ogg']);
const MOVIE_EXT = new Set(['.avi', '.mpg', '.mpeg', '.mp4', '.mov']);

function kindOf(p) {
  const e = path.extname(p).toLowerCase();
  if (WRL_EXT.has(e)) return 'wrl';
  if (TEXTURE_EXT.has(e)) return 'texture';
  if (AUDIO_EXT.has(e)) return 'audio';
  if (MOVIE_EXT.has(e)) return 'movie';
  return 'other';
}

const DEFAULTS = { maxWrlNodes: 200, maxDepth: 12 };

// deps (all injectable for tests):
//   readSource(absPath) -> { text }        (default: gzip-transparent readWrlSource)
//   exists(absPath) -> bool                (default: fs.existsSync)
//   listDir(absDir) -> string[]            (default: fs.readdirSync; used for case checks)
function buildAssetGraph(rootWrlPath, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const readSource = opts.readSource || ((p) => readWrlSource(p));
  const exists = opts.exists || ((p) => fs.existsSync(p));
  const listDir = opts.listDir || ((d) => { try { return fs.readdirSync(d); } catch { return []; } });

  const root = path.resolve(rootWrlPath);
  const wrlNodes = [];               // { path, depth, refs, remoteRefs, unreadable? }
  const assets = new Map();          // resolvedPath -> { path, kind, refCount, referencedBy:Set }
  const edges = [];                  // { from, to, kind }
  const missingMap = new Map();      // resolvedPath -> { path, kind, refCount, referencedBy:Set }
  const caseMap = new Map();         // resolvedPath -> { referenced, actual, referencedBy:Set }
  const remoteRefs = [];             // { url, referencedBy }
  const visited = new Set();         // resolved wrl paths already walked
  let inlineScriptCount = 0;
  let truncated = false;
  let depthCapped = false;

  // Does `abs` exist, and if not, is there a case-only sibling that does?
  function resolveExistence(abs) {
    if (exists(abs)) return { exists: true };
    const dir = path.dirname(abs);
    const base = path.basename(abs);
    const hit = listDir(dir).find((name) => name !== base && name.toLowerCase() === base.toLowerCase());
    return hit ? { exists: false, caseActual: path.join(dir, hit) } : { exists: false };
  }

  const queue = [{ abs: root, depth: 0 }];
  while (queue.length) {
    const { abs, depth } = queue.shift();
    if (visited.has(abs)) continue;
    visited.add(abs);

    if (wrlNodes.length >= cfg.maxWrlNodes) { truncated = true; break; }

    let text;
    try {
      text = readSource(abs).text;
    } catch (err) {
      wrlNodes.push({ path: abs, depth, unreadable: String((err && err.message) || err), refs: [] });
      continue;
    }

    // Occurrence-level: every url reference counts (a texture used twice in one
    // file has refCount 2). Remote refs are de-duplicated per file.
    const node = { path: abs, depth, refs: [], remoteRefs: [] };
    const remoteSeen = new Set();
    const dir = path.dirname(abs);
    for (const rel of extractUrlValues(text)) {
      // Inline VRML/JS script code in a Script.url -- not an asset, not a URL.
      if (isInlineScript(rel)) { inlineScriptCount += 1; continue; }
      if (isRemote(rel)) {
        if (!remoteSeen.has(rel)) { remoteSeen.add(rel); node.remoteRefs.push(rel); remoteRefs.push({ url: rel, referencedBy: abs }); }
        continue;
      }
      // VRML url values are POSIX-relative; resolve against the referrer's dir.
      const target = path.resolve(dir, rel.split('\\').join('/'));
      const kind = kindOf(target);
      node.refs.push({ url: rel, target, kind });
      edges.push({ from: abs, to: target, kind });

      const res = resolveExistence(target);
      if (!res.exists) {
        if (res.caseActual) {
          const c = caseMap.get(target) || { referenced: target, actual: res.caseActual, referencedBy: new Set() };
          c.referencedBy.add(abs);
          caseMap.set(target, c);
        } else {
          const mrec = missingMap.get(target) || { path: target, kind, refCount: 0, referencedBy: new Set() };
          mrec.refCount += 1;
          mrec.referencedBy.add(abs);
          missingMap.set(target, mrec);
        }
      }

      if (kind === 'wrl') {
        if (depth + 1 > cfg.maxDepth) { depthCapped = true; continue; }
        if (!visited.has(target)) queue.push({ abs: target, depth: depth + 1 });
      } else {
        const rec = assets.get(target) || { path: target, kind, refCount: 0, referencedBy: new Set() };
        rec.refCount += 1;
        rec.referencedBy.add(abs);
        assets.set(target, rec);
      }
    }
    wrlNodes.push(node);
  }

  const assetList = [...assets.values()].map((a) => ({ ...a, referencedBy: [...a.referencedBy] }));
  const byKind = assetList.reduce((m, a) => ((m[a.kind] = (m[a.kind] || 0) + 1), m), {});
  const missing = [...missingMap.values()].map((m) => ({ ...m, referencedBy: [...m.referencedBy] }));
  const caseMismatches = [...caseMap.values()].map((c) => ({ ...c, referencedBy: [...c.referencedBy] }));

  return {
    root,
    wrlNodes,
    assets: assetList,
    edges,
    missing,
    caseMismatches,
    remoteRefs,
    truncated,
    depthCapped,
    stats: {
      wrlFiles: wrlNodes.length,
      uniqueAssets: assetList.length,
      byKind,
      totalRefs: edges.length,
      inlineScripts: inlineScriptCount,
      missing: missing.length,
      caseMismatches: caseMismatches.length,
      remoteRefs: remoteRefs.length,
      maxDepthSeen: wrlNodes.reduce((m, n) => Math.max(m, n.depth), 0),
    },
  };
}

module.exports = { buildAssetGraph, kindOf, DEFAULTS };
