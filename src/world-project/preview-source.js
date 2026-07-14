'use strict';
// World Project preview source authorization + serving (Phase 4B).
//
// The embedded X_ITE world preview must NOT be allowed to read whatever it likes
// off disk. This module is the read-authorization boundary between X_ITE (which
// resolves nested Inline / textures itself) and the filesystem:
//
//   * X_ITE is pointed at a custom `wrlworld://project/<relpath>` scheme (NOT
//     file://), so every dependency it resolves comes back through the main
//     process. Relative URLs resolve per-file (against each WRL's own directory)
//     because the scheme is a standard hierarchical scheme -- see worldBaseUrl.
//   * `buildAuthorizedSet()` derives the allow-list from the production asset
//     graph: readable WRL nodes + present (exact-case) local assets ONLY.
//     Missing, case-mismatched, remote, unsafe, and inline-script references are
//     deliberately NOT authorized, so X_ITE simply fails to load them (surfacing
//     a runtime warning) instead of the preview reaching outside the graph.
//   * `resolveWorldRequest()` maps a request URL to an absolute path, confines it
//     to the project root (defense in depth on top of the scheme's own `..`
//     clamping), checks the allow-list, and serves gzip-decompressed text for
//     WRL nodes / raw bytes for assets.
//
// Pure/injectable: the fs reads are injectable so the whole authorization surface
// is unit-tested without Electron or a real X_ITE. Read-only: nothing here writes.

const fs = require('fs');
const path = require('path');
const { readWrlSource } = require('../preview/wrl-source');

// A standard, hierarchical, local-only scheme registered as privileged in
// main.js. It is intentionally NOT file:// so app resources (x_ite bundle, wasm,
// world.html) stay on the default file handler and only world CONTENT routes
// through the authorized handler. Kept in sync with url-policy's ALLOWED_SCHEMES
// (a unit test asserts they agree).
const WORLD_PREVIEW_SCHEME = 'wrlworld';
const WORLD_PREVIEW_AUTHORITY = 'project';
const WORLD_PREVIEW_ORIGIN = `${WORLD_PREVIEW_SCHEME}://${WORLD_PREVIEW_AUTHORITY}/`;

const MIME = {
  '.wrl': 'model/vrml', '.wrz': 'model/vrml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.tga': 'image/x-tga',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.mid': 'audio/midi', '.midi': 'audio/midi', '.au': 'audio/basic',
  '.avi': 'video/x-msvideo', '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime',
};

function mimeForAsset(p) {
  return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

const relOf = (root, abs) => path.relative(path.resolve(root), path.resolve(abs)).split(path.sep).join('/');

// Read-authorization allow-list from a scan graph: readable WRL nodes + present
// exact-case assets. Keyed by absolute path -> { kind }.
function buildAuthorizedSet(graph) {
  const m = new Map();
  for (const n of (graph && graph.wrlNodes) || []) {
    if (!n.unreadable) m.set(path.resolve(n.path), { kind: 'wrl' });
  }
  for (const a of (graph && graph.assets) || []) {
    if (a.present) m.set(path.resolve(a.path), { kind: a.kind });
  }
  return m;
}

// wrlworld:// URL for an absolute path under projectRoot (each segment encoded,
// so spaces and other URL-significant characters survive the round trip).
function worldAssetUrl(projectRoot, absPath) {
  const rel = path.relative(path.resolve(projectRoot), path.resolve(absPath));
  if (rel === '') return WORLD_PREVIEW_ORIGIN;
  const segs = rel.split(path.sep).map(encodeURIComponent);
  return WORLD_PREVIEW_ORIGIN + segs.join('/');
}

// Base URL (the primary's OWN directory, trailing slash) so the primary's
// relative references resolve against its folder -- and every nested Inline
// then resolves against ITS OWN folder via the scheme's hierarchical semantics.
function worldBaseUrl(projectRoot, primary) {
  const dirUrl = worldAssetUrl(projectRoot, path.dirname(path.resolve(primary)));
  return dirUrl.endsWith('/') ? dirUrl : dirUrl + '/';
}

// Map a wrlworld:// request URL to an absolute path confined to projectRoot.
// Returns { abs } or { error } (never throws).
function requestToAbsPath(projectRoot, requestUrl) {
  let u;
  try { u = new URL(String(requestUrl)); } catch { return { error: 'bad-url' }; }
  if (u.protocol !== WORLD_PREVIEW_SCHEME + ':') return { error: 'bad-scheme' };
  let rel;
  try { rel = decodeURIComponent(u.pathname).replace(/^\/+/, ''); } catch { return { error: 'bad-encoding' }; }
  const root = path.resolve(projectRoot);
  const abs = path.resolve(root, rel);
  const relCheck = path.relative(root, abs);
  // '' == the root directory itself (not a file); '..'/absolute == escaped root.
  if (relCheck === '' || relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    return { error: 'outside-root', abs };
  }
  return { abs };
}

// Core of the scheme handler (fs injectable). `preview` is { projectRoot,
// authorized } or null (no preview active -> refuse everything). Returns
// { status, mimeType?, body?, error? }.
function resolveWorldRequest(preview, requestUrl, deps = {}) {
  const readSource = deps.readSource || ((p) => readWrlSource(p));
  const readFile = deps.readFile || ((p) => fs.readFileSync(p));
  if (!preview || !preview.authorized) return { status: 503, error: 'no-active-world-preview' };

  const { abs, error } = requestToAbsPath(preview.projectRoot, requestUrl);
  if (error) return { status: 403, error };

  const entry = preview.authorized.get(abs);
  if (!entry) return { status: 404, error: 'not-authorized' };

  // Phase 7C3: an OPTIONAL unsaved-buffer overlay lookup, consulted only AFTER
  // the request has passed scheme/root confinement AND the graph allow-list
  // above -- overlay presence alone can never make a request valid. Only WRL
  // nodes may be overridden (a byte substitution of already-authorized text);
  // assets always come from disk. Absent (the default, and always for the
  // workspace disk preview), behavior is byte-identical to Phase 4B.
  const overlayLookup = deps.overlayLookup;
  if (entry.kind === 'wrl' && typeof overlayLookup === 'function') {
    const hit = overlayLookup(abs, entry);
    if (typeof hit === 'string') {
      return { status: 200, mimeType: 'model/vrml', body: Buffer.from(hit, 'utf8'), overlay: true };
    }
  }

  try {
    if (entry.kind === 'wrl') {
      const { text } = readSource(abs); // gzip-transparent -> X_ITE only sees text
      return { status: 200, mimeType: 'model/vrml', body: Buffer.from(text, 'utf8') };
    }
    return { status: 200, mimeType: mimeForAsset(abs), body: readFile(abs) };
  } catch (err) {
    return { status: 500, error: String((err && err.message) || err) };
  }
}

// Renderer-facing payload for a scan. Contains ONLY controlled, read-only content
// and metadata: the decompressed primary text, the wrlworld base URL (no absolute
// filesystem path is leaked in it), advisory counts, and the warning lists. The
// authorized allow-list is NOT included -- main installs it into the scheme
// handler separately via buildAuthorizedSet(). fs read is injectable.
function buildPreviewPayload(scan, deps = {}) {
  const readSource = deps.readSource || ((p) => readWrlSource(p));
  const graph = (scan && scan.graph) || { stats: {}, wrlNodes: [], assets: [], missing: [], caseMismatches: [], remoteRefs: [], unsafe: [] };
  const s = graph.stats || {};
  const projectRoot = path.resolve(scan.root);
  const primary = path.resolve(scan.primary);

  let text = null, wasGzipped = false, readError = null;
  try {
    const r = readSource(primary);
    text = r.text;
    wasGzipped = !!r.wasGzipped;
  } catch (err) {
    readError = String((err && err.message) || err);
  }

  const remoteUrls = [...new Set((graph.remoteRefs || []).map((r) => r.url))];
  const missingAssets = [...new Set((graph.missing || []).map((m) => relOf(projectRoot, m.path)))];
  const caseMismatches = (graph.caseMismatches || []).map((c) => ({
    referenced: relOf(projectRoot, c.referenced),
    actual: path.basename(c.actual),
  }));
  const unsafeRefs = [...new Set((graph.unsafe || []).map((u) => u.url))];
  const presentAssets = (graph.assets || []).filter((a) => a.present).length;

  return {
    ok: scan.status === 'ok' && !readError,
    status: readError ? 'primary-unreadable' : scan.status,
    error: readError || scan.error || null,
    stale: !!scan.stale,
    primaryRel: relOf(projectRoot, primary),
    baseURL: worldBaseUrl(projectRoot, primary),
    scheme: WORLD_PREVIEW_SCHEME,
    text,
    wasGzipped,
    remoteUrls,
    missingAssets,
    caseMismatches,
    unsafeRefs,
    counts: {
      wrlFiles: s.wrlFiles || 0,
      references: s.totalRefs || 0,
      presentAssets,
      uniqueTextures: s.uniqueTextures || 0,
      missing: s.missing || 0,
      caseMismatches: s.caseMismatches || 0,
      remote: (graph.remoteRefs || []).length,
      unsafe: s.unsafe || 0,
      cycles: s.cycles || 0,
      duplicates: s.duplicateRefs || 0,
      viewpoints: s.viewpoints || 0,
    },
  };
}

module.exports = {
  WORLD_PREVIEW_SCHEME,
  WORLD_PREVIEW_AUTHORITY,
  WORLD_PREVIEW_ORIGIN,
  mimeForAsset,
  buildAuthorizedSet,
  worldAssetUrl,
  worldBaseUrl,
  requestToAbsPath,
  resolveWorldRequest,
  buildPreviewPayload,
};
