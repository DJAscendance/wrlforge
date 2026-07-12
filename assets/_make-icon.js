'use strict';
// Deterministic generator for a NEUTRAL PLACEHOLDER app icon (Phase 6A).
// Run: `node assets/_make-icon.js`  -> assets/icon.ico (+ assets/icon.png)
//
// Intentionally NOT branding art: a plain dark rounded square with a lighter
// inset border and a small centered geometric mark. It exists only so the private
// Windows test build has *an* icon; final branding is out of scope for this lane.
// Kept in-tree so the icon is reproducible rather than a mystery binary.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const BG = [27, 27, 27];        // #1b1b1b (matches the app background)
const BORDER = [90, 108, 130];  // muted slate
const MARK = [120, 179, 255];   // the app's accent blue (#78b3ff)

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// Build a 256x256 RGBA image: dark rounded field, inset border ring, and a small
// centered diamond outline (a neutral geometric placeholder, not a logo).
function pixels() {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  const R = 40;                    // corner radius
  const inset = 24;                // border inset
  const inArc = (x, y, cx, cy) => (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
  const rounded = (x, y) => {
    if (x < R && y < R) return inArc(x, y, R, R);
    if (x >= SIZE - R && y < R) return inArc(x, y, SIZE - R - 1, R);
    if (x < R && y >= SIZE - R) return inArc(x, y, R, SIZE - R - 1);
    if (x >= SIZE - R && y >= SIZE - R) return inArc(x, y, SIZE - R - 1, SIZE - R - 1);
    return true;
  };
  const cx = SIZE / 2, cy = SIZE / 2, diamond = 58, ring = 6;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const o = (y * SIZE + x) * 4;
      let col = BG, a = 255;
      if (!rounded(x, y)) { a = 0; }
      else {
        // inset border ring
        const onBorder = (x === inset || x === SIZE - 1 - inset || y === inset || y === SIZE - 1 - inset) &&
          x >= inset && x <= SIZE - 1 - inset && y >= inset && y <= SIZE - 1 - inset;
        const d = Math.abs(x - cx) + Math.abs(y - cy); // L1 => diamond
        const onDiamond = d >= diamond - ring && d <= diamond;
        if (onDiamond) col = MARK;
        else if (onBorder) col = BORDER;
      }
      buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = a;
    }
  }
  return buf;
}

function pngFrom(rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  // one filter byte (0) per scanline
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (1 + SIZE * 4)] = 0;
    rgba.copy(raw, y * (1 + SIZE * 4) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function icoFrom(png) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0; entry[1] = 0;      // 256x256 (0 means 256)
  entry[2] = 0; entry[3] = 0;      // palette, reserved
  entry.writeUInt16LE(1, 4);       // planes
  entry.writeUInt16LE(32, 6);      // bpp
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);     // offset (6 + 16)
  return Buffer.concat([dir, entry, png]);
}

const png = pngFrom(pixels());
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
fs.writeFileSync(path.join(__dirname, 'icon.ico'), icoFrom(png));
console.log('placeholder icon written: assets/icon.ico (+ icon.png), 256x256');
