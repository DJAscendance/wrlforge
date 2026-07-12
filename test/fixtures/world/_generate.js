'use strict';
// Deterministic generator for the larger / trickier World Project preview
// fixtures (Phase 4B). Run with `node test/fixtures/world/_generate.js` to
// (re)create them. Kept in-tree so the fixtures are reproducible rather than
// mystery blobs. It writes only under test/fixtures/world/ and is never part of
// the app or the default test run.
//
// Produces:
//   valid70/  -- a single primary world referencing 71 UNIQUE local textures
//               (proves ">20" and "at least 70" textures with no truncation)
//   cycle/    -- a.wrl Inlines b.wrl which Inlines a.wrl (bounded dependency
//               cycle) each with its own texture
//   nested/   -- primary -> parts/panel.wrl -> parts/deep/more.wrl, textures
//               resolved from each file's OWN directory, including a filename
//               that contains a space and a texture referenced by two files
//               (repeated dependency)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;

// --- minimal valid PNG encoder (1x1, colour varies so every file is unique) ---
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function png1x1(r, g, b) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);   // width
  ihdr.writeUInt32BE(1, 4);   // height
  ihdr[8] = 8;                // bit depth
  ihdr[9] = 2;                // colour type: RGB
  const raw = Buffer.from([0x00, r, g, b]); // one scanline: filter byte + RGB
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function write(rel, buf) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}
function writeText(rel, text) { write(rel, Buffer.from(text, 'utf8')); }
function writeGzip(rel, text) { write(rel, zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 })); }

// --- valid70: 71 unique textures off a single primary --------------------------
(function valid70() {
  const N = 71;
  let body = '#VRML V2.0 utf8\nWorldInfo { title "Seventy Texture World" }\nViewpoint { description "Overview" position 0 0 40 }\n';
  for (let i = 0; i < N; i++) {
    const name = `img/t${String(i).padStart(3, '0')}.png`;
    write(`valid70/${name}`, png1x1(i & 0xff, (i * 3) & 0xff, (i * 7) & 0xff));
    body += `Shape { appearance Appearance { texture ImageTexture { url "${name}" } } geometry Box {} }\n`;
  }
  writeText('valid70/world.wrl', body);
})();

// --- cycle: a <-> b -----------------------------------------------------------
(function cycle() {
  write('cycle/img/a.png', png1x1(200, 10, 10));
  write('cycle/img/b.png', png1x1(10, 200, 10));
  writeText('cycle/a.wrl',
    '#VRML V2.0 utf8\nWorldInfo { title "Cycle A" }\nViewpoint { description "A" position 0 0 10 }\n' +
    'Shape { appearance Appearance { texture ImageTexture { url "img/a.png" } } geometry Box {} }\n' +
    'Inline { url "b.wrl" }\n');
  writeText('cycle/b.wrl',
    '#VRML V2.0 utf8\n' +
    'Shape { appearance Appearance { texture ImageTexture { url "img/b.png" } } geometry Sphere {} }\n' +
    'Inline { url "a.wrl" }\n');
})();

// --- nested: depth 2, per-directory bases, a space in a filename, a repeat -----
(function nested() {
  write('nested/img/floor.png', png1x1(120, 120, 120));         // referenced by primary AND deep child (repeat)
  write('nested/parts/tex/wall art.png', png1x1(30, 60, 200));  // space in filename, resolved from parts/
  write('nested/parts/deep/tex/lamp.png', png1x1(240, 220, 40));// resolved from parts/deep/
  writeText('nested/world.wrl',
    '#VRML V2.0 utf8\nWorldInfo { title "Nested World" }\n' +
    'Viewpoint { description "Front" position 0 0 12 }\n' +
    'Viewpoint { description "Top" position 0 12 0 orientation 1 0 0 -1.5708 }\n' +
    'Shape { appearance Appearance { texture ImageTexture { url "img/floor.png" } } geometry Box {} }\n' +
    'Inline { url "parts/panel.wrl" }\n');
  // panel.wrl lives in parts/, so "tex/wall art.png" is parts/tex/wall art.png.
  writeText('nested/parts/panel.wrl',
    '#VRML V2.0 utf8\n' +
    'Viewpoint { description "Panel" position 0 0 4 }\n' +
    'Shape { appearance Appearance { texture ImageTexture { url "tex/wall art.png" } } geometry Box {} }\n' +
    'Inline { url "deep/more.wrl" }\n');
  // more.wrl lives in parts/deep/, so "tex/lamp.png" is parts/deep/tex/lamp.png,
  // and it re-references the root floor via "../../img/floor.png" (a repeat).
  writeGzip('nested/parts/deep/more.wrl',
    '#VRML V2.0 utf8\n' +
    'Shape { appearance Appearance { texture ImageTexture { url "tex/lamp.png" } } geometry Cone {} }\n' +
    'Shape { appearance Appearance { texture ImageTexture { url "../../img/floor.png" } } geometry Sphere {} }\n');
})();

// --- unused: a clean world plus stray files that are NOT referenced -------------
// Proves the packaging audit REPORTS unused files under the project root without
// auto-including them: world.wrl references img/used.png and props.wrl (which
// references img/used.png again -- a repeat), while img/orphan.png, notes.txt, and
// old/backup.wrl sit on disk unreferenced.
(function unused() {
  write('unused/img/used.png', png1x1(60, 160, 90));
  write('unused/img/orphan.png', png1x1(200, 40, 40));   // present on disk, referenced by nothing
  writeText('unused/notes.txt', 'author scratch notes -- not part of the world\n');
  writeText('unused/old/backup.wrl',
    '#VRML V2.0 utf8\nWorldInfo { title "old backup" }\n' +
    'Shape { appearance Appearance { texture ImageTexture { url "../img/orphan.png" } } geometry Box {} }\n');
  writeText('unused/props.wrl',
    '#VRML V2.0 utf8\n' +
    'Shape { appearance Appearance { texture ImageTexture { url "img/used.png" } } geometry Cone {} }\n');
  writeText('unused/world.wrl',
    '#VRML V2.0 utf8\nWorldInfo { title "Unused-file World" }\n' +
    'Viewpoint { description "Entry" position 0 1 8 }\n' +
    'Shape { appearance Appearance { texture ImageTexture { url "img/used.png" } } geometry Box {} }\n' +
    'Inline { url "props.wrl" }\n');
})();

// --- small: a minimal single-file world (a couple of textures, one viewpoint) --
(function small() {
  write('small/img/floor.png', png1x1(90, 90, 110));
  write('small/img/wall.png', png1x1(150, 120, 90));
  writeText('small/world.wrl',
    '#VRML V2.0 utf8\nWorldInfo { title "Small World" }\n' +
    'Viewpoint { description "Entry" position 0 1 8 }\n' +
    'Shape { appearance Appearance { texture ImageTexture { url "img/floor.png" } } geometry Box { size 6 0.2 6 } }\n' +
    'Shape { appearance Appearance { texture ImageTexture { url "img/wall.png" } } geometry Box { size 6 3 0.2 } }\n');
})();

console.log('World Project preview fixtures generated under', ROOT);
