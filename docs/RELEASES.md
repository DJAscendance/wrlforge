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
- **Free and open source (GPL-3.0-or-later).** WRL Forge is licensed under the GNU
  General Public License, version 3 or any later version. See [`LICENSE`](../LICENSE),
  [`COPYRIGHT.md`](../COPYRIGHT.md), and
  [`OPEN_SOURCE_PROVENANCE.md`](../OPEN_SOURCE_PROVENANCE.md). Third-party components
  keep their own licenses. Releases through `v1.3.0-beta.3` were distributed under the
  MIT License and those copies keep the permissions granted with them.

---



## 1.3.0-beta.4 — Crash Recovery

**Status: Beta · Prerelease · Unsigned — not a stable release.**

This refresh ships **Phase Beta 2 — Crash Recovery** so unsaved native-editor
work survives an abnormal exit. A Restore / Start Fresh prompt at next
launch offers the user a deliberate decision before any recovered text
is restored or discarded. Source files on disk are NEVER mutated by
recovery — the recovered buffer opens as unsaved work, and the user
decides whether to keep it.

The exact release commit is shown on the GitHub release page:
**https://github.com/DJAscendance/wrlforge/releases/tag/v1.3.0-beta.4**

### What changed since beta.3

- **Phase Beta 2 crash recovery**. Debounced recovery snapshot under
  `userData/editor-recovery.json` (schemaVersion 2; carries
  `sourceStat { mtimeMs, size, sha1 }` of the real source bytes as the
  conflict anchor — gzip-aware). The three renderer pages (Mall, Editor,
  World) all invoke the same shared `WRLForgeRecoveryPrompt.maybePrompt`
  on init, idempotent per session via `sessionStorage`.
- **Recovery lifecycle rule**: the recovery file is cleared ONLY by
  successful Save / explicit Discard / explicit Start Fresh. Restore,
  Save failure, missing source, renderer reload, app restart — all keep
  it on disk so the next launch can offer it again. Independent final
  re-QA: `PHASE_BETA_2_FINAL_REQA_PASS`.
- **B1 plain + gzip external-change protection**. Save after Restore
  detects a post-snapshot external source change through the existing
  `EEXTERNAL` conflict path (no second conflict system). For gzip
  sources, the conflict anchor is the sha1 of the gzip bytes, NOT the
  decompressed text — the recovery snapshot carries the real disk
  identity at snapshot time.
- **B2 missing-source viewer**. When the original source is missing
  (or the recovery lacks a `sourceStat` anchor), the renderer shows a
  dedicated viewer with the recovered text in a selectable `<pre>` and
  a Copy-to-clipboard action. Recovery stays on disk; the viewer is
  non-destructive.
- **B4 / M1 prompt pages**. `recovery-prompt.js` script tag now loads
  BEFORE `editor.js` and `world.js` so the page init can call
  `WRLForgeRecoveryPrompt.maybePrompt` immediately. Deferred scripts
  run in document order.
- **Third-party bundle unchanged**: x_ite 15.1.10 (the only runtime
  dependency) and CodeMirror 6 (dev-time editor bundle).

### Downloads

Start at **https://wrlforge.com**, or download directly from the
[GitHub release](https://github.com/DJAscendance/wrlforge/releases/tag/v1.3.0-beta.4).

**Linux x64** — built locally on this machine
- `WRL-Forge-1.3.0-beta.4-linux-x64.AppImage` — recommended
- `WRL-Forge-1.3.0-beta.4-linux-x64.tar.gz` — portable app directory

**Windows x64** — owner-routed (rebuild on the Win11 guest and update
the release page when the next lane lands)
- `WRL-Forge-Setup-1.3.0-beta.4-x64.exe` — recommended
- `WRL-Forge-1.3.0-beta.4-x64.msi`
- `WRL-Forge-Portable-1.3.0-beta.4-x64.exe`
- `WRL-Forge-1.3.0-beta.4-windows-x64.zip`

**Checksums**

- `SHA256SUMS-1.3.0-beta.4.txt`

This release is still **beta, prerelease, unsigned, and x64-only**. There is
no auto-update, telemetry, direct Cybertown upload, or automatic
submission.

### Known limitations

- **Beta limits inherited from beta.3**: unsigned (SmartScreen prompt on
  Windows); x64 only (no ARM64); no auto-update; not server-certified
  for direct Cybertown upload.
- **Phase Beta 2 accepted limit**: the renderer throttles dirty-buffer
  recovery pings at 1.5 s and main debounces at 5 s. In the 0–1.5 s
  window after a keystroke, the latest text can exist only in renderer
  memory. A renderer crash in that window may lose those characters.
  Crash survives — the user is still offered Restore on the next
  launch (possibly without the last typing burst).
- **Phase 7D0 deferred**: no automatic last-Mall-item restore, no
  automatic last-World-Project restore. Mall and World pages open
  empty after a fresh launch.

# 1.3.0-beta.3 — Desktop Open With Update

**Status: Beta · Prerelease · Unsigned — not a stable release.**

This is a small maintenance update for the public beta. It makes WRL Forge work
properly when a `.wrl` or `.wrz` is opened from the Linux desktop, a file
manager, or the command line. It also packages the shortcut installer and cyan
icon so extracted Linux builds can register themselves without a hardcoded
install location.

The exact release commit and tag are shown on the GitHub release page:
**https://github.com/DJAscendance/wrlforge/releases/tag/v1.3.0-beta.3**

### What changed

- WRL Forge can open `.wrl` and `.wrz` arguments at startup and forward a later
  **Open With** request to the already-running app.
- Startup, second-instance, and desktop file-open requests are serialized so an
  older request cannot win a race and replace the file you opened most recently.
- Linux packages include a path-neutral, per-user shortcut installer. It adds
  WRL Forge to the application menu, installs the approved cyan SVG icon, and
  registers VRML files as an **Open With** choice.
- The source launcher now forwards command-line arguments correctly.
- File-URL parsing and tests are portable across Linux and Windows.
- Public package metadata now points to **https://wrlforge.com**.

Files opened from the desktop enter the **Mall Item** lane. World Projects still
open through their own workspace because WRL Forge needs the project root to
scan and authorize dependencies. The Linux helper does not force WRL Forge to
become your default VRML application.

### Downloads

Start at **https://wrlforge.com**, or download directly from the
[GitHub release](https://github.com/DJAscendance/wrlforge/releases/tag/v1.3.0-beta.3).

**Linux x64**

- `WRL-Forge-1.3.0-beta.3-linux-x64.AppImage` — recommended
- `WRL-Forge-1.3.0-beta.3-linux-x64.tar.gz` — portable app directory

**Windows x64**

- `WRL-Forge-Setup-1.3.0-beta.3-x64.exe` — recommended
- `WRL-Forge-1.3.0-beta.3-x64.msi`
- `WRL-Forge-Portable-1.3.0-beta.3-x64.exe`
- `WRL-Forge-1.3.0-beta.3-windows-x64.zip`

**Checksums**

- `SHA256SUMS-1.3.0-beta.3.txt`

This release is still **beta, prerelease, unsigned, and x64-only**. Windows may
show an unknown-publisher warning. There is no auto-update, telemetry, direct
Cybertown upload, or automatic submission.

---

## 1.3.0-beta.2 — First Public Beta

**Status: Beta · Prerelease · Unsigned — not a stable release.**

The first **public** beta of WRL Forge. (The earlier `1.3.0-beta.1` was a
**private** beta.) The exact release commit and tag **`v1.3.0-beta.2`** are shown
on the GitHub release page (which displays the tagged commit SHA):
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
