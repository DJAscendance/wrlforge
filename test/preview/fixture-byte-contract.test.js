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
const crypto = require('crypto');

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

// The gzip-encoding twins are the oracle for the Mall upload-size gate: they
// prove that identical VRML text can be a legal gzip `.wrl` on either side of
// the 81,290 B limit. Their VALUE is their exact byte count, so drift is not a
// cosmetic problem -- a regenerated or EOL-rewritten fixture would silently stop
// straddling the limit and the size test would pass while proving nothing.
const GZIP_TWINS = [
  { rel: 'gzip-encodings/twin.plain.wrl', bytes: 81753, gzip: false,
    sha256: '309ccdcb09dfa1ad10a5da6b0076de3200f247d1c978d59c1c2b3789a5ecd120' },
  { rel: 'gzip-encodings/twin-small.wrl.gz', bytes: 451, gzip: true,
    sha256: 'aa23dbbc3516a26e0082b095fbe09eaa6c17145dacc482e533b83f73d659f389' },
  { rel: 'gzip-encodings/twin-large.wrl.gz', bytes: 81781, gzip: true,
    sha256: '960c2a616a982fcfe682203c78fbb82aaf12f434dc3c49cf184601e220692771' },
];

test('gzip-encoding twin fixtures are byte-identical on every platform', () => {
  for (const fx of GZIP_TWINS) {
    const buf = fs.readFileSync(path.join(FX, fx.rel));
    assert.equal(buf.length, fx.bytes, `${fx.rel} byte count drifted`);
    assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), fx.sha256,
      `${fx.rel} content drifted -- these bytes are the oracle, not a derived artifact`);
    assert.equal(isGzip(buf), fx.gzip, `${fx.rel} gzip-ness changed`);
  }
});

test('gzip-encoding twins still straddle the Mall upload limit', () => {
  const { MALL_UPLOAD_MAX_BYTES } = require('../../validator');
  const [, small, large] = GZIP_TWINS;
  assert.ok(small.bytes <= MALL_UPLOAD_MAX_BYTES, 'the small twin must fit the limit');
  assert.ok(large.bytes > MALL_UPLOAD_MAX_BYTES, 'the large twin must exceed the limit');
});

test('the plain gzip-encoding twin is LF-only (no autocrlf rewrite)', () => {
  const buf = fs.readFileSync(path.join(FX, 'gzip-encodings/twin.plain.wrl'));
  assert.equal(hasCR(buf), false,
    'a CR byte means autocrlf converted it and the gzip twins no longer decompress to it');
});
