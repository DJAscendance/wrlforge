'use strict';
// Cross-platform external-editor discovery (Phase 6A).
//
// The app opens a plain `.edit.wrl` working copy in an external editor (VSCodium,
// falling back to VS Code). On Linux the `codium` binary is on PATH; on Windows
// it installs as `VSCodium.exe` + a `codium.cmd` shim in per-user/per-machine
// locations that are NOT on PATH by default. This module resolves the right
// launch command per platform, honouring an explicit override, and returns a
// clear "not found" result (with what was tried) so the app can tell the user
// how to fix it instead of failing silently.
//
// Pure/injectable: `platform`, `env`, and an `existsSync` probe are passed in, so
// the whole resolution — including the Windows install-location search and the
// spaces/non-ASCII-safe spawn arguments — is unit-tested without a real
// filesystem, without spawning anything, and on any host OS.

const path = require('path');

// Env var (and settings key) a user can set to force a specific editor: either
// an absolute path to an executable / `.cmd`, or a bare command resolvable on
// PATH. Takes precedence over auto-discovery on every platform.
const EDITOR_ENV = 'WRL_FORGE_EDITOR';

// Windows executables are launched directly (args array → spaces/non-ASCII safe,
// no shell). `.cmd`/`.bat` shims are NOT directly executable by CreateProcess, so
// they are launched through the shell with explicit quoting (see buildLaunch).
function isCmdShim(p) {
  return /\.(cmd|bat)$/i.test(p);
}

// Walk PATH (+ PATHEXT on Windows) for a bare command, returning the first
// existing absolute match, or null. Pure via injected existsSync.
function findOnPath(command, env, existsSync, isWindows) {
  const PATH = env.PATH || env.Path || '';
  const dirs = PATH.split(isWindows ? ';' : ':').filter(Boolean);
  const hasExt = path.extname(command) !== '';
  const exts = isWindows && !hasExt
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// Ordered Windows install-location candidates for VSCodium then VS Code. `.exe`
// first (launched without a shell → spaces/non-ASCII safe), then the `.cmd` shim.
function windowsCandidates(env) {
  const LOCALAPPDATA = env.LOCALAPPDATA || '';
  const PF = env.ProgramFiles || 'C:\\Program Files';
  const PF86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const out = [];
  const add = (base, exe, cmdRel) => {
    if (!base) return;
    out.push(path.join(base, exe));
    out.push(path.join(base, cmdRel));
  };
  // VSCodium (preferred)
  if (LOCALAPPDATA) add(path.join(LOCALAPPDATA, 'Programs', 'VSCodium'), 'VSCodium.exe', path.join('bin', 'codium.cmd'));
  add(path.join(PF, 'VSCodium'), 'VSCodium.exe', path.join('bin', 'codium.cmd'));
  add(path.join(PF86, 'VSCodium'), 'VSCodium.exe', path.join('bin', 'codium.cmd'));
  // VS Code (fallback — same X3D/VRML extensions run there too)
  if (LOCALAPPDATA) add(path.join(LOCALAPPDATA, 'Programs', 'Microsoft VS Code'), 'Code.exe', path.join('bin', 'code.cmd'));
  add(path.join(PF, 'Microsoft VS Code'), 'Code.exe', path.join('bin', 'code.cmd'));
  add(path.join(PF86, 'Microsoft VS Code'), 'Code.exe', path.join('bin', 'code.cmd'));
  return out;
}

// Resolve the editor launch command. deps: { platform, env, existsSync }.
// Returns:
//   { found:true, command, shell, source }   — command is absolute (discovery)
//                                              or a bare command (PATH default);
//                                              shell=true only for a .cmd shim.
//   { found:false, tried:[...], hint }        — nothing usable.
function resolveEditor(deps = {}) {
  const platform = deps.platform || process.platform;
  const env = deps.env || process.env;
  const existsSync = deps.existsSync || require('fs').existsSync;
  const isWindows = platform === 'win32';
  const tried = [];

  // 1. Explicit override (env / settings). Absolute path → check it exists;
  //    bare command → resolve on PATH.
  const override = deps.override || env[EDITOR_ENV];
  if (override && String(override).trim()) {
    const ov = String(override).trim();
    if (path.isAbsolute(ov)) {
      tried.push(ov);
      if (existsSync(ov)) return { found: true, command: ov, shell: isWindows && isCmdShim(ov), source: 'override' };
    } else {
      const onPath = findOnPath(ov, env, existsSync, isWindows);
      tried.push(`${ov} (on PATH)`);
      if (onPath) return { found: true, command: onPath, shell: isWindows && isCmdShim(onPath), source: 'override' };
      // A bare override that we couldn't verify is still honoured as-is (trust
      // the user); the shell handles final resolution. Non-Windows only —
      // on Windows an unresolvable override is reported as not-found below.
      if (!isWindows) return { found: true, command: ov, shell: false, source: 'override' };
    }
  }

  if (isWindows) {
    // 2a. Known install locations (absolute, existence-checked).
    for (const candidate of windowsCandidates(env)) {
      tried.push(candidate);
      if (existsSync(candidate)) {
        return { found: true, command: candidate, shell: isCmdShim(candidate), source: 'install-location' };
      }
    }
    // 2b. PATH shims as a last resort.
    for (const bare of ['codium.cmd', 'code.cmd', 'codium.exe', 'code.exe']) {
      const onPath = findOnPath(bare, env, existsSync, true);
      tried.push(`${bare} (on PATH)`);
      if (onPath) return { found: true, command: onPath, shell: isCmdShim(onPath), source: 'path' };
    }
    return {
      found: false,
      tried,
      hint: `VSCodium/VS Code was not found. Install VSCodium, or set ${EDITOR_ENV} to the full path of VSCodium.exe (or a codium.cmd shim).`,
    };
  }

  // 2. Linux / macOS: codium then code, verified on PATH.
  for (const bare of ['codium', 'code']) {
    const onPath = findOnPath(bare, env, existsSync, false);
    tried.push(`${bare} (on PATH)`);
    if (onPath) return { found: true, command: onPath, shell: false, source: 'path' };
  }
  // PATH probe can miss on unusual setups; fall back to the bare `codium`
  // command and let exec resolve it (preserves the historical Linux behavior).
  return { found: true, command: 'codium', shell: false, source: 'path-default' };
}

// Build the exact spawn arguments for a resolution + a target file, handling
// spaces / non-ASCII safely. Pure — returned shape is asserted in tests without
// spawning. For a `.cmd` shim it goes through the shell with BOTH the command and
// the file explicitly double-quoted (so a path with spaces or Unicode survives
// cmd.exe re-parsing); otherwise the file is passed as a plain argv entry (which
// Node quotes for the child without a shell).
function buildLaunch(resolution, file) {
  const base = { detached: true, stdio: 'ignore', windowsHide: true };
  if (resolution.shell) {
    const q = (s) => `"${String(s).replace(/"/g, '')}"`;
    return { command: `${q(resolution.command)} ${q(file)}`, args: [], options: { ...base, shell: true } };
  }
  return { command: resolution.command, args: [file], options: { ...base, shell: false } };
}

module.exports = { EDITOR_ENV, resolveEditor, buildLaunch, findOnPath, isCmdShim, windowsCandidates };
