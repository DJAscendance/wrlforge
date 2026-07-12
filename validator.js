'use strict';
// Generic Cybertown Revival Mall / VRML97 rule checks.
// Pure function: text (+ gzip size) in, structured results out. No filesystem access here.
const zlib = require('zlib');

const FORBIDDEN_NODES = [
  'Inline', 'EXTERNPROTO', 'Sound', 'DirectionalLight',
  'HAnimHumanoid', 'HAnimJoint', 'HAnimSegment', 'HAnimSite',
];

const MAX_GZIP_BYTES = 80 * 1024;
const MAX_TEXTURE_BYTES = 80 * 1024;

function check(name, pass, detail, severity = 'hard') {
  return { name, pass, detail: detail || '', severity };
}

function gzipSize(text) {
  return zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 }).length;
}

function validate(text) {
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

  // 3. gzip size under 80KB
  const gz = gzipSize(text);
  results.push(check(
    `Gzip size under ${MAX_GZIP_BYTES / 1024}KB`,
    gz < MAX_GZIP_BYTES,
    `${gz} bytes gzipped (${text.length} bytes raw)`
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
  return {
    results,
    ok: hardFails.length === 0,
    gzipBytes: gz,
    rawBytes: Buffer.byteLength(text, 'utf8'),
  };
}

module.exports = { validate, gzipSize, FORBIDDEN_NODES, MAX_GZIP_BYTES, MAX_TEXTURE_BYTES };
