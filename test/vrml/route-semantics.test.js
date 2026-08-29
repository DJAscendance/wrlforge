'use strict';
// VRML97 ROUTE endpoint resolution and compatibility tests (Phase WD1.5-P2C).
//
// A SEPARATE FILE from `scope-graph.test.js` (DEF/USE, P1),
// `type-resolution.test.js` (node types, P2A) and `interface-is.test.js`
// (interface members and `IS`, P2B), for the reason each of those gave in turn:
// their value is partly that they did NOT change when this lane landed, so a
// predecessor regression surfaces there as a failure rather than as a merge
// conflict in a file four lanes edit.
//
// As in P1/P2A/P2B, most of what follows asserts a REFUSAL, and every positive
// case proves WHICH declaration came back by object identity against the exact
// AST node located by an independent walk -- never merely that something did.
//
// Fixtures are authored here as string literals, original to this lane. Nothing
// under `spikes/` is imported: a production test graded against a research
// prototype would be checking one implementation against another instead of
// against ISO/IEC 14772-1.
//
// THE TWO CLAUSES THIS FILE EXISTS TO PIN:
//
//   4.10.2  "Routes may be established only from eventOuts to eventIns", the
//           types "shall match exactly", nodes "shall be defined before the
//           ROUTE statement", and the `set_`/`_changed` part of a name is
//           OPTIONAL -- with a direction-specific fallback procedure.
//   4.6.2   a DEF'd node "may be referenced by name later in the same file with
//           USE or ROUTE statements" -- which is what makes ROUTE node names
//           P1's namespace rather than a fourth one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const { parse, ast } = require('../../src/vrml');
const sg = require('../../src/vrml/scope-graph');
const sym = require('../../src/vrml/symbols');

const {
  STATUS, REASON, SCOPE_ERROR, REFERENCE_KIND, NAMESPACE, ACCESS,
  ENDPOINT_ORIGIN, ROUTE_SIDE,
} = sg;

const H = '#VRML V2.0 utf8\n';
const SRC = path.join(__dirname, '..', '..', 'src', 'vrml');
const { SOURCE, DESTINATION } = ROUTE_SIDE;

// --- helpers ---------------------------------------------------------------
//
// These locate things by walking the tree independently of the graph, so a test
// never proves the graph right using the graph's own index.

function build(source, opts) {
  const parsed = parse(source, opts);
  return { parsed, graph: sg.buildScopeGraph(parsed) };
}

/** Every `Route` AST node, in source order, found by an independent walk. */
function routeNodes(parsed) {
  const out = [];
  ast.walk(parsed.tree, (n) => {
    if (n.type === ast.NODE.ROUTE) out.push(n);
  });
  return out.sort((a, b) => a.range.start.offset - b.range.start.offset);
}

/** The `Node` AST node carrying `DEF <name>`, located independently. */
function defNodes(parsed, name) {
  const out = [];
  ast.walk(parsed.tree, (n) => {
    if (n.type === ast.NODE.NODE && n.def === name) out.push(n);
  });
  return out.sort((a, b) => a.range.start.offset - b.range.start.offset);
}

/**
 * The four answers for one ROUTE, plus its verdict.
 *
 * Deliberately returns all five separately rather than a merged summary -- the
 * whole point of the lane is that these are independently observable, and a
 * helper that collapsed them would hide the property under test.
 */
function ask(graph, route) {
  const sn = sg.routeNodeReferenceFor(graph, route, SOURCE);
  const dn = sg.routeNodeReferenceFor(graph, route, DESTINATION);
  const se = sg.routeEventReferenceFor(graph, route, SOURCE);
  const de = sg.routeEventReferenceFor(graph, route, DESTINATION);
  return {
    sourceNodeRef: sn,
    destNodeRef: dn,
    sourceEventRef: se,
    destEventRef: de,
    sourceNode: sg.resolveRouteNode(graph, sn),
    destNode: sg.resolveRouteNode(graph, dn),
    sourceEvent: sg.resolveRouteEndpoint(graph, se),
    destEvent: sg.resolveRouteEndpoint(graph, de),
    sourceEndpoint: sg.routeEndpointFor(graph, se),
    destEndpoint: sg.routeEndpointFor(graph, de),
    verdict: sg.routeVerdict(graph, route),
  };
}

/** The single ROUTE of a one-ROUTE fixture, fully answered. */
function oneRoute(source, opts) {
  const { parsed, graph } = build(source, opts);
  const routes = routeNodes(parsed);
  assert.equal(routes.length, 1, 'fixture must hold exactly one ROUTE');
  return { parsed, graph, route: routes[0], ...ask(graph, routes[0]) };
}

const okBoth = (a) => {
  assert.equal(a.sourceNode.status, STATUS.RESOLVED);
  assert.equal(a.destNode.status, STATUS.RESOLVED);
  assert.equal(a.sourceEvent.status, STATUS.RESOLVED);
  assert.equal(a.destEvent.status, STATUS.RESOLVED);
};

/** Comment- and string-stripped source, for the structural-absence scans. */
function codeOnly(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (c === '/' && d === '/') { while (i < n && source[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// ===========================================================================
// 1-10. Node resolution -- 4.6.2's namespace, under 4.10.2's ordering rule
// ===========================================================================

test('1. a clean ROUTE binds both node names to the exact DEF nodes', () => {
  const src = `${H}DEF Clock TimeSensor { loop TRUE }\n`
    + 'DEF Path PositionInterpolator { key [ 0 1 ] }\n'
    + 'ROUTE Clock.fraction_changed TO Path.set_fraction\n';
  const a = oneRoute(src);
  okBoth(a);
  // Identity against an INDEPENDENT walk, not against the graph's own index.
  assert.equal(a.sourceNode.symbol.node, defNodes(a.parsed, 'Clock')[0]);
  assert.equal(a.destNode.symbol.node, defNodes(a.parsed, 'Path')[0]);
  assert.equal(a.verdict.status, STATUS.RESOLVED);
  assert.equal(a.verdict.reason, REASON.OK);
  assert.equal(a.verdict.side, null);
});

test('2. a source node name that is declared nowhere is unresolved, not guessed', () => {
  const src = `${H}DEF Path PositionInterpolator { }\n`
    + 'ROUTE Ghost.fraction_changed TO Path.set_fraction\n';
  const a = oneRoute(src);
  assert.equal(a.sourceNode.status, STATUS.UNRESOLVED);
  assert.equal(a.sourceNode.reason, REASON.DEF_NOT_DECLARED_IN_SCOPE);
  assert.equal(a.sourceNode.symbol, null);
  // The DESTINATION is untouched by the source's failure -- independence.
  assert.equal(a.destNode.status, STATUS.RESOLVED);
  assert.equal(a.verdict.status, STATUS.UNRESOLVED);
  assert.equal(a.verdict.side, SOURCE);
});

test('3. a destination node name that is declared nowhere fails on its own side', () => {
  const src = `${H}DEF Clock TimeSensor { }\n`
    + 'ROUTE Clock.fraction_changed TO Ghost.set_fraction\n';
  const a = oneRoute(src);
  assert.equal(a.sourceNode.status, STATUS.RESOLVED);
  assert.equal(a.destNode.status, STATUS.UNRESOLVED);
  assert.equal(a.destNode.reason, REASON.DEF_NOT_DECLARED_IN_SCOPE);
  assert.equal(a.verdict.side, DESTINATION);
  // The good source binding SURVIVES the bad destination. Losing it would throw
  // away evidence the resolver actually has.
  assert.equal(a.sourceNode.symbol.node, defNodes(a.parsed, 'Clock')[0]);
});

test('4. a duplicated source DEF is ambiguous -- decided on the NAME alone', () => {
  const src = `${H}DEF Clock TimeSensor { }\nDEF Clock TouchSensor { }\n`
    + 'DEF Path PositionInterpolator { }\n'
    + 'ROUTE Clock.fraction_changed TO Path.set_fraction\n';
  const a = oneRoute(src);
  assert.equal(a.sourceNode.status, STATUS.AMBIGUOUS);
  assert.equal(a.sourceNode.reason, REASON.DUPLICATE_DEF_IN_SCOPE);
  assert.equal(a.sourceNode.candidateCount, 2);
  assert.equal(a.sourceNode.symbol, null);
  // The decisive property: only ONE of the two candidates actually has a
  // `fraction_changed` eventOut, so a resolver that narrowed duplicates by
  // endpoint availability would "helpfully" bind the TimeSensor. That is
  // candidate ranking -- WD.md §7's failure mode -- and it must not happen.
  assert.equal(a.sourceEvent.status, STATUS.AMBIGUOUS);
  assert.equal(a.sourceEndpoint, null);
});

test('5. a duplicated destination DEF is ambiguous on its own side', () => {
  const src = `${H}DEF Clock TimeSensor { }\n`
    + 'DEF Path PositionInterpolator { }\nDEF Path ScalarInterpolator { }\n'
    + 'ROUTE Clock.fraction_changed TO Path.set_fraction\n';
  const a = oneRoute(src);
  assert.equal(a.sourceNode.status, STATUS.RESOLVED);
  assert.equal(a.destNode.status, STATUS.AMBIGUOUS);
  assert.equal(a.destNode.candidateCount, 2);
});

test('6. the same spelling in two lexical scopes binds the one in ITS OWN scope', () => {
  // 4.8.4 in both directions, reached through 4.6.2. The inner ROUTE must bind
  // the PROTO body's `Knob`, never the document's -- and they are different node
  // TYPES, so a wrong binding is visible in the endpoint that follows.
  const src = `${H}DEF Knob TimeSensor { }\n`
    + 'PROTO P [ ] {\n'
    + '  DEF Knob TouchSensor { }\n'
    + '  DEF Sink Transform { }\n'
    + '  ROUTE Knob.isActive TO Sink.set_bboxSize\n'
    + '}\n'
    + 'P { }\n';
  const { parsed, graph } = build(src);
  const routes = routeNodes(parsed);
  assert.equal(routes.length, 1);
  const a = ask(graph, routes[0]);
  assert.equal(a.sourceNode.status, STATUS.RESOLVED);
  // The INNER `Knob` -- the second in source order.
  const knobs = defNodes(parsed, 'Knob');
  assert.equal(knobs.length, 2);
  assert.equal(a.sourceNode.symbol.node, knobs[1]);
  assert.equal(a.sourceNode.symbol.nodeType, 'TouchSensor');
});

test('7. PROTO disjointness holds in BOTH directions for ROUTE node names', () => {
  // Outward: a ROUTE inside a PROTO body cannot see a document-level DEF.
  const outward = `${H}DEF Outer TimeSensor { }\n`
    + 'PROTO P [ ] {\n  DEF Sink ScalarInterpolator { }\n'
    + '  ROUTE Outer.fraction_changed TO Sink.set_fraction\n}\n'
    + 'P { }\n';
  const a = oneRoute(outward);
  assert.equal(a.sourceNode.status, STATUS.UNRESOLVED);
  assert.equal(a.sourceNode.reason, REASON.DEF_NOT_VISIBLE_ACROSS_PROTO_BOUNDARY);
  assert.equal(a.sourceNode.symbol, null);

  // Inward: a document-level ROUTE cannot see a DEF inside a PROTO body.
  const inward = `${H}PROTO P [ ] {\n  DEF Hidden TimeSensor { }\n}\n`
    + 'DEF Sink ScalarInterpolator { }\nP { }\n'
    + 'ROUTE Hidden.fraction_changed TO Sink.set_fraction\n';
  const b = oneRoute(inward);
  assert.equal(b.sourceNode.status, STATUS.UNRESOLVED);
  assert.equal(b.sourceNode.reason, REASON.DEF_NOT_VISIBLE_ACROSS_PROTO_BOUNDARY);
});

test('8. a projection from another graph is rejected, even for identical text', () => {
  const src = `${H}DEF Clock TimeSensor { }\nDEF Path ScalarInterpolator { }\n`
    + 'ROUTE Clock.fraction_changed TO Path.set_fraction\n';
  const one = build(src);
  const two = build(src);
  const refFromOne = sg.routeNodeReferenceFor(one.graph, routeNodes(one.parsed)[0], SOURCE);
  assert.throws(() => sg.resolveRouteNode(two.graph, refFromOne),
    (e) => e.code === SCOPE_ERROR.REFERENCE);
  const evtFromOne = sg.routeEventReferenceFor(one.graph, routeNodes(one.parsed)[0], SOURCE);
  assert.throws(() => sg.resolveRouteEndpoint(two.graph, evtFromOne),
    (e) => e.code === SCOPE_ERROR.REFERENCE);
  assert.throws(() => sg.routeVerdict(two.graph, routeNodes(one.parsed)[0]),
    (e) => e.code === SCOPE_ERROR.REFERENCE);
  // And a hand-rolled look-alike has nothing behind it.
  assert.throws(() => sg.resolveRouteNode(one.graph,
    { kind: 'route-node', namespace: 'node-name', side: 'source', name: 'Clock' }),
  (e) => e.code === SCOPE_ERROR.REFERENCE);
});

test('9. a damaged scope cannot manufacture a confident ABSENCE', () => {
  // An unclosed PROTO body absorbs the following statements, so the ROUTE is no
  // longer in the scope it was written in and the outer `Clock` is invisible to
  // it. A resolver that trusted negatives would report a confident "not
  // declared" about a document whose scope boundaries it cannot prove.
  const src = `${H}DEF Clock TimeSensor { }\n`
    + 'PROTO P [ ] { Shape { }\n'
    + 'DEF Path ScalarInterpolator { }\n'
    + 'ROUTE Clock.fraction_changed TO Path.set_fraction\n';
  const a = oneRoute(src);
  assert.equal(a.sourceNode.status, STATUS.RECOVERED);
  assert.notEqual(a.sourceNode.reason, REASON.DEF_NOT_DECLARED_IN_SCOPE);
  assert.equal(a.sourceNode.symbol, null);
  assert.equal(a.verdict.status, STATUS.RECOVERED);
});

test('10. a damaged scope cannot manufacture a confident AMBIGUITY', () => {
  // Two `DEF Path` written in DIFFERENT scopes. With the brace present they are
  // not duplicates at all; with it missing the absorbed body holds both, and a
  // resolver that let ambiguity stand under damage would report a duplicate the
  // author never wrote. `ambiguous` binds nothing, which is exactly why it looks
  // safe to allow -- it is still an ASSERTION, and recovery can fabricate it.
  const clean = `${H}PROTO P [ ] { Shape { } DEF Path ScalarInterpolator { } }\n`
    + 'DEF Clock TimeSensor { }\nDEF Path ScalarInterpolator { }\n'
    + 'ROUTE Clock.fraction_changed TO Path.set_fraction\n';
  assert.equal(oneRoute(clean).destNode.status, STATUS.RESOLVED);

  const damaged = `${H}PROTO P [ ] { Shape { } DEF Path ScalarInterpolator { }\n`
    + 'DEF Clock TimeSensor { }\nDEF Path ScalarInterpolator { }\n'
    + 'ROUTE Clock.fraction_changed TO Path.set_fraction\n';
  const a = oneRoute(damaged);
  assert.equal(a.destNode.status, STATUS.RECOVERED);
  assert.notEqual(a.destNode.reason, REASON.DUPLICATE_DEF_IN_SCOPE);
});

// ===========================================================================
// 11-23. Endpoint acquisition -- the node's own public interface
// ===========================================================================

test('11. a built-in eventOut is a legal source', () => {
  const a = oneRoute(`${H}DEF Clock TimeSensor { }\nDEF Path ScalarInterpolator { }\n`
    + 'ROUTE Clock.fraction_changed TO Path.set_fraction\n');
  assert.equal(a.sourceEvent.status, STATUS.RESOLVED);
  assert.equal(a.sourceEndpoint.origin, ENDPOINT_ORIGIN.BUILTIN_SCHEMA);
  assert.equal(a.sourceEndpoint.access, ACCESS.EVENT_OUT);
  assert.equal(a.sourceEndpoint.type, 'SFFloat');
  assert.equal(a.sourceEndpoint.effectiveName, 'fraction_changed');
  // A built-in is a clause-6 SCHEMA fact, declared nowhere in the file, so there
  // is no lexical symbol for it. `origin` is what says so.
  assert.equal(a.sourceEvent.symbol, null);
});

test('12. a built-in eventIn is a legal destination', () => {
  const a = oneRoute(`${H}DEF Clock TimeSensor { }\nDEF Path ScalarInterpolator { }\n`
    + 'ROUTE Clock.fraction_changed TO Path.set_fraction\n');
  assert.equal(a.destEvent.status, STATUS.RESOLVED);
  assert.equal(a.destEndpoint.access, ACCESS.EVENT_IN);
  assert.equal(a.destEndpoint.type, 'SFFloat');
});

test('13. 4.7 alias expansion: a written `set_zzz` finds the declared exposedField', () => {
  const a = oneRoute(`${H}DEF Src Transform { }\nDEF Dst Transform { }\n`
    + 'ROUTE Src.translation_changed TO Dst.set_translation\n');
  okBoth(a);
  assert.equal(a.sourceEndpoint.effectiveName, 'translation');
  assert.equal(a.sourceEndpoint.access, ACCESS.EVENT_OUT, 'the alias carries its OWN access');
  assert.equal(a.destEndpoint.effectiveName, 'translation');
  assert.equal(a.destEndpoint.access, ACCESS.EVENT_IN);
  // Bound through EXPANSION (4.7), not through 4.10.2's fallback. The two
  // mechanisms are distinguishable in the result, which is the point.
  assert.equal(a.sourceEvent.detail, REASON.ROUTE_ENDPOINT_VIA_IMPLICIT_ALIAS);
  assert.equal(a.destEvent.detail, REASON.ROUTE_ENDPOINT_VIA_IMPLICIT_ALIAS);
  assert.equal(a.verdict.status, STATUS.RESOLVED);
});

test('14. an eventIn used as a SOURCE is a direction error, not a missing name', () => {
  const a = oneRoute(`${H}DEF Clock TimeSensor { }\nDEF Path ScalarInterpolator { }\n`
    + 'ROUTE Path.set_fraction TO Clock.set_enabled\n');
  assert.equal(a.sourceEvent.status, STATUS.INVALID);
  assert.equal(a.sourceEvent.reason, REASON.ROUTE_SOURCE_NOT_AN_EVENT_OUT);
  // The endpoint was FOUND -- the failure is directional. A consumer reporting
  // it can still say what the author named.
  assert.equal(a.sourceEndpoint.access, ACCESS.EVENT_IN);
  assert.equal(a.verdict.reason, REASON.ROUTE_SOURCE_NOT_AN_EVENT_OUT);
  assert.equal(a.verdict.side, SOURCE);
});

test('15. an eventOut used as a DESTINATION is a direction error', () => {
  const a = oneRoute(`${H}DEF Clock TimeSensor { }\nDEF Path ScalarInterpolator { }\n`
    + 'ROUTE Clock.fraction_changed TO Path.value_changed\n');
  assert.equal(a.sourceEvent.status, STATUS.RESOLVED);
  assert.equal(a.destEvent.status, STATUS.INVALID);
  assert.equal(a.destEvent.reason, REASON.ROUTE_DEST_NOT_AN_EVENT_IN);
  assert.equal(a.destEndpoint.access, ACCESS.EVENT_OUT);
  assert.equal(a.verdict.side, DESTINATION);
});

test('16. a plain `field` cannot serve either side, after the fallback has failed', () => {
  // `Box.size` and `Sphere.radius` are `field`s with no event side at all, and
  // no `size_changed` / `set_radius` exists to fall back to.
  const asSource = oneRoute(`${H}DEF B Box { }\nDEF T Transform { }\n`
    + 'ROUTE B.size TO T.set_translation\n');
  assert.equal(asSource.sourceEvent.status, STATUS.INVALID);
  assert.equal(asSource.sourceEvent.reason, REASON.ROUTE_SOURCE_NOT_AN_EVENT_OUT);
  assert.equal(asSource.sourceEndpoint.access, ACCESS.FIELD);

  const asDest = oneRoute(`${H}DEF S Sphere { }\nDEF C TimeSensor { }\n`
    + 'ROUTE C.fraction_changed TO S.radius\n');
  assert.equal(asDest.destEvent.status, STATUS.INVALID);
  assert.equal(asDest.destEvent.reason, REASON.ROUTE_DEST_NOT_AN_EVENT_IN);
  assert.equal(asDest.destEndpoint.access, ACCESS.FIELD);
});

test('17. an unknown source endpoint is `unknown-field`, never a direction error', () => {
  const a = oneRoute(`${H}DEF Clock TimeSensor { }\nDEF Path ScalarInterpolator { }\n`
    + 'ROUTE Clock.nosuchthing TO Path.set_fraction\n');
  assert.equal(a.sourceEvent.status, STATUS.UNRESOLVED);
  assert.equal(a.sourceEvent.reason, REASON.ROUTE_ENDPOINT_UNKNOWN_FIELD);
  assert.equal(a.sourceEndpoint, null);
});

test('18. an unknown destination endpoint is `unknown-field`', () => {
  const a = oneRoute(`${H}DEF Clock TimeSensor { }\nDEF Path ScalarInterpolator { }\n`
    + 'ROUTE Clock.fraction_changed TO Path.nosuchthing\n');
  assert.equal(a.destEvent.status, STATUS.UNRESOLVED);
  assert.equal(a.destEvent.reason, REASON.ROUTE_ENDPOINT_UNKNOWN_FIELD);
});

test('19. an X3D-only field is NOT a VRML97 ROUTE endpoint', () => {
  // The committed schema carries 232 fields whose `vrml97Declaration` is null.
  // `Transform.visible` is one; it must not leak in as an endpoint merely
  // because the schema knows the name.
  const a = oneRoute(`${H}DEF Clock TimeSensor { }\nDEF T Transform { }\n`
    + 'ROUTE Clock.isActive TO T.visible\n');
  assert.equal(a.destEvent.status, STATUS.UNRESOLVED);
  assert.equal(a.destEvent.reason, REASON.ROUTE_ENDPOINT_UNKNOWN_FIELD);
  assert.equal(a.destEndpoint, null);
});

test('20. a PROTO interface supplies both endpoints, and names the member', () => {
  const src = `${H}PROTO Emitter [ eventOut SFTime fired  eventIn SFTime poke ] {\n`
    + '  Group { }\n}\n'
    + 'DEF A Emitter { }\nDEF B Emitter { }\nROUTE A.fired TO B.poke\n';
  const a = oneRoute(src);
  okBoth(a);
  assert.equal(a.sourceEndpoint.origin, ENDPOINT_ORIGIN.PROTO_INTERFACE);
  assert.equal(a.sourceEndpoint.access, ACCESS.EVENT_OUT);
  assert.equal(a.destEndpoint.origin, ENDPOINT_ORIGIN.PROTO_INTERFACE);
  // A PROTO member IS a lexical declaration, so unlike a built-in it has a
  // symbol -- and it is the exact `InterfaceDecl` the author wrote.
  const decls = [];
  ast.walk(a.parsed.tree, (n) => {
    if (n.type === ast.NODE.INTERFACE && n.name === 'fired') decls.push(n);
  });
  assert.equal(decls.length, 1);
  assert.equal(a.sourceEvent.symbol.node, decls[0]);
  assert.equal(a.verdict.status, STATUS.RESOLVED);
});

test('21. a Script instance\'s own declarations are consulted before clause 6', () => {
  const src = `${H}DEF S Script { eventOut SFTime fired  eventIn SFTime poke  url "x.js" }\n`
    + 'DEF T Script { eventIn SFTime poke  url "y.js" }\n'
    + 'ROUTE S.fired TO T.poke\n';
  const a = oneRoute(src);
  okBoth(a);
  assert.equal(a.sourceEndpoint.origin, ENDPOINT_ORIGIN.SCRIPT_INTERFACE);
  assert.equal(a.destEndpoint.origin, ENDPOINT_ORIGIN.SCRIPT_INTERFACE);
  assert.equal(a.verdict.status, STATUS.RESOLVED);
});

test('22. a Script still falls through to its clause-6 fields', () => {
  // `url` is an exposedField of Script itself (6.40) and no user declaration
  // shadows it here, so it resolves from the schema.
  const src = `${H}DEF S Script { eventOut MFString spat  url "x.js" }\n`
    + 'DEF T Script { url "y.js" }\nROUTE S.spat TO T.set_url\n';
  const a = oneRoute(src);
  okBoth(a);
  assert.equal(a.sourceEndpoint.origin, ENDPOINT_ORIGIN.SCRIPT_INTERFACE);
  assert.equal(a.destEndpoint.origin, ENDPOINT_ORIGIN.BUILTIN_SCHEMA);
  assert.equal(a.destEndpoint.type, 'MFString');
});

test('23. EXTERNPROTO: a locally DECLARED endpoint is positive and usable', () => {
  const src = `${H}EXTERNPROTO Remote [ eventOut SFTime fired  eventIn SFTime poke ] "r.wrl"\n`
    + 'DEF A Remote { }\nDEF B Remote { }\nROUTE A.fired TO B.poke\n';
  const a = oneRoute(src);
  okBoth(a);
  assert.equal(a.sourceEndpoint.origin, ENDPOINT_ORIGIN.EXTERNPROTO_INTERFACE);
  assert.equal(a.sourceEndpoint.access, ACCESS.EVENT_OUT);
  assert.equal(a.verdict.status, STATUS.RESOLVED);
  // 4.9.2 makes the local declaration authoritative for what it DOES state, so
  // this is a full answer reached without loading anything.
});

test('23b. EXTERNPROTO: a locally ABSENT endpoint is `unsupported`, never absent', () => {
  const src = `${H}EXTERNPROTO Remote [ eventIn SFTime poke ] "r.wrl"\n`
    + 'DEF A Remote { }\nDEF B Remote { }\nROUTE A.whatever TO B.poke\n';
  const a = oneRoute(src);
  assert.equal(a.sourceEvent.status, STATUS.UNSUPPORTED);
  assert.equal(a.sourceEvent.reason, REASON.EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE);
  // The words that must NEVER be used here: the declaration may be a strict
  // subset of the implementation's, so local silence is unknowable, not false.
  assert.notEqual(a.sourceEvent.reason, REASON.ROUTE_ENDPOINT_UNKNOWN_FIELD);
  assert.equal(a.verdict.status, STATUS.UNSUPPORTED);
  // The NODE binding survives -- the endpoint being unverifiable says nothing
  // about which declaration `A` names.
  assert.equal(a.sourceNode.status, STATUS.RESOLVED);
});

// ===========================================================================
// 24-28. Type compatibility -- 4.10.2's "shall match exactly"
// ===========================================================================

test('24. equal type tokens are compatible', () => {
  const a = oneRoute(`${H}DEF Clock TimeSensor { }\nDEF Path ScalarInterpolator { }\n`
    + 'ROUTE Clock.fraction_changed TO Path.set_fraction\n');
  assert.equal(a.sourceEndpoint.type, 'SFFloat');
  assert.equal(a.destEndpoint.type, 'SFFloat');
  assert.equal(a.verdict.status, STATUS.RESOLVED);
});

test('25. SFFloat -> SFInt32 is a mismatch (4.10.2\'s own example)', () => {
  const src = `${H}PROTO Sink [ eventIn SFInt32 take ] { Group { } }\n`
    + 'DEF Clock TimeSensor { }\nDEF K Sink { }\n'
    + 'ROUTE Clock.fraction_changed TO K.take\n';
  const a = oneRoute(src);
  okBoth(a);
  assert.equal(a.verdict.status, STATUS.INVALID);
  assert.equal(a.verdict.reason, REASON.ROUTE_TYPE_MISMATCH);
  // Both endpoints are still reported -- the verdict says WHY, not merely NO.
  assert.equal(a.verdict.sourceEndpoint.type, 'SFFloat');
  assert.equal(a.verdict.destinationEndpoint.type, 'SFInt32');
});

test('26. SF -> MF is a mismatch: there is no promotion (4.10.2\'s own example)', () => {
  const src = `${H}PROTO Sink [ eventIn MFFloat take ] { Group { } }\n`
    + 'DEF Clock TimeSensor { }\nDEF K Sink { }\n'
    + 'ROUTE Clock.fraction_changed TO K.take\n';
  const a = oneRoute(src);
  assert.equal(a.verdict.reason, REASON.ROUTE_TYPE_MISMATCH);

  // And the same in the other direction, on real built-ins: SFString -> MFString.
  const strings = `${H}PROTO Src [ eventOut SFString said ] { Group { } }\n`
    + 'DEF S Src { }\nDEF T Text { }\nROUTE S.said TO T.set_string\n';
  const b = oneRoute(strings);
  assert.equal(b.sourceEndpoint.type, 'SFString');
  assert.equal(b.destEndpoint.type, 'MFString');
  assert.equal(b.verdict.reason, REASON.ROUTE_TYPE_MISMATCH);
});

test('27. node-valued endpoints compare by TOKEN, with no look inside', () => {
  // SFNode -> SFNode is compatible whatever the node types involved: 4.10.2
  // imposes no constraint at the ROUTE boundary and inventing one would be
  // interpretation-grade. SFNode -> MFNode is a plain mismatch.
  const ok = `${H}PROTO Src [ eventOut SFNode emitted ] { Group { } }\n`
    + 'PROTO Sink [ eventIn SFNode taken ] { Group { } }\n'
    + 'DEF S Src { }\nDEF K Sink { }\nROUTE S.emitted TO K.taken\n';
  assert.equal(oneRoute(ok).verdict.status, STATUS.RESOLVED);

  const bad = `${H}PROTO Src [ eventOut SFNode emitted ] { Group { } }\n`
    + 'DEF S Src { }\nDEF G Group { }\nROUTE S.emitted TO G.addChildren\n';
  const b = oneRoute(bad);
  assert.equal(b.destEndpoint.type, 'MFNode');
  assert.equal(b.verdict.reason, REASON.ROUTE_TYPE_MISMATCH);
});

test('28. an unidentifiable field type is `type-unknown`, never a silent pass', () => {
  // A PROTO member whose type token is not one of Annex A.2's twenty.
  const src = `${H}PROTO Sink [ eventIn SFWidget take ] { Group { } }\n`
    + 'DEF Clock TimeSensor { }\nDEF K Sink { }\n'
    + 'ROUTE Clock.fraction_changed TO K.take\n';
  const a = oneRoute(src);
  if (a.destEvent.status === STATUS.RESOLVED) {
    assert.equal(a.verdict.status, STATUS.UNRESOLVED);
    assert.equal(a.verdict.reason, REASON.ROUTE_TYPE_UNKNOWN);
  } else {
    // The parser may decline the declaration outright; either way the ROUTE is
    // NOT reported compatible, which is the property under test.
    assert.notEqual(a.verdict.status, STATUS.RESOLVED);
  }
});

// ===========================================================================
// 29-37. Recovery -- the proof gate
// ===========================================================================

test('29. a truncated ROUTE (no TO) yields no confident claim', () => {
  const a = oneRoute(`${H}DEF Clock TimeSensor { }\nROUTE Clock.fraction_changed\n`);
  // The parser recovers a `null` destination rather than inventing a name, so
  // the destination side is INVALID/missing-name -- a token fact, not a lexical
  // claim -- and never a binding.
  assert.equal(a.destNodeRef.name, null);
  assert.equal(a.destNode.symbol, null);
  assert.notEqual(a.verdict.status, STATUS.RESOLVED);
});

test('30. a ROUTE endpoint with no event name is INVALID, not "unknown field"', () => {
  const a = oneRoute(`${H}DEF Clock TimeSensor { }\nDEF Path ScalarInterpolator { }\n`
    + 'ROUTE Clock. TO Path.set_fraction\n');
  assert.equal(a.sourceEventRef.name, null);
  assert.equal(a.sourceEvent.status, STATUS.INVALID);
  assert.equal(a.sourceEvent.reason, REASON.MISSING_NAME);
  assert.notEqual(a.sourceEvent.reason, REASON.ROUTE_ENDPOINT_UNKNOWN_FIELD);
});

test('31. a hard parse cap withholds every ROUTE answer', () => {
  const deep = `${H}${'Group { children [ '.repeat(12)}Shape { }${' ] }'.repeat(12)}\n`
    + 'DEF Clock TimeSensor { }\nDEF Path ScalarInterpolator { }\n'
    + 'ROUTE Clock.fraction_changed TO Path.set_fraction\n';
  const { parsed, graph } = build(deep, { maxDepth: 3 });
  assert.equal(parsed.truncated || parsed.depthCapped, true, 'the cap must actually fire');
  for (const route of routeNodes(parsed)) {
    const a = ask(graph, route);
    assert.equal(a.sourceNode.status, STATUS.RECOVERED);
    assert.equal(a.sourceNode.reason, REASON.DOCUMENT_PARSE_INCOMPLETE);
    assert.equal(a.destNode.status, STATUS.RECOVERED);
    assert.equal(a.verdict.status, STATUS.RECOVERED);
  }
});

test('32. an unresolved node TYPE withholds the endpoint but KEEPS the binding', () => {
  // `Mystery` is neither a built-in nor a declared prototype, so P2A cannot
  // resolve it and the endpoint namespace is a guess. The DEF binding is a
  // different question and is perfectly provable.
  const src = `${H}DEF X Mystery { }\nDEF Path ScalarInterpolator { }\n`
    + 'ROUTE X.something TO Path.set_fraction\n';
  const a = oneRoute(src);
  assert.equal(a.sourceNode.status, STATUS.RESOLVED, 'the NODE binding survives');
  assert.equal(a.sourceNode.symbol.node, defNodes(a.parsed, 'X')[0]);
  assert.equal(a.sourceEvent.status, STATUS.UNRESOLVED);
  assert.equal(a.sourceEvent.reason, REASON.ROUTE_ENDPOINT_NODE_TYPE_UNRESOLVED);
  assert.notEqual(a.sourceEvent.reason, REASON.ROUTE_ENDPOINT_UNKNOWN_FIELD);
});

test('33. a damaged PROTO interface withholds the endpoint it would have supplied', () => {
  // The damage is in a DIFFERENT declaration's interface list from the ROUTE's
  // own scope, so this exercises the interface gate rather than the scope gate.
  const src = `${H}PROTO Sink [ eventIn SFFloat ] { Group { } }\n`
    + 'DEF Clock TimeSensor { }\nDEF K Sink { }\n'
    + 'ROUTE Clock.fraction_changed TO K.take\n';
  const a = oneRoute(src);
  assert.equal(a.destNode.status, STATUS.RESOLVED, 'the NODE binding survives');
  assert.equal(a.destEvent.status, STATUS.RECOVERED);
  assert.equal(a.destEvent.reason, REASON.INTERFACE_SCOPE_NOT_PROVABLE);
  assert.notEqual(a.destEvent.reason, REASON.ROUTE_ENDPOINT_UNKNOWN_FIELD);
});

test('34. unrelated damage does NOT suppress a clean ROUTE', () => {
  // Recovery is attributed to the INNERMOST scope containing the error. A stray
  // error inside a PROTO body must not mark the document scope recovered and
  // silence every honest answer in the file.
  const src = `${H}PROTO P [ ] { Shape { appearance } }\n`
    + 'DEF Clock TimeSensor { }\nDEF Path ScalarInterpolator { }\n'
    + 'ROUTE Clock.fraction_changed TO Path.set_fraction\n';
  const { parsed, graph } = build(src);
  assert.equal(parsed.syntaxDiagnostics.some((d) => d.severity === 'error'), true,
    'the fixture must actually be damaged');
  const a = ask(graph, routeNodes(parsed)[0]);
  assert.equal(a.sourceNode.status, STATUS.RESOLVED);
  assert.equal(a.verdict.status, STATUS.RESOLVED);
});

test('35. a damaged scope cannot manufacture a DIRECTION verdict', () => {
  // With the brace present this ROUTE has a genuine direction error. With it
  // missing the ROUTE is in a scope whose extent cannot be proven, so even the
  // NEGATIVE verdict is unsayable -- an assertion recovery is able to fabricate.
  const clean = `${H}PROTO P [ ] { Shape { } }\nDEF C TimeSensor { }\n`
    + 'DEF I ScalarInterpolator { }\nROUTE I.set_fraction TO C.set_enabled\n';
  assert.equal(oneRoute(clean).verdict.reason, REASON.ROUTE_SOURCE_NOT_AN_EVENT_OUT);

  const damaged = `${H}PROTO P [ ] { Shape { }\nDEF C TimeSensor { }\n`
    + 'DEF I ScalarInterpolator { }\nROUTE I.set_fraction TO C.set_enabled\n';
  const a = oneRoute(damaged);
  assert.equal(a.verdict.status, STATUS.RECOVERED);
  assert.notEqual(a.verdict.reason, REASON.ROUTE_SOURCE_NOT_AN_EVENT_OUT);
});

test('36. a damaged scope cannot manufacture a TYPE mismatch', () => {
  const clean = `${H}PROTO Sink [ eventIn SFInt32 take ] { Group { } }\n`
    + 'PROTO P [ ] { Shape { } }\n'
    + 'DEF C TimeSensor { }\nDEF K Sink { }\nROUTE C.fraction_changed TO K.take\n';
  assert.equal(oneRoute(clean).verdict.reason, REASON.ROUTE_TYPE_MISMATCH);

  const damaged = `${H}PROTO Sink [ eventIn SFInt32 take ] { Group { } }\n`
    + 'PROTO P [ ] { Shape { }\n'
    + 'DEF C TimeSensor { }\nDEF K Sink { }\nROUTE C.fraction_changed TO K.take\n';
  const a = oneRoute(damaged);
  assert.equal(a.verdict.status, STATUS.RECOVERED);
  assert.notEqual(a.verdict.reason, REASON.ROUTE_TYPE_MISMATCH);
});

test('37. a damaged scope cannot bind the WRONG declaration', () => {
  // The failure this whole architecture exists to prevent. With the brace
  // present the document scope holds two `DEF Target`, so the honest answer is
  // `ambiguous`. With it missing, the absorbed PROTO body holds exactly ONE --
  // and because a proto-body has no `defParent`, it is simultaneously blind to
  // the other. A resolver that trusted positives would return one CONFIDENT and
  // WRONG binding.
  const damaged = `${H}DEF Target Transform { }\n`
    + 'PROTO P [ ] { Shape { }\n'
    + 'DEF Target Transform { }\n'
    + 'DEF C TimeSensor { }\n'
    + 'ROUTE C.fraction_changed TO Target.set_translation\n';
  const a = oneRoute(damaged);
  assert.equal(a.destNode.status, STATUS.RECOVERED);
  assert.equal(a.destNode.symbol, null);
});

// ===========================================================================
// 38-42. Structural safety
// ===========================================================================

test('38. no nearest / closest / fuzzy / ranking fallback exists -- source AND behaviour', () => {
  const code = codeOnly(fs.readFileSync(path.join(SRC, 'scope-graph.js'), 'utf8'))
    + codeOnly(fs.readFileSync(path.join(SRC, 'symbols.js'), 'utf8'));
  for (const banned of ['closest', 'nearest', 'fuzzy', 'score', 'ranking', 'bestMatch',
    'similarity', 'levenshtein', 'firstMatch', 'approximate']) {
    assert.equal(new RegExp(banned, 'i').test(code), false,
      `${banned} must not appear in production source`);
  }
  // The recon harness located a ROUTE's scope by innermost containment because
  // it worked from outside the module. That approximation must NOT have reached
  // production: the ROUTE's scope is fixed on descent, so `addRoute` takes it as
  // an argument and computes nothing.
  const graphCode = codeOnly(fs.readFileSync(path.join(SRC, 'scope-graph.js'), 'utf8'));
  const addRoute = graphCode.slice(graphCode.indexOf('addRoute(route, scope)'));
  const body = addRoute.slice(0, addRoute.indexOf('\n  }\n'));
  assert.equal(/contains\s*\(/.test(body), false,
    'addRoute must not search for its scope by containment');

  // Behaviourally: two same-named DEFs in one scope refuse, and adding a third
  // that is a "better" type match changes nothing.
  const src = `${H}DEF N TimeSensor { }\nDEF N Box { }\nDEF P ScalarInterpolator { }\n`
    + 'ROUTE N.fraction_changed TO P.set_fraction\n';
  const a = oneRoute(src);
  assert.equal(a.sourceNode.status, STATUS.AMBIGUOUS);
});

test('39. every ROUTE projection is frozen, opaque and branded', () => {
  const src = `${H}DEF C TimeSensor { }\nDEF P ScalarInterpolator { }\n`
    + 'ROUTE C.fraction_changed TO P.set_fraction\n';
  const { parsed, graph } = build(src);
  const a = ask(graph, routeNodes(parsed)[0]);
  for (const p of [a.sourceNodeRef, a.destNodeRef, a.sourceEventRef, a.destEventRef,
    a.sourceNode, a.destNode, a.sourceEvent, a.destEvent, a.verdict,
    a.sourceEndpoint, a.destEndpoint]) {
    assert.equal(Object.isFrozen(p), true);
  }
  assert.equal(Object.isFrozen(sg.routeReferences(graph)), true);
  assert.equal(Object.isFrozen(sg.routeResolutions(graph)), true);
  // A fresh array each call, so a caller cannot mutate the graph's own list.
  assert.notEqual(sg.routeReferences(graph), sg.routeReferences(graph));
  // Kinds and namespaces are exactly as published.
  assert.equal(a.sourceNodeRef.kind, REFERENCE_KIND.ROUTE_NODE);
  assert.equal(a.sourceNodeRef.namespace, NAMESPACE.NODE_NAME);
  assert.equal(a.sourceEventRef.kind, REFERENCE_KIND.ROUTE_EVENT);
  assert.equal(a.sourceEventRef.namespace, null, 'an event name is not a lexical namespace');
  assert.equal(a.sourceNodeRef.side, SOURCE);
  assert.equal(a.destNodeRef.side, DESTINATION);
});

test('40. reverse indexes contain ONLY fully proven relationships', () => {
  const src = `${H}DEF C TimeSensor { }\nDEF P ScalarInterpolator { }\n`
    + 'DEF Dup TimeSensor { }\nDEF Dup TouchSensor { }\n'
    + 'ROUTE C.fraction_changed TO P.set_fraction\n'   // clean
    + 'ROUTE C.fraction_changed TO P.value_changed\n'  // direction error
    + 'ROUTE C.fraction_changed TO Ghost.set_fraction\n' // unresolved node
    + 'ROUTE Dup.isActive TO P.set_fraction\n';        // ambiguous node
  const { parsed, graph } = build(src);
  const clock = defNodes(parsed, 'C')[0];
  const path0 = defNodes(parsed, 'P')[0];
  const out = sg.routesFrom(graph, clock);
  const inb = sg.routesTo(graph, path0);
  assert.equal(out.length, 1, 'only the clean ROUTE is a proven relationship');
  assert.equal(inb.length, 1);
  assert.equal(out[0].route, routeNodes(parsed)[0]);
  assert.equal(out[0].source, sg.symbolFor(graph, clock));
  assert.equal(out[0].destination, sg.symbolFor(graph, path0));
  assert.equal(Object.isFrozen(out[0]), true);
  // The three rejected ROUTEs are still READABLE, with their status attached --
  // they are excluded from the index, not from the graph.
  assert.equal(sg.routeReferences(graph).length, 16, '4 ROUTEs x 4 references');
});

test('41. ordering is deterministic and source-based', () => {
  const src = `${H}DEF A TimeSensor { }\nDEF B ScalarInterpolator { }\n`
    + 'ROUTE A.fraction_changed TO B.set_fraction\n'
    + 'ROUTE A.isActive TO B.set_fraction\n'
    + 'ROUTE A.cycleTime TO B.set_fraction\n';
  const { parsed, graph } = build(src);
  const events = sg.routeEventReferences(graph);
  // Source-side before destination-side, ROUTEs in source order.
  assert.deepEqual(events.map((r) => r.name),
    ['fraction_changed', 'set_fraction', 'isActive', 'set_fraction',
      'cycleTime', 'set_fraction']);
  assert.deepEqual(events.map((r) => r.side),
    [SOURCE, DESTINATION, SOURCE, DESTINATION, SOURCE, DESTINATION]);
  assert.deepEqual(events.map((r) => r.sourceOrder), [0, 1, 2, 3, 4, 5]);
  // A rebuild over the same text yields the same order.
  const again = sg.buildScopeGraph(parse(src));
  assert.deepEqual(sg.routeEventReferences(again).map((r) => r.name),
    events.map((r) => r.name));
});

test('42. P1 / P2A / P2B result lists are semantically unchanged', () => {
  // The regression that would be invisible in every other test: if a ROUTE's
  // references had joined the DEF/USE or node-type lists, every existing
  // caller's counts would have shifted silently.
  const src = `${H}PROTO Mover [ field SFVec3f offset 0 0 0 ] {\n`
    + '  DEF T Transform { translation IS offset }\n}\n'
    + 'DEF C TimeSensor { }\nDEF M Mover { }\nGroup { children [ USE C ] }\n'
    + 'ROUTE C.fraction_changed TO T.set_translation\n';
  const { graph } = build(src);
  for (const r of sg.references(graph)) assert.equal(r.kind, REFERENCE_KIND.USE);
  for (const r of sg.typeReferences(graph)) assert.equal(r.kind, REFERENCE_KIND.NODE_TYPE);
  for (const r of sg.isReferences(graph)) assert.equal(r.kind, REFERENCE_KIND.IS);
  for (const s of sg.symbols(graph)) assert.equal(s.namespace, NAMESPACE.NODE_NAME);
  assert.equal(sg.references(graph).length, 1, 'exactly the one USE');
  assert.equal(sg.isReferences(graph).length, 1, 'exactly the one IS');
  assert.equal(sg.routeNodeReferences(graph).length, 2);
  // `scopes()` keeps its P1/P2A meaning: a ROUTE opens no scope.
  for (const s of sg.scopes(graph)) {
    assert.equal(['document', 'proto-body'].includes(s.kind), true);
  }
});

// ===========================================================================
// 43-48. Added by the P2C research
// ===========================================================================

test('43. P2C-0: an IS host\'s interface scope is the one the AST proves it owns', () => {
  // THE REFACTOR'S ONE ASSUMPTION, pinned rather than believed.
  //
  // `acquireEndpoint` (P2B) read the target's own Script interface from the `IS`
  // reference's `hostInterfaceScope`; the extracted `acquireEndpointOn` derives
  // it from the AST node instead, because a ROUTE endpoint has no `IS`
  // reference to read it from. If those two ever disagreed, the extraction would
  // have silently changed `IS` behaviour.
  //
  // INDEPENDENCE, and why the obvious test is not good enough. Comparing
  // `reference.hostInterfaceScope` against `interfaceScopeFor(graph, hostNode)`
  // proves almost nothing: both are served by the one internal
  // astNode -> scope map, so the assertion holds even if that map is wrong. It
  // is the same value fetched twice.
  //
  // So the expected owner is derived here from two things that are NOT that
  // map, and `interfaceScopeFor` is deliberately never called:
  //
  //   1. AST CONTAINMENT. The host is found by walking the parse tree for the
  //      node whose own `fields`/`interfaces` physically contain this `IS`.
  //      That is a fact about the text, established without the graph.
  //   2. THE REVERSE PROJECTION. Each published interface scope carries its own
  //      `ownerNode`. Selecting the scope that CLAIMS the AST host, and
  //      asserting exactly one does, is the inverse direction of the lookup
  //      under test -- so a map with a wrong or duplicated entry fails here
  //      instead of agreeing with itself.
  //
  // Fixtures cover every shape an `IS` host takes: a Script with declarations, a
  // Script WITHOUT (no interface scope is created at all, so the honest answer
  // is `null`), a non-Script node (likewise `null`), a nested Script inside a
  // PROTO body, and a Script whose interface is damaged.

  /** The node that physically contains this `IS`, by AST containment alone. */
  const hostByContainment = (parsed, isNode) => {
    let found = null;
    ast.walk(parsed.tree, (n) => {
      if (found || n.type !== ast.NODE.NODE) return;
      for (const child of [].concat(n.fields || [], n.interfaces || [])) {
        if (child === isNode) { found = n; return; }
      }
    });
    return found;
  };

  const fixtures = [
    `${H}PROTO P [ field SFBool go TRUE ] {\n`
      + '  DEF S Script { field SFBool run TRUE  url "x.js"  field SFBool q IS go }\n}\nP { }\n',
    `${H}PROTO P [ field SFBool go TRUE ] {\n`
      + '  Script { url "x.js"  directOutput IS go }\n}\nP { }\n',
    `${H}PROTO P [ field SFVec3f off 0 0 0 ] {\n`
      + '  Transform { translation IS off }\n}\nP { }\n',
    `${H}PROTO Outer [ field SFBool go TRUE ] {\n`
      + '  Group { children [ Script { eventOut SFBool fired  url "x.js"  '
      + 'mustEvaluate IS go } ] }\n}\nOuter { }\n',
    `${H}PROTO P [ field SFBool go TRUE ] {\n`
      + '  Script { eventIn SFBool  url "x.js"  directOutput IS go }\n}\nP { }\n',
  ];
  let checked = 0;
  let withScope = 0;
  let withoutScope = 0;
  for (const src of fixtures) {
    const { parsed, graph } = build(src);
    const refs = sg.isReferences(graph);
    assert.equal(refs.length > 0, true, 'every fixture must carry at least one IS');
    for (const r of refs) {
      // (1) The host, from the text alone.
      const astHost = hostByContainment(parsed, r.node);
      assert.notEqual(astHost, null, 'every IS in these fixtures sits inside a node body');
      assert.equal(r.hostNode, astHost,
        'the reference must name the node that lexically contains it');

      // (2) The scope that claims to own that host, from the published reverse
      // projection -- NOT from interfaceScopeFor.
      const claimants = sg.interfaceScopes(graph).filter((s) => s.ownerNode === astHost);
      assert.equal(claimants.length <= 1, true,
        `exactly one interface scope may own a host, saw ${claimants.length}`);
      const expected = claimants.length === 1 ? claimants[0] : null;

      assert.equal(r.hostInterfaceScope, expected,
        'hostInterfaceScope must be the scope the AST host is independently shown to own');
      if (expected) {
        assert.equal(expected.kind, sg.SCOPE_KIND.SCRIPT_INTERFACE,
          'only a Script instance owns an interface scope of its own');
        withScope += 1;
      } else {
        withoutScope += 1;
      }
      checked += 1;
    }
  }
  assert.equal(checked >= 5, true, `expected at least 5 IS hosts, saw ${checked}`);
  // Both outcomes must be exercised, or the assertion above could pass by
  // always comparing null to null.
  assert.equal(withScope >= 1, true, 'a Script host with its own interface scope');
  assert.equal(withoutScope >= 1, true, 'a host that owns no interface scope at all');
});

test('44. R19: the fallback fires even when the written name exists as a `field`', () => {
  // THE OWNER-ADJUDICATED CASE. 4.10.2's condition is that an eventIn/eventOut
  // OF THAT NAME is not found -- the lookup is direction-specific. A `field zzz`
  // is not an eventIn, so the required event was NOT found and `set_zzz` is
  // tried. Stopping at the field because the spelling matched would read a
  // condition the clause does not state.
  const src = `${H}PROTO N [ field SFFloat zzz 0  eventIn SFFloat set_zzz  `
    + 'eventOut SFFloat zzz_changed ] { Group { } }\n'
    + 'DEF X N { }\nDEF Y N { }\nROUTE X.zzz TO Y.zzz\n';
  const a = oneRoute(src);
  okBoth(a);
  // Source: `zzz` exists as a field -> falls through to `zzz_changed`.
  assert.equal(a.sourceEndpoint.effectiveName, 'zzz_changed');
  assert.equal(a.sourceEndpoint.access, ACCESS.EVENT_OUT);
  assert.equal(a.sourceEvent.detail, REASON.ROUTE_ENDPOINT_VIA_SHORTHAND);
  // Destination: same, to `set_zzz`.
  assert.equal(a.destEndpoint.effectiveName, 'set_zzz');
  assert.equal(a.destEndpoint.access, ACCESS.EVENT_IN);
  assert.equal(a.destEvent.detail, REASON.ROUTE_ENDPOINT_VIA_SHORTHAND);
  assert.equal(a.verdict.status, STATUS.RESOLVED);

  // THE OTHER READING, pinned so the choice stays visible rather than
  // incidental: had the fallback stopped at the field, both sides would have
  // been direction errors. This asserts the rejected outcome did NOT occur.
  assert.notEqual(a.sourceEvent.reason, REASON.ROUTE_SOURCE_NOT_AN_EVENT_OUT);
  assert.notEqual(a.destEvent.reason, REASON.ROUTE_DEST_NOT_AN_EVENT_IN);
});

test('44b. R19: with no fallback event anywhere, the field IS a direction error', () => {
  // The boundary of the decision above. `zzz` exists only as a field and no
  // `set_zzz` / `zzz_changed` is declared, so the fallback finds nothing and the
  // honest answer is the direction failure -- NOT a binding of the field as an
  // event, and NOT `unknown-field`, because the name was found.
  const src = `${H}PROTO N [ field SFFloat zzz 0 ] { Group { } }\n`
    + 'DEF X N { }\nDEF Y N { }\nROUTE X.zzz TO Y.zzz\n';
  const a = oneRoute(src);
  assert.equal(a.sourceEvent.status, STATUS.INVALID);
  assert.equal(a.sourceEvent.reason, REASON.ROUTE_SOURCE_NOT_AN_EVENT_OUT);
  assert.equal(a.sourceEndpoint.access, ACCESS.FIELD);
  assert.equal(a.destEvent.status, STATUS.INVALID);
  assert.equal(a.destEvent.reason, REASON.ROUTE_DEST_NOT_AN_EVENT_IN);
});

test('44c. R19: an EXTERNPROTO miss does NOT license the fallback', () => {
  // The safety edge of the same decision. Absence from an EXTERNPROTO
  // declaration is unknowable (4.9.2), so the fallback's precondition -- that
  // the required event was NOT FOUND -- is unproven. Falling back anyway could
  // bind `set_zzz` in an implementation that also declares a real `eventIn zzz`,
  // which is a WRONG endpoint binding.
  const src = `${H}EXTERNPROTO E [ eventIn SFFloat set_zzz ] "e.wrl"\n`
    + 'DEF C TimeSensor { }\nDEF Y E { }\nROUTE C.fraction_changed TO Y.zzz\n';
  const a = oneRoute(src);
  assert.equal(a.destEvent.status, STATUS.UNSUPPORTED);
  assert.equal(a.destEvent.reason, REASON.EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE);
  assert.equal(a.destEndpoint, null, 'no endpoint may be bound through an unproven fallback');
});

test('45. R12 candidate ORDER: the written name beats the alias when both resolve', () => {
  // 4.10.2 says try the written name FIRST and only THEN the alias. A set-based
  // or alias-first lookup would silently lose that, and both spellings resolve
  // here, so only the order distinguishes them.
  const src = `${H}PROTO N [ eventOut SFFloat zzz  eventOut SFBool zzz_changed  `
    + 'eventIn SFFloat zzz2  eventIn SFBool set_zzz2 ] { Group { } }\n'
    + 'DEF X N { }\nDEF Y N { }\nROUTE X.zzz TO Y.zzz2\n';
  const a = oneRoute(src);
  okBoth(a);
  // The WRITTEN `zzz` (SFFloat) wins over the also-present `zzz_changed`
  // (SFBool). The types differ precisely so a wrong pick is visible.
  assert.equal(a.sourceEndpoint.effectiveName, 'zzz');
  assert.equal(a.sourceEndpoint.type, 'SFFloat');
  assert.equal(a.sourceEvent.detail, null, 'no fallback was needed');
  assert.equal(a.destEndpoint.effectiveName, 'zzz2');
  assert.equal(a.destEndpoint.type, 'SFFloat');
  assert.equal(a.destEvent.detail, null);
  assert.equal(a.verdict.status, STATUS.RESOLVED);
});

test('46. R5: a DEF written AFTER the ROUTE is distinguishable from never-declared', () => {
  // Two different facts, two different reasons. 4.10.2 requires the definition
  // to PRECEDE the ROUTE statement.
  const later = `${H}DEF Path ScalarInterpolator { }\n`
    + 'ROUTE Clock.fraction_changed TO Path.set_fraction\n'
    + 'DEF Clock TimeSensor { }\n';
  const a = oneRoute(later);
  assert.equal(a.sourceNode.status, STATUS.UNRESOLVED);
  assert.equal(a.sourceNode.reason, REASON.ROUTE_NODE_NOT_DEFINED_BEFORE_ROUTE);
  assert.equal(a.sourceNode.candidateCount, 1);
  assert.equal(a.sourceNode.symbol, null, 'a later declaration is not a binding');

  const never = `${H}DEF Path ScalarInterpolator { }\n`
    + 'ROUTE Clock.fraction_changed TO Path.set_fraction\n';
  const b = oneRoute(never);
  assert.equal(b.sourceNode.reason, REASON.DEF_NOT_DECLARED_IN_SCOPE);
  assert.notEqual(b.sourceNode.reason, a.sourceNode.reason);
});

test('46b. R5 uses the ROUTE STATEMENT\'s start, so a DEF just before it is visible', () => {
  const src = `${H}DEF Path ScalarInterpolator { } DEF Clock TimeSensor { } `
    + 'ROUTE Clock.fraction_changed TO Path.set_fraction\n';
  const a = oneRoute(src);
  assert.equal(a.sourceNode.status, STATUS.RESOLVED);
  assert.equal(a.destNode.status, STATUS.RESOLVED);
  // Both sides share the STATEMENT's offset, not their own name tokens'.
  assert.equal(a.sourceNodeRef.offset, a.destNodeRef.offset);
  assert.equal(a.sourceNodeRef.offset, a.route.range.start.offset);
});

test('47. a `route-node` that fails NEVER yields an endpoint reason', () => {
  // §7's independence requirement, stated as a prohibition. When the node is
  // unbound there is no interface to consult, so any endpoint claim -- positive
  // or negative -- would be a fabrication.
  const cases = [
    // unresolved node
    `${H}DEF P ScalarInterpolator { }\nROUTE Ghost.fraction_changed TO P.set_fraction\n`,
    // ambiguous node
    `${H}DEF N TimeSensor { }\nDEF N TouchSensor { }\nDEF P ScalarInterpolator { }\n`
      + 'ROUTE N.fraction_changed TO P.set_fraction\n',
    // declared only later
    `${H}DEF P ScalarInterpolator { }\nROUTE N.fraction_changed TO P.set_fraction\n`
      + 'DEF N TimeSensor { }\n',
  ];
  const endpointReasons = new Set([
    REASON.ROUTE_ENDPOINT_UNKNOWN_FIELD,
    REASON.ROUTE_SOURCE_NOT_AN_EVENT_OUT,
    REASON.ROUTE_DEST_NOT_AN_EVENT_IN,
    REASON.ROUTE_ENDPOINT_NODE_TYPE_UNRESOLVED,
  ]);
  for (const src of cases) {
    const a = oneRoute(src);
    assert.notEqual(a.sourceNode.status, STATUS.RESOLVED);
    assert.equal(endpointReasons.has(a.sourceEvent.reason), false,
      `an unbound node must not produce ${a.sourceEvent.reason}`);
    // The event answer simply CARRIES the node's own answer forward.
    assert.equal(a.sourceEvent.status, a.sourceNode.status);
    assert.equal(a.sourceEvent.reason, a.sourceNode.reason);
    assert.equal(a.sourceEndpoint, null);
  }
});

test('48. a ROUTE in a node body binds in the ENCLOSING scope, not in the node', () => {
  // Annex A's `nodeBodyElement` admits a ROUTE wherever fields may appear, and
  // the parser collects it into `node.fields`. Iterating `fields` as if every
  // entry were a field silently drops it -- which cost the research spike 5,444
  // real ROUTEs before it was caught. It opens no scope of its own either.
  const src = `${H}DEF C TimeSensor { }\nDEF P ScalarInterpolator { }\n`
    + 'Group { children [ Shape { } ]\n'
    + '  ROUTE C.fraction_changed TO P.set_fraction\n}\n';
  const { parsed, graph } = build(src);
  const routes = routeNodes(parsed);
  assert.equal(routes.length, 1, 'the body ROUTE must not be dropped');
  const a = ask(graph, routes[0]);
  assert.equal(a.sourceNode.status, STATUS.RESOLVED);
  assert.equal(a.sourceNode.symbol.node, defNodes(parsed, 'C')[0]);
  assert.equal(a.verdict.status, STATUS.RESOLVED);
  // The DOCUMENT scope owns it -- a node body is not a DEF scope.
  assert.equal(a.sourceNodeRef.scope, sg.documentScope(graph));

  // And the same inside an MFNode array, which the parser accepts leniently as a
  // Cybertown/Blaxxun compatibility measure.
  const inArray = `${H}DEF C TimeSensor { }\nDEF P ScalarInterpolator { }\n`
    + 'Group { children [ Shape { } ROUTE C.fraction_changed TO P.set_fraction ] }\n';
  const two = build(inArray);
  const arrayRoutes = routeNodes(two.parsed);
  assert.equal(arrayRoutes.length, 1);
  assert.equal(sg.routeNodeReferences(two.graph).length, 2,
    'a ROUTE in an MFNode array must still project');
  assert.equal(ask(two.graph, arrayRoutes[0]).verdict.status, STATUS.RESOLVED);
});

// ===========================================================================
// 49. Mutation -- every gate is load-bearing, or its redundancy is pinned
// ===========================================================================

test('49. each recovery gate and ordering rule is killed by a mutation', () => {
  const file = path.join(SRC, 'scope-graph.js');
  const original = fs.readFileSync(file, 'utf8');

  function mutateInFunction(source, fnName, from, to) {
    const start = source.indexOf(`function ${fnName}(`);
    assert.notEqual(start, -1, `${fnName} must exist`);
    const end = source.indexOf('\n}\n', start) + 3;
    const body = source.slice(start, end);
    const hits = body.split(from).length - 1;
    assert.equal(hits, 1, `"${from}" must appear exactly once in ${fnName}, saw ${hits}`);
    return source.slice(0, start) + body.replace(from, to) + source.slice(end);
  }

  function load(mutated) {
    assert.notEqual(mutated, original, 'the mutation must actually change the source');
    const m = new Module(file, null);
    m.filename = file;
    m.paths = Module._nodeModulePaths(path.dirname(file));
    m._compile(mutated, file);
    return m.exports;
  }

  // G2 -- the ROUTE's own enclosing DEF scope, and WHAT IT UNIQUELY DEFENDS.
  //
  // Worth stating precisely, because the obvious fixture does NOT kill it. On a
  // POSITIVE binding G2 is doubly defended: `guardLexical` independently
  // downgrades a `resolved` answer whose scope is unprovable, so removing G2
  // leaves the confidently-wrong binding of test 37 still prevented. That is a
  // real second line of defence and is asserted below rather than glossed over.
  //
  // What G2 uniquely supplies is the NEGATIVE and AMBIGUOUS claims, which
  // `guardLexical` never sees because they never reach `resolved`. Two `DEF
  // Path` written in DIFFERENT scopes get absorbed into one by an unclosed
  // body; without G2 the resolver asserts a duplicate the author never wrote.
  const g2Sg = load(mutateInFunction(original, 'routeChainWithholds',
    'scope && scope.recovered', 'false'));

  const fabricateSrc = `${H}PROTO P [ ] { Shape { } DEF Path ScalarInterpolator { }\n`
    + 'DEF Clock TimeSensor { }\nDEF Path ScalarInterpolator { }\n'
    + 'ROUTE Clock.fraction_changed TO Path.set_fraction\n';
  const fabParsed = parse(fabricateSrc);
  const fabRoute = routeNodes(fabParsed)[0];
  const fabCleanGraph = sg.buildScopeGraph(fabParsed);
  const fabClean = sg.resolveRouteNode(fabCleanGraph,
    sg.routeNodeReferenceFor(fabCleanGraph, fabRoute, DESTINATION));
  const fabBrokenGraph = g2Sg.buildScopeGraph(fabParsed);
  const fabBroken = g2Sg.resolveRouteNode(fabBrokenGraph,
    g2Sg.routeNodeReferenceFor(fabBrokenGraph, fabRoute, DESTINATION));
  assert.equal(fabClean.status, STATUS.RECOVERED, 'G2: the unmutated resolver withholds');
  assert.equal(fabBroken.status, STATUS.AMBIGUOUS,
    'G2 is load-bearing: without it a damaged scope FABRICATES a duplicate');

  // The second line of defence on the positive path, pinned so its existence is
  // a recorded fact rather than a lucky accident.
  const bindSrc = `${H}DEF Target Transform { }\nPROTO P [ ] { Shape { }\n`
    + 'DEF Target Transform { }\nDEF C TimeSensor { }\n'
    + 'ROUTE C.fraction_changed TO Target.set_translation\n';
  const bindParsed = parse(bindSrc);
  const bindRoute = routeNodes(bindParsed)[0];
  const bindBrokenGraph = g2Sg.buildScopeGraph(bindParsed);
  const bindBroken = g2Sg.resolveRouteNode(bindBrokenGraph,
    g2Sg.routeNodeReferenceFor(bindBrokenGraph, bindRoute, DESTINATION));
  assert.equal(bindBroken.status, STATUS.RECOVERED,
    'guardLexical independently prevents a confident binding from a damaged scope');
  assert.equal(bindBroken.symbol, null);

  // G1 -- a hard parse cap. HONESTLY REDUNDANT BY CONSTRUCTION for ROUTE, and
  // recorded as such rather than given a ceremonial kill.
  //
  // P2B's G1 at least owned its REASON: removing it there degraded
  // `document-parse-incomplete` into a vaguer one. ROUTE's does not even do
  // that, because `markRecovery`'s cap branch sets BOTH `recovered` AND the
  // reason `document-parse-incomplete` on EVERY scope -- so G2 fires next and
  // returns a byte-identical answer. The mutation is genuinely unobservable.
  //
  // It is kept anyway, for the reason G3 is kept in `interfaceChainWithholds`:
  // the redundancy is a property of that blanket pass, not of the rule. Narrow
  // the cap's attribution and this becomes the live guard. THE ENABLING
  // INVARIANT IS PINNED HERE, so if it ever stops holding this test says so
  // rather than a gap opening silently.
  const cappedSrc = `${H}${'Group { children [ '.repeat(12)}Shape { }${' ] }'.repeat(12)}\n`
    + 'DEF C TimeSensor { }\nDEF P ScalarInterpolator { }\n'
    + 'ROUTE C.fraction_changed TO P.set_fraction\n';
  const cappedParsed = parse(cappedSrc, { maxDepth: 3 });
  assert.equal(cappedParsed.truncated || cappedParsed.depthCapped, true);
  const cappedGraph = sg.buildScopeGraph(cappedParsed);
  // The invariant: a hard cap marks EVERY lexical scope recovered, WITH the
  // document-parse-incomplete reason -- which is exactly what makes G1's
  // condition unobservable behind G2.
  for (const s of sg.scopes(cappedGraph)) {
    assert.equal(s.recovered, true, 'the cap must blanket-mark every scope');
    assert.equal(s.recoveredReason, REASON.DOCUMENT_PARSE_INCOMPLETE);
  }
  const g1Sg = load(mutateInFunction(original, 'routeChainWithholds',
    'state.documentIncomplete', 'false'));
  const g1Graph = g1Sg.buildScopeGraph(cappedParsed);
  const g1Route = routeNodes(cappedParsed)[0];
  const g1Broken = g1Sg.resolveRouteNode(g1Graph,
    g1Sg.routeNodeReferenceFor(g1Graph, g1Route, DESTINATION));
  const g1Clean = sg.resolveRouteNode(cappedGraph,
    sg.routeNodeReferenceFor(cappedGraph, g1Route, DESTINATION));
  assert.equal(g1Clean.status, STATUS.RECOVERED);
  assert.equal(g1Clean.reason, REASON.DOCUMENT_PARSE_INCOMPLETE);
  // Subsumed, stated outright: the mutant answers IDENTICALLY. Asserting a kill
  // here would be theatre.
  assert.equal(g1Broken.status, g1Clean.status, 'G1 is subsumed by G2, as documented');
  assert.equal(g1Broken.reason, g1Clean.reason);

  // The R12 candidate ORDER is load-bearing too, and it is not a gate -- swap
  // the two candidates and test 45's fixture binds the wrong declaration.
  const swapped = mutateInFunction(original, 'shorthandNameFor',
    'return side === sym.ROUTE_SIDE.SOURCE ? `${name}_changed` : `set_${name}`;',
    'return name;');
  const swappedSg = load(swapped);
  const orderSrc = `${H}PROTO N [ eventOut SFFloat zzz  eventOut SFBool zzz_changed ] `
    + '{ Group { } }\nDEF X N { }\nDEF Y N { }\nROUTE X.zzz TO Y.zzz\n';
  const orderParsed = parse(orderSrc);
  const orderGraph = swappedSg.buildScopeGraph(orderParsed);
  const orderRoute = routeNodes(orderParsed)[0];
  // With the fallback neutered the SOURCE still binds `zzz` directly (it is a
  // legal eventOut), which is exactly why the order test above uses a fixture
  // where both spellings resolve -- the mutation must be observable somewhere,
  // and it is: the DESTINATION loses its only route to an eventIn.
  const destAnswer = swappedSg.resolveRouteEndpoint(orderGraph,
    swappedSg.routeEventReferenceFor(orderGraph, orderRoute, DESTINATION));
  assert.notEqual(destAnswer.status, STATUS.RESOLVED,
    'neutering the fallback must be observable');
});

// ===========================================================================
// 50. Lane boundary
// ===========================================================================

test('50. P2C is consumer-free, performs no I/O, and changes no predecessor', () => {
  // No module outside this lane requires the scope graph, and the facade stays
  // shut. P4 is the integration lane; this one ends at `scope-graph.js`.
  for (const file of ['analyze.js', 'node-identity.js', 'document-transaction.js',
    'parser.js', 'tokenizer.js', 'ast.js', 'source-map.js', 'edit.js']) {
    const other = fs.readFileSync(path.join(SRC, file), 'utf8');
    assert.equal(/require\(['"]\.\/scope-graph['"]\)/.test(other), false,
      `${file} must not require scope-graph`);
  }
  // `index.js` IS the one exception, and only since WD1.6-B: it requires the
  // scope graph solely to assemble the narrowed `interfaceQuery` sub-object.
  // The boundary this test defends is unchanged and is asserted positively
  // below -- the substrate is still not published, and still has no consumer
  // inside the application.
  const indexSrc = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
  assert.equal(/interfaceQuery/.test(indexSrc), true,
    'index.js may require scope-graph only for the WD1.6-B consumer facade');
  for (const name of ['resolveIs', 'isConnectionVerdict', 'resolveRouteEndpoint',
    'interfaceMembers', 'symbols', 'scopes', 'references', 'resolutions']) {
    assert.equal(name in require('../../src/vrml').interfaceQuery, false,
      `${name} must not reach the facade through interfaceQuery`);
  }
  const facade = require('../../src/vrml');
  for (const name of ['routeReferences', 'resolveRouteNode', 'resolveRouteEndpoint',
    'routeVerdict', 'routesFrom', 'routesTo', 'buildScopeGraph']) {
    assert.equal(name in facade, false, `${name} must not be exposed through the facade`);
  }
  // No I/O of any kind -- an EXTERNPROTO's URL is never fetched to settle an
  // endpoint, which is what makes `unsupported` the only honest answer for one.
  const code = codeOnly(fs.readFileSync(path.join(SRC, 'scope-graph.js'), 'utf8'));
  for (const banned of ['require(\'fs\')', 'require("fs")', 'fetch(', 'XMLHttpRequest',
    'readFile', 'https']) {
    assert.equal(code.includes(banned), false, `${banned} must not appear`);
  }
  // The parser, the AST and the committed schema are untouched INPUTS. If P2C
  // had needed to change any of them it would have been a separate lane.
  assert.equal(sg.buildScopeGraph.length, 1);
});
