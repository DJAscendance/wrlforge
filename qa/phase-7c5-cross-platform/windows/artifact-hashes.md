# Phase 7C5 — Windows x64 Beta Artifact Hashes (1.3.0-beta.1)

Computed **after** the final `1.3.0-beta.1` rebuild from committed source `0ecde5e`
(`build:win` exit 0). Artifacts live in `release/` (git-ignored, never committed);
the shipped `SHA256SUMS-1.3.0-beta.1.txt` is recorded here for the committed evidence.

| Artifact | Bytes | SHA-256 | Signature |
|---|---|---|---|
| `WRL Forge-1.3.0-beta.1-x64-PrivateBeta-Unsigned-portable.exe` | 99,358,164 | `f66563293846bb952a2f9f88099599c9ca25687b568558ba8c5c721a0f501020` | NotSigned (empty PE cert table) |
| `WRL Forge-1.3.0-beta.1-x64-PrivateBeta-Unsigned-setup.exe` | 99,566,284 | `26d2e5b183cd4ec8d29e15031c31522a6c42b27286a99bb6f65e15d1351da757` | NotSigned (empty PE cert table) |

`release/win-unpacked/WRL Forge.exe` — also `NotSigned` (unpacked app dir; not a
distributed artifact). No signing identity was used (`CSC_IDENTITY_AUTO_DISCOVERY=
false`); no SmartScreen-elimination claim.

Runtime: Electron 41.7.1 · Node (in-electron) 24.15.0 · Chromium (electron 41's
bundled build).
