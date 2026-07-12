'use strict';
// VRML97 AST node model + tree helpers (Phase 7A).
//
// The AST is deliberately profile-neutral and renderer-neutral: it describes the
// syntax of a VRML97 file, nothing about X_ITE, Mall Fit, or a single validator.
// Every node carries a `range` {start,end} span so diagnostics, an outline,
// go-to-definition, and safe targeted edits all anchor to exact source.
//
// Nodes are plain objects with a `type` discriminator (the NODE constants below)
// -- no classes, so they serialize cleanly and are cheap to construct. Factory
// helpers exist mostly to keep field names consistent; construct-by-literal is
// equally valid.

// AST node type discriminators.
const NODE = Object.freeze({
  DOCUMENT: 'Document',
  HEADER: 'Header',
  NODE: 'Node', // a node instance: NodeType { ... }  (with optional DEF name)
  USE: 'Use',
  FIELD: 'Field', // fieldName value  (inside a node body)
  IS: 'Is', // fieldName IS interfaceName
  ROUTE: 'Route',
  PROTO: 'Proto',
  EXTERNPROTO: 'ExternProto',
  INTERFACE: 'InterfaceDecl', // field/eventIn/eventOut/exposedField declaration
  // value nodes
  BOOL: 'Bool',
  NUMBER: 'Number',
  STRING: 'String',
  NULL: 'Null',
  NUMBERS: 'Numbers', // a bare run of >=1 numbers (SFVec*/SFRotation/MFFloat...)
  ARRAY: 'Array', // a bracketed [ ... ] MF value
});

// Merge two spans into one that covers both (a.start .. b.end). Either may be
// null; returns the non-null one, or null when both are null.
function mergeRange(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return { start: a.start, end: b.end };
}

// Depth-first pre-order walk. `visit(node, parent)` is called for every AST node
// object encountered (anything with a string `type`). Arrays and plain values are
// traversed transparently. Returning `false` from visit prunes that subtree.
function walk(node, visit, parent = null) {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, parent);
    return;
  }
  if (typeof node.type === 'string') {
    if (visit(node, parent) === false) return;
    parent = node;
  }
  // for..in (not Object.keys) avoids allocating a throwaway key array per node;
  // AST nodes are plain object literals with no inherited enumerable props, so
  // enumeration order and membership are identical. walk() runs over the whole
  // tree once per consumer (analyze's two passes, asset-refs), so this is hot.
  for (const key in node) {
    if (key === 'range' || key === 'type' || key === 'leadingTrivia') continue;
    const v = node[key];
    if (v && typeof v === 'object') walk(v, visit, parent);
  }
}

// --- factory helpers (thin; keep field naming consistent) ---

const document = (header, statements, range) => ({ type: NODE.DOCUMENT, header, statements, range });
const header = (version, encoding, comment, range) => ({ type: NODE.HEADER, version, encoding, comment, range });
const use = (name, nameRange, range) => ({ type: NODE.USE, name, nameRange, range });
const isBinding = (name, nameRange, range) => ({ type: NODE.IS, name, nameRange, range });
const boolVal = (value, range) => ({ type: NODE.BOOL, value, range });
const numberVal = (value, numeric, valid, lexeme, range) => ({ type: NODE.NUMBER, value, numeric, valid, lexeme, range });
const stringVal = (value, raw, range) => ({ type: NODE.STRING, value, raw, range });
const nullVal = (range) => ({ type: NODE.NULL, range });
const numbers = (values, range) => ({ type: NODE.NUMBERS, values, range });
const array = (items, range) => ({ type: NODE.ARRAY, items, range });

module.exports = {
  NODE,
  mergeRange,
  walk,
  document,
  header,
  use,
  isBinding,
  boolVal,
  numberVal,
  stringVal,
  nullVal,
  numbers,
  array,
};
