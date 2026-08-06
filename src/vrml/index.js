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
  ast,
  diagnostics,
  assetRefs,
  TT,
  KEYWORDS,
  DEFAULT_LIMITS,
};
