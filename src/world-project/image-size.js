'use strict';
// Dependency-free image-dimension probing from a file's header bytes only.
// "Texture dimensions where safely available" (Phase 4A): we read just enough
// leading bytes to parse the intrinsic size out of the container header -- no
// decoding, no third-party image library, and a hard cap on how much we read.
// Unknown/corrupt/unsupported -> null (never throws for a caller feeding a
// truncated buffer).
//
// Pure: takes a Buffer, returns { width, height } or null. The fs read (and its
// byte cap) lives in the caller (project-loader), keeping this unit-testable.

// PNG: 8-byte signature, then IHDR whose width/height are big-endian u32 at 16/20.
function png(buf) {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null; // \x89PNG
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// GIF: "GIF87a"/"GIF89a", then logical screen width/height as little-endian u16.
function gif(buf) {
  if (buf.length < 10) return null;
  const sig = buf.toString('ascii', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

// BMP: "BM", then BITMAPINFOHEADER width/height as little-endian i32 at 18/22.
function bmp(buf) {
  if (buf.length < 26) return null;
  if (buf.toString('ascii', 0, 2) !== 'BM') return null;
  return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
}

// JPEG: scan segment markers for a Start-Of-Frame (SOF0..SOFf, excluding the
// non-SOF C4/C8/CC), which carries height/width as big-endian u16.
function jpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) { off += 1; continue; }
    let marker = buf[off + 1];
    // Skip fill bytes (0xff padding).
    while (marker === 0xff && off + 1 < buf.length) { off += 1; marker = buf[off + 1]; }
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      if (off + 9 >= buf.length) return null;
      return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
    }
    // Standalone markers (no length): RSTn, SOI, EOI, TEM.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      off += 2;
      continue;
    }
    const len = buf.readUInt16BE(off + 2);
    if (len < 2) return null;
    off += 2 + len;
  }
  return null;
}

function imageSize(buf) {
  if (!buf || buf.length < 8) return null;
  return png(buf) || gif(buf) || bmp(buf) || jpeg(buf) || null;
}

module.exports = { imageSize };
