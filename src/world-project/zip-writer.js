'use strict';
// Deterministic, dependency-free ZIP writer (Phase 5A).
//
// Node ships no ZIP *writer*, only gzip/deflate via the built-in `zlib`. Rather
// than add a third-party archive dependency (most of which stamp the current
// wall-clock mtime into every entry and are therefore NON-deterministic), this
// module builds a minimal, standard PKZIP (APPNOTE) archive using only `zlib`:
//
//   * entries are written in the exact order given (the caller sorts them),
//   * every entry's DOS timestamp is a FIXED constant (1980-01-01), so the same
//     input bytes always produce the same archive bytes -- reproducible output,
//   * deflate is done with a pinned level, filenames are UTF-8 (general-purpose
//     bit 11 set), and no OS/extra metadata is embedded.
//
// Result: `buildZip(sameEntries)` is byte-identical every time (a unit test
// asserts it), satisfying the roadmap's "deterministic package output" rule
// without introducing a dependency. Pure: it takes/returns Buffers, no fs.
//
// This is a WRITER only -- it never reads or mutates anything on disk.

const zlib = require('zlib');

const DEFLATE_LEVEL = 9;
// Fixed DOS date/time = 1980-01-01 00:00:00 (the ZIP epoch). Keeping it constant
// is what makes the archive reproducible instead of embedding "now".
const DOS_DATE = 0x0021; // year 1980 (<<9=0) | month 1 (<<5=0x20) | day 1 (0x01)
const DOS_TIME = 0x0000;
// General-purpose bit 11 => filename/comment are UTF-8.
const FLAG_UTF8 = 0x0800;
const METHOD_DEFLATE = 8;
const METHOD_STORE = 0;
const VERSION = 20; // 2.0

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

// entries: [{ name: string (forward-slash path), data: Buffer }]
// Returns a Buffer containing the whole .zip. Deterministic for identical input.
function buildZip(entries) {
  const parts = [];      // local header + data blocks, in order
  const central = [];    // central directory records
  let offset = 0;        // running offset of the next local header

  for (const entry of entries) {
    const nameBuf = Buffer.from(String(entry.name), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '');
    const crc = crc32(data);

    // Compress; fall back to STORE if deflate would not shrink it (also keeps
    // empty files valid). Deterministic either way.
    let method = METHOD_DEFLATE;
    let comp = zlib.deflateRawSync(data, { level: DEFLATE_LEVEL });
    if (comp.length >= data.length) {
      method = METHOD_STORE;
      comp = data;
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    parts.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(SIG_CENTRAL, 0);
    cd.writeUInt16LE(VERSION, 4);   // version made by
    cd.writeUInt16LE(VERSION, 6);   // version needed
    cd.writeUInt16LE(FLAG_UTF8, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra len
    cd.writeUInt16LE(0, 32); // comment len
    cd.writeUInt16LE(0, 34); // disk number start
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42); // local header offset
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + comp.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);  // disk number
  eocd.writeUInt16LE(0, 6);  // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...parts, centralBuf, eocd]);
}

// Minimal reader (used by tests to verify bundle contents/hashes match the
// manifest). Returns [{ name, data:Buffer }]. Reads the central directory so it
// is robust to the store/deflate choice. Never touches disk.
function readZip(buf) {
  const out = [];
  // Find EOCD (scan back from the end; no zip comment in our writer).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip (no EOCD)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // Local header at localOff: name+extra then data.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    const data = method === METHOD_STORE ? Buffer.from(raw) : zlib.inflateRawSync(raw);
    out.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

module.exports = { buildZip, readZip, crc32 };
