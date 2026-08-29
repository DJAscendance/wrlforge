'use strict';
// WD1.7-C -- architecture boundary audit.
//
// C is the first lane to span BOTH sides of the browser boundary: its selection
// half is pure and lives in `src/vrml`, its orchestration half is Node-side and
// lives in `src/proto-resolution`. That split is only worth anything if it is
// enforced, so the direction is asserted mechanically rather than promised:
//
//   * `require('src/vrml')` must stay loadable without `fs`/`zlib`/`crypto`,
//     and must not pull retrieval or orchestration in behind the new module;
//   * C may depend on B, the parser and the type resolver -- never the reverse;
//   * C contains no second grammar, no second type resolver, no second retrieval
//     path, no network, no writes and no ambient machine state;
//   * C performs no WD1.7-D interface comparison and populates no WD1.7-E
//     compatibility slot.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const PR = path.join(ROOT, 'src', 'proto-resolution');
const PR_FILES = fs.readdirSync(PR).filter((f) => f.endsWith('.js'));
const PURE = path.join(ROOT, 'src', 'vrml', 'proto-target.js');
// Comments carry the rationale and name the very things that must not appear --
// the ISO 4.9.3 doc comment cites the `bxx/shared.wrl` corpus shape by name, and
// that citation is why the rule exists. Every scan below therefore runs on code
// with BOTH comment forms removed, so a rule can never be satisfied by silence.
const codeOf = (p) => fs.readFileSync(p, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('the lane is exactly the modules it claims to be', () => {
  assert.deepEqual(PR_FILES.sort(), ['dependency-graph.js', 'external-resolver.js', 'index.js']);
  assert.ok(fs.existsSync(PURE), 'the pure half must live beside the parser');
});

test('the pure half declares no filesystem, compression, network or Electron capability', () => {
  const code = codeOf(PURE);
  for (const cap of ['fs', 'node:fs', 'zlib', 'node:zlib', 'crypto', 'node:crypto', 'http', 'https', 'net', 'child_process', 'electron', 'os', 'path']) {
    assert.ok(!code.includes(`require('${cap}')`), `proto-target.js must not require ${cap}`);
  }
  assert.ok(!code.includes('proto-resolution'), 'the pure half must not reach the Node orchestration');
  assert.ok(!code.includes('external-proto'), 'the pure half must not reach retrieval');
});

test('requiring the browser-safe vrml facade loads NO orchestration and NO retrieval', () => {
  // A child process, so this file's own requires cannot mask the result.
  const out = execFileSync(process.execPath, ['-e', `
    require(${JSON.stringify(path.join(ROOT, 'src', 'vrml'))});
    const loaded = Object.keys(require.cache).filter((p) => p.includes('proto-resolution') || p.includes('external-proto'));
    process.stdout.write(JSON.stringify(loaded));
  `], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), []);
});

test('requiring the vrml facade still pulls in no Node capability module', () => {
  const out = execFileSync(process.execPath, ['-e', `
    require(${JSON.stringify(path.join(ROOT, 'src', 'vrml'))});
    const src = Object.keys(require.cache).filter((p) => p.includes('${path.sep}src${path.sep}'));
    const fs2 = require('fs');
    const bad = [];
    for (const p of src) {
      const text = fs2.readFileSync(p, 'utf8').replace(/^\\s*\\/\\/.*$/gm, '');
      for (const cap of ['fs', 'node:fs', 'zlib', 'node:zlib', 'crypto', 'node:crypto', 'child_process', 'http', 'https', 'net', 'electron']) {
        if (text.includes("require('" + cap + "')")) bad.push(p + ' -> ' + cap);
      }
    }
    process.stdout.write(JSON.stringify(bad));
  `], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), [], 'the browser-safe semantic layer must stay capability-free');
});

test('C reaches retrieval ONLY through WD1.7-B’s public facade', () => {
  for (const f of PR_FILES) {
    const code = codeOf(path.join(PR, f));
    if (!code.includes('external-proto')) continue;
    assert.ok(code.includes("require('../external-proto')"), `${f} must import the facade`);
    for (const inner of ['retrieval', 'routing', 'reference-forms', 'resolver-context', 'url-origin']) {
      assert.ok(!code.includes(`../external-proto/${inner}`), `${f} must not reach into ${inner}.js`);
    }
    assert.ok(!code.includes('_internals'), `${f} must not use B's test-only internals`);
  }
});

test('C reaches the parser and the type resolver ONLY through the vrml facade', () => {
  for (const f of PR_FILES) {
    const code = codeOf(path.join(PR, f));
    for (const inner of ['parser', 'scope-graph', 'symbols', 'ast', 'analyze', 'tokenizer', 'proto-target', 'node-schema']) {
      assert.ok(!code.includes(`'../vrml/${inner}'`), `${f} must not reach into src/vrml/${inner}.js`);
    }
  }
});

test('C contains no second grammar -- the AST is the only syntax authority', () => {
  for (const f of PR_FILES) {
    const code = codeOf(path.join(PR, f));
    for (const forbidden of ['EXTERNPROTO\\\\s', 'PROTO\\\\s', 'new RegExp', '.match(', 'indexOf(\'PROTO', 'split(\'{\'']) {
      assert.ok(!code.includes(forbidden), `${f} must not scan source text (found ${forbidden})`);
    }
  }
});

test('C contains no second type resolver and no name lookup of its own', () => {
  for (const f of PR_FILES) {
    const code = codeOf(path.join(PR, f));
    for (const forbidden of ['nearest', 'closest', 'fuzzy', 'score', 'toLowerCase()', 'startsWith(', 'endsWith(']) {
      assert.ok(!code.includes(forbidden), `${f} must not rank or match candidates itself (found ${forbidden})`);
    }
  }
});

test('C performs no filesystem access, no network and no writes', () => {
  for (const f of PR_FILES) {
    const code = codeOf(path.join(PR, f));
    for (const cap of ['fs', 'node:fs', 'zlib', 'crypto', 'http', 'https', 'net', 'dns', 'electron', 'os']) {
      assert.ok(!code.includes(`require('${cap}')`), `${f} must not require ${cap}`);
    }
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'child_process', 'writeFileSync', 'mkdirSync', 'unlinkSync', 'createWriteStream']) {
      assert.ok(!code.includes(forbidden), `${f} must not contain ${forbidden}`);
    }
  }
});

test('C consults no ambient machine state', () => {
  for (const f of [...PR_FILES.map((f) => path.join(PR, f)), PURE]) {
    const code = codeOf(f);
    for (const forbidden of ['process.cwd', 'process.env', 'homedir', '__dirname', '/home/', 'Date.now', 'Math.random']) {
      assert.ok(!code.includes(forbidden), `${path.basename(f)} must not contain ${forbidden}`);
    }
  }
});

test('nothing depends on C -- the direction is one-way', () => {
  const holders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'proto-resolution' && entry.name !== 'node_modules') walk(p); continue; }
      if (!entry.name.endsWith('.js')) continue;
      if (codeOf(p).includes('proto-resolution')) holders.push(path.relative(ROOT, p));
    }
  };
  for (const dir of ['src', 'renderer', 'qa']) walk(path.join(ROOT, dir));
  for (const f of ['main.js', 'preload.js', 'validator.js']) {
    assert.ok(!codeOf(path.join(ROOT, f)).includes('proto-resolution'), f);
  }
  // WD1.7-C ships as a resolver and a graph. A World Project consumer of it is a
  // separate, deliberate decision (WD1.7-C brief §37/§38) and would be recorded
  // here rather than discovered in a diff.
  assert.deepEqual(holders, [], 'no production module may consume C yet');
});

test('the module require graph inside the lane is acyclic and one-way', () => {
  const deps = new Map();
  for (const f of PR_FILES) {
    const code = codeOf(path.join(PR, f));
    deps.set(f, [...code.matchAll(/require\('\.\/([a-z-]+)'\)/g)].map((m) => `${m[1]}.js`));
  }
  assert.deepEqual(deps.get('external-resolver.js'), []);
  assert.deepEqual(deps.get('dependency-graph.js'), ['external-resolver.js']);
  assert.deepEqual(deps.get('index.js').sort(), ['dependency-graph.js', 'external-resolver.js']);
});

test('the C facade publishes exactly the intended surface', () => {
  const api = require('../../src/proto-resolution');
  assert.deepEqual(Object.keys(api).sort(), [
    'INCOMPLETENESS_REASON', 'RESOLUTION_REASON', 'RESOLUTION_STATUS',
    'SELECTION_RULE', 'SELECTION_STATUS', 'TRAVERSAL_STATUS',
    'buildExternalDependencyGraph', 'createResolutionSession', 'resolveExternalPrototype',
  ]);
  assert.ok(Object.isFrozen(api));
});

test('the selection tables are the SAME objects the vrml facade publishes', () => {
  const { protoTarget } = require('../../src/vrml');
  const api = require('../../src/proto-resolution');
  assert.equal(api.SELECTION_STATUS, protoTarget.SELECTION_STATUS);
  assert.equal(api.SELECTION_RULE, protoTarget.SELECTION_RULE);
});

test('the resolution vocabulary is about MEANING, with no generic ERROR', () => {
  const { RESOLUTION_STATUS, TRAVERSAL_STATUS } = require('../../src/proto-resolution');
  assert.deepEqual(Object.keys(RESOLUTION_STATUS).sort(), [
    'NOT_ATTEMPTED', 'RESOLVED', 'TARGET_PARSE_FAILED', 'TARGET_PROTO_AMBIGUOUS', 'TARGET_PROTO_NOT_FOUND',
  ]);
  for (const forbidden of ['ERROR', 'FAILED', 'OK', 'UNKNOWN']) {
    assert.ok(!(forbidden in RESOLUTION_STATUS), `${forbidden} is not a resolution status`);
  }
  // Retrieval statuses stay B's and never leak into C's resolution table.
  for (const b of ['RETRIEVED', 'NOT_FOUND', 'AMBIGUOUS_SOURCE', 'DECODE_FAILED', 'LIMIT_EXCEEDED']) {
    assert.ok(!(b in RESOLUTION_STATUS), `${b} is a RETRIEVAL status and belongs to WD1.7-B`);
  }
  assert.ok('DEPENDENCY_CYCLE' in TRAVERSAL_STATUS, 'the cycle verdict is a property of the traversal');
  assert.ok(!('DEPENDENCY_CYCLE' in RESOLUTION_STATUS), 'a cycle does not unprove a target');
});

test('the completeness vocabulary names conditions, and `complete` is derived from it', () => {
  const { INCOMPLETENESS_REASON } = require('../../src/proto-resolution');
  assert.deepEqual(Object.keys(INCOMPLETENESS_REASON).sort(), [
    'CONTEXT_REQUIRED', 'DEPTH_LIMIT_EXCEEDED', 'TYPE_BINDING_WITHHELD', 'UNINDEXED_INTERFACE_DEFAULT',
  ]);
  // A cycle and a definitively unresolved declaration are COMPLETE answers, so
  // neither may acquire an incompleteness reason by drift.
  for (const forbidden of ['DEPENDENCY_CYCLE', 'NOT_RESOLVED', 'ERROR', 'UNKNOWN']) {
    assert.ok(!(forbidden in INCOMPLETENESS_REASON), `${forbidden} does not make a graph incomplete`);
  }
  // The boolean must be derived, never assigned -- a second assignment site is
  // how a reason gets added without becoming visible evidence.
  const code = codeOf(path.join(PR, 'dependency-graph.js'));
  assert.ok(!/\bcomplete\s*=\s*(true|false)/.test(code), '`complete` must not be assigned');
  assert.ok(code.includes('complete: incompleteness.length === 0'), '`complete` must be derived');
});

test('the coverage gate READS the AST and resolves nothing -- no second type authority', () => {
  // The gate answers "is there a node occurrence in a region P2A does not index?"
  // It must never answer "and what does that name mean?", so the pure half may
  // not acquire a lookup, a schema consult or a declaration scan of its own.
  const code = codeOf(PURE);
  for (const forbidden of [
    'lookupType', 'typeDeclarations(', 'isVRML97Node', 'node-schema',
    'declarations.find', 'interfaces.find', 'statements.find',
  ]) {
    assert.ok(!code.includes(forbidden), `proto-target.js must not resolve names itself (found ${forbidden})`);
  }
  // Its ONLY view of a binding stays P2A's aligned projections.
  assert.ok(code.includes('scopeGraph.typeReferences(graph)'));
  assert.ok(code.includes('scopeGraph.typeResolutions(graph)'));
  // And the graph half never inspects a written type name to decide anything --
  // it forwards the pure layer's region record verbatim.
  const graph = codeOf(path.join(PR, 'dependency-graph.js'));
  assert.ok(graph.includes('for (const gap of found.coverageGaps)'));
  assert.ok(!graph.includes('writtenTypeName ==='), 'the graph must not branch on a written spelling');
});

test('C performs NO WD1.7-D interface comparison and NO WD1.7-E compatibility work', () => {
  for (const f of [...PR_FILES.map((f) => path.join(PR, f)), PURE]) {
    const code = codeOf(f);
    for (const forbidden of [
      'subset', 'memberMissing', 'member-missing', 'typeMismatch', 'type-mismatch',
      'accessDiffers', 'implementationClass', 'firstBodyNode', 'childLegality',
      'effectiveInterfaceOf', 'compatibility', 'blaxxun', 'Blaxxun', 'GLView', 'cybertown', 'Cybertown',
    ]) {
      assert.ok(!code.includes(forbidden), `${path.basename(f)} must not contain ${forbidden} -- that is WD1.7-D/E`);
    }
  }
});

test('C rewrites no document -- no substitution, inlining or url repair', () => {
  for (const f of [...PR_FILES.map((f) => path.join(PR, f)), PURE]) {
    const code = codeOf(f);
    for (const forbidden of ['applyEdit', 'require(\'../vrml/edit\')', 'serialize', 'toSource', 'rewrite']) {
      assert.ok(!code.includes(forbidden), `${path.basename(f)} must not rewrite source (found ${forbidden})`);
    }
  }
});

test('the lane adds no runtime dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['x_ite']);
  const declared = new Set(['../vrml', '../external-proto', './external-resolver', './dependency-graph']);
  for (const f of PR_FILES) {
    const code = codeOf(path.join(PR, f));
    for (const m of code.matchAll(/require\('([^']+)'\)/g)) {
      assert.ok(declared.has(m[1]), `${f} requires an unexpected module: ${m[1]}`);
    }
  }
});

test('every new source file is covered by the npm run check syntax gate', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const check = pkg.scripts.check;
  const expected = [
    'src/vrml/proto-target.js',
    'src/proto-resolution/external-resolver.js',
    'src/proto-resolution/dependency-graph.js',
    'src/proto-resolution/index.js',
    'test/vrml/proto-target.test.js',
    'test/proto-resolution/fixture-archive.js',
    'test/proto-resolution/external-resolver.test.js',
    'test/proto-resolution/dependency-graph.test.js',
    'test/proto-resolution/mutation-controls.test.js',
    'test/proto-resolution/graph-completeness.test.js',
    'test/proto-resolution/architecture-boundary.test.js',
  ];
  for (const f of expected) assert.ok(check.includes(`node --check ${f}`), `${f} must be in the syntax gate`);
});

test('the new test directory is enumerated by the cross-platform runner', () => {
  const runner = fs.readFileSync(path.join(ROOT, 'scripts', 'run-tests.js'), 'utf8');
  assert.ok(runner.includes("'test/proto-resolution'"), 'the runner must collect the new suite');
});

// --- strict WD1.6 semantics are unchanged by C's existence -------------------

test('WD1.6-C still answers an EXTERNPROTO child strictly, with no external evidence', () => {
  // WD1.7-C proves targets. It does NOT enrich a strict-local answer, and the
  // strict answer must stay exactly what it was before this lane existed --
  // enrichment is WD1.7-D's, and it will CONTAIN the strict result rather than
  // replace it.
  const { parse, interfaceQuery, containment } = require('../../src/vrml');
  const src = '#VRML V2.0 utf8\nEXTERNPROTO Thing [] "thing.wrl"\n'
    + 'Group { children [ Thing {} ] }\n';
  const p = parse(src);
  const graph = interfaceQuery.buildScopeGraph(p);
  const group = p.tree.statements.find((s2) => s2.type === 'Node');
  const child = group.fields[0].value.items[0];
  const verdict = containment.childLegality(graph, group, 'children', child);
  assert.equal(verdict.status, containment.CONTAINMENT_STATUS.UNSUPPORTED);
  assert.equal(verdict.reason, containment.CONTAINMENT_REASON.EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE);
});

test('no WD1.6 module has acquired a resolver context, so none can be enriched by accident', () => {
  // The mechanical proof is that the strict modules have no way to REACH
  // external evidence: no retrieval, no orchestration, no resolver context.
  for (const f of ['interface-query.js', 'containment.js', 'semantic-findings.js']) {
    const code = codeOf(path.join(ROOT, 'src', 'vrml', f));
    for (const forbidden of ['external-proto', 'proto-resolution', 'ResolverContext', 'resolverContext', 'externalEvidence']) {
      assert.ok(!code.includes(forbidden), `${f} must stay strict-local (found ${forbidden})`);
    }
  }
});
