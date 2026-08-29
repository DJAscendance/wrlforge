'use strict';
// WD1.7-B -- routing: from a classified written reference plus an explicit base
// document to "which configured source(s), and which archive-relative path".
//
// PURE: no fs, no network. Every decision here is made from the frozen
// ResolverContext and the two strings the caller supplied, so the whole mapping
// and containment policy is unit-testable without an archive on disk.
//
// TWO RESOLUTION SPACES, and keeping them apart is the design:
//
//   URL space      -- the base document's source declares a URL prefix, so the
//                     base HAS an origin. A reference is resolved as a URL
//                     against that origin under NORMAL URL PATH SEMANTICS, and
//                     the RESULT IS RE-ROUTED through every configured mapping.
//                     A `../` that leaves one mapping's prefix may legitimately
//                     land in another mapping, or in none -- in which case it
//                     fails closed. Excess `../` is CLAMPED at `scheme://host/`,
//                     because a URL namespace has a root and climbing above it
//                     is meaningless rather than dangerous: no filesystem has
//                     been touched at this point.
//   archive space  -- the base document's source declares no prefix (a plain
//                     local project folder; the shape WD1.7-B2 needs). There is
//                     no origin, only a configured filesystem root, so relative
//                     references resolve inside that one source and NOTHING may
//                     leave it: excess `../` is REFUSED, never clamped. An
//                     absolute-http or URL-root-relative reference can never
//                     route into such a source at all, because it owns no URL
//                     namespace.
//
// THE DISTINCTION IS THE POINT (WD1.7-B correction 2, after independent QA):
//
//     URL namespace normalization  !=  filesystem/archive-root containment
//
// Clamping `http://h/a/../../../x.wrl` to `http://h/x.wrl` is what every URL
// consumer does and grants no additional reach: the result must still match a
// configured mapping, and the filesystem layer still enforces the configured
// root, realpath containment, symlink containment and exact case afterwards.
// Clamping an ARCHIVE path would be different in kind -- there the root IS a
// filesystem boundary -- so archive space keeps failing closed.
//
// WHAT NEVER HAPPENS HERE:
//   * the host is never stripped so a path can be searched across roots
//     (WD1.7-A §15.1 -- that is the harness probe's generous rule, rejected for
//     production in §11 as "first filesystem match wins");
//   * no suffix, fuzzy, nearest-path or case-insensitive matching;
//   * a URL-root-relative `/protos/foo.wrl` is NEVER read as a workstation path.
//
// ISO 4.5.3/N12: the base document is a REQUIRED INPUT and is never inferred.
// An EXTERNPROTO written inside a PROTO body resolves against the file where the
// enclosing prototype is INSTANTIATED, not the file it was written in, and that
// is unknowable from the declaration alone. WD1.7-C supplies the correct base;
// B's job is to make supplying it mandatory.

const { sourceById } = require('./resolver-context');
const { REFERENCE_FORM } = require('./reference-forms');

// Routing refusals. Each carries the status `retrieval.js` will report, so the
// status/reason pairing is decided in one place rather than at every call site.
const ROUTE_REASON = Object.freeze({
  UNMAPPED_ORIGIN: 'unmapped-origin',
  NO_URL_NAMESPACE_FOR_BASE: 'no-url-namespace-for-base',
  // There is deliberately NO `traversal-above-origin-root`. Excess `../` in URL
  // space is clamped at the namespace root, not refused -- see the header.
  // `outside-source-root` is the archive-space counterpart and is a real
  // filesystem boundary, so it stays.
  OUTSIDE_SOURCE_ROOT: 'outside-source-root',
  EMPTY_PATH_SEGMENT: 'empty-path-segment',
  NAMES_NO_FILE: 'reference-names-no-file',
});

function fail(msg) { throw new TypeError(`external retrieval: ${msg}`); }

// Validate + normalise the caller-supplied base document. A malformed base is a
// PROGRAMMING error in the caller (it is configuration, not hostile document
// content), so it throws rather than becoming a retrieval status -- a silent
// "not found" would hide a wiring mistake in C or B2.
//
// baseDocument = { sourceId, path } where `path` is POSIX and relative to that
// source's configured root.
function normalizeBaseDocument(context, baseDocument) {
  if (baseDocument === null || typeof baseDocument !== 'object') fail('baseDocument must be an object { sourceId, path }');
  const { sourceId } = baseDocument;
  if (typeof sourceId !== 'string' || sourceId === '') fail('baseDocument.sourceId must be a non-empty string');
  const source = sourceById(context, sourceId);
  if (!source) fail(`baseDocument.sourceId ${JSON.stringify(sourceId)} is not a configured source`);
  const raw = baseDocument.path;
  if (typeof raw !== 'string' || raw.trim() === '') fail('baseDocument.path must be a non-empty string');
  if (raw.includes('\\')) fail('baseDocument.path must use POSIX separators');
  if (raw.startsWith('/')) fail('baseDocument.path must be relative to the source root (no leading "/")');
  const segments = raw.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    fail('baseDocument.path must be already normalised (no empty, "." or ".." segments)');
  }
  return Object.freeze({ sourceId, path: segments.join('/'), source, segments: Object.freeze(segments) });
}

// RFC-3986 dot-segment handling. `clampAtRoot` decides the ONE case the two
// resolution spaces disagree on -- a `..` with nothing left to pop:
//
//   clampAtRoot: true   URL space. Discard it, exactly as RFC 3986 says and as
//                       every browser does. `http://h/a/../../x` is `http://h/x`,
//                       and no reach is gained: routing and the filesystem
//                       boundary both still apply afterwards.
//   clampAtRoot: false  Archive space. REFUSE. Here the root is a filesystem
//                       boundary, and clamping an escape into a legal path is
//                       precisely how a traversal gets normalised into a read.
//
// An INTERIOR empty segment (`a//b`) is refused in both spaces: it is not a
// dot-segment rule, it is a malformed path, and collapsing it would look up a
// file the document did not name.
//
// Returns { segments } or { error }.
function joinSegments(baseDirSegments, refSegments, clampAtRoot) {
  const out = baseDirSegments.slice();
  for (const seg of refSegments) {
    if (seg === '.') continue;
    if (seg === '') return { error: ROUTE_REASON.EMPTY_PATH_SEGMENT };
    if (seg === '..') {
      if (out.length === 0) {
        if (clampAtRoot) continue;
        return { error: 'ESCAPE' };
      }
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return { segments: out };
}

// Resolve one URL-space path. `baseDirSegments` is the directory the reference is
// relative to (empty for an absolute or root-relative locator, which carry their
// own leading '/'). Always clamps at the namespace root.
//
// Returns { path } -- always starting with '/' -- or { error }.
function resolveUrlPath(baseDirSegments, locator, isAbsolute) {
  const { segments, trailingSlash } = refSegmentsOf(locator);
  // For an absolute/root-relative locator the leading '' is the ROOT MARKER, not
  // an empty segment, so it is dropped rather than refused.
  const ref = isAbsolute ? segments.slice(1) : segments;
  const joined = joinSegments(baseDirSegments, ref, true);
  if (joined.error) return { error: joined.error };
  const body = joined.segments.join('/');
  return { path: body === '' ? '/' : `/${body}${trailingSlash ? '/' : ''}` };
}

// The directory a URL-space base document lives in, as segments.
function urlBaseDirSegments(pathPrefix, basePath) {
  const segments = `${pathPrefix}${basePath}`.split('/');
  segments.shift();   // leading '' from the '/'-prefixed path
  segments.pop();     // the base document's own filename
  return segments;
}

// Split a locator into segments. A SINGLE trailing '/' is a directory marker,
// not an empty segment: it is stripped here and re-attached to the joined result
// so the "names no file" refusal stays distinct from the "empty segment"
// refusal. An interior '//' is still an empty segment and is still refused.
function refSegmentsOf(locator) {
  const segments = locator.split('/');
  if (segments.length > 1 && segments[segments.length - 1] === '') {
    segments.pop();
    return { segments, trailingSlash: true };
  }
  return { segments, trailingSlash: false };
}

// Find every configured source whose mapping covers `origin` + `path`, keeping
// only the LONGEST matching prefix.
//
// PRECEDENCE RULE, chosen and stated: the longest configured pathPrefix wins.
// Justification: a longer prefix is a strictly more specific statement about the
// same namespace, so honouring the broader one would make the specific mapping
// unreachable -- configuration that can never take effect is worse than no
// configuration. Because every pathPrefix is normalised to end in '/', a longer
// match is also always a segment-aligned match, so `/3d/` never captures `/3dx/`.
//
// Mappings that tie (necessarily the same prefix string) are NOT resolved by
// configured order: they all become candidates, and retrieval decides between
// them on CONTENT -- identical decoded content is one artifact, differing
// content is AMBIGUOUS_SOURCE. Order therefore never silently picks a winner.
function matchMappings(context, origin, urlPath) {
  let best = -1;
  let matches = [];
  for (const s of context.sources) {
    if (s.origin === null || s.origin !== origin) continue;
    if (!urlPath.startsWith(s.pathPrefix)) continue;
    if (s.pathPrefix.length > best) { best = s.pathPrefix.length; matches = [s]; }
    else if (s.pathPrefix.length === best) matches.push(s);
  }
  if (matches.length === 0) return null;
  return { sources: matches, requestedPath: urlPath.slice(best) };
}

function refuse(status, reason, extra) {
  return Object.freeze({ routed: false, status, reason, target: null, sourceIds: Object.freeze([]), requestedPath: null, ...extra });
}

// routeCandidate({ context, base, classified }) -> frozen routing record.
//
// On success: { routed: true, target: { origin, path } | null, sourceIds[],
//               requestedPath }
// On refusal: { routed: false, status, reason }
//
// `status` on refusal is always one that asserts NOTHING was proven absent
// (NOT_RETRIEVED_BY_POLICY), except NAMES_NO_FILE, where the reference
// names a directory and therefore cannot denote an artifact at all.
function routeCandidate({ context, base, classified }) {
  const form = classified.form;
  const source = base.source;

  // ---- absolute http(s): the mapping decides, and only the mapping ----------
  // The path is normalised (dot-segments removed, clamped at the namespace root)
  // BEFORE mapping, so `http://h/a/../lib/x.wrl` and `http://h/lib/x.wrl` route
  // identically -- otherwise a `..` would survive into an archive lookup.
  if (form === REFERENCE_FORM.ABSOLUTE_HTTP) {
    const resolved = resolveUrlPath([], classified.originPath, true);
    if (resolved.error) return refuse('NOT_RETRIEVED_BY_POLICY', resolved.error);
    return finish(context, classified.origin, resolved.path);
  }

  // ---- URL-root-relative: needs the BASE's URL namespace --------------------
  if (form === REFERENCE_FORM.ROOT_RELATIVE) {
    if (source.origin === null) {
      return refuse('NOT_RETRIEVED_BY_POLICY', ROUTE_REASON.NO_URL_NAMESPACE_FOR_BASE);
    }
    const resolved = resolveUrlPath([], classified.locator, true);
    if (resolved.error) return refuse('NOT_RETRIEVED_BY_POLICY', resolved.error);
    return finish(context, source.origin, resolved.path);
  }

  // ---- relative forms -------------------------------------------------------
  if (source.origin !== null) {
    // URL space. The base's URL path is prefix + archive-relative path.
    const resolved = resolveUrlPath(urlBaseDirSegments(source.pathPrefix, base.path), classified.locator, false);
    if (resolved.error) return refuse('NOT_RETRIEVED_BY_POLICY', resolved.error);
    return finish(context, source.origin, resolved.path);
  }

  // Archive space: no origin, so the configured source root is a FILESYSTEM
  // boundary and nothing may leave it. No clamping here.
  const { segments: refSegments, trailingSlash } = refSegmentsOf(classified.locator);
  const joined = joinSegments(base.segments.slice(0, -1), refSegments, false);
  if (joined.error === 'ESCAPE') return refuse('NOT_RETRIEVED_BY_POLICY', ROUTE_REASON.OUTSIDE_SOURCE_ROOT);
  if (joined.error) return refuse('NOT_RETRIEVED_BY_POLICY', joined.error);
  const requestedPath = joined.segments.join('/') + (trailingSlash ? '/' : '');
  if (requestedPath === '' || requestedPath.endsWith('/')) {
    return refuse('NOT_FOUND', ROUTE_REASON.NAMES_NO_FILE);
  }
  return Object.freeze({
    routed: true,
    status: null,
    reason: null,
    target: null,
    sourceIds: Object.freeze([source.id]),
    requestedPath,
  });
}

function finish(context, origin, urlPath) {
  if (urlPath === '' || urlPath.endsWith('/')) {
    return refuse('NOT_FOUND', ROUTE_REASON.NAMES_NO_FILE, { target: Object.freeze({ origin, path: urlPath }) });
  }
  const matched = matchMappings(context, origin, urlPath);
  if (!matched) {
    // FAIL CLOSED. Never host-stripped into a generic root search, and never
    // reported as NOT_FOUND -- nothing was explored, so nothing is absent.
    return refuse('NOT_RETRIEVED_BY_POLICY', ROUTE_REASON.UNMAPPED_ORIGIN, { target: Object.freeze({ origin, path: urlPath }) });
  }
  if (matched.requestedPath === '' || matched.requestedPath.endsWith('/')) {
    return refuse('NOT_FOUND', ROUTE_REASON.NAMES_NO_FILE, { target: Object.freeze({ origin, path: urlPath }) });
  }
  return Object.freeze({
    routed: true,
    status: null,
    reason: null,
    target: Object.freeze({ origin, path: urlPath }),
    sourceIds: Object.freeze(matched.sources.map((s) => s.id)),
    requestedPath: matched.requestedPath,
  });
}

module.exports = { routeCandidate, normalizeBaseDocument, matchMappings, ROUTE_REASON };
