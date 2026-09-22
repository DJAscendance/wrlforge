'use strict';
// OPTIONAL real-world proof for the Mall size contract.
//
// "Ragnum Red" is the shipping Cybertown item that exposed the bug: a 72,820 B
// gzip artifact holding 335,924 B of VRML. A Node zlib level-9 re-encode of that
// text lands well above the 81,920 B (80 KiB) limit, so the old predicted-size
// gate FAILED an item that is comfortably inside it with 9,100 B to spare.
//
// The exact predicted byte count is NOT a portable fact: it depends on the
// zlib build Node was linked against. The historical Linux baseline produced
// 87,187 B; macOS arm64 / Node 26 against a shared system zlib produces 87,366 B.
// Both are far above the limit, which is the only thing the regression needs.
// So this test asserts the verdict inversion and the validator's agreement with
// the current runtime's predictor -- never a hard-coded compressed size.
//
// The file lives OUTSIDE this repository and is read strictly read-only. CI must
// never depend on it, so every assertion is skipped when it is absent -- and the
// deterministic committed fixtures in test/fixtures/gzip-encodings/ carry the
// same proof without it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validate, predictedRepackSize, MALL_UPLOAD_MAX_BYTES } = require('../validator');
const { measureArtifact } = require('../src/mall/artifact-size');

// Resolve the sibling item repository without baking in an absolute home path.
// `../new-items` covers a normal checkout; `../../../new-items` covers a Git
// worktree under `.worktrees/<repo>/<lane>/`. `WRL_FORGE_MALL_ITEMS` overrides
// both, mirroring the WRL_FORGE_ISO_MIRROR pattern used by the schema tests.
const ITEM_REL = path.join('item-categories', 'vehicles', 'ragnum-red', 'ragnum-red.wrl');
function findRagnum() {
  const named = process.env.WRL_FORGE_MALL_ITEMS;
  const roots = named
    ? [named]
    : [path.resolve(__dirname, '..', '..', 'new-items'),
       path.resolve(__dirname, '..', '..', '..', '..', 'new-items')];
  for (const root of roots) {
    const p = path.join(root, ITEM_REL);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
const RAGNUM = findRagnum();
const skip = RAGNUM ? false : 'external Ragnum Red artifact not present (optional integration proof)';

test('Ragnum Red: the measured 72,820 B artifact PASSES where the prediction failed', { skip }, () => {
  const raw = fs.readFileSync(RAGNUM);
  const text = require('node:zlib').gunzipSync(raw).toString('utf8');

  const ctx = measureArtifact(RAGNUM, text);
  const r = validate(text, ctx);

  assert.equal(r.artifactBytes, 72820, 'measured bytes of the real shipping artifact');
  assert.equal(r.artifactBytes, raw.length);
  assert.equal(r.textBytes, 335924);
  assert.ok(Number.isInteger(r.predictedRepackBytes), 'the zlib level-9 prediction is reported');
  assert.equal(r.artifactMatchesText, true);
  assert.equal(r.sizeAuthority, 'measured');
  assert.equal(r.sizeStatus, 'pass');
  assert.equal(r.mallUploadMaxBytes, 81920);

  // The exact inversion the lane exists to fix.
  assert.ok(r.predictedRepackBytes > MALL_UPLOAD_MAX_BYTES, 'the prediction alone would FAIL');
  assert.ok(r.artifactBytes <= MALL_UPLOAD_MAX_BYTES, 'the real artifact PASSES');
  assert.equal(MALL_UPLOAD_MAX_BYTES - r.artifactBytes, 9100, 'headroom under the 80 KiB ceiling');

  // The validator reports exactly what this runtime's predictor computes --
  // a build-independent identity, unlike the byte count itself.
  assert.equal(r.predictedRepackBytes, predictedRepackSize(text));
});

test('Ragnum Red: editing the buffer makes the shipping artifact stale, not oversized', { skip }, () => {
  const text = require('node:zlib').gunzipSync(fs.readFileSync(RAGNUM)).toString('utf8');
  const edited = `${text}\n# unsaved edit\n`;
  const r = validate(edited, measureArtifact(RAGNUM, edited));

  assert.equal(r.artifactMatchesText, false);
  assert.equal(r.sizeStatus, 'stale');
  assert.equal(r.sizeAuthority, 'none');
  assert.equal(r.mallReady, false);
});
