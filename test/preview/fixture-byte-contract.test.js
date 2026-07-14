'use strict';
// Phase 7C5 regression guard: test fixtures are byte-exact oracles and MUST be
// identical on every platform. Git for Windows defaults to core.autocrlf=true,
// which rewrote plain-text .wrl fixtures to CRLF on checkout and broke the
// "gzipped .wrl decompresses to text identical to its plain twin" comparison
// (test/preview/wrl-source.test.js). The fix is a root .gitattributes marking
// the fixture tree as -text; this test locks the contract in place so a dropped
// attribute or an accidentally line-ending-converted fixture fails loudly.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const FX = path.join(REPO, 'test', 'fixtures');
const isGzip = (buf) => buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
const hasCR = (buf) => buf.includes(0x0d);

test('plain-text .wrl twins are committed LF-only (no CRLF corruption on checkout)', () => {
  // These are compared byte-for-byte against decompressed gzip twins, which are
  // always LF; a CRLF checkout of the plain side silently breaks that equality.
  for (const rel of ['preview/gz-plain-twin.wrl', 'vrml/plain-twin.wrl']) {
    const p = path.join(FX, rel);
    if (!fs.existsSync(p)) continue;
    const buf = fs.readFileSync(p);
    assert.equal(isGzip(buf), false, `${rel} should be plain text`);
    assert.equal(hasCR(buf), false, `${rel} must be LF-only; a CR byte means autocrlf converted it`);
  }
});

test('deliberate CRLF fixtures still contain CRLF (not normalized away)', () => {
  // The inverse guard: an over-broad eol=lf rule would strip these and defeat
  // their purpose (exercising the parser/tokenizer on CRLF input).
  for (const rel of ['vrml/crlf.wrl', 'vrml/multiline-script-crlf.wrl']) {
    const buf = fs.readFileSync(path.join(FX, rel));
    assert.equal(hasCR(buf), true, `${rel} must keep its CRLF line endings`);
  }
});

test('root .gitattributes marks the fixture trees as byte-exact (-text)', () => {
  const ga = fs.readFileSync(path.join(REPO, '.gitattributes'), 'utf8');
  assert.match(ga, /test\/fixtures\/\*\*\s+-text/, 'test/fixtures/** must be -text');
  assert.match(ga, /spikes\/xite-mall-fit\/fixtures\/\*\*\s+-text/, 'spikes fixtures must be -text');
});
