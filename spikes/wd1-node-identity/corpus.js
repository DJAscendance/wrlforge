'use strict';
// WD1.4 spike -- corpus discovery and inventory.
//
// THROWAWAY PROTOTYPE. Nothing here is production code and nothing in src/
// requires it. It exists to answer one question with real evidence:
//
//   Can a node selection survive reparsing and ordinary edits with ZERO wrong
//   anchors?
//
// This module finds real VRML97 content, reads it through the PRODUCTION gzip
// loader (src/preview/wrl-source.js -- reused, never re-implemented), parses it
// through the PRODUCTION parser (src/vrml), and produces an inventory.
//
// READ-ONLY. It opens files for reading only. It never writes to, moves, copies,
// renames, or deletes a corpus file, and it never copies corpus content into
// this repository. Corpus roots outside the repo are read in place.
//
// DETERMINISM. Directory entries are sorted with an explicit codepoint
// comparator (never localeCompare), traversal order is therefore stable across
// machines and filesystems, and no timestamp or random value enters any result.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORKSPACE_ROOT = path.resolve(REPO_ROOT, '..');

// Production loader: magic-byte gzip detection + inflate + UTF-8 decode.
const { readWrlSource } = require(path.join(REPO_ROOT, 'src', 'preview', 'wrl-source.js'));
const { parse } = require(path.join(REPO_ROOT, 'src', 'vrml'));
const { NODE, walk } = require(path.join(REPO_ROOT, 'src', 'vrml', 'ast.js'));

// ---------------------------------------------------------------------------
// Hard exclusions -- these are safety assertions, not filters
// ---------------------------------------------------------------------------
//
// The WD1.4 brief forbids touching White Dune material and the separate
// modeling-tool reverse-engineering research artifacts. The roots below were
// chosen so neither can be reached, but a path containing any of these markers
// aborts the run rather than being silently skipped: a silent skip would let a
// future root change quietly cross the boundary.
const FORBIDDEN_MARKERS = [
  'white-dune',
  'white_dune',
  'RE-ARTIFACTS',
  'blaxxun-cs-RE',
  'Downloads',
  'node_modules',
];

// Directories never descended into.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', 'dist', 'out', 'build', 'release',
  '.worktrees', '.qa', '.backups', '.reports', 'graphify-out',
]);

// A file is VRML source if it carries one of these suffixes (case-insensitive).
// `.wrl` files may still be gzip-compressed -- the production loader decides by
// magic bytes, not by extension.
const VRML_SUFFIXES = ['.wrl', '.wrz', '.wrl.gz'];

// ---------------------------------------------------------------------------
// Corpus groups
// ---------------------------------------------------------------------------
//
// `label` is what appears in reports. Absolute paths never do: an entry is
// reported as `group:relative/path`, so a committed report carries no private
// machine path. `root` is resolved from the repo location, so the spike does not
// hardcode a home directory.
const GROUP_DEFS = [
  {
    // Independently authored for this lane, living inside the spike directory.
    // `authored: true` means these files are ALWAYS sampled rather than being
    // subject to the deterministic 180-file draw: they exist to cover shapes the
    // real corpus does not contain (scenario S22 found no PROTO-in-MFNode-array
    // anywhere in the sample), so leaving their inclusion to chance would defeat
    // the point. Nothing here is copied from any corpus, archive or third party.
    id: 'spike-authored',
    label: 'WD1.4 spike-authored coverage fixtures',
    root: path.join(__dirname, 'fixtures'),
    inRepo: true,
    authored: true,
  },
  {
    id: 'repo-fixtures',
    label: 'WRL Forge repository test fixtures',
    root: path.join(REPO_ROOT, 'test', 'fixtures'),
    inRepo: true,
  },
  {
    id: 'repo-spike-fixtures',
    label: 'WRL Forge xite-mall-fit spike fixtures',
    root: path.join(REPO_ROOT, 'spikes', 'xite-mall-fit', 'fixtures'),
    inRepo: true,
  },
  {
    id: 'ct-mall-items',
    label: 'Cybertown mall item authoring tree',
    root: path.join(WORKSPACE_ROOT, 'new-items'),
    inRepo: false,
  },
  {
    id: 'ct-web-archive',
    label: 'Cybertown web archive scrape',
    root: path.join(WORKSPACE_ROOT, 'wb-ct-scrape'),
    inRepo: false,
  },
  {
    id: 'ct-mall-archive',
    label: 'Cybertown mall archive',
    root: path.join(WORKSPACE_ROOT, 'ct-mall-archive'),
    inRepo: false,
  },
  {
    id: 'ct-campus',
    label: 'Cybertown campus/colony worlds',
    root: path.join(WORKSPACE_ROOT, 'campuscolony'),
    inRepo: false,
  },
  {
    id: 'ct-ng',
    label: 'Cybertown NG topical collection',
    root: path.join(WORKSPACE_ROOT, 'ctng'),
    inRepo: false,
  },
  {
    id: 'ct-dev-assets',
    label: 'Cybertown dev asset tree',
    root: path.join(WORKSPACE_ROOT, 'ct-dev'),
    inRepo: false,
  },
];

// Explicit codepoint ordering. `Array.prototype.sort` without a comparator is
// already codepoint-ordered for strings, but saying so here makes the
// determinism requirement auditable rather than incidental, and rules out any
// future accidental switch to localeCompare.
function byCodepoint(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function assertAllowed(absPath) {
  for (const marker of FORBIDDEN_MARKERS) {
    if (absPath.includes(marker)) {
      throw new Error(`WD1.4 corpus boundary violation: refusing to touch ${marker} path`);
    }
  }
}

function isVrmlFile(name) {
  const lower = name.toLowerCase();
  return VRML_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

// Deterministic, symlink-refusing directory walk. Symlinks are skipped rather
// than followed so the walk cannot escape its declared root or loop.
function walkDir(root, maxDepth, out) {
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable directory: not an error for a read-only survey
    }
    const names = entries.map((e) => e.name).sort(byCodepoint);
    const byName = new Map(entries.map((e) => [e.name, e]));
    // Push directories in reverse so the stack pops them in sorted order.
    const dirs = [];
    for (const name of names) {
      const entry = byName.get(name);
      const abs = path.join(dir, name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        if (depth >= maxDepth) continue;
        dirs.push({ dir: abs, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isVrmlFile(name)) continue;
      assertAllowed(abs);
      let size = 0;
      try {
        size = fs.statSync(abs).size;
      } catch {
        continue;
      }
      out.push({ abs, size });
    }
    for (let i = dirs.length - 1; i >= 0; i -= 1) stack.push(dirs[i]);
  }
}

/**
 * Discover every VRML file under every configured group root.
 *
 * @param {object} [options]
 * @param {number} [options.maxDepth=12] Directory depth cap per root.
 * @returns {{groups: object[], entries: object[]}} `entries` is globally sorted
 *   by `id` (`group:relpath`), so the order is identical on any machine.
 */
function discover(options = {}) {
  const maxDepth = options.maxDepth === undefined ? 12 : options.maxDepth;
  const groups = [];
  const entries = [];

  for (const def of GROUP_DEFS) {
    assertAllowed(def.root);
    const present = fs.existsSync(def.root);
    const found = [];
    if (present) walkDir(def.root, maxDepth, found);
    const groupEntries = found
      .map((f) => ({
        id: `${def.id}:${path.relative(def.root, f.abs).split(path.sep).join('/')}`,
        group: def.id,
        abs: f.abs,
        size: f.size,
        authored: !!def.authored,
      }))
      .sort((a, b) => byCodepoint(a.id, b.id));
    groups.push({
      id: def.id,
      label: def.label,
      inRepo: def.inRepo,
      authored: !!def.authored,
      present,
      discovered: groupEntries.length,
      bytes: groupEntries.reduce((sum, e) => sum + e.size, 0),
    });
    entries.push(...groupEntries);
  }

  entries.sort((a, b) => byCodepoint(a.id, b.id));
  return { groups, entries };
}

// ---------------------------------------------------------------------------
// Reading, de-duplication and parsing
// ---------------------------------------------------------------------------

const SKIP_REASON = Object.freeze({
  OVER_SIZE_CAP: 'over-size-cap',
  DUPLICATE_CONTENT: 'duplicate-content',
  READ_ERROR: 'read-error',
  GZIP_ERROR: 'gzip-error',
  DECODE_EMPTY: 'decode-empty',
  PARSE_ERROR: 'parse-error',
  BUDGET_EXHAUSTED: 'char-budget-exhausted',
});

// Statistics one parse yields. Kept here (rather than in the identity code) so
// the inventory is computed from the AST alone and shares no logic with any
// candidate strategy.
function summarizeTree(tree) {
  let astNodes = 0;
  let nodeInstances = 0;
  let defCount = 0;
  let useCount = 0;
  let routeCount = 0;
  let protoCount = 0;
  let externProtoCount = 0;
  const defNames = [];
  const typeCounts = new Map();

  if (tree) {
    walk(tree, (node) => {
      astNodes += 1;
      switch (node.type) {
        case NODE.NODE:
          nodeInstances += 1;
          typeCounts.set(node.nodeType, (typeCounts.get(node.nodeType) || 0) + 1);
          if (node.def) { defCount += 1; defNames.push(node.def); }
          break;
        case NODE.USE: useCount += 1; break;
        case NODE.ROUTE: routeCount += 1; break;
        case NODE.PROTO: protoCount += 1; break;
        case NODE.EXTERNPROTO: externProtoCount += 1; break;
        default: break;
      }
    });
  }
  return {
    astNodes, nodeInstances, defCount, useCount, routeCount,
    protoCount, externProtoCount, defNames, typeCounts,
  };
}

/**
 * Interleave entries round-robin across their groups, preserving each group's own
 * deterministic order.
 *
 * This exists because the char budget is spent in iteration order. `discover()`
 * returns entries sorted globally by `group:path`, so a straight pass hands the
 * whole budget to whichever groups sort first: in the first full run `ct-campus`
 * and `ct-mall-archive` consumed all 220 MB and FOUR groups parsed nothing at all
 * -- including both in-repo fixture groups, which the brief names as the starting
 * corpus. Interleaving makes budget exhaustion truncate every group's tail evenly
 * instead of deleting whole groups, and it guarantees a small group (60 repo
 * fixtures) is fully loaded long before the budget runs out.
 *
 * Deterministic: groups in codepoint order, entries already in codepoint order
 * within each group, no dependence on filesystem traversal.
 */
function interleaveByGroup(entries) {
  const byGroup = new Map();
  for (const entry of entries) {
    if (!byGroup.has(entry.group)) byGroup.set(entry.group, []);
    byGroup.get(entry.group).push(entry);
  }
  const groupIds = [...byGroup.keys()].sort(byCodepoint);
  const out = [];
  for (let i = 0; out.length < entries.length; i += 1) {
    for (const gid of groupIds) {
      const list = byGroup.get(gid);
      if (i < list.length) out.push(list[i]);
    }
  }
  return out;
}

/**
 * Read, de-duplicate by content, and parse discovered corpus entries.
 *
 * De-duplication is by SHA-256 of the RAW bytes: the corpus roots overlap
 * heavily (the same world appears in an archive, a scrape, and a working tree),
 * and counting one file three times would inflate every metric in the report.
 * The first entry in the deterministic load order wins; later identical files
 * are recorded as skipped with the id of the entry they duplicate. Because that
 * order is now round-robin across groups (see `interleaveByGroup`), the winner of
 * a cross-group duplicate is spread across groups rather than always falling to
 * the alphabetically-first one.
 *
 * STREAMING. The text and the parse tree of each file are released as soon as
 * its statistics have been taken. Retaining them is not an option: the corpus
 * runs to hundreds of megabytes and tens of millions of AST nodes, which
 * exhausts a default V8 heap long before the survey finishes. Anything that
 * needs a tree again asks `materialize()` for a fresh one.
 *
 * @param {object[]} entries From `discover()`.
 * @param {object} [options]
 * @param {number} [options.maxFileChars] Decoded-length cap per file.
 * @param {number} [options.charBudget] Total decoded characters to parse.
 * @returns {object} `{ files, skipped, globalTypeCounts, budgetExhausted, charsParsed }`.
 */
function load(entries, options = {}) {
  const maxFileChars = options.maxFileChars === undefined ? 4 * 1024 * 1024 : options.maxFileChars;
  const charBudget = options.charBudget === undefined ? 220 * 1024 * 1024 : options.charBudget;

  const files = [];
  const skipped = [];
  const seenHash = new Map();
  const globalTypeCounts = new Map();
  let charsParsed = 0;
  let budgetExhausted = false;

  for (const entry of interleaveByGroup(entries)) {
    if (entry.size > maxFileChars * 2) {
      // Cheap pre-filter on raw size: a file this large cannot decode under the
      // cap unless it is gzip, and the gzip case is caught after inflation.
      if (!/\.(wrz|gz)$/i.test(entry.id)) {
        skipped.push({ id: entry.id, group: entry.group, reason: SKIP_REASON.OVER_SIZE_CAP, bytes: entry.size });
        continue;
      }
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
      skipped.push({
        id: entry.id, group: entry.group, reason: SKIP_REASON.DUPLICATE_CONTENT,
        duplicateOf: seenHash.get(hash),
      });
      continue;
    }
    seenHash.set(hash, entry.id);

    let source;
    try {
      source = readWrlSource(entry.abs);
    } catch (err) {
      skipped.push({ id: entry.id, group: entry.group, reason: SKIP_REASON.GZIP_ERROR, detail: String(err.message).slice(0, 120) });
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

    let result;
    try {
      result = parse(text);
    } catch (err) {
      skipped.push({ id: entry.id, group: entry.group, reason: SKIP_REASON.PARSE_ERROR, detail: String(err.message).slice(0, 120) });
      continue;
    }
    charsParsed += text.length;

    const summary = summarizeTree(result.tree);
    const uniqueDefs = new Set(summary.defNames);
    const duplicateNames = new Set();
    const seenDef = new Set();
    for (const name of summary.defNames) {
      if (seenDef.has(name)) duplicateNames.add(name);
      else seenDef.add(name);
    }
    let hasUnknownNodeType = false;
    for (const [type, count] of summary.typeCounts) {
      globalTypeCounts.set(type, (globalTypeCounts.get(type) || 0) + count);
      if (!VRML97_NODE_TYPES.has(type)) hasUnknownNodeType = true;
    }

    files.push({
      id: entry.id,
      group: entry.group,
      authored: !!entry.authored,
      abs: entry.abs,
      bytes: entry.size,
      chars: text.length,
      wasGzipped: source.wasGzipped,
      // A "recovered" parse is one the parser completed while reporting syntax
      // diagnostics -- a partial tree, which the identity work must handle.
      recovered: result.syntaxDiagnostics.length > 0,
      syntaxDiagnostics: result.syntaxDiagnostics.length,
      truncated: !!result.truncated,
      depthCapped: !!result.depthCapped,
      stats: {
        astNodes: summary.astNodes,
        nodeInstances: summary.nodeInstances,
        defCount: summary.defCount,
        uniqueDefCount: uniqueDefs.size,
        duplicateDefNameCount: duplicateNames.size,
        useCount: summary.useCount,
        routeCount: summary.routeCount,
        protoCount: summary.protoCount,
        externProtoCount: summary.externProtoCount,
        hyphenDefNames: summary.defNames.filter((n) => n.includes('-')).length,
        imageTextureCount: summary.typeCounts.get('ImageTexture') || 0,
        distinctNodeTypes: summary.typeCounts.size,
        hasUnknownNodeType,
      },
    });
  }

  return { files, skipped, globalTypeCounts, budgetExhausted, charsParsed };
}

/**
 * Re-read and re-parse one file record on demand.
 *
 * The counterpart to `load()`'s streaming: a caller that actually needs a tree
 * (the scenario runner, the performance pass) asks for one file at a time and
 * lets it go again. Read-only, and it re-reads through the same production
 * loader, so a gzip corpus file behaves exactly as it does in the app.
 */
function materialize(file) {
  const source = readWrlSource(file.abs);
  return { text: source.text, parse: parse(source.text) };
}

// The set of node type names ISO/IEC 14772-1 defines. Any other node type in a
// document is vendor, historical, or PROTO-declared. Listed here (not imported
// from the generated schema) so the inventory's notion of "unknown node" is a
// plain corpus fact and does not couple the spike to WD1.3's schema shape.
const VRML97_NODE_TYPES = new Set([
  'Anchor', 'Appearance', 'AudioClip', 'Background', 'Billboard', 'Box',
  'Collision', 'Color', 'ColorInterpolator', 'Cone', 'Coordinate',
  'CoordinateInterpolator', 'Cylinder', 'CylinderSensor', 'DirectionalLight',
  'ElevationGrid', 'Extrusion', 'Fog', 'FontStyle', 'Group', 'ImageTexture',
  'IndexedFaceSet', 'IndexedLineSet', 'Inline', 'LOD', 'Material',
  'MovieTexture', 'NavigationInfo', 'Normal', 'NormalInterpolator',
  'OrientationInterpolator', 'PixelTexture', 'PlaneSensor', 'PointLight',
  'PointSet', 'PositionInterpolator', 'ProximitySensor', 'ScalarInterpolator',
  'Script', 'Shape', 'Sound', 'Sphere', 'SphereSensor', 'SpotLight',
  'Switch', 'Text', 'TextureCoordinate', 'TextureTransform', 'TimeSensor',
  'TouchSensor', 'Transform', 'Viewpoint', 'VisibilitySensor', 'WorldInfo',
]);

/**
 * Aggregate a corpus inventory from loaded files. Pure over its inputs.
 */
function inventory(groups, files, skipped, globalTypeCounts) {
  const byGroup = new Map(groups.map((g) => [g.id, {
    id: g.id, label: g.label, inRepo: g.inRepo, authored: !!g.authored, present: g.present,
    discovered: g.discovered, discoveredBytes: g.bytes,
    read: 0, parsed: 0, plain: 0, gzip: 0, recovered: 0, chars: 0,
    astNodes: 0, nodeInstances: 0,
  }]));

  const typeCounts = globalTypeCounts || new Map();
  const skipReasons = new Map();
  let totals = {
    parsed: 0, plain: 0, gzip: 0, recovered: 0, truncated: 0, depthCapped: 0,
    chars: 0, astNodes: 0, nodeInstances: 0,
    defCount: 0, uniqueDefCount: 0, useCount: 0, routeCount: 0,
    filesWithProto: 0, filesWithExternProto: 0, filesWithRoute: 0,
    filesWithDuplicateDefs: 0, duplicateDefNameOccurrences: 0,
    filesWithUnknownNodes: 0, hyphenDefNames: 0, filesWithHyphenDefs: 0,
  };

  for (const s of skipped) {
    skipReasons.set(s.reason, (skipReasons.get(s.reason) || 0) + 1);
  }

  for (const f of files) {
    const g = byGroup.get(f.group);
    g.read += 1; g.parsed += 1; g.chars += f.chars;
    g.astNodes += f.stats.astNodes; g.nodeInstances += f.stats.nodeInstances;
    if (f.wasGzipped) { g.gzip += 1; totals.gzip += 1; } else { g.plain += 1; totals.plain += 1; }
    if (f.recovered) { g.recovered += 1; totals.recovered += 1; }

    totals.parsed += 1;
    totals.chars += f.chars;
    totals.astNodes += f.stats.astNodes;
    totals.nodeInstances += f.stats.nodeInstances;
    totals.defCount += f.stats.defCount;
    totals.uniqueDefCount += f.stats.uniqueDefCount;
    totals.useCount += f.stats.useCount;
    totals.routeCount += f.stats.routeCount;
    if (f.truncated) totals.truncated += 1;
    if (f.depthCapped) totals.depthCapped += 1;
    if (f.stats.protoCount > 0) totals.filesWithProto += 1;
    if (f.stats.externProtoCount > 0) totals.filesWithExternProto += 1;
    if (f.stats.routeCount > 0) totals.filesWithRoute += 1;
    if (f.stats.duplicateDefNameCount > 0) {
      totals.filesWithDuplicateDefs += 1;
      totals.duplicateDefNameOccurrences += f.stats.duplicateDefNameCount;
    }
    if (f.stats.hyphenDefNames > 0) {
      totals.filesWithHyphenDefs += 1;
      totals.hyphenDefNames += f.stats.hyphenDefNames;
    }
    if (f.stats.hasUnknownNodeType) totals.filesWithUnknownNodes += 1;
  }

  const sortedTypes = [...typeCounts.entries()]
    .sort((a, b) => (b[1] - a[1]) || byCodepoint(a[0], b[0]))
    .map(([type, count]) => ({ type, count, standard: VRML97_NODE_TYPES.has(type) }));

  const largestByBytes = [...files]
    .sort((a, b) => (b.chars - a.chars) || byCodepoint(a.id, b.id))
    .slice(0, 10)
    .map((f) => ({ id: f.id, chars: f.chars, astNodes: f.stats.astNodes }));

  const largestByNodes = [...files]
    .sort((a, b) => (b.stats.astNodes - a.stats.astNodes) || byCodepoint(a.id, b.id))
    .slice(0, 10)
    .map((f) => ({ id: f.id, chars: f.chars, astNodes: f.stats.astNodes }));

  return {
    groups: [...byGroup.values()],
    totals,
    skipReasons: [...skipReasons.entries()].sort((a, b) => byCodepoint(a[0], b[0]))
      .map(([reason, count]) => ({ reason, count })),
    nodeTypes: sortedTypes,
    unknownNodeTypes: sortedTypes.filter((t) => !t.standard),
    largestByBytes,
    largestByNodes,
  };
}

// File size classes used to slice results in the report.
function sizeClass(chars) {
  if (chars < 4 * 1024) return 'tiny(<4KB)';
  if (chars < 32 * 1024) return 'small(<32KB)';
  if (chars < 256 * 1024) return 'medium(<256KB)';
  if (chars < 1024 * 1024) return 'large(<1MB)';
  return 'huge(>=1MB)';
}

module.exports = {
  REPO_ROOT,
  WORKSPACE_ROOT,
  GROUP_DEFS,
  SKIP_REASON,
  VRML97_NODE_TYPES,
  byCodepoint,
  discover,
  interleaveByGroup,
  load,
  materialize,
  inventory,
  sizeClass,
  summarizeTree,
};
