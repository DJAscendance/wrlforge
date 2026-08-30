'use strict';
// P4-A -- semantic findings presentation policy.
//
// The layer WD1.6-D named and refused to build. Every module below this one
// answers "what is true about this document"; this one answers the ONE question
// they all decline: "how should a consumer show it?"
//
//   semantic evidence  ->  P4 presentation policy  ->  WD2 renders it
//   (WD1.5 / WD1.6 / WD1.7)   ^^^^^^^^^^^^^^^^^^^      (not this lane)
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE OWNS, AND WHAT IT MAY NEVER TOUCH
// ---------------------------------------------------------------------------
//
// OWNS: severity, attention rank, ordering, default visibility, filter/group
// tags, how confidence is presented, how a compatibility attachment is
// presented, and whether an ordinary Save is blocked.
//
// MAY NEVER DECIDE: whether the ISO fact is true, whether a PROTO resolves,
// whether an EXTERNPROTO target matches, whether a class is legal, or whether
// compatibility evidence is earned. Those are already decided, by authorities
// this module reads and cannot reach into. A presentation is a SIBLING
// PROJECTION: the finding is carried by identity, frozen exactly as its own
// authority froze it, and there is no code path here that constructs a finding,
// copies one field-by-field, or re-emits one with a changed value.
//
// ---------------------------------------------------------------------------
// THE FOUR RULES THAT COST SOMETHING TO GET WRONG
// ---------------------------------------------------------------------------
//
//   1. COMPATIBILITY NEVER DOWNGRADES A STRICT SEVERITY. A construct that ISO
//      prohibits and a named runtime tolerates is still an error; the profile
//      is an ANNOTATION beside it, never a discount on it. "blaxxun Contact
//      accepts this" and "this is VRML97" are different sentences, and the
//      second one is false.
//
//   2. SEVERITY AND CONFIDENCE ARE ORTHOGONAL. When the ISO axis asserts a
//      normative claim, `confidence` is NOT CONSULTED AT ALL -- a recovered
//      violation is the same severity as its proven twin. `confidence` reaches
//      severity in exactly one place: it distinguishes a finding that reports a
//      CONCLUSIVE answer from one that reports the substrate could not answer,
//      and that distinction only ever applies where NO normative claim is made.
//      86.96% of WD1.6-D's corpus findings carry `recovered`; a policy that let
//      that dilute severity would silently retire most of the substrate.
//
//   3. RECOVERED IS VISIBLE. It may rank lower and it carries its own tag, but
//      it is never hidden, never suppressed and never dropped. Filtering is the
//      user's choice, made in a UI, from metadata this module supplies.
//
//   4. A SEMANTIC FINDING NEVER BLOCKS AN ORDINARY SAVE. An author must be able
//      to save a broken, half-written or unprovable document precisely so they
//      can go on fixing it. `saveBlocking` is a frozen `false` on every result
//      this module can produce, and there is no parameter that changes it.
//
// ---------------------------------------------------------------------------
// TWO FAMILIES, ONE POLICY
// ---------------------------------------------------------------------------
//
// Two record shapes carry semantic evidence today, and they are NOT merged into
// a third:
//
//   * WD1.6-D `semantic-findings` -- `{ code, iso, confidence, reason, ... }`
//   * WD1.7-D `proto-agreement`   -- `{ code, basis, name, localType, ... }`
//
// Each gets its own explicit entry point, because sniffing a record's shape to
// guess which family it belongs to is the WD.md §7 failure mode wearing a new
// hat. What they SHARE is the policy core: both are normalized onto the same
// two axes (`ISO_RESULT` and a conclusive/inconclusive reading of the answer),
// and one table turns those axes into a severity. There is exactly one severity
// table in this repository and it is below.
//
// NO CATCH-ALL. Every table is total over its vocabulary and an unrecognized
// value THROWS. A future finding code, status, ISO result, agreement basis or
// compatibility classification therefore cannot reach a consumer with a default
// severity nobody chose -- it fails, loudly, in `presentation-matrix.test.js`.
//
// ---------------------------------------------------------------------------
// WHERE P4-A STOPS
// ---------------------------------------------------------------------------
//
// NO MESSAGE TEXT. There is no user-facing prose authority for semantic
// findings anywhere in the repository, and writing one is a catalogue of
// hundreds of sentences whose wording must not over-claim for an `unsupported`
// or a `recovered` answer. That is P4-B. A consumer has `code`, `reason` and
// `rule` and can render them until it exists.
//
// NO EXPORT/PACKAGE GATE. World Project packaging already owns its own blocking
// authority (`src/world-project/package-plan.js`), and Mall Item upload rules
// belong to `validator.js`. A generic `exportBlocking` here would be a third
// opinion about a question two profiles already answer, so this module does not
// have the field at all.
//
// NO DISPLAY KEY. WD2 will want stable list identity; it does not exist yet, an
// array index is stable within a render pass, and a key minted here would be one
// more thing that must not be confused with WD1.4 node identity. Deferred, with
// the recipe recorded in the as-built document.
//
// NO CONTEXT PARAMETER. Presentation is a pure function of the finding. There is
// no product concept that legitimately varies it: the owner's ratified policy is
// that compatibility never creates an alternate severity mode, and a speculative
// `{ mode, target, expertLevel }` object would be a place for one to grow.
//
// NO UI. No component, no panel, no colour, no icon, no wiring.

const diagnostics = require('./diagnostics');
const semanticFindings = require('./semantic-findings');
const scopeGraph = require('./scope-graph');
const protoAgreement = require('./proto-agreement');
const compatibilityProfiles = require('./compatibility');

const { SEVERITY } = diagnostics;
const { ISO_RESULT, FINDING_CODE } = semanticFindings;
const { STATUS } = scopeGraph;
const { AGREEMENT_FINDING, AGREEMENT_BASIS, AGREEMENT_STATUS } = protoAgreement;
const { COMPATIBILITY_CLASSIFICATION } = compatibilityProfiles;

// ---------------------------------------------------------------------------
// Failure
// ---------------------------------------------------------------------------

/**
 * Error codes. A presentation failure is a PROGRAMMING error -- an unclassified
 * vocabulary value or a foreign record -- and fails loudly for WD1.4's reason:
 * a policy layer that degrades into a default is a policy layer that shipped a
 * decision nobody made.
 */
const PRESENTATION_ERROR = Object.freeze({
  /** The record is not the shape this entry point accepts. */
  SHAPE: 'EPRESENTATIONSHAPE',
  /** A vocabulary value has no entry in the policy table that must classify it. */
  UNCLASSIFIED: 'EPRESENTATIONUNCLASSIFIED',
});

function presentationError(code, message) {
  const err = new Error(`presentation: ${message}`);
  err.code = code;
  return err;
}

/** Read a total table, or throw. THE ONLY table accessor -- there is no default. */
function classify(table, value, what) {
  const entry = Object.prototype.hasOwnProperty.call(table, value) ? table[value] : undefined;
  if (entry === undefined) {
    throw presentationError(PRESENTATION_ERROR.UNCLASSIFIED,
      `${what} ${JSON.stringify(value)} has no presentation policy`);
  }
  return entry;
}

const table = (entries) => Object.freeze(Object.assign(Object.create(null), entries));

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Which evidence family a presentation was projected from. */
const FINDING_ORIGIN = Object.freeze({
  /** WD1.6-D `semanticFindings.findingsForDocument`. */
  SEMANTIC: 'semantic',
  /** WD1.7-D `protoAgreement.compareInterfaceAgreement`. */
  INTERFACE_AGREEMENT: 'interface-agreement',
});

/**
 * WHAT KIND OF STATEMENT the finding makes. The single input to severity, and
 * the reason severity is explicable rather than a lookup nobody can defend.
 */
const CLAIM = Object.freeze({
  /**
   * A normative sentence of ISO/IEC 14772-1 is asserted to be violated, or to
   * leave this construct's results undefined. Both are conformance failures
   * under 7.2.1. Confidence plays NO part in reaching this value.
   */
  VIOLATION: 'violation',
  /**
   * The substrate could not answer the question it was asked. NOT a claim that
   * the document is wrong -- "could not determine" and "known invalid" are
   * different, and presenting the first as the second is the failure this value
   * exists to prevent.
   */
  UNDETERMINED: 'undetermined',
  /**
   * A conclusive, factual answer about a construct the standard does not
   * legislate. Reports no violation, and must never be shown as one.
   */
  OBSERVATION: 'observation',
});

/** Did the producing authority return a usable answer for the question asked? */
const CONFIDENCE_CLASS = Object.freeze({
  /** Yes -- the answer stands on its own. */
  CONCLUSIVE: 'conclusive',
  /** No -- unbound, ambiguous, unsupported, ill-formed or recovery-damaged. */
  INCONCLUSIVE: 'inconclusive',
});

/**
 * Which part of the language a finding is about. Group metadata for a UI that
 * wants sections; it is NOT a severity input and never affects one.
 */
const FINDING_GROUP = Object.freeze({
  NODE_NAMES: 'node-names',
  NODE_TYPES: 'node-types',
  PROTOTYPE_INTERFACE: 'prototype-interface',
  EVENT_ROUTING: 'event-routing',
  SCENE_STRUCTURE: 'scene-structure',
  EXTERNAL_INTERFACE: 'external-interface',
});

/**
 * Stable filter tags. A presentation carries SEVERAL, on purpose: a UI filters
 * along whichever axis its user picked, and one tag per finding would force it
 * to re-derive the others.
 */
const FILTER_TAG = Object.freeze({
  // --- severity axis ---
  ERRORS: 'errors',
  WARNINGS: 'warnings',
  INFORMATION: 'information',
  // --- confidence axis ---
  /**
   * The producing authority returned a usable answer. Deliberately NOT called
   * "proven": an `unresolved` USE has PROVEN an absence (P1 downgrades to
   * `recovered` whenever absence is not provable), so "proven" would be a claim
   * about the document, and this tag is a claim about the ANSWER.
   */
  CONCLUSIVE: 'conclusive',
  INCONCLUSIVE: 'inconclusive',
  /**
   * Parser recovery moved the boundaries the answer depended on. ADDITIONAL to
   * `INCONCLUSIVE`, never instead of it. This is the axis a UI filters on when
   * it wants to hide uncertainty -- 86.96% of WD1.6-D's corpus findings carry
   * it -- which is why it is its own tag and not folded into the one above.
   */
  RECOVERED: 'recovered',
  // --- rule-source axis ---
  STRICT_ISO: 'strict-iso',
  NOT_SPECIFIED_BY_ISO: 'not-specified-by-iso',
  /** Additional to a rule-source tag: an evidence-backed profile is attached. */
  COMPATIBILITY: 'compatibility',
});

// ---------------------------------------------------------------------------
// The policy tables
// ---------------------------------------------------------------------------

/**
 * ISO axis + answer class -> claim. THE ONLY PLACE severity's input is decided.
 *
 * Read the shape, not just the values: the two terminal ISO results map to
 * `VIOLATION` with NO dependence on the answer class, which is rule 2 expressed
 * as data rather than as a comment. Only `NOT_STATED` -- where there is no
 * normative claim to preserve -- splits, and it splits on whether the substrate
 * answered at all.
 */
const CLAIM_BY_ISO = table({
  [ISO_RESULT.PROHIBITED]: table({
    [CONFIDENCE_CLASS.CONCLUSIVE]: CLAIM.VIOLATION,
    [CONFIDENCE_CLASS.INCONCLUSIVE]: CLAIM.VIOLATION,
  }),
  [ISO_RESULT.UNDEFINED]: table({
    [CONFIDENCE_CLASS.CONCLUSIVE]: CLAIM.VIOLATION,
    [CONFIDENCE_CLASS.INCONCLUSIVE]: CLAIM.VIOLATION,
  }),
  [ISO_RESULT.NOT_STATED]: table({
    [CONFIDENCE_CLASS.CONCLUSIVE]: CLAIM.OBSERVATION,
    [CONFIDENCE_CLASS.INCONCLUSIVE]: CLAIM.UNDETERMINED,
  }),
});

/** claim -> severity. Three rows, and the whole severity contract. */
const SEVERITY_BY_CLAIM = table({
  [CLAIM.VIOLATION]: SEVERITY.ERROR,
  [CLAIM.UNDETERMINED]: SEVERITY.WARNING,
  [CLAIM.OBSERVATION]: SEVERITY.INFO,
});

/**
 * The substrate's own status -> did it answer?
 *
 * `RESOLVED` is the only status that returns an answer a consumer can act on.
 * Every other value means the question came back unanswered in some way, and
 * the DIFFERENCES between them are preserved verbatim in `confidence.status`
 * and in the attention rank -- they are flattened here only for the severity
 * input, and only where no normative claim exists to preserve.
 */
const CONFIDENCE_CLASS_BY_STATUS = table({
  [STATUS.RESOLVED]: CONFIDENCE_CLASS.CONCLUSIVE,
  [STATUS.UNRESOLVED]: CONFIDENCE_CLASS.INCONCLUSIVE,
  [STATUS.AMBIGUOUS]: CONFIDENCE_CLASS.INCONCLUSIVE,
  [STATUS.INVALID]: CONFIDENCE_CLASS.INCONCLUSIVE,
  [STATUS.UNSUPPORTED]: CONFIDENCE_CLASS.INCONCLUSIVE,
  [STATUS.RECOVERED]: CONFIDENCE_CLASS.INCONCLUSIVE,
});

/**
 * WD1.6-D finding code -> group. Total, and the guard that makes a NEW finding
 * code a P4 decision instead of a silent arrival.
 *
 * `ROUTE_NODE_NOT_BOUND` is grouped with routing rather than with node names
 * even though 4.6.2 is the rule it breaks: the author sees a ROUTE statement,
 * and grouping is about where they will look. The ISO axis is untouched by it.
 */
const GROUP_BY_FINDING_CODE = table({
  [FINDING_CODE.USE_NOT_BOUND]: FINDING_GROUP.NODE_NAMES,
  [FINDING_CODE.NODE_TYPE_NOT_BOUND]: FINDING_GROUP.NODE_TYPES,
  [FINDING_CODE.NODE_TYPE_SHADOWS_BUILTIN]: FINDING_GROUP.NODE_TYPES,
  [FINDING_CODE.IS_TARGET_NOT_BOUND]: FINDING_GROUP.PROTOTYPE_INTERFACE,
  [FINDING_CODE.IS_CONNECTION_REJECTED]: FINDING_GROUP.PROTOTYPE_INTERFACE,
  [FINDING_CODE.IS_BINDING_ISSUE]: FINDING_GROUP.PROTOTYPE_INTERFACE,
  [FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING]: FINDING_GROUP.PROTOTYPE_INTERFACE,
  [FINDING_CODE.ROUTE_NODE_NOT_BOUND]: FINDING_GROUP.EVENT_ROUTING,
  [FINDING_CODE.ROUTE_ENDPOINT_NOT_BOUND]: FINDING_GROUP.EVENT_ROUTING,
  [FINDING_CODE.ROUTE_CONNECTION_REJECTED]: FINDING_GROUP.EVENT_ROUTING,
  [FINDING_CODE.CHILD_NOT_PERMITTED]: FINDING_GROUP.SCENE_STRUCTURE,
});

/**
 * WD1.7-D agreement basis -> the SAME ISO axis WD1.6-D uses.
 *
 * One strictness vocabulary, not two. 4.9.2 states a requirement, so a finding
 * on that basis is `PROHIBITED`; 4.9.2 says nothing about access categories
 * (WD1.7-A's U7), so `ACCESS_DIFFERS` is `NOT_STATED` -- which is precisely why
 * it comes out as INFO below without any code that mentions it by name.
 */
const ISO_BY_AGREEMENT_BASIS = table({
  [AGREEMENT_BASIS.ISO_4_9_2]: ISO_RESULT.PROHIBITED,
  [AGREEMENT_BASIS.NOT_SPECIFIED_BY_ISO_4_9_2]: ISO_RESULT.NOT_STATED,
});

/**
 * WD1.7-D agreement code -> group. Total, for the same reason
 * `GROUP_BY_FINDING_CODE` is: a new agreement code must be adjudicated here.
 */
const GROUP_BY_AGREEMENT_CODE = table({
  [AGREEMENT_FINDING.MEMBER_MISSING]: FINDING_GROUP.EXTERNAL_INTERFACE,
  [AGREEMENT_FINDING.TYPE_MISMATCH]: FINDING_GROUP.EXTERNAL_INTERFACE,
  [AGREEMENT_FINDING.ACCESS_DIFFERS]: FINDING_GROUP.EXTERNAL_INTERFACE,
});

/**
 * WD1.7-E1 classification -> how it is presented.
 *
 * `tolerated` says the named runtime accepts the construct. `portable` is
 * `false` for BOTH classifications and is not negotiable: a vendor acceptance
 * and an extra-standard extension are equally unusable in another browser, and
 * a consumer that renders only "accepted by blaxxun Contact" without it would
 * be telling an author their file is fine.
 */
const COMPATIBILITY_PRESENTATION = table({
  [COMPATIBILITY_CLASSIFICATION.TOLERATED_VIOLATION]: Object.freeze({
    tolerated: true, portable: false,
  }),
  [COMPATIBILITY_CLASSIFICATION.EXTRA_STANDARD]: Object.freeze({
    tolerated: false, portable: false,
  }),
});

/**
 * WD1.7-D agreement ROLLUP status -> presentation. NOT a finding table.
 *
 * The rollup is the only place "the whole comparison could not be made"
 * appears; `withheld` produces no finding at all, by design (turning unknown
 * into missing is the gate WD1.7-D exists for). Presenting the status is how a
 * consumer learns that without this module minting an occurrence that the
 * substrate did not report.
 */
const AGREEMENT_STATUS_PRESENTATION = table({
  [AGREEMENT_STATUS.SATISFIED]: Object.freeze({
    claim: CLAIM.OBSERVATION, attention: false,
  }),
  [AGREEMENT_STATUS.VIOLATED]: Object.freeze({
    claim: CLAIM.VIOLATION, attention: true,
  }),
  [AGREEMENT_STATUS.WITHHELD]: Object.freeze({
    claim: CLAIM.UNDETERMINED, attention: true,
  }),
  [AGREEMENT_STATUS.NOT_ATTEMPTED]: Object.freeze({
    claim: CLAIM.UNDETERMINED, attention: true,
  }),
  [AGREEMENT_STATUS.INVALID]: Object.freeze({
    claim: CLAIM.UNDETERMINED, attention: true,
  }),
});

// ---------------------------------------------------------------------------
// Attention rank
// ---------------------------------------------------------------------------

/**
 * Three ordered scales, combined into ONE integer so ordering has a single key
 * a consumer can also sort by itself. Lower means "look at this first".
 *
 * The nesting is the contract: severity dominates absolutely, so no confidence
 * value can lift a warning above an error or push an error below one. Within a
 * severity, a more explicit normative basis comes first. Within that, a
 * conclusive answer comes before an unprovable one -- which is how `recovered`
 * gets its lower attention WITHOUT touching severity.
 */
const SEVERITY_RANK = table({
  [SEVERITY.ERROR]: 0,
  [SEVERITY.WARNING]: 1,
  [SEVERITY.INFO]: 2,
  [SEVERITY.HINT]: 3,
});

const STRICTNESS_RANK = table({
  [ISO_RESULT.PROHIBITED]: 0,
  [ISO_RESULT.UNDEFINED]: 1,
  [ISO_RESULT.NOT_STATED]: 2,
});

const CONFIDENCE_RANK = table({
  [STATUS.RESOLVED]: 0,
  [STATUS.UNRESOLVED]: 1,
  [STATUS.AMBIGUOUS]: 2,
  [STATUS.INVALID]: 3,
  [STATUS.UNSUPPORTED]: 4,
  [STATUS.RECOVERED]: 5,
});

function attentionRankOf(severity, iso, status) {
  return classify(SEVERITY_RANK, severity, 'severity') * 100
    + classify(STRICTNESS_RANK, iso, 'ISO result') * 10
    + (status === null ? 0 : classify(CONFIDENCE_RANK, status, 'confidence status'));
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

const SEVERITY_TAG = table({
  [SEVERITY.ERROR]: FILTER_TAG.ERRORS,
  [SEVERITY.WARNING]: FILTER_TAG.WARNINGS,
  [SEVERITY.INFO]: FILTER_TAG.INFORMATION,
  [SEVERITY.HINT]: FILTER_TAG.INFORMATION,
});

const RULE_SOURCE_TAG = table({
  [ISO_RESULT.PROHIBITED]: FILTER_TAG.STRICT_ISO,
  [ISO_RESULT.UNDEFINED]: FILTER_TAG.STRICT_ISO,
  [ISO_RESULT.NOT_STATED]: FILTER_TAG.NOT_SPECIFIED_BY_ISO,
});

/**
 * Tags in ONE fixed order -- severity, confidence, rule source, compatibility.
 * Deterministic by construction rather than by sorting, so the array reads in
 * the order a person would explain the finding in.
 */
function tagsFor(severity, confidenceClass, recovered, iso, hasCompatibility) {
  const tags = [classify(SEVERITY_TAG, severity, 'severity')];
  tags.push(confidenceClass === CONFIDENCE_CLASS.CONCLUSIVE
    ? FILTER_TAG.CONCLUSIVE : FILTER_TAG.INCONCLUSIVE);
  if (recovered) tags.push(FILTER_TAG.RECOVERED);
  tags.push(classify(RULE_SOURCE_TAG, iso, 'ISO result'));
  if (hasCompatibility) tags.push(FILTER_TAG.COMPATIBILITY);
  return Object.freeze(tags);
}

/**
 * The compatibility projection, or `null` for NOT EVALUATED.
 *
 * `null` keeps meaning exactly what WD1.6-D reserved it to mean. What is
 * present is a re-expression of the attached record's OWN fields -- this module
 * does not consult the registry, does not name a profile, and cannot decide
 * that evidence is earned.
 */
function compatibilityPresentation(attachment) {
  if (attachment == null) return null;
  const shown = classify(COMPATIBILITY_PRESENTATION, attachment.classification,
    'compatibility classification');
  return Object.freeze({
    profile: attachment.profile,
    classification: attachment.classification,
    behavior: attachment.behavior == null ? null : attachment.behavior,
    evidenceTier: attachment.tier == null ? null : attachment.tier,
    evidenceSubtier: attachment.subtier == null ? null : attachment.subtier,
    /** The named runtime accepts a construct the standard prohibits. */
    tolerated: shown.tolerated,
    /** ALWAYS false. A runtime acceptance is not portability and not conformance. */
    portable: shown.portable,
    /** ALWAYS false. Stated as data so a regression is a failing assertion. */
    downgradesSeverity: false,
  });
}

/**
 * One presentation. FROZEN, and a SIBLING of its finding rather than a copy.
 *
 * `finding` is the producing authority's own frozen record, held BY IDENTITY.
 * Nothing here reads through it to write, and no field of it is duplicated into
 * `presentation` under a new name -- a consumer wanting `code`, `reason`,
 * `rule`, `range`, `detail` or `evidence` reads them from `finding`, where they
 * remain the authority's answer rather than this module's paraphrase.
 */
function presentationResult(finding, presentation) {
  return Object.freeze({ finding, presentation: Object.freeze(presentation) });
}

/** The policy core. Both families arrive here normalized onto the same axes. */
function present(finding, fields) {
  const confidenceClass = fields.status === null
    ? CONFIDENCE_CLASS.CONCLUSIVE
    : classify(CONFIDENCE_CLASS_BY_STATUS, fields.status, 'confidence status');
  const claim = classify(classify(CLAIM_BY_ISO, fields.iso, 'ISO result'),
    confidenceClass, 'confidence class');
  const severity = classify(SEVERITY_BY_CLAIM, claim, 'claim');
  const recovered = fields.status === STATUS.RECOVERED;
  const compatibility = compatibilityPresentation(fields.compatibility);
  return presentationResult(finding, {
    /** `FINDING_ORIGIN.*` -- which evidence family produced the finding. */
    origin: fields.origin,
    /** `FINDING_GROUP.*` -- which part of the language it is about. */
    group: fields.group,
    /** `SEVERITY.*`. A pure function of `claim`, and of nothing else. */
    severity,
    /** `CLAIM.*` -- what kind of statement the finding makes. */
    claim,
    /** `ISO_RESULT.*`, normalized across both families. Never recomputed. */
    iso: fields.iso,
    confidence: Object.freeze({
      /** The substrate's own `STATUS`, VERBATIM, or `null` where it has none. */
      status: fields.status,
      /** `CONFIDENCE_CLASS.*` -- did the authority answer the question? */
      class: confidenceClass,
      /** Parser recovery moved the boundaries this answer depended on. */
      recovered,
    }),
    /** The compatibility projection, or `null` for NOT EVALUATED. */
    compatibility,
    /** Lower means "look at this first". Severity dominates absolutely. */
    attentionRank: attentionRankOf(severity, fields.iso, fields.status),
    /** ALWAYS true. No semantic category is hidden before the user filters. */
    visible: true,
    /** ALWAYS false. Rule 4 -- a semantic finding never blocks an ordinary Save. */
    saveBlocking: false,
    /** Stable filter tags, several per finding, in a fixed order. */
    tags: tagsFor(severity, confidenceClass, recovered, fields.iso, compatibility !== null),
  });
}

// ---------------------------------------------------------------------------
// The entry points
// ---------------------------------------------------------------------------

function requireRecord(finding, what) {
  if (!finding || typeof finding !== 'object') {
    throw presentationError(PRESENTATION_ERROR.SHAPE, `expected ${what}`);
  }
}

/**
 * Present one WD1.6-D semantic finding.
 *
 * @param {object} finding A record from `semanticFindings.findingsForDocument`,
 *   optionally already carrying a WD1.7-E1 compatibility attachment.
 * @returns {object} `{ finding, presentation }`, frozen. `finding` is the input,
 *   by identity and unmodified.
 * @throws {Error} `EPRESENTATIONSHAPE` for a record that is not one;
 *   `EPRESENTATIONUNCLASSIFIED` for a vocabulary value no table classifies.
 */
function presentSemanticFinding(finding) {
  requireRecord(finding, 'a semantic finding');
  if (typeof finding.code !== 'string' || typeof finding.iso !== 'string'
    || typeof finding.confidence !== 'string') {
    throw presentationError(PRESENTATION_ERROR.SHAPE,
      'a semantic finding carries a code, an iso result and a confidence');
  }
  return present(finding, {
    origin: FINDING_ORIGIN.SEMANTIC,
    group: classify(GROUP_BY_FINDING_CODE, finding.code, 'finding code'),
    iso: finding.iso,
    status: finding.confidence,
    compatibility: finding.compatibility == null ? null : finding.compatibility,
  });
}

/**
 * Present one WD1.7-D interface-agreement finding.
 *
 * An agreement finding has no `confidence` field because WD1.7-D emits one ONLY
 * for a member it could prove -- everything unprovable becomes a `withheld`
 * member and a `withheld` rollup, with no finding at all. So the answer class is
 * conclusive by construction, and `confidence.status` is `null` rather than a
 * borrowed `resolved` that would imply a scope-graph status it never had.
 *
 * @param {object} finding A record from an agreement's `findings` array.
 * @returns {object} `{ finding, presentation }`, frozen.
 */
function presentAgreementFinding(finding) {
  requireRecord(finding, 'an interface-agreement finding');
  if (typeof finding.code !== 'string' || typeof finding.basis !== 'string') {
    throw presentationError(PRESENTATION_ERROR.SHAPE,
      'an interface-agreement finding carries a code and a basis');
  }
  return present(finding, {
    origin: FINDING_ORIGIN.INTERFACE_AGREEMENT,
    group: classify(GROUP_BY_AGREEMENT_CODE, finding.code, 'agreement finding code'),
    iso: classify(ISO_BY_AGREEMENT_BASIS, finding.basis, 'agreement basis'),
    // WD1.7-D never populates the slot; asked for anyway so the field is read
    // from the record rather than assumed, and a future attachment presents.
    status: null,
    compatibility: finding.compatibility == null ? null : finding.compatibility,
  });
}

/**
 * Present a WD1.7-D agreement's ROLLUP STATUS. NOT a finding, and deliberately
 * a different shape so it cannot be mixed into a findings list by accident.
 *
 * This is how "the comparison could not be made" reaches a consumer without
 * this module manufacturing an occurrence. `attention` is `false` only for a
 * satisfied comparison -- there is nothing to show, and a UI that renders every
 * status would fill a panel with successes.
 *
 * @param {string} status An `AGREEMENT_STATUS` value.
 * @returns {object} A frozen status presentation.
 */
function presentAgreementStatus(status) {
  const shown = classify(AGREEMENT_STATUS_PRESENTATION, status, 'agreement status');
  const severity = classify(SEVERITY_BY_CLAIM, shown.claim, 'claim');
  const iso = shown.claim === CLAIM.VIOLATION ? ISO_RESULT.PROHIBITED : ISO_RESULT.NOT_STATED;
  const confidenceClass = shown.claim === CLAIM.UNDETERMINED
    ? CONFIDENCE_CLASS.INCONCLUSIVE : CONFIDENCE_CLASS.CONCLUSIVE;
  return Object.freeze({
    /** The `AGREEMENT_STATUS` value, VERBATIM. */
    status,
    origin: FINDING_ORIGIN.INTERFACE_AGREEMENT,
    group: FINDING_GROUP.EXTERNAL_INTERFACE,
    severity,
    claim: shown.claim,
    /** Is there anything for a consumer to show? `false` only for `satisfied`. */
    attention: shown.attention,
    visible: true,
    saveBlocking: false,
    attentionRank: attentionRankOf(severity, iso, null),
    tags: tagsFor(severity, confidenceClass, false, iso, false),
  });
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

const offsetOf = (range) => (range && range.start ? range.start.offset : Infinity);
const endOf = (range) => (range && range.end ? range.end.offset : Infinity);
const byCodepoint = (a, b) => {
  const x = a == null ? '' : String(a);
  const y = b == null ? '' : String(b);
  return x < y ? -1 : (x > y ? 1 : 0);
};

/**
 * THE ONE ordering policy. Total, deterministic, and stable across runs.
 *
 * Dimensions, in order:
 *
 *   1. `attentionRank`  -- severity, then normative strictness, then confidence.
 *   2. span start offset -- so within one rank the list follows the file.
 *   3. span end offset   -- an outer span before an inner one at the same start.
 *   4. `origin`, 5. `code`, 6. `reason`/`basis`, 7. subject name -- codepoint
 *      comparisons over values both families carry or default to `''`.
 *   8. INPUT INDEX -- the last resort, so two findings that are equal on every
 *      other dimension keep their producer's order instead of swapping between
 *      runs. Nothing is ever dropped or merged to break a tie.
 *
 * A range-less finding sorts LAST within its rank (`Infinity`), never first, so
 * an unanchored answer cannot displace an anchored one. It does not throw.
 *
 * @param {ReadonlyArray<object>} results Presentations from this module.
 * @returns {ReadonlyArray<object>} A new frozen array. The input is not mutated.
 */
function orderPresentations(results) {
  if (!Array.isArray(results)) {
    throw presentationError(PRESENTATION_ERROR.SHAPE, 'expected an array of presentations');
  }
  const indexed = results.map((result, index) => {
    requireRecord(result, 'a presentation');
    requireRecord(result.presentation, 'a presentation');
    const f = result.finding || {};
    return {
      result,
      index,
      rank: result.presentation.attentionRank,
      start: offsetOf(f.range),
      end: endOf(f.range),
      origin: result.presentation.origin,
      code: f.code,
      reason: f.reason != null ? f.reason : f.basis,
      name: f.subject ? f.subject.name : f.name,
    };
  });
  indexed.sort((a, b) => (a.rank - b.rank)
    || (a.start - b.start)
    || (a.end - b.end)
    || byCodepoint(a.origin, b.origin)
    || byCodepoint(a.code, b.code)
    || byCodepoint(a.reason, b.reason)
    || byCodepoint(a.name, b.name)
    || (a.index - b.index));
  return Object.freeze(indexed.map((entry) => entry.result));
}

/**
 * Every WD1.6-D finding in one document, presented and ordered.
 *
 * The ordinary WD2 path. Every input occurrence produces exactly one output
 * presentation -- there is no de-duplication, no collapsing by code, and no
 * grouping that discards an occurrence. Two source locations are two findings,
 * whatever they have in common.
 *
 * @param {ReadonlyArray<object>} findings `findingsForDocument`'s array, or the
 *   same array with WD1.7-E1 compatibility attached.
 * @returns {ReadonlyArray<object>} A new frozen, ordered array of the same length.
 */
function presentDocumentFindings(findings) {
  if (!Array.isArray(findings)) {
    throw presentationError(PRESENTATION_ERROR.SHAPE, 'expected an array of semantic findings');
  }
  return orderPresentations(findings.map(presentSemanticFinding));
}

module.exports = {
  // Severity is `diagnostics.SEVERITY` BY IDENTITY, not a second copy: a
  // presentation's severity and a parser diagnostic's severity must be the same
  // value, and two frozen tables with the same keys would not make that obvious.
  SEVERITY,
  FINDING_ORIGIN,
  CLAIM,
  CONFIDENCE_CLASS,
  FINDING_GROUP,
  FILTER_TAG,
  PRESENTATION_ERROR,
  presentSemanticFinding,
  presentAgreementFinding,
  presentAgreementStatus,
  presentDocumentFindings,
  orderPresentations,
  // Internal, for this lane's own matrix and mutation tests: the policy tables.
  // NOT published on `src/vrml/index.js` -- they are the module's reasoning, not
  // its contract, the same split WD1.6-D made for `ISO_BY_REASON`.
  CLAIM_BY_ISO,
  SEVERITY_BY_CLAIM,
  CONFIDENCE_CLASS_BY_STATUS,
  GROUP_BY_FINDING_CODE,
  GROUP_BY_AGREEMENT_CODE,
  ISO_BY_AGREEMENT_BASIS,
  COMPATIBILITY_PRESENTATION,
  AGREEMENT_STATUS_PRESENTATION,
  SEVERITY_RANK,
  STRICTNESS_RANK,
  CONFIDENCE_RANK,
};
