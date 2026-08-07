'use strict';
// WD1.5-P2C -- corpus discovery, decoded-content de-duplication, and the
// damage-metric denominators.
//
// READ-ONLY. This module opens files for reading only. It never writes, moves,
// copies, renames or deletes a corpus file, and it never copies corpus content
// into this repository. Corpus roots outside the repo are read in place.
//
// DISCOVERY IS NOT REIMPLEMENTED. The committed WD1.4 spike
// (`spikes/wd1-node-identity/corpus.js`) already solved deterministic,
// boundary-guarded, group-interleaved discovery over exactly the roots this lane
// is told to use, and WD1.5-P1's spike reused it on the same terms. This module
// `require`s it read-only and adds only what P2C needs: decoded-content identity
// and the explicit damage denominators. The WD1.4 spike is not modified and
// nothing here writes into it.
//
// BOUNDARY. WD1.4's `FORBIDDEN_MARKERS` guard (white-dune, white_dune,
// RE-ARTIFACTS, blaxxun-cs-RE, Downloads, node_modules) is inherited by using its
// `discover()`. `assertAllowed` below is a second, independent check applied to
// every path THIS module opens, so a future change to either side cannot
// silently widen the boundary. A forbidden path THROWS -- it is never skipped,
// because a silent skip would let a root change cross the GPL boundary quietly.
//
// DETERMINISM. Entry order is WD1.4's explicit codepoint ordering. No clock, no
// PRNG, no locale collation, and no absolute path enters any emitted record.

const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const wd14 = require(path.join(REPO_ROOT, 'spikes', 'wd1-node-identity', 'corpus.js'));
const { readWrlSource } = require(path.join(REPO_ROOT, 'src', 'preview', 'wrl-source.js'));
const { parse } = require(path.join(REPO_ROOT, 'src', 'vrml'));

const FORBIDDEN_MARKERS = [
  'white-dune', 'white_dune', 'RE-ARTIFACTS', 'blaxxun-cs-RE', 'Downloads', 'node_modules',
];

function assertAllowed(absPath) {
  for (const marker of FORBIDDEN_MARKERS) {
    if (String(absPath).includes(marker)) {
      throw new Error(`WD1.5-P2C corpus boundary violation: refusing to touch ${marker} path`);
    }
  }
}

// ---------------------------------------------------------------------------
// Decoded-content identity -- the canonical de-duplication rule
// ---------------------------------------------------------------------------
//
// THE GZIP TRAP, recorded so it is not re-fallen-into. A `.wrz` and its plain
// `.wrl` twin are DIFFERENT BYTES and IDENTICAL CONTENT. De-duplicating on the
// raw bytes therefore counts the same document twice and inflated an earlier
// sweep's denominator by ~32% (6,264 "unique" files, 323,923 ROUTEs). The
// canonical semantic denominator is UNIQUE BY DECODED SOURCE TEXT: read through
// the production loader FIRST (magic-byte gzip detection + inflate + UTF-8
// decode), and only then take identity.
//
// The fingerprint is SHA-256 over the UTF-8 bytes of the decoded text, hex
// encoded. Two paths share a document identity exactly when their decoded text
// is byte-for-byte equal.
function contentIdentity(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// The INPUT fingerprint, over the discovered file SET rather than its content.
// The corpus roots are external workspace trees that change independently of
// this repository, so a changed number is an INPUT change -- a different thing
// from the analysis being unstable. SHA-256 over `id:size` lines in codepoint
// order, which is WD1.5-P1's recorded convention.
function inputFingerprint(entries) {
  const h = crypto.createHash('sha256');
  for (const e of entries) h.update(`${e.id}:${e.size}\n`);
  return h.digest('hex');
}

// ---------------------------------------------------------------------------
// Damage definitions -- measured in PARALLEL, never collapsed to one number
// ---------------------------------------------------------------------------
//
// The whole point of this table is that "damaged" is not one property. An
// earlier planning harness and the implementation sweep disagreed (576 vs 212
// files, 36,472 vs 11,173 ROUTEs) and the difference was recorded as a
// "measurement-definition difference" WITHOUT the definitions ever being
// proven. So every plausible definition is now computed side by side, over
// BOTH denominators, and the report says which one reproduces which figure.
//
// Each predicate takes a parse result and returns a boolean. `truncated` and
// `depthCapped` are folded into every definition because both mean the parser
// stopped early -- a scope boundary may have moved, which is the only kind of
// damage that can actually manufacture a wrong lexical answer.
const DAMAGE_DEFS = Object.freeze({
  // Syntax diagnostics of severity `error` only. This is the definition the
  // implementation sweep used ("files damaged (>=1 error diagnostic)").
  'syntax-error': (p) => p.truncated || p.depthCapped
    || p.syntaxDiagnostics.some((d) => d.severity === 'error'),
  // ANY syntax diagnostic, whatever its severity -- warnings and advisories too.
  'syntax-any': (p) => p.truncated || p.depthCapped || p.syntaxDiagnostics.length > 0,
  // Any diagnostic at all, INCLUDING the flat semantic advisories from
  // analyze.js (VRML040-VRML044). Those are exactly the non-authoritative
  // advisories WD.md documents, and a harness that treated them as "damage"
  // would mark a very large share of the corpus damaged.
  'any-diagnostic': (p) => p.truncated || p.depthCapped || p.diagnostics.length > 0,
});

const DAMAGE_DEF_NAMES = Object.freeze(Object.keys(DAMAGE_DEFS));

// The damage definition that gates the ORACLE and that the report treats as
// canonical for safety purposes. It is the STRICTEST-fail-closed one: a moved
// scope boundary is what the recovery gate defends against, and only an error,
// a truncation or a depth cap can move one.
const CANONICAL_DAMAGE = 'syntax-error';

function damageFlags(parsed) {
  const out = {};
  for (const name of DAMAGE_DEF_NAMES) out[name] = !!DAMAGE_DEFS[name](parsed);
  return out;
}

// ---------------------------------------------------------------------------
// Streaming traversal
// ---------------------------------------------------------------------------

/**
 * Discover the corpus. Returns WD1.4's `{groups, entries}` plus a fingerprint.
 *
 * Every entry is re-checked against this module's own boundary guard.
 */
function discover(options = {}) {
  const { groups, entries } = wd14.discover(options);
  for (const e of entries) assertAllowed(e.abs);
  return { groups, entries, fingerprint: inputFingerprint(entries) };
}

/**
 * Stream every discovered path, decoding through the production loader and
 * parsing ONCE PER UNIQUE DECODED TEXT.
 *
 * Parsing is a pure function of the text, so a duplicate-content path's parse
 * result is identical by construction. Caching the per-content parse FACTS
 * (damage flags, ROUTE count) and replaying them onto every raw path sharing
 * that content therefore makes the raw-path damage metrics exact rather than
 * estimated -- and keeps the sweep to ~4.5k parses instead of ~14.2k.
 *
 * The callback receives one record per RAW PATH:
 *   { id, group, size, ok, error, contentHash, first, parsed, damage, routeCount }
 * `parsed` is non-null ONLY on the first path of a content group -- the caller
 * owns the tree for the duration of the call and must not retain it. On a
 * duplicate the caller still gets `damage` and `routeCount`, which is all the
 * raw-path denominators need.
 *
 * @param {function} onPath called once per discovered path, in codepoint order
 * @param {object} options `{maxDepth}` forwarded to discovery
 * @returns {object} discovery summary + read/decode counters
 */
function sweepPaths(onPath, options = {}) {
  const discovered = discover(options);
  const { groups, fingerprint } = discovered;
  // `limit` truncates the WORK, not the discovery, so the fingerprint still
  // describes the whole input set and a capped run is visibly a capped run.
  const entries = options.limit
    ? discovered.entries.slice(0, options.limit)
    : discovered.entries;

  // contentHash -> { first: id, damage, routeCount }
  const seen = new Map();

  let read = 0;
  let readErrors = 0;
  const readErrorIds = [];
  let duplicatePaths = 0;

  for (const entry of entries) {
    assertAllowed(entry.abs);
    let text = null;
    try {
      text = readWrlSource(entry.abs).text;
    } catch (err) {
      readErrors += 1;
      // Sanitized: the entry id is `group:relative/path`, never an absolute path.
      readErrorIds.push({ id: entry.id, message: String(err && err.message).slice(0, 200) });
      onPath({
        id: entry.id, group: entry.group, size: entry.size,
        ok: false, error: 'read-error', contentHash: null, first: false,
        parsed: null, damage: null, routeCount: 0,
      });
      continue;
    }
    read += 1;

    const contentHash = contentIdentity(text);
    const prior = seen.get(contentHash);
    if (prior) {
      duplicatePaths += 1;
      onPath({
        id: entry.id, group: entry.group, size: entry.size,
        ok: true, error: null, contentHash, first: false,
        parsed: null, damage: prior.damage, routeCount: prior.routeCount,
      });
      continue;
    }

    let parsed = null;
    try {
      parsed = parse(text);
    } catch (err) {
      readErrors += 1;
      readErrorIds.push({ id: entry.id, message: `parse-throw: ${String(err && err.message).slice(0, 160)}` });
      onPath({
        id: entry.id, group: entry.group, size: entry.size,
        ok: false, error: 'parse-error', contentHash, first: false,
        parsed: null, damage: null, routeCount: 0,
      });
      continue;
    }

    const damage = damageFlags(parsed);
    const routeCount = countRoutes(parsed.tree);
    seen.set(contentHash, { damage, routeCount });

    onPath({
      id: entry.id, group: entry.group, size: entry.size,
      ok: true, error: null, contentHash, first: true,
      parsed, damage, routeCount,
    });
    // Release the tree: the caller was told not to retain it.
    parsed = null;
    text = null;
  }

  return {
    groups,
    fingerprint,
    rawDiscoveredPaths: discovered.entries.length,
    rawPathsConsidered: entries.length,
    rawPathsRead: read,
    rawReadErrors: readErrors,
    readErrorIds,
    duplicateContentPaths: duplicatePaths,
    uniqueDecodedDocuments: seen.size,
  };
}

// A ROUTE count taken from the AST alone, so it shares no logic with the scope
// graph it is a denominator for. ROUTEs nest: 4.10.2 admits them at the top
// level, inside a PROTO body, and inside a node body wherever fields may appear
// (Annex A.3), so this is a full walk rather than a scan of `tree.statements`.
function countRoutes(tree) {
  let n = 0;
  forEachRoute(tree, () => { n += 1; });
  return n;
}

/** Visit every `Route` AST node anywhere in the tree, in source order. */
function forEachRoute(tree, visit) {
  const stack = [tree];
  const found = [];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (Array.isArray(cur)) {
      for (let i = cur.length - 1; i >= 0; i -= 1) stack.push(cur[i]);
      continue;
    }
    if (cur.type === 'Route') found.push(cur);
    for (const key of Object.keys(cur)) {
      if (key === 'range' || key === 'nameRange' || key === 'typeRange'
        || key === 'defRange' || key === 'fieldTypeRange' || key === 'isRange') continue;
      const v = cur[key];
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  // Source order, with an explicit codepoint-free numeric tiebreak on offset.
  found.sort((a, b) => offsetOf(a) - offsetOf(b));
  for (const r of found) visit(r);
}

function offsetOf(node) {
  return (node && node.range && node.range.start && node.range.start.offset) || 0;
}

module.exports = {
  FORBIDDEN_MARKERS,
  DAMAGE_DEFS,
  DAMAGE_DEF_NAMES,
  CANONICAL_DAMAGE,
  assertAllowed,
  contentIdentity,
  inputFingerprint,
  damageFlags,
  discover,
  sweepPaths,
  countRoutes,
  forEachRoute,
  byCodepoint: wd14.byCodepoint,
};
