'use strict';
// World Project loader -- the main-process glue that turns a folder or a chosen
// primary .wrl into a scanned project. This is the one module in the world-
// project set that touches the real filesystem (bounded, read-only); everything
// it depends on is injectable so it stays unit-testable without a real tree.
//
// Read-only: it reads sources, sizes, and directory listings. It never writes,
// repairs, copies, renames, or deletes anything.

const fs = require('fs');
const path = require('path');
const { readWrlSource } = require('../preview/wrl-source');
const { buildAssetGraph } = require('./asset-graph');
const { extractUrlValues, isRemote, isInlineScript } = require('./url-fields');

const WRL_EXT = new Set(['.wrl', '.wrz']);
const PREFERRED_NAMES = ['index', 'main', 'world', 'scene'];
const MAX_WRL_FILES = 500;

function isWrl(p) {
  return WRL_EXT.has(path.extname(p).toLowerCase());
}

// Bounded recursive collection of .wrl/.wrz files under a directory.
function defaultCollectWrl(root, cap = MAX_WRL_FILES) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < cap) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (isWrl(e.name)) out.push(p);
    }
  }
  return out;
}

function defaultStatSize(p) {
  try { return fs.statSync(p).size; } catch { return null; }
}

// Detect the primary world file(s) in a project folder. A file is a "root
// candidate" when no other .wrl in the project inlines it. Returns:
//   { candidates: [{ path, relative, bytes, depth, referenced, preferred }],
//     primary, ambiguous, empty }
// - empty        : no .wrl found at all
// - primary set  : exactly one sensible candidate (auto-selected)
// - ambiguous    : more than one root candidate -> caller must ask the user
function detectPrimaries(root, opts = {}) {
  const projectRoot = path.resolve(root);
  const collectWrl = opts.collectWrl || ((r) => defaultCollectWrl(r));
  const readSource = opts.readSource || ((p) => readWrlSource(p));
  const statSize = opts.statSize || defaultStatSize;

  const files = collectWrl(projectRoot).map((p) => path.resolve(p));
  if (files.length === 0) return { candidates: [], primary: null, ambiguous: false, empty: true };

  const fileSet = new Set(files);
  const referenced = new Set();
  for (const f of files) {
    let text;
    try { text = readSource(f).text; } catch { continue; }
    const dir = path.dirname(f);
    for (const v of extractUrlValues(text)) {
      if (isInlineScript(v) || isRemote(v)) continue;
      if (!isWrl(v)) continue;
      const target = path.resolve(dir, v.split('\\').join('/'));
      if (fileSet.has(target)) referenced.add(target);
    }
  }

  const candidates = files
    .filter((f) => !referenced.has(f))
    .map((f) => {
      const rel = path.relative(projectRoot, f).split(path.sep).join('/');
      const depth = rel.split('/').length - 1;
      const base = path.basename(f, path.extname(f)).toLowerCase();
      const folder = path.basename(projectRoot).toLowerCase();
      const preferred = PREFERRED_NAMES.includes(base) || base === folder;
      return { path: f, relative: rel, bytes: statSize(f), depth, referenced: false, preferred };
    })
    .sort((a, b) => (Number(b.preferred) - Number(a.preferred)) || (a.depth - b.depth) || ((b.bytes || 0) - (a.bytes || 0)));

  // No unreferenced file (every .wrl is inlined by another -> a pure cycle or a
  // fully-linked set): fall back to offering every file, ambiguously.
  if (candidates.length === 0) {
    const all = files.map((f) => ({
      path: f,
      relative: path.relative(projectRoot, f).split(path.sep).join('/'),
      bytes: statSize(f),
      depth: path.relative(projectRoot, f).split(path.sep).length - 1,
      referenced: true,
      preferred: false,
    }));
    return { candidates: all, primary: null, ambiguous: all.length > 1, empty: false, primaryDefault: all[0] ? all[0].path : null };
  }

  if (candidates.length === 1) {
    return { candidates, primary: candidates[0].path, ambiguous: false, empty: false };
  }
  return { candidates, primary: null, ambiguous: true, empty: false, primaryDefault: candidates[0].path };
}

// Scan a project: build the enriched asset graph for `primary` within `root`.
// `now` is injectable so tests don't depend on the wall clock.
function scanProject(params, opts = {}) {
  const root = path.resolve(params.root);
  const primary = path.resolve(params.primary);
  const now = opts.now || (() => Date.now());
  const readSource = opts.readSource || ((p) => readWrlSource(p));

  const t0 = now();
  let primaryGzip = false;
  let primaryError = null;
  try {
    primaryGzip = !!readSource(primary).wasGzipped;
  } catch (err) {
    primaryError = String((err && err.message) || err);
  }

  const graph = buildAssetGraph(primary, {
    projectRoot: root,
    readSource: opts.readSource,
    exists: opts.exists,
    listDir: opts.listDir,
    statSize: opts.statSize,
    readHead: opts.readHead,
    maxWrlNodes: opts.maxWrlNodes,
    maxDepth: opts.maxDepth,
  });

  const primaryNode = graph.wrlNodes.find((n) => n.path === primary);
  const primaryUnreadable = primaryError || (primaryNode && primaryNode.unreadable) || null;

  return {
    root,
    primary,
    primaryGzip,
    graph,
    scanMs: now() - t0,
    status: primaryUnreadable ? 'primary-unreadable' : 'ok',
    error: primaryUnreadable,
  };
}

module.exports = { detectPrimaries, scanProject, defaultCollectWrl, isWrl, WRL_EXT };
