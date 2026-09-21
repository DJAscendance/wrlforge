'use strict';
// Generic Cybertown Revival Mall / VRML97 rule checks.
//
// Pure function: text (+ already-measured artifact facts) in, structured results
// out. No filesystem access here -- the main process owns file truth and hands
// this module a `sizeContext` of facts it has already proven (see
// src/mall/artifact-size.js and docs/MALL_SIZE_CONTRACT.md).
//
// SIZE TRUTH (Lane A). The Mall gate applies to the ACTUAL `.wrl` that will be
// uploaded, not to whatever WRLForge would produce if it recompressed the text
// itself. Those are different numbers: a Zopfli-encoded shipping artifact can be
// far smaller than a Node zlib level-9 re-encode of the same text. This module
// therefore reports three separate facts and never conflates them:
//
//   textBytes            UTF-8 length of the text being validated
//   artifactBytes        measured bytes of the real gzip upload artifact (or null)
//   predictedRepackBytes what a WRLForge zlib level-9 repack WOULD write (advisory)
//
// A hard size PASS/FAIL is produced ONLY from a measured artifact that is proven
// to match the text being validated. Everything else is reported as `stale` or
// `unknown` rather than guessed.
const zlib = require('zlib');

const FORBIDDEN_NODES = [
  'Inline', 'EXTERNPROTO', 'Sound', 'DirectionalLight',
  'HAnimHumanoid', 'HAnimJoint', 'HAnimSegment', 'HAnimSite',
];

// The Cybertown Mall `.wrl` upload limit, in bytes, confirmed by the owner.
// This is an exact byte count -- NOT 80 * 1024, NOT 80000, and not a rounded
// "80 KB" display value. It is the only limit the Mall upload-size gate uses.
const MALL_UPLOAD_MAX_BYTES = 81290;
const MAX_TEXTURE_BYTES = 80 * 1024;

// Size states. `sizeStatus` answers "what do we actually know about the bytes
// that would be uploaded?" and is deliberately NOT a boolean.
const SIZE_STATUS = Object.freeze({
  PASS: 'pass',        // measured artifact matches the text and fits the limit
  FAIL: 'fail',        // measured artifact matches the text and exceeds the limit
  STALE: 'stale',      // an artifact exists but does not match the current text
  UNKNOWN: 'unknown',  // no gzip upload artifact, or its identity is unproven
});

// Where the authoritative number came from. 'measured' means a real file on disk
// was weighed; 'none' means nothing authoritative is available and no hard size
// verdict may be reported.
const SIZE_AUTHORITY = Object.freeze({
  MEASURED: 'measured',
  NONE: 'none',
});

// Why the size is (or is not) authoritative -- drives the UI wording.
const SIZE_REASON = Object.freeze({
  MEASURED: 'measured',
  STALE_ARTIFACT: 'stale-artifact',
  NO_GZIP_ARTIFACT: 'no-gzip-artifact',
  UNVERIFIED_ARTIFACT: 'unverified-artifact',
});

// `status` is optional on a check row: only the size row carries one, because
// only the size row has states beyond pass/fail. Rows without it render from
// `pass` exactly as before.
function check(name, pass, detail, severity = 'hard', status = undefined) {
  const row = { name, pass, detail: detail || '', severity };
  if (status !== undefined) row.status = status;
  return row;
}

// What a WRLForge repack of this text WOULD write today (Node zlib, level 9).
// Advisory pre-flight information only: it is a prediction about a file that
// does not exist yet, never a measurement of one that does.
function predictedRepackSize(text) {
  return zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 }).length;
}

// Resolve the supplied artifact facts into the size half of the contract.
//
// sizeContext: { artifactBytes, artifactIsGzip, artifactMatchesText } -- every
// field optional; anything absent or unproven degrades to `unknown` rather than
// being inferred. Only a gzip artifact counts as a Mall upload artifact: a plain
// `.wrl` on disk is the editable source, and its byte count is already reported
// as `textBytes`.
function resolveSizeState(sizeContext) {
  const ctx = sizeContext || {};
  const isGzipArtifact = ctx.artifactIsGzip === true;
  const bytes = (isGzipArtifact && Number.isInteger(ctx.artifactBytes) && ctx.artifactBytes >= 0)
    ? ctx.artifactBytes
    : null;

  if (bytes === null) {
    return {
      artifactBytes: null,
      artifactIsGzip: ctx.artifactIsGzip === undefined ? null : ctx.artifactIsGzip,
      artifactMatchesText: null,
      sizeAuthority: SIZE_AUTHORITY.NONE,
      sizeStatus: SIZE_STATUS.UNKNOWN,
      sizeReason: SIZE_REASON.NO_GZIP_ARTIFACT,
    };
  }
  if (ctx.artifactMatchesText === false) {
    return {
      artifactBytes: bytes,
      artifactIsGzip: true,
      artifactMatchesText: false,
      sizeAuthority: SIZE_AUTHORITY.NONE,
      sizeStatus: SIZE_STATUS.STALE,
      sizeReason: SIZE_REASON.STALE_ARTIFACT,
    };
  }
  if (ctx.artifactMatchesText !== true) {
    // A gzip artifact exists but nobody proved it decompresses to this text.
    // Weighing it would be measuring a different document.
    return {
      artifactBytes: bytes,
      artifactIsGzip: true,
      artifactMatchesText: null,
      sizeAuthority: SIZE_AUTHORITY.NONE,
      sizeStatus: SIZE_STATUS.UNKNOWN,
      sizeReason: SIZE_REASON.UNVERIFIED_ARTIFACT,
    };
  }
  return {
    artifactBytes: bytes,
    artifactIsGzip: true,
    artifactMatchesText: true,
    sizeAuthority: SIZE_AUTHORITY.MEASURED,
    sizeStatus: bytes <= MALL_UPLOAD_MAX_BYTES ? SIZE_STATUS.PASS : SIZE_STATUS.FAIL,
    sizeReason: SIZE_REASON.MEASURED,
  };
}

function validate(text, sizeContext) {
  const results = [];
  const lines = text.split('\n');

  // 1. header
  const headerLine = (lines[0] || '').trim();
  results.push(check(
    "Header is '#VRML V2.0 utf8'",
    headerLine === '#VRML V2.0 utf8',
    headerLine
  ));

  // 2. WorldInfo present
  results.push(check('WorldInfo present', /\bWorldInfo\b/.test(text)));

  // 3. Mall upload size -- measured, never predicted.
  const size = resolveSizeState(sizeContext);
  const predictedRepackBytes = predictedRepackSize(text);
  const textBytes = Buffer.byteLength(text, 'utf8');
  results.push(check(
    `Upload size within ${MALL_UPLOAD_MAX_BYTES.toLocaleString('en-US')} B`,
    // `pass` stays meaningful only where a hard verdict exists. In the stale and
    // unknown states it is null so a caller reading `pass` alone can never
    // mistake "not verified" for "passed".
    size.sizeStatus === SIZE_STATUS.PASS ? true
      : size.sizeStatus === SIZE_STATUS.FAIL ? false
        : null,
    sizeDetail(size, predictedRepackBytes),
    // Only a proven measurement may fail the item. Unverified size is reported,
    // never used to hard-fail an edit the user has not packed yet.
    size.sizeAuthority === SIZE_AUTHORITY.MEASURED ? 'hard' : 'info',
    size.sizeStatus
  ));

  // 4. forbidden nodes
  const forbiddenHits = FORBIDDEN_NODES.filter(n => new RegExp('\\b' + n + '\\b').test(text));
  const wholeObjectBillboard = /^\s*Billboard\s*\{/m.test(text) && lines[0] !== undefined &&
    /\bBillboard\b/.test(text.slice(0, text.indexOf('{', text.indexOf('Billboard')) + 1));
  results.push(check(
    'No forbidden nodes (Inline/EXTERNPROTO/Sound/DirectionalLight/H-Anim)',
    forbiddenHits.length === 0,
    forbiddenHits.length ? `found: ${forbiddenHits.join(', ')}` : 'clean'
  ));
  results.push(check(
    'No whole-object Billboard',
    !wholeObjectBillboard,
    wholeObjectBillboard ? 'Billboard node found at top level' : 'clean',
    'soft'
  ));

  // 5. no external URLs
  const urlMatches = [...text.matchAll(/url\s*\[?\s*"([^"]*)"/g)].map(m => m[1]);
  const externalUrls = urlMatches.filter(u => /^https?:\/\//i.test(u) || u.includes('/') || u.includes('\\'));
  results.push(check(
    'No external URLs / nested paths in url fields',
    externalUrls.length === 0,
    externalUrls.length ? `found: ${externalUrls.join(', ')}` : 'clean'
  ));

  // 6. texture rules: at most one ImageTexture, local filename only
  const textureCount = (text.match(/\bImageTexture\s*\{/g) || []).length;
  results.push(check(
    'At most one texture (ImageTexture)',
    textureCount <= 1,
    `${textureCount} ImageTexture node(s)`
  ));
  const textureExt = /\.(jpg|jpeg|gif|png)$/i;
  results.push(check(
    'Texture format is jpg/jpeg/gif/png',
    textureCount === 0 || urlMatches.some(u => textureExt.test(u)),
    textureCount === 0 ? 'n/a (no texture)' : urlMatches.join(', '),
    'soft'
  ));

  // 7. DEF/USE integrity
  const defs = new Set([...text.matchAll(/\bDEF\s+(\w+)/g)].map(m => m[1]));
  const uses = [...text.matchAll(/\bUSE\s+(\w+)/g)].map(m => m[1]);
  const missing = [...new Set(uses.filter(u => !defs.has(u)))];
  results.push(check(
    'Every USE has a matching DEF',
    missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : `${defs.size} DEF, ${uses.length} USE`
  ));

  // 8. placement (advisory / best-effort, no transform propagation)
  const coordMatches = [...text.matchAll(/point\s*\[([^\]]*)\]/gs)];
  let minY = null, minX = null, maxX = null, maxZ = null;
  let minAll = [Infinity, Infinity, Infinity], maxAll = [-Infinity, -Infinity, -Infinity];
  for (const cm of coordMatches) {
    const nums = cm[1].trim().split(/\s*,\s*|\s+/).filter(Boolean).map(Number);
    for (let i = 0; i + 2 < nums.length; i += 3) {
      const [x, y, z] = [nums[i], nums[i + 1], nums[i + 2]];
      if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;
      minAll[0] = Math.min(minAll[0], x); maxAll[0] = Math.max(maxAll[0], x);
      minAll[1] = Math.min(minAll[1], y); maxAll[1] = Math.max(maxAll[1], y);
      minAll[2] = Math.min(minAll[2], z); maxAll[2] = Math.max(maxAll[2], z);
    }
  }
  const havePoints = coordMatches.length > 0 && isFinite(minAll[0]);
  if (havePoints) {
    const dims = [maxAll[0] - minAll[0], maxAll[1] - minAll[1], maxAll[2] - minAll[2]];
    results.push(check(
      'Placement/bbox (advisory, untransformed local coords only)',
      true,
      `local bbox X:[${minAll[0].toFixed(2)},${maxAll[0].toFixed(2)}] ` +
      `Y:[${minAll[1].toFixed(2)},${maxAll[1].toFixed(2)}] ` +
      `Z:[${minAll[2].toFixed(2)},${maxAll[2].toFixed(2)}] ` +
      `dims ${dims.map(d => d.toFixed(2)).join(' x ')} ` +
      `— NOTE: does not apply Transform translations/scales, verify visually`,
      'soft'
    ));
  } else {
    results.push(check('Placement/bbox', true, 'no Coordinate.point data found to check', 'soft'));
  }

  const hardFails = results.filter(r => r.severity === 'hard' && !r.pass);
  const ok = hardFails.length === 0;
  return {
    results,
    // `ok` keeps its established meaning: every HARD structural rule passed.
    // It deliberately does NOT imply the item is uploadable, because a
    // structurally perfect document with no packed artifact has no proven size.
    ok,
    // Mall readiness is the stricter question: structurally valid AND proven to
    // fit the upload limit. Never true while the size is stale or unknown.
    mallReady: ok && size.sizeStatus === SIZE_STATUS.PASS,
    textBytes,
    artifactBytes: size.artifactBytes,
    artifactIsGzip: size.artifactIsGzip,
    artifactMatchesText: size.artifactMatchesText,
    predictedRepackBytes,
    sizeAuthority: size.sizeAuthority,
    sizeStatus: size.sizeStatus,
    sizeReason: size.sizeReason,
    mallUploadMaxBytes: MALL_UPLOAD_MAX_BYTES,
  };
}

// Human-readable detail for the size row. Each state names the source of every
// number it prints, so a prediction can never be read as a measurement.
function sizeDetail(size, predictedRepackBytes) {
  const n = (v) => v.toLocaleString('en-US');
  const predicted = `predicted WRLForge repack ${n(predictedRepackBytes)} B`;
  switch (size.sizeReason) {
    case SIZE_REASON.MEASURED:
      return `${n(size.artifactBytes)} B measured in the gzip upload artifact `
        + `(limit ${n(MALL_UPLOAD_MAX_BYTES)} B; ${predicted})`;
    case SIZE_REASON.STALE_ARTIFACT:
      return `not verified — the existing gzip artifact (${n(size.artifactBytes)} B) `
        + `does not match the current text (${predicted})`;
    case SIZE_REASON.UNVERIFIED_ARTIFACT:
      return `not verified — a gzip artifact exists (${n(size.artifactBytes)} B) `
        + `but was not proven to match the current text (${predicted})`;
    default:
      return `not verified — no gzip upload artifact exists (${predicted})`;
  }
}

module.exports = {
  validate,
  predictedRepackSize,
  resolveSizeState,
  FORBIDDEN_NODES,
  MALL_UPLOAD_MAX_BYTES,
  MAX_TEXTURE_BYTES,
  SIZE_STATUS,
  SIZE_AUTHORITY,
  SIZE_REASON,
};
