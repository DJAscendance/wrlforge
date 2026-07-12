# WRL Forge 1.2.0-beta.1 — Private Windows Beta (Unsigned)

**Status:** Private beta candidate. **Do not distribute publicly.**
**Signing:** **Unsigned** — SmartScreen shows the unknown-publisher prompt on
first run (**More info → Run anyway**); not eliminated (see `docs/SIGNING_READINESS.md`).

## What's new in 1.2.0-beta.1 — the native WRL editor (Phase 7B)

This build adds a **native WRL editor** so WRL Forge edits and safely saves plain
**and** gzip `.wrl` **without any external editor** (VSCodium stays optional). It
is a CodeMirror 6 workspace (all MIT, bundled locally — no CDN), driven by the
built-in Phase 7A VRML97 parser as the **sole** language authority:

- VRML97 **syntax highlighting**, **parser diagnostics** (click-to-navigate,
  capped with a retained total), and an **AST outline** — all from the parser, no
  second grammar. Flat-scope semantic findings show as a **separate, non-
  authoritative advisories** panel that never blocks saving.
- **Conservative safe save**: encode → conflict-guard → temp + `fsync` → verify-
  decode → timestamped backup → atomic rename. A failed save never damages the
  source. **External-change** detection offers **Reload / Save As / Cancel**.
- Gzip transparency (a gzip source saves back gzip, never silently converted),
  dirty tracking, cursor Ln/Col, Save As, Reload, Go-to-line, Undo/Redo, Find/
  Replace, session restore, optional "Open in External Editor", and **four
  themes** (Dark/Light/Terminal/Tokyo Night, contrast-checked).
- Opened from **both** lanes: Mall "Open in Native Editor" (edits the real `.wrl`,
  no `.edit.wrl`); World "Open Primary WRL in Native Editor" + a per-dependency
  "Edit" that the main process authorizes against the scan graph.

Security is unchanged: `contextIsolation:true`, `nodeIntegration:false`, the
narrow `window.vrmlpad` bridge (with an `editor` sub-object), and main-process
path ownership (the renderer never supplies a write path). Verified by 382
non-visual tests, serialized Linux visual QA (15/15), and a perf gate; the
editor's non-GUI logic is also in the Windows self-test. Excludes (Phase 7C):
unsaved-buffer X_ITE preview.

### Artifacts (x64, unsigned)

| File | Size | SHA-256 |
|---|---|---|
| `WRL Forge-1.2.0-beta.1-x64-PrivateBeta-Unsigned-portable.exe` | 98,301,072 B (~94 MB) | `0bab1c55af648d58a5d52d30682196c909a2b1dac6d8bcd234481ebfb70c30d2` |
| `WRL Forge-1.2.0-beta.1-x64-PrivateBeta-Unsigned-setup.exe` (NSIS installer) | 98,509,197 B (~94 MB) | `5e431e003f649bf36dddff76301a03e99ffaf9c4b5d328991154c676ad3ab102` |

Checksums also in `release/SHA256SUMS-1.2.0-beta.1.txt`. The Windows **GUI** run
of the editor is the interactive WinBoat step (the editor's filesystem logic is
covered by the self-test on Linux and slated for the NTFS run).

---

# WRL Forge 1.1.0-beta.1 — Private Windows Beta (Unsigned)

**Status:** Private beta candidate. **Do not distribute publicly.**
**Signing:** **Unsigned** (no Authenticode certificate). Windows SmartScreen will
show a "Windows protected your PC" / unknown-publisher prompt on first run —
**More info → Run anyway**. Signing is **not** applied and SmartScreen warnings are
**not** eliminated (see `docs/SIGNING_READINESS.md`).

## What this build is

The first Windows **beta** of WRL Forge — a VRML97 inspection / validation /
preview / review-bundle workbench for Cybertown Mall items and World projects.
Phase 6B is **hardening only**: no new product features versus the Phase 6A
private test build. It promotes the private Windows build from "it launches" to
"the real GUI workflows are exercised end-to-end on Windows 11."

## Artifacts (x64, unsigned)

| File | Size | SHA-256 |
|---|---|---|
| `WRL Forge-1.1.0-beta.1-x64-PrivateBeta-Unsigned-portable.exe` | 98,114,098 B (~94 MB) | `df77f773d46db51ef6786882090d0161c23edff3ffc2674996cabdba75a96c79` |
| `WRL Forge-1.1.0-beta.1-x64-PrivateBeta-Unsigned-setup.exe` (NSIS installer) | 98,322,172 B (~94 MB) | `01dac87698c2804f8963ef029f03a68bc4d1874fd5bcd5839df08893eae66ae4` |

Checksums also in `release/SHA256SUMS-1.1.0-beta.1.txt`. Verify before running:

```powershell
# PowerShell
Get-FileHash '.\WRL Forge-1.1.0-beta.1-x64-PrivateBeta-Unsigned-portable.exe' -Algorithm SHA256
```

Both artifacts are **PE32 x64 wrappers** around a **PE32+ x86-64** app
(`win-unpacked/WRL Forge.exe`, 223,073,280 B). Both are unsigned (PE certificate
table empty — verified at build time). x64 only — **no Windows ARM64 build**.

## Requirements

- Windows 10/11 **x64**. (ARM64 unsupported this lane.)
- ~250 MB free disk for the installed app.
- **VSCodium** (or VS Code) — an **optional external editor**, only if you want to
  exercise "Open in External Editor" — see install notes below. The rest of the app
  works without it; the built-in **native WRL editor** (Phase 7B, backed by the
  built-in VRML97 parser) needs no external editor. (See
  `docs/NATIVE_EDITOR_ARCHITECTURE.md`.)

## Install / run

**Portable** (no install): download the `-portable.exe`, verify the hash,
double-click. SmartScreen → **More info → Run anyway**. It self-extracts to a temp
dir and runs; nothing is installed.

**Installer** (NSIS): run the `-setup.exe`, **More info → Run anyway**, choose an
install directory (per-user; no admin required). It creates Start-menu and desktop
shortcuts. Launch from the Start-menu shortcut. Uninstall from
**Settings → Apps** or the Start-menu uninstaller — this removes the app files and
shortcuts and leaves your projects untouched.

## User data / settings

- Window state: `%APPDATA%\wrl-forge\window-state.json` (migrates a legacy
  `%APPDATA%\vrmlpad\window-state.json` if present).
- Editor override: `%APPDATA%\wrl-forge\settings.json` `{"editorCommand": "..."}`,
  or the `WRL_FORGE_EDITOR` environment variable (full path to `VSCodium.exe` or a
  `codium.cmd` shim). Portable and installed builds use the **same** `%APPDATA%`
  location.

## What to test (beta test matrix)

Mall lane: open a plain and a gzip `.wrl` via the native file dialog; confirm the
`.edit.wrl` working copy is generated; Original/Fit preview renders; local textures
render. World lane: open a project folder and a primary `.wrl` directly; confirm
nested + gzip dependencies, >20 and ~70-texture projects, viewpoints/navigation,
and the missing/case-mismatch/remote/unsafe diagnostics; run Package Audit; Build a
World Project Bundle to a folder **outside** the project and verify the ZIP opens and its
hashes match the manifest. Editor: install VSCodium, confirm discovery + live
launch (including paths with spaces and non-ASCII), a configured override, and the
clear failure message when the override points at an invalid executable. Confirm
window position/size persists across restarts and the app exits cleanly. See
`qa/phase-6b-windows/RESULTS.md` for the maintainer's verified results.

## Known limitations

- **Unsigned** — SmartScreen prompt on first run (expected; not a defect).
- **x64 only** — no Windows ARM64, no macOS.
- **Review + manual upload** — the **WRL Forge World Project Bundle** is a
  *review* artifact you upload through the Cybertown website / Mall workflow **by
  hand**. WRL Forge does no direct upload, auth, or networking (by design), and
  makes no CTR server-format claim. Open questions in
  `docs/WORLD_PACKAGE_QUESTIONS.md`.
- No auto-update, no Microsoft Store packaging, no public release.
- Placeholder app icon (not final branding).

## Reporting

File issues privately with: the artifact (portable vs installer), Windows version,
repro steps, and any on-screen diagnostic text. Attach `%APPDATA%\wrl-forge\`
contents if a settings/window-state issue.
