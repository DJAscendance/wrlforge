'use strict';
// Containment legality tests (Phase WD1.6-C).
//
// A SEPARATE FILE from `node-schema.test.js` (WD1.6-A) and
// `interface-query.test.js` (WD1.6-B), for the reason every lane before it gave:
// C is additive, so an UNCHANGED predecessor suite is this lane's primary
// evidence that it added a consumer rather than a second authority.
//
// WHAT THIS FILE IS ACTUALLY PROVING. `ILLEGAL` is a positive claim, and the
// expensive half of that claim is everything it must NOT be returned for. So the
// assertions come in three kinds:
//
//   1. the two terminal answers, where a normative rule genuinely decides;
//   2. PROOF DIRECTION -- for every way a fact can be missing (absent metadata,
//      positive-only rule, unrepresented class, unresolved type, ambiguous type,
//      EXTERNPROTO, recovered PROTO body), the answer is uncertainty and is
//      neither `LEGAL` nor `ILLEGAL`;
//   3. structural guards -- no fallback-to-ILLEGAL branch, no global inversion
//      of `notValidAsChildren`, no second resolver, a frozen verdict.
//
// Fixtures are string literals original to this lane; nothing under `spikes/` is
// imported, and no White Dune material contributed to any expectation here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vrml = require('../../src/vrml');
const { parse, ast } = vrml;
const sg = require('../../src/vrml/scope-graph');
const nodeSchema = require('../../src/vrml/node-schema');
const containment = require('../../src/vrml/containment');

const { childLegality, CONTAINMENT_STATUS: CS, CONTAINMENT_REASON: CR, CANDIDATE_KIND } = containment;
const { STATUS } = sg;

const H = '#VRML V2.0 utf8\n';

/** Parse + build a graph, and expose a finder over the resulting tree. */
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
    use: () => find((n) => n.type === 'Use'),
    ask: (parent, field, candidate) => childLegality(graph, parent, field, candidate),
  };
}

/** The common shape: one parent type, one field, one candidate node type. */
function verdictFor(text, parentType, field, candidateType) {
  const d = doc(text);
  return d.ask(d.node(parentType), field, d.node(candidateType));
}

const TERMINAL = new Set([CS.LEGAL, CS.ILLEGAL]);

// ---------------------------------------------------------------------------
// 1. Taxonomy and facade
// ---------------------------------------------------------------------------

test('01 the uncertain statuses ARE the scope-graph statuses, not copies of them', () => {
  // If these ever drift, a consumer branching on `STATUS.UNRESOLVED` would
  // silently stop matching a containment verdict that means exactly that.
  assert.equal(CS.UNSUPPORTED, STATUS.UNSUPPORTED);
  assert.equal(CS.UNRESOLVED, STATUS.UNRESOLVED);
  assert.equal(CS.AMBIGUOUS, STATUS.AMBIGUOUS);
  assert.equal(CS.INVALID, STATUS.INVALID);
  assert.equal(CS.RECOVERED, STATUS.RECOVERED);
  // The two terminal values are new because nothing existing means them.
  assert.equal(CS.LEGAL, 'legal');
  assert.equal(CS.ILLEGAL, 'illegal');
  assert.ok(!Object.values(STATUS).includes(CS.LEGAL));
  assert.ok(!Object.values(STATUS).includes(CS.ILLEGAL));
});

test('02 the facade publishes exactly the intended C surface', () => {
  assert.deepEqual(Object.keys(vrml.containment).sort(),
    ['CANDIDATE_KIND', 'CONTAINMENT_REASON', 'CONTAINMENT_STATUS', 'childLegality']);
  assert.ok(Object.isFrozen(vrml.containment));
  // Internal reasoning is NOT published: a consumer must read the verdict, not
  // re-implement the judgement.
  assert.equal(vrml.containment.EXCLUSION_COMPLETE_RULES, undefined);
  assert.equal(vrml.containment.CLASS_COMPLEMENT, undefined);
  assert.equal(vrml.containment.judgeAcceptance, undefined);
});

test('03 no boolean accessor is offered anywhere on the surface', () => {
  // Five of seven statuses are not booleans. A coercion is how uncertainty gets
  // silently spent as permission.
  for (const key of Object.keys(vrml.containment)) {
    assert.ok(!/^(is|can|may)[A-Z]/.test(key), `${key} reads as a boolean predicate`);
  }
  const v = verdictFor('Transform{children[Shape{}]}', 'Transform', 'children', 'Shape');
  assert.equal(v.allowed, undefined);
  assert.equal(v.ok, undefined);
  assert.equal(typeof v.isAllowed, 'undefined');
});

test('04 the whole consumer path runs off the facade alone', () => {
  const parsed = vrml.parse(`${H}Transform{children[Shape{}]}`);
  const graph = vrml.interfaceQuery.buildScopeGraph(parsed);
  const parent = parsed.tree.statements[0];
  const child = parent.fields[0].value.items[0];
  const v = vrml.containment.childLegality(graph, parent, 'children', child);
  assert.equal(v.status, CS.LEGAL);
});

// ---------------------------------------------------------------------------
// 2. Built-in containment -- the two terminal answers
// ---------------------------------------------------------------------------

test('05 class-based field: an accepted children node is LEGAL', () => {
  const v = verdictFor('Transform{children[Shape{}]}', 'Transform', 'children', 'Shape');
  assert.equal(v.status, CS.LEGAL);
  assert.equal(v.reason, CR.ACCEPTED_NODE_CLASS);
  assert.equal(v.arity, 'MFNode');
  assert.equal(v.field.name, 'children');
  assert.deepEqual(v.required.acceptedNodeClasses, ['children']);
  assert.equal(v.required.exclusionComplete, true);
  assert.equal(v.candidate.nodeType, 'Shape');
  assert.equal(v.candidate.kind, CANDIDATE_KIND.BUILTIN);
  assert.equal(v.ruleSource[0].id, 'table-4.3');
  assert.equal(v.ruleSource[0].standard, 'ISO/IEC 14772-1');
});

test('06 class-based field: a node ISO names "not valid as children" is ILLEGAL', () => {
  // ISO 4.6.5 states the prohibition explicitly. That explicit negative list --
  // not absence from the positive one -- is what makes exclusion provable.
  const v = verdictFor('Transform{children[Box{}]}', 'Transform', 'children', 'Box');
  assert.equal(v.status, CS.ILLEGAL);
  assert.equal(v.reason, CR.EXCLUDED_BY_NODE_CLASS);
  assert.ok(nodeSchema.getNodeClasses('Box').includes('notValidAsChildren'));
});

test('07 exact-type field: a listed geometry node is LEGAL', () => {
  const v = verdictFor('Shape{geometry Box{}}', 'Shape', 'geometry', 'Box');
  assert.equal(v.status, CS.LEGAL);
  assert.equal(v.reason, CR.ACCEPTED_EXACT_TYPE);
  assert.equal(v.arity, 'SFNode');
  assert.ok(v.required.acceptedNodeTypes.includes('Box'));
  assert.equal(v.required.acceptedNodeClasses, null);
});

test('08 exact-type field: a type outside a complete Table 4.3 set is ILLEGAL', () => {
  const v = verdictFor('Shape{geometry Material{}}', 'Shape', 'geometry', 'Material');
  assert.equal(v.status, CS.ILLEGAL);
  assert.equal(v.reason, CR.EXCLUDED_BY_EXACT_TYPE_SET);
});

test('09 a single-type field accepts its one type and excludes others', () => {
  const legal = verdictFor('Shape{appearance Appearance{}}', 'Shape', 'appearance', 'Appearance');
  assert.equal(legal.status, CS.LEGAL);
  const illegal = verdictFor('Shape{appearance Material{}}', 'Shape', 'appearance', 'Material');
  assert.equal(illegal.status, CS.ILLEGAL);
});

test('10 exact-type matching is EXACT -- no case folding, no substring, no aliasing', () => {
  // `Box` is accepted by `Shape.geometry`; nothing that merely resembles it is.
  const d = doc('Shape{geometry Box{}}');
  for (const spelling of ['box', 'BOX', 'Boxes', 'MyBox']) {
    const v = d.ask(d.node('Shape'), 'geometry', spelling);
    assert.ok(!TERMINAL.has(v.status), `${spelling} produced a terminal answer`);
    assert.equal(v.reason, CR.CANDIDATE_TYPE_NAME_NOT_BUILTIN, spelling);
  }
  assert.equal(d.ask(d.node('Shape'), 'geometry', 'Box').status, CS.LEGAL);
});

// ---------------------------------------------------------------------------
// 3. Field arity and API misuse -- INVALID, never ILLEGAL
// ---------------------------------------------------------------------------

test('11 a non-node-valued field is a category error, not a rejected child', () => {
  const v = verdictFor('Transform{children[Box{}]}', 'Transform', 'translation', 'Box');
  assert.equal(v.status, CS.INVALID);
  assert.equal(v.reason, CR.FIELD_NOT_NODE_VALUED);
  assert.equal(v.arity, null);
  assert.equal(v.field.type, 'SFVec3f');
});

test('12 an event alias is not a child-storage field', () => {
  // 4.7 gives `exposedField children` the names `set_children`/`children_changed`.
  // Neither stores children, so containment through one is ill-formed.
  for (const name of ['set_children', 'children_changed']) {
    const v = verdictFor('Transform{children[Shape{}]}', 'Transform', name, 'Shape');
    assert.equal(v.status, CS.INVALID, name);
    assert.equal(v.reason, CR.FIELD_NAME_IS_EVENT_ALIAS, name);
  }
});

test('13 an undeclared field on a complete interface is INVALID', () => {
  const v = verdictFor('Transform{children[Shape{}]}', 'Transform', 'nosuchfield', 'Shape');
  assert.equal(v.status, CS.INVALID);
  assert.equal(v.reason, CR.FIELD_NOT_DECLARED);
});

test('14 a non-node parent is INVALID, and a bad field name throws', () => {
  const d = doc('Transform{children[Shape{}]}');
  const v = d.ask({ type: 'Field', name: 'x' }, 'children', d.node('Shape'));
  assert.equal(v.status, CS.INVALID);
  assert.equal(v.reason, CR.PARENT_NOT_A_NODE);
  assert.throws(() => d.ask(d.node('Transform'), '', d.node('Shape')),
    (e) => e.code === sg.SCOPE_ERROR.REFERENCE);
});

test('15 a candidate that is not a node at all is INVALID, never ILLEGAL', () => {
  const d = doc('Transform{children[Shape{}]}');
  for (const bogus of [null, 42, { type: 'Field', name: 'x' }]) {
    const v = d.ask(d.node('Transform'), 'children', bogus);
    assert.equal(v.status, CS.INVALID);
    assert.equal(v.reason, CR.CANDIDATE_NOT_A_NODE);
  }
});

test('16 a cross-parse node fails loudly rather than degrading to a verdict', () => {
  const a = doc('Transform{children[Shape{}]}');
  const b = doc('Group{children[Box{}]}');
  assert.throws(() => a.ask(b.node('Group'), 'children', a.node('Shape')),
    (e) => e.code === sg.SCOPE_ERROR.PARSE || e.code === sg.SCOPE_ERROR.GRAPH);
});

// ---------------------------------------------------------------------------
// 4. PROOF DIRECTION -- missing facts never become either terminal answer
// ---------------------------------------------------------------------------

test('17 metadata absent: an uncovered SFNode field is UNSUPPORTED, not LEGAL or ILLEGAL', () => {
  // `Collision.proxy` is node-valued and carries no WD1.6-A acceptance metadata:
  // Table 4.3 has no row for it and no clause 6 sentence template matches.
  assert.equal(nodeSchema.getFieldConstraints('Collision', 'proxy'), null);
  for (const candidate of ['Shape', 'Box', 'Material']) {
    const v = verdictFor(`Collision{proxy ${candidate}{}}`, 'Collision', 'proxy', candidate);
    assert.equal(v.status, CS.UNSUPPORTED, candidate);
    assert.equal(v.reason, CR.CONTAINMENT_METADATA_ABSENT, candidate);
    assert.equal(v.required, null);
    // The candidate was still resolved, so a consumer can see what was asked.
    assert.equal(v.candidate.nodeType, candidate);
  }
});

test('18 metadata absent on an MFNode eventIn is likewise UNSUPPORTED', () => {
  const v = verdictFor('Transform{children[Box{}]}', 'Transform', 'addChildren', 'Box');
  assert.equal(v.status, CS.UNSUPPORTED);
  assert.equal(v.reason, CR.CONTAINMENT_METADATA_ABSENT);
  assert.equal(v.arity, 'MFNode');
});

test('19 a POSITIVE-ONLY acceptance rule proves LEGAL but never ILLEGAL', () => {
  // `PointSet.color` comes from `clause-6-sentence`, which C treats as
  // positive-only: the rule id spans four sentence templates, one of them
  // indicative, so the id alone cannot certify exclusivity for a future field.
  assert.deepEqual(nodeSchema.getFieldConstraints('PointSet', 'color').rules, ['clause-6-sentence']);
  const legal = verdictFor('Shape{geometry PointSet{color Color{}}}', 'PointSet', 'color', 'Color');
  assert.equal(legal.status, CS.LEGAL);
  assert.equal(legal.required.exclusionComplete, false);

  const unproven = verdictFor('Shape{geometry PointSet{color Material{}}}', 'PointSet', 'color', 'Material');
  assert.equal(unproven.status, CS.UNSUPPORTED);
  assert.equal(unproven.reason, CR.ACCEPTANCE_RULE_NOT_EXCLUSION_COMPLETE);
});

test('20 an unrepresented class membership is UNSUPPORTED, not ILLEGAL', () => {
  // ISO 4.6.5 lists 32 children nodes and 20 "not valid as children" -- 52 of 54.
  // `FontStyle` and `PixelTexture` appear in NEITHER list.
  for (const gap of ['FontStyle', 'PixelTexture']) {
    assert.ok(!nodeSchema.getNodeClasses(gap).includes('children'));
    assert.ok(!nodeSchema.getNodeClasses(gap).includes('notValidAsChildren'));
    const v = verdictFor(`Transform{children[${gap}{}]}`, 'Transform', 'children', gap);
    assert.equal(v.status, CS.UNSUPPORTED, gap);
    assert.equal(v.reason, CR.CLASS_MEMBERSHIP_NOT_DETERMINED, gap);
  }
});

test('21 an unresolved candidate type is UNRESOLVED, not ILLEGAL', () => {
  const v = verdictFor('Transform{children[Zork{}]}', 'Transform', 'children', 'Zork');
  assert.equal(v.status, CS.UNRESOLVED);
  assert.equal(v.reason, CR.CANDIDATE_TYPE_NOT_PROVABLE);
  assert.equal(v.candidate.nodeType, null);
});

test('22 an ambiguous candidate type is AMBIGUOUS, not ILLEGAL', () => {
  // Two PROTO declarations of one name: 4.8.1 says node type names shall be
  // unique, so P2A refuses to choose and C inherits that refusal.
  const v = verdictFor('PROTO P []{Shape{}}\nPROTO P []{Box{}}\nTransform{children[P{}]}',
    'Transform', 'children', 'P');
  assert.equal(v.status, CS.AMBIGUOUS);
  assert.equal(v.reason, CR.CANDIDATE_TYPE_NOT_PROVABLE);
});

test('23 an invalid candidate type (instance before declaration) is INVALID, not ILLEGAL', () => {
  const v = verdictFor('Transform{children[P{}]}\nPROTO P []{Shape{}}', 'Transform', 'children', 'P');
  assert.equal(v.status, CS.INVALID);
  assert.equal(v.reason, CR.CANDIDATE_TYPE_NOT_PROVABLE);
});

test('24 an unprovable USE is UNRESOLVED, not ILLEGAL', () => {
  const v = verdictFor('Transform{children[USE Nope]}', 'Transform', 'children', null)
    && (() => {
      const d = doc('Transform{children[USE Nope]}');
      return d.ask(d.node('Transform'), 'children', d.use());
    })();
  assert.equal(v.status, CS.UNRESOLVED);
  assert.equal(v.reason, CR.CANDIDATE_USE_NOT_PROVABLE);
});

test('25 a parent whose own interface is unprovable yields no legality claim', () => {
  const d = doc('Unknown{children[Box{}]}');
  const v = d.ask(d.node('Unknown'), 'children', d.node('Box'));
  assert.ok(!TERMINAL.has(v.status));
  assert.equal(v.reason, CR.PARENT_INTERFACE_NOT_PROVABLE);
});

// ---------------------------------------------------------------------------
// 5. PROTO candidates -- ISO/IEC 14772-1, 4.8.3
// ---------------------------------------------------------------------------

test('26 4.8.3: a PROTO instance is judged by its body\'s FIRST NODE type', () => {
  // "The first node type determines how instantiations of the prototype can be
  // used in a VRML file." -- ISO/IEC 14772-1, 4.8.3.
  const legal = verdictFor('PROTO P []{Shape{}}\nTransform{children[P{}]}',
    'Transform', 'children', 'P');
  assert.equal(legal.status, CS.LEGAL);
  assert.equal(legal.candidate.nodeType, 'Shape');
  assert.equal(legal.candidate.kind, CANDIDATE_KIND.BUILTIN);
  assert.deepEqual(legal.candidate.derivation, ['P']);
});

test('27 4.8.3: a PROTO whose first node is not valid as a child is ILLEGAL', () => {
  const v = verdictFor('PROTO P []{Box{}}\nTransform{children[P{}]}', 'Transform', 'children', 'P');
  assert.equal(v.status, CS.ILLEGAL);
  assert.equal(v.reason, CR.EXCLUDED_BY_NODE_CLASS);
  assert.equal(v.candidate.nodeType, 'Box');
  assert.deepEqual(v.candidate.derivation, ['P']);
});

test('28 4.8.3 is transitive: PROTO -> PROTO -> built-in', () => {
  const v = verdictFor('PROTO Q []{Box{}}\nPROTO P []{Q{}}\nTransform{children[P{}]}',
    'Transform', 'children', 'P');
  assert.equal(v.status, CS.ILLEGAL);
  assert.deepEqual(v.candidate.derivation, ['P', 'Q']);
  assert.equal(v.candidate.nodeType, 'Box');
});

test('29 "first NODE", not "first statement": leading ROUTE and PROTO are skipped', () => {
  // 4.8.3 names nodes, nested PROTO statements and ROUTE statements as three
  // separate body constituents. Only the first of the first kind classifies.
  const afterRoute = verdictFor('PROTO P []{ROUTE A.b TO C.d Shape{}}\nTransform{children[P{}]}',
    'Transform', 'children', 'P');
  assert.equal(afterRoute.candidate.nodeType, 'Shape');
  assert.equal(afterRoute.status, CS.LEGAL);

  const afterProto = verdictFor('PROTO P []{PROTO Q []{Box{}} Shape{}}\nTransform{children[P{}]}',
    'Transform', 'children', 'P');
  assert.equal(afterProto.candidate.nodeType, 'Shape');
  assert.equal(afterProto.status, CS.LEGAL);
});

test('30 a PROTO body with no node at all cannot be classified', () => {
  const v = verdictFor('PROTO P []{ROUTE A.b TO C.d}\nTransform{children[P{}]}',
    'Transform', 'children', 'P');
  assert.equal(v.status, CS.UNRESOLVED);
  assert.equal(v.reason, CR.PROTO_BODY_HAS_NO_FIRST_NODE);
});

test('31 a recovered PROTO body withholds the answer -- never ILLEGAL', () => {
  // An empty body is marked recovered by the scope graph: parser recovery moves
  // body boundaries, so a "first node" found in one is not the author's.
  const v = verdictFor('PROTO P []{}\nTransform{children[P{}]}', 'Transform', 'children', 'P');
  assert.equal(v.status, CS.RECOVERED);
  assert.equal(v.reason, CR.PROTO_BODY_NOT_PROVABLE);
  assert.ok(!TERMINAL.has(v.status));
});

test('32 an unclosed PROTO absorbs what follows and yields no legality claim', () => {
  const d = doc('PROTO P []{ Box{}\nTransform{children[P{}]}\n');
  const v = d.ask(d.node('Transform'), 'children', d.node('P'));
  assert.ok(!TERMINAL.has(v.status), `got ${v.status}/${v.reason}`);
});

test('33 PROTO class cycles are refused, however the parser classifies them', () => {
  // 4.8.4 makes recursive prototypes illegal and 4.8.1 makes an instance before
  // its declaration invalid, so P2A already forecloses both constructible cycle
  // shapes. C's own cycle guard is a structural backstop behind that; what
  // matters here is that NEITHER shape can reach a terminal answer.
  const direct = verdictFor('PROTO P []{P{}}\nTransform{children[P{}]}', 'Transform', 'children', 'P');
  assert.ok(!TERMINAL.has(direct.status), `direct: ${direct.status}`);
  const indirect = verdictFor('PROTO A []{B{}}\nPROTO B []{A{}}\nTransform{children[A{}]}',
    'Transform', 'children', 'A');
  assert.ok(!TERMINAL.has(indirect.status), `indirect: ${indirect.status}`);
});

test('34 a lexical PROTO that shadows a built-in name is judged by its body', () => {
  // 4.8.1: the local declaration wins the binding. A `PROTO Box` whose first node
  // is a Shape instantiates as a Shape -- judging it by the SPELLING `Box` would
  // be exactly the wrong answer.
  const v = verdictFor('PROTO Box []{Shape{}}\nTransform{children[Box{}]}',
    'Transform', 'children', 'Box');
  assert.equal(v.status, CS.LEGAL);
  assert.equal(v.candidate.nodeType, 'Shape');
  assert.deepEqual(v.candidate.derivation, ['Box']);
});

test('35 a PROTO-declared node-valued field carries no containment metadata', () => {
  const v = verdictFor('PROTO P [ field MFNode kids [] ]{Group{children IS kids}}\n'
    + 'P{kids [Box{}]}', 'P', 'kids', 'Box');
  assert.equal(v.status, CS.UNSUPPORTED);
  assert.equal(v.reason, CR.CONTAINMENT_METADATA_ABSENT);
  assert.equal(v.arity, 'MFNode');
  assert.equal(v.field.declarationOrigin, sg.ENDPOINT_ORIGIN.PROTO_INTERFACE);
});

// ---------------------------------------------------------------------------
// 6. EXTERNPROTO -- "cannot prove locally", never "forbidden"
// ---------------------------------------------------------------------------

test('36 an EXTERNPROTO candidate is UNSUPPORTED against a field C otherwise decides', () => {
  const v = verdictFor('EXTERNPROTO E [] ["e.wrl"]\nTransform{children[E{}]}',
    'Transform', 'children', 'E');
  assert.equal(v.status, CS.UNSUPPORTED);
  assert.equal(v.reason, CR.EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE);
  assert.equal(v.candidate.kind, CANDIDATE_KIND.EXTERNPROTO);
  // The field itself WAS decided -- the same field answers ILLEGAL for a Box.
  assert.equal(v.required.exclusionComplete, true);
});

test('37 a KNOWN EXTERNPROTO interface still does not make its node class knowable', () => {
  // 4.9.2 makes what an EXTERNPROTO declares authoritative. That is a fact about
  // its INTERFACE; 4.8.3 classification needs its BODY, which is not present.
  // The two are orthogonal, and inferring one from the other is an invention.
  const d = doc('EXTERNPROTO E [ field SFVec3f translation ] ["e.wrl"]\nTransform{children[E{}]}');
  const iface = vrml.interfaceQuery.effectiveInterfaceOf(d.graph, d.node('E'));
  assert.equal(iface.status, STATUS.RESOLVED);
  assert.ok(iface.byName.translation, 'the declared member is known');
  const v = d.ask(d.node('Transform'), 'children', d.node('E'));
  assert.equal(v.status, CS.UNSUPPORTED);
  assert.equal(v.reason, CR.EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE);
});

test('38 an EXTERNPROTO PARENT is never told a field does not exist', () => {
  // 4.9.2: an EXTERNPROTO declaration may be a strict subset of the
  // implementation's, so an absent name is not proof of absence.
  const v = verdictFor('EXTERNPROTO E [] ["e.wrl"]\nE{}\nBox{}', 'E', 'anything', 'Box');
  assert.equal(v.status, CS.UNSUPPORTED);
  assert.equal(v.reason, CR.EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE);
  assert.notEqual(v.reason, CR.FIELD_NOT_DECLARED);
});

test('39 no file or network access occurs for an EXTERNPROTO candidate', () => {
  const readFile = fs.readFileSync;
  const readSync = fs.readSync;
  let touched = 0;
  fs.readFileSync = (...a) => { touched += 1; return readFile(...a); };
  fs.readSync = (...a) => { touched += 1; return readSync(...a); };
  try {
    verdictFor('EXTERNPROTO E [] ["http://example.invalid/e.wrl"]\nTransform{children[E{}]}',
      'Transform', 'children', 'E');
  } finally {
    fs.readFileSync = readFile;
    fs.readSync = readSync;
  }
  assert.equal(touched, 0);
});

// ---------------------------------------------------------------------------
// 7. Bare type-name candidates -- the deliberate boundary
// ---------------------------------------------------------------------------

test('40 a built-in type NAME is answered because the answer is context-free', () => {
  const d = doc('Transform{children[]}');
  assert.equal(d.ask(d.node('Transform'), 'children', 'Shape').status, CS.LEGAL);
  assert.equal(d.ask(d.node('Transform'), 'children', 'Box').status, CS.ILLEGAL);
});

test('41 a user-defined type NAME is refused rather than resolved from an invented scope', () => {
  // 4.8.4 makes PROTO scopes disjoint and 4.8.1 makes instantiation before
  // declaration invalid, so `"P"` has no meaning without a lexical position.
  // WD2 owns insertion; until it can name one, this stays unanswered.
  const d = doc('PROTO P []{Shape{}}\nTransform{children[]}');
  const v = d.ask(d.node('Transform'), 'children', 'P');
  assert.equal(v.status, CS.UNRESOLVED);
  assert.equal(v.reason, CR.CANDIDATE_TYPE_NAME_NOT_BUILTIN);
  assert.equal(v.candidate.nodeType, null);
  // ... even though an AST occurrence of the very same PROTO resolves fine.
  const occ = doc('PROTO P []{Shape{}}\nTransform{children[P{}]}');
  assert.equal(occ.ask(occ.node('Transform'), 'children', occ.node('P')).status, CS.LEGAL);
});

// ---------------------------------------------------------------------------
// 8. Structural guards
// ---------------------------------------------------------------------------

test('42 `notValidAsChildren` is NOT a global veto', () => {
  // Every node ISO calls "not valid as children" that Table 4.3 accepts SOMEWHERE
  // must still be LEGAL there. A global inversion would make all of these ILLEGAL.
  const placements = [
    ['Shape{geometry Box{}}', 'Shape', 'geometry', 'Box'],
    ['Shape{appearance Appearance{}}', 'Shape', 'appearance', 'Appearance'],
    ['Appearance{material Material{}}', 'Appearance', 'material', 'Material'],
    ['Appearance{texture ImageTexture{}}', 'Appearance', 'texture', 'ImageTexture'],
    ['Appearance{texture MovieTexture{}}', 'Appearance', 'texture', 'MovieTexture'],
    ['Appearance{textureTransform TextureTransform{}}', 'Appearance', 'textureTransform', 'TextureTransform'],
    ['Sound{source AudioClip{}}', 'Sound', 'source', 'AudioClip'],
    ['Text{fontStyle FontStyle{}}', 'Text', 'fontStyle', 'FontStyle'],
    ['Shape{geometry IndexedFaceSet{coord Coordinate{}}}', 'IndexedFaceSet', 'coord', 'Coordinate'],
    ['Shape{geometry IndexedFaceSet{color Color{}}}', 'IndexedFaceSet', 'color', 'Color'],
    ['Shape{geometry IndexedFaceSet{normal Normal{}}}', 'IndexedFaceSet', 'normal', 'Normal'],
    ['Shape{geometry ElevationGrid{texCoord TextureCoordinate{}}}', 'ElevationGrid', 'texCoord', 'TextureCoordinate'],
  ];
  for (const [text, parent, field, child] of placements) {
    const v = verdictFor(text, parent, field, child);
    assert.equal(v.status, CS.LEGAL, `${parent}.${field} <- ${child}: ${v.status}/${v.reason}`);
  }
});

test('43 exclusion completeness is a whitelist, and only Table 4.3 is on it', () => {
  assert.deepEqual([...containment.EXCLUSION_COMPLETE_RULES], ['table-4.3']);
  // Every acceptance rule WD1.6-A can emit is accounted for -- a NEW one added by
  // a future regeneration is positive-only until it is deliberately adjudicated,
  // which fails safe rather than silently proving negatives.
  const emitted = new Set();
  for (const name of nodeSchema.listNodeNames()) {
    const fields = nodeSchema.getNodeSchema(name).fields;
    for (const key of Object.keys(fields)) {
      const c = fields[key].constraints;
      if (!c || (!c.acceptedNodeTypes && !c.acceptedNodeClasses)) continue;
      for (const id of c.rules) emitted.add(id);
    }
  }
  assert.deepEqual([...emitted].sort(), ['clause-6-sentence', 'table-4.3']);
});

test('44 the class-complement table is scoped to the class that pairs with it', () => {
  assert.deepEqual(Object.keys(containment.CLASS_COMPLEMENT), ['children']);
  assert.equal(containment.CLASS_COMPLEMENT.children, 'notValidAsChildren');
  // The complement class exists in the schema and is genuinely disjoint from it.
  const children = nodeSchema.listNodesInClass('children');
  const not = nodeSchema.listNodesInClass('notValidAsChildren');
  assert.ok(not.length > 0);
  assert.equal(children.filter((n) => not.includes(n)).length, 0);
});

test('45 no acceptance record carries BOTH exact types and classes today', () => {
  // The union/intersection semantics in `judgeAcceptance` are defined for a
  // combination WD1.6-A does not currently emit. This pins that fact, so if a
  // regeneration ever produces one it surfaces as a decision to make rather than
  // as untested behaviour.
  let both = 0;
  for (const name of nodeSchema.listNodeNames()) {
    const fields = nodeSchema.getNodeSchema(name).fields;
    for (const key of Object.keys(fields)) {
      const c = fields[key].constraints;
      if (c && c.acceptedNodeTypes && c.acceptedNodeClasses) both += 1;
    }
  }
  assert.equal(both, 0);
});

test('46 ILLEGAL is never a fallback branch -- by source scan', () => {
  // The behavioural tests above cover the reachable paths; this one guards the
  // SHAPE, so a future edit cannot reintroduce a default-deny by restructuring.
  const src = fs.readFileSync(path.join(__dirname, '../../src/vrml/containment.js'), 'utf8');
  // `ILLEGAL` is produced in exactly one place, and that place is guarded by the
  // exclusion-completeness test.
  const produced = src.match(/CONTAINMENT_STATUS\.ILLEGAL/g) || [];
  assert.equal(produced.length, 1, 'ILLEGAL should be constructed in exactly one branch');
  const judge = src.slice(src.indexOf('function judgeAcceptance'));
  const guard = judge.indexOf('if (!required.exclusionComplete)');
  const illegal = judge.indexOf('CONTAINMENT_STATUS.ILLEGAL');
  assert.ok(guard !== -1 && illegal !== -1 && guard < illegal,
    'the exclusion-completeness gate must precede the only ILLEGAL branch');
  // No fuzzy matching anywhere.
  for (const banned of ['toLowerCase', 'toUpperCase', 'startsWith', 'endsWith', 'score', 'nearest']) {
    assert.ok(!src.includes(banned), `containment.js must not use ${banned}`);
  }
});

test('47 C introduces no second resolver -- by import scan', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/vrml/containment.js'), 'utf8');
  const requires = [...src.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(requires, ['./ast', './interface-query', './node-schema', './scope-graph']);
  // No fs, no Electron, no renderer -- pure and browser-safe.
  for (const banned of ['node:fs', 'electron', 'node:path', 'child_process']) {
    assert.ok(!src.includes(banned), `containment.js must not require ${banned}`);
  }
});

test('48 verdicts are deeply immutable', () => {
  const v = verdictFor('Transform{children[Shape{}]}', 'Transform', 'children', 'Shape');
  assert.ok(Object.isFrozen(v));
  assert.ok(Object.isFrozen(v.field));
  assert.ok(Object.isFrozen(v.required));
  assert.ok(Object.isFrozen(v.required.acceptedNodeClasses));
  assert.ok(Object.isFrozen(v.candidate));
  assert.ok(Object.isFrozen(v.candidate.classes));
  assert.ok(Object.isFrozen(v.candidate.derivation));
  assert.ok(Object.isFrozen(v.ruleSource));
  assert.ok(Object.isFrozen(v.ruleSource[0]));
  assert.throws(() => { v.status = CS.LEGAL; }, TypeError);
  assert.throws(() => { v.required.acceptedNodeClasses.push('x'); }, TypeError);
  // A fresh array each call: mutating one caller's copy cannot reach another's.
  const other = verdictFor('Transform{children[Shape{}]}', 'Transform', 'children', 'Shape');
  assert.notEqual(v.candidate.classes, other.candidate.classes);
  // No Map or Set leaks out.
  for (const key of Object.keys(v)) {
    assert.ok(!(v[key] instanceof Map) && !(v[key] instanceof Set), key);
  }
});

test('49 the parent AST node is shared by identity, not copied or frozen', () => {
  const d = doc('Transform{children[Shape{}]}');
  const parent = d.node('Transform');
  const v = d.ask(parent, 'children', d.node('Shape'));
  assert.equal(v.parent, parent);
  assert.equal(v.candidate.given, d.node('Shape'));
  assert.ok(!Object.isFrozen(parent), 'the parse tree is not this projection\'s to freeze');
});

// ---------------------------------------------------------------------------
// 9. The WD2-shaped consumer path
// ---------------------------------------------------------------------------

test('50 WD2-shaped proof: selected parent -> interface -> field -> legality', () => {
  // The shape a future scene tree would use. C reports truth; it does NOT decide
  // what a UI does with an uncertain verdict -- that is WD2 policy, deliberately
  // absent from the verdict (no severity, no message, no suggested fix).
  const parsed = vrml.parse(`${H}Transform{children[]}`);
  const graph = vrml.interfaceQuery.buildScopeGraph(parsed);
  const selected = parsed.tree.statements[0];

  const iface = vrml.interfaceQuery.effectiveInterfaceOf(graph, selected);
  const nodeValued = iface.members.filter((m) => m.type === 'SFNode' || m.type === 'MFNode');
  assert.ok(nodeValued.some((m) => m.name === 'children'));

  const seen = new Map();
  for (const candidate of ['Shape', 'Box', 'FontStyle']) {
    const v = vrml.containment.childLegality(graph, selected, 'children', candidate);
    seen.set(candidate, v.status);
    assert.equal(v.severity, undefined, 'no severity -- that is WD1.6-D\'s');
    assert.equal(v.message, undefined, 'no UI text');
    assert.equal(v.suggestion, undefined, 'no suggested fix');
    assert.equal(v.profile, undefined, 'no compatibility-profile policy');
  }
  assert.deepEqual([...seen], [['Shape', CS.LEGAL], ['Box', CS.ILLEGAL], ['FontStyle', CS.UNSUPPORTED]]);
});

test('51 C carries no compatibility-profile, Mall, Cybertown or X3D acceptance rule', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/vrml/containment.js'), 'utf8');
  // Comments are stripped: the file DISCUSSES these exclusions at length, and it
  // is the CODE that must not act on them.
  const code = src.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  for (const banned of ['cybertown', 'blaxxun', 'mall', 'compat', 'profile', 'severity', 'policy']) {
    assert.ok(!new RegExp(banned, 'i').test(code),
      `containment.js code must not mention ${banned}`);
  }
  // An X3D-only field is never offered as a VRML97 containment target.
  const d = doc('Appearance{}');
  const v = d.ask(d.node('Appearance'), 'shaders', 'Shape');
  assert.equal(v.status, CS.INVALID);
  assert.equal(v.reason, CR.FIELD_NOT_DECLARED);
});
