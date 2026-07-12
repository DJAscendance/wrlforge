'use strict';
// VRML97 structural parser (Phase 7A).
//
// Token-driven recursive descent over the tokenizer's output -- it never re-scans
// source text. Produces a profile-neutral partial syntax tree (see ast.js) with a
// source span on every node, plus recoverable diagnostics.
//
// Design goals:
//   * Recovery-oriented, like a language-server parser: one malformed field/node
//     yields ONE diagnostic and a still-usable partial tree, by resynchronizing at
//     safe boundaries (`}`, `]`, next top-level statement, next field).
//   * Bounded: explicit depth and node-count limits with clear diagnostics; every
//     loop is guaranteed to make progress, so malformed input can never hang.
//   * Separable: pure syntax here; DEF/USE/ROUTE semantics live in analyze.js.

const { tokenize, TT } = require('./tokenizer');
const ast = require('./ast');
const { NODE, mergeRange } = ast;
const { CODE, error, warning } = require('./diagnostics');

const DEFAULT_LIMITS = Object.freeze({ maxDepth: 256, maxNodes: 100000 });

// Thrown internally when a hard node-count limit trips; caught at the top so the
// caller still gets the partial tree collected so far.
class AbortParse extends Error {}

class Parser {
  constructor(tokens, diagnostics, limits) {
    this.toks = tokens;
    this.pos = 0;
    this.diagnostics = diagnostics;
    this.limits = { ...DEFAULT_LIMITS, ...(limits || {}) };
    this.nodeBudget = this.limits.maxNodes;
    this.nodesCapped = false;
    this.depthCapped = false;
  }

  // --- token cursor ---
  peek(k = 0) {
    const idx = this.pos + k;
    return idx < this.toks.length ? this.toks[idx] : this.toks[this.toks.length - 1];
  }
  next() {
    const t = this.peek();
    if (this.pos < this.toks.length - 1) this.pos += 1;
    return t;
  }
  atEof() {
    return this.peek().type === TT.EOF;
  }
  at(kind) {
    return this.peek().type === kind;
  }
  atKeyword(kw) {
    const t = this.peek();
    return t.type === TT.KEYWORD && t.keyword === kw;
  }
  spanTo(startTok) {
    // A span from a start token/node's range through the previously consumed one.
    const prev = this.toks[Math.max(0, this.pos - 1)];
    const startRange = startTok.range || startTok;
    return mergeRange(startRange, (prev && prev.range) || startRange);
  }

  // Consume `kind` or record an "expected" diagnostic (without consuming).
  expect(kind, what) {
    if (this.at(kind)) return this.next();
    const t = this.peek();
    this.diagnostics.push(error(CODE.EXPECTED_TOKEN,
      `Expected ${what} but found ${describe(t)}`, t.range, { expected: what }));
    return null;
  }

  // --- entry ---
  parseDocument() {
    let header = null;
    if (this.at(TT.HEADER)) {
      const t = this.next();
      header = ast.header(t.version, t.encoding, t.lexeme, t.range);
      if (!t.version || !/^V2\.0$/i.test(t.version) || !/^utf8$/i.test(t.encoding || '')) {
        this.diagnostics.push(warning(CODE.INVALID_HEADER,
          `Non-standard VRML header '${t.lexeme.trim()}' (expected '#VRML V2.0 utf8')`, t.range));
      }
    } else {
      this.diagnostics.push(error(CODE.MISSING_HEADER,
        "Missing '#VRML V2.0 utf8' header", this.peek().range, { expected: '#VRML V2.0 utf8' }));
    }

    const statements = [];
    while (!this.atEof()) {
      const before = this.pos;
      const stmt = this.parseTopStatement(0);
      if (stmt) statements.push(stmt);
      if (this.pos === before) this.next(); // guaranteed progress
    }
    const range = { start: header ? header.range.start : (statements[0] ? statements[0].range.start : this.peek().range.start),
      end: this.peek().range.end };
    return ast.document(header, statements, range);
  }

  // A top-level (or PROTO-body) statement: ROUTE / PROTO / EXTERNPROTO / node.
  parseTopStatement(depth) {
    const t = this.peek();
    if (t.type === TT.KEYWORD) {
      switch (t.keyword) {
        case 'ROUTE': return this.parseRoute();
        case 'PROTO': return this.parseProto(depth);
        case 'EXTERNPROTO': return this.parseExternProto(depth);
        case 'DEF': return this.parseNodeStatement(depth);
        case 'USE': return this.parseUse();
        default: break;
      }
    }
    if (t.type === TT.ID) return this.parseNode(depth);
    // Unexpected top-level token.
    this.diagnostics.push(error(CODE.UNEXPECTED_TOKEN,
      `Unexpected ${describe(t)} at top level`, t.range));
    this.next();
    return null;
  }

  // `DEF name node` | `node` -> a Node instance (def optional).
  parseNodeStatement(depth) {
    if (this.atKeyword('DEF')) {
      const defTok = this.next();
      const nameTok = this.at(TT.ID) ? this.next() : null;
      if (!nameTok) {
        this.diagnostics.push(error(CODE.EXPECTED_IDENTIFIER,
          'Expected a name after DEF', this.peek().range, { expected: 'name' }));
      }
      const node = this.parseNode(depth);
      if (node) {
        node.def = nameTok ? nameTok.name : null;
        node.defRange = nameTok ? nameTok.range : null;
        node.range = mergeRange(defTok.range, node.range);
      }
      return node;
    }
    return this.parseNode(depth);
  }

  // NodeType { body }
  parseNode(depth) {
    if (this.nodeBudget-- <= 0) {
      if (!this.nodesCapped) {
        this.nodesCapped = true;
        this.diagnostics.push(error(CODE.MAX_NODES,
          `Node limit (${this.limits.maxNodes}) exceeded; parsing stopped`, this.peek().range));
      }
      throw new AbortParse();
    }
    const typeTok = this.expect(TT.ID, 'a node type name');
    if (!typeTok) return null;

    if (depth > this.limits.maxDepth) {
      if (!this.depthCapped) {
        this.depthCapped = true;
        this.diagnostics.push(error(CODE.MAX_DEPTH,
          `Maximum nesting depth (${this.limits.maxDepth}) exceeded`, typeTok.range));
      }
      this.skipBracedBlock();
      return { type: NODE.NODE, nodeType: typeTok.name, typeRange: typeTok.range,
        def: null, defRange: null, fields: [], interfaces: [], incomplete: true,
        range: this.spanTo(typeTok) };
    }

    const node = { type: NODE.NODE, nodeType: typeTok.name, typeRange: typeTok.range,
      def: null, defRange: null, fields: [], interfaces: [], range: typeTok.range };

    if (!this.at(TT.LBRACE)) {
      // A node type not followed by a body: recoverable (e.g. truncated file).
      this.diagnostics.push(error(CODE.EXPECTED_TOKEN,
        `Expected '{' to open ${typeTok.name} body but found ${describe(this.peek())}`,
        this.peek().range, { expected: '{' }));
      node.incomplete = true;
      return node;
    }
    this.next(); // {

    while (!this.at(TT.RBRACE) && !this.atEof()) {
      const before = this.pos;
      const el = this.parseNodeBodyElement(node, depth);
      if (el && el.type === NODE.INTERFACE) node.interfaces.push(el);
      else if (el) node.fields.push(el);
      if (this.pos === before) {
        // Nothing consumed: report once and resync to a body boundary.
        this.diagnostics.push(error(CODE.UNEXPECTED_TOKEN,
          `Unexpected ${describe(this.peek())} in ${typeTok.name} body`, this.peek().range));
        this.syncInBody();
      }
    }
    if (this.at(TT.RBRACE)) this.next();
    else this.diagnostics.push(error(CODE.UNCLOSED_BRACE,
      `Unclosed '{' for ${typeTok.name}`, typeTok.range, { expected: '}' }));
    node.range = this.spanTo(typeTok);
    return node;
  }

  parseNodeBodyElement(node, depth) {
    const t = this.peek();
    if (t.type === TT.KEYWORD) {
      switch (t.keyword) {
        case 'ROUTE': return this.parseRoute();
        case 'PROTO': return this.parseProto(depth);
        case 'EXTERNPROTO': return this.parseExternProto(depth);
        case 'field':
        case 'eventIn':
        case 'eventOut':
        case 'exposedField':
          return this.parseInterfaceDecl();
        default: break;
      }
    }
    if (t.type === TT.ID) return this.parseField(depth);
    return null; // caller resyncs
  }

  // fieldName value  |  fieldName IS interfaceName
  parseField(depth) {
    const nameTok = this.next(); // ID
    if (this.atKeyword('IS')) {
      this.next();
      const idTok = this.at(TT.ID) ? this.next() : null;
      if (!idTok) {
        this.diagnostics.push(error(CODE.EXPECTED_IDENTIFIER,
          'Expected an interface name after IS', this.peek().range, { expected: 'name' }));
      }
      const binding = ast.isBinding(idTok ? idTok.name : null, idTok ? idTok.range : null,
        this.spanTo(nameTok));
      return { type: NODE.FIELD, name: nameTok.name, nameRange: nameTok.range,
        value: binding, isBinding: true, range: this.spanTo(nameTok) };
    }
    const value = this.parseValue(depth);
    if (value == null) {
      this.diagnostics.push(error(CODE.EXPECTED_FIELD_VALUE,
        `Expected a value for field '${nameTok.name}' but found ${describe(this.peek())}`,
        this.peek().range, { expected: 'field value' }));
    }
    return { type: NODE.FIELD, name: nameTok.name, nameRange: nameTok.range,
      value: value || null, isBinding: false, range: this.spanTo(nameTok) };
  }

  // A field value: array, node, scalar run, string, bool, null, or USE.
  parseValue(depth) {
    const t = this.peek();
    switch (t.type) {
      case TT.LBRACKET: return this.parseArray(depth);
      case TT.STRING: {
        this.next();
        return ast.stringVal(t.value, t.lexeme, t.range);
      }
      case TT.BOOL: {
        this.next();
        return ast.boolVal(t.value, t.range);
      }
      case TT.NUMBER: return this.parseNumberRun();
      case TT.ID: return this.parseNode(depth + 1);
      case TT.KEYWORD:
        if (t.keyword === 'NULL') { this.next(); return ast.nullVal(t.range); }
        if (t.keyword === 'USE') return this.parseUse();
        if (t.keyword === 'DEF') return this.parseNodeStatement(depth + 1);
        return null;
      default:
        return null;
    }
  }

  // A bare run of >=1 consecutive numbers (SFVec*/SFRotation/SFColor/MFFloat...).
  // Arity is intentionally NOT checked here (no field-type schema in 7A).
  parseNumberRun() {
    const first = this.peek();
    const values = [];
    while (this.at(TT.NUMBER)) {
      const t = this.next();
      values.push(ast.numberVal(t.value, t.numeric, t.valid, t.lexeme, t.range));
    }
    return ast.numbers(values, mergeRange(first.range, values[values.length - 1].range));
  }

  parseArray(depth) {
    const open = this.next(); // [
    const items = [];
    while (!this.at(TT.RBRACKET) && !this.atEof()) {
      const before = this.pos;
      const t = this.peek();
      if (t.type === TT.NUMBER) { this.next(); items.push(ast.numberVal(t.value, t.numeric, t.valid, t.lexeme, t.range)); }
      else if (t.type === TT.STRING) { this.next(); items.push(ast.stringVal(t.value, t.lexeme, t.range)); }
      else if (t.type === TT.BOOL) { this.next(); items.push(ast.boolVal(t.value, t.range)); }
      else if (t.type === TT.ID) { const nd = this.parseNode(depth + 1); if (nd) items.push(nd); }
      else if (t.type === TT.LBRACKET) { const arr = this.parseArray(depth + 1); if (arr) items.push(arr); }
      else if (t.type === TT.KEYWORD && t.keyword === 'NULL') { this.next(); items.push(ast.nullVal(t.range)); }
      else if (t.type === TT.KEYWORD && t.keyword === 'USE') { const u = this.parseUse(); if (u) items.push(u); }
      else if (t.type === TT.KEYWORD && t.keyword === 'DEF') { const nd = this.parseNodeStatement(depth + 1); if (nd) items.push(nd); }
      else {
        this.diagnostics.push(error(CODE.UNEXPECTED_TOKEN,
          `Unexpected ${describe(t)} in array`, t.range));
        this.next();
      }
      if (this.pos === before) this.next(); // progress guard
    }
    if (this.at(TT.RBRACKET)) this.next();
    else this.diagnostics.push(error(CODE.UNCLOSED_BRACKET,
      "Unclosed '['", open.range, { expected: ']' }));
    return ast.array(items, this.spanTo(open));
  }

  parseUse() {
    const kw = this.next(); // USE
    const nameTok = this.at(TT.ID) ? this.next() : null;
    if (!nameTok) {
      this.diagnostics.push(error(CODE.EXPECTED_IDENTIFIER,
        'Expected a name after USE', this.peek().range, { expected: 'name' }));
    }
    return ast.use(nameTok ? nameTok.name : null, nameTok ? nameTok.range : null, this.spanTo(kw));
  }

  parseRoute() {
    const kw = this.next(); // ROUTE
    const from = this.parseRouteEndpoint();
    if (this.atKeyword('TO')) this.next();
    else this.diagnostics.push(error(CODE.EXPECTED_TOKEN,
      `Expected 'TO' in ROUTE but found ${describe(this.peek())}`, this.peek().range, { expected: 'TO' }));
    const to = this.parseRouteEndpoint();
    return { type: NODE.ROUTE, from, to, range: this.spanTo(kw) };
  }

  // nodeName.eventName
  parseRouteEndpoint() {
    const nodeTok = this.at(TT.ID) ? this.next() : null;
    if (!nodeTok) {
      this.diagnostics.push(error(CODE.EXPECTED_IDENTIFIER,
        'Expected a node name in ROUTE endpoint', this.peek().range, { expected: 'name' }));
      return { node: null, nodeRange: null, event: null, eventRange: null, range: this.peek().range };
    }
    let event = null;
    let eventRange = null;
    if (this.at(TT.PERIOD)) {
      this.next();
      const evTok = this.at(TT.ID) ? this.next() : null;
      if (evTok) { event = evTok.name; eventRange = evTok.range; }
      else this.diagnostics.push(error(CODE.EXPECTED_IDENTIFIER,
        'Expected an event name after "."', this.peek().range, { expected: 'eventName' }));
    } else {
      this.diagnostics.push(error(CODE.EXPECTED_TOKEN,
        "Expected '.' in ROUTE endpoint", this.peek().range, { expected: '.' }));
    }
    return { node: nodeTok.name, nodeRange: nodeTok.range, event, eventRange, range: mergeRange(nodeTok.range, eventRange || nodeTok.range) };
  }

  parseProto(depth) {
    const kw = this.next(); // PROTO
    const nameTok = this.expect(TT.ID, 'a PROTO name');
    const interfaces = this.parseInterfaceList(false);
    const body = [];
    if (this.expect(TT.LBRACE, "'{' to open PROTO body")) {
      while (!this.at(TT.RBRACE) && !this.atEof()) {
        const before = this.pos;
        const stmt = this.parseTopStatement(depth + 1);
        if (stmt) body.push(stmt);
        if (this.pos === before) { this.next(); }
      }
      if (this.at(TT.RBRACE)) this.next();
      else this.diagnostics.push(error(CODE.UNCLOSED_BRACE, "Unclosed '{' for PROTO body",
        kw.range, { expected: '}' }));
    }
    return { type: NODE.PROTO, name: nameTok ? nameTok.name : null,
      nameRange: nameTok ? nameTok.range : null, interfaces, body, range: this.spanTo(kw) };
  }

  parseExternProto(depth) {
    const kw = this.next(); // EXTERNPROTO
    const nameTok = this.expect(TT.ID, 'an EXTERNPROTO name');
    const interfaces = this.parseInterfaceList(true);
    // URL(s): a bracketed MFString or a single SFString.
    let url = null;
    if (this.at(TT.LBRACKET) || this.at(TT.STRING)) url = this.parseValue(depth);
    return { type: NODE.EXTERNPROTO, name: nameTok ? nameTok.name : null,
      nameRange: nameTok ? nameTok.range : null, interfaces, url, range: this.spanTo(kw) };
  }

  // [ interfaceDecl* ]  -- shared by PROTO (with defaults) and EXTERNPROTO (no
  // defaults). `externNoDefaults` suppresses default-value parsing.
  parseInterfaceList(externNoDefaults) {
    const decls = [];
    if (!this.at(TT.LBRACKET)) {
      this.diagnostics.push(error(CODE.EXPECTED_TOKEN,
        `Expected '[' to open interface declarations but found ${describe(this.peek())}`,
        this.peek().range, { expected: '[' }));
      return decls;
    }
    const open = this.next(); // [
    while (!this.at(TT.RBRACKET) && !this.atEof()) {
      const before = this.pos;
      const decl = this.parseInterfaceDecl(externNoDefaults);
      if (decl) decls.push(decl);
      if (this.pos === before) {
        this.diagnostics.push(error(CODE.EXPECTED_INTERFACE,
          `Expected an interface declaration but found ${describe(this.peek())}`, this.peek().range));
        this.next();
      }
    }
    if (this.at(TT.RBRACKET)) this.next();
    else this.diagnostics.push(error(CODE.UNCLOSED_BRACKET, "Unclosed '[' in interface declarations",
      open.range, { expected: ']' }));
    return decls;
  }

  // field SFFloat radius 1  |  eventIn SFBool set_active  | exposedField ...
  parseInterfaceDecl(externNoDefaults) {
    const t = this.peek();
    if (!(t.type === TT.KEYWORD && (t.keyword === 'field' || t.keyword === 'eventIn'
      || t.keyword === 'eventOut' || t.keyword === 'exposedField'))) {
      return null;
    }
    const access = this.next().keyword;
    const typeTok = this.expect(TT.ID, 'a field type (e.g. SFFloat)');
    const nameTok = this.expect(TT.ID, 'an interface field name');
    let defaultValue = null;
    const hasDefault = access === 'field' || access === 'exposedField';
    if (hasDefault && !externNoDefaults) defaultValue = this.parseValue(1);
    return { type: NODE.INTERFACE, access,
      fieldType: typeTok ? typeTok.name : null, fieldTypeRange: typeTok ? typeTok.range : null,
      name: nameTok ? nameTok.name : null, nameRange: nameTok ? nameTok.range : null,
      default: defaultValue, range: this.spanTo(t) };
  }

  // --- recovery helpers ---
  // Skip a `{ ... }` block (balanced), used when a depth cap trips.
  skipBracedBlock() {
    if (!this.at(TT.LBRACE)) return;
    let depth = 0;
    while (!this.atEof()) {
      const t = this.next();
      if (t.type === TT.LBRACE) depth += 1;
      else if (t.type === TT.RBRACE) { depth -= 1; if (depth === 0) break; }
    }
  }

  // Resync inside a node body: skip to the next field/node boundary or `}`.
  syncInBody() {
    while (!this.atEof()) {
      const t = this.peek();
      if (t.type === TT.RBRACE || t.type === TT.ID) return;
      if (t.type === TT.KEYWORD && ['ROUTE', 'PROTO', 'EXTERNPROTO', 'field',
        'eventIn', 'eventOut', 'exposedField'].includes(t.keyword)) return;
      this.next();
    }
  }
}

function describe(t) {
  if (!t) return 'end of input';
  switch (t.type) {
    case TT.EOF: return 'end of input';
    case TT.ID: return `identifier '${t.name}'`;
    case TT.KEYWORD: return `'${t.keyword}'`;
    case TT.STRING: return 'string';
    case TT.NUMBER: return `number '${t.lexeme}'`;
    case TT.BOOL: return `'${t.lexeme}'`;
    default: return `'${t.lexeme || t.type}'`;
  }
}

// parse(text, opts) -> { tree, diagnostics }
// opts: { maxDepth, maxNodes }. Lexer + parser diagnostics are merged in order.
function parse(text, opts = {}) {
  const { tokens, comments, diagnostics: lexDiags } = tokenize(text);
  const diagnostics = lexDiags.slice();
  const parser = new Parser(tokens, diagnostics, opts);
  let tree;
  try {
    tree = parser.parseDocument();
  } catch (err) {
    if (!(err instanceof AbortParse)) throw err;
    // Partial tree: rebuild what we can from an empty document shell.
    tree = ast.document(null, [], tokens[0] ? { start: tokens[0].range.start, end: parser.peek().range.end } : null);
  }
  return {
    tree,
    tokens,
    comments,
    diagnostics,
    limits: parser.limits,
    truncated: parser.nodesCapped,
    depthCapped: parser.depthCapped,
  };
}

module.exports = { parse, Parser, DEFAULT_LIMITS };
