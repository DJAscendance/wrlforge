'use strict';
// Editor language model (Phase 7B) -- the single bridge between the native editor
// and the Phase 7A VRML97 tokenizer+parser. It runs ONE parse and derives three
// things the editor needs, all anchored to character offsets (CodeMirror's
// position model):
//
//   * highlight spans   (from tokens + comments + a light AST role pass)
//   * diagnostics       (SYNTAX only -- authoritative)
//   * advisories        (SEMANTIC -- flat-scope, NON-authoritative, shown apart)
//   * outline           (top-level nodes / DEF / PROTO / ROUTE from the AST)
//
// There is deliberately NO second grammar or regex language mode: the existing
// `src/vrml` parser is the sole authority. This module is pure (text in, spans
// out) and unit-tests in Node; the CodeMirror wiring lives in browser/editor-view.js.

const vrml = require('../vrml');
const { walk } = require('../vrml/ast');

// Token type -> highlight class. Punctuation braces/brackets get a class so a
// theme can tint them; everything else falls back to the lexical kind.
const TOKEN_CLASS = {
  header: 'header',
  keyword: 'keyword',
  bool: 'bool',
  string: 'string',
  number: 'number',
  id: 'identifier',
  lbrace: 'bracket',
  rbrace: 'bracket',
  lbracket: 'bracket',
  rbracket: 'bracket',
  period: 'punct',
};

// A handful of keywords read better as their own class (DEF/USE/ROUTE anchor the
// scene graph); the rest stay generic 'keyword'. Purely cosmetic.
const KEYWORD_CLASS = {
  DEF: 'def',
  USE: 'use',
  ROUTE: 'route',
  PROTO: 'proto',
  EXTERNPROTO: 'proto',
  IS: 'is',
  NULL: 'null',
};

// Build offset -> role overrides from the AST so identifier tokens can be shown
// as node types vs. field names vs. DEF/USE names -- still the parser's view of
// the tree, not a separate grammar. Keyed by the token's start offset.
function idRoleOverrides(tree) {
  const roles = new Map();
  if (!tree) return roles;
  const mark = (range, cls) => {
    if (range && range.start) roles.set(range.start.offset, cls);
  };
  walk(tree, (node) => {
    switch (node.type) {
      case 'Node':
        mark(node.typeRange, 'nodeType');
        if (node.defRange) mark(node.defRange, 'defName');
        break;
      case 'Field':
      case 'InterfaceDecl':
        mark(node.nameRange, 'fieldName');
        break;
      case 'Use':
        mark(node.nameRange, 'useName');
        break;
      default:
        break;
    }
  });
  return roles;
}

function tokenClass(tok, roles) {
  if (tok.type === 'keyword') return KEYWORD_CLASS[tok.keyword] || 'keyword';
  if (tok.type === 'number' && tok.valid === false) return 'invalid';
  if (tok.type === 'id') {
    const override = roles.get(tok.range.start.offset);
    if (override) return override;
  }
  return TOKEN_CLASS[tok.type] || null;
}

// Convert a parser diagnostic's {start,end} offset span to a CodeMirror {from,to},
// clamped into [0, docLength] with to >= from so a zero-width span at EOF still
// renders (CodeMirror requires from < to for a mark; we widen to a 1-char caret).
function spanOf(range, docLength) {
  const from = Math.max(0, Math.min(range.start.offset, docLength));
  let to = Math.max(0, Math.min(range.end.offset, docLength));
  if (to <= from) to = Math.min(from + 1, docLength);
  return { from, to };
}

function mapDiagnostic(d, docLength) {
  const { from, to } = spanOf(d.range, docLength);
  return {
    from,
    to,
    severity: d.severity === 'warning' ? 'warning' : 'error',
    message: d.message,
    code: d.code,
    line: d.range.start.line,
    column: d.range.start.column,
  };
}

// Outline entry from an AST node, recursively including nested child nodes down
// to `maxDepth`. Tolerates partial/incomplete nodes (missing type, no body).
function outlineEntry(node, depth, maxDepth) {
  const range = node.range || null;
  const at = range ? { from: range.start.offset, to: range.end.offset, line: range.start.line } : null;
  if (node.type === 'Node') {
    const label = node.def ? `DEF ${node.def} ${node.nodeType || '?'}` : (node.nodeType || '?');
    const entry = { kind: 'node', label, def: node.def || null, ...at, children: [] };
    if (depth < maxDepth) {
      for (const field of node.fields || []) {
        collectChildNodes(field.value, depth + 1, maxDepth, entry.children);
      }
    }
    return entry;
  }
  if (node.type === 'Proto') return { kind: 'proto', label: `PROTO ${node.name || '?'}`, ...at, children: [] };
  if (node.type === 'ExternProto') return { kind: 'externproto', label: `EXTERNPROTO ${node.name || '?'}`, ...at, children: [] };
  if (node.type === 'Route') {
    const f = node.from || {}; const t = node.to || {};
    return { kind: 'route', label: `ROUTE ${f.node || '?'}.${f.event || '?'} → ${t.node || '?'}.${t.event || '?'}`, ...at, children: [] };
  }
  return null;
}

// A field value may be a single node, an array of items, or a scalar; pull the
// child nodes (for outline nesting) out of whichever it is.
function collectChildNodes(value, depth, maxDepth, into) {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'Node') {
    const e = outlineEntry(value, depth, maxDepth);
    if (e) into.push(e);
  } else if (value.type === 'Array') {
    for (const item of value.items || []) collectChildNodes(item, depth, maxDepth, into);
  }
}

function buildOutline(tree, maxDepth = 6) {
  if (!tree || !tree.statements) return [];
  const out = [];
  for (const stmt of tree.statements) {
    const e = outlineEntry(stmt, 0, maxDepth);
    if (e) out.push(e);
  }
  return out;
}

// analyze(text, opts) -> { highlights, diagnostics, advisories, outline, meta }.
//   highlights  : [{ from, to, cls }]  (tokens + comments + AST id roles)
//   diagnostics : [{ from, to, severity, message, code, line, column }]  (SYNTAX)
//   advisories  : same shape, SEMANTIC (flat-scope, non-authoritative)
//   outline     : nested entries with source ranges
//   meta        : { truncated, depthCapped }
function analyze(text, opts = {}) {
  const docLength = text.length;
  const res = vrml.parse(text, opts);
  const roles = idRoleOverrides(res.tree);

  const highlights = [];
  for (const tok of res.tokens) {
    if (tok.type === 'eof') continue;
    const cls = tokenClass(tok, roles);
    if (cls) highlights.push({ from: tok.range.start.offset, to: tok.range.end.offset, cls });
  }
  for (const c of res.comments) {
    highlights.push({ from: c.range.start.offset, to: c.range.end.offset, cls: 'comment' });
  }
  highlights.sort((a, b) => a.from - b.from);

  return {
    highlights,
    diagnostics: res.syntaxDiagnostics.map((d) => mapDiagnostic(d, docLength)),
    advisories: res.semanticDiagnostics.map((d) => mapDiagnostic(d, docLength)),
    outline: buildOutline(res.tree),
    meta: { truncated: !!res.truncated, depthCapped: !!res.depthCapped },
  };
}

module.exports = { analyze, buildOutline, TOKEN_CLASS, KEYWORD_CLASS };
