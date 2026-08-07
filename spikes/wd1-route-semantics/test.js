'use strict';
// WD1.5-P2C -- tests for the AUDIT HARNESS itself.
//
//   node --test spikes/wd1-route-semantics/test.js
//
// NOT collected by `npm run check`: `scripts/run-tests.js` enumerates named
// directories under `test/`, so nothing here changes the production test count.
// That is the same isolation the WD1.4 and WD1.5 spikes have.
//
// These tests are mostly about the HARNESS rather than about VRML97. Their job
// is to make the audit's central claim -- "an independent oracle found 0 wrong
// bindings" -- mean what it says:
//
//   * the oracle genuinely cannot reach the resolver it grades;
//   * the corpus reader genuinely cannot write;
//   * the adversarial detectors genuinely still fire;
//   * the output is genuinely deterministic.
//
// The VRML97 rules themselves are pinned by the PRODUCTION suite
// (`test/vrml/route-semantics.test.js`, 54 tests). This file does not duplicate
// them; it only checks that the oracle's own reading is exercised.

// LOAD ORDER IS PART OF THE EVIDENCE, in this file too. `controls.js` pulls in
// the production resolver, so the oracle must be required BEFORE it or the
// oracle's own guard fires -- which is precisely the behaviour the guard exists
// for, and precisely how this file first discovered it works.
const oracle = require('./oracle');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const REPO_ROOT = path.resolve(HERE, '..', '..');
const ORACLE = path.join(HERE, 'oracle.js');
const CORPUS = path.join(HERE, 'corpus.js');

// ---------------------------------------------------------------------------
// 1. THE ORACLE CANNOT REACH WHAT IT GRADES
// ---------------------------------------------------------------------------

test('oracle: loading it alone pulls in NEITHER production resolver module', () => {
  // The strongest of the three guards, and the reason it is a child process:
  // it proves absence TRANSITIVELY, through every module the oracle reaches at
  // any depth. A source scan cannot do that -- an innocent-looking dependency
  // three levels down could require the resolver and no amount of reading
  // oracle.js would show it.
  const script = `
    require(${JSON.stringify(ORACLE)});
    const keys = Object.keys(require.cache);
    const bad = keys.filter((k) => /src[\\\\/]+vrml[\\\\/]+(scope-graph|symbols)\\.js$/.test(k));
    process.stdout.write(JSON.stringify(bad));
  `;
  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), [],
    'the oracle transitively loaded the production ROUTE resolver');
});

test('oracle: its load-time guard actually fires when the resolver is preloaded', () => {
  // A guard that has never been observed to throw is a comment. This proves the
  // precondition `run.js` satisfies is a real one, by violating it on purpose.
  const script = `
    require(${JSON.stringify(path.join(REPO_ROOT, 'src', 'vrml', 'scope-graph.js'))});
    try {
      require(${JSON.stringify(ORACLE)});
      process.stdout.write('NO-THROW');
    } catch (err) {
      process.stdout.write(/independence violation/.test(err.message) ? 'THREW' : 'WRONG-ERROR');
    }
  `;
  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(out, 'THREW');
});

test('oracle: its ENTIRE require surface is three neutral modules', () => {
  // The auditable version. Every `require(...)` argument in the file is
  // extracted and compared against an explicit allow-list, so a new dependency
  // fails here rather than being noticed by a careful reader or not at all.
  const src = fs.readFileSync(ORACLE, 'utf8');
  const found = [...src.matchAll(/\brequire\(((?:[^()]|\([^()]*\))*)\)/g)].map((m) => m[1].trim());
  assert.deepEqual(found.sort(), [
    "'path'",
    "path.join(VRML_DIR, 'index.js')",
    "path.join(VRML_DIR, 'node-schema.js')",
  ].sort(), `unexpected require in oracle.js: ${JSON.stringify(found)}`);
});

test('oracle: it names no production resolution helper', () => {
  const src = stripComments(fs.readFileSync(ORACLE, 'utf8'));
  for (const banned of ['buildScopeGraph', 'acquireEndpointOn', 'acquireRouteEndpoint',
    'resolveRouteNode', 'resolveRouteEndpoint', 'routeVerdict', 'routeEndpointFor',
    'interfaceScopeFor', 'resolveIs']) {
    assert.equal(src.includes(banned), false,
      `oracle.js references the production helper '${banned}'`);
  }
});

test('oracle: WD.md §7 banned ranking vocabulary is absent', () => {
  // Carried forward from WD1.4/WD1.5 unchanged. An oracle that scored or
  // fuzzy-matched candidates would be grading against the very failure mode the
  // hard gate exists to forbid.
  const src = stripComments(fs.readFileSync(ORACLE, 'utf8'));
  for (const banned of ['score', 'closest', 'nearest', 'bestMatch', 'fuzzy']) {
    assert.equal(src.includes(banned), false, `oracle.js contains '${banned}'`);
  }
});

// ---------------------------------------------------------------------------
// 2. THE CORPUS READER CANNOT WRITE
// ---------------------------------------------------------------------------

test('corpus: it calls no filesystem write API', () => {
  const src = stripComments(fs.readFileSync(CORPUS, 'utf8'));
  // Named precisely enough not to collide with ordinary vocabulary: an earlier
  // draft banned bare 'truncate' and matched the parser's own `truncated` flag.
  for (const banned of ['writeFile', 'appendFile', 'mkdirSync', 'mkdir(', 'rmSync', 'rmdir',
    'unlink', 'renameSync', 'copyFile', 'createWriteStream', 'truncateSync', 'chmod',
    'utimes', 'openSync']) {
    assert.equal(src.includes(banned), false, `corpus.js calls '${banned}'`);
  }
});

test('corpus: a forbidden path THROWS rather than being skipped', () => {
  // A silent skip would let a future root change cross the White Dune / RE
  // boundary quietly, which is the whole reason this is an assertion and not a
  // filter. See WD.md §1.
  const corpus = require('./corpus');
  for (const marker of corpus.FORBIDDEN_MARKERS) {
    assert.throws(() => corpus.assertAllowed(`/somewhere/${marker}/thing.wrl`),
      /boundary violation/, `marker '${marker}' must throw`);
  }
  assert.doesNotThrow(() => corpus.assertAllowed('/ordinary/path/thing.wrl'));
});

test('corpus: identity is taken over DECODED text, so a gzip twin is one document', () => {
  // The recorded trap. De-duplicating raw bytes counted a `.wrz` and its plain
  // `.wrl` twin as two documents and inflated an earlier denominator by ~32%.
  const zlib = require('zlib');
  const corpus = require('./corpus');
  const text = '#VRML V2.0 utf8\nDEF A Transform { }\n';
  const gz = zlib.gzipSync(Buffer.from(text, 'utf8'));
  assert.notEqual(gz.toString('binary'), text, 'the two byte streams differ');
  assert.equal(corpus.contentIdentity(text),
    corpus.contentIdentity(zlib.gunzipSync(gz).toString('utf8')),
    'decoded identity must collapse the gzip twin onto one document');
});

test('corpus: ROUTEs are counted everywhere 4.10.2 and Annex A.3 admit them', () => {
  const corpus = require('./corpus');
  const { parse } = require(path.join(REPO_ROOT, 'src', 'vrml'));
  const src = '#VRML V2.0 utf8\n'
    + 'PROTO P [ ] { Group { children [ ROUTE A.a_changed TO B.set_b ] } }\n'
    + 'DEF T TimeSensor { }\n'
    + 'Group { children [ ] }\n'
    + 'ROUTE T.isActive TO T.set_enabled\n';
  // One inside a PROTO body inside an MFNode array, one at the top level.
  assert.equal(corpus.countRoutes(parse(src).tree), 2);
});

// ---------------------------------------------------------------------------
// 3. THE DETECTORS STILL FIRE
// ---------------------------------------------------------------------------

test('controls: every adversarial control fires', () => {
  const controls = require('./controls');
  const { results, allPassed } = controls.runControls();
  const dead = results.filter((r) => !r.passed).map((r) => `${r.id}${r.error ? `: ${r.error}` : ''}`);
  assert.deepEqual(dead, [], 'a detector stopped firing; corpus zero-counts are no longer evidence');
  assert.equal(allPassed, true);
  assert.equal(results.length >= 11, true, `expected at least 11 controls, saw ${results.length}`);
});

test('controls: the control set covers every classifier the corpus reports zero for', () => {
  const controls = require('./controls');
  const ids = new Set(controls.CONTROLS.map((c) => c.id));
  for (const required of ['forward-def-reference', 'duplicate-def',
    'direction-source-not-event-out', 'direction-dest-not-event-in', 'field-as-event',
    'type-mismatch', 'shorthand-source', 'shorthand-destination',
    'r19-fallback-past-wrong-kind', 'unknown-endpoint', 'externproto-unsupported',
    'nested-proto-isolation', 'recovered-scope-withholds']) {
    assert.equal(ids.has(required), true, `missing control '${required}'`);
  }
});

// ---------------------------------------------------------------------------
// 4. THE ORACLE'S OWN READING IS EXERCISED
// ---------------------------------------------------------------------------
//
// An oracle that abstained on everything would also report zero wrong bindings.
// These pin that it actually commits to answers, and to the RIGHT ones, derived
// from its own model rather than from the resolver's.

test('oracle: it binds, refuses and abstains -- and says which', () => {
  const { EXPECT } = oracle;
  const run = (body) => oracle.expectations(oracle.parse(`#VRML V2.0 utf8\n${body}`));

  // A clean binding.
  let r = run('DEF T TimeSensor { }\nDEF X Transform { }\nROUTE T.isActive TO X.set_translation\n')[0];
  assert.equal(r.source.node.verdict, EXPECT.BINDS);
  assert.equal(r.source.endpoint.verdict, EXPECT.BINDS);
  assert.equal(r.source.endpoint.endpoint.declaredName, 'isActive');
  assert.equal(r.destination.endpoint.endpoint.declaredName, 'translation');
  assert.equal(r.destination.endpoint.endpoint.access, oracle.ACCESS.EVENT_IN);

  // R5 -- declared, but only after the ROUTE.
  r = run('DEF X Transform { }\nROUTE L.isActive TO X.set_translation\nDEF L TimeSensor { }\n')[0];
  assert.equal(r.source.node.verdict, EXPECT.NO_BINDING);
  assert.equal(r.source.node.why, 'declared-only-after-the-route');

  // 4.6.2 duplicates -- refused, never ranked.
  r = run('DEF T TimeSensor { }\nDEF T TimeSensor { }\nDEF X Transform { }\n'
    + 'ROUTE T.isActive TO X.set_translation\n')[0];
  assert.equal(r.source.node.verdict, EXPECT.NO_BINDING);
  assert.equal(r.source.node.why, 'duplicate-declaration-in-scope');

  // 4.8.4 -- a PROTO body DEF is invisible outside it.
  r = run('PROTO P [ ] { DEF Inner TimeSensor { } }\nDEF X Transform { }\n'
    + 'ROUTE Inner.isActive TO X.set_translation\n')[0];
  assert.equal(r.source.node.verdict, EXPECT.NO_BINDING);
  assert.equal(r.source.node.why, 'not-declared-in-this-scope');

  // 4.9.2 -- an EXTERNPROTO's local silence is unknowable, so ABSTAIN.
  r = run('EXTERNPROTO W [ eventIn SFBool declared ] "w.wrl"\nDEF T TimeSensor { }\n'
    + 'DEF N W { }\nROUTE T.isActive TO N.undeclared\n')[0];
  assert.equal(r.destination.endpoint.verdict, EXPECT.ABSTAIN);
  assert.equal(r.destination.endpoint.why, 'externproto-not-locally-verifiable');
});

test('oracle: R12 shorthand and the R19 direction-specific fallback', () => {
  const run = (body) => oracle.expectations(oracle.parse(`#VRML V2.0 utf8\n${body}`));

  // Bare source name falls back to `zzz_changed`.
  let r = run('DEF T TimeSensor { }\nDEF S Script { eventIn SFFloat take url [ ] }\n'
    + 'ROUTE T.fraction TO S.take\n')[0];
  assert.equal(r.source.endpoint.verdict, oracle.EXPECT.BINDS);
  assert.equal(r.source.endpoint.endpoint.declaredName, 'fraction_changed');
  assert.equal(r.source.endpoint.viaShorthand, true);

  // R19: the written name EXISTS as a field, so the fallback still applies.
  r = run('DEF T TimeSensor { }\n'
    + 'DEF S Script { field SFBool zzz FALSE eventIn SFBool set_zzz url [ ] }\n'
    + 'ROUTE T.isActive TO S.zzz\n')[0];
  assert.equal(r.destination.endpoint.verdict, oracle.EXPECT.BINDS);
  assert.equal(r.destination.endpoint.endpoint.declaredName, 'set_zzz');
  assert.equal(r.destination.endpoint.viaShorthand, true);

  // Order is normative: the written name wins when it can serve.
  r = run('DEF T TimeSensor { }\n'
    + 'DEF S Script { eventIn SFBool zzz eventIn SFBool set_zzz url [ ] }\n'
    + 'ROUTE T.isActive TO S.zzz\n')[0];
  assert.equal(r.destination.endpoint.endpoint.declaredName, 'zzz');
  assert.equal(r.destination.endpoint.viaShorthand, false);
});

test('oracle: 4.7 alias expansion, and a collision binds NOTHING', () => {
  const expanded = oracle.expandMembers([
    { name: 'zzz', access: oracle.ACCESS.EXPOSED_FIELD, type: 'SFBool' },
  ]);
  assert.equal(expanded.get('zzz').access, oracle.ACCESS.EXPOSED_FIELD);
  assert.equal(expanded.get('set_zzz').access, oracle.ACCESS.EVENT_IN);
  assert.equal(expanded.get('zzz_changed').access, oracle.ACCESS.EVENT_OUT);
  assert.equal(expanded.get('set_zzz').declaredName, 'zzz',
    'the binding is the DECLARED member, not the spelling used to reach it');

  // 4.3.5 prohibits this outright, so neither declaration is the intended one.
  const collided = oracle.expandMembers([
    { name: 'zzz', access: oracle.ACCESS.EXPOSED_FIELD, type: 'SFBool' },
    { name: 'set_zzz', access: oracle.ACCESS.EVENT_IN, type: 'SFBool' },
  ]);
  assert.equal(collided.get('set_zzz'), oracle.COLLIDED);
});

test('oracle: X3D-only fields never enter a VRML97 interface', () => {
  // WD1.3 records 232 X3D-only fields. One leaking in would let the oracle
  // expect an endpoint VRML97 does not have.
  const members = oracle.builtinMembers('TimeSensor');
  assert.equal(members.length > 0, true);
  for (const m of members) {
    assert.equal(['field', 'eventIn', 'eventOut', 'exposedField'].includes(m.access), true,
      `member '${m.name}' has a non-VRML97 declaration`);
  }
});

// ---------------------------------------------------------------------------
// 5. DETERMINISM
// ---------------------------------------------------------------------------

test('run: the control report is deterministic and carries no clock or path', () => {
  const controls = require('./controls');
  const a = JSON.stringify(controls.runControls());
  const b = JSON.stringify(controls.runControls());
  assert.equal(a, b, 'two runs must be byte-identical');
  assert.equal(/\d{4}-\d{2}-\d{2}T/.test(a), false, 'no timestamp may appear');
  assert.equal(a.includes('/home/'), false, 'no absolute path may appear');
});

test('run: --controls-only produces a PASS verdict and writes only under out/', () => {
  const out = fs.mkdtempSync(path.join(require('os').tmpdir(), 'p2c-harness-'));
  try {
    execFileSync(process.execPath,
      [path.join(HERE, 'run.js'), '--controls-only', '--quiet', `--out=${out}`],
      { encoding: 'utf8' });
    const report = JSON.parse(fs.readFileSync(path.join(out, 'audit.json'), 'utf8'));
    assert.equal(report.verdict, 'PASS');
    assert.equal(report.controls.allPassed, true);
    assert.deepEqual(fs.readdirSync(out).sort(), ['audit.json', 'metrics.md']);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------

/**
 * Strip comments before a source scan.
 *
 * KNOWN LIMITATION, recorded rather than papered over: this does not understand
 * regex literals, so a `//` inside one would be read as a line comment. It is
 * the same weakness `codeOnly()` has in the P2B suite, deferred there as a
 * separate test-hygiene item and NOT fixed here. It is safe for these scans
 * because neither scanned file contains a regex literal -- asserted below so the
 * assumption fails loudly if that changes.
 */
function stripComments(src) {
  assert.equal(/[^\\]\/[^/*\s][^\n]*\/[gimsuy]*[),;.\s]/.test(src.replace(/\/\/[^\n]*/g, '')),
    false, 'stripComments assumes the scanned file has no regex literal');
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
