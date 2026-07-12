'use strict';
// Native editor path authorization (Phase 7B) -- pure, injectable fs. The editor
// lane follows the same posture as the World lane: the main process owns every
// path, and the renderer never supplies an arbitrary path to write (or even to
// open). A "referenced WRL" open is the one case where the renderer names a file,
// and it is confined three ways:
//   1. lexical confinement to the open project root (rejects ../ traversal),
//   2. membership in the scan's discovered WRL set (rejects unrelated in-root
//      files -- only real dependency nodes are openable),
//   3. realpath confinement (rejects a symlink whose target escapes the root).
//
// No fs writes here; realpathSync is the only disk touch, and it is injectable so
// the symlink-escape path is unit-testable.

const nodePath = require('path');
const nodeFs = require('fs');

// Is `target` inside `root` AFTER resolving symlinks? Symlinks are resolved on
// whatever prefix exists on disk; a not-yet-existing target falls back to its
// lexical (already root-confined) form. Exported so session-store reuses the
// exact same confinement rule for restore.
function realpathInside(root, target, fs = nodeFs) {
  const absRoot = nodePath.resolve(root);
  let realTarget;
  try { realTarget = fs.realpathSync(nodePath.resolve(target)); }
  catch { realTarget = nodePath.resolve(target); }
  let realRoot;
  try { realRoot = fs.realpathSync(absRoot); }
  catch { realRoot = absRoot; }
  const rel = nodePath.relative(realRoot, realTarget);
  return rel === '' || (!rel.startsWith('..') && !nodePath.isAbsolute(rel));
}

// Lexical confinement (no disk): does `abs` stay within `root`?
function lexicallyInside(root, abs) {
  const rel = nodePath.relative(nodePath.resolve(root), nodePath.resolve(abs));
  return rel === '' || (!rel.startsWith('..') && !nodePath.isAbsolute(rel));
}

// Authorize opening a WORLD WRL reference in the native editor. `ref` is a path
// the renderer got from the (main-owned) scan graph -- absolute or project-
// relative. `allowedWrl` is the set of absolute WRL-node paths from that scan.
// Returns { ok, resolved } or { ok:false, reason } with a stable reason string:
//   no-world-open | bad-ref | outside-root | not-in-project | symlink-escape
function authorizeWorldReference({ root, allowedWrl, ref }, deps = {}) {
  const fs = deps.fs || nodeFs;
  if (!root) return { ok: false, reason: 'no-world-open' };
  if (typeof ref !== 'string' || ref.trim() === '') return { ok: false, reason: 'bad-ref' };

  const absRoot = nodePath.resolve(root);
  // Absolute refs are taken as-is; relative refs resolve against the root.
  const abs = nodePath.isAbsolute(ref) ? nodePath.resolve(ref) : nodePath.resolve(absRoot, ref);

  if (!lexicallyInside(absRoot, abs)) return { ok: false, reason: 'outside-root' };
  if (!allowedWrl || !allowedWrl.has(abs)) return { ok: false, reason: 'not-in-project' };
  if (!realpathInside(absRoot, abs, fs)) return { ok: false, reason: 'symlink-escape' };
  return { ok: true, resolved: abs };
}

module.exports = { authorizeWorldReference, realpathInside, lexicallyInside };
