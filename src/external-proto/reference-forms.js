'use strict';
// WD1.7-B -- written external-reference classification. PURE: no fs, no network,
// no Electron, no zlib. Text in, a frozen classification record out.
//
// One question, and only one:
//
//   What KIND of reference is this written EXTERNPROTO url candidate, and is
//   that kind routable by a filesystem/archive retrieval substrate at all?
//
// It is answered BEFORE anything touches disk, because the alternative -- handing
// an unclassified string to a path resolver -- is how `file:///etc/passwd` and
// `C:\Windows\...` become filesystem reads. Every form that this substrate cannot
// retrieve is named here and refused here.
//
// WHAT THIS MODULE IS NOT:
//   * It is not a URL resolver. It splits a written string into its syntactic
//     parts; it does not join it to a base, and it never consults configuration.
//   * It does not interpret `#fragment`. The fragment is SPLIT OFF because it is
//     not part of the locator and would otherwise become part of a filename --
//     that is URL syntax (ISO 4.9.3/N10 cites the same `#name` form). Choosing a
//     PROTO by that name is ISO 4.9.3 target selection and belongs to WD1.7-C.
//     B carries the fragment verbatim as provenance and never reads it.
//   * It decides no status. Statuses live in `retrieval.js`; this module reports
//     a form plus, for an unroutable form, the machine-readable reason why.
//
// FAIL CLOSED. An unrecognised or ambiguous spelling is classified as something
// that is NOT retrieved, never as "probably a relative path".
//
// Corpus grounding (WD1.7-A §7.3, denominator 2,672 written candidates):
//   absolute-http 41.73% - bare-relative 24.78% - urn 19.20% - root-relative
//   7.07% - parent-relative 5.43% - dot-relative 1.61% - empty 0.19%; and
//   ZERO file:, protocol-relative or windows-path references. The last three are
//   classified anyway so they can be refused safely rather than resolved.

// Every form a written candidate can take. Stable strings: callers branch on them.
const REFERENCE_FORM = Object.freeze({
  ABSOLUTE_HTTP: 'absolute-http',       // http:// or https://  -- routable via a configured mapping
  BARE_RELATIVE: 'bare-relative',       // foo.wrl               -- routable against the base
  DOT_RELATIVE: 'dot-relative',         // ./foo.wrl             -- routable against the base
  PARENT_RELATIVE: 'parent-relative',   // ../lib/foo.wrl        -- routable against the base
  ROOT_RELATIVE: 'root-relative',       // /protos/foo.wrl       -- URL-root-relative, NOT a disk path
  URN: 'urn',                           // urn:inet:...          -- conforming (N2), not retrievable here
  FILE: 'file',                         // file:///...           -- never followed
  PROTOCOL_RELATIVE: 'protocol-relative', // //host/path         -- not modelled
  WINDOWS_PATH: 'windows-path',         // C:\... or C:/...      -- never followed
  UNKNOWN_SCHEME: 'unknown-scheme',     // javascript:, ftp:, data:, ...
  EMPTY: 'empty',                       // "" -- names nothing
});

// Reasons a form is refused before routing. These are `reason` values on the
// eventual UNSUPPORTED_REFERENCE result; retrieval.js does not invent its own.
const CLASSIFY_REASON = Object.freeze({
  EMPTY_REFERENCE: 'empty-reference',
  URN_NOT_RETRIEVABLE: 'urn-not-retrievable',
  FILE_SCHEME: 'file-scheme-unsupported',
  PROTOCOL_RELATIVE: 'protocol-relative-unsupported',
  WINDOWS_PATH: 'windows-path-unsupported',
  UNKNOWN_SCHEME: 'unknown-scheme-unsupported',
  MALFORMED_HTTP_URL: 'malformed-http-url',
  QUERY_STRING: 'query-string-unsupported',
  PERCENT_ENCODING: 'percent-encoding-unsupported',
  BACKSLASH_SEPARATOR: 'backslash-separator-unsupported',
  CONTROL_CHARACTER: 'control-character-unsupported',
});

const { canonicalOrigin } = require('./url-origin');

// A leading drive letter must be recognised BEFORE scheme parsing, or `C:` reads
// as a one-character URL scheme (the same trap `src/world-project/path-policy.js`
// documents).
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const SCHEME = /^([A-Za-z][A-Za-z0-9+.\-]*):/;

// Split a written candidate at the FIRST '#'. Everything after it is the
// fragment, carried verbatim and never interpreted here.
function splitFragment(raw) {
  const hash = raw.indexOf('#');
  if (hash < 0) return { locator: raw, fragment: null };
  return { locator: raw.slice(0, hash), fragment: raw.slice(hash + 1) };
}

function unsupported(form, reason, extra) {
  return { form, routable: false, reason, ...extra };
}

// classifyReference(writtenUrl) -> frozen record:
//   { writtenUrl, trimmed, form, routable, reason|null, scheme|null,
//     locator, fragment|null, origin|null, originPath|null }
//
// `writtenUrl` is preserved EXACTLY as authored (provenance); `trimmed` is what
// classification actually inspected. Surrounding whitespace inside an MFString
// entry is authoring noise, not part of the locator, so it is trimmed -- and the
// fact that it was trimmed stays visible by keeping both fields.
//
// `origin` / `originPath` are populated only for ABSOLUTE_HTTP: the lowercased
// `scheme://host[:port]` and the path beginning with '/'. Scheme and host are
// lowercased because they are case-insensitive by URL definition; the PATH is
// never case-folded -- exact case is a boundary rule in this lane.
function classifyReference(writtenUrl) {
  const written = writtenUrl == null ? '' : String(writtenUrl);
  const trimmed = written.trim();
  const base = { writtenUrl: written, trimmed, scheme: null, fragment: null, origin: null, originPath: null };

  if (trimmed === '') {
    return freeze({ ...base, locator: '', ...unsupported(REFERENCE_FORM.EMPTY, CLASSIFY_REASON.EMPTY_REFERENCE) });
  }
  // A control character (incl. NUL) in a reference is never legitimate and is a
  // classic path-truncation trick against C-string APIs underneath fs.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return freeze({ ...base, locator: trimmed, ...unsupported(REFERENCE_FORM.UNKNOWN_SCHEME, CLASSIFY_REASON.CONTROL_CHARACTER) });
  }

  const { locator, fragment } = splitFragment(trimmed);
  const withFrag = { ...base, locator, fragment };

  if (WINDOWS_DRIVE.test(locator)) {
    return freeze({ ...withFrag, ...unsupported(REFERENCE_FORM.WINDOWS_PATH, CLASSIFY_REASON.WINDOWS_PATH) });
  }
  if (locator.startsWith('//')) {
    return freeze({ ...withFrag, ...unsupported(REFERENCE_FORM.PROTOCOL_RELATIVE, CLASSIFY_REASON.PROTOCOL_RELATIVE) });
  }

  const schemeMatch = SCHEME.exec(locator);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : null;
  const withScheme = { ...withFrag, scheme };

  if (scheme === 'urn') {
    return freeze({ ...withScheme, ...unsupported(REFERENCE_FORM.URN, CLASSIFY_REASON.URN_NOT_RETRIEVABLE) });
  }
  if (scheme === 'file') {
    return freeze({ ...withScheme, ...unsupported(REFERENCE_FORM.FILE, CLASSIFY_REASON.FILE_SCHEME) });
  }
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    return freeze({ ...withScheme, ...unsupported(REFERENCE_FORM.UNKNOWN_SCHEME, CLASSIFY_REASON.UNKNOWN_SCHEME) });
  }

  if (scheme === 'http' || scheme === 'https') {
    const parsed = parseHttpUrl(locator, scheme);
    if (!parsed) {
      return freeze({ ...withScheme, ...unsupported(REFERENCE_FORM.ABSOLUTE_HTTP, CLASSIFY_REASON.MALFORMED_HTTP_URL) });
    }
    const bad = rejectUnsafeLocatorChars(parsed.originPath);
    if (bad) return freeze({ ...withScheme, ...unsupported(REFERENCE_FORM.ABSOLUTE_HTTP, bad) });
    return freeze({
      ...withScheme,
      form: REFERENCE_FORM.ABSOLUTE_HTTP,
      routable: true,
      reason: null,
      origin: parsed.origin,
      originPath: parsed.originPath,
    });
  }

  // Scheme-less: a relative or URL-root-relative reference.
  const bad = rejectUnsafeLocatorChars(locator);
  const form = locator.startsWith('/')
    ? REFERENCE_FORM.ROOT_RELATIVE
    : locator.startsWith('./')
      ? REFERENCE_FORM.DOT_RELATIVE
      : locator === '..' || locator.startsWith('../')
        ? REFERENCE_FORM.PARENT_RELATIVE
        : REFERENCE_FORM.BARE_RELATIVE;
  if (bad) return freeze({ ...withScheme, ...unsupported(form, bad) });
  return freeze({ ...withScheme, form, routable: true, reason: null });
}

// Characters this substrate refuses to interpret rather than guess at.
//
//   '?'  a query string is a server-side mechanism an archive cannot honour.
//        Silently treating it as part of a filename would look up the wrong file.
//   '%'  percent-encoding is NOT decoded here. Decoding introduces `%2e%2e%2f`
//        traversal spellings that would then have to be re-checked, and the
//        corpus contains zero percent-encoded references (WD1.7-A §7.3), so the
//        safe option costs nothing measurable.
//   '\\' a backslash is not a URL separator. Converting it to '/' is a recovery
//        convention, and recovery conventions do not belong in strict retrieval.
//
// Each returns its own reason so the refusal is explainable, never a generic one.
function rejectUnsafeLocatorChars(locator) {
  if (locator.includes('?')) return CLASSIFY_REASON.QUERY_STRING;
  if (locator.includes('%')) return CLASSIFY_REASON.PERCENT_ENCODING;
  if (locator.includes('\\')) return CLASSIFY_REASON.BACKSLASH_SEPARATOR;
  return null;
}

// Split `scheme://authority[/path]` into its two halves BY HAND, and canonicalize
// only the authority.
//
// The split is manual because the WHATWG parser percent-encodes and re-spells
// PATHS, and a re-spelled path looks up a different file on disk. The AUTHORITY
// is then handed to the one canonicalization authority (`url-origin.js`), which
// does use the platform parser -- see that module for why the two halves are
// treated differently. Returns null for anything that is not a well-formed
// absolute http(s) URL with a usable authority.
function parseHttpUrl(locator, scheme) {
  const prefix = `${scheme}://`;
  if (!locator.toLowerCase().startsWith(prefix)) return null;
  const rest = locator.slice(prefix.length);
  if (rest === '') return null;
  const slash = rest.indexOf('/');
  const authority = slash < 0 ? rest : rest.slice(0, slash);
  const originPath = slash < 0 ? '/' : rest.slice(slash);
  // Userinfo is refused here rather than left to the parser, which would drop it
  // silently and let `http://attacker@www.cybertown.com/x` map to the configured
  // Cybertown archive.
  const origin = canonicalOrigin(scheme, authority);
  if (origin === null) return null;
  return { origin, originPath };
}

function freeze(o) { return Object.freeze(o); }

module.exports = { classifyReference, REFERENCE_FORM, CLASSIFY_REASON };
