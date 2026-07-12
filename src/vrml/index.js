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
  ast,
  diagnostics,
  assetRefs,
  TT,
  KEYWORDS,
  DEFAULT_LIMITS,
};
