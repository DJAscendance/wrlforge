'use strict';
// WD1.6-D -- adversarial controls for the findings sweep.
//
// A gate that reads "0 contradictions" is worth exactly as much as the harness's
// ability to produce a non-zero one. Each control below compiles a MUTATED copy
// of `semantic-findings.js` in memory -- the repository file is never written --
// runs the SAME sweep over the SAME fixtures, and asserts a SPECIFIC gate moves.
// A control that stops firing fails the run, because that means the measurement
// stopped measuring.
//
// The mutants are the four ways this projection could silently go wrong:
//
//   1. status collapse       -- a recovered answer reported as a plain unresolved
//   2. hard-coded ISO        -- an accusation manufactured from an unprovable answer
//   3. presentation leak     -- a severity arriving in the semantic record
//   4. authority bypass      -- reporting a containment answer WD1.6-C withheld

const fs = require('fs');
const path = require('path');
const Module = require('module');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MODULE_PATH = path.join(REPO_ROOT, 'src', 'vrml', 'semantic-findings.js');
const { parse } = require(path.join(REPO_ROOT, 'src', 'vrml'));
const sweep = require('./sweep');

const SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');
const H = '#VRML V2.0 utf8\n';

// Fixtures original to this lane -- string literals, no corpus content, so the
// controls run with `--no-corpus` and are reproducible on any machine.
const FIXTURES = Object.freeze([
  'Group { children [ USE Nothing ] }',
  'PROTO P [ exposedField SFBool a TRUE ] { Group { addChildren IS a } }\nP {}',
  'PROTO P [ field SFNode slot NULL ] { Group {} }\nP { slot Box {} }',
  'Shape { appearance Box {} }',
  'PROTO P [ field SFBool a TRUE ] { Group { children [ USE Missing\nDEF B Group {}',
  'DEF T Transform {}\nDEF C Color {}\nROUTE T.translation_changed TO C.set_color',
]);

function loadMutant(mutate) {
  const mutated = mutate(SOURCE);
  if (mutated === SOURCE) throw new Error('control mutation did not change the source');
  const m = new Module(MODULE_PATH, module);
  m.filename = MODULE_PATH;
  m.paths = Module._nodeModulePaths(path.dirname(MODULE_PATH));
  m._compile(mutated, MODULE_PATH);
  return m.exports;
}

/** Run the sweep's per-document audit over the fixtures with one producer. */
function run(produce) {
  const counters = sweep.newCounters();
  FIXTURES.forEach((text, i) => {
    sweep.sweepDocument(parse(H + text), `control:${i}`, counters, produce);
  });
  return counters;
}

const MUTANTS = Object.freeze([
  {
    name: 'status-collapse',
    defect: 'a recovered or ambiguous substrate answer is reported as a plain `unresolved`, '
      + 'so a consumer can no longer suppress an untrustworthy finding',
    gate: 'contradictions',
    mutate: (s) => s.replace(
      'confidence: answer.status,',
      "confidence: answer.status === 'resolved' ? answer.status : 'unresolved',",
    ),
  },
  {
    name: 'hard-coded-iso',
    defect: 'a producer decides the ISO axis itself, so an unprovable answer starts '
      + 'accusing the document of non-conformance',
    gate: 'isoMismatches',
    mutate: (s) => s.replace(
      '  const entry = ISO_BY_REASON[reason];\n  return entry || notStated;',
      '  const entry = ISO_BY_REASON[reason];\n  return entry ? stated(ISO_RESULT.PROHIBITED, CITE.DEF_USE) : notStated;',
    ),
  },
  {
    name: 'presentation-leak',
    defect: 'a severity is pre-decided in the semantic record, so every consumer '
      + 'inherits a policy it cannot see or override',
    gate: 'shapeViolations',
    mutate: (s) => s.replace(
      '    code: fields.code,\n    subject: fields.subject,',
      "    code: fields.code,\n    severity: 'error',\n    subject: fields.subject,",
    ),
  },
  {
    name: 'authority-bypass',
    defect: 'a containment answer WD1.6-C withheld is reported as a finding anyway -- '
      + 'a second containment engine',
    gate: 'findings',
    mutate: (s) => s.replace(
      'if (verdict.status !== CONTAINMENT_STATUS.ILLEGAL) continue;',
      "if (!(verdict.status === CONTAINMENT_STATUS.ILLEGAL || verdict.status === 'unsupported')) continue;",
    ),
  },
]);

/**
 * Every mutant must move its named gate away from the honest baseline.
 *
 * `findings` is used as the gate for the authority-bypass mutant because the
 * defect is EXTRA findings for placements the authority declined to judge; the
 * other three keep a defect counter at zero on an honest run and move it off
 * zero when mutated.
 */
function runControls() {
  const baseline = run();
  const results = [];
  for (const mutant of MUTANTS) {
    const mutated = run(loadMutant(mutant.mutate).findingsForDocument);
    const before = baseline[mutant.gate];
    const after = mutated[mutant.gate];
    results.push({
      name: mutant.name,
      defect: mutant.defect,
      gate: mutant.gate,
      baseline: before,
      mutated: after,
      caught: after !== before,
    });
  }
  return { baseline, results, fixtures: FIXTURES.length };
}

module.exports = { runControls, MUTANTS, FIXTURES };
