'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const io = require('../../src/editor/file-io');
const { FORMAT } = require('../../src/editor/wrl-document');

const WRL = '#VRML V2.0 utf8\nGroup {\n  children [\n    Shape {}\n  ]\n}\n';

function tmpDir(suffix = '') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `wrlforge-editor-${suffix}`));
}

// Proxy over real fs that overrides selected methods with faults, delegating the
// rest -- lets us simulate an interrupted write without a real disk fault.
function faultyFs(faults) {
  return new Proxy(fs, {
    get(target, prop) {
      if (Object.prototype.hasOwnProperty.call(faults, prop)) return faults[prop];
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

test('loadDocument reads a plain .wrl as UTF-8 with a plain format + stat', () => {
  const dir = tmpDir('load-plain');
  const p = path.join(dir, 'item.wrl');
  fs.writeFileSync(p, WRL, 'utf8');
  const d = io.loadDocument(p);
  assert.strictEqual(d.text, WRL);
  assert.strictEqual(d.format, FORMAT.PLAIN);
  assert.ok(d.stat && typeof d.stat.hash === 'string' && d.stat.size > 0);
});

test('loadDocument transparently decompresses a gzip .wrl', () => {
  const dir = tmpDir('load-gzip');
  const p = path.join(dir, 'item.wrl');
  fs.writeFileSync(p, zlib.gzipSync(Buffer.from(WRL, 'utf8')));
  const d = io.loadDocument(p);
  assert.strictEqual(d.text, WRL);
  assert.strictEqual(d.format, FORMAT.GZIP);
});

test('safeSave (plain) writes verified bytes, leaves no temp, and round-trips', () => {
  const dir = tmpDir('save-plain');
  const p = path.join(dir, 'item.wrl');
  fs.writeFileSync(p, WRL, 'utf8');
  const next = WRL + '# edited\n';
  const res = io.safeSave({ filePath: p, text: next, format: FORMAT.PLAIN, expectedStat: io.statFile(p) });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), next);
  assert.ok(res.backup && fs.existsSync(res.backup), 'a backup was created');
  assert.strictEqual(fs.readFileSync(res.backup, 'utf8'), WRL, 'backup holds the prior contents');
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes('wrlforge-tmp'));
  assert.deepStrictEqual(leftovers, [], 'no temp file is left behind');
});

test('safeSave (gzip) writes real gzip bytes that decode back to the buffer', () => {
  const dir = tmpDir('save-gzip');
  const p = path.join(dir, 'item.wrl');
  fs.writeFileSync(p, zlib.gzipSync(Buffer.from(WRL)));
  const next = WRL + '# gz\n';
  const res = io.safeSave({ filePath: p, text: next, format: FORMAT.GZIP, expectedStat: io.statFile(p) });
  assert.strictEqual(res.ok, true);
  const onDisk = fs.readFileSync(p);
  assert.strictEqual(onDisk[0], 0x1f, 'on-disk file has gzip magic bytes');
  assert.strictEqual(zlib.gunzipSync(onDisk).toString('utf8'), next);
});

test('Save As to a new path creates the file with no backup and may change format', () => {
  const dir = tmpDir('save-as');
  const src = path.join(dir, 'src.wrl');
  fs.writeFileSync(src, zlib.gzipSync(Buffer.from(WRL))); // gzip source
  const dst = path.join(dir, 'copy.wrl');
  const res = io.safeSave({ filePath: dst, text: WRL, format: FORMAT.PLAIN }); // as plain
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.backup, null, 'a brand-new destination has nothing to back up');
  assert.strictEqual(fs.readFileSync(dst, 'utf8'), WRL);
});

test('safeSave preserves the original when the write is interrupted', () => {
  const dir = tmpDir('save-fail-write');
  const p = path.join(dir, 'item.wrl');
  fs.writeFileSync(p, WRL, 'utf8');
  const badFs = faultyFs({ writeSync: () => { throw new Error('simulated disk-full'); } });
  assert.throws(
    () => io.safeSave({ filePath: p, text: 'CLOBBERED', format: FORMAT.PLAIN }, { fs: badFs }),
    /disk-full/
  );
  assert.strictEqual(fs.readFileSync(p, 'utf8'), WRL, 'source is untouched after a failed write');
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes('wrlforge-tmp'));
  assert.deepStrictEqual(leftovers, [], 'the temp file was cleaned up');
});

test('safeSave aborts (EVERIFY) and preserves the source when the written file will not decode', () => {
  const dir = tmpDir('save-fail-verify');
  const p = path.join(dir, 'item.wrl');
  fs.writeFileSync(p, zlib.gzipSync(Buffer.from(WRL)));
  // zlib that compresses DIFFERENT bytes than the buffer: the verify read-back
  // will decode to the wrong text and must abort before replacing the file.
  const tamperZlib = {
    gzipSync: (_buf, opts) => zlib.gzipSync(Buffer.from('tampered', 'utf8'), opts),
    gunzipSync: zlib.gunzipSync,
  };
  assert.throws(
    () => io.safeSave({ filePath: p, text: WRL + '# real\n', format: FORMAT.GZIP }, { zlib: tamperZlib }),
    (err) => err.code === 'EVERIFY'
  );
  assert.strictEqual(zlib.gunzipSync(fs.readFileSync(p)).toString('utf8'), WRL, 'source is intact after a verify failure');
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes('wrlforge-tmp'));
  assert.deepStrictEqual(leftovers, [], 'the unverified temp was removed');
});

test('safeSave refuses (EEXTERNAL) when the file changed on disk, unless allowOverwrite', () => {
  const dir = tmpDir('save-conflict');
  const p = path.join(dir, 'item.wrl');
  fs.writeFileSync(p, WRL, 'utf8');
  const stamp = io.statFile(p);
  // External edit (same length -> exercises the content-hash tiebreaker).
  const external = WRL.replace('Shape {}', 'Shape {@'.padEnd('Shape {}'.length, ' '));
  fs.writeFileSync(p, external, 'utf8');

  assert.throws(
    () => io.safeSave({ filePath: p, text: 'MINE', format: FORMAT.PLAIN, expectedStat: stamp }),
    (err) => err.code === 'EEXTERNAL'
  );
  assert.strictEqual(fs.readFileSync(p, 'utf8'), external, 'the external change is not clobbered');

  const forced = io.safeSave({ filePath: p, text: 'MINE', format: FORMAT.PLAIN, expectedStat: stamp, allowOverwrite: true });
  assert.strictEqual(forced.ok, true);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), 'MINE');
});

test('detectExternalChange distinguishes unchanged, content, size, and deleted', () => {
  const dir = tmpDir('detect');
  const p = path.join(dir, 'item.wrl');
  fs.writeFileSync(p, WRL, 'utf8');
  const stamp = io.statFile(p);

  assert.strictEqual(io.detectExternalChange(stamp, p).changed, false);

  fs.writeFileSync(p, WRL.replace('Shape {}', 'Shape {!'), 'utf8'); // same length
  const contentChange = io.detectExternalChange(stamp, p);
  assert.strictEqual(contentChange.changed, true);
  assert.strictEqual(contentChange.reason, 'content');

  fs.writeFileSync(p, WRL + 'MORE', 'utf8'); // different length
  assert.strictEqual(io.detectExternalChange(stamp, p).reason, 'size');

  fs.rmSync(p);
  const gone = io.detectExternalChange(stamp, p);
  assert.strictEqual(gone.changed, true);
  assert.strictEqual(gone.reason, 'deleted');
});

test('reloadDocument returns the current on-disk contents', () => {
  const dir = tmpDir('reload');
  const p = path.join(dir, 'item.wrl');
  fs.writeFileSync(p, WRL, 'utf8');
  fs.writeFileSync(p, WRL + '# changed on disk\n', 'utf8');
  const d = io.reloadDocument(p);
  assert.strictEqual(d.text, WRL + '# changed on disk\n');
});

test('paths with spaces and non-ASCII characters round-trip through save + load', () => {
  const dir = tmpDir('unicode');
  const sub = path.join(dir, 'my worlds', 'café — tëst');
  fs.mkdirSync(sub, { recursive: true });
  const p = path.join(sub, 'ítem wörld.wrl');
  const res = io.safeSave({ filePath: p, text: WRL, format: FORMAT.PLAIN });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(io.loadDocument(p).text, WRL);
});
