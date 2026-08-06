'use strict';
// PERMANENT byte-exact tokenizer round-trip contract (Phase WD1.1).
//
// This is WD1's guard rail. The whole visual-authoring design rests on one
// property: the tokenizer is lossless, so an edit can be a span-anchored byte
// replacement against text that is NEVER regenerated. If this file ever goes
// red, the premise is broken and everything downstream is invalid -- fix the
// tokenizer or stop, do NOT weaken a fixture to make it pass.
//
// THE CONTRACT
//   concat over tokens of ( each leadingTrivia lexeme ++ the token's own lexeme )
//     ===  the exact input text
//
// No separate end-of-file handling is required: the tokenizer emits a final EOF
// token whose own lexeme is empty and whose `leadingTrivia` carries the file's
// trailing whitespace/commas/comments, so trailing trivia is covered by the same
// concatenation (src/vrml/tokenizer.js `readTrivia` + the EOF push).
//
// Offsets in this project are indices into the DECODED JavaScript string, not
// byte offsets. The corpus sweep therefore decodes UTF-8, reconstructs, re-encodes
// to UTF-8, and compares Buffers -- so "byte-exact" is asserted literally, and a
// lossy decode could not hide inside a string-only comparison.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { tokenize } = require('../../src/vrml/tokenizer');
const { CODE } = require('../../src/vrml/diagnostics');

const REPO = path.join(__dirname, '..', '..');

// Both fixture trees the root .gitattributes pins as byte-exact oracles (`-text`),
// so their bytes are identical on every platform and this contract means the same
// thing on Linux and Windows.
const FIXTURE_ROOTS = ['test/fixtures', 'spikes/xite-mall-fit/fixtures'];
const VRML_EXT = /\.(?:wrl|wrz|vrml|x3dv)$/i;

// --- exclusions (each explicit, narrow, and re-asserted below) ---------------
//
// 1. GZIP fixtures are excluded from the byte-exact-against-file-bytes sweep:
//    their bytes are a DEFLATE stream, not tokenizer input. They are not skipped
//    though -- they are decompressed through the production loader and round-tripped
//    as text in a second contract below, so their content is still covered.
// 2. INTENTIONALLY-CORRUPT gzip fixtures exist to prove the loader refuses a
//    truncated archive; there is no text to round-trip at all. Excluded by exact
//    basename, and asserted to really be undecompressable so this exclusion can
//    never quietly widen to cover a genuine regression.
const CORRUPT_GZIP_BASENAME = 'gz-corrupt.wrl';

const isGzip = (buf) => buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;

function walkFiles(absDir, out = []) {
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) walkFiles(abs, out);
    else out.push(abs);
  }
  return out;
}

// Every VRML-ish fixture in the repo, as repo-relative POSIX paths, sorted for
// stable output. Discovery is derived from the tree, never hardcoded, so a new
// fixture is covered by this contract the moment it lands.
function discoverFixtures() {
  const found = [];
  for (const root of FIXTURE_ROOTS) {
    const abs = path.join(REPO, root);
    if (!fs.existsSync(abs)) continue;
    for (const file of walkFiles(abs)) {
      if (VRML_EXT.test(file)) found.push(path.relative(REPO, file).split(path.sep).join('/'));
    }
  }
  return found.sort();
}

// The contract itself.
function reconstruct(text) {
  const { tokens } = tokenize(text);
  let out = '';
  for (const tok of tokens) {
    for (const tr of tok.leadingTrivia || []) out += tr.lexeme;
    out += tok.lexeme;
  }
  return out;
}

const FIXTURES = discoverFixtures();

test('fixture discovery finds the VRML corpus (guards against a vacuous sweep)', () => {
  // A broken glob returning zero files would make every assertion below pass
  // trivially. Floor, not an exact count: fixtures are expected to be added.
  assert.ok(FIXTURES.length >= 60, `expected >=60 VRML fixtures, discovered ${FIXTURES.length}`);
  for (const root of FIXTURE_ROOTS) {
    assert.ok(FIXTURES.some((f) => f.startsWith(`${root}/`)), `no fixtures discovered under ${root}`);
  }
});

test('every plain-text VRML fixture round-trips BYTE-EXACTLY through the tokenizer', () => {
  const mismatches = [];
  const tested = [];
  const excludedGzip = [];

  for (const rel of FIXTURES) {
    const raw = fs.readFileSync(path.join(REPO, rel));
    if (isGzip(raw)) { excludedGzip.push(rel); continue; }

    // Decode exactly the way production does (src/preview/wrl-source.js: UTF-8),
    // and prove the decode itself is lossless before trusting the comparison.
    const text = raw.toString('utf8');
    assert.deepEqual(Buffer.from(text, 'utf8'), raw,
      `${rel}: is not valid UTF-8; it must be excluded explicitly, not compared`);

    const rebuilt = Buffer.from(reconstruct(text), 'utf8');
    if (!rebuilt.equals(raw)) mismatches.push(rel);
    tested.push(rel);
  }

  // Reported totals (Part A deliverable).
  console.log(`  round-trip: discovered=${FIXTURES.length} tested=${tested.length} `
    + `excluded=${excludedGzip.length} (gzip) mismatches=${mismatches.length}`);

  assert.deepEqual(mismatches, [], 'byte-exact round-trip FAILED -- do not weaken the fixture, fix or report');
  assert.equal(tested.length + excludedGzip.length, FIXTURES.length, 'every discovered fixture must be tested or explicitly excluded');
  assert.ok(tested.length >= 50, `expected >=50 plain-text fixtures, tested ${tested.length}`);
});

test('gzip fixtures round-trip exactly once decompressed through the production loader', () => {
  // Excluded from the byte sweep above (their bytes are DEFLATE), but their TEXT
  // is real production-shaped content -- notably the gzipped World fixtures -- so
  // it is covered here rather than skipped.
  const tested = [];
  const corrupt = [];
  const mismatches = [];

  for (const rel of FIXTURES) {
    const raw = fs.readFileSync(path.join(REPO, rel));
    if (!isGzip(raw)) continue;
    if (path.basename(rel) === CORRUPT_GZIP_BASENAME) {
      assert.throws(() => zlib.gunzipSync(raw), `${rel} is excluded as intentionally corrupt but decompressed fine`);
      corrupt.push(rel);
      continue;
    }
    const text = zlib.gunzipSync(raw).toString('utf8');
    if (reconstruct(text) !== text) mismatches.push(rel);
    tested.push(rel);
  }

  console.log(`  round-trip (gzip): tested=${tested.length} excluded=${corrupt.length} (intentionally corrupt) mismatches=${mismatches.length}`);
  assert.deepEqual(mismatches, []);
  assert.ok(tested.length >= 6, `expected >=6 valid gzip fixtures, tested ${tested.length}`);
});

test('the corpus actually exercises the constructs this contract claims to protect', () => {
  // Without this, the sweep could be green because the fixtures are bland. Each
  // entry asserts at least one TESTED fixture really contains the construct.
  const texts = FIXTURES
    .map((rel) => ({ rel, raw: fs.readFileSync(path.join(REPO, rel)) }))
    .filter(({ raw }) => !isGzip(raw))
    .map(({ rel, raw }) => ({ rel, text: raw.toString('utf8') }));

  const present = (label, re) => assert.ok(texts.some(({ text }) => re.test(text)),
    `no fixture exercises ${label}; the round-trip contract is weaker than it claims`);

  present('CRLF line endings', /\r\n/);
  present('LF line endings', /(?<!\r)\n/);
  present('comments', /(^|\n)[ \t]*#(?!VRML)/);
  present('commas used as VRML whitespace', /,/);
  present('blank lines', /\n[ \t]*\r?\n/);
  present('quoted strings', /"/);
  present('the #VRML header', /^#VRML/m);
  present('exponent-form numbers', /[0-9][eE][-+]?[0-9]/);
  present('hex numbers', /0[xX][0-9a-fA-F]/);
  present('MFNode arrays', /\[/);
});

// --- constructs the corpus does not currently contain -----------------------
// Covered as synthetic sources rather than new fixture files: a lone-CR or
// trailing-whitespace file on disk is exactly the kind of thing a stray
// .gitattributes change or an editor-on-save rule silently rewrites, which would
// turn a real contract into a flaky one. Inline strings cannot be rewritten.
const CONSTRUCTS = [
  ['LF newlines', '#VRML V2.0 utf8\nWorldInfo {\n  title "a"\n}\n'],
  ['CRLF newlines', '#VRML V2.0 utf8\r\nWorldInfo {\r\n  title "a"\r\n}\r\n'],
  ['lone CR newlines', '#VRML V2.0 utf8\rWorldInfo {\r  title "a"\r}\r'],
  ['mixed LF/CRLF/CR', '#VRML V2.0 utf8\nA {\r\n b 1\r c 2\n}\n'],
  ['tabs', '#VRML V2.0 utf8\n\tWorldInfo {\n\t\ttitle\t"a"\n\t}\n'],
  ['runs of spaces', '#VRML V2.0 utf8\n   WorldInfo    {   title   "a"   }   \n'],
  ['blank lines', '#VRML V2.0 utf8\n\n\nWorldInfo {}\n\n\n'],
  ['comments', '#VRML V2.0 utf8\n# lead\nWorldInfo {} # trail\n# tail\n'],
  ['a comment with no trailing newline', '#VRML V2.0 utf8\nWorldInfo {}\n# unterminated comment'],
  ['commas as whitespace', '#VRML V2.0 utf8\nA { b [ 1, 2, 3 ], c 4,5,6 }\n'],
  ['numeric spelling preserved verbatim', '#VRML V2.0 utf8\nA { b 1.500 c 0.10 d 2. e .25 f +7 g -0 h 1E+3 i 0x1F }\n'],
  ['quoted strings incl. escapes', '#VRML V2.0 utf8\nA { url "a\\"b" title "c\\\\d" empty "" }\n'],
  ['a multi-line quoted string', '#VRML V2.0 utf8\nScript { url "vrmlscript:\n  function a() {\n    x = 1;\n  }\n" }\n'],
  ['non-canonical header spelling', '#VRML V2.0 UTF8\nWorldInfo {}\n'],
  ['header with extra trailing text', '#VRML V2.0 utf8 some vendor note\nWorldInfo {}\n'],
  ['leading blank lines before the header', '\n\n#VRML V2.0 utf8\nWorldInfo {}\n'],
  ['trailing whitespace on a line', '#VRML V2.0 utf8\nWorldInfo {}   \n   \n'],
  ['a missing final newline', '#VRML V2.0 utf8\nWorldInfo {}'],
  ['nothing but a header, no newline', '#VRML V2.0 utf8'],
  ['an empty file', ''],
  ['whitespace-only content', '   \n\t\n  '],
  ['no header at all', 'WorldInfo { title "a" }\n'],
  ['non-ASCII UTF-8 content', '#VRML V2.0 utf8\nWorldInfo { title "café — 世界 🌐" }\n'],
  ['unknown/extension node and field names', '#VRML V2.0 utf8\nblaxxun_Vendor { weird-Field+Name 1 }\n'],
  ['hyphenated DEF names (real Cybertown corpus shape)', '#VRML V2.0 utf8\nDEF phb_left-COORD Coordinate { point [ 0 0 0 ] }\n'],
  ['PROTO and IS', '#VRML V2.0 utf8\nPROTO P [ field SFFloat r 1 ] { Sphere { radius IS r } }\nP {}\n'],
  ['EXTERNPROTO', '#VRML V2.0 utf8\nEXTERNPROTO E [ field SFFloat r ] [ "e.wrl#E" ]\n'],
  ['ROUTE statements', '#VRML V2.0 utf8\nDEF T TimeSensor {}\nDEF I PositionInterpolator {}\nROUTE T.fraction_changed TO I.set_fraction\n'],
  ['recovered malformed source (unclosed brace)', '#VRML V2.0 utf8\nTransform { children [ Shape {\n'],
  ['recovered malformed source (stray tokens)', '#VRML V2.0 utf8\nA { b } } ] TO\n'],
  ['an unterminated string', '#VRML V2.0 utf8\nA { url "never closed\n'],
  ['CRLF inside a multi-line string', '#VRML V2.0 utf8\r\nScript { url "vrmlscript:\r\n  x = 1;\r\n" }\r\n'],
];

test('every whitespace, comment, numeric and structural construct round-trips byte-exactly', () => {
  for (const [label, source] of CONSTRUCTS) {
    assert.equal(reconstruct(source), source, `round-trip lost bytes for: ${label}`);
    // And byte-exact once encoded, which is the property that actually matters
    // for a file on disk (non-ASCII content is the case a string compare alone
    // would not fully pin down).
    assert.deepEqual(Buffer.from(reconstruct(source), 'utf8'), Buffer.from(source, 'utf8'), label);
  }
});

test('DOCUMENTED CURRENT BEHAVIOUR: unexpected-character recovery is not byte-preserving', () => {
  // THIS TEST RECORDS WHAT THE TOKENIZER DOES TODAY. It is NOT an endorsement of
  // that behaviour, NOT a claim that it is desirable, and NOT a compatibility
  // promise -- no caller may rely on these bytes being dropped.
  //
  // Pre-existing behaviour of src/vrml/tokenizer.js, unchanged by WD1.1: on an
  // unexpected character the tokenizer records a diagnostic and skips the
  // character without emitting a token, which also drops the trivia collected in
  // that iteration -- so those bytes cannot be reconstructed.
  //
  // Only `\` and `'` (both in ID_DELIM but handled by no branch) and control
  // characters reach that path. NO fixture in either tree contains one, which is
  // why the corpus sweep above is a clean 0-mismatch, and the WD1 patch model is
  // unaffected regardless: an edit replaces a byte span in text that is never
  // regenerated from tokens.
  //
  // Written down so the limit stays known rather than assumed. If a future
  // tokenizer-hardening lane makes this recovery path byte-preserving, that is an
  // IMPROVEMENT: update this test alongside the behaviour change rather than
  // treating the failure as a regression.
  const rejected = ['\\', "'", '\u0000', '\u007f', '\u0001'];
  for (const ch of rejected) {
    const source = `#VRML V2.0 utf8\nA { b ${ch} 1 }\n`;
    const { diagnostics } = tokenize(source);
    assert.ok(diagnostics.some((d) => d.code === CODE.UNEXPECTED_CHAR),
      `expected an unexpected-character diagnostic for ${JSON.stringify(ch)}`);
    assert.notEqual(reconstruct(source), source,
      `${JSON.stringify(ch)} now round-trips -- the tokenizer's recovery path changed. `
      + 'If that was intentional, update this test to match the new behaviour.');
  }

  // Every OTHER printable character the corpus might contain does round-trip,
  // including the ones that merely look exotic.
  for (const ch of ['@', '~', '!', '$', '%', '^', '&', '*', '(', ')', '/', '|', ':', ';', '<', '>', '?', '`', '=']) {
    const source = `#VRML V2.0 utf8\nA { b ${ch} 1 }\n`;
    assert.equal(reconstruct(source), source, `round-trip lost bytes for ${JSON.stringify(ch)}`);
  }
});
