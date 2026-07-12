'use strict';
// Read-only asset-reference extraction from the VRML97 AST (Phase 7A).
//
// Purpose: recover the SAME url-bearing references the production World Project
// scanner finds (src/world-project/url-fields.js `extractUrlRefs`), but from the
// parsed tree instead of a lexical regex sweep -- so a url token that appears
// inside a comment or an unrelated string is NOT mistaken for a dependency, and
// each reference is anchored to a real source span.
//
// Parity target: a url-*named* field (`url`, `frontUrl`, ...; the production
// `\w*[Uu]rl` shape) whose value is an SFString or an MFString array. Inline
// Script bodies (`javascript:` / `vrmlscript:` / `ecmascript:`) are recognized and
// classified as inline-script, never as file dependencies -- matching the
// production classifier, which is reused here so the two cannot drift.
//
// Known shared gap (documented, not a bug): EXTERNPROTO URLs have no `url` field
// name, so neither the production regex nor this extractor treats them as url-field
// refs. This helper does NOT replace the production scanner in Phase 7A.

const { NODE, walk } = require('./ast');
const { isRemote, isInlineScript, isLocalFile } = require('../world-project/url-fields');

// Matches the production `\b(\w*[Uu]rl)\b` field shape: word chars then url/Url.
const URL_FIELD_NAME = /^[A-Za-z0-9_]*[Uu]rl$/;

function isUrlFieldName(name) {
  return typeof name === 'string' && URL_FIELD_NAME.test(name);
}

// Collect the trimmed, non-empty string values from a field value (an SFString or
// an MFString `[ ... ]`), in source order -- matching the production extractor's
// per-field quote iteration.
function collectStrings(value) {
  const out = [];
  if (!value) return out;
  if (value.type === NODE.STRING) {
    const v = String(value.value == null ? '' : value.value).trim();
    if (v) out.push({ value: v, range: value.range });
  } else if (value.type === NODE.ARRAY) {
    for (const item of value.items) {
      if (item && item.type === NODE.STRING) {
        const v = String(item.value == null ? '' : item.value).trim();
        if (v) out.push({ value: v, range: item.range });
      }
    }
  }
  return out;
}

function classify(value) {
  if (isInlineScript(value)) return 'inline-script';
  if (isRemote(value)) return 'remote';
  return 'local'; // scheme-less or file: -> local file reference
}

// Extract every url-field reference from the tree, in source order. Each record:
//   { nodeType, field, value, kind, range }
// where kind is 'local' | 'remote' | 'inline-script'. `nodeType` is the enclosing
// node's type (null if unknown).
function extractAssetRefs(tree) {
  const out = [];
  if (!tree) return out;
  walk(tree, (node, parent) => {
    if (node.type === NODE.FIELD && isUrlFieldName(node.name)) {
      const nodeType = parent && parent.type === NODE.NODE ? parent.nodeType : null;
      for (const s of collectStrings(node.value)) {
        out.push({ nodeType, field: node.name, value: s.value, kind: classify(s.value), range: s.range });
      }
    }
  });
  return out;
}

// Just the parity triples (matches production extractUrlRefs' {nodeType, field,
// value} exactly, inline scripts included), for direct comparison in tests.
function extractUrlTriples(tree) {
  return extractAssetRefs(tree).map((r) => ({ nodeType: r.nodeType, field: r.field, value: r.value }));
}

// Convenience split, mirroring the production classifyUrls shape.
function classifyAssetRefs(tree) {
  const refs = extractAssetRefs(tree);
  const local = [];
  const remote = [];
  const inlineScripts = [];
  for (const r of refs) {
    if (r.kind === 'inline-script') inlineScripts.push(r.value);
    else if (r.kind === 'remote') remote.push(r.value);
    else local.push(r.value);
  }
  return { all: refs.map((r) => r.value), local, remote, inlineScripts };
}

module.exports = { extractAssetRefs, extractUrlTriples, classifyAssetRefs, isUrlFieldName, isLocalFile };
