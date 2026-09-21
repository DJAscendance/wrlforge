'use strict';
// Windows portability regression guards.
//
// Two defect classes reached the Windows 11 runtime unseen, because Windows CI
// had been failing at the `npm run check` command-length gate before any test
// ran. Both are TEST defects -- no runtime behavior was ever wrong -- but both
// made a security/architecture control fail for the wrong reason, which is the
// one outcome a mutation control must never have.
//
//   Defect A  A path separator interpolated into JavaScript SOURCE that is then
//             handed to `node -e`. On Windows `path.sep` is a backslash, so
//             `'${path.sep}src${path.sep}'` becomes the literal text
//             `'\src\'` -- `\s` is an escape and `\'` escapes the closing
//             quote, so the child dies with a SyntaxError and the architecture
//             audit never runs. On POSIX the separator is `/`, which needs no
//             escaping, so the same line passed for years.
//
//   Defect B  A multi-line mutation anchor written with LF, matched against
//             source read from a Git-for-Windows checkout. `core.autocrlf=true`
//             rewrites text to CRLF on checkout, and .gitattributes pins only
//             `src/vrml/**` to `eol=lf` -- so anchors into src/external-proto/**,
//             src/proto-resolution/** and src/proto-enrichment/** stopped
//             matching and their mutants were never built.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// The child-source templates that Defect A broke.
const GENERATED_SOURCE_TESTS = [
  'test/external-proto/architecture-boundary.test.js',
  'test/proto-resolution/architecture-boundary.test.js',
  'test/proto-enrichment/architecture-boundary.test.js',
  'test/world-project/externproto-deps.test.js',
];

// The mutation harnesses that Defect B broke, plus the one that shares the
// pattern against an unpinned tree. test/vrml/*-mutations.test.js are NOT here:
// they anchor only into src/vrml/**, which .gitattributes pins to eol=lf.
const MUTATION_HARNESSES = [
  'test/external-proto/security-controls.test.js',
  'test/proto-enrichment/mutation-controls.test.js',
  'test/proto-resolution/mutation-controls.test.js',
];

// --- Defect A ---------------------------------------------------------------

test('the old form really is invalid JavaScript when the separator is a backslash', () => {
  // Reproduces the Windows failure on any platform, so the regression below is
  // anchored to a demonstrated defect rather than to a description of one.
  const broken = "const src = [].filter((p) => p.includes('" + '\\' + 'src' + '\\' + "'));";
  const r = spawnSync(process.execPath, ['-e', broken], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'the backslash form must fail, or this guard proves nothing');
  assert.match(r.stderr, /SyntaxError/, 'and it must fail as a syntax error');
});

test('no test interpolates a raw path separator into generated child source', () => {
  for (const rel of GENERATED_SOURCE_TESTS) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.equal(code.includes('${path.sep}'), false,
      `${rel} must not interpolate path.sep into source handed to node -e`);
    assert.equal(/\$\{(?!JSON\.stringify)[^}]*\bsep\b[^}]*\}/.test(code), false,
      `${rel} must not interpolate an unescaped separator into generated source`);
  }
});

test('a child process derives its own separator, so the audit runs under both forms', () => {
  // The fix: the separator never crosses the source boundary. The child asks
  // Node for it, so the same template is correct whether sep is / or \.
  const out = execFileSync(process.execPath, ['-e', `
    const sep = require('path').sep;
    const keys = ['a' + sep + 'src' + sep + 'b.js', 'a' + sep + 'lib' + sep + 'c.js'];
    process.stdout.write(JSON.stringify(keys.filter((p) => p.includes(sep + 'src' + sep))));
  `], { encoding: 'utf8' });
  const got = JSON.parse(out);
  assert.equal(got.length, 1, 'the separator-derived filter must select exactly the src entry');
  assert.ok(got[0].includes(`${path.sep}src${path.sep}`));
});

test('the filter predicate selects src entries under BOTH separators, not just /', () => {
  // Proves the predicate's meaning is separator-agnostic -- the Windows form is
  // exercised explicitly on every platform, so POSIX CI cannot go green on a
  // predicate that only works for `/`.
  const select = (sep, keys) => keys.filter((p) => p.includes(sep + 'src' + sep));
  for (const sep of ['/', '\\']) {
    const keys = [`a${sep}src${sep}vrml${sep}parser.js`, `a${sep}node_modules${sep}x.js`];
    assert.deepEqual(select(sep, keys), [keys[0]], `separator ${JSON.stringify(sep)} must select the src entry`);
  }
});

// --- Defect B ---------------------------------------------------------------

test('every mutation harness normalises source to LF before anchoring', () => {
  for (const rel of MUTATION_HARNESSES) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(code, /readFileSync\([^)]*'utf8'\)\.replace\(\/\\r\\n\/g, '\\n'\)/,
      `${rel} must LF-normalise the source it anchors into (Windows CRLF checkout)`);
  }
});

test('a multi-line LF anchor matches CRLF source only after normalisation', () => {
  // The exact failure shape: the anchor is authored with LF, the checkout is
  // CRLF, and `includes` therefore reports a false negative -- which the
  // harnesses turn into "mutation anchor not found" rather than a silent pass.
  const anchor = "  if (a) {\n    b();\n  }";
  const crlfSource = `x();\n${anchor.replace(/\n/g, '\r\n')}\ny();\n`.replace(/(?<!\r)\n/g, '\r\n');

  assert.equal(crlfSource.includes(anchor), false, 'CRLF source must not match an LF anchor');
  const normalised = crlfSource.replace(/\r\n/g, '\n');
  assert.equal(normalised.includes(anchor), true, 'normalisation must restore the match');

  // And the mutation must actually change the program, not merely match.
  const mutated = normalised.replace(anchor, "  if (false) {\n    b();\n  }");
  assert.notEqual(mutated, normalised, 'the mutation must alter the source');
  assert.equal(mutated.includes('if (false)'), true);
});

test('LF normalisation is a no-op on an already-LF checkout', () => {
  // The POSIX path must be untouched: the mutants built on Linux -- where every
  // one of these controls is currently proven -- stay byte-identical.
  const lf = "a();\nb();\n";
  assert.equal(lf.replace(/\r\n/g, '\n'), lf);
});

test('the trees these harnesses anchor into are the ones .gitattributes leaves unpinned', () => {
  // If a future .gitattributes pins these trees to eol=lf the normalisation
  // becomes redundant but stays harmless; if someone UNPINS src/vrml/** the
  // vrml mutation harnesses acquire this defect, so the pin is asserted here.
  const attrs = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8');
  assert.match(attrs, /^src\/vrml\/\*\* text eol=lf$/m,
    'src/vrml/** must stay pinned to LF, or the vrml mutation harnesses need normalising too');
  for (const tree of ['src/external-proto/', 'src/proto-resolution/', 'src/proto-enrichment/']) {
    assert.equal(new RegExp(`^${tree.replace(/\//g, '\\/')}\\*\\* text eol=lf$`, 'm').test(attrs), false,
      `${tree} is unpinned -- its harnesses must normalise (this test documents why)`);
  }
});

// --- Defect C ---------------------------------------------------------------
//
//   Defect C  A mutation control that proves its LIVENESS by walking the real
//             workstation drive root. `locateExactCase` requires every
//             component to match a directory entry VERBATIM, so such a control
//             is only as portable as the spelling of the host's own temp path.
//             On a GitHub-hosted Windows runner `os.tmpdir()` is
//             `C:\Users\RUNNER~1\AppData\Local\Temp` -- an 8.3 alias whose real
//             directory entry is `runneradmin` -- so the walk from `C:\` was
//             absent at that segment and the mutant answered NOT_FOUND instead
//             of leaking. The control went red for a host-spelling reason, not
//             a security reason. The owner's Windows 11 VM, whose temp path is
//             spelled exactly as it is on disk, passed the identical code.

const { createResolverContext, retrieveExternalCandidate, RETRIEVAL_STATUS } = require('../src/external-proto');

// The controls whose liveness proof must stand on test-owned trees alone.
const HOST_ROOT_FREE_CONTROLS = [
  'test/external-proto/security-controls.test.js',
  'test/proto-enrichment/mutation-controls.test.js',
  'test/proto-resolution/mutation-controls.test.js',
];

const portabilityTrees = [];
test.after(() => {
  for (const d of portabilityTrees) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

function tmpTree(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-portability-'));
  portabilityTrees.push(dir);
  for (const [rel, content] of Object.entries(spec)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

test('an 8.3-style alias segment makes an exact-case walk absent, on every platform', () => {
  // Reproduces the GitHub Windows failure mechanism without needing Windows:
  // the directory on disk is `runneradmin`, the reference spells it `RUNNER~1`,
  // and exact-case retrieval -- correctly -- refuses to promote the alias.
  const root = tmpTree({ 'runneradmin/AppData/Local/Temp/secret.wrl': 'HOST SECRET' });
  const cfg = { sources: [{ id: 'web', prefix: 'http://h/', root }] };
  const ask = (written) => retrieveExternalCandidate({
    context: createResolverContext(cfg),
    baseDocument: { sourceId: 'web', path: 'base.wrl' },
    writtenUrl: written,
    candidateIndex: 0,
  });

  const exact = ask('/runneradmin/AppData/Local/Temp/secret.wrl');
  assert.equal(exact.status, RETRIEVAL_STATUS.RETRIEVED, 'the on-disk spelling must resolve');
  assert.equal(exact.text, 'HOST SECRET');

  const aliased = ask('/RUNNER~1/AppData/Local/Temp/secret.wrl');
  assert.equal(aliased.status, RETRIEVAL_STATUS.NOT_FOUND,
    'an 8.3 alias segment is absent -- so any proof that walks a host temp path is host-dependent');
});

test('no mutation control derives the host filesystem root', () => {
  // The exact construct that broke CONTROL 11 on GitHub Windows:
  //   const fsRoot = path.parse(outsideFile).root;
  //   const written = `/${path.relative(fsRoot, outsideFile)...}`;
  // A control must own both ends of the reference it proves.
  for (const rel of HOST_ROOT_FREE_CONTROLS) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.equal(/\.parse\([^)]*\)\s*\.root/.test(code), false,
      `${rel} must not derive the filesystem root from a host path`);
    assert.equal(/path\.relative\(\s*fsRoot/.test(code), false,
      `${rel} must not spell a reference relative to the drive root`);
    assert.equal(/\bos\.tmpdir\(\)\s*\.split\(/.test(code), false,
      `${rel} must not decompose the host temp path into reference segments`);
  }
});

test('a workstation-root escape is provable from a test-owned sandbox alone', () => {
  // The design CONTROL 11 now uses: one sandbox holding the configured archive
  // and a sibling standing in for the workstation root. Retrieval resolved
  // against the sibling leaks; resolved against the configured root it is
  // absent -- and neither direction touches the real drive root.
  const sandbox = tmpTree({
    'configured/base.wrl': 'root',
    'workstation/secret.wrl': 'WORKSTATION SECRET',
  });
  const ask = (root) => retrieveExternalCandidate({
    context: createResolverContext({ sources: [{ id: 'web', prefix: 'http://h/', root }] }),
    baseDocument: { sourceId: 'web', path: 'base.wrl' },
    writtenUrl: '/secret.wrl',
    candidateIndex: 0,
  });

  const leaked = ask(path.join(sandbox, 'workstation'));
  assert.equal(leaked.status, RETRIEVAL_STATUS.RETRIEVED, 'the stand-in root must really hold the secret');
  assert.equal(leaked.text, 'WORKSTATION SECRET');

  const safe = ask(path.join(sandbox, 'configured'));
  assert.equal(safe.status, RETRIEVAL_STATUS.NOT_FOUND, 'inside the configured root the reference is absent');
  assert.equal(safe.text, null);
  assert.equal(safe.artifact, null);

  // And the reference itself carries no host path -- it is a constant.
  const code = fs.readFileSync(path.join(ROOT, 'test/external-proto/security-controls.test.js'), 'utf8');
  assert.match(code, /const written = '\/secret\.wrl';/,
    'CONTROL 11 must spell its reference as a constant, not build it from the host');
});
