'use strict';
// World Project preview source authorization + serving (Phase 4B). Exercises the
// read-authorization boundary against the committed fixtures with the REAL
// filesystem (gzip-transparent), covering the Phase 4B completion-gate scenarios
// at the main-process module level (no Electron, no X_ITE):
//   plain/gzip primary, plain/gzip nested Inline, per-file relative bases,
//   >20 and >=70 textures, repeated dependency, dependency cycle, missing asset,
//   case mismatch, remote blocking, path-traversal blocking, and non-mutation.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { detectPrimaries, scanProject } = require('../../src/world-project/project-loader');
const {
  WORLD_PREVIEW_SCHEME,
  buildAuthorizedSet,
  worldAssetUrl,
  worldBaseUrl,
  requestToAbsPath,
  resolveWorldRequest,
  buildPreviewPayload,
  mimeForAsset,
} = require('../../src/world-project/preview-source');
const { ALLOWED_SCHEMES } = require('../../src/preview/url-policy');

const FX = path.resolve(__dirname, '../fixtures/world');

function scanOf(proj, primaryName) {
  const root = path.join(FX, proj);
  const primary = path.join(root, primaryName || 'world.wrl');
  return scanProject({ root, primary });
}
// A live preview object as main.js would install it.
function previewOf(scan) {
  return { projectRoot: path.resolve(scan.root), authorized: buildAuthorizedSet(scan.graph) };
}
// Serve a wrlworld URL through the real filesystem, as the scheme handler would.
function serve(preview, url) {
  return resolveWorldRequest(preview, url);
}

test('scheme name agrees with the network-guard allow-list (no drift)', () => {
  assert.ok(ALLOWED_SCHEMES.has(WORLD_PREVIEW_SCHEME),
    `url-policy ALLOWED_SCHEMES must include '${WORLD_PREVIEW_SCHEME}' or the network guard cancels the world preview`);
});

test('plain primary world: payload carries decompressed text + wrlworld base', () => {
  const scan = scanOf('mini');
  const p = buildPreviewPayload(scan);
  assert.equal(p.ok, true);
  assert.equal(p.wasGzipped, false);
  assert.match(p.text, /^#VRML V2\.0 utf8/);
  assert.equal(p.baseURL, `${WORLD_PREVIEW_SCHEME}://project/`);
  assert.equal(p.counts.uniqueTextures, 25);
  assert.equal(p.counts.viewpoints, 2);
});

test('gzip primary world: payload text is decompressed, flagged gzip', () => {
  const scan = scanOf('gz');
  const p = buildPreviewPayload(scan);
  assert.equal(p.ok, true);
  assert.equal(p.wasGzipped, true);
  assert.match(p.text, /^#VRML V2\.0 utf8/);
});

test('plain nested Inline resolves through the scheme handler', () => {
  const scan = scanOf('mini');
  const preview = previewOf(scan);
  const res = serve(preview, `${WORLD_PREVIEW_SCHEME}://project/sub/props.wrl`);
  assert.equal(res.status, 200);
  assert.equal(res.mimeType, 'model/vrml');
  assert.match(res.body.toString('utf8'), /geometry Cone/);
});

test('gzip nested Inline is served decompressed (X_ITE never sees gzip bytes)', () => {
  const scan = scanOf('gz');
  const preview = previewOf(scan);
  const res = serve(preview, `${WORLD_PREVIEW_SCHEME}://project/parts/panel.wrl`);
  assert.equal(res.status, 200);
  const text = res.body.toString('utf8');
  assert.match(text, /^#VRML V2\.0 utf8/); // decompressed, not gzip magic bytes
  assert.ok(!/\x1f\x8b/.test(text));
});

test('per-file relative bases: each WRL resolves textures from its OWN directory', () => {
  const scan = scanOf('nested');
  const preview = previewOf(scan);
  // primary references img/floor.png at root
  assert.equal(serve(preview, `${WORLD_PREVIEW_SCHEME}://project/img/floor.png`).status, 200);
  // panel.wrl (in parts/) references "tex/wall art.png" -> parts/tex/wall art.png
  const wall = serve(preview, `${WORLD_PREVIEW_SCHEME}://project/parts/tex/wall%20art.png`);
  assert.equal(wall.status, 200, 'space-in-filename texture must resolve from parts/');
  assert.equal(wall.mimeType, 'image/png');
  // more.wrl (in parts/deep/) references "tex/lamp.png" -> parts/deep/tex/lamp.png
  assert.equal(serve(preview, `${WORLD_PREVIEW_SCHEME}://project/parts/deep/tex/lamp.png`).status, 200);
  // and its "../../img/floor.png" is the SAME root floor (repeat), still authorized
  assert.equal(serve(preview, `${WORLD_PREVIEW_SCHEME}://project/img/floor.png`).status, 200);
});

test('worldBaseUrl/worldAssetUrl encode nested dirs and spaces', () => {
  const root = FX;
  const primary = path.join(FX, 'nested', 'world.wrl');
  assert.equal(worldBaseUrl(root, primary), `${WORLD_PREVIEW_SCHEME}://project/nested/`);
  assert.equal(
    worldAssetUrl(root, path.join(FX, 'nested', 'parts', 'tex', 'wall art.png')),
    `${WORLD_PREVIEW_SCHEME}://project/nested/parts/tex/wall%20art.png`
  );
});

test('more than 20 textures: all authorized, none truncated', () => {
  const scan = scanOf('mini');
  const preview = previewOf(scan);
  const p = buildPreviewPayload(scan);
  assert.equal(p.counts.uniqueTextures, 25);
  for (let i = 0; i <= 23; i++) {
    const url = `${WORLD_PREVIEW_SCHEME}://project/img/t${String(i).padStart(2, '0')}.png`;
    assert.equal(serve(preview, url).status, 200, `texture ${i} must be authorized`);
  }
});

test('at least 70 textures: every one is authorized and served', () => {
  const scan = scanOf('valid70');
  const preview = previewOf(scan);
  const p = buildPreviewPayload(scan);
  assert.equal(p.counts.uniqueTextures, 71, 'no texture cap in the World lane');
  let served = 0;
  for (let i = 0; i < 71; i++) {
    const url = `${WORLD_PREVIEW_SCHEME}://project/img/t${String(i).padStart(3, '0')}.png`;
    if (serve(preview, url).status === 200) served++;
  }
  assert.equal(served, 71);
});

test('repeated dependency authorizes exactly one entry, serves every time', () => {
  const scan = scanOf('nested');
  const p = buildPreviewPayload(scan);
  assert.ok(p.counts.duplicates >= 1, 'floor.png is referenced by two files');
  const preview = previewOf(scan);
  // The repeat still serves (idempotent) from both referencing contexts.
  assert.equal(serve(preview, `${WORLD_PREVIEW_SCHEME}://project/img/floor.png`).status, 200);
  assert.equal(serve(preview, `${WORLD_PREVIEW_SCHEME}://project/img/floor.png`).status, 200);
});

test('dependency cycle: both WRL nodes authorized, serving stays bounded', () => {
  const scan = scanOf('cycle', 'a.wrl');
  const p = buildPreviewPayload(scan);
  assert.ok(p.counts.cycles >= 1, 'a<->b cycle must be detected');
  const preview = previewOf(scan);
  assert.equal(serve(preview, `${WORLD_PREVIEW_SCHEME}://project/a.wrl`).status, 200);
  assert.equal(serve(preview, `${WORLD_PREVIEW_SCHEME}://project/b.wrl`).status, 200);
  // Authorized set is finite (bounded walk) -- 2 wrl + 2 textures.
  assert.equal(preview.authorized.size, 4);
});

test('missing asset is NOT authorized (X_ITE gets a 404 -> load warning)', () => {
  const scan = scanOf('broken');
  const preview = previewOf(scan);
  const p = buildPreviewPayload(scan);
  assert.ok(p.missingAssets.some((m) => /missing\.jpg$/.test(m)));
  assert.equal(serve(preview, `${WORLD_PREVIEW_SCHEME}://project/img/missing.jpg`).status, 404);
  // the present one IS served
  assert.equal(serve(preview, `${WORLD_PREVIEW_SCHEME}://project/img/present.png`).status, 200);
});

test('case mismatch is NOT authorized under the referenced casing', () => {
  const scan = scanOf('broken');
  const preview = previewOf(scan);
  const p = buildPreviewPayload(scan);
  assert.ok(p.caseMismatches.some((c) => /Present\.PNG$/.test(c.referenced)));
  // Referenced "Present.PNG" must not be served (would break on a case-sensitive
  // server even though a differently-cased sibling exists).
  assert.equal(serve(preview, `${WORLD_PREVIEW_SCHEME}://project/img/Present.PNG`).status, 404);
});

test('remote URLs are surfaced in the payload and never authorized', () => {
  const scan = scanOf('broken');
  const preview = previewOf(scan);
  const p = buildPreviewPayload(scan);
  assert.ok(p.remoteUrls.includes('http://example.com/remote.png'));
  assert.ok(p.remoteUrls.includes('//cdn.example.com/proto.png'));
  // Even if X_ITE somehow requested them through the scheme, they are not local
  // paths in the allow-list.
  assert.equal(preview.authorized.has('http://example.com/remote.png'), false);
});

test('path traversal is blocked at the scheme boundary AND the allow-list', () => {
  const scan = scanOf('broken');
  const preview = previewOf(scan);
  // A crafted URL trying to climb out of the project root.
  const climb = requestToAbsPath(preview.projectRoot, `${WORLD_PREVIEW_SCHEME}://project/../../../etc/passwd`);
  // The WHATWG URL parser clamps `..` at the authority root, so this maps to a
  // path under the root that simply isn't authorized -> refused either way.
  const res = serve(preview, `${WORLD_PREVIEW_SCHEME}://project/../../../etc/passwd`);
  assert.ok(res.status === 403 || res.status === 404, `traversal must be refused (got ${res.status})`);
  assert.ok(!climb.error || climb.error === 'outside-root' || preview.authorized.has(climb.abs) === false);
  // The authored unsafe refs (absolute /etc/hosts, ../../escape.png) are surfaced.
  const p = buildPreviewPayload(scan);
  assert.ok(p.unsafeRefs.length >= 2);
});

test('no active preview refuses every request', () => {
  assert.equal(resolveWorldRequest(null, `${WORLD_PREVIEW_SCHEME}://project/anything.png`).status, 503);
});

test('a foreign scheme is refused', () => {
  const preview = previewOf(scanOf('mini'));
  assert.equal(serve(preview, 'file:///etc/passwd').status, 403);
  assert.equal(serve(preview, 'http://evil.example/x.png').status, 403);
});

test('primary-unreadable (corrupt gzip) yields an error payload, not a throw', () => {
  const scan = scanOf('mini');
  // Force a read error via injected readSource.
  const p = buildPreviewPayload(scan, { readSource: () => { throw new Error('bad gzip'); } });
  assert.equal(p.ok, false);
  assert.equal(p.status, 'primary-unreadable');
  assert.match(p.error, /bad gzip/);
  assert.equal(p.text, null);
});

test('mime types map by extension', () => {
  assert.equal(mimeForAsset('/x/a.png'), 'image/png');
  assert.equal(mimeForAsset('/x/a.WRL'), 'model/vrml');
  assert.equal(mimeForAsset('/x/a.unknownext'), 'application/octet-stream');
});

test('no Mall Item rules are applied in World preview mode', () => {
  // The World preview must not import the Mall validator or the Mall fit/guide
  // math -- worlds get no 80KB cap, no placement fit, no forbidden-node rules.
  // Strip comments so the deliberate "does NOT use Mall rules" disclaimers in the
  // headers don't count as usage -- we assert on real code only.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const srcRoot = path.resolve(__dirname, '../..');
  const previewSrc = stripComments(fs.readFileSync(path.join(srcRoot, 'src/world-project/preview-source.js'), 'utf8'));
  const rendererSrc = stripComments(fs.readFileSync(path.join(srcRoot, 'renderer/world-preview.js'), 'utf8'));
  for (const src of [previewSrc, rendererSrc]) {
    assert.ok(!/require\(['"][^'"]*validator['"]\)/.test(src), 'must not import validator.js');
    assert.ok(!/fit-math|extrusion-bounds|buildGuidesVrml|computeFit|computeSceneBBox|proposedAppliedScale/.test(src),
      'must not use Mall fit / guide / placement logic');
    assert.ok(!/80\s*KB|80000|forbidden/i.test(src), 'must not apply Mall size/forbidden-node rules');
  }
  // preview-source only depends on the shared gzip reader, not on any Mall module.
  const req = [...previewSrc.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(req.filter((r) => /validator|fit-math|guides|extrusion/.test(r)), []);
});

test('building a preview + serving mutates nothing on disk', () => {
  const hashTree = (dir) => {
    const out = {};
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const pth = path.join(dir, e.name);
      if (e.name === '_generate.js') continue;
      if (e.isDirectory()) Object.assign(out, hashTree(pth));
      else out[pth] = crypto.createHash('sha256').update(fs.readFileSync(pth)).digest('hex');
    }
    return out;
  };
  const before = hashTree(FX);
  for (const [proj, primaryName] of [['mini'], ['gz'], ['broken'], ['valid70'], ['nested'], ['cycle', 'a.wrl']]) {
    const scan = scanOf(proj, primaryName);
    const preview = previewOf(scan);
    buildPreviewPayload(scan);
    for (const abs of preview.authorized.keys()) {
      serve(preview, worldAssetUrl(preview.projectRoot, abs));
    }
  }
  assert.deepEqual(hashTree(FX), before);
});
