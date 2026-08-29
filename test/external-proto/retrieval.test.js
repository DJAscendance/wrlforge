'use strict';
// WD1.7-B -- filesystem retrieval tests against small synthetic archive trees.
//
// These are deliberately NOT run against the real corpus: WD1.7-A's archive
// probe is generous by design (host-blind, case-insensitive, longest-suffix) and
// exists to produce an upper bound, so it is the wrong instrument for proving a
// strict substrate. Synthetic trees give independently authored, deterministic
// evidence for the exact boundaries that matter: exact case, root containment
// after symlink resolution, gzip-by-content, bounded decompression, and the
// separation of "refused" from "absent".
//
// Every tree is built here, used here and removed here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const {
  createResolverContext, retrieveExternalCandidate, RETRIEVAL_STATUS, RETRIEVAL_REASON,
} = require('../../src/external-proto');

const HOME = 'PROTO Placeholder [] { Group {} }\n';

// ---------------------------------------------------------------- tree helper

const tmpRoots = [];
function makeTree(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-wd17b-'));
  tmpRoots.push(dir);
  for (const [rel, content] of Object.entries(spec)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}
test.after(() => {
  for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

function ctxFor(root, extra = {}) {
  return createResolverContext({
    sources: [{ id: 'web', prefix: 'http://www.cybertown.com', root }],
    ...extra,
  });
}
function get(context, written, basePath = '3d/home/home.wrl', candidateIndex = 0, deps) {
  return retrieveExternalCandidate(
    { context, baseDocument: { sourceId: 'web', path: basePath }, writtenUrl: written, candidateIndex },
    deps,
  );
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ------------------------------------------------------------------ retrieval

test('an ordinary UTF-8 .wrl is retrieved and decoded', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'externprotos/bxx/shared.wrl': HOME });
  const r = get(ctxFor(root), 'http://www.cybertown.com/externprotos/bxx/shared.wrl#BlaxxunZone');
  assert.equal(r.status, RETRIEVAL_STATUS.RETRIEVED);
  assert.equal(r.reason, null);
  assert.equal(r.text, HOME);
  assert.equal(r.artifact.wasGzipped, false);
  assert.equal(r.artifact.utf8Valid, true);
  assert.equal(r.artifact.rawBytes, Buffer.byteLength(HOME));
});

test('a missing file is NOT_FOUND, and NOT_FOUND is reserved for proven absence', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root' });
  const r = get(ctxFor(root), 'http://www.cybertown.com/externprotos/missing.wrl');
  assert.equal(r.status, RETRIEVAL_STATUS.NOT_FOUND);
  assert.equal(r.reason, RETRIEVAL_REASON.NOT_IN_CONFIGURED_SOURCES);
  assert.equal(r.text, null);
  assert.equal(r.artifact, null);
});

test('a zero-byte file retrieves successfully as empty text', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'lib/empty.wrl': '' });
  const r = get(ctxFor(root), '/lib/empty.wrl');
  assert.equal(r.status, RETRIEVAL_STATUS.RETRIEVED);
  assert.equal(r.text, '');
  assert.equal(r.artifact.rawBytes, 0);
  assert.equal(r.artifact.decodedBytes, 0);
});

test('a directory that exists at the requested path is not a retrievable artifact', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'lib/inner/x.wrl': HOME });
  const r = get(ctxFor(root), '/lib/inner');
  assert.equal(r.status, RETRIEVAL_STATUS.NOT_FOUND);
  assert.equal(r.reason, RETRIEVAL_REASON.NOT_A_REGULAR_FILE);
});

test('relative references resolve against the base document', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', '3d/home/slot.wrl': 'SLOT', '3d/lib/shared.wrl': 'SHARED' });
  assert.equal(get(ctxFor(root), 'slot.wrl').text, 'SLOT');
  assert.equal(get(ctxFor(root), './slot.wrl').text, 'SLOT');
  assert.equal(get(ctxFor(root), '../lib/shared.wrl').text, 'SHARED');
});

// ----------------------------------------------------------------- exact case

test('exact case is required on the LEAF component', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'bxx/shared.wrl': HOME });
  assert.equal(get(ctxFor(root), '/bxx/shared.wrl').status, RETRIEVAL_STATUS.RETRIEVED);
  const wrong = get(ctxFor(root), '/bxx/Shared.WRL');
  assert.equal(wrong.status, RETRIEVAL_STATUS.NOT_FOUND);
  assert.equal(wrong.reason, RETRIEVAL_REASON.CASE_MISMATCH);
  assert.equal(wrong.text, null);
});

test('exact case is required on an INTERMEDIATE directory component', () => {
  // requested: bxx/shared.wrl   archive: BXX/shared.wrl
  const root = makeTree({ '3d/home/home.wrl': 'root', 'BXX/shared.wrl': HOME });
  const r = get(ctxFor(root), '/bxx/shared.wrl');
  assert.equal(r.status, RETRIEVAL_STATUS.NOT_FOUND);
  assert.equal(r.reason, RETRIEVAL_REASON.CASE_MISMATCH);
  assert.equal(r.attempts[0].caseActual, 'BXX/shared.wrl', 'the near-miss is reported, not resolved');
});

test('a case-only near-miss is REPORTED and never silently promoted to a hit', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'lib/Shared.wrl': HOME });
  const r = get(ctxFor(root), '/lib/shared.wrl');
  assert.equal(r.status, RETRIEVAL_STATUS.NOT_FOUND);
  assert.equal(r.attempts[0].caseActual, 'lib/Shared.wrl');
  assert.equal(r.artifact, null);
});

test('a truly absent file is distinguished from a case-only near-miss', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'lib/other.wrl': HOME });
  const r = get(ctxFor(root), '/lib/shared.wrl');
  assert.equal(r.reason, RETRIEVAL_REASON.NOT_IN_CONFIGURED_SOURCES);
  assert.equal(r.attempts[0].caseActual, null);
});

test('a CASE-INSENSITIVE host filesystem cannot change the strict result', () => {
  // Simulates NTFS/APFS: stat/read succeed for any case, but the directory
  // listing (case-preserved on every platform) still says `BXX`.
  const root = makeTree({ '3d/home/home.wrl': 'root', 'BXX/shared.wrl': HOME });
  const insensitive = {
    readdirSync: (d) => fs.readdirSync(realCase(d)),
    realpathSync: (p) => fs.realpathSync(realCase(p)),
    statSync: (p) => fs.statSync(realCase(p)),
    readFileSync: (p) => fs.readFileSync(realCase(p)),
  };
  // Map any-case path onto the real one, exactly as a case-insensitive kernel would.
  function realCase(p) {
    const rel = path.relative(root, path.resolve(p));
    if (rel === '' || rel.startsWith('..')) return p;
    let cur = root;
    for (const seg of rel.split(path.sep)) {
      const hit = fs.readdirSync(cur).find((n) => n.toLowerCase() === seg.toLowerCase());
      cur = path.join(cur, hit || seg);
    }
    return cur;
  }
  // The host would happily open it...
  assert.equal(insensitive.readFileSync(path.join(root, 'bxx/shared.wrl')).toString(), HOME);
  // ...and the substrate still refuses.
  const r = get(ctxFor(root), '/bxx/shared.wrl', '3d/home/home.wrl', 0, insensitive);
  assert.equal(r.status, RETRIEVAL_STATUS.NOT_FOUND);
  assert.equal(r.reason, RETRIEVAL_REASON.CASE_MISMATCH);
});

// ------------------------------------------------------- containment / symlink

test('a symlinked FILE whose target escapes the root is refused', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'lib/keep.wrl': HOME });
  const outside = makeTree({ 'secret.wrl': 'SECRET' });
  fs.symlinkSync(path.join(outside, 'secret.wrl'), path.join(root, 'lib', 'escape.wrl'));
  const r = get(ctxFor(root), '/lib/escape.wrl');
  assert.equal(r.status, RETRIEVAL_STATUS.NOT_RETRIEVED_BY_POLICY);
  assert.equal(r.reason, RETRIEVAL_REASON.SYMLINK_ESCAPE);
  assert.equal(r.text, null);
});

test('a symlinked DIRECTORY whose target escapes the root is refused', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root' });
  const outside = makeTree({ 'inner/secret.wrl': 'SECRET' });
  fs.symlinkSync(path.join(outside, 'inner'), path.join(root, 'linked'));
  const r = get(ctxFor(root), '/linked/secret.wrl');
  assert.equal(r.status, RETRIEVAL_STATUS.NOT_RETRIEVED_BY_POLICY);
  assert.equal(r.reason, RETRIEVAL_REASON.SYMLINK_ESCAPE);
});

test('a NESTED symlink chain that escapes is refused', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root' });
  const mid = makeTree({});
  const outside = makeTree({ 'secret.wrl': 'SECRET' });
  fs.symlinkSync(path.join(outside, 'secret.wrl'), path.join(mid, 'hop.wrl'));
  fs.symlinkSync(path.join(mid, 'hop.wrl'), path.join(root, 'escape.wrl'));
  const r = get(ctxFor(root), '/escape.wrl');
  assert.equal(r.status, RETRIEVAL_STATUS.NOT_RETRIEVED_BY_POLICY);
  assert.equal(r.reason, RETRIEVAL_REASON.SYMLINK_ESCAPE);
});

test('a symlink that stays INSIDE the root is allowed', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'real/shared.wrl': HOME });
  fs.symlinkSync(path.join(root, 'real', 'shared.wrl'), path.join(root, 'alias.wrl'));
  const r = get(ctxFor(root), '/alias.wrl');
  assert.equal(r.status, RETRIEVAL_STATUS.RETRIEVED);
  assert.equal(r.text, HOME);
});

test('a configured root that IS a symlink still works', () => {
  const real = makeTree({ '3d/home/home.wrl': 'root', 'lib/shared.wrl': HOME });
  const holder = makeTree({});
  const linkRoot = path.join(holder, 'archive');
  fs.symlinkSync(real, linkRoot);
  const r = get(ctxFor(linkRoot), '/lib/shared.wrl');
  assert.equal(r.status, RETRIEVAL_STATUS.RETRIEVED);
});

test('a sibling root sharing a path PREFIX is not inside the root', () => {
  // `/x/foobar` startsWith `/x/foo` -- a prefix test would wrongly allow this.
  const holder = makeTree({ 'foo/3d/home/home.wrl': 'root', 'foobar/secret.wrl': 'SECRET' });
  const root = path.join(holder, 'foo');
  fs.symlinkSync(path.join(holder, 'foobar', 'secret.wrl'), path.join(root, 'peek.wrl'));
  const r = get(ctxFor(root), '/peek.wrl');
  assert.equal(r.status, RETRIEVAL_STATUS.NOT_RETRIEVED_BY_POLICY);
  assert.equal(r.reason, RETRIEVAL_REASON.SYMLINK_ESCAPE);
});

test('a clamped URL "../" stays a URL -- the lookup happens INSIDE the configured root', () => {
  // WD1.7-B correction 2. `../../../../etc/passwd` from `3d/home/home.wrl`
  // clamps to the URL `http://www.cybertown.com/etc/passwd`, which maps into the
  // configured archive. The decisive proof is the DECOY: the substrate returns
  // the archive's own `etc/passwd`, never the workstation's.
  const root = makeTree({ '3d/home/home.wrl': 'root', 'etc/passwd': 'ARCHIVE DECOY' });
  const r = get(ctxFor(root), '../../../../etc/passwd');
  assert.equal(r.status, RETRIEVAL_STATUS.RETRIEVED);
  assert.equal(r.requestedPath, 'etc/passwd');
  assert.equal(r.text, 'ARCHIVE DECOY', 'the configured root answered, not the host filesystem');
  assert.ok(!r.text.includes('root:'), 'the workstation /etc/passwd was not read');
});

test('a clamped URL that leaves every configured mapping fails closed', () => {
  const root = makeTree({ 'lib/deep/world.wrl': 'root', 'etc/passwd': 'ARCHIVE DECOY' });
  const ctx = createResolverContext({ sources: [{ id: 'web', prefix: 'http://h/lib/', root }] });
  const r = retrieveExternalCandidate({
    context: ctx, baseDocument: { sourceId: 'web', path: 'deep/world.wrl' },
    writtenUrl: '../../../../etc/passwd', candidateIndex: 0,
  });
  assert.equal(r.status, RETRIEVAL_STATUS.NOT_RETRIEVED_BY_POLICY);
  assert.equal(r.reason, 'unmapped-origin');
  assert.deepEqual([...r.attempts], [], 'no source was even attempted');
  assert.equal(r.text, null);
});

test('an ARCHIVE-LOCAL "../" escape is refused before any filesystem access', () => {
  const root = makeTree({ 'a/b/world.wrl': 'root', 'etc/passwd': 'ARCHIVE DECOY' });
  const ctx = createResolverContext({ sources: [{ id: 'proj', root }] });
  const r = retrieveExternalCandidate({
    context: ctx, baseDocument: { sourceId: 'proj', path: 'a/b/world.wrl' },
    writtenUrl: '../../../../etc/passwd', candidateIndex: 0,
  });
  assert.equal(r.status, RETRIEVAL_STATUS.NOT_RETRIEVED_BY_POLICY);
  assert.equal(r.reason, 'outside-source-root');
  assert.deepEqual([...r.attempts], [], 'no source was even attempted');
  assert.equal(r.text, null, 'clamping must NOT turn an archive escape into a legal in-root read');
});

test('a default-port spelling difference retrieves the same artifact', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'lib/shared.wrl': HOME });
  const ctx = ctxFor(root);
  const bare = get(ctx, 'http://www.cybertown.com/lib/shared.wrl');
  const ported = get(ctx, 'http://www.cybertown.com:80/lib/shared.wrl');
  assert.equal(bare.status, RETRIEVAL_STATUS.RETRIEVED);
  assert.equal(ported.status, RETRIEVAL_STATUS.RETRIEVED);
  assert.equal(bare.artifact.decodedContentHash, ported.artifact.decodedContentHash);
  assert.equal(ported.target.origin, 'http://www.cybertown.com', 'the canonical origin is what evidence records');
});

// ------------------------------------------------------------------ I/O errors

test('an unreadable artifact is UNREADABLE_ARTIFACT, never NOT_FOUND', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'lib/locked.wrl': HOME });
  const denying = {
    readdirSync: (d) => fs.readdirSync(d),
    realpathSync: (p) => fs.realpathSync(p),
    statSync: (p) => fs.statSync(p),
    readFileSync: () => { const e = new Error('permission denied'); e.code = 'EACCES'; throw e; },
  };
  const r = get(ctxFor(root), '/lib/locked.wrl', '3d/home/home.wrl', 0, denying);
  assert.equal(r.status, RETRIEVAL_STATUS.UNREADABLE_ARTIFACT);
  assert.equal(r.reason, RETRIEVAL_REASON.ARTIFACT_READ_FAILED);
});

test('an unreadable DIRECTORY is UNREADABLE_ARTIFACT; a missing one is absence', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'lib/x.wrl': HOME });
  const denyDir = {
    readdirSync: (d) => { if (path.basename(d) === 'lib') { const e = new Error('denied'); e.code = 'EACCES'; throw e; } return fs.readdirSync(d); },
    realpathSync: (p) => fs.realpathSync(p),
    statSync: (p) => fs.statSync(p),
    readFileSync: (p) => fs.readFileSync(p),
  };
  const r = get(ctxFor(root), '/lib/x.wrl', '3d/home/home.wrl', 0, denyDir);
  assert.equal(r.status, RETRIEVAL_STATUS.UNREADABLE_ARTIFACT);
  assert.equal(r.reason, RETRIEVAL_REASON.DIRECTORY_UNREADABLE);
  assert.equal(get(ctxFor(root), '/nope/x.wrl').status, RETRIEVAL_STATUS.NOT_FOUND);
});

// ----------------------------------------------------------------------- gzip

test('gzip is detected by MAGIC BYTES, whatever the file is named', () => {
  const gz = zlib.gzipSync(Buffer.from(HOME));
  const root = makeTree({
    '3d/home/home.wrl': 'root',
    'a/plain.wrl': HOME,          // plain content, plain name
    'a/hidden.wrl': gz,           // gzip content behind a plain .wrl name (31.45% of the corpus)
    'a/announced.gz': gz,         // gzip content, gzip name
    'a/lying.gz': HOME,           // plain content, gzip name
    'a/odd.png': gz,              // gzip content, unexpected extension
  });
  const ctx = ctxFor(root);
  assert.equal(get(ctx, '/a/plain.wrl').artifact.wasGzipped, false);
  assert.equal(get(ctx, '/a/hidden.wrl').artifact.wasGzipped, true);
  assert.equal(get(ctx, '/a/announced.gz').artifact.wasGzipped, true);
  assert.equal(get(ctx, '/a/lying.gz').artifact.wasGzipped, false);
  assert.equal(get(ctx, '/a/odd.png').artifact.wasGzipped, true);
  for (const p of ['/a/plain.wrl', '/a/hidden.wrl', '/a/announced.gz', '/a/lying.gz', '/a/odd.png']) {
    assert.equal(get(ctx, p).text, HOME, p);
  }
});

test('a gzip/plain twin shares decoded identity but not artifact identity', () => {
  const gz = zlib.gzipSync(Buffer.from(HOME));
  const root = makeTree({ '3d/home/home.wrl': 'root', 'a/twin.wrl': HOME, 'a/twin.wrz': gz });
  const ctx = ctxFor(root);
  const plain = get(ctx, '/a/twin.wrl');
  const zipped = get(ctx, '/a/twin.wrz');
  assert.equal(plain.artifact.decodedContentHash, zipped.artifact.decodedContentHash);
  assert.notEqual(plain.artifact.retrievedBytesHash, zipped.artifact.retrievedBytesHash);
  assert.equal(plain.artifact.retrievedBytesHash, plain.artifact.decodedContentHash, 'plain bytes are their own decoding');
});

test('malformed gzip is DECODE_FAILED, distinct from every size limit', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'a/broken.wrl': Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02]) });
  const r = get(ctxFor(root), '/a/broken.wrl');
  assert.equal(r.status, RETRIEVAL_STATUS.DECODE_FAILED);
  assert.equal(r.reason, RETRIEVAL_REASON.GZIP_INFLATE_FAILED);
  assert.equal(r.text, null);
});

test('invalid UTF-8 is reported, not silently equated with valid text', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'a/bad.wrl': Buffer.from([0x41, 0xff, 0xfe, 0x42]) });
  const r = get(ctxFor(root), '/a/bad.wrl');
  assert.equal(r.status, RETRIEVAL_STATUS.RETRIEVED, 'established project decoding behaviour is preserved');
  assert.equal(r.artifact.utf8Valid, false);
  assert.ok(r.text.includes('�'));
});

// --------------------------------------------------------------------- limits

test('raw bytes exactly at the limit succeed; one byte over is LIMIT_EXCEEDED', () => {
  const body = 'x'.repeat(100);
  const root = makeTree({ '3d/home/home.wrl': 'root', 'a/at.wrl': body, 'a/over.wrl': `${body}y` });
  const ctx = ctxFor(root, { limits: { maxBytes: 100 } });
  assert.equal(get(ctx, '/a/at.wrl').status, RETRIEVAL_STATUS.RETRIEVED);
  const over = get(ctx, '/a/over.wrl');
  assert.equal(over.status, RETRIEVAL_STATUS.LIMIT_EXCEEDED);
  assert.equal(over.reason, RETRIEVAL_REASON.RAW_BYTES_LIMIT);
});

test('decoded bytes exactly at the limit succeed; one over is LIMIT_EXCEEDED', () => {
  const at = zlib.gzipSync(Buffer.alloc(100, 0x41));
  const over = zlib.gzipSync(Buffer.alloc(101, 0x41));
  const root = makeTree({ '3d/home/home.wrl': 'root', 'a/at.wrl': at, 'a/over.wrl': over });
  const ctx = ctxFor(root, { limits: { maxDecodedBytes: 100, maxExpansionRatio: 10000 } });
  assert.equal(get(ctx, '/a/at.wrl').status, RETRIEVAL_STATUS.RETRIEVED);
  const r = get(ctx, '/a/over.wrl');
  assert.equal(r.status, RETRIEVAL_STATUS.LIMIT_EXCEEDED);
  assert.equal(r.reason, RETRIEVAL_REASON.DECODED_BYTES_LIMIT);
});

test('an uncompressed file over the decoded limit is LIMIT_EXCEEDED too', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'a/big.wrl': 'x'.repeat(200) });
  const ctx = ctxFor(root, { limits: { maxBytes: 1000, maxDecodedBytes: 100 } });
  const r = get(ctx, '/a/big.wrl');
  assert.equal(r.status, RETRIEVAL_STATUS.LIMIT_EXCEEDED);
  assert.equal(r.reason, RETRIEVAL_REASON.DECODED_BYTES_LIMIT);
});

test('the expansion ratio bounds a gzip bomb whose compressed size is tiny', () => {
  const bomb = zlib.gzipSync(Buffer.alloc(2 * 1024 * 1024, 0x41));
  const root = makeTree({ '3d/home/home.wrl': 'root', 'a/bomb.wrl': bomb });
  assert.ok(bomb.length < 4096, 'the compressed input must be small to make the point');
  const ctx = ctxFor(root, { limits: { maxDecodedBytes: 64 * 1024 * 1024, maxExpansionRatio: 10 } });
  const r = get(ctx, '/a/bomb.wrl');
  assert.equal(r.status, RETRIEVAL_STATUS.LIMIT_EXCEEDED);
  assert.equal(r.reason, RETRIEVAL_REASON.EXPANSION_RATIO_LIMIT);
  assert.equal(r.text, null);
});

test('a ratio under the limit is retrieved', () => {
  const gz = zlib.gzipSync(Buffer.from(HOME));
  const root = makeTree({ '3d/home/home.wrl': 'root', 'a/ok.wrl': gz });
  const ctx = ctxFor(root, { limits: { maxExpansionRatio: 1000 } });
  const r = get(ctx, '/a/ok.wrl');
  assert.equal(r.status, RETRIEVAL_STATUS.RETRIEVED);
  assert.ok(r.artifact.decodedBytes / r.artifact.rawBytes <= 1000);
});

test('a small valid gzip inside every bound is retrieved', () => {
  const gz = zlib.gzipSync(Buffer.from('PROTO A [] {}\n'));
  const root = makeTree({ '3d/home/home.wrl': 'root', 'a/s.wrl': gz });
  assert.equal(get(ctxFor(root), '/a/s.wrl').text, 'PROTO A [] {}\n');
});

// ---------------------------------------------------- multiple configured sources

function twoSourceCtx(rootA, rootB) {
  return createResolverContext({
    sources: [
      { id: 'a', prefix: 'http://h/', root: rootA },
      { id: 'b', prefix: 'http://h/', root: rootB },
    ],
  });
}

test('two sources with IDENTICAL decoded content are one artifact -- and both are recorded', () => {
  const ra = makeTree({ 'base.wrl': 'root', 'shared/foo.wrl': HOME });
  const rb = makeTree({ 'shared/foo.wrl': zlib.gzipSync(Buffer.from(HOME)) });
  const ctx = twoSourceCtx(ra, rb);
  const r = retrieveExternalCandidate({ context: ctx, baseDocument: { sourceId: 'a', path: 'base.wrl' }, writtenUrl: 'http://h/shared/foo.wrl', candidateIndex: 0 });
  assert.equal(r.status, RETRIEVAL_STATUS.RETRIEVED);
  assert.equal(r.artifact.evidenceSourceId, 'a');
  assert.equal(r.matches.length, 2, 'location provenance is NOT collapsed by equal content');
  assert.deepEqual(r.matches.map((m) => m.evidenceSourceId), ['a', 'b']);
  assert.equal(r.matches[0].wasGzipped, false);
  assert.equal(r.matches[1].wasGzipped, true);
  assert.equal(r.matches[0].decodedContentHash, r.matches[1].decodedContentHash);
});

test('two sources with DIFFERENT content are AMBIGUOUS_SOURCE, never a picked winner', () => {
  const ra = makeTree({ 'base.wrl': 'root', 'shared/foo.wrl': 'CONTENT A' });
  const rb = makeTree({ 'shared/foo.wrl': 'CONTENT B' });
  const ctx = twoSourceCtx(ra, rb);
  const r = retrieveExternalCandidate({ context: ctx, baseDocument: { sourceId: 'a', path: 'base.wrl' }, writtenUrl: 'http://h/shared/foo.wrl', candidateIndex: 0 });
  assert.equal(r.status, RETRIEVAL_STATUS.AMBIGUOUS_SOURCE);
  assert.equal(r.reason, RETRIEVAL_REASON.MULTIPLE_SOURCES_DIFFERING_CONTENT);
  assert.equal(r.artifact, null);
  assert.equal(r.text, null, 'an ambiguous candidate yields no content');
  assert.equal(r.matches.length, 2);
});

test('one source answering and one absent is unambiguous', () => {
  const ra = makeTree({ 'base.wrl': 'root' });
  const rb = makeTree({ 'shared/foo.wrl': HOME });
  const ctx = twoSourceCtx(ra, rb);
  const r = retrieveExternalCandidate({ context: ctx, baseDocument: { sourceId: 'a', path: 'base.wrl' }, writtenUrl: 'http://h/shared/foo.wrl', candidateIndex: 0 });
  assert.equal(r.status, RETRIEVAL_STATUS.RETRIEVED);
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].evidenceSourceId, 'b');
});

test('an undecodable candidate source is terminal even when another source succeeded', () => {
  const ra = makeTree({ 'base.wrl': 'root', 'shared/foo.wrl': Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01]) });
  const rb = makeTree({ 'shared/foo.wrl': HOME });
  const ctx = twoSourceCtx(ra, rb);
  const r = retrieveExternalCandidate({ context: ctx, baseDocument: { sourceId: 'a', path: 'base.wrl' }, writtenUrl: 'http://h/shared/foo.wrl', candidateIndex: 0 });
  assert.equal(r.status, RETRIEVAL_STATUS.DECODE_FAILED, 'content that cannot be compared cannot be called unambiguous');
  assert.equal(r.text, null);
});

// ----------------------------------------------------------------- provenance

test('provenance is complete, reproducible and host-private', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'externprotos/bxx/shared.wrl': HOME });
  const written = '  http://www.cybertown.com/externprotos/bxx/shared.wrl#BlaxxunZone  ';
  const r = get(ctxFor(root), written, '3d/home/home.wrl', 3);
  assert.equal(r.candidateIndex, 3);
  assert.equal(r.writtenUrl, written, 'the written spelling is preserved verbatim');
  assert.equal(r.reference.form, 'absolute-http');
  assert.equal(r.reference.fragment, 'BlaxxunZone', 'carried, never interpreted');
  assert.deepEqual({ ...r.base }, { sourceId: 'web', path: '3d/home/home.wrl' });
  assert.equal(r.artifact.evidenceSourceId, 'web');
  assert.equal(r.artifact.artifactPath, 'externprotos/bxx/shared.wrl');
  assert.equal(r.artifact.retrievedBytesHash, sha(Buffer.from(HOME)));
  assert.equal(r.artifact.decodedContentHash, sha(Buffer.from(HOME)));
  assert.deepEqual({ ...r.target }, { origin: 'http://www.cybertown.com', path: '/externprotos/bxx/shared.wrl' });

  // No absolute host path anywhere in the evidence.
  const json = JSON.stringify(r);
  assert.ok(!json.includes(root), 'the configured root must not leak into the result');
  assert.ok(!json.includes(os.tmpdir()), 'no host-absolute path may appear in the result');
});

test('hashes are deterministic across repeated retrievals', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'a/x.wrl': HOME });
  const a = get(ctxFor(root), '/a/x.wrl');
  const b = get(ctxFor(root), '/a/x.wrl');
  assert.equal(a.artifact.decodedContentHash, b.artifact.decodedContentHash);
  assert.equal(a.artifact.retrievedBytesHash, b.artifact.retrievedBytesHash);
});

test('unroutable and refused candidates still carry full identity provenance', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root' });
  const ctx = ctxFor(root);
  const urn = get(ctx, 'urn:inet:blaxxun.com:node:HUD', '3d/home/home.wrl', 0);
  assert.equal(urn.status, RETRIEVAL_STATUS.UNSUPPORTED_REFERENCE);
  assert.equal(urn.reason, 'urn-not-retrievable');
  assert.equal(urn.candidateIndex, 0);
  assert.equal(urn.writtenUrl, 'urn:inet:blaxxun.com:node:HUD');
  assert.deepEqual({ ...urn.base }, { sourceId: 'web', path: '3d/home/home.wrl' });

  const empty = get(ctx, '', '3d/home/home.wrl', 1);
  assert.equal(empty.status, RETRIEVAL_STATUS.UNSUPPORTED_REFERENCE);
  assert.equal(empty.reason, 'empty-reference');
  assert.equal(empty.requestedPath, null, 'an empty candidate becomes no path at all');
  assert.equal(empty.text, null);
});

// ---------------------------------------------------------------- immutability

test('the result and every nested structure are frozen', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'a/x.wrl': HOME });
  const r = get(ctxFor(root), '/a/x.wrl');
  for (const o of [r, r.reference, r.base, r.target, r.artifact, r.matches, r.matches[0], r.attempts, r.attempts[0], r.consideredSourceIds]) {
    assert.ok(Object.isFrozen(o), 'every exposed structure must be frozen');
  }
  assert.throws(() => { 'use strict'; r.status = 'RESOLVED'; }, TypeError);
});

test('no raw Buffer is exposed on the public result', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root', 'a/x.wrl': HOME });
  const r = get(ctxFor(root), '/a/x.wrl');
  const walk = (v, seen = new Set()) => {
    if (v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    assert.ok(!Buffer.isBuffer(v), 'mutable raw bytes must not be returned');
    for (const k of Object.keys(v)) walk(v[k], seen);
  };
  walk(r);
});

// -------------------------------------------------------------- input guards

test('candidateIndex and context are validated rather than guessed', () => {
  const root = makeTree({ '3d/home/home.wrl': 'root' });
  const ctx = ctxFor(root);
  const bd = { sourceId: 'web', path: '3d/home/home.wrl' };
  assert.throws(() => retrieveExternalCandidate({ context: ctx, baseDocument: bd, writtenUrl: 'a.wrl' }), /candidateIndex/);
  assert.throws(() => retrieveExternalCandidate({ context: ctx, baseDocument: bd, writtenUrl: 'a.wrl', candidateIndex: -1 }), /candidateIndex/);
  assert.throws(() => retrieveExternalCandidate({ context: ctx, baseDocument: bd, writtenUrl: 'a.wrl', candidateIndex: 1.5 }), /candidateIndex/);
  assert.throws(() => retrieveExternalCandidate({ context: {}, baseDocument: bd, writtenUrl: 'a.wrl', candidateIndex: 0 }), /ResolverContext/);
});
