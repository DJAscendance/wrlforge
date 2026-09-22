# Building WRL Forge

WRL Forge runs from source on Linux, Windows, and macOS (`npm start`). Phase 6A
added a **private, unsigned Windows test build**; Phase 6B promoted it to a **private beta**
(`1.1.0-beta.1`, labelled **Private Beta — Unsigned**). Public beta releases are
now published from the Release workflow. Code signing is configured for
**macOS only**; Linux and Windows artifacts remain deliberately unsigned, and no
auto-update or store packaging is configured (intentionally — see the roadmap
and "Excluded" scope). Windows signing *readiness* (for a future approved
certificate) is documented separately in `docs/SIGNING_READINESS.md`; beta
install/testing instructions are in `docs/BETA_RELEASE_NOTES.md`.

The macOS lane produces a **Developer ID signed, notarized and stapled Apple
Silicon build**. It **is** wired into the published release workflow: the
`.github/workflows/release.yml` Release workflow builds, signs, notarizes, and
staples the public macOS arm64 DMG and ZIP on GitHub Actions. The same lane can
also be run locally on an Apple Silicon Mac with the credentials below.

## Prerequisites

- Node 24 and npm. Use Node 24 for development and release builds; hosted CI
  and release automation run on Node 24.
- `npm install` (installs `x_ite` runtime + `electron`/`electron-builder` dev deps).
- For the **macOS** DMG/ZIP: an Apple Silicon Mac, plus a **Developer ID
  Application** certificate and private key in the login keychain and a
  notarization credential (see "macOS signing" below).
- For the **Windows** build **from Linux**: `wine` (electron-builder uses it to
  stamp the exe icon/metadata and build the NSIS installer). Verified with
  `wine-9.0`. Building on Windows itself needs no wine.

## Run from source

```bash
npm start          # launch the app
npm test           # non-visual unit tests (no window opens)
npm run check      # npm test + node --check syntax gate over all source
npm run install:desktop  # per-user Linux menu/icon + .wrl/.wrz Open With entry
```

`install:desktop` is Linux-only; the other commands are cross-platform.

## Icon

The app icon is the approved **WRL Forge cyan** branding, rasterized
deterministically from `assets/wrl-forge-cyan.svg`:

```bash
npm run build:icons   # SVG -> assets/generated/icons/{windows,linux,macos,runtime}
```

Cyan opaque is the single executable identity. All four approved variants
(`wrl-forge-{cyan,cyan-transparent,yellow,yellow-transparent}.svg`) are also
rasterized to multi-resolution `.ico` files and shipped inside the installed app
(`resources/icons/`), so a user can repoint their own shortcut to any of them via
Windows' **Change Icon** dialog. A build may start from a different variant with
`WRL_FORGE_ICON=cyan|cyan-transparent|yellow|yellow-transparent`. The four source
SVGs must never be modified; only owner-approved artwork may replace them. Full
detail — sizes, determinism, regeneration, verification — is in **`docs/ICONS.md`**.

## macOS build (Developer ID signed + notarized, Apple Silicon)

Run this on an Apple Silicon Mac:

```bash
npm ci
npm run check
export APPLE_KEYCHAIN_PROFILE=<your notarytool profile>
npm run dist:mac
```

The command regenerates the approved icons and native-editor bundle, then invokes
electron-builder through `scripts/build-dist.js`. Output lands in `release/`:

- `WRL-Forge-<version>-mac-arm64.dmg` — drag-and-drop disk image.
- `WRL-Forge-<version>-mac-arm64.zip` — zipped `.app` bundle.
- `release/mac-arm64/WRL Forge.app` — unpacked application bundle.

The package registers `.wrl` and `.wrz` as editable document types, and `main.js`
handles Finder's `open-file` event.

### macOS signing

The public macOS build is **Developer ID Application signed, Hardened Runtime,
notarized and stapled**. This is not optional polish. An unsigned or ad-hoc
("linker-signed") bundle downloads with the `com.apple.quarantine` attribute and
Gatekeeper refuses it with:

> "WRL Forge.app is damaged and can't be opened."

That was the 1.4.0 release blocker. It is a *configuration* failure, not a code
failure — the same bundle runs fine once quarantine is stripped, which is exactly
why it survived functional QA.

The contract, enforced by `.github/scripts/validate-build-config.js` and
`test/build-config.test.js`:

| setting | value | why |
|---|---|---|
| `mac.identity` | **absent** | `null` is electron-builder's "do not sign" switch |
| `mac.hardenedRuntime` | `true` | notarization is rejected without it |
| `mac.notarize` | `true` | electron-builder 26 takes a **boolean**, not the v24/25 `{ teamId }` object |
| `mac.entitlements` | `assets/entitlements.mac.plist` | Hardened Runtime denies the JIT V8 needs |
| `mac.entitlementsInherit` | `assets/entitlements.mac.inherit.plist` | helper processes inherit the posture |

`scripts/build-dist.js` forces `CSC_IDENTITY_AUTO_DISCOVERY=false` for **Linux
only**. Forcing it off for macOS too is what prevented identity discovery and
produced the sealless bundle. Linux artifacts stay deterministically unsigned.

**Entitlements are deliberately minimal** — `allow-jit` and
`allow-unsigned-executable-memory`, nothing else. Do not add
`disable-library-validation`, `get-task-allow` (which makes the build
un-notarizable) or App Sandbox without a measured failure proving the need.

**Credentials** are supplied only through the environment and are never read,
logged or committed. Any one of:

- `APPLE_KEYCHAIN_PROFILE` — a `xcrun notarytool store-credentials` profile.
  Preferred locally: no password enters the environment.
- `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`.
- `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` — App Store Connect
  API key, the right choice for CI.

electron-builder signs and notarizes the `.app` and staples it, then builds the
DMG around the stapled bundle. The `afterAllArtifactBuild` hook
(`scripts/notarize-dmg.js`) then signs, notarizes and staples the **DMG itself**,
so the container verifies offline too.

That hook **fails closed**. Once the build contract asks for a macOS DMG, every
trust stage is mandatory: a codesign, notarization or stapling failure, or the
absence of a usable notarization credential, throws and fails the build. It must
never be possible for `npm run dist:mac` to exit 0 while producing a DMG that is
not fully trusted. The only clean no-op is an invocation that was never asked for
a mac DMG at all, decided from the resolved targets rather than from whatever
happens to be in the artifact list.

### Verifying a macOS build

```bash
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/WRL Forge.app"
codesign -dv --verbose=4 "release/mac-arm64/WRL Forge.app"   # expect flags=0x10000(runtime)
xcrun stapler validate "release/mac-arm64/WRL Forge.app"
spctl --assess --verbose --type exec "release/mac-arm64/WRL Forge.app"
```

`spctl` must report **`accepted`** with **`source=Notarized Developer ID`**.
Anything reporting `no usable signature`, `unidentified developer` or `rejected`
must not ship.

## Windows beta build (unsigned)

```bash
npm run build:win            # portable .exe + NSIS installer (x64)
npm run build:win:portable   # portable .exe only
```

Both scripts route through the cross-platform wrapper `scripts/build-win.js`, which
sets `CSC_IDENTITY_AUTO_DISCOVERY=false` **in-process** so no ambient code-signing
certificate on the build host is ever picked up — the labelled-unsigned build stays
deterministically unsigned (artifacts confirmed to have an empty PE certificate
table). The wrapper replaces the old POSIX inline-env form
(`CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder …`), which cmd.exe could not
parse — so `npm run build:win` now works **both** cross-built on Linux (with wine)
**and natively on Windows** (Phase 7C5; verified on Windows 11 with Node 24). Output lands in `release/` (git-ignored):

- `WRL Forge-<version>-x64-PrivateBeta-Unsigned-portable.exe` — single-file
  portable app (no install; run directly).
- `WRL Forge-<version>-x64-PrivateBeta-Unsigned-setup.exe` — NSIS installer
  (per-user, lets the user choose the install dir; creates Start-menu/desktop
  shortcuts — the Windows equivalent of the Linux `wrl-forge.desktop` entry).
- `release/win-unpacked/WRL Forge.exe` — the unpacked app directory.

After building, generate/refresh the checksum file for the beta:

```bash
cd release && sha256sum "WRL Forge-<version>-x64-PrivateBeta-Unsigned-"*.exe > "SHA256SUMS-<version>.txt"
```

### These builds are UNSIGNED

No Authenticode certificate is applied. On first launch Windows SmartScreen shows
**"Windows protected your PC" / unknown publisher**. To run the private beta:
**More info → Run anyway**. This is expected for an unsigned build and is **not** a
defect. **Signing would not eliminate SmartScreen warnings** and none is claimed —
see `docs/SIGNING_READINESS.md` for what a future (separately approved) signing
setup would require. Do not distribute these publicly.

## What's in the package

electron-builder bundles `main.js`, `preload.js`, `validator.js`, `src/**`, and
`renderer/**` into `app.asar`, plus the Electron runtime and the `x_ite` runtime
dependency. This includes the native editor: `renderer/editor.html`/`editor.js`,
the generated CodeMirror bundle `renderer/vendor/wrl-editor.bundle.js`, and every
`src/editor/*` module. Tests, QA harnesses, fixtures, docs, and the generators
(`*.test.js`, `_generate.js`) are excluded (see the `build.files` globs in
`package.json`). The runtime window-icon PNGs (`assets/generated/icons/runtime/`)
are included; the Windows `.ico` files are wired via `build.win.icon` and
`build.win.extraResources` rather than the app `files` globs. The Linux desktop
helper and SVG are similarly confined to `build.linux.extraFiles`; neither is
copied into the macOS application.

**Native-editor bundle:** `npm run build:win` runs `npm run build:editor` first
(esbuild → `renderer/vendor/wrl-editor.bundle.js`), so the bundle is always fresh
in the package. The bundle itself is git-ignored and regenerated; it is **not** a
runtime npm dependency — CodeMirror ships only as the compiled bundle.

## Dependencies + third-party licenses

Runtime `dependencies` remain **`x_ite` only** (MIT) — the app-bundled renderer.
Everything else is a **devDependency** used only to build:

- **CodeMirror 6** — `@codemirror/{state,view,commands,language,search,lint}` and
  `@lezer/highlight`, all **MIT**. The native editor's compiled bundle
  (`renderer/vendor/wrl-editor.bundle.js`) is derived from these and ships inside
  `app.asar`; their MIT notices cover that bundle.
- **esbuild 0.24** (MIT) — builds the CodeMirror bundle (`npm run build:editor`).
- **electron-builder 26.15.3** (MIT) — the packaging tool; pulls its own MIT/BSD/
  ISC dependency tree (`app-builder-lib`, etc.).
- **electron** is a devDependency (the build runtime, provided in the packaged app
  by electron-builder — not an app-bundled npm dependency).

No third-party archive library was added for the World Project Bundle ZIP — that
uses Node's built-in `zlib` (`src/world-project/zip-writer.js`). No renderer UI
framework/bundler was added; only the editor bundle is precompiled.

## Cross-platform notes

See `docs/PLATFORM_NOTES.md` for the platform-sensitive behaviors (optional
external editor discovery, filename-case handling, userData/window-state paths,
path separators)
and the platform test matrix.
