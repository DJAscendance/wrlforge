'use strict';
// Structured semantic findings tests (Phase WD1.6-D).
//
// A SEPARATE FILE from the WD1.6-A/B/C suites, for the reason every WD1.5/WD1.6
// lane before it gave: D is purely additive, so an UNCHANGED predecessor suite
// is this lane's primary evidence that it added a projection rather than a
// second authority.
//
// WHAT THIS FILE IS ACTUALLY PROVING. A findings model is a place where two
// things go wrong quietly, so the assertions are aimed at both:
//
//   1. PRESENTATION LEAKING IN. A severity, a message or a visibility flag
//      arriving in the semantic record is unrecoverable for a consumer -- once a
//      fact is pre-judged, the judgement cannot be undone downstream. Proven
//      absent by shape, by source scan, by the absence of any adapter, and by a
//      MUTANT that adds one and is caught.
//   2. CERTAINTY BEING MANUFACTURED. A recovered, ambiguous, unsupported or
//      unresolved substrate answer becoming a confident claim about the standard
//      is the WD1.4/WD1.5 failure mode in a new costume. Proven absent by
//      carrying the substrate's own status verbatim, by a total ISO table that
//      classifies every recovery reason as `NOT_STATED`, and by MUTANTS that
//      collapse a status or hard-code an ISO verdict and are caught.
//
// Fixtures are string literals original to this lane; nothing under `spikes/` is
// imported, and no White Dune material contributed to any expectation here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const vrml = require('../../src/vrml');
const { parse, ast } = vrml;
const sg = require('../../src/vrml/scope-graph');
const nodeSchema = require('../../src/vrml/node-schema');
const containment = require('../../src/vrml/containment');
const interfaceQuery = require('../../src/vrml/interface-query');
const semanticFindings = require('../../src/vrml/semantic-findings');

const {
  findingsForDocument, FINDING_CODE, ISO_RESULT, ISO_BY_REASON,
} = semanticFindings;
const { STATUS, REASON } = sg;

const H = '#VRML V2.0 utf8\n';
const MODULE_PATH = path.join(__dirname, '../../src/vrml/semantic-findings.js');
const SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');

/**
 * The module's CODE, with comment lines removed.
 *
 * Several scans below assert that a concept is absent. The module's header
 * deliberately DISCUSSES those concepts -- it explains why there is no severity
 * and why no compatibility profile is named -- and that explanation is the
 * documentation a future reader needs. Scanning the raw file would forbid the
 * comment along with the code, so the scans read this instead.
 */
const codeOnly = (src) => src.split('\n')
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n');
const CODE = codeOnly(SOURCE);

/** Parse + build a graph + collect findings, with a finder over the tree. */
function doc(text) {
  const parsed = parse(H + text);
  const graph = sg.buildScopeGraph(parsed);
  const find = (predicate) => {
    let hit = null;
    ast.walk(parsed.tree, (n) => { if (!hit && predicate(n)) hit = n; });
    return hit;
  };
  return {
    parsed,
    graph,
    find,
    node: (nodeType, skip = 0) => {
      let seen = 0;
      return find((n) => n.type === 'Node' && n.nodeType === nodeType && seen++ === skip);
    },
    findings: () => findingsForDocument(graph),
    of: (code) => findingsForDocument(graph).filter((f) => f.code === code),
    one: (code) => {
      const hits = findingsForDocument(graph).filter((f) => f.code === code);
      assert.equal(hits.length, 1, `expected exactly one ${code}, got ${hits.length}`);
      return hits[0];
    },
  };
}

// ---------------------------------------------------------------------------
// The fixture corpus this file reasons over as a whole.
//
// Several assertions below are INVARIANTS rather than single expectations --
// "no finding anywhere ever does X". They run over every fixture here, so
// adding one strengthens them automatically.
// ---------------------------------------------------------------------------

const FIXTURES = Object.freeze({
  unboundUse: 'Group { children [ USE Nothing ] }',
  ambiguousDef: 'Group { children [ DEF A Group {}, DEF A Group {}, USE A ] }',
  useBeforeDef: 'Group { children [ USE A, DEF A Group {} ] }',
  protoBoundary: 'DEF Outside Group {}\nPROTO P [] { Group { children [ USE Outside ] } }\nP {}',
  unknownType: 'Nope { }',
  shadowingProto: 'PROTO Transform [ field SFBool x TRUE ] { Group {} }\nTransform {}',
  recursiveProto: 'PROTO R [] { Group { children [ R {} ] } }\nR {}',
  earlyInstance: 'PROTO Q [] { Group { children [ Q2 {} ] } }\nPROTO Q2 [] { Group {} }\nQ {}',
  isUnknownMember: 'PROTO P [ field SFBool a TRUE ] { Transform { translation IS nope } }\nP {}',
  isAccessBad: 'PROTO P [ exposedField SFBool a TRUE ] { Group { addChildren IS a } }\nP {}',
  isTypeBad: 'PROTO P [ field SFBool a TRUE ] { Transform { translation IS a } }\nP {}',
  isEndpointUnknown: 'PROTO P [ field SFBool a TRUE ] { Transform { nosuch IS a } }\nP {}',
  isDoubleBound: 'PROTO P [ field SFBool a TRUE field SFBool b TRUE ] { Group { visible IS a  visible IS b } }\nP {}',
  isValuedAndBound: 'PROTO P [ field SFVec3f a 0 0 0 ] { Transform { translation 1 1 1  translation IS a } }\nP {}',
  isOutsideProto: 'Transform { translation IS somewhere }',
  externProtoIs: 'EXTERNPROTO E [ field SFBool a ] "e.wrl"\nPROTO P [ field SFBool a TRUE ] { E { b IS a } }\nP {}',
  scriptExposedField: 'DEF S Script { exposedField SFBool oops FALSE }',
  interfaceIs: 'PROTO P [ field SFBool a IS b ] { Group {} }\nP {}',
  routeGhostNode: 'DEF T Transform {}\nROUTE Ghost.a TO T.set_translation',
  routeUnknownEvent: 'DEF T Transform {}\nROUTE T.nosuch TO T.set_translation',
  routeDirection: 'DEF T Transform {}\nDEF U Transform {}\nROUTE T.bboxSize TO U.set_translation',
  routeTypeMismatch: 'DEF T Transform {}\nDEF C Color {}\nROUTE T.translation_changed TO C.set_color',
  routeBeforeDef: 'ROUTE T.translation_changed TO T.set_translation\nDEF T Transform {}',
  illegalChild: 'Shape { appearance Box {} }',
  recovered: 'PROTO P [ field SFBool a TRUE ] { Group { children [ USE Missing\nDEF B Group {}',
  clean: 'DEF T Transform { children [ Shape { geometry Box {} } ] }\nROUTE T.translation_changed TO T.set_translation',
});

// A PROTO field whose DEFAULT VALUE is a node that itself hosts a placement.
// The inner `Shape { geometry Box {} }` is the position WD1.6-B is structurally
// unable to answer about, and it only becomes reachable if the traversal is
// widened -- so it must be a PARENT, not merely a node.
const PROTO_DEFAULT_FIXTURE = 'PROTO P [ field SFNode thing Shape { geometry Box {} } ] { Group {} }\nP {}';

const allFindings = () => Object.entries(FIXTURES)
  .flatMap(([name, text]) => doc(text).findings().map((f) => ({ name, f })));

/** Compile a MUTATED copy of the module without touching the repository. */
function loadMutant(mutate) {
  const mutated = mutate(SOURCE);
  assert.notEqual(mutated, SOURCE, 'the mutation did not change the source');
  const m = new Module(MODULE_PATH, module);
  m.filename = MODULE_PATH;
  m.paths = Module._nodeModulePaths(path.dirname(MODULE_PATH));
  m._compile(mutated, MODULE_PATH);
  return m.exports;
}

// ---------------------------------------------------------------------------
// 1. Taxonomy and facade
// ---------------------------------------------------------------------------

test('01 ISO_RESULT is three values and none of them is a STATUS', () => {
  assert.deepEqual(Object.keys(ISO_RESULT).sort(), ['NOT_STATED', 'PROHIBITED', 'UNDEFINED']);
  // The two axes must stay distinguishable at a glance in a consumer's switch:
  // a shared string would make `f.iso === STATUS.UNRESOLVED` accidentally
  // meaningful.
  for (const v of Object.values(ISO_RESULT)) {
    assert.ok(!Object.values(STATUS).includes(v), `${v} collides with a STATUS`);
  }
  assert.ok(Object.isFrozen(ISO_RESULT));
});

test('02 finding codes are stable, unique, and are not severities or messages', () => {
  const values = Object.values(FINDING_CODE);
  assert.equal(new Set(values).size, values.length, 'duplicate finding code');
  const severityWords = new Set(['error', 'warning', 'info', 'hint', 'critical', 'notice']);
  for (const v of values) {
    assert.match(v, /^[a-z][a-z0-9-]*$/, `${v} is not a stable machine code`);
    assert.ok(!severityWords.has(v), `${v} is a severity name`);
    assert.ok(!v.includes(' '), `${v} reads like prose`);
  }
  assert.ok(Object.isFrozen(FINDING_CODE));
});

test('03 the facade publishes exactly the intended surface', () => {
  assert.deepEqual(
    Object.keys(vrml.semanticFindings).sort(),
    ['FINDING_CODE', 'ISO_RESULT', 'findingsForDocument'],
  );
  assert.ok(Object.isFrozen(vrml.semanticFindings));
  // The classification table is the module's REASONING, not its contract.
  assert.equal(vrml.semanticFindings.ISO_BY_REASON, undefined);
  // And the substrate stays where it was: D publishes no second copy of the
  // status/reason vocabulary under its own name.
  assert.equal(vrml.semanticFindings.STATUS, undefined);
  assert.equal(vrml.semanticFindings.REASON, undefined);
  assert.equal(vrml.symbols, undefined);
  assert.equal(vrml.scopeGraph, undefined);
});

test('04 a foreign or absent graph fails loudly rather than answering nothing', () => {
  for (const bad of [null, undefined, {}, Object.freeze({}), 'graph', 42]) {
    assert.throws(() => findingsForDocument(bad), (err) => err.code === sg.SCOPE_ERROR.GRAPH);
  }
});

// ---------------------------------------------------------------------------
// 2. Presentation separation -- the record carries facts, never judgements
// ---------------------------------------------------------------------------

const FINDING_KEYS = [
  'code', 'compatibility', 'confidence', 'detail', 'evidence', 'iso', 'range', 'reason', 'rule', 'subject',
];

test('10 a finding has exactly the semantic keys and no presentation key', () => {
  const f = doc(FIXTURES.unboundUse).one(FINDING_CODE.USE_NOT_BOUND);
  assert.deepEqual(Object.keys(f).sort(), FINDING_KEYS);
  for (const banned of ['severity', 'message', 'visible', 'presentationHint', 'hint',
    'importance', 'suppressed', 'label', 'title', 'icon', 'color']) {
    assert.ok(!(banned in f), `finding exposes ${banned}`);
    assert.ok(!(banned in f.subject), `subject exposes ${banned}`);
  }
});

test('11 EVERY finding from EVERY fixture has the same key set -- no producer adds one', () => {
  const seen = allFindings();
  assert.ok(seen.length > 20, `expected a broad fixture sweep, got ${seen.length}`);
  for (const { name, f } of seen) {
    assert.deepEqual(Object.keys(f).sort(), FINDING_KEYS, `${name}/${f.code}`);
  }
});

test('12 the module names no presentation concept in its own source', () => {
  // Comments are exempt: the header explains WHY these are absent, which is the
  // documentation a future reader needs. Only CODE is scanned.
  for (const banned of [/\bseverity\b/, /\bmakeDiagnostic\b/, /\bpresentationHint\b/,
    /\bvisible\b/, /\bsuppress/, /SEVERITY/]) {
    assert.ok(!banned.test(CODE), `semantic-findings.js code mentions ${banned}`);
  }
});

test('13 there is no adapter: the module never reaches diagnostics.js', () => {
  // `diagnostics.makeDiagnostic` takes severity FIRST and a human message THIRD.
  // A module that cannot see it cannot grow a default for either.
  const requires = SOURCE.match(/require\(['"][^'"]+['"]\)/g) || [];
  assert.deepEqual(requires.sort(), [
    "require('./ast')", "require('./containment')", "require('./scope-graph')",
  ]);
});

test('14 CONSUMER PROOF (P4): severity and wording are chosen outside the model', () => {
  // A REFERENCE consumer, not production code. It stands in for P4 and shows the
  // three decisions D refuses to make being made here, from D's facts.
  const d = doc(FIXTURES.isAccessBad + '\n' + FIXTURES.unboundUse);
  const settings = { showUnprovable: false };
  const emitted = [];
  for (const f of d.findings()) {
    // 1. Suppression -- P4's call, expressible in one line because `confidence`
    //    is separate from `iso`.
    if (!settings.showUnprovable && f.confidence !== STATUS.RESOLVED
      && f.iso === ISO_RESULT.NOT_STATED) continue;
    // 2. Severity -- chosen HERE, from the ISO axis, by this consumer.
    const severity = f.iso === ISO_RESULT.PROHIBITED ? 'error'
      : f.iso === ISO_RESULT.UNDEFINED ? 'warning'
        : 'info';
    // 3. Wording -- composed HERE, from the citation and the effective interface
    //    query WD2 also uses. D supplied neither string.
    const where = f.rule ? `${f.rule.standard} ${f.rule.clause}` : 'no cited rule';
    emitted.push({ severity, code: f.code, text: `${where}: ${f.subject.name}`, range: f.range });
  }
  assert.ok(emitted.length >= 2);
  assert.ok(emitted.some((e) => e.severity === 'error'));
  for (const e of emitted) assert.ok(e.range && e.range.start);
  // The severities exist only in the consumer's own array; nothing in the model
  // knows about them.
  for (const f of d.findings()) assert.equal(f.severity, undefined);
});

test('15 CONSUMER PROOF (WD2): the inspector path needs no finding at all', () => {
  // WD1.6-B/C's consumer path, re-run against the shipped API to confirm D did
  // not make an authoring consumer depend on diagnostics or findings.
  const d = doc('DEF T Transform { children [ Shape {} ] }');
  const parentNode = d.node('Transform');
  const iface = interfaceQuery.effectiveInterfaceOf(d.graph, parentNode);
  assert.equal(iface.status, STATUS.RESOLVED);
  assert.ok(iface.members.length > 0);
  // Selected node -> effective interface -> constraints, exactly WD1.6-B's
  // published projection. `constraints` may be null, which PERMITS (WD1.6-A
  // §6.2); what matters here is that the whole chain is reachable.
  const children = iface.byName.children;
  assert.ok(children && children.status === STATUS.RESOLVED);
  assert.ok(children.member && children.member.vrml97Legal);
  assert.ok('constraints' in children.member);
  // ...and containment from C -- with no findings module anywhere in the chain.
  const verdict = containment.childLegality(d.graph, parentNode, 'children', d.node('Shape'));
  assert.equal(verdict.status, containment.CONTAINMENT_STATUS.LEGAL);
  assert.equal(verdict.severity, undefined);
});

// ---------------------------------------------------------------------------
// 3. The ISO axis -- a positive claim about the standard, never a fallback
// ---------------------------------------------------------------------------

test('20 the ISO table is TOTAL over the substrate\'s REASON vocabulary', () => {
  // The guard that makes `isoFor`'s weak-claim fallback a backstop rather than a
  // silent shrug: a REASON added to `symbols.js` fails here until classified.
  const unmapped = Object.entries(REASON).filter(([, v]) => !(v in ISO_BY_REASON));
  assert.deepEqual(unmapped, [], `unclassified reasons: ${unmapped.map(([k]) => k)}`);
  const extra = Object.keys(ISO_BY_REASON).filter((v) => !Object.values(REASON).includes(v));
  assert.deepEqual(extra, [], `table classifies non-reasons: ${extra}`);
});

test('21 a claim about the standard always cites the standard', () => {
  for (const [reason, entry] of Object.entries(ISO_BY_REASON)) {
    if (entry.iso === ISO_RESULT.NOT_STATED) {
      assert.equal(entry.rule, null, `${reason} asserts nothing but cites something`);
      continue;
    }
    assert.ok(entry.rule, `${reason} claims ${entry.iso} with no citation`);
    assert.equal(entry.rule.standard, 'ISO/IEC 14772-1');
    assert.match(entry.rule.clause, /^(\d+(\.\d+)*|A\.\d+)$/, `${reason}: odd clause`);
    assert.ok(entry.rule.description.length > 10);
    assert.ok(Object.isFrozen(entry.rule));
  }
});

test('22 every recovery reason asserts NOTHING about the standard', () => {
  // Parser recovery MOVES scope boundaries. A finding built on a recovered
  // answer must never carry a normative accusation, however the reason reads.
  for (const reason of [REASON.DOCUMENT_PARSE_INCOMPLETE, REASON.SCOPE_RECOVERED,
    REASON.PROTO_SCOPE_NOT_PROVABLE, REASON.PROTO_BODY_NOT_PROVABLE,
    REASON.INTERFACE_SCOPE_NOT_PROVABLE, REASON.INTERFACE_NOT_PROVABLE_FOR_REFERENCE]) {
    assert.equal(ISO_BY_REASON[reason].iso, ISO_RESULT.NOT_STATED, reason);
  }
});

test('23 EXTERNPROTO silence is unknowable, never a violation', () => {
  // 4.9.2: a local EXTERNPROTO declaration may be a strict subset of the
  // implementation's, so an absent member proves nothing about the document.
  assert.equal(
    ISO_BY_REASON[REASON.EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE].iso,
    ISO_RESULT.NOT_STATED,
  );
  const d = doc(FIXTURES.externProtoIs);
  const hits = d.of(FINDING_CODE.IS_CONNECTION_REJECTED);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].confidence, STATUS.UNSUPPORTED);
  assert.equal(hits[0].reason, REASON.EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE);
  assert.equal(hits[0].iso, ISO_RESULT.NOT_STATED);
  assert.equal(hits[0].rule, null);
});

test('24 WRL Forge\'s own strictness gap is not blamed on the standard', () => {
  // 4.6.2 DEFINES the duplicate-DEF binding (closest preceding). It is this tool
  // that declines to rank, so the finding is uncertain and the standard is
  // silent -- not "the document is wrong".
  const f = doc(FIXTURES.ambiguousDef).one(FINDING_CODE.USE_NOT_BOUND);
  assert.equal(f.confidence, STATUS.AMBIGUOUS);
  assert.equal(f.reason, REASON.DUPLICATE_DEF_IN_SCOPE);
  assert.equal(f.iso, ISO_RESULT.NOT_STATED);
  assert.equal(f.rule, null);
});

test('25 CONTROL: `iso` is a pure function of `reason` for every finding produced', () => {
  // The invariant that keeps the two axes independent. If any producer ever
  // computed an ISO result of its own -- from the status, from a compatibility
  // slot, from anything -- this diverges.
  for (const { name, f } of allFindings()) {
    if (f.code === FINDING_CODE.CHILD_NOT_PERMITTED) {
      // The one producer whose citation comes from WD1.6-C's OWN verdict rather
      // than the table, because C already knows which rule excluded the child.
      assert.equal(f.iso, ISO_RESULT.PROHIBITED, name);
      assert.ok(f.rule && f.rule.standard === 'ISO/IEC 14772-1', name);
      const known = Object.values(nodeSchema.constraintRules).some(
        (r) => r.clause === f.rule.clause && r.description === f.rule.description,
      );
      assert.ok(known, `${name}: containment cited a rule the schema does not record`);
      continue;
    }
    const expected = ISO_BY_REASON[f.reason];
    assert.ok(expected, `${name}: ${f.reason} is unclassified`);
    assert.equal(f.iso, expected.iso, `${name}/${f.code}/${f.reason}`);
    assert.equal(f.rule, expected.rule, `${name}/${f.code}: rule is not the table's`);
  }
});

test('26 the two ISO_RESULT terminal values are both actually produced', () => {
  const isos = new Set(allFindings().map(({ f }) => f.iso));
  assert.ok(isos.has(ISO_RESULT.PROHIBITED));
  assert.ok(isos.has(ISO_RESULT.UNDEFINED));
  assert.ok(isos.has(ISO_RESULT.NOT_STATED));
});

// ---------------------------------------------------------------------------
// 4. Compatibility -- a reserved slot, never a guessed name
// ---------------------------------------------------------------------------

test('30 every finding\'s compatibility slot is null -- NOT EVALUATED', () => {
  for (const { name, f } of allFindings()) {
    assert.equal(f.compatibility, null, `${name}/${f.code} evaluated a compatibility profile`);
  }
});

test('31 no compatibility-profile identifier exists in the module or the facade', () => {
  // WD1.6 §22.4 deferred the naming to this lane; this lane declines to guess
  // it. Whether a historical construct is Blaxxun-, GLView- or Cybertown-
  // specific is an EVIDENCE question, and none of those names may become
  // accidental API in the meantime.
  const facade = fs.readFileSync(path.join(__dirname, '../../src/vrml/index.js'), 'utf8');
  for (const banned of [/cybertown-compat/i, /blaxxun/i, /glview/i, /vendor-extension/i,
    /legacy-vrml/i, /['"][a-z0-9-]*compat[a-z0-9-]*['"]/i]) {
    assert.ok(!banned.test(CODE), `semantic-findings.js code names ${banned}`);
    assert.ok(!banned.test(codeOnly(facade)), `index.js code names ${banned}`);
  }
  // And no profile value is reachable through the published API.
  const values = JSON.stringify([FINDING_CODE, ISO_RESULT]);
  assert.ok(!/compat|blaxxun|cybertown|vendor/i.test(values));
});

test('32 a finding is frozen, so a compatibility layer cannot rewrite ISO truth', () => {
  const f = doc(FIXTURES.isAccessBad).one(FINDING_CODE.IS_CONNECTION_REJECTED);
  assert.equal(f.iso, ISO_RESULT.PROHIBITED);
  assert.ok(Object.isFrozen(f));
  assert.ok(Object.isFrozen(f.subject));
  assert.ok(Object.isFrozen(f.evidence));
  assert.ok(Object.isFrozen(f.rule));
  assert.throws(() => { 'use strict'; f.iso = ISO_RESULT.NOT_STATED; }, TypeError);
  assert.throws(() => { 'use strict'; f.compatibility = { profile: 'anything' }; }, TypeError);
  assert.equal(f.iso, ISO_RESULT.PROHIBITED);
});

// ---------------------------------------------------------------------------
// 5. Uncertainty survives, exactly as the substrate stated it
// ---------------------------------------------------------------------------

test('40 all five non-resolved statuses reach a finding, distinctly', () => {
  const byStatus = new Map();
  for (const { f } of allFindings()) {
    if (!byStatus.has(f.confidence)) byStatus.set(f.confidence, []);
    byStatus.get(f.confidence).push(f);
  }
  for (const status of [STATUS.UNRESOLVED, STATUS.UNSUPPORTED, STATUS.AMBIGUOUS,
    STATUS.INVALID, STATUS.RECOVERED, STATUS.RESOLVED]) {
    assert.ok(byStatus.has(status), `no finding ever carried ${status}`);
  }
  // None of them was rewritten into a generic UNKNOWN on the way out.
  for (const { f } of allFindings()) {
    assert.ok(Object.values(STATUS).includes(f.confidence), `${f.confidence} is not a STATUS`);
  }
});

test('41 a recovered scope never yields a claim about the standard', () => {
  const recovered = allFindings().filter(({ f }) => f.confidence === STATUS.RECOVERED);
  assert.ok(recovered.length > 0, 'the recovery fixture produced nothing to check');
  for (const { name, f } of recovered) {
    assert.equal(f.iso, ISO_RESULT.NOT_STATED, `${name}/${f.code} accused a damaged parse`);
    assert.equal(f.rule, null);
  }
});

test('42 a finding never contradicts the verdict it came from', () => {
  // The substrate is right and a derivation that disagrees has a bug. Checked by
  // re-asking the SAME authority for every reference-shaped finding.
  const d = doc(FIXTURES.unboundUse + '\n' + FIXTURES.routeGhostNode
    + '\n' + FIXTURES.isUnknownMember + '\n' + FIXTURES.unknownType);
  let checked = 0;
  for (const f of d.findings()) {
    const ref = f.subject.reference;
    if (!ref) continue;
    let answer = null;
    if (f.code === FINDING_CODE.USE_NOT_BOUND || f.code === FINDING_CODE.NODE_TYPE_NOT_BOUND) {
      answer = sg.resolve(d.graph, ref);
    } else if (f.code === FINDING_CODE.IS_TARGET_NOT_BOUND) {
      answer = sg.resolveIs(d.graph, ref);
    } else if (f.code === FINDING_CODE.ROUTE_NODE_NOT_BOUND) {
      answer = sg.resolveRouteNode(d.graph, ref);
    } else if (f.code === FINDING_CODE.ROUTE_ENDPOINT_NOT_BOUND) {
      answer = sg.resolveRouteEndpoint(d.graph, ref);
    } else if (f.code === FINDING_CODE.IS_CONNECTION_REJECTED) {
      answer = sg.isConnectionVerdict(d.graph, ref);
    }
    if (!answer) continue;
    checked += 1;
    assert.equal(f.confidence, answer.status, `${f.code} rewrote the status`);
    assert.equal(f.reason, answer.reason, `${f.code} rewrote the reason`);
    assert.equal(f.detail, answer.detail == null ? null : answer.detail);
  }
  assert.ok(checked >= 4, `expected several verdicts re-checked, got ${checked}`);
});

test('43 a containment finding never contradicts childLegality', () => {
  const d = doc(FIXTURES.illegalChild);
  const f = d.one(FINDING_CODE.CHILD_NOT_PERMITTED);
  const verdict = containment.childLegality(d.graph, f.subject.parent, f.subject.name, f.subject.node);
  assert.equal(verdict.status, containment.CONTAINMENT_STATUS.ILLEGAL);
  assert.equal(f.reason, verdict.reason);
  assert.equal(f.confidence, STATUS.RESOLVED);
});

// ---------------------------------------------------------------------------
// 6. Producers -- what is reported, and what deliberately is not
// ---------------------------------------------------------------------------

test('50 a clean document produces no findings at all', () => {
  assert.deepEqual(doc(FIXTURES.clean).findings(), []);
});

const PRODUCER_CASES = [
  [FIXTURES.unboundUse, FINDING_CODE.USE_NOT_BOUND, REASON.DEF_NOT_DECLARED_IN_SCOPE, ISO_RESULT.PROHIBITED],
  [FIXTURES.useBeforeDef, FINDING_CODE.USE_NOT_BOUND, REASON.USE_BEFORE_DEF, ISO_RESULT.PROHIBITED],
  [FIXTURES.protoBoundary, FINDING_CODE.USE_NOT_BOUND, REASON.DEF_NOT_VISIBLE_ACROSS_PROTO_BOUNDARY, ISO_RESULT.PROHIBITED],
  [FIXTURES.unknownType, FINDING_CODE.NODE_TYPE_NOT_BOUND, REASON.NODE_TYPE_UNKNOWN, ISO_RESULT.PROHIBITED],
  [FIXTURES.recursiveProto, FINDING_CODE.NODE_TYPE_NOT_BOUND, REASON.RECURSIVE_PROTO_INSTANCE, ISO_RESULT.PROHIBITED],
  [FIXTURES.earlyInstance, FINDING_CODE.NODE_TYPE_NOT_BOUND, REASON.PROTO_INSTANCE_BEFORE_DECLARATION, ISO_RESULT.PROHIBITED],
  [FIXTURES.shadowingProto, FINDING_CODE.NODE_TYPE_SHADOWS_BUILTIN, REASON.PROTO_SHADOWS_BUILTIN, ISO_RESULT.UNDEFINED],
  [FIXTURES.isUnknownMember, FINDING_CODE.IS_TARGET_NOT_BOUND, REASON.INTERFACE_MEMBER_NOT_DECLARED, ISO_RESULT.PROHIBITED],
  [FIXTURES.isOutsideProto, FINDING_CODE.IS_TARGET_NOT_BOUND, REASON.IS_OUTSIDE_PROTO_BODY, ISO_RESULT.PROHIBITED],
  [FIXTURES.isAccessBad, FINDING_CODE.IS_CONNECTION_REJECTED, REASON.IS_ACCESS_INCOMPATIBLE, ISO_RESULT.PROHIBITED],
  [FIXTURES.isTypeBad, FINDING_CODE.IS_CONNECTION_REJECTED, REASON.IS_TYPE_MISMATCH, ISO_RESULT.PROHIBITED],
  [FIXTURES.isEndpointUnknown, FINDING_CODE.IS_CONNECTION_REJECTED, REASON.IS_ENDPOINT_UNKNOWN_FIELD, ISO_RESULT.PROHIBITED],
  [FIXTURES.isDoubleBound, FINDING_CODE.IS_BINDING_ISSUE, REASON.DUPLICATE_IS_FOR_ENDPOINT, ISO_RESULT.UNDEFINED],
  [FIXTURES.isValuedAndBound, FINDING_CODE.IS_BINDING_ISSUE, REASON.FIELD_VALUED_AND_IS, ISO_RESULT.UNDEFINED],
  [FIXTURES.scriptExposedField, FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING, REASON.EXPOSED_FIELD_IN_SCRIPT_INTERFACE, ISO_RESULT.PROHIBITED],
  [FIXTURES.interfaceIs, FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING, REASON.IS_IN_INTERFACE_DECLARATION_LIST, ISO_RESULT.PROHIBITED],
  [FIXTURES.routeGhostNode, FINDING_CODE.ROUTE_NODE_NOT_BOUND, REASON.DEF_NOT_DECLARED_IN_SCOPE, ISO_RESULT.PROHIBITED],
  [FIXTURES.routeBeforeDef, FINDING_CODE.ROUTE_NODE_NOT_BOUND, REASON.ROUTE_NODE_NOT_DEFINED_BEFORE_ROUTE, ISO_RESULT.PROHIBITED],
  [FIXTURES.routeUnknownEvent, FINDING_CODE.ROUTE_ENDPOINT_NOT_BOUND, REASON.ROUTE_ENDPOINT_UNKNOWN_FIELD, ISO_RESULT.PROHIBITED],
  [FIXTURES.routeDirection, FINDING_CODE.ROUTE_ENDPOINT_NOT_BOUND, REASON.ROUTE_SOURCE_NOT_AN_EVENT_OUT, ISO_RESULT.PROHIBITED],
  [FIXTURES.routeTypeMismatch, FINDING_CODE.ROUTE_CONNECTION_REJECTED, REASON.ROUTE_TYPE_MISMATCH, ISO_RESULT.PROHIBITED],
  [FIXTURES.illegalChild, FINDING_CODE.CHILD_NOT_PERMITTED, null, ISO_RESULT.PROHIBITED],
];

test('51 every producer emits its finding with the substrate\'s own reason', () => {
  const covered = new Set();
  for (const [text, code, reason, iso] of PRODUCER_CASES) {
    const hits = doc(text).of(code);
    assert.ok(hits.length >= 1, `${code} not produced for: ${text.slice(0, 50)}`);
    const hit = reason ? hits.find((f) => f.reason === reason) : hits[0];
    assert.ok(hit, `${code} produced no ${reason}`);
    assert.equal(hit.iso, iso, `${code}/${hit.reason}`);
    assert.ok(hit.range && hit.range.start && typeof hit.range.start.offset === 'number');
    covered.add(code);
  }
  // Every published code is exercised, so none is a name with nothing behind it.
  assert.deepEqual(
    Object.values(FINDING_CODE).filter((c) => !covered.has(c)), [],
  );
});

test('52 containment contributes ILLEGAL and nothing else', () => {
  // Uncertain containment is a fact about WHAT WRL FORGE REPRESENTS, or a
  // restatement of a P1/P2A failure already reported at the same position.
  // Neither belongs in a per-placement report about the author's document.
  const uncertain = doc('PROTO P [ field SFNode slot NULL ] { Group {} }\nP { slot Box {} }');
  assert.deepEqual(uncertain.of(FINDING_CODE.CHILD_NOT_PERMITTED), []);
  const unknownChildType = doc('Group { children [ Mystery {} ] }');
  assert.deepEqual(unknownChildType.of(FINDING_CODE.CHILD_NOT_PERMITTED), []);
  // ...and the underlying type failure IS reported, once, by its own producer.
  assert.equal(unknownChildType.of(FINDING_CODE.NODE_TYPE_NOT_BOUND).length, 1);
  for (const { f } of allFindings()) {
    if (f.code !== FINDING_CODE.CHILD_NOT_PERMITTED) continue;
    assert.equal(f.confidence, STATUS.RESOLVED);
  }
});

test('53 the placement traversal does not enter a PROTO interface default value', () => {
  // A node written as a PROTO field's DEFAULT is not a scene-graph placement:
  // P2A indexes no type reference for it and WD1.6-B throws ESCOPEPARSE on it.
  // Inherited from WD1.6-C's harness; asserted here because the traversal is now
  // production code.
  const d = doc(PROTO_DEFAULT_FIXTURE);
  assert.deepEqual(d.findings(), []);
});

test('54 de-duplication: one underlying fact produces exactly one finding', () => {
  // Rule 1 -- `computeIsVerdict` mirrors a failed right-hand resolution.
  const isCase = doc(FIXTURES.isUnknownMember);
  assert.equal(isCase.of(FINDING_CODE.IS_TARGET_NOT_BOUND).length, 1);
  assert.deepEqual(isCase.of(FINDING_CODE.IS_CONNECTION_REJECTED), []);

  // Rule 2 -- `resolveRouteEndpoint` propagates its node's status unchanged.
  const routeCase = doc(FIXTURES.routeGhostNode);
  assert.equal(routeCase.of(FINDING_CODE.ROUTE_NODE_NOT_BOUND).length, 1);
  assert.deepEqual(routeCase.of(FINDING_CODE.ROUTE_ENDPOINT_NOT_BOUND), []);

  // Rule 3 -- `routeVerdict` mirrors the earliest failing sub-answer.
  assert.deepEqual(routeCase.of(FINDING_CODE.ROUTE_CONNECTION_REJECTED), []);
  const eventCase = doc(FIXTURES.routeUnknownEvent);
  assert.equal(eventCase.of(FINDING_CODE.ROUTE_ENDPOINT_NOT_BOUND).length, 1);
  assert.deepEqual(eventCase.of(FINDING_CODE.ROUTE_CONNECTION_REJECTED), []);
  // ...and the type comparison, which nothing else answers, IS reported.
  assert.equal(doc(FIXTURES.routeTypeMismatch).of(FINDING_CODE.ROUTE_CONNECTION_REJECTED).length, 1);
});

// ---------------------------------------------------------------------------
// 7. Projection discipline -- derived, disposable, deterministic
// ---------------------------------------------------------------------------

test('60 the result array and everything in it is frozen and fresh', () => {
  const d = doc(FIXTURES.unboundUse);
  const a = d.findings();
  const b = d.findings();
  assert.ok(Object.isFrozen(a));
  assert.notEqual(a, b, 'the same array was handed out twice');
  assert.deepEqual(a, b);
  assert.throws(() => { 'use strict'; a.push({}); }, TypeError);
});

test('61 the range is the parser\'s OWN object, by identity and unfrozen', () => {
  // Freezing it would mutate the caller's parse result; every other projection
  // in src/vrml/ makes the same read-only-by-contract promise instead.
  const d = doc(FIXTURES.unboundUse);
  const f = d.one(FINDING_CODE.USE_NOT_BOUND);
  assert.equal(f.range, f.subject.reference.range);
  assert.ok(!Object.isFrozen(f.range));
  assert.equal(f.subject.node.type, 'Use');
});

test('62 findings are source-ordered and deterministic', () => {
  const text = [FIXTURES.routeTypeMismatch, FIXTURES.unboundUse, FIXTURES.illegalChild,
    FIXTURES.unknownType, FIXTURES.scriptExposedField].join('\n');
  const first = doc(text).findings();
  const second = doc(text).findings();
  assert.ok(first.length >= 5);
  assert.deepEqual(
    first.map((f) => [f.code, f.reason, f.range.start.offset]),
    second.map((f) => [f.code, f.reason, f.range.start.offset]),
  );
  for (let i = 1; i < first.length; i += 1) {
    assert.ok(first[i - 1].range.start.offset <= first[i].range.start.offset, 'out of source order');
  }
});

test('63 no persistent identity: nothing survives a reparse but the facts', () => {
  const text = FIXTURES.unboundUse;
  const a = doc(text).one(FINDING_CODE.USE_NOT_BOUND);
  const b = doc(text).one(FINDING_CODE.USE_NOT_BOUND);
  assert.equal(a.code, b.code);
  assert.notEqual(a.subject.node, b.subject.node, 'an AST node was shared across parses');
  assert.notEqual(a.subject.reference, b.subject.reference);
  for (const key of ['id', 'uid', 'fingerprint', 'path', 'index', 'hash']) {
    assert.ok(!(key in a), `finding carries a persistent ${key}`);
    assert.ok(!(key in a.subject), `subject carries a persistent ${key}`);
  }
});

test('64 pure and browser-safe: no fs, no Electron, no host access', () => {
  const banned = [/require\(['"]fs['"]\)/, /require\(['"]node:fs['"]\)/, /require\(['"]path['"]\)/,
    /require\(['"]electron['"]\)/, /\bprocess\./, /\bwindow\./, /\bdocument\./,
    /Date\.now/, /Math\.random/, /new Date/];
  for (const b of banned) assert.ok(!b.test(CODE), `semantic-findings.js uses ${b}`);
  // And nothing touches the filesystem while a document is analysed.
  const real = fs.readFileSync;
  let touched = 0;
  fs.readFileSync = (...args) => { touched += 1; return real(...args); };
  try {
    doc(FIXTURES.routeTypeMismatch).findings();
  } finally {
    fs.readFileSync = real;
  }
  assert.equal(touched, 0);
});

test('65 the module graph stays acyclic and one-way', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/vrml', f), 'utf8');
  for (const upstream of ['scope-graph.js', 'symbols.js', 'interface-query.js',
    'containment.js', 'node-schema.js', 'ast.js', 'parser.js']) {
    assert.ok(!/semantic-findings/.test(read(upstream)),
      `${upstream} depends on semantic-findings.js -- the arrow runs one way`);
  }
});

test('66 no new runtime dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['x_ite']);
});

test('67 NO SECOND RESOLVER: the module derives no semantics of its own', () => {
  const code = CODE;
  // The alias rule (4.7/4.8.2) has ONE authority and it is not here.
  assert.ok(!/['"`]set_/.test(code), 'derives a set_ alias');
  assert.ok(!/_changed['"`]/.test(code), 'derives a _changed alias');
  // The schema, the interface query and the symbol vocabulary are reached only
  // THROUGH the authorities that own them.
  assert.ok(!/require\(['"]\.\/node-schema/.test(code));
  assert.ok(!/require\(['"]\.\/symbols/.test(code));
  assert.ok(!/require\(['"]\.\/interface-query/.test(code));
  // No scope walking, no candidate ranking, no type comparison.
  for (const b of [/defParent/, /typeParent/, /\.scope\b.*while/, /candidateCount\s*>/,
    /fieldType\s*[!=]==\s*\w+\.type/, /notValidAsChildren/]) {
    assert.ok(!b.test(code), `semantic-findings.js re-derives ${b}`);
  }
});

// ---------------------------------------------------------------------------
// 8. Mutation controls
//
// Each names the concrete defect it proves this suite can catch. A control that
// cannot fail is decoration, so every mutant below is compiled and asserted to
// break a specific assertion above.
// ---------------------------------------------------------------------------

test('70 MUTANT: collapsing the substrate status into one is caught', () => {
  // Defect: a future "simplification" maps every non-resolved answer to
  // `unresolved`, so a recovered parse and a proven absence become the same
  // thing and a consumer can no longer suppress the untrustworthy one.
  const mutant = loadMutant((s) => s.replace(
    'confidence: answer.status,',
    "confidence: answer.status === 'resolved' ? answer.status : 'unresolved',",
  ));
  const parsed = parse(H + FIXTURES.recovered);
  const graph = sg.buildScopeGraph(parsed);
  const before = findingsForDocument(graph).map((f) => f.confidence);
  const after = mutant.findingsForDocument(graph).map((f) => f.confidence);
  assert.ok(before.includes(STATUS.RECOVERED), 'the fixture no longer produces a recovered answer');
  assert.ok(!after.includes(STATUS.RECOVERED), 'the mutation did not take effect');
  assert.notDeepEqual(before, after);
});

test('71 MUTANT: hard-coding an ISO verdict is caught', () => {
  // Defect: a producer decides the ISO axis itself instead of reading the table,
  // so an unprovable answer starts accusing the document of non-conformance.
  const mutant = loadMutant((s) => s.replace(
    'function isoFor(reason) {\n  const entry = ISO_BY_REASON[reason];\n  return entry || notStated;',
    'function isoFor(reason) {\n  const entry = ISO_BY_REASON[reason];\n  return stated(ISO_RESULT.PROHIBITED, CITE.DEF_USE) && (entry || notStated) && stated(ISO_RESULT.PROHIBITED, CITE.DEF_USE);',
  ));
  const parsed = parse(H + FIXTURES.ambiguousDef);
  const graph = sg.buildScopeGraph(parsed);
  const honest = findingsForDocument(graph);
  const lying = mutant.findingsForDocument(graph);
  assert.equal(honest[0].iso, ISO_RESULT.NOT_STATED);
  assert.equal(lying[0].iso, ISO_RESULT.PROHIBITED);
  // Test 25's control is what catches this in the suite proper.
  assert.notEqual(lying[0].iso, ISO_BY_REASON[lying[0].reason].iso);
});

test('72 MUTANT: a severity field re-entering the record is caught', () => {
  // Defect: a future edit "helpfully" pre-classifies a finding, and every
  // consumer inherits a policy decision it cannot see or override.
  const mutant = loadMutant((s) => s.replace(
    '    code: fields.code,\n    subject: fields.subject,',
    "    code: fields.code,\n    severity: 'error',\n    subject: fields.subject,",
  ));
  const parsed = parse(H + FIXTURES.unboundUse);
  const graph = sg.buildScopeGraph(parsed);
  const f = mutant.findingsForDocument(graph)[0];
  assert.equal(f.severity, 'error', 'the mutation did not take effect');
  // Tests 10 and 11 are what catch it in the suite proper.
  assert.notDeepEqual(Object.keys(f).sort(), FINDING_KEYS);
});

test('73 MUTANT: bypassing WD1.6-C to judge containment here is caught', () => {
  // Defect: a producer stops asking the authority and decides ILLEGAL itself --
  // a second containment engine, which is exactly what §7's proof rules forbid.
  const mutant = loadMutant((s) => s.replace(
    'if (verdict.status !== CONTAINMENT_STATUS.ILLEGAL) continue;',
    "if (!(verdict.status === CONTAINMENT_STATUS.ILLEGAL || verdict.status === 'unsupported')) continue;",
  ));
  const parsed = parse(H + 'PROTO P [ field SFNode slot NULL ] { Group {} }\nP { slot Box {} }');
  const graph = sg.buildScopeGraph(parsed);
  assert.deepEqual(findingsForDocument(graph), []);
  const wrong = mutant.findingsForDocument(graph);
  assert.ok(wrong.length > 0, 'the mutation did not take effect');
  // Tests 43 and 52 are what catch it in the suite proper: the mutant reports a
  // placement the authority did NOT call illegal, and asserts a confidence the
  // authority never granted.
  assert.equal(wrong[0].code, FINDING_CODE.CHILD_NOT_PERMITTED);
  const authority = containment.childLegality(
    graph, wrong[0].subject.parent, wrong[0].subject.name, wrong[0].subject.node,
  );
  assert.notEqual(authority.status, containment.CONTAINMENT_STATUS.ILLEGAL);
  assert.equal(authority.status, STATUS.UNSUPPORTED);
});

test('74 MUTANT: widening the placement traversal into PROTO defaults is caught', () => {
  // Defect: someone replaces the scene-graph traversal with `ast.walk`, which
  // descends into a PROTO interface declaration's default value -- a position
  // WD1.6-B is structurally unable to answer about, so the query throws instead
  // of returning findings.
  const mutant = loadMutant((s) => s.replace(
    '  walkStatements(tree && tree.statements);',
    '  ast.walk(tree, (n) => { if (n && n.type === NODE.NODE) visit(n); });',
  ));
  const parsed = parse(H + PROTO_DEFAULT_FIXTURE);
  const graph = sg.buildScopeGraph(parsed);
  assert.deepEqual(findingsForDocument(graph), []);
  assert.throws(() => mutant.findingsForDocument(graph), (err) => err.code === sg.SCOPE_ERROR.PARSE);
});
