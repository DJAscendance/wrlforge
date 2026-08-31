'use strict';
// Narrow JSON-file reader used by the QA harnesses. Strips a leading UTF-8
// BOM so a job file written by PowerShell (`Out-File -Encoding utf8` emits a
// BOM, a PowerShell 5.1 quirk) is accepted by `JSON.parse` without changing
// the generators. Per the Cross-Platform-Beta correction pass, this is a
// single-line read-side fix; the generators (PowerShell scripts) stay as they
// are. No new dependency.
//
// Behaviour:
//   - Reads the file as UTF-8 and strips one leading U+FEFF if present.
//   - Throws the standard SyntaxError if the body is not valid JSON (matching
//     `JSON.parse(fs.readFileSync(file, 'utf8'))` for BOM-free inputs).
//
// A regression test in `test/visual-qa/json-file.test.js` proves both the
// round-trip on a BOM-free input and the BOM-stripped parse on a BOM-prefixed
// input that PowerShell would write.

const fs = require('fs');

function readJsonFile(filePath, encoding) {
  if (encoding === undefined) encoding = 'utf8';
  let text = fs.readFileSync(filePath, encoding);
  // Strip a single leading UTF-8 BOM (U+FEFF) if present.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return JSON.parse(text);
}

module.exports = { readJsonFile };