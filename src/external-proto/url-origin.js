'use strict';
// WD1.7-B -- the SINGLE origin canonicalization authority for the lane.
//
// PURE: no fs, no network. It answers one question:
//
//   Given a scheme and an authority, what is the canonical URL origin that
//   mapping identity is decided on?
//
// WHY THIS IS ITS OWN MODULE. An origin is produced in two places -- when a
// configured source prefix is normalised, and when a written absolute-http
// reference is classified -- and those two must agree exactly or a mapping that
// looks configured silently never matches. Sharing one function is the only way
// to guarantee it; two "obviously equivalent" implementations is how the
// asymmetry gets introduced later.
//
// WHY WHATWG `URL` HERE, AND ONLY HERE. The rest of this lane deliberately parses
// URLs by hand, because the WHATWG parser percent-encodes and re-spells PATHS,
// and a re-spelled path looks up a different file on disk. The AUTHORITY is the
// opposite case: default-port elision, port-number normalisation, host
// lowercasing, IPv6 bracket handling and invalid-port rejection are exactly the
// rules we want, they are fiddly, and re-deriving them by hand would be
// re-implementing a standard badly. So the platform parser is used for the
// authority, deliberately, and the path is never shown to it.
//
// WHAT CANONICALIZATION MEANS HERE (WD1.7-B correction 1, after independent QA):
//
//   http://example.com      ==  http://example.com:80        default port elided
//   https://example.com     ==  https://example.com:443      default port elided
//   http://example.com      !=  http://example.com:8080      non-default kept
//   https://example.com     !=  https://example.com:8443     non-default kept
//   http://example.com      !=  https://example.com          scheme is part of it
//   http://EXAMPLE.com      ==  http://example.com           host case-insensitive
//   http://bücher.example   ==  http://xn--bcher-kva.example IDN -> punycode
//
// This is URL canonicalization and nothing more. It does NOT weaken the
// explicit-mapping requirement: an origin still has to be configured, there is
// still no host stripping, no suffix search and no unknown-origin fallback.
//
// USERINFO IS REFUSED, NOT DROPPED. `new URL('http://user@h/').origin` is
// `http://h` -- the parser discards the userinfo silently. Accepting that would
// let `http://attacker@www.cybertown.com/x.wrl` map to the configured Cybertown
// archive, so the userinfo is detected and the whole reference refused instead.

// The two schemes this substrate models. Anything else is refused upstream by
// classification, so this table is complete for the lane rather than a subset
// of a general URL implementation.
const SUPPORTED_SCHEMES = Object.freeze(['http', 'https']);

// canonicalOrigin(scheme, authority) -> 'scheme://host[:port]' | null
//
// `scheme` is already lowercased by the caller; `authority` is the raw
// `host[:port]` (or `user@host`) text between `//` and the first `/`.
// Returns null for anything that is not a well-formed, userinfo-free authority
// on a supported scheme -- the caller turns that into an explicit refusal.
function canonicalOrigin(scheme, authority) {
  if (typeof scheme !== 'string' || !SUPPORTED_SCHEMES.includes(scheme)) return null;
  if (typeof authority !== 'string' || authority === '') return null;
  // Reject before parsing: `@` and any character the parser would treat as a
  // path/query/fragment boundary means the caller mis-split the URL.
  if (/[@/\\?#]/.test(authority)) return null;
  let url;
  try {
    url = new URL(`${scheme}://${authority}/`);
  } catch {
    return null;            // invalid host, out-of-range port, empty host, ...
  }
  // Defence in depth: the parser must not have invented credentials or changed
  // the scheme out from under us.
  if (url.username !== '' || url.password !== '') return null;
  if (url.protocol !== `${scheme}:`) return null;
  if (url.hostname === '') return null;
  // `origin` is already `scheme://host[:port]` with the default port elided.
  return url.origin;
}

module.exports = { canonicalOrigin, SUPPORTED_SCHEMES };
