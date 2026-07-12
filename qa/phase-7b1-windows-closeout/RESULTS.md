# Phase 7B1 — Real Windows 11 GUI verification (WinBoat)

Target build: **WRL Forge 1.2.0-beta.2** (private, unsigned, x64).
Environment: WinBoat (Docker `WinBoat`, `ghcr.io/dockur/windows:5.14`, Windows 11
x64, KVM), reached over RDP (FreeRDP). Host share `\\host.lan\Data` → Linux `/home/ryan`.

## Status: PENDING — interactive run required by maintainer

The VM is up and the Windows 11 desktop was reached over RDP
(`screenshots/win-desktop.png`). In this automated session, **synthetic pointer
input from `xdotool` was not delivered to the FreeRDP guest** (the flatpak-sandboxed
FreeRDP ignores XTEST-warped pointer motion, so injected clicks land nowhere). The
keyboard/mouse-driven GUI matrix below therefore could not be executed
autonomously. This matches the Phase 6B precedent, where the interactive Windows
GUI run was performed by the maintainer while automated logic ran headless.

**What IS already verified for this behavior change** (does not depend on the VM):

- Passive-launch removal, native-editing-no-`.edit.wrl`, explicit-launch, and
  explicit-recreate-working-copy — deterministic unit tests
  (`test/editor/mall-edit-flow.test.js`) + the Windows self-test cases in
  `qa/phase-6b-windows/win-selftest.js` (which run identically on real Windows once
  launched). "editor not found only on explicit request" — `test/product-posture.test.js`.
- Native editor GUI (open/edit/save/themes/diagnostics/outline/conflict) — Linux
  serialized visual QA (`qa/phase-7b-native-editor/` 15/15) + focused passive-launch
  visual pass (`qa/phase-7b1-native-closeout/` 3/3).

## Runbook for the interactive Windows verification

### A. Automated packed-runtime self-test (fastest, do first)
From the VM, run the batch on the host share (dismiss the mark-of-the-web
"Open File – Security Warning" with **Run**):

```
\\host.lan\Data\Projects\cybertown\wrlforge\qa\phase-7b1-windows-closeout\run-selftest-b2.bat
```

It copies `release\win-unpacked` (beta.2) to `C:\wrlforge-b2`, runs the self-test
under the packed Electron-as-node on real NTFS, and writes
`selftest-b2-win-result.json` + `selftest-b2-win-console.txt` back into this folder.
Expected: **45/45 passed** (incl. the two Phase 7B1 passive-launch cases). A
`selftest-b2-win-DONE.txt` marker is written on completion.

### B. Install + lifecycle
- Run `release\...-setup.exe` (NSIS), **More info → Run anyway**, install per-user.
- Launch from the Start-menu shortcut. Confirm one app session; confirm clean exit.
- Run the `...-portable.exe`; confirm it launches and exits cleanly.
- Uninstall (Settings → Apps): confirm app files + shortcuts removed, projects untouched.

### C. Passive-launch correction (the headline change)
- Open a Mall `.wrl`. **Confirm VSCodium does NOT launch** and **no editor-not-found
  message appears**.
- Click **Open in Native Editor** → the native editor opens.
- Click **Open in External Editor** → VSCodium launches only now.

### D. Native editor
- Plain `.wrl`: edit → Save → confirm timestamped `*.bak-<ISO>` backup.
- gzip `.wrl`: edit → Save → confirm it stays gzip. Reopen both.
- Spaces + non-ASCII path; dirty/saved states; Undo/Redo; Find; Replace; Go-to-line;
  cursor Ln/Col; diagnostics navigation; advisory separation; outline navigation;
  all four themes; theme persistence across relaunch.

### E. Conflict handling
- Stage an external change (edit the file in Notepad). In WRL Forge: **Cancel**
  preserves the buffer; **Reload** loads disk after confirmation; **Save As** writes
  a separate destination; the externally-changed original is not silently overwritten.

### F. Session behavior
- Mall → editor → Mall preserves the unsaved buffer. Restart WRL Forge → valid
  session restores; missing/stale session behaves safely.

### G. World integration
- Open a World Project; open the primary WRL in the native editor; open an
  authorized nested WRL; confirm graph-external / unsafe paths are rejected; confirm
  World preview + packaging still function.

### H. Optional VSCodium (already installed in the VM: `%LOCALAPPDATA%\Programs\VSCodium\`)
- Explicit launch works (plain + gzip external-editor workflows, spaces + Unicode);
  one normal editor instance; clean exit; no passive launch occurs.

## Evidence to capture
Windows/WinBoat/Electron-Node-Chromium versions; installed vs portable results;
native editor plain/gzip save; backup; conflict-dialog; search/replace; shortcuts;
diagnostics + outline nav; themes; session restore; World integration; explicit
VSCodium; process lifecycle; installer/uninstall. Store cropped screenshots here.
Do not commit machine-specific secrets, absolute private paths, or large binaries.
