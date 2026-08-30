'use strict';
// ---------------------------------------------------------------------------
// P4-B -- diagnostic message catalog.
// ---------------------------------------------------------------------------
//
// P4-A reads structured semantic facts and answers "how should a consumer show
// it". P4-B answers "what words should those visuals carry". This module
// depends on P4-A's presentation shape and is structurally unable to alter a
// fact, a severity, a group, a saveBlocking or a compatibility classification
// -- those are already frozen by P4-A.
//
//   semantic evidence       P4-A presentation          P4-B message
//   (WD1.5 / WD1.6 / WD1.7) -> severity, rank, order, -> title, summary,
//                              visibility, tags         detail
//                                                          |
//                                                          v
//                                                       WD2 renders it
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE OWNS, AND WHAT IT MAY NEVER TOUCH
// ---------------------------------------------------------------------------
//
// OWNS:
//   * a stable internal message ID per template
//   * a one-line title
//   * a one-sentence summary
//   * a short detail (or null)
//   * subject-name interpolation against the finding's structured fields
//   * compatibility wording for the E1 TOLERATED_VIOLATION case
//   * recovered-confidence wording for strict findings
//   * ACCESS_DIFFERS wording (informational, not normative)
//   * rollup wording that does not look like a per-member finding
//
// MAY NEVER DECIDE: whether a fact is true, its severity, group, saveBlocking,
// compatibility classification, attention rank, ordering, or visibility. A
// message is a TEXT PROJECTION over a P4-A presentation, and it never reads
// the semantic substrate directly -- P4-A already made every decision.
//
// MAY NEVER DO: parse source text, run another semantic check, guess from a
// file name, regex-match to decide what to show, or invent any fact not already
// frozen by P4-A.
//
// ---------------------------------------------------------------------------
// WHY TEXT IS NOT A SECOND AUTHORITY
// ---------------------------------------------------------------------------
//
// Each template is data: a stable ID, a title, a summary, and a detail builder
// that only consumes fields P4-A already exposes. No string literal names a
// profile, a behaviour, a reason or an ISO clause -- the policy that decided
// what to surface lives where it always has, and P4-B borrows from the same
// constants `proto-agreement.js` and `compatibility.js` publish.
//
// ---------------------------------------------------------------------------
// NO UI, NO LOCALIZATION FRAMEWORK, NO HTML
// ---------------------------------------------------------------------------
//
// The result is plain structured strings. WD2 renders them. A localization
// framework is deferred; text lives in ONE place here so a later lane can swap
// templates by language without rewriting call sites.
//
// Pure and browser-safe: no fs, no Electron, no DOM, no Node-only modules.
// Asserted by source scan in the test suite.

const semanticFindings = require('./semantic-findings');
const scopeGraph = require('./scope-graph');
const protoAgreement = require('./proto-agreement');
const compatibility = require('./compatibility');
const presentation = require('./presentation');

const { FINDING_CODE } = semanticFindings;
const { REASON } = scopeGraph;
const { AGREEMENT_FINDING, AGREEMENT_BASIS, AGREEMENT_STATUS } = protoAgreement;
const { COMPATIBILITY_CLASSIFICATION } = compatibility;
const { FINDING_ORIGIN, CLAIM } = presentation;

// ---------------------------------------------------------------------------
// Failure
// ---------------------------------------------------------------------------

const MESSAGE_ERROR = Object.freeze({
  /** The record is not the shape this entry point accepts. */
  SHAPE: 'EMESSAGESHAPE',
  /** A vocabulary value has no entry in the catalog that must classify it. */
  UNCLASSIFIED: 'EMESSAGEUNCLASSIFIED',
});

function messageError(code, message) {
  const err = new Error(`messages: ${message}`);
  err.code = code;
  return err;
}

const table = (entries) => Object.freeze(Object.assign(Object.create(null), entries));

/** Read a total table, or throw. THE ONLY catalog accessor -- there is no default. */
function read(t, value, what) {
  const entry = Object.prototype.hasOwnProperty.call(t, value) ? t[value] : undefined;
  if (entry === undefined) {
    throw messageError(MESSAGE_ERROR.UNCLASSIFIED,
      `${what} ${JSON.stringify(value)} has no message`);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Template vocabulary
// ---------------------------------------------------------------------------

const MESSAGE_ID = Object.freeze({
  // --- semantic findings (WD1.6-D) -----------------------------------------
  USE_NOT_BOUND: 'use-not-bound',
  NODE_TYPE_NOT_BOUND: 'node-type-not-bound',
  NODE_TYPE_SHADOWS_BUILTIN: 'node-type-shadows-builtin',
  IS_TARGET_NOT_BOUND: 'is-target-not-bound',
  IS_CONNECTION_REJECTED: 'is-connection-rejected',
  IS_BINDING_ISSUE: 'is-binding-issue',
  INTERFACE_DECLARATION_NONCONFORMING: 'interface-declaration-nonconforming',
  ROUTE_NODE_NOT_BOUND: 'route-node-not-bound',
  ROUTE_ENDPOINT_NOT_BOUND: 'route-endpoint-not-bound',
  ROUTE_CONNECTION_REJECTED: 'route-connection-rejected',
  CHILD_NOT_PERMITTED: 'child-not-permitted',

  // --- agreement findings (WD1.7-D) ---------------------------------------
  AGREEMENT_MEMBER_MISSING: 'agreement-member-missing',
  AGREEMENT_TYPE_MISMATCH: 'agreement-type-mismatch',
  AGREEMENT_ACCESS_DIFFERS: 'agreement-access-differs',

  // --- agreement rollups (WD1.7-D) ----------------------------------------
  AGREEMENT_ROLLUP_SATISFIED: 'agreement-rollup-satisfied',
  AGREEMENT_ROLLUP_VIOLATED: 'agreement-rollup-violated',
  AGREEMENT_ROLLUP_WITHHELD: 'agreement-rollup-withheld',
  AGREEMENT_ROLLUP_NOT_ATTEMPTED: 'agreement-rollup-not-attempted',
  AGREEMENT_ROLLUP_INVALID: 'agreement-rollup-invalid',
});

/** A safe subject-name fragment for interpolation. NEVER HTML, NEVER a DOM node. */
function nameOf(value) {
  if (value == null) return null;
  const s = String(value);
  if (s.length === 0) return null;
  return s;
}

/** Render a name safely for inclusion in a sentence, with quotation when present. */
function quoteName(value) {
  const n = nameOf(value);
  if (n == null) return null;
  // Quotation is the visual marker; no escaping is needed because we never build
  // HTML and never run the string anywhere.
  return `“${n}”`;
}

// ---------------------------------------------------------------------------
// Template definition helpers
// ---------------------------------------------------------------------------

/**
 * A message template. PURE DATA.
 *
 * `detailFor(context)` returns the short detail for the finding, or `null` when
 * the title and summary are enough. `context` carries the structured fields P4-A
 * exposed: `subjectName`, `memberName`, `localType`, `targetType`, `localAccess`,
 * `targetAccess`, `iso`, `claim`, `confidenceStatus`, `recovered`, and
 * `compatibility` (the frozen P4-A projection or `null`).
 */
function makeTemplate(id, title, summary, detailFor) {
  return Object.freeze({
    id,
    title: title,
    summary: summary,
    detailFor: detailFor || null,
  });
}

/**
 * Compatibility sentence fragment. PURE and TOTAL over the E1 classifications.
 *
 * Returns `null` for `null` input (the WD1.6-D reserved NOT EVALUATED meaning).
 * Returns one sentence that names the classification honestly, in the wording
 * the prompt requires: a TOLERATED_VIOLATION preserves both facts
 * (not VRML97-conforming AND the named runtime accepted it), an EXTRA_STANDARD
 * says ISO is silent and the runtime defined something in the gap.
 */
function compatibilitySentence(compatibility) {
  if (compatibility == null) return null;
  const profile = compatibility.profile;
  const cls = compatibility.classification;
  const portable = compatibility.portable;
  if (cls === COMPATIBILITY_CLASSIFICATION.TOLERATED_VIOLATION) {
    const portableBit = portable
      ? ''
      : ' The behavior is not portable VRML97.';
    return `${profile} is documented to accept this behavior. The content is not VRML97-conforming.${portableBit}`;
  }
  if (cls === COMPATIBILITY_CLASSIFICATION.EXTRA_STANDARD) {
    return `ISO does not state a rule here. ${profile} is documented to define this behavior.`;
  }
  // The two classifications are E1's entire output; anything else is a foreign
  // record and is treated as no attachment.
  return null;
}

/**
 * Recovered-confidence sentence fragment. Strict wording stays in title and
 * summary; detail adds one sentence so the user knows the finding is from a
 * damaged or incomplete parse.
 */
function recoveredSentence(recovered) {
  if (!recovered) return null;
  return 'WRLForge recovered this result from damaged or incomplete syntax.';
}

// ---------------------------------------------------------------------------
// WD1.6-D semantic finding templates
// ---------------------------------------------------------------------------
//
// Each (code, reason) pair keeps a single template; reason-specific detail
// branches in `detailFor`. Reasons that do not change the user-facing meaning
// inherit the per-code default. The matrix test asserts that every current
// (code, reason) is reachable as either an override or the default.

const UNCERTAIN = (ctx) =>
  'WRLForge could not determine this result from the file as written.';

const SEMANTIC_TEMPLATES = table({
  // --- USE_NOT_BOUND (P1) ------------------------------------------------
  [FINDING_CODE.USE_NOT_BOUND]: makeTemplate(
    MESSAGE_ID.USE_NOT_BOUND,
    'Reference name is not defined',
    'A USE statement names a name that is not bound by a DEF in this scope.',
    (ctx) => {
      const name = quoteName(ctx.subjectName);
      const r = ctx.reason;
      if (r === REASON.USE_BEFORE_DEF) {
        return name
          ? `${name} is used before it is defined. ISO 4.6.2 requires a DEF to appear before its USE.`
          : 'A USE statement appears before its DEF. ISO 4.6.2 requires a DEF to appear before its USE.';
      }
      if (r === REASON.DEF_NOT_VISIBLE_ACROSS_PROTO_BOUNDARY) {
        return 'The named DEF is inside a PROTO and is not visible outside it. ISO 4.8.4 separates a PROTO DEF/USE scope from the rest of the scene.';
      }
      if (r === REASON.DUPLICATE_DEF_IN_SCOPE) {
        return name
          ? `More than one DEF declares ${name} in the same scope. ISO 4.6.2 binds a USE to its preceding DEF.`
          : 'More than one DEF declares this name in the same scope. ISO 4.6.2 binds a USE to its preceding DEF.';
      }
      if (r === REASON.SELF_REFERENTIAL_USE) {
        return 'A USE names its own transformation ancestor. ISO 4.4.4 leaves the results undefined for a node that is its own ancestor.';
      }
      if (r === REASON.MISSING_NAME) {
        return UNCERTAIN(ctx);
      }
      if (r === REASON.SELF_REFERENCE_OUTSIDE_TRANSFORMATION_HIERARCHY
        || r === REASON.DOCUMENT_PARSE_INCOMPLETE) {
        return UNCERTAIN(ctx);
      }
      // DEFAULT: DEF_NOT_DECLARED_IN_SCOPE
      return name
        ? `${name} does not name a DEF in this scope.`
        : 'This USE statement does not name a DEF in this scope.';
    }
  ),

  // --- NODE_TYPE_NOT_BOUND (P2A) -----------------------------------------
  [FINDING_CODE.NODE_TYPE_NOT_BOUND]: makeTemplate(
    MESSAGE_ID.NODE_TYPE_NOT_BOUND,
    'Node type is not defined',
    'A node instance names a type that is not defined in this file.',
    (ctx) => {
      const name = quoteName(ctx.subjectName);
      const r = ctx.reason;
      if (r === REASON.NODE_TYPE_UNKNOWN) {
        return 'The named type is not a built-in node type and no PROTO or EXTERNPROTO in this file declares it. ISO 7.2.1 admits only built-in nodes and PROTO/EXTERNPROTO declarations.';
      }
      if (r === REASON.PROTO_INSTANCE_BEFORE_DECLARATION) {
        return 'A node instance uses a PROTO before its declaration completes. ISO 4.8.4 requires the declaration to complete first.';
      }
      if (r === REASON.DUPLICATE_PROTO_DECLARATION) {
        return name
          ? `More than one PROTO declaration uses the type name ${name}. ISO 4.8.1 requires type names to be unique.`
          : 'More than one PROTO declaration uses this type name. ISO 4.8.1 requires type names to be unique.';
      }
      if (r === REASON.RECURSIVE_PROTO_INSTANCE) {
        return 'A PROTO is instantiated inside its own implementation. ISO 4.8.4 prohibits recursive prototypes.';
      }
      if (r === REASON.DOCUMENT_PARSE_INCOMPLETE
        || r === REASON.NODE_TYPE_IS_BUILTIN) {
        return UNCERTAIN(ctx);
      }
      // DEFAULT
      return name
        ? `${name} is not defined as a node type.`
        : 'This node type is not defined in this file.';
    }
  ),

  // --- NODE_TYPE_SHADOWS_BUILTIN (P2A detail) ----------------------------
  [FINDING_CODE.NODE_TYPE_SHADOWS_BUILTIN]: makeTemplate(
    MESSAGE_ID.NODE_TYPE_SHADOWS_BUILTIN,
    'Prototype shadows a built-in node type',
    'A PROTO declaration uses the name of a built-in node type.',
    (ctx) => {
      const name = quoteName(ctx.subjectName);
      return name
        ? `${name} is the name of a built-in node type. A PROTO taking this name leaves the results undefined. ISO 4.8.1 prohibits shadowing a built-in name.`
        : 'A PROTO declaration takes the name of a built-in node type. ISO 4.8.1 prohibits shadowing a built-in name.';
    }
  ),

  // --- IS_TARGET_NOT_BOUND (P2B) -----------------------------------------
  [FINDING_CODE.IS_TARGET_NOT_BOUND]: makeTemplate(
    MESSAGE_ID.IS_TARGET_NOT_BOUND,
    'IS target is not defined',
    'An IS statement names a member that does not exist in the prototype interface.',
    (ctx) => {
      const name = quoteName(ctx.subjectName);
      const r = ctx.reason;
      if (r === REASON.IS_TYPE_UNKNOWN) {
        return 'The named member has no field type that WRLForge could read. The result is uncertain.';
      }
      if (r === REASON.INTERFACE_MEMBER_NOT_DECLARED) {
        return name
          ? `${name} is not declared in the prototype interface. ISO 4.8.3 requires an IS to refer to a declared interface member.`
          : 'No interface member matches this name. ISO 4.8.3 requires an IS to refer to a declared interface member.';
      }
      if (r === REASON.DUPLICATE_INTERFACE_MEMBER) {
        return 'The interface declares this name more than once. ISO 4.3.5 prohibits duplicate interface declarations.';
      }
      if (r === REASON.IS_OUTSIDE_PROTO_BODY) {
        return 'An IS statement appears outside a PROTO body. ISO 4.3.6 confines IS statements to bodies inside a PROTO.';
      }
      if (r === REASON.IS_TARGET_NAME_MISSING
        || r === REASON.IS_ENDPOINT_NODE_TYPE_UNRESOLVED
        || r === REASON.IS_ENDPOINT_UNKNOWN_FIELD) {
        return UNCERTAIN(ctx);
      }
      if (r === REASON.EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE
        || r === REASON.INTERFACE_SCOPE_NOT_PROVABLE
        || r === REASON.INTERFACE_NOT_PROVABLE_FOR_REFERENCE
        || r === REASON.MEMBER_FOUND_IN_OUTER_INTERFACE_ONLY
        || r === REASON.MEMBER_VIA_IMPLICIT_ALIAS
        || r === REASON.DOCUMENT_PARSE_INCOMPLETE) {
        return UNCERTAIN(ctx);
      }
      // DEFAULT
      return name
        ? `${name} is not declared in this prototype interface.`
        : 'This name is not declared in the prototype interface.';
    }
  ),

  // --- IS_CONNECTION_REJECTED (P2B) --------------------------------------
  [FINDING_CODE.IS_CONNECTION_REJECTED]: makeTemplate(
    MESSAGE_ID.IS_CONNECTION_REJECTED,
    'IS connection is not allowed',
    'An IS statement does not match the prototype interface member by type or access.',
    (ctx) => {
      const r = ctx.reason;
      if (r === REASON.IS_TYPE_MISMATCH) {
        return 'The field type of the IS does not match the field type of the prototype interface member. ISO 4.8.3 requires the types to match exactly.';
      }
      if (r === REASON.IS_ACCESS_INCOMPATIBLE) {
        return 'The access category of the IS does not match the access category of the prototype interface member. ISO 4.8.3 requires matching access categories.';
      }
      if (r === REASON.DUPLICATE_IS_FOR_ENDPOINT
        || r === REASON.FIELD_VALUED_AND_IS) {
        return 'The same node member has more than one IS, or a value and an IS at the same time. ISO 4.8.3 leaves the results undefined for such multiplicity.';
      }
      // Every remaining reason is a substrate-side inability to determine:
      // a missing type token, an unprovable scope, an unreachable interface, or
      // a damaged parse. The strict wording would over-claim.
      if (r === REASON.IS_TYPE_UNKNOWN
        || r === REASON.EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE
        || r === REASON.INTERFACE_SCOPE_NOT_PROVABLE
        || r === REASON.INTERFACE_NOT_PROVABLE_FOR_REFERENCE
        || r === REASON.DOCUMENT_PARSE_INCOMPLETE
        || r === REASON.MEMBER_VIA_IMPLICIT_ALIAS) {
        return UNCERTAIN(ctx);
      }
      // DEFAULT
      return 'This IS connection does not match the prototype interface member.';
    }
  ),

  // --- IS_BINDING_ISSUE (P2B multiplicity) --------------------------------
  [FINDING_CODE.IS_BINDING_ISSUE]: makeTemplate(
    MESSAGE_ID.IS_BINDING_ISSUE,
    'IS binding is not allowed',
    'An IS statement conflicts with another IS or with a value on the same node member.',
    (ctx) => {
      const r = ctx.reason;
      if (r === REASON.DUPLICATE_IS_FOR_ENDPOINT) {
        return 'Two or more IS statements associate the same node member. ISO 4.8.3 leaves the results undefined for such multiplicity.';
      }
      if (r === REASON.FIELD_VALUED_AND_IS) {
        return 'A node member is given a value and also associated by IS. ISO 4.8.3 leaves the results undefined for such multiplicity.';
      }
      return 'IS binding multiplicity is not allowed.';
    }
  ),

  // --- INTERFACE_DECLARATION_NONCONFORMING (P2B grammar) ----------------
  [FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING]: makeTemplate(
    MESSAGE_ID.INTERFACE_DECLARATION_NONCONFORMING,
    'Interface declaration is not allowed here',
    'A declaration in this interface position does not match the language grammar.',
    (ctx) => {
      const r = ctx.reason;
      if (r === REASON.EXPOSED_FIELD_IN_SCRIPT_INTERFACE) {
        const compat = compatibilitySentence(ctx.compatibility);
        const base = 'A Script interface uses exposedField. ISO 6.40 forbids exposedField in a Script interface; Annex A.3 admits only restrictedInterfaceDeclaration there.';
        return compat ? `${base} ${compat}` : base;
      }
      if (r === REASON.IS_IN_INTERFACE_DECLARATION_LIST) {
        return 'An IS statement appears in an interface declaration list. Annex A.2 admits no IS form for an interfaceDeclaration.';
      }
      if (r === REASON.DUPLICATE_INTERFACE_MEMBER) {
        return 'The interface declares the same member name more than once. ISO 4.3.5 prohibits duplicate interface declarations.';
      }
      return 'This interface declaration does not match the language grammar.';
    }
  ),

  // --- ROUTE_NODE_NOT_BOUND (P2C) ----------------------------------------
  [FINDING_CODE.ROUTE_NODE_NOT_BOUND]: makeTemplate(
    MESSAGE_ID.ROUTE_NODE_NOT_BOUND,
    'ROUTE node name is not defined',
    'A ROUTE statement names a node that is not defined before the ROUTE.',
    (ctx) => {
      const name = quoteName(ctx.subjectName);
      const r = ctx.reason;
      if (r === REASON.ROUTE_NODE_NOT_DEFINED_BEFORE_ROUTE) {
        return name
          ? `${name} is referenced in a ROUTE but has no preceding DEF. ISO 4.10.2 requires the node to be defined before the ROUTE.`
          : 'A ROUTE references a node that has no preceding DEF. ISO 4.10.2 requires the node to be defined before the ROUTE.';
      }
      if (r === REASON.DEF_NOT_DECLARED_IN_SCOPE) {
        return name
          ? `${name} is not declared in this scope.`
          : 'The named node is not declared in this scope.';
      }
      if (r === REASON.USE_BEFORE_DEF) {
        return 'The named node is used before it is defined.';
      }
      return 'A ROUTE statement names a node that is not defined.';
    }
  ),

  // --- ROUTE_ENDPOINT_NOT_BOUND (P2C) ------------------------------------
  [FINDING_CODE.ROUTE_ENDPOINT_NOT_BOUND]: makeTemplate(
    MESSAGE_ID.ROUTE_ENDPOINT_NOT_BOUND,
    'ROUTE endpoint is not defined',
    'A ROUTE statement names an event that does not exist on its node.',
    (ctx) => {
      const r = ctx.reason;
      if (r === REASON.ROUTE_ENDPOINT_UNKNOWN_FIELD) {
        return 'The named endpoint is not a declared event on the node. ISO 4.10.2 requires a ROUTE to connect existing events.';
      }
      if (r === REASON.ROUTE_ENDPOINT_NODE_TYPE_UNRESOLVED) {
        return UNCERTAIN(ctx);
      }
      if (r === REASON.ROUTE_SOURCE_NOT_AN_EVENT_OUT) {
        return 'The ROUTE source endpoint is not an eventOut on the source node. ISO 4.10.2 requires a ROUTE to start at an eventOut.';
      }
      if (r === REASON.ROUTE_DEST_NOT_AN_EVENT_IN) {
        return 'The ROUTE destination endpoint is not an eventIn on the destination node. ISO 4.10.2 requires a ROUTE to end at an eventIn.';
      }
      if (r === REASON.ROUTE_TYPE_UNKNOWN) {
        return UNCERTAIN(ctx);
      }
      if (r === REASON.ROUTE_ENDPOINT_VIA_SHORTHAND
        || r === REASON.ROUTE_ENDPOINT_VIA_IMPLICIT_ALIAS) {
        return 'WRLForge could not determine this endpoint from the file as written.';
      }
      return 'A ROUTE statement names an event that does not exist on its node.';
    }
  ),

  // --- ROUTE_CONNECTION_REJECTED (P2C) ------------------------------------
  [FINDING_CODE.ROUTE_CONNECTION_REJECTED]: makeTemplate(
    MESSAGE_ID.ROUTE_CONNECTION_REJECTED,
    'ROUTE connection is not allowed',
    'The types of the ROUTE source eventOut and destination eventIn do not match.',
    (ctx) => 'ISO 4.10.2 requires the source eventOut and destination eventIn of a ROUTE to have matching types.'
  ),

  // --- CHILD_NOT_PERMITTED (WD1.6-C) -------------------------------------
  [FINDING_CODE.CHILD_NOT_PERMITTED]: makeTemplate(
    MESSAGE_ID.CHILD_NOT_PERMITTED,
    'Child node is not permitted here',
    'This node type cannot occupy this field.',
    (ctx) => {
      const childName = quoteName(ctx.subjectName);
      const r = ctx.reason;
      if (r === 'child-class-not-permitted-by-table-4.3'
        || r === 'table-4.3') {
        return childName
          ? `${childName} is not in the class of node types permitted for this field. ISO Table 4.3 names the permitted classes.`
          : 'This node type is not in the class of node types permitted for this field. ISO Table 4.3 names the permitted classes.';
      }
      return 'This child node is not permitted in this position.';
    }
  ),
});

// ---------------------------------------------------------------------------
// WD1.7-D agreement finding templates
// ---------------------------------------------------------------------------

const AGREEMENT_FINDING_TEMPLATES = table({
  [AGREEMENT_FINDING.MEMBER_MISSING]: makeTemplate(
    MESSAGE_ID.AGREEMENT_MEMBER_MISSING,
    'Interface member is missing',
    'The local EXTERNPROTO declares a member that the implementation PROTO does not declare.',
    (ctx) => {
      const member = quoteName(ctx.memberName);
      const compat = compatibilitySentence(ctx.compatibility);
      const base = member
        ? `${member} is declared in the local EXTERNPROTO but the implementation PROTO does not declare it. ISO 4.9.2 requires the implementation to provide every locally declared member.`
        : 'The local EXTERNPROTO declares a member that the implementation PROTO does not declare. ISO 4.9.2 requires the implementation to provide every locally declared member.';
      return compat ? `${base} ${compat}` : base;
    }
  ),

  [AGREEMENT_FINDING.TYPE_MISMATCH]: makeTemplate(
    MESSAGE_ID.AGREEMENT_TYPE_MISMATCH,
    'Interface member type differs',
    'The local and target member names match but use different field types.',
    (ctx) => {
      const member = quoteName(ctx.memberName);
      const local = nameOf(ctx.localType);
      const target = nameOf(ctx.targetType);
      const who = member || 'this member';
      if (local != null && target != null) {
        return `${who} is declared as ${local} in the local EXTERNPROTO and as ${target} in the implementation PROTO. ISO 4.9.2 requires matching types.`;
      }
      if (local != null) {
        return `${who} is declared as ${local} in the local EXTERNPROTO but the implementation PROTO does not provide a matching type. ISO 4.9.2 requires matching types.`;
      }
      if (target != null) {
        return `${who} is declared as ${target} in the implementation PROTO but the local EXTERNPROTO does not declare a matching type. ISO 4.9.2 requires matching types.`;
      }
      return `${who} uses different field types on the local and target sides. ISO 4.9.2 requires matching types.`;
    }
  ),

  [AGREEMENT_FINDING.ACCESS_DIFFERS]: makeTemplate(
    MESSAGE_ID.AGREEMENT_ACCESS_DIFFERS,
    'Interface member access category differs',
    'The local and target member names match and use the same field type, but use different access categories.',
    (ctx) => {
      const member = quoteName(ctx.memberName);
      const local = nameOf(ctx.localAccess);
      const target = nameOf(ctx.targetAccess);
      const who = member || 'This member';
      const parts = [`${who} uses ${local || 'one access category'} in the local declaration and ${target || 'a different access category'} in the target.`];
      parts.push('ISO 4.9.2 names "names and types" and does not state that access categories must match.');
      return parts.join(' ');
    }
  ),
});

// ---------------------------------------------------------------------------
// WD1.7-D agreement rollup templates
// ---------------------------------------------------------------------------

const ROLLUP_TEMPLATES = table({
  [AGREEMENT_STATUS.SATISFIED]: makeTemplate(
    MESSAGE_ID.AGREEMENT_ROLLUP_SATISFIED,
    'Interface check passed',
    'The local EXTERNPROTO interface satisfies the implementation PROTO.',
    () => 'Every locally declared member is present in the implementation PROTO with the same type.'
  ),

  [AGREEMENT_STATUS.VIOLATED]: makeTemplate(
    MESSAGE_ID.AGREEMENT_ROLLUP_VIOLATED,
    'Interface check failed',
    'The local EXTERNPROTO interface does not satisfy the implementation PROTO.',
    () => 'At least one locally declared member is missing from or differs from the implementation PROTO. ISO 4.9.2 requires the implementation to provide every locally declared member with a matching type.'
  ),

  [AGREEMENT_STATUS.WITHHELD]: makeTemplate(
    MESSAGE_ID.AGREEMENT_ROLLUP_WITHHELD,
    'Interface check withheld',
    'WRLForge could not determine whether the local interface satisfies the implementation PROTO.',
    UNCERTAIN
  ),

  [AGREEMENT_STATUS.NOT_ATTEMPTED]: makeTemplate(
    MESSAGE_ID.AGREEMENT_ROLLUP_NOT_ATTEMPTED,
    'Interface check not attempted',
    'WRLForge did not attempt the interface check because no implementation target was selected.',
    () => 'No implementation PROTO was selected for this local EXTERNPROTO, so ISO 4.9.2 was not checked.'
  ),

  [AGREEMENT_STATUS.INVALID]: makeTemplate(
    MESSAGE_ID.AGREEMENT_ROLLUP_INVALID,
    'Interface check invalid',
    'The interface check request was not well-formed.',
    () => 'The interface check could not be run because one of its arguments was not a prototype declaration.'
  ),
});

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** Build the context object a detail builder consumes. Pure, deterministic. */
function buildContext(presentationResult) {
  const finding = presentationResult && presentationResult.finding;
  const p = presentationResult && presentationResult.presentation;
  return Object.freeze({
    subjectName: finding && finding.subject && finding.subject.name != null
      ? finding.subject.name : (finding && finding.name != null ? finding.name : null),
    memberName: finding && finding.name != null ? finding.name : null,
    localType: finding && finding.localType != null ? finding.localType : null,
    targetType: finding && finding.targetType != null ? finding.targetType : null,
    localAccess: finding && finding.localAccess != null ? finding.localAccess : null,
    targetAccess: finding && finding.targetAccess != null ? finding.targetAccess : null,
    iso: p && p.iso != null ? p.iso : null,
    claim: p && p.claim != null ? p.claim : null,
    confidenceStatus: p && p.confidence ? p.confidence.status : null,
    recovered: p && p.confidence ? !!p.confidence.recovered : false,
    compatibility: p && p.compatibility ? p.compatibility : null,
    reason: finding && finding.reason != null ? finding.reason : null,
    basis: finding && finding.basis != null ? finding.basis : null,
  });
}

/** Compose a message result from a template and a context. Frozen. */
function compose(template, ctx) {
  const compat = compatibilitySentence(ctx.compatibility);
  const recovered = recoveredSentence(ctx.recovered);
  const rawDetail = template.detailFor ? template.detailFor(ctx) : null;
  const parts = [];
  if (rawDetail) parts.push(String(rawDetail));
  if (compat) parts.push(compat);
  if (recovered) parts.push(recovered);
  const detail = parts.length === 0 ? null : parts.join(' ');
  return Object.freeze({
    id: template.id,
    title: template.title,
    summary: template.summary,
    detail,
  });
}

function requirePresentationResult(value, what) {
  if (!value || typeof value !== 'object'
    || !value.finding || !value.presentation) {
    throw messageError(MESSAGE_ERROR.SHAPE, `expected ${what}`);
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * The message for one WD1.6-D semantic finding's P4-A presentation result.
 *
 * @param {object} presentationResult `{ finding, presentation }` from
 *   `presentation.presentSemanticFinding`.
 * @returns {object} Frozen `{ id, title, summary, detail }`.
 * @throws {Error} `EMESSAGESHAPE` for a malformed result, `EMESSAGEUNCLASSIFIED`
 *   for a finding code with no message entry.
 */
function messageForSemanticFinding(presentationResult) {
  requirePresentationResult(presentationResult, 'a semantic presentation result');
  const finding = presentationResult.finding;
  if (typeof finding.code !== 'string') {
    throw messageError(MESSAGE_ERROR.SHAPE, 'a semantic finding carries a code');
  }
  const template = read(SEMANTIC_TEMPLATES, finding.code, 'semantic finding code');
  return compose(template, buildContext(presentationResult));
}

/**
 * The message for one WD1.7-D agreement finding's P4-A presentation result.
 *
 * @param {object} presentationResult `{ finding, presentation }` from
 *   `presentation.presentAgreementFinding`.
 * @returns {object} Frozen `{ id, title, summary, detail }`.
 * @throws {Error} `EMESSAGESHAPE` or `EMESSAGEUNCLASSIFIED`.
 */
function messageForAgreementFinding(presentationResult) {
  requirePresentationResult(presentationResult, 'an agreement presentation result');
  const finding = presentationResult.finding;
  if (typeof finding.code !== 'string') {
    throw messageError(MESSAGE_ERROR.SHAPE, 'an agreement finding carries a code');
  }
  const template = read(AGREEMENT_FINDING_TEMPLATES, finding.code, 'agreement finding code');
  return compose(template, buildContext(presentationResult));
}

/**
 * The message for a WD1.7-D agreement rollup status presentation.
 *
 * The rollup status is NOT a finding; this entry point accepts the bare
 * `presentAgreementStatus(status)` result, which carries `status` and no
 * `finding`.
 *
 * @param {object} statusPresentation The frozen result of
 *   `presentation.presentAgreementStatus`.
 * @returns {object} Frozen `{ id, title, summary, detail }`.
 */
function messageForAgreementStatus(statusPresentation) {
  if (!statusPresentation || typeof statusPresentation.status !== 'string') {
    throw messageError(MESSAGE_ERROR.SHAPE, 'expected an agreement status presentation');
  }
  const template = read(ROLLUP_TEMPLATES, statusPresentation.status, 'agreement status');
  return compose(template, Object.freeze({
    subjectName: null, memberName: null,
    localType: null, targetType: null, localAccess: null, targetAccess: null,
    iso: statusPresentation.iso != null ? statusPresentation.iso : null,
    claim: statusPresentation.claim != null ? statusPresentation.claim : null,
    confidenceStatus: null, recovered: false, compatibility: null,
    reason: null, basis: null,
  }));
}

/**
 * One entry point that dispatches on `presentation.origin`.
 *
 * Use this from WD2 when the consumer holds a mixed list of presentation
 * results and wants each one converted to text by the same code path.
 *
 * @param {object} presentationResult `{ finding, presentation }` OR a status
 *   presentation (from `presentAgreementStatus`).
 * @returns {object} Frozen `{ id, title, summary, detail }`.
 */
function messageForPresentation(presentationResult) {
  if (!presentationResult || typeof presentationResult !== 'object') {
    throw messageError(MESSAGE_ERROR.SHAPE, 'expected a presentation result');
  }
  // Rollup presentations carry `status` and no `finding`.
  if (presentationResult.status != null && !presentationResult.finding) {
    return messageForAgreementStatus(presentationResult);
  }
  requirePresentationResult(presentationResult, 'a presentation result');
  const origin = presentationResult.presentation.origin;
  if (origin === FINDING_ORIGIN.SEMANTIC) return messageForSemanticFinding(presentationResult);
  if (origin === FINDING_ORIGIN.INTERFACE_AGREEMENT) return messageForAgreementFinding(presentationResult);
  throw messageError(MESSAGE_ERROR.UNCLASSIFIED,
    `finding origin ${JSON.stringify(origin)} has no message`);
}

module.exports = {
  MESSAGE_ID,
  MESSAGE_ERROR,
  messageForSemanticFinding,
  messageForAgreementFinding,
  messageForAgreementStatus,
  messageForPresentation,
  // Internal, for this lane's own matrix and mutation tests: the catalog
  // tables. NOT published on `src/vrml/index.js` -- the same split P4-A made
  // for its policy tables.
  SEMANTIC_TEMPLATES,
  AGREEMENT_FINDING_TEMPLATES,
  ROLLUP_TEMPLATES,
};
