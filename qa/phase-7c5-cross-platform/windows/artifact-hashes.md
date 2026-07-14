# Phase 7C5 — Windows x64 Beta Artifact Hashes (1.3.0-beta.1)

> **PENDING FINAL BUILD.** These hashes are computed **after** the final
> `1.3.0-beta.1` rebuild from committed source (per the acceptance instruction:
> "Calculate final SHA-256 hashes only after the last rebuild"). The values below
> are filled in the closeout's final commit; the accompanying
> `SHA256SUMS-1.3.0-beta.1.txt` ships alongside the artifacts (not committed —
> `release/` is git-ignored and binaries are never committed).

| Artifact | Bytes | SHA-256 | Signature |
|---|---|---|---|
| `WRL Forge-1.3.0-beta.1-x64-PrivateBeta-Unsigned-portable.exe` | _pending_ | _pending_ | NotSigned |
| `WRL Forge-1.3.0-beta.1-x64-PrivateBeta-Unsigned-setup.exe` | _pending_ | _pending_ | NotSigned |

Validation build reference (`1.2.0-beta.2`, same source sans version): portable
99,357,271 B · setup 99,565,387 B · win-unpacked `WRL Forge.exe` 223,073,280 B —
all `NotSigned`, empty PE certificate table.

Runtime: Electron 41.7.1 · Node (in-electron) 24.15.0 · Chromium (electron 41's
bundled build).
