# Linux Build & Verification — WRL Forge 1.3.0-beta.2

Host: Linux x64 (Node 20.20.2, electron 41.7.1, electron-builder 26.15.3). Command: `npm run dist:linux` (→ `build:icons` + `build:editor` + `electron-builder --linux --x64`, `CSC_IDENTITY_AUTO_DISCOVERY=false`, `--publish never`).

## Artifacts (canonical names — `${os}` resolved to `linux-x64`)
| Artifact | Size (bytes) | SHA-256 |
|---|---|---|
| WRL-Forge-1.3.0-beta.2-linux-x64.AppImage | 134154442 | b3a65a71d71d79c19f519a72defd53ffd7ba41d15b87a9f83f1220cbe3348226 |
| WRL-Forge-1.3.0-beta.2-linux-x64.tar.gz | 127284272 | caa826a28b3ad518f330c3c4507d8bc6b7958c06504f7079cb34b53548113692 |

## Structural verification
- **tar.gz** extracts to a runnable app directory `WRL-Forge-1.3.0-beta.2-linux-x64/` containing the `wrl-forge` binary, `resources/app.asar`, `chrome-sandbox`, and `resources/icons/*.ico` — **not** the project source tree.
- **app.asar** embedded `package.json` version = **1.3.0-beta.2**; runtime icons `assets/generated/icons/runtime/{icon,about-logo}.png` present.
- **AppImage** ships `wrl-forge.desktop` (`Name=WRL Forge`, `Icon=wrl-forge`) and `wrl-forge.png` (cyan app icon).

## Launch smoke test
Single controlled launch (extracted AppRun, `--no-sandbox`, DISPLAY=:0) under a 12 s hard timeout — deliberately one process, not the multi-launch storm pattern that is guarded against. The process stayed alive for the full window (timeout exit 124, i.e. no early crash), produced no error output, and left **zero survivors** after termination. Deep editor/preview interaction is covered by the source-identical QA suites (phase-7b/7c) that exercise the same `app.asar` code.

Result: **PASS** — launches, runs, clean termination, zero survivors, correct version + icon.

## Notes
- electron-builder emitted a benign advisory that `desktopName`/`syncDesktopName` are unset (window-association hint only); not a release blocker for the beta.
- Windows artifacts (NSIS/MSI/portable/ZIP) are produced natively by `.github/workflows/release.yml` on a `windows-latest` runner from the exact tag; see `windows-build-results.md`.
