# Phase 6B — Windows Beta Hardening

Validation of the **1.1.0-beta.1** private Windows build on real Windows 11
(WinBoat / dockur-windows KVM guest). Artifacts live under `release/`
(git-ignored); this file + `selftest-6b-result.json` + `screenshots/` are the
committed evidence. Starting commit: `e017e7b`.

## Beta artifacts (x64, UNSIGNED)

Built on Linux via electron-builder 26.15.3 + wine, `CSC_IDENTITY_AUTO_DISCOVERY=false`
(guarantees no ambient cert is picked up). **PE certificate table empty →
genuinely unsigned** (verified at build). Labelled **Private Beta — Unsigned**.

| Artifact | Size (bytes) | SHA-256 |
|---|---|---|
| `WRL Forge-1.1.0-beta.1-x64-PrivateBeta-Unsigned-portable.exe` | 98,114,098 | `df77f773d46db51ef6786882090d0161c23edff3ffc2674996cabdba75a96c79` |
| `WRL Forge-1.1.0-beta.1-x64-PrivateBeta-Unsigned-setup.exe` | 98,322,172 | `01dac87698c2804f8963ef029f03a68bc4d1874fd5bcd5839df08893eae66ae4` |
| `win-unpacked/WRL Forge.exe` (PE32+ x86-64 GUI) | 223,073,280 | (dir build) |

Checksums: `release/SHA256SUMS-1.1.0-beta.1.txt`. Release notes:
`docs/BETA_RELEASE_NOTES.md`.

## Environment

Windows 11 (x64) under WinBoat / `ghcr.io/dockur/windows` (KVM), accessed via
FreeRDP. Runtime reported by the app: **Electron 41.7.1, Node 24.15.0, Chromium
146.0.7680.216**.

## A. Packaged-runtime self-test — 37/37 PASSED

`qa/phase-6b-windows/win-selftest.js` ran under the **packaged beta Electron
runtime** (`ELECTRON_RUN_AS_NODE`) against the real WRL Forge source on the real
(case-INSENSITIVE NTFS) filesystem. Full output: `selftest-6b-result.json`.
Launcher: `run-selftest-6b.bat`. The harness is also green on Linux (37/37), so it
is CI-verifiable before it reaches the VM.

Covered (all pass): `platform=win32`/`path.sep='\'`; drive-letter + spaces joins;
gzip detect + gunzip round-trip; nested world scan (3 WRL incl. **gzip Inline
child**, 3 textures, **3 viewpoints**, 0 missing/case/unsafe); **71-texture** world
(not truncated); **25-texture** world; broken-world diagnostics (missing / remote /
unsafe / **case-mismatch on real NTFS** with the `existsSync('Stone.PNG')===true`
precondition asserted); Package Audit **READY**; **Review Bundle** written outside
the project with **ZIP hashes matching the manifest**, plus **in-project** and
**overwrite** refusals; **spaces + non-ASCII** project path (real:
`…\a b — wörld`); editor **not-found** clear message; **all editor-override cases
incl. the INVALID-override fall-through** (documented); settings.json
`editorCommand` override; `.edit.wrl` sibling generation; `.exe` (no-shell) vs
`.cmd` (double-quoted shell) spawn-arg quoting; window-state userData path +
legacy `vrmlpad` migration path.

## B. Live GUI validation (focused pass) — screenshots/

Driven through the real Windows GUI on the packaged beta build. Screenshots
numbered in `screenshots/`.

| # | Item | Result |
|---|---|---|
| 01 | **Portable** launch (beta artifact from share) | ✅ "WRL Forge — Mall Item lane" renders; diamond taskbar icon; no SmartScreen block |
| 02 | Native **file dialog** (Open mall .wrl) | ✅ titled "Open Cybertown mall .wrl (gzip or plain)", VRML filter |
| 03 | **Plain** Mall `.wrl` → preview | ✅ **X_ITE renders** the item; **`.edit.wrl` path shown**; CYBERTOWN FIT **EXACT** (125% / max 292% / offset); editor not-found message in GUI |
| 04 | **Gzip** Mall `.wrl` → preview | ✅ transparently decompressed (299 raw / 201 gzip B), preview + FIT EXACT |
| 05 | **World** lane via native **folder** dialog | ✅ scan ok (3 WRL / 6 refs, gzip child), **world X_ITE preview renders**, 3 local assets loaded, **3 viewpoints** + navigation |
| 06 | World assets + dependency + packaging | ✅ asset table (incl. `wall art.png` w/ space), dep tree, "~20 not a server rule" note |
| 07 | **Package Audit** | ✅ **READY** — 6 files / 847 B / 3 WRL / 3 textures / 0 unused; manifest preview w/ "Not Confirmed for Direct Cybertown Upload" |
| 08 | **Build Review Bundle** | ✅ ZIP written **outside** project (9 entries, 3.9 KB); host re-check: `unzip -t` clean, **6/6 manifest hashes match**, 1980 timestamps |
| 09 | **NSIS installer** | ✅ wizard shows **"WRL Forge 1.1.0-beta.1"**, per-user ("Only for me") |
| 10 | Post-install launch + shortcut | ✅ installed build launches; **desktop shortcut created** |
| 11 | **Start-menu** launch + **window-state** | ✅ relaunched from Start menu; **reopened at the same size** (window-state persisted) |
| 12 | Installed-apps entry | ✅ "WRL Forge 1.1.0-beta.1", 374 MB |
| 13 | **Uninstall** | ✅ removed from Installed apps; **desktop shortcut gone**; other desktop items + share projects untouched |

**User-data location:** portable and installed builds both read/write
`%APPDATA%\wrl-forge\window-state.json` — proven by the installed build opening at
the size the **portable** left behind (11), and by the self-test path check (A).

**Clean exit:** confirmed for both the portable (closed before install) and the
installed build (closed before Start-menu relaunch and before uninstall).

**Non-mutation:** all project fixtures on the share are **byte-identical** after
every Windows open/preview/audit/bundle operation (`git status` shows no
`.wrl`/`.png`/fixture changes). The Review Bundle was written only to
`…\wrlforge-beta-bundles\` (outside the repo).

## C. Not driven live this lane (documented limitations)

- **Live VSCodium launch** — VSCodium was intentionally **not** installed in the VM
  for this focused pass. The GUI showed the clear **not-found** message (03), and
  the editor override / invalid-override / `.edit.wrl` / spawn-arg-quoting logic is
  covered by the **37/37** self-test (A) and `test/editor/editor-locator.test.js`.
  A live launch remains a **future** verification item.
- **Local textures / >20 / 70-texture / broken-diagnostics in the GUI** — exercised
  through the self-test (A) and partially in the GUI (05/06 show textured assets
  loaded and the diagnostics tiles); not every count was re-driven click-by-click.
- **x64 only** — no Windows ARM64 build.

## Verdict

**CONDITIONAL GO** for a limited private Windows beta: every core workflow is
verified on real Windows 11 (37/37 logic + focused live GUI incl. install/launch/
preview/packaging/uninstall). Conditions before wider distribution: (1) a live
VSCodium "Open in Editor" run; (2) artifacts remain **Unsigned** — do not claim
SmartScreen warnings are eliminated (see `docs/SIGNING_READINESS.md`); (3) the
Review Bundle is **not** confirmed for direct Cybertown upload.
