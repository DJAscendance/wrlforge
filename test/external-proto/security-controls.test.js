'use strict';
// WD1.7-B -- security mutation controls.
//
// A retrieval substrate driven by untrusted document content fails SILENTLY when
// it fails: a weakened containment check does not throw, it just returns bytes it
// should never have read. A green suite is therefore not evidence on its own --
// the evidence is that a specific weakening makes a specific assertion go red.
//
// Each control below copies the lane's four modules into a scratch directory,
// applies ONE textual mutation, and proves two things:
//
//   * the mutation is LIVE -- the mutated build produces the dangerous answer,
//     so the control is not testing a no-op;
//   * the real build produces the safe answer.
//
// Nothing in the repository is modified: the mutants exist only under a temp
// directory that is removed when the file finishes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const real = require('../../src/external-proto');

const SRC = path.join(__dirname, '..', '..', 'src');
const MODULES = ['index.js', 'reference-forms.js', 'resolver-context.js', 'routing.js', 'retrieval.js', 'url-origin.js'];
const scratch = [];

test.after(() => {
  for (const d of scratch) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

// Copy the lane (plus the one production module it reuses, the gzip magic-byte
// authority) into a scratch tree and mutate exactly one file.
function mutantBuild(file, from, to) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-wd17b-mutant-'));
  scratch.push(dir);
  fs.mkdirSync(path.join(dir, 'external-proto'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
  fs.copyFileSync(path.join(SRC, 'files', 'vrml-file.js'), path.join(dir, 'files', 'vrml-file.js'));
  for (const m of MODULES) fs.copyFileSync(path.join(SRC, 'external-proto', m), path.join(dir, 'external-proto', m));
  const target = path.join(dir, 'external-proto', file);
  const before = fs.readFileSync(target, 'utf8');
  assert.ok(before.includes(from), `mutation anchor not found in ${file}: ${from}`);
  fs.writeFileSync(target, before.replace(from, to));
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(path.join(dir, 'external-proto', 'index.js'));
}

const tmpTrees = [];
function makeTree(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-wd17b-ctl-'));
  tmpTrees.push(dir);
  scratch.push(dir);
  for (const [rel, content] of Object.entries(spec)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}
function run(build, ctxConfig, written, basePath = 'base.wrl', baseSourceId = 'web') {
  const context = build.createResolverContext(ctxConfig);
  return build.retrieveExternalCandidate({
    context, baseDocument: { sourceId: baseSourceId, path: basePath }, writtenUrl: written, candidateIndex: 0,
  });
}

// CONTROL 1 -----------------------------------------------------------------
// failure mode: a symlink inside a configured root reads a file outside it.
// mutation:     remove the post-realpath containment check.
// expected:     real build refuses; mutant leaks the outside file.
test('CONTROL 1 -- removing the realpath containment check leaks an outside file', () => {
  const root = makeTree({ 'base.wrl': 'root' });
  const outside = makeTree({ 'secret.wrl': 'TOP SECRET' });
  fs.symlinkSync(path.join(outside, 'secret.wrl'), path.join(root, 'escape.wrl'));
  const cfg = { sources: [{ id: 'web', prefix: 'http://h/', root }] };

  const mutant = mutantBuild('retrieval.js', 'if (!isInside(realRoot, realTarget)) {', 'if (false) {');
  const leaked = run(mutant, cfg, '/escape.wrl');
  assert.equal(leaked.status, 'RETRIEVED', 'mutation must be live');
  assert.equal(leaked.text, 'TOP SECRET');

  const safe = run(real, cfg, '/escape.wrl');
  assert.equal(safe.status, real.RETRIEVAL_STATUS.NOT_RETRIEVED_BY_POLICY);
  assert.equal(safe.reason, real.RETRIEVAL_REASON.SYMLINK_ESCAPE);
  assert.equal(safe.text, null);
});

// CONTROL 2 -----------------------------------------------------------------
// failure mode: strict results vary with host filesystem case behaviour, so a
//               reference resolves on NTFS/APFS and dies on ext4.
// mutation:     make the per-component lookup case-insensitive (the shape
//               `existsSync` gives you for free on a case-insensitive volume).
test('CONTROL 2 -- a case-insensitive lookup silently resolves a wrong-case reference', () => {
  const root = makeTree({ 'base.wrl': 'root', 'BXX/shared.wrl': 'LIBRARY' });
  const cfg = { sources: [{ id: 'web', prefix: 'http://h/', root }] };

  // The mutant accepts a case-only sibling AND walks into it -- precisely the
  // behaviour a case-insensitive host gives `existsSync` for free.
  const mutant = mutantBuild(
    'retrieval.js',
    '    if (listing.includes(seg)) {\n      walked.push(seg);\n      cur = nodePath.join(cur, seg);\n      continue;\n    }',
    '    const loose = listing.find((n) => n.toLowerCase() === seg.toLowerCase());\n    if (loose) {\n      walked.push(loose);\n      cur = nodePath.join(cur, loose);\n      continue;\n    }',
  );
  const loose = run(mutant, cfg, '/bxx/shared.wrl');
  assert.equal(loose.status, 'RETRIEVED', 'mutation must be live');

  const safe = run(real, cfg, '/bxx/shared.wrl');
  assert.equal(safe.status, real.RETRIEVAL_STATUS.NOT_FOUND);
  assert.equal(safe.reason, real.RETRIEVAL_REASON.CASE_MISMATCH);
});

// CONTROL 3 -----------------------------------------------------------------
// failure mode: the host is stripped and one generic archive answers every
//               origin -- WD1.7-A §15.1's rejected "first match wins".
// mutation:     drop the origin equality test in mapping.
test('CONTROL 3 -- stripping the HTTP origin makes an unmapped host resolve', () => {
  const root = makeTree({ 'base.wrl': 'root', 'shared/foo.wrl': 'CYBERTOWN COPY' });
  const cfg = { sources: [{ id: 'web', prefix: 'http://www.cybertown.com/', root }] };

  const mutant = mutantBuild('routing.js', 'if (s.origin === null || s.origin !== origin) continue;', 'if (s.origin === null) continue;');
  const wrong = run(mutant, cfg, 'http://objects.cybertown.com/shared/foo.wrl');
  assert.equal(wrong.status, 'RETRIEVED', 'mutation must be live');
  assert.equal(wrong.text, 'CYBERTOWN COPY', 'a different namespace answered');

  const safe = run(real, cfg, 'http://objects.cybertown.com/shared/foo.wrl');
  assert.equal(safe.status, real.RETRIEVAL_STATUS.NOT_RETRIEVED_BY_POLICY);
  assert.equal(safe.reason, 'unmapped-origin');
});

// CONTROL 4 -----------------------------------------------------------------
// failure mode: compression decided by anything other than the magic bytes.
//               6,462 corpus files are gzip behind a plain `.wrl` name.
// mutation:     disable content sniffing.
test('CONTROL 4 -- not sniffing gzip magic returns binary garbage as VRML source', () => {
  const body = 'PROTO Ball [] { Sphere {} }\n';
  const root = makeTree({ 'base.wrl': 'root', 'lib/hidden.wrl': zlib.gzipSync(Buffer.from(body)) });
  const cfg = { sources: [{ id: 'web', prefix: 'http://h/', root }] };

  const mutant = mutantBuild('retrieval.js', 'const wasGzipped = isGzip(raw);', 'const wasGzipped = false;');
  const garbage = run(mutant, cfg, '/lib/hidden.wrl');
  assert.equal(garbage.status, 'RETRIEVED', 'mutation must be live');
  assert.notEqual(garbage.text, body, 'the mutant hands a parser compressed bytes');

  const safe = run(real, cfg, '/lib/hidden.wrl');
  assert.equal(safe.text, body);
  assert.equal(safe.artifact.wasGzipped, true);
});

// CONTROL 5 -----------------------------------------------------------------
// failure mode: a few KB of hostile input expands without bound in memory.
// mutation:     remove the cap handed to zlib.
test('CONTROL 5 -- removing the decompression bound lets a small input expand without limit', () => {
  const bomb = zlib.gzipSync(Buffer.alloc(4 * 1024 * 1024, 0x41));
  const root = makeTree({ 'base.wrl': 'root', 'lib/bomb.wrl': bomb });
  const cfg = {
    sources: [{ id: 'web', prefix: 'http://h/', root }],
    limits: { maxDecodedBytes: 64 * 1024 * 1024, maxExpansionRatio: 4 },
  };

  const mutant = mutantBuild('retrieval.js', 'zlib.gunzipSync(raw, { maxOutputLength: cap })', 'zlib.gunzipSync(raw)');
  const unbounded = run(mutant, cfg, '/lib/bomb.wrl');
  assert.equal(unbounded.status, 'RETRIEVED', 'mutation must be live');
  assert.equal(unbounded.text.length, 4 * 1024 * 1024, 'the mutant expands the whole bomb');

  const safe = run(real, cfg, '/lib/bomb.wrl');
  assert.equal(safe.status, real.RETRIEVAL_STATUS.LIMIT_EXCEEDED);
  assert.equal(safe.reason, real.RETRIEVAL_REASON.EXPANSION_RATIO_LIMIT);
  assert.equal(safe.text, null);
});

// CONTROL 6 -----------------------------------------------------------------
// failure mode: a policy refusal is reported as a factual absence, so a UI tells
//               the user a library is missing when nothing was ever looked for.
// mutation:     collapse NOT_RETRIEVED_BY_POLICY into NOT_FOUND.
test('CONTROL 6 -- collapsing NOT_RETRIEVED_BY_POLICY into NOT_FOUND asserts an unproven absence', () => {
  const root = makeTree({ 'base.wrl': 'root' });
  const cfg = { sources: [{ id: 'web', prefix: 'http://h/', root }] };

  const mutant = mutantBuild('routing.js', "return refuse('NOT_RETRIEVED_BY_POLICY', ROUTE_REASON.UNMAPPED_ORIGIN", "return refuse('NOT_FOUND', ROUTE_REASON.UNMAPPED_ORIGIN");
  const lying = run(mutant, cfg, 'http://elsewhere.example/x.wrl');
  assert.equal(lying.status, 'NOT_FOUND', 'mutation must be live');

  const safe = run(real, cfg, 'http://elsewhere.example/x.wrl');
  assert.equal(safe.status, real.RETRIEVAL_STATUS.NOT_RETRIEVED_BY_POLICY);
  assert.notEqual(safe.status, real.RETRIEVAL_STATUS.NOT_FOUND);
});

// CONTROL 7 -----------------------------------------------------------------
// failure mode: two archives disagree about one URL and the substrate silently
//               picks one -- exactly the heuristic WD1.7-A §11 rejects.
// mutation:     take the first hit instead of comparing decoded content.
test('CONTROL 7 -- picking the first hit hides a genuine source ambiguity', () => {
  const a = makeTree({ 'base.wrl': 'root', 'shared/foo.wrl': 'CONTENT A' });
  const b = makeTree({ 'shared/foo.wrl': 'CONTENT B' });
  const cfg = { sources: [{ id: 'web', prefix: 'http://h/', root: a }, { id: 'alt', prefix: 'http://h/', root: b }] };

  const mutant = mutantBuild('retrieval.js', 'if (distinct.size > 1) {', 'if (false) {');
  const picked = run(mutant, cfg, 'http://h/shared/foo.wrl');
  assert.equal(picked.status, 'RETRIEVED', 'mutation must be live');
  assert.equal(picked.text, 'CONTENT A');

  const safe = run(real, cfg, 'http://h/shared/foo.wrl');
  assert.equal(safe.status, real.RETRIEVAL_STATUS.AMBIGUOUS_SOURCE);
  assert.equal(safe.text, null);
});

// CONTROL 8 -----------------------------------------------------------------
// failure mode: a URL-root-relative `/etc/passwd` is read as a workstation path.
// mutation:     resolve a root-relative reference against the base's own source
//               root without requiring a configured URL namespace.
test('CONTROL 8 -- a root-relative reference must never become a workstation path', () => {
  const root = makeTree({ 'base.wrl': 'root', 'etc/passwd': 'NOT THE REAL ONE' });
  const cfg = { sources: [{ id: 'web', root }] };            // archive-local, no URL namespace

  const mutant = mutantBuild(
    'routing.js',
    "    if (source.origin === null) {\n      return refuse('NOT_RETRIEVED_BY_POLICY', ROUTE_REASON.NO_URL_NAMESPACE_FOR_BASE);\n    }",
    "    if (source.origin === null) {\n      return Object.freeze({ routed: true, status: null, reason: null, target: null, sourceIds: Object.freeze([source.id]), requestedPath: classified.locator.slice(1) });\n    }",
  );
  const leaked = run(mutant, cfg, '/etc/passwd');
  assert.equal(leaked.status, 'RETRIEVED', 'mutation must be live');

  const safe = run(real, cfg, '/etc/passwd');
  assert.equal(safe.status, real.RETRIEVAL_STATUS.NOT_RETRIEVED_BY_POLICY);
  assert.equal(safe.reason, 'no-url-namespace-for-base');
});

// ---------------------------------------------------------------------------
// CONTROLS 9-12 accompany the two WD1.7-B URL-semantics corrections made after
// independent QA. Two of them guard the NEW behaviour; two guard the boundary
// the new behaviour must not cross.
// ---------------------------------------------------------------------------

// CONTROL 9 ------------------------------------------------------------------
// failure mode: a default port is treated as a distinct namespace again, so a
//               configured mapping silently never matches a candidate that
//               spells the port out (or vice versa) -- a mapping that looks
//               present and is unreachable.
// mutation:     defeat default-port elision in the single canonicalization
//               authority.
test('CONTROL 9 -- losing default-port canonicalization makes a configured mapping unreachable', () => {
  const root = makeTree({ 'base.wrl': 'root', 'lib/shared.wrl': 'LIBRARY' });
  const cfg = { sources: [{ id: 'web', prefix: 'http://example.com/', root }] };

  // `url.host` already elides the default port, so a live mutation has to go
  // back to the AUTHORITY AS WRITTEN -- which is exactly the pre-correction rule.
  const mutant = mutantBuild('url-origin.js', '  return url.origin;', '  return `${scheme}://${authority.toLowerCase()}`;');
  const missed = run(mutant, cfg, 'http://example.com:80/lib/shared.wrl');
  assert.equal(missed.status, 'NOT_RETRIEVED_BY_POLICY', 'mutation must be live');
  assert.equal(missed.reason, 'unmapped-origin');

  const safe = run(real, cfg, 'http://example.com:80/lib/shared.wrl');
  assert.equal(safe.status, real.RETRIEVAL_STATUS.RETRIEVED);
  assert.equal(safe.text, 'LIBRARY');
  // ...and the non-default port must still NOT collapse.
  assert.equal(run(real, cfg, 'http://example.com:8080/lib/shared.wrl').reason, 'unmapped-origin');
});

// CONTROL 10 -----------------------------------------------------------------
// failure mode: URL-space excess `..` goes back to being refused, so a
//               conforming reference every browser resolves is reported as a
//               policy failure.
// mutation:     stop clamping at the URL namespace root.
test('CONTROL 10 -- refusing URL-space excess ".." loses a conforming reference', () => {
  const root = makeTree({ 'a/b/world.wrl': 'root', 'foo.wrl': 'TARGET' });
  const cfg = { sources: [{ id: 'web', prefix: 'http://h/', root }] };

  const mutant = mutantBuild('routing.js', '        if (clampAtRoot) continue;', '        if (false) continue;');
  const refused = run(mutant, cfg, '../../../../foo.wrl', 'a/b/world.wrl');
  assert.equal(refused.status, 'NOT_RETRIEVED_BY_POLICY', 'mutation must be live');

  const safe = run(real, cfg, '../../../../foo.wrl', 'a/b/world.wrl');
  assert.equal(safe.status, real.RETRIEVAL_STATUS.RETRIEVED);
  assert.equal(safe.text, 'TARGET');
});

// CONTROL 11 -----------------------------------------------------------------
// failure mode: THE ONE THE CORRECTION MUST NOT CAUSE. A URL-normalised
//               `/foo.wrl` is interpreted as a workstation path, so clamping a
//               `../` turns into host filesystem access.
// mutation:     resolve the archive-relative path from the filesystem root
//               instead of the configured source root (both the lookup and the
//               containment check, so this is the real "no boundary" build).
test('CONTROL 11 -- a URL-normalised path must never be resolved against the workstation root', () => {
  const root = makeTree({ 'base.wrl': 'root' });
  const outside = makeTree({ 'secret.wrl': 'WORKSTATION SECRET' });
  const outsideFile = path.join(outside, 'secret.wrl');
  // Spell the outside file as a URL-ROOT-RELATIVE reference. Under the real
  // build it names a path inside the configured archive; under the mutant it
  // names the host filesystem.
  const fsRoot = path.parse(outsideFile).root;
  const written = `/${path.relative(fsRoot, outsideFile).split(path.sep).join('/')}`;
  const cfg = { sources: [{ id: 'web', prefix: 'http://h/', root }] };

  const mutant = mutantBuild(
    'retrieval.js',
    "  const base = { sourceId: source.id, artifactPath: requestedPath };\n  const segments = requestedPath.split('/');",
    "  const base = { sourceId: source.id, artifactPath: requestedPath };\n  const segments = requestedPath.split('/');\n  source = { ...source, root: nodePath.parse(source.root).root };",
  );
  const escaped = run(mutant, cfg, written);
  assert.equal(escaped.status, 'RETRIEVED', 'mutation must be live');
  assert.equal(escaped.text, 'WORKSTATION SECRET');

  const safe = run(real, cfg, written);
  assert.equal(safe.status, real.RETRIEVAL_STATUS.NOT_FOUND, 'the path is looked up INSIDE the configured root');
  assert.equal(safe.text, null);
  assert.equal(safe.artifact, null);
});

// CONTROL 12 -----------------------------------------------------------------
// failure mode: URL clamping is applied to ARCHIVE space, where the root is a
//               filesystem boundary -- so an above-root traversal is normalised
//               into a legal in-root read instead of being refused.
// mutation:     clamp in archive space too.
test('CONTROL 12 -- clamping an ARCHIVE-space escape silently answers a refused reference', () => {
  const root = makeTree({ 'a/b/world.wrl': 'root', 'outside.wrl': 'IN-ROOT DECOY' });
  const cfg = { sources: [{ id: 'web', root }] };          // archive-local, no URL namespace

  const mutant = mutantBuild(
    'routing.js',
    "  const joined = joinSegments(base.segments.slice(0, -1), refSegments, false);",
    "  const joined = joinSegments(base.segments.slice(0, -1), refSegments, true);",
  );
  const clamped = run(mutant, cfg, '../../../../outside.wrl', 'a/b/world.wrl');
  assert.equal(clamped.status, 'RETRIEVED', 'mutation must be live');
  assert.equal(clamped.text, 'IN-ROOT DECOY');

  const safe = run(real, cfg, '../../../../outside.wrl', 'a/b/world.wrl');
  assert.equal(safe.status, real.RETRIEVAL_STATUS.NOT_RETRIEVED_BY_POLICY);
  assert.equal(safe.reason, 'outside-source-root');
  assert.equal(safe.text, null);
});
