# Changelog

All notable changes to WRL Forge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Releases through `1.3.0-beta.5` used semantic-style version numbers with
`-beta.N` prerelease tags. Starting with `1.4.0`, **Beta is a release
channel/status label, not part of the version string** — the machine version is
plain semver (`1.4.0`) and the human-facing release name carries the status
(`WRL Forge 1.4.0 (Beta)`). See [docs/RELEASES.md](docs/RELEASES.md).

WRL Forge is in **public beta**: releases are **beta / prerelease** and Windows
builds are **unsigned by design**. Not a stable/production release.

## [1.4.0] - UNRELEASED

**Beta.** Release-prep source changes since `1.3.0-beta.3` (the last logged
public release; `1.3.0-beta.4`/`.5` shipped without their own changelog
entries). Summarized from the commit history — see git log for full detail.

### Added

- Crash recovery for the native editor.
- Accessibility and performance checks/improvements.
- A preferences and settings surface.
- Cross-platform (macOS/Apple Silicon) development support — an **unsigned
  Apple Silicon developer build only**; the public release assets remain
  **Linux x64 and Windows x64**, unchanged.
- Substantial `src/vrml/` document-core work underlying the model editor: the
  span-patch edit algebra, the generated VRML97/X3D node schema, two-tier node
  identity, and the DEF/USE/PROTO/`IS`/ROUTE scope-semantics resolver (WD1.1–WD1.5).

### Fixed

- Corrected the Mall upload ceiling to `80 * 1024 = 81,920` bytes.
- Mall repack now uses the measured artifact size, not an assumed one, for
  upload-size truth.
- Unchanged buffers are preserved byte-for-byte as gzip on save (no
  spurious re-compression), with the write authority kept in the main process.
- Windows and gzip-preservation tests made cross-platform/host-portable
  (no host-root or macOS-alias assumptions baked into fixtures).
- Cross-platform CI validation gates repaired.

### Notes

- WRL Forge relicensed to `GPL-3.0-or-later` during this cycle; White Dune and
  other GPL-compatible open-source material may now be reused with preserved
  notices and recorded provenance — see `OPEN_SOURCE_PROVENANCE.md`.
- This entry documents release-prep source state. It is **not yet tagged,
  built, or published** — see [docs/RELEASES.md](docs/RELEASES.md) for what is
  actually available for download.

## [1.3.0-beta.3] - 2026-07-25

A small public-beta maintenance release focused on opening files from the
desktop and making portable Linux installs feel at home.

### Added

- Linux file-manager integration for `.wrl` and `.wrz` files. WRL Forge now
  appears as an **Open With** choice and accepts files passed from a desktop
  shortcut, command line, or an existing running instance.
- A portable per-user Linux shortcut installer for source checkouts and
  extracted tarball builds. It installs the approved cyan SVG icon and uses the
  standard XDG application and icon folders without hardcoded user paths.
- Packaged file-association metadata for `.wrl` and `.wrz`.

### Fixed

- Desktop startup and later file-open requests now use one serialized path, so
  overlapping requests cannot leave an older file on screen.
- File-URL handling and its tests now behave consistently on Linux and Windows.
- The source launcher forwards command-line file arguments to Electron.

### Notes

- Files opened from the desktop enter the **Mall Item** lane. World Projects
  remain an explicit workspace because they need a project root and dependency
  scan.
- WRL Forge registers itself as an **Open With** option but does not take over as
  the default VRML application.
- The project homepage is **https://wrlforge.com**. Download data on the site
  comes from published GitHub releases.
- This remains an unsigned, x64-only beta for Linux and Windows.

## [1.3.0-beta.2] - 2026-07-14

First **public** beta. (The earlier `1.3.0-beta.1` was a private beta.)
**Beta · Prerelease · Unsigned · x64 only** (Linux x64, Windows x64).

### Added

- **Native editor** (CodeMirror 6): syntax highlighting, document outline, live
  syntax diagnostics and advisories, line/column position, five themes including
  High Contrast, and zoom (`Ctrl` `+` / `-` / `0`).
- **Backup-first saves** with a timestamped backup written before the source is
  replaced, plus **external-change conflict detection**.
- **Unsaved live X_ITE preview** for both the **Mall** and **World Project**
  lanes: a split view of the in-memory buffer with no temp file (~700 ms
  debounce) that keeps the last valid scene during a temporary syntax error and
  recovers on correction.
- **Mall Item** inspection with **Cybertown placement preview** — Original and
  Fit modes with placement guides and scale info (preview transforms never modify
  the source).
- **World Project** lane: multi-file world scanning (nested Inline files,
  textures) with missing / unsafe / case-mismatched asset reporting; embedded
  X_ITE world preview with viewpoint selector, navigation mode, and reset view;
  and editing of a nested WRL with a full-world preview via an unsaved nested
  override.
- **Plain and gzip-compressed** `.wrl` files opened transparently, including
  nested WRL.
- **World Project Bundle**: builds a portable ZIP for manual review and hand-off
  (deterministic in-repo ZIP writer), uploaded by hand through the Cybertown
  website.
- **Optional VSCodium / VS Code** external-editor integration, launched only by
  an explicit external-editor action.
- New **cyan WRL Forge app icon**.
- Downloads: Linux **AppImage** and **tar.gz**; Windows **Setup EXE (NSIS)**,
  **MSI**, **Portable EXE**, and **ZIP**; plus `SHA256SUMS-1.3.0-beta.2.txt`.

### Notes

- **Unsigned Windows builds** may trigger SmartScreen/Defender (*More info → Run
  anyway*). Unsigned by design for this beta.
- **No direct Cybertown upload, authentication, or automatic submission** — these
  will not be built (locked product decision). The World Project Bundle is a
  manual hand-off package, not a server-certified format.
- Rendering is **X_ITE only**; parser advisories are advisory-only while the
  X_ITE runtime is authoritative for what renders.
- No telemetry, analytics, ads, auto-update, code signing, or crash upload.
- WRL Forge is an independent community project and is **not** affiliated with,
  endorsed by, or connected to Cybertown or its operators.

## [1.3.0-beta.1] - Private beta

- Private, unsigned beta preceding the first public release; not distributed
  publicly. Superseded by 1.3.0-beta.2.
