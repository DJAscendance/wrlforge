# Changelog

All notable changes to WRL Forge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses semantic-style version numbers with beta/prerelease tags.

WRL Forge is in **public beta**: releases are **beta / prerelease** and Windows
builds are **unsigned by design**. Not a stable/production release.

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
