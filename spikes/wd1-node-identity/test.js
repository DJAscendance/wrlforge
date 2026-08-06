'use strict';
// WD1.4 spike -- tests for the spike itself.
//
// THROWAWAY PROTOTYPE. Deliberately NOT part of `npm run check`: scripts/run-tests.js
// enumerates named directories under test/, so nothing here changes the production
// test count. Run it directly:
//
//   node --test spikes/wd1-node-identity/test.js
//
// What these tests are for. The spike's whole output is a safety claim -- "these
// strategies recorded N wrong anchors" -- and that claim is only worth anything if
// three things hold:
//
//   1. the candidate strategies cannot see the oracle's answer,
//   2. the oracle actually refuses when it cannot prove the expected node, and
//   3. the classification of a candidate result into correct/safe-loss/ambiguous/
//      wrong/oracle-unresolved is not itself the thing being tuned.
//
// So most of what follows tests the harness rather than the strategies. The
// strategy tests that do appear are the adversarial ones -- duplicate DEFs and
// identical twin siblings -- because those are the cases where a plausible
// implementation quietly returns the wrong node.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { parse } = require(path.join(REPO_ROOT, 'src', 'vrml'));
const edit = require(path.join(REPO_ROOT, 'src', 'vrml', 'edit.js'));
const { NODE } = require(path.join(REPO_ROOT, 'src', 'vrml', 'ast.js'));

const identity = require('./identity');
const oracle = require('./oracle');
const scenarios = require('./scenarios');
const corpus = require('./corpus');
const report = require('./report');
const transaction = require('./transaction');
const session = require('./session');

// A verified transaction receipt for edits the test itself just applied. Strategy
// D refuses without one, so every D case must supply it explicitly.
const receiptFor = (baseText, edits, newText) => transaction.verify({
  baseText, anchorBaseText: baseText, edits, newText,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HEADER = '#VRML V2.0 utf8\n';

// A stand-in for a corpus file record. Only `recovered` is read by the scenario
// builders; the rest is here so a scenario that grows a dependency fails loudly
// instead of reading `undefined`.
const fakeFile = (over = {}) => ({
  id: 'test:inline', group: 'test', chars: 0, recovered: false, stats: {}, ...over,
});

function indexOf(text) {
  const s = session.createSession(text, parse(text), 'inline');
  return { text, parsed: s.parse, session: s, index: identity.buildIndex(s) };
}

// Build an index for already-edited text. A session is now REQUIRED, so this is
// the only way to get one.
function indexAfter(text, label = 'after') {
  return identity.buildIndex(session.createSession(text, parse(text), label));
}

function entryByDef(index, def) {
  const found = index.entries.filter((e) => e.defName === def);
  assert.ok(found.length >= 1, `no entry with DEF ${def}`);
  return found[0];
}

// ---------------------------------------------------------------------------
// 1. Oracle independence
// ---------------------------------------------------------------------------
//
// The brief requires proof that the candidate cannot read oracle-only metadata.
// Two independent proofs: the static source, and the actual runtime require graph
// of a fresh process that loads only identity.js.

test('identity.js does not require the oracle or the scenario generator', () => {
  const src = codeOf('identity.js');
  assert.ok(!/require\(['"]\.\/oracle/.test(src), 'identity.js must not require ./oracle');
  assert.ok(!/require\(['"]\.\/scenarios/.test(src), 'identity.js must not require ./scenarios');
  assert.ok(!/require\(['"]\.\/run/.test(src), 'identity.js must not require ./run');
});

test('oracle.js does not require the candidate strategies', () => {
  const src = codeOf('oracle.js');
  assert.ok(!/require\(['"]\.\/identity/.test(src), 'oracle.js must not require ./identity');
});

// Strip line and block comments so a source scan tests the CODE, not the prose.
// oracle.js's header documents that it never calls mapOffset/mapRange, so a naive
// scan matches its own disclaimer.
function codeOf(file) {
  return fs.readFileSync(path.join(__dirname, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('oracle.js never uses the WD1.2 offset mapping strategy D is built on', () => {
  // Sharing mapOffset/mapRange with strategy D would make D correct by
  // construction: the oracle would be asking the same arithmetic that the
  // candidate answered with.
  const src = codeOf('oracle.js');
  assert.ok(!/mapOffset|mapRange/.test(src), 'oracle.js must not call mapOffset/mapRange');
  // Anchored so the `.*` cannot swallow an unrelated path and mask a future
  // direct `require('.../edit')`. Matches only a literal require of an edit module.
  assert.ok(!/require\(\s*['"][^'"]*edit(\.js)?['"]\s*\)/.test(src),
    'oracle.js must not require src/vrml/edit');
});

test('runtime require graph of identity.js contains neither oracle nor scenarios', () => {
  // A source scan can be defeated by an indirect require; this loads the module
  // for real in a clean process and inspects the resulting cache.
  const probe = `
    require(${JSON.stringify(path.join(__dirname, 'identity.js'))});
    const loaded = Object.keys(require.cache);
    const bad = loaded.filter((p) => /wd1-node-identity[\\\\/](oracle|scenarios|run|report|corpus)\\.js$/.test(p));
    if (bad.length) { console.error('LEAK ' + bad.join(',')); process.exit(1); }
    console.log('CLEAN');
  `;
  const out = execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
  assert.equal(out.trim(), 'CLEAN');
});

test('a descriptor carries no expectation fields', () => {
  // The candidate is handed a descriptor built from the ORIGINAL parse plus the
  // controlled edit set. It must never carry the scenario's expected span/text.
  const { index } = indexOf(`${HEADER}DEF A Transform { children [ Shape { } ] }\n`);
  const descriptors = identity.createDescriptors(index, index.entries[0]);
  for (const id of identity.STRATEGIES) {
    const keys = JSON.stringify(descriptors[id]);
    assert.ok(!/"expected/.test(keys), `${id} descriptor leaks an expectation`);
    assert.ok(!/"expectation/.test(keys), `${id} descriptor leaks an expectation`);
  }
});

test('resolve() ignores anything beyond edits on its context argument', () => {
  // Belt and braces: if a future edit accidentally threaded the expectation into
  // ctx, this would catch it -- results must be identical with and without it.
  const before = `${HEADER}DEF A Transform { children [ Shape { } ] }\n`;
  const { index: oldIndex } = indexOf(before);
  const entry = entryByDef(oldIndex, 'A');
  const edits = [{ from: HEADER.length, to: HEADER.length, insert: '# hello\n' }];
  const after = edit.applyEdits(before, edits);
  const newIndex = indexAfter(after);

  for (const id of identity.STRATEGIES) {
    const d = identity.createDescriptor(id, oldIndex, entry);
    const plain = identity.resolve(id, d, newIndex, { edits });
    const poisoned = identity.resolve(id, d, newIndex, {
      edits,
      expectation: { kind: 'preserved', start: 0, end: 5, text: 'nope' },
      expectedNode: newIndex.entries[newIndex.entries.length - 1].node,
    });
    assert.equal(plain.status, poisoned.status, `${id} changed status when handed an expectation`);
    assert.equal(plain.node, poisoned.node, `${id} changed node when handed an expectation`);
  }
});

// ---------------------------------------------------------------------------
// 2. classify() -- the full truth table
// ---------------------------------------------------------------------------

test('classify covers the five labels exactly', () => {
  const nodeA = { id: 'a' };
  const nodeB = { id: 'b' };
  const established = { status: oracle.ORACLE.ESTABLISHED, node: nodeA, reason: '' };
  const deleted = { status: oracle.ORACLE.DELETED, node: null, reason: '' };
  const unresolved = { status: oracle.ORACLE.UNRESOLVED, node: null, reason: '' };

  const resolvedA = { status: 'resolved', node: nodeA };
  const resolvedB = { status: 'resolved', node: nodeB };
  const amb = { status: 'ambiguous', node: null };
  const ref = { status: 'refused', node: null };

  assert.equal(oracle.classify(established, resolvedA), oracle.CLASS.CORRECT);
  assert.equal(oracle.classify(established, resolvedB), oracle.CLASS.WRONG);
  assert.equal(oracle.classify(established, amb), oracle.CLASS.AMBIGUOUS);
  assert.equal(oracle.classify(established, ref), oracle.CLASS.SAFE_LOSS);

  // The node was deleted by the edit. Claiming ANY node is a wrong anchor --
  // this is the case where a "nearest surviving node" heuristic would be lethal.
  assert.equal(oracle.classify(deleted, resolvedA), oracle.CLASS.WRONG);
  assert.equal(oracle.classify(deleted, resolvedB), oracle.CLASS.WRONG);
  assert.equal(oracle.classify(deleted, ref), oracle.CLASS.SAFE_LOSS);
  assert.equal(oracle.classify(deleted, amb), oracle.CLASS.AMBIGUOUS);

  for (const cand of [resolvedA, amb, ref]) {
    assert.equal(oracle.classify(unresolved, cand), oracle.CLASS.ORACLE_UNRESOLVED);
  }
  assert.equal(oracle.classify(established, null), oracle.CLASS.ORACLE_UNRESOLVED);
  assert.equal(oracle.classify(null, resolvedA), oracle.CLASS.ORACLE_UNRESOLVED);
});

test('classify never invents a success from a malformed candidate status', () => {
  const established = { status: oracle.ORACLE.ESTABLISHED, node: {}, reason: '' };
  assert.equal(oracle.classify(established, { status: 'maybe', node: {} }), oracle.CLASS.ORACLE_UNRESOLVED);
});

// ---------------------------------------------------------------------------
// 3. establish() -- the oracle must refuse rather than approximate
// ---------------------------------------------------------------------------

test('establish requires the expected bytes to be present at the expected span', () => {
  const text = `${HEADER}DEF A Transform { }\n`;
  const s = session.createSession(text, parse(text), 'establish');
  const start = text.indexOf('DEF A');
  const end = text.indexOf('}') + 1;
  const good = oracle.establish(
    { kind: 'preserved', start, end, text: text.slice(start, end) }, s, 'Transform',
  );
  assert.equal(good.status, oracle.ORACLE.ESTABLISHED);

  const bad = oracle.establish(
    { kind: 'preserved', start, end, text: 'Group { }' }, s, 'Transform',
  );
  assert.equal(bad.status, oracle.ORACLE.UNRESOLVED);
});

test('establish refuses when the node type changed under the span', () => {
  const text = `${HEADER}DEF A Transform { }\n`;
  const s = session.createSession(text, parse(text), 'type-change');
  const start = text.indexOf('DEF A');
  const end = text.indexOf('}') + 1;
  const res = oracle.establish(
    { kind: 'preserved', start, end, text: text.slice(start, end) }, s, 'Group',
  );
  assert.equal(res.status, oracle.ORACLE.UNRESOLVED);
});

test('establish refuses an out-of-range or inverted span', () => {
  const text = `${HEADER}DEF A Transform { }\n`;
  const s = session.createSession(text, parse(text), 'range');
  for (const span of [{ start: 5, end: 5 }, { start: 9, end: 4 }, { start: 0, end: text.length + 10 }]) {
    const res = oracle.establish({ kind: 'preserved', ...span, text: 'x' }, s, 'Transform');
    assert.equal(res.status, oracle.ORACLE.UNRESOLVED);
  }
});

test('establish refuses when several nodes occupy the expected span', () => {
  // Synthetic tree: two node instances sharing one range. The production parser
  // does not emit this, but the oracle must not silently take the first.
  const range = { start: { offset: 0, line: 1 }, end: { offset: 4, line: 1 } };
  const twin = () => ({ type: NODE.NODE, nodeType: 'Transform', fields: [], interfaces: [], range });
  const fakeParse = { tree: { type: NODE.DOCUMENT, statements: [twin(), twin()] } };
  const fakeSession = { sessionId: 'ps-synthetic', text: 'abcd', parse: fakeParse };
  const res = oracle.establish({ kind: 'preserved', start: 0, end: 4, text: 'abcd' }, fakeSession, 'Transform');
  assert.equal(res.status, oracle.ORACLE.UNRESOLVED);
  assert.match(res.reason, /not unique/);
});

test('establish reports deletion as its own status, not as an established node', () => {
  const res = oracle.establish({ kind: 'deleted' },
    session.createSession(HEADER, parse(HEADER), 'del'), 'Transform');
  assert.equal(res.status, oracle.ORACLE.DELETED);
  assert.equal(res.node, null);
});

// ---------------------------------------------------------------------------
// 4. Adversarial strategy behaviour
// ---------------------------------------------------------------------------

test('duplicate DEF names are ambiguous, never first-match', () => {
  const before = `${HEADER}DEF Dup Transform { }\nGroup { }\n`;
  // Introduce a second DEF Dup after the selected one.
  const at = before.length;
  const edits = [{ from: at, to: at, insert: 'DEF Dup Transform { }\n' }];
  const { index: oldIndex } = indexOf(before);
  const entry = entryByDef(oldIndex, 'Dup');

  for (const id of ['A1', 'A2']) {
    const d = identity.createDescriptor(id, oldIndex, entry);
    const after = edit.applyEdits(before, edits);
    const newIndex = indexAfter(after);
    const res = identity.resolve(id, d, newIndex, { edits });
    assert.equal(res.status, identity.STATUS.AMBIGUOUS, `${id} must not pick a duplicate DEF`);
    assert.equal(res.node, null, `${id} must not return a node when ambiguous`);
  }
});

test('a duplicate DEF is ambiguous even when only one duplicate has the right type', () => {
  // The tempting shortcut -- narrow by type, then take the survivor -- is exactly
  // "resolve a duplicate by picking the plausible one". It must not be taken.
  const before = `${HEADER}DEF Dup Transform { }\n`;
  const at = before.length;
  const edits = [{ from: at, to: at, insert: 'DEF Dup Group { }\n' }];
  const { index: oldIndex } = indexOf(before);
  const entry = entryByDef(oldIndex, 'Dup');
  const d = identity.createDescriptor('A1', oldIndex, entry);
  const after = edit.applyEdits(before, edits);
  const res = identity.resolve('A1', d, indexAfter(after), { edits });
  assert.equal(res.status, identity.STATUS.AMBIGUOUS);
});

test('a DEF that disappears is a safe loss, not a re-anchor onto a same-type node', () => {
  const before = `${HEADER}DEF A Transform { }\nTransform { }\n`;
  const { index: oldIndex } = indexOf(before);
  const entry = entryByDef(oldIndex, 'A');
  const from = before.indexOf('DEF A');
  const to = before.indexOf('}') + 2;
  const edits = [{ from, to, insert: '' }];
  const after = edit.applyEdits(before, edits);
  for (const id of ['A1', 'A2']) {
    const d = identity.createDescriptor(id, oldIndex, entry);
    const res = identity.resolve(id, d, indexAfter(after), { edits });
    assert.equal(res.status, identity.STATUS.REFUSED, `${id} must lose the selection, not re-anchor`);
  }
});

test('strategy C refuses to build a descriptor for a non-unique fingerprint', () => {
  const before = `${HEADER}Group { children [ Transform { }, Transform { } ] }\n`;
  const { index } = indexOf(before);
  const twins = index.entries.filter((e) => e.nodeType === 'Transform');
  assert.equal(twins.length, 2);
  assert.equal(twins[0].fingerprint, twins[1].fingerprint, 'twins must share a fingerprint');
  const d = identity.createDescriptor('C', index, twins[0]);
  assert.equal(d.supported, false);
});

// The identical-twin fixture, shared by the two tests below.
//
// NOTE, because it is easy to get wrong and it silently fabricates wrong anchors:
// `classify` compares the candidate's node to the oracle's node by OBJECT
// IDENTITY, so both must come from the SAME parse of the edited text. Parsing
// twice yields structurally equal but non-identical trees, and every strategy then
// reads as `wrong`. run.js parses once and shares `newParse` for exactly this
// reason.
function twinCase() {
  const before = `${HEADER}Group {\n  children [\n    Transform { translation 1 1 1 }\n  ]\n}\n`;
  const { index: oldIndex } = indexOf(before);
  const entry = oldIndex.entries.find((e) => e.nodeType === 'Transform');
  const at = before.indexOf('    Transform');
  const edits = [{ from: at, to: at, insert: '    Transform { translation 1 1 1 },\n' }];
  const after = edit.applyEdits(before, edits);
  // ONE session, shared by the index and the oracle.
  const newSession = session.createSession(after, parse(after), 'twin');
  const newIndex = identity.buildIndex(newSession);
  // The selected node's text now sits shifted by exactly the inserted length.
  const shift = edits[0].insert.length;
  const expected = oracle.establish(
    { kind: 'preserved', start: entry.start + shift, end: entry.end + shift, text: before.slice(entry.start, entry.end) },
    newSession, entry.nodeType,
  );
  const receipt = receiptFor(before, edits, after);
  return { before, oldIndex, entry, edits, after, newIndex, expected, receipt, ctx: { edits, transaction: receipt } };
}

test('inserting an identical twin sibling before the selection: C, D and E stay safe', () => {
  // THE adversarial case. A byte-identical Transform is inserted ahead of the
  // selected one. Anything that resolves by sibling index lands on the intruder.
  const { oldIndex, entry, newIndex, expected, ctx } = twinCase();
  assert.equal(expected.status, oracle.ORACLE.ESTABLISHED);

  for (const id of ['C', 'D', 'E']) {
    const d = identity.createDescriptor(id, oldIndex, entry);
    const res = identity.resolve(id, d, newIndex, ctx);
    const klass = oracle.classify(expected, res);
    assert.notEqual(klass, oracle.CLASS.WRONG, `${id} anchored onto the twin`);
  }

  // D must not merely avoid being wrong here -- it must actually re-anchor. If it
  // silently refused (e.g. a missing receipt) the assertion above would pass while
  // proving nothing.
  const dRes = identity.resolve('D', identity.createDescriptor('D', oldIndex, entry), newIndex, ctx);
  assert.equal(dRes.status, identity.STATUS.RESOLVED, 'D should resolve the twin case with a verified receipt');
  assert.equal(oracle.classify(expected, dRes), oracle.CLASS.CORRECT);
});

test('strategy B is unsafe under identical-twin insertion (pinned failure)', () => {
  // This test asserts the FAILURE, deliberately. The brief forbids tuning a
  // strategy until its wrong anchor disappears, and forbids deleting the failing
  // case. B resolves by structural path alone, so an inserted twin shifts the
  // index and B lands on the wrong node. Pinning it here means a later "fix" to
  // B cannot quietly change the spike's recorded conclusion without this failing.
  const { oldIndex, entry, newIndex, expected, ctx } = twinCase();
  const d = identity.createDescriptor('B', oldIndex, entry);
  const res = identity.resolve('B', d, newIndex, ctx);
  assert.equal(res.status, identity.STATUS.RESOLVED, 'B resolves (that is the problem)');
  assert.equal(oracle.classify(expected, res), oracle.CLASS.WRONG,
    'B is expected to anchor onto the inserted twin; if this now passes, re-run the spike and revisit the recommendation');
});

test('strategy D refuses when an edit touches the selected node boundary', () => {
  const before = `${HEADER}DEF A Transform { }\n`;
  const { index: oldIndex } = indexOf(before);
  const entry = entryByDef(oldIndex, 'A');
  // An edit that starts exactly at the node start and runs past it: the node may
  // have been replaced wholesale, and offset arithmetic cannot tell.
  const edits = [{ from: entry.start, to: entry.start + 5, insert: 'DEF B' }];
  const after = edit.applyEdits(before, edits);
  const d = identity.createDescriptor('D', oldIndex, entry);
  const res = identity.resolve('D', d, indexAfter(after),
    { edits, transaction: receiptFor(before, edits, after) });
  assert.equal(res.status, identity.STATUS.REFUSED);
  assert.match(res.reason, /boundary/, 'the refusal must come from the containment guard, not a missing receipt');
});

test('strategy D loses the selection when the node is deleted outright', () => {
  const before = `${HEADER}DEF A Transform { }\nGroup { }\n`;
  const { index: oldIndex } = indexOf(before);
  const entry = entryByDef(oldIndex, 'A');
  const edits = [{ from: entry.start, to: entry.end, insert: '' }];
  const after = edit.applyEdits(before, edits);
  const d = identity.createDescriptor('D', oldIndex, entry);
  const res = identity.resolve('D', d, indexAfter(after),
    { edits, transaction: receiptFor(before, edits, after) });
  assert.notEqual(res.status, identity.STATUS.RESOLVED, 'a deleted node must never resolve');
});

test('strategy E refuses when its structural layers disagree', () => {
  // Force disagreement: B resolves by path, C by unique fingerprint. Deleting the
  // sibling ahead of the selection moves the path without moving the fingerprint.
  const before = `${HEADER}Group {\n  children [\n    Shape { },\n    Transform { translation 2 2 2 }\n  ]\n}\n`;
  const { index: oldIndex } = indexOf(before);
  const entry = oldIndex.entries.find((e) => e.nodeType === 'Transform');
  const from = before.indexOf('    Shape { },\n');
  const edits = [{ from, to: from + '    Shape { },\n'.length, insert: '' }];
  const after = edit.applyEdits(before, edits);
  const newIndex = indexAfter(after);
  const d = identity.createDescriptor('E', oldIndex, entry);
  const res = identity.resolve('E', d, newIndex, { edits, transaction: receiptFor(before, edits, after) });
  // Whatever E does here it must not be a confident claim built on one layer
  // alone -- either every layer agreed, or it declined.
  if (res.status === identity.STATUS.RESOLVED) {
    assert.equal(res.detail.B, identity.STATUS.RESOLVED);
    assert.equal(res.detail.C, identity.STATUS.RESOLVED);
    assert.equal(res.detail.D, identity.STATUS.RESOLVED);
  }
});

test('E never returns a node while reporting an ambiguous or refused status', () => {
  const before = `${HEADER}Group { children [ Transform { }, Transform { } ] }\n`;
  const { index: oldIndex } = indexOf(before);
  for (const entry of oldIndex.entries) {
    const d = identity.createDescriptor('E', oldIndex, entry);
    for (const edits of [[], [{ from: HEADER.length, to: HEADER.length, insert: '# c\n' }]]) {
      const after = edit.applyEdits(before, edits);
      const res = identity.resolve('E', d, indexAfter(after),
        { edits, transaction: receiptFor(before, edits, after) });
      if (res.status !== identity.STATUS.RESOLVED) {
        assert.equal(res.node, null, 'a non-resolved result must carry no node');
      }
    }
  }
});

test('no strategy resolves against an empty new parse', () => {
  const before = `${HEADER}DEF A Transform { }\n`;
  const { index: oldIndex } = indexOf(before);
  const entry = entryByDef(oldIndex, 'A');
  const emptyIndex = indexAfter(HEADER);
  for (const id of identity.STRATEGIES) {
    const d = identity.createDescriptor(id, oldIndex, entry);
    const res = identity.resolve(id, d, emptyIndex, { edits: [] });
    assert.notEqual(res.status, identity.STATUS.RESOLVED, `${id} resolved against an empty document`);
  }
});

// ---------------------------------------------------------------------------
// 4b. Transaction integrity — the Tier 1 gate
// ---------------------------------------------------------------------------
//
// Strategy D is only safe when the edit set it is given genuinely connects the
// exact old text to the exact new text. Every case below is a way a caller can be
// wrong about that, and NONE of them may resolve a node.

const TXBASE = `${HEADER}DEF A Transform { translation 1 2 3 }\nGroup { }\n`;
const TXEDITS = [{ from: HEADER.length, to: HEADER.length, insert: '# note\n' }];
const TXNEW = edit.applyEdits(TXBASE, TXEDITS);

test('a truthful transaction verifies', () => {
  const r = transaction.verify({ baseText: TXBASE, anchorBaseText: TXBASE, edits: TXEDITS, newText: TXNEW });
  assert.equal(r.status, transaction.TX.VERIFIED);
  assert.equal(r.reason, transaction.REASON.OK);
});

test('an unchanged document with no edits verifies', () => {
  const r = transaction.unchanged(TXBASE);
  assert.equal(r.status, transaction.TX.VERIFIED);
});

// Each row: [label, mutated verify() input, expected rejection reason]
const NEGATIVE_TRANSACTIONS = [
  ['base text differs by one character',
    { baseText: `${TXBASE}x`, anchorBaseText: TXBASE, edits: TXEDITS, newText: TXNEW },
    transaction.REASON.BASE_MISMATCH],
  ['new text differs by one character',
    { baseText: TXBASE, anchorBaseText: TXBASE, edits: TXEDITS, newText: `${TXNEW}x` },
    transaction.REASON.RESULT_MISMATCH],
  ['one edit is missing',
    { baseText: TXBASE,
      anchorBaseText: TXBASE,
      edits: [TXEDITS[0]],
      newText: edit.applyEdits(TXBASE, [TXEDITS[0], { from: TXBASE.length, to: TXBASE.length, insert: '# two\n' }]) },
    transaction.REASON.RESULT_MISMATCH],
  ['one edit has the wrong range',
    { baseText: TXBASE, anchorBaseText: TXBASE, edits: [{ from: 3, to: 3, insert: '# note\n' }], newText: TXNEW },
    transaction.REASON.RESULT_MISMATCH],
  ['one edit has the wrong inserted text',
    { baseText: TXBASE, anchorBaseText: TXBASE, edits: [{ from: HEADER.length, to: HEADER.length, insert: '# NOTE\n' }], newText: TXNEW },
    transaction.REASON.RESULT_MISMATCH],
  ['edits are from a different document',
    { baseText: TXBASE, anchorBaseText: TXBASE, edits: [{ from: 4000, to: 4010, insert: 'x' }], newText: TXNEW },
    transaction.REASON.EDIT_INVALID],
  ['the edit set is stale (anchored against an older revision)',
    { baseText: TXNEW, anchorBaseText: TXBASE, edits: TXEDITS, newText: TXNEW },
    transaction.REASON.BASE_MISMATCH],
  ['an empty edit set is supplied for changed text',
    { baseText: TXBASE, anchorBaseText: TXBASE, edits: [], newText: TXNEW },
    transaction.REASON.EMPTY_EDITS_FOR_CHANGED_TEXT],
  ['old and new texts are swapped',
    { baseText: TXNEW, anchorBaseText: TXNEW, edits: TXEDITS, newText: TXBASE },
    transaction.REASON.RESULT_MISMATCH],
  ['edits validate but do not produce the supplied new text',
    { baseText: TXBASE, anchorBaseText: TXBASE, edits: [{ from: 0, to: 0, insert: '' }], newText: TXNEW },
    transaction.REASON.RESULT_MISMATCH],
];

for (const [label, input, expectedReason] of NEGATIVE_TRANSACTIONS) {
  test(`transaction rejected: ${label}`, () => {
    const r = transaction.verify(input);
    assert.equal(r.status, transaction.TX.REJECTED, `"${label}" must not verify`);
    assert.equal(r.reason, expectedReason, `"${label}" rejected for the wrong reason`);
    // Structured, not a bare throw: a code and a detail object every time.
    assert.equal(typeof r.reason, 'string');
    assert.equal(typeof r.detail, 'object');
    assert.equal(r.edits, null);
  });

  test(`strategy D refuses when: ${label}`, () => {
    const { index: oldIndex } = indexOf(TXBASE);
    const entry = entryByDef(oldIndex, 'A');
    const d = identity.createDescriptor('D', oldIndex, entry);
    // Resolve against a genuine reparse of the real new text, so the ONLY thing
    // standing between D and a confident answer is the rejected receipt.
    const newIndex = indexAfter(TXNEW);
    const res = identity.resolve('D', d, newIndex, {
      edits: input.edits,
      transaction: transaction.verify(input),
    });
    assert.notEqual(res.status, identity.STATUS.RESOLVED, `D resolved on a rejected transaction (${label})`);
    assert.equal(res.node, null);
    assert.match(res.reason, /transaction/, 'the refusal must name the transaction, not some other cause');
  });
}

test('strategy D refuses outright when no transaction is supplied at all', () => {
  const { index: oldIndex } = indexOf(TXBASE);
  const entry = entryByDef(oldIndex, 'A');
  const d = identity.createDescriptor('D', oldIndex, entry);
  const newIndex = indexAfter(TXNEW);
  // A bare edit set is exactly the untrustworthy input the contract exists to
  // reject: it is unverifiable, so it must not be honoured.
  const res = identity.resolve('D', d, newIndex, { edits: TXEDITS });
  assert.equal(res.status, identity.STATUS.REFUSED);
  assert.match(res.reason, /no verified edit transaction/);
});

test('strategy E does not require D agreement when no verified transaction exists', () => {
  // Without a receipt D always refuses; if E still demanded its agreement E could
  // never resolve anything through the structural layer.
  const { index: oldIndex } = indexOf(TXBASE);
  const entry = entryByDef(oldIndex, 'A');
  const d = identity.createDescriptor('E', oldIndex, entry);
  const res = identity.resolve('E', d, indexAfter(TXNEW), {});
  assert.ok([identity.STATUS.RESOLVED, identity.STATUS.AMBIGUOUS, identity.STATUS.REFUSED].includes(res.status));
  if (res.status !== identity.STATUS.RESOLVED) assert.equal(res.node, null);
});

test('transaction.verify rejects malformed input rather than throwing', () => {
  for (const bad of [
    { baseText: null, anchorBaseText: null, edits: [], newText: '' },
    { baseText: '', anchorBaseText: '', edits: 'nope', newText: '' },
    { baseText: '', anchorBaseText: '', edits: [{ from: 'a', to: 1, insert: '' }], newText: '' },
  ]) {
    const r = transaction.verify(bad);
    assert.equal(r.status, transaction.TX.REJECTED);
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
  }
});

test('transaction.verify rejects overlapping and inverted edits', () => {
  const overlapping = transaction.verify({
    baseText: TXBASE,
    anchorBaseText: TXBASE,
    edits: [{ from: 20, to: 30, insert: 'x' }, { from: 25, to: 35, insert: 'y' }],
    newText: TXBASE,
  });
  assert.equal(overlapping.reason, transaction.REASON.EDIT_INVALID);
  const inverted = transaction.verify({
    baseText: TXBASE, anchorBaseText: TXBASE, edits: [{ from: 30, to: 20, insert: 'x' }], newText: TXBASE,
  });
  assert.equal(inverted.reason, transaction.REASON.EDIT_INVALID);
});

// ---------------------------------------------------------------------------
// 4b-i. Receipt binding and forgery — regressions from the independent review
// ---------------------------------------------------------------------------
//
// An independent read-only review (codex, recorded in REPORT.md) demonstrated two
// holes in the first cut of the contract. Both are pinned here.

test('REGRESSION: a receipt minted for a FOREIGN document cannot license a re-anchor', () => {
  // Reproduced by the reviewer: `anchorBaseText` was optional, so a caller could
  // mint a perfectly "verified" zero-edit receipt for a document the anchor never
  // came from, and D re-anchored across two different files.
  const anchorText = `${HEADER}DEF A Transform { }\n#anchor\n`;
  const foreignText = `${HEADER}DEF A Transform { }\n#foreign\n`;
  assert.notEqual(anchorText, foreignText);

  const { index: anchorIndex } = indexOf(anchorText);
  const d = identity.createDescriptor('D', anchorIndex, entryByDef(anchorIndex, 'A'));

  const foreignReceipt = transaction.verify({
    baseText: foreignText, anchorBaseText: foreignText, edits: [], newText: foreignText,
  });
  assert.equal(foreignReceipt.status, transaction.TX.VERIFIED, 'the receipt is legitimately verified — for the WRONG document');

  const res = identity.resolve('D', d, indexAfter(foreignText, 'foreign'), { transaction: foreignReceipt });
  assert.equal(res.status, identity.STATUS.REFUSED, 'D must refuse a receipt bound to a different document');
  assert.match(res.reason, /different base document/);
});

test('REGRESSION: verify() rejects a missing anchorBaseText instead of assuming one', () => {
  const text = `${HEADER}DEF A Transform { }\n`;
  const r = transaction.verify({ baseText: text, edits: [], newText: text });
  assert.equal(r.status, transaction.TX.REJECTED);
  assert.equal(r.reason, transaction.REASON.MISSING_ANCHOR_BASE);
});

test('REGRESSION: a hand-forged receipt object is refused, however well-shaped', () => {
  // D used to trust any object with `{status:'verified', edits:[...]}`. Only a
  // receipt actually minted by transaction.verify() is accepted now.
  const before = `${HEADER}Group {\n  children [\n    DEF Sel Transform { translation 1 1 1 }\n  ]\n}\n`;
  const at = before.indexOf('    DEF Sel');
  const realEdits = [{ from: at, to: at, insert: '    Transform { translation 9 9 9 },\n' }];
  const after = edit.applyEdits(before, realEdits);

  const { index: oldIndex } = indexOf(before);
  const d = identity.createDescriptor('D', oldIndex, entryByDef(oldIndex, 'Sel'));

  for (const forged of [
    { status: 'verified', reason: 'ok', detail: {}, edits: [] },
    { status: 'verified', reason: 'ok', detail: {}, edits: realEdits },
    { status: 'verified', edits: realEdits, baseDigest: 'deadbeef', newDigest: 'deadbeef' },
  ]) {
    const res = identity.resolve('D', d, indexAfter(after), { transaction: forged });
    assert.equal(res.status, identity.STATUS.REFUSED, 'a forged receipt must never license a re-anchor');
    assert.match(res.reason, /not issued by transaction\.verify/);
  }
});

test('a genuine receipt for the right document still works after the hardening', () => {
  // The binding must not be so strict that the legitimate path breaks.
  const before = `${HEADER}DEF A Transform { translation 1 2 3 }\n`;
  const edits = [{ from: HEADER.length, to: HEADER.length, insert: '# note\n' }];
  const after = edit.applyEdits(before, edits);
  const { index: oldIndex } = indexOf(before);
  const d = identity.createDescriptor('D', oldIndex, entryByDef(oldIndex, 'A'));
  const res = identity.resolve('D', d, indexAfter(after), {
    transaction: receiptFor(before, edits, after),
  });
  assert.equal(res.status, identity.STATUS.RESOLVED);
});

// ---------------------------------------------------------------------------
// 4c. The harness parse-identity invariant
// ---------------------------------------------------------------------------

test('REGRESSION: two RAW parses cannot bypass the session guard', () => {
  // Reproduced by the reviewer: buildIndex() and establish() both accepted bare
  // parse results, which produced untagged results on BOTH sides, so
  // assertSameSession waved the comparison through and every strategy read as
  // `wrong`. There must now be no untagged path out of a real parse at all.
  const text = `${HEADER}DEF A Transform { }\n`;
  assert.throws(() => identity.buildIndex(parse(text)),
    (err) => err instanceof session.HarnessError && err.code === session.HARNESS.MISSING_SESSION,
    'buildIndex must refuse a bare parse result');
  assert.throws(() => oracle.establish({ kind: 'deleted' }, parse(text), text, 'Transform'),
    (err) => err instanceof session.HarnessError && err.code === session.HARNESS.MISSING_SESSION,
    'establish must refuse a bare parse result');
});

test('mixing two parses of identical text fails LOUDLY instead of reporting wrong anchors', () => {
  // The exact defect that bit this harness during development. Two parses of the
  // SAME text are structurally equal but not identical, so `candidate.node ===
  // oracleResult.node` is false for every strategy and the run silently reports a
  // 100% wrong-anchor rate that looks like a genuine safety finding.
  const before = `${HEADER}DEF A Transform { translation 1 1 1 }\n`;
  const edits = [{ from: HEADER.length, to: HEADER.length, insert: '# c\n' }];
  const after = edit.applyEdits(before, edits);

  const sessionOne = session.createSession(after, parse(after), 'one');
  const sessionTwo = session.createSession(after, parse(after), 'two');   // <- the mistake
  assert.notEqual(sessionOne.sessionId, sessionTwo.sessionId);

  const { index: oldIndex } = indexOf(before);
  const entry = entryByDef(oldIndex, 'A');
  const shift = edits[0].insert.length;

  const expected = oracle.establish(
    { kind: 'preserved', start: entry.start + shift, end: entry.end + shift, text: before.slice(entry.start, entry.end) },
    sessionOne, entry.nodeType,
  );
  assert.equal(expected.status, oracle.ORACLE.ESTABLISHED);

  // Candidate resolved against the OTHER parse of the same text.
  const candidate = identity.resolve('A2', identity.createDescriptor('A2', oldIndex, entry),
    identity.buildIndex(sessionTwo), {});
  assert.equal(candidate.status, identity.STATUS.RESOLVED);

  assert.throws(
    () => oracle.classify(expected, candidate),
    (err) => err instanceof session.HarnessError
      && err.code === session.HARNESS.MIXED_PARSE_SESSION,
    'classify must throw a structured HarnessError, not return a verdict',
  );
});

test('same-session comparison is permitted and yields a real verdict', () => {
  const before = `${HEADER}DEF A Transform { translation 1 1 1 }\n`;
  const edits = [{ from: HEADER.length, to: HEADER.length, insert: '# c\n' }];
  const after = edit.applyEdits(before, edits);
  const only = session.createSession(after, parse(after), 'only');

  const { index: oldIndex } = indexOf(before);
  const entry = entryByDef(oldIndex, 'A');
  const shift = edits[0].insert.length;
  const expected = oracle.establish(
    { kind: 'preserved', start: entry.start + shift, end: entry.end + shift, text: before.slice(entry.start, entry.end) },
    only, entry.nodeType,
  );
  const candidate = identity.resolve('A2', identity.createDescriptor('A2', oldIndex, entry),
    identity.buildIndex(only), {});
  assert.equal(oracle.classify(expected, candidate), oracle.CLASS.CORRECT);
});

test('a session-tagged result may not be compared against an untagged one', () => {
  const text = `${HEADER}DEF A Transform { }\n`;
  const only = session.createSession(text, parse(text), 'only');
  const tagged = oracle.establish(
    { kind: 'preserved', start: text.indexOf('DEF A'), end: text.indexOf('}') + 1, text: text.slice(text.indexOf('DEF A'), text.indexOf('}') + 1) },
    only, 'Transform',
  );
  const untagged = { status: 'resolved', node: {} };
  assert.throws(() => oracle.classify(tagged, untagged),
    (err) => err instanceof session.HarnessError && err.code === session.HARNESS.MISSING_SESSION);
});

test('indexes and results inherit the session id they were built from', () => {
  const text = `${HEADER}DEF A Transform { }\n`;
  const s = session.createSession(text, parse(text), 'x');
  const index = identity.buildIndex(s);
  assert.equal(index.sessionId, s.sessionId);
  const entry = entryByDef(index, 'A');
  for (const id of identity.STRATEGIES) {
    const res = identity.resolve(id, identity.createDescriptor(id, index, entry), index, {});
    assert.equal(res.sessionId, s.sessionId, `${id} result lost its session tag`);
  }
});

// ---------------------------------------------------------------------------
// 4d. S22 coverage — PROTO inside an MFNode array
// ---------------------------------------------------------------------------

test('the authored fixture parses without diagnostics and holds BOTH PROTO-in-array shapes', () => {
  // NOTE on what "parses without diagnostics" means here: the array-hosted PROTO
  // DECLARATION is deliberately NOT valid ISO VRML97 -- the parser tolerates it as
  // documented Cybertown/Blaxxun leniency. Zero diagnostics is evidence about the
  // parser's leniency, not about standards conformance. The fixture also carries a
  // standards-clean PROTO instance inside an MFNode array.
  {
  const file = path.join(__dirname, 'fixtures', 'proto-in-mfnode-array.wrl');
  const text = fs.readFileSync(file, 'utf8');
  const fixtureSession = session.createSession(text, parse(text), 'fixture');
  const parsed = fixtureSession.parse;
  assert.equal(parsed.syntaxDiagnostics.length, 0, 'the authored fixture must parse without diagnostics');

  const facts = scenarios.documentFacts(parsed);
  assert.ok(facts.protosInArray.length >= 1, 'fixture must contain a PROTO directly inside an MFNode array');
  assert.ok(facts.protos.length >= 2, 'fixture should also carry a standards-clean top-level PROTO');

  // A selectable nested node inside the array-hosted PROTO body.
  const index = identity.buildIndex(fixtureSession);
  const proto = facts.protosInArray[0];
  const nested = index.entries.filter((e) => e.start > proto.range.start.offset && e.end < proto.range.end.offset);
  assert.ok(nested.length >= 1, 'fixture must expose at least one selectable node nested in the PROTO body');

  // THE DISTINCTION THE FIXTURE EXISTS TO PROVE. These are two different things and
  // the test must show they are reachable by two different routes, otherwise the
  // fixture proves nothing about the standards-clean / lenient split.
  //
  //  * standards-clean: a PROTO *instance* is an ordinary node statement, so it
  //    appears in the node index with a containing field, like any other node.
  //  * lenient vendor shape: a PROTO *declaration* is NOT a node, so it never
  //    appears in the node index at all — it is reachable only via
  //    documentFacts().protosInArray.
  const instanceInArray = index.entries.filter((e) => e.nodeType === 'Marker'
    && e.containingField === 'children');
  assert.equal(instanceInArray.length, 1,
    'fixture must carry exactly one standards-clean PROTO instance in an MFNode array');

  const declaredNames = facts.protosInArray.map((n) => n.name);
  assert.ok(declaredNames.includes('InlineBadge'),
    'the lenient shape must be the PROTO DECLARATION InlineBadge');
  assert.ok(!declaredNames.includes('Marker'),
    'Marker is an INSTANCE, not a declaration — it must not appear in protosInArray');

  // And the converse: the lenient declaration is not a selectable node instance.
  assert.ok(!index.entries.some((e) => e.nodeType === 'InlineBadge'
    && e.start === proto.range.start.offset),
  'the PROTO declaration itself must not be indexed as a node instance');
  }
});

test('S22 builds a valid edit set against the authored fixture', () => {
  const file = path.join(__dirname, 'fixtures', 'proto-in-mfnode-array.wrl');
  const text = fs.readFileSync(file, 'utf8');
  const s22Session = session.createSession(text, parse(text), 'fixture-s22');
  const parsed = s22Session.parse;
  const index = identity.buildIndex(s22Session);
  const facts = scenarios.documentFacts(parsed);

  let built = null;
  for (const entry of index.entries) {
    const all = scenarios.buildScenarios({ text, file: fakeFile(), parseResult: parsed, index, facts, entry });
    const s22 = all.find((s) => s.id.startsWith('S22'));
    if (s22) { built = { s22, entry }; break; }
  }
  assert.ok(built, 'S22 must build at least one scenario against the authored fixture');
  assert.ok(built.s22.edits.length > 0);
  const after = edit.applyEdits(text, built.s22.edits);
  assert.notEqual(after, text, 'S22 must actually change the document');
});

test('S22 yields an oracle-established case where D and A2 record no wrong anchor', () => {
  const file = path.join(__dirname, 'fixtures', 'proto-in-mfnode-array.wrl');
  const text = fs.readFileSync(file, 'utf8');
  const baseSession = session.createSession(text, parse(text), 'fixture');
  const index = identity.buildIndex(baseSession);
  const facts = scenarios.documentFacts(baseSession.parse);

  let established = 0;
  for (const entry of index.entries) {
    const all = scenarios.buildScenarios({
      text, file: fakeFile(), parseResult: baseSession.parse, index, facts, entry,
    });
    const s22 = all.find((s) => s.id.startsWith('S22'));
    if (!s22) continue;

    const after = edit.applyEdits(text, s22.edits);
    const newSession = session.createSession(after, parse(after), 'fixture-after');
    const newIndex = identity.buildIndex(newSession);
    const oracleResult = oracle.establish(s22.expectation, newSession, entry.nodeType);
    if (oracleResult.status !== oracle.ORACLE.ESTABLISHED
      && oracleResult.status !== oracle.ORACLE.DELETED) continue;
    established += 1;

    const receipt = receiptFor(text, s22.edits, after);
    assert.equal(receipt.status, transaction.TX.VERIFIED);
    for (const id of ['A1', 'A2', 'C', 'D', 'E']) {
      const res = identity.resolve(id, identity.createDescriptor(id, index, entry), newIndex,
        { edits: s22.edits, transaction: receipt });
      assert.notEqual(oracle.classify(oracleResult, res), oracle.CLASS.WRONG,
        `${id} produced a wrong anchor on S22`);
    }
  }
  assert.ok(established >= 1, 'S22 must produce at least one oracle-established case');
});

// ---------------------------------------------------------------------------
// 4e. Regressions pinned from the MiniMax M3 acceptance review
// ---------------------------------------------------------------------------
//
// The reviewer's three most severe claims did NOT reproduce. These tests pin the
// behaviour that refutes them, so a future change cannot quietly make any of them
// true. See REPORT.md §M for the full adjudication.

test('MMX-1: a resolve() result is tagged with the index it resolved AGAINST, never a stale session', () => {
  // Claim (blocker): resolve() could stamp or retain a foreign session id, letting a
  // cross-parse comparison slip past assertSameSession. It cannot: every strategy
  // returns a fresh object, and E's spread copies a result produced against the SAME
  // newIndex.
  const text = `${HEADER}DEF A Transform { }\n`;
  const one = session.createSession(text, parse(text), 'one');
  const two = session.createSession(text, parse(text), 'two');
  const indexOne = identity.buildIndex(one);
  const indexTwo = identity.buildIndex(two);
  const entry = entryByDef(indexOne, 'A');

  for (const id of identity.STRATEGIES) {
    // Descriptor built from session ONE, resolved against session TWO.
    const res = identity.resolve(id, identity.createDescriptor(id, indexOne, entry), indexTwo, {});
    assert.equal(res.sessionId, indexTwo.sessionId, `${id} must carry the resolving index's session`);
    assert.notEqual(res.sessionId, indexOne.sessionId, `${id} must not carry the descriptor's session`);
  }
});

test('MMX-1: buildIndex refuses any input without a session, so no untagged index exists', () => {
  for (const bad of [{}, null, undefined, { parse: {} }, { sessionId: 'x' }, { sessionId: 5, parse: {} }]) {
    assert.throws(() => identity.buildIndex(bad),
      (err) => err instanceof session.HarnessError && err.code === session.HARNESS.MISSING_SESSION);
  }
});

test('MMX-2: the legacy 4-argument establish() call fails closed and loudly', () => {
  // Claim (high): a caller still on `establish(exp, parse, text, nodeType)` would
  // silently mis-score. It throws instead.
  const text = `${HEADER}DEF A Transform { }\n`;
  assert.throws(() => oracle.establish({ kind: 'deleted' }, parse(text), text, 'Transform'),
    (err) => err instanceof session.HarnessError && err.code === session.HARNESS.MISSING_SESSION,
    'the old 4-arg form must throw, not silently accept');
});

test('MMX-3: D re-anchors identical twins correctly when the edit is strictly inside one twin', () => {
  // Claim (high): with two byte-identical siblings, an edit strictly inside one of
  // them could let D resolve the WRONG twin, because parentType and containingField
  // are identical and only the mapped span discriminates. All four
  // (selected, edited) permutations are checked.
  const before = `${HEADER}Group {\n  children [\n    Transform { translation 1 1 1 },\n    Transform { translation 1 1 1 }\n  ]\n}\n`;
  const baseSession = session.createSession(before, parse(before), 'twins');
  const baseIndex = identity.buildIndex(baseSession);
  const twins = baseIndex.entries.filter((e) => e.nodeType === 'Transform');
  assert.equal(twins.length, 2);
  assert.equal(twins[0].fingerprint, twins[1].fingerprint, 'the twins must be structurally identical');

  for (const selectIndex of [0, 1]) {
    for (const editIndex of [0, 1]) {
      const selected = twins[selectIndex];
      const target = twins[editIndex];
      // Change a scalar strictly inside the target twin, with a LENGTH change so the
      // arithmetic cannot succeed by coincidence.
      const at = target.start + before.slice(target.start, target.end).indexOf('1 1 1');
      const edits = [{ from: at, to: at + 5, insert: '7 7 7 7' }];
      const after = edit.applyEdits(before, edits);
      const afterSession = session.createSession(after, parse(after), 'twins-after');
      const afterIndex = identity.buildIndex(afterSession);

      // Oracle truth computed here, independently of strategy D's mapping.
      const delta = edits[0].insert.length - (edits[0].to - edits[0].from);
      const shift = at < selected.start ? delta : 0;
      const newStart = selected.start + shift;
      const newEnd = (at > selected.start && at < selected.end) ? selected.end + delta : selected.end + shift;
      const expected = oracle.establish(
        { kind: 'preserved', start: newStart, end: newEnd, text: after.slice(newStart, newEnd) },
        afterSession, selected.nodeType,
      );
      assert.equal(expected.status, oracle.ORACLE.ESTABLISHED,
        `oracle must prove the expectation for select=${selectIndex} edit=${editIndex}`);

      const res = identity.resolve('D', identity.createDescriptor('D', baseIndex, selected), afterIndex,
        { transaction: receiptFor(before, edits, after) });
      assert.notEqual(oracle.classify(expected, res), oracle.CLASS.WRONG,
        `D anchored the wrong twin (select=${selectIndex}, edit=${editIndex})`);
    }
  }
});

test('MMX-4: a session whose parse carries no tree yields oracle-unresolved, not a throw or a match', () => {
  const malformed = { sessionId: 'ps-malformed', text: 'abcd', parse: { tree: null } };
  const res = oracle.establish({ kind: 'preserved', start: 0, end: 4, text: 'abcd' }, malformed, 'Transform');
  assert.equal(res.status, oracle.ORACLE.UNRESOLVED);
  assert.equal(res.sessionId, 'ps-malformed');
});

test('MMX-6: the session guard fires BEFORE the deleted-expectation WRONG verdict', () => {
  // A cross-session candidate against a DELETED expectation must throw rather than
  // return WRONG — the harness error must win over the safety verdict, because a
  // wrong-session comparison is a harness bug, not a finding.
  const text = `${HEADER}DEF A Transform { }\n`;
  const one = session.createSession(text, parse(text), 'one');
  const two = session.createSession(text, parse(text), 'two');
  const deleted = oracle.establish({ kind: 'deleted' }, one, 'Transform');
  assert.equal(deleted.status, oracle.ORACLE.DELETED);

  const indexTwo = identity.buildIndex(two);
  const candidate = identity.resolve('A2',
    identity.createDescriptor('A2', indexTwo, entryByDef(indexTwo, 'A')), indexTwo, {});
  assert.equal(candidate.status, identity.STATUS.RESOLVED);

  assert.throws(() => oracle.classify(deleted, candidate),
    (err) => err instanceof session.HarnessError && err.code === session.HARNESS.MIXED_PARSE_SESSION);

  // Same-session deleted + resolved is still WRONG, as the taxonomy requires.
  const sameSessionDeleted = oracle.establish({ kind: 'deleted' }, two, 'Transform');
  assert.equal(oracle.classify(sameSessionDeleted, candidate), oracle.CLASS.WRONG);
});

test('MMX-9: transaction.unchanged() issues a usable receipt for an empty document', () => {
  const r = transaction.unchanged('');
  assert.equal(r.status, transaction.TX.VERIFIED);
  assert.ok(transaction.isIssued(r), 'the empty-document receipt must be branded');
  assert.deepEqual(r.edits, []);
});

// ---------------------------------------------------------------------------
// 5. Determinism
// ---------------------------------------------------------------------------

test('byCodepoint is a strict, locale-independent ordering', () => {
  const input = ['b', 'A', 'a', 'B', 'Z10', 'Z9', 'é', 'e'];
  const once = [...input].sort(corpus.byCodepoint);
  const twice = [...input].reverse().sort(corpus.byCodepoint);
  assert.deepEqual(once, twice, 'sort result must not depend on input order');
  // Codepoint order, not locale order: uppercase sorts before lowercase.
  assert.ok(once.indexOf('A') < once.indexOf('a'));
  assert.ok(once.indexOf('Z10') < once.indexOf('Z9'), 'plain codepoint compare, no numeric collation');
});

test('interleaveByGroup spreads the char budget across every group', () => {
  // Regression guard for a real coverage defect. The first full run sorted
  // entries globally by `group:path` and spent the whole 220 MB budget on the two
  // alphabetically-first archives -- four groups parsed nothing, including both
  // in-repo fixture groups the brief names as the starting corpus.
  const entries = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `aaa-big:${i}`, group: 'aaa-big' })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `zzz-small:${i}`, group: 'zzz-small' })),
  ];
  const order = corpus.interleaveByGroup(entries);
  assert.equal(order.length, entries.length, 'every entry must survive interleaving');
  // The small group's entries must appear early, not after the whole big group.
  const lastSmall = order.map((e) => e.group).lastIndexOf('zzz-small');
  assert.ok(lastSmall < 4, `small group starved: last member at position ${lastSmall}`);
  // Within a group the original order is preserved.
  assert.deepEqual(order.filter((e) => e.group === 'aaa-big').map((e) => e.id),
    ['aaa-big:0', 'aaa-big:1', 'aaa-big:2', 'aaa-big:3', 'aaa-big:4']);
});

test('interleaveByGroup is deterministic and independent of input order', () => {
  const entries = [
    { id: 'b:1', group: 'b' }, { id: 'a:1', group: 'a' },
    { id: 'a:2', group: 'a' }, { id: 'c:1', group: 'c' },
  ];
  const forward = corpus.interleaveByGroup(entries).map((e) => e.id);
  const again = corpus.interleaveByGroup([...entries]).map((e) => e.id);
  assert.deepEqual(forward, again);
  // Groups are visited in codepoint order on each round.
  assert.deepEqual(forward, ['a:1', 'b:1', 'c:1', 'a:2']);
});

test('buildIndex is stable across two parses of the same text', () => {
  const text = `${HEADER}DEF A Transform { children [ Shape { appearance Appearance { } } ] }\n`;
  const a = indexAfter(text);
  const b = indexAfter(text);
  assert.equal(a.entries.length, b.entries.length);
  for (let i = 0; i < a.entries.length; i += 1) {
    assert.equal(a.entries[i].pathKey, b.entries[i].pathKey);
    assert.equal(a.entries[i].fingerprint, b.entries[i].fingerprint);
    assert.equal(a.entries[i].start, b.entries[i].start);
  }
  // Object identity must NOT survive a reparse -- if it did, every strategy would
  // look correct for the wrong reason.
  assert.notEqual(a.entries[0].node, b.entries[0].node);
});

test('scenario generation is deterministic for the same input', () => {
  const text = `${HEADER}DEF A Transform { translation 1 2 3 children [ Shape { }, Shape { } ] }\n`;
  const ses = session.createSession(text, parse(text), 'determinism');
  const parsed = ses.parse;
  const index = identity.buildIndex(ses);
  const facts = scenarios.documentFacts(parsed);
  const entry = entryByDef(index, 'A');
  const ctx = { text, file: fakeFile(), parseResult: parsed, index, facts, entry };
  const first = scenarios.buildScenarios(ctx);
  const second = scenarios.buildScenarios(ctx);
  assert.deepEqual(first, second);
  assert.ok(first.length > 0, 'the fixture must exercise at least one scenario');
});

test('selectNodes is deterministic and bounded', () => {
  const text = `${HEADER}Group { children [ ${'Shape { }, '.repeat(20)}Shape { } ] }\n`;
  const index = indexAfter(text);
  const a = scenarios.selectNodes(index, 5);
  const b = scenarios.selectNodes(index, 5);
  assert.deepEqual(a.map((x) => x.entry.pathKey), b.map((x) => x.entry.pathKey));
  assert.ok(a.length <= 5);
});

// ---------------------------------------------------------------------------
// 6. Scenario / expectation integrity
// ---------------------------------------------------------------------------

test('all 30 required scenarios are declared with unique ids', () => {
  const ids = scenarios.SCENARIOS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'scenario ids must be unique');
  assert.equal(ids.length, 30, 'the brief enumerates 30 scenarios');
  // The two adversarial ones the brief says must not be omitted.
  assert.ok(ids.some((id) => /S29-reorder-siblings/.test(id)), 'S29 sibling reorder is required');
  assert.ok(ids.some((id) => /S30-insert-near-identical/.test(id)), 'S30 identical-sibling insert is required');
});

test('every built scenario produces an applicable edit set and a matching expectation', () => {
  const text = `${HEADER}DEF A Transform { translation 1 2 3 children [ Shape { }, Shape { } ] }\nGroup { }\n`;
  const ses = session.createSession(text, parse(text), 'built');
  const parsed = ses.parse;
  const index = identity.buildIndex(ses);
  const facts = scenarios.documentFacts(parsed);
  const entry = entryByDef(index, 'A');
  const built = scenarios.buildScenarios({ text, file: fakeFile(), parseResult: parsed, index, facts, entry });

  for (const scenario of built) {
    const after = edit.applyEdits(text, scenario.edits); // must not throw
    if (scenario.expectation.kind === 'preserved') {
      // The expectation's own arithmetic must agree with the real edited bytes.
      // This is what makes an `oracle-unresolved` verdict meaningful rather than
      // an artefact of a buggy scenario.
      assert.equal(
        after.slice(scenario.expectation.start, scenario.expectation.end),
        scenario.expectation.text,
        `${scenario.id}: expectation text does not match the edited document`,
      );
    }
  }
});

test('buildExpectation computes deletion, not a shifted survivor, when the node is removed', () => {
  const text = `${HEADER}DEF A Transform { }\n`;
  const start = text.indexOf('DEF A');
  const end = text.indexOf('}') + 1;
  const exp = scenarios.buildExpectation(text, [{ from: start, to: end, insert: '' }], start, end);
  assert.equal(exp.kind, 'deleted');
});

test('buildExpectation shifts a preserved node by the inserted length', () => {
  const text = `${HEADER}DEF A Transform { }\n`;
  const start = text.indexOf('DEF A');
  const end = text.indexOf('}') + 1;
  const insert = '# note\n';
  const exp = scenarios.buildExpectation(text, [{ from: HEADER.length, to: HEADER.length, insert }], start, end);
  assert.equal(exp.kind, 'preserved');
  assert.equal(exp.start, start + insert.length);
  assert.equal(exp.end, end + insert.length);
  assert.equal(exp.text, text.slice(start, end));
});

test('a straddling edit is refused rather than guessed at', () => {
  const text = `${HEADER}DEF A Transform { }\n`;
  const start = text.indexOf('DEF A');
  const end = text.indexOf('}') + 1;
  const exp = scenarios.buildExpectation(text, [{ from: start + 2, to: end + 1, insert: 'X' }], start, end);
  assert.equal(exp.kind, 'straddling');
});

// ---------------------------------------------------------------------------
// 7. Reporting arithmetic
// ---------------------------------------------------------------------------

test('rates exclude oracle-unresolved cases from the denominator', () => {
  const tally = report.emptyTally();
  report.bump(tally, oracle.CLASS.CORRECT);
  report.bump(tally, oracle.CLASS.SAFE_LOSS);
  report.bump(tally, oracle.CLASS.ORACLE_UNRESOLVED);
  const r = report.rates(tally);
  assert.equal(tally.total, 3);
  assert.equal(r.scored, 2, 'unresolved cases must not be scored');
  assert.equal(r.provenSuccess, 0.5);
});

test('a strategy with no scored cases reports null rates rather than 0 or NaN', () => {
  const tally = report.emptyTally();
  report.bump(tally, oracle.CLASS.ORACLE_UNRESOLVED);
  const r = report.rates(tally);
  assert.equal(r.provenSuccess, null);
  assert.equal(r.safeRefusal, null);
});

test('serialize produces byte-identical output for equal inputs', () => {
  const build = () => {
    const cases = [
      { strategy: 'A1', klass: oracle.CLASS.CORRECT, scenario: 'S01', nodeType: 'Transform', group: 'g', sizeClass: 'small', layer: null, unsupported: false, hasDef: true, hasUniqueDef: true, duplicateDef: false, protoFile: false, protoScoped: false, hyphenDef: false, unknownNode: false, recovered: false, identicalSibling: false },
      { strategy: 'A1', klass: oracle.CLASS.WRONG, scenario: 'S02', nodeType: 'Shape', group: 'g', sizeClass: 'small', layer: null, unsupported: false, hasDef: false, hasUniqueDef: false, duplicateDef: false, protoFile: false, protoScoped: false, hyphenDef: false, unknownNode: false, recovered: false, identicalSibling: true },
    ];
    return JSON.stringify(report.serialize(report.aggregate(cases)));
  };
  assert.equal(build(), build());
});
