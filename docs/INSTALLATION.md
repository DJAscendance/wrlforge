# Installing WRL Forge

WRL Forge is a desktop application for inspecting, editing, and previewing
classic VRML97 `.wrl` content. This guide covers every download for the
**1.3.0-beta.3** public beta.

> **Beta / Prerelease / Unsigned.** This is still a beta. Windows
> builds are **not code-signed** (unsigned by design for this beta), so Windows
> SmartScreen/Defender may warn on first launch — see the Windows sections below.
> WRL Forge is **x64 only** (Linux x64 and Windows x64). There is no ARM64 build,
> no macOS build, and no Snap/Flatpak/Store package.

Recommended downloads are on **https://wrlforge.com**. Every package and its
checksum are also available from:
**https://github.com/DJAscendance/wrlforge/releases**

Verify your download against `SHA256SUMS-1.3.0-beta.3.txt` before running it
(see [Verifying your download](#verifying-your-download)).

| Platform | Recommended | Alternative |
|---|---|---|
| Linux x64 | AppImage | tar.gz |
| Windows x64 | Setup EXE | MSI, portable EXE, ZIP |

Ordinary users: on Linux download the **AppImage**; on Windows download the
**Setup EXE**.

---

## Linux — AppImage (recommended)

**File:** `WRL-Forge-1.3.0-beta.3-linux-x64.AppImage`

An AppImage is a single self-contained file that runs without installation.

1. Download the `.AppImage` file.
2. Make it executable:
   ```bash
   chmod +x WRL-Forge-1.3.0-beta.3-linux-x64.AppImage
   ```
3. Launch it:
   ```bash
   ./WRL-Forge-1.3.0-beta.3-linux-x64.AppImage
   ```

**Desktop integration.** The first time you run the AppImage, your desktop
environment may offer to add a menu entry and icon for WRL Forge. Accepting this
is optional — the AppImage runs the same either way. If you prefer automatic
integration, tools such as AppImageLauncher can register AppImages system-wide;
WRL Forge does not require them.

**FUSE note.** AppImages mount themselves using FUSE. On some minimal or newer
Linux installs, FUSE 2 is not present and you may see an error such as
`dlopen(): error loading libfuse.so.2` or `AppImages require FUSE to run`. Two
options:

- Install the FUSE 2 runtime (for example `libfuse2` / `libfuse2t64` on
  Debian/Ubuntu, `fuse` on Fedora), then run the AppImage again; or
- Extract and run without FUSE:
  ```bash
  ./WRL-Forge-1.3.0-beta.3-linux-x64.AppImage --appimage-extract
  ./squashfs-root/AppRun
  ```

**Updating.** Download the newer `.AppImage`, `chmod +x` it, and run it in place
of the old one. You can delete the previous file.

---

## Linux — tar.gz (portable app directory)

**File:** `WRL-Forge-1.3.0-beta.3-linux-x64.tar.gz`

This is the unpacked application directory in a tarball — useful if you prefer
not to use an AppImage.

1. Extract it to a location of your choice:
   ```bash
   tar -xzf WRL-Forge-1.3.0-beta.3-linux-x64.tar.gz
   ```
   This creates a WRL Forge application directory.
2. Launch the executable **inside** the extracted directory:
   ```bash
   cd wrl-forge-*/
   ./wrl-forge
   ```
   (The executable sits next to its bundled `resources/` and library files. Keep
   the directory intact — run the binary from within it, don't move the binary
   out on its own.)

**Optional desktop integration.** The extracted directory includes a helper that
installs a per-user application-menu entry, the approved cyan SVG icon, and the
`.wrl` / `.wrz` **Open With WRL Forge** association:

```bash
cd wrl-forge-*/
./install-linux-shortcut.sh
```

The helper discovers the extracted location automatically, supports paths with
spaces and other shell-sensitive characters, backs up a customized existing
entry before replacing it, and does not change your default VRML application.
Files opened this way enter the Mall Item lane; use the World Project workspace
for a world and its dependency folder. If you move the extracted application
directory later, rerun the helper from its new location.

**Updating.** Extract the new tarball and replace the old application directory
with it (delete the previous directory, or extract alongside and repoint your
shortcut).

---

## Windows — Setup EXE / NSIS installer (recommended)

**File:** `WRL-Forge-Setup-1.3.0-beta.3-x64.exe`

A standard Windows installer that adds a Start Menu entry and (optionally)
desktop shortcut.

1. Download and run `WRL-Forge-Setup-1.3.0-beta.3-x64.exe`.
2. **SmartScreen / unknown publisher.** Because this beta is **unsigned by
   design**, Windows SmartScreen may show *"Windows protected your PC"* with an
   *unknown publisher*. This is expected and not a defect. To continue, click
   **More info**, then **Run anyway**.
   *(Signing would not, by itself, remove SmartScreen prompts, and none is
   claimed for this beta.)*
3. Complete the installer. You can choose the install directory; it installs
   per-user and creates Start Menu / desktop shortcuts.
4. **Launch** WRL Forge from the **Start Menu** (search for "WRL Forge").

**Uninstall.** Remove WRL Forge like any Windows app —
*Settings → Apps → Installed apps → WRL Forge → Uninstall*, or via
*Control Panel → Programs and Features*. Uninstalling removes the app and its
shortcuts; your own `.wrl` files and world projects are untouched.

---

## Windows — MSI installer

**File:** `WRL-Forge-1.3.0-beta.3-x64.msi`

An MSI package for the same app, aimed at managed / enterprise deployment
(Group Policy, `msiexec`, software-distribution tooling).

- **Interactive install:** double-click the `.msi` and follow the prompts. As
  with the Setup EXE, this beta is **unsigned**, so SmartScreen/Defender may warn
  — proceed the same way (**More info → Run anyway**).
- **Silent / scripted install** (elevated command prompt):
  ```bat
  msiexec /i WRL-Forge-1.3.0-beta.3-x64.msi /qn
  ```
- **Uninstall:**
  ```bat
  msiexec /x WRL-Forge-1.3.0-beta.3-x64.msi /qn
  ```
  or via *Settings → Apps → Installed apps*.

If you are an ordinary single-machine user, prefer the **Setup EXE** above; the
MSI exists mainly for administrators who standardize on MSI-based deployment.

---

## Windows — Portable (no installation)

Two portable options — neither runs an installer and neither adds Start Menu
entries.

- **Portable EXE:** `WRL-Forge-Portable-1.3.0-beta.3-x64.exe` — a single-file
  portable app. Download it and run it directly. On first run, SmartScreen may
  warn (unsigned by design) — **More info → Run anyway**.
- **Portable ZIP:** `WRL-Forge-1.3.0-beta.3-windows-x64.zip` — the unpacked
  application directory. Extract it (right-click → *Extract All*, or your archive
  tool) to a folder such as `C:\Projects\wrlforge`, keep the folder intact, and
  run the WRL Forge executable inside it.

**Where settings are stored.** The portable builds do **not** keep their settings
next to the executable. Like the installed builds, WRL Forge stores its
configuration and window state in the standard Electron per-user application-data
location for the app — on Windows that is:

```
%APPDATA%\wrl-forge
```

The portable and installed builds share this same location, so preferences carry
across them. To reset WRL Forge to defaults, close it and remove that folder.

> **Portable EXE QA note.** The portable EXE has a documented stdout-handshake
> limitation that affects only the project's automated visual-capture harness —
> it does **not** affect normal interactive use.

---

## Verifying your download

Every artifact is listed with its SHA-256 hash in
`SHA256SUMS-1.3.0-beta.3.txt` on the release page. Verify before running.

**Linux:**
```bash
sha256sum -c SHA256SUMS-1.3.0-beta.3.txt
```
Run it from the folder containing both the checksum file and the downloaded
artifacts; each line should report `OK`.

**Windows (PowerShell):**
```powershell
Get-FileHash .\WRL-Forge-Setup-1.3.0-beta.3-x64.exe -Algorithm SHA256
```
Compare the printed hash against the matching line in
`SHA256SUMS-1.3.0-beta.3.txt`.

---

## Getting help

If installation or launch fails, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
To report a problem, open an issue:
**https://github.com/DJAscendance/wrlforge/issues**

---

*WRL Forge is an independent community project. It is **not** affiliated with,
endorsed by, sponsored by, or officially connected to Cybertown or its
current/former operators. "Cybertown" and related names belong to their
respective owners.*
