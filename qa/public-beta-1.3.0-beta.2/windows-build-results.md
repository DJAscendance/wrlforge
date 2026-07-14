# Windows Build & Verification — WRL Forge 1.3.0-beta.2

Two independent Windows build paths, both from commit `2eea330` / tag `v1.3.0-beta.2`:
1. **Local NTFS clone** `C:\Projects\wrlforge` (native Windows 11, Node v24, over SSH — **not** through any SMB share) — used to iterate and validate the build config.
2. **GitHub `windows-latest` runner** (`release.yml`) — produced the **published** artifacts.

## Build-config defect found and fixed
The electron-builder `zip` Windows target resolved to the **same output filename** as the `msi` target, and its internal 7za step failed (`The parameter is incorrect`, archiving into the `.msi` name) — failing the whole Windows build. Fix (`2eea330`): drop the `zip` electron-builder target and assemble the canonical `WRL-Forge-<v>-windows-x64.zip` from `release/win-unpacked` in the workflow (PowerShell `Compress-Archive`). After the fix, the native VM build produced all four Windows artifacts and the runner build succeeded.

Also fixed en route (`f2fce00`): `npm test` used shell globs that Windows npm (cmd/pwsh) does not expand, breaking CI on `windows-latest`; replaced with a Node file-enumerating runner (`scripts/run-tests.js`). CI is green on Ubuntu + Windows.

## Native VM build (config validation)
`npm run dist:windows` produced (canonical names, local NTFS, no SMB):
- WRL-Forge-Setup-1.3.0-beta.2-x64.exe (104.7 MB)
- WRL-Forge-1.3.0-beta.2-x64.msi (120.4 MB) — WiX 4.0, no collision
- WRL-Forge-Portable-1.3.0-beta.2-x64.exe (104.5 MB)
- WRL-Forge-1.3.0-beta.2-windows-x64.zip (150.1 MB, from win-unpacked)

MSI lifecycle on the VM-built artifact: silent install exit 0 → registered **WRL Forge v1.3.0.0** → silent uninstall exit 0 → registry entry removed.

## Published-artifact verification (official runner artifacts, transferred to the VM)
Downloaded the six published assets, verified each SHA-256 against the release manifest (all **OK**), transferred the four Windows artifacts to `C:\Projects\rel-verify` (local NTFS), and ran:

| Target | Checksum | Install | Version | Launch | Uninstall / extract |
|---|---|---|---|---|---|
| MSI | OK | `msiexec /i /qn` exit 0 | registry **1.3.0.0** | (app source-identical; see Linux launch) | `msiexec /x /qn` exit 0, **removed cleanly** |
| NSIS Setup | OK | `/S` exit 0 | registry **1.3.0-beta.2** | — | `/S` uninstall, **removed cleanly** |
| ZIP | OK | — | — | — | extracts to `WRL-Forge-1.3.0-beta.2-windows-x64/WRL Forge.exe` (runnable app, not source) |
| Portable | OK | — | — | no detectable process under headless automated capture — **documented stdout-handshake QA limitation** (expected; interactive launch verified in Phase 7C5.1 with the same config) | — |

## Zero-survivor / no-mutation
All process launches were force-terminated after check; no surviving `WRL Forge` processes. No fixture or source-tree mutation on the VM (the checkout at `2eea330` remained clean; artifacts were staged under a separate `C:\Projects\rel-verify`). No broad `taskkill /IM` was used. No passive VSCodium launch. No user `.wrl` files were touched.

## Windows platform notes confirmed
- MSI `ProductVersion` is numeric-only (`1.3.0.0`) — MSI cannot carry the `-beta.2` suffix; NSIS and the app About surface keep the full `1.3.0-beta.2`. This is expected, not a defect.
- Unsigned builds trigger SmartScreen (unsigned by design); documented in README/INSTALLATION/TROUBLESHOOTING.
