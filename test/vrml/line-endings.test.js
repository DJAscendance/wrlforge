'use strict';
// Windows-checkout regression guard. Git for Windows' core.autocrlf=true
// rewrites plain-text source to CRLF on checkout unless an eol=lf attribute
// pins it. src/vrml/** carries no such attribute prior to this test's
// companion .gitattributes fix, which let a CRLF checkout: (a) break the
// generated node-schema.js LF-only invariant, and (b) make two
// node-identity.test.js source-inspection tests misread `//` comments --
// their per-line strip regex anchors on `$`/`.`, neither of which matches a
// trailing `\r`, so the "comment" text (and any banned word inside it)
// survived stripping. This test proves the checked-out bytes of every
// tracked src/vrml/ file are LF-only, independent of any one file's own
// content-specific test.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const VRML_DIR = path.resolve(__dirname, '..', '..', 'src', 'vrml');

test('every tracked src/vrml/ source file checks out LF-only, no CR bytes', () => {
  const files = fs.readdirSync(VRML_DIR).filter((name) => name.endsWith('.js'));
  assert.ok(files.length > 0, 'expected to find .js files under src/vrml/');
  for (const name of files) {
    const raw = fs.readFileSync(path.join(VRML_DIR, name));
    assert.equal(raw.includes(0x0d), false,
      `${name} contains a CR byte -- a CRLF checkout would break comment-stripping ` +
      'and LF-only assertions that read this file\'s exact on-disk bytes');
  }
});
