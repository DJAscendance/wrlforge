'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { EditorSession } = require('../../src/editor/session');

const WRL = '#VRML V2.0 utf8\nGroup { children [] }\n';

function tmpFile(name, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-session-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, bytes);
  return p;
}

test('open loads text + format and starts clean', () => {
  const p = tmpFile('item.wrl', WRL);
  const s = new EditorSession();
  const d = s.open(p, { profile: 'mall-item', context: 'mall' });
  assert.strictEqual(d.open, true);
  assert.strictEqual(d.text, WRL);
  assert.strictEqual(d.format, 'plain');
  assert.strictEqual(d.dirty, false);
  assert.strictEqual(d.context, 'mall');
});

test('setText drives dirty state', () => {
  const p = tmpFile('item.wrl', WRL);
  const s = new EditorSession();
  s.open(p);
  assert.strictEqual(s.setText(WRL + '# edit\n'), true);
  assert.strictEqual(s.describe().dirty, true);
  assert.strictEqual(s.setText(WRL), false, 'reverting clears dirty');
});

test('save writes, backs up, and clears dirty', () => {
  const p = tmpFile('item.wrl', WRL);
  const s = new EditorSession();
  s.open(p);
  s.setText(WRL + '# saved\n');
  const res = s.save();
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.dirty, false);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), WRL + '# saved\n');
  assert.ok(res.backup && fs.existsSync(res.backup));
  assert.strictEqual(s.describe().dirty, false, 'saved buffer is clean');
});

test('save round-trips a gzip source as gzip', () => {
  const p = tmpFile('item.wrl', zlib.gzipSync(Buffer.from(WRL)));
  const s = new EditorSession();
  const d = s.open(p);
  assert.strictEqual(d.format, 'gzip');
  s.setText(WRL + '# gz\n');
  s.save();
  const onDisk = fs.readFileSync(p);
  assert.strictEqual(onDisk[0], 0x1f, 'still gzip on disk');
  assert.strictEqual(zlib.gunzipSync(onDisk).toString('utf8'), WRL + '# gz\n');
});

test('checkConflict detects an external change; save refuses until resolved', () => {
  const p = tmpFile('item.wrl', WRL);
  const s = new EditorSession();
  s.open(p);
  s.setText('mine');
  fs.writeFileSync(p, WRL + '# theirs\n', 'utf8'); // external edit

  assert.strictEqual(s.checkConflict().changed, true);
  assert.throws(() => s.save(), (err) => err.code === 'EEXTERNAL');
  assert.strictEqual(fs.readFileSync(p, 'utf8'), WRL + '# theirs\n', 'external change not clobbered');

  // Resolve by overwriting (user chose "keep mine").
  const res = s.save('mine', { allowOverwrite: true });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), 'mine');
  assert.strictEqual(s.checkConflict().changed, false, 'stat refreshed after save');
});

test('reload discards buffer edits and takes the on-disk version', () => {
  const p = tmpFile('item.wrl', WRL);
  const s = new EditorSession();
  s.open(p);
  s.setText('unsaved edits');
  fs.writeFileSync(p, WRL + '# disk\n', 'utf8');
  const res = s.reload();
  assert.strictEqual(res.text, WRL + '# disk\n');
  assert.strictEqual(s.describe().dirty, false);
  assert.strictEqual(s.checkConflict().changed, false);
});

test('saveAs targets a new path and can change format', () => {
  const p = tmpFile('src.wrl', zlib.gzipSync(Buffer.from(WRL)));
  const s = new EditorSession();
  s.open(p);
  const dst = path.join(path.dirname(p), 'copy.wrl');
  const res = s.saveAs(dst, { format: 'plain' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.sourcePath, dst);
  assert.strictEqual(res.format, 'plain');
  assert.strictEqual(fs.readFileSync(dst, 'utf8'), WRL);
  // The session now points at the new file.
  assert.strictEqual(s.describe().sourcePath, dst);
  assert.strictEqual(s.describe().dirty, false);
});

test('operations throw clearly when nothing is open', () => {
  const s = new EditorSession();
  assert.strictEqual(s.isOpen(), false);
  assert.strictEqual(s.describe().open, false);
  assert.throws(() => s.save(), /No document is open/);
  assert.throws(() => s.reload(), /No document is open/);
});
