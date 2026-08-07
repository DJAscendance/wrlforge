'use strict';
// WD1.5-P2C -- adversarial controls: proof that every zero-count detector fires.
//
// WHY THIS FILE EXISTS. The corpus reports 0 direction violations and 0 wrong
// bindings. A zero is only evidence if the thing counting it can count. A
// detector that is broken, unreachable, or silently short-circuited reports the
// same zero as a detector that looked and found nothing, and the two are
// indistinguishable from the number alone.
//
// So each control is an AUTHORED input, written here from the clause text and
// copied from nothing, that MUST make one specific classifier report non-zero.
// A control that stops firing is a harness failure, reported as loudly as a
// wrong binding -- it means a later corpus zero has become meaningless.
//
// These run through the PRODUCTION path, exactly as the corpus sweep does.

const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const corpus = require('./corpus');
const { parse } = require(path.join(REPO_ROOT, 'src', 'vrml'));
const sg = require(path.join(REPO_ROOT, 'src', 'vrml', 'scope-graph.js'));

const { STATUS, REASON, ROUTE_SIDE } = sg;

const HEADER = '#VRML V2.0 utf8\n';

/**
 * Run one authored source through the production path and hand every ROUTE's
 * six answers to a predicate.
 */
function observe(text) {
  const parsed = parse(HEADER + text);
  const graph = sg.buildScopeGraph(parsed);
  const out = [];
  corpus.forEachRoute(parsed.tree, (astRoute) => {
    const srcNodeRef = sg.routeNodeReferenceFor(graph, astRoute, ROUTE_SIDE.SOURCE);
    const dstNodeRef = sg.routeNodeReferenceFor(graph, astRoute, ROUTE_SIDE.DESTINATION);
    const srcEvtRef = sg.routeEventReferenceFor(graph, astRoute, ROUTE_SIDE.SOURCE);
    const dstEvtRef = sg.routeEventReferenceFor(graph, astRoute, ROUTE_SIDE.DESTINATION);
    if (!srcNodeRef || !dstNodeRef || !srcEvtRef || !dstEvtRef) return;
    out.push({
      srcNode: sg.resolveRouteNode(graph, srcNodeRef),
      dstNode: sg.resolveRouteNode(graph, dstNodeRef),
      srcEvt: sg.resolveRouteEndpoint(graph, srcEvtRef),
      dstEvt: sg.resolveRouteEndpoint(graph, dstEvtRef),
      srcEndpoint: sg.routeEndpointFor(graph, srcEvtRef),
      dstEndpoint: sg.routeEndpointFor(graph, dstEvtRef),
      verdict: sg.routeVerdict(graph, astRoute),
    });
  });
  return out;
}

// A tiny assertion vocabulary, so a control reads as its claim.
const is = (res, status, reason) => !!res && res.status === status && res.reason === reason;

const CONTROLS = [
  {
    id: 'forward-def-reference',
    detector: 'R5 -- node not defined before the ROUTE',
    // 4.10.2: "nodes referenced in a ROUTE statement shall be defined before the
    // ROUTE statement". The declaration exists, in this very scope, but LATER --
    // a different fact from never having been written here at all.
    source: `
DEF X Transform {}
ROUTE Later.isActive TO X.set_translation
DEF Later TimeSensor {}
`,
    expect: (o) => is(o[0].srcNode, STATUS.UNRESOLVED, REASON.ROUTE_NODE_NOT_DEFINED_BEFORE_ROUTE),
  },
  {
    id: 'duplicate-def',
    detector: 'duplicate DEF in scope -> ambiguous, never ranked',
    // 4.6.2 defines closest-preceding for USE. P2C deliberately does NOT
    // implement it: ranking candidates is WD.md §7's banned failure mode.
    source: `
DEF T TimeSensor {}
DEF T TimeSensor {}
DEF X Transform {}
ROUTE T.isActive TO X.set_translation
`,
    expect: (o) => is(o[0].srcNode, STATUS.AMBIGUOUS, REASON.DUPLICATE_DEF_IN_SCOPE)
      && o[0].srcNode.symbol == null,
  },
  {
    id: 'direction-source-not-event-out',
    detector: 'R10 -- source side named something that is not an eventOut',
    // TimeSensor.startTime is an exposedField, so `set_startTime` is its eventIn
    // alias. Used as a ROUTE SOURCE it cannot serve, and no `set_startTime_changed`
    // exists to rescue it.
    source: `
DEF T TimeSensor {}
DEF X Transform {}
ROUTE T.set_startTime TO X.set_translation
`,
    expect: (o) => is(o[0].srcEvt, STATUS.INVALID, REASON.ROUTE_SOURCE_NOT_AN_EVENT_OUT),
  },
  {
    id: 'direction-dest-not-event-in',
    detector: 'R10 -- destination side named something that is not an eventIn',
    source: `
DEF A TimeSensor {}
DEF T TimeSensor {}
ROUTE A.isActive TO T.isActive
`,
    expect: (o) => is(o[0].dstEvt, STATUS.INVALID, REASON.ROUTE_DEST_NOT_AN_EVENT_IN),
  },
  {
    id: 'field-as-event',
    detector: 'a declared `field` is never a ROUTE endpoint',
    // A Script field, with no alias of any kind to fall back to.
    source: `
DEF S Script { field SFInt32 counter 0 url [] }
DEF X Transform {}
ROUTE S.counter TO X.set_translation
`,
    expect: (o) => is(o[0].srcEvt, STATUS.INVALID, REASON.ROUTE_SOURCE_NOT_AN_EVENT_OUT),
  },
  {
    id: 'type-mismatch',
    detector: 'R11 -- types shall match EXACTLY',
    source: `
DEF T TimeSensor {}
DEF X Transform {}
ROUTE T.fraction_changed TO X.set_translation
`,
    expect: (o) => is(o[0].verdict, STATUS.INVALID, REASON.ROUTE_TYPE_MISMATCH),
  },
  {
    id: 'shorthand-source',
    detector: 'R12 -- bare source name falls back to `zzz_changed` (ROUTE only)',
    // TimeSensor declares `fraction_changed` as an eventOut. The author wrote
    // the bare `fraction`, which 4.10.2 permits for ROUTE and 4.8.3 does NOT
    // permit for IS -- the rule that makes ROUTE differ from `IS`.
    source: `
DEF T TimeSensor {}
DEF S Script { eventIn SFFloat take url [] }
ROUTE T.fraction TO S.take
`,
    expect: (o) => o[0].srcEvt.status === STATUS.RESOLVED
      && o[0].srcEndpoint.name === 'fraction'
      && o[0].srcEndpoint.effectiveName === 'fraction_changed',
  },
  {
    id: 'shorthand-destination',
    detector: 'R12 -- bare destination name falls back to `set_zzz`',
    source: `
DEF T TimeSensor {}
DEF S Script { eventIn SFBool set_go url [] }
ROUTE T.isActive TO S.go
`,
    expect: (o) => o[0].dstEvt.status === STATUS.RESOLVED
      && o[0].dstEndpoint.name === 'go'
      && o[0].dstEndpoint.effectiveName === 'set_go',
  },
  {
    id: 'r19-fallback-past-wrong-kind',
    detector: 'R19 -- the written name EXISTS but is a `field`, so the fallback still applies',
    // Owner adjudication, 2026-08-07: the lookup is direction-specific, so a
    // written `zzz` found only as a field has NOT found the required event.
    // Both names are declared, so the exact spelling is found and rejected on
    // KIND -- this is the case a name-only lookup would get wrong.
    source: `
DEF T TimeSensor {}
DEF S Script { field SFBool zzz FALSE eventIn SFBool set_zzz url [] }
ROUTE T.isActive TO S.zzz
`,
    expect: (o) => o[0].dstEvt.status === STATUS.RESOLVED
      && o[0].dstEndpoint.effectiveName === 'set_zzz'
      && o[0].dstEndpoint.access === 'eventIn',
  },
  {
    id: 'unknown-endpoint',
    detector: 'a resolved interface genuinely has no such member',
    source: `
DEF T TimeSensor {}
DEF X Transform {}
ROUTE T.noSuchEventAnywhere TO X.set_translation
`,
    expect: (o) => is(o[0].srcEvt, STATUS.UNRESOLVED, REASON.ROUTE_ENDPOINT_UNKNOWN_FIELD),
  },
  {
    id: 'externproto-unsupported',
    detector: '4.9.2 -- local absence in an EXTERNPROTO is UNKNOWABLE, never false',
    // The declaration may be a strict subset of the implementation's, and the
    // URL is never loaded. `unsupported`, never `unresolved`.
    source: `
EXTERNPROTO Widget [ eventIn SFBool declared ] "widget.wrl"
DEF T TimeSensor {}
DEF W Widget {}
ROUTE T.isActive TO W.notDeclaredLocally
`,
    expect: (o) => is(o[0].dstEvt, STATUS.UNSUPPORTED,
      REASON.EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE),
  },
  {
    id: 'externproto-declared-resolves',
    detector: '4.9.2 asymmetry -- what an EXTERNPROTO DOES declare binds normally',
    source: `
EXTERNPROTO Widget [ eventIn SFBool declared ] "widget.wrl"
DEF T TimeSensor {}
DEF W Widget {}
ROUTE T.isActive TO W.declared
`,
    expect: (o) => o[0].dstEvt.status === STATUS.RESOLVED
      && o[0].dstEndpoint.origin === 'externproto-interface',
  },
  {
    id: 'nested-proto-isolation',
    detector: '4.8.4 -- a PROTO body DEF is invisible outside it, in both directions',
    // Disjointness, not shadowing: the outward lookup has no parent to walk to
    // and simply stops.
    //
    // The resolver distinguishes two shades of "not here" and reports the
    // SHARPER one: `def-not-visible-across-proto-boundary` rather than the
    // generic `def-not-declared-in-scope`. It knows the name IS declared, just
    // behind a boundary 4.8.4 makes impassable, and saying so is strictly more
    // information at the same confidence. Either reason satisfies this control;
    // what it actually pins is that the lookup REFUSES and binds nothing.
    source: `
PROTO P [] { DEF Inner TimeSensor {} }
DEF X Transform {}
ROUTE Inner.isActive TO X.set_translation
`,
    expect: (o) => o[0].srcNode.status === STATUS.UNRESOLVED
      && o[0].srcNode.symbol == null
      && (o[0].srcNode.reason === REASON.DEF_NOT_VISIBLE_ACROSS_PROTO_BOUNDARY
        || o[0].srcNode.reason === REASON.DEF_NOT_DECLARED_IN_SCOPE),
  },
  {
    id: 'recovered-scope-withholds',
    detector: 'a damaged scope withholds EVERY lexical answer, positive included',
    // An unclosed PROTO absorbs the statements that follow it, so the absorbed
    // scope sees a declaration set that never existed. The binding below looks
    // unique and must NOT be returned.
    source: `
PROTO P [] { Group { children [
DEF T TimeSensor {}
ROUTE T.isActive TO T.set_enabled
`,
    expect: (o) => o.length > 0 && o[0].srcNode.status === STATUS.RECOVERED
      && o[0].srcNode.symbol == null,
  },
];

/**
 * Run every control. Returns one record per control plus an overall pass flag.
 *
 * A control that THROWS is a failure, not an error to swallow -- the harness's
 * own reachability proof has broken.
 */
function runControls() {
  const results = CONTROLS.map((c) => {
    let observed = null;
    let passed = false;
    let error = null;
    try {
      observed = observe(c.source);
      passed = !!c.expect(observed);
    } catch (err) {
      error = String(err && err.message).slice(0, 200);
    }
    return {
      id: c.id,
      detector: c.detector,
      passed,
      error,
      // A compact, path-free trace so a reviewer can see WHAT fired, not just
      // that something did.
      observed: (observed || []).map((o) => ({
        srcNode: `${o.srcNode.status}/${o.srcNode.reason}`,
        dstNode: `${o.dstNode.status}/${o.dstNode.reason}`,
        srcEvt: `${o.srcEvt.status}/${o.srcEvt.reason}`,
        dstEvt: `${o.dstEvt.status}/${o.dstEvt.reason}`,
        srcEndpoint: o.srcEndpoint
          ? `${o.srcEndpoint.name}->${o.srcEndpoint.effectiveName}:${o.srcEndpoint.access}:${o.srcEndpoint.type}` : null,
        dstEndpoint: o.dstEndpoint
          ? `${o.dstEndpoint.name}->${o.dstEndpoint.effectiveName}:${o.dstEndpoint.access}:${o.dstEndpoint.type}` : null,
        verdict: `${o.verdict.status}/${o.verdict.reason}`,
      })),
    };
  });
  return { results, allPassed: results.every((r) => r.passed) };
}

module.exports = { CONTROLS, observe, runControls };
