'use strict';
// WD1.7-B -- architecture boundary audit.
//
// This lane introduces the FIRST `fs`-bound VRML module in the repository, so the
// boundary it must not cross is worth asserting mechanically rather than
// promising in a comment:
//
//   * `require('src/vrml')` -- the browser-safe semantic facade the renderer and
//     the editor load -- must not pull retrieval, and therefore must not pull
//     `fs`, `zlib`, `crypto` or `child_process` in behind it;
//   * retrieval may depend on pure helpers, never the other way round;
//   * World Project gains NO coupling to retrieval in this lane (that is B2);
//   * the substrate contains no target-PROTO semantics and no network path.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const EP = path.join(ROOT, 'src', 'external-proto');
const EP_FILES = fs.readdirSync(EP).filter((f) => f.endsWith('.js'));
const read = (p) => fs.readFileSync(p, 'utf8');
// Comments carry the rationale (and name the very things that must not be
// imported), so every source scan below is done on code with comments removed.
const codeOf = (p) => read(p).replace(/^\s*\/\/.*$/gm, '');

test('the lane is exactly the modules it claims to be', () => {
  assert.deepEqual(EP_FILES.sort(), ['index.js', 'reference-forms.js', 'resolver-context.js', 'retrieval.js', 'routing.js', 'url-origin.js']);
});

test('requiring the browser-safe vrml facade loads NO retrieval module', () => {
  // A child process, so this file's own requires cannot mask the result.
  const out = execFileSync(process.execPath, ['-e', `
    require(${JSON.stringify(path.join(ROOT, 'src', 'vrml'))});
    const loaded = Object.keys(require.cache).filter((p) => p.includes('external-proto'));
    process.stdout.write(JSON.stringify(loaded));
  `], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), []);
});

test('requiring the vrml facade pulls in no Node capability module', () => {
  const out = execFileSync(process.execPath, ['-e', `
    require(${JSON.stringify(path.join(ROOT, 'src', 'vrml'))});
    const src = Object.keys(require.cache).filter((p) => p.includes('${path.sep}src${path.sep}'));
    const fs2 = require('fs');
    const bad = [];
    for (const p of src) {
      const text = fs2.readFileSync(p, 'utf8').replace(/^\\s*\\/\\/.*$/gm, '');
      for (const cap of ['fs', 'node:fs', 'zlib', 'node:zlib', 'crypto', 'node:crypto', 'child_process', 'node:child_process', 'http', 'https', 'net', 'electron']) {
        if (text.includes("require('" + cap + "')") || text.includes('require("' + cap + '")')) bad.push(p + ' -> ' + cap);
      }
    }
    process.stdout.write(JSON.stringify(bad));
  `], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), [], 'the browser-safe semantic layer must stay capability-free');
});

test('no module outside the lane requires the retrieval substrate yet', () => {
  const scanned = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'external-proto' && entry.name !== 'node_modules') walk(p); continue; }
      if (!entry.name.endsWith('.js')) continue;
      scanned.push(p);
      assert.ok(!codeOf(p).includes('external-proto'), `${path.relative(ROOT, p)} must not depend on the retrieval substrate in WD1.7-B`);
    }
  };
  for (const dir of ['src', 'renderer', 'qa']) walk(path.join(ROOT, dir));
  for (const f of ['main.js', 'preload.js', 'validator.js']) assert.ok(!codeOf(path.join(ROOT, f)).includes('external-proto'), f);
  assert.ok(scanned.length > 50, 'the audit must actually have scanned the tree');
});

test('World Project is not coupled to retrieval in this lane', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'src', 'world-project'))) {
    if (!f.endsWith('.js')) continue;
    assert.ok(!codeOf(path.join(ROOT, 'src', 'world-project', f)).includes('external-proto'), f);
  }
});

test('the pure modules declare no filesystem, compression or network capability', () => {
  for (const f of ['reference-forms.js', 'routing.js', 'resolver-context.js', 'url-origin.js']) {
    const code = codeOf(path.join(EP, f));
    for (const cap of ['fs', 'node:fs', 'zlib', 'crypto', 'http', 'https', 'net', 'electron']) {
      assert.ok(!code.includes(`require('${cap}')`), `${f} must not require ${cap}`);
    }
  }
});

test('retrieval declares no network capability anywhere in the lane', () => {
  for (const f of EP_FILES) {
    const code = codeOf(path.join(EP, f));
    for (const forbidden of ["require('http')", "require('https')", "require('net')", "require('dns')", "require('electron')", 'fetch(', 'XMLHttpRequest', 'WebSocket', 'child_process']) {
      assert.ok(!code.includes(forbidden), `${f} must not contain ${forbidden}`);
    }
  }
});

test('the lane never consults ambient machine state', () => {
  for (const f of EP_FILES) {
    const code = codeOf(path.join(EP, f));
    for (const forbidden of ['process.cwd', 'process.env', 'os.homedir', "require('os')", '__dirname', '/home/']) {
      assert.ok(!code.includes(forbidden), `${f} must not contain ${forbidden}`);
    }
  }
});

test('the lane performs no filesystem WRITE', () => {
  for (const f of EP_FILES) {
    const code = codeOf(path.join(EP, f));
    for (const forbidden of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'rmdirSync', 'unlinkSync', 'renameSync', 'copyFileSync', 'createWriteStream', 'chmodSync', 'writeSync', 'truncateSync']) {
      assert.ok(!code.includes(forbidden), `${f} must not contain ${forbidden}`);
    }
  }
});

test('the module require graph inside the lane is acyclic and one-way', () => {
  const deps = new Map();
  for (const f of EP_FILES) {
    const code = codeOf(path.join(EP, f));
    deps.set(f, [...code.matchAll(/require\('\.\/([a-z-]+)'\)/g)].map((m) => `${m[1]}.js`));
  }
  // index depends on everything; retrieval on classification+routing; routing on
  // classification+context; classification and context share ONE origin
  // canonicalization authority; that authority depends on nothing in-lane.
  //
  // The shared dependency is the point of correction 1: if classification and
  // configuration each canonicalized origins their own way, a configured mapping
  // could silently never match a candidate that spells the port differently.
  assert.deepEqual(deps.get('url-origin.js'), []);
  assert.deepEqual(deps.get('reference-forms.js'), ['url-origin.js']);
  assert.deepEqual(deps.get('resolver-context.js'), ['url-origin.js']);
  assert.deepEqual(deps.get('routing.js').sort(), ['reference-forms.js', 'resolver-context.js']);
  assert.deepEqual(deps.get('retrieval.js').sort(), ['reference-forms.js', 'routing.js']);
  const seen = new Set();
  const visiting = new Set();
  const visit = (f) => {
    if (seen.has(f)) return;
    assert.ok(!visiting.has(f), `cycle through ${f}`);
    visiting.add(f);
    for (const d of deps.get(f) || []) visit(d);
    visiting.delete(f);
    seen.add(f);
  };
  for (const f of EP_FILES) visit(f);
});

test('retrieval reuses the production gzip magic-byte authority rather than forking it', () => {
  assert.ok(codeOf(path.join(EP, 'retrieval.js')).includes("require('../files/vrml-file')"));
  assert.ok(!codeOf(path.join(EP, 'retrieval.js')).includes('0x1f'), 'the magic bytes must not be re-declared here');
});

test('WD1.7-B contains NO target-PROTO semantics -- that is WD1.7-C', () => {
  for (const f of EP_FILES) {
    const code = codeOf(path.join(EP, f));
    // No parser, no schema, no scope graph: retrieval never reads the document
    // it retrieved.
    for (const forbidden of ["require('../vrml", 'parse(', 'selectedProtoName', 'selectionRule', 'selectionWasUnique', 'dependencyChain', 'cycleKey', 'RESOLVED', 'TARGET_', 'nodeTypeId']) {
      assert.ok(!code.includes(forbidden), `${f} must not contain ${forbidden}`);
    }
    // `PROTOCOL_RELATIVE` legitimately contains the letters; a word-boundary
    // match is what proves no PROTO/EXTERNPROTO *concept* is handled here.
    assert.ok(!/\bPROTO\b/.test(code), `${f} must not handle PROTO declarations`);
    assert.ok(!/\bEXTERNPROTO\b/.test(code), `${f} must not handle EXTERNPROTO declarations`);
  }
});

test('origin canonicalization has exactly ONE authority in the lane', () => {
  // Only `url-origin.js` may construct an origin string; everyone else asks it.
  for (const f of EP_FILES) {
    if (f === 'url-origin.js') continue;
    const code = codeOf(path.join(EP, f));
    assert.ok(!code.includes('new URL('), `${f} must not parse URLs itself`);
    // `scheme://` immediately followed by an interpolated authority IS origin
    // assembly; a bare `${scheme}://` used only to split a URL is not.
    assert.ok(!/\$\{scheme\}:\/\/\$\{/.test(code), `${f} must not assemble an origin itself`);
  }
  assert.ok(codeOf(path.join(EP, 'reference-forms.js')).includes("require('./url-origin')"));
  assert.ok(codeOf(path.join(EP, 'resolver-context.js')).includes("require('./url-origin')"));
});

test('the public facade publishes exactly the intended surface', () => {
  const api = require('../../src/external-proto');
  assert.deepEqual(Object.keys(api).sort(), [
    'CLASSIFY_REASON', 'DEFAULT_LIMITS', 'REFERENCE_FORM', 'RETRIEVAL_REASON', 'RETRIEVAL_STATUS',
    'ROUTE_REASON', 'classifyReference', 'createResolverContext', 'retrieveExternalCandidate', 'sourceById',
  ]);
  assert.ok(Object.isFrozen(api));
  // No candidate-list walker: ISO 4.5.2 fallback stops on "interpretable data",
  // which is only knowable after WD1.7-C parses and selects a target.
  for (const k of Object.keys(api)) assert.ok(!/all|list|walk|resolveExternal/i.test(k), `unexpected list/resolve helper: ${k}`);
});

test('the status vocabulary is retrieval-only -- no resolution status leaks in', () => {
  const { RETRIEVAL_STATUS } = require('../../src/external-proto');
  assert.deepEqual(Object.keys(RETRIEVAL_STATUS).sort(), [
    'AMBIGUOUS_SOURCE', 'DECODE_FAILED', 'LIMIT_EXCEEDED', 'NOT_FOUND',
    'NOT_RETRIEVED_BY_POLICY', 'RETRIEVED', 'UNREADABLE_ARTIFACT', 'UNSUPPORTED_REFERENCE',
  ]);
  for (const forbidden of ['RESOLVED', 'TARGET_PARSE_FAILED', 'TARGET_PROTO_NOT_FOUND', 'TARGET_PROTO_AMBIGUOUS', 'DEPENDENCY_CYCLE', 'NOT_ATTEMPTED', 'ERROR']) {
    assert.ok(!(forbidden in RETRIEVAL_STATUS), `${forbidden} belongs to WD1.7-C, not B`);
  }
});
