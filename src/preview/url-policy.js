'use strict';
// Pure URL-policy helpers for the embedded X_ITE preview. No Electron, no fs --
// fully unit-testable in node:test. Two separate concerns:
//
//   1. isBlockedPreviewUrl(url): the network-layer gate wired into Electron's
//      session.webRequest.onBeforeRequest (see main.js). It returns true for any
//      remote / network-capable scheme, so an authored VRML `url` pointing at
//      http(s)/ws/ftp/protocol-relative hosts can never trigger an outbound
//      request -- even if a CSP directive were somehow bypassed. This is the
//      authoritative, layered control the task requires (not just browser.baseURL).
//
//   2. scanRemoteUrls(text): a preflight over the VRML source's `url [...]`
//      fields, surfacing remote references to the user as warnings before load.
//      (The Mall Item text validator also hard-fails these; this is the
//      preview-side advisory that names them.)
//
// The renderer only ever resolves LOCAL assets, so the allow-list is exactly the
// local schemes X_ITE needs for the app bundle and the item's own directory.
const ALLOWED_SCHEMES = new Set([
  'file', 'data', 'blob', 'devtools', 'chrome', 'chrome-extension', 'about',
]);

// Leading scheme of a URL string, lower-cased, or null for a scheme-less
// (relative) reference. `//host/x` is intentionally NOT a scheme here.
function schemeOf(url) {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(String(url == null ? '' : url).trim());
  return m ? m[1].toLowerCase() : null;
}

// True if a request to `url` must be blocked. Any non-local scheme is blocked,
// as is a protocol-relative `//host/...` URL (which resolves to http(s)). A
// bare relative path (no scheme) is a local asset resolved against the file://
// base URL, so it is allowed here and is enforced by the base-dir confinement.
function isBlockedPreviewUrl(url) {
  const u = String(url == null ? '' : url).trim();
  if (u === '') return false;
  if (/^\/\//.test(u)) return true; // protocol-relative -> remote
  const scheme = schemeOf(u);
  if (scheme === null) return false; // relative path -> local
  return !ALLOWED_SCHEMES.has(scheme);
}

// Extract remote (network-capable) url references from VRML text's `url` fields.
// Returns a de-duplicated list; empty when the item references only local files.
function scanRemoteUrls(text) {
  const urls = [...String(text == null ? '' : text).matchAll(/url\s*\[?\s*"([^"]*)"/g)].map((m) => m[1]);
  const remote = [];
  for (const raw of urls) {
    const t = raw.trim();
    if (/^https?:\/\//i.test(t) || /^\/\//.test(t) || /^(ws|wss|ftp):/i.test(t)) {
      remote.push(t);
    }
  }
  return [...new Set(remote)];
}

module.exports = { isBlockedPreviewUrl, scanRemoteUrls, schemeOf, ALLOWED_SCHEMES };
