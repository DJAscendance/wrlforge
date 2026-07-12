'use strict';
// Phase 7B1 regression: opening a Mall .wrl is PASSIVE (no external-editor
// launch); an external editor starts ONLY through the explicit action; native
// editing never creates a .edit.wrl working copy.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { openMallItem, openExternalEditor } = require('../../src/editor/mall-edit-flow');
const { EditorController } = require('../../src/editor/editor-controller');

const WRL = '#VRML V2.0 utf8\nGroup { children [] }\n';

// A recording dependency bag mirroring main.js's mallEditDeps.
function fakeDeps({ text = WRL, wasGzipped = false, existing = new Set() } = {}) {
  const rec = { launched: [], writes: [], reads: [] };
  const store = new Set(existing);
  return {
    rec,
    readSource: (p) => { rec.reads.push(p); return { text, wasGzipped, rawBytes: text.length }; },
    editPathFor: (mallPath) => mallPath.replace(/\.wr[lz]$/i, '') + '.edit.wrl',
    writeWorkingCopy: (editFile, t) => { rec.writes.push({ editFile, text: t }); store.add(editFile); },
    workingCopyExists: (editFile) => store.has(editFile),
    launch: (editFile) => { rec.launched.push(editFile); return { launched: true }; },
  };
}

test('opening a Mall file is passive: it writes the working copy but never launches an editor', () => {
  const d = fakeDeps();
  const out = openMallItem('/mall/item.wrl', d);
  assert.strictEqual(out.editFile, '/mall/item.edit.wrl');
  assert.strictEqual(out.wasGzipped, false);
  assert.deepStrictEqual(d.rec.writes.map((w) => w.editFile), ['/mall/item.edit.wrl'],
    'open writes the working copy');
  assert.strictEqual(d.rec.launched.length, 0, 'open must NOT launch any external editor');
  // The passive open payload carries no editorStatus, so it cannot surface an
  // "editor not found" message.
  assert.ok(!('editorStatus' in out), 'passive open returns no editorStatus');
});

test('explicit external-editor action launches the editor on the working copy', () => {
  const d = fakeDeps({ existing: new Set(['/mall/item.edit.wrl']) });
  const res = openExternalEditor({ mallPath: '/mall/item.wrl', editFile: '/mall/item.edit.wrl' }, d);
  assert.deepStrictEqual(d.rec.launched, ['/mall/item.edit.wrl'], 'explicit action launches once');
  assert.strictEqual(res.created, false, 'existing working copy is reused, not recreated');
  assert.deepStrictEqual(res.editorStatus, { launched: true });
});

test('explicit external editing (re)creates the working copy when it is missing', () => {
  const d = fakeDeps(); // nothing exists yet
  const res = openExternalEditor({ mallPath: '/mall/item.wrl', editFile: '/mall/item.edit.wrl' }, d);
  assert.strictEqual(res.created, true, 'missing working copy is created from source');
  assert.deepStrictEqual(d.rec.writes.map((w) => w.editFile), ['/mall/item.edit.wrl']);
  assert.deepStrictEqual(d.rec.launched, ['/mall/item.edit.wrl'], 'and then the editor launches');
});

test('native editing opens the real Mall source, never a .edit.wrl working copy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-native-'));
  const mallPath = path.join(dir, 'item.wrl');
  fs.writeFileSync(mallPath, WRL);

  const c = new EditorController({ getMallSource: () => mallPath });
  const d = c.openMall();

  assert.strictEqual(d.sourcePath, path.resolve(mallPath), 'edits the real source path');
  assert.ok(!/\.edit\.wrl$/.test(d.sourcePath), 'source is not a .edit.wrl working copy');
  assert.strictEqual(fs.existsSync(path.join(dir, 'item.edit.wrl')), false,
    'native open creates no .edit.wrl sibling');
});

test('native editing of a gzip Mall source does not create a .edit.wrl sibling', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-native-gz-'));
  const mallPath = path.join(dir, 'item.wrl');
  fs.writeFileSync(mallPath, zlib.gzipSync(Buffer.from(WRL)));

  const c = new EditorController({ getMallSource: () => mallPath });
  const d = c.openMall();

  assert.strictEqual(d.gzip, true, 'gzip format is detected');
  assert.strictEqual(fs.existsSync(path.join(dir, 'item.edit.wrl')), false,
    'native open of a gzip source creates no .edit.wrl sibling');
});
