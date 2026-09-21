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

// --- Lane B B1: gzip preservation through the session ------------------------

const crypto = require('node:crypto');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// A gzip artifact carrying foreign-encoder header metadata. B1 must decide
// preservation on decompressed-text identity alone, never on the header, the
// size or which encoder wrote the file.
function foreignGzip(text) {
  const buf = zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 });
  buf[9] = 0x03; // OS header byte: metadata only, it does not change the payload
  return buf;
}

test('B1: session.save preserves an unchanged gzip source and still reports clean', () => {
  const p = tmpFile('item.wrl', foreignGzip(WRL));
  const beforeSha = sha256(fs.readFileSync(p));
  const beforeMtime = fs.statSync(p).mtimeMs;

  const s = new EditorSession();
  const d = s.open(p);
  assert.strictEqual(d.format, 'gzip');
  assert.strictEqual(d.dirty, false);

  const res = s.save();
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.preserved, true, 'preservation is reported through the session');
  assert.strictEqual(res.bytesWritten, 0);
  assert.strictEqual(res.backup, null);
  assert.strictEqual(res.format, 'gzip', 'format is unchanged');
  assert.strictEqual(res.sourcePath, p, 'source path is unchanged');
  assert.strictEqual(res.dirty, false);

  assert.strictEqual(sha256(fs.readFileSync(p)), beforeSha, 'bytes are byte-identical');
  assert.strictEqual(fs.statSync(p).mtimeMs, beforeMtime, 'mtime is untouched');

  // The session is synced and its stat remains a valid conflict baseline.
  assert.strictEqual(s.describe().dirty, false, 'buffer is clean');
  assert.ok(res.stat && typeof res.stat.hash === 'string');
  assert.strictEqual(s.checkConflict().changed, false, 'no phantom conflict after a no-op');
});

test('B1: a session save of CHANGED text still writes and backs up normally', () => {
  const p = tmpFile('item.wrl', foreignGzip(WRL));
  const beforeSha = sha256(fs.readFileSync(p));
  const s = new EditorSession();
  s.open(p);
  s.setText(WRL + '# edited\n');

  const res = s.save();
  assert.strictEqual(res.preserved, false);
  assert.ok(res.bytesWritten > 0);
  assert.ok(res.backup && fs.existsSync(res.backup), 'a real overwrite backs up');
  assert.notStrictEqual(sha256(fs.readFileSync(p)), beforeSha);
  assert.strictEqual(zlib.gunzipSync(fs.readFileSync(p)).toString('utf8'), WRL + '# edited\n');
});

test('B1: an external change still raises EEXTERNAL on an unchanged gzip buffer', () => {
  const p = tmpFile('item.wrl', foreignGzip(WRL));
  const s = new EditorSession();
  s.open(p);
  // Buffer untouched; the file is rewritten externally to different bytes that
  // still decode to the same text.
  const rewritten = zlib.gzipSync(Buffer.from(WRL, 'utf8'), { level: 1 });
  fs.writeFileSync(p, rewritten);

  assert.throws(() => s.save(), (err) => err.code === 'EEXTERNAL',
    'conflict wins over preservation');
  assert.strictEqual(sha256(fs.readFileSync(p)), sha256(rewritten), 'file untouched by the refusal');
});

test('B1 scope: saveAs does NOT preserve, even into an identical gzip destination', () => {
  const p = tmpFile('src.wrl', foreignGzip(WRL));
  const dst = path.join(path.dirname(p), 'dest.wrl');
  // The destination already holds a gzip artifact of exactly the same text.
  fs.writeFileSync(dst, foreignGzip(WRL));
  const destBefore = sha256(fs.readFileSync(dst));

  const s = new EditorSession();
  s.open(p);
  const res = s.saveAs(dst); // same (gzip) format, identical text

  assert.strictEqual(res.ok, true);
  assert.notStrictEqual(res.preserved, true, 'Save As preservation is B3 scope, not B1');

  // The normal write path is proven by its observable effects. A legitimate
  // Save As may re-encode to the very same gzip bytes, so destination byte
  // inequality is not a portable proof that a write happened -- the backup is.
  assert.ok(res.backup && fs.existsSync(res.backup), 'the existing destination got its normal backup');
  assert.strictEqual(sha256(fs.readFileSync(res.backup)), destBefore,
    'the backup holds the destination bytes from before Save As -- an overwrite really occurred');

  const after = fs.readFileSync(dst);
  assert.ok(after[0] === 0x1f && after[1] === 0x8b, 'the destination is still a valid gzip');
  assert.strictEqual(zlib.gunzipSync(after).toString('utf8'), WRL,
    'and decompresses to exactly the saved text');
  assert.strictEqual(res.sourcePath, dst, 'the session now points at the destination');
  assert.strictEqual(res.format, 'gzip', 'the format is unchanged');
});
