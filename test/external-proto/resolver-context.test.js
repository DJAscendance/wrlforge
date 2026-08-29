'use strict';
// WD1.7-B -- ResolverContext configuration tests.
//
// The context is the whole of this lane's ambient-state argument: if it can be
// built from nothing, or silently accepts a cwd-relative root, or quietly
// tolerates a `network: true` it does not implement, then every downstream
// guarantee is conditional on configuration nobody checked. So these tests are
// mostly about what construction REFUSES.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createResolverContext, sourceById, DEFAULT_LIMITS } = require('../../src/external-proto/resolver-context');

const ROOT = process.platform === 'win32' ? 'C:\\archive' : '/archive';
const OTHER = process.platform === 'win32' ? 'C:\\other' : '/other';

test('an empty source list is legal and simply retrieves nothing', () => {
  const ctx = createResolverContext({ sources: [] });
  assert.equal(ctx.sources.length, 0);
  assert.equal(ctx.network, false);
});

test('there are NO default sources -- no archive mapping is built in', () => {
  const ctx = createResolverContext({ sources: [] });
  assert.deepEqual([...ctx.sources], []);
  const src = require('node:fs').readFileSync(require.resolve('../../src/external-proto/resolver-context'), 'utf8');
  assert.ok(!/cybertown\.com['"]\s*[,)]/.test(src.replace(/^\s*\/\/.*$/gm, '')),
    'no configured origin literal may appear outside comments');
  assert.ok(!src.includes('/home/'), 'no owner-specific absolute path may appear');
  assert.ok(!src.includes('process.cwd'), 'the context must never consult cwd');
  assert.ok(!src.includes('process.env'), 'the context must never consult the environment');
});

test('a source without a prefix is archive-local and owns no URL namespace', () => {
  const ctx = createResolverContext({ sources: [{ id: 'local', root: ROOT }] });
  assert.equal(ctx.sources[0].origin, null);
  assert.equal(ctx.sources[0].pathPrefix, null);
});

test('an origin prefix normalises to a slash-terminated path prefix', () => {
  const ctx = createResolverContext({
    sources: [
      { id: 'a', prefix: 'http://www.cybertown.com', root: ROOT },
      { id: 'b', prefix: 'http://www.cybertown.com/3d', root: ROOT },
      { id: 'c', prefix: 'HTTP://WWW.Cybertown.COM/3d/', root: ROOT },
    ],
  });
  assert.equal(ctx.sources[0].pathPrefix, '/');
  assert.equal(ctx.sources[1].pathPrefix, '/3d/');
  assert.equal(ctx.sources[2].pathPrefix, '/3d/');
  assert.equal(ctx.sources[2].origin, 'http://www.cybertown.com');
});

test('roots are resolved but MUST be absolute -- a relative root is refused', () => {
  assert.throws(() => createResolverContext({ sources: [{ id: 'a', root: 'archive' }] }), /absolute path/);
  assert.throws(() => createResolverContext({ sources: [{ id: 'a', root: './archive' }] }), /absolute path/);
});

test('duplicate source ids are refused', () => {
  assert.throws(() => createResolverContext({ sources: [{ id: 'a', root: ROOT }, { id: 'a', root: OTHER }] }), /duplicate source id/);
});

test('a configured prefix canonicalizes its default port (correction 1)', () => {
  const ctx = createResolverContext({
    sources: [
      { id: 'http-bare', prefix: 'http://example.com/', root: ROOT },
      { id: 'https-bare', prefix: 'https://other.example/', root: ROOT },
    ],
  });
  assert.equal(ctx.sources[0].origin, 'http://example.com');
  assert.equal(ctx.sources[1].origin, 'https://other.example');

  const explicit = createResolverContext({
    sources: [
      { id: 'http-80', prefix: 'http://example.com:80/', root: ROOT },
      { id: 'https-443', prefix: 'https://other.example:443/', root: ROOT },
      { id: 'http-8080', prefix: 'http://example.com:8080/', root: ROOT },
    ],
  });
  assert.equal(explicit.sources[0].origin, 'http://example.com', 'http :80 is the default');
  assert.equal(explicit.sources[1].origin, 'https://other.example', 'https :443 is the default');
  assert.equal(explicit.sources[2].origin, 'http://example.com:8080', 'a non-default port survives');
});

test('malformed prefixes are refused', () => {
  const bad = [
    'cybertown.com',                 // no scheme
    'ftp://h/',                      // wrong scheme
    'http://',                       // no host
    'http://h/x#frag',               // fragment
    'http://h/x?q=1',                // query
    'http://user@h/',                // userinfo
    'http://h:abc/',                 // bad port
    'http://h:99999/',               // out-of-range port
    'http://h/a//b/',                // empty segment
    'http://h/a/../b/',              // dot segments
    '',
  ];
  for (const prefix of bad) {
    assert.throws(() => createResolverContext({ sources: [{ id: 'a', prefix, root: ROOT }] }), TypeError, `prefix ${JSON.stringify(prefix)} must be refused`);
  }
});

test('network:true is REFUSED rather than ignored', () => {
  assert.throws(() => createResolverContext({ sources: [], network: true }), /network retrieval is not implemented/);
  assert.equal(createResolverContext({ sources: [], network: false }).network, false);
});

test('limits default to the documented policy values and may be overridden', () => {
  const ctx = createResolverContext({ sources: [] });
  assert.deepEqual({ ...ctx.limits }, { ...DEFAULT_LIMITS });
  const custom = createResolverContext({ sources: [], limits: { maxBytes: 10 } });
  assert.equal(custom.limits.maxBytes, 10);
  assert.equal(custom.limits.maxDecodedBytes, DEFAULT_LIMITS.maxDecodedBytes);
});

test('invalid limits are refused', () => {
  for (const limits of [{ maxBytes: 0 }, { maxBytes: -1 }, { maxBytes: 1.5 }, { maxDecodedBytes: NaN }, { maxExpansionRatio: 0.5 }, { maxExpansionRatio: 'x' }]) {
    assert.throws(() => createResolverContext({ sources: [], limits }), TypeError, JSON.stringify(limits));
  }
});

test('the context, its source list and every source entry are frozen', () => {
  const ctx = createResolverContext({ sources: [{ id: 'a', prefix: 'http://h/', root: ROOT }] });
  assert.ok(Object.isFrozen(ctx));
  assert.ok(Object.isFrozen(ctx.sources));
  assert.ok(Object.isFrozen(ctx.sources[0]));
  assert.ok(Object.isFrozen(ctx.limits));
  assert.throws(() => { 'use strict'; ctx.sources[0].root = OTHER; }, TypeError);
  assert.throws(() => { 'use strict'; ctx.limits.maxBytes = 1; }, TypeError);
});

test('the caller-supplied config object is not mutated or retained', () => {
  const config = { sources: [{ id: 'a', root: ROOT }], limits: { maxBytes: 99 } };
  const ctx = createResolverContext(config);
  assert.ok(!Object.isFrozen(config), 'caller-owned config must not be frozen as a side effect');
  assert.ok(!Object.isFrozen(config.sources[0]), 'caller-owned source entries must not be frozen');
  config.sources[0].root = OTHER;
  config.limits.maxBytes = 1;
  assert.notEqual(ctx.sources[0].root, OTHER);
  assert.equal(ctx.limits.maxBytes, 99);
});

test('sources must be an array and entries must be objects', () => {
  assert.throws(() => createResolverContext({}), /sources must be an array/);
  assert.throws(() => createResolverContext({ sources: 'a' }), /sources must be an array/);
  assert.throws(() => createResolverContext({ sources: [null] }), /must be an object/);
  assert.throws(() => createResolverContext({ sources: [{ root: ROOT }] }), /id must be a non-empty string/);
  assert.throws(() => createResolverContext({ sources: [{ id: 'a' }] }), /root must be a non-empty string/);
});

test('sourceById finds a configured source and returns null otherwise', () => {
  const ctx = createResolverContext({ sources: [{ id: 'a', root: ROOT }] });
  assert.equal(sourceById(ctx, 'a').id, 'a');
  assert.equal(sourceById(ctx, 'b'), null);
});
