# WRL Forge Phase 7C5 Independent QA Audit Report (corrected)

> **Provenance / correction note.** The original independent (Gemini) draft of this
> report lived outside the repository and contained three factual errors that this
> corrected, in-repo version fixes against the actual evidence: an invented Linux
> test total ("224/224"), an unsupported absolute "Leaks: 0" claim, and an
> installed `DisplayVersion` *inferred from the artifact filename* rather than read
> from the registry. The audit was re-run on both platforms during the Phase 7C5.1
> app-icon closeout; figures below are anchored at that closeout commit and
> supersede the draft. Facts are labelled **[verified this pass]**,
> **[accepted from 7C5, not re-executed]**, or **[not manually repeated]**.

## 1. Audited repository and commit
- **Repository:** `wrlforge` (`github.com/DJAscendance/wrlforge`).
- **7C5 acceptance baseline:** `c95b5a5`.
- **Icon-closeout tip (this corrected audit):** `1cbbb68` (icon integration) +
  `5c9af96` (byte-exact `.gitattributes` for icon assets).

## 2. Working-tree status
- Linux: clean at the closeout tip; only the generated icon tree + evidence added.
- Windows: audited in the local NTFS clone `C:\Projects\wrlforge` (Fixed drive,
  not UNC/network — workspace-safety preflight passed). Prior-agent working-tree
  output was set aside reversibly (`git stash`) before checkout; tree clean at
  `5c9af96`. All scratch used disposable locations, since deleted.

## 3. Test totals — corrected

The draft's "224/224" corresponds to nothing in the tree and is withdrawn. The
authoritative breakdown, in one consistent format:

| Metric | Value |
|---|---|
| Nonvisual test **files** (the `npm test` set) | **55** |
| Individual nonvisual **tests** at `c95b5a5` | **567 / 567** pass |
| Individual nonvisual **tests** at the icon tip (`5c9af96`) | **580 / 580** pass |
| `node --test` suites | 0 (flat `test()` calls, not `describe()` suites) |
| `npm run check` (tests + full `node --check` syntax gate) | exit 0 |

- **Linux [verified this pass]:** 580/580, `npm run check` exit 0 (Node 20.20.2).
- **Windows [verified this pass]:** 580/580 at the same commit, `npm run check`
  exit 0 (Node 24.18.0, local NTFS). Tier-1 packed self-test **55/55**
  **[accepted from 7C5, not re-executed this pass]**.
- Historical note: the earlier free-form Windows note's "407/407" was the test
  count at the Phase 7C4 era, before later tests were added; it is not the current
  total and is not this report's figure.

## 4. Visual-suite results **[accepted from 7C5, not re-executed this pass]**
From the accepted `qa/phase-7c5-cross-platform/` evidence (both OSes, chips
matched, cleanup 0/0): Vision 9/9, Native editor 15/15, Mall preview 18/18, World
preview 22/22. These were **not** re-run during the icon closeout — the icon
change does not affect the rendered web contents these suites capture.

## 5. Resource cleanup — corrected wording
The draft's "Leaks: 0 (no lingering buffers or file descriptors)" overstates what
was measured (no memory/FD profiler was run). Corrected, evidence-based statement:

> **No process survivors or observable resource accumulation were detected during
> the audited runs.** WRL Forge process count was 0 before and 0 after every
> launch (dev smoke, installed-app smoke, portable), the visual-QA cleanup was
> 0/0 in the accepted 7C5 runs, and test-fixture hashes were byte-identical before
> and after all Windows testing (172 fixtures). No claim is made that every
> possible memory leak was disproven — that would require memory profiling that
> was not performed.

## 6. Installed application metadata — from the registry (not inferred)
NSIS silent install (`/S`), then read from the Windows uninstall registry:

| Field | Value |
|---|---|
| Registry hive | `HKCU` |
| Registry path | `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\5da646f8-3b5a-561c-9d2a-4470f9bb6657` |
| `DisplayName` | `WRL Forge 1.3.0-beta.1` |
| `DisplayVersion` | `1.3.0-beta.1` |
| `Publisher` | *(empty — no publisher configured)* |
| `InstallLocation` | *(empty registry value)* — actual location `%LOCALAPPDATA%\Programs\WRL Forge` (from `UninstallString`/`DisplayIcon`) |
| `UninstallString` | `"…\Uninstall WRL Forge.exe" /currentuser` |
| `DisplayIcon` | `…\WRL Forge.exe,0` (cyan) |

The value is read from the registry — it is not inferred from the artifact
filename. (It happens to equal the version, but is now evidenced, not assumed.)

## 7. App-icon integration **[verified this pass]**
- **Source artwork:** the four owner-approved `assets/wrl-forge-*.svg` preserved
  byte-for-byte (before==after on Linux; and byte-identical across Linux and
  Windows after the `-text` `.gitattributes` — cyan `f9b9063d…`, cyan-transparent
  `5a0e2094…`, yellow `4da6f88a…`, yellow-transparent `7ac1b165…`).
- **Determinism:** `npm run build:icons` is byte-identical on repeat runs on each
  platform, **and cross-platform byte-identical** (15 generated files incl.
  `MANIFEST.json` `4092d67f…` match exactly between Linux and Windows). Rasterizer
  `@resvg/resvg-js@2.6.2`, system fonts disabled.
- **ICO validity:** each of the four variant `.ico` contains 7 entries
  (16/24/32/48/64/128/256), verified by `file`/ImageMagick/PIL, each a square PNG.
- **Embedded in exe:** `release/win-unpacked/WRL Forge.exe` carries one icon group
  with all sizes 16→256 (Win32 `PrivateExtractIcons`); the 256px image is the cyan
  "WRL" artwork. Same for the installed exe (byte-identical extract).
- **Choosable icons:** all four `.ico` ship in `resources/icons/` (win-unpacked and
  installed), so a user can repoint a shortcut via Windows **Change Icon**. Cyan is
  the sole default executable identity; yellow never becomes primary.
- **Build:** `build:win` produced the unsigned portable + NSIS `1.3.0-beta.1` on
  native Windows; the hand-assembled multi-resolution ICO passed electron-builder
  validation.

## 8. NSIS lifecycle **[verified this pass]**
Install (`/S`, per-user) → install dir + `WRL Forge.exe` + `resources/icons/` +
Start-menu shortcut (icon `exe,0`) + uninstall registry entry created. Installed
app launched (smoke: `hasVrmlpadBridge`, `xiteLoaded`, `hasPreviewCanvas` all true,
Mall Item lane), self-quit, 0 survivors. Silent uninstall (`/S /currentuser`) →
install dir removed, shortcut removed, registry entry removed, 0 survivors.

## 9. Portable runtime **[verified this pass]**
The portable artifact launches (process starts, app self-extracts and runs); the
automated **stdout readiness handshake is not captured** because the
self-extracting stub does not forward the child Electron process's stdout. This is
the **documented, unchanged** limitation — an environment capture limitation, not
an application failure. No redesign was attempted.

## 10. Signing / trust
Artifacts labelled Private Beta — Unsigned; no Authenticode certificate (empty PE
cert table) **[accepted from 7C5]**. SmartScreen will flag the unsigned binary
(expected).

## 11. Artifact hashes (this build)
This icon build's artifacts differ from the pre-icon `SHA256SUMS-1.3.0-beta.1.txt`
committed at `c95b5a5` (the icon changed the exe; builds also embed timestamps):

```
a2194ad983800b7c31708af3dea8d72517289380c4403953b431637e9bcba0a1  …-portable.exe (99417282 B)
92bb0dd44dd27fbaae4a09aa058e578ff755b38244c21ea1199029ba51dddb2f  …-setup.exe    (99635852 B)
```

## 12. Claims not independently repeated **[not manually repeated]**
Interactive Windows UI workflows (Open/Save dialogs, drag-drop) were not driven by
hand this pass, consistent with the documented tier-3 smoke design. Visual suites
(§4) are carried from accepted 7C5 evidence.

## 13. Findings by severity
- Critical / High / Medium: **none**.
- Low (process): the prior Windows QA agent left two scratch directories at `C:\`
  root (`C:\wrl-qa`, `C:\wrl-gemini-qa`) and a dirty working tree; these were
  outside the repo, archived (inventory + zip) and removed during this closeout.

## 14. Final verdict
> **GO — Phase 7C accepted for broader unsigned private-beta distribution, with the
> documented portable visual-QA handshake and SmartScreen limitations.** The
> app-icon integration is verified on Linux and native Windows 11 and does not
> alter that conclusion.

Evidence: `qa/phase-7c5-icon-closeout/` (Linux + Windows), `qa/phase-7c5-cross-platform/`
(accepted 7C5), `docs/ICONS.md`.
