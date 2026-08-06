'use strict';
// VRML97 symbol taxonomy tests (Phase WD1.5-P1).
//
// `symbols.js` is data and shape, so these tests are about the two properties a
// vocabulary module can actually get wrong: a published value silently changing
// meaning, and a projection being trusted on SHAPE rather than on MEMBERSHIP.
// The second is the load-bearing one -- a shape check that doubled as an
// authorization check is exactly how a symbol from document A resolves against
// document B.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const sym = require('../../src/vrml/symbols');

const SYMBOLS_PATH = path.join(__dirname, '..', '..', 'src', 'vrml', 'symbols.js');

test('symbols: the module is dependency-free and browser-safe', () => {
  const src = fs.readFileSync(SYMBOLS_PATH, 'utf8');
  // A taxonomy that reached for the filesystem, a clock or crypto would not be
  // usable in the renderer, and would make the graph non-deterministic.
  assert.equal(/\brequire\s*\(/.test(src), false, 'symbols.js must require nothing');
  for (const banned of ['Date.now', 'Math.random', 'process.', 'Buffer']) {
    assert.equal(src.includes(banned), false, `symbols.js must not use ${banned}`);
  }
});

test('symbols: every published constant table is frozen', () => {
  for (const name of ['SCOPE_ERROR', 'NAMESPACE', 'SCOPE_KIND', 'SYMBOL_KIND',
    'REFERENCE_KIND', 'STATUS', 'REASON']) {
    assert.equal(Object.isFrozen(sym[name]), true, `${name} must be frozen`);
  }
});

test('symbols: the published string values are exactly the committed ones', () => {
  // Pinned as literals, written from the committed plan rather than read back
  // from the module, so a rename shows up here as a failure instead of passing
  // silently. Downstream consumers, tests and docs key off these strings.
  assert.deepEqual({ ...sym.NAMESPACE }, {
    NODE_NAME: 'node-name',
    NODE_TYPE: 'node-type',
    INTERFACE_MEMBER: 'interface-member',
  });
  assert.deepEqual({ ...sym.SCOPE_KIND }, {
    DOCUMENT: 'document',
    PROTO_BODY: 'proto-body',
  });
  assert.deepEqual({ ...sym.SYMBOL_KIND }, { NODE_DEF: 'node-def' });
  assert.deepEqual({ ...sym.REFERENCE_KIND }, { USE: 'use' });
  assert.deepEqual({ ...sym.STATUS }, {
    RESOLVED: 'resolved',
    UNRESOLVED: 'unresolved',
    AMBIGUOUS: 'ambiguous',
    INVALID: 'invalid',
    UNSUPPORTED: 'unsupported',
    RECOVERED: 'recovered',
  });
  assert.equal(sym.REASON.DEF_NOT_VISIBLE_ACROSS_PROTO_BOUNDARY,
    'def-not-visible-across-proto-boundary');
  assert.equal(sym.REASON.DUPLICATE_DEF_IN_SCOPE, 'duplicate-def-in-scope');
  assert.equal(sym.REASON.USE_BEFORE_DEF, 'use-before-def');
  assert.equal(sym.REASON.SCOPE_RECOVERED, 'scope-recovered');
  assert.equal(sym.REASON.DOCUMENT_PARSE_INCOMPLETE, 'document-parse-incomplete');
  assert.equal(sym.REASON.PROTO_SCOPE_NOT_PROVABLE, 'proto-scope-not-provable');
  assert.equal(sym.REASON.PROTO_BODY_NOT_PROVABLE, 'proto-body-not-provable');
  assert.equal(sym.REASON.SELF_REFERENCE_OUTSIDE_TRANSFORMATION_HIERARCHY,
    'self-reference-outside-transformation-hierarchy');
});

test('symbols: P1 publishes no kind it cannot construct', () => {
  // The scope kinds WD1.5-P2 adds must NOT be advertised before anything
  // creates them; publishing `proto-interface` today would claim support that
  // does not exist.
  const scopeKinds = Object.values(sym.SCOPE_KIND);
  for (const later of ['proto-interface', 'externproto-interface', 'script-interface']) {
    assert.equal(scopeKinds.includes(later), false,
      `${later} is a WD1.5-P2 scope kind and must not be published by P1`);
  }
  const symbolKinds = Object.values(sym.SYMBOL_KIND);
  for (const later of ['proto-decl', 'externproto-decl', 'proto-interface-member',
    'script-interface-member']) {
    assert.equal(symbolKinds.includes(later), false, `${later} must not be published by P1`);
  }
  const refKinds = Object.values(sym.REFERENCE_KIND);
  for (const later of ['node-type', 'is', 'route-node', 'route-event']) {
    assert.equal(refKinds.includes(later), false, `${later} must not be published by P1`);
  }
});

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

test('symbols: membership is object identity, never shape', () => {
  const ownerA = {};
  const ownerB = {};
  const scope = sym.createScope({ kind: sym.SCOPE_KIND.DOCUMENT, index: 0 }, ownerA);

  assert.equal(sym.belongsTo(scope, ownerA), true);
  assert.equal(sym.belongsTo(scope, ownerB), false);
  assert.equal(sym.ownerOf(scope), ownerA);

  // A hand-rolled object with a perfectly valid shape has nothing behind it.
  const forged = Object.freeze({ kind: 'document', defParent: null, typeParent: null });
  assert.equal(sym.isScopeShape(forged), true, 'the forgery is shape-valid on purpose');
  assert.equal(sym.belongsTo(forged, ownerA), false);
  assert.equal(sym.ownerOf(forged), undefined);
});

test('symbols: belongsTo refuses a missing owner rather than matching one', () => {
  const scope = sym.createScope({ kind: sym.SCOPE_KIND.DOCUMENT, index: 0 }, {});
  // `undefined === undefined` would be true for an unbranded object if this
  // were written as a bare comparison. It must not be.
  assert.equal(sym.belongsTo(scope, undefined), false);
  assert.equal(sym.belongsTo({}, undefined), false);
  assert.equal(sym.belongsTo(null, undefined), false);
});

test('symbols: brand requires an owner token', () => {
  assert.throws(() => sym.brand(Object.freeze({}), null), (e) => e.code === sym.SCOPE_ERROR.GRAPH);
  assert.throws(() => sym.brand(Object.freeze({}), undefined),
    (e) => e.code === sym.SCOPE_ERROR.GRAPH);
});

test('symbols: primitives and non-objects are never members', () => {
  const owner = {};
  for (const value of [null, undefined, 0, 1, '', 'document', true, Symbol('x')]) {
    assert.equal(sym.belongsTo(value, owner), false);
    assert.equal(sym.ownerOf(value), undefined);
  }
});

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

test('symbols: every projection is frozen', () => {
  const owner = {};
  const scope = sym.createScope({ kind: sym.SCOPE_KIND.DOCUMENT, index: 0 }, owner);
  const node = { type: 'Node', nodeType: 'Group', def: 'Ball' };
  const symbol = sym.createDefSymbol({
    name: 'Ball', node, scope, declRange: null, sourceOrder: 0, nodeType: 'Group', visibleFrom: 5,
  }, owner);
  const reference = sym.createUseReference({
    name: 'Ball', node: { type: 'Use' }, scope, range: null, sourceOrder: 0, offset: 9,
  }, owner);
  const resolution = sym.createResolution({
    reference, status: sym.STATUS.RESOLVED, reason: sym.REASON.OK, symbol, candidateCount: 1,
    evidence: [null],
  });

  for (const [label, obj] of [['scope', scope], ['symbol', symbol],
    ['reference', reference], ['resolution', resolution]]) {
    assert.equal(Object.isFrozen(obj), true, `${label} must be frozen`);
  }
  assert.equal(Object.isFrozen(resolution.evidence), true);
  assert.throws(() => { resolution.evidence.push(null); }, TypeError);
  assert.throws(() => { symbol.name = 'other'; }, TypeError);
});

test('symbols: a resolution carries a symbol ONLY when it resolved', () => {
  const owner = {};
  const scope = sym.createScope({ kind: sym.SCOPE_KIND.DOCUMENT, index: 0 }, owner);
  const symbol = sym.createDefSymbol({
    name: 'Ball', node: {}, scope, sourceOrder: 0, visibleFrom: 0,
  }, owner);
  const reference = sym.createUseReference({
    name: 'Ball', node: {}, scope, sourceOrder: 0, offset: 1,
  }, owner);

  // The hard gate in the constructor itself: even a caller that passes a symbol
  // alongside a non-resolved status gets `null` back.
  for (const status of ['unresolved', 'ambiguous', 'invalid', 'unsupported', 'recovered']) {
    const r = sym.createResolution({ reference, status, reason: 'x', symbol });
    assert.equal(r.symbol, null, `status ${status} must not carry a symbol`);
  }
  const ok = sym.createResolution({
    reference, status: sym.STATUS.RESOLVED, reason: sym.REASON.OK, symbol,
  });
  assert.equal(ok.symbol, symbol);
});

test('symbols: a resolution copies its evidence rather than aliasing it', () => {
  const owner = {};
  const scope = sym.createScope({ kind: sym.SCOPE_KIND.DOCUMENT, index: 0 }, owner);
  const reference = sym.createUseReference({
    name: 'B', node: {}, scope, sourceOrder: 0, offset: 1,
  }, owner);
  const caller = [{ start: { offset: 1 } }];
  const r = sym.createResolution({
    reference, status: sym.STATUS.AMBIGUOUS, reason: sym.REASON.DUPLICATE_DEF_IN_SCOPE,
    evidence: caller,
  });
  caller.push({ start: { offset: 2 } });
  assert.equal(r.evidence.length, 1, 'the caller must not be able to grow it afterwards');
});

test('symbols: a scope never derives identity from a name', () => {
  const owner = {};
  const a = sym.createScope({ kind: sym.SCOPE_KIND.PROTO_BODY, ownerName: 'P', index: 1 }, owner);
  const b = sym.createScope({ kind: sym.SCOPE_KIND.PROTO_BODY, ownerName: 'P', index: 2 }, owner);
  assert.notEqual(a, b, 'two same-named PROTO bodies are two scopes');
  assert.equal(a.ownerName, b.ownerName);
  // Nothing printable stands in for the identity.
  assert.equal(Object.prototype.hasOwnProperty.call(a, 'key'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(a, 'path'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(a, 'scopeKey'), false);
});

test('symbols: uniqueness answers are frozen and explicit', () => {
  const u = sym.createUniqueness(true, sym.REASON.OK);
  assert.equal(Object.isFrozen(u), true);
  assert.deepEqual({ ...u }, { unique: true, reason: 'ok' });
  const n = sym.createUniqueness(false, sym.REASON.DUPLICATE_DEF_IN_SCOPE);
  assert.deepEqual({ ...n }, { unique: false, reason: 'duplicate-def-in-scope' });
});

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

test('symbols: shape predicates reject near-misses', () => {
  assert.equal(sym.isScopeShape({ kind: 'proto-interface' }), false);
  assert.equal(sym.isScopeShape([{ kind: 'document' }]), false);
  assert.equal(sym.isScopeShape(null), false);
  assert.equal(sym.isDefSymbolShape({ kind: 'node-def' }), false, 'namespace is required');
  assert.equal(sym.isDefSymbolShape({ kind: 'node-def', namespace: 'node-type' }), false);
  assert.equal(sym.isUseReferenceShape({ kind: 'use' }), false);
  assert.equal(sym.isUseReferenceShape({ kind: 'use', namespace: 'node-name' }), true);
});

test('symbols: status predicates are mutually exclusive', () => {
  const owner = {};
  const scope = sym.createScope({ kind: sym.SCOPE_KIND.DOCUMENT, index: 0 }, owner);
  const reference = sym.createUseReference({
    name: 'B', node: {}, scope, sourceOrder: 0, offset: 1,
  }, owner);
  const checks = {
    resolved: sym.isResolved,
    unresolved: sym.isUnresolved,
    ambiguous: sym.isAmbiguous,
    invalid: sym.isInvalid,
    recovered: sym.isRecovered,
  };
  for (const [status, fn] of Object.entries(checks)) {
    const r = sym.createResolution({ reference, status, reason: 'x' });
    assert.equal(fn(r), true, `${status} predicate must accept ${status}`);
    for (const [other, otherFn] of Object.entries(checks)) {
      if (other === status) continue;
      assert.equal(otherFn(r), false, `${other} predicate must reject ${status}`);
    }
  }
  for (const fn of Object.values(checks)) {
    assert.equal(fn(null), false);
    assert.equal(fn(undefined), false);
  }
});
