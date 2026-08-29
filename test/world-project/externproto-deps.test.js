'use strict';
// WD1.7-B2 -- World Project EXTERNPROTO dependency integration.
//
// The defect this suite pins (`F3-WORLD-PROJECT-SCANNER-EXTERNPROTO-OMISSION`,
// WD1.7-A §19) failed SILENTLY: an external prototype library was omitted from
// the dependency graph and the package plan still said `ready`. A silent
// omission is only ever caught by a test that asserts the dependency is THERE,
// so the reproduction fixture is asserted end-to-end through the production path
// (`scanProject` -> `buildPackagePlan`), not against a module in isolation.
//
// Four mutation controls (M1-M4) are at the bottom. Each names the failure mode
// it exists to catch and applies the mutation in memory -- no repository file is
// ever modified.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const {
  EXTERNPROTO_BASE,
  EXTERNPROTO_GROUP_STATUS,
  discoverExternProtoGroups,
  createProjectResolverContext,
  resolveExternProtoGroups,
  scanExternProtoDependencies,
  projectRelativeBase,
} = require('../../src/world-project/externproto-deps');
const { buildAssetGraph } = require('../../src/world-project/asset-graph');
const { scanProject } = require('../../src/world-project/project-loader');
const { buildPackagePlan } = require('../../src/world-project/package-plan');

const HEADER = '#VRML V2.0 utf8\n';

// --- fixture helpers -------------------------------------------------------

// A disposable project tree. `files` maps project-relative POSIX paths to
// string contents (or a Buffer, for the gzip case).
function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-b2-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

function scan(root, primaryRel = 'world.wrl') {
  return scanProject({ root, primary: path.join(root, ...primaryRel.split('/')) });
}

function groupsOf(root, primaryRel = 'world.wrl') {
  return scan(root, primaryRel).graph.externProtos;
}

function planOf(root, primaryRel = 'world.wrl') {
  return buildPackagePlan(scan(root, primaryRel));
}

const codeOf = (relPath) =>
  fs.readFileSync(path.join(__dirname, '..', '..', relPath), 'utf8').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// 1. Discovery comes from the AST, not from a second grammar
// ---------------------------------------------------------------------------

test('discovers a top-level EXTERNPROTO whose URL list has no brackets', () => {
  const { groups } = discoverExternProtoGroups(`${HEADER}EXTERNPROTO Lib [] "lib/x.wrl#X"\n`);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, 'Lib');
  assert.equal(groups[0].nestedInProto, false);
  assert.deepEqual(groups[0].candidates.map((c) => c.writtenUrl), ['lib/x.wrl#X']);
});

test('keeps every bracketed candidate in WRITTEN order with its index', () => {
  const { groups } = discoverExternProtoGroups(
    `${HEADER}EXTERNPROTO X [] [ "urn:vendor:X" "lib/x.wrl#X" "fallback/x.wrl#X" ]\n`);
  assert.deepEqual(groups[0].candidates.map((c) => [c.index, c.writtenUrl]), [
    [0, 'urn:vendor:X'], [1, 'lib/x.wrl#X'], [2, 'fallback/x.wrl#X'],
  ]);
});

test('the word EXTERNPROTO inside a comment or a string is not a declaration', () => {
  // The whole point of using the parser: a lexical matcher would fire on both.
  const text = `${HEADER}# EXTERNPROTO Ghost [] "ghost.wrl#G"\n`
    + 'WorldInfo { title "EXTERNPROTO Phantom [] \\"phantom.wrl\\"" }\n';
  const { groups } = discoverExternProtoGroups(text);
  assert.deepEqual(groups, []);
});

test('the production url-field extractor still cannot see an EXTERNPROTO', () => {
  // Not a lament -- an assertion that the fix did NOT take the forbidden route of
  // widening the url-field regex into a second EXTERNPROTO grammar.
  const { extractUrlRefs } = require('../../src/world-project/url-fields');
  const refs = extractUrlRefs('EXTERNPROTO Z [] "bxx/shared.wrl#BlaxxunZone"\nInline { url "child.wrl" }');
  assert.deepEqual(refs, [{ nodeType: 'Inline', field: 'url', value: 'child.wrl' }]);
});

test('an EXTERNPROTO nested in a PROTO body is detected, however deep', () => {
  const shallow = discoverExternProtoGroups(
    `${HEADER}PROTO Avatar [] {\n  EXTERNPROTO HUD [] "hud.wrl#HUD"\n  Group {}\n}\n`).groups;
  assert.equal(shallow.length, 1);
  assert.equal(shallow[0].nestedInProto, true);
  assert.equal(shallow[0].enclosingProto, 'Avatar');

  const deep = discoverExternProtoGroups(
    `${HEADER}PROTO Avatar [] {\n  Group { children [\n    EXTERNPROTO HUD [] "hud.wrl#HUD"\n  ] }\n}\n`).groups;
  assert.equal(deep.length, 1, 'a declaration inside a node body inside a PROTO is still nested');
  assert.equal(deep[0].nestedInProto, true);
  assert.equal(deep[0].enclosingProto, 'Avatar');
});

test('an EXTERNPROTO in a top-level MFNode array is NOT nested in a PROTO', () => {
  // Non-conforming placement the parser leniently recovers. ISO 4.5.3 case (3)
  // still applies: it was read from THIS file, so the declaring document is the
  // base. Placement legality is a different question and is not decided here.
  const { groups } = discoverExternProtoGroups(
    `${HEADER}Group { children [\n  EXTERNPROTO Lib [] "lib/x.wrl#X"\n] }\n`);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].nestedInProto, false);
  assert.equal(groups[0].damaged, false);
});

test('a declaration with no URL list at all is damaged, not an empty list', () => {
  const { groups } = discoverExternProtoGroups(`${HEADER}EXTERNPROTO Lib []\n`);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].urlWritten, false);
  assert.equal(groups[0].damaged, true);
});

test('a provably empty URL list is intact with zero candidates', () => {
  const { groups } = discoverExternProtoGroups(`${HEADER}EXTERNPROTO Lib [] [ ]\n`);
  assert.equal(groups[0].damaged, false);
  assert.deepEqual(groups[0].candidates, []);
});

test('a recovery-damaged declaration is marked damaged', () => {
  // An unclosed interface bracket: recovery MOVES statement boundaries, so the
  // URL list this declaration appears to own may be text the author wrote for
  // something else.
  const { groups } = discoverExternProtoGroups(`${HEADER}EXTERNPROTO Lib [ "lib/x.wrl#X"\n`);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].damaged, true);
});

// ---------------------------------------------------------------------------
// 2. ISO 4.5.3 / N12 -- the base document
// ---------------------------------------------------------------------------

test('a top-level candidate resolves against the DECLARING file, not the root', () => {
  const root = project({
    'world.wrl': `${HEADER}Inline { url "sub/child.wrl" }\n`,
    'sub/child.wrl': `${HEADER}EXTERNPROTO Lib [] "../lib/x.wrl#X"\n`,
    'lib/x.wrl': `${HEADER}PROTO X [] { Group {} }\n`,
  });
  const g = groupsOf(root).find((x) => x.referrerRelative === 'sub/child.wrl');
  assert.equal(g.base, EXTERNPROTO_BASE.DECLARING_DOCUMENT);
  assert.equal(g.status, EXTERNPROTO_GROUP_STATUS.RETRIEVABLE);
  assert.equal(g.candidates[0].artifactPath, 'lib/x.wrl');
});

test('an EXTERNPROTO inside a PROTO body is context-required and is NOT retrieved', () => {
  // The candidate WOULD resolve against the declaring file. ISO 4.5.3 says the
  // base is the file where `Avatar` is INSTANTIATED, which this scan cannot know,
  // so a confident answer here would be a confident WRONG answer.
  const root = project({
    'world.wrl': `${HEADER}PROTO Avatar [] {\n  EXTERNPROTO HUD [] "lib/hud.wrl#HUD"\n  Group {}\n}\n`,
    'lib/hud.wrl': `${HEADER}PROTO HUD [] { Group {} }\n`,
  });
  const [g] = groupsOf(root);
  assert.equal(g.nestedInProto, true);
  assert.equal(g.enclosingProto, 'Avatar');
  assert.equal(g.base, EXTERNPROTO_BASE.CONTEXT_REQUIRED);
  assert.equal(g.status, EXTERNPROTO_GROUP_STATUS.CONTEXT_REQUIRED);
  assert.equal(g.candidates[0].status, null, 'no retrieval status was invented');
  assert.equal(g.candidates[0].artifactPath, null);
  // And the file it would have resolved to is NOT packaged on that basis.
  const plan = planOf(root);
  assert.ok(!plan.files.some((f) => f.relPath === 'lib/hud.wrl'));
});

test('a declaring file outside the project root yields no base and withholds', () => {
  const root = project({ 'lib/x.wrl': `${HEADER}PROTO X [] { Group {} }\n` });
  assert.equal(projectRelativeBase(root, path.join(root, '..', 'outside.wrl')), null);
  const { groups } = discoverExternProtoGroups(`${HEADER}EXTERNPROTO Lib [] "lib/x.wrl#X"\n`);
  const [g] = resolveExternProtoGroups({
    groups,
    projectRoot: root,
    referrerAbs: path.join(root, '..', 'outside.wrl'),
    context: createProjectResolverContext(root),
  });
  assert.equal(g.base, EXTERNPROTO_BASE.UNAVAILABLE);
  assert.equal(g.status, EXTERNPROTO_GROUP_STATUS.UNPROVABLE);
  assert.equal(g.candidates[0].artifactPath, null);
});

// ---------------------------------------------------------------------------
// 3. Retrieval status mapping -- the four uncertainties stay distinct
// ---------------------------------------------------------------------------

const statusCases = [
  ['an existing relative library', 'lib/x.wrl#X', EXTERNPROTO_GROUP_STATUS.RETRIEVABLE, 'RETRIEVED', null],
  ['a missing relative library', 'missing_lib.wrl#M', EXTERNPROTO_GROUP_STATUS.MISSING, 'NOT_FOUND', 'not-in-configured-sources'],
  ['a urn', 'urn:inet:blaxxun.com:node:HUD', EXTERNPROTO_GROUP_STATUS.UNSUPPORTED, 'UNSUPPORTED_REFERENCE', 'urn-not-retrievable'],
  ['an absolute http url', 'http://example.com/protos/x.wrl#X', EXTERNPROTO_GROUP_STATUS.NOT_PORTABLE, 'NOT_RETRIEVED_BY_POLICY', 'unmapped-origin'],
  ['a URL-root-relative path', '/protos/x.wrl#X', EXTERNPROTO_GROUP_STATUS.NOT_PORTABLE, 'NOT_RETRIEVED_BY_POLICY', 'no-url-namespace-for-base'],
  ['a path that escapes the project root', '../../secrets.wrl#S', EXTERNPROTO_GROUP_STATUS.NOT_PORTABLE, 'NOT_RETRIEVED_BY_POLICY', 'outside-source-root'],
  ['an empty candidate', '', EXTERNPROTO_GROUP_STATUS.UNSUPPORTED, 'UNSUPPORTED_REFERENCE', 'empty-reference'],
  ['a case-only near miss', 'lib/X.wrl#X', EXTERNPROTO_GROUP_STATUS.MISSING, 'NOT_FOUND', 'case-mismatch'],
];

for (const [label, written, groupStatus, retrieval, reason] of statusCases) {
  test(`${label} -> group ${groupStatus} / candidate ${retrieval}`, () => {
    const root = project({
      'world.wrl': `${HEADER}EXTERNPROTO Lib [] "${written}"\n`,
      'lib/x.wrl': `${HEADER}PROTO X [] { Group {} }\n`,
    });
    const [g] = groupsOf(root);
    assert.equal(g.status, groupStatus);
    assert.equal(g.candidates[0].status, retrieval);
    if (reason) assert.equal(g.candidates[0].reason, reason);
  });
}

test('a later candidate can satisfy the group (ISO 4.5.2 ordered fallback)', () => {
  const root = project({
    'world.wrl': `${HEADER}EXTERNPROTO X [] [ "urn:vendor:X" "http://example.com/x.wrl#X" "" "lib/x.wrl#X" ]\n`,
    'lib/x.wrl': `${HEADER}PROTO X [] { Group {} }\n`,
  });
  const [g] = groupsOf(root);
  assert.equal(g.status, EXTERNPROTO_GROUP_STATUS.RETRIEVABLE);
  // EVERY candidate keeps its own outcome: the record is a list, not a winner.
  assert.deepEqual(g.candidates.map((c) => c.status), [
    'UNSUPPORTED_REFERENCE', 'NOT_RETRIEVED_BY_POLICY', 'UNSUPPORTED_REFERENCE', 'RETRIEVED',
  ]);
  assert.deepEqual(g.candidates.map((c) => c.artifactPath), [null, null, null, 'lib/x.wrl']);
});

test('an unreadable candidate is INDETERMINATE, never reported as missing', () => {
  const root = project({
    'world.wrl': `${HEADER}EXTERNPROTO Lib [] "lib/x.wrl#X"\n`,
    'lib/x.wrl': `${HEADER}PROTO X [] { Group {} }\n`,
  });
  // B's injectable fs surface, forced into an EACCES on the artifact read.
  const graph = buildAssetGraph(path.join(root, 'world.wrl'), {
    projectRoot: root,
    externProtoDeps: {
      readFileSync: () => { const e = new Error('permission denied'); e.code = 'EACCES'; throw e; },
    },
  });
  const [g] = graph.externProtos;
  assert.equal(g.candidates[0].status, 'UNREADABLE_ARTIFACT');
  assert.equal(g.status, EXTERNPROTO_GROUP_STATUS.INDETERMINATE);
});

test('a gzip artifact behind a plain .wrl name is retrieved (magic bytes, not extension)', () => {
  const root = project({
    'world.wrl': `${HEADER}EXTERNPROTO Lib [] "lib/x.wrl#X"\n`,
    'lib/x.wrl': zlib.gzipSync(Buffer.from(`${HEADER}PROTO X [] { Group {} }\n`)),
  });
  const [g] = groupsOf(root);
  assert.equal(g.status, EXTERNPROTO_GROUP_STATUS.RETRIEVABLE);
  assert.equal(g.candidates[0].artifactPath, 'lib/x.wrl');
});

// ---------------------------------------------------------------------------
// 4. Fragments are provenance, never filename and never semantics
// ---------------------------------------------------------------------------

test('the fragment is preserved and is never part of the artifact path', () => {
  const root = project({
    'world.wrl': `${HEADER}EXTERNPROTO Zone [] "lib/shared.wrl#BlaxxunZone"\n`,
    'lib/shared.wrl': `${HEADER}PROTO SomethingElse [] { Group {} }\n`,
  });
  const [g] = groupsOf(root);
  assert.equal(g.candidates[0].fragment, 'BlaxxunZone');
  assert.equal(g.candidates[0].locator, 'lib/shared.wrl');
  assert.equal(g.candidates[0].artifactPath, 'lib/shared.wrl');
  // The artifact declares no `BlaxxunZone`, and this lane does NOT notice --
  // ISO 4.9.3 target selection is WD1.7-C's, so the group stays `retrievable`
  // and never claims the EXTERNPROTO resolved.
  assert.equal(g.status, EXTERNPROTO_GROUP_STATUS.RETRIEVABLE);
  const plan = planOf(root);
  assert.ok(!JSON.stringify(plan.files).includes('#'), 'no packaged path carries a fragment');
  assert.equal(plan.findings.externProtos[0].candidates[0].fragment, 'BlaxxunZone');
});

// ---------------------------------------------------------------------------
// 5. Duplicate artifacts -- one payload, all provenance
// ---------------------------------------------------------------------------

test('two declarations naming one artifact package it once and keep both referrers', () => {
  const root = project({
    'world.wrl': `${HEADER}EXTERNPROTO A [] "lib/shared.wrl#A"\nEXTERNPROTO B [] "lib/shared.wrl#B"\n`
      + 'Inline { url "sub/child.wrl" }\n',
    'sub/child.wrl': `${HEADER}EXTERNPROTO C [] "../lib/shared.wrl#C"\n`,
    'lib/shared.wrl': `${HEADER}PROTO A [] { Group {} }\n`,
  });
  const plan = planOf(root);
  const hits = plan.files.filter((f) => f.relPath === 'lib/shared.wrl');
  assert.equal(hits.length, 1, 'one physical payload');
  assert.deepEqual(hits[0].referencedBy, ['sub/child.wrl', 'world.wrl']);
  assert.equal(plan.findings.externProtos.length, 3, 'three declarations keep their own provenance');
});

test('one declaration listing the same artifact twice still packages it once', () => {
  const root = project({
    'world.wrl': `${HEADER}EXTERNPROTO A [] [ "lib/shared.wrl#A" "./lib/shared.wrl#A" ]\n`,
    'lib/shared.wrl': `${HEADER}PROTO A [] { Group {} }\n`,
  });
  const plan = planOf(root);
  assert.equal(plan.files.filter((f) => f.relPath === 'lib/shared.wrl').length, 1);
  assert.deepEqual(plan.findings.externProtos[0].candidates.map((c) => c.artifact),
    ['lib/shared.wrl', 'lib/shared.wrl']);
});

// ---------------------------------------------------------------------------
// 6. Package readiness -- the original defect, end to end
// ---------------------------------------------------------------------------

test('THE DEFECT FIXTURE: both dependencies are visible and `ready` is impossible', () => {
  const root = project({
    'world.wrl': `${HEADER}\nEXTERNPROTO MissingLibrary [] "missing_lib.wrl#Missing"\n\nInline {\n  url "local.wrl"\n}\n`,
    'local.wrl': `${HEADER}Shape { geometry Box {} }\n`,
  });
  const s = scan(root);

  // The Inline dependency is still discovered exactly as before.
  assert.deepEqual(s.graph.references.map((r) => [r.nodeType, r.field, r.authoredUrl, r.status]),
    [['Inline', 'url', 'local.wrl', 'present']]);
  // The EXTERNPROTO dependency is now discovered too, as its own kind.
  assert.equal(s.graph.externProtos.length, 1);
  assert.equal(s.graph.externProtos[0].name, 'MissingLibrary');
  assert.equal(s.graph.externProtos[0].status, EXTERNPROTO_GROUP_STATUS.MISSING);

  const plan = buildPackagePlan(s);
  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.blocking.map((b) => b.code), ['externproto-missing']);
  assert.equal(plan.findings.externProtos[0].candidates[0].retrieval, 'NOT_FOUND');
});

test('a satisfied EXTERNPROTO is packaged, counted, and not reported as unused', () => {
  const root = project({
    'world.wrl': `${HEADER}EXTERNPROTO Lib [] "lib/x.wrl#X"\n`,
    'lib/x.wrl': `${HEADER}PROTO X [] { Group {} }\n`,
  });
  const plan = planOf(root);
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.blocking, []);
  assert.deepEqual(plan.files.map((f) => f.relPath).sort(), ['lib/x.wrl', 'world.wrl']);
  assert.equal(plan.files.find((f) => f.relPath === 'lib/x.wrl').kind, 'wrl');
  assert.deepEqual(plan.unusedFiles, []);
});

test('a urn-only declaration is REVIEW, never blocked and never called missing', () => {
  const root = project({ 'world.wrl': `${HEADER}EXTERNPROTO HUD [] "urn:inet:blaxxun.com:node:HUD"\n` });
  const plan = planOf(root);
  assert.equal(plan.status, 'needs-review');
  assert.deepEqual(plan.blocking, []);
  assert.equal(plan.externProtoReview.length, 1);
  assert.equal(plan.findings.externProtos[0].status, EXTERNPROTO_GROUP_STATUS.UNSUPPORTED);
  assert.deepEqual(plan.findings.missing, [], 'a urn is not a missing file');
});

test('a nested (context-required) declaration is REVIEW, never blocked', () => {
  const root = project({
    'world.wrl': `${HEADER}PROTO Avatar [] {\n  EXTERNPROTO HUD [] "lib/hud.wrl#HUD"\n  Group {}\n}\n`,
  });
  const plan = planOf(root);
  assert.equal(plan.status, 'needs-review');
  assert.deepEqual(plan.blocking, []);
  assert.equal(plan.findings.externProtos[0].base, EXTERNPROTO_BASE.CONTEXT_REQUIRED);
});

test('the four uncertainty kinds do not collapse into one code', () => {
  const root = project({
    'world.wrl': `${HEADER}`
      + 'EXTERNPROTO Gone [] "gone.wrl#G"\n'
      + 'EXTERNPROTO Far  [] "http://example.com/far.wrl#F"\n'
      + 'EXTERNPROTO Urn  [] "urn:inet:blaxxun.com:node:HUD"\n'
      + 'PROTO Avatar [] { EXTERNPROTO Nested [] "lib/n.wrl#N" Group {} }\n',
  });
  const plan = planOf(root);
  assert.deepEqual(plan.blocking.map((b) => b.code).sort(),
    ['externproto-missing', 'externproto-not-portable']);
  const byName = Object.fromEntries(plan.findings.externProtos.map((g) => [g.name, g.status]));
  assert.deepEqual(byName, {
    Gone: EXTERNPROTO_GROUP_STATUS.MISSING,
    Far: EXTERNPROTO_GROUP_STATUS.NOT_PORTABLE,
    Urn: EXTERNPROTO_GROUP_STATUS.UNSUPPORTED,
    Nested: EXTERNPROTO_GROUP_STATUS.CONTEXT_REQUIRED,
  });
  const reasons = plan.findings.externProtos.map((g) => g.candidates[0].reason);
  assert.ok(reasons.includes('not-in-configured-sources'));
  assert.ok(reasons.includes('unmapped-origin'));
  assert.ok(reasons.includes('urn-not-retrievable'));
});

test('the manifest and report carry the declarations deterministically', () => {
  const { manifestJson, renderReport } = require('../../src/world-project/package-plan');
  const root = project({ 'world.wrl': `${HEADER}EXTERNPROTO Gone [] "gone.wrl#G"\n` });
  const plan = planOf(root);
  const a = manifestJson(plan);
  assert.equal(a, manifestJson(buildPackagePlan(scan(root))), 'byte-identical across builds');
  assert.ok(a.includes('"externProtos"'));
  assert.ok(!a.includes(root), 'no absolute path leaks into the manifest');
  assert.ok(renderReport(plan).includes('EXTERNPROTO declarations'));
});

// ---------------------------------------------------------------------------
// 7. No regression to existing url-field discovery
// ---------------------------------------------------------------------------

test('existing Inline / ImageTexture discovery is unchanged by the integration', () => {
  const root = project({
    'world.wrl': `${HEADER}Inline { url "sub/child.wrl" }\n`
      + 'Shape { appearance Appearance { texture ImageTexture { url [ "t/a.gif" "t/b.gif" ] } } }\n',
    'sub/child.wrl': `${HEADER}Shape { appearance Appearance { texture ImageTexture { url "../t/a.gif" } } }\n`,
    't/a.gif': 'GIF89a',
    't/b.gif': 'GIF89a',
  });
  const g = scan(root).graph;
  assert.deepEqual(g.references.map((r) => [r.field, r.authoredUrl, r.status]), [
    ['url', 'sub/child.wrl', 'present'],
    ['url', 't/a.gif', 'present'],
    ['url', 't/b.gif', 'present'],
    ['url', '../t/a.gif', 'present'],
  ]);
  assert.equal(g.stats.uniqueTextures, 2);
  assert.deepEqual(g.externProtos, []);
  assert.equal(buildPackagePlan(scan(root)).status, 'ready');
});

test('a document the parser cannot enumerate is surfaced, not assumed EXTERNPROTO-free', () => {
  // Unknown is not the same as none: the plan must say so rather than stay ready.
  const graph = { wrlNodes: [], assets: [], references: [], externProtos: [],
    externProtoErrors: [{ referrer: '/p/world.wrl', error: 'boom' }] };
  const plan = buildPackagePlan({ root: '/p', primary: '/p/world.wrl', status: 'ok', graph },
    { readFile: () => Buffer.alloc(0), listAllFiles: () => [] });
  assert.equal(plan.status, 'needs-review');
  assert.deepEqual(plan.externProtoErrors, [{ referrer: 'world.wrl', error: 'boom' }]);
});

// ---------------------------------------------------------------------------
// 8. Architecture and security boundaries
// ---------------------------------------------------------------------------

test('World Project reaches retrieval ONLY through the public B facade', () => {
  const dir = path.join(__dirname, '..', '..', 'src', 'world-project');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const code = codeOf(path.posix.join('src/world-project', f));
    for (const forbidden of [
      "require('../external-proto/retrieval')", "require('../external-proto/routing')",
      "require('../external-proto/reference-forms')", "require('../external-proto/url-origin')",
      "require('../external-proto/resolver-context')", '_internals',
    ]) {
      assert.ok(!code.includes(forbidden), `${f} must not reach into B: ${forbidden}`);
    }
  }
  // Exactly one module holds the dependency, and it holds the facade.
  const holders = fs.readdirSync(dir).filter((n) => n.endsWith('.js'))
    .filter((n) => codeOf(path.posix.join('src/world-project', n)).includes('external-proto'));
  assert.deepEqual(holders, ['externproto-deps.js']);
  assert.ok(codeOf('src/world-project/externproto-deps.js').includes("require('../external-proto')"));
});

test('the retrieval substrate gains NO dependency on World Project (one-way)', () => {
  const dir = path.join(__dirname, '..', '..', 'src', 'external-proto');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    assert.ok(!codeOf(path.posix.join('src/external-proto', f)).includes('world-project'),
      `${f} must not depend on a profile`);
  }
});

test('the B2 consumer performs no filesystem access of its own', () => {
  const code = codeOf('src/world-project/externproto-deps.js');
  for (const forbidden of [
    "require('fs')", 'require("fs")', "require('node:fs')", 'existsSync', 'readdirSync',
    'readFileSync', 'realpathSync', 'statSync', 'gunzip', "require('zlib')",
    'toLowerCase()', 'fetch(', "require('http')",
  ]) {
    assert.ok(!code.includes(forbidden), `externproto-deps.js must not contain ${forbidden}`);
  }
});

test('the B2 consumer never consults ambient machine state', () => {
  const code = codeOf('src/world-project/externproto-deps.js');
  for (const forbidden of ['process.cwd', 'process.env', 'os.homedir', "require('os')", '/home/', '__dirname']) {
    assert.ok(!code.includes(forbidden), `externproto-deps.js must not contain ${forbidden}`);
  }
});

test('no EXTERNPROTO grammar is re-implemented outside the parser', () => {
  // Behavioural, not a ban on the word: the discovery module must own no regex
  // that could match a declaration, and the lexical url extractor must own none
  // either. One syntax authority.
  for (const rel of ['src/world-project/externproto-deps.js', 'src/world-project/url-fields.js',
    'src/world-project/asset-graph.js']) {
    const code = codeOf(rel);
    for (const m of code.matchAll(/\/(?![/*])(?:\\.|\[[^\]]*\]|[^/\n\\])+\/[gimsuy]*/g)) {
      assert.ok(!/EXTERNPROTO|PROTO/i.test(m[0]), `${rel} declares a PROTO-matching regex: ${m[0]}`);
    }
  }
  assert.ok(codeOf('src/world-project/externproto-deps.js').includes("require('../vrml/parser')"));
});

test('the browser-safe vrml facade still loads no retrieval substrate', () => {
  const { execFileSync } = require('node:child_process');
  const ROOT = path.join(__dirname, '..', '..');
  const out = execFileSync(process.execPath, ['-e', `
    require(${JSON.stringify(path.join(ROOT, 'src', 'vrml'))});
    process.stdout.write(JSON.stringify(Object.keys(require.cache).filter((p) =>
      p.includes('external-proto') || p.includes('world-project' + require('path').sep + 'asset-graph'))));
  `], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), [], 'src/vrml must stay capability-free after B2');
});

// ---------------------------------------------------------------------------
// 9. Mutation controls. Each one must FAIL LOUDLY when the guard is removed.
// ---------------------------------------------------------------------------

const MISSING_FIXTURE = {
  'world.wrl': `${HEADER}\nEXTERNPROTO MissingLibrary [] "missing_lib.wrl#Missing"\n\nInline {\n  url "local.wrl"\n}\n`,
  'local.wrl': `${HEADER}Shape { geometry Box {} }\n`,
};

test('M1 -- with EXTERNPROTO discovery removed, the fixture silently returns to `ready`', () => {
  // Failure mode: the dependency is omitted and packaging says nothing.
  const root = project(MISSING_FIXTURE);
  const s = scan(root);
  assert.equal(buildPackagePlan(s).status, 'blocked');

  const mutated = { ...s, graph: { ...s.graph, externProtos: [] } };
  assert.equal(buildPackagePlan(mutated).status, 'ready',
    'the regression test depends on discovery, so removing discovery must break it');
});

test('M2 -- forcing the declaring-document base manufactures a false confident answer', () => {
  // Failure mode: a nested EXTERNPROTO resolved against the file that DECLARED it
  // rather than the file that INSTANTIATES the enclosing PROTO (ISO 4.5.3).
  const root = project({
    'world.wrl': `${HEADER}PROTO Avatar [] {\n  EXTERNPROTO HUD [] "lib/hud.wrl#HUD"\n  Group {}\n}\n`,
    'lib/hud.wrl': `${HEADER}PROTO HUD [] { Group {} }\n`,
  });
  const context = createProjectResolverContext(root);
  const referrerAbs = path.join(root, 'world.wrl');
  const { groups } = discoverExternProtoGroups(fs.readFileSync(referrerAbs, 'utf8'));

  const real = resolveExternProtoGroups({ groups, projectRoot: root, referrerAbs, context })[0];
  assert.equal(real.status, EXTERNPROTO_GROUP_STATUS.CONTEXT_REQUIRED);
  assert.equal(real.candidates[0].artifactPath, null);

  // The mutant: pretend the declaration is not nested.
  const mutant = resolveExternProtoGroups({
    groups: groups.map((g) => ({ ...g, nestedInProto: false })),
    projectRoot: root, referrerAbs, context,
  })[0];
  assert.equal(mutant.status, EXTERNPROTO_GROUP_STATUS.RETRIEVABLE);
  assert.equal(mutant.candidates[0].artifactPath, 'lib/hud.wrl',
    'the mutant confidently retrieves; production must not, and does not');
});

test('M3 -- a direct filesystem lookup that bypasses B is caught by the boundary gate', () => {
  // Failure mode: World Project quietly re-implements candidate resolution with
  // existsSync/readFileSync, losing exact-case, symlink containment and bounds.
  const code = codeOf('src/world-project/externproto-deps.js');
  const gate = (source) => ['existsSync', 'readFileSync', "require('fs')"]
    .every((f) => !source.includes(f));
  assert.equal(gate(code), true, 'production passes the gate');
  const mutant = `${code}\nconst fs2 = require('fs');\nfs2.existsSync('x');\n`;
  assert.equal(gate(mutant), false, 'the gate actually fires on the bypass');
});

test('M4 -- readiness genuinely keys on the group status, not on a constant', () => {
  // Failure mode: the EXTERNPROTO finding is recorded but never consulted by the
  // blocking rules, so `ready` survives a missing library.
  const root = project(MISSING_FIXTURE);
  const s = scan(root);
  assert.equal(buildPackagePlan(s).status, 'blocked');

  const relabelled = {
    ...s,
    graph: {
      ...s.graph,
      externProtos: s.graph.externProtos.map((g) => ({ ...g, status: EXTERNPROTO_GROUP_STATUS.RETRIEVABLE })),
    },
  };
  assert.equal(buildPackagePlan(relabelled).status, 'ready',
    'flipping only the status flips only the verdict -- the rule is live');
});

test('scanExternProtoDependencies is the single entry point the graph uses', () => {
  const root = project({
    'world.wrl': `${HEADER}EXTERNPROTO Lib [] "lib/x.wrl#X"\n`,
    'lib/x.wrl': `${HEADER}PROTO X [] { Group {} }\n`,
  });
  const out = scanExternProtoDependencies({
    text: fs.readFileSync(path.join(root, 'world.wrl'), 'utf8'),
    referrerAbs: path.join(root, 'world.wrl'),
    projectRoot: root,
    context: createProjectResolverContext(root),
  });
  assert.equal(out.parseError, null);
  assert.equal(out.groups[0].status, EXTERNPROTO_GROUP_STATUS.RETRIEVABLE);
  assert.ok(codeOf('src/world-project/asset-graph.js').includes('scanExternProtoDependencies'));
});
