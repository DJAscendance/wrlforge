'use strict';
// Full URL-field extraction for World Project recon.
//
// This is deliberately broader than src/preview/url-policy.js's scanRemoteUrls
// (which is a narrow remote-blocking preflight that keeps only the FIRST url of
// an MFString and matches lowercase `url` only). World recon must enumerate
// EVERY local reference to build a complete asset graph, so it:
//   * captures all entries of an MFString `url [ "a" "b" ... ]` (possibly
//     spanning multiple lines), not just the first,
//   * matches url fields case-insensitively and including the *Url suffix forms
//     seen in real Cybertown worlds (`url`, `Url`, `frontUrl`, `backUrl`, ...),
//   * classifies each value as local vs remote by URL scheme.
//
// It does NOT interpret the VRML scene graph -- it is a lexical pass over the
// decompressed source, which is all recon needs to know what a world points at.

const { schemeOf } = require('../../src/preview/url-policy');

// A url-bearing field followed immediately by either a single quoted string or a
// bracketed MFString. `[^\]]*` (not `.`) lets the array span newlines.
const URL_FIELD = /\b\w*[Uu]rl\b\s*(\[[^\]]*\]|"[^"]*")/g;
const QUOTED = /"([^"]*)"/g;

// Every url value referenced in the text, in source order (not de-duplicated;
// duplicates are meaningful for reference-count evidence). Empty strings dropped.
function extractUrlValues(text) {
  const out = [];
  const src = String(text == null ? '' : text);
  for (const field of src.matchAll(URL_FIELD)) {
    for (const q of field[1].matchAll(QUOTED)) {
      const v = q[1].trim();
      if (v) out.push(v);
    }
  }
  return out;
}

// VRML97 Script nodes carry inline code in the url field under these pseudo-
// schemes -- e.g. `Script { url "vrmlscript: function foo(){...}" }`. That is NOT
// a fetchable network URL and NOT a local file; recon must not treat it as either
// (it was being miscounted as a "remote reference" against real Cybertown worlds).
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

// Split extracted values into { local, remote, inlineScripts }, each de-duplicated.
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

module.exports = { extractUrlValues, classifyUrls, isRemote, isInlineScript, isLocalFile, URL_FIELD };
