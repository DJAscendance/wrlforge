'use strict';
// Pure path/base-URL helpers for resolving a WRL's relative texture URLs
// against the DIRECTORY OF THE SOURCE .wrl (not the spike's HTML directory).
// No fs, no Electron -- unit-testable in node:test. `path` is used only for
// cross-platform path arithmetic (portable to Windows).
//
// Security posture (Phase 2B0):
//   - safeResolve() confines any renderer-supplied name to an approved base
//     directory and rejects path traversal ("../", absolute paths, etc.), so
//     the read-only IPC channel cannot be coaxed into reading arbitrary files.
//   - fileDirUrl() only ever produces `file://` URLs for LOCAL directories;
//     there is no path here that yields an http(s):// base, so a malicious
//     texture URL cannot cause a remote fetch via the base URL.

const path = require('path');

// Resolve `name` (a renderer-supplied fixture identifier) against `baseDir`,
// returning the absolute path ONLY if it stays inside baseDir. Returns null for
// anything that escapes (../, absolute paths, symlink-style tricks in the name).
// baseDir is trusted (set by main.js), name is untrusted.
function safeResolve(baseDir, name) {
  if (typeof name !== 'string' || name.length === 0) return null;
  // Reject absolute paths and Windows drive letters outright.
  if (path.isAbsolute(name) || /^[a-zA-Z]:[\\/]/.test(name)) return null;
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, name);
  const rel = path.relative(resolvedBase, resolved);
  // If the relative path climbs out (starts with ..) it escaped the base dir.
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

// Turn an absolute directory path into a `file://` base URL with a trailing
// slash (required so X_ITE treats it as a directory when resolving relatives).
// Each path segment is percent-encoded so spaces and other URL-significant
// characters in directory names resolve correctly.
function dirUrl(absDir) {
  const norm = absDir.split(path.sep).filter(Boolean).map(encodeURIComponent).join('/');
  // POSIX absolute paths need a leading slash after file://; keep it.
  return 'file:///' + norm + '/';
}

// Base URL for resolving a source .wrl's relative texture references: the
// `file://` URL of the directory CONTAINING that .wrl.
function fileDirUrl(absWrlPath) {
  return dirUrl(path.dirname(absWrlPath));
}

module.exports = { safeResolve, dirUrl, fileDirUrl };
