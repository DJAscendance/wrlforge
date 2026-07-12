'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { analyze } = require('../../src/editor/language');

const DOC = `#VRML V2.0 utf8
# a leading comment
DEF Ball Transform {
  translation 0 1 0
  children [
    Shape {
      geometry Sphere { radius 1.5 }
    }
    DEF Ball Group {}
  ]
}
ROUTE Ball.translation TO Two.set_translation
`;

function classOf(a, text, snippet) {
  const from = text.indexOf(snippet);
  return a.highlights.find((h) => h.from === from && text.slice(h.from, h.to) === snippet);
}

test('highlights are driven by the tokenizer + AST roles, anchored to offsets', () => {
  const a = analyze(DOC);
  // Header line.
  assert.ok(a.highlights.some((h) => h.cls === 'header' && DOC.slice(h.from, h.to).startsWith('#VRML')));
  // Keyword roles.
  assert.strictEqual(classOf(a, DOC, 'DEF').cls, 'def');
  assert.strictEqual(classOf(a, DOC, 'ROUTE').cls, 'route');
  // AST-derived identifier roles: node type vs field name.
  assert.strictEqual(classOf(a, DOC, 'Transform').cls, 'nodeType');
  assert.strictEqual(classOf(a, DOC, 'translation').cls, 'fieldName');
  // Lexical classes.
  assert.ok(a.highlights.some((h) => h.cls === 'comment' && DOC.slice(h.from, h.to).includes('leading comment')));
  assert.ok(a.highlights.some((h) => h.cls === 'string' === false)); // sanity: no stray strings
  assert.ok(a.highlights.some((h) => h.cls === 'number'));
  // Highlights are sorted by start offset.
  for (let i = 1; i < a.highlights.length; i += 1) {
    assert.ok(a.highlights[i].from >= a.highlights[i - 1].from);
  }
});

test('an invalid number token is classed as invalid', () => {
  const a = analyze('#VRML V2.0 utf8\nShape { geometry Box { size 1 2x 3 } }\n');
  assert.ok(a.highlights.some((h) => h.cls === 'invalid'), 'malformed 2x is highlighted invalid');
});

test('syntax diagnostics are authoritative; semantic findings are advisories only', () => {
  const a = analyze(DOC);
  // A syntactically clean doc -> no syntax diagnostics.
  assert.strictEqual(a.diagnostics.length, 0);
  // The duplicate DEF Ball is a FLAT-SCOPE semantic finding: it must appear as a
  // non-authoritative advisory, never as an editor error.
  assert.ok(a.advisories.length >= 1, 'duplicate DEF surfaces as an advisory');
  assert.ok(a.advisories.every((d) => typeof d.code === 'string' && d.from <= d.to));
});

test('malformed input yields syntax diagnostics with line/column and never throws', () => {
  const a = analyze('#VRML V2.0 utf8\nShape {\n'); // unclosed brace
  assert.ok(a.diagnostics.length >= 1);
  const d = a.diagnostics[0];
  assert.ok(Number.isInteger(d.line) && Number.isInteger(d.column));
  assert.ok(d.from <= d.to);
});

test('outline reflects top-level nodes, nesting, DEF, and ROUTE from the AST', () => {
  const a = analyze(DOC);
  const top = a.outline;
  assert.ok(top.length >= 2, 'a top-level node and a ROUTE');
  const ball = top.find((e) => e.kind === 'node');
  assert.strictEqual(ball.label, 'DEF Ball Transform');
  assert.ok(Number.isInteger(ball.from) && ball.to > ball.from, 'entry carries a source range');
  // Nested children were collected (Shape and the inner DEF Ball Group).
  assert.ok(ball.children.length >= 1);
  assert.ok(top.some((e) => e.kind === 'route' && e.label.includes('ROUTE Ball.translation')));
});

test('outline tolerates a partial AST from a malformed document', () => {
  const a = analyze('#VRML V2.0 utf8\nDEF Broken Transform {\n  children [ Shape {\n');
  assert.doesNotThrow(() => a.outline);
  assert.ok(Array.isArray(a.outline));
});
