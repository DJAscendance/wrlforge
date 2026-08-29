'use strict';
// WD1.7-D -- architecture boundary audit.
//
// D spans the browser boundary the same way C does: its ISO 4.9.2 comparison is
// pure and lives in `src/vrml`, its orchestration over C evidence is Node-side
// and lives in `src/proto-enrichment`. That split is only worth anything if it
// is enforced, so the direction is asserted mechanically rather than promised:
//
//   * `require('src/vrml')` must stay loadable without `fs`/`zlib`/`crypto`, and
//     must not pull orchestration or retrieval in behind the new module;
//   * D may depend on C, WD1.6-B/C and the parser -- never the reverse;
//   * D contains no second grammar, no second type resolver, no second target
//     selector, no second retrieval path, no second class derivation, no
//     network, no writes and no ambient machine state;
//   * D populates no WD1.7-E compatibility slot and names no profile;
//   * every strict WD1.6 answer is unchanged by D's existence.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const PE = path.join(ROOT, 'src', 'proto-enrichment');
const PE_FILES = fs.readdirSync(PE).filter((f) => f.endsWith('.js'));
const PURE = path.join(ROOT, 'src', 'vrml', 'proto-agreement.js');
// Comments carry the rationale and name the very things that must not appear --
// the module headers cite ISO 4.7's `set_zzz` expansion by name, and that
// citation is why the rule exists. Every scan below therefore runs on code with
// BOTH comment forms removed, so a rule can never be satisfied by silence.
const codeOf = (p) => fs.readFileSync(p, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('the lane is exactly the modules it claims to be', () => {
  assert.deepEqual(PE_FILES.sort(), ['external-enrichment.js', 'index.js']);
  assert.ok(fs.existsSync(PURE), 'the pure half must live beside the parser');
});

test('the pure half declares no filesystem, compression, network or Electron capability', () => {
  const code = codeOf(PURE);
  for (const cap of ['fs', 'node:fs', 'zlib', 'node:zlib', 'crypto', 'node:crypto', 'http', 'https', 'net', 'child_process', 'electron', 'os', 'path']) {
    assert.ok(!code.includes(`require('${cap}')`), `proto-agreement.js must not require ${cap}`);
  }
  for (const forbidden of ['proto-resolution', 'proto-enrichment', 'external-proto']) {
    assert.ok(!code.includes(forbidden), `the pure half must not reach ${forbidden}`);
  }
});

test('requiring the browser-safe vrml facade loads NO orchestration and NO retrieval', () => {
  const out = execFileSync(process.execPath, ['-e', `
    require(${JSON.stringify(path.join(ROOT, 'src', 'vrml'))});
    const loaded = Object.keys(require.cache).filter((p) =>
      p.includes('proto-resolution') || p.includes('proto-enrichment') || p.includes('external-proto'));
    process.stdout.write(JSON.stringify(loaded));
  `], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), []);
});

test('D reaches every authority ONLY through a public facade', () => {
  for (const f of PE_FILES) {
    const code = codeOf(path.join(PE, f));
    for (const inner of ['parser', 'scope-graph', 'symbols', 'analyze', 'tokenizer',
      'proto-target', 'proto-agreement', 'containment', 'interface-query', 'node-schema', 'semantic-findings']) {
      assert.ok(!code.includes(`'../vrml/${inner}'`), `${f} must not reach into src/vrml/${inner}.js`);
    }
    for (const inner of ['external-resolver', 'dependency-graph']) {
      assert.ok(!code.includes(`'../proto-resolution/${inner}'`), `${f} must not reach into ${inner}.js`);
    }
    assert.ok(!code.includes('external-proto'), `${f} must not reach retrieval at all`);
    assert.ok(!code.includes('_internals'), `${f} must not use another lane's test-only internals`);
  }
});

test('D contains no second grammar -- the AST is the only syntax authority', () => {
  for (const f of PE_FILES) {
    const code = codeOf(path.join(PE, f));
    for (const forbidden of ['new RegExp', '.match(', 'indexOf(\'PROTO', 'split(\'{\'', 'readFileSync']) {
      assert.ok(!code.includes(forbidden), `${f} must not scan source text (found ${forbidden})`);
    }
  }
});

test('D contains no second resolver, selector or ranking of its own', () => {
  for (const f of [...PE_FILES.map((x) => path.join(PE, x)), PURE]) {
    const code = codeOf(f);
    for (const forbidden of ['nearest', 'closest', 'fuzzy', 'score', 'toLowerCase()',
      'startsWith(', 'endsWith(', 'selectPrototypeTarget', 'retrieveExternalCandidate',
      'resolveExternalPrototype', 'buildExternalDependencyGraph']) {
      assert.ok(!code.includes(forbidden),
        `${path.basename(f)} must not resolve, select or rank (found ${forbidden})`);
    }
  }
});

test('D contains no second 4.8.3 class derivation', () => {
  // The one authority is `containment.js`. D may CALL it; it may not re-derive
  // "the first body node determines the class" anywhere of its own.
  for (const f of [...PE_FILES.map((x) => path.join(PE, x)), PURE]) {
    const code = codeOf(f);
    for (const forbidden of ['firstBodyNode', '.body[0]', 'protoBodyScopeFor', 'getNodeClasses']) {
      assert.ok(!code.includes(forbidden),
        `${path.basename(f)} must not derive a class itself (found ${forbidden})`);
    }
  }
  const enrichment = codeOf(path.join(PE, 'external-enrichment.js'));
  assert.ok(enrichment.includes('containment.protoImplementationClass('),
    'the external class proof must go through the WD1.6-C authority');
  // And there is exactly ONE implementation of it in the repository.
  const containmentSrc = fs.readFileSync(path.join(ROOT, 'src', 'vrml', 'containment.js'), 'utf8');
  assert.equal(containmentSrc.split('function firstBodyNode(').length - 1, 1);
  assert.equal(containmentSrc.split('function stepIntoPrototype(').length - 1, 1);
});

test('D performs no filesystem access, no network and no writes', () => {
  for (const f of [...PE_FILES.map((x) => path.join(PE, x)), PURE]) {
    const code = codeOf(f);
    for (const cap of ['fs', 'node:fs', 'zlib', 'crypto', 'http', 'https', 'net', 'dns', 'electron', 'os']) {
      assert.ok(!code.includes(`require('${cap}')`), `${path.basename(f)} must not require ${cap}`);
    }
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'child_process',
      'writeFileSync', 'mkdirSync', 'unlinkSync', 'createWriteStream']) {
      assert.ok(!code.includes(forbidden), `${path.basename(f)} must not contain ${forbidden}`);
    }
  }
});

test('D consults no ambient machine state', () => {
  for (const f of [...PE_FILES.map((x) => path.join(PE, x)), PURE]) {
    const code = codeOf(f);
    for (const forbidden of ['process.cwd', 'process.env', 'homedir', '__dirname', '/home/', 'Date.now', 'Math.random']) {
      assert.ok(!code.includes(forbidden), `${path.basename(f)} must not contain ${forbidden}`);
    }
  }
});

test('D rewrites no document -- no substitution, inlining or url repair', () => {
  for (const f of [...PE_FILES.map((x) => path.join(PE, x)), PURE]) {
    const code = codeOf(f);
    for (const forbidden of ['applyEdit', 'require(\'../vrml/edit\')', 'serialize', 'toSource', 'rewrite']) {
      assert.ok(!code.includes(forbidden), `${path.basename(f)} must not rewrite source (found ${forbidden})`);
    }
  }
});

test('nothing depends on D -- the direction is one-way', () => {
  const holders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'proto-enrichment' && entry.name !== 'node_modules') walk(p); continue; }
      if (!entry.name.endsWith('.js')) continue;
      if (codeOf(p).includes('proto-enrichment')) holders.push(path.relative(ROOT, p));
    }
  };
  for (const dir of ['src', 'renderer', 'qa']) walk(path.join(ROOT, dir));
  for (const f of ['main.js', 'preload.js', 'validator.js']) {
    assert.ok(!codeOf(path.join(ROOT, f)).includes('proto-enrichment'), f);
  }
  // A World Project consumer of D is a separate, deliberate decision and would be
  // recorded here rather than discovered in a diff.
  assert.deepEqual(holders, [], 'no production module may consume D yet');
});

test('the module require graph inside the lane is acyclic and one-way', () => {
  const deps = new Map();
  for (const f of PE_FILES) {
    const code = codeOf(path.join(PE, f));
    deps.set(f, [...code.matchAll(/require\('\.\/([a-z-]+)'\)/g)].map((m) => `${m[1]}.js`));
  }
  assert.deepEqual(deps.get('external-enrichment.js'), []);
  assert.deepEqual(deps.get('index.js'), ['external-enrichment.js']);
});

test('the D facade publishes exactly the intended surface', () => {
  const api = require('../../src/proto-enrichment');
  assert.deepEqual(Object.keys(api).sort(), [
    'AGREEMENT_BASIS', 'AGREEMENT_FINDING', 'AGREEMENT_REASON', 'AGREEMENT_STATUS',
    'ENRICHMENT_REASON', 'ENRICHMENT_STATUS', 'EXTERNAL_CLASS_REASON', 'EXTERNAL_CLASS_STATUS',
    'MEMBER_STATUS', 'createEnrichmentSession', 'enrichExternalPrototype',
  ]);
  assert.ok(Object.isFrozen(api));
});

test('the vrml facade publishes exactly the intended WD1.7-D pure surface', () => {
  const { protoAgreement, containment } = require('../../src/vrml');
  assert.deepEqual(Object.keys(protoAgreement).sort(), [
    'AGREEMENT_BASIS', 'AGREEMENT_FINDING', 'AGREEMENT_REASON', 'AGREEMENT_STATUS',
    'MEMBER_STATUS', 'compareInterfaceAgreement', 'notAttempted',
  ]);
  assert.ok(Object.isFrozen(protoAgreement));
  // WD1.6-C gained exactly one symbol, and nothing else moved.
  assert.deepEqual(Object.keys(containment).sort(), [
    'CANDIDATE_KIND', 'CONTAINMENT_REASON', 'CONTAINMENT_STATUS',
    'childLegality', 'protoImplementationClass',
  ]);
});

test('D populates no compatibility slot and names no profile', () => {
  for (const f of [...PE_FILES.map((x) => path.join(PE, x)), PURE]) {
    const src = fs.readFileSync(f, 'utf8');
    for (const forbidden of ['blaxxun', 'Blaxxun', 'GLView', 'cybertown', 'Cybertown', 'legacy-vrml']) {
      assert.ok(!src.includes(forbidden), `${path.basename(f)} must not name ${forbidden}`);
    }
    const code = codeOf(f);
    assert.ok(!/compatibility\s*[:=]\s*(?!null)/.test(code.replace(/compatibility: null/g, '')),
      `${path.basename(f)} must not assign a compatibility value`);
  }
  assert.ok(codeOf(path.join(PE, 'external-enrichment.js')).includes('compatibility: null'));
});

test('the lane adds no runtime dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['x_ite']);
  const declared = new Set(['../vrml', '../proto-resolution', './external-enrichment']);
  for (const f of PE_FILES) {
    const code = codeOf(path.join(PE, f));
    for (const m of code.matchAll(/require\('([^']+)'\)/g)) {
      assert.ok(declared.has(m[1]), `${f} requires an unexpected module: ${m[1]}`);
    }
  }
});

test('every new source file is covered by the npm run check syntax gate', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const check = pkg.scripts.check;
  const expected = [
    'src/vrml/proto-agreement.js',
    'src/proto-enrichment/external-enrichment.js',
    'src/proto-enrichment/index.js',
    'test/vrml/proto-agreement.test.js',
    'test/proto-enrichment/fixtures.js',
    'test/proto-enrichment/external-enrichment.test.js',
    'test/proto-enrichment/mutation-controls.test.js',
    'test/proto-enrichment/architecture-boundary.test.js',
  ];
  for (const f of expected) assert.ok(check.includes(`node --check ${f}`), `${f} must be in the syntax gate`);
});

test('the new test directory is enumerated by the cross-platform runner', () => {
  const runner = fs.readFileSync(path.join(ROOT, 'scripts', 'run-tests.js'), 'utf8');
  assert.ok(runner.includes("'test/proto-enrichment'"), 'the runner must collect the new suite');
});

// --- strict WD1.6 semantics are unchanged by D's existence -------------------

test('WD1.6-C still answers an EXTERNPROTO child strictly, with no external evidence', () => {
  const { parse, interfaceQuery, containment } = require('../../src/vrml');
  const src = '#VRML V2.0 utf8\nEXTERNPROTO Thing [] "thing.wrl"\n'
    + 'Group { children [ Thing {} ] }\n';
  const p = parse(src);
  const graph = interfaceQuery.buildScopeGraph(p);
  const group = p.tree.statements.find((s) => s.type === 'Node');
  const child = group.fields[0].value.items[0];
  const verdict = containment.childLegality(graph, group, 'children', child);
  assert.equal(verdict.status, containment.CONTAINMENT_STATUS.UNSUPPORTED);
  assert.equal(verdict.reason, containment.CONTAINMENT_REASON.EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE);
});

test('WD1.6-B still reports an EXTERNPROTO interface resolved-but-incomplete', () => {
  const { parse, interfaceQuery } = require('../../src/vrml');
  const src = '#VRML V2.0 utf8\nEXTERNPROTO Thing [ field SFInt32 a ] "thing.wrl"\nThing {}\n';
  const p = parse(src);
  const graph = interfaceQuery.buildScopeGraph(p);
  const occurrence = p.tree.statements.find((s) => s.type === 'Node');
  const iface = interfaceQuery.effectiveInterfaceOf(graph, occurrence);
  assert.equal(iface.status, interfaceQuery.STATUS.RESOLVED);
  assert.equal(iface.complete, false, 'ISO 4.9.2: the local declaration may be a strict subset');
  assert.deepEqual(iface.members.map((m) => m.name), ['a']);
});

test('no WD1.6 module has acquired a resolver context, so none can be enriched by accident', () => {
  for (const f of ['interface-query.js', 'containment.js', 'semantic-findings.js', 'proto-agreement.js']) {
    const code = codeOf(path.join(ROOT, 'src', 'vrml', f));
    for (const forbidden of ['external-proto', 'proto-resolution', 'proto-enrichment',
      'ResolverContext', 'resolverContext', 'externalEvidence', 'dependencyGraph']) {
      assert.ok(!code.includes(forbidden), `${f} must stay strict-local (found ${forbidden})`);
    }
  }
});

test('structured semantic findings (WD1.6-D) are unchanged by D\'s existence', () => {
  const { parse, interfaceQuery, semanticFindings } = require('../../src/vrml');
  const src = '#VRML V2.0 utf8\nEXTERNPROTO Thing [] "thing.wrl"\n'
    + 'Group { children [ Thing {} ] }\n';
  const p = parse(src);
  const graph = interfaceQuery.buildScopeGraph(p);
  const findings = semanticFindings.findingsForDocument(graph);
  for (const f of findings) {
    assert.equal(f.compatibility, null, 'the reserved slot stays null');
    assert.ok(!('severity' in f) && !('message' in f));
  }
});
