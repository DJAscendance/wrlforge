'use strict';
// ---------------------------------------------------------------------------
// WD1.7-E1 -- earned compatibility profiles.
// ---------------------------------------------------------------------------
//
// The lane that fills the third axis `semantic-findings.js` reserved and
// WD1.6-D deliberately left `null`. It answers ONE question, for one construct
// at a time:
//
//   Is there evidence that a NAMED implementation accepts or defines this?
//
// and it answers it from a closed, citable registry -- never from prevalence,
// authorship, file path or plausibility.
//
// ---------------------------------------------------------------------------
// THE THREE AXES, STILL SEPARATE
// ---------------------------------------------------------------------------
//
//   iso            -- what ISO/IEC 14772-1 says.            (semantic-findings)
//   confidence     -- how sure the substrate is it read it right. (the substrate)
//   compatibility  -- what a NAMED runtime is evidenced to accept.     (HERE)
//
// A runtime accepting a violation does not make the content conforming. This
// module is a SIBLING PROJECTION: it adds a record beside the strict facts and
// is structurally unable to alter them, because it never constructs a finding.
// `semantic-findings.attachCompatibility` re-emits the caller's own strict
// fields verbatim through the one constructor, and this module supplies only
// the opaque slot value.
//
// ---------------------------------------------------------------------------
// WHAT `null` MEANS -- unchanged from WD1.6-D
// ---------------------------------------------------------------------------
//
// `null` means NOT EVALUATED. It does NOT mean "strict VRML97", "no runtime
// accepts this", "incompatible", or "unknown browser". Most findings are `null`
// and will stay `null`: a profile membership is EARNED by a citable artifact,
// and absence of a citation is the falsifier, not a gap to fill by inference.
//
// There is deliberately NO BOOLEAN. `compatible: true` cannot express "ISO
// forbids it and this runtime took it anyway", which is the state that matters
// most -- the same argument `AGREEMENT_STATUS` already makes for WD1.7-D.
//
// ---------------------------------------------------------------------------
// PROFILE MEMBERSHIP IS NOT FINDING COVERAGE
// ---------------------------------------------------------------------------
//
// The registry documents five vendor behaviours. WRL Forge currently emits an
// exactly-corresponding structured observation for ONE of them. The other four
// stay REGISTRY-ONLY: the evidence is recorded and auditable, and no finding is
// invented to display it. Minting a finding so that a documented behaviour
// becomes visible would be manufacturing the observation the evidence is
// supposed to explain -- see `BEHAVIOR_BY_FINDING`.
//
// ---------------------------------------------------------------------------
// NO PRESENTATION, NO DETECTION, NO RESEARCH ACCESS
// ---------------------------------------------------------------------------
//
// No severity, message, colour, ordering, suppression or save policy: P4 owns
// presentation, and `TOLERATED_VIOLATION` is emphatically not "downgrade the
// error to a warning". No runtime detection either -- nothing here reads a
// browser name, a user agent or a platform; the profile describes documented
// evidence about an implementation, not the implementation the user is running.
//
// And no filesystem. The evidence artifacts are reference material that lives
// outside this repository and outside the shipped product; what is recorded
// here are the INDEPENDENT FACTS established from them plus reference-root
// relative identifiers so a reviewer can re-open the same artifact. Production
// classification works with zero access to that tree, which is why this module
// stays pure and browser-safe like the rest of `src/vrml/`.

const semanticFindings = require('./semantic-findings');
const { REASON } = require('./scope-graph');

const { FINDING_CODE } = semanticFindings;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * The public profile registry. EARNED NAMES ONLY.
 *
 * One member. `blaxxun-3d` is real, independently evidenced and behaves in the
 * OPPOSITE direction on the very constructs at issue (it supports no PROTO,
 * EXTERNPROTO or Script at all), but no WRL Forge query consumes it, so it is
 * not a member -- a deferred profile is not an enum entry because a document
 * mentions it. The bare vendor name is not a member either: it is ambiguous
 * across two implementations with opposite posture, which makes it concretely
 * wrong rather than merely vague. `GLView` is a `Browser.getName()` identity
 * string, not a documented resolution behaviour, and is retired as a profile
 * name. A site is not a runtime, so no site name appears here.
 */
const COMPATIBILITY_PROFILE = Object.freeze({
  /** blaxxun Contact 3D, the 4.x-5.x ActiveX VRML client. */
  BLAXXUN_CONTACT: 'blaxxun-contact',
});

/**
 * The two kinds of compatibility claim, kept apart because a remediation
 * decision turns on exactly this distinction and one bucket destroys it.
 */
const COMPATIBILITY_CLASSIFICATION = Object.freeze({
  /**
   * ISO is SILENT and the vendor defined something in the space it left open.
   * "Portable only on this runtime" -- an intentional capability, not a defect.
   */
  EXTRA_STANDARD: 'extra-standard',
  /**
   * ISO FORBIDS it and the named runtime accepted it anyway. "A defect one
   * runtime forgave" -- the strict finding underneath is unchanged and stays
   * exactly as non-conforming as it was.
   */
  TOLERATED_VIOLATION: 'tolerated-violation',
});

/**
 * How strong the evidence for ONE BEHAVIOUR CLAIM is.
 *
 * The tier is a property of a claim, never of a source: a document is tier A
 * for a rule it states and NO evidence at all for a rule it does not mention.
 * And prevalence never promotes a tier -- a construct observed 46,945 times is
 * `CORPUS_OBSERVED` at 46,945 exactly as surely as it is at 1.
 *
 * Only `VENDOR_DOCUMENTED` may support a named claim on its own. `CORPUS_OBSERVED`
 * and `INFERRED` may never appear on an emitted record at all; they are named
 * here so that a future contributor has to say out loud which one they have.
 */
const EVIDENCE_TIER = Object.freeze({
  VENDOR_DOCUMENTED: 'a',
  HISTORICAL_OPERATIONAL: 'b',
  CORPUS_OBSERVED: 'c',
  INFERRED: 'd',
});

/** The sub-tiers inside A, which are not equally strong. `null` outside A. */
const EVIDENCE_SUBTIER = Object.freeze({
  /** The vendor states the behaviour in shipped documentation. */
  DOCUMENTED: 'a1',
  /** Vendor-authored sample or capability content exercises it. */
  VENDOR_AUTHORED_CONTENT: 'a2',
  /** Reproduced in the named runtime and recorded. Not yet performed. */
  EXECUTED: 'a3',
});

/** What kind of artifact an evidence entry points at. */
const EVIDENCE_KIND = Object.freeze({
  /** Documentation the vendor shipped with the product. */
  VENDOR_DOCUMENTATION: 'vendor-documentation',
  /** Content the vendor authored to demonstrate the product. */
  VENDOR_AUTHORED_CONTENT: 'vendor-authored-content',
  /** A recorded observation of the named runtime executing. */
  RUNTIME_OBSERVATION: 'runtime-observation',
});

/**
 * Stable identifiers for the documented behaviours. These are WRL Forge's own
 * names for the claims, not the vendor's -- the vendor documentation defines no
 * stable ids, so a positional label would be a citation of something that does
 * not exist. Values are stable; adding is allowed, changing is not.
 */
const VENDOR_BEHAVIOR = Object.freeze({
  /**
   * For a built-in reached through the vendor's URN node mechanism, the native
   * node's own interface is used and the locally declared EXTERNPROTO interface
   * is not consulted.
   */
  URN_NATIVE_NODE_INTERFACE_OVERRIDE: 'urn-native-node-interface-override',
  /**
   * ROUTE, PROTO and EXTERNPROTO statements are accepted wherever a node value
   * is expected -- including inside an MFNode array, which Annex A.2 does not
   * admit.
   */
  NODE_VALUE_POSITION_STATEMENTS: 'node-value-position-statements',
  /** An `exposedField` is accepted in a Script node's interface (6.40 forbids). */
  SCRIPT_INTERFACE_EXPOSED_FIELD: 'script-interface-exposed-field',
  /** A registry of native extension node types reachable through the URN mechanism. */
  URN_NATIVE_EXTENSION_NODES: 'urn-native-extension-nodes',
  /**
   * `Browser.createVrmlFromString` resolves PROTO declarations made in the
   * top-level file, which the standard does not provide for.
   */
  CREATE_VRML_FROM_STRING_TOP_LEVEL_PROTOS: 'create-vrml-from-string-top-level-protos',
});

// ---------------------------------------------------------------------------
// The evidence
// ---------------------------------------------------------------------------

/**
 * The reference root an evidence `path` is relative to.
 *
 * A KEY, NOT A LOCATION. It names the workspace research tree recorded in
 * `OPEN_SOURCE_PROVENANCE.md` §4.1 so a reviewer with the same material can
 * re-open the same artifact, and it is deliberately not a host-absolute path:
 * nothing here is read, and an end user is not expected to hold the tree.
 */
const REFERENCE_ROOT = 'blaxxun-cs-RE';

/**
 * One citable artifact behind one claim.
 *
 * `claim` is WRL Forge's own PARAPHRASE of the documented rule, never the
 * vendor's sentence: this repository is public and the source is proprietary
 * documentation, so the record carries the fact and the pointer rather than the
 * prose. The paraphrase is what makes the claim auditable; the path is what
 * makes it falsifiable.
 */
function evidence(fields) {
  return Object.freeze({
    vendor: fields.vendor,
    /** The product the claim is about -- NOT every product the vendor shipped. */
    product: fields.product,
    /** The shipped generation the artifact was published with. */
    generation: fields.generation,
    kind: fields.kind,
    subtier: fields.subtier,
    /** Reference-root key. Never a host-absolute path. */
    root: REFERENCE_ROOT,
    /** Path within that root. */
    path: fields.path,
    /** WRL Forge's paraphrase of what the artifact states. */
    claim: fields.claim,
  });
}

const BLAXXUN = 'blaxxun interactive';
const CONTACT = 'blaxxun Contact 3D';
const VWP_51 = 'Virtual Worlds Platform 5.1';
const CS_70 = 'Community Server 7.0';

const DOC_51_AUTHORING = 'install/blaxxun interactive/Virtual Worlds Platform/csadmin/doc/reference/3dauthoring9.html';
const DOC_70_EXTENSIONS = 'install-7.0/csadmin/doc/3dauthoring/3dextensions2.html';
const DOC_70_SCRIPTING = 'install-7.0/csadmin/doc/3dauthoring/3dscripting7.html';

const doc = (generation, path, claim) => evidence({
  vendor: BLAXXUN,
  product: CONTACT,
  generation,
  kind: EVIDENCE_KIND.VENDOR_DOCUMENTATION,
  subtier: EVIDENCE_SUBTIER.DOCUMENTED,
  path,
  claim,
});

/**
 * The native extension node type names the vendor's URN registry documents.
 *
 * NAMES ONLY, and they prove exactly one thing: that this mechanism reaches
 * these types. They are NOT a licence to treat a bare unknown node spelling as
 * an extension -- the documented capability is the URN registry, and a document
 * that writes one of these names directly has not used it. Nothing in this
 * module consults this list to classify a node, and that is deliberate.
 */
const URN_EXTENSION_NODE_TYPES = Object.freeze([
  'Background2D', 'Bitmap', 'BspGroup', 'BspTree', 'Camera', 'Cell', 'CellGroup',
  'CompositeTexture3D', 'CoordinateInterpolator2D', 'CullGroup', 'Curve2D',
  'ImageTexture', 'Inclusion', 'Inline', 'Inline2', 'KeySensor', 'Layer2D',
  'Layer3D', 'MenuSensor', 'MouseSensor', 'MovieTexture2', 'NodeType',
  'NurbsSurface', 'Occlusion', 'Selection',
]);

function behaviorRecord(fields) {
  return Object.freeze({
    behavior: fields.behavior,
    profile: fields.profile,
    classification: fields.classification,
    tier: fields.tier,
    subtier: fields.subtier,
    evidence: Object.freeze(fields.evidence.slice()),
    /** Extra factual detail this behaviour carries, or `null`. Never prose. */
    detail: fields.detail || null,
  });
}

const A1 = {
  tier: EVIDENCE_TIER.VENDOR_DOCUMENTED,
  subtier: EVIDENCE_SUBTIER.DOCUMENTED,
  profile: COMPATIBILITY_PROFILE.BLAXXUN_CONTACT,
};

/**
 * The closed behaviour registry for `blaxxun-contact`.
 *
 * INCLUSION RULE, stated so it can be tested: a behaviour enters this table if
 * and only if a citable normative statement in the named shipped documentation
 * set describes the runtime accepting or defining it. Prevalence, authorship
 * and plausibility grant no membership, and the ABSENCE of such a statement is
 * the falsifier.
 *
 * Every entry is `a1`. NONE is `a3` -- nothing here has been reproduced by
 * executing the product, and the vendor's own authoring guide hedges its
 * extension-node support in writing, which is exactly why documented must not
 * be presented as executed.
 */
const BEHAVIOR_EVIDENCE = Object.freeze(Object.assign(Object.create(null), {
  [VENDOR_BEHAVIOR.URN_NATIVE_NODE_INTERFACE_OVERRIDE]: behaviorRecord({
    ...A1,
    behavior: VENDOR_BEHAVIOR.URN_NATIVE_NODE_INTERFACE_OVERRIDE,
    // 4.9.1 expressly permits an implementation-dependent mechanism for locating
    // an external prototype, so the standard is SILENT here rather than
    // contradicted, and 4.9.2's subset rule is simply never consulted.
    classification: COMPATIBILITY_CLASSIFICATION.EXTRA_STANDARD,
    evidence: [
      doc(CS_70, DOC_70_EXTENSIONS,
        'a built-in node reached through the vendor URN scheme is instantiated with the native node interface; the interface written in the EXTERNPROTO declaration is not the one used'),
      doc(VWP_51, DOC_51_AUTHORING,
        'a built-in node reached through the vendor URN scheme is instantiated with the native node interface; the interface written in the EXTERNPROTO declaration is not the one used'),
    ],
  }),

  [VENDOR_BEHAVIOR.NODE_VALUE_POSITION_STATEMENTS]: behaviorRecord({
    ...A1,
    behavior: VENDOR_BEHAVIOR.NODE_VALUE_POSITION_STATEMENTS,
    classification: COMPATIBILITY_CLASSIFICATION.TOLERATED_VIOLATION,
    evidence: [
      doc(CS_70, DOC_70_EXTENSIONS,
        'the client parses PROTO, EXTERNPROTO and ROUTE statements in every position where a node value may appear'),
      doc(VWP_51, DOC_51_AUTHORING,
        'the client parses PROTO, EXTERNPROTO and ROUTE statements in every position where a node value may appear'),
    ],
  }),

  [VENDOR_BEHAVIOR.SCRIPT_INTERFACE_EXPOSED_FIELD]: behaviorRecord({
    ...A1,
    behavior: VENDOR_BEHAVIOR.SCRIPT_INTERFACE_EXPOSED_FIELD,
    classification: COMPATIBILITY_CLASSIFICATION.TOLERATED_VIOLATION,
    evidence: [
      doc(CS_70, DOC_70_SCRIPTING,
        'exposedField declarations are permitted in a Script node interface; the same page warns that content relying on it is not portable to other VRML browsers'),
    ],
  }),

  [VENDOR_BEHAVIOR.URN_NATIVE_EXTENSION_NODES]: behaviorRecord({
    ...A1,
    behavior: VENDOR_BEHAVIOR.URN_NATIVE_EXTENSION_NODES,
    classification: COMPATIBILITY_CLASSIFICATION.EXTRA_STANDARD,
    detail: Object.freeze({ nodeTypes: URN_EXTENSION_NODE_TYPES }),
    evidence: [
      doc(CS_70, DOC_70_EXTENSIONS,
        'the documentation enumerates the native extension node types addressable through the vendor URN scheme'),
      doc(VWP_51, DOC_51_AUTHORING,
        'the documentation enumerates the native extension node types addressable through the vendor URN scheme'),
    ],
  }),

  [VENDOR_BEHAVIOR.CREATE_VRML_FROM_STRING_TOP_LEVEL_PROTOS]: behaviorRecord({
    ...A1,
    behavior: VENDOR_BEHAVIOR.CREATE_VRML_FROM_STRING_TOP_LEVEL_PROTOS,
    classification: COMPATIBILITY_CLASSIFICATION.TOLERATED_VIOLATION,
    evidence: [
      doc(CS_70, DOC_70_SCRIPTING,
        'the browser createVrmlFromString call resolves PROTO declarations from the top-level file, which the documentation itself marks as non-standard'),
    ],
  }),
}));

/**
 * The five questions every public profile must answer. This one can, which is
 * what "earned" means.
 */
const PROFILE_CONTRACT = Object.freeze(Object.assign(Object.create(null), {
  [COMPATIBILITY_PROFILE.BLAXXUN_CONTACT]: Object.freeze({
    profile: COMPATIBILITY_PROFILE.BLAXXUN_CONTACT,
    vendor: BLAXXUN,
    product: CONTACT,
    /**
     * The family the documentation set covers. It does NOT cover the vendor's
     * Java applet client, which supports no PROTO, EXTERNPROTO or Script at all,
     * and it does NOT cover the successor product shipped under different
     * ownership after this generation.
     */
    versionFamily: '4.x-5.x',
    definedBy: Object.freeze([
      Object.freeze({ generation: VWP_51, root: REFERENCE_ROOT, path: DOC_51_AUTHORING }),
      Object.freeze({ generation: CS_70, root: REFERENCE_ROOT, path: DOC_70_EXTENSIONS }),
      Object.freeze({ generation: CS_70, root: REFERENCE_ROOT, path: DOC_70_SCRIPTING }),
    ]),
    behaviors: Object.freeze(Object.keys(BEHAVIOR_EVIDENCE)),
    /** What would remove a behaviour from the profile. */
    falsifiedBy: 'absence of a statement in the named documentation set, or a recorded execution result that contradicts one',
  }),
}));

// ---------------------------------------------------------------------------
// Which findings this evidence actually explains
// ---------------------------------------------------------------------------

/**
 * NUL-separated, for the reason WD1.4's scope keys are: a separator that can
 * occur inside either component is not a separator. Both halves must match --
 * the code says WHICH question was asked and the reason says what the answer
 * was, and a profile that keyed on only one of them would classify a different
 * question that happens to share an answer.
 */
const key = (code, reason) => `${code}\u0000${reason}`;

/**
 * finding -> behaviour. ONE ENTRY, and the short list is the finding.
 *
 * A behaviour appears here only when WRL Forge ALREADY emits a structured
 * observation that represents it EXACTLY. Four of the five documented
 * behaviours have no such observation and are deliberately absent:
 *
 *   * the URN interface override and the extension-node registry both concern
 *     a reference form the retrieval substrate classifies as not retrievable,
 *     so target selection never selects one and interface agreement never
 *     produces a record for one. The one documented rule that speaks directly
 *     to external prototype interfaces applies exactly and only where there is
 *     no finding to attach it to.
 *   * statements in node-value position are accepted by the parser SILENTLY --
 *     the array reader delegates to the ordinary handlers and emits no
 *     diagnostic and no finding at all. There is nothing to classify, and
 *     minting a finding for it would change what WD1.6-D reports on every
 *     document in the corpus, uncorroborated by this lane's measurements.
 *     That is its own lane, with its own corpus evidence.
 *   * the browser string-parsing call is a runtime API behaviour with no
 *     static-source counterpart; WRL Forge models no browser API.
 *
 * Those four stay REGISTRY-ONLY. The evidence is recorded, auditable and
 * queryable, and no observation is manufactured to display it.
 */
const BEHAVIOR_BY_FINDING = Object.freeze(Object.assign(Object.create(null), {
  [key(FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING,
    REASON.EXPOSED_FIELD_IN_SCRIPT_INTERFACE)]:
    VENDOR_BEHAVIOR.SCRIPT_INTERFACE_EXPOSED_FIELD,
}));

/**
 * Load-time invariant: nothing weaker than vendor documentation may sit in the
 * registry.
 *
 * Deliberately a THROW rather than a test. "This construct appears a lot in the
 * corpus, so the vendor must have accepted it" is the single most likely way
 * this module goes wrong over time, and a table that cannot be LOADED with a
 * `CORPUS_OBSERVED` or `INFERRED` entry cannot ship one.
 */
for (const behavior of Object.keys(BEHAVIOR_EVIDENCE)) {
  const record = BEHAVIOR_EVIDENCE[behavior];
  if (record.tier !== EVIDENCE_TIER.VENDOR_DOCUMENTED) {
    throw new Error(`compatibility: ${behavior} is not supported by vendor-documented evidence`);
  }
  if (!record.evidence.length) {
    throw new Error(`compatibility: ${behavior} carries no evidence`);
  }
  if (!PROFILE_CONTRACT[record.profile]) {
    throw new Error(`compatibility: ${behavior} names an unregistered profile`);
  }
}

// ---------------------------------------------------------------------------
// The queries
// ---------------------------------------------------------------------------

/**
 * The earned compatibility record for one finding, or `null`.
 *
 * PURE, TOTAL AND SIDE-EFFECT FREE. `null` is the answer for everything the
 * registry does not explain exactly, which is almost everything -- including
 * every WD1.7-D interface-agreement finding against an ordinary file target.
 * No documentation addresses those, and corpus prevalence is not evidence.
 *
 * The returned record is the registry's own frozen record, shared by identity.
 * It carries no severity, no message and no recommendation.
 *
 * @param {object} finding A finding from `semantic-findings.findingsForDocument`.
 * @returns {object|null} The frozen evidence record, or `null` for NOT EVALUATED.
 */
function compatibilityFor(finding) {
  if (!finding || typeof finding.code !== 'string' || typeof finding.reason !== 'string') {
    return null;
  }
  const behavior = BEHAVIOR_BY_FINDING[key(finding.code, finding.reason)];
  return behavior ? BEHAVIOR_EVIDENCE[behavior] : null;
}

/**
 * The same finding with its reserved slot filled where the evidence earns it.
 *
 * Returns the INPUT UNCHANGED when nothing is earned, so the default stays
 * exactly the `null` WD1.6-D shipped. When something is earned the strict
 * fields are re-emitted VERBATIM through `semantic-findings`' one constructor;
 * this module never sets `iso`, `rule`, `confidence`, `reason` or any other
 * strict field, and has no parameter through which a caller could.
 *
 * @param {object} finding A finding from `semantic-findings.findingsForDocument`.
 * @returns {object} A finding whose strict facts are identical.
 */
function withCompatibility(finding) {
  return semanticFindings.attachCompatibility(finding, compatibilityFor(finding));
}

/** The contract for one earned profile, or `null`. */
function profileContract(profile) {
  return PROFILE_CONTRACT[profile] || null;
}

/** The evidence record for one documented behaviour, or `null`. */
function behaviorEvidence(behavior) {
  return BEHAVIOR_EVIDENCE[behavior] || null;
}

/** Every earned profile identifier. One, today. */
function profiles() {
  return Object.freeze(Object.keys(PROFILE_CONTRACT));
}

/**
 * The behaviours a current structured observation maps to, as against those
 * that are documented but have nothing to classify. Published so the split is
 * auditable from the API rather than only from a document.
 */
function mappedBehaviors() {
  const seen = new Set(Object.keys(BEHAVIOR_BY_FINDING).map((k) => BEHAVIOR_BY_FINDING[k]));
  return Object.freeze([...seen].sort());
}

/** Documented behaviours with no current WRL Forge observation to attach to. */
function registryOnlyBehaviors() {
  const mapped = new Set(mappedBehaviors());
  return Object.freeze(Object.keys(BEHAVIOR_EVIDENCE).filter((b) => !mapped.has(b)).sort());
}

module.exports = {
  COMPATIBILITY_PROFILE,
  COMPATIBILITY_CLASSIFICATION,
  EVIDENCE_TIER,
  EVIDENCE_SUBTIER,
  EVIDENCE_KIND,
  VENDOR_BEHAVIOR,
  REFERENCE_ROOT,
  URN_EXTENSION_NODE_TYPES,
  compatibilityFor,
  withCompatibility,
  profileContract,
  behaviorEvidence,
  profiles,
  mappedBehaviors,
  registryOnlyBehaviors,
  // Internal, for this lane's own tests. NOT published on `src/vrml/index.js`.
  BEHAVIOR_EVIDENCE,
  BEHAVIOR_BY_FINDING,
  PROFILE_CONTRACT,
};
