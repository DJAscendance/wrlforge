# Troubleshooting WRL Forge

This page covers the issues most likely to come up in the **1.3.0-beta.3**
public beta. Each entry is **symptom → likely cause → what to do**.

If your problem isn't here, or a fix doesn't work, please open an issue and
attach the evidence listed in [What to attach to a bug report](#what-to-attach-to-a-bug-report):
**https://github.com/DJAscendance/wrlforge/issues**

> WRL Forge renders exclusively with the **X_ITE** engine. X_ITE's runtime is the
> authority for what actually appears on screen; the editor's parser advisories
> are advisory-only and never block saving.

---

## Blank or empty preview

**Symptom.** The preview pane is blank, black, or shows nothing after you open a
`.wrl` file or start a live preview.

**Likely cause.** The scene may have a temporary syntax error in the editor
buffer, the file may reference assets that can't be found, or the current
viewpoint/camera may not be pointing at any geometry.

**What to do.**
- Check the editor for **syntax diagnostics** (red markers / the diagnostics
  list). While a live-preview buffer has a syntax error, WRL Forge keeps showing
  the **last valid scene** and recovers automatically once you correct the edit —
  so a persistent blank usually means the *last* good parse was already empty.
- In the World lane, use the **viewpoint selector** and **reset view** to move the
  camera; some scenes load with a viewpoint far from the geometry.
- Confirm the file actually contains renderable geometry (open it in the editor
  and check the outline).
- If assets are missing, see [Missing textures](#missing-textures) below.
- Give the live preview a moment — it debounces edits (~700 ms) before
  re-rendering.

---

## Missing textures

**Symptom.** Geometry renders but appears untextured, plain-shaded, or shows
placeholder surfaces; a Mall item or world looks "flat".

**Likely cause.** A referenced texture file is absent, is in a different folder
than the reference expects, or its filename **case** doesn't match the reference
(see the next entry).

**What to do.**
- In the **World Project** lane, run a scan — WRL Forge reports **missing**,
  **unsafe**, and **case-mismatched** assets explicitly. Fix the reported paths
  or add the missing files, then rescan (**Find new files**).
- Make sure textures sit where the `.wrl` references them (relative to the file),
  and that the files are actually present on disk.
- Remember that remote (`http://` / `https://`) texture URLs are blocked by
  policy in the preview — see [Remote assets are blocked](#remote-assets-are-blocked).

---

## Case-sensitive paths (Linux)

**Symptom.** A texture or nested file loads on Windows but fails on Linux, or the
World scanner flags a **case mismatch**.

**Likely cause.** Linux filesystems are case-sensitive; Windows is
case-insensitive but case-preserving. A reference to `Stone.PNG` when the file on
disk is `stone.png` loads silently on Windows but fails on Linux — and, crucially,
would fail on a case-sensitive server even if it works on your Windows machine.

**What to do.**
- Treat WRL Forge's **case-mismatch** finding as a real problem to fix, not a
  cosmetic warning. It is detected in code on **every** platform (including
  Windows), precisely so a mismatch that only breaks on a case-sensitive host
  doesn't slip through.
- Rename either the file or the reference so the **exact** case matches, then
  rescan.
- When in doubt, author and test on Linux, where case mismatches surface
  immediately.

---

## Gzip-compressed `.wrl` files won't open elsewhere

**Symptom.** A `.wrl` looks like binary garbage in a plain text editor, or another
tool refuses it.

**Likely cause.** Classic VRML97 `.wrl` files are frequently **gzip-compressed**.
That's normal and expected.

**What to do.**
- WRL Forge opens **both** plain and gzip-compressed `.wrl` files transparently —
  just open it in WRL Forge; no manual decompression is needed.
- If another tool can't read it, that tool likely doesn't handle gzip'd VRML; use
  WRL Forge (or `gunzip` a copy) rather than assuming the file is corrupt.

---

## Remote assets are blocked

**Symptom.** A texture, Inline, or other asset that lives at an `http://` or
`https://` URL doesn't load in the preview; you may see a blocked-request notice.

**Likely cause.** By policy, WRL Forge's X_ITE preview **blocks remote network
requests** — the preview loads local project assets only. This is a deliberate
safety control, not a bug.

**What to do.**
- Download the referenced asset and reference it **locally** (relative to the
  `.wrl`) instead of by remote URL.
- For Mall items, note that external / nested-path URLs are non-compliant anyway
  and are flagged accordingly.

---

## World dependency problems

**Symptom.** A World Project preview is incomplete — some nested Inline files or
textures don't appear — or the scan reports problems.

**Likely cause.** One or more dependencies are missing, out of the project root,
case-mismatched, or otherwise unsafe; or you edited a nested file and the buffer
has a syntax error.

**What to do.**
- Read the scan report: it lists **missing / unsafe / case-mismatched** assets by
  path. Address each, then use **Find new files** to rescan (an explicit rescan —
  unsaved edits never silently expand what the world is allowed to load).
- Keep all world files **inside the project root**; WRL Forge confines the world
  preview to the project root and its scanned asset graph and will not reach
  outside it.
- When editing a **nested** WRL with the full-world preview, a broken nested edit
  keeps the last good full scene on screen; fix the syntax and the full scene
  returns.

---

## Windows SmartScreen / "unknown publisher"

**Symptom.** On first launch of a Windows download, Windows shows *"Windows
protected your PC"* with an **unknown publisher**, or Defender/SmartScreen warns.

**Likely cause.** The Windows builds are **unsigned by design** for this beta (no
Authenticode certificate).

**What to do.**
- Click **More info**, then **Run anyway**.
- This is expected for an unsigned beta and is not a defect. Code signing would
  not, by itself, remove SmartScreen prompts, and none is claimed for this beta.
- Verify your download's SHA-256 against `SHA256SUMS-1.3.0-beta.3.txt` for peace
  of mind (see [INSTALLATION.md](INSTALLATION.md#verifying-your-download)).

---

## VSCodium (external editor) not found

**Symptom.** Using the explicit **Open in External Editor** action reports that no
editor was found, with a hint naming `WRL_FORGE_EDITOR`.

**Likely cause.** External-editor integration is **optional**. VSCodium (or VS
Code) is discovered only when you explicitly trigger the external-editor action —
ordinary file opening never launches it — and none was found on your system.

**What to do.**
- You don't need an external editor at all: WRL Forge has a **built-in native
  editor**. This message only appears when you deliberately ask for an external
  one.
- If you *want* an external editor, install VSCodium (or VS Code), or point WRL
  Forge at your editor via either:
  - the `WRL_FORGE_EDITOR` environment variable (an absolute path or a bare
    command on `PATH`), or
  - `editorCommand` in `settings.json` under the app's user-data folder
    (`~/.config/wrl-forge` on Linux, `%APPDATA%\wrl-forge` on Windows).
- An override that can't be resolved is treated as a preference: WRL Forge falls
  back to normal discovery, and only shows the not-found hint if nothing is found.

---

## Portable EXE automated-capture (stdout-handshake) limitation

**Symptom.** The project's **automated visual-capture** harness doesn't complete
against the portable Windows EXE.

**Likely cause.** The portable EXE has a documented **stdout-handshake
limitation** in the QA capture path.

**What to do.**
- This affects **automated capture only**, not normal interactive use — you can
  use the portable EXE normally.
- If you are running visual QA, use one of the other Windows builds (Setup EXE /
  MSI / unpacked ZIP) or the supported capture transport for that harness.

---

## What to attach to a bug report

When you open an issue at
**https://github.com/DJAscendance/wrlforge/issues**, please include:

- **WRL Forge version** (e.g. `1.3.0-beta.3`) and which **download** you used
  (AppImage / tar.gz / Setup EXE / MSI / Portable EXE / ZIP).
- **OS and version** (e.g. Linux distro + version, or Windows 11 23H2), and
  confirm it's **x64**.
- **Steps to reproduce**, and whether it's the **Mall** lane or **World Project**
  lane.
- **Screenshots** of the problem — the editor with any **diagnostics/advisories**
  visible, and the **preview** pane, are especially useful. For a blank/missing-
  asset issue, a screenshot of the **World scan report** (missing / unsafe /
  case-mismatch findings) is ideal.
- For a broken-scene report, the **`.wrl` file** (and its nearby assets) if you
  can share it — noting whether it is plain or **gzip-compressed**.
- Any **error text** shown in the app.

Please don't include secrets, private paths, or anything you can't share.

---

*WRL Forge is an independent community project and is **not** affiliated with,
endorsed by, or connected to Cybertown or its operators. It performs **no**
direct upload to Cybertown; the World Project Bundle is a manual-handoff package.*
