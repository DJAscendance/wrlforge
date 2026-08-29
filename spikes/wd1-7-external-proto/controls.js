'use strict';
// WD1.7-A -- adversarial controls.
//
// Every control states an invariant AND a mutant that breaks it. A control that
// merely asserts the current behaviour is a tautology; a control that shows the
// assertion FAILING under a plausible wrong implementation is evidence. The
// driver refuses to publish numbers if any control stops firing, because a
// silent control is indistinguishable from a passing one.

const assert = require('assert');
const extract = require('./extract');
const sweep = require('./sweep');
const { subsetCheck } = sweep;
const corpus = require('../wd1-route-semantics/corpus');

const CONTROLS = [
  // -----------------------------------------------------------------------
  // C1 -- the evidence boundary is LIVE, not assumed.
  // -----------------------------------------------------------------------
  // WD.md and OPEN_SOURCE_PROVENANCE.md §3 make `blaxxun-cs-RE` and
  // `RE-ARTIFACTS` implementation-prohibited. The inherited guard must THROW on
  // one, never skip it: a silent skip would let a root change cross the
  // boundary quietly, which is the failure mode the guard exists to prevent.
  {
    id: 'C1-boundary-throws',
    run() {
      for (const marker of ['blaxxun-cs-RE', 'RE-ARTIFACTS', 'white-dune']) {
        assert.throws(
          () => corpus.assertAllowed(`/tmp/${marker}/x.wrl`),
          /boundary violation/,
          `guard did not throw on a ${marker} path`,
        );
      }
      // Mutant: a guard that only checked the FIRST marker would let the others
      // through. Prove each is checked independently, not by position.
      assert.doesNotThrow(() => corpus.assertAllowed('/tmp/ordinary/x.wrl'));
    },
  },

  // -----------------------------------------------------------------------
  // C2 -- scheme detection precedes separator detection.
  // -----------------------------------------------------------------------
  // Mutant: classifying on `\` before the scheme makes `file://C:\a\b` a
  // windows-path, which would then be probed as a relative suffix and could
  // produce a spurious hit.
  {
    id: 'C2-scheme-before-separator',
    run() {
      assert.strictEqual(extract.classifyForm('file://C:\\a\\b.wrl'), extract.FORM.ABSOLUTE_FILE);
      assert.strictEqual(extract.classifyForm('C:\\a\\b.wrl'), extract.FORM.WINDOWS_PATH);
      assert.strictEqual(extract.classifyForm('urn:inet:blaxxun.com:node:HUD'), extract.FORM.URN);
      assert.strictEqual(extract.classifyForm('http://h/a.wrl'), extract.FORM.ABSOLUTE_HTTP);
      assert.strictEqual(extract.classifyForm('//h/a.wrl'), extract.FORM.PROTOCOL_RELATIVE);
      assert.strictEqual(extract.classifyForm('/a.wrl'), extract.FORM.ROOT_RELATIVE);
      assert.strictEqual(extract.classifyForm('../a.wrl'), extract.FORM.PARENT_RELATIVE);
      assert.strictEqual(extract.classifyForm('./a.wrl'), extract.FORM.DOT_RELATIVE);
      assert.strictEqual(extract.classifyForm('a.wrl'), extract.FORM.BARE_RELATIVE);
      assert.strictEqual(extract.classifyForm(''), extract.FORM.EMPTY);
    },
  },

  // -----------------------------------------------------------------------
  // C3 -- the ISO 4.9.3 fragment is the LAST `#`.
  // -----------------------------------------------------------------------
  // Mutant: `indexOf('#')` would select `b#Proto` as the fragment of
  // `a#b#Proto`, naming a PROTO that cannot exist.
  {
    id: 'C3-fragment-is-last-hash',
    run() {
      assert.deepStrictEqual(extract.splitFragment('a#b#Proto'),
        { locator: 'a#b', fragment: 'Proto', hasFragment: true });
      assert.deepStrictEqual(extract.splitFragment('a.wrl'),
        { locator: 'a.wrl', fragment: null, hasFragment: false });
      // A written empty fragment is NOT the same as no fragment: 4.9.3 answers
      // only the second, so the two must stay distinguishable.
      assert.deepStrictEqual(extract.splitFragment('a.wrl#'),
        { locator: 'a.wrl', fragment: '', hasFragment: true });
    },
  },

  // -----------------------------------------------------------------------
  // C4 -- 4.9.3 target selection excludes EXTERNPROTOs and nested PROTOs.
  // -----------------------------------------------------------------------
  // This is the `bxx/shared.wrl` shape exactly: an EXTERNPROTO first, PROTOs
  // after. A selector that took the first prototype STATEMENT would answer
  // `HUD`; 4.9.3 says the answer is `BlaxxunZone`.
  {
    id: 'C4-selection-excludes-externproto-and-nested',
    run() {
      const { parse } = require('../../src/vrml');
      const src = [
        '#VRML V2.0 utf8',
        'EXTERNPROTO HUD [] ["urn:inet:blaxxun.com:node:HUD"]',
        'PROTO BlaxxunZone [] { Group { children [] } }',
        'PROTO Outer [] { Group {} PROTO Nested [] { Group {} } }',
      ].join('\n');
      const names = extract.selectablePrototypes(parse(src)).map((p) => p.name);
      assert.deepStrictEqual(names, ['BlaxxunZone', 'Outer'],
        'selection must exclude the EXTERNPROTO and the nested PROTO');
      assert.ok(!names.includes('HUD'), 'HUD is an EXTERNPROTO and 4.9.3 excludes it');
      assert.ok(!names.includes('Nested'), '4.8.4 makes a nested PROTO local to its encloser');
    },
  },

  // -----------------------------------------------------------------------
  // C5 -- the 4.9.2 subset relation is DIRECTIONAL: local ⊆ target.
  // -----------------------------------------------------------------------
  // Mutant: a symmetric set-equality check would flag a conforming target that
  // merely declares MORE than the EXTERNPROTO uses -- the single most common
  // legitimate shape -- and would miss nothing in exchange.
  {
    id: 'C5-subset-is-directional',
    run() {
      const target = [
        { access: 'exposedField', name: 'children', fieldType: 'MFNode' },
        { access: 'exposedField', name: 'name', fieldType: 'SFString' },
        { access: 'eventOut', name: 'isOver', fieldType: 'SFBool' },
      ];
      // local ⊂ target -> conforming, no problems.
      assert.deepStrictEqual(
        subsetCheck([{ access: 'exposedField', name: 'children', fieldType: 'MFNode' }], target),
        [], 'a strict subset must be accepted');
      // local declares a member the target lacks -> 4.9.2 error.
      const missing = subsetCheck([{ access: 'field', name: 'nope', fieldType: 'SFInt32' }], target);
      assert.strictEqual(missing.length, 1);
      assert.strictEqual(missing[0].kind, 'member-missing');
      // matching name, different type -> 4.9.2 error, and it must NOT be
      // reported as an access difference (types are checked first).
      const typed = subsetCheck([{ access: 'exposedField', name: 'name', fieldType: 'SFInt32' }], target);
      assert.strictEqual(typed[0].kind, 'type-mismatch');
      // matching name and type, different access -> ISO is SILENT. Reported as
      // its own kind, never folded into "mismatch".
      const access = subsetCheck([{ access: 'field', name: 'name', fieldType: 'SFString' }], target);
      assert.strictEqual(access[0].kind, 'access-differs');
    },
  },

  // -----------------------------------------------------------------------
  // C6 -- probe keys are longest-suffix-first.
  // -----------------------------------------------------------------------
  // Mutant: shortest-first would match `shared.wrl` anywhere in the archive
  // before the specific `externprotos/bxx/shared.wrl`, turning a precise
  // reference into an ambiguous one and inflating the ambiguity count.
  {
    id: 'C6-probe-keys-longest-first',
    run() {
      const [cand] = extract.candidatesOf({
        type: 'String', value: 'http://www.cybertown.com/externprotos/bxx/shared.wrl#BlaxxunZone', raw: '', range: null,
      });
      const keys = sweep.probeKeys(cand);
      assert.deepStrictEqual(keys, ['externprotos/bxx/shared.wrl', 'bxx/shared.wrl', 'shared.wrl']);
      for (let i = 1; i < keys.length; i += 1) {
        assert.ok(keys[i].length < keys[i - 1].length, 'keys must shorten monotonically');
      }
    },
  },

  // -----------------------------------------------------------------------
  // C7 -- a `urn:` has no extension and no probe key.
  // -----------------------------------------------------------------------
  // Mutant: treating the URN as a path yields the extension `.com:node:hud` and
  // a probe key, both fabricated. The URN names a BUILT-IN node; ISO 4.9.1's
  // "some other implementation-dependent mechanism" is the clause, and a
  // retrieval probe has nothing to say about it.
  {
    id: 'C7-urn-is-not-a-path',
    run() {
      const [cand] = extract.candidatesOf({
        type: 'String', value: 'urn:inet:blaxxun.com:node:HUD', raw: '', range: null,
      });
      assert.strictEqual(cand.form, extract.FORM.URN);
      assert.strictEqual(cand.extension, null, 'a urn must not report a file extension');
      assert.deepStrictEqual(sweep.probeKeys(cand), [], 'a urn must yield no probe key');
    },
  },

  // -----------------------------------------------------------------------
  // C8 -- EXTERNPROTOs are found wherever they appear, not only at top level.
  // -----------------------------------------------------------------------
  // The corpus nests them inside PROTO bodies (legal) and inside MFNode arrays
  // (non-conforming, accepted by parser recovery). A top-level-only scan
  // under-counts, and an under-count that looks clean is the worst outcome.
  {
    id: 'C8-externprotos-found-when-nested',
    run() {
      const { parse } = require('../../src/vrml');
      const src = [
        '#VRML V2.0 utf8',
        'EXTERNPROTO Top [] "t.wrl"',
        'PROTO Holder [] { Group { children [ EXTERNPROTO Inner [] "i.wrl" ] } }',
      ].join('\n');
      const names = extract.externProtosOf(parse(src)).map((d) => d.name).sort();
      assert.deepStrictEqual(names, ['Inner', 'Top'],
        'a nested EXTERNPROTO must still be counted');
    },
  },
];

function run() {
  const failures = [];
  let passed = 0;
  for (const control of CONTROLS) {
    try {
      control.run();
      passed += 1;
    } catch (err) {
      failures.push(`${control.id}: ${err.message}`);
    }
  }
  return { total: CONTROLS.length, passed, failures, ids: CONTROLS.map((c) => c.id) };
}

module.exports = { run, CONTROLS };

if (require.main === module) {
  const r = run();
  console.log(`${r.passed}/${r.total} controls fired`);
  for (const f of r.failures) console.error(`FAILED ${f}`);
  process.exitCode = r.failures.length ? 1 : 0;
}
