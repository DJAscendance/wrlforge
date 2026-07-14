# WRL Forge Releases

This is the index of WRL Forge releases. WRL Forge is a Linux-first,
Windows-supported desktop tool for classic VRML97 `.wrl` content.

All releases are published on GitHub:
**https://github.com/DJAscendance/wrlforge/releases**

## About these versions

- **Public beta / prerelease.** WRL Forge is in **beta**. Versions are marked
  *Beta / Prerelease* and are **not** stable or production releases. Expect rough
  edges and changes between builds.
- **Unsigned.** Windows builds are **not code-signed** (unsigned by design for
  the beta). SmartScreen/Defender may warn on first launch — this is expected.
- **x64 only.** Linux x64 and Windows x64. No ARM64, no macOS, no
  Snap/Flatpak/Store package.
- **Source available, not open source.** The source is publicly viewable for
  inspection; the project is **all rights reserved** (`package.json` license =
  `UNLICENSED`). Third-party components keep their own licenses.

---

## 1.3.0-beta.2 — First Public Beta

**Status: Beta · Prerelease · Unsigned — not a stable release.**

The first **public** beta of WRL Forge. (The earlier `1.3.0-beta.1` was a
**private** beta.) The exact release commit SHA (`<release-commit-sha>`) and tag
**`v1.3.0-beta.2`** are recorded on the GitHub release page:
**https://github.com/DJAscendance/wrlforge/releases/tag/v1.3.0-beta.2**

### Highlights

- **Native editor** (CodeMirror 6): syntax highlighting, document outline, live
  syntax **diagnostics + advisories**, line/column position, **five themes**
  including **High Contrast**, and zoom (`Ctrl` `+` / `-` / `0`).
- **Backups and conflict handling:** saves are **backup-first** (a timestamped
  backup is written before the source is replaced), and WRL Forge **detects
  external changes** to a file so you don't silently clobber edits made outside
  the app.
- **Unsaved live preview** (X_ITE) for **both** the Mall and World lanes: a split
  view of your in-memory editor buffer with **no temp file**, ~700 ms debounce.
  It keeps the **last valid scene** during a temporary syntax error and recovers
  when you fix it.
- **Mall Item** inspection with **Cybertown placement preview**: **Original** mode
  and **Fit** mode, with placement guides and scale info. Preview transforms
  never modify your source.
- **World Project** lane: scans a multi-file world (nested **Inline** files,
  textures), reports **missing / unsafe / case-mismatched** assets, gives an
  embedded X_ITE **world preview** with a **viewpoint selector**, **navigation
  mode**, and **reset view**, and lets you **edit a nested WRL** with a full-world
  preview via an unsaved nested override.
- **Nested WRL** support and **plain + gzip-compressed** `.wrl` files, opened
  transparently.
- **World Project Bundle:** builds a portable ZIP for **manual review and
  hand-off** (deterministic in-repo ZIP writer). You upload it by hand through the
  Cybertown website — it is review + manual handoff only, **not** a direct upload
  and **not** a server-certified format.
- **Optional VSCodium / VS Code** integration, launched **only** by an explicit
  external-editor action (ordinary file opening never launches it).
- **New cyan WRL Forge app icon.**

### Downloads

From the release page
(**https://github.com/DJAscendance/wrlforge/releases/tag/v1.3.0-beta.2**):

**Linux x64**
- `WRL-Forge-1.3.0-beta.2-linux-x64.AppImage` — recommended
- `WRL-Forge-1.3.0-beta.2-linux-x64.tar.gz` — portable app directory

**Windows x64**
- `WRL-Forge-Setup-1.3.0-beta.2-x64.exe` — recommended (NSIS installer)
- `WRL-Forge-1.3.0-beta.2-x64.msi` — MSI installer
- `WRL-Forge-Portable-1.3.0-beta.2-x64.exe` — portable, no install
- `WRL-Forge-1.3.0-beta.2-windows-x64.zip` — portable unpacked app

**Checksums**
- `SHA256SUMS-1.3.0-beta.2.txt`

Install instructions for each: [INSTALLATION.md](INSTALLATION.md).

### Known limitations

- **Unsigned Windows builds** → SmartScreen/Defender may warn (*More info → Run
  anyway*). Unsigned by design for this beta; signing would not by itself remove
  the warning.
- The **portable EXE** has a documented **stdout-handshake** limitation that
  affects **automated visual capture only**, not normal use.
- **Historical nonstandard VRML extensions** may not behave identically to the
  original platform.
- Parser **advisories are advisory-only**; the **X_ITE runtime is authoritative**
  for what actually renders.
- **x64-only** public beta (no ARM64, no macOS).
- **No direct upload** — the World Project Bundle is a manual hand-off package.
- No telemetry, analytics, ads, auto-update, code signing, or crash upload.

### Verifying your download (SHA-256)

Every artifact's SHA-256 hash is in `SHA256SUMS-1.3.0-beta.2.txt` on the release
page. Verify before running.

**Linux:**
```bash
sha256sum -c SHA256SUMS-1.3.0-beta.2.txt
```
Run it from the folder holding both the checksum file and the artifacts; each
line should print `OK`.

**Windows (PowerShell):**
```powershell
Get-FileHash .\WRL-Forge-Setup-1.3.0-beta.2-x64.exe -Algorithm SHA256
```
Compare the printed hash to the matching line in `SHA256SUMS-1.3.0-beta.2.txt`.

### Reporting problems

- Troubleshooting guide: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- Bug reports (and what screenshots/evidence to attach): open an issue at
  **https://github.com/DJAscendance/wrlforge/issues** — see
  [What to attach to a bug report](TROUBLESHOOTING.md#what-to-attach-to-a-bug-report).

### Notes

- **No direct upload / no Cybertown authentication / no automatic submission** —
  these will not be built (a locked product decision).
- WRL Forge is an **independent community project**. It is **not** affiliated
  with, endorsed by, sponsored by, or officially connected to **Cybertown** or its
  current/former operators. "Cybertown" and related names belong to their
  respective owners.

---

## 1.3.0-beta.1 — Private beta

A **private**, unsigned beta that preceded the first public release. Not
distributed publicly; superseded by **1.3.0-beta.2**.
