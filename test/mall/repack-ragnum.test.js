'use strict';
// OPTIONAL real-artifact proof for Lane B B2 Mall Repack preservation.
//
// "Ragnum Red" is the shipping Cybertown item that motivated the whole lane: a
// 72,820 B gzip artifact holding 335,924 B of VRML, packed by a stronger
// encoder than Node's zlib. The OLD repack re-encoded it on every save and
// produced a file well over the 81,920 B upload limit -- WRLForge destroyed a
// legal artifact and then reported the item as too big.
//
// The real item is NEVER written. It is copied into a scratch directory and the
// copy is what Repack acts on, so this test cannot damage the source material.
//
// The Node-zlib candidate size is NOT asserted: it depends on the zlib build
// Node was linked against (Linux 87,187 B; macOS arm64 87,366 B). It is measured
// and printed as evidence only. The portable facts are the ones asserted --
// preservation, byte identity, no backup, and a measured PASS.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const { repackMall } = require('../../src/mall/repack');
const { MALL_UPLOAD_MAX_BYTES } = require('../../validator');

// Same resolution strategy as test/mall-size-ragnum.test.js -- no absolute home
// path is baked in, and an override env var matches the established pattern.
const ITEM_REL = path.join('item-categories', 'vehicles', 'ragnum-red', 'ragnum-red.wrl');
function findRagnum() {
  const named = process.env.WRL_FORGE_MALL_ITEMS;
  const roots = named
    ? [named]
    : [path.resolve(__dirname, '..', '..', '..', 'new-items'),
       path.resolve(__dirname, '..', '..', '..', '..', '..', 'new-items')];
  for (const root of roots) {
    const p = path.join(root, ITEM_REL);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
const RAGNUM = findRagnum();
const skip = RAGNUM ? false : 'external Ragnum Red artifact not present (optional integration proof)';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

test('Ragnum Red: an unchanged Repack preserves the 72,820 B artifact byte-for-byte', { skip }, () => {
  const original = fs.readFileSync(RAGNUM);
  const originalSha = sha(original);
  const text = zlib.gunzipSync(original).toString('utf8');

  // Work on a COPY. The real item is read-only to this suite.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-ragnum-'));
  const scratch = path.join(dir, 'ragnum-red.wrl');
  fs.copyFileSync(RAGNUM, scratch);
  const beforeMtime = fs.statSync(scratch).mtimeMs;

  // Evidence only, never asserted: what this runtime's encoder WOULD have
  // produced, and therefore what the old repack would have written.
  const nodeCandidate = zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 }).length;

  const res = repackMall({ mallPath: scratch, text, asGzip: true });

  assert.equal(res.saved, true);
  assert.equal(res.preserved, true, 'the shipping artifact was preserved, not re-encoded');
  assert.equal(res.writtenBytes, 0, 'no bytes were written');
  assert.equal(res.backup, null, 'no write means no backup');
  assert.equal(res.errorCode, null);

  const after = fs.readFileSync(scratch);
  assert.equal(sha(after), originalSha, 'the artifact SHA is unchanged');
  assert.equal(after.length, 72820, 'still the original 72,820 B artifact');
  assert.equal(fs.statSync(scratch).mtimeMs, beforeMtime, 'mtime unchanged');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f !== 'ragnum-red.wrl'), [],
    'no backup and no temp were created alongside it');

  // Lane A's verdict, measured from the preserved artifact.
  assert.equal(res.artifactBytes, 72820);
  assert.equal(res.sizeAuthority, 'measured');
  assert.equal(res.sizeStatus, 'pass');

  // The regression this lane exists to prevent: the candidate the old code
  // would have written is over the limit, while the preserved artifact is not.
  assert.ok(nodeCandidate > MALL_UPLOAD_MAX_BYTES,
    `a Node-zlib re-encode (${nodeCandidate} B) exceeds the ${MALL_UPLOAD_MAX_BYTES} B limit`);
  assert.ok(72820 < MALL_UPLOAD_MAX_BYTES, 'the real artifact is comfortably inside it');

  // The real source file was never touched.
  assert.equal(sha(fs.readFileSync(RAGNUM)), originalSha, 'the real item is untouched');

  fs.rmSync(dir, { recursive: true, force: true });
});
