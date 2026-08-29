'use strict';
// WD1.6-B -- the unified effective-interface query.
//
// One question, for a consumer that has to SHOW an interface rather than resolve
// a single reference:
//
//   Given a node occurrence in a parsed document, what is its effective public
//   interface -- every field and event that may be displayed, edited or routed
//   -- whether its type is built-in, `Script`, PROTO or EXTERNPROTO?
//
// THIS MODULE IS NOT A RESOLVER. It owns no lexical rule, no precedence, no
// shadowing decision, no alias construction and no legality verdict. Every
// meaningful answer here is one that `scope-graph.js` produced through the
// SAME `acquireEndpointOn` that shipped `IS` (WD1.5-P2B) and ROUTE (P2C)
// semantics reach. What this module contributes is candidate discovery -- "which
// names should I ask the authority about?" -- and the projection shape.
//
// That boundary is STRUCTURAL, not a promise: `scope-graph.js` keeps its graph
// state in a module-private WeakMap, so nothing here can walk a scope even by
// mistake. If enumeration ever needs to decide which of two declarations wins,
// that decision belongs in `scope-graph.js`, not in this file.
//
// Pure and browser-safe: no fs, no Electron, no renderer dependency.

const scopeGraph = require('./scope-graph');
const nodeSchema = require('./node-schema');

const {
  STATUS, REASON, ENDPOINT_ORIGIN, BINDING_FORM,
  interfaceSourceOf, acquireEndpointFor, writtenNamesFor, membersOf,
} = scopeGraph;

const EMPTY = Object.freeze([]);

/**
 * A genuinely read-only name index.
 *
 * NOT a `Map`. `Object.freeze(new Map())` does not prevent `.set()` or
 * `.delete()`, so publishing a frozen `Map` would be an immutability claim the
 * runtime does not honour. A null-prototype object frozen after population is
 * actually immutable, and having no prototype means an arbitrary VRML97
 * identifier -- `__proto__`, `constructor`, `hasOwnProperty` -- is an ordinary
 * key rather than a collision or an inherited false positive.
 */
function freezeIndex(pairs) {
  const out = Object.create(null);
  for (const [name, value] of pairs) out[name] = value;
  return Object.freeze(out);
}

function createBinding(fields) {
  return Object.freeze({
    /** The name as a consumer would write it, e.g. `set_translation`. */
    writtenName: fields.writtenName,
    /** The access THIS NAME denotes -- an alias differs from its declaration. */
    effectiveAccess: fields.effectiveAccess == null ? null : fields.effectiveAccess,
    viaAlias: !!fields.viaAlias,
    /** From the alias authority, never re-derived from the spelling. */
    form: fields.form == null ? null : fields.form,
    /**
     * The declaration this name denotes, or `null`.
     *
     * NULL WHEN AMBIGUOUS, deliberately. 4.3.5 prohibits the collision that
     * produces two candidates, so neither is "intended" and preferring one
     * would be candidate ranking -- the WD.md §7 failure mode.
     */
    member: fields.member || null,
    status: fields.status,
    reason: fields.reason,
    evidence: Object.freeze(fields.evidence ? fields.evidence.slice() : []),
  });
}

/**
 * Built UNFROZEN and frozen by `sealMember` once its bindings exist.
 *
 * A binding must be able to point at the projected member a consumer actually
 * reads -- the one carrying `type`, `constraints` and `profiles` -- rather than
 * at the raw scope-graph symbol, whose shape is the substrate's (`fieldType`,
 * no constraints) and is not this API's contract. That is a reference cycle, so
 * the member is wired first and sealed after.
 */
function createMember(fields) {
  return ({
    /** The declared name. One declaration appears here ONCE. */
    name: fields.name,
    type: fields.type == null ? null : fields.type,
    /** The access as DECLARED. Per-name access lives on the binding. */
    access: fields.access == null ? null : fields.access,
    declarationOrigin: fields.declarationOrigin,
    /** Source range of the declaration; null for a clause-6 built-in. */
    declRange: fields.declRange || null,
    /**
     * The AST declaration node, or `null` for a clause-6 built-in.
     *
     * Object identity, so a consumer can anchor a selection to the declaration
     * itself rather than to its name. Shared by reference and deliberately not
     * frozen -- it belongs to the parse result, not to this projection.
     */
    declNode: fields.declNode || null,
    /**
     * Schema profile facts, or `null` for a user declaration.
     *
     * `null` is not "illegal" and not "VRML97-only" -- it says the schema has no
     * record because the declaration is the document's own. Asserting a profile
     * verdict for it would be inventing one.
     */
    profiles: fields.profiles || null,
    vrml97Legal: fields.vrml97Legal === undefined ? null : fields.vrml97Legal,
    /** WD1.6-A metadata, passed through verbatim. `null` means none is recorded. */
    constraints: fields.constraints === undefined ? null : fields.constraints,
    sourceOrder: fields.sourceOrder === undefined ? null : fields.sourceOrder,
    bindings: null,
    status: fields.status,
    reason: fields.reason,
  });
}

function sealMember(member, bindings) {
  member.bindings = Object.freeze(bindings.slice());
  return Object.freeze(member);
}

function createInterface(fields) {
  return Object.freeze({
    node: fields.node,
    nodeType: fields.nodeType == null ? null : fields.nodeType,
    /**
     * The PRIMARY source that decides this node's interface -- not a per-member
     * fact. A `Script` that declares anything is `script-interface` even though
     * it also yields clause-6 members; read `member.declarationOrigin` for where
     * an individual declaration actually came from.
     */
    sourceOrigin: fields.sourceOrigin == null ? null : fields.sourceOrigin,
    /**
     * Is what was returned TRUSTWORTHY? A property of the SOURCE.
     *
     * One ambiguous alias does NOT make the interface ambiguous: if the node
     * type and its interface are fully known, the interface is `resolved` and
     * every other member stays usable.
     */
    status: fields.status,
    reason: fields.reason,
    /**
     * Is what was returned ALL OF IT? Emphatically not "is every binding usable".
     *
     * `false` for EXTERNPROTO even when the status is `resolved`: 4.9.2 makes
     * every declared member authoritative while its silence is unknowable, so an
     * absent name in `byName` is NOT proof that the name does not exist.
     */
    complete: !!fields.complete,
    members: Object.freeze(fields.members.slice()),
    /** Written name -> binding. Frozen null-prototype object; never a `Map`. */
    byName: fields.byName,
    detail: fields.detail || null,
    evidence: Object.freeze(fields.evidence ? fields.evidence.slice() : []),
  });
}

/**
 * The clause-6 fields of a node type, in ISO declaration order.
 *
 * Gated on `vrml97Declaration` truthiness -- the SAME gate `builtinEndpoint`
 * applies -- rather than on the profile list, so enumeration cannot offer a
 * candidate that lookup would refuse. The 232 X3D-only fields are excluded here
 * and by that gate alike.
 */
function builtinCandidates(nodeType) {
  const node = nodeSchema.getNodeSchema(nodeType);
  if (!node) return [];
  const out = [];
  for (const name of Object.keys(node.fields)) {
    const record = node.fields[name];
    if (!record.vrml97Declaration) continue;
    out.push({ name, access: record.vrml97Declaration, record });
  }
  out.sort((a, b) => {
    const ao = a.record.order;
    const bo = b.record.order;
    if (ao !== bo) return (ao == null ? Infinity : ao) - (bo == null ? Infinity : bo);
    return a.name < b.name ? -1 : 1;
  });
  return out;
}

/**
 * Did this written name bind back to the schema field that offered it?
 *
 * Asked of the ACQUISITION, not of the projected binding: the projection
 * deliberately publishes only the declaring `member`, which is `null` for a
 * clause-6 field because such a field is declared nowhere in the document.
 * Identity is therefore established by origin plus declaration name -- the two
 * facts the authority itself returned.
 */
function bindsBackToSchemaField(acquired, candidate) {
  const ep = acquired.endpoint;
  return !!ep
    && ep.origin === ENDPOINT_ORIGIN.BUILTIN_SCHEMA
    && ep.effectiveName === candidate.name;
}

function memberStatusOf(bindings) {
  if (bindings.every((b) => b.status === STATUS.RESOLVED)) {
    return { status: STATUS.RESOLVED, reason: REASON.OK };
  }
  const ambiguous = bindings.find((b) => b.status === STATUS.AMBIGUOUS);
  if (ambiguous) return { status: ambiguous.status, reason: ambiguous.reason };
  const first = bindings.find((b) => b.status !== STATUS.RESOLVED);
  return { status: first.status, reason: first.reason };
}

/**
 * The effective public interface of one node occurrence.
 *
 * @param {object} graph A scope graph from `buildScopeGraph`.
 * @param {object} astNode A `Node` occurrence from that graph's parse.
 * @returns {object|null} A frozen projection, or `null` when `astNode` is not a
 *   node occurrence at all.
 * @throws {Error} `ESCOPEGRAPH` for a foreign graph, `ESCOPEPARSE` for a node
 *   from another parse. A cross-document mixup is a programming error and fails
 *   loudly; it never degrades into `unresolved` (WD1.4).
 */
function effectiveInterfaceOf(graph, astNode) {
  const source = interfaceSourceOf(graph, astNode);
  if (!source) return null;

  const base = {
    node: astNode,
    nodeType: source.nodeType,
    sourceOrigin: source.origin,
    status: source.status,
    reason: source.reason,
    complete: source.complete,
  };

  // A source that could not be proven withholds EVERY lexical answer, the
  // positive ones included: recovery moves scope boundaries, so a damaged
  // interface can manufacture a member as easily as it can lose one.
  //
  // The status reported is P2A's OWN type verdict where the failure was a type
  // failure, so a consumer can tell `ambiguous` (two declarations of this type)
  // from `unresolved` (no such type). Endpoint acquisition still collapses both
  // to `unresolved`; that is its contract and it is untouched.
  if (source.status !== STATUS.RESOLVED) {
    return createInterface({
      ...base,
      status: source.typeStatus,
      reason: source.typeReason,
      complete: false,
      members: EMPTY,
      byName: freezeIndex([]),
    });
  }

  // --- candidate discovery: which names to ask the authority about ----------
  //
  // Semantically dumb ON PURPOSE. Declared members come from `membersOf`, which
  // is the authority for what one interface scope declares; a `Script` ALSO
  // offers its clause-6 fields, unconditionally and with no shadowing test --
  // which of the two wins for a given name is the authority's answer below, not
  // a rule applied here.
  const declaredScope = source.origin === ENDPOINT_ORIGIN.SCRIPT_INTERFACE
    ? source.scriptScope
    : source.ifaceScope;
  const declared = declaredScope ? membersOf(graph, declaredScope) : EMPTY;
  const schema = source.origin === ENDPOINT_ORIGIN.BUILTIN_SCHEMA
    || source.origin === ENDPOINT_ORIGIN.SCRIPT_INTERFACE
    ? builtinCandidates(source.nodeType)
    : [];

  const members = [];
  const index = [];
  const seenName = new Set();

  // Returns BOTH halves: the published binding, and the raw acquisition the
  // shadowing test needs. The acquisition never leaves this function.
  //
  // `boundTo` is the projected member this name is allowed to point at, and it
  // is used ONLY when the authority actually returned that declaration. A name
  // that resolved elsewhere -- or resolved to nothing -- carries `member: null`
  // rather than a plausible guess.
  const bindName = (entry, shell, boundBack) => {
    const acquired = acquireEndpointFor(graph, astNode, entry.writtenName);
    const binding = createBinding({
      writtenName: entry.writtenName,
      effectiveAccess: entry.effectiveAccess,
      viaAlias: entry.viaAlias,
      form: entry.form,
      member: boundBack(acquired) ? shell : null,
      status: acquired.status,
      reason: acquired.reason,
      evidence: acquired.evidence,
    });
    return { binding, acquired };
  };

  const publish = (bindings) => {
    for (const binding of bindings) {
      if (seenName.has(binding.writtenName)) continue;
      seenName.add(binding.writtenName);
      index.push([binding.writtenName, binding]);
    }
  };

  for (const member of declared) {
    const shell = createMember({
      name: member.name,
      type: member.fieldType,
      access: member.access,
      declarationOrigin: source.origin === ENDPOINT_ORIGIN.SCRIPT_INTERFACE
        ? ENDPOINT_ORIGIN.SCRIPT_INTERFACE
        : source.origin,
      declRange: member.declRange,
      declNode: member.node,
      sourceOrder: member.sourceOrder,
      status: STATUS.RESOLVED,
      reason: REASON.OK,
    });
    // Identity against the DECLARATION SYMBOL the authority returned -- not the
    // name it was asked about. A duplicate makes every candidate ambiguous, so
    // this can only be true when exactly one declaration owns the name.
    const bindings = writtenNamesFor(member)
      .map((entry) => bindName(entry, shell,
        (acq) => !!acq.endpoint && acq.endpoint.member === member).binding);
    if (!bindings.length) continue;
    const { status, reason } = memberStatusOf(bindings);
    shell.status = status;
    shell.reason = reason;
    members.push(sealMember(shell, bindings));
    publish(bindings);
  }

  for (const candidate of schema) {
    // SHADOWING FALLS OUT, it is not decided here. Each written name is kept
    // only if the authority actually returned THIS field for it; a name a
    // `Script` declaration has taken over belongs to that declaration and is
    // published under it instead.
    //
    // Shadowing is PER NAME, not per declaration, and that is not a subtlety
    // this module gets to smooth over: `Script { field MFString url }` occupies
    // `url` only, so `set_url` and `url_changed` still reach the clause-6
    // `exposedField url`. Both declarations are genuinely reachable, under
    // different names, and the projection says so rather than picking one.
    const shell = createMember({
      name: candidate.name,
      type: candidate.record.type,
      access: candidate.access,
      declarationOrigin: ENDPOINT_ORIGIN.BUILTIN_SCHEMA,
      declRange: null,
      profiles: candidate.record.profiles,
      vrml97Legal: nodeSchema.isFieldAllowed(source.nodeType, candidate.name, 'vrml97'),
      // WD1.6-A, verbatim. Never clamped, validated, normalized or interpreted:
      // `null` means no machine-represented constraint is recorded, which
      // PERMITS rather than restricts.
      constraints: candidate.record.constraints || null,
      sourceOrder: candidate.record.order,
      status: STATUS.RESOLVED,
      reason: REASON.OK,
    });
    const bound = writtenNamesFor(candidate)
      .map((entry) => bindName(entry, shell,
        (acq) => bindsBackToSchemaField(acq, candidate)))
      .filter((b) => bindsBackToSchemaField(b.acquired, candidate));
    if (!bound.length) continue;
    const bindings = bound.map((b) => b.binding);
    const { status, reason } = memberStatusOf(bindings);
    shell.status = status;
    shell.reason = reason;
    members.push(sealMember(shell, bindings));
    publish(bindings);
  }

  return createInterface({
    ...base,
    members,
    byName: freezeIndex(index),
  });
}

module.exports = {
  effectiveInterfaceOf,
  BINDING_FORM,
};
