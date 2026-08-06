'use strict';
// VRML97 source map (Phase WD1.1): offset -> token / AST-node lookup.
//
// PURE and READ-ONLY. Text in the form of an existing parse result goes in;
// lookups come out. This module never mutates the AST, the tokens, or the parse
// result, never touches the filesystem or Electron, and never re-scans source
// text -- every answer comes from the exact `range` spans the tokenizer and
// parser already recorded (src/vrml/tokenizer.js, src/vrml/ast.js).
//
// It exists so a later lane can turn a click in a scene tree or a 3D viewport
// into an exact source span, and a cursor position into the node it sits in.
// WD1.1 builds only the read side; nothing here edits, patches, or writes.
//
// ---------------------------------------------------------------------------
// CONVENTIONS a WD2 implementer needs
// ---------------------------------------------------------------------------
//
// OFFSETS are zero-based indices into the DECODED JavaScript string that was
// parsed -- the same units the tokenizer's `range.start.offset` uses, and the
// same units CodeMirror 6 uses. They are NOT byte offsets: a multi-byte UTF-8
// character advances the offset by its UTF-16 code-unit length, not its byte
// length. Gzip is decompressed long before parsing (src/preview/wrl-source.js),
// so an offset always refers to plain text.
//
// RANGES are HALF-OPEN: [start.offset, end.offset). An offset equal to a span's
// `end` is NOT inside it -- it is the first offset of whatever follows. This is
// what makes boundary lookups unambiguous: at the exact seam between two
// adjacent tokens, precisely one of them contains the offset. `inclusiveEnd`
// opts into a closed [start, end] fallback where an editor wants "the thing the
// cursor just left" (see tokenAt).
//
// TRIVIA (whitespace, VRML's comma-as-whitespace, and comments) is not a token.
// The tokenizer attaches it to the FOLLOWING token as `leadingTrivia`, with the
// file's trailing trivia landing on the EOF token. `tokenAt` therefore defaults
// to `trivia: 'none'` -- an offset inside whitespace or a comment belongs to no
// token and returns null. Pass `trivia: 'following'` to resolve such an offset
// to the token the trivia is attached to. Trivia is not an AST node either, so
// `nodeAt` on an offset inside a comment returns the innermost node whose range
// spans that comment (usually the enclosing Node or the Document).
//
// DEEPEST-NODE selection is deterministic: among all AST nodes whose range
// contains the offset, the winner is the one with the greatest tree depth; ties
// break to the narrowest range, then to the earliest pre-order position. Ties
// do not arise in a well-formed parse (ranges nest strictly -- verified across
// every fixture in the repo), but a recovered parse is not assumed to be
// well-formed, so the rule is total rather than merely usually-right.
//
// STRUCTURAL PATHS from `pathTo` are DESCRIPTIVE FOR THE CURRENT PARSE ONLY.
// They describe where a node sits in the tree that produced them; they are not
// identities. This module deliberately provides NO persistent identity and NO
// re-anchoring across edits: after any text change the parse result is stale and
// every path taken from it must be discarded. Stable identity across edits is a
// separate, harder problem (WD1.4 / `node-path.js`) with its own prototype gate.

const { walk } = require('./ast');

// Keys ast.walk does not descend into. Mirrored here so `pathTo` can name the
// property holding a child using exactly the traversal rules that produced the
// parent/child relationship in the first place.
const SKIPPED_KEYS = new Set(['range', 'type', 'leadingTrivia']);

const TRIVIA_MODES = new Set(['none', 'following']);

const copyPosition = (p) => ({ offset: p.offset, line: p.line, column: p.column });

const hasSpan = (value) => !!(value && value.range && value.range.start && value.range.end
  && Number.isFinite(value.range.start.offset) && Number.isFinite(value.range.end.offset));

/**
 * Build a read-only offset index over an existing parse result.
 *
 * @param {object} parseResult A result from `require('./src/vrml').parse(text)`
 *   or from `./parser`.parse(text) -- anything carrying `{ tree, tokens }`. The
 *   result is read, never modified, and never retained beyond the returned map.
 * @returns {object} A frozen source map (see the methods below).
 */
function createSourceMap(parseResult) {
  if (!parseResult || typeof parseResult !== 'object') {
    throw new TypeError('createSourceMap(parseResult): expected a parse result object');
  }
  const tokens = Array.isArray(parseResult.tokens) ? parseResult.tokens : [];
  const tree = parseResult.tree && typeof parseResult.tree === 'object' ? parseResult.tree : null;

  // --- token index -----------------------------------------------------------
  // Tokens are already a flat, source-ordered, non-overlapping array, so a sorted
  // lookup array is the natural structure rather than an optimization. `fullStart`
  // is where the token's leading trivia begins; `lexStart`/`lexEnd` bound its own
  // lexeme. Both are needed because the two trivia modes measure from different
  // points.
  const spans = [];
  for (const tok of tokens) {
    if (!hasSpan(tok)) continue;
    const lexStart = tok.range.start.offset;
    const trivia = tok.leadingTrivia;
    const first = trivia && trivia.length ? trivia[0] : null;
    spans.push({
      token: tok,
      fullStart: first && hasSpan(first) ? first.range.start.offset : lexStart,
      lexStart,
      lexEnd: tok.range.end.offset,
    });
  }

  // Index of the last span whose fullStart <= offset, or -1. `fullStart` is
  // non-decreasing because tokens are emitted in source order.
  function searchSpans(offset) {
    let lo = 0;
    let hi = spans.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (spans[mid].fullStart <= offset) { found = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return found;
  }

  // --- node index ------------------------------------------------------------
  // Built with ast.walk so the node set and pre-order are IDENTICAL to every
  // other src/vrml consumer (analyze, asset-refs). Depth and parent come from
  // walk's own parent argument -- pre-order guarantees a parent is recorded
  // before its children.
  const nodes = [];
  const meta = new Map(); // node -> { depth, parent, order }
  if (tree) {
    walk(tree, (node, parent) => {
      const parentMeta = parent ? meta.get(parent) : null;
      meta.set(node, {
        depth: parentMeta ? parentMeta.depth + 1 : 0,
        parent: parentMeta ? parent : null,
        order: nodes.length,
      });
      nodes.push(node);
    });
  }

  const validOffset = (offset) => Number.isInteger(offset) && offset >= 0;

  // The deterministic deepest-node rule, applied over whichever containment test
  // is passed in (half-open, or the closed-end fallback).
  //
  // A flat scan rather than a descent through the tree: a descent would be faster
  // but only correct if child ranges always nest inside their parent's, and a
  // RECOVERED parse is not guaranteed to be well formed. The scan costs a numeric
  // comparison per node (~0.03 ms on the 652-node/70-texture World fixture), which
  // is far below a click or a debounce, so correctness wins here. If hover-rate
  // lookups on a much larger document ever prove this too slow, MEASURE first and
  // add an interval index -- do not assume nesting.
  function deepestMatching(contains) {
    let best = null;
    let bestMeta = null;
    let bestWidth = 0;
    for (const node of nodes) {
      if (!hasSpan(node)) continue;
      const start = node.range.start.offset;
      const end = node.range.end.offset;
      if (!contains(start, end)) continue;
      const m = meta.get(node);
      const width = end - start;
      if (best === null
        || m.depth > bestMeta.depth
        || (m.depth === bestMeta.depth && width < bestWidth)
        || (m.depth === bestMeta.depth && width === bestWidth && m.order < bestMeta.order)) {
        best = node;
        bestMeta = m;
        bestWidth = width;
      }
    }
    return best;
  }

  /**
   * The token at `offset`.
   *
   * Half-open by default: an offset equal to a token's end belongs to whatever
   * follows, not to that token.
   *
   * @param {number} offset Zero-based offset into the parsed text. A negative,
   *   fractional, NaN or out-of-range offset returns null rather than throwing.
   * @param {object} [options]
   * @param {'none'|'following'} [options.trivia='none'] `'none'`: only a token's
   *   own lexeme counts, so offsets inside whitespace/commas/comments return
   *   null. `'following'`: leading trivia resolves to the token it is attached
   *   to, and trailing trivia at end of file resolves to the EOF token.
   * @param {boolean} [options.inclusiveEnd=false] When nothing contains the
   *   offset half-open, also accept a token whose lexeme ends exactly at it.
   *   Half-open matches always win, so this only ever fills a gap.
   * @returns {object|null} The tokenizer's own token object (do not mutate it).
   */
  function tokenAt(offset, options) {
    const opts = options || {};
    const trivia = opts.trivia === undefined ? 'none' : opts.trivia;
    if (!TRIVIA_MODES.has(trivia)) {
      throw new TypeError(`tokenAt: options.trivia must be 'none' or 'following', got ${JSON.stringify(trivia)}`);
    }
    if (!validOffset(offset)) return null;

    const idx = searchSpans(offset);
    if (idx < 0) return null;

    const span = spans[idx];
    const start = trivia === 'following' ? span.fullStart : span.lexStart;
    if (offset >= start && offset < span.lexEnd) return span.token;
    if (!opts.inclusiveEnd) return null;

    // Closed-end fallback. Only two candidates can end exactly at `offset`: the
    // span the search landed on, and the one before it (the search lands on a
    // later, zero-width span -- EOF -- when the offset sits at end of file).
    for (const j of [idx, idx - 1]) {
      if (j < 0) continue;
      const s = spans[j];
      if (s.lexEnd === offset && s.lexEnd > s.lexStart) return s.token;
    }
    return null;
  }

  /**
   * The deepest AST node whose range contains `offset`.
   *
   * Half-open by default. Returns null when no node contains the offset -- which
   * happens at end of file (the Document's range is half-open too), for offsets
   * in whitespace preceding the `#VRML` header (the Document begins AT the
   * header), and for any invalid offset.
   *
   * @param {number} offset Zero-based offset into the parsed text.
   * @param {object} [options]
   * @param {boolean} [options.inclusiveEnd=false] When nothing contains the
   *   offset half-open, also accept nodes ending exactly at it, again choosing
   *   the deepest.
   * @returns {object|null} An AST node from the parse result (do not mutate it).
   */
  function nodeAt(offset, options) {
    if (!validOffset(offset)) return null;
    const hit = deepestMatching((start, end) => offset >= start && offset < end);
    if (hit) return hit;
    if (!(options && options.inclusiveEnd)) return null;
    return deepestMatching((start, end) => end === offset && end > start);
  }

  /**
   * Every AST node enclosing `offset`, ordered DEEPEST FIRST and ending at the
   * Document root -- the ancestry chain of `nodeAt(offset)`.
   *
   * Note the ordering is the reverse of `pathTo`, which reads root-first. Both
   * orders are what their names imply: you look *outward* from an offset, and
   * you describe a path *down to* a node.
   *
   * @param {number} offset Zero-based offset into the parsed text.
   * @param {object} [options] Same options as `nodeAt`.
   * @returns {object[]} Deepest-to-root chain; empty when nothing contains the offset.
   */
  function nodesAt(offset, options) {
    const deepest = nodeAt(offset, options);
    if (!deepest) return [];
    const chain = [];
    for (let cur = deepest; cur; cur = meta.get(cur).parent) chain.push(cur);
    return chain;
  }

  // Which property of `holder` holds `child`? Mirrors ast.walk's descent (same
  // skipped keys, arrays traversed transparently, untyped holder objects entered)
  // so anything walk reported as a child is addressable. `key` is dotted for the
  // rare child nested inside an untyped holder.
  function findAccessor(holder, child, prefix) {
    for (const key in holder) {
      if (SKIPPED_KEYS.has(key)) continue;
      const value = holder[key];
      if (value === child) return { key: prefix + key, index: null };
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) {
        const at = value.indexOf(child);
        if (at !== -1) return { key: prefix + key, index: at };
        for (let j = 0; j < value.length; j += 1) {
          const item = value[j];
          if (item && typeof item === 'object' && typeof item.type !== 'string') {
            const nested = findAccessor(item, child, `${prefix}${key}[${j}].`);
            if (nested) return nested;
          }
        }
        continue;
      }
      if (typeof value.type !== 'string') {
        const nested = findAccessor(value, child, `${prefix}${key}.`);
        if (nested) return nested;
      }
    }
    return null;
  }

  /**
   * The structural path from the Document root down to `node`, ROOT FIRST.
   *
   * DESCRIPTIVE FOR THIS PARSE ONLY. A path is not an identity and does not
   * survive an edit: there is no `resolve()` here by design, and re-anchoring
   * across reparses belongs to a later lane (WD1.4).
   *
   * Each segment is `{ node, type, key, index, depth }`, where `key` is the
   * parent property holding the node (`'statements'`, `'fields'`, `'value'`,
   * `'items'`, `'body'`, ...) and `index` is its array index or null. The root
   * segment has `key: null, index: null, depth: 0`.
   *
   * @param {object} node A node from this parse result.
   * @returns {object[]|null} Root-to-node segments, or null if `node` is not
   *   part of this parse (a foreign or stale node is rejected, not guessed at).
   */
  function pathTo(node) {
    if (!node || !meta.has(node)) return null;
    const chain = [];
    for (let cur = node; cur; cur = meta.get(cur).parent) chain.push(cur);
    chain.reverse();
    return chain.map((current, depth) => {
      const parent = depth === 0 ? null : chain[depth - 1];
      const accessor = parent ? findAccessor(parent, current, '') : null;
      return {
        node: current,
        type: current.type,
        key: accessor ? accessor.key : null,
        index: accessor ? accessor.index : null,
        depth,
      };
    });
  }

  /**
   * The exact source range of a token or AST node.
   *
   * Returned as a fresh deep copy in the repo's standard range shape, so a
   * caller cannot accidentally mutate the parse result through it.
   *
   * @param {object} value Any token, AST node, or trivia item carrying a `range`.
   * @returns {{start:{offset:number,line:number,column:number},
   *            end:{offset:number,line:number,column:number}}|null}
   *   null when `value` carries no usable range.
   */
  function rangeOf(value) {
    if (!hasSpan(value)) return null;
    return { start: copyPosition(value.range.start), end: copyPosition(value.range.end) };
  }

  return Object.freeze({ tokenAt, nodeAt, nodesAt, pathTo, rangeOf });
}

module.exports = { createSourceMap };
