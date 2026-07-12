'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { imageSize } = require('../../src/world-project/image-size');

test('parses a real committed PNG header', () => {
  const buf = fs.readFileSync(path.resolve(__dirname, '../fixtures/world/gz/img/floor.png'));
  assert.deepEqual(imageSize(buf.subarray(0, 64)), { width: 16, height: 16 });
});

test('parses a GIF89a logical screen size', () => {
  const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x0a, 0x00, 0x14, 0x00]);
  assert.deepEqual(imageSize(gif), { width: 10, height: 20 });
});

test('parses a BMP BITMAPINFOHEADER size', () => {
  const bmp = Buffer.alloc(30);
  bmp.write('BM', 0, 'ascii');
  bmp.writeInt32LE(64, 18);
  bmp.writeInt32LE(-48, 22); // top-down bitmaps carry a negative height
  assert.deepEqual(imageSize(bmp), { width: 64, height: 48 });
});

test('parses a JPEG SOF0 frame size', () => {
  // SOI, then a SOF0 (ffc0) segment: len=17, precision=8, height=24, width=32.
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x18, 0x00, 0x20, 0x03]),
    Buffer.alloc(8),
  ]);
  assert.deepEqual(imageSize(jpeg), { width: 32, height: 24 });
});

test('returns null for non-image / truncated data', () => {
  assert.equal(imageSize(Buffer.from('not an image')), null);
  assert.equal(imageSize(Buffer.alloc(4)), null);
  assert.equal(imageSize(null), null);
});

test('does not decode gzip (a gzipped png header is not a png)', () => {
  const gz = zlib.gzipSync(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  assert.equal(imageSize(gz.subarray(0, 32)), null);
});
