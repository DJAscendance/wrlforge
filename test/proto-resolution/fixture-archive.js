'use strict';
// Shared fixture support for the WD1.7-C suites. NOT a test file (the runner
// collects `*.test.js` only).
//
// Builds a throwaway archive under the OS temp directory and hands back a real
// WD1.7-B `ResolverContext` over it. Real files on a real filesystem, because
// exact-case lookup, symlink containment and gzip-by-magic are B's contracts and
// C must be proven to sit on top of them rather than around them.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { createResolverContext } = require('../../src/external-proto');

const H = '#VRML V2.0 utf8\n';

const created = [];

/**
 * Materialise `files` (POSIX-relative path -> string contents, or
 * `{ gzip: string }`) under a fresh temp root and build a context over it.
 *
 * `sources` defaults to ONE archive-local source with no url prefix -- the
 * shape a World Project has, and the one that makes an absolute-http candidate
 * fail closed instead of being host-stripped into a tree search.
 */
function makeArchive(files, sources) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-wd17c-'));
  created.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (body && typeof body === 'object' && typeof body.gzip === 'string') {
      fs.writeFileSync(abs, zlib.gzipSync(Buffer.from(body.gzip, 'utf8')));
    } else if (body && typeof body === 'object' && Buffer.isBuffer(body.bytes)) {
      fs.writeFileSync(abs, body.bytes);
    } else {
      fs.writeFileSync(abs, String(body), 'utf8');
    }
  }
  const entries = (sources || [{ id: 'archive' }]).map((s) => ({
    id: s.id,
    root: s.subdir ? path.join(root, ...s.subdir.split('/')) : root,
    ...(s.prefix ? { prefix: s.prefix } : {}),
  }));
  return { root, context: createResolverContext({ sources: entries }) };
}

/** Remove every archive this process created. Safe to call more than once. */
function cleanupArchives() {
  while (created.length > 0) {
    const dir = created.pop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/** A minimal document that declares exactly one PROTO of the given name. */
const library = (name, body = 'Group {}') => `${H}PROTO ${name} [] { ${body} }\n`;

/** A document that instantiates one EXTERNPROTO over an ordered candidate list. */
function world(typeName, urls, extra = '') {
  const list = urls.map((u) => JSON.stringify(u)).join(', ');
  return `${H}EXTERNPROTO ${typeName} [] [ ${list} ]\n${extra}${typeName} {}\n`;
}

module.exports = { H, makeArchive, cleanupArchives, library, world };
