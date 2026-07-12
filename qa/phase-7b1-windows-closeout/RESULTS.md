# Phase 7B1 — Real Windows 11 GUI verification (WinBoat)

Target build: **WRL Forge 1.2.0-beta.2** (private, unsigned, x64).
Environment: WinBoat (Docker `WinBoat`, `ghcr.io/dockur/windows:5.14`, Windows 11
x64, KVM). Driven via the **noVNC** web console (`http://127.0.0.1:47273`). Host
share `\\host.lan\Data` → Linux `/home/ryan`.

Packed runtime versions (from the self-test): **win32 / x64, Electron 41.7.1,
Node 24.15.0, Chromium 146.0.7680.216**.

> **Scope note:** This lane verified the Phase 7B1 behavior change and core editor
> functions on real Windows. It did **not** re-run the entire Phase 6B/7B
> interactive matrix. See "Not repeated" and "Limitations" below. The full
> interactive matrix was **not** completed.

## Interactively verified on real Windows 11 (this lane)

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | App launches (portable `win-unpacked`) → Mall Item lane | ✅ | `screenshots/win-01-app-launched-mall.png` |
| 2 | **Passive-launch removed:** opening a Mall `.wrl` loads the workspace and does **NOT** launch VSCodium and shows **no** "editor not found" banner | ✅ | `screenshots/win-02-mall-open-no-vscodium.png` |
| 3 | **Open in Native Editor** (explicit) opens the CodeMirror editor: syntax highlighting, outline, Ln/Col, diagnostics (`⚠ 4` from an invalid edit line, kept separate from advisories); all four themes present; Dark↔Light switch | ✅ | `screenshots/win-03-native-editor.png`, `win-03b-native-editor-light-theme.png` |
| 4 | Native editor edited a **real plain `.wrl`** and **Saved** (status → "No changes", Save disabled) | ✅ | `screenshots/win-04-native-editor-saved.png` |
| 5 | **Open in External Editor** (explicit) launches VSCodium — verified by **process detection**: after the action `tasklist` showed **8 `VSCodium.exe` processes** and the `.edit.wrl` working copy was (re)created | ✅ | `tasklist-out.txt`, `diag-editor-out.txt`, `screenshots/win-05-external-editor-explicit.png` |

### Notes on check 5 (external editor)
`diag-editor-out.txt` (packed Electron-as-node) confirms the launch path is correct:
`WRL_FORGE_NO_EDITOR` **unset**, `resolveEditor` → `found:true` (`VSCodium.exe`,
install-location), and a valid `buildLaunch` spec. VSCodium is **single-instance**,
so the explicit action opened the file in the already-running instance rather than
raising a new foreground window (which is why a new window is not visible in the
screenshot). The `launchEditor`/`editor-locator`/`buildLaunch` code was **not**
changed by Phase 7B1, and live foreground VSCodium launch was visually verified in
Phase 6B1. Process detection here confirms the explicit launch fires and reaches
VSCodium.

## Packed-runtime self-test coverage (real Windows 11 NTFS)

`run-selftest-b2.bat` ran the app's shipping modules under the **packed beta.2
Electron-as-node** on real NTFS: **45/45 passed, 0 failed**
(`selftest-b2-win-result.json`, `selftest-b2-win-console.txt`). Includes:

- **Passive-launch posture** (Phase 7B1): open writes the `.edit.wrl` working copy
  but never launches; explicit external action launches once and recreates the
  working copy if missing.
- **Plain + gzip safe-save** (atomic write, verify-decode) with **gzip round-trip**
  preserved; **timestamped backup** created.
- **External-change conflict**: save refused (`EEXTERNAL`), source not clobbered.
- **Path authorization** (in-graph ok; traversal + stray rejected) and **session
  restore confinement** (world doc outside recorded root refused).
- **Spaces / non-ASCII paths** end-to-end; editor discovery / override / `.cmd`
  vs `.exe` launch-arg quoting.

## Previously verified (Phase 6B / 6B1) — not re-driven here

- Foreground VSCodium **live launch** on real Windows 11 (space/non-ASCII paths,
  `settings.json` / `WRL_FORGE_EDITOR` overrides, invalid-override fallback,
  single instance, clean exit) — `qa/phase-6b1-vscodium/`.
- NSIS **install → Start-menu launch → uninstall** and window-state persistence —
  `qa/phase-6b-windows/`.

## Not interactively repeated during Phase 7B1

These are covered by the packed self-test at the filesystem level and/or unchanged
since Phase 6B, and were **not** clicked through interactively this lane:

- Interactive **gzip** open/edit/save in the GUI (fs-level gzip round-trip is in the
  self-test).
- Interactive **conflict dialog** (Cancel / Reload / Save As) click-through
  (`EEXTERNAL` refusal + source-intact is in the self-test).
- **Session restart** + restore in the GUI (restore confinement is in the self-test).
- **World Project → open primary / nested WRL in the native editor**, and World
  preview/packaging (authorization + restore confinement are in the self-test; World
  IPC unchanged by 7B1).
- **NSIS install/uninstall** lifecycle (Phase 6B; portable build was used this lane).

## Limitations carried forward

- The interactive matrix above (gzip GUI, conflict dialog, session restart, World-in-
  editor, NSIS lifecycle, foreground VSCodium) was **not** repeated in Phase 7B1.
- noVNC keyboard forwarding mangled some special characters (`#`→`3`; `Ctrl+S` not
  chorded), an environment artifact of the driving harness, not a WRL Forge defect —
  worked around with on-screen buttons.
- The self-test exercises the shipping source modules under the packed Windows
  Electron runtime (byte-identical to the `app.asar` contents), not the asar directly.
- The evidence `.bat`/`.js` here are reproduction tooling; they run only against the
  local share and write only scratch output. No Windows binaries are committed
  (artifacts stay git-ignored under `release/`).
