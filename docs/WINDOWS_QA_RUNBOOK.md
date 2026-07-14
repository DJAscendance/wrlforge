# Windows QA Runbook (Phase 7C5)

How to reproduce the Windows-native acceptance. Companion to
`docs/WINDOWS_NATIVE_QA_PLAN.md` (design) and `qa/phase-7c5-cross-platform/`
(evidence). **Workspace safety: use only a local NTFS clone** (e.g.
`C:\Projects\wrlforge`). Never install/build/test/write fixtures from `\\<host-share>`,
an SMB share, or a host-mounted repo — the Phase 7C4.1 guard refuses UNC/network/
host-share workspaces.

## Environment
- Windows 11 (x64), Node 20+ (24 verified), Git, VSCodium (optional, for the
  external-editor test). `virt-manager`/QEMU or bare metal.
- Optional headless drive: enable **OpenSSH Server** on the guest and authorize a
  host key; then run every step below over `ssh`. The guest interactive console
  session is **not** required for the visual suites — the file transport +
  `capturePage()` render without a visible desktop.

## Preflight
```powershell
cd C:\Projects\wrlforge
git fetch origin; git checkout <commit>; git status   # clean, local NTFS
npm ci                                                 # electron/esbuild binaries present
```

## Automated gate
```powershell
npm test            # 567/567
npm run check       # exit 0
npm run build:editor
# Tier-1 packed self-test (no window; ELECTRON_RUN_AS_NODE):
$env:ELECTRON_RUN_AS_NODE=1
& node_modules\electron\dist\electron.exe qa\phase-6b-windows\win-selftest.js --out tier1.json   # 55/55
```

## GUI visual suites (file transport, one reused process each)
On Windows the orchestrators auto-select the **file-based** capture transport
(`qa/visual-qa/transport.js`) because a GUI-subsystem `electron.exe` cannot read
stdin. Run each; each writes `screenshots/` + `RESULTS.json`:
```powershell
node qa/phase-7c-vision/orchestrate.js          # 9/9
node qa/phase-7b-native-editor/orchestrate.js   # 15/15
node qa/phase-7c-mall-preview/orchestrate.js    # 18/18
node qa/phase-7c-world-preview/orchestrate.js   # 22/22
```
Each must report one launch, 0 survivors, and (Mall/World) overlays 0 / generations
0 at the leak/cleanup states. Never use broad `/IM` termination; the runner does
graceful close then targeted PID-tree kill only on timeout.

Packed/portable/installed targets via the Windows orchestrator or `qa/visual-qa/cli.js`:
```powershell
node qa/phase-7c-windows/orchestrate.js --jobs=<jobs.json> --out=<dir> --target=win-unpacked --allow-headed
node qa/visual-qa/cli.js <jobs.json> --target=portable --exe="<...portable.exe>" --allow-headed
node qa/visual-qa/cli.js <jobs.json> --target=installed --exe="<install dir>\WRL Forge.exe" --allow-headed
```
Note: the self-extracting **portable** stub does not forward the child app's stdout,
so its READY/result handshake times out even though the render (PNG) succeeds —
verify portable by the produced PNG.

## Build + installer lifecycle
```powershell
npm run build:win   # portable + NSIS + win-unpacked, unsigned
# verify unsigned: (Get-AuthenticodeSignature <exe>).Status  ->  NotSigned
# NSIS: run the setup /S ; confirm Apps entry + Desktop/Start-Menu shortcuts ;
#       launch installed exe ; uninstall /S ; confirm removal ; user data intact.
# hashes AFTER the final build:
cd release; certutil -hashfile "<artifact>" SHA256
```

## External editor
`resolveEditor()` finds `VSCodium.exe` at `%LOCALAPPDATA%\Programs\VSCodium`; the
explicit **Open in External Editor** action launches it on the `.edit.wrl` (space +
Unicode paths OK). Opening a Mall file never launches it passively.
