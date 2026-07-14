# Phase 7C5 — Cross-Platform Acceptance & Private Beta Refresh

**Starting production commit:** `2a99d49` (Phase 7C3 accepted)
**Result version:** `1.3.0-beta.1` — Private, Unsigned, Windows x64 only.
**Date:** 2026-07-14.

Phase 7C5 is the cross-platform acceptance of the Phase 7C feature set (vision
accommodations, native WRL editor, Mall unsaved-buffer preview, World primary +
nested unsaved-buffer preview, last-valid-scene / saved-version fallback,
viewpoint & navigation preservation, Windows-native QA harness) on **both Linux
and native Windows**, plus a refreshed private unsigned Windows x64 beta.

## Verdict summary

| Gate | Result |
|---|---|
| Linux tests + syntax gate | ✅ 567/567, `npm run check` exit 0 |
| Linux serialized visual suites (7) | ✅ all PASS, 1 launch each, 0 survivors, no fixture mutation |
| Linux stress / leak | ✅ coalescing, 0-overlay/0-generation cleanup, 150/0 replacements, sources hash-identical |
| Linux performance | ✅ every analyze profile < 250 ms debounce |
| Windows tests + syntax gate (local NTFS) | ✅ 567/567, exit 0 |
| Windows Tier-1 packed self-test (source + win-unpacked) | ✅ 55/55 each (incl. 7C1–7C3) |
| Windows visual suites (vision/native/mall/world) | ✅ 9 / 15 / 18 / 22 — PASS, chips match Linux, cleanup 0/0 |
| Windows `build:win` portable + NSIS | ✅ built, **NotSigned** (empty PE cert table) |
| Windows portable runtime | ✅ renders (stdout not forwarded by self-extracting stub — documented) |
| Windows NSIS lifecycle | ✅ install → shortcuts + Apps entry → launch → uninstall → cleanup; user data intact |
| Windows VSCodium explicit launch | ✅ found, space+Unicode `.edit.wrl`, session opened + closed cleanly; no passive launch |
| Regression isolation | ✅ validator/scanner/packaging independent of parser + 7C overlay |

See `linux/RESULTS.md`, `windows/RESULTS.md`, `windows/environment.json`,
`KNOWN_LIMITATIONS.md`, and `results.json`.

## Acceptance-found defects (all fixed, tested, pushed to main, re-verified both OSes)

| # | Commit | Defect | Fix |
|---|---|---|---|
| 1 | `f3107af` | Git-for-Windows `autocrlf=true` + no root `.gitattributes` rewrote plain-text `.wrl` fixtures to CRLF on checkout → `wrl-source.test.js` byte-exact twin comparison failed on Windows (559/560). Not an app defect. | Root `.gitattributes` marks fixture trees `-text` (byte-exact on all platforms; deliberate CRLF twins preserved) + `test/preview/fixture-byte-contract.test.js`. |
| 2 | `0a9eca8` | A GUI-subsystem `electron.exe` on Windows gets an immediately-ended `process.stdin` (readline `close` at ~34 ms; piped jobs never arrive), so the stdin-based capture-server transport — and **all** automated Windows visual QA — was non-functional (latent since 7C4; prior Windows GUI check was manual via noVNC). stdout/WebGL/`capturePage()` all work. | File-based transport: server reads the batch from `WRL_FORGE_CAPTURE_JOBS_FILE`, emits results on stdout, self-quits. `VisualQaRunner` gains `prepareJobs`/`writeJob`/`requestShutdown` hooks (POSIX defaults unchanged); `qa/visual-qa/transport.js` selects by platform; `test/visual-qa/transport.test.js`. |
| 3 | `84fdcea` | `build:win`/`build:win:portable` set the signing guard with POSIX inline-env (`CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder …`); cmd.exe fails with "not recognized", so a native Windows build was impossible (prior builds cross-built on Linux). | Dependency-free `scripts/build-win.js` wrapper sets the env var in-process on every platform; regression test in `product-posture`. |

## Acceptance architecture

- **Linux:** run directly in the repo. Visual QA only through `VisualQaRunner`
  (single reused Electron capture-server, concurrency 1, launch cap, cooldown,
  PID tracking, zero-survivor teardown; no per-capture launches, no `pkill`).
- **Windows:** a `virt-manager`/QEMU **Windows 11 Pro** guest (libvirt domain
  `win11`, local NTFS `C:\Projects\wrlforge`), driven **headlessly over SSH**
  from the Linux host session (OpenSSH Server + host pubkey). All git ops local
  after one authenticated fetch; the same `VisualQaRunner` + orchestrators run
  with the file transport (Windows). No host-share workspace; temp-confined
  inputs; targeted PID-tree teardown only, never broad `/IM`.
