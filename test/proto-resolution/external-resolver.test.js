'use strict';
// WD1.7-C -- the ISO 4.5.2 candidate walk.
//
// The property under test throughout: RETRIEVED IS NOT RESOLVED. Every one of
// WD1.7-A §15.3's non-terminal outcomes must let the walk continue, and only a
// successful 4.9.3 selection may stop it.

const test = require('node:test');
const assert = require('node:assert/strict');

const { parse } = require('../../src/vrml');
const {
  resolveExternalPrototype, createResolutionSession,
  RESOLUTION_STATUS, RESOLUTION_REASON, SELECTION_STATUS, SELECTION_RULE,
} = require('../../src/proto-resolution');
const { RETRIEVAL_STATUS } = require('../../src/external-proto');
const { H, makeArchive, cleanupArchives, library, world } = require('./fixture-archive');

test.after(cleanupArchives);

// Resolve the single EXTERNPROTO of `worldText`, written into the archive at
// `worldPath`, against a context built over `files`.
function resolveOne(files, worldPath, worldText, opts = {}) {
  const all = { ...files, [worldPath]: worldText };
  const { context } = makeArchive(all, opts.sources);
  const p = parse(worldText);
  const declaration = p.tree.statements.find((s) => s.type === 'ExternProto');
  const base = { sourceId: opts.sourceId || 'archive', path: opts.basePath || worldPath };
  return resolveExternalPrototype({
    context, baseDocument: base, parseResult: p, declaration, session: opts.session,
  });
}

const statusesOf = (r) => r.candidates.map((c) => (c.evaluated ? (c.selection ? c.selection.status : c.retrieval.status) : 'not-evaluated'));

// --- the happy path ---------------------------------------------------------

test('a single relative candidate resolves, fragment-less', () => {
  const r = resolveOne({ 'lib.wrl': library('Thing') }, 'main.wrl', world('Thing', ['lib.wrl']));
  assert.equal(r.status, RESOLUTION_STATUS.RESOLVED);
  assert.equal(r.reason, RESOLUTION_REASON.OK);
  assert.equal(r.selectedCandidateIndex, 0);
  assert.equal(r.target.selectedProtoName, 'Thing');
  assert.equal(r.target.selectionRule, SELECTION_RULE.FIRST_EXCLUDING_EXTERNPROTO);
  assert.equal(r.target.selectionWasUnique, true);
  assert.equal(r.target.artifactPath, 'lib.wrl');
  assert.equal(r.target.evidenceSourceId, 'archive');
  assert.deepEqual(r.target.base, { sourceId: 'archive', path: 'lib.wrl' });
});

test('an explicit fragment selects by name, and the rule says which rule ran', () => {
  const lib = `${H}PROTO Alpha [] { Group {} }\nPROTO Beta [] { Shape {} }\n`;
  const r = resolveOne({ 'lib.wrl': lib }, 'main.wrl', world('T', ['lib.wrl#Beta']));
  assert.equal(r.status, RESOLUTION_STATUS.RESOLVED);
  assert.equal(r.target.selectedProtoName, 'Beta');
  assert.equal(r.target.selectionRule, SELECTION_RULE.FRAGMENT);
});

test('the target name need not match the EXTERNPROTO name (ISO 4.9.3/N8)', () => {
  const r = resolveOne({ 'lib.wrl': library('SomethingElse') }, 'main.wrl', world('LocalName', ['lib.wrl']));
  assert.equal(r.status, RESOLUTION_STATUS.RESOLVED);
  assert.equal(r.declarationName, 'LocalName');
  assert.equal(r.target.selectedProtoName, 'SomethingElse');
});

test('gzip behind a plain .wrl name is decoded by B and selected from normally', () => {
  const r = resolveOne({ 'lib.wrl': { gzip: library('Zipped') } }, 'main.wrl', world('T', ['lib.wrl']));
  assert.equal(r.status, RESOLUTION_STATUS.RESOLVED);
  assert.equal(r.target.selectedProtoName, 'Zipped');
  assert.equal(r.target.wasGzipped, true);
});

// --- ISO 4.5.2 ordered fallback --------------------------------------------

test('candidate 0 NOT_FOUND -> candidate 1 RESOLVED', () => {
  const r = resolveOne({ 'b.wrl': library('B') }, 'main.wrl', world('T', ['missing.wrl', 'b.wrl']));
  assert.equal(r.status, RESOLUTION_STATUS.RESOLVED);
  assert.equal(r.selectedCandidateIndex, 1);
  assert.deepEqual(statusesOf(r), [RETRIEVAL_STATUS.NOT_FOUND, SELECTION_STATUS.RESOLVED]);
});

test('candidate 0 RETRIEVED but TARGET_PROTO_NOT_FOUND -> candidate 1 RESOLVED', () => {
  // The single most important case in the lane: retrieval SUCCEEDED and the walk
  // still had to continue. A resolver that stops on RETRIEVED returns the wrong
  // library here and never looks at candidate 1.
  const files = { 'a.wrl': `${H}Group { children [ Shape {} ] }\n`, 'b.wrl': library('B') };
  const r = resolveOne(files, 'main.wrl', world('T', ['a.wrl', 'b.wrl']));
  assert.equal(r.status, RESOLUTION_STATUS.RESOLVED);
  assert.equal(r.selectedCandidateIndex, 1);
  assert.equal(r.candidates[0].retrieval.status, RETRIEVAL_STATUS.RETRIEVED);
  assert.equal(r.candidates[0].selection.status, SELECTION_STATUS.TARGET_PROTO_NOT_FOUND);
  assert.equal(r.target.selectedProtoName, 'B');
});

test('candidate 0 TARGET_PARSE_FAILED -> candidate 1 RESOLVED', () => {
  const files = { 'a.wrl': '<html>not vrml</html>\n', 'b.wrl': library('B') };
  const r = resolveOne(files, 'main.wrl', world('T', ['a.wrl', 'b.wrl']));
  assert.equal(r.status, RESOLUTION_STATUS.RESOLVED);
  assert.equal(r.selectedCandidateIndex, 1);
  assert.equal(r.candidates[0].selection.status, SELECTION_STATUS.TARGET_PARSE_FAILED);
});

test('candidate 0 TARGET_PROTO_AMBIGUOUS -> candidate 1 RESOLVED', () => {
  const dup = `${H}PROTO Dup [] { Group {} }\nPROTO Dup [] { Shape {} }\n`;
  const files = { 'a.wrl': dup, 'b.wrl': library('Dup') };
  const r = resolveOne(files, 'main.wrl', world('T', ['a.wrl#Dup', 'b.wrl#Dup']));
  assert.equal(r.status, RESOLUTION_STATUS.RESOLVED);
  assert.equal(r.selectedCandidateIndex, 1);
  assert.equal(r.candidates[0].selection.status, SELECTION_STATUS.TARGET_PROTO_AMBIGUOUS);
  assert.equal(r.candidates[0].selection.matches.length, 2, 'ambiguity evidence survives the fallback');
});

test('candidate 0 urn UNSUPPORTED_REFERENCE -> candidate 1 RESOLVED', () => {
  const r = resolveOne({ 'b.wrl': library('B') }, 'main.wrl', world('T', ['urn:inet:blaxxun.com:node:HUD', 'b.wrl']));
  assert.equal(r.status, RESOLUTION_STATUS.RESOLVED);
  assert.equal(r.selectedCandidateIndex, 1);
  assert.equal(r.candidates[0].retrieval.status, RETRIEVAL_STATUS.UNSUPPORTED_REFERENCE);
  assert.equal(r.candidates[0].retrieval.form, 'urn');
});

test('candidate 0 absolute http with no configured mapping -> candidate 1 RESOLVED', () => {
  const r = resolveOne({ 'b.wrl': library('B') }, 'main.wrl', world('T', ['http://www.blaxxun.com/x.wrl', 'b.wrl']));
  assert.equal(r.status, RESOLUTION_STATUS.RESOLVED);
  assert.equal(r.candidates[0].retrieval.status, RETRIEVAL_STATUS.NOT_RETRIEVED_BY_POLICY);
});

test('once a candidate RESOLVES, later candidates are NOT evaluated and get no invented status', () => {
  const files = { 'a.wrl': library('A'), 'b.wrl': library('B') };
  const r = resolveOne(files, 'main.wrl', world('T', ['a.wrl', 'b.wrl']));
  assert.equal(r.selectedCandidateIndex, 0);
  assert.equal(r.candidates.length, 2, 'the authored list is preserved in full');
  assert.equal(r.candidates[1].evaluated, false);
  assert.equal(r.candidates[1].retrieval, null);
  assert.equal(r.candidates[1].selection, null);
  assert.equal(r.candidates[1].writtenUrl, 'b.wrl', 'the written spelling survives');
});

test('when every candidate fails, no target is produced and every outcome is kept', () => {
  const files = { 'a.wrl': `${H}Group {}\n` };
  const r = resolveOne(files, 'main.wrl', world('T', ['urn:x', 'gone.wrl', 'a.wrl']));
  assert.notEqual(r.status, RESOLUTION_STATUS.RESOLVED);
  assert.equal(r.target, null);
  assert.equal(r.selectedCandidateIndex, null);
  assert.deepEqual(statusesOf(r), [
    RETRIEVAL_STATUS.UNSUPPORTED_REFERENCE,
    RETRIEVAL_STATUS.NOT_FOUND,
    SELECTION_STATUS.TARGET_PROTO_NOT_FOUND,
  ]);
  // The headline is the first candidate that actually produced a document.
  assert.equal(r.status, RESOLUTION_STATUS.TARGET_PROTO_NOT_FOUND);
});

test('artifact unavailable and target missing stay distinguishable', () => {
  const r = resolveOne({}, 'main.wrl', world('T', ['gone.wrl']));
  assert.equal(r.status, RESOLUTION_STATUS.NOT_ATTEMPTED);
  assert.equal(r.reason, RESOLUTION_REASON.NO_CANDIDATE_RETRIEVED);
  assert.equal(r.candidates[0].retrieval.status, RETRIEVAL_STATUS.NOT_FOUND);
  assert.equal(r.candidates[0].selection, null, 'nothing was parsed, so nothing was selected');
});

test('an exact-case near miss is a retrieval finding, never promoted to a hit', () => {
  const r = resolveOne({ 'Lib.wrl': library('Thing') }, 'main.wrl', world('T', ['lib.wrl']));
  assert.equal(r.status, RESOLUTION_STATUS.NOT_ATTEMPTED);
  assert.equal(r.candidates[0].retrieval.status, RETRIEVAL_STATUS.NOT_FOUND);
  assert.equal(r.candidates[0].retrieval.reason, 'case-mismatch');
});

// --- declarations that cannot be read at all --------------------------------

test('a damaged declaration is NOT_ATTEMPTED, and no candidate is retrieved', () => {
  const { context } = makeArchive({ 'lib.wrl': library('Thing') });
  const text = `${H}EXTERNPROTO T [ field SFBool\n`;
  const p = parse(text);
  const declaration = p.tree.statements.find((s) => s.type === 'ExternProto');
  const r = resolveExternalPrototype({
    context, baseDocument: { sourceId: 'archive', path: 'main.wrl' }, parseResult: p, declaration,
  });
  assert.equal(r.status, RESOLUTION_STATUS.NOT_ATTEMPTED);
  assert.equal(r.reason, RESOLUTION_REASON.DECLARATION_UNPROVABLE);
  assert.equal(r.candidates.length, 0);
});

test('an intact declaration with an empty url list is NO_CANDIDATES', () => {
  const r = resolveOne({}, 'main.wrl', `${H}EXTERNPROTO T [] [ ]\nT {}\n`);
  assert.equal(r.status, RESOLUTION_STATUS.NOT_ATTEMPTED);
  assert.equal(r.reason, RESOLUTION_REASON.NO_CANDIDATES);
});

// --- contract shape ---------------------------------------------------------

test('the base document is REQUIRED and is never inferred', () => {
  const { context } = makeArchive({ 'lib.wrl': library('Thing') });
  const p = parse(world('T', ['lib.wrl']));
  const declaration = p.tree.statements.find((s) => s.type === 'ExternProto');
  assert.throws(() => resolveExternalPrototype({ context, parseResult: p, declaration }), /baseDocument is REQUIRED/);
  assert.throws(() => resolveExternalPrototype({ baseDocument: { sourceId: 'archive', path: 'main.wrl' }, parseResult: p, declaration }), /context/);
});

test('the resolution record and its candidates are frozen', () => {
  const r = resolveOne({ 'lib.wrl': library('Thing') }, 'main.wrl', world('T', ['lib.wrl']));
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.candidates));
  assert.ok(r.candidates.every((c) => Object.isFrozen(c)));
  assert.ok(Object.isFrozen(r.target));
});

test('an operation-scoped session parses one decoded artifact once', () => {
  const session = createResolutionSession();
  const files = { 'a.wrl': library('Same'), 'b.wrl': library('Same') };
  const worldText = world('T', ['a.wrl']);
  const first = resolveOne(files, 'main.wrl', worldText, { session });
  assert.equal(first.status, RESOLUTION_STATUS.RESOLVED);
  assert.equal(session.parses.size, 1);
  // Byte-identical content at a different path reuses the PARSE...
  const second = resolveOne(files, 'main.wrl', world('T', ['b.wrl']), { session });
  assert.equal(session.parses.size, 1, 'identical decoded content is parsed once');
  // ...but NOT the provenance: location is what resolves the next hop.
  assert.equal(first.target.artifactPath, 'a.wrl');
  assert.equal(second.target.artifactPath, 'b.wrl');
  assert.equal(first.target.decodedContentHash, second.target.decodedContentHash);
  assert.notDeepEqual(first.target.base, second.target.base);
});

test('two configured sources with DIFFERENT content for one url are AMBIGUOUS_SOURCE, and the walk continues', () => {
  const { context } = makeArchive({
    'one/lib.wrl': library('FromOne'),
    'two/lib.wrl': library('FromTwo'),
    'two/other.wrl': library('Fallback'),
  }, [{ id: 'one', subdir: 'one', prefix: 'http://h/' }, { id: 'two', subdir: 'two', prefix: 'http://h/' }]);
  const text = world('T', ['http://h/lib.wrl', 'http://h/other.wrl']);
  const p = parse(text);
  const declaration = p.tree.statements.find((s) => s.type === 'ExternProto');
  const r = resolveExternalPrototype({
    context, baseDocument: { sourceId: 'one', path: 'main.wrl' }, parseResult: p, declaration,
  });
  assert.equal(r.candidates[0].retrieval.status, RETRIEVAL_STATUS.AMBIGUOUS_SOURCE);
  assert.equal(r.candidates[0].selection, null, 'an ambiguous artifact is never silently selected from');
  assert.equal(r.status, RESOLUTION_STATUS.RESOLVED);
  assert.equal(r.selectedCandidateIndex, 1);
});

test('two sources with IDENTICAL content for one url resolve, keeping every source that answered', () => {
  const { context } = makeArchive({
    'one/lib.wrl': library('Same'),
    'two/lib.wrl': library('Same'),
  }, [{ id: 'one', subdir: 'one', prefix: 'http://h/' }, { id: 'two', subdir: 'two', prefix: 'http://h/' }]);
  const text = world('T', ['http://h/lib.wrl']);
  const p = parse(text);
  const declaration = p.tree.statements.find((s) => s.type === 'ExternProto');
  const r = resolveExternalPrototype({
    context, baseDocument: { sourceId: 'one', path: 'main.wrl' }, parseResult: p, declaration,
  });
  assert.equal(r.status, RESOLUTION_STATUS.RESOLVED);
  assert.equal(r.candidates[0].retrieval.matches.length, 2, 'both sources stay in provenance');
  assert.deepEqual(r.candidates[0].retrieval.matches.map((m) => m.evidenceSourceId), ['one', 'two']);
});
