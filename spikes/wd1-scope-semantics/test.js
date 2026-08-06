'use strict';
// WD1.5 spike tests.
//
//   node --test spikes/wd1-scope-semantics/test.js
//
// Not collected by `npm run check`: `scripts/run-tests.js` enumerates named
// directories under `test/`, so this file does not change the production test
// count.
//
// Most of these are about the HARNESS rather than the scope rules -- the rules
// are graded by `cases.js`, and a harness that can grade itself proves nothing.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { parse } = require(path.join(REPO_ROOT, 'src', 'vrml'));
const scopeModel = require('./scope-model');
const { CASES } = require('./cases');
const runner = require('./run');
const corpus = require('./corpus');

const { STATUS, SCOPE_KIND, SYMBOL_KIND, REASON } = scopeModel;
const H = '#VRML V2.0 utf8\n';

const build = (src) => scopeModel.buildScopeGraph(parse(src));

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// ---------------------------------------------------------------------------
// Candidate / oracle independence
// ---------------------------------------------------------------------------

test('cases.js does not require the scope model it grades', () => {
  const src = stripComments(fs.readFileSync(path.join(__dirname, 'cases.js'), 'utf8'));
  assert.ok(!/require\([^)]*scope-model/.test(src), 'cases.js must not require scope-model.js');
  assert.ok(!/require\([^)]*run\.js/.test(src), 'cases.js must not require run.js');
});

test('cases.js expectations are literal strings, not imported constants', () => {
  const src = stripComments(fs.readFileSync(path.join(__dirname, 'cases.js'), 'utf8'));
  assert.ok(!/\brequire\s*\(/.test(src), 'cases.js must not require anything at all');
  // Every status used must appear as a quoted literal.
  for (const status of ["'resolved'", "'unresolved'", "'ambiguous'", "'invalid'", "'unsupported'", "'recovered'"]) {
    assert.ok(src.includes(status), `expected literal ${status} in cases.js`);
  }
});

test('loading cases.js in a clean process pulls in no scope-model code', () => {
  const script = 'require(process.argv[1]);'
    + 'const keys=Object.keys(require.cache).map(k=>k.replace(/\\\\/g,"/"));'
    + 'process.stdout.write(JSON.stringify(keys));';
  const out = execFileSync(process.execPath, ['-e', script, path.join(__dirname, 'cases.js')], { encoding: 'utf8' });
  const keys = JSON.parse(out);
  assert.ok(!keys.some((k) => k.endsWith('/scope-model.js')), 'scope-model.js must not be loaded by cases.js');
  assert.ok(!keys.some((k) => k.endsWith('/corpus.js')), 'corpus.js must not be loaded by cases.js');
});

test('scope-model.js does not require the expectation file', () => {
  const src = stripComments(fs.readFileSync(path.join(__dirname, 'scope-model.js'), 'utf8'));
  assert.ok(!/require\([^)]*cases/.test(src), 'scope-model.js must not require cases.js');
});

// ---------------------------------------------------------------------------
// The banned behaviours -- absent by source scan AND by behaviour
// ---------------------------------------------------------------------------

test('the resolver never ranks, scores or first-matches candidates', () => {
  const src = stripComments(fs.readFileSync(path.join(__dirname, 'scope-model.js'), 'utf8'));
  for (const banned of ['score', 'closest', 'nearest', 'bestMatch', 'fuzzy']) {
    assert.ok(!new RegExp(`\\b${banned}`, 'i').test(src), `banned concept present: ${banned}`);
  }
});

test('two candidates never yield a node -- ambiguity is decided on the name alone', () => {
  const g = build(`${H}DEF A Shape { }\nDEF A Group { }\nGroup { children [ USE A ] }\n`);
  const use = g.resolutions.find((r) => r.kind === 'use');
  assert.strictEqual(use.status, STATUS.AMBIGUOUS);
  assert.strictEqual(use.symbolId, null, 'an ambiguous result must not carry a symbol');
  assert.strictEqual(use.candidateCount, 2);
});

test('no resolution carries a symbol unless it is resolved', () => {
  for (const testCase of CASES) {
    const g = build(testCase.source);
    for (const r of g.resolutions) {
      if (r.status !== STATUS.RESOLVED) {
        assert.strictEqual(r.symbolId, null, `${testCase.id}: ${r.kind}/${r.status} carried a symbol`);
      }
    }
  }
});

test('resolutions are frozen', () => {
  const g = build(`${H}Group { children [ DEF A Shape { } USE A ] }\n`);
  assert.ok(Object.isFrozen(g.resolutions[0]));
});

// ---------------------------------------------------------------------------
// Read-only over the parse result
// ---------------------------------------------------------------------------

test('building a scope graph does not mutate the parse result', () => {
  const src = `${H}PROTO P [ field SFVec3f t 0 0 0 ] { Transform { translation IS t } }\n`
    + `DEF A Group { children [ USE A ] }\nROUTE A.addChildren TO A.addChildren\n`;
  const before = parse(src);
  const snapshot = JSON.stringify(before.tree);
  scopeModel.buildScopeGraph(before);
  assert.strictEqual(JSON.stringify(before.tree), snapshot, 'the AST was mutated');
});

test('two graphs over the same parse are equal in shape', () => {
  const p = parse(`${H}DEF A Shape { }\nGroup { children [ USE A ] }\n`);
  const a = scopeModel.buildScopeGraph(p);
  const b = scopeModel.buildScopeGraph(p);
  assert.deepStrictEqual(
    a.resolutions.map((r) => `${r.kind}/${r.status}/${r.reason}`),
    b.resolutions.map((r) => `${r.kind}/${r.status}/${r.reason}`),
  );
});

// ---------------------------------------------------------------------------
// The 4.8.4 disjointness rule, which is the whole point of the lane
// ---------------------------------------------------------------------------

test('a PROTO body scope has no node-name parent', () => {
  const g = build(`${H}PROTO P [ ] { Group { } }\nGroup { }\n`);
  const body = g.scopes.find((s) => s.kind === SCOPE_KIND.PROTO_BODY);
  assert.strictEqual(body.defParent, null, 'PROTO DEF scope must be disjoint, not nested');
  assert.notStrictEqual(body.typeParent, null, 'PROTO TYPE scope must still nest outward');
});

test('scopes are identities, not joined strings: PROTO "A/B" cannot collide with A > B', () => {
  const g = build(`${H}PROTO A/B [ ] { Group { children [ DEF X Shape { } ] } }\n`
    + `PROTO A [ ] { PROTO B [ ] { Group { children [ DEF X Shape { } ] } } Group { } }\nGroup { }\n`);
  const defs = g.symbols.filter((s) => s.kind === SYMBOL_KIND.NODE_DEF && s.name === 'X');
  assert.strictEqual(defs.length, 2);
  assert.strictEqual(new Set(defs.map((d) => d.scopeId)).size, 2, 'the two DEFs must live in distinct scopes');
  const dup = g.findings.filter((f) => f.code === REASON.DUPLICATE_DEF_IN_SCOPE);
  assert.strictEqual(dup.length, 0);
});

test('node names and node type names are separate namespaces', () => {
  // A PROTO named `Ball` and a DEF named `Ball` must not interfere.
  const g = build(`${H}PROTO Ball [ ] { Sphere { } }\nDEF Ball Group { children [ Ball { } ] }\n`
    + `Group { children [ USE Ball ] }\n`);
  const use = g.resolutions.find((r) => r.kind === 'use');
  assert.strictEqual(use.status, STATUS.RESOLVED);
  const nodeType = g.resolutions.find((r) => r.kind === 'node-type' && r.name === 'Ball');
  assert.strictEqual(nodeType.status, STATUS.RESOLVED);
  assert.strictEqual(nodeType.reason, REASON.OK);
});

// ---------------------------------------------------------------------------
// Fail-closed asymmetry
// ---------------------------------------------------------------------------

// REVISED after an external review disproved the original asymmetry claim.
// A damaged scope withholds BOTH answers: parser recovery moves scope
// boundaries, so neither the presence nor the absence of a declaration IN THAT
// SCOPE can be trusted. See the X59 regression below for why.
test('a damaged scope withholds both positive and negative lexical answers', () => {
  const g = build(`${H}PROTO P [ ] { Group { children [ DEF Real Shape { } USE Real USE Ghost\n`);
  const real = g.resolutions.find((r) => r.kind === 'use' && r.name === 'Real');
  const ghost = g.resolutions.find((r) => r.kind === 'use' && r.name === 'Ghost');
  assert.strictEqual(real.status, STATUS.RECOVERED, 'scope membership is not provable here');
  assert.strictEqual(real.symbolId, null, 'a recovered result must never carry a symbol');
  assert.strictEqual(ghost.status, STATUS.RECOVERED, 'absence is not provable either');
});

test('regression: an unclosed PROTO cannot turn an ambiguous binding into a unique one', () => {
  const truth = build(`${H}DEF Foo Group { }\nPROTO P [ ] {\n  Shape { }\n}\n`
    + `DEF Foo Transform { }\nGroup { children [ USE Foo ] }\n`);
  const damaged = build(`${H}DEF Foo Group { }\nPROTO P [ ] {\n  Shape { }\n`
    + `DEF Foo Transform { }\nGroup { children [ USE Foo ] }\n`);

  const t = truth.resolutions.find((r) => r.kind === 'use');
  assert.strictEqual(t.status, STATUS.AMBIGUOUS, 'two DEF Foo share the document scope');

  const d = damaged.resolutions.find((r) => r.kind === 'use');
  assert.strictEqual(d.status, STATUS.RECOVERED, 'must not manufacture a unique binding');
  assert.strictEqual(d.symbolId, null);
});

test('a schema fact is NOT downgraded by a damaged scope', () => {
  // A built-in node type and a built-in event are clause-6 facts with no scope
  // dependency, so recovery must not suppress them -- the guard is lexical only.
  const g = build(`${H}Group { children [ DEF T TimeSensor { } ] \nTransform { translation }\n`);
  const builtin = g.resolutions.find((r) => r.kind === 'node-type' && r.name === 'TimeSensor');
  assert.strictEqual(builtin.status, STATUS.RESOLVED);
  assert.strictEqual(builtin.reason, REASON.NODE_TYPE_IS_BUILTIN);
});

test('a syntax error is attributed to the innermost scope, not to every enclosing one', () => {
  const g = build(`${H}PROTO P [ ] { Group { children [ USE Ghost\n} }\nGroup { children [ USE AlsoGhost ] }\n`);
  const doc = g.scopes.find((s) => s.kind === SCOPE_KIND.DOCUMENT);
  const body = g.scopes.find((s) => s.kind === SCOPE_KIND.PROTO_BODY);
  assert.strictEqual(body.recovered, true);
  assert.strictEqual(doc.recovered, false, 'one damaged PROTO must not blind the whole document');
});

test('a hard parse cap makes the entire graph unprovable', () => {
  const p = parse(`${H}Group { children [ DEF A Shape { } USE A ] }\n`, { maxNodes: 1 });
  const g = scopeModel.buildScopeGraph(p);
  assert.strictEqual(p.truncated, true, 'the node cap did not trip');
  assert.strictEqual(g.documentIncomplete, true);
  for (const scope of g.scopes) assert.strictEqual(scope.recovered, true);
});

test('an unnamed PROTO fails closed rather than inventing a scope key', () => {
  const g = build(`${H}PROTO [ ] { Group { children [ USE Ghost ] } }\nGroup { }\n`);
  const use = g.resolutions.find((r) => r.kind === 'use');
  assert.strictEqual(use.status, STATUS.RECOVERED);
  assert.strictEqual(use.reason, REASON.PROTO_SCOPE_NOT_PROVABLE);
});

// ---------------------------------------------------------------------------
// Regressions for defects this lane found
// ---------------------------------------------------------------------------

test('regression: a Script self-reference is not a forbidden cycle (4.4.4)', () => {
  const g = build(`${H}DEF S Script { field SFNode me USE S url "x.js" }\nGroup { }\n`);
  const use = g.resolutions.find((r) => r.kind === 'use');
  assert.strictEqual(use.status, STATUS.RESOLVED);
  assert.strictEqual(use.reason, REASON.SELF_REFERENCE_OUTSIDE_TRANSFORMATION_HIERARCHY);
});

test('regression: a Group self-reference IS a forbidden cycle (4.4.4)', () => {
  const g = build(`${H}DEF G Group { children [ USE G ] }\n`);
  const use = g.resolutions.find((r) => r.kind === 'use');
  assert.strictEqual(use.status, STATUS.INVALID);
  assert.strictEqual(use.reason, REASON.SELF_REFERENTIAL_USE);
});

test('regression: recursion is diagnosed before the ordering rule', () => {
  const g = build(`${H}PROTO R [ ] { Group { children [ R { } ] } }\nGroup { }\n`);
  const r = g.resolutions.find((x) => x.kind === 'node-type' && x.name === 'R');
  assert.strictEqual(r.reason, REASON.RECURSIVE_PROTO_INSTANCE);
});

test('regression: an event bound to an exposedField declaration is tagged as compatibility', () => {
  const g = build(`${H}PROTO A [ exposedField SFTime touchTime 0 ] {\n`
    + `  Group { children [ DEF T TouchSensor { touchTime IS touchTime } ] }\n}\nGroup { }\n`);
  const is = g.resolutions.find((r) => r.kind === 'is');
  assert.strictEqual(is.status, STATUS.INVALID, 'strict VRML97 status is unchanged');
  assert.strictEqual(is.compat, scopeModel.COMPAT.EVENT_BOUND_TO_EXPOSED_FIELD_DECLARATION);
});

test('regression: duplicate ROUTE detection is not quadratic', () => {
  const routes = [];
  for (let i = 0; i < 400; i += 1) routes.push(`ROUTE C.fraction_changed TO P${i}.set_fraction`);
  const defs = [];
  for (let i = 0; i < 400; i += 1) {
    defs.push(`DEF P${i} PositionInterpolator { key [ 0 1 ] keyValue [ 0 0 0 1 1 1 ] }`);
  }
  const src = `${H}DEF C TimeSensor { }\n${defs.join('\n')}\n${routes.join('\n')}\n`;
  const started = process.hrtime.bigint();
  const g = build(src);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.strictEqual(g.findings.filter((f) => f.code === REASON.DUPLICATE_ROUTE).length, 0);
  assert.ok(ms < 3000, `scope build took ${ms}ms`);
});

// ---------------------------------------------------------------------------
// IS / ROUTE semantics spot checks (the graded set lives in cases.js)
// ---------------------------------------------------------------------------

test('IS binds the innermost PROTO interface, never an outer one', () => {
  const g = build(`${H}PROTO Outer [ field SFVec3f outerT 0 0 0 ] {\n`
    + `  PROTO Inner [ ] { Transform { translation IS outerT } }\n  Group { }\n}\nGroup { }\n`);
  const is = g.resolutions.find((r) => r.kind === 'is');
  assert.strictEqual(is.status, STATUS.UNRESOLVED);
  assert.strictEqual(is.reason, REASON.IS_MEMBER_NOT_DECLARED);
});

test('exposedField supplies its implicit set_/_changed events to IS and ROUTE', () => {
  const g = build(`${H}PROTO P [ exposedField SFVec3f t 0 0 0 ] {\n`
    + `  Transform { set_translation IS set_t }\n}\nGroup { }\n`);
  const is = g.resolutions.find((r) => r.kind === 'is');
  assert.strictEqual(is.status, STATUS.RESOLVED);
});

test('an EXTERNPROTO interface is a subset, so a missing event is unprovable not wrong', () => {
  const g = build(`${H}EXTERNPROTO Ext [ eventIn SFBool on ] "x.wrl#Ext"\n`
    + `DEF E Ext { }\nDEF C TimeSensor { }\nROUTE C.isActive TO E.somethingElse\nGroup { }\n`);
  const ev = g.resolutions.find((r) => r.kind === 'route-event' && r.name === 'somethingElse');
  assert.strictEqual(ev.status, STATUS.UNSUPPORTED);
  assert.strictEqual(ev.reason, REASON.EXTERNPROTO_INTERFACE_IS_SUBSET);
});

test('a ROUTE event on an unresolved endpoint is unsupported, never guessed', () => {
  const g = build(`${H}DEF C TimeSensor { }\nROUTE Nope.x TO C.set_startTime\nGroup { }\n`);
  const ev = g.resolutions.find((r) => r.kind === 'route-event' && r.name === 'x');
  assert.strictEqual(ev.status, STATUS.UNSUPPORTED);
  assert.strictEqual(ev.reason, REASON.ROUTE_ENDPOINT_UNRESOLVED);
});

test('routing an eventIn as a source is a direction error', () => {
  const g = build(`${H}DEF V Viewpoint { }\nDEF C TimeSensor { }\n`
    + `ROUTE V.set_bind TO C.set_startTime\nGroup { }\n`);
  const ev = g.resolutions.find((r) => r.kind === 'route-event' && r.name === 'set_bind');
  assert.strictEqual(ev.status, STATUS.INVALID);
  assert.strictEqual(ev.reason, REASON.ROUTE_EVENT_DIRECTION_INVALID);
});

// ---------------------------------------------------------------------------
// Identity-support query
// ---------------------------------------------------------------------------

test('defIsUniqueInScope is scope-aware where the flat analyzer is not', () => {
  const g = build(`${H}PROTO A [ ] { Group { children [ DEF X Shape { } ] } }\n`
    + `PROTO B [ ] { Group { children [ DEF X Shape { } ] } }\nGroup { }\n`);
  const defs = g.symbols.filter((s) => s.kind === SYMBOL_KIND.NODE_DEF && s.name === 'X');
  assert.strictEqual(defs.length, 2);
  for (const d of defs) {
    assert.deepStrictEqual(scopeModel.defIsUniqueInScope(g, d.id), { unique: true, reason: REASON.OK });
  }
});

test('defIsUniqueInScope refuses on a duplicate and in a damaged scope', () => {
  const dup = build(`${H}DEF X Shape { }\nDEF X Group { }\n`);
  const dupDefs = dup.symbols.filter((s) => s.kind === SYMBOL_KIND.NODE_DEF);
  assert.strictEqual(dupDefs.length, 2);
  for (const d of dupDefs) {
    assert.deepStrictEqual(scopeModel.defIsUniqueInScope(dup, d.id),
      { unique: false, reason: REASON.DUPLICATE_DEF_IN_SCOPE });
  }

  // An unnamed PROTO body: the DEF is unique by count, but the SCOPE is not
  // provable, so uniqueness must not be claimed.
  const damaged = build(`${H}PROTO [ ] { Group { children [ DEF X Shape { } ] } }\nGroup { }\n`);
  const inDamaged = damaged.symbols.filter((s) => s.kind === SYMBOL_KIND.NODE_DEF && s.name === 'X');
  assert.strictEqual(inDamaged.length, 1);
  assert.deepStrictEqual(scopeModel.defIsUniqueInScope(damaged, inDamaged[0].id),
    { unique: false, reason: REASON.PROTO_SCOPE_NOT_PROVABLE });
});

test('referencesTo finds every reference bound to one declaration', () => {
  const g = build(`${H}DEF A Group { }\nGroup { children [ USE A USE A ] }\nROUTE A.addChildren TO A.addChildren\n`);
  const decl = g.symbols.find((s) => s.kind === SYMBOL_KIND.NODE_DEF && s.name === 'A');
  const refs = scopeModel.referencesTo(g, decl.id);
  assert.strictEqual(refs.filter((r) => r.kind === 'use').length, 2);
  assert.strictEqual(refs.filter((r) => r.kind === 'route-node').length, 2);
});

// ---------------------------------------------------------------------------
// Determinism and ordering
// ---------------------------------------------------------------------------

test('symbols, references, resolutions and findings are ordered by source position', () => {
  const g = build(`${H}PROTO P [ field SFVec3f t 0 0 0 ] { Transform { translation IS t } }\n`
    + `DEF A Group { }\nGroup { children [ USE A ] }\nROUTE A.addChildren TO A.addChildren\n`);
  for (const list of [g.symbols, g.references, g.resolutions, g.findings]) {
    const offsets = list.map((x) => x.sortOffset);
    assert.deepStrictEqual(offsets, offsets.slice().sort((a, b) => a - b));
  }
});

test('the authored case list has unique ids and a stable order', () => {
  const ids = CASES.map((c) => c.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate case id');
  assert.ok(CASES.every((c) => c.source && c.cite && c.grade && c.title));
});

test('every authored case carries at least one graded assertion', () => {
  for (const c of CASES) {
    const n = (c.expect || []).length + (c.findings || []).length + (c.symbolExpect ? 1 : 0);
    assert.ok(n > 0, `${c.id} asserts nothing`);
  }
});

test('all authored cases pass', () => {
  const graded = runner.runAuthoredCases();
  const failures = graded.flatMap((c) => c.checks.filter((x) => !x.pass)
    .map((x) => `${c.id} ${x.what}: expected ${x.expected}, got ${x.actual}`));
  assert.deepStrictEqual(failures, []);
});

test('rendered metrics contain no timestamp and no absolute path', () => {
  const md = runner.renderMetrics({
    seed: runner.SEED, authored: runner.runAuthoredCases(),
    authoredDifferential: runner.authoredDifferential(), corpus: null,
  });
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(md), 'ISO timestamp leaked into a deterministic artifact');
  assert.ok(!md.includes('/home/'), 'absolute path leaked into a deterministic artifact');
});

// ---------------------------------------------------------------------------
// Corpus boundary
// ---------------------------------------------------------------------------

test('the corpus boundary guard refuses forbidden roots', () => {
  for (const marker of corpus.FORBIDDEN_MARKERS) {
    assert.throws(() => corpus.assertAllowed(`/tmp/${marker}/x.wrl`), /boundary violation/);
  }
});

test('the corpus module never opens a file for writing', () => {
  const src = stripComments(fs.readFileSync(path.join(__dirname, 'corpus.js'), 'utf8'));
  for (const banned of ['writeFileSync', 'appendFileSync', 'unlinkSync', 'renameSync', 'copyFileSync', 'rmSync', 'mkdirSync']) {
    assert.ok(!src.includes(banned), `corpus.js must not call ${banned}`);
  }
});

test('the spike modifies no production module and adds no dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(pkg.dependencies), ['x_ite']);
  const files = fs.readdirSync(__dirname);
  assert.ok(!files.includes('package.json'), 'the spike must not carry its own manifest');
});
