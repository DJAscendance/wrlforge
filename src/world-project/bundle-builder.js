'use strict';
// World Project review-bundle BUILDER (Phase 5A).
//
// The ONE module in the packaging lane that creates a file -- and only ever a new
// bundle at a caller-chosen destination, NEVER inside or over the source project.
// It assembles a deterministic ZIP (src/world-project/zip-writer.js -- built on
// Node's `zlib` only, no third-party dependency) containing:
//
//   project/<relpath>   the referenced project files, byte-for-byte, structure
//                       preserved (no repair / rename / flatten / rewrite),
//   MANIFEST.json       the machine-readable manifest (package-plan),
//   REPORT.md           the human-readable report,
//   READ-ME-FIRST.txt   the "Not Confirmed for Direct Cybertown Upload" label.
//
// Safety rules enforced here (in addition to the plan's own blocking rules):
//   * REFUSE if the plan is `blocked` (missing / case / unsafe / remote / unreadable),
//   * REFUSE to write inside the project root (never mutate the source project),
//   * REFUSE to overwrite an existing file (no silent clobber),
//   * every packaged file's bytes are re-hashed and checked against the manifest
//     the caller will ship, so the archive and manifest can never disagree.
//
// fs is injectable so the flow is unit-testable; in the app it runs in the main
// process (the renderer never supplies a path -- it only triggers the action and
// the main process owns the destination via a save dialog).

const fs = require('fs');
const path = require('path');
const { buildZip } = require('./zip-writer');
const {
  buildPackagePlan, buildManifest, manifestJson, renderReport, readmeText,
  BUNDLE_FILES_PREFIX, MANIFEST_NAME, REPORT_NAME, README_NAME, sha256,
} = require('./package-plan');

function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Build the bundle archive as an in-memory Buffer for a given scan + plan. Reads
// each packaged file's real bytes and verifies them against the plan's hashes, so
// the archive is guaranteed consistent with the manifest. Read-only; no writing.
function assembleBundleBuffer(scan, plan, deps = {}) {
  const readFile = deps.readFile || ((p) => fs.readFileSync(p));
  const hash = deps.hash || sha256;
  const projectRoot = path.resolve(scan.root);

  const entries = [];
  // Metadata first (stable order → deterministic archive).
  entries.push({ name: README_NAME, data: Buffer.from(readmeText(plan), 'utf8') });
  entries.push({ name: MANIFEST_NAME, data: Buffer.from(manifestJson(plan), 'utf8') });
  entries.push({ name: REPORT_NAME, data: Buffer.from(renderReport(plan), 'utf8') });

  for (const f of plan.files) {
    const abs = path.resolve(projectRoot, f.relPath);
    const buf = readFile(abs);
    const got = hash(buf);
    if (got !== f.sha256) {
      throw new Error(`content changed under packaging for ${f.relPath} (hash mismatch); refusing to build an inconsistent bundle`);
    }
    entries.push({ name: BUNDLE_FILES_PREFIX + f.relPath, data: buf });
  }
  return { buffer: buildZip(entries), entryCount: entries.length };
}

// Full guarded flow: plan → validate destination → assemble → write. Returns a
// summary. Throws (with a stable .code) on any refusal so the caller can surface
// exactly why. Never writes on refusal.
function writeReviewBundle(scan, destPath, deps = {}) {
  const existsSync = deps.existsSync || ((p) => fs.existsSync(p));
  const writeFileSync = deps.writeFileSync || ((p, b) => fs.writeFileSync(p, b));
  const mkdirSync = deps.mkdirSync || ((p, o) => fs.mkdirSync(p, o));

  const plan = deps.plan || buildPackagePlan(scan, deps);
  const projectRoot = path.resolve(scan.root);
  const dest = path.resolve(String(destPath || ''));

  if (!dest || dest === path.parse(dest).root) {
    const e = new Error('No output destination was chosen.'); e.code = 'ENODEST'; throw e;
  }
  if (plan.status === 'blocked' || plan.blocking.length) {
    const e = new Error(`Packaging is blocked: ${plan.blocking.map((b) => b.message).join('; ')}`);
    e.code = 'EBLOCKED'; e.plan = plan; throw e;
  }
  // Never write into the source project (must go to a separate output location).
  if (isInside(projectRoot, dest) || isInside(dest, projectRoot)) {
    const e = new Error('Refusing to write the bundle inside the source project. Choose an output location outside the project.');
    e.code = 'EINPROJECT'; throw e;
  }
  // Never overwrite an existing file silently.
  if (existsSync(dest)) {
    const e = new Error('A file already exists at that destination. Choose a new name (existing bundles are never overwritten).');
    e.code = 'EEXISTS'; throw e;
  }

  const { buffer, entryCount } = assembleBundleBuffer(scan, plan, deps);

  const parent = path.dirname(dest);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  writeFileSync(dest, buffer);

  return {
    ok: true,
    outPath: dest,
    entryCount,
    bytes: buffer.length,
    bundleSha256: (deps.hash || sha256)(buffer),
    status: plan.status,
    totals: plan.totals,
    unusedCount: plan.unusedFiles.length,
    manifest: buildManifest(plan),
  };
}

module.exports = { assembleBundleBuffer, writeReviewBundle, isInside };
