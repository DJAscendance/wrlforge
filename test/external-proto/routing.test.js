'use strict';
// WD1.7-B -- routing tests: origin/prefix mapping, precedence, base-document
// semantics, and traversal refusal. PURE -- no archive on disk is involved, so
// every mapping rule is provable in isolation from the filesystem layer.
//
// The property under test throughout is WD1.7-A §15.1 (correction F2):
//
//     external URL namespace -> explicit configured mapping -> archive root
//
// and never `strip the host -> search one generic root`.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createResolverContext } = require('../../src/external-proto/resolver-context');
const { classifyReference } = require('../../src/external-proto/reference-forms');
const { routeCandidate, normalizeBaseDocument, ROUTE_REASON } = require('../../src/external-proto/routing');

const A = process.platform === 'win32' ? 'C:\\a' : '/a';
const B = process.platform === 'win32' ? 'C:\\b' : '/b';
const C = process.platform === 'win32' ? 'C:\\c' : '/c';

function route(ctx, basePath, written, baseSourceId = 'web') {
  const base = normalizeBaseDocument(ctx, { sourceId: baseSourceId, path: basePath });
  return routeCandidate({ context: ctx, base, classified: classifyReference(written) });
}

const webCtx = createResolverContext({
  sources: [{ id: 'web', prefix: 'http://www.cybertown.com', root: A }],
});
const localCtx = createResolverContext({ sources: [{ id: 'proj', root: A }] });

// ---------------------------------------------------------------- base input

test('the base document is REQUIRED and validated -- a bad base throws, never "not found"', () => {
  assert.throws(() => normalizeBaseDocument(webCtx, undefined), /baseDocument must be an object/);
  assert.throws(() => normalizeBaseDocument(webCtx, { sourceId: 'nope', path: 'a.wrl' }), /not a configured source/);
  assert.throws(() => normalizeBaseDocument(webCtx, { sourceId: 'web', path: '' }), /non-empty string/);
  assert.throws(() => normalizeBaseDocument(webCtx, { sourceId: 'web', path: '/abs.wrl' }), /no leading/);
  assert.throws(() => normalizeBaseDocument(webCtx, { sourceId: 'web', path: 'a\\b.wrl' }), /POSIX separators/);
  assert.throws(() => normalizeBaseDocument(webCtx, { sourceId: 'web', path: '../a.wrl' }), /already normalised/);
  assert.throws(() => normalizeBaseDocument(webCtx, { sourceId: 'web', path: 'a//b.wrl' }), /already normalised/);
});

test('a valid base normalises to a frozen { sourceId, path } plus its source', () => {
  const base = normalizeBaseDocument(webCtx, { sourceId: 'web', path: '3d/home/home.wrl' });
  assert.equal(base.sourceId, 'web');
  assert.equal(base.path, '3d/home/home.wrl');
  assert.equal(base.source.id, 'web');
  assert.ok(Object.isFrozen(base));
});

// ------------------------------------------------------------ absolute http

test('an absolute http URL routes through its own origin mapping', () => {
  const r = route(webCtx, '3d/home/home.wrl', 'http://www.cybertown.com/externprotos/bxx/shared.wrl#Zone');
  assert.equal(r.routed, true);
  assert.deepEqual([...r.sourceIds], ['web']);
  assert.equal(r.requestedPath, 'externprotos/bxx/shared.wrl');
  assert.deepEqual({ ...r.target }, { origin: 'http://www.cybertown.com', path: '/externprotos/bxx/shared.wrl' });
});

test('an UNMAPPED origin fails closed as NOT_RETRIEVED_BY_POLICY, never NOT_FOUND', () => {
  const r = route(webCtx, '3d/home/home.wrl', 'http://objects.cybertown.com/x.wrl');
  assert.equal(r.routed, false);
  assert.equal(r.status, 'NOT_RETRIEVED_BY_POLICY');
  assert.equal(r.reason, ROUTE_REASON.UNMAPPED_ORIGIN);
  assert.deepEqual([...r.sourceIds], []);
});

test('the host is never stripped: an unmapped origin does not fall through to a mapped root', () => {
  const ctx = createResolverContext({
    sources: [
      { id: 'ct', prefix: 'http://www.cybertown.com', root: A },
      { id: 'bx', prefix: 'http://www.blaxxun.com', root: B },
    ],
  });
  const r = route(ctx, 'home.wrl', 'http://origin-c.example/shared/foo.wrl', 'ct');
  assert.equal(r.routed, false);
  assert.equal(r.reason, ROUTE_REASON.UNMAPPED_ORIGIN);
});

test('two origins holding the same path never cross-contaminate', () => {
  const ctx = createResolverContext({
    sources: [
      { id: 'a', prefix: 'http://origin-a.example', root: A },
      { id: 'b', prefix: 'http://origin-b.example', root: B },
    ],
  });
  const ra = route(ctx, 'x.wrl', 'http://origin-a.example/shared/foo.wrl', 'a');
  const rb = route(ctx, 'x.wrl', 'http://origin-b.example/shared/foo.wrl', 'a');
  assert.deepEqual([...ra.sourceIds], ['a']);
  assert.deepEqual([...rb.sourceIds], ['b']);
  assert.equal(ra.requestedPath, 'shared/foo.wrl');
  assert.equal(rb.requestedPath, 'shared/foo.wrl');
});

test('scheme/host matching is case-insensitive; the path is not', () => {
  const r = route(webCtx, 'home.wrl', 'HTTP://WWW.CYBERTOWN.COM/Externprotos/Shared.WRL');
  assert.equal(r.routed, true);
  assert.equal(r.requestedPath, 'Externprotos/Shared.WRL');
});

test('a NON-DEFAULT port difference is a different namespace', () => {
  const r = route(webCtx, 'home.wrl', 'http://www.cybertown.com:8080/x.wrl');
  assert.equal(r.routed, false);
  assert.equal(r.reason, ROUTE_REASON.UNMAPPED_ORIGIN);
});

// -------------------------------------------------- default-port canonicalization
// WD1.7-B correction 1. A default port is a spelling, not a namespace, so the
// four combinations of {configured with/without} x {written with/without} must
// all map. Canonicalization happens in ONE place, so configuration and written
// references cannot drift apart.

test('configured bare origin maps a candidate written with the default port', () => {
  const http = createResolverContext({ sources: [{ id: 's', prefix: 'http://example.com/', root: A }] });
  const r = route(http, 'x.wrl', 'http://example.com:80/foo.wrl', 's');
  assert.equal(r.routed, true);
  assert.equal(r.requestedPath, 'foo.wrl');

  const https = createResolverContext({ sources: [{ id: 's', prefix: 'https://example.com/', root: A }] });
  const rs = route(https, 'x.wrl', 'https://example.com:443/foo.wrl', 's');
  assert.equal(rs.routed, true);
  assert.equal(rs.requestedPath, 'foo.wrl');
});

test('configured default port maps a candidate written bare', () => {
  const http = createResolverContext({ sources: [{ id: 's', prefix: 'http://example.com:80/', root: A }] });
  const r = route(http, 'x.wrl', 'http://example.com/foo.wrl', 's');
  assert.equal(r.routed, true);
  assert.equal(r.requestedPath, 'foo.wrl');

  const https = createResolverContext({ sources: [{ id: 's', prefix: 'https://example.com:443/', root: A }] });
  const rs = route(https, 'x.wrl', 'https://example.com/foo.wrl', 's');
  assert.equal(rs.routed, true);
  assert.equal(rs.requestedPath, 'foo.wrl');
});

test('non-default ports stay distinct in BOTH directions', () => {
  const bare = createResolverContext({ sources: [{ id: 's', prefix: 'http://example.com/', root: A }] });
  assert.equal(route(bare, 'x.wrl', 'http://example.com:8080/foo.wrl', 's').reason, ROUTE_REASON.UNMAPPED_ORIGIN);
  const ported = createResolverContext({ sources: [{ id: 's', prefix: 'http://example.com:8080/', root: A }] });
  assert.equal(route(ported, 'x.wrl', 'http://example.com/foo.wrl', 's').reason, ROUTE_REASON.UNMAPPED_ORIGIN);

  const tls = createResolverContext({ sources: [{ id: 's', prefix: 'https://example.com/', root: A }] });
  assert.equal(route(tls, 'x.wrl', 'https://example.com:8443/foo.wrl', 's').reason, ROUTE_REASON.UNMAPPED_ORIGIN);
});

test('canonicalization never merges http and https, and a default port stays scheme-specific', () => {
  const ctx = createResolverContext({
    sources: [
      { id: 'plain', prefix: 'http://example.com/', root: A },
      { id: 'tls', prefix: 'https://example.com/', root: B },
    ],
  });
  assert.deepEqual([...route(ctx, 'x.wrl', 'http://example.com/foo.wrl', 'plain').sourceIds], ['plain']);
  assert.deepEqual([...route(ctx, 'x.wrl', 'https://example.com/foo.wrl', 'plain').sourceIds], ['tls']);
  // 443 is not http's default, so it does NOT collapse onto the http mapping.
  assert.equal(route(ctx, 'x.wrl', 'http://example.com:443/foo.wrl', 'plain').reason, ROUTE_REASON.UNMAPPED_ORIGIN);
  assert.equal(route(ctx, 'x.wrl', 'https://example.com:80/foo.wrl', 'plain').reason, ROUTE_REASON.UNMAPPED_ORIGIN);
});

// ------------------------------------------------------------ prefix precedence

test('the LONGEST configured prefix wins over a broader origin mapping', () => {
  const ctx = createResolverContext({
    sources: [
      { id: 'broad', prefix: 'http://example.com/', root: A },
      { id: 'special', prefix: 'http://example.com/special/', root: B },
    ],
  });
  const broad = route(ctx, 'x.wrl', 'http://example.com/other/foo.wrl', 'broad');
  assert.deepEqual([...broad.sourceIds], ['broad']);
  assert.equal(broad.requestedPath, 'other/foo.wrl');

  const special = route(ctx, 'x.wrl', 'http://example.com/special/foo.wrl', 'broad');
  assert.deepEqual([...special.sourceIds], ['special']);
  assert.equal(special.requestedPath, 'foo.wrl', 'the prefix is stripped, not merely matched');
});

test('prefix matching is segment-aligned: /3d/ never captures /3dx/', () => {
  const ctx = createResolverContext({
    sources: [
      { id: 'root', prefix: 'http://h/', root: A },
      { id: 'three-d', prefix: 'http://h/3d', root: B },
    ],
  });
  assert.deepEqual([...route(ctx, 'x.wrl', 'http://h/3d/a.wrl', 'root').sourceIds], ['three-d']);
  assert.deepEqual([...route(ctx, 'x.wrl', 'http://h/3dx/a.wrl', 'root').sourceIds], ['root']);
});

test('equally-specific mappings become a CANDIDATE SET, not an order-decided winner', () => {
  const ctx = createResolverContext({
    sources: [
      { id: 'first', prefix: 'http://h/', root: A },
      { id: 'second', prefix: 'http://h', root: B },
      { id: 'third', prefix: 'http://h/deeper/', root: C },
    ],
  });
  const r = route(ctx, 'x.wrl', 'http://h/a.wrl', 'first');
  assert.deepEqual([...r.sourceIds], ['first', 'second'], 'both equally-specific mappings are candidates');
  const deep = route(ctx, 'x.wrl', 'http://h/deeper/a.wrl', 'first');
  assert.deepEqual([...deep.sourceIds], ['third'], 'the more specific mapping still wins outright');
});

// ------------------------------------------------------------ root-relative

test('a URL-root-relative reference resolves through the BASE origin, not the disk root', () => {
  const r = route(webCtx, '3d/home/home.wrl', '/externprotos/nurbs.wrl#NurbsSurface');
  assert.equal(r.routed, true);
  assert.equal(r.requestedPath, 'externprotos/nurbs.wrl');
  assert.equal(r.target.origin, 'http://www.cybertown.com');
});

test('a root-relative reference from a base with NO url namespace fails closed', () => {
  const r = route(localCtx, 'sub/home.wrl', '/etc/passwd', 'proj');
  assert.equal(r.routed, false);
  assert.equal(r.status, 'NOT_RETRIEVED_BY_POLICY');
  assert.equal(r.reason, ROUTE_REASON.NO_URL_NAMESPACE_FOR_BASE);
});

test('an absolute-http reference can never route into a prefix-less source', () => {
  const r = route(localCtx, 'sub/home.wrl', 'http://h/x.wrl', 'proj');
  assert.equal(r.routed, false);
  assert.equal(r.reason, ROUTE_REASON.UNMAPPED_ORIGIN);
});

// ------------------------------------------------------------ relative forms

test('relative references resolve against the base DOCUMENT, not a cwd or a root', () => {
  assert.equal(route(webCtx, '3d/home/home.wrl', 'slot.wrl').requestedPath, '3d/home/slot.wrl');
  assert.equal(route(webCtx, '3d/home/home.wrl', './slot.wrl').requestedPath, '3d/home/slot.wrl');
  assert.equal(route(webCtx, '3d/home/home.wrl', '../lib/slot.wrl').requestedPath, '3d/lib/slot.wrl');
  assert.equal(route(webCtx, '3d/home/home.wrl', '../../ent/elevator.wrl').requestedPath, 'ent/elevator.wrl');
  assert.equal(route(webCtx, 'home.wrl', 'a/./b/../c.wrl').requestedPath, 'a/c.wrl');
});

test('a relative reference is RE-ROUTED in URL space and may land in another mapping', () => {
  const ctx = createResolverContext({
    sources: [
      { id: 'homes', prefix: 'http://h/homes/', root: A },
      { id: 'lib', prefix: 'http://h/lib/', root: B },
    ],
  });
  const r = route(ctx, 'user/home.wrl', '../../lib/shared.wrl', 'homes');
  assert.equal(r.routed, true);
  assert.deepEqual([...r.sourceIds], ['lib'], 'leaving one prefix lands in the other mapping, not in the same root');
  assert.equal(r.requestedPath, 'shared.wrl');
});

test('a relative reference that leaves every mapping fails closed', () => {
  const ctx = createResolverContext({ sources: [{ id: 'lib', prefix: 'http://h/lib/', root: A }] });
  const r = route(ctx, 'deep/shared.wrl', '../../other/x.wrl', 'lib');
  assert.equal(r.routed, false);
  assert.equal(r.reason, ROUTE_REASON.UNMAPPED_ORIGIN);
});

// ------------------------------------------- URL parent traversal (correction 2)
// SUPERSEDED POLICY. This lane originally REFUSED an excess `..` in URL space.
// It now clamps at the namespace root, as RFC 3986 and every URL consumer do.
// The invariant being proven is the DISTINCTION, not permissiveness: clamping a
// URL grants no reach, because the result must still match a configured mapping
// and the filesystem layer still enforces root/realpath/symlink/exact-case
// afterwards. The archive-space counterpart below still refuses.

test('URL space: a normal parent walks up one level', () => {
  assert.equal(route(webCtx, 'a/b/world.wrl', '../foo.wrl').requestedPath, 'a/foo.wrl');
});

test('URL space: a root-reaching parent lands exactly at the namespace root', () => {
  assert.equal(route(webCtx, 'a/b/world.wrl', '../../foo.wrl').requestedPath, 'foo.wrl');
});

test('URL space: an EXCESS parent is CLAMPED at the namespace root, not refused', () => {
  for (const written of ['../../../foo.wrl', '../../../../../../foo.wrl']) {
    const r = route(webCtx, 'a/b/world.wrl', written);
    assert.equal(r.routed, true, written);
    assert.equal(r.requestedPath, 'foo.wrl', written);
    assert.equal(r.target.path, '/foo.wrl', written);
  }
});

test('URL space: dot-segments are removed from absolute and root-relative paths too', () => {
  // Before correction 2 these carried `..` straight into an archive lookup.
  assert.equal(route(webCtx, 'home.wrl', 'http://www.cybertown.com/a/../lib/x.wrl').requestedPath, 'lib/x.wrl');
  assert.equal(route(webCtx, 'home.wrl', 'http://www.cybertown.com/../../x.wrl').requestedPath, 'x.wrl');
  assert.equal(route(webCtx, 'home.wrl', '/a/b/../../lib/x.wrl').requestedPath, 'lib/x.wrl');
  assert.equal(route(webCtx, 'home.wrl', '/../../x.wrl').requestedPath, 'x.wrl');
});

test('URL clamping still routes through the configured mapping -- it grants no reach', () => {
  // Clamped to `http://h/etc/passwd`, which is a URL, not a workstation path.
  const ctx = createResolverContext({ sources: [{ id: 'lib', prefix: 'http://h/lib/', root: A }] });
  const escaped = route(ctx, 'deep/world.wrl', '../../../../etc/passwd', 'lib');
  assert.equal(escaped.routed, false, 'the clamped URL leaves the configured prefix');
  assert.equal(escaped.reason, ROUTE_REASON.UNMAPPED_ORIGIN);
  assert.equal(escaped.target.path, '/etc/passwd', 'the URL was resolved, then failed to map');
});

test('an interior empty segment is still refused in URL space, clamping or not', () => {
  assert.equal(route(webCtx, 'home.wrl', 'http://www.cybertown.com/a//b.wrl').reason, ROUTE_REASON.EMPTY_PATH_SEGMENT);
  assert.equal(route(webCtx, 'home.wrl', '/a//b.wrl').reason, ROUTE_REASON.EMPTY_PATH_SEGMENT);
});

test('ARCHIVE space: an above-root parent is REFUSED, never clamped', () => {
  // The counterpart to the URL clamping above, and the reason the two spaces are
  // kept apart: here the root is a FILESYSTEM boundary, and clamping an escape
  // into a legal in-root path is exactly how a traversal becomes a read.
  assert.equal(route(localCtx, 'a/b/world.wrl', '../foo.wrl', 'proj').requestedPath, 'a/foo.wrl');
  assert.equal(route(localCtx, 'a/b/world.wrl', '../../foo.wrl', 'proj').requestedPath, 'foo.wrl');
  for (const written of ['../../../foo.wrl', '../../../../../../foo.wrl', '../../../../etc/passwd']) {
    const r = route(localCtx, 'a/b/world.wrl', written, 'proj');
    assert.equal(r.routed, false, written);
    assert.equal(r.status, 'NOT_RETRIEVED_BY_POLICY', written);
    assert.equal(r.reason, ROUTE_REASON.OUTSIDE_SOURCE_ROOT, written);
  }
});

test('the two spaces disagree ONLY about the excess parent', () => {
  // Same base depth, same written reference, deliberately different verdicts.
  const url = route(webCtx, 'a/b/world.wrl', '../../../foo.wrl');
  const archive = route(localCtx, 'a/b/world.wrl', '../../../foo.wrl', 'proj');
  assert.equal(url.routed, true);
  assert.equal(archive.routed, false);
  // ...and they agree everywhere the parent stays in range.
  assert.equal(route(webCtx, 'a/b/world.wrl', '../foo.wrl').requestedPath,
    route(localCtx, 'a/b/world.wrl', '../foo.wrl', 'proj').requestedPath);
});

test('an empty path segment is refused rather than collapsed', () => {
  const r = route(webCtx, 'home.wrl', 'a//b.wrl');
  assert.equal(r.routed, false);
  assert.equal(r.reason, ROUTE_REASON.EMPTY_PATH_SEGMENT);
});

test('a reference that names a directory retrieves nothing', () => {
  for (const url of ['http://www.cybertown.com/externprotos/', 'lib/', '/externprotos/']) {
    const r = route(webCtx, '3d/home.wrl', url);
    assert.equal(r.routed, false, url);
    assert.equal(r.status, 'NOT_FOUND', url);
    assert.equal(r.reason, ROUTE_REASON.NAMES_NO_FILE, url);
  }
});

test('routing records are frozen', () => {
  const r = route(webCtx, 'home.wrl', 'a.wrl');
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.sourceIds));
});

test('the routing module is pure: no fs, no network', () => {
  const src = require('node:fs').readFileSync(require.resolve('../../src/external-proto/routing'), 'utf8');
  for (const forbidden of ["require('fs')", "require('node:fs')", "require('zlib')", "require('http')", 'fetch(', 'process.cwd']) {
    assert.ok(!src.includes(forbidden), `routing.js must not contain ${forbidden}`);
  }
});
