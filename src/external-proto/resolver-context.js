'use strict';
// WD1.7-B -- the ResolverContext: explicit, inert, frozen retrieval configuration.
//
// PURE with respect to the world: it reads no environment variable, no cwd, no
// home directory, no settings file and no disk. Everything it knows, a caller
// passed in. That is the point -- a resolver whose answer depends on ambient
// machine state is not reproducible, and WD1.7-A §15/§12 make reproducibility a
// contract rather than a nicety.
//
// THE BINDING INVARIANT (WD1.7-A §15.1, correction F2):
//
//     external URL namespace -> explicit configured mapping -> archive root
//
// and explicitly NOT `strip the host -> search one generic root`. The corpus
// references at least www.cybertown.com, objects.cybertown.com and
// www.blaxxun.com; those are DIFFERENT namespaces that happen to be archived
// near each other, and two of them can legitimately hold different files at the
// same path. An origin with no configured mapping FAILS CLOSED.
//
// A mapping is expressed as a URL PREFIX, not merely an origin, because a prefix
// is a superset of an origin: `http://host` and `http://host/3d/` are the same
// mechanism at two granularities, so no second mechanism is needed (§15.1).
//
// NO DEFAULT SOURCES. There is no built-in Cybertown archive mapping, and none
// may be added here: the roots live on the owner's machine, and baking a
// machine-specific path into production behaviour is exactly the ambient
// coupling this module exists to prevent.

const path = require('path');
const { canonicalOrigin } = require('./url-origin');

// Resource bounds. These are WRL FORGE SECURITY POLICY, not ISO requirements --
// ISO/IEC 14772-1 says nothing about file sizes, compression or archives at all
// (WD1.7-A §3.2 U1/U2). They exist to bound hostile input, and a caller may
// override any of them.
const DEFAULT_LIMITS = Object.freeze({
  maxBytes: 16 * 1024 * 1024,        // artifact bytes read from disk
  maxDecodedBytes: 64 * 1024 * 1024, // decoded VRML source bytes
  maxExpansionRatio: 100,            // decoded / retrieved, gzip bomb bound
});

function fail(msg) { throw new TypeError(`resolver context: ${msg}`); }

// Normalise a configured URL prefix into { origin, pathPrefix }.
// `pathPrefix` ALWAYS ends with '/', which is what makes prefix matching
// segment-safe later: `http://h/3d/` can then never match `http://h/3dx/foo`.
function normalizePrefix(prefix, id) {
  if (typeof prefix !== 'string' || prefix.trim() === '') fail(`source "${id}": prefix must be a non-empty string when present`);
  const raw = prefix.trim();
  if (raw.includes('#')) fail(`source "${id}": prefix must not contain a fragment`);
  if (raw.includes('?')) fail(`source "${id}": prefix must not contain a query string`);
  const m = /^(https?):\/\/([^/]+)(\/.*)?$/i.exec(raw);
  if (!m) fail(`source "${id}": prefix must be an absolute http(s) URL, got ${JSON.stringify(raw)}`);
  const scheme = m[1].toLowerCase();
  // ONE canonicalization authority, shared with reference classification. A
  // configured `http://h:80/` and a written `http://h/` must produce the same
  // origin string, or a mapping that looks configured silently never matches.
  const origin = canonicalOrigin(scheme, m[2]);
  if (origin === null) fail(`source "${id}": prefix has an unusable authority (empty host, userinfo, or an invalid port): ${JSON.stringify(raw)}`);
  let pathPrefix = m[3] || '/';
  if (!pathPrefix.startsWith('/')) pathPrefix = `/${pathPrefix}`;
  if (!pathPrefix.endsWith('/')) pathPrefix += '/';
  if (pathPrefix.includes('//')) fail(`source "${id}": prefix path must not contain an empty segment`);
  if (/(^|\/)\.\.?(\/|$)/.test(pathPrefix)) fail(`source "${id}": prefix path must not contain "." or ".." segments`);
  return { origin, pathPrefix };
}

// createResolverContext(config) -> frozen ResolverContext
//
// config = {
//   sources: [ { id, root, prefix? } ],   // ORDERED; order is provenance policy only
//   limits?: { maxBytes, maxDecodedBytes, maxExpansionRatio },
//   network?: false,
// }
//
// `root` MUST be absolute. A relative root would be resolved against the process
// cwd, which is precisely the ambient dependency this lane forbids.
//
// `prefix` is optional. A source WITHOUT a prefix is archive-local: it can serve
// as a base document's home and answer relative references inside itself, but it
// owns no URL namespace, so no absolute-http or URL-root-relative reference can
// ever route into it. That is the shape WD1.7-B2 will use for a World Project
// folder, which genuinely has no origin.
function createResolverContext(config = {}) {
  if (config === null || typeof config !== 'object') fail('config must be an object');
  const rawSources = config.sources;
  if (!Array.isArray(rawSources)) fail('sources must be an array (an empty array is allowed and retrieves nothing)');

  const seenIds = new Set();
  const sources = rawSources.map((entry, i) => {
    if (entry === null || typeof entry !== 'object') fail(`sources[${i}] must be an object`);
    const id = entry.id;
    if (typeof id !== 'string' || id.trim() === '') fail(`sources[${i}].id must be a non-empty string`);
    if (seenIds.has(id)) fail(`duplicate source id ${JSON.stringify(id)}`);
    seenIds.add(id);
    const root = entry.root;
    if (typeof root !== 'string' || root.trim() === '') fail(`source "${id}": root must be a non-empty string`);
    if (!path.isAbsolute(root)) fail(`source "${id}": root must be an absolute path (no cwd-relative roots), got ${JSON.stringify(root)}`);
    const mapping = entry.prefix === undefined || entry.prefix === null ? null : normalizePrefix(entry.prefix, id);
    return Object.freeze({
      id,
      // Lexically normalised. NOT realpath'd here: the context must stay pure and
      // usable before the archive is mounted. Symlink resolution happens at
      // retrieval time, where it is a per-lookup boundary check (retrieval.js).
      root: path.resolve(root),
      origin: mapping ? mapping.origin : null,
      pathPrefix: mapping ? mapping.pathPrefix : null,
      order: i,
    });
  });

  const limits = normalizeLimits(config.limits);

  if (config.network !== undefined && config.network !== false) {
    // Not "unsupported yet, so ignored" -- accepting the flag would imply a
    // capability that does not exist. WD1.7-B performs ZERO network retrieval
    // (WD1.7-A §8), and an injected retriever is a later, separately approved
    // decision (DECISION-3).
    fail('network retrieval is not implemented in WD1.7-B; `network` must be false or omitted');
  }

  return Object.freeze({
    sources: Object.freeze(sources),
    limits,
    network: false,
  });
}

function normalizeLimits(limits) {
  if (limits === undefined || limits === null) return DEFAULT_LIMITS;
  if (typeof limits !== 'object') fail('limits must be an object');
  const out = { ...DEFAULT_LIMITS };
  for (const key of ['maxBytes', 'maxDecodedBytes', 'maxExpansionRatio']) {
    if (limits[key] === undefined) continue;
    const v = limits[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) fail(`limits.${key} must be a positive finite number`);
    out[key] = v;
  }
  if (out.maxExpansionRatio < 1) fail('limits.maxExpansionRatio must be >= 1');
  for (const key of ['maxBytes', 'maxDecodedBytes']) {
    if (!Number.isInteger(out[key])) fail(`limits.${key} must be an integer number of bytes`);
  }
  return Object.freeze(out);
}

// Look one source up by id. Returns the frozen entry or null.
function sourceById(context, id) {
  for (const s of context.sources) if (s.id === id) return s;
  return null;
}

module.exports = { createResolverContext, sourceById, DEFAULT_LIMITS };
