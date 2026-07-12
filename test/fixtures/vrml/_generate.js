'use strict';
// Deterministic generator for the VRML97 parser fixtures that must NOT be stored
// as ordinary editor-normalized text: a gzip-compressed .wrl (proves the parser
// runs on gzip source once the loader decompresses it) and a CRLF-line-ending
// file (proves LF/CRLF span handling). Run with:
//   node test/fixtures/vrml/_generate.js
// Kept in-tree so the binary/CRLF fixtures are reproducible, not mystery blobs.
// A `.gitattributes` (`* -text`) in this dir keeps git from rewriting line
// endings under us.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = __dirname;

// A small valid world with DEF/USE, a texture ref, and a comment.
const LF_SOURCE = [
  '#VRML V2.0 utf8',
  'WorldInfo { title "CRLF And Gzip" }',
  'Viewpoint { position 0 1 8 }',
  'DEF Panel Shape {',
  '  appearance Appearance { texture ImageTexture { url "panel.png" } }',
  '  geometry Box { size 2 2 0.1 }',
  '}',
  'Transform { translation 3 0 0 children [ USE Panel ] }',
  '',
].join('\n');

// gzip fixture (loader decompresses before the parser sees it).
fs.writeFileSync(path.join(DIR, 'valid-gzip.wrl'), zlib.gzipSync(Buffer.from(LF_SOURCE, 'utf8')));

// CRLF fixture (every newline is \r\n).
fs.writeFileSync(path.join(DIR, 'crlf.wrl'), Buffer.from(LF_SOURCE.replace(/\n/g, '\r\n'), 'utf8'));

// Plain (LF) twin of the same content, for a direct plain-vs-gzip equality test.
fs.writeFileSync(path.join(DIR, 'plain-twin.wrl'), Buffer.from(LF_SOURCE, 'utf8'));

// CRLF twin of the multiline-script fixture (Phase 7A1): proves a quoted string
// that spans CRLF line breaks -- inline Script source -- parses, and that content
// after it is unaffected. The LF original is committed as multiline-script.wrl.
const MULTILINE_LF = fs.readFileSync(path.join(DIR, 'multiline-script.wrl'), 'utf8');
fs.writeFileSync(path.join(DIR, 'multiline-script-crlf.wrl'),
  Buffer.from(MULTILINE_LF.replace(/\n/g, '\r\n'), 'utf8'));

// eslint-disable-next-line no-console
console.log('Generated valid-gzip.wrl, crlf.wrl, plain-twin.wrl, multiline-script-crlf.wrl');
