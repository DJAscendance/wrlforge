'use strict';
// Phase 7C4.1 — Windows Workspace Isolation Guard.
//
// Windows development and QA must run from a LOCAL NTFS clone (e.g.
// C:\Projects\wrlforge), never from a UNC path, a mapped network drive, an SMB
// host-share, or the host-mounted Linux repository. Running `npm ci`, builds, or
// fixture-writing QA against the WinBoat `\\host.lan\Data` share is what broke
// node_modules before; this guard refuses those workspaces up front with one
// clear message.
//
// Pure / injectable: no direct process.exit or child_process at module load.
// The classification takes { platform, env, driveType } so it unit-tests on any
// host with no real Windows and no network. Linux paths are never blocked.
//
// The share may still be used as an EXPLICIT evidence-export destination (§3 of
// docs/WINDOWS_NATIVE_QA_PLAN.md) — but only for an allowlisted evidence run
// directory, and never for node_modules/.git/source/fixtures/backups/binaries.

const path = require('path');
const { execFileSync } = require('child_process');

// The single, exact operator-facing failure message (kept as one constant so the
// wording stays identical across every guarded command and its tests).
const WORKSPACE_MESSAGE =
  'Windows work must run from a local NTFS clone. Clone WRL Forge to '
  + 'C:\\Projects\\wrlforge and retry. The host share may be used only to export '
  + 'finalized QA evidence.';

// Host-share markers that always identify the WinBoat/SMB bridge regardless of
// how the path is presented (direct UNC or via a mapped letter whose target
// still contains the host name). Extendable per-machine via WRL_FORGE_HOST_SHARE
// (comma-separated substrings, matched case-insensitively).
const DEFAULT_HOST_SHARE_MARKERS = ['host.lan'];

function hostShareMarkers(env = {}) {
  const extra = String(env.WRL_FORGE_HOST_SHARE || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...DEFAULT_HOST_SHARE_MARKERS, ...extra];
}

// A UNC path: \\server\share\... or //server/share/... (two leading separators).
function isUncPath(p) {
  return /^(\\\\|\/\/)[^\\/]/.test(String(p || ''));
}

// The real Windows drive-type probe (only invoked on win32). DriveInfo.DriveType
// returns Fixed | Network | Removable | Ram | CDRom | NoRootDirectory | Unknown.
// A mapped network drive reports "Network". Any failure yields 'Unknown' so a
// missing probe never *falsely* blocks a legitimately-local clone — UNC and
// host-share detection still catch the share case.
function realDriveType(letter) {
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `[System.IO.DriveInfo]::new('${letter}').DriveType`,
    ], { encoding: 'utf8' });
    return String(out).trim() || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

function driveLetterOf(p) {
  const m = /^([A-Za-z]):/.exec(String(p || ''));
  return m ? m[1].toUpperCase() : null;
}

// Classify a working directory. Returns { ok, kind, reason }.
//   kind: 'non-windows' | 'ok' | 'unc' | 'host-share' | 'network-drive'
// Non-Windows platforms are always ok (Linux is never blocked).
function classifyWorkspace(cwd, opts = {}) {
  const platform = opts.platform || process.platform;
  if (platform !== 'win32') {
    return { ok: true, kind: 'non-windows', reason: 'not Windows — no workspace restriction' };
  }
  const env = opts.env || process.env;
  const p = String(cwd == null ? '' : cwd);
  const lower = p.toLowerCase();

  if (isUncPath(p)) {
    return { ok: false, kind: 'unc', reason: `UNC path is not a local NTFS clone: ${p}` };
  }
  for (const marker of hostShareMarkers(env)) {
    if (lower.includes(marker)) {
      return { ok: false, kind: 'host-share', reason: `host-share path (matched "${marker}"): ${p}` };
    }
  }
  const letter = driveLetterOf(p);
  if (letter) {
    const probe = opts.driveType || realDriveType;
    const type = String(probe(letter) || 'Unknown');
    if (/network/i.test(type)) {
      return { ok: false, kind: 'network-drive', reason: `drive ${letter}: is a network-mapped drive (${type})` };
    }
  }
  return { ok: true, kind: 'ok', reason: `local workspace: ${p}` };
}

// Throwing form for library callers. Throws an Error carrying WORKSPACE_MESSAGE
// (and a `.classification` for diagnostics) when the workspace is unsuitable.
function assertLocalWorkspace(cwd, opts = {}) {
  const c = classifyWorkspace(cwd, opts);
  if (!c.ok) {
    const err = new Error(WORKSPACE_MESSAGE);
    err.code = 'ENETWORKWORKSPACE';
    err.classification = c;
    throw err;
  }
  return c;
}

// CLI-friendly form for command entry points. On rejection it prints the exact
// message (plus the specific reason) and exits non-zero; on success it returns
// the classification. Injectable error/exit for testing.
function guardWindowsWorkspace(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const error = opts.error || ((m) => process.stderr.write(m + '\n'));
  const exit = opts.exit || ((code) => process.exit(code));
  const label = opts.label ? `[${opts.label}] ` : '';
  const c = classifyWorkspace(cwd, opts);
  if (!c.ok) {
    error(`${label}${WORKSPACE_MESSAGE}`);
    error(`${label}Refused workspace: ${c.reason}`);
    exit(2);
  }
  return c;
}

// ---- Evidence-export allowlist ---------------------------------------------
// The host share is a legitimate destination ONLY for finalized QA evidence.
// Export is allowlist-first: a file is exportable only from within a designated
// evidence run directory AND only if it is not one of the never-export kinds.

// Never export these, even from an evidence directory.
const EVIDENCE_EXPORT_DENY = [
  { reason: 'dependencies', test: (rel) => segments(rel).includes('node_modules') },
  { reason: 'git metadata', test: (rel) => segments(rel).includes('.git') },
  { reason: 'source directory', test: (rel) => hasAnySegment(rel, ['src', 'renderer', 'main.js', 'preload.js', 'validator.js']) },
  { reason: 'committed fixtures', test: (rel) => hasAnySegment(rel, ['fixtures']) },
  { reason: 'working copy', test: (rel) => /\.edit\.wrl$/i.test(rel) },
  { reason: 'backup file', test: (rel) => /(\.bak|\.orig|~)$/i.test(rel) || segments(rel).includes('backups') },
  { reason: 'build intermediate', test: (rel) => hasAnySegment(rel, ['release', 'dist', 'win-unpacked', 'vendor']) },
];

// Windows binaries are export-denied UNLESS explicitly requested (allowBinaries).
const BINARY_RE = /\.(exe|dll|msi|node|nsis|appx|sys|cab)$/i;

function segments(rel) {
  return String(rel || '').split(/[\\/]/).filter(Boolean);
}
function hasAnySegment(rel, names) {
  const segs = segments(rel);
  return names.some((n) => segs.includes(n));
}

// Why a single relative path may not be exported (or null if it may).
function deniedEvidenceReason(rel, { allowBinaries = false } = {}) {
  for (const rule of EVIDENCE_EXPORT_DENY) {
    if (rule.test(rel)) return rule.reason;
  }
  if (!allowBinaries && BINARY_RE.test(rel)) return 'windows binary (pass allowBinaries to include)';
  return null;
}
function isDeniedEvidenceEntry(rel, opts) { return deniedEvidenceReason(rel, opts) != null; }

// Partition a list of relative paths into what may and may not be exported.
function filterEvidenceExport(relPaths, opts = {}) {
  const allowed = [];
  const denied = [];
  for (const rel of relPaths || []) {
    const reason = deniedEvidenceReason(rel, opts);
    if (reason) denied.push({ path: rel, reason });
    else allowed.push(rel);
  }
  return { allowed, denied };
}

module.exports = {
  WORKSPACE_MESSAGE,
  DEFAULT_HOST_SHARE_MARKERS,
  isUncPath,
  driveLetterOf,
  classifyWorkspace,
  assertLocalWorkspace,
  guardWindowsWorkspace,
  EVIDENCE_EXPORT_DENY,
  deniedEvidenceReason,
  isDeniedEvidenceEntry,
  filterEvidenceExport,
};
