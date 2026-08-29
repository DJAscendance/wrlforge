'use strict';
// WD1.7-B2 -- World Project EXTERNPROTO dependency discovery.
//
// THE DEFECT THIS CLOSES (WD1.7-A §19, `F3-WORLD-PROJECT-SCANNER-EXTERNPROTO-
// OMISSION`). World Project dependency discovery is anchored on url-*named*
// fields (`src/world-project/url-fields.js`'s `/\b(\w*[Uu]rl)\b/`). An
// EXTERNPROTO's URL list has no field name at all -- the grammar is
// `EXTERNPROTO nodeTypeId [ externInterfaceDeclarations ] URLList` (ISO A.2) --
// so every external prototype library a world depends on was invisible to the
// asset graph, and `package-plan.js` could therefore report `ready` for a bundle
// that omits all of them.
//
// WHAT THIS MODULE IS -- and the two things it deliberately is not:
//
//   1. It is a CONSUMER of the WD1.7-B retrieval substrate, not a second
//      resolver. Classification, URL/archive routing, exact-case lookup,
//      symlink containment, gzip-by-magic decoding and every resource bound
//      belong to `src/external-proto/`, are reached only through its public
//      facade, and are not re-implemented, wrapped or second-guessed here.
//      There is exactly one filesystem authority for an EXTERNPROTO candidate:
//      `retrieveExternalCandidate`.
//
//   2. It is a CONSUMER of the existing VRML97 parser, not a second syntax
//      authority. Declarations come from the AST (`src/vrml/parser` +
//      `src/vrml/ast`), never from a regex over source text. Extending
//      `url-fields.js`'s field-name regex into an `EXTERNPROTO\s+...` matcher is
//      exactly the wrong fix: it would make a second grammar, and a second
//      grammar drifts.
//
// AND IT STOPS AT BYTES. `RETRIEVED` means "one candidate artifact was
// deterministically obtained and decoded". It does NOT mean the EXTERNPROTO
// resolved: whether the artifact contains the named PROTO, whether a
// fragment-less reference selects the right one, and whether the target is even
// interpretable are ISO 4.9.3 target-selection questions owned by WD1.7-C. No
// status, field or helper here may be read as answering them.
//
// ISO 4.5.3 / N12 IS A HARD GATE, NOT A NICETY. For an EXTERNPROTO written
// inside a PROTO definition the base document is "the file in which that
// prototype is INSTANTIATED", which a per-document scan cannot know. Such a
// declaration is reported `context-required` and NO retrieval is attempted --
// resolving it against the declaring file would be a confident wrong answer, the
// one failure mode WD.md §7 forbids outright. Measured prevalence in the
// Cybertown corpus: 1 of 1,667 declarations (0.06%) over 8,246 unique decoded
// documents -- rare, real, and clean (zero parser diagnostics), so the gate is
// load-bearing rather than hypothetical.

const path = require('path');

const { parse: parseSyntax } = require('../vrml/parser');
const { NODE, walk } = require('../vrml/ast');
const {
  createResolverContext,
  retrieveExternalCandidate,
  RETRIEVAL_STATUS,
} = require('../external-proto');

// The id given to the single archive-local source a World Project maps to. A
// World Project folder owns NO URL namespace -- it is a directory, not a host --
// so the source carries no `prefix`. That is what makes an absolute-http or a
// URL-root-relative candidate fail closed with NOT_RETRIEVED_BY_POLICY instead
// of being host-stripped into a search of the project tree (WD1.7-A §15.1).
const PROJECT_SOURCE_ID = 'world-project';

// Which document the candidate URLs are resolved against (ISO 4.5.3 / N12).
const EXTERNPROTO_BASE = Object.freeze({
  // N12 case (3): the statement is not part of a prototype definition, so the
  // base is the file the statement was read from. Retrieval runs.
  DECLARING_DOCUMENT: 'declaring-document',
  // N12 case (1): the statement IS part of a prototype definition, so the base
  // is the instantiating file. Not knowable here. Retrieval is WITHHELD.
  CONTEXT_REQUIRED: 'context-required',
  // The declaring document is not inside the project root, so no
  // project-relative base can be formed at all. Retrieval is WITHHELD.
  UNAVAILABLE: 'unavailable',
});

// The group-level summary of ONE EXTERNPROTO declaration -- always about
// retrieval, never about resolution.
const EXTERNPROTO_GROUP_STATUS = Object.freeze({
  // At least one written candidate was retrieved from the project. Whether it
  // contains the target PROTO is WD1.7-C's question and is NOT claimed here.
  RETRIEVABLE: 'retrievable',
  // Nothing retrieved, and at least one candidate is PROVABLY absent.
  MISSING: 'missing',
  // Nothing retrieved, nothing provably absent, and at least one candidate was
  // refused by policy (absolute http, URL-root-relative with no namespace, or a
  // path that leaves the project root). Not reproducible in a portable bundle.
  NOT_PORTABLE: 'not-portable',
  // A candidate could not be read, decoded, or bounded, or two sources
  // disagreed. Nothing was established either way.
  INDETERMINATE: 'indeterminate',
  // Every candidate is a conforming form this substrate cannot retrieve at all
  // (`urn:`, `file:`, an unknown scheme). NOT a missing file and NOT invalid
  // VRML -- a `urn:inet:blaxxun.com:node:HUD` names a built-in.
  UNSUPPORTED: 'unsupported',
  // ISO 4.5.3 / N12: the base is the instantiating file. Withheld, not guessed.
  CONTEXT_REQUIRED: 'context-required',
  // Parser recovery moved or damaged the declaration, so its URL list is not
  // provable. Withheld: recovery may continue analysis but may not manufacture
  // certainty.
  UNPROVABLE: 'unprovable',
  // The declaration is intact and its URL list is provably empty.
  NO_CANDIDATES: 'no-candidates',
});

// Group statuses that mean "this bundle could not be reproduced portably".
const BLOCKING_GROUP_STATUSES = Object.freeze([
  EXTERNPROTO_GROUP_STATUS.MISSING,
  EXTERNPROTO_GROUP_STATUS.NOT_PORTABLE,
  EXTERNPROTO_GROUP_STATUS.INDETERMINATE,
]);

// Group statuses that are honest uncertainty: surfaced for review, never
// presented as a proven failure.
const REVIEW_GROUP_STATUSES = Object.freeze([
  EXTERNPROTO_GROUP_STATUS.UNSUPPORTED,
  EXTERNPROTO_GROUP_STATUS.CONTEXT_REQUIRED,
  EXTERNPROTO_GROUP_STATUS.UNPROVABLE,
  EXTERNPROTO_GROUP_STATUS.NO_CANDIDATES,
]);

// Retrieval statuses that establish nothing -- an I/O failure, a decode failure,
// a bound, or two sources disagreeing.
const INDETERMINATE_STATUSES = new Set([
  RETRIEVAL_STATUS.UNREADABLE_ARTIFACT,
  RETRIEVAL_STATUS.DECODE_FAILED,
  RETRIEVAL_STATUS.LIMIT_EXCEEDED,
  RETRIEVAL_STATUS.AMBIGUOUS_SOURCE,
]);

// --- discovery (PURE: AST in, declaration groups out; no fs, no retrieval) ---

// Do the two spans overlap at all? Used to decide whether a parser ERROR
// diagnostic damaged a particular declaration.
function rangesOverlap(a, b) {
  if (!a || !b || !a.start || !a.end || !b.start || !b.end) return false;
  return a.start.offset < b.end.offset && b.start.offset < a.end.offset;
}

// The written candidates of one EXTERNPROTO URL list, in SOURCE ORDER.
//
// Order is normative -- ISO 4.5.2 makes an MFString URL list "decreasing order
// of preference" -- so it is preserved and indexed rather than sorted or
// de-duplicated. `url` is an SFString when the brackets were omitted (A.2
// allows both) and an ARRAY otherwise; both shapes are read, neither is
// rewritten.
function writtenCandidatesOf(urlValue) {
  const out = [];
  const push = (node) => {
    if (!node || node.type !== NODE.STRING) return;
    out.push({
      index: out.length,
      writtenUrl: typeof node.value === 'string' ? node.value : '',
      range: node.range || null,
    });
  };
  if (!urlValue) return out;
  if (urlValue.type === NODE.STRING) push(urlValue);
  else if (urlValue.type === NODE.ARRAY) for (const item of urlValue.items || []) push(item);
  return out;
}

// discoverExternProtoGroups(text) -> { groups, parseError }
//
// One group per EXTERNPROTO declaration in the document, in source order.
// PURE -- text in, records out. It never touches a filesystem, so no extension
// of it can become an ambient path lookup.
//
// The walk is a FULL tree walk, not a scan of `tree.statements`: the corpus
// nests EXTERNPROTO inside PROTO bodies (legal, ISO 4.8.4) and inside MFNode
// arrays (non-conforming, accepted by this parser's recovery). A top-level-only
// scan would under-count, and an under-count that looks like a clean number is
// the worst kind.
function discoverExternProtoGroups(text) {
  let parsed;
  try {
    parsed = parseSyntax(String(text == null ? '' : text));
  } catch (err) {
    // The document could not be parsed at all, so whether it declares an
    // EXTERNPROTO is UNKNOWN. Reported, never silently read as "none".
    return { groups: [], parseError: String((err && err.message) || err) };
  }

  // `walk` passes only the immediate parent, but N12 asks about ANY enclosing
  // PROTO, so the parent chain is recorded on the same single pass and climbed
  // afterwards. Reusing the shared walker keeps traversal semantics identical to
  // every other AST consumer rather than forking a second traversal.
  const parentOf = new Map();
  const declarations = [];
  walk(parsed.tree, (node, parent) => {
    parentOf.set(node, parent);
    if (node.type === NODE.EXTERNPROTO) declarations.push(node);
  });

  const errors = (parsed.diagnostics || []).filter((d) => d && d.severity === 'error');

  const groups = declarations.map((decl, declarationIndex) => {
    let enclosingProto = null;
    for (let cur = parentOf.get(decl); cur; cur = parentOf.get(cur)) {
      if (cur.type === NODE.PROTO) { enclosingProto = cur; break; }
    }
    // A declaration is UNPROVABLE when parser recovery touched it: recovery
    // moves statement boundaries, so an unclosed bracket can absorb following
    // statements and manufacture a URL list the author never wrote. A missing
    // `url` value is the same problem seen from the other side.
    const damaged = errors.some((d) => rangesOverlap(decl.range, d.range));
    const candidates = writtenCandidatesOf(decl.url);
    return {
      declarationIndex,
      name: typeof decl.name === 'string' ? decl.name : null,
      enclosingProto: enclosingProto && typeof enclosingProto.name === 'string' ? enclosingProto.name : null,
      nestedInProto: !!enclosingProto,
      urlWritten: decl.url != null,
      damaged: damaged || decl.url == null,
      candidates,
      range: decl.range || null,
    };
  });

  return { groups, parseError: null };
}

// --- retrieval (the B substrate; this module supplies only explicit state) ---

// The ResolverContext for one World Project. Built from the project root the
// project ALREADY knows -- never from `process.cwd()`, a repository root, a home
// directory, or a nearest-match search. A World Project has no origin, so the
// single source carries no prefix and owns no URL namespace.
function createProjectResolverContext(projectRoot, limits) {
  return createResolverContext({
    sources: [{ id: PROJECT_SOURCE_ID, root: path.resolve(projectRoot) }],
    ...(limits ? { limits } : {}),
  });
}

// The base document as a source-root-relative POSIX path, or null when the
// declaring file is not inside the project root at all (in which case no base
// exists and retrieval must be withheld rather than approximated).
function projectRelativeBase(projectRoot, referrerAbs) {
  const rel = path.relative(path.resolve(projectRoot), path.resolve(referrerAbs));
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

// Fold every candidate outcome into one group status.
//
// PRECEDENCE, and each step is a decision rather than an ordering convenience:
//   RETRIEVABLE    a retrieved candidate is the strongest fact available, and
//                  ISO 4.5.2's ordered fallback means a LATER candidate
//                  succeeding is a satisfied group even when an earlier one is
//                  absent. (What it does NOT mean is "resolved".)
//   INDETERMINATE  outranks MISSING: if one candidate could not be read at all,
//                  "missing" is a stronger claim than the evidence supports.
//   MISSING        a provable absence outranks a policy refusal, because it
//                  names a concrete, fixable file.
//   NOT_PORTABLE   nothing was explored, but nothing can be bundled either.
//   UNSUPPORTED    every candidate is a conforming form we cannot fetch.
function foldGroupStatus(results) {
  if (!results.length) return EXTERNPROTO_GROUP_STATUS.NO_CANDIDATES;
  const has = (s) => results.some((r) => r.status === s);
  if (has(RETRIEVAL_STATUS.RETRIEVED)) return EXTERNPROTO_GROUP_STATUS.RETRIEVABLE;
  if (results.some((r) => INDETERMINATE_STATUSES.has(r.status))) return EXTERNPROTO_GROUP_STATUS.INDETERMINATE;
  if (has(RETRIEVAL_STATUS.NOT_FOUND)) return EXTERNPROTO_GROUP_STATUS.MISSING;
  if (has(RETRIEVAL_STATUS.NOT_RETRIEVED_BY_POLICY)) return EXTERNPROTO_GROUP_STATUS.NOT_PORTABLE;
  return EXTERNPROTO_GROUP_STATUS.UNSUPPORTED;
}

// resolveExternProtoGroups({ groups, projectRoot, referrerAbs, context }, deps)
//
// Attaches a retrieval outcome to every written candidate of every group, and a
// folded status to the group. `deps` is B's injectable fs surface
// (readdirSync/realpathSync/statSync/readFileSync) and is passed straight
// through -- this module performs NO filesystem access of its own.
//
// EVERY candidate is evaluated, and every outcome is kept. WD1.7-A §15.3: the
// fallback walk stops only on `RESOLVED`, which this lane cannot produce, so
// there is no winner to pick and the record is a list.
function resolveExternProtoGroups(params, deps = {}) {
  const { groups, projectRoot, referrerAbs, context } = params;
  const basePath = projectRelativeBase(projectRoot, referrerAbs);

  return groups.map((group) => {
    const base = group.nestedInProto
      ? EXTERNPROTO_BASE.CONTEXT_REQUIRED
      : basePath === null
        ? EXTERNPROTO_BASE.UNAVAILABLE
        : EXTERNPROTO_BASE.DECLARING_DOCUMENT;

    // Withheld, in three independent ways and for three different reasons. None
    // of them may fall through to "resolve against the declaring file anyway".
    if (group.damaged) {
      return finishGroup(group, base, [], EXTERNPROTO_GROUP_STATUS.UNPROVABLE);
    }
    if (base !== EXTERNPROTO_BASE.DECLARING_DOCUMENT) {
      return finishGroup(group, base, group.candidates.map((c) => ({
        ...c, status: null, reason: null, form: null, locator: null, fragment: null, artifactPath: null,
      })), base === EXTERNPROTO_BASE.CONTEXT_REQUIRED
        ? EXTERNPROTO_GROUP_STATUS.CONTEXT_REQUIRED
        : EXTERNPROTO_GROUP_STATUS.UNPROVABLE);
    }

    const baseDocument = { sourceId: PROJECT_SOURCE_ID, path: basePath };
    const results = group.candidates.map((c) => {
      const r = retrieveExternalCandidate({
        context,
        baseDocument,
        writtenUrl: c.writtenUrl,
        candidateIndex: c.index,
      }, deps);
      return {
        index: c.index,
        writtenUrl: c.writtenUrl,
        range: c.range,
        status: r.status,
        reason: r.reason,
        form: r.reference.form,
        locator: r.reference.locator,
        // Carried verbatim as provenance. It is NEVER appended to a filename and
        // NEVER checked against a PROTO name -- that is WD1.7-C's (ISO 4.9.3).
        fragment: r.reference.fragment,
        // Source-root-relative POSIX path of the artifact whose bytes were
        // obtained, or null. For a World Project the source root IS the project
        // root, so this is directly the project-relative path.
        artifactPath: r.artifact ? r.artifact.artifactPath : null,
      };
    });
    return finishGroup(group, base, results, foldGroupStatus(results));
  });
}

function finishGroup(group, base, candidates, status) {
  return {
    declarationIndex: group.declarationIndex,
    name: group.name,
    base,
    enclosingProto: group.enclosingProto,
    nestedInProto: group.nestedInProto,
    status,
    candidates,
    range: group.range,
  };
}

// scanExternProtoDependencies({ text, referrerAbs, projectRoot, context }, deps)
//
// The one call the asset graph makes per walked `.wrl`: discover, then resolve.
function scanExternProtoDependencies(params, deps = {}) {
  const { text, referrerAbs, projectRoot, context } = params;
  const { groups, parseError } = discoverExternProtoGroups(text);
  if (parseError) return { groups: [], parseError };
  if (!groups.length) return { groups: [], parseError: null };
  return {
    groups: resolveExternProtoGroups({ groups, projectRoot, referrerAbs, context }, deps),
    parseError: null,
  };
}

module.exports = {
  PROJECT_SOURCE_ID,
  EXTERNPROTO_BASE,
  EXTERNPROTO_GROUP_STATUS,
  BLOCKING_GROUP_STATUSES,
  REVIEW_GROUP_STATUSES,
  discoverExternProtoGroups,
  createProjectResolverContext,
  resolveExternProtoGroups,
  scanExternProtoDependencies,
  projectRelativeBase,
};
