'use strict';
// WD1.7-C, pure half -- ISO 4.9.3 prototype TARGET SELECTION, and the reachable
// prototype-dependency enumeration a traversal needs.
//
// PURE and BROWSER-SAFE, exactly like every other module in this directory: an
// already-parsed document in, a frozen answer out. No `fs`, no `zlib`, no
// `crypto`, no retrieval, no network, no candidate list, no base document and no
// URL. It never learns where the text came from, which is what lets it live
// beside the parser instead of beside the Node-side substrate.
//
// The two questions it answers, and they are deliberately separate:
//
//   1. selectPrototypeTarget(parseResult, { fragment })
//        Given ONE decoded VRML document and the written `#fragment` (or its
//        absence), which PROTO declaration does ISO 4.9.3 select?
//
//   2. prototypeDependencies(graph, root)
//        Given a scope graph and a realized implementation, which node-type
//        occurrences bind to which PROTO / EXTERNPROTO declarations?
//
// WHAT IT IS NOT. It is not a resolver: it never walks a candidate list, never
// decides a base document, never retrieves anything and never recurses into
// another document. Those are `src/proto-resolution/`'s, which is Node-side
// because retrieval is. Splitting them here is what keeps 4.9.3 -- a statement
// about a *document* -- out of a filesystem module.
//
// THE STATUS VOCABULARY IS WD1.7's, NOT WD1.5's. `RESOLVED` here is spelled in
// upper case and means "a unique target PROTO was selected under a named rule";
// `scope-graph.js`'s lowercase `resolved` means "this name denotes exactly one
// declaration". They are different questions over different things, so they get
// visibly different spellings rather than one table doing double duty.
//
// THE HARD GATE (WD.md §7, inherited unchanged): a selection may be lost, and a
// selection may be unprovable. It may NEVER confidently name a different PROTO.
// Parser recovery MOVES statement boundaries, so every claim below sits behind a
// proof that recovery did not manufacture it.

const { NODE, walk } = require('./ast');
const { SEVERITY } = require('./diagnostics');
const scopeGraph = require('./scope-graph');

// Which ISO 4.9.3 sentence produced the answer. Two rules with two different
// failure modes, so the record always says which one ran (WD1.7-A §9).
const SELECTION_RULE = Object.freeze({
  /** N10 -- "browsers shall recognise a URL ending #name". */
  FRAGMENT: 'fragment',
  /** N8 -- "the first PROTO statement found in the VRML file (excluding EXTERNPROTOs)". */
  FIRST_EXCLUDING_EXTERNPROTO: 'first-excluding-externproto',
});

// Selection statuses. The WD1.7-A §10 RESOLUTION set, minus the two that are not
// properties of a single document: `DEPENDENCY_CYCLE` belongs to traversal and
// `NOT_ATTEMPTED` belongs to a candidate walk. There is deliberately no generic
// `ERROR` (WD1.7-A §10) and no `RECOVERED` -- a damaged target is reported as
// `TARGET_PARSE_FAILED` with a reason that says which proof failed, because
// reusing WD1.5's `recovered` here would make a consumer's confidence check mean
// two different things.
const SELECTION_STATUS = Object.freeze({
  RESOLVED: 'RESOLVED',
  TARGET_PARSE_FAILED: 'TARGET_PARSE_FAILED',
  TARGET_PROTO_NOT_FOUND: 'TARGET_PROTO_NOT_FOUND',
  TARGET_PROTO_AMBIGUOUS: 'TARGET_PROTO_AMBIGUOUS',
});

const SELECTION_REASON = Object.freeze({
  OK: 'ok',
  // --- the document could not be trusted enough to select from ---------------
  /** No parse tree at all. */
  PARSE_TREE_ABSENT: 'parse-tree-absent',
  /** A parser safety limit fired, so the statement list is a prefix of the file. */
  PARSE_LIMITS_EXCEEDED: 'parse-limits-exceeded',
  /**
   * No `#VRML` header. ISO 4.9.3/N9 makes the result UNDEFINED for a non-VRML
   * target, and a headerless artifact is the strongest locally provable
   * statement of that. Reported as its own reason rather than folded into the
   * damage scan, which would only say "something is wrong near offset 0".
   */
  NO_VRML_HEADER: 'no-vrml-header',
  /**
   * Fragment-less: an ERROR diagnostic lies at or before the end of the
   * candidate first declaration, so "this is the FIRST top-level PROTO" is not
   * provable -- recovery may have absorbed an earlier one into a preceding
   * statement, or promoted a nested one.
   */
  SELECTION_PREFIX_UNPROVABLE: 'selection-prefix-unprovable',
  /**
   * Fragment, or a fragment-less claim of absence: an ERROR diagnostic anywhere
   * in the document, so the top-level statement sequence cannot be enumerated
   * completely. A duplicate declaration hidden by recovery would silently turn
   * an AMBIGUOUS answer into a confident one.
   */
  TOP_LEVEL_ENUMERATION_UNPROVABLE: 'top-level-enumeration-unprovable',
  // --- the document was trustworthy and the answer is a real absence ---------
  /** N8: the file declares no top-level PROTO at all (EXTERNPROTOs excluded). */
  NO_TOP_LEVEL_PROTO: 'no-top-level-proto',
  /** N10: no top-level PROTO carries the written name. Case-sensitive. */
  FRAGMENT_NAMES_NO_TOP_LEVEL_PROTO: 'fragment-names-no-top-level-proto',
  /**
   * A written `#` with nothing after it. It names no PROTO, and it is NOT
   * silently re-read as a fragment-less reference: switching selection rules on
   * the author's behalf is exactly the "confident different answer" the hard
   * gate forbids. A property of the reference, so it needs no document proof.
   */
  EMPTY_FRAGMENT: 'empty-fragment',
  /** N10: two or more top-level PROTOs carry the written name. */
  DUPLICATE_TOP_LEVEL_PROTO_NAME: 'duplicate-top-level-proto-name',
});

/** How a node-type occurrence inside a realized implementation binds. */
const DEPENDENCY_KIND = Object.freeze({
  /** Binds to an EXTERNPROTO declaration -- an external dependency edge. */
  EXTERNPROTO: 'externproto',
  /** Binds to a local PROTO declaration -- traversed through, never an edge. */
  PROTO: 'proto',
  /** Binds to a built-in node type. Not a dependency. */
  BUILTIN: 'builtin',
  /**
   * The type resolver declined to bind it: unknown vendor type, duplicate
   * declaration, recovery, forward reference. Reported, never guessed at.
   */
  WITHHELD: 'withheld',
});

/**
 * A SEMANTIC COVERAGE GAP -- a syntactic region this module REACHED that the
 * type authority it consumes does not index at all.
 *
 * It is not a diagnostic, not a finding and not an error in the document. It is
 * a statement about the LIMIT OF THE ANSWER, and it exists for exactly one
 * purpose: so a consumer can decline to claim exhaustiveness instead of
 * silently claiming it. A dependency enumeration that quietly omits a region it
 * cannot see is indistinguishable from one that saw the region and found
 * nothing, and only one of those two is true.
 */
const COVERAGE_GAP = Object.freeze({
  /**
   * WD1.5-P2A deliberately does not descend into a PROTO's interface DEFAULT
   * VALUES (`scope-graph.js`, "KNOWN, DELIBERATE LIMITS OF P1", limit 1), so a
   * node occurrence written only there mints no type reference and can bind to
   * nothing. Resolving it privately is precisely the second type authority this
   * lane exists to refuse, so the REGION is reported instead of the binding.
   */
  UNINDEXED_INTERFACE_DEFAULT: 'unindexed-interface-default',
});

function fail(msg) { throw new TypeError(`proto target: ${msg}`); }

// The minimum a selection needs from a parse result. Deliberately its own guard
// rather than `scope-graph.js`'s: selection uses no graph, so requiring one
// would couple two independent questions.
function assertParse(parseResult) {
  if (parseResult === null || typeof parseResult !== 'object' || Array.isArray(parseResult)) {
    fail("parseResult must be the object returned by require('src/vrml').parse()");
  }
  if (!Array.isArray(parseResult.syntaxDiagnostics)) {
    fail('parseResult.syntaxDiagnostics must be an array; recovery cannot be proven without it');
  }
  if (typeof parseResult.truncated !== 'boolean' || typeof parseResult.depthCapped !== 'boolean') {
    fail('parseResult.truncated and parseResult.depthCapped must be booleans');
  }
  const tree = parseResult.tree;
  if (tree != null && (typeof tree !== 'object' || tree.type !== NODE.DOCUMENT)) {
    fail(`parseResult.tree must be a ${NODE.DOCUMENT} node or null`);
  }
}

const errorsOf = (parseResult) =>
  parseResult.syntaxDiagnostics.filter((d) => d && d.severity === SEVERITY.ERROR);

const startOffsetOf = (range) => (range && range.start ? range.start.offset : null);
const endOffsetOf = (range) => (range && range.end ? range.end.offset : null);

function rangesOverlap(a, b) {
  if (!a || !b || !a.start || !a.end || !b.start || !b.end) return false;
  return a.start.offset < b.end.offset && b.start.offset < a.end.offset;
}

function selection(fields) {
  return Object.freeze({
    status: fields.status,
    reason: fields.reason,
    /** The rule that ran, even on failure -- the two fail differently. */
    rule: fields.rule,
    /** The written fragment, verbatim, or `null`. Never re-spelled. */
    fragment: fields.fragment === undefined ? null : fields.fragment,
    /** The selected PROTO's declared name. `null` unless RESOLVED. */
    selectedProtoName: fields.selectedProtoName || null,
    /**
     * The selected `Proto` AST node. PARSE-LIFETIME ONLY, derived and
     * disposable: it belongs to the caller's parse of the target text and is
     * NOT a persistent identity, not a document handle and not written
     * anywhere (WD.md §2/§7). It exists so WD1.7-D can read the interface C
     * already proved instead of selecting the target a second time.
     */
    declaration: fields.declaration || null,
    /** The selected declaration's whole span, or `null`. */
    declarationRange: fields.declarationRange || null,
    /** The selected declared name's own span, or `null`. */
    nameRange: fields.nameRange || null,
    /**
     * Every top-level declaration the answer weighed, source-ordered: the
     * ambiguity evidence on TARGET_PROTO_AMBIGUOUS, and the single winner on
     * RESOLVED. Names and spans only.
     */
    matches: Object.freeze((fields.matches || []).map((m) => Object.freeze({ name: m.name, range: m.range }))),
    /**
     * How many top-level PROTO statements were enumerated. `null` when the
     * enumeration itself was not provable -- 0 would assert an absence.
     */
    topLevelProtoCount: fields.topLevelProtoCount === undefined ? null : fields.topLevelProtoCount,
  });
}

/**
 * ISO 4.9.3 -- which PROTO does this target document supply?
 *
 * TOP-LEVEL MEANS A DIRECT MEMBER OF THE DOCUMENT'S STATEMENT LIST, and that is
 * a structural fact read off the AST, never a scope fact. A `PROTO` written
 * inside a node body is in the document's *type* scope but is not a top-level
 * statement, so it is not selectable; a `PROTO` inside another `PROTO` is
 * neither. Using the scope graph here would select the first of those.
 *
 * EXTERNPROTOs are excluded by construction: the filter keeps `Proto` nodes, and
 * an `ExternProto` is a different AST type. That is N8's parenthesis, and it is
 * not decoration -- `bxx/shared.wrl`, the most-referenced library in the
 * Cybertown corpus, opens with `EXTERNPROTO HUD` and only then declares
 * `PROTO BlaxxunZone`. Including EXTERNPROTOs would bind every fragment-less
 * reference to `HUD`.
 *
 * @param {object} parseResult From `require('src/vrml').parse(targetText)`.
 * @param {{fragment?: string|null}} [options] The written `#fragment`, verbatim,
 *   or `null`/absent for a fragment-less reference. Never re-spelled, never
 *   case-folded, never trimmed.
 * @returns {object} A frozen selection record.
 * @throws {TypeError} when `parseResult` is not a parse result.
 */
function selectPrototypeTarget(parseResult, options = {}) {
  assertParse(parseResult);
  if (options === null || typeof options !== 'object') fail('options must be an object');
  const fragment = options.fragment === undefined || options.fragment === null
    ? null
    : String(options.fragment);
  const rule = fragment === null ? SELECTION_RULE.FIRST_EXCLUDING_EXTERNPROTO : SELECTION_RULE.FRAGMENT;
  const base = { rule, fragment };

  // A property of the REFERENCE, provable without the document. Checked first so
  // an unparseable target cannot mask it, and so it is never re-read as N8.
  if (fragment === '') {
    return selection({ ...base, status: SELECTION_STATUS.TARGET_PROTO_NOT_FOUND, reason: SELECTION_REASON.EMPTY_FRAGMENT });
  }

  const tree = parseResult.tree;
  if (!tree) {
    return selection({ ...base, status: SELECTION_STATUS.TARGET_PARSE_FAILED, reason: SELECTION_REASON.PARSE_TREE_ABSENT });
  }
  // A capped parse holds a PREFIX of the file. "First" is still answerable in
  // principle, but "the only one with this name" is not, and one gate for both
  // is the conservative reading.
  if (parseResult.truncated || parseResult.depthCapped) {
    return selection({ ...base, status: SELECTION_STATUS.TARGET_PARSE_FAILED, reason: SELECTION_REASON.PARSE_LIMITS_EXCEEDED });
  }
  if (!tree.header) {
    return selection({ ...base, status: SELECTION_STATUS.TARGET_PARSE_FAILED, reason: SELECTION_REASON.NO_VRML_HEADER });
  }

  const errors = errorsOf(parseResult);
  const topLevel = (tree.statements || []).filter((s) => s && s.type === NODE.PROTO);
  const asMatch = (p) => ({ name: p.name, range: p.range || null });

  if (rule === SELECTION_RULE.FRAGMENT) {
    // THE WHOLE top-level sequence must be enumerable. A duplicate of the written
    // name could sit anywhere, so damage anywhere is relevant -- unlike N8, where
    // damage after a proven first declaration is not.
    if (errors.length > 0) {
      return selection({ ...base, status: SELECTION_STATUS.TARGET_PARSE_FAILED, reason: SELECTION_REASON.TOP_LEVEL_ENUMERATION_UNPROVABLE });
    }
    // Exact, case-sensitive, written-name equality. No trimming, no case folding,
    // no nearest match: every one of those is candidate ranking (WD.md §7).
    const matches = topLevel.filter((p) => p.name === fragment);
    if (matches.length === 0) {
      return selection({ ...base, status: SELECTION_STATUS.TARGET_PROTO_NOT_FOUND, reason: SELECTION_REASON.FRAGMENT_NAMES_NO_TOP_LEVEL_PROTO, topLevelProtoCount: topLevel.length });
    }
    if (matches.length > 1) {
      // NOT "the first one wins". N10 names a PROTO; two of them make the
      // reference unprovable, and every matching declaration is kept as evidence.
      return selection({ ...base, status: SELECTION_STATUS.TARGET_PROTO_AMBIGUOUS, reason: SELECTION_REASON.DUPLICATE_TOP_LEVEL_PROTO_NAME, matches: matches.map(asMatch), topLevelProtoCount: topLevel.length });
    }
    const won = matches[0];
    return selection({ ...base, status: SELECTION_STATUS.RESOLVED, reason: SELECTION_REASON.OK, selectedProtoName: won.name, declaration: won, declarationRange: won.range || null, nameRange: won.nameRange || null, matches: [asMatch(won)], topLevelProtoCount: topLevel.length });
  }

  // --- N8, fragment-less ----------------------------------------------------
  const first = topLevel[0] || null;
  if (!first) {
    // "This file declares no selectable PROTO" is an ASSERTION OF ABSENCE, and a
    // damaged document cannot support one -- recovery can absorb a real top-level
    // PROTO into a preceding unclosed statement and leave the list empty.
    if (errors.length > 0) {
      return selection({ ...base, status: SELECTION_STATUS.TARGET_PARSE_FAILED, reason: SELECTION_REASON.TOP_LEVEL_ENUMERATION_UNPROVABLE });
    }
    return selection({ ...base, status: SELECTION_STATUS.TARGET_PROTO_NOT_FOUND, reason: SELECTION_REASON.NO_TOP_LEVEL_PROTO, topLevelProtoCount: 0 });
  }

  // THE PREFIX RULE, and it is exactly as wide as the claim it protects. The
  // claim is "no top-level PROTO precedes this one", which depends only on the
  // text up to this declaration's END. Damage strictly after that cannot make an
  // earlier declaration appear, so it is not grounds for withholding (WD1.7-C
  // brief §13: do not blindly reject unrelated later damage).
  //
  // It is `<=` on the END offset rather than an overlap test because an
  // unclosed body's error anchors at the construct's START: `PROTO A [] { Group
  // {` reports UNCLOSED_BRACE at `A`'s own keyword, which an overlap test also
  // catches, but a damaged statement BEFORE `A` that recovery swallowed reports
  // earlier still, and only an offset comparison sees both.
  const firstEnd = endOffsetOf(first.range);
  const prefixDamaged = firstEnd === null || errors.some((d) => {
    const s = startOffsetOf(d.range);
    return s === null || s <= firstEnd;
  });
  if (prefixDamaged || first.name == null) {
    return selection({ ...base, status: SELECTION_STATUS.TARGET_PARSE_FAILED, reason: SELECTION_REASON.SELECTION_PREFIX_UNPROVABLE });
  }
  return selection({
    ...base,
    status: SELECTION_STATUS.RESOLVED,
    reason: SELECTION_REASON.OK,
    selectedProtoName: first.name,
    declaration: first,
    declarationRange: first.range || null,
    nameRange: first.nameRange || null,
    matches: [asMatch(first)],
    topLevelProtoCount: topLevel.length,
  });
}

// --- EXTERNPROTO declaration reading (AST authority, no regex) ---------------

/**
 * The written URL candidates of one EXTERNPROTO declaration, IN SOURCE ORDER,
 * plus whether the declaration is provable at all.
 *
 * Order is normative -- ISO 4.5.2/N11 makes an MFString url list "decreasing
 * order of preference" -- so it is preserved and indexed, never sorted or
 * de-duplicated. `url` is an SFString when the brackets were omitted (Annex A.2
 * allows both) and an ARRAY otherwise; both shapes are read and neither is
 * rewritten.
 *
 * `damaged` is the same gate WD1.7-B2 applies for the same reason: recovery
 * moves statement boundaries, so an unclosed bracket can absorb following
 * statements and manufacture a url list the author never wrote.
 *
 * @param {object} parseResult The parse the declaration came from.
 * @param {object} declaration An `ExternProto` AST node from that parse.
 * @returns {object} frozen `{ name, damaged, urlWritten, candidates, range, nameRange }`.
 */
function externProtoCandidates(parseResult, declaration) {
  assertParse(parseResult);
  if (!declaration || typeof declaration !== 'object' || declaration.type !== NODE.EXTERNPROTO) {
    fail(`declaration must be an ${NODE.EXTERNPROTO} AST node`);
  }
  const candidates = [];
  const push = (node) => {
    if (!node || node.type !== NODE.STRING) return;
    candidates.push(Object.freeze({
      index: candidates.length,
      writtenUrl: typeof node.value === 'string' ? node.value : '',
      range: node.range || null,
    }));
  };
  const url = declaration.url;
  if (url && url.type === NODE.STRING) push(url);
  else if (url && url.type === NODE.ARRAY) for (const item of url.items || []) push(item);

  const damaged = url == null
    || errorsOf(parseResult).some((d) => rangesOverlap(declaration.range, d.range));

  return Object.freeze({
    name: typeof declaration.name === 'string' ? declaration.name : null,
    damaged,
    urlWritten: url != null,
    candidates: Object.freeze(candidates),
    range: declaration.range || null,
    nameRange: declaration.nameRange || null,
  });
}

// --- reachable prototype dependencies (WD1.5-P2A is the ONLY authority) ------

function dependency(fields) {
  return Object.freeze({
    kind: fields.kind,
    /** The written node-type name, or `null` when the parse could not prove one. */
    typeName: fields.typeName == null ? null : fields.typeName,
    /** The type token's own span. */
    range: fields.range || null,
    /**
     * The bound `Proto` / `ExternProto` AST node, or `null`. Parse-lifetime
     * only, like every AST handle in this module.
     */
    declaration: fields.declaration || null,
    /**
     * The `Proto` AST node whose DEFINITION lexically contains this declaration,
     * or `null` when it is not inside one.
     *
     * ISO 4.5.3/N12 case (1) turns on exactly this, and the OWNER -- not merely
     * the fact of nesting -- is what a caller needs: the base is "the file in
     * which THAT prototype is instantiated", and which file that is depends on
     * which prototype it is. A boolean would force the caller to guess.
     * Parse-lifetime only, like every AST handle here.
     */
    declaringPrototype: fields.declaringPrototype || null,
    /** The P2A resolution's own status/reason, carried verbatim. */
    resolutionStatus: fields.resolutionStatus,
    resolutionReason: fields.resolutionReason,
    /**
     * `WITHHELD` only, and `false` on every other kind. `true` when P2A's own
     * answer leaves open that a PROTO or EXTERNPROTO declaration of this name
     * EXISTS -- in which case an external dependency edge may be missing from
     * any enumeration built on this result, and a consumer must not claim to
     * have enumerated exhaustively.
     *
     * It is NOT a binding, not a candidate and not a guess at which declaration
     * that would be. See `provesNoDeclaration`.
     */
    declarationMayExist: fields.declarationMayExist === true,
    /** The local PROTO names traversed to reach this occurrence, outermost first. */
    via: Object.freeze((fields.via || []).slice()),
  });
}

// Does P2A's OWN answer already prove that no PROTO/EXTERNPROTO declaration of
// this name is in play?
//
// Exactly one of its withheld answers does. `node-type-unknown` is returned only
// AFTER the whole `typeParent` chain was proven and a whole-scope lookup found
// zero declarations of the name anywhere in it -- so a vendor spelling with no
// declaration hides nothing, and the very common corpus shape of an unrecognised
// node type does not poison an otherwise exhaustive enumeration.
//
// Every OTHER withheld answer is compatible with a declaration existing:
// recovery withholds without looking, a duplicate asserts two of them, a forward
// reference asserts one later in the file, and a missing name token asserts
// nothing at all. Any of those declarations could be an EXTERNPROTO.
//
// This READS P2A's published status and reason. It performs no lookup, consults
// no scope and consults no schema.
function provesNoDeclaration(res) {
  return res.status === scopeGraph.STATUS.UNRESOLVED
    && res.reason === scopeGraph.REASON.NODE_TYPE_UNKNOWN;
}

// One PROTO's interface DEFAULT VALUES, audited for the single question C is
// entitled to ask about them: does a region P2A does not index contain a node
// occurrence at all?
//
// THIS IS NOT TYPE RESOLUTION, and the line is exact. It reads the AST's own
// `Node` discriminator -- a syntactic fact the parser already decided -- and it
// never asks what the written spelling MEANS: not whether it is a built-in, not
// whether a PROTO or an EXTERNPROTO of that name is declared, not which
// declaration would win, not whether one is declared at all. No lookup, no
// scope, no schema, no graph, no candidate list. `writtenTypeName` is carried as
// EVIDENCE so a reader can see which occurrence is unindexed; it is a token, it
// is not a binding, and nothing downstream may treat it as one.
//
// SCOPED TO NODE OCCURRENCES, deliberately. `field SFFloat amount 1` contains no
// node-type reference to lose and raises nothing -- the gate is about semantic
// coverage of node/type occurrences, never about the mere presence of a default.
// A `USE` raises nothing either: it names a DEF, not a type, so no prototype
// dependency can hide behind it.
//
// EXTERNPROTO interfaces cannot reach here at all. Annex A.2 gives them no
// default values and the parser mints none, so this gap is a PROTO-only shape.
function interfaceDefaultCoverageGaps(proto, via) {
  const gaps = [];
  for (const decl of proto.interfaces || []) {
    if (!decl || decl.type !== NODE.INTERFACE || decl.default == null) continue;
    const occurrences = [];
    walk(decl.default, (astNode) => {
      if (astNode.type === NODE.NODE) occurrences.push(astNode);
      return true;
    });
    if (occurrences.length === 0) continue;
    // Source order, for the same reason the dependency walk sorts: `walk`'s key
    // order is deterministic but is a fact about the AST's field layout, not
    // about the document.
    occurrences.sort((x, y) => (startOffsetOf(x.typeRange) || 0) - (startOffsetOf(y.typeRange) || 0));
    const first = occurrences[0];
    gaps.push(Object.freeze({
      gap: COVERAGE_GAP.UNINDEXED_INTERFACE_DEFAULT,
      /** The prototype whose interface holds the unindexed region. */
      prototypeName: proto.name == null ? null : proto.name,
      prototypeRange: proto.range || null,
      /** The interface member, spelled exactly as declared. */
      memberAccess: decl.access == null ? null : decl.access,
      memberFieldType: decl.fieldType == null ? null : decl.fieldType,
      memberName: decl.name == null ? null : decl.name,
      memberRange: decl.range || null,
      /** The default value's whole span -- the region that is not indexed. */
      defaultRange: decl.default.range || null,
      /** How many node occurrences the region holds, nested ones included. */
      occurrenceCount: occurrences.length,
      firstOccurrenceRange: first.typeRange || first.range || null,
      /** The FIRST occurrence's written type token. Evidence, never a binding. */
      writtenTypeName: first.nodeType == null ? null : first.nodeType,
      /** The local PROTO names traversed to reach this prototype. */
      via: Object.freeze(via.slice()),
    }));
  }
  return gaps;
}

/**
 * Which prototype declarations does this realized implementation depend on?
 *
 * NO SECOND TYPE RESOLVER. Every binding below is WD1.5-P2A's answer, read out
 * of the scope graph: no name lookup, no nearest declaration, no first match, no
 * built-in table of its own. When P2A withholds, this withholds -- the record
 * carries P2A's own status and reason so a consumer can see *why* rather than
 * receive a guess.
 *
 * TWO TRAVERSAL RULES, and both are semantic rather than convenient:
 *
 *  1. **Nested PROTO definitions are pruned.** A prototype's implementation is
 *     realized only where the prototype is INSTANTIATED (4.8.3), so descending
 *     into a nested definition would report dependencies of code that may never
 *     run. The instantiation, if there is one, is itself a node-type occurrence
 *     and is found as such -- at which point the definition is expanded through
 *     the `PROTO` branch, once.
 *  2. **A local PROTO is traversed THROUGH, not reported as an edge.** Reaching
 *     an EXTERNPROTO by way of one is normal, and `via` records the path.
 *
 * INHERITED LIMIT, REPORTED RATHER THAN WORKED AROUND: WD1.5 deliberately does
 * not descend into PROTO interface DEFAULT values, so a node written only as an
 * interface default carries no type reference in the graph and cannot appear in
 * `references`. That is a scope-graph boundary, and re-walking those subtrees
 * with a private resolver is precisely the second authority this module refuses
 * to become -- so the REGION is reported in `coverageGaps` instead, for every
 * prototype this walk actually reached. A consumer that needs exhaustiveness
 * must treat a non-empty `coverageGaps` as "this enumeration is not exhaustive",
 * because a dependency may be hiding in a region nothing here can see.
 *
 * The same honesty applies inside `references`: a `WITHHELD` record whose
 * `declarationMayExist` is `true` is an occurrence P2A could not bind and could
 * not prove undeclared, so an EXTERNPROTO edge may be missing there too.
 *
 * @param {object} graph From `require('src/vrml').interfaceQuery.buildScopeGraph()`.
 * @param {object} root The `Document` AST node (whole-scene dependencies) or a
 *   `Proto` AST node (that implementation's dependencies), from the same parse.
 * @returns {object} frozen `{ references, coverageGaps }`, source-ordered within
 *   each expansion. `coverageGaps` covers EXACTLY the prototypes this walk
 *   reached -- the root when it is a `Proto`, plus every local PROTO expanded
 *   through -- so an unreached declaration elsewhere in the document contributes
 *   nothing, exactly as it contributes no dependency.
 * @throws {TypeError} when `root` is not a Document or Proto node.
 */
function prototypeDependencies(graph, root) {
  if (!root || typeof root !== 'object' || (root.type !== NODE.DOCUMENT && root.type !== NODE.PROTO)) {
    fail(`root must be a ${NODE.DOCUMENT} or ${NODE.PROTO} AST node`);
  }
  // Built once per call from the graph's OWN aligned projections. `typeReferences`
  // and `typeResolutions` are index-aligned by construction (P2A), so no lookup
  // heuristic is involved.
  const refs = scopeGraph.typeReferences(graph);
  const resolutions = scopeGraph.typeResolutions(graph);
  const byAstNode = new Map();
  for (let i = 0; i < refs.length; i += 1) byAstNode.set(refs[i].node, resolutions[i]);

  const references = [];
  const coverageGaps = [];
  const expanded = new Set();
  const queue = [{ node: root, via: [] }];

  while (queue.length > 0) {
    const frame = queue.shift();
    // The coverage audit rides the SAME queue as the dependency walk, so its
    // reachability boundary is the walk's own by construction rather than by a
    // second traversal that could drift from it. A prototype nothing instantiates
    // is never dequeued, contributes no dependency, and contributes no gap.
    if (frame.node.type === NODE.PROTO) {
      for (const gap of interfaceDefaultCoverageGaps(frame.node, frame.via)) coverageGaps.push(gap);
    }
    const statements = frame.node.type === NODE.DOCUMENT ? frame.node.statements : frame.node.body;
    const found = [];
    walk(statements || [], (astNode) => {
      // Prune a nested definition; its instantiation, if any, is a type
      // reference elsewhere and reaches us through the PROTO branch below.
      if (astNode.type === NODE.PROTO || astNode.type === NODE.EXTERNPROTO) return false;
      if (astNode.type === NODE.NODE) found.push(astNode);
      return true;
    });
    // Source order, explicitly. `walk`'s key order is deterministic but is an
    // implementation detail of the AST's field layout, not a document fact.
    found.sort((a, b) => (startOffsetOf(a.typeRange) || 0) - (startOffsetOf(b.typeRange) || 0));

    for (const astNode of found) {
      const res = byAstNode.get(astNode);
      if (!res) continue; // no type reference minted for it: nothing to report
      const symbol = res.status === scopeGraph.STATUS.RESOLVED ? res.symbol : null;
      const common = {
        typeName: astNode.nodeType == null ? null : astNode.nodeType,
        range: astNode.typeRange || null,
        resolutionStatus: res.status,
        resolutionReason: res.reason,
        via: frame.via,
      };
      if (!symbol) {
        const bound = res.status === scopeGraph.STATUS.RESOLVED;
        references.push(dependency({
          ...common,
          kind: bound ? DEPENDENCY_KIND.BUILTIN : DEPENDENCY_KIND.WITHHELD,
          declarationMayExist: !bound && !provesNoDeclaration(res),
        }));
        continue;
      }
      // The owning PROTO comes from the declaration's own scope, which P1/P2A
      // already proved -- never from an ancestor walk of the AST.
      const owner = symbol.scope && symbol.scope.kind === scopeGraph.SCOPE_KIND.PROTO_BODY
        ? (symbol.scope.ownerNode || null)
        : null;
      if (symbol.kind === scopeGraph.SYMBOL_KIND.EXTERNPROTO_DECL) {
        references.push(dependency({ ...common, kind: DEPENDENCY_KIND.EXTERNPROTO, declaration: symbol.node, declaringPrototype: owner }));
        continue;
      }
      references.push(dependency({ ...common, kind: DEPENDENCY_KIND.PROTO, declaration: symbol.node, declaringPrototype: owner }));
      // Expand the local implementation ONCE per call. P2A already makes a
      // self-instantiation `invalid` (4.8.4/N14) and a forward one too, so a
      // local cycle is not reachable in a well-formed document -- but recovery
      // can produce shapes the language cannot, and an unbounded walk is not
      // something to leave to an argument.
      if (symbol.node && !expanded.has(symbol.node)) {
        expanded.add(symbol.node);
        queue.push({ node: symbol.node, via: frame.via.concat([symbol.name]) });
      }
    }
  }
  return Object.freeze({
    references: Object.freeze(references),
    coverageGaps: Object.freeze(coverageGaps),
  });
}

module.exports = {
  SELECTION_RULE,
  SELECTION_STATUS,
  SELECTION_REASON,
  DEPENDENCY_KIND,
  COVERAGE_GAP,
  selectPrototypeTarget,
  externProtoCandidates,
  prototypeDependencies,
};
