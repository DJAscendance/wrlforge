'use strict';
// Shared fixtures for the P4-A presentation suite.
//
// REAL findings wherever a real one exists: every document below is parsed and
// resolved through the production path, so a policy assertion is made against
// what the substrate actually emits rather than against a hand-written record
// that agrees with the policy by construction.
//
// Synthetic records appear ONLY where the substrate cannot currently produce the
// shape under test -- a range-less finding, and a recovered strict violation.
// They are built from the published vocabularies and carry no field the real
// constructor would not, because their whole job is to prove that presentation
// reads the axes and nothing else.

const { parse } = require('../../src/vrml');
const sg = require('../../src/vrml/scope-graph');
const semanticFindings = require('../../src/vrml/semantic-findings');
const compatibility = require('../../src/vrml/compatibility');
const protoAgreement = require('../../src/vrml/proto-agreement');

const { ISO_RESULT, FINDING_CODE, findingsForDocument } = semanticFindings;
const { STATUS, REASON } = sg;

const H = '#VRML V2.0 utf8\n';

/** Every finding in one document, through the production path. */
const findings = (text) => findingsForDocument(sg.buildScopeGraph(parse(H + text)));

/** The same, with WD1.7-E1's attachment applied -- the ordinary consumer path. */
const projected = (text) => findings(text).map(compatibility.withCompatibility);

/** Exactly one finding matching a code (and optionally a reason), or fail. */
function one(list, code, reason) {
  const hits = list.filter((f) => f.code === code
    && (reason === undefined || f.reason === reason));
  if (hits.length !== 1) {
    throw new Error(`fixture expected exactly one ${code}/${reason}, got ${hits.length}`);
  }
  return hits[0];
}

// --- documents --------------------------------------------------------------

/** Q1. ISO 4.8.3 excludes a Group from `Shape.geometry`. Resolved, prohibited. */
const ILLEGAL_CHILD = 'Shape { geometry Group {} }\n';

/** Q2. The one construct WD1.7-E1's evidence explains. Resolved, prohibited. */
const SCRIPT_EXPOSED_FIELD = 'DEF S Script { exposedField SFBool go TRUE }\n';

/** Q4. An EXTERNPROTO's interface is not locally verifiable -- `unsupported`. */
const UNSUPPORTED_IS = 'EXTERNPROTO E [] "e.wrl#E"\n'
  + 'PROTO P [ field SFInt32 k 0 ] { E { zzz IS k } }\nP {}\n';

/** Q6/Q8. Two USE statements naming the same absent DEF, at two ranges. */
const TWO_UNBOUND_USES = 'Group { children [ USE Missing, USE Missing ] }\n';

/** A damaged document: an unclosed PROTO makes every lexical answer recovered. */
const RECOVERED_DOCUMENT = 'PROTO P [] { Group { children [ USE Q\n';

/** A clean document. Nothing to present. */
const CLEAN = 'Group { children [ Shape { geometry Box {} } ] }\n';

// --- real findings ----------------------------------------------------------

const illegalChild = () => one(findings(ILLEGAL_CHILD), FINDING_CODE.CHILD_NOT_PERMITTED);

const scriptExposedField = () => one(findings(SCRIPT_EXPOSED_FIELD),
  FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING, REASON.EXPOSED_FIELD_IN_SCRIPT_INTERFACE);

/** The same finding with WD1.7-E1's `blaxxun-contact` attachment. */
const scriptExposedFieldWithCompatibility = () =>
  compatibility.withCompatibility(scriptExposedField());

const unsupportedIs = () => one(findings(UNSUPPORTED_IS),
  FINDING_CODE.IS_CONNECTION_REJECTED, REASON.EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE);

/** A real WD1.7-D `ACCESS_DIFFERS` -- basis `NOT_SPECIFIED_BY_ISO_4_9_2`. */
function accessDiffers() {
  const local = parse(`${H}EXTERNPROTO X [field SFInt32 a] "lib.wrl#X"\n`);
  const target = parse(`${H}PROTO X [exposedField SFInt32 a 0] { Group {} }\n`);
  const agreement = protoAgreement.compareInterfaceAgreement(
    sg.buildScopeGraph(local),
    local.tree.statements.find((s) => s.type === 'ExternProto'),
    sg.buildScopeGraph(target),
    target.tree.statements.find((s) => s.type === 'Proto'));
  const f = agreement.findings.find(
    (x) => x.code === protoAgreement.AGREEMENT_FINDING.ACCESS_DIFFERS);
  if (!f) throw new Error('fixture expected a real ACCESS_DIFFERS finding');
  return f;
}

/** A real WD1.7-D `MEMBER_MISSING` -- basis `ISO_4_9_2`, a proven violation. */
function memberMissing() {
  const local = parse(`${H}EXTERNPROTO X [field SFInt32 a] "lib.wrl#X"\n`);
  const target = parse(`${H}PROTO X [field SFInt32 b 0] { Group {} }\n`);
  const agreement = protoAgreement.compareInterfaceAgreement(
    sg.buildScopeGraph(local),
    local.tree.statements.find((s) => s.type === 'ExternProto'),
    sg.buildScopeGraph(target),
    target.tree.statements.find((s) => s.type === 'Proto'));
  const f = agreement.findings.find(
    (x) => x.code === protoAgreement.AGREEMENT_FINDING.MEMBER_MISSING);
  if (!f) throw new Error('fixture expected a real MEMBER_MISSING finding');
  return f;
}

// --- synthetic records ------------------------------------------------------

const span = (start, end) => Object.freeze({
  start: Object.freeze({ offset: start, line: 1, column: start }),
  end: Object.freeze({ offset: end, line: 1, column: end }),
});

/**
 * A finding-shaped record. Used ONLY for shapes the substrate cannot currently
 * emit; every field is a published vocabulary value.
 */
const synthetic = (fields) => Object.freeze({
  code: fields.code || FINDING_CODE.USE_NOT_BOUND,
  subject: Object.freeze({
    node: null, parent: null, reference: null, symbol: null,
    name: fields.name === undefined ? null : fields.name,
  }),
  range: fields.range === undefined ? span(0, 1) : fields.range,
  iso: fields.iso || ISO_RESULT.PROHIBITED,
  rule: null,
  compatibility: fields.compatibility || null,
  confidence: fields.confidence || STATUS.RESOLVED,
  reason: fields.reason || REASON.DEF_NOT_DECLARED_IN_SCOPE,
  detail: null,
  evidence: Object.freeze([]),
});

module.exports = {
  H,
  findings,
  projected,
  one,
  span,
  synthetic,
  ILLEGAL_CHILD,
  SCRIPT_EXPOSED_FIELD,
  UNSUPPORTED_IS,
  TWO_UNBOUND_USES,
  RECOVERED_DOCUMENT,
  CLEAN,
  illegalChild,
  scriptExposedField,
  scriptExposedFieldWithCompatibility,
  unsupportedIs,
  accessDiffers,
  memberMissing,
};
