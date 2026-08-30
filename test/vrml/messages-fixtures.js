'use strict';
// Shared fixtures for the P4-B message catalog suite.
//
// Real P4-A presentation results wherever one exists: every document below is
// parsed, resolved, projected and presented through the production path, so a
// message assertion is made against what a consumer would actually receive.
//
// Synthetic presentation results appear ONLY where the substrate cannot
// currently produce the shape under test -- primarily a recovered strict
// violation, which P4-A presents with `confidence.status === recovered` and a
// `recovered: true` flag. Synthetic records are built from published vocabulary
// values and carry no field a real constructor would not.

const { parse } = require('../../src/vrml');
const sg = require('../../src/vrml/scope-graph');
const semanticFindings = require('../../src/vrml/semantic-findings');
const compatibility = require('../../src/vrml/compatibility');
const protoAgreement = require('../../src/vrml/proto-agreement');
const presentation = require('../../src/vrml/presentation');

const { ISO_RESULT, FINDING_CODE } = semanticFindings;
const { STATUS, REASON } = sg;

const H = '#VRML V2.0 utf8\n';

// --- production projection helpers ------------------------------------------

/** Parse, build a scope graph, and return all findings through the production path. */
const findings = (text) => semanticFindings.findingsForDocument(sg.buildScopeGraph(parse(H + text)));

/** Same as `findings`, with WD1.7-E1 compatibility attached. */
const projected = (text) => findings(text).map(compatibility.withCompatibility);

/** Present every projected finding through P4-A and return the ordered list. */
const presented = (text) => presentation.presentDocumentFindings(projected(text));

/** One finding matching a code (and optionally a reason), or fail. */
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

/** Q2/Q3. The one construct WD1.7-E1's evidence explains. Resolved, prohibited. */
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

/** A real WD1.7-D `TYPE_MISMATCH` -- basis `ISO_4_9_2`, types differ. */
function typeMismatch() {
  const local = parse(`${H}EXTERNPROTO X [field SFInt32 a] "lib.wrl#X"\n`);
  const target = parse(`${H}PROTO X [field SFString a ""] { Group {} }\n`);
  const agreement = protoAgreement.compareInterfaceAgreement(
    sg.buildScopeGraph(local),
    local.tree.statements.find((s) => s.type === 'ExternProto'),
    sg.buildScopeGraph(target),
    target.tree.statements.find((s) => s.type === 'Proto'));
  const f = agreement.findings.find(
    (x) => x.code === protoAgreement.AGREEMENT_FINDING.TYPE_MISMATCH);
  if (!f) throw new Error('fixture expected a real TYPE_MISMATCH finding');
  return f;
}

// --- synthetic presentation results ----------------------------------------

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
  presented,
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
  typeMismatch,
};
