'use strict';
// Parse-session and verified-transaction tests (Phase WD1.4).
//
// Two things are being pinned here, and both are safety properties rather than
// features:
//
//   1. A parse session cannot be forged, cannot be produced by accident, and is
//      never equal to another parse of the same text. Everything downstream
//      compares AST nodes by object identity, which is meaningless across
//      parses, so the guard has to be structural.
//   2. A transaction receipt is issued ONLY when the supplied edits, applied to
//      the supplied old text, reproduce the supplied new text byte for byte --
//      and a receipt is unforgeable, non-serializable, and bound to exactly one
//      (oldText, newText) pair.
//
// Every negative case below is written so that the edit set is plausible: a
// missing edit, a one-character drift, a stale set, a set from another document.
// Those are the inputs a real editor produces when it loses track of its own
// transaction log, and each one has to be refused BEFORE any node is resolved.

const test = require('node:test');
const assert = require('node:assert/strict');

const { parse } = require('../../src/vrml');
const edit = require('../../src/vrml/edit');
const dt = require('../../src/vrml/document-transaction');
const {
  TX_ERROR, TX_STATUS, TX_REASON,
  createParseSession, isParseSession, assertParseSession,
  verifyTransaction, isVerifiedReceipt,
  receiptBindsOldText, receiptBindsNewText, receiptEdits,
} = dt;

const DOC = '#VRML V2.0 utf8\n\nWorldInfo { title "identity" }\nTransform { translation 1 2 3 }\n';

const sessionFor = (text) => createParseSession(text, parse(text));

function throwsCode(fn, code, message) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof Error, `${message}: expected an Error`);
    assert.equal(err.code, code, `${message}: wrong error code (message was: ${err.message})`);
    return true;
  }, message);
}

// ---------------------------------------------------------------------------
// parse sessions
// ---------------------------------------------------------------------------

test('createParseSession binds one exact text to one exact parse', () => {
  const session = sessionFor(DOC);
  assert.equal(session.text, DOC);
  assert.ok(session.parse && session.parse.tree, 'session carries the parse result');
  assert.equal(typeof session.sessionId, 'string');
  assert.ok(isParseSession(session));
});

test('a session is frozen and carries no clock or random value', () => {
  // Deliberately asserted WITHOUT resetting a counter: the ids are opaque here,
  // and only their SHAPE and their strict monotonicity are contractual. A test
  // that pinned 'ps1' would need a production reset helper to exist, and that
  // helper is exactly what makes two documents able to display the same id.
  const a = sessionFor(DOC);
  const b = sessionFor(DOC);
  assert.ok(Object.isFrozen(a));
  assert.match(a.sessionId, /^ps\d+$/);
  assert.match(b.sessionId, /^ps\d+$/);
  assert.ok(Number(b.sessionId.slice(2)) > Number(a.sessionId.slice(2)), 'ids strictly increase');
  assert.throws(() => { a.text = 'other'; }, TypeError);
});

test('there is no way to restart the session counter', () => {
  // The preferred correction from the WD1.4 hardening pass: `resetParseSessions`
  // was removed outright rather than merely kept off the facade. A counter that
  // can be restarted lets two unrelated documents mint the same id, and an
  // earlier Tier 0 compared exactly that id.
  assert.equal(dt.resetParseSessions, undefined, 'module must not export a reset');
  const reset = Object.keys(dt).filter((k) => /reset|clear/i.test(k));
  assert.deepEqual(reset, [], `no reset-shaped export may exist, found: ${reset.join(', ')}`);
  const ids = Array.from({ length: 5 }, () => Number(sessionFor(DOC).sessionId.slice(2)));
  for (let i = 1; i < ids.length; i += 1) {
    assert.ok(ids[i] > ids[i - 1], 'session ids never repeat or go backwards');
  }
});

test('two parses of identical text are two distinct sessions', () => {
  const a = sessionFor(DOC);
  const b = sessionFor(DOC);
  assert.notEqual(a.sessionId, b.sessionId);
  assert.notEqual(a, b);
  assert.equal(a.text, b.text);
  // The reason the ids must differ: the trees are structurally equal but not
  // identical, so any object-identity comparison across them is meaningless.
  assert.notEqual(a.parse.tree, b.parse.tree);
});

test('a bare parse result is not a session and cannot be used as one', () => {
  const bare = parse(DOC);
  assert.equal(isParseSession(bare), false);
  throwsCode(() => assertParseSession(bare), TX_ERROR.SESSION, 'bare parse result');
});

test('session-shaped literals are rejected -- membership cannot be forged', () => {
  const real = sessionFor(DOC);
  const forgeries = [
    { sessionId: real.sessionId, text: real.text, parse: real.parse },
    { ...real },
    Object.freeze({ sessionId: 'ps1', text: DOC, parse: parse(DOC) }),
    { sessionId: 'ps999' },
    null, undefined, 'ps1', 7, [], () => {},
  ];
  for (const value of forgeries) {
    assert.equal(isParseSession(value), false, `forgery accepted: ${JSON.stringify(value)}`);
    throwsCode(() => assertParseSession(value), TX_ERROR.SESSION, 'session forgery');
  }
});

test('createParseSession rejects malformed arguments loudly', () => {
  throwsCode(() => createParseSession(null, parse(DOC)), TX_ERROR.SHAPE, 'null text');
  throwsCode(() => createParseSession(7, parse(DOC)), TX_ERROR.SHAPE, 'numeric text');
  throwsCode(() => createParseSession(DOC, null), TX_ERROR.SHAPE, 'null parse');
  throwsCode(() => createParseSession(DOC, 'tree'), TX_ERROR.SHAPE, 'string parse');
  throwsCode(() => createParseSession(DOC, []), TX_ERROR.SHAPE, 'array parse');
});

// ---------------------------------------------------------------------------
// transaction verification -- accepted
// ---------------------------------------------------------------------------

const insertComment = () => [edit.insertAt(DOC.indexOf('Transform'), '# note\n')];

test('a valid exact transaction is verified', () => {
  const edits = insertComment();
  const newText = edit.applyEdits(DOC, edits);
  const receipt = verifyTransaction({ oldText: DOC, edits, newText });
  assert.equal(receipt.status, TX_STATUS.VERIFIED);
  assert.equal(receipt.reason, TX_REASON.OK);
  assert.equal(receipt.editCount, 1);
  assert.ok(isVerifiedReceipt(receipt));
  assert.ok(Object.isFrozen(receipt));
});

test('an empty edit set is verified only for unchanged text', () => {
  const receipt = verifyTransaction({ oldText: DOC, edits: [], newText: DOC });
  assert.equal(receipt.status, TX_STATUS.VERIFIED);
  assert.equal(receipt.editCount, 0);
  assert.ok(isVerifiedReceipt(receipt));
});

test('an empty document can carry a transaction', () => {
  const empty = verifyTransaction({ oldText: '', edits: [], newText: '' });
  assert.equal(empty.status, TX_STATUS.VERIFIED);

  const edits = [edit.insertAt(0, '#VRML V2.0 utf8\n')];
  const grown = verifyTransaction({ oldText: '', edits, newText: '#VRML V2.0 utf8\n' });
  assert.equal(grown.status, TX_STATUS.VERIFIED);
  assert.equal(grown.editCount, 1);
});

test('edits are accepted in any caller order and reported canonically', () => {
  const a = edit.insertAt(DOC.indexOf('WorldInfo'), '# one\n');
  const b = edit.insertAt(DOC.indexOf('Transform'), '# two\n');
  const newText = edit.applyEdits(DOC, [a, b]);
  const forward = verifyTransaction({ oldText: DOC, edits: [a, b], newText });
  const reversed = verifyTransaction({ oldText: DOC, edits: [b, a], newText });
  assert.equal(forward.status, TX_STATUS.VERIFIED);
  assert.equal(reversed.status, TX_STATUS.VERIFIED);
  assert.deepEqual(receiptEdits(forward), receiptEdits(reversed));
});

test('verification does not mutate the caller arrays or the texts', () => {
  const edits = insertComment();
  const snapshot = JSON.parse(JSON.stringify(edits));
  const newText = edit.applyEdits(DOC, edits);
  verifyTransaction({ oldText: DOC, edits, newText });
  assert.deepEqual(JSON.parse(JSON.stringify(edits)), snapshot);
});

// ---------------------------------------------------------------------------
// transaction verification -- refused
// ---------------------------------------------------------------------------
//
// Each case names the way a real caller drifts from its own transaction log.

test('old text differing by one character is refused', () => {
  const edits = insertComment();
  const newText = edit.applyEdits(DOC, edits);
  const drifted = `${DOC.slice(0, 20)}X${DOC.slice(21)}`;
  assert.notEqual(drifted, DOC);
  const result = verifyTransaction({ oldText: drifted, edits, newText });
  assert.equal(result.status, TX_STATUS.REJECTED);
  assert.equal(result.reason, TX_REASON.RESULT_MISMATCH);
});

test('new text differing by one character is refused', () => {
  const edits = insertComment();
  const newText = edit.applyEdits(DOC, edits);
  const drifted = `${newText.slice(0, newText.length - 1)}X`;
  const result = verifyTransaction({ oldText: DOC, edits, newText: drifted });
  assert.equal(result.status, TX_STATUS.REJECTED);
  assert.equal(result.reason, TX_REASON.RESULT_MISMATCH);
  assert.equal(typeof result.detail.firstDivergence, 'number');
});

test('a missing edit is refused', () => {
  const a = edit.insertAt(DOC.indexOf('WorldInfo'), '# one\n');
  const b = edit.insertAt(DOC.indexOf('Transform'), '# two\n');
  const newText = edit.applyEdits(DOC, [a, b]);
  const result = verifyTransaction({ oldText: DOC, edits: [a], newText });
  assert.equal(result.status, TX_STATUS.REJECTED);
  assert.equal(result.reason, TX_REASON.RESULT_MISMATCH);
});

test('an edit with the wrong range is refused', () => {
  const at = DOC.indexOf('Transform');
  const newText = edit.applyEdits(DOC, [edit.insertAt(at, '# note\n')]);
  const result = verifyTransaction({
    oldText: DOC, edits: [edit.insertAt(at + 3, '# note\n')], newText,
  });
  assert.equal(result.status, TX_STATUS.REJECTED);
  assert.equal(result.reason, TX_REASON.RESULT_MISMATCH);
});

test('an edit with the wrong inserted text is refused', () => {
  const at = DOC.indexOf('Transform');
  const newText = edit.applyEdits(DOC, [edit.insertAt(at, '# note\n')]);
  const result = verifyTransaction({
    oldText: DOC, edits: [edit.insertAt(at, '# NOTE\n')], newText,
  });
  assert.equal(result.status, TX_STATUS.REJECTED);
  assert.equal(result.reason, TX_REASON.RESULT_MISMATCH);
});

test('edits from a foreign document are refused', () => {
  const other = '#VRML V2.0 utf8\nGroup { children [ Shape { } ] }\n';
  const foreignEdits = [edit.replaceSpan(
    { from: other.indexOf('Shape'), to: other.indexOf('Shape') + 5 }, 'Sound',
  )];
  const newText = edit.applyEdits(other, foreignEdits);
  const result = verifyTransaction({ oldText: DOC, edits: foreignEdits, newText });
  assert.equal(result.status, TX_STATUS.REJECTED);
  assert.notEqual(result.reason, TX_REASON.OK);
});

test('an out-of-bounds edit set is refused as structurally invalid', () => {
  const result = verifyTransaction({
    oldText: DOC, edits: [edit.replaceSpan({ from: 0, to: DOC.length + 50 }, 'x')], newText: 'x',
  });
  assert.equal(result.status, TX_STATUS.REJECTED);
  assert.equal(result.reason, TX_REASON.EDIT_SET_INVALID);
  assert.equal(result.detail.code, edit.EDIT_ERROR.BOUNDS);
});

test('overlapping edits are refused as structurally invalid', () => {
  const result = verifyTransaction({
    oldText: DOC,
    edits: [edit.replaceSpan({ from: 0, to: 10 }, 'a'), edit.replaceSpan({ from: 5, to: 15 }, 'b')],
    newText: DOC,
  });
  assert.equal(result.status, TX_STATUS.REJECTED);
  assert.equal(result.reason, TX_REASON.EDIT_SET_INVALID);
  assert.equal(result.detail.code, edit.EDIT_ERROR.OVERLAP);
});

test('a stale edit set from an earlier revision is refused', () => {
  const first = insertComment();
  const v2 = edit.applyEdits(DOC, first);
  const v3 = edit.applyEdits(v2, [edit.insertAt(v2.length, '# tail\n')]);
  // The caller still holds v1's edits but the document is at v2 heading to v3.
  const result = verifyTransaction({ oldText: v2, edits: first, newText: v3 });
  assert.equal(result.status, TX_STATUS.REJECTED);
  assert.equal(result.reason, TX_REASON.RESULT_MISMATCH);
});

test('an empty edit set against changed text has its own reason', () => {
  const newText = edit.applyEdits(DOC, insertComment());
  const result = verifyTransaction({ oldText: DOC, edits: [], newText });
  assert.equal(result.status, TX_STATUS.REJECTED);
  assert.equal(result.reason, TX_REASON.EMPTY_EDITS_FOR_CHANGED_TEXT);
});

test('swapped old and new text is refused', () => {
  const edits = insertComment();
  const newText = edit.applyEdits(DOC, edits);
  const result = verifyTransaction({ oldText: newText, edits, newText: DOC });
  assert.equal(result.status, TX_STATUS.REJECTED);
  assert.notEqual(result.reason, TX_REASON.OK);
});

test('a structurally valid edit set that does not produce the new text is refused', () => {
  const edits = [edit.replaceSpan(
    { from: DOC.indexOf('1 2 3'), to: DOC.indexOf('1 2 3') + 5 }, '4 5 6',
  )];
  // Perfectly applicable -- it just is not what produced `newText`.
  const unrelated = `${DOC}# appended\n`;
  const result = verifyTransaction({ oldText: DOC, edits, newText: unrelated });
  assert.equal(result.status, TX_STATUS.REJECTED);
  assert.equal(result.reason, TX_REASON.RESULT_MISMATCH);
});

test('malformed inputs are structured refusals, never throws', () => {
  const cases = [
    undefined, null, 'text', 42, [],
    { edits: [], newText: DOC },
    { oldText: DOC, edits: [], newText: null },
    { oldText: DOC, edits: 'nope', newText: DOC },
    { oldText: 7, edits: [], newText: DOC },
  ];
  for (const input of cases) {
    const result = verifyTransaction(input);
    assert.equal(result.status, TX_STATUS.REJECTED, `input accepted: ${JSON.stringify(input)}`);
    assert.equal(result.reason, TX_REASON.MALFORMED_INPUT);
  }
});

test('a malformed edit object is refused rather than repaired', () => {
  const result = verifyTransaction({
    oldText: DOC, edits: [{ from: 0, to: 0, text: 'oops' }], newText: DOC,
  });
  assert.equal(result.status, TX_STATUS.REJECTED);
  assert.equal(result.reason, TX_REASON.EDIT_SET_INVALID);
  assert.equal(result.detail.code, edit.EDIT_ERROR.SHAPE);
});

test('every refusal carries a stable reason id from TX_REASON', () => {
  const known = new Set(Object.values(TX_REASON));
  const inputs = [
    { oldText: DOC, edits: [], newText: `${DOC}x` },
    { oldText: DOC, edits: [{ from: 0 }], newText: DOC },
    { oldText: DOC, edits: [edit.insertAt(0, 'x')], newText: DOC },
    null,
  ];
  for (const input of inputs) {
    const result = verifyTransaction(input);
    assert.equal(result.status, TX_STATUS.REJECTED);
    assert.ok(known.has(result.reason), `unclassified reason ${result.reason}`);
    assert.ok(result.detail && typeof result.detail === 'object');
  }
});

// ---------------------------------------------------------------------------
// receipt authenticity and binding
// ---------------------------------------------------------------------------

test('a receipt-shaped object is not a receipt', () => {
  const forgeries = [
    { status: TX_STATUS.VERIFIED, reason: TX_REASON.OK, editCount: 1 },
    Object.freeze({ status: 'verified', reason: 'ok', editCount: 0 }),
    { status: 'verified' },
    null, undefined, 'verified', 1, [],
  ];
  for (const value of forgeries) {
    assert.equal(isVerifiedReceipt(value), false, 'forged receipt accepted');
    assert.equal(receiptEdits(value), null);
    assert.equal(receiptBindsOldText(value, DOC), false);
    assert.equal(receiptBindsNewText(value, DOC), false);
  }
});

test('a receipt does not survive serialization', () => {
  const edits = insertComment();
  const newText = edit.applyEdits(DOC, edits);
  const receipt = verifyTransaction({ oldText: DOC, edits, newText });
  const roundTripped = JSON.parse(JSON.stringify(receipt));
  assert.equal(isVerifiedReceipt(roundTripped), false);
  assert.equal(receiptBindsOldText(roundTripped, DOC), false);
  // And the serialized form carries neither document.
  const json = JSON.stringify(receipt);
  assert.equal(json.includes('WorldInfo'), false);
  assert.equal(json.includes('Transform'), false);
});

test('a receipt names exactly one old text and one new text', () => {
  const edits = insertComment();
  const newText = edit.applyEdits(DOC, edits);
  const receipt = verifyTransaction({ oldText: DOC, edits, newText });
  assert.equal(receiptBindsOldText(receipt, DOC), true);
  assert.equal(receiptBindsNewText(receipt, newText), true);
  assert.equal(receiptBindsOldText(receipt, newText), false);
  assert.equal(receiptBindsNewText(receipt, DOC), false);
  assert.equal(receiptBindsOldText(receipt, `${DOC} `), false);
  assert.equal(receiptBindsOldText(receipt, null), false);
});

test('a receipt from another document does not bind this one', () => {
  const other = '#VRML V2.0 utf8\nGroup { }\n';
  const otherEdits = [edit.insertAt(other.length, '# tail\n')];
  const otherNew = edit.applyEdits(other, otherEdits);
  const receipt = verifyTransaction({ oldText: other, edits: otherEdits, newText: otherNew });
  assert.ok(isVerifiedReceipt(receipt));
  assert.equal(receiptBindsOldText(receipt, DOC), false);
  assert.equal(receiptBindsNewText(receipt, DOC), false);
});

test('receiptEdits returns a frozen, canonical, read-only view', () => {
  const b = edit.insertAt(DOC.indexOf('Transform'), '# two\n');
  const a = edit.insertAt(DOC.indexOf('WorldInfo'), '# one\n');
  const newText = edit.applyEdits(DOC, [a, b]);
  const receipt = verifyTransaction({ oldText: DOC, edits: [b, a], newText });
  const view = receiptEdits(receipt);
  assert.equal(view.length, 2);
  assert.ok(view[0].from < view[1].from, 'canonical order is by ascending from');
  assert.ok(Object.isFrozen(view));
  assert.ok(Object.isFrozen(view[0]));
  assert.throws(() => { view.push(edit.insertAt(0, 'x')); }, TypeError);
});

test('the same receipt can be reused for many lookups', () => {
  const edits = insertComment();
  const newText = edit.applyEdits(DOC, edits);
  const receipt = verifyTransaction({ oldText: DOC, edits, newText });
  for (let i = 0; i < 5; i += 1) {
    assert.equal(isVerifiedReceipt(receipt), true);
    assert.equal(receiptBindsOldText(receipt, DOC), true);
    assert.equal(receiptEdits(receipt).length, 1);
  }
});

test('firstDivergence reports the exact offset or null', () => {
  assert.equal(dt.firstDivergence('abc', 'abc'), null);
  assert.equal(dt.firstDivergence('abc', 'abd'), 2);
  assert.equal(dt.firstDivergence('abc', 'abcd'), 3);
  assert.equal(dt.firstDivergence('', ''), null);
});

test('receiptEdits hands out an immutable view -- receipt internals cannot be reached', () => {
  // `receiptEdits` is INTERNAL (kept off the src/vrml facade) and exists for one
  // caller: node-identity.js's Tier 1 span mapping. It must therefore be provably
  // incapable of leaking mutable receipt state.
  const newText = DOC.replace('identity', 'IDENTITY');
  const edits = [edit.replaceSpan({ from: DOC.indexOf('identity'), to: DOC.indexOf('identity') + 8 }, 'IDENTITY')];
  const receipt = verifyTransaction({ oldText: DOC, edits, newText });
  assert.equal(receipt.status, TX_STATUS.VERIFIED);

  const view = receiptEdits(receipt);
  assert.ok(Object.isFrozen(view), 'the canonical edit array is frozen');
  for (const e of view) assert.ok(Object.isFrozen(e), 'every canonical edit is frozen');

  // Every mutation route throws under strict mode and changes nothing.
  assert.throws(() => { view[0] = { from: 0, to: 0, insert: 'x' }; }, TypeError);
  assert.throws(() => { view[0].insert = 'HACKED'; }, TypeError);
  assert.throws(() => { view.push({ from: 0, to: 0, insert: 'x' }); }, TypeError);
  assert.throws(() => { view.length = 0; }, TypeError);

  // A second read is byte-for-byte what it was, and the receipt still verifies
  // the same document pair.
  const again = receiptEdits(receipt);
  assert.equal(again, view, 'the same canonical array is returned');
  assert.deepEqual(again.map((e) => ({ ...e })), edits.map((e) => ({ ...e })));
  assert.equal(receiptBindsOldText(receipt, DOC), true);
  assert.equal(receiptBindsNewText(receipt, newText), true);

  // And a caller cannot re-point the receipt by handing back a mutated array.
  const impostor = [{ from: 0, to: DOC.length, insert: newText }];
  assert.notEqual(receiptEdits(receipt), impostor);
  assert.deepEqual(receiptEdits(receipt).map((e) => ({ ...e })), edits.map((e) => ({ ...e })));
});

test('the receipt exposes no document text and survives no serialization', () => {
  const newText = `${DOC}Group { }\n`;
  const edits = [edit.insertAt(DOC.length, 'Group { }\n')];
  const receipt = verifyTransaction({ oldText: DOC, edits, newText });
  // Nothing on the receipt names either document.
  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes('WorldInfo'), false);
  assert.equal(serialized.includes('VRML'), false);
  assert.deepEqual(Object.keys(receipt).sort(), ['editCount', 'reason', 'status']);
});
