'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const ui = require('../../src/editor/ui-state');

test('formatLabel + gzip/plain labels', () => {
  assert.strictEqual(ui.formatLabel('plain'), 'Plain');
  assert.strictEqual(ui.formatLabel('gzip'), 'gzip');
  assert.strictEqual(ui.formatLabel('anything-else'), 'Plain');
});

test('isDirty is a pure buffer-vs-baseline comparison', () => {
  assert.strictEqual(ui.isDirty('a', 'a'), false);
  assert.strictEqual(ui.isDirty('a', 'b'), true);
});

test('cursorLabel formats 1-based line/column with sane defaults', () => {
  assert.strictEqual(ui.cursorLabel({ line: 3, column: 7 }), 'Ln 3, Col 7');
  assert.strictEqual(ui.cursorLabel(null), 'Ln 1, Col 1');
  assert.strictEqual(ui.cursorLabel({}), 'Ln 1, Col 1');
});

test('capDiagnostics caps the shown list but keeps the total', () => {
  const many = Array.from({ length: 250 }, (_, i) => ({ message: `d${i}` }));
  const r = ui.capDiagnostics(many, 200);
  assert.strictEqual(r.shown.length, 200);
  assert.strictEqual(r.total, 250);
  assert.strictEqual(r.hidden, 50);
  assert.strictEqual(r.capped, true);

  const few = ui.capDiagnostics([{ message: 'x' }], 200);
  assert.strictEqual(few.capped, false);
  assert.strictEqual(few.hidden, 0);
  assert.deepStrictEqual(ui.capDiagnostics(null).shown, []);
});

test('statusModel: closed vs open, dirty, gzip, counts', () => {
  assert.strictEqual(ui.statusModel({ describe: { open: false } }).open, false);

  const m = ui.statusModel({
    describe: { open: true, sourcePath: '/a/b/world.wrl', format: 'gzip', gzip: true, dirty: true, context: 'world' },
    cursor: { line: 2, column: 4 },
    diagnostics: [{}, {}],
    advisories: [{}],
  });
  assert.strictEqual(m.fileName, 'world.wrl');
  assert.strictEqual(m.format, 'gzip');
  assert.strictEqual(m.gzip, true);
  assert.strictEqual(m.dirty, true);
  assert.strictEqual(m.cursor, 'Ln 2, Col 4');
  assert.strictEqual(m.diagnosticCount, 2);
  assert.strictEqual(m.advisoryCount, 1);
  assert.strictEqual(m.context, 'world');
  assert.strictEqual(m.saveState, 'dirty');
  assert.strictEqual(m.saveLabel, 'Unsaved changes');
});

test('statusModel: an explicit saveState overrides the derived one', () => {
  const m = ui.statusModel({ describe: { open: true, sourcePath: 'x.wrl', dirty: true }, saveState: ui.SAVE_STATE.SAVING });
  assert.strictEqual(m.saveState, 'saving');
  assert.strictEqual(m.saveLabel, 'Saving…');
});

test('basename handles both separators and edge cases', () => {
  assert.strictEqual(ui.basename('/a/b/c.wrl'), 'c.wrl');
  assert.strictEqual(ui.basename('C:\\a\\b\\c.wrl'), 'c.wrl');
  assert.strictEqual(ui.basename('bare.wrl'), 'bare.wrl');
  assert.strictEqual(ui.basename(''), '');
});

test('toolbarModel: save needs dirty; saving disables everything but close is still allowed when open', () => {
  const closed = ui.toolbarModel({ open: false });
  assert.strictEqual(closed.save.enabled, false);
  assert.strictEqual(closed.saveAs.enabled, false);
  assert.strictEqual(closed.close.enabled, false);

  const cleanOpen = ui.toolbarModel({ open: true, dirty: false });
  assert.strictEqual(cleanOpen.save.enabled, false, 'nothing to save');
  assert.strictEqual(cleanOpen.saveAs.enabled, true);
  assert.strictEqual(cleanOpen.reload.enabled, true);
  assert.strictEqual(cleanOpen.close.enabled, true);

  const dirtyOpen = ui.toolbarModel({ open: true, dirty: true });
  assert.strictEqual(dirtyOpen.save.enabled, true);

  const saving = ui.toolbarModel({ open: true, dirty: true, saving: true });
  assert.strictEqual(saving.save.enabled, false);
  assert.strictEqual(saving.saveAs.enabled, false);
});

test('flattenOutline: depth-annotated rows preserve navigation targets', () => {
  const outline = [
    { kind: 'node', label: 'DEF Root Transform', from: 0, to: 10, line: 1, children: [
      { kind: 'node', label: 'Shape', from: 4, to: 8, line: 2, children: [] },
    ] },
    { kind: 'route', label: 'ROUTE A.x → B.y', from: 20, to: 40, line: 5, children: [] },
  ];
  const rows = ui.flattenOutline(outline);
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows.map((r) => r.depth), [0, 1, 0]);
  assert.deepStrictEqual(rows[1], { label: 'Shape', kind: 'node', depth: 1, from: 4, to: 8, line: 2 });
  assert.deepStrictEqual(ui.flattenOutline(null), []);
});

test('originNav maps context to the Back target', () => {
  assert.deepStrictEqual(ui.originNav('world'), { page: 'world', label: 'Back to World Project' });
  assert.deepStrictEqual(ui.originNav('mall'), { page: 'mall', label: 'Back to Mall Item' });
  assert.strictEqual(ui.originNav('generic').page, 'mall');
});

test('conflictDecision maps the three dialog choices', () => {
  assert.deepStrictEqual(ui.conflictDecision('reload'), { action: 'reload', discardsBuffer: true });
  assert.deepStrictEqual(ui.conflictDecision('saveAs'), { action: 'saveAs', discardsBuffer: false });
  assert.deepStrictEqual(ui.conflictDecision('cancel'), { action: 'cancel', discardsBuffer: false });
  assert.deepStrictEqual(ui.conflictDecision('anything'), { action: 'cancel', discardsBuffer: false });
});

test('needsUnsavedConfirm gates the close/reload confirmation on dirty', () => {
  assert.strictEqual(ui.needsUnsavedConfirm({ dirty: true }), true);
  assert.strictEqual(ui.needsUnsavedConfirm({ dirty: false }), false);
  assert.strictEqual(ui.needsUnsavedConfirm({}), false);
});

test('resolveShortcut dispatches app-level accelerators only', () => {
  assert.strictEqual(ui.resolveShortcut({ key: 's', ctrlOrMeta: true }), 'save');
  assert.strictEqual(ui.resolveShortcut({ key: 'S', ctrlOrMeta: true, shift: true }), 'saveAs');
  assert.strictEqual(ui.resolveShortcut({ key: 'g', ctrlOrMeta: true }), 'gotoLine');
  assert.strictEqual(ui.resolveShortcut({ key: 'w', ctrlOrMeta: true }), 'close');
  assert.strictEqual(ui.resolveShortcut({ key: 's' }), null, 'no modifier -> not an accelerator');
  assert.strictEqual(ui.resolveShortcut({ key: 'z', ctrlOrMeta: true }), null, 'undo is CodeMirror-owned');
  assert.strictEqual(ui.resolveShortcut({}), null);
  // Zoom accelerators (both punctuation forms).
  assert.strictEqual(ui.resolveShortcut({ key: '=', ctrlOrMeta: true }), 'zoomIn');
  assert.strictEqual(ui.resolveShortcut({ key: '+', ctrlOrMeta: true }), 'zoomIn');
  assert.strictEqual(ui.resolveShortcut({ key: '-', ctrlOrMeta: true }), 'zoomOut');
  assert.strictEqual(ui.resolveShortcut({ key: '_', ctrlOrMeta: true }), 'zoomOut');
  assert.strictEqual(ui.resolveShortcut({ key: '0', ctrlOrMeta: true }), 'zoomReset');
  assert.strictEqual(ui.resolveShortcut({ key: '=' }), null, 'zoom needs the modifier');
});

test('themes: at least five (incl. High Contrast), with a safe default and fallback', () => {
  assert.ok(ui.THEMES.length >= 5, 'at least five built-in themes');
  const ids = ui.THEMES.map((t) => t.id);
  for (const id of ['dark', 'light', 'terminal', 'tokyo', 'contrast']) assert.ok(ids.includes(id), `${id} present`);
  assert.ok(ui.THEMES.every((t) => t.id && t.label), 'every theme has an id and a label');
  assert.strictEqual(ui.isValidTheme('contrast'), true, 'High Contrast is available');
  assert.strictEqual(ui.isValidTheme('nope'), false);
  assert.strictEqual(ui.resolveTheme('contrast'), 'contrast');
  assert.strictEqual(ui.resolveTheme('bogus'), ui.DEFAULT_THEME);
  assert.strictEqual(ui.resolveTheme(null), ui.DEFAULT_THEME);
  assert.strictEqual(ui.isValidTheme(ui.DEFAULT_THEME), true);
});

test('zoom: clamping, stepping, and reset stay within bounds', () => {
  assert.strictEqual(ui.clampZoom(0), 0);
  assert.strictEqual(ui.clampZoom(99), ui.ZOOM_MAX, 'clamps above max');
  assert.strictEqual(ui.clampZoom(-99), ui.ZOOM_MIN, 'clamps below min');
  assert.strictEqual(ui.zoomStep(0, +1), 1);
  assert.strictEqual(ui.zoomStep(ui.ZOOM_MAX, +1), ui.ZOOM_MAX, 'cannot step past max');
  assert.strictEqual(ui.zoomStep(ui.ZOOM_MIN, -1), ui.ZOOM_MIN, 'cannot step below min');
  assert.strictEqual(ui.zoomStep(2, -3), -1);
});

test('resolveZoom tolerates absent / garbage persisted values', () => {
  assert.strictEqual(ui.resolveZoom('3'), 3);
  assert.strictEqual(ui.resolveZoom(3), 3);
  assert.strictEqual(ui.resolveZoom(null), ui.ZOOM_DEFAULT);
  assert.strictEqual(ui.resolveZoom('garbage'), ui.ZOOM_DEFAULT);
  assert.strictEqual(ui.resolveZoom(undefined), ui.ZOOM_DEFAULT);
  assert.strictEqual(ui.resolveZoom('999'), ui.ZOOM_MAX, 'out-of-range persisted value is clamped');
});

test('zoomModel: the single source of truth for code font + chrome scale', () => {
  const base = ui.zoomModel(0);
  assert.strictEqual(base.level, 0);
  assert.strictEqual(base.codeFontPx, 13, 'level 0 is the 13px base');
  assert.strictEqual(base.chromeScale, 1);
  assert.strictEqual(base.label, '100%');

  const up = ui.zoomModel(5);
  const down = ui.zoomModel(-2);
  assert.ok(up.codeFontPx > base.codeFontPx, 'zooming in enlarges the code font');
  assert.ok(up.chromeScale > base.chromeScale, 'zooming in enlarges the chrome');
  assert.ok(down.codeFontPx < base.codeFontPx, 'zooming out shrinks the code font');
  assert.match(up.label, /^\d+%$/, 'label is a percentage');

  // Monotonic across the whole range, and font stays within the shared bounds.
  let prev = -Infinity;
  for (let lv = ui.ZOOM_MIN; lv <= ui.ZOOM_MAX; lv++) {
    const m = ui.zoomModel(lv);
    assert.ok(m.codeFontPx >= prev, 'codeFontPx is non-decreasing with level');
    assert.ok(m.codeFontPx >= 9 && m.codeFontPx <= 28, `font ${m.codeFontPx} within [9,28]`);
    prev = m.codeFontPx;
  }
  // Out-of-range input is clamped by the model itself.
  assert.deepStrictEqual(ui.zoomModel(999), ui.zoomModel(ui.ZOOM_MAX));
});

test('isFreshAnalysis rejects an older analysis version', () => {
  assert.strictEqual(ui.isFreshAnalysis(5, 3), true);
  assert.strictEqual(ui.isFreshAnalysis(3, 3), true, 'equal is fresh enough');
  assert.strictEqual(ui.isFreshAnalysis(2, 3), false, 'a late older parse is dropped');
  assert.strictEqual(ui.isFreshAnalysis(undefined, 3), false);
});
