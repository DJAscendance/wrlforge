'use strict';
// WD1.7-A -- the EXTERNPROTO corpus measurement.
//
// THE QUESTIONS, and their denominators, stated before any number is produced:
//
//   Q1  How much of the corpus uses EXTERNPROTO at all?
//       Denominators: unique decoded documents; discovered raw paths.
//   Q2  What reference FORMS are actually written?
//       Denominator: written URL candidates.
//   Q3  How often is ISO 4.9.3's `#name` fragment used, and how often must the
//       "first PROTO excluding EXTERNPROTOs" positional rule decide instead?
//       Denominator: written URL candidates.
//   Q4  Does the "excluding EXTERNPROTOs" half of 4.9.3 ever CHANGE the answer?
//       Denominator: documents that could serve as a fragment-less target.
//   Q5  Under an explicitly-named, deliberately GENEROUS probe policy, how many
//       references find a target in the archived corpus -- and how many find
//       MORE THAN ONE semantically different target?
//       Denominator: written URL candidates.
//   Q6  Where a target is found, does the local EXTERNPROTO interface satisfy
//       ISO 4.9.2's SUBSET rule against that target's PROTO interface?
//       Denominator: candidates with exactly one semantically distinct target.
//   Q7  Is compression signalled by file extension, or only by content?
//       Denominator: discovered raw paths.
//
// READ-ONLY, boundary-guarded, deterministic. Discovery, decoding, decoded-text
// de-duplication and the forbidden-path guard are P2C's committed
// `spikes/wd1-route-semantics/corpus.js`, reused UNMODIFIED. That guard THROWS
// on a `white-dune`, `RE-ARTIFACTS` or `blaxxun-cs-RE` path rather than skipping
// it, so this sweep is structurally unable to read the restricted evidence
// roots -- which is the property that makes its numbers safe to publish.
//
// THE PROBE IS NOT A RESOLVER, and the distinction is the whole point of §10 of
// the lane brief. It answers "do bytes plausibly matching this reference exist
// anywhere in the archive", which is RETRIEVAL. It does not and must not answer
// "this is the unique PROTO implementation this EXTERNPROTO refers to", which is
// SEMANTIC RESOLUTION. It is deliberately generous (longest-suffix match across
// every discovered path, ignoring host and scheme) so that its result is an
// UPPER BOUND: a reference the probe cannot find is definitively dead in this
// archive, while a reference it finds is merely a candidate. Production must be
// strictly narrower, and must never adopt this matching rule -- "first
// filesystem match wins" and "nearest path wins" are exactly the heuristics the
// lane brief rejects.

const path = require('path');
const corpus = require('../wd1-route-semantics/corpus');
const extract = require('./extract');
const { NODE } = require('../../src/vrml/ast');

// ---------------------------------------------------------------------------
// Normalizing a written reference into probe keys
// ---------------------------------------------------------------------------
//
// A key is a `/`-joined lower-cased path suffix. Lower-casing is a MEASUREMENT
// decision, not a semantic one: the archive was captured from a case-sensitive
// web server onto case-insensitive media in places, so a case-sensitive probe
// would report dead references that a period browser resolved. The sweep
// therefore probes case-INSENSITIVELY and reports case agreement separately, so
// the two facts never collapse into one number.

/** Split a locator into path segments, dropping empties, `.` and scheme/host. */
function locatorSegments(candidate) {
  let p = candidate.locatorPath || '';
  // An OPAQUE URI -- a scheme with no `//` authority (`urn:`, `javascript:`,
  // `mailto:`) -- has no path component at all. Returning segments for one would
  // fabricate a probe key out of its opaque part, and `urn:inet:blaxxun.com:
  // node:HUD` would then be "searched for" as the file `node:HUD`. ISO 4.9.1
  // routes such a reference to "some other implementation-dependent mechanism";
  // a retrieval probe has nothing to say about it, and saying nothing is the
  // correct answer rather than a gap.
  const hasAuthority = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(p);
  const opaqueScheme = /^[A-Za-z][A-Za-z0-9+.-]{1,}:/.test(p) && !hasAuthority;
  if (opaqueScheme) return [];
  // Strip an explicit scheme and authority: `http://host/a/b` -> `a/b`.
  const schemeAuthority = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]*\//;
  if (schemeAuthority.test(p)) p = p.replace(schemeAuthority, '');
  else if (hasAuthority) return []; // `http://host` with no path
  else if (p.startsWith('//')) p = p.replace(/^\/\/[^/]*\//, '');
  p = p.replace(/\\/g, '/');
  const segs = [];
  for (const raw of p.split('/')) {
    if (raw === '' || raw === '.') continue;
    segs.push(raw);
  }
  return segs;
}

/**
 * Every `/`-joined suffix of a locator, LONGEST FIRST.
 *
 * Longest-first is what makes the probe report "the most specific archived path
 * consistent with this reference". `..` segments are NOT resolved here: a probe
 * key is a suffix, and a suffix containing `..` simply will not match any
 * archived path, which is the honest outcome for a reference whose base this
 * measurement does not model.
 */
function probeKeys(candidate) {
  const segs = locatorSegments(candidate);
  const keys = [];
  for (let i = 0; i < segs.length; i += 1) {
    keys.push(segs.slice(i).join('/').toLowerCase());
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Pass 1 -- the target index
// ---------------------------------------------------------------------------

/** Fresh, empty counters. Every field is named for the question it answers. */
function newCounters() {
  return {
    // Q1
    rawPaths: 0,
    uniqueDocs: 0,
    readErrors: 0,
    rawPathsWithExternProto: 0,
    uniqueDocsWithExternProto: 0,
    externProtoDecls: 0,
    externProtoDeclsUniqueDocs: 0,
    declsWithNoUrl: 0,
    declsWithEmptyList: 0,
    declsWithSingleString: 0,
    declsWithArray: 0,
    candidates: 0,
    candidatesPerDeclMax: 0,
    // Q2
    byForm: Object.create(null),
    // Q3
    withFragment: 0,
    withEmptyFragment: 0,
    withoutFragment: 0,
    percentEncoded: 0,
    withQuery: 0,
    byExtension: Object.create(null),
    // Q4
    docsWithTopLevelProto: 0,
    docsWhereExcludingExternProtoMatters: 0,
    // Q5
    probeResolvedUnique: 0,
    probeResolvedAmbiguous: 0,
    probeNotFound: 0,
    probeNotProbeable: 0,
    probeCaseExact: 0,
    probeCaseDiffered: 0,
    // Q6
    subsetChecked: 0,
    subsetSatisfied: 0,
    subsetMemberMissing: 0,
    subsetTypeMismatch: 0,
    subsetAccessMismatch: 0,
    subsetTargetHasNoSuchProto: 0,
    // Q7
    gzipByMagic: 0,
    gzipExtension: 0,
    gzipMagicButPlainExtension: 0,
    plainMagicButGzipExtension: 0,
  };
}

function bump(map, key) {
  const k = key === null || key === undefined ? '(none)' : String(key);
  map[k] = (map[k] || 0) + 1;
}

/**
 * A document's contribution to the target index.
 *
 * `selectable` is 4.9.3's fragment-less answer set (top-level PROTOs, source
 * order). `firstAnyProto` is the same list WITHOUT the "excluding EXTERNPROTOs"
 * exclusion -- kept only so Q4 can measure whether the exclusion ever changes
 * the selected name. It is never used to resolve anything.
 */
function indexEntryFor(parsed) {
  const selectable = extract.selectablePrototypes(parsed);
  const stmts = (parsed && parsed.tree && parsed.tree.statements) || [];
  let firstAnyProto = null;
  for (const s of stmts) {
    if (s && (s.type === NODE.PROTO || s.type === NODE.EXTERNPROTO) && typeof s.name === 'string') {
      firstAnyProto = { name: s.name, isExtern: s.type === NODE.EXTERNPROTO };
      break;
    }
  }
  const byName = Object.create(null);
  for (const p of selectable) {
    // A file may declare the same PROTO name twice. Record the count so the
    // probe can report target-side ambiguity rather than silently taking one.
    byName[p.name] = (byName[p.name] || 0) + 1;
  }
  return {
    selectable: selectable.map((p) => p.name),
    firstSelectable: selectable.length ? selectable[0].name : null,
    firstAnyProto,
    protoNameCounts: byName,
    protoInterfaces: protoInterfacesOf(parsed),
  };
}

/** Top-level PROTO name -> its interface member list, for the 4.9.2 subset check. */
function protoInterfacesOf(parsed) {
  const out = Object.create(null);
  const stmts = (parsed && parsed.tree && parsed.tree.statements) || [];
  for (const s of stmts) {
    if (!s || s.type !== NODE.PROTO || typeof s.name !== 'string') continue;
    if (out[s.name]) continue; // first declaration wins for the measurement
    out[s.name] = extract.interfaceSummary(s.interfaces).names;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The 4.9.2 subset check
// ---------------------------------------------------------------------------
//
// ISO 4.9.2, verbatim: "The names and types of the fields, exposedFields,
// eventIns, and eventOuts of the interface declaration shall be a subset of
// those defined in the implementation. Declaring a field or event with a
// non-matching name is an error, as is declaring a field or event with a
// matching name but a different type."
//
// So the relation is DIRECTIONAL and the direction is easy to get backwards:
// LOCAL ⊆ TARGET. A target with extra members is conforming; a local
// declaration with a member the target lacks is an ERROR. Types compare by
// exact token equality, which is the rule P2B established for Table 4.4 and
// which is reused here rather than re-derived.
//
// ACCESS is reported SEPARATELY from type. 4.9.2 names "names and types" and is
// silent on whether an `eventIn x` may satisfy an `exposedField x`; the sweep
// therefore records an access difference as its own outcome rather than folding
// it into "mismatch", because folding it in would be this lane inventing a rule
// the standard does not state.
function subsetCheck(localMembers, targetMembers) {
  const byName = new Map();
  for (const m of targetMembers) if (!byName.has(m.name)) byName.set(m.name, m);
  const problems = [];
  for (const local of localMembers) {
    const target = byName.get(local.name);
    if (!target) { problems.push({ kind: 'member-missing', name: local.name }); continue; }
    if (local.fieldType !== target.fieldType) {
      problems.push({ kind: 'type-mismatch', name: local.name, local: local.fieldType, target: target.fieldType });
      continue;
    }
    if (local.access !== target.access) {
      problems.push({ kind: 'access-differs', name: local.name, local: local.access, target: target.access });
    }
  }
  return problems;
}


module.exports = {
  corpus,
  subsetCheck,
  extract,
  locatorSegments,
  probeKeys,
  newCounters,
  bump,
  indexEntryFor,
  protoInterfacesOf,
  GENEROUS_PROBE_POLICY: Object.freeze({
    id: 'longest-suffix-case-insensitive',
    describes: 'RETRIEVAL upper bound only. Not a resolution rule. Never production.',
  }),
};
