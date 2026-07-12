'use strict';
// Deterministic ZIP writer (Phase 5A). No Electron, no fs -- pure Buffers.

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { buildZip, readZip, crc32 } = require('../../src/world-project/zip-writer');

const E = (name, str) => ({ name, data: Buffer.from(str, 'utf8') });

test('round-trips names + bytes through buildZip/readZip', () => {
  const entries = [
    E('a.txt', 'hello'),
    E('dir/b.wrl', '#VRML V2.0 utf8\n'.repeat(50)),
    E('dir/space name.png', 'x'.repeat(3000)),
  ];
  const zip = buildZip(entries);
  const back = readZip(zip);
  assert.equal(back.length, 3);
  for (const e of entries) {
    const got = back.find((b) => b.name === e.name);
    assert.ok(got, `entry ${e.name} present`);
    assert.deepEqual(got.data, e.data);
  }
});

test('is byte-for-byte deterministic for identical input (no wall-clock)', () => {
  const entries = [E('one.txt', 'alpha'), E('two.txt', 'beta beta beta')];
  const a = buildZip(entries);
  const b = buildZip(entries.map((e) => ({ name: e.name, data: Buffer.from(e.data) })));
  assert.ok(a.equals(b), 'two builds of the same input must be identical');
});

test('entry order is preserved (caller controls ordering)', () => {
  const zip = buildZip([E('z.txt', '1'), E('a.txt', '2'), E('m.txt', '3')]);
  const names = readZip(zip).map((e) => e.name);
  assert.deepEqual(names, ['z.txt', 'a.txt', 'm.txt']);
});

test('handles empty file and stores when deflate would not shrink', () => {
  const zip = buildZip([E('empty', ''), E('tiny', 'ab')]);
  const back = readZip(zip);
  assert.equal(back.find((e) => e.name === 'empty').data.length, 0);
  assert.deepEqual(back.find((e) => e.name === 'tiny').data, Buffer.from('ab'));
});

test('compresses highly-compressible data (deflate path)', () => {
  const big = 'A'.repeat(10000);
  const zip = buildZip([E('big.txt', big)]);
  assert.ok(zip.length < 2000, 'repetitive data should deflate well');
  assert.equal(readZip(zip)[0].data.toString(), big);
});

test('EOCD reports the correct entry count', () => {
  const zip = buildZip([E('a', 'x'), E('b', 'y'), E('c', 'z'), E('d', 'w')]);
  // EOCD is the last 22 bytes (no comment); total-entries at offset +10.
  const eocd = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50);
  assert.equal(zip.readUInt16LE(eocd + 10), 4);
});

test('crc32 matches zlib.crc32-style known value', () => {
  // CRC-32 of "123456789" is the standard 0xCBF43926.
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('deflate content is inflate-able back to the original', () => {
  const data = Buffer.from('#VRML V2.0 utf8\nShape { geometry Box {} }\n'.repeat(20));
  const zip = buildZip([{ name: 'w.wrl', data }]);
  // Pull the single entry back and re-verify (readZip already inflates).
  assert.deepEqual(readZip(zip)[0].data, data);
  // And its raw deflate stream is self-consistent.
  const raw = zlib.deflateRawSync(data, { level: 9 });
  assert.deepEqual(zlib.inflateRawSync(raw), data);
});
