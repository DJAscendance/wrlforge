# Phase 6A — Windows Compatibility Recon + First Private Build

Private, **unsigned** Windows test build validated on real Windows 11 (WinBoat /
dockur-windows KVM guest). The build artifacts live under `release/` (git-ignored;
too large to commit); this file + `selftest-result.json` + `screenshots/` are the
committed evidence.

## Artifacts (built on Linux via electron-builder + wine, unsigned)

| Artifact | Size | sha256 |
|---|---|---|
| `WRL Forge-1.0.0-x64-PrivateTestBuild-Unsigned-portable.exe` | 94 MB | `e4c47732fe5e5918376eec44b3f252b21571eae1d0d401668913566e49b68eae` |
| `WRL Forge-1.0.0-x64-PrivateTestBuild-Unsigned-setup.exe` (NSIS installer) | 106 MB | `4094f410f9e68a512cc3563a55eeda831431d15f471f2fc8781117ae187eed59` |
| `win-unpacked/WRL Forge.exe` (PE32+ x86-64 GUI) | 213 MB | (dir build) |

Both installer artifacts are labelled **Private Test Build — Unsigned**. They are
unsigned, so Windows SmartScreen shows the normal "Windows protected your PC" /
unknown-publisher warning; the user clicks **More info → Run anyway** (documented
in `README.md`). No code signing, auto-update, store, or public release is
configured.

## Windows environment

- Windows 11 (x64) guest under WinBoat 0.9.0 / `ghcr.io/dockur/windows:5.14` (KVM),
  4 vCPU / 8 GB, accessed via RDP (FreeRDP 3.27.1).
- Runtime reported by the app: **Electron 41.7.1, Node 24.15.0, Chromium 146.0.7680.216**.

## Automated runtime self-test — 31/31 PASSED

`win-selftest.js` ran under the **packaged Windows Electron runtime**
(`ELECTRON_RUN_AS_NODE`) against the real WRL Forge source, on the real
(case-INSENSITIVE NTFS) filesystem. Full output: `selftest-result.json`.

Covered (all pass): `platform=win32` / `path.sep='\'`; gzip `.wrl` detection +
gunzip round-trip; nested world scan (3 WRL, **gzip Inline child** resolved, 3
textures); **70-texture** world (71 unique, no truncation); **>20-texture** world
(25); viewpoints; broken-world diagnostics (missing / remote / unsafe); **case
mismatch flagged on real case-insensitive NTFS** (precondition asserted:
`existsSync('Stone.PNG')===true`, yet `caseMismatches=1, missing=0`, and the file
is NOT counted present); Package Audit READY; **Review Bundle** written on Windows
(4030 B, 9 entries) with **ZIP integrity: hashes match manifest**, not-for-upload
label, and in-project / overwrite refusals; **spaces + non-ASCII** project path;
**editor discovery not-found** message (VSCodium absent in the VM → clear hint
naming `WRL_FORGE_EDITOR`, 16 locations tried); Windows userData window-state path
(`C:\Users\ryan\AppData\Roaming\wrl-forge\window-state.json`) + legacy `vrmlpad`
migration path; drive-letter / backslash path arithmetic.

## GUI verification (screenshots/)

1. `1-mall-launch.png` — the packaged `WRL Forge.exe` launched from local disk;
   title bar **"WRL Forge — Mall Item lane"**, correct header/subtitle/buttons, the
   placeholder diamond icon in the taskbar.
2. `2-world-lane.png` — clicking **Open World Project…** navigated to
   **"WRL Forge — World Project lane"** (both workspaces render on Windows).
3. `3-clean-exit.png` — closing the window exits cleanly (no leftover window or
   taskbar entry).

## Test matrix status (from the lane spec)

| Item | Result |
|---|---|
| App launch | ✅ GUI launched (screenshot 1) |
| Window branding | ✅ "WRL Forge — Mall/World … lane" |
| Plain `.wrl` | ✅ self-test (scan/gzip-detect) |
| Gzip `.wrl` | ✅ self-test (isGzip + gunzip round-trip; gzip Inline child) |
| `.edit.wrl` creation | ⚠️ logic present (editPathFor, path-based); not exercised via GUI dialog this run |
| VSCodium launch / not-found | ✅ clear not-found message (VSCodium absent in VM) — the discovery + hint path |
| Mall Original/Fit preview | ⚠️ Mall GUI shell verified; preview render validated on Linux (unchanged X_ITE) |
| Local textures | ✅ self-test (texture resolution in scans) |
| World Project folder opening | ✅ World lane workspace renders (screenshot 2); scan logic in self-test |
| Nested WRL + gzip deps | ✅ self-test |
| >20-texture project | ✅ self-test (25) |
| Seventy-texture project | ✅ self-test (71) |
| Viewpoints | ✅ self-test (lexical count) |
| Missing/case/remote/unsafe diagnostics | ✅ self-test |
| Package Audit | ✅ self-test (status READY, totals) |
| Review Bundle creation | ✅ self-test (written, refusals) |
| ZIP integrity | ✅ self-test (hashes match manifest; also `unzip -t` on Linux build) |
| Window-state persistence | ✅ path resolution self-test (userData + legacy) |
| Clean exit | ✅ screenshot 3 |

## Windows process discipline

One RDP client at a time; the app was launched from the VM's **local disk**
(copied once from the share) and closed via its window control; no
per-screenshot/per-fixture app launch loop, no broad process killing of the app.
The WinBoat container was started once and stopped after testing.

## Remaining (broader-beta) items — not blockers for a private test build

- File-dialog-driven **open** (Mall `.wrl` / World folder) and **live preview
  render** were not driven through the native Windows dialogs this run (GUI-dialog
  automation over RDP is fragile); the underlying logic is covered by the 31
  self-tests and the Linux visual regressions.
- VSCodium is **not installed** in the test VM, so a successful editor *launch* on
  Windows (vs. the not-found path) is unverified end-to-end.
- The `codium` VS Code family aside, no signed build / SmartScreen-clean run.
