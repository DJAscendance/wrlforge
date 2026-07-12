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
- **VSCodium** (or VS Code) only if you want to exercise "Open in Editor" — see
  install notes below. The rest of the app works without it.

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
Review Bundle to a folder **outside** the project and verify the ZIP opens and its
hashes match the manifest. Editor: install VSCodium, confirm discovery + live
launch (including paths with spaces and non-ASCII), a configured override, and the
clear failure message when the override points at an invalid executable. Confirm
window position/size persists across restarts and the app exits cleanly. See
`qa/phase-6b-windows/RESULTS.md` for the maintainer's verified results.

## Known limitations

- **Unsigned** — SmartScreen prompt on first run (expected; not a defect).
- **x64 only** — no Windows ARM64, no macOS.
- **Not upload-ready** — the Review Bundle is a *review* artifact labelled "Not
  Confirmed for Direct Cybertown Upload." No direct upload, no auth, no CTR
  server-format claim. Open questions in `docs/WORLD_PACKAGE_QUESTIONS.md`.
- No auto-update, no Microsoft Store packaging, no public release.
- Placeholder app icon (not final branding).

## Reporting

File issues privately with: the artifact (portable vs installer), Windows version,
repro steps, and any on-screen diagnostic text. Attach `%APPDATA%\wrl-forge\`
contents if a settings/window-state issue.
