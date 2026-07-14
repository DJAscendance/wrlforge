# Release Artifacts — WRL Forge 1.3.0-beta.2

Source: `.github/workflows/release.yml` built natively from tag **`v1.3.0-beta.2`** (commit `2eea330`) on GitHub-hosted `ubuntu-latest` + `windows-latest` runners. Draft prerelease assembled with the combined checksum manifest. All names canonical; all checksums verified against [`SHA256SUMS-1.3.0-beta.2.txt`](SHA256SUMS-1.3.0-beta.2.txt).

| Artifact | Platform | Size (bytes) | SHA-256 | Verified |
|---|---|---|---|---|
| WRL-Forge-1.3.0-beta.2-linux-x64.AppImage | Linux x64 | 134154440 | 26c58a83a634c910a575a1f6287cc510b29445e89a23f486355dc5222e3b5b67 | checksum OK; launches, zero survivors |
| WRL-Forge-1.3.0-beta.2-linux-x64.tar.gz | Linux x64 | 127284232 | 68ca2d3b679b5f079ef4c5140c43f46fe5bccdb37d26d292fb66531dfd5eaff8 | checksum OK; extracts to runnable app dir |
| WRL-Forge-Setup-1.3.0-beta.2-x64.exe | Windows x64 (NSIS) | 109791533 | 286c94c57183c6a197108722294e78b9d1a5ac1b6780c6d7eddf73951c3b27f4 | checksum OK; install→v1.3.0-beta.2→uninstall clean |
| WRL-Forge-1.3.0-beta.2-x64.msi | Windows x64 (MSI) | 126255104 | 29f59abfc4b6effd44cee8983409975dd6b18ac757fd3b5a16be12f44a507bd7 | checksum OK; install→v1.3.0.0→uninstall clean |
| WRL-Forge-Portable-1.3.0-beta.2-x64.exe | Windows x64 (portable) | 109572720 | dce1fd99ab6a1fc5ff309bee1da500d0fe89c773d43320ea8505199aa014f4f0 | checksum OK; documented stdout-handshake QA limitation in headless capture |
| WRL-Forge-1.3.0-beta.2-windows-x64.zip | Windows x64 (unpacked) | 161843941 | 38599dadc68206cc140065161291c2c50169c06931086c214c1a491bb6844c9d | checksum OK; extracts to runnable app dir + `WRL Forge.exe` |

Every artifact embeds `package.json` version **1.3.0-beta.2** (the MSI ProductVersion normalizes to `1.3.0.0` per MSI numeric-version rules; NSIS DisplayVersion keeps the full `1.3.0-beta.2`; the app's About surface reports the full string). All ship the approved **cyan** WRL Forge icon. All unsigned by design (`CSC_IDENTITY_AUTO_DISCOVERY=false`). None contain `.git`, tests, QA evidence, `.edit.wrl`, backups, or owner absolute paths (see `package.json` `build.files`).
