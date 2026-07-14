# Building WRL Forge

WRL Forge runs from source on Linux (`npm start`). Phase 6A added a **private,
unsigned Windows test build**; Phase 6B promoted it to a **private beta**
(`1.1.0-beta.1`, labelled **Private Beta — Unsigned**). No public release, code
signing, auto-update, or store packaging is configured (intentionally — see the
roadmap and "Excluded" scope). Signing *readiness* (for a future approved
certificate) is documented separately in `docs/SIGNING_READINESS.md`; beta
install/testing instructions are in `docs/BETA_RELEASE_NOTES.md`.

## Prerequisites

- Node 20+ and npm.
- `npm install` (installs `x_ite` runtime + `electron`/`electron-builder` dev deps).
- For the **Windows** build **from Linux**: `wine` (electron-builder uses it to
  stamp the exe icon/metadata and build the NSIS installer). Verified with
  `wine-9.0`. Building on Windows itself needs no wine.

## Run from source (Linux)

```bash
npm start          # launch the app
npm test           # non-visual unit tests (no window opens)
npm run check      # npm test + node --check syntax gate over all source
```

## Icon

The app icon is the approved **WRL Forge cyan** branding, rasterized
deterministically from `assets/wrl-forge-cyan.svg`:

```bash
npm run build:icons   # SVG -> assets/generated/icons/{windows,linux,runtime}
```

Cyan opaque is the single executable identity. All four approved variants
(`wrl-forge-{cyan,cyan-transparent,yellow,yellow-transparent}.svg`) are also
rasterized to multi-resolution `.ico` files and shipped inside the installed app
(`resources/icons/`), so a user can repoint their own shortcut to any of them via
Windows' **Change Icon** dialog. A build may start from a different variant with
`WRL_FORGE_ICON=cyan|cyan-transparent|yellow|yellow-transparent`. The four source
SVGs must never be modified; only owner-approved artwork may replace them. Full
detail — sizes, determinism, regeneration, verification — is in **`docs/ICONS.md`**.

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
**and natively on Windows** (Phase 7C5; Node 20+ — verified on Windows 11 with Node
24). Output lands in `release/` (git-ignored):

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
`build.extraResources` rather than the app `files` globs.

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
and the Linux/Windows test matrix.
