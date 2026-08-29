'use strict';
// WD1.7-B -- written-reference classification tests.
//
// Classification runs BEFORE anything touches a filesystem, so this file is the
// first line of the lane's security argument: every form that must never become
// a path read is named and refused here, and the refusal is proven to be a
// distinct, machine-readable reason rather than a generic failure.
//
// Fixtures are written in this file. Nothing under spikes/ is imported.

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyReference, REFERENCE_FORM, CLASSIFY_REASON } = require('../../src/external-proto/reference-forms');

function form(url) { return classifyReference(url).form; }
function reason(url) { return classifyReference(url).reason; }

test('classifies the six observed corpus forms', () => {
  assert.equal(form('http://www.cybertown.com/externprotos/bxx/shared.wrl#BlaxxunZone'), REFERENCE_FORM.ABSOLUTE_HTTP);
  assert.equal(form('slot.wrl'), REFERENCE_FORM.BARE_RELATIVE);
  assert.equal(form('urn:inet:blaxxun.com:node:BspGroup'), REFERENCE_FORM.URN);
  assert.equal(form('/externprotos/nurbs_xite.wrl#NurbsSurface'), REFERENCE_FORM.ROOT_RELATIVE);
  assert.equal(form('../../ent_complex/elevator/elevator.wrl#CasinoElevator'), REFERENCE_FORM.PARENT_RELATIVE);
  assert.equal(form('./house_proto.wrl#HouseProto'), REFERENCE_FORM.DOT_RELATIVE);
  assert.equal(form(''), REFERENCE_FORM.EMPTY);
});

test('classifies the three forms the corpus never contains, so they can be refused', () => {
  assert.equal(form('file:///etc/passwd'), REFERENCE_FORM.FILE);
  assert.equal(form('//evil.example/x.wrl'), REFERENCE_FORM.PROTOCOL_RELATIVE);
  assert.equal(form('C:\\Windows\\system32\\drivers\\etc\\hosts'), REFERENCE_FORM.WINDOWS_PATH);
  assert.equal(form('C:/Windows/x.wrl'), REFERENCE_FORM.WINDOWS_PATH);
});

test('a Windows drive letter is recognised BEFORE scheme parsing', () => {
  // `C:` would otherwise read as a one-character URL scheme.
  const c = classifyReference('C:\\lib\\proto.wrl');
  assert.equal(c.form, REFERENCE_FORM.WINDOWS_PATH);
  assert.equal(c.scheme, null);
  assert.equal(c.routable, false);
});

test('unknown and executable schemes are refused, never treated as paths', () => {
  for (const url of ['javascript:alert(1)', 'vrmlscript:x', 'data:text/plain,hi', 'ftp://h/x.wrl', 'ws://h/x']) {
    const c = classifyReference(url);
    assert.equal(c.form, REFERENCE_FORM.UNKNOWN_SCHEME, url);
    assert.equal(c.routable, false, url);
    assert.equal(c.reason, CLASSIFY_REASON.UNKNOWN_SCHEME, url);
  }
});

test('every unroutable form carries its OWN reason (no generic failure)', () => {
  const pairs = [
    ['', CLASSIFY_REASON.EMPTY_REFERENCE],
    ['urn:x:y', CLASSIFY_REASON.URN_NOT_RETRIEVABLE],
    ['file:///x', CLASSIFY_REASON.FILE_SCHEME],
    ['//h/x', CLASSIFY_REASON.PROTOCOL_RELATIVE],
    ['C:\\x', CLASSIFY_REASON.WINDOWS_PATH],
    ['gopher://h/x', CLASSIFY_REASON.UNKNOWN_SCHEME],
    ['a.wrl?v=2', CLASSIFY_REASON.QUERY_STRING],
    ['a%2e%2e%2fb.wrl', CLASSIFY_REASON.PERCENT_ENCODING],
    ['lib\\proto.wrl', CLASSIFY_REASON.BACKSLASH_SEPARATOR],
    ['a\u0000b.wrl', CLASSIFY_REASON.CONTROL_CHARACTER],
  ];
  const seen = new Set();
  for (const [url, want] of pairs) {
    assert.equal(reason(url), want, url);
    seen.add(want);
  }
  assert.equal(seen.size, pairs.length, 'reasons must be distinct');
});

test('percent-encoding is refused rather than decoded (traversal spellings)', () => {
  // `%2e%2e%2f` decodes to `../`. Decoding here would create a traversal
  // spelling that the path layer would then have to re-detect.
  const c = classifyReference('http://h/a/%2e%2e%2f%2e%2e%2fetc/passwd');
  assert.equal(c.routable, false);
  assert.equal(c.reason, CLASSIFY_REASON.PERCENT_ENCODING);
});

test('a backslash in a scheme-less reference is refused, not converted to "/"', () => {
  const c = classifyReference('..\\..\\..\\etc\\passwd');
  assert.equal(c.routable, false);
  assert.equal(c.reason, CLASSIFY_REASON.BACKSLASH_SEPARATOR);
});

test('the fragment is SPLIT OFF and carried verbatim, never interpreted', () => {
  const c = classifyReference('http://h/lib/shared.wrl#BlaxxunZone');
  assert.equal(c.fragment, 'BlaxxunZone');
  assert.equal(c.locator, 'http://h/lib/shared.wrl');
  assert.equal(c.originPath, '/lib/shared.wrl');
  // Only the FIRST '#' splits; the rest is fragment text.
  assert.equal(classifyReference('a.wrl#One#Two').fragment, 'One#Two');
  assert.equal(classifyReference('a.wrl').fragment, null);
});

test('an empty fragment is preserved as "" and does not change the locator', () => {
  const c = classifyReference('a.wrl#');
  assert.equal(c.fragment, '');
  assert.equal(c.locator, 'a.wrl');
  assert.equal(c.routable, true);
});

test('scheme and host are lowercased for matching; the PATH never is', () => {
  const c = classifyReference('HTTP://WWW.Cybertown.COM/3D/Home.WRL');
  assert.equal(c.origin, 'http://www.cybertown.com');
  assert.equal(c.originPath, '/3D/Home.WRL');
});

test('a DEFAULT port canonicalizes away; a non-default port is preserved', () => {
  // WD1.7-B correction 1. `http://h` and `http://h:80` are the same namespace,
  // and so are `https://h` and `https://h:443`. Anything else is not.
  assert.equal(classifyReference('http://h/x.wrl').origin, 'http://h');
  assert.equal(classifyReference('http://h:80/x.wrl').origin, 'http://h');
  assert.equal(classifyReference('https://h/x.wrl').origin, 'https://h');
  assert.equal(classifyReference('https://h:443/x.wrl').origin, 'https://h');
  assert.equal(classifyReference('http://h:8080/x.wrl').origin, 'http://h:8080');
  assert.equal(classifyReference('https://h:8443/x.wrl').origin, 'https://h:8443');
});

test('canonicalization never merges the two schemes, or a cross-scheme default port', () => {
  assert.notEqual(classifyReference('http://h/x.wrl').origin, classifyReference('https://h/x.wrl').origin);
  // 443 is not http's default and 80 is not https's, so neither is elided.
  assert.equal(classifyReference('http://h:443/x.wrl').origin, 'http://h:443');
  assert.equal(classifyReference('https://h:80/x.wrl').origin, 'https://h:80');
});

test('the authority is canonicalized the way URLs define it, and the path is not', () => {
  assert.equal(classifyReference('http://h:080/x.wrl').origin, 'http://h', 'a leading-zero port normalises');
  assert.equal(classifyReference('http://h:/x.wrl').origin, 'http://h', 'an empty port means the default');
  assert.equal(classifyReference('HTTP://H/Externprotos/Shared.WRL').originPath, '/Externprotos/Shared.WRL');
});

test('malformed absolute http URLs are refused, not half-parsed', () => {
  // `http://user@h/` REFUSED, never silently reduced to `http://h/`: the WHATWG
  // parser drops userinfo, and accepting that would let
  // `http://attacker@www.cybertown.com/x` map to the configured Cybertown archive.
  for (const url of ['http://', 'http:///x.wrl', 'http://user@h/x.wrl', 'http://h:abc/x.wrl', 'http://h:99999/x.wrl']) {
    const c = classifyReference(url);
    assert.equal(c.routable, false, url);
    assert.equal(c.reason, CLASSIFY_REASON.MALFORMED_HTTP_URL, url);
  }
});

test('an http URL with no path gets originPath "/"', () => {
  const c = classifyReference('http://h');
  assert.equal(c.routable, true);
  assert.equal(c.originPath, '/');
});

test('whitespace is trimmed for classification and the written form is preserved', () => {
  const c = classifyReference('  slot.wrl  ');
  assert.equal(c.writtenUrl, '  slot.wrl  ');
  assert.equal(c.trimmed, 'slot.wrl');
  assert.equal(c.form, REFERENCE_FORM.BARE_RELATIVE);
  assert.equal(classifyReference('   ').form, REFERENCE_FORM.EMPTY);
});

test('null/undefined are classified as empty rather than throwing', () => {
  assert.equal(classifyReference(null).form, REFERENCE_FORM.EMPTY);
  assert.equal(classifyReference(undefined).form, REFERENCE_FORM.EMPTY);
});

test('".." alone is parent-relative; "..lib" is not', () => {
  assert.equal(form('..'), REFERENCE_FORM.PARENT_RELATIVE);
  assert.equal(form('../a.wrl'), REFERENCE_FORM.PARENT_RELATIVE);
  assert.equal(form('..lib/a.wrl'), REFERENCE_FORM.BARE_RELATIVE);
  assert.equal(form('.hidden.wrl'), REFERENCE_FORM.BARE_RELATIVE);
});

test('the classification record is frozen', () => {
  const c = classifyReference('a.wrl');
  assert.ok(Object.isFrozen(c));
  assert.throws(() => { 'use strict'; c.form = 'x'; }, TypeError);
});

test('the module is pure: it requires no filesystem or network capability', () => {
  const src = require('node:fs').readFileSync(require.resolve('../../src/external-proto/reference-forms'), 'utf8');
  for (const forbidden of ["require('fs')", 'require("fs")', "require('node:fs')", "require('zlib')", "require('http')", "require('https')", 'fetch(']) {
    assert.ok(!src.includes(forbidden), `reference-forms.js must not contain ${forbidden}`);
  }
});
