'use strict';
// WD1.7-A -- EXTERNPROTO declaration extraction and reference-form classification.
//
// PURE. Parse result in, records out. No `fs`, no network, no path resolution,
// no candidate selection. This module answers "what did the document ASK FOR",
// which is a strictly separate question from "what did we FIND" (probe.js) and
// from "what does that PROVE" (a future production lane).
//
// WHY A SEPARATE MODULE AT ALL. ISO 4.9.3 gives an EXTERNPROTO's URL list two
// independent jobs -- LOCATING a file and SELECTING a PROTO inside it -- and the
// corpus mixes forms that succeed at one and not the other (a `urn:` candidate
// locates nothing but names a built-in; a fragment-less HTTP URL locates a file
// but selects by position). Collapsing them into one "is it resolvable" boolean
// is exactly the measurement that would hide the interesting cases, so every
// candidate is classified on BOTH axes and the two are never merged.
//
// NOT A RESOLVER, and deliberately unfit to become one: nothing here can open a
// file, so no amount of extension can turn it into an ambient filesystem lookup.

const { NODE, walk } = require('../../src/vrml/ast');

// ---------------------------------------------------------------------------
// Reference forms
// ---------------------------------------------------------------------------
//
// The taxonomy is by SYNTACTIC SHAPE, not by "would this work" -- a form is a
// property of the written string alone, so the same string classifies
// identically on every machine and under every root configuration. Whether a
// form is resolvable is probe.js's question and depends on configuration.
const FORM = Object.freeze({
  /** `urn:...` -- names a resource, locates nothing. ISO 4.9.1's
   *  "some other implementation-dependent mechanism" reaches VRML through here. */
  URN: 'urn',
  /** `http://` or `https://` absolute URL. */
  ABSOLUTE_HTTP: 'absolute-http',
  /** `file://` absolute URL -- a local path wearing a URL. */
  ABSOLUTE_FILE: 'absolute-file',
  /** Any other explicit `scheme:` prefix (ftp:, javascript:, ...). */
  ABSOLUTE_OTHER_SCHEME: 'absolute-other-scheme',
  /** `//host/path` -- scheme-relative. */
  PROTOCOL_RELATIVE: 'protocol-relative',
  /** `/path` -- server-root-relative; has no meaning without a server. */
  ROOT_RELATIVE: 'root-relative',
  /** Contains a `\` separator or a `X:` drive letter. */
  WINDOWS_PATH: 'windows-path',
  /** Begins `../` -- relative and ASCENDING. Its own form because ascent is
   *  the root-escape question, and a resolver must be able to count them. */
  PARENT_RELATIVE: 'parent-relative',
  /** Begins `./`. */
  DOT_RELATIVE: 'dot-relative',
  /** Any other relative path. The expected common case. */
  BARE_RELATIVE: 'bare-relative',
  /** The empty string. Legal MFString, locates nothing. */
  EMPTY: 'empty',
});

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

/**
 * Classify one written candidate string into a `FORM`.
 *
 * Order matters and is asserted by the controls: a `file://C:\x` is a
 * `file:` URL first and a Windows path second, so scheme detection precedes
 * separator detection.
 */
function classifyForm(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return FORM.EMPTY;
  const m = SCHEME.exec(raw);
  if (m) {
    const scheme = m[1].toLowerCase();
    if (scheme === 'urn') return FORM.URN;
    if (scheme === 'http' || scheme === 'https') return FORM.ABSOLUTE_HTTP;
    if (scheme === 'file') return FORM.ABSOLUTE_FILE;
    // A bare `C:` drive letter also matches SCHEME. One-letter schemes do not
    // exist in practice, so treat it as the Windows path it is.
    if (m[1].length === 1) return FORM.WINDOWS_PATH;
    return FORM.ABSOLUTE_OTHER_SCHEME;
  }
  if (raw.startsWith('//')) return FORM.PROTOCOL_RELATIVE;
  if (raw.includes('\\')) return FORM.WINDOWS_PATH;
  if (raw.startsWith('/')) return FORM.ROOT_RELATIVE;
  if (raw.startsWith('../')) return FORM.PARENT_RELATIVE;
  if (raw.startsWith('./')) return FORM.DOT_RELATIVE;
  return FORM.BARE_RELATIVE;
}

/**
 * Split a written candidate into its locator and its ISO 4.9.3 fragment.
 *
 * THE FRAGMENT IS THE LAST `#`, not the first. A percent-decoded path could in
 * principle contain one; taking the last keeps `a#b#Proto` selecting `Proto`,
 * which is the only reading under which the trailing-`#name` rule in 4.9.3 is
 * unambiguous. `hasFragment` distinguishes a written empty fragment (`file#`)
 * from no fragment at all -- they are different questions and 4.9.3 answers
 * only the second.
 */
function splitFragment(raw) {
  if (typeof raw !== 'string') return { locator: '', fragment: null, hasFragment: false };
  const i = raw.lastIndexOf('#');
  if (i < 0) return { locator: raw, fragment: null, hasFragment: false };
  return { locator: raw.slice(0, i), fragment: raw.slice(i + 1), hasFragment: true };
}

/** The `?query` part of a locator, or null. Recorded, never stripped silently. */
function splitQuery(locator) {
  const i = locator.indexOf('?');
  if (i < 0) return { path: locator, query: null };
  return { path: locator.slice(0, i), query: locator.slice(i + 1) };
}

/** Lower-cased final extension of a locator path, or `''` when there is none. */
function extensionOf(locatorPath) {
  const base = locatorPath.split(/[/\\]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot).toLowerCase();
}

/** `true` when the string contains a `%XX` escape. Percent-encoding is a
 *  decode step a resolver must perform explicitly, never incidentally. */
function hasPercentEncoding(s) {
  return /%[0-9A-Fa-f]{2}/.test(s);
}

/**
 * Every candidate written in one EXTERNPROTO's URL list, in SOURCE ORDER.
 *
 * Source order is normative (4.5.2 "decreasing order of preference"), so it is
 * preserved rather than sorted, and the index is emitted so a later record can
 * cite "candidate 0 was a urn, candidate 1 resolved" without re-deriving it.
 */
function candidatesOf(urlValue) {
  if (!urlValue) return [];
  const out = [];
  const push = (node) => {
    if (!node || node.type !== NODE.STRING) return;
    const raw = typeof node.value === 'string' ? node.value : '';
    const { locator, fragment, hasFragment } = splitFragment(raw);
    const { path: locPath, query } = splitQuery(locator);
    const form = classifyForm(raw);
    out.push({
      index: out.length,
      raw,
      form,
      locator,
      locatorPath: locPath,
      query,
      fragment,
      hasFragment,
      // A `urn:` names a resource and has no path, so it has no extension --
      // reporting `.com:node:hud` for `urn:inet:blaxxun.com:node:HUD` would be a
      // fabricated fact that a downstream gzip/extension tally would then count.
      extension: form === FORM.URN ? null : extensionOf(locPath),
      percentEncoded: hasPercentEncoding(raw),
      range: node.range || null,
    });
  };
  if (urlValue.type === NODE.STRING) push(urlValue);
  else if (urlValue.type === NODE.ARRAY) for (const item of urlValue.items || []) push(item);
  return out;
}

/** Interface member counts by access category, for the 4.9.2 subset question. */
function interfaceSummary(interfaces) {
  const counts = { field: 0, exposedField: 0, eventIn: 0, eventOut: 0, other: 0 };
  const names = [];
  for (const decl of interfaces || []) {
    if (!decl || decl.type !== NODE.INTERFACE) continue;
    const access = decl.access;
    if (Object.prototype.hasOwnProperty.call(counts, access)) counts[access] += 1;
    else counts.other += 1;
    if (typeof decl.name === 'string') names.push({ access, name: decl.name, fieldType: decl.fieldType || null });
  }
  return { counts, names, total: names.length };
}

/**
 * Every `EXTERNPROTO` in a parsed document, wherever it appears.
 *
 * `walk` rather than a top-level scan because the corpus really does nest them:
 * inside PROTO bodies (legal, 4.8.4) and inside MFNode arrays (non-conforming,
 * accepted by parser recovery). A top-level-only scan would under-count, and an
 * under-count that looks like a clean number is the worst kind.
 */
function externProtosOf(parseResult) {
  const found = [];
  const doc = parseResult && parseResult.tree;
  if (!doc) return found;
  walk(doc, (node) => {
    if (!node || node.type !== NODE.EXTERNPROTO) return undefined;
    const candidates = candidatesOf(node.url);
    found.push({
      name: typeof node.name === 'string' ? node.name : null,
      candidates,
      candidateCount: candidates.length,
      urlWritten: node.url !== null && node.url !== undefined,
      urlIsArray: !!(node.url && node.url.type === NODE.ARRAY),
      iface: interfaceSummary(node.interfaces),
      range: node.range || null,
    });
    return undefined;
  });
  return found;
}

/**
 * The ISO 4.9.3 target-selection question, answered for ONE file's parse.
 *
 * Returns the PROTO declarations a fragment-less reference could select, in
 * source order, EXCLUDING EXTERNPROTOs -- 4.9.3 says "the first PROTO statement
 * found in the VRML file (excluding EXTERNPROTOs)" in exactly those words.
 *
 * TOP-LEVEL ONLY, and this is a decision rather than a shortcut. 4.8.4 makes a
 * nested PROTO "local to the enclosing prototype", so a nested declaration is
 * not a thing an outside file can name; including it would let a fragment
 * select a declaration that is unreachable by construction.
 */
function selectablePrototypes(parseResult) {
  const doc = parseResult && parseResult.tree;
  const stmts = (doc && doc.statements) || [];
  const out = [];
  for (const s of stmts) {
    if (s && s.type === NODE.PROTO && typeof s.name === 'string') {
      out.push({ name: s.name, range: s.range || null });
    }
  }
  return out;
}

module.exports = {
  FORM,
  classifyForm,
  splitFragment,
  splitQuery,
  extensionOf,
  hasPercentEncoding,
  candidatesOf,
  interfaceSummary,
  externProtosOf,
  selectablePrototypes,
};
