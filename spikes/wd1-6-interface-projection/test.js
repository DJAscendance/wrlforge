'use strict';
// WD1.6-B -- harness self-tests.
//
// A measurement whose detectors are never observed to fire is an assertion, not
// evidence: "0 mismatches" from a comparator that cannot report one is worth
// nothing. Every negative claim the sweep makes is exercised here on authored
// inputs BEFORE the corpus is touched.
//
//   node --test spikes/wd1-6-interface-projection/test.js
//
// Not collected by `npm run check` -- `scripts/run-tests.js` enumerates named
// directories under `test/`, so the production count is unaffected.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { parse } = require(path.join(REPO_ROOT, 'src', 'vrml'));
const sg = require(path.join(REPO_ROOT, 'src', 'vrml', 'scope-graph.js'));
const { effectiveInterfaceOf } = require(path.join(REPO_ROOT, 'src', 'vrml', 'interface-query.js'));
const corpus = require(path.join(REPO_ROOT, 'spikes', 'wd1-route-semantics', 'corpus.js'));
const { routeShorthandFor, lookupNameFor, compareEndpoint, compareAcquisition } = require('./compare.js');
const { forEachNode } = require('./run.js');

const H = '#VRML V2.0 utf8\n';

test('the corpus boundary guard THROWS, and is not merely documented', () => {
  for (const marker of corpus.FORBIDDEN_MARKERS) {
    assert.throws(() => corpus.assertAllowed(`/some/${marker}/file.wrl`), /boundary violation/);
  }
  // This harness weakens nothing: it uses P2C's guard, unmodified.
  assert.ok(corpus.FORBIDDEN_MARKERS.includes('white-dune'));
  assert.ok(corpus.FORBIDDEN_MARKERS.includes('RE-ARTIFACTS'));
});

test('the comparator DETECTS a wrong access', () => {
  const binding = { status: 'resolved', effectiveAccess: 'eventIn', member: { declarationOrigin: 'proto-interface', name: 'zzz', type: 'SFBool', declRange: null } };
  const endpoint = { origin: 'proto-interface', effectiveName: 'zzz', access: 'eventOut', type: 'SFBool', range: null };
  const cmp = compareEndpoint(binding, endpoint);
  assert.equal(cmp.ok, false);
  assert.equal(cmp.field, 'access');
});

test('the comparator DETECTS a wrong origin, name, type and declRange', () => {
  const good = { origin: 'proto-interface', effectiveName: 'zzz', access: 'eventIn', type: 'SFBool', range: { start: 1, end: 2 } };
  const base = () => ({ status: 'resolved', effectiveAccess: 'eventIn', member: { declarationOrigin: 'proto-interface', name: 'zzz', type: 'SFBool', declRange: good.range } });
  assert.equal(compareEndpoint(base(), good).ok, true);
  for (const [field, mutate] of [
    ['origin', (b) => { b.member.declarationOrigin = 'externproto-interface'; }],
    ['effectiveName', (b) => { b.member.name = 'other'; }],
    ['type', (b) => { b.member.type = 'SFInt32'; }],
    ['declRange', (b) => { b.member.declRange = { start: 9, end: 9 }; }],
  ]) {
    const b = base();
    mutate(b);
    const cmp = compareEndpoint(b, good);
    assert.equal(cmp.ok, false, field);
    assert.equal(cmp.field, field);
  }
});

test('the comparator DETECTS an absent binding and a non-resolved one', () => {
  const endpoint = { origin: 'proto-interface', effectiveName: 'z', access: 'eventIn', type: 'SFBool', range: null };
  assert.equal(compareEndpoint(undefined, endpoint).field, 'binding-missing');
  assert.equal(compareEndpoint({ status: 'ambiguous', member: null }, endpoint).field, 'status');
  assert.equal(compareEndpoint({ status: 'resolved', member: null }, endpoint).field, 'member');
});

test('declRange is NOT compared for a built-in, and that is deliberate', () => {
  // Acquisition reports the REFERENCE's range for a clause-6 field; the
  // projection honestly reports null. Comparing them compares two questions.
  const binding = { status: 'resolved', effectiveAccess: 'exposedField', member: { declarationOrigin: 'builtin-schema', name: 'translation', type: 'SFVec3f', declRange: null } };
  const endpoint = { origin: 'builtin-schema', effectiveName: 'translation', access: 'exposedField', type: 'SFVec3f', range: { start: 5, end: 9 } };
  assert.equal(compareEndpoint(binding, endpoint).ok, true);
});

test('the authority comparator DETECTS a wrong form, viaAlias, status and reason', () => {
  const acquired = { status: 'resolved', reason: 'ok', endpoint: { access: 'eventIn', form: 'set-alias', viaAlias: true } };
  const good = { status: 'resolved', reason: 'ok', effectiveAccess: 'eventIn', form: 'set-alias', viaAlias: true };
  assert.equal(compareAcquisition(good, acquired).ok, true);
  assert.equal(compareAcquisition({ ...good, form: 'declared' }, acquired).field, 'form');
  assert.equal(compareAcquisition({ ...good, viaAlias: false }, acquired).field, 'viaAlias');
  assert.equal(compareAcquisition({ ...good, status: 'unresolved' }, acquired).field, 'status');
  assert.equal(compareAcquisition({ ...good, reason: 'other' }, acquired).field, 'reason');
});

test('ROUTE shorthand normalization is direction-specific, and only fires on shorthand', () => {
  assert.equal(routeShorthandFor('fraction', 'source'), 'fraction_changed');
  assert.equal(routeShorthandFor('fraction', 'destination'), 'set_fraction');
  assert.equal(lookupNameFor('x', 'source', null), 'x');
  assert.equal(lookupNameFor('x', 'source', 'route-endpoint-via-implicit-alias'), 'x');
  assert.equal(lookupNameFor('x', 'source', 'route-endpoint-via-shorthand'), 'x_changed');
});

test('a real shorthand ROUTE is comparable only AFTER normalization', () => {
  // `set_fraction` is written bare as `fraction`; 4.10.2's fallback finds it.
  const parsed = parse(`${H}DEF C TimeSensor { }\nDEF I ScalarInterpolator { }\n`
    + 'ROUTE C.fraction_changed TO I.fraction\n');
  const graph = sg.buildScopeGraph(parsed);
  const ref = sg.routeEventReferences(graph)
    .find((r) => r.side === sg.ROUTE_SIDE.DESTINATION);
  const resolution = sg.resolveRouteEndpoint(graph, ref);
  const endpoint = sg.routeEndpointFor(graph, ref);
  assert.equal(resolution.detail, sg.REASON.ROUTE_ENDPOINT_VIA_SHORTHAND);
  assert.equal(endpoint.name, 'fraction', 'the record keeps the AUTHOR\'s spelling');

  const target = sg.resolveRouteNode(graph, ref.nodeReference).symbol.node;
  const iface = effectiveInterfaceOf(graph, target);
  // Un-normalized the written name is a DIFFERENT declaration -- so a harness
  // that skipped normalization would report a false mismatch.
  assert.notEqual(compareEndpoint(iface.byName[endpoint.name], endpoint).ok, true);
  const name = lookupNameFor(endpoint.name, ref.side, resolution.detail);
  assert.equal(name, 'set_fraction');
  assert.equal(compareEndpoint(iface.byName[name], endpoint).ok, true);
});

test('the node walker finds occurrences a curated key list misses', () => {
  const parsed = parse(`${H}PROTO P [ field SFNode n NULL ] {\n`
    + '  Group { children [ Transform { children [ Shape { } ] } ] }\n}\n'
    + 'P { n Cone { } }\n');
  const found = [];
  forEachNode(parsed.tree, (n) => found.push(n.nodeType));
  for (const expected of ['Group', 'Transform', 'Shape', 'P', 'Cone']) {
    assert.ok(found.includes(expected), `${expected} must be walked`);
  }
});

test('the projection agrees with BOTH shipped paths on an authored control', () => {
  const parsed = parse(`${H}PROTO P [ exposedField SFVec3f pos 0 0 0 ] {\n`
    + '  DEF T Transform { translation IS pos }\n'
    + '  DEF S TimeSensor { }\n'
    + '  ROUTE S.fraction_changed TO T.set_scale\n}\nP { }\n');
  const graph = sg.buildScopeGraph(parsed);
  let checked = 0;
  for (const ref of sg.isReferences(graph)) {
    if (ref.form === sg.IS_FORM.SCRIPT_INTERFACE || !ref.hostNode) continue;
    const verdict = sg.isConnectionVerdict(graph, ref);
    if (!verdict.endpoint) continue;
    const iface = effectiveInterfaceOf(graph, ref.hostNode);
    assert.equal(compareEndpoint(iface.byName[verdict.endpoint.name], verdict.endpoint).ok, true);
    checked += 1;
  }
  for (const ref of sg.routeEventReferences(graph)) {
    const endpoint = sg.routeEndpointFor(graph, ref);
    if (!endpoint) continue;
    const nodeRes = sg.resolveRouteNode(graph, ref.nodeReference);
    if (!nodeRes || nodeRes.status !== sg.STATUS.RESOLVED) continue;
    const iface = effectiveInterfaceOf(graph, nodeRes.symbol.node);
    const resolution = sg.resolveRouteEndpoint(graph, ref);
    const name = lookupNameFor(endpoint.name, ref.side, resolution && resolution.detail);
    assert.equal(compareEndpoint(iface.byName[name], endpoint).ok, true);
    checked += 1;
  }
  assert.equal(checked, 3, 'one IS and two ROUTE endpoints');
});

test('this harness imports no production write path and performs no writes itself', () => {
  const src = require('fs').readFileSync(path.join(__dirname, 'run.js'), 'utf8');
  // One write, to the gitignored out/ directory, and nothing else.
  assert.equal((src.match(/writeFileSync/g) || []).length, 2);
  assert.equal(/unlink|rmSync|renameSync|copyFileSync|appendFileSync/.test(src), false);
});
