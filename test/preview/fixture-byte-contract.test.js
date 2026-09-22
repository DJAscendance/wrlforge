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

// The gzip-encoding twins are the oracle for the Mall upload-size gate. Their
// VALUE is their exact byte count, so drift is not a cosmetic problem -- a
// regenerated or EOL-rewritten fixture would silently stop proving what it was
// committed to prove and the size test would pass while proving nothing.
//
// Two pairs, two different proofs:
//   * `twin*`       -- ENCODING VARIANCE: identical text, 451 B vs 81,781 B.
//                      Both are UNDER the 81,920 B (80 KiB) Mall limit.
//   * `limit-twin*` -- LIMIT STRADDLE: identical text, one artifact under the
//                      limit and one comfortably over it.
const GZIP_TWINS = [
  { rel: 'gzip-encodings/twin.plain.wrl', bytes: 81753, gzip: false,
    sha256: '309ccdcb09dfa1ad10a5da6b0076de3200f247d1c978d59c1c2b3789a5ecd120' },
  { rel: 'gzip-encodings/twin-small.wrl.gz', bytes: 451, gzip: true,
    sha256: 'aa23dbbc3516a26e0082b095fbe09eaa6c17145dacc482e533b83f73d659f389' },
  { rel: 'gzip-encodings/twin-large.wrl.gz', bytes: 81781, gzip: true,
    sha256: '960c2a616a982fcfe682203c78fbb82aaf12f434dc3c49cf184601e220692771' },
  { rel: 'gzip-encodings/limit-twin.plain.wrl', bytes: 120030, gzip: false,
    sha256: '29d4f9a8917f8a9d40166c4cbdcd5bd7f1ee740c138ab94c72998347532166b3' },
  { rel: 'gzip-encodings/limit-twin-small.wrl.gz', bytes: 589, gzip: true,
    sha256: 'e0a2a69d660ab4724664dce4175d1478ae2e65fecaddabf8a9048ab1e28e839b' },
  { rel: 'gzip-encodings/limit-twin-large.wrl.gz', bytes: 120063, gzip: true,
    sha256: '3788452222e515ca6690800a72b3809e5051afe2ccb92f5f70fc6a4913e64c0e' },
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

test('the encoding-variance twins are both UNDER the Mall upload limit', () => {
  const { MALL_UPLOAD_MAX_BYTES } = require('../../validator');
  const [, small, large] = GZIP_TWINS;
  assert.equal(MALL_UPLOAD_MAX_BYTES, 80 * 1024);
  assert.ok(small.bytes <= MALL_UPLOAD_MAX_BYTES, 'the small twin fits the limit');
  assert.ok(large.bytes <= MALL_UPLOAD_MAX_BYTES,
    '81,781 B is under 81,920 B -- this pair proves encoding variance, not a straddle');
  assert.notEqual(small.bytes, large.bytes, 'identical text, different legal gzip sizes');
});

test('the limit-straddle twins sit on opposite sides of the 81,920 B ceiling', () => {
  const { MALL_UPLOAD_MAX_BYTES } = require('../../validator');
  const [, , , , small, large] = GZIP_TWINS;
  assert.equal(MALL_UPLOAD_MAX_BYTES, 81920);
  assert.ok(small.bytes <= MALL_UPLOAD_MAX_BYTES, 'the small straddle twin must fit the limit');
  assert.ok(large.bytes > MALL_UPLOAD_MAX_BYTES, 'the large straddle twin must exceed the limit');
  assert.ok(large.bytes - MALL_UPLOAD_MAX_BYTES > 1024,
    'the margin is comfortable, not a fragile one-byte difference');
});

test('both straddle archives decompress to the identical committed plain text', () => {
  const zlib = require('zlib');
  const plain = fs.readFileSync(path.join(FX, 'gzip-encodings/limit-twin.plain.wrl'));
  for (const rel of ['gzip-encodings/limit-twin-small.wrl.gz', 'gzip-encodings/limit-twin-large.wrl.gz']) {
    const gz = fs.readFileSync(path.join(FX, rel));
    assert.equal(Buffer.compare(zlib.gunzipSync(gz), plain), 0,
      `${rel} must decompress byte-for-byte to limit-twin.plain.wrl`);
  }
});

test('the plain gzip-encoding twins are LF-only (no autocrlf rewrite)', () => {
  for (const rel of ['gzip-encodings/twin.plain.wrl', 'gzip-encodings/limit-twin.plain.wrl']) {
    const buf = fs.readFileSync(path.join(FX, rel));
    assert.equal(hasCR(buf), false,
      `a CR byte in ${rel} means autocrlf converted it and the gzip twins no longer decompress to it`);
  }
});
