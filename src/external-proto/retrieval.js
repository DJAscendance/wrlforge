'use strict';
// WD1.7-B -- the retrieval substrate. THE ONLY MODULE IN THIS LANE THAT TOUCHES
// A FILESYSTEM, and it touches nothing else: no network, no writes, no cwd.
//
// Given an explicitly configured retrieval context, an explicit base document,
// and ONE written external reference candidate, deterministically attempt to
// obtain and safely decode the corresponding artifact while preserving complete
// provenance and uncertainty.
//
// A successful result means exactly:
//
//     WRL Forge deterministically obtained and decoded one candidate artifact
//     under the configured retrieval policy.
//
// It does NOT mean "this artifact contains the correct PROTO implementation".
// That is ISO 4.9.3 target selection, it is WD1.7-C's, and this lane contains
// none of it: no fragment lookup, no first-PROTO-excluding-EXTERNPROTO rule, no
// interface comparison, no class derivation, no dependency traversal, no cycle
// detection. `RETRIEVED` is deliberately NOT spelled `RESOLVED` (WD1.7-A §10).
//
// THE FIVE BOUNDARY RULES, each of which cost a real defect somewhere before:
//
//  1. EXACT CASE IS ENFORCED IN SOFTWARE, per path component. The directory
//     listing is authoritative, never `existsSync` -- on a case-insensitive
//     NTFS/APFS volume `exists('BXX/shared.wrl')` answers true for `bxx/`, so
//     inheriting host behaviour would make one reference resolve on Windows and
//     fail on ext4. A case-only near-miss is REPORTED, never promoted to a hit.
//  2. CONTAINMENT IS CHECKED AFTER SYMLINK RESOLUTION, with `path.relative`,
//     never `startsWith` -- `/root/foobar` starts with `/root/foo`.
//  3. GZIP IS DETECTED BY MAGIC BYTES, never by extension. 6,462 corpus files
//     are gzip behind a plain `.wrl` name against 58 that announce it, and 3
//     announce compression they do not have (WD1.7-A §7.4).
//  4. DECOMPRESSION IS BOUNDED INSIDE zlib, not measured afterwards. The cap
//     handed to `gunzipSync` is min(decoded-byte limit, raw x ratio limit), so a
//     small hostile input cannot expand without bound before anyone looks.
//  5. EVERY FAILURE KEEPS ITS OWN NAME. A policy refusal is never reported as an
//     absence, and an unreadable artifact is never reported as decoded bytes.
//
// Reuse note: gzip DETECTION is `src/files/vrml-file.js`'s `isGzip`, the single
// existing authority, reused rather than re-implemented. `readWrlSource` itself
// is deliberately NOT reused for the read: it reads whole files unbounded and
// has no cap to hand zlib, so rule 4 would be lost. Same magic bytes, same
// gunzip, bounded.

const nodeFs = require('fs');
const nodePath = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const { isGzip } = require('../files/vrml-file');
const { classifyReference } = require('./reference-forms');
const { routeCandidate, normalizeBaseDocument } = require('./routing');

// Retrieval statuses -- WD1.7-A §10, plus one documented addition (see below).
// These are about BYTES. Resolution statuses (`RESOLVED`, `TARGET_PROTO_*`,
// `DEPENDENCY_CYCLE`) are WD1.7-C's and must never appear here.
const RETRIEVAL_STATUS = Object.freeze({
  RETRIEVED: 'RETRIEVED',
  NOT_FOUND: 'NOT_FOUND',
  AMBIGUOUS_SOURCE: 'AMBIGUOUS_SOURCE',
  UNSUPPORTED_REFERENCE: 'UNSUPPORTED_REFERENCE',
  NOT_RETRIEVED_BY_POLICY: 'NOT_RETRIEVED_BY_POLICY',
  DECODE_FAILED: 'DECODE_FAILED',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  // WD1.7-B IMPLEMENTATION FINDING -- an addition to the ratified §10 set.
  // The A taxonomy has no cell for "the artifact was located inside a configured
  // root, and its bytes could not be read" (EACCES, EIO, an unreadable
  // directory). Reporting that as NOT_FOUND would assert an absence nobody
  // established; reporting it as DECODE_FAILED would claim bytes nobody got.
  // Keeping independently answerable questions independently answerable is the
  // discipline P2C paid for with ROUTE endpoints, so it gets its own name.
  UNREADABLE_ARTIFACT: 'UNREADABLE_ARTIFACT',
});

const RETRIEVAL_REASON = Object.freeze({
  NOT_IN_CONFIGURED_SOURCES: 'not-in-configured-sources',
  CASE_MISMATCH: 'case-mismatch',
  NOT_A_REGULAR_FILE: 'not-a-regular-file',
  SYMLINK_ESCAPE: 'symlink-escape',
  GZIP_INFLATE_FAILED: 'gzip-inflate-failed',
  RAW_BYTES_LIMIT: 'raw-bytes-limit',
  DECODED_BYTES_LIMIT: 'decoded-bytes-limit',
  EXPANSION_RATIO_LIMIT: 'expansion-ratio-limit',
  ARTIFACT_READ_FAILED: 'artifact-read-failed',
  DIRECTORY_UNREADABLE: 'directory-unreadable',
  REALPATH_FAILED: 'realpath-failed',
  MULTIPLE_SOURCES_DIFFERING_CONTENT: 'multiple-sources-differing-content',
});

// Absence, as opposed to an I/O failure. ENOENT/ENOTDIR genuinely prove the
// path is not there; every other errno proves only that we could not look.
const ABSENCE_CODES = new Set(['ENOENT', 'ENOTDIR']);

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function defaultDeps() {
  return {
    readdirSync: (d) => nodeFs.readdirSync(d),
    realpathSync: (p) => nodeFs.realpathSync(p),
    statSync: (p) => nodeFs.statSync(p),
    readFileSync: (p) => nodeFs.readFileSync(p),
  };
}

// Is `abs` inside `root`, both already realpath-resolved? `path.relative` is
// used rather than a prefix test because `/root/foobar` startsWith `/root/foo`.
function isInside(root, abs) {
  const rel = nodePath.relative(root, abs);
  return rel !== '' && !rel.startsWith('..') && !nodePath.isAbsolute(rel);
}

// Walk `segments` down from `root`, requiring EACH component to match a real
// directory entry with exact written case. Returns one of:
//   { abs }                              exact match, component by component
//   { absent: true, caseActual|null }    not there (caseActual = the differing-
//                                        case archive-relative spelling, if any)
//   { error: reason }                    a directory could not be enumerated
function locateExactCase(root, segments, deps) {
  let cur = root;
  const walked = [];
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    let listing;
    try {
      listing = deps.readdirSync(cur);
    } catch (err) {
      if (ABSENCE_CODES.has(err && err.code)) return { absent: true, caseActual: null };
      return { error: RETRIEVAL_REASON.DIRECTORY_UNREADABLE };
    }
    if (listing.includes(seg)) {
      walked.push(seg);
      cur = nodePath.join(cur, seg);
      continue;
    }
    const lower = seg.toLowerCase();
    const ci = listing.find((name) => name.toLowerCase() === lower);
    // A case-only sibling is a FINDING, not a match. Promoting it would be the
    // archive-recovery convention (WD1.7-A §12), which belongs to a migration
    // tool, not to strict retrieval.
    return { absent: true, caseActual: ci ? [...walked, ci, ...segments.slice(i + 1)].join('/') : null };
  }
  return { abs: cur };
}

// Read at most `maxBytes` bytes of a regular file, refusing before allocation if
// it is larger. Returns { buf } | { status, reason }.
function readBounded(abs, maxBytes, deps) {
  let st;
  try {
    st = deps.statSync(abs);
  } catch (err) {
    if (ABSENCE_CODES.has(err && err.code)) return { absent: true };
    return { status: RETRIEVAL_STATUS.UNREADABLE_ARTIFACT, reason: RETRIEVAL_REASON.ARTIFACT_READ_FAILED };
  }
  if (!st.isFile()) return { status: RETRIEVAL_STATUS.NOT_FOUND, reason: RETRIEVAL_REASON.NOT_A_REGULAR_FILE };
  if (st.size > maxBytes) return { status: RETRIEVAL_STATUS.LIMIT_EXCEEDED, reason: RETRIEVAL_REASON.RAW_BYTES_LIMIT };
  let buf;
  try {
    buf = deps.readFileSync(abs);
  } catch (err) {
    if (ABSENCE_CODES.has(err && err.code)) return { absent: true };
    return { status: RETRIEVAL_STATUS.UNREADABLE_ARTIFACT, reason: RETRIEVAL_REASON.ARTIFACT_READ_FAILED };
  }
  // The stat is advisory; the bytes are authoritative. A file that grew between
  // stat and read is still capped here.
  if (buf.length > maxBytes) return { status: RETRIEVAL_STATUS.LIMIT_EXCEEDED, reason: RETRIEVAL_REASON.RAW_BYTES_LIMIT };
  return { buf };
}

// Decode retrieved bytes to VRML source. Gzip is decided by magic bytes only.
// Returns { decoded, wasGzipped } | { status, reason }.
function decodeArtifact(raw, limits) {
  const wasGzipped = isGzip(raw);
  if (!wasGzipped) {
    if (raw.length > limits.maxDecodedBytes) {
      return { status: RETRIEVAL_STATUS.LIMIT_EXCEEDED, reason: RETRIEVAL_REASON.DECODED_BYTES_LIMIT };
    }
    return { decoded: raw, wasGzipped: false };
  }
  // BOUND INSIDE zlib. `maxOutputLength` permits exactly the cap and throws
  // ERR_BUFFER_TOO_LARGE above it, so nothing hostile is ever fully expanded in
  // memory first. The ratio cap is folded into the same number, which is what
  // makes "small compressed input" unable to buy unbounded decompression.
  const ratioCap = Math.floor(raw.length * limits.maxExpansionRatio);
  const cap = Math.min(limits.maxDecodedBytes, ratioCap);
  let decoded;
  try {
    decoded = zlib.gunzipSync(raw, { maxOutputLength: cap });
  } catch (err) {
    if (err && err.code === 'ERR_BUFFER_TOO_LARGE') {
      return {
        status: RETRIEVAL_STATUS.LIMIT_EXCEEDED,
        reason: ratioCap < limits.maxDecodedBytes
          ? RETRIEVAL_REASON.EXPANSION_RATIO_LIMIT
          : RETRIEVAL_REASON.DECODED_BYTES_LIMIT,
      };
    }
    return { status: RETRIEVAL_STATUS.DECODE_FAILED, reason: RETRIEVAL_REASON.GZIP_INFLATE_FAILED };
  }
  return { decoded, wasGzipped: true };
}

// UTF-8 is reported, not enforced. `src/preview/wrl-source.js` -- the existing
// source-loading authority -- decodes with `Buffer#toString('utf8')`, which
// substitutes U+FFFD rather than rejecting. B PRESERVES that behaviour (§26: do
// not introduce a second decoding policy) and adds an observation, `utf8Valid`,
// so a consumer can see the difference instead of inferring it. Whether invalid
// UTF-8 should become a retrieval failure is a real open question and is
// recorded as a WD1.7-B implementation finding rather than decided here.
function decodeText(decoded) {
  const text = decoded.toString('utf8');
  let utf8Valid = true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(decoded);
  } catch {
    utf8Valid = false;
  }
  return { text, utf8Valid };
}

// One (source, path) attempt. Returns a frozen attempt record.
function attemptSource(source, requestedPath, limits, deps) {
  const base = { sourceId: source.id, artifactPath: requestedPath };
  const segments = requestedPath.split('/');

  const located = locateExactCase(source.root, segments, deps);
  if (located.error) {
    return Object.freeze({ ...base, kind: 'error', status: RETRIEVAL_STATUS.UNREADABLE_ARTIFACT, reason: located.error, caseActual: null });
  }
  if (located.absent) {
    return Object.freeze({
      ...base,
      kind: 'absent',
      status: RETRIEVAL_STATUS.NOT_FOUND,
      reason: located.caseActual ? RETRIEVAL_REASON.CASE_MISMATCH : RETRIEVAL_REASON.NOT_IN_CONFIGURED_SOURCES,
      caseActual: located.caseActual,
    });
  }

  // Containment, AFTER symlink resolution and on both ends. A symlinked root is
  // legitimate; a symlink that leaves the root is not.
  let realRoot;
  let realTarget;
  try {
    realRoot = deps.realpathSync(source.root);
    realTarget = deps.realpathSync(located.abs);
  } catch (err) {
    if (ABSENCE_CODES.has(err && err.code)) {
      return Object.freeze({ ...base, kind: 'absent', status: RETRIEVAL_STATUS.NOT_FOUND, reason: RETRIEVAL_REASON.NOT_IN_CONFIGURED_SOURCES, caseActual: null });
    }
    return Object.freeze({ ...base, kind: 'error', status: RETRIEVAL_STATUS.UNREADABLE_ARTIFACT, reason: RETRIEVAL_REASON.REALPATH_FAILED, caseActual: null });
  }
  if (!isInside(realRoot, realTarget)) {
    // A configured root is a security boundary. Escaping it is refused, and the
    // refusal is NOT an absence -- the bytes exist, we declined to read them.
    return Object.freeze({ ...base, kind: 'error', status: RETRIEVAL_STATUS.NOT_RETRIEVED_BY_POLICY, reason: RETRIEVAL_REASON.SYMLINK_ESCAPE, caseActual: null });
  }

  const read = readBounded(located.abs, limits.maxBytes, deps);
  if (read.absent) {
    return Object.freeze({ ...base, kind: 'absent', status: RETRIEVAL_STATUS.NOT_FOUND, reason: RETRIEVAL_REASON.NOT_IN_CONFIGURED_SOURCES, caseActual: null });
  }
  if (read.status) {
    const kind = read.status === RETRIEVAL_STATUS.NOT_FOUND ? 'absent' : 'error';
    return Object.freeze({ ...base, kind, status: read.status, reason: read.reason, caseActual: null });
  }

  const dec = decodeArtifact(read.buf, limits);
  if (dec.status) {
    return Object.freeze({ ...base, kind: 'error', status: dec.status, reason: dec.reason, caseActual: null });
  }
  const { text, utf8Valid } = decodeText(dec.decoded);
  return Object.freeze({
    ...base,
    kind: 'found',
    status: RETRIEVAL_STATUS.RETRIEVED,
    reason: null,
    caseActual: null,
    wasGzipped: dec.wasGzipped,
    retrievedBytesHash: sha256(read.buf),
    decodedContentHash: sha256(dec.decoded),
    rawBytes: read.buf.length,
    decodedBytes: dec.decoded.length,
    utf8Valid,
    text,
  });
}

// The provenance vocabulary is WD1.7-A §9's, kept verbatim: `evidenceSourceId`
// answers "which CONFIGURED root supplied it", which is what makes the record
// reproducible under a named configuration rather than under this machine's disk.
function projectMatch(a) {
  return Object.freeze({
    evidenceSourceId: a.sourceId,
    artifactPath: a.artifactPath,
    retrievedBytesHash: a.retrievedBytesHash,
    decodedContentHash: a.decodedContentHash,
    wasGzipped: a.wasGzipped,
    rawBytes: a.rawBytes,
    decodedBytes: a.decodedBytes,
    utf8Valid: a.utf8Valid,
  });
}

function buildResult(fields) {
  return Object.freeze({
    candidateIndex: fields.candidateIndex,
    writtenUrl: fields.writtenUrl,
    reference: fields.reference,
    base: fields.base,
    target: fields.target || null,
    requestedPath: fields.requestedPath || null,
    consideredSourceIds: Object.freeze(fields.consideredSourceIds || []),
    status: fields.status,
    reason: fields.reason || null,
    attempts: Object.freeze(fields.attempts || []),
    matches: Object.freeze(fields.matches || []),
    artifact: fields.artifact || null,
    text: fields.text === undefined ? null : fields.text,
  });
}

// retrieveExternalCandidate({ context, baseDocument, writtenUrl, candidateIndex })
//
// ONE candidate. Deliberately not a list walk: ISO 4.5.2 candidate fallback
// stops on "interpretable data", and whether a retrieved artifact is
// interpretable is only knowable AFTER parsing and target selection -- which is
// WD1.7-C's. A list helper here would inevitably mistake `RETRIEVED` for
// "the EXTERNPROTO resolved", so this lane does not ship one (WD1.7-A §15.3).
// `deps` is an injectable fs surface (readdirSync/realpathSync/statSync/
// readFileSync). It exists so the case, symlink and I/O-failure boundaries are
// unit-testable -- including host filesystems this machine does not have -- and
// it defaults to real `fs`.
function retrieveExternalCandidate({ context, baseDocument, writtenUrl, candidateIndex } = {}, deps = {}) {
  if (context === null || typeof context !== 'object' || !Array.isArray(context.sources)) {
    throw new TypeError('external retrieval: context must be a ResolverContext from createResolverContext()');
  }
  if (!Number.isInteger(candidateIndex) || candidateIndex < 0) {
    throw new TypeError('external retrieval: candidateIndex must be a non-negative integer');
  }
  const io = { ...defaultDeps(), ...(deps || {}) };
  const base = normalizeBaseDocument(context, baseDocument);
  const classified = classifyReference(writtenUrl);

  const reference = Object.freeze({
    form: classified.form,
    scheme: classified.scheme,
    fragment: classified.fragment,   // carried verbatim; NEVER interpreted here
    locator: classified.locator,
    origin: classified.origin,
    originPath: classified.originPath,
  });
  const publicBase = Object.freeze({ sourceId: base.sourceId, path: base.path });
  const common = { candidateIndex, writtenUrl: classified.writtenUrl, reference, base: publicBase };

  // Refused by KIND, before anything touches a filesystem.
  if (!classified.routable) {
    return buildResult({ ...common, status: RETRIEVAL_STATUS.UNSUPPORTED_REFERENCE, reason: classified.reason });
  }

  const route = routeCandidate({ context, base, classified });
  if (!route.routed) {
    return buildResult({ ...common, target: route.target, status: route.status, reason: route.reason });
  }

  const attempts = route.sourceIds.map((id) => {
    const source = context.sources.find((s) => s.id === id);
    return attemptSource(source, route.requestedPath, context.limits, io);
  });

  const withTarget = {
    ...common,
    target: route.target,
    requestedPath: route.requestedPath,
    consideredSourceIds: route.sourceIds.slice(),
    attempts: attempts.map((a) => Object.freeze({
      sourceId: a.sourceId, status: a.status, reason: a.reason, caseActual: a.caseActual || null,
    })),
  };

  // A hard error in ANY candidate source is terminal, even when another source
  // succeeded. An artifact we could not decode or could not read is an artifact
  // whose content we cannot compare, so "unambiguous" is not something this
  // lane may claim. First in configured order wins the reporting.
  const errored = attempts.find((a) => a.kind === 'error');
  if (errored) {
    return buildResult({ ...withTarget, status: errored.status, reason: errored.reason });
  }

  const found = attempts.filter((a) => a.kind === 'found');
  if (found.length === 0) {
    // The per-source reason is kept, not flattened: a case-only near-miss and a
    // path that names a directory are different findings, and a consumer that
    // only ever sees "not in configured sources" cannot tell a user which.
    // A case near-miss is preferred when sources disagree, because it is the one
    // outcome that names a concrete, fixable spelling.
    const caseMiss = attempts.find((a) => a.reason === RETRIEVAL_REASON.CASE_MISMATCH);
    const first = attempts.find((a) => a.reason);
    return buildResult({
      ...withTarget,
      status: RETRIEVAL_STATUS.NOT_FOUND,
      reason: (caseMiss || first || {}).reason || RETRIEVAL_REASON.NOT_IN_CONFIGURED_SOURCES,
    });
  }

  const matches = found.map(projectMatch);
  const distinct = new Set(found.map((a) => a.decodedContentHash));
  if (distinct.size > 1) {
    // Two configured sources answer the same URL with different documents. The
    // user can fix that by narrowing configuration; this lane will not fix it by
    // picking one (WD1.7-A §11: "first filesystem match wins" is rejected).
    return buildResult({
      ...withTarget,
      status: RETRIEVAL_STATUS.AMBIGUOUS_SOURCE,
      reason: RETRIEVAL_REASON.MULTIPLE_SOURCES_DIFFERING_CONTENT,
      matches,
    });
  }

  // Identical decoded content from several sources is ONE artifact for the
  // immediately retrieved document -- but location provenance is NOT collapsed
  // (WD1.7-A §15.2): identical copies can sit under different base contexts, and
  // a later hop's relative references resolve against the base, not the hash.
  // `matches` therefore keeps every source that answered.
  const chosen = found[0];
  return buildResult({
    ...withTarget,
    status: RETRIEVAL_STATUS.RETRIEVED,
    reason: null,
    matches,
    artifact: projectMatch(chosen),
    text: chosen.text,
  });
}

module.exports = {
  retrieveExternalCandidate,
  RETRIEVAL_STATUS,
  RETRIEVAL_REASON,
  // Internal, exported for focused tests only -- not part of the public facade.
  _internals: Object.freeze({ locateExactCase, isInside, decodeArtifact, readBounded, sha256 }),
};
