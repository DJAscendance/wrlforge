'use strict';
// WD1.7-C, pure half -- ISO 4.9.3 target selection and reachable prototype
// dependencies.
//
// Every expectation below names a status EXPLICITLY. "Did not throw" is not an
// assertion about a semantic gate, and a gate whose failure mode is "returns
// something plausible" is not a gate.

const test = require('node:test');
const assert = require('node:assert/strict');

const { parse, interfaceQuery, protoTarget } = require('../../src/vrml');

const {
  selectPrototypeTarget, externProtoCandidates, prototypeDependencies,
  SELECTION_STATUS, SELECTION_REASON, SELECTION_RULE, DEPENDENCY_KIND, COVERAGE_GAP,
} = protoTarget;

const H = '#VRML V2.0 utf8\n';
const select = (src, fragment) => selectPrototypeTarget(parse(src), fragment === undefined ? {} : { fragment });

// --- ISO 4.9.3 / N8: fragment-less selection --------------------------------

test('N8 selects the first top-level PROTO statement', () => {
  const s = select(`${H}PROTO First [] { Group {} }\nPROTO Second [] { Group {} }\n`);
  assert.equal(s.status, SELECTION_STATUS.RESOLVED);
  assert.equal(s.rule, SELECTION_RULE.FIRST_EXCLUDING_EXTERNPROTO);
  assert.equal(s.selectedProtoName, 'First');
  assert.equal(s.topLevelProtoCount, 2);
});

test("N8's parenthesis: an EXTERNPROTO before the first PROTO is skipped, not selected", () => {
  // The `bxx/shared.wrl` shape (WD1.7-A control C4), and the single most likely
  // way to get 4.9.3 wrong: the file OPENS with an EXTERNPROTO.
  const s = select(`${H}EXTERNPROTO VendorThing [] "vendor.wrl"\nPROTO ActualTarget [] { Group {} }\n`);
  assert.equal(s.status, SELECTION_STATUS.RESOLVED);
  assert.equal(s.selectedProtoName, 'ActualTarget');
  assert.notEqual(s.selectedProtoName, 'VendorThing');
});

test('N8 skips several leading EXTERNPROTOs', () => {
  const s = select(`${H}EXTERNPROTO A [] "a.wrl"\nEXTERNPROTO B [] "b.wrl"\nPROTO C [] { Group {} }\n`);
  assert.equal(s.selectedProtoName, 'C');
});

test('a PROTO nested inside another PROTO is not top-level and is not selected', () => {
  const src = `${H}PROTO Outer [] { PROTO Inner [] { Group {} } Group {} }\nPROTO Later [] { Group {} }\n`;
  const s = select(src);
  assert.equal(s.status, SELECTION_STATUS.RESOLVED);
  assert.equal(s.selectedProtoName, 'Outer');
  assert.equal(s.topLevelProtoCount, 2, 'Inner must not be counted as top level');
});

test('a PROTO written inside a node body is not top-level, even when it comes first', () => {
  // Non-conforming placement this parser accepts. It IS in the document TYPE
  // scope, which is exactly why selection reads the STATEMENT LIST rather than
  // the scope graph: a scope-based rule would select `Inner`.
  const src = `${H}Group { PROTO Inner [] { Group {} } }\nPROTO Top [] { Group {} }\n`;
  const p = parse(src);
  assert.equal(p.diagnostics.filter((d) => d.severity === 'error').length, 0, 'fixture must parse cleanly');
  const s = selectPrototypeTarget(p);
  assert.equal(s.status, SELECTION_STATUS.RESOLVED);
  assert.equal(s.selectedProtoName, 'Top');
  assert.equal(s.topLevelProtoCount, 1);
});

test('a file with only EXTERNPROTOs supplies no target', () => {
  const s = select(`${H}EXTERNPROTO A [] "a.wrl"\nEXTERNPROTO B [] "b.wrl"\n`);
  assert.equal(s.status, SELECTION_STATUS.TARGET_PROTO_NOT_FOUND);
  assert.equal(s.reason, SELECTION_REASON.NO_TOP_LEVEL_PROTO);
  assert.equal(s.topLevelProtoCount, 0);
});

test('a file with no prototype at all supplies no target', () => {
  const s = select(`${H}Group { children [ Shape {} ] }\n`);
  assert.equal(s.status, SELECTION_STATUS.TARGET_PROTO_NOT_FOUND);
  assert.equal(s.reason, SELECTION_REASON.NO_TOP_LEVEL_PROTO);
});

test('the word PROTO in a comment or a string is not a declaration', () => {
  const src = `${H}# PROTO Commented [] { Group {} }\n`
    + 'WorldInfo { info [ "PROTO InString [] { Group {} }" ] }\n'
    + 'PROTO Real [] { Group {} }\n';
  const p = parse(src);
  assert.equal(p.diagnostics.filter((d) => d.severity === 'error').length, 0);
  assert.equal(selectPrototypeTarget(p).selectedProtoName, 'Real');
  assert.equal(selectPrototypeTarget(p, { fragment: 'Commented' }).status, SELECTION_STATUS.TARGET_PROTO_NOT_FOUND);
  assert.equal(selectPrototypeTarget(p, { fragment: 'InString' }).status, SELECTION_STATUS.TARGET_PROTO_NOT_FOUND);
});

// --- ISO 4.9.3 / N10: explicit fragment selection ---------------------------

test('a fragment selects the top-level PROTO of that exact name', () => {
  const src = `${H}PROTO Alpha [] { Group {} }\nPROTO Beta [] { Group {} }\nPROTO Gamma [] { Group {} }\n`;
  const s = select(src, 'Beta');
  assert.equal(s.status, SELECTION_STATUS.RESOLVED);
  assert.equal(s.rule, SELECTION_RULE.FRAGMENT);
  assert.equal(s.selectedProtoName, 'Beta');
  assert.equal(s.fragment, 'Beta');
});

test('fragment matching is case-sensitive', () => {
  const src = `${H}PROTO Alpha [] { Group {} }\n`;
  assert.equal(select(src, 'alpha').status, SELECTION_STATUS.TARGET_PROTO_NOT_FOUND);
  assert.equal(select(src, 'alpha').reason, SELECTION_REASON.FRAGMENT_NAMES_NO_TOP_LEVEL_PROTO);
  assert.equal(select(src, 'ALPHA').status, SELECTION_STATUS.TARGET_PROTO_NOT_FOUND);
  assert.equal(select(src, 'Alpha').status, SELECTION_STATUS.RESOLVED);
});

test('a fragment naming nothing is not found', () => {
  const s = select(`${H}PROTO Alpha [] { Group {} }\n`, 'Missing');
  assert.equal(s.status, SELECTION_STATUS.TARGET_PROTO_NOT_FOUND);
  assert.equal(s.reason, SELECTION_REASON.FRAGMENT_NAMES_NO_TOP_LEVEL_PROTO);
});

test('a fragment never selects an EXTERNPROTO of the same name', () => {
  const s = select(`${H}EXTERNPROTO Thing [] "thing.wrl"\nPROTO Other [] { Group {} }\n`, 'Thing');
  assert.equal(s.status, SELECTION_STATUS.TARGET_PROTO_NOT_FOUND);
});

test('a fragment never selects a nested PROTO of that name', () => {
  const s = select(`${H}PROTO Outer [] { PROTO Inner [] { Group {} } Group {} }\n`, 'Inner');
  assert.equal(s.status, SELECTION_STATUS.TARGET_PROTO_NOT_FOUND);
});

test('a duplicated fragment name is AMBIGUOUS, and the first does NOT win', () => {
  const src = `${H}PROTO Dup [] { Group {} }\nPROTO Other [] { Group {} }\nPROTO Dup [] { Shape {} }\n`;
  const s = select(src, 'Dup');
  assert.equal(s.status, SELECTION_STATUS.TARGET_PROTO_AMBIGUOUS);
  assert.equal(s.reason, SELECTION_REASON.DUPLICATE_TOP_LEVEL_PROTO_NAME);
  assert.equal(s.selectedProtoName, null, 'an ambiguous selection binds nothing');
  assert.equal(s.declaration, null);
  assert.equal(s.matches.length, 2, 'every matching declaration is kept as evidence');
  assert.notEqual(s.matches[0].range.start.offset, s.matches[1].range.start.offset);
});

test('a duplicate name does NOT disturb fragment-less selection, which asks a different question', () => {
  // WD1.7-C brief §12: 4.9.3's fragment-less rule identifies the FIRST
  // statement, and a later duplicate does not erase which one was first.
  const src = `${H}PROTO Dup [] { Group {} }\nPROTO Dup [] { Shape {} }\n`;
  const s = select(src);
  assert.equal(s.status, SELECTION_STATUS.RESOLVED);
  assert.equal(s.selectedProtoName, 'Dup');
  assert.equal(s.declarationRange.start.offset, parse(src).tree.statements[0].range.start.offset);
});

test('an empty fragment names nothing and is never re-read as fragment-less', () => {
  const s = select(`${H}PROTO Alpha [] { Group {} }\n`, '');
  assert.equal(s.status, SELECTION_STATUS.TARGET_PROTO_NOT_FOUND);
  assert.equal(s.reason, SELECTION_REASON.EMPTY_FRAGMENT);
  assert.equal(s.rule, SELECTION_RULE.FRAGMENT);
  assert.equal(s.selectedProtoName, null);
});

// --- the recovery proof gate ------------------------------------------------

test('a non-VRML target is TARGET_PARSE_FAILED, not ISO_PROHIBITED and not empty', () => {
  const s = selectPrototypeTarget(parse('<html><body>404 Not Found</body></html>\n'));
  assert.equal(s.status, SELECTION_STATUS.TARGET_PARSE_FAILED);
  assert.equal(s.reason, SELECTION_REASON.NO_VRML_HEADER);
});

test('a JPEG-ish binary target is TARGET_PARSE_FAILED', () => {
  const s = selectPrototypeTarget(parse('����JFIF '));
  assert.equal(s.status, SELECTION_STATUS.TARGET_PARSE_FAILED);
});

test('recovery BEFORE the candidate declaration withholds the selection', () => {
  const src = `${H}Transform { translation }\nPROTO Target [] { Group {} }\n`;
  const p = parse(src);
  assert.ok(p.diagnostics.some((d) => d.severity === 'error'), 'fixture must actually damage the prefix');
  const s = selectPrototypeTarget(p);
  assert.equal(s.status, SELECTION_STATUS.TARGET_PARSE_FAILED);
  assert.equal(s.reason, SELECTION_REASON.SELECTION_PREFIX_UNPROVABLE);
  assert.equal(s.selectedProtoName, null);
});

test('recovery INSIDE the candidate declaration withholds the selection', () => {
  const p = parse(`${H}PROTO Target [] { Group { children [ Shape {} \n`);
  assert.ok(p.diagnostics.some((d) => d.severity === 'error'));
  assert.equal(selectPrototypeTarget(p).status, SELECTION_STATUS.TARGET_PARSE_FAILED);
});

test('recovery strictly AFTER a proven first declaration does NOT withhold it', () => {
  // The proof boundary is exactly as wide as the claim: "no top-level PROTO
  // precedes this one" depends only on the text up to its end.
  const src = `${H}PROTO Target [] { Group {} }\nTransform { translation }\n`;
  const p = parse(src);
  const errors = p.diagnostics.filter((d) => d.severity === 'error');
  assert.ok(errors.length > 0, 'fixture must actually be damaged');
  const first = p.tree.statements[0];
  assert.ok(errors.every((d) => d.range.start.offset > first.range.end.offset), 'damage must be after the declaration');
  const s = selectPrototypeTarget(p);
  assert.equal(s.status, SELECTION_STATUS.RESOLVED);
  assert.equal(s.selectedProtoName, 'Target');
});

test('FRAGMENT selection withholds on damage anywhere, because a duplicate could hide anywhere', () => {
  const src = `${H}PROTO Target [] { Group {} }\nTransform { translation }\n`;
  const s = selectPrototypeTarget(parse(src), { fragment: 'Target' });
  assert.equal(s.status, SELECTION_STATUS.TARGET_PARSE_FAILED);
  assert.equal(s.reason, SELECTION_REASON.TOP_LEVEL_ENUMERATION_UNPROVABLE);
});

test('a damaged document cannot assert that NO prototype is present either', () => {
  const src = `${H}Transform { translation }\n`;
  const s = selectPrototypeTarget(parse(src));
  assert.equal(s.status, SELECTION_STATUS.TARGET_PARSE_FAILED);
  assert.equal(s.reason, SELECTION_REASON.TOP_LEVEL_ENUMERATION_UNPROVABLE);
  assert.equal(s.topLevelProtoCount, null, 'a withheld enumeration must not report 0');
});

test('a capped parse holds only a prefix and selects nothing', () => {
  const src = `${H}PROTO A [] { Group {} }\nPROTO B [] { Group {} }\n`;
  const p = parse(src, { maxNodes: 1 });
  assert.ok(p.truncated || p.depthCapped || p.diagnostics.some((d) => d.severity === 'error'));
  const s = selectPrototypeTarget(p);
  assert.equal(s.status, SELECTION_STATUS.TARGET_PARSE_FAILED);
});

test('the selection record never leaks a declaration on a non-RESOLVED status', () => {
  for (const [src, frag] of [
    [`${H}EXTERNPROTO A [] "a.wrl"\n`, undefined],
    [`${H}PROTO Dup [] { Group {} }\nPROTO Dup [] { Shape {} }\n`, 'Dup'],
    [`${H}Transform { translation }\nPROTO T [] { Group {} }\n`, undefined],
    ['not vrml at all\n', undefined],
  ]) {
    const s = frag === undefined ? select(src) : select(src, frag);
    assert.notEqual(s.status, SELECTION_STATUS.RESOLVED);
    assert.equal(s.declaration, null);
    assert.equal(s.selectedProtoName, null);
  }
});

test('selection is frozen and rejects a non-parse-result', () => {
  const s = select(`${H}PROTO A [] { Group {} }\n`);
  assert.ok(Object.isFrozen(s));
  assert.throws(() => selectPrototypeTarget(null), TypeError);
  assert.throws(() => selectPrototypeTarget({}), TypeError);
  assert.throws(() => selectPrototypeTarget({ syntaxDiagnostics: [], truncated: false, depthCapped: false, tree: { type: 'Node' } }), TypeError);
});

// --- EXTERNPROTO declaration reading (AST authority) ------------------------

test('candidates are read from the AST in written order, verbatim', () => {
  const src = `${H}EXTERNPROTO T [] [ "  a.wrl  ", "b.wrl#Name", "urn:x" ]\n`;
  const p = parse(src);
  const d = externProtoCandidates(p, p.tree.statements[0]);
  assert.equal(d.name, 'T');
  assert.equal(d.damaged, false);
  assert.deepEqual(d.candidates.map((c) => c.writtenUrl), ['  a.wrl  ', 'b.wrl#Name', 'urn:x']);
  assert.deepEqual(d.candidates.map((c) => c.index), [0, 1, 2]);
});

test('a bracket-less single url is read as one candidate (Annex A.2)', () => {
  const p = parse(`${H}EXTERNPROTO T [] "only.wrl"\n`);
  assert.deepEqual(externProtoCandidates(p, p.tree.statements[0]).candidates.map((c) => c.writtenUrl), ['only.wrl']);
});

test('an intact declaration with an empty url list is not damaged, just empty', () => {
  const p = parse(`${H}EXTERNPROTO T [] [ ]\n`);
  const d = externProtoCandidates(p, p.tree.statements[0]);
  assert.equal(d.damaged, false);
  assert.equal(d.candidates.length, 0);
});

test('a declaration parser recovery touched is damaged, and a missing url list is too', () => {
  const p = parse(`${H}EXTERNPROTO T [ field SFBool\n`);
  const decl = p.tree.statements.find((s) => s.type === 'ExternProto');
  assert.ok(decl, 'fixture must still yield a declaration');
  assert.equal(externProtoCandidates(p, decl).damaged, true);
});

// --- reachable prototype dependencies (P2A is the only type authority) ------

const depsOf = (src, rootPicker) => {
  const p = parse(src);
  const g = interfaceQuery.buildScopeGraph(p);
  const root = rootPicker ? rootPicker(p) : p.tree;
  const found = prototypeDependencies(g, root);
  return { p, refs: found.references, gaps: found.coverageGaps };
};

test('an instantiated EXTERNPROTO is a dependency; a declared-but-unused one is not', () => {
  const src = `${H}EXTERNPROTO Used [] "u.wrl"\nEXTERNPROTO Unused [] "x.wrl"\nUsed {}\n`;
  const { refs } = depsOf(src);
  const ext = refs.filter((r) => r.kind === DEPENDENCY_KIND.EXTERNPROTO);
  assert.deepEqual(ext.map((r) => r.typeName), ['Used']);
});

test('a dependency reached through a local PROTO records the path it came by', () => {
  const src = `${H}EXTERNPROTO Dep [] "d.wrl"\n`
    + 'PROTO Wrapper [] { Group { children [ Dep {} ] } }\n'
    + 'Wrapper {}\n';
  const { refs } = depsOf(src);
  const ext = refs.filter((r) => r.kind === DEPENDENCY_KIND.EXTERNPROTO);
  assert.equal(ext.length, 1);
  assert.equal(ext[0].typeName, 'Dep');
  assert.deepEqual(ext[0].via, ['Wrapper']);
  assert.ok(refs.some((r) => r.kind === DEPENDENCY_KIND.PROTO && r.typeName === 'Wrapper'));
});

test('an UNINSTANTIATED local PROTO body is not traversed', () => {
  const src = `${H}EXTERNPROTO Dep [] "d.wrl"\n`
    + 'PROTO NeverUsed [] { Group { children [ Dep {} ] } }\n'
    + 'Group {}\n';
  const { refs } = depsOf(src);
  assert.equal(refs.filter((r) => r.kind === DEPENDENCY_KIND.EXTERNPROTO).length, 0);
});

test('built-ins are classified, never reported as dependencies', () => {
  const { refs } = depsOf(`${H}Group { children [ Shape { geometry Box {} } ] }\n`);
  assert.ok(refs.length >= 3);
  assert.ok(refs.every((r) => r.kind === DEPENDENCY_KIND.BUILTIN));
});

test('an unknown vendor type is WITHHELD with P2A’s own reason, never guessed', () => {
  const { refs } = depsOf(`${H}SomeVendorNode {}\n`);
  const w = refs.find((r) => r.typeName === 'SomeVendorNode');
  assert.equal(w.kind, DEPENDENCY_KIND.WITHHELD);
  assert.equal(w.declaration, null);
  assert.equal(w.resolutionStatus, interfaceQuery.STATUS.UNRESOLVED);
  assert.equal(w.resolutionReason, interfaceQuery.REASON.NODE_TYPE_UNKNOWN);
});

test('a duplicate prototype declaration is WITHHELD, not resolved to either one', () => {
  const src = `${H}EXTERNPROTO Dup [] "a.wrl"\nEXTERNPROTO Dup [] "b.wrl"\nDup {}\n`;
  const { refs } = depsOf(src);
  const w = refs.find((r) => r.typeName === 'Dup');
  assert.equal(w.kind, DEPENDENCY_KIND.WITHHELD);
  assert.equal(w.resolutionStatus, interfaceQuery.STATUS.AMBIGUOUS);
});

test('the owning prototype of a nested declaration is reported, not merely the fact of nesting', () => {
  const src = `${H}PROTO Outer [] { EXTERNPROTO Dep [] "d.wrl" Group { children [ Dep {} ] } }\nOuter {}\n`;
  const { p, refs } = depsOf(src);
  const ext = refs.find((r) => r.kind === DEPENDENCY_KIND.EXTERNPROTO);
  assert.equal(ext.typeName, 'Dep');
  assert.equal(ext.declaringPrototype, p.tree.statements[0], 'must be the Outer Proto AST node itself');
});

test('a top-level declaration has NO owning prototype even when instantiated inside one', () => {
  const src = `${H}EXTERNPROTO Dep [] "d.wrl"\nPROTO Outer [] { Group { children [ Dep {} ] } }\nOuter {}\n`;
  const { refs } = depsOf(src);
  const ext = refs.find((r) => r.kind === DEPENDENCY_KIND.EXTERNPROTO);
  assert.equal(ext.declaringPrototype, null);
});

test('dependencies can be enumerated from one PROTO implementation alone', () => {
  const src = `${H}EXTERNPROTO Dep [] "d.wrl"\nPROTO Only [] { Group { children [ Dep {} ] } }\nGroup {}\n`;
  const { p, refs } = depsOf(src, (r) => r.tree.statements.find((s) => s.type === 'Proto'));
  assert.ok(p);
  assert.deepEqual(refs.filter((r) => r.kind === DEPENDENCY_KIND.EXTERNPROTO).map((r) => r.typeName), ['Dep']);
});

test('prototypeDependencies rejects a root that is neither a Document nor a Proto', () => {
  const p = parse(`${H}Group {}\n`);
  const g = interfaceQuery.buildScopeGraph(p);
  assert.throws(() => prototypeDependencies(g, p.tree.statements[0]), TypeError);
  assert.throws(() => prototypeDependencies(g, null), TypeError);
});

test('every dependency record is frozen', () => {
  const { refs } = depsOf(`${H}EXTERNPROTO D [] "d.wrl"\nD {}\n`);
  assert.ok(refs.every((r) => Object.isFrozen(r)));
});

// --- inherited semantic coverage gaps (QA finding F-WD17C-01) ---------------
//
// WD1.5-P2A does not index node occurrences inside a PROTO's interface DEFAULT
// values. Nothing below resolves one -- a private lookup here is the second type
// authority the lane refuses to become. What is asserted is that the REGION is
// reported, so a consumer can decline to claim an exhaustive enumeration.

test('a node occurrence in an SFNode interface default is reported as an unindexed region', () => {
  const src = `${H}EXTERNPROTO DefaultDep [] "dep.wrl"\n`
    + 'PROTO Wrapper [\n  field SFNode thing DefaultDep {}\n] {\n  Group {}\n}\n'
    + 'Wrapper {}\n';
  const { refs, gaps } = depsOf(src);
  // The finding itself: no dependency is invented for it.
  assert.equal(refs.filter((r) => r.typeName === 'DefaultDep').length, 0,
    'C must NOT resolve an unindexed occurrence into a dependency');
  assert.equal(gaps.length, 1);
  const g = gaps[0];
  assert.equal(g.gap, COVERAGE_GAP.UNINDEXED_INTERFACE_DEFAULT);
  assert.equal(g.prototypeName, 'Wrapper');
  assert.equal(g.memberAccess, 'field');
  assert.equal(g.memberFieldType, 'SFNode');
  assert.equal(g.memberName, 'thing');
  assert.equal(g.occurrenceCount, 1);
  assert.equal(g.writtenTypeName, 'DefaultDep');
  assert.deepEqual(g.via, ['Wrapper']);
  assert.ok(g.defaultRange && g.firstOccurrenceRange && g.memberRange && g.prototypeRange);
});

test('an MFNode interface default reports every occurrence it holds, nested ones included', () => {
  const src = `${H}EXTERNPROTO A [] "a.wrl"\nEXTERNPROTO B [] "b.wrl"\n`
    + 'PROTO Wrapper [\n  field MFNode things [ A {} , Group { children [ B {} ] } ]\n] { Group {} }\n'
    + 'Wrapper {}\n';
  const { refs, gaps } = depsOf(src);
  assert.equal(refs.filter((r) => r.typeName === 'A' || r.typeName === 'B').length, 0);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].memberFieldType, 'MFNode');
  assert.equal(gaps[0].occurrenceCount, 3, 'A, the Group, and the nested B');
  assert.equal(gaps[0].writtenTypeName, 'A', 'evidence is the FIRST occurrence in source order');
});

test('a BUILT-IN-only node default is still an unindexed region -- the gate is conservative', () => {
  // C has no authoritative binding for this position, so it cannot say the
  // occurrence is the built-in. It withholds instead of asserting, and it still
  // invents no dependency. Documented conservatism, not an oversight.
  const src = `${H}PROTO Wrapper [\n  field SFNode thing Group {}\n] { Group {} }\nWrapper {}\n`;
  const { refs, gaps } = depsOf(src);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].writtenTypeName, 'Group');
  assert.ok(refs.every((r) => r.kind !== DEPENDENCY_KIND.EXTERNPROTO));
});

test('PRIMITIVE interface defaults raise nothing -- the gate is about node occurrences', () => {
  const src = `${H}PROTO P [\n  field SFFloat amount 1\n  field SFString label "hello"\n`
    + '  field SFVec3f where 0 0 0\n  field MFString urls [ "a", "b" ]\n'
    + '  exposedField SFBool on TRUE\n  eventIn SFBool set_on\n  eventOut SFBool on_changed\n'
    + '] { Group {} }\nP {}\n';
  const { gaps } = depsOf(src);
  assert.deepEqual(gaps, []);
});

test('an explicit NULL SFNode default raises nothing -- there is no occurrence to lose', () => {
  const { gaps } = depsOf(`${H}PROTO P [\n  field SFNode thing NULL\n] { Group {} }\nP {}\n`);
  assert.deepEqual(gaps, []);
});

test('an UNREACHED prototype’s interface default does not poison the enumeration', () => {
  // Same boundary as the dependency walk itself: a prototype nothing
  // instantiates contributes no dependency, so it contributes no gap either.
  const src = `${H}EXTERNPROTO Dep [] "d.wrl"\n`
    + 'PROTO Used [] { Group {} }\n'
    + 'PROTO Unused [\n  field SFNode thing Dep {}\n] { Group {} }\n'
    + 'Used {}\n';
  const { gaps } = depsOf(src);
  assert.deepEqual(gaps, []);
});

test('a REACHED local prototype’s interface default IS reported, through the via path', () => {
  const src = `${H}EXTERNPROTO Dep [] "d.wrl"\n`
    + 'PROTO Helper [\n  field SFNode thing Dep {}\n] { Group {} }\n'
    + 'PROTO Outer [] { Helper {} }\n'
    + 'Outer {}\n';
  const { gaps } = depsOf(src);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].prototypeName, 'Helper');
  assert.deepEqual(gaps[0].via, ['Outer', 'Helper']);
});

test('a PROTO root audits its OWN interface defaults', () => {
  const src = `${H}EXTERNPROTO Dep [] "d.wrl"\nPROTO Only [\n  field SFNode thing Dep {}\n] { Group {} }\n`;
  const { gaps } = depsOf(src, (r) => r.tree.statements.find((st) => st.type === 'Proto'));
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].prototypeName, 'Only');
  assert.deepEqual(gaps[0].via, []);
});

test('a USE in an interface default raises nothing -- it names a DEF, not a type', () => {
  const src = `${H}PROTO P [\n  field SFNode thing USE Somewhere\n] { Group {} }\nP {}\n`;
  const { gaps } = depsOf(src);
  assert.deepEqual(gaps, []);
});

test('an EXTERNPROTO interface cannot produce a gap -- Annex A.2 gives it no defaults', () => {
  const src = `${H}EXTERNPROTO E [\n  field SFNode thing\n] "e.wrl"\nE {}\n`;
  const { gaps } = depsOf(src);
  assert.deepEqual(gaps, []);
});

test('every coverage-gap record is frozen, and so is the list', () => {
  const src = `${H}PROTO P [\n  field SFNode thing Group {}\n] { Group {} }\nP {}\n`;
  const p = parse(src);
  const found = prototypeDependencies(interfaceQuery.buildScopeGraph(p), p.tree);
  assert.ok(Object.isFrozen(found));
  assert.ok(Object.isFrozen(found.coverageGaps));
  assert.ok(found.coverageGaps.every((g) => Object.isFrozen(g) && Object.isFrozen(g.via)));
});

// --- `declarationMayExist`: the OTHER way an edge can be missing ------------

test('a vendor type P2A proved undeclared hides nothing', () => {
  const { refs } = depsOf(`${H}SomeVendorNode {}\n`);
  const w = refs.find((r) => r.typeName === 'SomeVendorNode');
  assert.equal(w.kind, DEPENDENCY_KIND.WITHHELD);
  assert.equal(w.declarationMayExist, false,
    'the chain was proven and the whole-scope lookup found nothing -- a complete answer');
});

test('a DUPLICATE declaration could be an EXTERNPROTO, so an edge may be missing', () => {
  const src = `${H}EXTERNPROTO Dup [] "a.wrl"\nEXTERNPROTO Dup [] "b.wrl"\nDup {}\n`;
  const { refs } = depsOf(src);
  const w = refs.find((r) => r.typeName === 'Dup');
  assert.equal(w.kind, DEPENDENCY_KIND.WITHHELD);
  assert.equal(w.declarationMayExist, true);
});

test('a FORWARD reference to a declaration is withheld, and may be hiding an edge', () => {
  const src = `${H}Dep {}\nEXTERNPROTO Dep [] "d.wrl"\n`;
  const { refs } = depsOf(src);
  const w = refs.find((r) => r.typeName === 'Dep');
  assert.equal(w.kind, DEPENDENCY_KIND.WITHHELD);
  assert.equal(w.declarationMayExist, true);
});

test('a bound occurrence never claims a declaration may exist', () => {
  const { refs } = depsOf(`${H}EXTERNPROTO D [] "d.wrl"\nGroup { children [ D {} ] }\n`);
  assert.ok(refs.every((r) => r.declarationMayExist === false));
});
