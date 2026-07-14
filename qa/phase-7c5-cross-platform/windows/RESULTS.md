# Phase 7C5 — Windows-Native Acceptance

Guest: Windows 11 Pro 23H2 (build 22631.6199), AMD64, `virt-manager`/QEMU domain
`win11`. Workspace: local NTFS `C:\Projects\wrlforge`. Driven headlessly over SSH
from the Linux host Claude Code session; interactive rendering in the logged-on
console session. See `environment.json`.

## Workspace preflight
Local NTFS (Fixed drive), not UNC/network/host-share ✅ · `git fetch origin` ✅ ·
checked out production commit `2a99d49` → advanced to fix commits `f3107af` →
`0a9eca8` → `84fdcea` as corrections landed ✅ · clean status ✅ · `npm ci` exit 0,
electron/esbuild binaries present ✅.

## Automated verification (local)
| Step | Result |
|---|---|
| `npm ci` | exit 0 (electron.exe + esbuild win32-x64 present) |
| `npm test` | **567/567**, 0 fail |
| `npm run check` | exit 0 |
| `npm run build:editor` | exit 0, bundle 866.9 KB |
| Tier-1 packed self-test (dev electron) | **55/55**, 0 fail (win32, node 24.15.0, electron 41.7.1) |
| Tier-1 packed self-test (`win-unpacked` exe) | **55/55**, 0 fail |

Tier-1 covers path behavior, plain/gzip I/O, save + timestamped backup, conflict
detection, authorization, session restore, editor-locator (VSCodium on Windows),
and the **7C1–7C3 additions** (preview-bridge session/path rejection, >8 MiB
refusal, World primary+nested authorization, zero overlays/generations after
close, viewpoint fallback order).

## GUI visual suites (file transport, one reused process each, 0 survivors)
| Suite | Result | Notes |
|---|---|---|
| Vision | **9/9 PASS** | zoom/High-Contrast/themes/enlarged chrome; preview panel shows the intentional malformed-fixture diagnostic (by design) |
| Native editor | **15/15 PASS** | plain/gzip, dirty, diagnostics/advisory separation, outline, conflict, themes |
| Mall live preview | **18/18 PASS** | all chips match Linux; Live / large-file band / last-good / saved-version; local texture; remote blocked; leakOk; X_ITE renders |
| World live preview | **22/22 PASS** | chips match Linux; unsaved primary+nested; 70-textures Live; nested-gzip Live; viewpoint & nav preserved; new-ref blocked; Find-new-files; cleanup overlays 0 / gens 0 |

## Build lifecycle
- `build:win` (native, from committed source): portable + NSIS + `win-unpacked` produced.
- **Signature: all three `NotSigned`, no signer cert (empty PE certificate table).**
- Portable runtime: launches + renders a scene (PNG produced). The self-extracting
  portable stub does not forward the child app's stdout, so the capture-server
  READY/result handshake times out over the runner even though the render succeeds
  — a portable-stub plumbing limitation, not an app defect (see KNOWN_LIMITATIONS).
- **NSIS lifecycle:** silent `/S` install → Apps entry `WRL Forge <version>` with
  correct version → Desktop + Start-Menu shortcuts → installed-app launch renders +
  clean exit (0 survivors) → silent uninstall → Apps entry + shortcuts + install
  dir removed → temp-confined user project **byte-identical** (untouched).

## External editor
`resolveEditor()` → `VSCodium.exe` at install-location (`%LOCALAPPDATA%\Programs\
VSCodium`). Explicit launch on a `.edit.wrl` under a **space + Unicode** path
(`café wörld\château.edit.wrl`) opened one session; closed cleanly by targeted PID
(no broad `/IM`). No passive launch on Mall open (code + `mall-edit-flow` 5/5 +
`product-posture`).

## Process lifecycle
Every visual suite: exactly 1 Electron launch, 0 survivors, graceful teardown;
targeted PID-tree cleanup only if needed; never broad `/IM`. Fixture hashes
before/after unchanged. Temp-confined inputs under `C:\wrl-qa`.
