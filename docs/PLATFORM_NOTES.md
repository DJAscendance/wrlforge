# Platform Notes

Linux is the first supported platform and is tested thoroughly, today.
Windows support is planned in the near future — this document exists so
reusable core logic stays cross-platform-conscious now rather than picking
up Linux-only assumptions that have to be unwound later. It records
platform-sensitive behavior; it does not implement Windows packaging.

## VSCodium executable discovery

`main.js` currently launches the editor via `spawn('codium', [editFile], { detached: true, stdio: 'ignore' })`, relying on `codium` being resolvable on `PATH`. This is Linux-verified (the installed VSCodium provides a `codium` binary on `PATH`).

Windows implication (not yet implemented): the typical VSCodium install exposes `codium.cmd` rather than a bare `codium`, and `PATH` resolution/quoting rules differ from POSIX shells. A future Windows-readiness pass should resolve the correct executable name per `process.platform` rather than assuming `codium` works unmodified — this is a small, scoped change when it happens, not a redesign.

## Path separators

All path construction in this codebase uses `path.join`/`path.dirname`/`path.basename`/`path.extname` (see `src/files/vrml-file.js`, `src/files/backups.js`, `src/settings/window-state.js`) — never string-concatenated `/`. New code should follow the same rule; it's what makes the existing `node:test` suite's path assertions portable without modification.

## Case sensitivity

Linux (ext4) is case-sensitive; Windows (NTFS) is case-insensitive-but-case-preserving. This doesn't affect the current Mall Item lane (single-file, no cross-referenced local assets), but it's directly relevant to the planned Phase 4 World Asset Resolver, which will need to detect filename-case mismatches explicitly rather than relying on the local filesystem's behavior to catch them — a mismatch that's silently tolerated on a case-insensitive dev machine could be a hard failure on the actual target server. Flagged here as forward-looking context for that phase.

**Empirically confirmed (Phase 2B0):** in the X_ITE spike, a texture referenced as `Stone.PNG` when the file on disk is `stone.png` fails to load on Linux and surfaces a clear `Couldn't load URL '…/Stone.PNG'` warning — i.e. the case mismatch is caught here because the filesystem is case-sensitive. On a case-insensitive Windows/macOS dev machine the same reference would load silently, masking a bug that breaks on a case-sensitive server. This is exactly why Phase 4 must detect case mismatches in code rather than leaning on the local fs, and it's an argument for authoring/testing on the case-sensitive (Linux) platform. The texture base-URL resolution itself (`spikes/xite-mall-fit/texture-base.js`) is written with `path` arithmetic and percent-encoding, so it is portable as-is; only the *observed* case behavior differs by platform.

## Desktop launcher vs. Windows shortcut

`wrl-forge.desktop` is a Linux/XDG desktop-entry file (`Exec=`/`Path=` pointing at `launch.sh`), installed both in-repo and to `~/.local/share/applications/`. This mechanism doesn't exist on Windows — the equivalent would be a Start Menu shortcut (`.lnk`) or an installer-created entry, not implemented in this lane.

## Electron `userData` locations

Derived from `app.getPath('userData')`, which Electron bases on `package.json`'s `name` field (`wrl-forge`):

- Linux: `~/.config/wrl-forge`
- Windows: `%APPDATA%\wrl-forge`
- macOS: `~/Library/Application Support/wrl-forge` (out of scope — macOS isn't part of the Linux-first/Windows-near-term posture, noted only for completeness)

`main.js`'s window-state load falls back to the pre-rename `~/.config/vrmlpad` path (see `AGENTS.md` "Rename note") — that fallback is about the old *package name*, not the old *directory path*, and stays correct regardless of platform or any future directory move.

## Local texture / URL handling

`validator.js`'s "no external URLs / nested paths" check (rule 5) already rejects any `url` field value containing `http://`, `https://`, `/`, or `\` — meaning a Windows-style backslash path in a texture URL is already caught as non-compliant by the existing rule, without any platform-specific change needed. Verified compatible as-is.

## File-dialog behavior

The GTK file-open dialog's `Ctrl+L` + typed-path unreliability documented in `AGENTS.md` "Known gotchas" is Linux/GTK-specific — Windows' native common file dialog doesn't share this quirk. Documented as a known gotcha, explicitly not in scope to fix in this lane.

## Packaging implications

Not implemented in this lane. A future Windows packaging pass will need `electron-builder` (or similar) configuration for a Windows target — deferred per the roadmap and per this lane's explicit instruction not to implement Windows packaging yet.

## Test matrix

| Coverage | Linux | Windows |
|---|---|---|
| `npm test` (`node:test` suite: validator, vrml-file, backups, window-state) | ✅ verified this lane | Not yet run — pure `path`-based logic, expected to be portable, not independently confirmed |
| Electron smoke test | ✅ verified this lane (real Electron launch, title/bridge/security-flag assertions) | Not yet run |
| X_ITE spike (`spikes/xite-mall-fit/`) | ✅ verified this lane against 4 real fixtures | Not yet run; `x_ite` itself ships no native/platform-specific binaries, so no structural blocker is known |
| X_ITE spike Phase 2B0 (extrusion sweep, gzip loading, relative textures) | ✅ verified on Linux (26 spike node:tests; extrusion bounds EXACT vs X_ITE mesh oracle; gzip + texture base-URL end-to-end; case-mismatch surfaced) | Not yet run; logic is `path`-portable and `zlib`/`isGzip` are cross-platform. Case-*mismatch* detection is platform-observable (see Case sensitivity) |
| VSCodium launch (`spawn('codium', ...)`) | ✅ working | Known gap — executable name differs, not yet handled |
| Desktop launcher | ✅ working (corrected path this lane) | N/A — no Windows equivalent implemented |
