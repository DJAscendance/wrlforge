'use strict';
// URL-field extraction for the World Project profile (production).
//
// This is the promoted, production home of the Phase 3A recon extractor
// (qa/world-recon/url-fields.js now re-exports from here -- single source of
// truth). It is deliberately broader than src/preview/url-policy.js's
// scanRemoteUrls (a narrow remote-blocking preflight that keeps only the FIRST
// url of an MFString and matches lowercase `url` only). World analysis must
// enumerate EVERY local reference to build a complete asset graph, so it:
//   * captures all entries of an MFString `url [ "a" "b" ... ]` (possibly
//     spanning multiple lines), not just the first,
//   * matches url fields case-insensitively and including the *Url suffix forms
//     seen in real Cybertown worlds (`url`, `Url`, `frontUrl`, `backUrl`, ...),
//   * records the enclosing node type and the exact field name per reference,
//   * classifies each value as local vs remote vs inline-script by URL scheme.
//
// It does NOT interpret the VRML scene graph -- it is a lexical pass over the
// decompressed source, which is all the resolver needs to know what a world
// points at. Pure: no Electron, no fs.

const { schemeOf } = require('../preview/url-policy');

// A url-bearing field followed immediately by either a single quoted string or a
// bracketed MFString. Group 1 is the field name (e.g. `url`, `frontUrl`);
// group 2 is the value part. `[^\]]*` (not `.`) lets the array span newlines.
const URL_FIELD = /\b(\w*[Uu]rl)\b\s*(\[[^\]]*\]|"[^"]*")/g;
const QUOTED = /"([^"]*)"/g;

// The nearest enclosing node type name for a match at `idx` -- the identifier
// immediately before the innermost unclosed `{`. Brace-depth aware so nested
// nodes (e.g. an Appearance holding an ImageTexture) attribute correctly.
// Returns null when no enclosing node is found (bounded backward scan).
function nodeTypeBefore(text, idx) {
  let depth = 0;
  for (let i = idx - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '}') depth += 1;
    else if (c === '{') {
      if (depth === 0) {
        let j = i - 1;
        while (j >= 0 && /\s/.test(text[j])) j -= 1;
        const end = j + 1;
        while (j >= 0 && /[\w]/.test(text[j])) j -= 1;
        const name = text.slice(j + 1, end);
        return name || null;
      }
      depth -= 1;
    }
  }
  return null;
}

// Every url reference in source order (not de-duplicated -- duplicates are
// meaningful reference-count evidence), each with its node type and field name.
// Empty values dropped.
function extractUrlRefs(text) {
  const out = [];
  const src = String(text == null ? '' : text);
  for (const field of src.matchAll(URL_FIELD)) {
    const fieldName = field[1];
    const nodeType = nodeTypeBefore(src, field.index);
    for (const q of field[2].matchAll(QUOTED)) {
      const v = q[1].trim();
      if (v) out.push({ nodeType, field: fieldName, value: v });
    }
  }
  return out;
}

// Just the values, in source order (back-compat with the recon extractor).
function extractUrlValues(text) {
  return extractUrlRefs(text).map((r) => r.value);
}

// VRML97 Script nodes carry inline code in the url field under these pseudo-
// schemes -- e.g. `Script { url "vrmlscript: function foo(){...}" }`. That is NOT
// a fetchable network URL and NOT a local file; the resolver must not treat it as
// either (it was being miscounted as a "remote reference" against real worlds).
const SCRIPT_SCHEMES = new Set(['vrmlscript', 'javascript', 'ecmascript']);

function isInlineScript(url) {
  const scheme = schemeOf(url);
  return !!scheme && SCRIPT_SCHEMES.has(scheme.toLowerCase());
}

// True when a url value targets the network (remote/non-local scheme or protocol-
// relative). Scheme-less values are relative local paths; `file:` is local; inline
// script pseudo-schemes are neither remote nor local.
function isRemote(url) {
  const t = String(url == null ? '' : url).trim();
  if (isInlineScript(t)) return false;
  if (/^\/\//.test(t)) return true; // protocol-relative
  const scheme = schemeOf(t);
  if (!scheme) return false;
  return !/^file$/i.test(scheme);
}

// A scheme-less (or file:) reference to an actual local file.
function isLocalFile(url) {
  return !isInlineScript(url) && !isRemote(url);
}

// Split extracted values into { all, local, remote, inlineScripts } (local/remote
// de-duplicated). Back-compat with the recon classifier.
function classifyUrls(text) {
  const values = extractUrlValues(text);
  const local = [];
  const remote = [];
  const inlineScripts = [];
  for (const v of values) {
    if (isInlineScript(v)) inlineScripts.push(v);
    else if (isRemote(v)) remote.push(v);
    else local.push(v);
  }
  return { all: values, local: [...new Set(local)], remote: [...new Set(remote)], inlineScripts };
}

module.exports = {
  extractUrlRefs,
  extractUrlValues,
  classifyUrls,
  isRemote,
  isInlineScript,
  isLocalFile,
  nodeTypeBefore,
  URL_FIELD,
};
