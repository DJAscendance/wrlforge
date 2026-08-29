'use strict';
// VRML97 parser facade (Phase 7A). One import surface for consumers:
//
//   const { parse } = require('./src/vrml');
//   const result = parse(text, { profile: 'world' });
//   // result: { tree, tokens, comments, diagnostics, defs, routes, uses,
//   //           assetRefs, truncated, depthCapped, limits, profile }
//
// Pure: text in, tree + diagnostics + index out. Gzip is handled OUTSIDE the
// parser (the main process decompresses to plain UTF-8 first; see
// src/preview/wrl-source.js). `profile` is carried through for later Mall vs.
// World rule layering but does NOT change syntax parsing in 7A -- the tree is
// profile-neutral by design.

const { tokenize, TT, KEYWORDS } = require('./tokenizer');
const { parse: parseSyntax, DEFAULT_LIMITS } = require('./parser');
const { analyze } = require('./analyze');
const assetRefs = require('./asset-refs');
const ast = require('./ast');
const diagnostics = require('./diagnostics');
// Read-only offset -> token/node lookup over a parse result. Opt-in and lazy:
// `parse()` does NOT build one, so nothing existing pays for it.
const { createSourceMap } = require('./source-map');
// Span-patch algebra (WD1.2): pure text-in/text-out edits anchored to the exact
// spans the parser and source map report. No callers in production yet.
const edit = require('./edit');
// Generated VRML97/X3D node + field schema (WD1.3). Data only -- committed, so
// no generator or ISO mirror is needed at runtime. See scripts/build-node-schema.js.
const nodeSchema = require('./node-schema');
// Parse sessions + verified document transactions, and the two-tier stable node
// identity built on them (WD1.4). Pure and browser-safe; no callers in
// production yet -- this is the foundation a future scene tree / inspector
// selection model resolves through, not a UI integration.
//
// NARROWED ON PURPOSE. Both modules export more than appears here: internal
// predicates, the receipt's canonical edit view, and the session guards exist for
// node-identity.js's own CommonJS composition and for focused tests. They are not
// consumer-facing, and a facade is the wrong place to publish "you could also
// reach in here". What follows is the whole intended public surface -- consumer
// operations plus the constant tables a caller needs to branch on a `status` or a
// `reason`. Adding to it is a decision, not a convenience.
const documentTransaction = require('./document-transaction');
const nodeIdentity = require('./node-identity');
// The WD1.5 scope graph and the WD1.6-B consumer query over it. `scope-graph.js`
// stays UNPUBLISHED as a module -- its ~60 exports are the internal semantic
// surface, and publishing them would make consumers depend on the substrate
// instead of the consumer layer. `symbols.js` stays unpublished entirely.
const scopeGraph = require('./scope-graph');
const interfaceQuery = require('./interface-query');
// WD1.6-C, the containment query over the same graph. Like `interface-query.js`
// it is a CONSUMER layer, not a new authority: every fact it judges came from
// P1/P2A, WD1.6-B or the WD1.6-A schema.
const containment = require('./containment');
// WD1.6-D, the structured semantic findings model over the same graph. Like the
// two above it is a CONSUMER layer: every fact it reports was decided by
// P1/P2A/P2B/P2C, WD1.6-B or WD1.6-C, and it re-expresses them in one record
// shape without deciding anything itself.
const semanticFindings = require('./semantic-findings');

const publicDocumentTransaction = Object.freeze({
  // Prove that an edit set is exactly what turned one exact text into another.
  verifyTransaction: documentTransaction.verifyTransaction,
  // A consumer holding a receipt across an async boundary can ask whether it is
  // still a receipt at all before offering to re-anchor through it.
  isVerifiedReceipt: documentTransaction.isVerifiedReceipt,
  TX_ERROR: documentTransaction.TX_ERROR,
  TX_STATUS: documentTransaction.TX_STATUS,
  TX_REASON: documentTransaction.TX_REASON,
});

const publicNodeIdentity = Object.freeze({
  // Sessions are created here rather than on the transaction facade because every
  // identity call needs one and nothing else does.
  createParseSession: documentTransaction.createParseSession,
  createCurrentSelection: nodeIdentity.createCurrentSelection,
  resolveCurrentSelection: nodeIdentity.resolveCurrentSelection,
  createTransactionAnchor: nodeIdentity.createTransactionAnchor,
  resolveTransactionAnchor: nodeIdentity.resolveTransactionAnchor,
  createPersistentAnchor: nodeIdentity.createPersistentAnchor,
  resolvePersistentAnchor: nodeIdentity.resolvePersistentAnchor,
  isResolved: nodeIdentity.isResolved,
  isAmbiguous: nodeIdentity.isAmbiguous,
  isRefused: nodeIdentity.isRefused,
  IDENTITY_ERROR: nodeIdentity.IDENTITY_ERROR,
  IDENTITY_STATUS: nodeIdentity.IDENTITY_STATUS,
  ANCHOR_STATUS: nodeIdentity.ANCHOR_STATUS,
  IDENTITY_REASON: nodeIdentity.IDENTITY_REASON,
  ANCHOR_KIND: nodeIdentity.ANCHOR_KIND,
});

/**
 * WD1.6-B -- what interface can be proven for one node occurrence?
 *
 * `buildScopeGraph` is published HERE and only here. A facade-public query that
 * takes a graph must offer a facade-supported way to build one; without it a
 * consumer would be forced to bypass the facade and require `scope-graph.js`
 * directly, which is exactly what this narrowing exists to prevent. The graph
 * itself stays OPAQUE -- it is a frozen handle with no reachable state, and none
 * of the queries over it are published.
 *
 * The constants are the tables a consumer must branch on to read a projection.
 * There is deliberately no `isUnsupported` predicate: `symbols.js` never defined
 * one, and inventing it here would put a semantic predicate in a facade. Compare
 * against `STATUS.UNSUPPORTED`.
 */
const publicInterfaceQuery = Object.freeze({
  buildScopeGraph: scopeGraph.buildScopeGraph,
  effectiveInterfaceOf: interfaceQuery.effectiveInterfaceOf,
  BINDING_FORM: scopeGraph.BINDING_FORM,
  ACCESS: scopeGraph.ACCESS,
  ENDPOINT_ORIGIN: scopeGraph.ENDPOINT_ORIGIN,
  STATUS: scopeGraph.STATUS,
  REASON: scopeGraph.REASON,
  SCOPE_ERROR: scopeGraph.SCOPE_ERROR,
  isResolved: scopeGraph.isResolved,
  isUnresolved: scopeGraph.isUnresolved,
  isAmbiguous: scopeGraph.isAmbiguous,
  isInvalid: scopeGraph.isInvalid,
  isRecovered: scopeGraph.isRecovered,
});

/**
 * WD1.6-C -- may a candidate legally occupy a node-valued field?
 *
 * Narrow ON PURPOSE. The class-derivation helpers, the exclusion-completeness
 * whitelist and the class-complement table are the module's reasoning, not its
 * contract; publishing them would invite a consumer to re-implement the
 * judgement instead of reading the verdict. `CANDIDATE_KIND` IS published
 * because a verdict carries it and a consumer must be able to branch on it.
 *
 * The scope graph is built through `interfaceQuery.buildScopeGraph`, so the whole
 * consumer path is `parse -> interfaceQuery.buildScopeGraph ->
 * containment.childLegality` with no internal import anywhere in it.
 *
 * NO POLICY. `UNSUPPORTED` does not mean "permit" and `UNRESOLVED` does not mean
 * "warn" -- what a UI does with an uncertain verdict is WD2's decision, and
 * encoding it here would make the semantic answer unrecoverable.
 */
const publicContainment = Object.freeze({
  childLegality: containment.childLegality,
  CONTAINMENT_STATUS: containment.CONTAINMENT_STATUS,
  CONTAINMENT_REASON: containment.CONTAINMENT_REASON,
  CANDIDATE_KIND: containment.CANDIDATE_KIND,
});

/**
 * WD1.6-D -- what is semantically wrong with this document, and how sure are we?
 *
 * Narrow ON PURPOSE, and narrower than the two above: ONE query plus the two
 * tables a consumer must branch on. The ISO classification table, the producers
 * and the placement traversal are the module's reasoning, not its contract.
 *
 * `STATUS` and `REASON` are deliberately NOT re-exported here -- a finding's
 * `confidence` and `reason` ARE the scope graph's own values, and publishing a
 * second copy of those tables under this name would invite a consumer to
 * believe they are a different vocabulary. Read them from `interfaceQuery`.
 *
 * NO PRESENTATION. There is no severity, no message, no visibility and no
 * adapter that would produce one -- deciding those is P4's job, and a finding
 * exists so P4 can decide them from facts rather than from a pre-judged label.
 */
const publicSemanticFindings = Object.freeze({
  findingsForDocument: semanticFindings.findingsForDocument,
  FINDING_CODE: semanticFindings.FINDING_CODE,
  ISO_RESULT: semanticFindings.ISO_RESULT,
});

// parse(text, opts) -> full result. opts: { profile, maxDepth, maxNodes }.
function parse(text, opts = {}) {
  const syntax = parseSyntax(text, opts);
  const semantic = analyze(syntax.tree);
  const refs = assetRefs.extractAssetRefs(syntax.tree);
  return {
    profile: opts.profile || 'generic',
    tree: syntax.tree,
    tokens: syntax.tokens,
    comments: syntax.comments,
    diagnostics: syntax.diagnostics.concat(semantic.diagnostics),
    syntaxDiagnostics: syntax.diagnostics,
    semanticDiagnostics: semantic.diagnostics,
    defs: semantic.defs,
    defsByName: semantic.defsByName,
    duplicateDefs: semantic.duplicateDefs,
    uses: semantic.uses,
    routes: semantic.routes,
    assetRefs: refs,
    truncated: syntax.truncated,
    depthCapped: syntax.depthCapped,
    limits: syntax.limits,
  };
}

module.exports = {
  parse,
  tokenize,
  analyze,
  createSourceMap,
  edit,
  nodeSchema,
  documentTransaction: publicDocumentTransaction,
  nodeIdentity: publicNodeIdentity,
  interfaceQuery: publicInterfaceQuery,
  containment: publicContainment,
  semanticFindings: publicSemanticFindings,
  ast,
  diagnostics,
  assetRefs,
  TT,
  KEYWORDS,
  DEFAULT_LIMITS,
};
