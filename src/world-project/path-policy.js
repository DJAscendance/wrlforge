'use strict';
// Pure path/URL diagnostics for the World Project profile. No Electron, no fs --
// it decides *what a reference is* (local, remote, traversal, absolute, inline
// script, malformed) and *where a local one resolves*, without touching disk.
// Existence / case checks are layered on separately by the asset graph, which
// does have (injected) fs access.
//
// Read-only by nature: nothing here fetches, repairs, or rewrites a reference.
// Remote and unsafe references are CLASSIFIED so the UI can flag them; they are
// never followed.

const path = require('path');
const { isInlineScript, isRemote } = require('./url-fields');
const { schemeOf } = require('../preview/url-policy');

// Classification categories (stable strings the UI keys off):
//   local              -- scheme-less relative path that stays within the project
//   traversal          -- relative path that escapes the project root (../..)
//   absolute-local     -- an absolute filesystem path or file:// URL
//   remote-http        -- http(s) URL
//   remote-protocol    -- protocol-relative //host/... (resolves to http(s))
//   remote-other       -- some other network-capable scheme (ws, ftp, ...)
//   inline-script      -- vrmlscript:/javascript:/ecmascript: code, not an asset
//   malformed          -- empty/garbage that names no usable target
const CATEGORY = Object.freeze({
  LOCAL: 'local',
  TRAVERSAL: 'traversal',
  ABSOLUTE: 'absolute-local',
  REMOTE_HTTP: 'remote-http',
  REMOTE_PROTOCOL: 'remote-protocol',
  REMOTE_OTHER: 'remote-other',
  INLINE_SCRIPT: 'inline-script',
  MALFORMED: 'malformed',
});

// A category is "safe to resolve to a local file" only for LOCAL. TRAVERSAL and
// ABSOLUTE are local-ish but unsafe (outside the project / non-portable) and are
// surfaced, never resolved into the asset set.
const RESOLVABLE = new Set([CATEGORY.LOCAL]);
const REMOTE = new Set([CATEGORY.REMOTE_HTTP, CATEGORY.REMOTE_PROTOCOL, CATEGORY.REMOTE_OTHER]);

function isWindowsAbsolute(p) {
  return /^[a-zA-Z]:[\\/]/.test(p);
}

// Normalize VRML's POSIX-style separators; authored worlds use `/`, but a stray
// backslash is treated as a separator too (and independently flagged upstream).
function toPosix(rel) {
  return String(rel).split('\\').join('/');
}

// Classify one authored url value relative to its referring file's directory and
// the project root. Returns:
//   { category, remote, resolvable, resolved?, projectRelative?, note }
// `resolved` (absolute) and `projectRelative` are present only for LOCAL,
// TRAVERSAL and ABSOLUTE (i.e. filesystem-bearing references).
function classifyReference(value, referrerDir, projectRoot) {
  const raw = String(value == null ? '' : value).trim();
  if (raw === '') {
    return { category: CATEGORY.MALFORMED, remote: false, resolvable: false, note: 'empty reference' };
  }
  if (isInlineScript(raw)) {
    return { category: CATEGORY.INLINE_SCRIPT, remote: false, resolvable: false, note: 'inline VRML/JS script, not an asset' };
  }
  // A Windows drive path (`C:\...`) must be recognised BEFORE scheme parsing --
  // otherwise its `C:` reads as a one-letter URL scheme and looks remote.
  if (isWindowsAbsolute(raw)) {
    const resolved = path.resolve(toPosix(raw));
    return {
      category: CATEGORY.ABSOLUTE,
      remote: false,
      resolvable: false,
      resolved,
      projectRelative: relOrNull(projectRoot, resolved),
      note: 'absolute local path (non-portable / outside project convention)',
    };
  }
  if (/^\/\//.test(raw)) {
    return { category: CATEGORY.REMOTE_PROTOCOL, remote: true, resolvable: false, note: 'protocol-relative remote URL' };
  }
  if (isRemote(raw)) {
    const scheme = (schemeOf(raw) || '').toLowerCase();
    if (scheme === 'http' || scheme === 'https') {
      return { category: CATEGORY.REMOTE_HTTP, remote: true, resolvable: false, note: `${scheme} URL` };
    }
    return { category: CATEGORY.REMOTE_OTHER, remote: true, resolvable: false, note: `${scheme}: remote URL` };
  }

  // Local-ish. Distinguish absolute (non-portable / outside project by nature),
  // traversal (escapes root), and a clean in-project relative path.
  const fileScheme = /^file:/i.test(raw);
  const bare = fileScheme ? raw.replace(/^file:(\/\/)?/i, '') : raw;
  const posix = toPosix(bare);

  if (fileScheme || path.isAbsolute(posix) || isWindowsAbsolute(bare)) {
    const resolved = path.resolve(posix);
    return {
      category: CATEGORY.ABSOLUTE,
      remote: false,
      resolvable: false,
      resolved,
      projectRelative: relOrNull(projectRoot, resolved),
      note: 'absolute local path (non-portable / outside project convention)',
    };
  }

  const resolved = path.resolve(referrerDir, posix);
  const root = projectRoot ? path.resolve(projectRoot) : null;
  if (root) {
    const relToRoot = path.relative(root, resolved);
    if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
      return {
        category: CATEGORY.TRAVERSAL,
        remote: false,
        resolvable: false,
        resolved,
        projectRelative: null,
        note: 'path escapes the project root',
      };
    }
    return {
      category: CATEGORY.LOCAL,
      remote: false,
      resolvable: true,
      resolved,
      projectRelative: relToRoot.split(path.sep).join('/'),
      note: '',
    };
  }
  // No root supplied: treat as local, project-relative unknown.
  return { category: CATEGORY.LOCAL, remote: false, resolvable: true, resolved, projectRelative: null, note: '' };
}

function relOrNull(root, abs) {
  if (!root) return null;
  const rel = path.relative(path.resolve(root), abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

module.exports = { classifyReference, CATEGORY, RESOLVABLE, REMOTE, toPosix };
