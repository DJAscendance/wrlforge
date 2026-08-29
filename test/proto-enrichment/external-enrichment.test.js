'use strict';
// WD1.7-D -- external interface and class enrichment over WD1.7-C evidence.
//
// The properties under test:
//
//   1. STRICT-LOCAL RESULTS ARE UNCHANGED. Every WD1.6 answer is identical with
//      and without external evidence, and D's own `strictLocal` is obtained by
//      calling the strict authority rather than by asserting what it would say.
//   2. D RE-RESOLVES NOTHING. Only C's `RESOLVED` supplies a target; every other
//      outcome leaves both external questions unasked with C's evidence intact.
//   3. THE TWO QUESTIONS ARE INDEPENDENT. Interface agreement needs the selected
//      root target and nothing more -- not a complete dependency graph.
//   4. ONE CLASS AUTHORITY. An externally proven class is the SAME ISO 4.8.3
//      derivation WD1.6-C runs locally, entered at a declaration.

const test = require('node:test');
const assert = require('node:assert/strict');

const { parse, interfaceQuery, containment } = require('../../src/vrml');
const { RESOLUTION_STATUS, INCOMPLETENESS_REASON } = require('../../src/proto-resolution');
const D = require('../../src/proto-enrichment');
const { H, scenario, cleanupArchives } = require('./fixtures');

const {
  enrichExternalPrototype, createEnrichmentSession,
  ENRICHMENT_STATUS, ENRICHMENT_REASON, EXTERNAL_CLASS_STATUS, EXTERNAL_CLASS_REASON,
  AGREEMENT_STATUS, AGREEMENT_FINDING, AGREEMENT_BASIS,
} = D;
const { CONTAINMENT_STATUS, CONTAINMENT_REASON } = containment;

test.after(cleanupArchives);

function enrich(files, rootPath, opts = {}) {
  const s = scenario(files, rootPath, opts);
  const result = enrichExternalPrototype({
    graph: s.graph,
    declaration: s.declaration,
    resolution: s.resolution,
    dependencyGraph: opts.withoutGraph ? null : s.dependencyGraph,
    session: createEnrichmentSession(),
  });
  return { ...s, result };
}

const world = (iface, url, extra = '') =>
  `${H}EXTERNPROTO Thing [${iface}] "${url}"\n${extra}Thing {}\n`;

// --- the happy path ---------------------------------------------------------

test('a proven target enriches both questions, and compatibility stays null', () => {
  const { result } = enrich({
    'lib.wrl': `${H}PROTO Thing [ field SFInt32 a 0 ] { Transform {} }\n`,
    'main.wrl': world('field SFInt32 a', 'lib.wrl'),
  }, 'main.wrl');

  assert.equal(result.status, ENRICHMENT_STATUS.ENRICHED);
  assert.equal(result.reason, ENRICHMENT_REASON.OK);
  assert.equal(result.declarationName, 'Thing');
  assert.equal(result.compatibility, null);

  assert.equal(result.external.interface.status, AGREEMENT_STATUS.SATISFIED);
  assert.equal(result.external.implementationClass.status, EXTERNAL_CLASS_STATUS.PROVEN);
  assert.equal(result.external.implementationClass.nodeType, 'Transform');
  assert.deepEqual(result.external.implementationClass.derivation, ['Thing']);
  assert.deepEqual(result.external.implementationClass.classes, ['children', 'grouping']);
});

test('the strict-local class stays UNSUPPORTED however much evidence exists', () => {
  const { result, graph, declaration } = enrich({
    'lib.wrl': `${H}PROTO Thing [] { Transform {} }\n`,
    'main.wrl': world('', 'lib.wrl'),
  }, 'main.wrl');

  assert.equal(result.strictLocal.implementationClass.status, CONTAINMENT_STATUS.UNSUPPORTED);
  assert.equal(result.strictLocal.implementationClass.reason,
    CONTAINMENT_REASON.EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE);
  assert.equal(result.strictLocal.implementationClass.nodeType, 'Thing',
    'the declared TYPE NAME is known locally; its CLASS is not');
  // And it is the very same call a caller holding no evidence would make.
  const strict = containment.protoImplementationClass(graph, declaration);
  assert.equal(strict.status, result.strictLocal.implementationClass.status);
  assert.equal(strict.reason, result.strictLocal.implementationClass.reason);
});

test('external class classes are real schema classes for the four shapes tested', () => {
  const cases = [
    ['Transform {}', 'Transform', ['children', 'grouping']],
    ['Shape {}', 'Shape', ['children']],
    ['Appearance {}', 'Appearance', ['notValidAsChildren']],
    ['Box {}', 'Box', ['geometry', 'notValidAsChildren']],
  ];
  for (const [body, nodeType, classes] of cases) {
    const { result } = enrich({
      'lib.wrl': `${H}PROTO Thing [] { ${body} }\n`,
      'main.wrl': world('', 'lib.wrl'),
    }, 'main.wrl');
    assert.equal(result.external.implementationClass.nodeType, nodeType, body);
    assert.deepEqual(result.external.implementationClass.classes, classes, body);
  }
});

test('a local PROTO chain inside the target is followed by the ONE 4.8.3 authority', () => {
  const { result } = enrich({
    'lib.wrl': `${H}PROTO Inner [] { Transform {} }\nPROTO Thing [] { Inner {} }\n`,
    'main.wrl': world('', 'lib.wrl#Thing'),
  }, 'main.wrl');
  assert.equal(result.external.implementationClass.nodeType, 'Transform');
  assert.deepEqual(result.external.implementationClass.derivation, ['Thing', 'Inner']);
});

test('an externally proven class equals the class the SAME authority derives locally', () => {
  const libText = `${H}PROTO Inner [] { Transform {} }\nPROTO Thing [] { Inner {} }\n`;
  const { result } = enrich({
    'lib.wrl': libText,
    'main.wrl': world('', 'lib.wrl#Thing'),
  }, 'main.wrl');

  // The SAME document, asked strictly with no evidence in play at all.
  const p = parse(libText);
  const g = interfaceQuery.buildScopeGraph(p);
  const decl = p.tree.statements.find((s) => s.type === 'Proto' && s.name === 'Thing');
  const local = containment.protoImplementationClass(g, decl);

  assert.equal(local.status, result.external.implementationClass.status);
  assert.equal(local.nodeType, result.external.implementationClass.nodeType);
  assert.deepEqual(local.derivation, result.external.implementationClass.derivation);
  assert.deepEqual([...local.classes], [...result.external.implementationClass.classes]);
});

// --- the EXTERNPROTO first-body-node case -----------------------------------

test('an EXTERNPROTO first body node is followed through C\'s PROVEN edge', () => {
  const files = {
    'base.wrl': `${H}PROTO Base [] { Shape {} }\n`,
    'lib.wrl': `${H}EXTERNPROTO Base [] "base.wrl"\nPROTO Wrapper [] { Base {} }\n`,
    'main.wrl': world('', 'lib.wrl#Wrapper'),
  };
  const { result } = enrich(files, 'main.wrl');
  const cls = result.external.implementationClass;
  assert.equal(cls.status, EXTERNAL_CLASS_STATUS.PROVEN);
  assert.equal(cls.nodeType, 'Shape');
  assert.deepEqual(cls.derivation, ['Wrapper', 'Base'], 'ONE 4.8.3 chain across two documents');
  assert.equal(cls.provenance.length, 2, 'one provenance record per external generation');
  assert.deepEqual(cls.provenance.map((p) => p.artifactPath), ['lib.wrl', 'base.wrl']);
  assert.deepEqual(cls.provenance.map((p) => p.selectedProtoName), ['Wrapper', 'Base']);
});

test('without a dependency graph D withholds rather than resolving the dependency itself', () => {
  const files = {
    'base.wrl': `${H}PROTO Base [] { Shape {} }\n`,
    'lib.wrl': `${H}EXTERNPROTO Base [] "base.wrl"\nPROTO Wrapper [] { Base {} }\n`,
    'main.wrl': world('', 'lib.wrl#Wrapper'),
  };
  const { result } = enrich(files, 'main.wrl', { withoutGraph: true });
  const cls = result.external.implementationClass;
  assert.equal(cls.status, CONTAINMENT_STATUS.UNSUPPORTED);
  assert.equal(cls.reason, EXTERNAL_CLASS_REASON.DEPENDENCY_GRAPH_NOT_SUPPLIED);
  assert.equal(cls.nodeType, null, 'no class may be guessed');
  // The INTERFACE answer is unaffected -- the two are independent.
  assert.equal(result.external.interface.status, AGREEMENT_STATUS.SATISFIED);
});

test('an UNRESOLVED external dependency withholds the class, and says which', () => {
  const files = {
    'lib.wrl': `${H}EXTERNPROTO Base [] "missing.wrl"\nPROTO Wrapper [] { Base {} }\n`,
    'main.wrl': world('', 'lib.wrl#Wrapper'),
  };
  const { result } = enrich(files, 'main.wrl');
  const cls = result.external.implementationClass;
  assert.equal(cls.status, CONTAINMENT_STATUS.UNRESOLVED);
  assert.equal(cls.reason, EXTERNAL_CLASS_REASON.EXTERNAL_DEPENDENCY_NOT_RESOLVED);
  assert.equal(cls.nodeType, null);
});

test('a DEPENDENCY CYCLE is preserved as uncertainty, never read as a node class', () => {
  const files = {
    'a.wrl': `${H}EXTERNPROTO B [] "b.wrl"\nPROTO A [] { B {} }\n`,
    'b.wrl': `${H}EXTERNPROTO A [] "a.wrl"\nPROTO B [] { A {} }\n`,
    'main.wrl': world('', 'a.wrl#A'),
  };
  const { result, dependencyGraph } = enrich(files, 'main.wrl');
  assert.ok(dependencyGraph.cycles.length > 0, 'C must have detected the cycle');
  const cls = result.external.implementationClass;
  assert.equal(cls.status, CONTAINMENT_STATUS.UNRESOLVED);
  assert.equal(cls.reason, EXTERNAL_CLASS_REASON.EXTERNAL_CLASS_CYCLE);
  assert.equal(cls.nodeType, null);
});

test('a configured depth bound withholds the class instead of manufacturing one', () => {
  const files = {
    'base.wrl': `${H}PROTO Base [] { Shape {} }\n`,
    'lib.wrl': `${H}EXTERNPROTO Base [] "base.wrl"\nPROTO Wrapper [] { Base {} }\n`,
    'main.wrl': world('', 'lib.wrl#Wrapper'),
  };
  const { result } = enrich(files, 'main.wrl', { maxDepth: 1 });
  const cls = result.external.implementationClass;
  assert.equal(cls.status, CONTAINMENT_STATUS.UNRESOLVED);
  assert.equal(cls.reason, EXTERNAL_CLASS_REASON.EXTERNAL_DEPENDENCY_DEPTH_LIMITED);
});

test('a dependency graph built over ANOTHER document proves nothing here', () => {
  const files = {
    'base.wrl': `${H}PROTO Base [] { Shape {} }\n`,
    'lib.wrl': `${H}EXTERNPROTO Base [] "base.wrl"\nPROTO Wrapper [] { Base {} }\n`,
    'main.wrl': world('', 'lib.wrl#Wrapper'),
    'other.wrl': `${H}PROTO Unrelated [] { Group {} }\n`,
  };
  const s = scenario(files, 'main.wrl');
  const other = scenario({ ...files, 'main.wrl': world('', 'other.wrl') }, 'main.wrl');
  const result = enrichExternalPrototype({
    graph: s.graph, declaration: s.declaration, resolution: s.resolution,
    dependencyGraph: other.dependencyGraph,
  });
  const cls = result.external.implementationClass;
  assert.equal(cls.status, CONTAINMENT_STATUS.UNSUPPORTED);
  assert.equal(cls.reason, EXTERNAL_CLASS_REASON.TARGET_NOT_IN_DEPENDENCY_GRAPH);
});

// --- targets with no provable first body node -------------------------------

test('an EMPTY implementation withholds the class -- Annex A needs a root node statement', () => {
  const { result } = enrich({
    'lib.wrl': `${H}PROTO Thing [] { }\n`,
    'main.wrl': world('', 'lib.wrl'),
  }, 'main.wrl');
  const cls = result.external.implementationClass;
  assert.equal(cls.status, EXTERNAL_CLASS_STATUS.RECOVERED);
  assert.equal(cls.reason, CONTAINMENT_REASON.PROTO_BODY_NOT_PROVABLE);
  assert.equal(cls.nodeType, null);
});

test('a body with statements but no NODE withholds -- 4.8.3 has nothing to classify', () => {
  const { result } = enrich({
    'lib.wrl': `${H}PROTO Thing [] { ROUTE A.b_changed TO C.set_d }\n`,
    'main.wrl': world('', 'lib.wrl'),
  }, 'main.wrl');
  const cls = result.external.implementationClass;
  assert.equal(cls.status, EXTERNAL_CLASS_STATUS.UNRESOLVED);
  assert.equal(cls.reason, CONTAINMENT_REASON.PROTO_BODY_HAS_NO_FIRST_NODE);
});

test('an unresolved first node type withholds the class', () => {
  const { result } = enrich({
    'lib.wrl': `${H}PROTO Thing [] { NoSuchNodeType {} }\n`,
    'main.wrl': world('', 'lib.wrl'),
  }, 'main.wrl');
  const cls = result.external.implementationClass;
  assert.notEqual(cls.status, EXTERNAL_CLASS_STATUS.PROVEN);
  assert.equal(cls.reason, CONTAINMENT_REASON.CANDIDATE_TYPE_NOT_PROVABLE);
  assert.equal(cls.nodeType, null);
});

test('a locally RECURSIVE implementation withholds the class -- no class is guessed', () => {
  // ISO 4.10.1 forbids a prototype instantiating itself, and P2A refuses the
  // self-reference outright; the derivation therefore never reaches its own
  // cycle guard. Either withholding is correct -- what matters is that NO class
  // comes back, which is what this pins.
  const { result } = enrich({
    'lib.wrl': `${H}PROTO Thing [] { Thing {} }\n`,
    'main.wrl': world('', 'lib.wrl'),
  }, 'main.wrl');
  const cls = result.external.implementationClass;
  assert.notEqual(cls.status, EXTERNAL_CLASS_STATUS.PROVEN);
  assert.equal(cls.nodeType, null);
  assert.deepEqual([...cls.classes], []);
});

test('a MUTUALLY recursive local pair inside one target withholds the class', () => {
  const { result } = enrich({
    'lib.wrl': `${H}PROTO A [] { B {} }\nPROTO B [] { A {} }\nPROTO Thing [] { A {} }\n`,
    'main.wrl': world('', 'lib.wrl#Thing'),
  }, 'main.wrl');
  const cls = result.external.implementationClass;
  assert.notEqual(cls.status, EXTERNAL_CLASS_STATUS.PROVEN);
  assert.equal(cls.nodeType, null);
});

test('a RECOVERED implementation body withholds the class', () => {
  const { result } = enrich({
    'lib.wrl': `${H}PROTO Thing [] { Transform { children [ }\n`,
    'main.wrl': world('', 'lib.wrl'),
  }, 'main.wrl');
  const cls = result.external.implementationClass;
  assert.notEqual(cls.status, EXTERNAL_CLASS_STATUS.PROVEN);
  assert.equal(cls.nodeType, null);
});

// --- the C outcome matrix ---------------------------------------------------

test('only RESOLVED supplies a target; every other C outcome is NOT_ATTEMPTED', () => {
  const cases = [
    ['TARGET_PROTO_NOT_FOUND', { 'lib.wrl': `${H}Group {}\n` }, 'lib.wrl'],
    ['TARGET_PROTO_AMBIGUOUS', { 'lib.wrl': `${H}PROTO A [] { Group {} }\nPROTO A [] { Shape {} }\n` }, 'lib.wrl#A'],
    ['NOT_ATTEMPTED', {}, 'missing.wrl'],
  ];
  for (const [expected, files, url] of cases) {
    const { result, resolution } = enrich({ ...files, 'main.wrl': world('field SFInt32 a', url) }, 'main.wrl');
    assert.equal(resolution.status, RESOLUTION_STATUS[expected], expected);
    assert.equal(result.status, ENRICHMENT_STATUS.NOT_ATTEMPTED, expected);
    assert.equal(result.reason, ENRICHMENT_REASON.NO_PROVEN_TARGET, expected);
    assert.equal(result.external.interface.status, AGREEMENT_STATUS.NOT_ATTEMPTED, expected);
    assert.equal(result.external.implementationClass.nodeType, null, expected);
    // C's evidence is preserved rather than discarded.
    assert.equal(result.external.resolution.status, resolution.status, expected);
    assert.equal(result.external.resolution.reason, resolution.reason, expected);
    // The strict-local answer is still there, and still strict.
    assert.equal(result.strictLocal.implementationClass.status, CONTAINMENT_STATUS.UNSUPPORTED);
    assert.equal(result.compatibility, null, expected);
  }
});

test('a target that is not VRML at all is NOT_ATTEMPTED, with C\'s own status', () => {
  const { result, resolution } = enrich({
    'lib.wrl': 'this is not a VRML file\n',
    'main.wrl': world('', 'lib.wrl'),
  }, 'main.wrl');
  assert.equal(resolution.status, RESOLUTION_STATUS.TARGET_PARSE_FAILED);
  assert.equal(result.status, ENRICHMENT_STATUS.NOT_ATTEMPTED);
  assert.equal(result.external.resolution.status, RESOLUTION_STATUS.TARGET_PARSE_FAILED);
});

// --- interface agreement over real C evidence -------------------------------

test('the interface findings survive the round trip through C evidence', () => {
  const { result } = enrich({
    'lib.wrl': `${H}PROTO Thing [ exposedField SFInt32 a 0 field SFString extra "" ] { Group {} }\n`,
    'main.wrl': world('field SFInt32 a field SFFloat gone', 'lib.wrl'),
  }, 'main.wrl');
  const iface = result.external.interface;
  assert.equal(iface.status, AGREEMENT_STATUS.VIOLATED);
  assert.deepEqual(iface.findings.map((f) => f.code).sort(),
    [AGREEMENT_FINDING.ACCESS_DIFFERS, AGREEMENT_FINDING.MEMBER_MISSING].sort());
  assert.equal(iface.findings.find((f) => f.code === AGREEMENT_FINDING.ACCESS_DIFFERS).basis,
    AGREEMENT_BASIS.NOT_SPECIFIED_BY_ISO_4_9_2);
  assert.equal(iface.targetOnlyMemberCount, 1, 'a target superset is conforming');
});

test('interface agreement does NOT require a complete dependency graph', () => {
  // The target's own interface default holds a node occurrence P2A does not
  // index, so C reports the graph incomplete. The ROOT target's interface is
  // still fully provable, and the 4.9.2 answer must not be withheld for it.
  const files = {
    'lib.wrl': `${H}PROTO Thing [ field SFNode proxy Group {} field SFInt32 a 0 ] { Transform {} }\n`,
    'main.wrl': world('field SFInt32 a', 'lib.wrl'),
  };
  const { result, dependencyGraph } = enrich(files, 'main.wrl');
  assert.equal(dependencyGraph.complete, false);
  assert.ok(dependencyGraph.incompleteness.some(
    (i) => i.reason === INCOMPLETENESS_REASON.UNINDEXED_INTERFACE_DEFAULT));
  assert.equal(result.external.interface.status, AGREEMENT_STATUS.SATISFIED);
  assert.equal(result.external.implementationClass.nodeType, 'Transform');
});

test('interface may be SATISFIED while class is withheld -- the statuses are independent', () => {
  const files = {
    'lib.wrl': `${H}EXTERNPROTO Base [] "missing.wrl"\nPROTO Wrapper [ field SFInt32 a 0 ] { Base {} }\n`,
    'main.wrl': world('field SFInt32 a', 'lib.wrl#Wrapper'),
  };
  const { result } = enrich(files, 'main.wrl');
  assert.equal(result.external.interface.status, AGREEMENT_STATUS.SATISFIED);
  assert.equal(result.external.implementationClass.status, CONTAINMENT_STATUS.UNRESOLVED);
});

// --- provenance -------------------------------------------------------------

test('the resolution projection carries C\'s proof and no host path', () => {
  const { result, resolution } = enrich({
    'nested/lib.wrl': `${H}PROTO Alpha [] { Group {} }\nPROTO Thing [] { Transform {} }\n`,
    'main.wrl': world('', 'nested/lib.wrl#Thing'),
  }, 'main.wrl');
  const r = result.external.resolution;
  assert.equal(r.status, RESOLUTION_STATUS.RESOLVED);
  assert.equal(r.writtenUrl, 'nested/lib.wrl#Thing');
  assert.equal(r.selectedCandidateIndex, 0);
  assert.equal(r.candidateCount, 1);
  assert.deepEqual(r.baseDocument, { sourceId: 'archive', path: 'main.wrl' });
  assert.equal(r.target.evidenceSourceId, 'archive');
  assert.equal(r.target.artifactPath, 'nested/lib.wrl');
  assert.equal(r.target.selectedProtoName, 'Thing');
  assert.equal(r.target.selectionRule, resolution.target.selectionRule);
  assert.equal(r.target.selectionWasUnique, true);
  assert.equal(r.target.decodedContentHash, resolution.target.decodedContentHash);
  assert.ok(r.target.retrievedBytesHash);

  const json = JSON.stringify(result.external.resolution);
  assert.ok(!json.includes('/home/'), 'no host absolute path may leak');
  assert.ok(!json.includes('tmpdir'));
  assert.ok(!/[A-Za-z]:\\\\/.test(json));
});

test('gzip behind a plain .wrl name is enriched normally, and says so', () => {
  const { result } = enrich({
    'lib.wrl': { gzip: `${H}PROTO Thing [] { Shape {} }\n` },
    'main.wrl': world('', 'lib.wrl'),
  }, 'main.wrl');
  assert.equal(result.external.resolution.target.wasGzipped, true);
  assert.equal(result.external.implementationClass.nodeType, 'Shape');
});

// --- ill-formed questions ---------------------------------------------------

test('a resolution for a DIFFERENT declaration is refused, not answered', () => {
  const files = {
    'a.wrl': `${H}PROTO A [] { Group {} }\n`,
    'b.wrl': `${H}PROTO B [] { Shape {} }\n`,
    'main.wrl': `${H}EXTERNPROTO A [] "a.wrl"\nEXTERNPROTO B [] "b.wrl"\nA {}\nB {}\n`,
  };
  const first = scenario(files, 'main.wrl', { index: 0 });
  const second = scenario(files, 'main.wrl', { index: 1 });
  const result = enrichExternalPrototype({
    graph: first.graph, declaration: first.declaration, resolution: second.resolution,
  });
  assert.equal(result.status, ENRICHMENT_STATUS.INVALID);
  assert.equal(result.reason, ENRICHMENT_REASON.RESOLUTION_NOT_FOR_THIS_DECLARATION);
  assert.equal(result.external, null);
});

test('a non-EXTERNPROTO declaration is INVALID, and still reports the strict answer', () => {
  const s = scenario({
    'lib.wrl': `${H}PROTO Thing [] { Group {} }\n`,
    'main.wrl': `${H}EXTERNPROTO Thing [] "lib.wrl"\nPROTO Local [] { Group {} }\nThing {}\n`,
  }, 'main.wrl');
  const localProto = s.parseResult.tree.statements.find((x) => x.type === 'Proto');
  const result = enrichExternalPrototype({
    graph: s.graph, declaration: localProto, resolution: s.resolution,
  });
  assert.equal(result.status, ENRICHMENT_STATUS.INVALID);
  assert.equal(result.reason, ENRICHMENT_REASON.NOT_AN_EXTERNPROTO);
  assert.equal(result.strictLocal.implementationClass.status, EXTERNAL_CLASS_STATUS.PROVEN);
  assert.equal(result.strictLocal.implementationClass.nodeType, 'Group');
});

test('a missing resolution throws -- D never resolves a target to fill the gap', () => {
  const s = scenario({
    'lib.wrl': `${H}PROTO Thing [] { Group {} }\n`,
    'main.wrl': world('', 'lib.wrl'),
  }, 'main.wrl');
  assert.throws(() => enrichExternalPrototype({ graph: s.graph, declaration: s.declaration }),
    /resolution is REQUIRED/);
  assert.throws(() => enrichExternalPrototype({ declaration: s.declaration, resolution: s.resolution }),
    /graph must be a scope graph/);
});

// --- shape ------------------------------------------------------------------

test('every owned record is frozen and carries no presentation policy', () => {
  const { result } = enrich({
    'lib.wrl': `${H}PROTO Thing [ field SFInt32 a 0 ] { Transform {} }\n`,
    'main.wrl': world('field SFString a', 'lib.wrl'),
  }, 'main.wrl');
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.strictLocal));
  assert.ok(Object.isFrozen(result.external));
  assert.ok(Object.isFrozen(result.external.resolution));
  assert.ok(Object.isFrozen(result.external.implementationClass));
  assert.ok(Object.isFrozen(result.external.interface));
  for (const k of ['severity', 'message', 'level', 'visible', 'blocking']) {
    assert.ok(!(k in result), `${k} is presentation policy and belongs to P4`);
    assert.ok(!(k in result.external.implementationClass), k);
  }
});

test('D\'s class reasons are DISJOINT from WD1.6-C\'s, so `reason` stays readable', () => {
  const mine = new Set(Object.values(EXTERNAL_CLASS_REASON));
  for (const r of Object.values(CONTAINMENT_REASON)) {
    assert.ok(!mine.has(r), `${r} must not be claimed by both tables`);
  }
});

test('the class STATUS table renames nothing -- every value is an authority\'s own', () => {
  assert.equal(EXTERNAL_CLASS_STATUS.PROVEN, interfaceQuery.STATUS.RESOLVED);
  for (const k of ['UNSUPPORTED', 'UNRESOLVED', 'AMBIGUOUS', 'RECOVERED', 'INVALID']) {
    assert.equal(EXTERNAL_CLASS_STATUS[k], CONTAINMENT_STATUS[k], k);
  }
  for (const forbidden of ['LEGAL', 'ILLEGAL', 'ERROR', 'OK']) {
    assert.ok(!(forbidden in EXTERNAL_CLASS_STATUS),
      `${forbidden} is a containment verdict, not an implementation class`);
  }
});

test('the facade publishes exactly the intended surface, and shares C\'s tables', () => {
  assert.deepEqual(Object.keys(D).sort(), [
    'AGREEMENT_BASIS', 'AGREEMENT_FINDING', 'AGREEMENT_REASON', 'AGREEMENT_STATUS',
    'ENRICHMENT_REASON', 'ENRICHMENT_STATUS', 'EXTERNAL_CLASS_REASON',
    'EXTERNAL_CLASS_STATUS', 'MEMBER_STATUS',
    'createEnrichmentSession', 'enrichExternalPrototype',
  ]);
  assert.ok(Object.isFrozen(D));
  const { protoAgreement } = require('../../src/vrml');
  assert.equal(D.AGREEMENT_STATUS, protoAgreement.AGREEMENT_STATUS);
  assert.equal(D.AGREEMENT_FINDING, protoAgreement.AGREEMENT_FINDING);
  assert.equal(D.AGREEMENT_BASIS, protoAgreement.AGREEMENT_BASIS);
});

test('a session is operation-scoped, and results do not depend on sharing one', () => {
  const files = {
    'lib.wrl': `${H}PROTO Thing [ field SFInt32 a 0 ] { Transform {} }\n`,
    'main.wrl': world('field SFInt32 a', 'lib.wrl'),
  };
  const s = scenario(files, 'main.wrl');
  const shared = createEnrichmentSession();
  const args = { graph: s.graph, declaration: s.declaration, resolution: s.resolution, dependencyGraph: s.dependencyGraph };
  const a = enrichExternalPrototype({ ...args, session: shared });
  const b = enrichExternalPrototype({ ...args, session: shared });
  const c = enrichExternalPrototype(args);
  for (const r of [b, c]) {
    assert.equal(r.status, a.status);
    assert.equal(r.external.interface.status, a.external.interface.status);
    assert.equal(r.external.implementationClass.nodeType, a.external.implementationClass.nodeType);
  }
});
