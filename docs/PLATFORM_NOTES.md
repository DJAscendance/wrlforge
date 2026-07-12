# Platform Notes

Linux is the first supported platform and is tested thoroughly, today.
Windows support is planned in the near future — this document exists so
reusable core logic stays cross-platform-conscious now rather than picking
up Linux-only assumptions that have to be unwound later. It records
platform-sensitive behavior; it does not implement Windows packaging.

## VSCodium executable discovery (cross-platform — Phase 6A)

VSCodium (or VS Code) is an **optional external editor** (a native WRL editor +
VRML97 parser are planned for Phase 7, `docs/NATIVE_EDITOR_ARCHITECTURE.md`).
Editor discovery is resolved by `src/editor/editor-locator.js` (pure/injectable),
wired into `main.js`'s `launchEditor`. Precedence on every platform:

1. **Override** — `editorCommand` in `settings.json` (under Electron's userData)
   or the `WRL_FORGE_EDITOR` env var (an absolute path or a bare PATH command).
2. **Platform discovery**:
   - **Linux/macOS**: `codium` then `code`, verified on `PATH` (falls back to the
     bare `codium` command to preserve the historical behavior).
   - **Windows**: known install locations, existence-checked — VSCodium
     `%LOCALAPPDATA%\Programs\VSCodium\VSCodium.exe` (and `bin\codium.cmd`),
     `%ProgramFiles%`/`%ProgramFiles(x86)%` equivalents, then VS Code
     `Code.exe`/`code.cmd`, then `codium.cmd`/`code.cmd`/`.exe` on `PATH`.

`.exe` targets are launched directly (args array → spaces/non-ASCII safe, no
shell); `.cmd` shims go through the shell with **both** the command and the file
double-quoted (survives `cmd.exe` re-parsing of paths with spaces/Unicode) — see
`buildLaunch`. When nothing is found, `launchEditor` returns a structured
`{ launched:false, reason:'not-found', hint, tried }`; the renderer surfaces a
clear message ("Set `WRL_FORGE_EDITOR` or `editorCommand`…") instead of failing
silently. Unit-tested for Linux **and** Windows via injected `platform`/`env`/
`existsSync` (`test/editor/editor-locator.test.js`), and verified on real Windows
11 (the not-found path, since VSCodium was absent in the test VM — see
`qa/phase-6a-windows/`).

## Native editor — cross-platform behavior (Phase 7B)

The native editor's filesystem behavior is written to be portable and is
covered by the Windows self-test (`qa/phase-6b-windows/win-selftest.js`, 6 editor
cases) as well as the Linux suite:

- **Safe save** (`src/editor/file-io.js`) writes a temp sibling
  (`<file>.wrlforge-tmp-<ISO>`), `fsync`s it, verifies it decodes back to the
  buffer, then **atomically renames** it over the source (`fs.renameSync` — atomic
  within a volume on both ext4 and NTFS). The timestamped backup (`*.bak-<ISO>`)
  reuses `src/files/backups.js`. All path arithmetic uses `path.*`.
- **Spaces / non-ASCII paths** are exercised end-to-end (open → edit → save →
  restore through a `…/wrlforge 7b ünïcode …/my itém.wrl` path).
- **Path authorization** (`src/editor/path-authorizer.js`) uses `path.relative`
  for root confinement and `fs.realpathSync` for symlink-escape detection; both
  are platform-aware. World references are confined to the project root **and** to
  the scan graph.
- **Session restore** persists under `userData` (see below) via
  `src/editor/session-store.js`; a world document is refused if it no longer sits
  inside its recorded root.
- **Keyboard shortcuts** are Ctrl-based, mapped from `e.ctrlKey || e.metaKey`
  (`src/editor/ui-state.js` `resolveShortcut`) so Cmd works on macOS and Ctrl on
  Linux/Windows; CodeMirror owns Undo/Redo/Find/Replace via its own keymap.

The editor **GUI** (CodeMirror rendering, themes, search/replace panel) is
verified on Linux via the serialized `VisualQaRunner`
(`qa/phase-7b-native-editor/`); the Windows GUI run is the interactive WinBoat
step, consistent with how the Phase 6B GUI was verified.

## Path separators

All path construction in this codebase uses `path.join`/`path.dirname`/`path.basename`/`path.extname` (see `src/files/vrml-file.js`, `src/files/backups.js`, `src/settings/window-state.js`, `src/editor/*`) — never string-concatenated `/`. New code should follow the same rule; it's what makes the existing `node:test` suite's path assertions portable without modification.

## Case sensitivity

Linux (ext4) is case-sensitive; Windows (NTFS) is case-insensitive-but-case-preserving. This doesn't affect the current Mall Item lane (single-file, no cross-referenced local assets), but it's directly relevant to the planned Phase 4 World Asset Resolver, which will need to detect filename-case mismatches explicitly rather than relying on the local filesystem's behavior to catch them — a mismatch that's silently tolerated on a case-insensitive dev machine could be a hard failure on the actual target server. Flagged here as forward-looking context for that phase.

**Empirically confirmed (Phase 2B0):** in the X_ITE spike, a texture referenced as `Stone.PNG` when the file on disk is `stone.png` fails to load on Linux and surfaces a clear `Couldn't load URL '…/Stone.PNG'` warning — i.e. the case mismatch is caught here because the filesystem is case-sensitive. On a case-insensitive Windows/macOS dev machine the same reference would load silently, masking a bug that breaks on a case-sensitive server. This is exactly why Phase 4 must detect case mismatches in code rather than leaning on the local fs, and it's an argument for authoring/testing on the case-sensitive (Linux) platform. The texture base-URL resolution itself (`spikes/xite-mall-fit/texture-base.js`) is written with `path` arithmetic and percent-encoding, so it is portable as-is; only the *observed* case behavior differs by platform.

**Implemented in code (Phase 4A) + hardened for case-insensitive fs (Phase 6A):**
the World Project resolver (`src/world-project/asset-graph.js`) detects case
mismatches **in code**, and does **not** trust `existsSync` to mean "present".
Phase 4A's detector listed the directory only when `existsSync(exactPath)`
returned false — which is correct on Linux (case-sensitive) but **wrong on
Windows/macOS**, where `existsSync('Stone.PNG')` returns true when the disk holds
`stone.png`, masking the mismatch. Phase 6A makes the **directory listing the
authoritative check on every platform**: a reference is `present` only when the
directory literally contains that exact basename; a case-only sibling →
`case-mismatch`; otherwise `missing` (with a listing cache so many textures in one
folder don't re-`readdir`). It falls back to `existsSync` only when the directory
can't be enumerated.

**Verified on real Windows 11 (Phase 6A):** the self-test asserted the
precondition that NTFS is case-insensitive (`existsSync('Stone.PNG')===true`) and
that the detector *still* flagged `caseMismatches=1, missing=0` and did **not**
count the file present — i.e. Windows behaves exactly like Linux for authored
case, catching a hazard that would otherwise break only on the case-sensitive
server. See `qa/phase-6a-windows/` and
`test/world-project/case-cross-platform.test.js` (an explicit, code-based test on
a simulated case-insensitive fs).

## Desktop launcher vs. Windows shortcut

`wrl-forge.desktop` is a Linux/XDG desktop-entry file (`Exec=`/`Path=` pointing at `launch.sh`), installed both in-repo and to `~/.local/share/applications/`. This mechanism doesn't exist on Windows — the equivalent is a Start-Menu/desktop shortcut (`.lnk`), which the **Phase 6A NSIS installer** creates for the user (the portable build needs none). The Linux `.desktop` launcher is unchanged.

## Electron `userData` locations

Derived from `app.getPath('userData')`, which Electron bases on `package.json`'s `name` field (`wrl-forge`):

- Linux: `~/.config/wrl-forge`
- Windows: `%APPDATA%\wrl-forge`
- macOS: `~/Library/Application Support/wrl-forge` (out of scope — macOS isn't part of the Linux-first/Windows-near-term posture, noted only for completeness)

`main.js`'s window-state load falls back to the pre-rename `~/.config/vrmlpad` path (see `AGENTS.md` "Rename note") — that fallback is about the old *package name*, not the old *directory path*, and stays correct regardless of platform or any future directory move.

## Local texture / URL handling

`validator.js`'s "no external URLs / nested paths" check (rule 5) already rejects any `url` field value containing `http://`, `https://`, `/`, or `\` — meaning a Windows-style backslash path in a texture URL is already caught as non-compliant by the existing rule, without any platform-specific change needed. Verified compatible as-is.

**Embedded preview (Phase 2B1):** the X_ITE preview's remote-URL blocking uses `session.webRequest.onBeforeRequest` (`url-policy.isBlockedPreviewUrl`) plus a strict CSP — both are Electron-level, platform-independent controls. Local texture resolution uses the source directory as a `file://` `baseURL` built with `path`/percent-encoding (portable). The one platform-observable behavior is texture-filename **case** matching (see "Case sensitivity" above): case-mismatched textures fail on Linux (case-sensitive) and would load silently on a case-insensitive Windows/macOS dev machine — an argument for authoring/testing on Linux. Screenshots are captured via Electron's `webContents.capturePage()` (no external screenshot tool), which is portable.

**World preview (Phase 4B):** the World lane's X_ITE preview routes every nested dependency through a `wrlworld://` custom scheme (`protocol.registerSchemesAsPrivileged` + `protocol.handle`) whose handler is authorized by the asset graph and confined to the project root. Both are Electron-level, platform-independent. The handler builds absolute paths with `path.resolve`/`path.relative` (portable) and serves gzip-decompressed WRL text via the shared `zlib`/`isGzip` reader. The same **case-sensitivity** caveat applies and is in fact leaned on for safety: a case-mismatched reference is *not* authorized (only the present exact-case file is), so on Linux it correctly fails to load; the asset-graph case-mismatch detector (see Phase 4A above) is what surfaces the hazard regardless of the dev machine's fs. Percent-encoding of `wrlworld://` path segments makes filenames with spaces portable.

## File-dialog behavior

The GTK file-open dialog's `Ctrl+L` + typed-path unreliability documented in `AGENTS.md` "Known gotchas" is Linux/GTK-specific — Windows' native common file dialog doesn't share this quirk. Documented as a known gotcha, explicitly not in scope to fix in this lane.

## World Project review bundle (Phase 5A)

The World Project packaging lane builds the portable **WRL Forge World Project
Bundle** (a review + manual-upload package) as a
deterministic ZIP using Node's built-in `zlib` only — a small in-repo writer
(`src/world-project/zip-writer.js`), **no third-party archive dependency**. This
is a deliberate portability + determinism choice: most archive libraries stamp the
current wall-clock mtime into every entry (non-reproducible) and add
platform/OS-specific metadata. The in-repo writer pins every entry to a fixed
1980 DOS timestamp, writes entries in a caller-sorted order, and marks filenames
UTF-8 (general-purpose bit 11), so `buildZip(sameInput)` is byte-identical every
run and on every platform. All path arithmetic uses `path` (portable), and the
output is validated to open under the system `unzip`. The one platform-observable
input is filename **case** (see “Case sensitivity”): a case-mismatched reference
is a *blocking* finding, so a bundle is never built around a reference that would
fail on a case-sensitive server. The builder writes only to a caller-chosen
destination outside the project and never mutates the source — no platform-specific
behavior there.

## Windows app packaging (Phase 6A)

A **private, unsigned Windows test build** is produced with **electron-builder**
26.15.3 (MIT), driven from Linux via `wine` (for exe icon/metadata + the NSIS
installer). Targets: a single-file **portable** `.exe` and an **NSIS installer**
(per-user, user-choosable install dir, Start-menu/desktop shortcuts). Config lives
in `package.json` `build`; `electron` moved to `devDependencies` (it is the build
runtime, not an app npm dependency), leaving `x_ite` as the only runtime
`dependency`. The app icon is a **neutral placeholder** (`assets/icon.ico`, not
final branding). Artifacts are labelled **Private Test Build — Unsigned** and land
in `release/` (git-ignored). See `docs/BUILD.md`.

**Unsigned warning.** No Authenticode certificate is applied, so Windows
SmartScreen shows the normal "Windows protected your PC" / unknown-publisher
prompt on first run (**More info → Run anyway**). No signing, auto-update, store,
or public release is configured. This is distinct from the Phase 5A **WRL Forge
World Project Bundle** (a portable content ZIP for review + manual upload, not an
app installer).

## Windows beta hardening (Phase 6B)

The Phase 6A build was promoted to a **beta candidate** (`1.1.0-beta.1`, labelled
**Private Beta — Unsigned**) and its real GUI workflows validated on Windows 11.
No product code changed (hardening + validation only). Evidence:
`qa/phase-6b-windows/RESULTS.md` (+ `selftest-6b-result.json`, `screenshots/`).

- **Verified live on Windows 11 (focused GUI pass):** portable + NSIS-installed
  launch; native file/folder dialogs; the **X_ITE Mall Original/Fit preview
  renders** (the Phase 6A "not yet run" gap — now closed) with `.edit.wrl`
  generation and the fit report; gzip Mall open; the **X_ITE World preview +
  viewpoints render**; Package Audit; **Review Bundle written outside the project**
  with `unzip -t` clean and **6/6 manifest SHA-256 hashes matching**; window-state
  persistence across portable↔installed (both use `%APPDATA%\wrl-forge`); clean
  exit; Start-menu launch; and **uninstall** (app + desktop shortcut removed, user
  projects untouched). Fixtures byte-identical after every operation.
- **Verified via the committed packaged-runtime self-test (37/37):**
  `qa/phase-6b-windows/win-selftest.js` under `ELECTRON_RUN_AS_NODE` — all the
  logic above plus **every editor-override case including the invalid-override
  fall-through** (an unusable override is skipped in favour of discovery, or yields
  the clear not-found hint when nothing else is found — see "editor override
  behavior" below), settings.json `editorCommand`, and spawn-arg quoting.
- **Unsigned, deterministically:** `build:win` now sets
  `CSC_IDENTITY_AUTO_DISCOVERY=false`, and the shipped artifacts were confirmed to
  have an **empty PE certificate table**. Signing readiness (cert format, env vars,
  timestamping, CI, secrets) is documented in `docs/SIGNING_READINESS.md`; **no
  certificate is used**, and **SmartScreen warnings are not claimed to be
  eliminated**.
- **VSCodium live launch — verified (Phase 6B1 closeout):** VSCodium
  **1.126.04524 (x64)** was installed in the VM and the real editor path was driven
  end-to-end, **13/13** (`qa/phase-6b1-vscodium/RESULTS.md`): automatic
  install-location discovery, plain **and** gzip `.wrl` → `.edit.wrl`, a genuine
  `buildLaunch`+`spawn` of VSCodium on an `.edit.wrl` whose path contains a **space
  and a non-ASCII character**, `editorCommand` **and** `WRL_FORGE_EDITOR` overrides
  honored, an invalid override falling back to discovery, a **single** editor
  instance (no launch loop), a clean exit (no survivors), and unmutated source
  fixtures. A live VSCodium window open on the `.edit.wrl` is captured in
  `qa/phase-6b1-vscodium/screenshots/`.

### Editor override behavior (an explicit, documented choice)

An `editorCommand`/`WRL_FORGE_EDITOR` override that cannot be resolved is treated
as a **preference, not a hard pin**: on Windows an unusable override is **skipped
in favour of install-location discovery**, and only if nothing is found does the
app surface the clear not-found hint (naming `WRL_FORGE_EDITOR`). This is a
deliberate graceful-fallback design, not a bug — verified by the 37/37 self-test.
(If a future lane wants an explicit override to fail loudly rather than fall back,
that is a behavior change requiring its own approval.)

## Test matrix

Windows column verified on Windows 11 (x64) under WinBoat/dockur-KVM, Electron
41.7.1 / Node 24.15 / Chromium 146 — see `qa/phase-6a-windows/RESULTS.md` (6A) and
`qa/phase-6b-windows/RESULTS.md` (6B beta).

| Coverage | Linux | Windows |
|---|---|---|
| `npm test` (`node:test` suite: validator, vrml-file, backups, window-state) | ✅ verified this lane | ✅ core logic verified on Windows via the packaged-runtime self-test (31/31): paths, gzip, scan, case, bundle, window-state |
| Electron smoke test | ✅ verified (real Electron launch; title/bridge/security-flags + preview-canvas/X_ITE/mode-controls/CSP assertions) | ✅ app launches (Mall + World lanes, correct branding, clean exit) — screenshots in `qa/phase-6a-windows/` |
| Cross-platform editor discovery (`src/editor/editor-locator.js`) | ✅ Linux `codium`/`code` on PATH | ✅ **Phase 6B1: real VSCodium 1.126.04524 auto-discovered at install-location** (+ not-found path from 6B); unit-tested for both platforms via injected env |
| Case-mismatch on case-INSENSITIVE fs (`asset-graph.js`) | ✅ (case-sensitive, real) | ✅ flagged on real NTFS despite `existsSync` returning true; explicit code-based test `test/world-project/case-cross-platform.test.js` |
| Review Bundle ZIP creation + integrity | ✅ (unzip -t + hash match) | ✅ written on Windows; hashes match manifest; in-project/overwrite refusals |
| Windows portable/NSIS build (electron-builder) | build host | ✅ portable + installer produced (unsigned); portable launches |
| Embedded preview (Phase 2B1: `src/preview/*`, `renderer/preview.js`) | ✅ verified on Linux (78-test suite incl. 5 Electron preview tests: DEF/USE, Extrusion, gzip, remote-URL block, missing texture; 16 real-app screenshots) | ✅ **Phase 6B: X_ITE Mall Original/Fit preview renders on real Windows 11** (plain + gzip item; fit report EXACT; `.edit.wrl` generated) — `qa/phase-6b-windows/screenshots/03,04` |
| World preview (Phase 4B: `src/world-project/preview-source.js`, `renderer/world-preview.js`, `wrlworld://` handler) | ✅ verified on Linux (21 preview-source unit tests; opt-in Electron world-preview test; one `VisualQaRunner` run of all 10 states — one launch, graceful exit, no leak) | ✅ **Phase 6B: X_ITE World preview renders on real Windows 11** (nested + gzip deps resolved via `wrlworld://`, 3 local assets loaded, viewpoints + navigation) — `qa/phase-6b-windows/screenshots/05` |
| X_ITE spike (`spikes/xite-mall-fit/`) | ✅ verified this lane against 4 real fixtures | Not yet run; `x_ite` itself ships no native/platform-specific binaries, so no structural blocker is known |
| X_ITE spike Phase 2B0 (extrusion sweep, gzip loading, relative textures) | ✅ verified on Linux (26 spike node:tests; extrusion bounds EXACT vs X_ITE mesh oracle; gzip + texture base-URL end-to-end; case-mismatch surfaced) | Not yet run; logic is `path`-portable and `zlib`/`isGzip` are cross-platform. Case-*mismatch* detection is platform-observable (see Case sensitivity) |
| Editor launch (`editor-locator` + `launchEditor`) | ✅ `codium`/`code` on PATH | ✅ **Phase 6B1: real VSCodium launch verified on Windows 11 (13/13)** — production `buildLaunch`+`spawn` opens a space/non-ASCII `.edit.wrl`, both overrides honored, invalid-override fallback, single instance, clean exit, sources unmutated — `qa/phase-6b1-vscodium/RESULTS.md` |
| Desktop launcher / installer shortcut | ✅ `.desktop` working | ✅ NSIS installer creates Start-menu/desktop shortcuts |

## Known Windows limitations (current, as of Phase 6B beta)

- **Unsigned**: SmartScreen unknown-publisher warning on first run (expected;
  **not** eliminated — see `docs/SIGNING_READINESS.md`). Artifacts labelled
  **Private Beta — Unsigned**.
- **x64 only**: no **Windows ARM64** build; no macOS build.
- **WRL Forge World Project Bundle is a review + manual-upload package**: you
  upload it through the Cybertown website by hand (WRL Forge does no direct upload,
  by design); it is **not a server-certified format** and **CTR upload
  compatibility is unconfirmed** (`docs/WORLD_PACKAGE_QUESTIONS.md`).
- Not implemented (by design): code signing (readiness documented only),
  auto-update, Microsoft Store, public release.

**Resolved in Phase 6B** (were 6A limitations): the native file/folder-dialog
flows and the live **X_ITE Mall + World preview render** are now verified on real
Windows 11 via the focused GUI pass (`qa/phase-6b-windows/`), and NSIS
install/Start-menu-launch/uninstall + window-state persistence were driven
end-to-end.

**Resolved in Phase 6B1** (was the one remaining 6B CONDITIONAL-GO item): the
**live VSCodium "Open in Editor" launch** is now verified on real Windows 11 —
VSCodium 1.126.04524 installed, auto-discovered, and launched via the production
spawn path on a space/non-ASCII `.edit.wrl`, with both overrides, invalid-override
fallback, single-instance, clean-exit, and non-mutation all confirmed (13/13,
`qa/phase-6b1-vscodium/RESULTS.md`).
