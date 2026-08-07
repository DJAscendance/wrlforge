'use strict';
// Stable node identity tests (Phase WD1.4).
//
// The module's entire value is a negative: it must never return a node it cannot
// prove. So most of what follows asserts a REFUSAL, and every success case
// proves the exact node that came back rather than merely that something did.
//
// ---------------------------------------------------------------------------
// HOW A SUCCESS IS PROVED
// ---------------------------------------------------------------------------
//
// Tier 1 re-anchors by mapping a span through `edit.mapRange`. A test that
// checked the answer with `edit.mapRange` would be checking the implementation
// against itself, so `expectedSpan()` below is an INDEPENDENT accumulation --
// plain length deltas over the edit list, no canonical ordering, no affinity
// model, no call into src/vrml/edit.js. The expected node is then the one node
// in the reparsed tree occupying that span, located by its own traversal. Only
// then is object identity compared, and both sides come from the SAME parse
// session, which is exactly what makes `===` the right comparison.
//
// The fixtures are authored here rather than generated, and the twin fixture is
// deliberately byte-identical across its two siblings: identical siblings are
// the case where every path-, structure- and value-based scheme produces a
// confident wrong answer, so they get the most attention.

const test = require('node:test');
const assert = require('node:assert/strict');

const { parse, ast } = require('../../src/vrml');
const edit = require('../../src/vrml/edit');
const dt = require('../../src/vrml/document-transaction');
const ni = require('../../src/vrml/node-identity');

const {
  IDENTITY_ERROR, IDENTITY_STATUS, ANCHOR_STATUS, IDENTITY_REASON,
  createCurrentSelection, resolveCurrentSelection,
  createTransactionAnchor, resolveTransactionAnchor,
  createPersistentAnchor, resolvePersistentAnchor,
  isResolved, isAmbiguous, isRefused,
} = ni;

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

// Two BYTE-IDENTICAL sibling Transforms. The adversarial case.
const TWINS = [
  '#VRML V2.0 utf8',
  '',
  'Group {',
  '  children [',
  '    Transform {',
  '      translation 1 2 3',
  '      children [ Shape { geometry Box { size 1 1 1 } } ]',
  '    }',
  '    Transform {',
  '      translation 1 2 3',
  '      children [ Shape { geometry Box { size 1 1 1 } } ]',
  '    }',
  '  ]',
  '}',
  '',
].join('\n');

// DEF names (including a hyphenated one), a vendor node, a Material, and an
// anonymous node.
const SCENE = [
  '#VRML V2.0 utf8',
  '',
  'WorldInfo { title "identity fixture" }',
  'DEF Root Transform {',
  '  translation 0 0 0',
  '  children [',
  '    DEF Body Shape {',
  '      appearance Appearance { material DEF Skin Material { diffuseColor 1 0 0 } }',
  '      geometry Box { size 2 2 2 }',
  '    }',
  '    DEF Vendor-Node-1 Walla { customField 7 }',
  '    Viewpoint { position 0 0 10 }',
  '  ]',
  '}',
  '',
].join('\n');

// The same DEF name in three lexically distinguishable scopes.
const PROTOS = [
  '#VRML V2.0 utf8',
  '',
  'PROTO Alpha [ field SFVec3f offset 0 0 0 ] {',
  '  DEF Marker Transform { translation IS offset }',
  '}',
  'PROTO Beta [ ] {',
  '  DEF Marker Group { }',
  '}',
  'DEF Marker Viewpoint { position 0 0 10 }',
  '',
].join('\n');

// One scope, one name, two different node types.
const DUPES = [
  '#VRML V2.0 utf8',
  '',
  'Group {',
  '  children [',
  '    DEF Twin Transform { translation 0 0 0 }',
  '    DEF Twin Group { }',
  '  ]',
  '}',
  '',
].join('\n');

// A PROTO the parser could not name: the scope below it is unprovable.
const UNNAMED_PROTO = '#VRML V2.0 utf8\nPROTO [ ] { DEF Inner Group { } }\n';

// Parses with diagnostics; the leading node survives intact.
const RECOVERED = [
  '#VRML V2.0 utf8',
  '',
  'DEF Good Transform {',
  '  translation 1 2 3',
  '}',
  'Shape { geometry Box {',
  '',
].join('\n');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const sessionFor = (text, opts) => dt.createParseSession(text, parse(text, opts));

function nodeInstances(session) {
  const out = [];
  ast.walk(session.parse.tree, (n) => { if (n.type === ast.NODE.NODE) out.push(n); });
  return out;
}

function nodesOfType(session, nodeType) {
  return nodeInstances(session).filter((n) => n.nodeType === nodeType);
}

function nodeWithDef(session, defName) {
  const hits = nodeInstances(session).filter((n) => n.def === defName);
  assert.equal(hits.length, 1, `fixture expects exactly one DEF ${defName}`);
  return hits[0];
}

function spanOf(node) {
  return { start: node.range.start.offset, end: node.range.end.offset };
}

// The same span in the {from, to} shape src/vrml/edit.js takes.
const asRange = (span) => ({ from: span.start, to: span.end });

// INDEPENDENT of edit.mapRange: accumulate the length delta of every edit that
// lies wholly before the span, and of every edit strictly inside it. Edits that
// touch or cross a boundary never reach here -- those cases assert a refusal.
function expectedSpan(span, edits) {
  let { start, end } = span;
  for (const e of edits) {
    const delta = e.insert.length - (e.to - e.from);
    if (e.to <= span.start) { start += delta; end += delta; continue; }
    if (e.from >= span.end) continue;
    end += delta;
  }
  return { start, end };
}

// The one node occupying an exact span in a session, located by its own walk.
function nodeAtSpan(session, span, label) {
  const hits = nodeInstances(session).filter((n) => n.range
    && n.range.start.offset === span.start && n.range.end.offset === span.end);
  assert.equal(hits.length, 1,
    `${label}: the test oracle expects exactly one node at ${span.start}..${span.end}`);
  return hits[0];
}

// Anchor -> apply -> verify -> reparse -> resolve, with the transaction proven
// at every step so a failure cannot be blamed on the harness.
function transact(session, node, edits) {
  const anchor = createTransactionAnchor(session, node);
  assert.equal(anchor.status, ANCHOR_STATUS.CREATED, 'anchor could not be created');
  const newText = edit.applyEdits(session.text, edits);
  const receipt = dt.verifyTransaction({ oldText: session.text, edits, newText });
  assert.equal(receipt.status, dt.TX_STATUS.VERIFIED, 'the test transaction did not verify');
  const newSession = sessionFor(newText);
  return {
    anchor: anchor.anchor,
    edits,
    newText,
    receipt,
    newSession,
    result: resolveTransactionAnchor(anchor.anchor, newSession, receipt),
  };
}

// A success must name the exact node the independent oracle names.
function assertReanchored(run, span, label) {
  assert.equal(run.result.status, IDENTITY_STATUS.RESOLVED,
    `${label}: expected a resolution, got ${run.result.status} (${run.result.reason})`);
  assert.equal(run.result.reason, IDENTITY_REASON.VERIFIED_SPAN);
  const expected = nodeAtSpan(run.newSession, expectedSpan(span, run.edits), label);
  assert.equal(run.result.node, expected, `${label}: a DIFFERENT node was returned`);
}

// An unsafe case must return no node at all.
function assertNoNode(result, label, reason) {
  assert.notEqual(result.status, IDENTITY_STATUS.RESOLVED, `${label}: a node was resolved`);
  assert.equal(result.node, null, `${label}: a node came back on a non-resolved result`);
  assert.ok(Object.values(IDENTITY_REASON).includes(result.reason),
    `${label}: unclassified reason ${result.reason}`);
  if (reason) assert.equal(result.reason, reason, label);
}

function throwsCode(fn, code, message) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof Error, `${message}: expected an Error`);
    assert.equal(err.code, code, `${message}: wrong code (message was: ${err.message})`);
    return true;
  }, message);
}

// Replace the first occurrence of `find` at or after `from`.
function replaceAt(text, find, insert, from = 0) {
  const at = text.indexOf(find, from);
  assert.notEqual(at, -1, `fixture does not contain ${JSON.stringify(find)}`);
  return edit.replaceSpan({ from: at, to: at + find.length }, insert);
}

// ---------------------------------------------------------------------------
// parse-session enforcement
// ---------------------------------------------------------------------------

test('a selection is valid within its own parse session', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Root');
  const selection = createCurrentSelection(session, node);
  assert.equal(selection.status, ANCHOR_STATUS.CREATED);
  const result = resolveCurrentSelection(selection.anchor, session);
  assert.ok(isResolved(result));
  assert.equal(result.node, node);
  assert.equal(result.reason, IDENTITY_REASON.SAME_PARSE);
});

test('a selection does not survive a second parse of identical text', () => {
  const a = sessionFor(SCENE);
  const b = sessionFor(SCENE);
  const selection = createCurrentSelection(a, nodeWithDef(a, 'Root')).anchor;
  const result = resolveCurrentSelection(selection, b);
  assertNoNode(result, 'cross-session selection', IDENTITY_REASON.SESSION_CHANGED);
});

test('a node from another parse session cannot be anchored', () => {
  const a = sessionFor(SCENE);
  const b = sessionFor(SCENE);
  const foreign = nodeWithDef(a, 'Root');
  throwsCode(() => createCurrentSelection(b, foreign), IDENTITY_ERROR.NODE, 'selection');
  throwsCode(() => createTransactionAnchor(b, foreign), IDENTITY_ERROR.NODE, 'transaction anchor');
  throwsCode(() => createPersistentAnchor(b, foreign), IDENTITY_ERROR.NODE, 'persistent anchor');
});

test('a node deleted by the edit cannot be anchored in the new session', () => {
  const session = sessionFor(SCENE);
  const walla = nodesOfType(session, 'Walla')[0];
  const span = spanOf(walla);
  const newText = edit.applyEdits(session.text, [edit.removeSpan(asRange(span))]);
  const newSession = sessionFor(newText);
  // The caller still holds the old node object. That must not quietly work.
  throwsCode(() => createTransactionAnchor(newSession, walla), IDENTITY_ERROR.NODE, 'deleted node');
  throwsCode(() => createCurrentSelection(newSession, walla), IDENTITY_ERROR.NODE, 'deleted node');
});

test('a bare parse result cannot bypass the session guard anywhere', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Root');
  const bare = parse(SCENE);
  const anchor = createTransactionAnchor(session, node).anchor;
  const persistent = createPersistentAnchor(session, node).anchor;
  const selection = createCurrentSelection(session, node).anchor;
  const code = dt.TX_ERROR.SESSION;
  throwsCode(() => createCurrentSelection(bare, node), code, 'createCurrentSelection');
  throwsCode(() => createTransactionAnchor(bare, node), code, 'createTransactionAnchor');
  throwsCode(() => createPersistentAnchor(bare, node), code, 'createPersistentAnchor');
  throwsCode(() => resolveCurrentSelection(selection, bare), code, 'resolveCurrentSelection');
  throwsCode(() => resolveTransactionAnchor(anchor, bare, null), code, 'resolveTransactionAnchor');
  throwsCode(() => resolvePersistentAnchor(persistent, bare), code, 'resolvePersistentAnchor');
});

test('session-shaped literals are rejected by every entry point', () => {
  const session = sessionFor(SCENE);
  const fake = { sessionId: session.sessionId, text: session.text, parse: session.parse };
  const node = nodeWithDef(session, 'Root');
  const code = dt.TX_ERROR.SESSION;
  throwsCode(() => createTransactionAnchor(fake, node), code, 'fake session');
  throwsCode(() => createPersistentAnchor(fake, node), code, 'fake session');
  throwsCode(() => resolvePersistentAnchor({}, fake), code, 'fake session');
});

test('a forged selection object resolves to nothing', () => {
  const session = sessionFor(SCENE);
  const forged = { kind: ni.ANCHOR_KIND.CURRENT, sessionId: session.sessionId };
  assertNoNode(resolveCurrentSelection(forged, session), 'forged selection',
    IDENTITY_REASON.MALFORMED_ANCHOR);
  for (const value of [null, undefined, {}, 'sel', 7, []]) {
    assertNoNode(resolveCurrentSelection(value, session), 'malformed selection',
      IDENTITY_REASON.MALFORMED_ANCHOR);
  }
});

// ---------------------------------------------------------------------------
// Tier 1 -- edits that leave the selected node provably intact
// ---------------------------------------------------------------------------

test('Tier 1: a comment inserted before the selected node', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Root');
  const span = spanOf(node);
  const run = transact(session, node, [edit.insertAt(span.start, '# a note\n')]);
  assertReanchored(run, span, 'comment before');
});

test('Tier 1: blank lines inserted before the selected node', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Body');
  const span = spanOf(node);
  const run = transact(session, node, [edit.insertAt(span.start, '\n\n')]);
  assertReanchored(run, span, 'blank lines before');
});

test('Tier 1: a scalar edited strictly inside the selected node', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Body');
  const span = spanOf(node);
  const run = transact(session, node, [replaceAt(SCENE, 'size 2 2 2', 'size 12 12 12', span.start)]);
  assertReanchored(run, span, 'scalar inside');
});

test('Tier 1: a vector edited strictly inside the selected node', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Root');
  const span = spanOf(node);
  const run = transact(session, node, [replaceAt(SCENE, 'translation 0 0 0', 'translation 1 -2 3.5', span.start)]);
  assertReanchored(run, span, 'vector inside');
});

test('Tier 1: a Material field edited inside the selected Shape', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Body');
  const span = spanOf(node);
  const run = transact(session, node, [replaceAt(SCENE, 'diffuseColor 1 0 0', 'diffuseColor 0.25 0.5 0.75', span.start)]);
  assertReanchored(run, span, 'material field');
  // ...and the Material itself re-anchors through the same transaction.
  const material = nodeWithDef(session, 'Skin');
  const materialRun = transact(session, material,
    [replaceAt(SCENE, 'diffuseColor 1 0 0', 'diffuseColor 0.25 0.5 0.75', span.start)]);
  assertReanchored(materialRun, spanOf(material), 'material itself');
});

test('Tier 1: an insertion strictly inside the selected node', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Root');
  const span = spanOf(node);
  const at = SCENE.indexOf('  translation 0 0 0');
  assert.ok(at > span.start && at < span.end, 'the insertion point must be interior');
  const run = transact(session, node, [edit.insertAt(at, '  # inner comment\n')]);
  assertReanchored(run, span, 'insertion inside');
});

test('Tier 1: a field deleted strictly inside the selected node', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Root');
  const span = spanOf(node);
  const run = transact(session, node, [replaceAt(SCENE, '  translation 0 0 0\n', '', span.start)]);
  assertReanchored(run, span, 'field deleted inside');
});

test('Tier 1: a sibling inserted before the selection', () => {
  const session = sessionFor(TWINS);
  const second = nodesOfType(session, 'Transform')[1];
  const span = spanOf(second);
  const first = nodesOfType(session, 'Transform')[0];
  const run = transact(session, second, [edit.insertAt(spanOf(first).start, 'Sound { }\n    ')]);
  assertReanchored(run, span, 'sibling inserted before');
});

test('Tier 1: a sibling inserted after the selection', () => {
  const session = sessionFor(TWINS);
  const first = nodesOfType(session, 'Transform')[0];
  const span = spanOf(first);
  const run = transact(session, first, [edit.insertAt(spanOf(first).end, '\n    Sound { }')]);
  assertReanchored(run, span, 'sibling inserted after');
});

test('Tier 1: a sibling deleted before the selection', () => {
  const session = sessionFor(TWINS);
  const [first, second] = nodesOfType(session, 'Transform');
  const span = spanOf(second);
  const run = transact(session, second, [edit.removeSpan(asRange(spanOf(first)))]);
  assertReanchored(run, span, 'sibling deleted before');
});

test('Tier 1: a sibling deleted after the selection', () => {
  const session = sessionFor(TWINS);
  const [first, second] = nodesOfType(session, 'Transform');
  const span = spanOf(first);
  const run = transact(session, first, [edit.removeSpan(asRange(spanOf(second)))]);
  assertReanchored(run, span, 'sibling deleted after');
});

test('Tier 1: a top-level statement inserted before the selection', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Root');
  const span = spanOf(node);
  const run = transact(session, node, [edit.insertAt(SCENE.indexOf('WorldInfo'), 'NavigationInfo { type "EXAMINE" }\n')]);
  assertReanchored(run, span, 'top-level insert before');
});

test('Tier 1: a top-level statement inserted after the selection', () => {
  const session = sessionFor(SCENE);
  const node = nodesOfType(session, 'WorldInfo')[0];
  const span = spanOf(node);
  const run = transact(session, node, [edit.insertAt(SCENE.length, 'NavigationInfo { }\n')]);
  assertReanchored(run, span, 'top-level insert after');
});

test('Tier 1: multiple non-overlapping edits', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Body');
  const span = spanOf(node);
  const run = transact(session, node, [
    edit.insertAt(SCENE.indexOf('WorldInfo'), '# header note\n'),
    replaceAt(SCENE, 'size 2 2 2', 'size 4 4 4', span.start),
    edit.insertAt(SCENE.length, 'NavigationInfo { }\n'),
  ]);
  assertReanchored(run, span, 'multiple non-overlapping edits');
});

test('Tier 1: edits before and inside the selection at the same time', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Body');
  const span = spanOf(node);
  const run = transact(session, node, [
    edit.insertAt(span.start, '# right before\n      '),
    replaceAt(SCENE, 'diffuseColor 1 0 0', 'diffuseColor 0 1 0', span.start),
  ]);
  assertReanchored(run, span, 'before + inside');
});

test('Tier 1: an anonymous node re-anchors', () => {
  const session = sessionFor(SCENE);
  const viewpoint = nodesOfType(session, 'Viewpoint')[0];
  assert.equal(viewpoint.def, null, 'the fixture Viewpoint must be anonymous');
  const span = spanOf(viewpoint);
  const run = transact(session, viewpoint, [edit.insertAt(span.start, '# anonymous\n    ')]);
  assertReanchored(run, span, 'anonymous node');
  // ...and it has no persistent identity at all.
  assert.equal(createPersistentAnchor(session, viewpoint).reason, IDENTITY_REASON.NO_DEF_NAME);
});

test('Tier 1: an unknown/vendor node re-anchors', () => {
  const session = sessionFor(SCENE);
  const walla = nodesOfType(session, 'Walla')[0];
  const span = spanOf(walla);
  const run = transact(session, walla, [replaceAt(SCENE, 'customField 7', 'customField 42', span.start)]);
  assertReanchored(run, span, 'vendor node');
});

test('Tier 1: a recovered parse re-anchors while the evidence holds', () => {
  const session = sessionFor(RECOVERED);
  assert.ok(session.parse.diagnostics.length > 0, 'the fixture must parse with diagnostics');
  const node = nodeWithDef(session, 'Good');
  const span = spanOf(node);
  const run = transact(session, node, [replaceAt(RECOVERED, 'translation 1 2 3', 'translation 9 9 9', span.start)]);
  assert.ok(run.newSession.parse.diagnostics.length > 0, 'the reparse is still recovered');
  assertReanchored(run, span, 'recovered parse');
});

// ---------------------------------------------------------------------------
// Tier 1 -- identical siblings
// ---------------------------------------------------------------------------

test('Tier 1: byte-identical siblings re-anchor to the right twin, all four ways', () => {
  const base = sessionFor(TWINS);
  const twinSpans = nodesOfType(base, 'Transform').map(spanOf);
  assert.equal(TWINS.slice(twinSpans[0].start, twinSpans[0].end),
    TWINS.slice(twinSpans[1].start, twinSpans[1].end),
    'the twins must be byte-identical for this test to mean anything');

  for (const selected of [0, 1]) {
    for (const edited of [0, 1]) {
      const session = sessionFor(TWINS);
      const twins = nodesOfType(session, 'Transform');
      const span = spanOf(twins[selected]);
      // A LENGTH-CHANGING edit, so the arithmetic cannot come out right by
      // coincidence.
      const run = transact(session, twins[selected],
        [replaceAt(TWINS, 'translation 1 2 3', 'translation 10 20 30', twinSpans[edited].start)]);
      assertReanchored(run, span, `selected twin ${selected}, edited twin ${edited}`);
    }
  }
});

test('Tier 1: an identical sibling inserted before the selection', () => {
  const session = sessionFor(TWINS);
  const twins = nodesOfType(session, 'Transform');
  const span = spanOf(twins[1]);
  const clone = `${TWINS.slice(spanOf(twins[0]).start, spanOf(twins[0]).end)}\n    `;
  const run = transact(session, twins[1], [edit.insertAt(spanOf(twins[0]).start, clone)]);
  assert.equal(nodesOfType(run.newSession, 'Transform').length, 3, 'a third twin now exists');
  assertReanchored(run, span, 'identical sibling inserted before');
});

test('Tier 1: reordered siblings re-anchor to the selected node, not the position', () => {
  const session = sessionFor(TWINS);
  const twins = nodesOfType(session, 'Transform');
  const firstSpan = spanOf(twins[0]);
  const secondSpan = spanOf(twins[1]);
  const firstText = TWINS.slice(firstSpan.start, firstSpan.end);
  // Delete the first twin and reinsert an identical copy after the second: the
  // selected node keeps its bytes but changes sibling position.
  const run = transact(session, twins[1], [
    edit.removeSpan({ from: firstSpan.start, to: secondSpan.start }),
    edit.insertAt(secondSpan.end, `\n    ${firstText}`),
  ]);
  assertReanchored(run, secondSpan, 'reordered siblings');
});

// ---------------------------------------------------------------------------
// Tier 1 -- unsafe cases: no node, ever
// ---------------------------------------------------------------------------

test('Tier 1: deleting the selected node returns no node', () => {
  const session = sessionFor(SCENE);
  const walla = nodesOfType(session, 'Walla')[0];
  const run = transact(session, walla, [edit.removeSpan(asRange(spanOf(walla)))]);
  assertNoNode(run.result, 'selected node deleted');
});

test('Tier 1: replacing the whole selected node returns no node', () => {
  const session = sessionFor(SCENE);
  const walla = nodesOfType(session, 'Walla')[0];
  const span = spanOf(walla);
  // Replaced by a node of the SAME type and DEF -- the tempting case.
  const run = transact(session, walla,
    [edit.replaceSpan(asRange(span), 'DEF Vendor-Node-1 Walla { customField 99 }')]);
  assertNoNode(run.result, 'whole-node replacement');
});

test('Tier 1: an edit touching the node boundary returns no node', () => {
  const session = sessionFor(SCENE);
  const body = nodeWithDef(session, 'Body');
  const span = spanOf(body);
  // Starts exactly at the node's first character.
  const run = transact(session, body,
    [edit.replaceSpan({ from: span.start, to: span.start + 'DEF Body Shape'.length }, 'DEF Body Group')]);
  assertNoNode(run.result, 'boundary-touching edit', IDENTITY_REASON.EDIT_TOUCHES_BOUNDARY);
});

test('Tier 1: an edit crossing the node boundary returns no node', () => {
  const session = sessionFor(SCENE);
  const body = nodeWithDef(session, 'Body');
  const span = spanOf(body);
  const run = transact(session, body,
    [edit.replaceSpan({ from: span.start - 4, to: span.start + 8 }, '  DEF Body')]);
  assertNoNode(run.result, 'crossing edit', IDENTITY_REASON.EDIT_TOUCHES_BOUNDARY);
});

test('Tier 1: an edit ending exactly at the node start is still safe', () => {
  // The half-open boundary: [from, to) with to === node.start does NOT touch the
  // node, so this one must resolve. It is the counterpart of the two above.
  const session = sessionFor(SCENE);
  const body = nodeWithDef(session, 'Body');
  const span = spanOf(body);
  const run = transact(session, body,
    [edit.replaceSpan({ from: span.start - 4, to: span.start }, '  ')]);
  assertReanchored(run, span, 'edit ending at node start');
});

test('Tier 1: no receipt returns no node', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Root');
  const anchor = createTransactionAnchor(session, node).anchor;
  const newText = `${SCENE}# tail\n`;
  const newSession = sessionFor(newText);
  assertNoNode(resolveTransactionAnchor(anchor, newSession, null), 'null receipt',
    IDENTITY_REASON.NO_RECEIPT);
  assertNoNode(resolveTransactionAnchor(anchor, newSession, undefined), 'absent receipt',
    IDENTITY_REASON.NO_RECEIPT);
});

test('Tier 1: a forged receipt-shaped object returns no node', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Root');
  const span = spanOf(node);
  const anchor = createTransactionAnchor(session, node).anchor;
  const edits = [edit.insertAt(span.start, '# note\n')];
  const newText = edit.applyEdits(SCENE, edits);
  const newSession = sessionFor(newText);
  const real = dt.verifyTransaction({ oldText: SCENE, edits, newText });
  // Everything the real receipt exposes, plus the real edits. Still not a receipt.
  const forgeries = [
    { status: 'verified', reason: 'ok', editCount: 1 },
    { ...real },
    JSON.parse(JSON.stringify(real)),
    { status: 'verified', edits },
  ];
  for (const forged of forgeries) {
    assertNoNode(resolveTransactionAnchor(anchor, newSession, forged), 'forged receipt',
      IDENTITY_REASON.RECEIPT_NOT_ISSUED);
  }
  // The genuine article does resolve, so the refusals above are about
  // authenticity and nothing else.
  assert.ok(isResolved(resolveTransactionAnchor(anchor, newSession, real)));
});

test('Tier 1: a receipt for another document returns no node', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Root');
  const anchor = createTransactionAnchor(session, node).anchor;
  const foreignEdits = [edit.insertAt(0, '# foreign\n')];
  const foreignNew = edit.applyEdits(TWINS, foreignEdits);
  const foreignReceipt = dt.verifyTransaction({
    oldText: TWINS, edits: foreignEdits, newText: foreignNew,
  });
  assert.ok(dt.isVerifiedReceipt(foreignReceipt), 'the foreign receipt is genuine');
  const newSession = sessionFor(foreignNew);
  assertNoNode(resolveTransactionAnchor(anchor, newSession, foreignReceipt), 'foreign receipt',
    IDENTITY_REASON.RECEIPT_NOT_BOUND_TO_ANCHOR);
});

test('Tier 1: a stale receipt from an earlier revision returns no node', () => {
  const v1 = sessionFor(SCENE);
  const node = nodeWithDef(v1, 'Root');
  const anchor = createTransactionAnchor(v1, node).anchor;
  const firstEdits = [edit.insertAt(SCENE.length, '# one\n')];
  const v2Text = edit.applyEdits(SCENE, firstEdits);
  const staleReceipt = dt.verifyTransaction({ oldText: SCENE, edits: firstEdits, newText: v2Text });
  // The document has since moved on to v3; the v1->v2 receipt is stale.
  const v3Text = edit.applyEdits(v2Text, [edit.insertAt(v2Text.length, '# two\n')]);
  const v3 = sessionFor(v3Text);
  assertNoNode(resolveTransactionAnchor(anchor, v3, staleReceipt), 'stale receipt',
    IDENTITY_REASON.RECEIPT_NOT_BOUND_TO_RESULT);
});

test('Tier 1: a receipt is refused before any node resolution, for every bad input', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Root');
  const anchor = createTransactionAnchor(session, node).anchor;
  const edits = [edit.insertAt(SCENE.indexOf('WorldInfo'), '# note\n')];
  const newText = edit.applyEdits(SCENE, edits);
  const newSession = sessionFor(newText);

  const badTransactions = [
    { label: 'old text drifted', oldText: `${SCENE} `, edits, newText },
    { label: 'new text drifted', oldText: SCENE, edits, newText: `${newText} ` },
    { label: 'edit missing', oldText: SCENE, edits: [], newText },
    { label: 'wrong range', oldText: SCENE, edits: [edit.insertAt(0, '# note\n')], newText },
    { label: 'wrong text', oldText: SCENE, edits: [edit.insertAt(SCENE.indexOf('WorldInfo'), '# other\n')], newText },
    { label: 'swapped', oldText: newText, edits, newText: SCENE },
    { label: 'foreign edits', oldText: SCENE, edits: [edit.insertAt(TWINS.length, 'x')], newText },
  ];
  for (const t of badTransactions) {
    const receipt = dt.verifyTransaction(t);
    assert.equal(receipt.status, dt.TX_STATUS.REJECTED, `${t.label}: verification passed`);
    assertNoNode(resolveTransactionAnchor(anchor, newSession, receipt), t.label);
  }
});

test('Tier 1: one verified receipt re-anchors many selections', () => {
  const session = sessionFor(SCENE);
  const targets = ['Root', 'Body', 'Skin', 'Vendor-Node-1'].map((d) => nodeWithDef(session, d));
  const spans = targets.map(spanOf);
  const anchors = targets.map((n) => createTransactionAnchor(session, n).anchor);
  const edits = [edit.insertAt(SCENE.indexOf('WorldInfo'), '# shared transaction\n')];
  const newText = edit.applyEdits(SCENE, edits);
  const receipt = dt.verifyTransaction({ oldText: SCENE, edits, newText });
  const newSession = sessionFor(newText);
  anchors.forEach((anchor, i) => {
    const result = resolveTransactionAnchor(anchor, newSession, receipt);
    assert.equal(result.status, IDENTITY_STATUS.RESOLVED, `selection ${i}`);
    assert.equal(result.node, nodeAtSpan(newSession, expectedSpan(spans[i], edits), `selection ${i}`));
  });
});

test('Tier 1: a malformed anchor resolves to nothing', () => {
  const session = sessionFor(SCENE);
  const edits = [edit.insertAt(0, '# x\n')];
  const newText = edit.applyEdits(SCENE, edits);
  const receipt = dt.verifyTransaction({ oldText: SCENE, edits, newText });
  const newSession = sessionFor(newText);
  const forged = {
    kind: ni.ANCHOR_KIND.TRANSACTION, sessionId: session.sessionId,
    start: 0, end: 10, nodeType: 'Transform', defName: null,
    parentType: '#root', containingField: '#statement',
  };
  for (const value of [forged, null, undefined, {}, 'anchor', 7]) {
    assertNoNode(resolveTransactionAnchor(value, newSession, receipt), 'forged anchor',
      IDENTITY_REASON.MALFORMED_ANCHOR);
  }
});

test('Tier 1: an anchor is inert data with no path, values or document text', () => {
  const session = sessionFor(SCENE);
  const anchor = createTransactionAnchor(session, nodeWithDef(session, 'Body')).anchor;
  assert.ok(Object.isFrozen(anchor));
  assert.deepEqual(Object.keys(anchor).sort(), [
    'containingField', 'defName', 'end', 'kind', 'nodeType', 'parentType', 'sessionId', 'start',
  ]);
  const json = JSON.stringify(anchor);
  assert.equal(json.includes('diffuseColor'), false, 'no field values are retained');
  assert.equal(json.includes('#VRML'), false, 'no document text is retained');
});

// ---------------------------------------------------------------------------
// Tier 2 -- persistent DEF identity
// ---------------------------------------------------------------------------

test('Tier 2: a unique top-level DEF survives a reload', () => {
  const first = sessionFor(SCENE);
  const anchor = createPersistentAnchor(first, nodeWithDef(first, 'Root'));
  assert.equal(anchor.status, ANCHOR_STATUS.CREATED);
  // A completely fresh parse -- the "reopened the file" case.
  const reloaded = sessionFor(SCENE);
  const result = resolvePersistentAnchor(anchor.anchor, reloaded);
  assert.equal(result.status, IDENTITY_STATUS.RESOLVED);
  assert.equal(result.reason, IDENTITY_REASON.UNIQUE_DEF);
  assert.equal(result.node, nodeWithDef(reloaded, 'Root'));
  assert.notEqual(result.node, nodeWithDef(first, 'Root'), 'a fresh parse means fresh objects');
});

test('Tier 2: unrelated external edits do not disturb a unique DEF', () => {
  const first = sessionFor(SCENE);
  const anchor = createPersistentAnchor(first, nodeWithDef(first, 'Skin')).anchor;
  // An edit made by something other than WRL Forge: no receipt exists at all.
  const changed = SCENE
    .replace('WorldInfo { title "identity fixture" }', '# rewritten by another tool\nWorldInfo { title "edited elsewhere" }')
    .replace('position 0 0 10', 'position 0 1 12');
  const reparsed = sessionFor(changed);
  const result = resolvePersistentAnchor(anchor, reparsed);
  assert.equal(result.status, IDENTITY_STATUS.RESOLVED);
  assert.equal(result.node, nodeWithDef(reparsed, 'Skin'));
});

test('Tier 2: a hyphenated DEF and a vendor node type behave like any other', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Vendor-Node-1');
  assert.equal(node.nodeType, 'Walla', 'the fixture node is a vendor type');
  const anchor = createPersistentAnchor(session, node);
  assert.equal(anchor.status, ANCHOR_STATUS.CREATED);
  assert.equal(anchor.anchor.defName, 'Vendor-Node-1');
  const reloaded = sessionFor(SCENE);
  assert.equal(resolvePersistentAnchor(anchor.anchor, reloaded).node,
    nodeWithDef(reloaded, 'Vendor-Node-1'));
});

test('Tier 2: a unique DEF inside a PROTO scope resolves within that scope', () => {
  const session = sessionFor(PROTOS);
  const inAlpha = nodeInstances(session).find((n) => n.def === 'Marker' && n.nodeType === 'Transform');
  const anchor = createPersistentAnchor(session, inAlpha);
  assert.equal(anchor.status, ANCHOR_STATUS.CREATED);
  assert.equal(anchor.anchor.scopeKey, 'Alpha');
  const reloaded = sessionFor(PROTOS);
  const result = resolvePersistentAnchor(anchor.anchor, reloaded);
  assert.equal(result.status, IDENTITY_STATUS.RESOLVED);
  assert.equal(result.node.nodeType, 'Transform');
  assert.equal(result.node,
    nodeInstances(reloaded).find((n) => n.def === 'Marker' && n.nodeType === 'Transform'));
});

test('Tier 2: the same DEF name in distinguishable PROTO scopes stays distinct', () => {
  const session = sessionFor(PROTOS);
  const markers = nodeInstances(session).filter((n) => n.def === 'Marker');
  assert.equal(markers.length, 3, 'three DEF Marker nodes in three scopes');
  const anchors = markers.map((n) => createPersistentAnchor(session, n));
  for (const a of anchors) assert.equal(a.status, ANCHOR_STATUS.CREATED);
  assert.deepEqual(anchors.map((a) => a.anchor.scopeKey).sort(), ['', 'Alpha', 'Beta']);

  const reloaded = sessionFor(PROTOS);
  const reloadedMarkers = nodeInstances(reloaded).filter((n) => n.def === 'Marker');
  anchors.forEach((a, i) => {
    const result = resolvePersistentAnchor(a.anchor, reloaded);
    assert.equal(result.status, IDENTITY_STATUS.RESOLVED, `marker ${i}`);
    assert.equal(result.node, reloadedMarkers[i], `marker ${i} resolved to the wrong scope`);
  });
});

test('Tier 2: a duplicate DEF in one scope is ambiguous, never narrowed by type', () => {
  const session = sessionFor(DUPES);
  const [asTransform, asGroup] = nodeInstances(session).filter((n) => n.def === 'Twin');
  assert.equal(asTransform.nodeType, 'Transform');
  assert.equal(asGroup.nodeType, 'Group');
  // Neither can even be anchored: the name is not unique in its scope.
  assert.equal(createPersistentAnchor(session, asTransform).reason, IDENTITY_REASON.DEF_NOT_UNIQUE);
  assert.equal(createPersistentAnchor(session, asGroup).reason, IDENTITY_REASON.DEF_NOT_UNIQUE);

  // And an anchor made while the name WAS unique goes ambiguous once it is not
  // -- even though exactly one of the duplicates has the anchor's node type, so
  // "narrow by type and take the survivor" would have produced a node here.
  const unique = SCENE.replace('DEF Body Shape', 'DEF Twin Shape');
  const before = sessionFor(unique);
  const anchor = createPersistentAnchor(before, nodeWithDef(before, 'Twin')).anchor;
  assert.equal(anchor.nodeType, 'Shape');
  const after = sessionFor(unique.replace('Viewpoint {', 'DEF Twin Viewpoint {'));
  const duplicated = nodeInstances(after).filter((n) => n.def === 'Twin');
  assert.equal(duplicated.length, 2);
  assert.equal(duplicated.filter((n) => n.nodeType === 'Shape').length, 1,
    'exactly one duplicate has the anchor node type -- the trap');
  const result = resolvePersistentAnchor(anchor, after);
  assert.ok(isAmbiguous(result));
  assert.equal(result.reason, IDENTITY_REASON.DEF_DUPLICATED);
  assert.equal(result.node, null);
  assert.equal(result.count, 2);
});

test('Tier 2: a renamed DEF is a safe loss, not a re-anchor', () => {
  const session = sessionFor(SCENE);
  const anchor = createPersistentAnchor(session, nodeWithDef(session, 'Body')).anchor;
  const renamed = sessionFor(SCENE.replace('DEF Body Shape', 'DEF Torso Shape'));
  const result = resolvePersistentAnchor(anchor, renamed);
  assertNoNode(result, 'renamed DEF', IDENTITY_REASON.DEF_NOT_FOUND);
});

test('Tier 2: a deleted DEF is a safe loss', () => {
  const session = sessionFor(SCENE);
  const anchor = createPersistentAnchor(session, nodeWithDef(session, 'Vendor-Node-1')).anchor;
  const removed = sessionFor(SCENE.replace('    DEF Vendor-Node-1 Walla { customField 7 }\n', ''));
  assertNoNode(resolvePersistentAnchor(anchor, removed), 'deleted DEF',
    IDENTITY_REASON.DEF_NOT_FOUND);
});

test('Tier 2: a DEF whose node type changed is a safe loss', () => {
  const session = sessionFor(SCENE);
  const anchor = createPersistentAnchor(session, nodeWithDef(session, 'Body')).anchor;
  const retyped = sessionFor(SCENE.replace('DEF Body Shape', 'DEF Body Group'));
  assertNoNode(resolvePersistentAnchor(anchor, retyped), 'type changed',
    IDENTITY_REASON.TYPE_CHANGED);
});

test('Tier 2: a DEF that moved into a different PROTO scope is a safe loss', () => {
  const session = sessionFor(PROTOS);
  const inBeta = nodeInstances(session).find((n) => n.def === 'Marker' && n.nodeType === 'Group');
  const anchor = createPersistentAnchor(session, inBeta).anchor;
  assert.equal(anchor.scopeKey, 'Beta');
  // The same DEF and type now sits at the top level instead.
  const moved = sessionFor(PROTOS
    .replace('PROTO Beta [ ] {\n  DEF Marker Group { }\n}\n', '')
    .replace('DEF Marker Viewpoint', 'DEF Marker Group { }\nDEF Other Viewpoint'));
  assertNoNode(resolvePersistentAnchor(anchor, moved), 'scope changed',
    IDENTITY_REASON.DEF_NOT_FOUND);
});

test('Tier 2: a nested PROTO scope resolves across a reload', () => {
  const text = '#VRML V2.0 utf8\nPROTO Outer [ ] { PROTO Inner [ ] { DEF X Group { } } }\n';
  const session = sessionFor(text);
  const anchor = createPersistentAnchor(session, nodeWithDef(session, 'X'));
  assert.equal(anchor.status, ANCHOR_STATUS.CREATED);
  const reloaded = sessionFor(text);
  const result = resolvePersistentAnchor(anchor.anchor, reloaded);
  assert.equal(result.status, IDENTITY_STATUS.RESOLVED);
  assert.equal(result.node, nodeWithDef(reloaded, 'X'));
});

test('Tier 2: a PROTO name that looks like a scope chain does not collide with one', () => {
  // Regression, found by the WD1.4 independent review and reproduced here before
  // it was fixed. src/vrml/tokenizer.js classifies identifiers by EXCLUSION, so
  // `/` is a legal PROTO name character in real corpora -- which made
  // `PROTO A/B` and `PROTO A { PROTO B }` spell the same scope key. An anchor
  // from one then resolved, confidently, into the other. That is a wrong anchor.
  const flat = '#VRML V2.0 utf8\nPROTO A/B [ ] { DEF X Group { } }\nShape { }\n';
  const nested = '#VRML V2.0 utf8\nPROTO A [ ] { PROTO B [ ] { DEF X Group { } } }\nShape { }\n';
  const flatSession = sessionFor(flat);
  const nestedSession = sessionFor(nested);
  const fromFlat = createPersistentAnchor(flatSession, nodeWithDef(flatSession, 'X'));
  const fromNested = createPersistentAnchor(nestedSession, nodeWithDef(nestedSession, 'X'));
  assert.equal(fromFlat.status, ANCHOR_STATUS.CREATED);
  assert.equal(fromNested.status, ANCHOR_STATUS.CREATED);
  assert.notEqual(fromFlat.anchor.scopeKey, fromNested.anchor.scopeKey,
    'the two scopes must not share a key');

  // Neither anchor may reach into the other document's scope...
  assertNoNode(resolvePersistentAnchor(fromFlat.anchor, nestedSession),
    'flat anchor vs nested scope', IDENTITY_REASON.DEF_NOT_FOUND);
  assertNoNode(resolvePersistentAnchor(fromNested.anchor, flatSession),
    'nested anchor vs flat scope', IDENTITY_REASON.DEF_NOT_FOUND);
  // ...while each still resolves in its own.
  assert.ok(isResolved(resolvePersistentAnchor(fromFlat.anchor, sessionFor(flat))));
  assert.ok(isResolved(resolvePersistentAnchor(fromNested.anchor, sessionFor(nested))));
});

test('Tier 2: an anonymous node has no persistent identity', () => {
  const session = sessionFor(TWINS);
  for (const twin of nodesOfType(session, 'Transform')) {
    const attempt = createPersistentAnchor(session, twin);
    assert.equal(attempt.status, ANCHOR_STATUS.UNSUPPORTED);
    assert.equal(attempt.reason, IDENTITY_REASON.NO_DEF_NAME);
    assert.equal(attempt.anchor, null);
  }
});

test('Tier 2: an unprovable PROTO scope refuses rather than guessing', () => {
  const session = sessionFor(UNNAMED_PROTO);
  const inner = nodeWithDef(session, 'Inner');
  const attempt = createPersistentAnchor(session, inner);
  assert.equal(attempt.status, ANCHOR_STATUS.UNSUPPORTED);
  assert.equal(attempt.reason, IDENTITY_REASON.SCOPE_NOT_PROVABLE);

  // A hand-built anchor naming the unprovable scope still cannot resolve.
  const forced = {
    kind: ni.ANCHOR_KIND.PERSISTENT, defName: 'Inner', nodeType: 'Group', scopeKey: '?',
  };
  assertNoNode(resolvePersistentAnchor(forced, session), 'unprovable scope',
    IDENTITY_REASON.SCOPE_NOT_PROVABLE);
});

test('Tier 2: an incomplete parse cannot prove uniqueness and refuses', () => {
  // A depth-capped parse still yields nodes -- and that is exactly the danger:
  // the nodes it did produce look ordinary, but the parse never saw the rest of
  // the document, so no uniqueness claim over it can be proven.
  const capped = sessionFor(SCENE, { maxDepth: 2 });
  assert.ok(capped.parse.depthCapped, 'the fixture parse must be depth-capped');
  const node = nodeWithDef(capped, 'Root');
  const attempt = createPersistentAnchor(capped, node);
  assert.equal(attempt.status, ANCHOR_STATUS.UNSUPPORTED);
  assert.equal(attempt.reason, IDENTITY_REASON.PARSE_INCOMPLETE);

  const whole = sessionFor(SCENE);
  const anchor = createPersistentAnchor(whole, nodeWithDef(whole, 'Root')).anchor;
  assertNoNode(resolvePersistentAnchor(anchor, capped), 'depth-capped target',
    IDENTITY_REASON.PARSE_INCOMPLETE);

  // A node-budget-exhausted parse is refused the same way.
  const truncated = sessionFor(SCENE, { maxNodes: 3 });
  assert.ok(truncated.parse.truncated, 'the fixture parse must be truncated');
  assertNoNode(resolvePersistentAnchor(anchor, truncated), 'truncated target',
    IDENTITY_REASON.PARSE_INCOMPLETE);
});

test('Tier 2: a malformed anchor resolves to nothing', () => {
  const session = sessionFor(SCENE);
  const bad = [
    null, undefined, {}, 'anchor', 7, [],
    { kind: 'persistent-def-anchor' },
    { kind: 'persistent-def-anchor', defName: '', nodeType: 'Shape', scopeKey: '' },
    { kind: 'persistent-def-anchor', defName: 'Root', nodeType: '', scopeKey: '' },
    { kind: 'persistent-def-anchor', defName: 'Root', nodeType: 'Transform' },
    { kind: 'transaction-anchor', defName: 'Root', nodeType: 'Transform', scopeKey: '' },
  ];
  for (const anchor of bad) {
    assertNoNode(resolvePersistentAnchor(anchor, session), 'malformed persistent anchor',
      IDENTITY_REASON.MALFORMED_ANCHOR);
  }
});

test('Tier 2: an anchor is plain data with no range, path or values', () => {
  const session = sessionFor(SCENE);
  const anchor = createPersistentAnchor(session, nodeWithDef(session, 'Skin')).anchor;
  assert.ok(Object.isFrozen(anchor));
  assert.deepEqual(Object.keys(anchor).sort(), ['defName', 'kind', 'nodeType', 'scopeKey']);
  assert.deepEqual(JSON.parse(JSON.stringify(anchor)), {
    kind: 'persistent-def-anchor', defName: 'Skin', nodeType: 'Material', scopeKey: '',
  });
});

// ---------------------------------------------------------------------------
// the rejected strategies do not exist
// ---------------------------------------------------------------------------

test('no structural-path, closest-match, first-match or scoring fallback exists in the source', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const files = ['node-identity.js', 'document-transaction.js'];
  // Comments are stripped first: the modules DISCUSS the rejected strategies at
  // length, and prose about them is exactly what this must not trip on.
  const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
  for (const name of files) {
    const src = strip(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'vrml', name), 'utf8'));
    for (const banned of [
      /\bnearest\b/i, /\bclosest\b/i, /\bscore/i, /\bfuzz/i, /\bfingerprint/i,
      /\bpathKey\b/, /\bstructuralPath\b/, /\bresolvePath\b/, /\bbyPathKey\b/,
      /\bsimilarity\b/i, /\bbestMatch\b/i,
    ]) {
      assert.equal(banned.test(src), false, `${name} contains ${banned} outside a comment`);
    }
    // Nothing ranks candidates, so nothing sorts them either.
    assert.equal(/\.sort\(/.test(src), false, `${name} sorts candidates`);
  }
});

test('the public surface exposes no path, fingerprint or scoring API', () => {
  const surface = Object.keys(ni).concat(Object.keys(dt)).join(' ').toLowerCase();
  for (const banned of ['path', 'fingerprint', 'score', 'nearest', 'closest', 'match']) {
    assert.equal(surface.includes(banned), false, `public surface exposes "${banned}"`);
  }
  // And the receipt's binding is not reachable as data.
  assert.equal(typeof dt.receiptEdits, 'function');
  assert.equal(dt.receiptOldText, undefined);
  assert.equal(dt.receiptNewText, undefined);
});

test('a candidate at a neighbouring span is never substituted for the anchored node', () => {
  // The failure mode structural-path identity produced 1,020 times in the WD1.4
  // spike: after the selected node goes away, return the plausible neighbour.
  const session = sessionFor(TWINS);
  const twins = nodesOfType(session, 'Transform');
  const run = transact(session, twins[0], [edit.removeSpan(asRange(spanOf(twins[0])))]);
  assertNoNode(run.result, 'deleted twin');
  // The surviving twin is byte-identical, sits in the same field, has the same
  // parent and the same type. Nothing returned it.
  const survivors = nodesOfType(run.newSession, 'Transform');
  assert.equal(survivors.length, 1, 'one twin survives');
  assert.notEqual(run.result.node, survivors[0]);
});

test('every result carries a status and a classified reason, never a bare null', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Root');
  const reasons = new Set(Object.values(IDENTITY_REASON));
  const results = [
    resolveCurrentSelection(createCurrentSelection(session, node).anchor, session),
    resolveCurrentSelection(createCurrentSelection(session, node).anchor, sessionFor(SCENE)),
    resolveTransactionAnchor(createTransactionAnchor(session, node).anchor, session, null),
    resolvePersistentAnchor(createPersistentAnchor(session, node).anchor, session),
    resolvePersistentAnchor({ kind: 'persistent-def-anchor', defName: 'Nope', nodeType: 'Group', scopeKey: '' }, session),
  ];
  for (const result of results) {
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.values(IDENTITY_STATUS).includes(result.status), 'unknown status');
    assert.ok(reasons.has(result.reason), `unclassified reason ${result.reason}`);
    assert.equal(isResolved(result) ? result.node !== null : result.node === null, true);
    assert.equal(isResolved(result) || isAmbiguous(result) || isRefused(result), true);
  }
});

// ---------------------------------------------------------------------------
// index construction
// ---------------------------------------------------------------------------

test('the index sees exactly the node instances ast.walk sees', () => {
  // The traversal mirrors ast.walk rather than calling it, so this pins the two
  // together: every node instance the production walk reports must be anchorable.
  for (const text of [SCENE, TWINS, PROTOS, DUPES, RECOVERED, UNNAMED_PROTO]) {
    const session = sessionFor(text);
    for (const node of nodeInstances(session)) {
      const attempt = createTransactionAnchor(session, node);
      assert.equal(attempt.status, ANCHOR_STATUS.CREATED,
        `node ${node.nodeType} is not in the identity index`);
    }
  }
});

test('the index is built once per session and released with it', () => {
  const session = sessionFor(SCENE);
  const node = nodeWithDef(session, 'Root');
  const first = createTransactionAnchor(session, node);
  const second = createTransactionAnchor(session, node);
  assert.equal(first.status, ANCHOR_STATUS.CREATED);
  assert.equal(second.status, ANCHOR_STATUS.CREATED);
  assert.deepEqual({ ...first.anchor }, { ...second.anchor });
});

test('identity holds no reference to a document beyond its session and receipt', () => {
  // A persistent anchor is the only thing meant to outlive a session, and it
  // carries four small strings.
  const session = sessionFor(SCENE);
  const anchor = createPersistentAnchor(session, nodeWithDef(session, 'Root')).anchor;
  const serialized = JSON.stringify(anchor);
  assert.ok(serialized.length < 120, `persistent anchor is ${serialized.length} bytes`);
  assert.equal(serialized.includes('translation'), false);
});

// ---------------------------------------------------------------------------
// WD1.4 hardening -- session identity must not rest on a resettable number
// ---------------------------------------------------------------------------
//
// The defect these pin: Tier 0 used to authorize with
// `selection.sessionId !== session.sessionId`. Session ids come from a counter,
// a counter could be restarted, and two unrelated documents could therefore both
// display `ps1` -- at which point a selection made in the first RESOLVED, with
// status `resolved`, to a node that does not exist in the second document's tree.

test('resolution never compares a session id -- the session OBJECT authorizes', () => {
  // Discriminating by construction: this fails against the pre-hardening source,
  // which contained exactly the comparison being banned. A behavioural test alone
  // cannot show the id is unread once the counter can no longer be restarted.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'vrml', 'node-identity.js'), 'utf8');
  const strip = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
  const bodyOf = (name) => {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start > 0, `${name} not found`);
    const next = src.indexOf('\nfunction ', start + 1);
    return strip(src.slice(start, next === -1 ? src.length : next));
  };
  for (const fn of ['resolveCurrentSelection', 'resolveTransactionAnchor', 'resolvePersistentAnchor']) {
    assert.equal(/sessionId/.test(bodyOf(fn)), false,
      `${fn} reads sessionId; authorization must use the session object`);
  }
  // Creation may record the id, but only as a label.
  assert.equal(/sessionId/.test(bodyOf('createPersistentAnchor')), false,
    'a persistent anchor must not carry a session id at all');
});

test('two session universes that both mint "ps1" cannot be conflated', () => {
  // Process-isolation style, with no production reset helper: two independent
  // module instances each start their counter at zero, so both sides genuinely
  // display the SAME id. This is the scenario the hardening brief describes,
  // reached without giving production a way to restart the counter.
  const resolvePath = (name) => require.resolve(`../../src/vrml/${name}`);
  const freshPair = () => {
    delete require.cache[resolvePath('document-transaction.js')];
    delete require.cache[resolvePath('node-identity.js')];
    return {
      dt: require('../../src/vrml/document-transaction'),
      ni: require('../../src/vrml/node-identity'),
    };
  };
  const A = freshPair();
  const B = freshPair();

  const textA = SCENE;
  const textB = TWINS;
  const sessionA = A.dt.createParseSession(textA, parse(textA));
  const sessionB = B.dt.createParseSession(textB, parse(textB));
  assert.equal(sessionA.sessionId, sessionB.sessionId, 'the two universes must collide on the id');
  assert.equal(sessionA.sessionId, 'ps1');

  const firstNodeOf = (session) => {
    let found = null;
    ast.walk(session.parse.tree, (n) => { if (!found && n.type === ast.NODE.NODE) found = n; });
    return found;
  };
  const selectionA = A.ni.createCurrentSelection(sessionA, firstNodeOf(sessionA)).anchor;
  const anchorA = A.ni.createTransactionAnchor(sessionA, firstNodeOf(sessionA)).anchor;

  // Resolved by the universe that owns the TARGET session: the selection and the
  // anchor are strangers there, so both are refused as malformed.
  assertNoNode(B.ni.resolveCurrentSelection(selectionA, sessionB), 'cross-universe selection');
  assertNoNode(B.ni.resolveTransactionAnchor(anchorA, sessionB, null), 'cross-universe anchor');

  // Resolved by the universe that owns the SELECTION: the foreign session is not
  // in its WeakSet, so the session guard throws before anything is compared.
  throwsCode(() => A.ni.resolveCurrentSelection(selectionA, sessionB),
    dt.TX_ERROR.SESSION, 'foreign session at Tier 0');
  throwsCode(() => A.ni.resolveTransactionAnchor(anchorA, sessionB, null),
    dt.TX_ERROR.SESSION, 'foreign session at Tier 1');

  // Restore the shared instances the rest of the file uses.
  delete require.cache[resolvePath('document-transaction.js')];
  delete require.cache[resolvePath('node-identity.js')];
});

test('a selection made in one parse is refused by a different parse of identical text', () => {
  // Byte-identical text is the hardest case: nothing but object identity can tell
  // the two sessions apart.
  const a = sessionFor(SCENE);
  const b = sessionFor(SCENE);
  assert.equal(a.text, b.text);
  const selection = createCurrentSelection(a, nodeWithDef(a, 'Root')).anchor;
  assertNoNode(resolveCurrentSelection(selection, b),
    'identical-text session', IDENTITY_REASON.SESSION_CHANGED);
  // ...and still resolves in its own session, so the refusal is not blanket.
  assert.equal(resolveCurrentSelection(selection, a).status, IDENTITY_STATUS.RESOLVED);
});

test('a selection carrying another session id resolves to its OWN session, never that id', () => {
  const a = sessionFor(SCENE);
  const selection = createCurrentSelection(a, nodeWithDef(a, 'Root')).anchor;
  // The id is a label. A hand-built selection wearing the same label has no
  // binding behind it and resolves to nothing.
  const forged = Object.freeze({ kind: selection.kind, sessionId: a.sessionId });
  assertNoNode(resolveCurrentSelection(forged, a), 'forged selection', IDENTITY_REASON.MALFORMED_ANCHOR);
  const forgedAnchor = Object.freeze({ ...createTransactionAnchor(a, nodeWithDef(a, 'Root')).anchor });
  assertNoNode(resolveTransactionAnchor(forgedAnchor, a, null),
    'forged Tier 1 anchor', IDENTITY_REASON.MALFORMED_ANCHOR);
});

test('a Tier 1 anchor is bound to its originating session, not to matching text', () => {
  // Two sessions over byte-identical text. The anchor was created in the first;
  // a receipt built from the second's text is still accepted, because Tier 1's
  // contract is text-exactness -- but the anchor's binding is the session object,
  // so nothing here depends on the id, and an anchor whose origin was dropped is
  // refused rather than re-based.
  const a = sessionFor(SCENE);
  const b = sessionFor(SCENE);
  const node = nodeWithDef(a, 'Root');
  const anchor = createTransactionAnchor(a, node).anchor;
  assert.equal(anchor.sessionId, a.sessionId);
  assert.notEqual(a.sessionId, b.sessionId);
  const edits = [edit.insertAt(0, '#comment\n')];
  const newText = edit.applyEdits(a.text, edits);
  const receipt = dt.verifyTransaction({ oldText: b.text, edits, newText });
  assert.equal(receipt.status, dt.TX_STATUS.VERIFIED);
  const target = sessionFor(newText);
  // Accepted: b.text IS a.text byte for byte, which is the documented gate.
  assert.equal(resolveTransactionAnchor(anchor, target, receipt).status, IDENTITY_STATUS.RESOLVED);
  // But a receipt for a genuinely different base is refused.
  const otherEdits = [edit.insertAt(0, '#comment\n')];
  const otherNew = edit.applyEdits(TWINS, otherEdits);
  const otherReceipt = dt.verifyTransaction({ oldText: TWINS, edits: otherEdits, newText: otherNew });
  assertNoNode(resolveTransactionAnchor(anchor, sessionFor(otherNew), otherReceipt),
    'receipt for another base', IDENTITY_REASON.RECEIPT_NOT_BOUND_TO_ANCHOR);
});

// ---------------------------------------------------------------------------
// WD1.4 hardening -- the public facade is the narrow one
// ---------------------------------------------------------------------------

test('the src/vrml facade publishes exactly the consumer surface, and no internals', () => {
  const vrml = require('../../src/vrml');
  assert.deepEqual(Object.keys(vrml.documentTransaction).sort(), [
    'TX_ERROR', 'TX_REASON', 'TX_STATUS', 'isVerifiedReceipt', 'verifyTransaction',
  ]);
  assert.deepEqual(Object.keys(vrml.nodeIdentity).sort(), [
    'ANCHOR_KIND', 'ANCHOR_STATUS', 'IDENTITY_ERROR', 'IDENTITY_REASON', 'IDENTITY_STATUS',
    'createCurrentSelection', 'createParseSession', 'createPersistentAnchor',
    'createTransactionAnchor', 'isAmbiguous', 'isRefused', 'isResolved',
    'resolveCurrentSelection', 'resolvePersistentAnchor', 'resolveTransactionAnchor',
  ]);
  assert.ok(Object.isFrozen(vrml.documentTransaction) && Object.isFrozen(vrml.nodeIdentity));
});

test('receipt internals and session-counter controls are not reachable from the facade', () => {
  const vrml = require('../../src/vrml');
  const surface = { ...vrml.documentTransaction, ...vrml.nodeIdentity };
  for (const banned of [
    'resetParseSessions', 'receiptEdits', 'receiptBindsOldText', 'receiptBindsNewText',
    'firstDivergence', 'isParseSession', 'assertParseSession', 'CTX',
    'scopedDefKey', 'buildIndex', 'indexOf', 'SCOPE_SEP',
  ]) {
    assert.equal(surface[banned], undefined, `facade exposes internal "${banned}"`);
  }
  // The internals still exist on the modules themselves -- that is what
  // node-identity.js composes against -- so this is a facade decision, not a
  // claim that the helpers were deleted.
  assert.equal(typeof dt.receiptEdits, 'function');
  assert.equal(typeof dt.assertParseSession, 'function');
});

test('the facade is enough to drive all three tiers end to end', () => {
  // A narrower surface is only correct if it is still sufficient. This uses the
  // facade ALONE -- no direct module require -- for a full edit -> verify ->
  // re-anchor cycle and a reload.
  const vrml = require('../../src/vrml');
  const { nodeIdentity: id, documentTransaction: txf } = vrml;
  const session = id.createParseSession(SCENE, vrml.parse(SCENE));
  let node = null;
  vrml.ast.walk(session.parse.tree, (n) => {
    if (n.type === vrml.ast.NODE.NODE && n.def === 'Skin') node = n;
  });
  assert.ok(node, 'fixture node found through the facade');

  const selection = id.createCurrentSelection(session, node);
  assert.equal(selection.status, id.ANCHOR_STATUS.CREATED);
  assert.ok(id.isResolved(id.resolveCurrentSelection(selection.anchor, session)));

  const anchor = id.createTransactionAnchor(session, node).anchor;
  const persistent = id.createPersistentAnchor(session, node).anchor;
  const edits = [edit.insertAt(0, '#facade\n')];
  const newText = edit.applyEdits(SCENE, edits);
  const receipt = txf.verifyTransaction({ oldText: SCENE, edits, newText });
  assert.equal(receipt.status, txf.TX_STATUS.VERIFIED);
  assert.ok(txf.isVerifiedReceipt(receipt));

  const reloaded = id.createParseSession(newText, vrml.parse(newText));
  const tier1 = id.resolveTransactionAnchor(anchor, reloaded, receipt);
  assert.ok(id.isResolved(tier1), `Tier 1 through the facade: ${tier1.reason}`);
  const tier2 = id.resolvePersistentAnchor(persistent, reloaded);
  assert.ok(id.isResolved(tier2), `Tier 2 through the facade: ${tier2.reason}`);
  assert.equal(tier1.node, tier2.node, 'both tiers name the same node');
});

// ---------------------------------------------------------------------------
// WD1.4 hardening -- persistent-anchor shape is validated before it is used
// ---------------------------------------------------------------------------

test('every malformed persistent anchor is refused with no node', () => {
  const session = sessionFor(SCENE);
  const valid = createPersistentAnchor(session, nodeWithDef(session, 'Skin')).anchor;
  const without = (key) => { const c = { ...valid }; delete c[key]; return c; };
  const withKey = (key, value) => ({ ...valid, [key]: value });

  const malformed = [
    ['missing defName', without('defName')],
    ['empty defName', withKey('defName', '')],
    ['non-string defName (number)', withKey('defName', 7)],
    ['non-string defName (null)', withKey('defName', null)],
    ['non-string defName (object)', withKey('defName', { toString: () => 'Skin' })],
    ['non-string defName (array)', withKey('defName', ['Skin'])],
    ['missing nodeType', without('nodeType')],
    ['empty nodeType', withKey('nodeType', '')],
    ['non-string nodeType', withKey('nodeType', 42)],
    ['missing scopeKey', without('scopeKey')],
    ['malformed scopeKey (number)', withKey('scopeKey', 0)],
    ['malformed scopeKey (null)', withKey('scopeKey', null)],
    ['malformed scopeKey (array)', withKey('scopeKey', [])],
    ['missing kind', without('kind')],
    ['wrong kind', withKey('kind', 'transaction-anchor')],
    ['wrong kind (current)', withKey('kind', 'current-parse-selection')],
    ['kind is not a string', withKey('kind', 1)],
    ['not an object (null)', null],
    ['not an object (undefined)', undefined],
    ['not an object (string)', 'persistent-def-anchor'],
    ['not an object (number)', 3],
    ['not an object (array)', [valid]],
    ['not an object (function)', () => valid],
  ];
  for (const [label, anchor] of malformed) {
    const result = resolvePersistentAnchor(anchor, session);
    assertNoNode(result, label, IDENTITY_REASON.MALFORMED_ANCHOR);
  }
});

test('attacker-controlled extra fields on a persistent anchor change nothing', () => {
  const session = sessionFor(SCENE);
  const valid = createPersistentAnchor(session, nodeWithDef(session, 'Skin')).anchor;
  const expected = resolvePersistentAnchor(valid, session);
  assert.equal(expected.status, IDENTITY_STATUS.RESOLVED);

  const decorated = [
    { ...valid, start: 0, end: 999999 },
    { ...valid, pathKey: '0/1/2', fingerprint: 'deadbeef', score: 1 },
    { ...valid, sessionId: session.sessionId },
    { ...valid, node: nodeWithDef(session, 'Root') },
    { ...valid, __proto__: { defName: 'Root' } },
    { ...valid, toString: () => 'Root', valueOf: () => 'Root' },
  ];
  for (const anchor of decorated) {
    const result = resolvePersistentAnchor(anchor, session);
    assert.equal(result.status, IDENTITY_STATUS.RESOLVED, 'a decorated anchor still resolves');
    assert.equal(result.node, expected.node, 'a decorated anchor resolved to a DIFFERENT node');
  }
});

test('a hand-built persistent anchor with a valid shape resolves -- that is the contract', () => {
  // Tier 2 anchors are deliberately plain, serializable data: they must survive a
  // reload, so they cannot be branded the way a selection or a receipt is. A
  // caller reconstructing one from its own state store is the intended use.
  const session = sessionFor(SCENE);
  const generated = createPersistentAnchor(session, nodeWithDef(session, 'Skin')).anchor;
  const handBuilt = {
    kind: 'persistent-def-anchor', defName: 'Skin', nodeType: 'Material', scopeKey: '',
  };
  assert.deepEqual({ ...generated }, handBuilt, 'the documented shape is exactly this');
  const fromGenerated = resolvePersistentAnchor(generated, session);
  const fromHand = resolvePersistentAnchor(handBuilt, session);
  assert.equal(fromHand.status, IDENTITY_STATUS.RESOLVED);
  assert.equal(fromHand.node, fromGenerated.node);
  // ...and a hand-built anchor still cannot name a node that is not provably
  // unique: shape is a gate on the INPUT, never a substitute for the proof.
  assertNoNode(resolvePersistentAnchor({ ...handBuilt, defName: 'Ghost' }, session),
    'hand-built anchor for a name that is not there', IDENTITY_REASON.DEF_NOT_FOUND);
  assertNoNode(resolvePersistentAnchor({ ...handBuilt, scopeKey: 'NotAScope' }, session),
    'hand-built anchor for a scope that is not there', IDENTITY_REASON.DEF_NOT_FOUND);
  assertNoNode(resolvePersistentAnchor({ ...handBuilt, nodeType: 'Transform' }, session),
    'hand-built anchor whose type is wrong', IDENTITY_REASON.TYPE_CHANGED);
});

test('an unfrozen or round-tripped persistent anchor behaves identically', () => {
  const session = sessionFor(SCENE);
  const anchor = createPersistentAnchor(session, nodeWithDef(session, 'Skin')).anchor;
  assert.ok(Object.isFrozen(anchor), 'the generated anchor is frozen');
  const expected = resolvePersistentAnchor(anchor, session);

  const mutableCopy = { ...anchor };
  assert.equal(Object.isFrozen(mutableCopy), false);
  assert.equal(resolvePersistentAnchor(mutableCopy, session).node, expected.node);

  // The whole point of Tier 2: it survives serialization.
  const roundTripped = JSON.parse(JSON.stringify(anchor));
  assert.equal(resolvePersistentAnchor(roundTripped, session).node, expected.node);

  // Mutating the copy re-targets it honestly -- it is a new anchor, not a
  // tampered one, and it is still held to the same proof.
  mutableCopy.defName = 'Root';
  const retargeted = resolvePersistentAnchor(mutableCopy, session);
  assertNoNode(retargeted, 'copy mutated to a different type', IDENTITY_REASON.TYPE_CHANGED);
  // The original is untouched.
  assert.equal(resolvePersistentAnchor(anchor, session).node, expected.node);
});
