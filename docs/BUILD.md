# Building WRL Forge

WRL Forge runs from source on Linux (`npm start`). Phase 6A adds a **private,
unsigned Windows test build**. No public release, code signing, auto-update, or
store packaging is configured (intentionally — see the roadmap and "Excluded"
scope).

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

The app icon is a **neutral placeholder** (not final branding):
`assets/icon.ico` (256×256), reproducible via `npm run make-icon`
(`assets/_make-icon.js`). Replace it with approved branding art before any public
build.

## Windows test build (unsigned)

```bash
npm run build:win            # portable .exe + NSIS installer (x64)
npm run build:win:portable   # portable .exe only
```

Output lands in `release/` (git-ignored):

- `WRL Forge-<version>-x64-PrivateTestBuild-Unsigned-portable.exe` — single-file
  portable app (no install; run directly).
- `WRL Forge-<version>-x64-PrivateTestBuild-Unsigned-setup.exe` — NSIS installer
  (per-user, lets the user choose the install dir; creates Start-menu/desktop
  shortcuts — the Windows equivalent of the Linux `wrl-forge.desktop` entry).
- `release/win-unpacked/WRL Forge.exe` — the unpacked app directory.

### These builds are UNSIGNED

No Authenticode certificate is applied. On first launch Windows SmartScreen shows
**"Windows protected your PC" / unknown publisher**. To run the private test
build: **More info → Run anyway**. This is expected for an unsigned private build
and is **not** a defect. Do not distribute these publicly.

## What's in the package

electron-builder bundles `main.js`, `preload.js`, `validator.js`, `src/**`, and
`renderer/**` into `app.asar`, plus the Electron runtime and the `x_ite` runtime
dependency. Tests, QA harnesses, fixtures, docs, and the generators
(`*.test.js`, `_generate.js`, `_make-icon.js`) are excluded (see the `build.files`
globs in `package.json`).

## Dependency added this lane

- **electron-builder 26.15.3** (MIT) — dev dependency; the packaging tool. It
  pulls in its own MIT/BSD/ISC-licensed dependency tree (`app-builder-lib`, etc.).
  No third-party archive library was added for the Review Bundle ZIP — that uses
  Node's built-in `zlib` (`src/world-project/zip-writer.js`).
- `electron` was moved from `dependencies` to `devDependencies` (it is the build
  runtime, provided by electron-builder in the packaged app — not an app-bundled
  npm dependency). `x_ite` remains the only runtime `dependency`.

## Cross-platform notes

See `docs/PLATFORM_NOTES.md` for the platform-sensitive behaviors (VSCodium
discovery, filename-case handling, userData/window-state paths, path separators)
and the Linux/Windows test matrix.
