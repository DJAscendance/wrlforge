'use strict';
// World Project asset-graph resolver (read-only, bounded, cycle-safe).
//
// Promoted, production home of the Phase 3A recon walker
// (qa/world-recon/asset-graph.js now re-exports from here). Given a primary world
// .wrl it walks local references -- following nested Inline `.wrl` children --
// and produces a dependency graph plus per-reference diagnostics:
//   * every referenced local asset (texture / audio / movie / other .wrl / other),
//     resolved relative to the referencing file's own directory,
//   * node type + field name + authored url + project-relative + resolved path,
//   * existence, exact-case, asset kind, byte size, texture dimensions (header),
//   * dependency depth, parent reference, duplicate-reference status,
//   * missing references, case mismatches, remote references (surfaced, not
//     followed), and unsafe references (absolute paths / project-root traversal).
//
// EXTERNPROTO (WD1.7-B2). Url-field extraction is field-NAME anchored, and an
// EXTERNPROTO's URL list has no field name, so external prototype libraries were
// invisible to this graph and could be omitted from a bundle that still reported
// `ready`. They are now discovered from the AST by
// `./externproto-deps.js` and retrieved through the WD1.7-B substrate, and land
// in `externProtos` as their own dependency kind -- NOT folded into `references`
// or `assets`, because an ordered EXTERNPROTO candidate list is a group of
// alternatives, not a set of independent mandatory files. A retrieved artifact's
// OWN references are not walked in this lane: traversal into external prototype
// targets is WD1.7-C's.
//
// Bounded on purpose (inline graphs can be large or cyclic): traversal is capped
// by maxWrlNodes and maxDepth, and a visited-set makes cycles safe. All of the
// source reader, existence, dir listing, size and header read are injectable so
// the whole thing is unit-tested without touching a real world tree.
//
// This is the production resolver. It does NOT import or apply validator.js or
// any Mall Item rules (World Project is a separate profile). It never writes.

const fs = require('fs');
const path = require('path');
const { readWrlSource } = require('../preview/wrl-source');
const { extractUrlRefs } = require('./url-fields');
const { imageSize } = require('./image-size');
const { classifyReference, CATEGORY } = require('./path-policy');
const {
  createProjectResolverContext,
  scanExternProtoDependencies,
  EXTERNPROTO_GROUP_STATUS,
} = require('./externproto-deps');

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

const DEFAULTS = { maxWrlNodes: 200, maxDepth: 12, headBytes: 64 };

function defaultReadHead(p, n) {
  try {
    const fd = fs.openSync(p, 'r');
    try {
      const b = Buffer.alloc(n);
      const read = fs.readSync(fd, b, 0, n, 0);
      return b.subarray(0, read);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function defaultStatSize(p) {
  try { return fs.statSync(p).size; } catch { return null; }
}

// deps (all injectable for tests):
//   readSource(absPath) -> { text }        (default: gzip-transparent readWrlSource)
//   exists(absPath) -> bool                (default: fs.existsSync)
//   listDir(absDir) -> string[]            (default: fs.readdirSync; case checks)
//   statSize(absPath) -> number|null       (default: fs.statSync().size)
//   readHead(absPath, n) -> Buffer|null    (default: first n bytes; texture dims)
//   projectRoot                            (default: dirname of the primary .wrl)
//   externProtoDeps                        (default: real fs; B's injectable
//                                           readdirSync/realpathSync/statSync/
//                                           readFileSync surface, passed straight
//                                           through to the retrieval substrate)
function buildAssetGraph(rootWrlPath, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const readSource = opts.readSource || ((p) => readWrlSource(p));
  const exists = opts.exists || ((p) => fs.existsSync(p));
  const listDir = opts.listDir || ((d) => { try { return fs.readdirSync(d); } catch { return []; } });
  const statSize = opts.statSize || defaultStatSize;
  const readHead = opts.readHead || defaultReadHead;

  const root = path.resolve(rootWrlPath);
  const projectRoot = opts.projectRoot ? path.resolve(opts.projectRoot) : path.dirname(root);

  // ONE retrieval context for the whole project, built from state the project
  // already has. A World Project owns no URL namespace, so the source carries no
  // `prefix` and every absolute-http / URL-root-relative candidate fails closed.
  let externProtoContext = null;
  let externProtoContextError = null;
  try {
    externProtoContext = createProjectResolverContext(projectRoot);
  } catch (err) {
    externProtoContextError = String((err && err.message) || err);
  }

  const externProtos = [];           // { referrer, referrerRelative, depth, ...group }
  const externProtoErrors = [];      // { referrer, referrerRelative, error }
  const wrlNodes = [];               // { path, depth, refs, remoteRefs, bytes, unreadable? }
  const assets = new Map();          // resolvedPath -> { path, kind, refCount, referencedBy, bytes, dimensions, present }
  const edges = [];                  // { from, to, kind }
  const references = [];             // occurrence-level enriched records
  const missingMap = new Map();      // resolvedPath -> { path, kind, refCount, referencedBy }
  const caseMap = new Map();         // resolvedPath -> { referenced, actual, referencedBy }
  const remoteRefs = [];             // { url, referencedBy }
  const unsafeMap = new Map();       // key -> { url, category, referencedBy, resolved }
  const cycles = [];                 // { from, to } wrl edge that closes a loop
  const seenTargets = new Set();     // resolved paths already referenced (duplicate detection)
  const visited = new Set();         // resolved wrl paths already walked
  const parentOf = new Map();        // abs -> parent abs (for ancestry/cycle checks)
  parentOf.set(root, null);

  // Is `candidate` an ancestor of `node` in the Inline nesting chain?
  function isAncestor(node, candidate) {
    let cur = parentOf.has(node) ? parentOf.get(node) : null;
    while (cur) {
      if (cur === candidate) return true;
      cur = parentOf.get(cur);
    }
    return false;
  }
  let inlineScriptCount = 0;
  let malformedCount = 0;
  let viewpointCount = 0;
  let scriptCount = 0;
  let truncated = false;
  let depthCapped = false;

  const relToRoot = (abs) => path.relative(projectRoot, abs).split(path.sep).join('/');

  // Per-directory listing cache (many textures share a folder; avoids re-listing).
  const dirCache = new Map();
  function listDirCached(dir) {
    if (!dirCache.has(dir)) dirCache.set(dir, listDir(dir));
    return dirCache.get(dir);
  }

  // Does `abs` exist AT ITS EXACT CASE, and if not, is there a case-only sibling?
  //
  // Cross-platform note (Phase 6A): we must NOT trust `exists(abs)` alone to mean
  // "present". On a case-INSENSITIVE filesystem (Windows/macOS) `exists('Stone.PNG')`
  // returns true even when the file on disk is `stone.png` -- which would mask a
  // case mismatch that BREAKS on a case-sensitive server. So the authoritative
  // check is the real directory listing (case-preserved on every platform): a
  // reference is `present` only when the directory literally contains that exact
  // basename. A case-only sibling => `case-mismatch`; otherwise `missing`. We only
  // fall back to `exists()` when the directory can't be enumerated.
  function resolveExistence(abs) {
    const dir = path.dirname(abs);
    const base = path.basename(abs);
    const listing = listDirCached(dir);
    if (listing.includes(base)) return { exists: true };
    const ci = listing.find((name) => name.toLowerCase() === base.toLowerCase());
    if (ci) return { exists: false, caseActual: path.join(dir, ci) };
    // Directory unreadable/empty in the listing but the file may still be there
    // (e.g. a permission quirk): defer to exists() so we don't false-flag missing.
    if (listing.length === 0 && exists(abs)) return { exists: true };
    return { exists: false };
  }

  function textureDims(abs, kind) {
    if (kind !== 'texture') return null;
    const head = readHead(abs, cfg.headBytes);
    return head ? imageSize(head) : null;
  }

  const queue = [{ abs: root, depth: 0, parent: null }];
  while (queue.length) {
    const { abs, depth, parent } = queue.shift();
    if (visited.has(abs)) continue;
    visited.add(abs);

    if (wrlNodes.length >= cfg.maxWrlNodes) { truncated = true; break; }

    let text;
    try {
      text = readSource(abs).text;
    } catch (err) {
      wrlNodes.push({ path: abs, depth, parent, unreadable: String((err && err.message) || err), refs: [], remoteRefs: [], bytes: statSize(abs) });
      continue;
    }

    // Scene-info counts for the summary (lexical, advisory).
    viewpointCount += (text.match(/\bViewpoint\b/g) || []).length;
    scriptCount += (text.match(/\bScript\b/g) || []).length;

    const node = { path: abs, depth, parent, refs: [], remoteRefs: [], bytes: statSize(abs) };
    const remoteSeen = new Set();
    const dir = path.dirname(abs);

    // EXTERNPROTO dependencies of THIS file (AST-derived, retrieved through the
    // WD1.7-B substrate). Kept beside the url-field references, never merged
    // into them.
    if (externProtoContext) {
      const ep = scanExternProtoDependencies(
        { text, referrerAbs: abs, projectRoot, context: externProtoContext },
        opts.externProtoDeps || {},
      );
      if (ep.parseError) {
        externProtoErrors.push({ referrer: abs, referrerRelative: relToRoot(abs), error: ep.parseError });
      }
      for (const group of ep.groups) {
        externProtos.push({ referrer: abs, referrerRelative: relToRoot(abs), depth, ...group });
      }
    } else if (externProtoContextError) {
      externProtoErrors.push({ referrer: abs, referrerRelative: relToRoot(abs), error: externProtoContextError });
    }

    for (const ref of extractUrlRefs(text)) {
      const authored = ref.value;
      const cls = classifyReference(authored, dir, projectRoot);
      const rec = {
        referrer: abs,
        referrerRelative: relToRoot(abs),
        nodeType: ref.nodeType,
        field: ref.field,
        authoredUrl: authored,
        category: cls.category,
        remote: cls.remote,
        projectRelative: cls.projectRelative || null,
        resolved: cls.resolved || null,
        kind: null,
        status: null,
        exactCase: null,
        bytes: null,
        dimensions: null,
        depth,
        duplicate: false,
        warnings: [],
      };

      if (cls.category === CATEGORY.INLINE_SCRIPT) {
        inlineScriptCount += 1;
        rec.status = 'inline-script';
        references.push(rec);
        continue;
      }
      if (cls.category === CATEGORY.MALFORMED) {
        malformedCount += 1;
        rec.status = 'malformed';
        rec.warnings.push(cls.note);
        references.push(rec);
        continue;
      }
      if (cls.remote) {
        rec.status = 'remote';
        rec.warnings.push(cls.note);
        if (!remoteSeen.has(authored)) {
          remoteSeen.add(authored);
          node.remoteRefs.push(authored);
          remoteRefs.push({ url: authored, referencedBy: abs, category: cls.category });
        }
        references.push(rec);
        continue;
      }
      if (cls.category === CATEGORY.ABSOLUTE || cls.category === CATEGORY.TRAVERSAL) {
        rec.status = 'unsafe';
        rec.kind = kindOf(cls.resolved || authored);
        rec.warnings.push(cls.note);
        const key = `${abs} ${cls.resolved || authored}`;
        if (!unsafeMap.has(key)) {
          unsafeMap.set(key, { url: authored, category: cls.category, resolved: cls.resolved || null, referencedBy: new Set([abs]) });
        } else {
          unsafeMap.get(key).referencedBy.add(abs);
        }
        references.push(rec);
        continue;
      }

      // LOCAL, resolvable within the project root.
      const target = cls.resolved;
      const kind = kindOf(target);
      rec.kind = kind;
      rec.resolved = target;
      node.refs.push({ url: authored, target, kind });
      edges.push({ from: abs, to: target, kind });

      if (seenTargets.has(target)) rec.duplicate = true;
      seenTargets.add(target);

      const res = resolveExistence(target);
      if (res.exists) {
        rec.status = 'present';
        rec.exactCase = true;
        rec.bytes = statSize(target);
        rec.dimensions = textureDims(target, kind);
      } else if (res.caseActual) {
        rec.status = 'case-mismatch';
        rec.exactCase = false;
        rec.warnings.push(`on disk as ${path.basename(res.caseActual)}`);
        const c = caseMap.get(target) || { referenced: target, actual: res.caseActual, referencedBy: new Set() };
        c.referencedBy.add(abs);
        caseMap.set(target, c);
      } else {
        rec.status = 'missing';
        rec.exactCase = false;
        const mrec = missingMap.get(target) || { path: target, kind, refCount: 0, referencedBy: new Set() };
        mrec.refCount += 1;
        mrec.referencedBy.add(abs);
        missingMap.set(target, mrec);
      }

      if (kind === 'wrl') {
        if (res.exists && (target === abs || isAncestor(abs, target))) {
          rec.warnings.push('dependency cycle');
          cycles.push({ from: abs, to: target });
          references.push(rec);
          continue;
        }
        if (depth + 1 > cfg.maxDepth) { depthCapped = true; references.push(rec); continue; }
        if (res.exists && !visited.has(target)) {
          if (!parentOf.has(target)) parentOf.set(target, abs);
          queue.push({ abs: target, depth: depth + 1, parent: abs });
        }
      } else if (res.exists) {
        // Only a reference that resolves to a real, exact-case file on disk is a
        // "local asset". Missing and case-mismatch targets are tracked in their
        // own diagnostic lists, not counted as present assets (which would
        // inflate the unique-texture count with files that aren't really there).
        const arec = assets.get(target) || {
          path: target, kind, refCount: 0, referencedBy: new Set(),
          bytes: rec.bytes, dimensions: rec.dimensions, present: true,
        };
        arec.refCount += 1;
        arec.referencedBy.add(abs);
        if (arec.bytes == null && rec.bytes != null) arec.bytes = rec.bytes;
        if (arec.dimensions == null && rec.dimensions != null) arec.dimensions = rec.dimensions;
        assets.set(target, arec);
      }
      references.push(rec);
    }
    wrlNodes.push(node);
  }

  const assetList = [...assets.values()].map((a) => ({ ...a, referencedBy: [...a.referencedBy] }));
  const byKind = assetList.reduce((m, a) => ((m[a.kind] = (m[a.kind] || 0) + 1), m), {});
  const missing = [...missingMap.values()].map((m) => ({ ...m, referencedBy: [...m.referencedBy] }));
  const caseMismatches = [...caseMap.values()].map((c) => ({ ...c, referencedBy: [...c.referencedBy] }));
  const unsafe = [...unsafeMap.values()].map((u) => ({ ...u, referencedBy: [...u.referencedBy] }));

  // Approx total project bytes: unique .wrl files + unique present assets.
  let approxTotalBytes = 0;
  for (const n of wrlNodes) if (typeof n.bytes === 'number') approxTotalBytes += n.bytes;
  for (const a of assetList) if (a.present && typeof a.bytes === 'number') approxTotalBytes += a.bytes;

  const uniqueTextures = assetList.filter((a) => a.kind === 'texture').length;
  const duplicateRefs = references.filter((r) => r.duplicate).length;

  return {
    root,
    projectRoot,
    wrlNodes,
    assets: assetList,
    references,
    edges,
    missing,
    caseMismatches,
    remoteRefs,
    unsafe,
    cycles,
    externProtos,
    externProtoErrors,
    truncated,
    depthCapped,
    stats: {
      wrlFiles: wrlNodes.length,
      uniqueAssets: assetList.length,
      uniqueTextures,
      byKind,
      totalRefs: references.length,
      localRefs: edges.length,
      inlineScripts: inlineScriptCount,
      malformed: malformedCount,
      remoteRefs: remoteRefs.length,
      unsafe: unsafe.length,
      missing: missing.length,
      caseMismatches: caseMismatches.length,
      cycles: cycles.length,
      externProtos: externProtos.length,
      externProtoCandidates: externProtos.reduce((n, g) => n + g.candidates.length, 0),
      externProtoRetrievable: externProtos.filter((g) => g.status === EXTERNPROTO_GROUP_STATUS.RETRIEVABLE).length,
      externProtoErrors: externProtoErrors.length,
      duplicateRefs,
      viewpoints: viewpointCount,
      scripts: scriptCount,
      approxTotalBytes,
      maxDepthSeen: wrlNodes.reduce((m, n) => Math.max(m, n.depth), 0),
    },
  };
}

module.exports = { buildAssetGraph, kindOf, DEFAULTS };
