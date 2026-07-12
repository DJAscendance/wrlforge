'use strict';
// Asset-reference tests (Phase 7A): url-field extraction, inline-script handling,
// and PARITY with the production World Project scanner across real fixtures.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('../../src/vrml');
const { extractUrlTriples, classifyAssetRefs } = require('../../src/vrml/asset-refs');
const prod = require('../../src/world-project/url-fields');
const { readWrlSource } = require('../../src/preview/wrl-source');

// Every .wrl fixture reachable through the normal loaders (plain + gzip), minus
// deliberately-corrupt archives the loader rejects before parsing.
function allWrlFixtures() {
  const roots = ['test/fixtures', 'test/fixtures/vrml', 'test/fixtures/preview', 'test/fixtures/world'];
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.wrl') && !name.endsWith('.edit.wrl')) out.push(p);
    }
  };
  walk('test/fixtures');
  return out;
}

test('inline script bodies are recognized, never treated as file deps', () => {
  const r = parse(readWrlSource('test/fixtures/vrml/script.wrl').text);
  const c = classifyAssetRefs(r.tree);
  assert.deepEqual(c.local, ['helper.js']);
  assert.equal(c.inlineScripts.length, 2);
  assert.ok(c.inlineScripts.every((s) => /^(vrml|java|ecma)script:/.test(s)));
});

test('remote vs local classification', () => {
  const r = parse(readWrlSource('test/fixtures/vrml/mfstring-urls.wrl').text);
  const c = classifyAssetRefs(r.tree);
  assert.ok(c.remote.includes('http://example.invalid/remote.jpg'));
  assert.ok(c.local.includes('tex/a.jpg'));
});

test('parity with production extractUrlRefs across all real fixtures', () => {
  const files = allWrlFixtures();
  let compared = 0;
  const knownDifferent = new Set([
    // The AST ignores a `url "..."` that only appears inside a COMMENT; the
    // production regex scanner (lexical) matches it. Asserted explicitly below.
    path.normalize('test/fixtures/vrml/comments.wrl'),
  ]);
  // The AST decoder normalizes CR/CRLF inside string VALUES to '\n'; the production
  // lexical scanner keeps raw bytes. That is a cosmetic value-encoding difference
  // (same reference, same decoded text), so line endings are normalized on BOTH
  // sides before comparison -- the only genuine "which refs" difference stays the
  // url-in-comment case below.
  const norm = (r) => ({ nodeType: r.nodeType, field: r.field, value: String(r.value).replace(/\r\n?/g, '\n') });
  for (const f of files) {
    let text;
    try { text = readWrlSource(f).text; } catch { continue; } // skip corrupt-gzip fixtures
    const mine = extractUrlTriples(parse(text).tree).map(norm);
    const theirs = prod.extractUrlRefs(text).map(norm);
    if (knownDifferent.has(path.normalize(f))) {
      assert.notDeepEqual(mine, theirs, `${f} is expected to differ (url-in-comment)`);
      continue;
    }
    assert.deepEqual(mine, theirs, `parity mismatch for ${f}`);
    compared += 1;
  }
  assert.ok(compared > 20, `expected to compare many fixtures, compared ${compared}`);
});

test('documented parity difference: url inside a comment', () => {
  const text = readWrlSource('test/fixtures/vrml/comments.wrl').text;
  const mine = extractUrlTriples(parse(text).tree).map((r) => r.value);
  const theirs = prod.extractUrlRefs(text).map((r) => r.value);
  // AST: only the real reference. Production: also the commented-out ghost.
  assert.deepEqual(mine, ['real.png']);
  assert.ok(theirs.includes('ghost.png'));
  assert.ok(theirs.includes('real.png'));
});
