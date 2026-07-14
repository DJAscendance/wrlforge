# Phase 7C5 — Known Limitations

These are truthful operational limits recorded during acceptance. None block the
private beta; each is scoped and non-regressive.

1. **Portable-exe capture handshake.** The self-extracting portable `.exe`
   launches a child app in a temp dir but does not forward that child's stdout, so
   the capture-server READY/result handshake over `VisualQaRunner` times out even
   though the render succeeds (PNG is produced via the file transport's disk side
   effect). Portable **runtime** is verified by the rendered output; automated
   result-plumbing against the portable target is not. `win-unpacked` and
   `installed` targets have no such limitation. Not an app defect.

2. **Unsigned artifacts / SmartScreen.** Artifacts are deliberately unsigned
   (empty PE certificate table), labelled **Private Beta — Unsigned**. Windows
   SmartScreen / "Unknown publisher" prompts are expected; no signing, auto-update,
   store packaging, or public release is configured. No SmartScreen-elimination
   claim is made.

3. **Windows GUI rendering needs a session.** Automated Windows visual QA renders
   via Electron `capturePage()` over the file transport; WebGL/`capturePage()` work
   over SSH in this guest, but a GUI-subsystem `electron.exe` cannot read stdin
   (root cause of defect #2, now fixed by the file transport).

4. **Chromium version not separately pinned in evidence.** Electron 41.7.1 ships
   its own Chromium; X_ITE confirmed WebGL 2.0. No first-frame metric is exposed by
   X_ITE, so none is reported.

5. **Guest Node is 24.18.0 vs Linux baseline 20.20.2.** Both satisfy the documented
   "Node 20+" requirement; the full suite is green on both.

6. **Flat-scope VRML semantics unchanged.** VRML040–044 remain advisory-only and
   never block saving; the scope-aware PROTO rewrite is explicitly out of 7C5 scope.

7. **No direct Cybertown upload / server submission.** Locked product decision —
   its absence is not a missing feature. World packaging is a manual hand-off
   bundle; no server-certified-format claim.
