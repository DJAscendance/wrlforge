'use strict';
// Regression test for the QA JSON-file BOM-strip reader added by the
// Cross-Platform-Beta correction pass.
//
// The Tier-3 PowerShell smoke script writes its jobs file with
// `Out-File -Encoding utf8`, which (on PowerShell 5.1, which the sanctioned
// Windows 11 guest runs) emits UTF-8 with BOM. Plain `JSON.parse(fs.readFileSync
// (file, 'utf8'))` rejects the leading U+FEFF with a SyntaxError, which is what
// the independent QA found.
//
// This test reproduces that failure on a BOM-free input and on a BOM-prefixed
// input that PowerShell would write, and proves the same parser the CLI uses
// now accepts the BOM-prefixed file without crashing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readJsonFile } = require('../../qa/visual-qa/json-file');

function writeFileWithBOM(filePath, text) {
  // Manually prepend the UTF-8 BOM (U+FEFF) to simulate what PowerShell writes.
  const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
  const body = Buffer.from(text, 'utf8');
  fs.writeFileSync(filePath, Buffer.concat([bom, body]));
}

const SAMPLE = JSON.stringify([{ id: 'tier3-smoke', json: true, mode: 'fit' }]);

test('regression: readJsonFile parses a BOM-free JSON file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-json-file-'));
  const f = path.join(tmp, 'jobs.json');
  fs.writeFileSync(f, SAMPLE, 'utf8');
  const got = readJsonFile(f);
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 'tier3-smoke');
  assert.equal(got[0].json, true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('regression: readJsonFile strips a leading UTF-8 BOM (PowerShell -Encoding utf8 quirk)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-json-file-'));
  const f = path.join(tmp, 'jobs.json');
  writeFileWithBOM(f, SAMPLE);
  // Sanity: confirm the file on disk really starts with the U+FEFF byte sequence.
  const bytes = fs.readFileSync(f);
  assert.equal(bytes[0], 0xEF);
  assert.equal(bytes[1], 0xBB);
  assert.equal(bytes[2], 0xBF);
  // The reader must accept the BOM and parse the body identically.
  const got = readJsonFile(f);
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 'tier3-smoke');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('regression: plain JSON.parse on a BOM-prefixed file (old failure)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-json-file-'));
  const f = path.join(tmp, 'jobs.json');
  writeFileWithBOM(f, SAMPLE);
  // Document the failure mode the new reader exists to fix: raw
  // `JSON.parse(fs.readFileSync(file, 'utf8'))` cannot accept a leading BOM.
  assert.throws(
    () => JSON.parse(fs.readFileSync(f, 'utf8')),
    /Unexpected token|Unexpected BOM/i,
  );
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('regression: readJsonFile still throws on a non-JSON body', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-json-file-'));
  const f = path.join(tmp, 'jobs.json');
  fs.writeFileSync(f, 'not json at all', 'utf8');
  assert.throws(() => readJsonFile(f), /JSON/i);
  fs.rmSync(tmp, { recursive: true, force: true });
});