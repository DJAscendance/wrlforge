# Phase 6B1 — VSCodium live-launch closeout (results)

Closes the one remaining Phase 6B CONDITIONAL-GO condition: a **real VSCodium
"Open in Editor" launch on Windows**. Phase 6B GUI-verified only the *not-found*
path (VSCodium was not yet installed in the VM).

## Environment

- **Host VM:** WinBoat / dockur-KVM **Windows 11 x64** (see
  `winboat-windows-test-env` memory / `docs/PLATFORM_NOTES.md`).
- **Editor:** **VSCodium 1.126.04524 (x64)** — commit `4c0b0c6cc561…`, installed
  from the official user-setup installer
  (`VSCodiumUserSetup-x64-1.126.04524.exe`, sha256
  `a8c0516a9b17d1ba4887898f0966445bc61b386fd11578e57433f1e57e9868c9`) via
  `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /MERGETASKS=!runcode`. Installed to
  `%LOCALAPPDATA%\Programs\VSCodium\`.
- **App runtime:** packaged WRL Forge beta run under `ELECTRON_RUN_AS_NODE=1`
  (Electron 41.7.1 / Node 24.15.0) so the exact bundled runtime resolves + spawns
  the editor.

## How it was run

`win-editor-verify.js` reproduces `main.js`'s `openMallFile()` / `launchEditor()`
flow with the **production modules** — `src/files/vrml-file` (`editPathFor`,
`isGzip`), `src/settings/app-settings` (`loadSettings` → `editorCommand`), and
`src/editor/editor-locator` (`resolveEditor`, `buildLaunch`) — against a **real**
filesystem and the **real** installed VSCodium. It then actually `spawn`s VSCodium
on a scratch `.edit.wrl` and confirms/cleans up the process. Source fixtures are
copied to a scratch dir (whose path contains a space **and** a non-ASCII em-dash /
`ö`) before opening, and their hashes are checked before/after — nothing under the
repo is mutated. Driven by `run-6b1.bat` (installs VSCodium if absent, runs the
verify under the packaged Electron-as-node, then opens one VSCodium window on the
`.edit.wrl` for a live screenshot).

The verify is also part of the `node --check` syntax gate and runs on Linux with
`--no-spawn` (module-wiring smoke check).

## Result — 13/13 PASS (`editor-verify-result.json`)

| # | Check | Result |
|---|---|---|
| 1 | VSCodium found automatically | ✅ source=`install-location`, `…\Programs\VSCodium\VSCodium.exe` |
| 2 | Plain `.wrl` → plain `.edit.wrl` | ✅ |
| 3 | Gzip `.wrl` → decompressed `.edit.wrl` (not gzip) | ✅ |
| 4 | Path contains a **space** | ✅ (`a b — wörld dir\plain item.edit.wrl`) |
| 5 | Path contains a **non-ASCII** char | ✅ (`… \gzip ítem.edit.wrl`) |
| 6 | `settings.json` `editorCommand` override honored | ✅ source=`override` |
| 7 | `WRL_FORGE_EDITOR` env override honored | ✅ source=`override` |
| 8 | Invalid override falls back (not honored as-is) | ✅ falls through to install-location discovery |
| 9 | **Open-in-Editor launches VSCodium (real spawn)** | ✅ `buildLaunch`+`spawn`, no spawn error, new PID |
| 10 | No duplicate-launch loop (single instance) | ✅ exactly one new process |
| 11 | Launched editor closed cleanly (no survivors) | ✅ launched PID gone, 0 editor procs remain |
| 12 | Repo source fixtures unchanged | ✅ sha256 identical before/after |
| 13 | Opened source copies unchanged (only `.edit.wrl` added) | ✅ |

`spec.shell=false` — discovery returns `VSCodium.exe` (the `.exe`, launched via an
argv array with **no shell**), so the space / non-ASCII target survives without any
quoting. (The `.cmd`-shim shell path — with explicit double-quoting — remains
covered by the cross-platform unit tests + the 6B 37/37 self-test.)

## Screenshots (`screenshots/`)

- `01-vscodium-installed-launched.png` — VSCodium installed and running on Win11.
- `02-vscodium-open-on-editwrl.png` — VSCodium open on the launched
  `wrl-forge-6b1-demo.edit.wrl` (breadcrumb under `AppData\Local\Temp`, VRML text,
  UTF-8) — the live "Open in Editor" evidence.

## Process lifecycle / safety

One editor process used per launch; no launch loops; VSCodium and the packaged app
both exited cleanly (verified: 0 editor processes survived, desktop returned to
bare state). No broad process killing — teardown targeted the specific launched
PID(s), then the VSCodium/Code image as a fallback. No project files were modified
(the VSCodium installer + staging artifacts live outside the repo, under
`~/wrlforge-6b1-vscodium/`, git-ignored).

## Verdict

**GO** for limited private Windows beta distribution — the last live Phase 6B
condition is closed. Unchanged standing constraints: artifacts remain **Unsigned**
(SmartScreen warning expected, **not** eliminated), **x64 only** (no Windows
ARM64), Review Bundles **not** confirmed for direct CTR upload, and the app icon
is provisional.
