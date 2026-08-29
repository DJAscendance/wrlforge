'use strict';
// WD1.7-D, pure half -- ISO 4.9.2 interface agreement.
//
// One question, asked of a LOCAL `EXTERNPROTO` declaration and the `PROTO`
// declaration WD1.7-C proved to be its implementation:
//
//   Does the local declaration satisfy 4.9.2 relative to that implementation?
//
// ISO/IEC 14772-1, 4.9.2:
//
//   "The names and types of the fields and events of the EXTERNPROTO ... shall
//    be a subset of those defined in the prototype definition."
//
// THE DIRECTION IS THE WHOLE RULE, and it is asymmetric:
//
//                 local  ⊆  target
//
// A target that declares MORE than the local declaration is CONFORMING -- that
// is what "subset" means, and it is the normal shape of a library prototype
// whose users declare only the members they touch. A comparator that flagged an
// extra target member would misreport conforming content as broken, so the
// direction is pinned by a mutation control rather than by a comment.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE IS NOT
// ---------------------------------------------------------------------------
//
// NOT A RESOLVER. It selects no target, retrieves nothing, follows no url and
// reads no filesystem. Both sides arrive as a scope graph plus a declaration
// that graph already owns; every member set comes from WD1.5-P2B's `membersOf`,
// every provability gate from `interfaceScopeIsProvable`, and the field-type
// vocabulary from Annex A.2's own production. There is no second interface
// resolver here, and no scope is walked.
//
// NOT A PRESENTATION LAYER. No severity, no message, no colour, no visibility,
// no suppression, no save policy. A finding says what the standard says and what
// was observed; what a UI does with it is P4's decision (WD1.6-D, same rule).
//
// NOT A COMPATIBILITY CLASSIFIER. No profile is named anywhere in this file.
// Whether an access-category difference belongs to a particular historical
// browser, a vendor dialect, or merely to widespread authoring habit is
// WD1.7-E's question, and WD1.7-E is blocked; see `AGREEMENT_BASIS`.
//
// ---------------------------------------------------------------------------
// TWO DISTINCTIONS THAT COST REAL DAMAGE IF MERGED
// ---------------------------------------------------------------------------
//
// 1. A DECLARATION IS NOT ITS ALIAS-EXPANDED BINDINGS. ISO 4.7 says a declared
//    `exposedField zzz` MAY BE REFERRED TO as `set_zzz` and `zzz_changed`. That
//    is three names for ONE declaration, and 4.9.2 is a statement about the
//    fields and events an interface DECLARES. Comparing written bindings instead
//    would demand that a conforming target declare `set_zzz` and `zzz_changed`
//    as members in their own right -- which 4.3.5 actually PROHIBITS alongside
//    the `exposedField`. `membersOf` is the declaration authority and is the
//    only member source used here; `writtenNamesFor` is deliberately not
//    imported.
//
// 2. AN ACCESS-CATEGORY DIFFERENCE IS NOT AN ISO 4.9.2 VIOLATION. The clause
//    names "names and types" and is silent on access. WD1.7-A recorded that
//    silence as open question U7 and measured 65 access-only differences against
//    2 genuine type mismatches in the same probe -- folding them together would
//    misreport the shape 32-fold. So an access difference is its own
//    observation, carrying the basis `NOT_SPECIFIED_BY_ISO_4_9_2`, and it never
//    changes a member's status.
//
// Pure and browser-safe: no fs, no Electron, no renderer dependency, and no
// reach into `src/proto-resolution` -- the dependency direction is one-way.

const scopeGraph = require('./scope-graph');
const { NODE } = require('./ast');

const {
  STATUS, SCOPE_KIND,
  interfaceScopeFor, membersOf, interfaceScopeIsProvable, isFieldTypeToken,
} = scopeGraph;

const EMPTY = Object.freeze([]);

/**
 * The agreement vocabulary.
 *
 * Both terminal values are new strings because no existing status means them:
 * "the subset obligation is met" is not `resolved`, and "it is not met" is not
 * `invalid`. `INVALID` IS the scope graph's own value, for the same reason
 * WD1.6-C reuses it -- an ill-formed question is a caller error in one
 * vocabulary, not two.
 *
 * There is no boolean accessor and no `isConforming()`. Three of these five are
 * not booleans, and offering a coercion is how uncertainty gets spent as proof.
 */
const AGREEMENT_STATUS = Object.freeze({
  /** Proven: every locally declared member exists in the target with that type. */
  SATISFIED: 'satisfied',
  /** Proven: at least one locally declared member does not. */
  VIOLATED: 'violated',
  /** Something that had to be proven could not be. Never a verdict. */
  WITHHELD: 'withheld',
  /** No proven target was supplied, so the question was never asked. */
  NOT_ATTEMPTED: 'not-attempted',
  /** The question itself is ill-formed -- caller error, not an agreement claim. */
  INVALID: STATUS.INVALID,
});

/** Per-member outcomes. The same three meanings, one member at a time. */
const MEMBER_STATUS = Object.freeze({
  SATISFIED: AGREEMENT_STATUS.SATISFIED,
  VIOLATED: AGREEMENT_STATUS.VIOLATED,
  WITHHELD: AGREEMENT_STATUS.WITHHELD,
});

/**
 * What was OBSERVED. Three codes, and the third is not like the other two.
 *
 * `MEMBER_MISSING` and `TYPE_MISMATCH` are the two errors ISO 4.9.2 names
 * (WD1.7-A N4). `ACCESS_DIFFERS` is a factual observation the standard does not
 * classify -- it is emitted alongside a SATISFIED member as readily as beside a
 * violated one, and it never decides a status.
 */
const AGREEMENT_FINDING = Object.freeze({
  /** No target declaration carries this locally declared name. */
  MEMBER_MISSING: 'member-missing',
  /** The name matches; the declared field-type token does not. */
  TYPE_MISMATCH: 'type-mismatch',
  /** Name and type match; the declared access category does not. */
  ACCESS_DIFFERS: 'access-differs',
});

/**
 * WHOSE RULE a finding is. The axis WD1.6-D keeps separate and this module keeps
 * separate for the same reason: "the standard forbids this" and "the standard
 * does not say" are different claims, and only one of them may ever be presented
 * as non-conformance.
 *
 * There is deliberately no third value naming a vendor, a browser or a
 * historical profile. WD1.7-E owns that classification and is blocked; a finding
 * here carries evidence for it to classify, never a classification of its own.
 * No profile identifier is spelled anywhere in this module.
 */
const AGREEMENT_BASIS = Object.freeze({
  /** ISO/IEC 14772-1, 4.9.2 states the requirement this finding reports. */
  ISO_4_9_2: 'iso-4.9.2',
  /**
   * 4.9.2 names "names and types" and says nothing about access categories, so
   * this observation asserts NOTHING about conformance in either direction.
   * WD1.7-A open question U7.
   */
  NOT_SPECIFIED_BY_ISO_4_9_2: 'not-specified-by-iso-4.9.2',
});

const AGREEMENT_REASON = Object.freeze({
  OK: 'ok',

  // --- the question is ill-formed (INVALID) -----------------------------
  /** `localDeclaration` is not an `ExternProto` node of `localGraph`'s parse. */
  LOCAL_NOT_AN_EXTERNPROTO: 'local-not-an-externproto',
  /** `targetDeclaration` is not a `Proto` node of `targetGraph`'s parse. */
  TARGET_NOT_A_PROTO: 'target-not-a-proto',

  // --- a whole interface could not be proven (WITHHELD) ------------------
  /** The local interface's member enumeration is not the author's. */
  LOCAL_INTERFACE_NOT_PROVABLE: 'local-interface-not-provable',
  /**
   * The target interface's member enumeration is not the author's, so an absent
   * name is NOT evidence of absence. Withheld rather than reported missing --
   * turning "unknown" into "missing" is the failure this gate exists for.
   */
  TARGET_INTERFACE_NOT_PROVABLE: 'target-interface-not-provable',

  // --- one member could not be proven (WITHHELD) ------------------------
  /** The local declaration has no provable name or no Annex A.2 field type. */
  LOCAL_MEMBER_NOT_PROVABLE: 'local-member-not-provable',
  /** The local interface declares this name more than once (4.3.5 prohibits it). */
  LOCAL_MEMBER_AMBIGUOUS: 'local-member-ambiguous',
  /**
   * The target declares this name more than once. NOT resolved by taking the
   * first, the last or the nearest -- ranking candidates is the WD.md §7 failure
   * mode, and neither of two prohibited declarations is "the intended one".
   */
  TARGET_MEMBER_AMBIGUOUS: 'target-member-ambiguous',
  /** The matching target declaration has no Annex A.2 field type to compare. */
  TARGET_MEMBER_NOT_PROVABLE: 'target-member-not-provable',

  // --- rollups ----------------------------------------------------------
  /** At least one member violates 4.9.2. Which ones is in `members`/`findings`. */
  MEMBER_VIOLATES_ISO_4_9_2: 'member-violates-iso-4.9.2',
  /** No violation was proven, but at least one member could not be judged. */
  MEMBER_WITHHELD: 'member-withheld',
  /** No proven target. The C outcome that says why is the caller's to carry. */
  NO_PROVEN_TARGET: 'no-proven-target',
});

function agreementError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function createFinding(fields) {
  return Object.freeze({
    code: fields.code,
    basis: fields.basis,
    /** The locally declared name the finding is about. */
    name: fields.name == null ? null : fields.name,
    localType: fields.localType == null ? null : fields.localType,
    targetType: fields.targetType === undefined ? null : fields.targetType,
    localAccess: fields.localAccess == null ? null : fields.localAccess,
    targetAccess: fields.targetAccess === undefined ? null : fields.targetAccess,
  });
}

function createMember(fields) {
  return Object.freeze({
    /** The locally declared name. One local declaration appears here ONCE. */
    name: fields.name == null ? null : fields.name,
    localType: fields.localType == null ? null : fields.localType,
    localAccess: fields.localAccess == null ? null : fields.localAccess,
    targetType: fields.targetType === undefined ? null : fields.targetType,
    targetAccess: fields.targetAccess === undefined ? null : fields.targetAccess,
    /**
     * The `InterfaceDecl` AST nodes, by identity. Shared and NOT frozen -- they
     * belong to their own parse, not to this projection, and they are
     * PARSE-LIFETIME ONLY (WD.md §2): derived, disposable, never an identity.
     */
    localDeclaration: fields.localDeclaration || null,
    targetDeclaration: fields.targetDeclaration || null,
    localRange: fields.localRange || null,
    targetRange: fields.targetRange || null,
    /** Source position of the LOCAL declaration among this interface's members. */
    sourceOrder: fields.sourceOrder === undefined ? null : fields.sourceOrder,
    status: fields.status,
    reason: fields.reason,
    findings: Object.freeze(fields.findings ? fields.findings.slice() : []),
  });
}

function createSide(fields) {
  return Object.freeze({
    /** The `ExternProto` / `Proto` AST node, by identity. Parse-lifetime only. */
    declaration: fields.declaration || null,
    name: fields.name === undefined ? null : fields.name,
    range: fields.range || null,
    /** Is `membersOf` for this interface the author's whole declaration list? */
    provable: !!fields.provable,
    provableReason: fields.provableReason == null ? null : fields.provableReason,
    /** How many declarations the interface carries. `null` when unprovable. */
    declaredMemberCount: fields.declaredMemberCount === undefined ? null : fields.declaredMemberCount,
  });
}

function createAgreement(fields) {
  return Object.freeze({
    status: fields.status,
    reason: fields.reason,
    local: fields.local || null,
    target: fields.target || null,
    /** One entry per LOCAL declaration, in local source order. */
    members: fields.members || EMPTY,
    /** Every finding from every member, flattened, in the same order. */
    findings: fields.findings || EMPTY,
    /**
     * Target declarations with no locally declared counterpart.
     *
     * A COUNT, and deliberately not a finding list: ISO 4.9.2 makes
     * `local ⊆ target` the conforming shape, so a target superset is normal and
     * reporting it as a problem would be this module inverting the clause. It is
     * kept because a consumer showing an interface benefits from knowing the
     * local declaration is partial -- which WD1.6-B already says another way
     * (`complete: false`).
     */
    targetOnlyMemberCount: fields.targetOnlyMemberCount === undefined ? null : fields.targetOnlyMemberCount,
  });
}

// --- interface projection ---------------------------------------------------

// The declared members of one prototype declaration, or `null` when the
// enumeration is not provable. NOTHING is inferred here: the scope comes from
// the graph's own AST index, the gate from the graph's own recovery state, and
// the list from the graph's own member table.
function declaredInterfaceOf(graph, declAstNode, expectedScopeKind) {
  const scope = interfaceScopeFor(graph, declAstNode);
  if (!scope || scope.kind !== expectedScopeKind) return { scope: null, members: null, gate: null };
  const gate = interfaceScopeIsProvable(graph, scope);
  if (!gate.unique) return { scope, members: null, gate };
  return { scope, members: membersOf(graph, scope), gate };
}

// name -> count, over DECLARED names only. The alias index is deliberately not
// consulted: see the module header, distinction 1.
function countByName(members) {
  const counts = new Map();
  for (const m of members) {
    if (m.name == null) continue;
    counts.set(m.name, (counts.get(m.name) || 0) + 1);
  }
  return counts;
}

function firstNamed(members, name) {
  for (const m of members) if (m.name === name) return m;
  return null;
}

/**
 * ISO 4.9.2 -- does the local EXTERNPROTO interface satisfy the target's?
 *
 * @param {object} localGraph A scope graph over the declaring document.
 * @param {object} localDeclaration An `ExternProto` node from that parse.
 * @param {object} targetGraph A scope graph over the TARGET document.
 * @param {object} targetDeclaration The `Proto` node WD1.7-C selected, from that
 *   target parse.
 * @returns {object} A frozen agreement record. Never throws for a semantic
 *   failure; it throws only when an argument is not a scope graph at all, which
 *   is a programming error rather than an answer (WD1.4).
 */
function compareInterfaceAgreement(localGraph, localDeclaration, targetGraph, targetDeclaration) {
  if (!scopeGraph.isScopeGraph(localGraph) || !scopeGraph.isScopeGraph(targetGraph)) {
    throw agreementError(scopeGraph.SCOPE_ERROR.GRAPH,
      'compareInterfaceAgreement: both graphs must come from buildScopeGraph');
  }

  const localIsExtern = !!localDeclaration && typeof localDeclaration === 'object'
    && localDeclaration.type === NODE.EXTERNPROTO;
  const targetIsProto = !!targetDeclaration && typeof targetDeclaration === 'object'
    && targetDeclaration.type === NODE.PROTO;
  if (!localIsExtern) {
    return createAgreement({
      status: AGREEMENT_STATUS.INVALID, reason: AGREEMENT_REASON.LOCAL_NOT_AN_EXTERNPROTO,
    });
  }
  if (!targetIsProto) {
    return createAgreement({
      status: AGREEMENT_STATUS.INVALID, reason: AGREEMENT_REASON.TARGET_NOT_A_PROTO,
    });
  }

  const localIface = declaredInterfaceOf(localGraph, localDeclaration, SCOPE_KIND.EXTERNPROTO_INTERFACE);
  if (!localIface.scope) {
    return createAgreement({
      status: AGREEMENT_STATUS.INVALID, reason: AGREEMENT_REASON.LOCAL_NOT_AN_EXTERNPROTO,
    });
  }
  const targetIface = declaredInterfaceOf(targetGraph, targetDeclaration, SCOPE_KIND.PROTO_INTERFACE);
  if (!targetIface.scope) {
    return createAgreement({
      status: AGREEMENT_STATUS.INVALID, reason: AGREEMENT_REASON.TARGET_NOT_A_PROTO,
    });
  }

  const local = createSide({
    declaration: localDeclaration,
    name: localDeclaration.name == null ? null : localDeclaration.name,
    range: localDeclaration.range || null,
    provable: !!localIface.members,
    provableReason: localIface.gate ? localIface.gate.reason : null,
    declaredMemberCount: localIface.members ? localIface.members.length : null,
  });
  const target = createSide({
    declaration: targetDeclaration,
    name: targetDeclaration.name == null ? null : targetDeclaration.name,
    range: targetDeclaration.range || null,
    provable: !!targetIface.members,
    provableReason: targetIface.gate ? targetIface.gate.reason : null,
    declaredMemberCount: targetIface.members ? targetIface.members.length : null,
  });

  // BOTH gates are upfront and BOTH withhold every answer, the positive ones
  // included. A recovered interface can manufacture a member as easily as it can
  // lose one, so a `SATISFIED` read off a damaged scope is exactly as wrong as a
  // `MEMBER_MISSING` read off one.
  if (!localIface.members) {
    return createAgreement({
      status: AGREEMENT_STATUS.WITHHELD,
      reason: AGREEMENT_REASON.LOCAL_INTERFACE_NOT_PROVABLE,
      local, target,
    });
  }
  if (!targetIface.members) {
    return createAgreement({
      status: AGREEMENT_STATUS.WITHHELD,
      reason: AGREEMENT_REASON.TARGET_INTERFACE_NOT_PROVABLE,
      local, target,
    });
  }

  const localCounts = countByName(localIface.members);
  const targetCounts = countByName(targetIface.members);

  const members = [];
  const findings = [];
  const matchedTargetNames = new Set();

  localIface.members.forEach((lm, index) => {
    const base = {
      name: lm.name, localType: lm.fieldType, localAccess: lm.access,
      localDeclaration: lm.node, localRange: lm.range || lm.declRange, sourceOrder: index,
    };
    const withhold = (reason) => members.push(createMember({
      ...base, status: MEMBER_STATUS.WITHHELD, reason,
    }));

    // A declaration the parse could not name, or whose type token is not one of
    // Annex A.2's twenty, states no obligation this module can check.
    if (lm.name == null || !isFieldTypeToken(lm.fieldType)) {
      withhold(AGREEMENT_REASON.LOCAL_MEMBER_NOT_PROVABLE);
      return;
    }
    // 4.3.5 prohibits two declarations of one name, so neither is "the intended
    // obligation" -- and if their types differ there is no single subset claim to
    // check at all. Withheld rather than ranked.
    if (localCounts.get(lm.name) > 1) {
      withhold(AGREEMENT_REASON.LOCAL_MEMBER_AMBIGUOUS);
      return;
    }

    const targetCount = targetCounts.get(lm.name) || 0;
    if (targetCount > 1) {
      withhold(AGREEMENT_REASON.TARGET_MEMBER_AMBIGUOUS);
      return;
    }
    if (targetCount === 0) {
      const finding = createFinding({
        code: AGREEMENT_FINDING.MEMBER_MISSING,
        basis: AGREEMENT_BASIS.ISO_4_9_2,
        name: lm.name, localType: lm.fieldType, localAccess: lm.access,
      });
      findings.push(finding);
      members.push(createMember({
        ...base,
        status: MEMBER_STATUS.VIOLATED,
        reason: AGREEMENT_REASON.MEMBER_VIOLATES_ISO_4_9_2,
        findings: [finding],
      }));
      return;
    }

    const tm = firstNamed(targetIface.members, lm.name);
    matchedTargetNames.add(lm.name);
    const matched = {
      ...base,
      targetType: tm.fieldType, targetAccess: tm.access,
      targetDeclaration: tm.node, targetRange: tm.range || tm.declRange,
    };
    if (!isFieldTypeToken(tm.fieldType)) {
      members.push(createMember({
        ...matched, status: MEMBER_STATUS.WITHHELD,
        reason: AGREEMENT_REASON.TARGET_MEMBER_NOT_PROVABLE,
      }));
      return;
    }

    // EXACT token equality -- the same rule 4.8.3's `IS` comparison uses, and
    // for the same reason: no promotion, no coercion, no SF<->MF relationship
    // and, for SFNode/MFNode, no inspection of the node type inside.
    const mine = [];
    if (lm.fieldType !== tm.fieldType) {
      mine.push(createFinding({
        code: AGREEMENT_FINDING.TYPE_MISMATCH,
        basis: AGREEMENT_BASIS.ISO_4_9_2,
        name: lm.name,
        localType: lm.fieldType, targetType: tm.fieldType,
        localAccess: lm.access, targetAccess: tm.access,
      }));
    }
    // U7. Reported WHETHER OR NOT the type matched, and symmetric in direction:
    // 4.9.2 is silent, so neither ordering of the two categories is the
    // conforming one and neither may become a verdict.
    if (lm.access !== tm.access) {
      mine.push(createFinding({
        code: AGREEMENT_FINDING.ACCESS_DIFFERS,
        basis: AGREEMENT_BASIS.NOT_SPECIFIED_BY_ISO_4_9_2,
        name: lm.name,
        localType: lm.fieldType, targetType: tm.fieldType,
        localAccess: lm.access, targetAccess: tm.access,
      }));
    }
    for (const f of mine) findings.push(f);

    const violated = mine.some((f) => f.basis === AGREEMENT_BASIS.ISO_4_9_2);
    members.push(createMember({
      ...matched,
      status: violated ? MEMBER_STATUS.VIOLATED : MEMBER_STATUS.SATISFIED,
      reason: violated ? AGREEMENT_REASON.MEMBER_VIOLATES_ISO_4_9_2 : AGREEMENT_REASON.OK,
      findings: mine,
    }));
  });

  let targetOnly = 0;
  for (const [name, count] of targetCounts) {
    if (!matchedTargetNames.has(name)) targetOnly += count;
  }

  // A PROVEN violation stands even beside a withheld member: it is a positive
  // claim about a member that WAS judged, and another member's uncertainty does
  // not unprove it. `SATISFIED`, by contrast, is a claim about ALL of them and
  // needs every one proven -- which is why the order of these two tests is the
  // safety property and not a preference.
  const anyViolated = members.some((m) => m.status === MEMBER_STATUS.VIOLATED);
  const anyWithheld = members.some((m) => m.status === MEMBER_STATUS.WITHHELD);
  let status = AGREEMENT_STATUS.SATISFIED;
  let reason = AGREEMENT_REASON.OK;
  if (anyViolated) {
    status = AGREEMENT_STATUS.VIOLATED;
    reason = AGREEMENT_REASON.MEMBER_VIOLATES_ISO_4_9_2;
  } else if (anyWithheld) {
    status = AGREEMENT_STATUS.WITHHELD;
    reason = AGREEMENT_REASON.MEMBER_WITHHELD;
  }

  return createAgreement({
    status,
    reason,
    local,
    target,
    members: Object.freeze(members),
    findings: Object.freeze(findings),
    targetOnlyMemberCount: targetOnly,
  });
}

/** The `NOT_ATTEMPTED` record, for a caller whose C outcome proved no target. */
function notAttempted(localDeclaration) {
  const isExtern = !!localDeclaration && typeof localDeclaration === 'object'
    && localDeclaration.type === NODE.EXTERNPROTO;
  return createAgreement({
    status: AGREEMENT_STATUS.NOT_ATTEMPTED,
    reason: AGREEMENT_REASON.NO_PROVEN_TARGET,
    local: isExtern ? createSide({
      declaration: localDeclaration,
      name: localDeclaration.name == null ? null : localDeclaration.name,
      range: localDeclaration.range || null,
      provable: false,
      provableReason: null,
    }) : null,
  });
}

module.exports = {
  compareInterfaceAgreement,
  notAttempted,
  AGREEMENT_STATUS,
  MEMBER_STATUS,
  AGREEMENT_FINDING,
  AGREEMENT_BASIS,
  AGREEMENT_REASON,
};
