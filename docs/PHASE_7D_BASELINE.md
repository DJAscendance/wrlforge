# Phase 7D — Beta Polish Baseline and Acceptance Matrix

**Lane:** Phase 7D0 — recon and scope-definition only.
**Scope:** no production code changes. Establish current product truth, enumerate
real gaps with evidence, and propose the smallest safe implementation lanes to
finish 7D. Owner review gates all 7D work.

**Status key:** `PROVEN_COMPLETE` · `PARTIAL` · `MISSING` · `BLOCKED` · `NOT_APPLICABLE`

---

## 0. Repository truth at start of 7D0

| Field | Value |
|---|---|
| Repository | `/home/ryan/Projects/cybertown/wrlforge` |
| Branch | `main` |
| HEAD | `9b83664234395e1673b2853209dc9c15f808cb87` |
| `origin/main` | `9b83664234395e1673b2853209dc9c15f808cb87` |
| ahead/behind | 0 / 0 |
| Staged | none |
| Tracked drift | `M AGENTS.md` |
| Untracked | `AGENTS.archive.md`, `qa/qa-artifacts/` |
| Package version | `1.3.0-beta.3` |
| License | `GPL-3.0-or-later` (per `package.json`; per-product release is UNLICENSED all-rights-reserved — see `docs/RELEASES.md`) |

**Phase Beta 2 closeout (post-7D0):** Phase Beta 2 was corrected through
two QA passes (B1/B2/B3/B4/M1) and `PHASE_BETA_2_FINAL_REQA_PASS` was
issued. The lane shipped at 1983/1983 repository tests, 58/58 Electron
runtime assertions, 0 console errors, 0 console warnings. The final
Phase Beta 2 commit replaces 7D0's HEAD on `main`. See
`docs/PHASE_BETA_2_CRASH_RECOVERY.md` and the roadmap's Phase Beta 2 entry
for the as-built record and lifecycle rules.

**Phase: Accessibility + Performance — closeout (post-7D0 + post-Phase-Beta-2):**
The D1 PARTIAL/MISSING items (Mall + World toolbar semantics, ARIA
labels, `aria-keyshortcuts` on the shortcut-bearing buttons, inspector
list semantics, back-navigation focus) and the D2 re-measurement are
**CLOSED** under `docs/ACCESSIBILITY_PERFORMANCE.md`. Independent QA
verdict: `ACCESSIBILITY_PERFORMANCE_QA_PASS_WITH_NOTES`. Final state:
1996/1996 repository tests pass, 0 failed, 0 skipped; 13/13 focused
accessibility tests pass; real Electron accessibility PASS;
renderer memory stable at **45.20 MB** over 30 cycles (no retention
leak); 72-texture World current render **847 ms**. Performance gate
is `MEDIAN_GATE` — profile median < 250 ms; all profile medians pass
(`small Mall 0.2 ms · representative World 1.4 ms · ~327 KB 49.3 ms ·
~1.3 MB corpus 216.2 ms · script-heavy 34.4 ms · many errors
14.2 ms`). **No production performance code change was required.**
The pure-Node 1192.8 MB heap delta from the analyze() harness is
classified `ACCEPTABLE_EXPLAINED` / `NOT_A_VALID_PRODUCTION_MEMORY_MEASURE`
and is not WRL Forge runtime memory.

---

## 1. Current test baseline (proven)

| Gate | Result |
|---|---|
| `npm test` | **1923 / 1923 pass, 0 fail, 0 skipped, 1333 ms** |
| `npm run check` | **1923 / 1923 pass + node `--check` over all source** |
| `npm run build:editor` | **OK** (renderer/vendor/wrl-editor.bundle.js, 1.4 MB, 34 ms) |
| `git diff --check` | clean |
| Phase 7B perf gate | **PASS** — every analyze() median < 250 ms debounce (`qa/phase-7b-native-editor/perf.js`) |
| WD2-A final re-QA | **PASS** — 1923 tests, 70/70 runtime assertions, 0 console errors/warnings (`docs/white-dune-2026/WD2_A_SCENE_TREE_INSPECTOR_FOUNDATION.md`) |

Related per-file observations:

| Profile | Bytes | Median | Max |
|---|---:|---:|---:|
| small Mall item | 608 | 0.2 ms | 1.0 ms |
| representative World (70-texture) | 6 929 | 1.3 ms | 2.4 ms |
| ~327 KB file | 326 887 | 40.6 ms | 69.7 ms |
| ~1.3 MB corpus | 1 634 435 | **174.7 ms** | 240.7 ms |
| script-heavy (1500 Scripts) | 257 296 | 30.1 ms | 37.7 ms |
| many recoverable errors | 108 016 | 9.7 ms | 56.8 ms |

The 1.3 MB median is documented as approaching the 250 ms debounce; the debounce
keeps typing responsive but a post-idle reparse of >~1 MB is a visible spinner.

Ad-hoc D2 measurement (`node /tmp/perf-7d0.js`, Node 24.19):

| Fixture | Bytes | Nodes | parse | analyze | scene-tree | reparse |
|---|---:|---:|---:|---:|---:|---:|
| `test/fixtures/world/valid70/world.wrl` | 6 929 | 287 | 8.0 ms | 1.4 ms | 1.7 ms | 2.9 ms |
| `test/fixtures/world/mini/world.wrl` | 2 475 | 102 | 0.5 ms | 0.2 ms | 0.3 ms | 0.4 ms |
| `test/fixtures/preview/real-smartcar-lite.wrl` | 17 675 | 264 | 5.7 ms | 1.3 ms | 2.1 ms | 5.4 ms |
| `test/fixtures/oversized.wrl` | 326 887 | 5 | 62.5 ms | 5.7 ms | 2.3 ms | 37.1 ms |

---

## 2. Acceptance matrix (D1–D6)

### D1 — Keyboard accessibility

| Property | Status | Evidence | Gap | Risk | Recommended lane | Acceptance |
|---|---|---|---|---|---|---|
| Native editor scene tree: roving-tabindex, ARIA `role=tree`/`treeitem`, `aria-level`, `aria-selected`, no `aria-expanded` on leaves | `PROVEN_COMPLETE` | `renderer/scene-tree.js` 55–216; `renderer/editor.html` 245, 462; WD2-A re-QA report | none | none | — | regression tests under `test/editor/scene-tree-integration.test.js` keep this |
| Native editor toolbar: `role=toolbar`, `role=group` for zoom, `aria-label` on every action, focus-visible outline | `PROVEN_COMPLETE` | `renderer/editor.html` 88–90, 322, 334–340 | none | none | — | test asserts every action carries `aria-label` + visible focus |
| Native editor modal: `role=dialog`, `aria-modal`, `aria-labelledby`, Enter/Space handlers on inputs (Go to line, Find/Replace) | `PROVEN_COMPLETE` | `renderer/editor.html` 491–498; `renderer/editor.js` 179, 209 | none | none | — | test asserts modal trap and Escape behavior |
| Native editor zoom (`Ctrl +/-/0`) — coherent for chrome (rem) and code area (font compartment) | `PROVEN_COMPLETE` | `renderer/editor.html` 66–67, 88, 322–340; `qa/phase-7c-vision/` (9/9) | none | none | — | covered by `qa:vision` |
| Native editor World preview controls: viewpoints, navigation, Find new files have labels | `PROVEN_COMPLETE` | `renderer/editor.html` 428, 432, 440; `renderer/editor-preview.js` 161–216 | none | none | — | covered by `qa:world-preview` (22/22) |
| Native editor live preview: keyboard-operable split/Update/Maximize (`Ctrl+Enter`, `Ctrl+Shift+Enter`, divider keyboard) | `PROVEN_COMPLETE` | `renderer/editor-preview.js` 155, 105–140; `renderer/editor.html` 351–353 | none | none | — | chip + status-line test |
| Mall (`renderer/index.html`): focus-visible outlines, `aria-live` on preview/editor status, `tabindex=0` on `<x3d-canvas>` | `PARTIAL` | `renderer/index.html` 50–52, 126, 144–145 | **Toolbar buttons have no `aria-label`s** — relies on text only; **no `role=toolbar`** on the row of 5 action buttons + checkbox; **no keyboard shortcut affordances** documented for Repack / Re-check | Low — text labels exist; screen-reader order is the document order which is correct | 7D1 | add `aria-label` to icon-only controls, add `role=toolbar"`, add documented `Ctrl+R`/`Ctrl+S` shortcuts, add `aria-keyshortcuts`, pin with tests |
| World (`renderer/world.html`): focus-visible, `aria-live` on status, `tabindex=0` on `<x3d-canvas>` | `PARTIAL` | `renderer/world.html` 46, 149, 174–175, 236 | Same gaps as Mall (no `role=toolbar`, no `aria-label`s on icon-only buttons, no `aria-keyshortcuts`) | Low | 7D1 | mirror Mall remediation; assert via re-QA |
| Editor inspector (`renderer/scene-inspector.js`) — ARIA semantics | `PARTIAL` | `renderer/editor.html` 466; `renderer/scene-inspector.js` | Inspector renders findings rows but does not list each as `role=listitem` with a labelled-by summary | Low–medium | 7D1 | declare `role=list`, ensure each row has accessible name from P4-B message text |
| Theme contrast across all 4 editor themes (Dark/Light/Terminal/Tokyo Night) + High Contrast | `PROVEN_COMPLETE` | `qa/phase-7b-native-editor/RESULTS.md` rows 13–15; `qa/phase-7c-vision/` 9/9 | none | none | — | covered by `qa:vision` |
| Mall toolbar `Ctrl+L` shortcut (keyboard-open `.wrl` via dialog) | `MISSING` | `renderer/index.html` 116; `renderer/renderer.js` | No keyboard equivalent to "Open mall .wrl…" — must use mouse. GTK dialog also does not accept `Ctrl+L` reliably per AGENTS.md known gotcha | Low | 7D1 | document but DO NOT add — owner concern about GTK reliability (AGENTS.md §"Known gotchas") |
| World toolbar `Ctrl+O` shortcut | `MISSING` | `renderer/world.html` 140 | Same as above | Low | 7D1 | document, do not add |
| Visible focus on every actionable control (outline not relying on `:hover` only) | `PROVEN_COMPLETE` | focus-visible in CSS across all 3 renderers | none | none | — | visual regression already covers this |
| Disabled-state semantics (correct `disabled`/`aria-disabled`) | `PROVEN_COMPLETE` | every action button uses `disabled=`; CSS distinguishes | none | none | — | covered by visual QA |
| Focus after workspace change (Mall → Editor → World) | `PARTIAL` | `renderer/editor.html` 323 (`← Back` button); `renderer/editor.js` 601 (`S.handle.focus()`) | After `← Back`, focus is not explicitly moved back to the originating workspace's primary action; documented `expectedFocusId` does not exist | Low | 7D1 | add `aria-live` announcement + focus return on Back |
| Inspector keyboard reach (Tab to focus findings rows?) | `PARTIAL` | `renderer/scene-inspector.js` | Inspector rows have no `tabindex`, so the screen-reader user reaches them only via virtual cursor; not consistent with scene-tree roving-tabindex | Low | 7D1 | add `tabindex="-1"` + roving-tabindex parity with scene tree |
| Modal Escape behaviour | `PROVEN_COMPLETE` | `renderer/editor.js` 419 (`window.addEventListener('keydown'…)`) | none | none | — | test covers |

### D2 — Large-project performance

| Property | Status | Evidence | Gap | Risk | Recommended lane | Acceptance |
|---|---|---|---|---|---|---|
| Native editor analyze() perf gate at 250 ms debounce | `PROVEN_COMPLETE` | `qa/phase-7b-native-editor/perf.js` PASS on 6 profiles; documented 1.3 MB median 175 ms | none | none | — | gate stays in `qa:phase-7b` |
| Scene-tree construction on a real Cybertown world (70 textures, 287 nodes) | `PROVEN_COMPLETE` | this lane's ad-hoc measurement: 1.7 ms | none | none | — | covered |
| Asset-graph scan on `valid70` (the canonical 70-texture fixture) | `PROVEN_COMPLETE` | Phase 4A/4B evidence + Phase 7C3 state #19 (72-texture world renders in 0.58–0.81 s end-to-end) | none | none | — | covered by `qa:world-preview` |
| 72-texture world live preview scene-replacement latency | `PROVEN_COMPLETE` | `qa/phase-7c-world-preview/RESULTS.md`: ~0.58–0.81 s end-to-end including parse, scan-graph install, overlay, X_ITE scene settle | none | none | — | covered |
| Parse/analyze/tree re-run latency (`reparse`) | `PROVEN_COMPLETE` | this lane's measurement; 327 KB reparse 37 ms | none | none | — | covered |
| Mall Fit preview on large item (Mall-original path) | `PROVEN_COMPLETE` | `qa/phase-2b1-production-fit/RESULTS.md` | none | none | — | covered |
| 1.3 MB+ corpus analyze() approach to 250 ms debounce | `PARTIAL` | 174.7 ms median / 240.7 ms max — within budget but flagged in `qa/phase-7b-native-editor/RESULTS.md` "Known limitation" | typing stays responsive (debounce), but a paused reparse of a >~1 MB file shows a visible spinner | Low (debounce mitigates) | 7D1 (re-measure under realistic workload) | measure + decision: keep debounce or raise; document |
| Source-map / node-schema generation perf | `PROVEN_COMPLETE` | `scripts/build-node-schema.js` runs offline; never in hot path | none | none | — | covered |
| Source-map lookups on hot path (click-to-reveal) | `PROVEN_COMPLETE` | WD1.1 evidence; opt-in lazy creation (`createSourceMap(parseResult)`) | none | none | — | covered |
| Existing memory profiling (heap delta) | `PROVEN_COMPLETE` | `qa/phase-7b-native-editor/perf.js` records `Heap delta over the whole run: 233.5 MB` — high but acceptable for a pure-Node short-lived harness | None for the harness; renderer-side memory not measured | Low | 7D1 | add a small renderer-side memory sanity check on a large world (existing `heapUsed` instrumentation) |
| X_ITE render time on the largest real project (the CTR bundled world) | `MISSING` | Not measured in the public record; only the 72-texture `qa:world-preview` state #19 captured it | We have no reproducible CTR-bundled-world render-time baseline | Medium — the asset graph scan proves we can render the project; we have no timing number | 7D1 | measure on `ctng/`-style fixture or the bundled CTR world if accessible; record median/max render time |
| Native editor memory on a long edit session | `MISSING` | Not measured | We have no steady-state editor memory number | Low–medium | 7D1 | run `qa:phase-7b-native-editor` style stress with `process.memoryUsage()` sampled |
| `wrlworld://` scheme handler perf for many concurrent nested reads | `PROVEN_COMPLETE` | Phase 7C3 stress (`qa/phase-7c-world-preview/stress.js`) covers 100 edits and project-switch; no leak; generation counts zero after close | none | none | — | covered |

### D3 — Crash recovery

This workstream classifies four concerns separately: **file backup**, **unsaved-buffer recovery**, **app-restart recovery**, and **preview-failure recovery**.

| Property | Status | Evidence | Gap | Risk | Recommended lane | Acceptance |
|---|---|---|---|---|---|---|
| **File backup.** Mall `Repack & Save` writes a timestamped backup next to the real `.wrl` BEFORE overwriting. Editor `safeSave` writes a timestamped backup, then a temp-then-atomic-rename, with an external-change conflict guard. `.bak-*` files are gitignored so they never leak. Backup-before-repack survives a failed write. `mallPath` corruption / external-change detection on Repack is handled by `detectExternalChange` + `allowOverwrite`. | `PROVEN_COMPLETE` | `main.js:986`; `src/files/backups.js`; `src/editor/file-io.js` 114–157 (`safeSave`); `src/editor/session.js` 91–103; `file-io.js` `detectExternalChange` (53–66); `.gitignore` includes `*.bak-*`; `qa/phase-7b-native-editor/RESULTS.md` state 11 (external-change conflict dialog); 6B selftest 31/31 | none | none | — | covered |
| **Unsaved-buffer recovery on app crash.** Abnormal exit while editor is dirty. | `PROVEN_COMPLETE` | `src/editor/recovery-store.js` + `recovery-controller.js`; `main.js` IPC `editor:recoveryRecordDirty` / `recoveryRead` / `recoveryAdopt` / `recoveryClear`; `renderer/recovery-prompt.js` Restore/Start Fresh; `docs/PHASE_BETA_2_CRASH_RECOVERY.md`; +28 recovery tests | none | none | — | covered |
| **Unsaved-buffer recovery on graceful close.** User closes app with a dirty editor. | `PROVEN_COMPLETE` | `editor:close` IPC handler in `main.js` calls `recoveryController.recordClear()`; `editor.js` `doClose()` runs `flushRecoverySnapshot` before close | Closing on purpose no longer strands a dirty buffer in the recovery slot — the snapshot is cleared at Close by deliberate user choice | none | — | covered |
| **Renderer-process crash recovery.** X_ITE / renderer killed. | `PROVEN_COMPLETE` | `win.webContents.on('render-process-gone')` in `main.js` does a single-shot `webContents.reload()` with a 10s burst guard; `forceFlush()` runs before the reload so the snapshot is freshest; `will-prevent-unload` does the same for navigations the renderer tries to cancel | None for the recovery substrate itself | none | — | covered |
| **Preview-failure recovery.** Parse error mid-update keeps the last valid scene. | `PROVEN_COMPLETE` | `src/preview/preview-state.js` last-valid-scene state machine; `qa:phase-7c-mall-preview/` + `qa:phase-7c-world-preview/` verify "Showing last good version" + zero overlay/generation leak | none | none | — | covered |
| **App restart — window state.** Size + position + maximized flag restored. | `PROVEN_COMPLETE` | `main.js:267–278` (`saveWindowState`) + `loadWindowState` (250–265); legacy path fall-back | none | none | — | covered by 6B selftest |
| **App restart — most-recent editor document** (with previously-authorized-context guard). | `PROVEN_COMPLETE` | `src/editor/session-store.js` + `editor-controller.js` `restore()`; renderer `renderer/editor.js:585` calls `bridge.restore()`; `qa:phase-7b-native-editor/perf` + 6B selftest cover restore | none | none | — | covered |
| **App restart — most-recent Mall item** | `MISSING` | No `mall-session.json`; `currentSession` is main-process state only; owner policy §4.4 explicitly defers auto-restore | User re-opens Mall lane to empty workspace | Low | deferred (recorded) | owner decision: NOT approved in Phase Beta 2 (deferred) |
| **App restart — most-recent World Project** | `MISSING` | No `world-session.json`; `currentSession` is main-process state only; owner policy §4.5 explicitly defers auto-restore + auto-scan | User re-opens World lane to empty workspace (consistent with current 4A/4B/5A posture) | Low | deferred (recorded) | owner decision: NOT approved in Phase Beta 2 (deferred) |

**Final D3 counts (post-Phase Beta 2):**

| Classification | Count | Rows |
|---|---:|---|
| `PROVEN_COMPLETE` | **7** | file backup · unsaved-buffer crash recovery · unsaved-buffer graceful close · renderer-process crash recovery · preview-failure recovery · app restart window state · app restart editor document |
| `PARTIAL` | **0** | — |
| `MISSING` | **2** | Mall item restart restore · World Project restart restore (both deferred per owner policy §4.4 / §4.5) |

Phase Beta 2 closed the previously-MISSING / PARTIAL rows; the only remaining items are the two deferred Mall / World auto-restores the owner explicitly rejected for this lane.

### D4 — Session restoration (per-state classification)

| State | Currently restored? | Owner disposition (suggested) | Evidence |
|---|---|---|---|
| Window size + position | YES | keep | `window-state.json` |
| Window maximized flag | YES | keep | `loadWindowState` |
| Active workspace (Mall / World / Editor) | NO — page always loads as Mall (default `currentPage = 'mall'`) | **decision needed** | `main.js:127` `await mainWindow.loadFile(... 'index.html')` |
| Open Mall item | NO | should probably remain transient | `currentSession` is in-memory; no `mall-session.json` |
| Open World Project (root + primary) | NO | should probably remain transient (root path can move) | no `world-session.json` |
| Open native editor document | YES (with previously-authorized-context guard) | keep | `editor-session.json` |
| Editor dirty vs clean | YES — restore re-loads the saved text; the `dirty` flag is reset to clean on restore (intentional — the buffer was never persisted) | keep | `editor-controller.js` `restore()` re-opens via `session.open()` |
| Editor selected tab (Outline / Scene tree / Inspector / Diagnostics / Advisories) | NO | should probably remain transient | tabs are sidebar sections, not tabs |
| Scene-tree selection | NO | should probably remain transient (selection is fragile after re-parse) | `renderer/scene-tree.js` `selectedId` |
| Inspector state | NO | should probably remain transient | tied to scene-tree selection |
| Preview mode (Mall: Original vs Fit) | NO | should probably remain transient | `renderer/index.html` radios |
| Preview layout (Split / Maximize / Editor-only) | PARTIAL — **persisted** for the editor (`renderer/editor-preview.js`), **not** for standalone World preview | keep | `ui-state.js` previewLayoutSelect |
| World preview viewpoint | NO (selected per-session; lost on refresh/close) | owner decision (low risk if kept transient) | `renderer/world-preview.js:161,216` |
| World preview navigation mode | NO | owner decision | `renderer/world-preview.js:316` |
| Editor zoom level | YES | keep | `ui-state.js` zoom; `qa:phase-7c-vision/` 9/9 |
| Editor theme | YES | keep | `ui-state.js` themeSelect |
| Split fraction (editor / preview) | YES | keep | `ui-state.js` |
| `editorCommand` user setting | YES (read from `settings.json`) | keep | `app-settings.js` |

**Owner decisions queued from D4 (none of them are pre-decided by 7D0):**

1. Restore the active workspace on launch (currently always Mall)?
2. Restore the most-recently-open Mall `.wrl`?
3. Restore the most-recently-open World Project root?

These are recorded as **owner decisions** in §6 of this report. The implementation
lanes do NOT pre-decide them.

### D5 — Linux + Windows verification

| Capability | Linux status | Windows status | Source | Remaining gap |
|---|---|---|---|---|
| `npm test` | 1923/1923 pass on commit 9b83664 | documented pass (567/567) on commit `c95b5a5` (7C5) + same suite on 9b83664 in CI | `qa/phase-7c5-cross-platform/RESULTS.md`, `.github/workflows/` | none |
| `npm run check` (syntax + tests) | passes | passes (CI confirmed) | same | none |
| `npm run build:editor` | passes | passes | `npm run build:editor` is cross-platform | none |
| `npm run build:win` (cross-build on Linux via wine) | passes | passes (`build:win` runs on Windows itself per Phase 7C5) | `docs/BUILD.md` | none |
| `npm run build:win:portable` | passes | passes | same | none |
| `dist:linux` (AppImage + tar.gz) | reproducible | N/A | `docs/BUILD.md` | none |
| Tier-1 packed self-test on Win11 | n/a | **55/55** on commit `c95b5a5` | `qa/phase-7c5-cross-platform/RESULTS.md`; `qa/phase-7c-windows/orchestrate.js` | none |
| Tier-1 packed self-test on Linux | n/a | n/a | Linux self-test in CI | none |
| Tier-2 `VisualQaRunner` visual GUI pass — vision | 9/9 | 9/9 on real Win11 | `qa/phase-7c-vision/RESULTS.md` | none |
| Tier-2 visual — native editor | 15/15 | 15/15 on real Win11 | `qa/phase-7b-native-editor/RESULTS.md` | none |
| Tier-2 visual — Mall unsaved-buffer preview | 18/18 | 18/18 on real Win11 | `qa/phase-7c-mall-preview/RESULTS.md` | none |
| Tier-2 visual — World unsaved-buffer preview | 22/22 | 22/22 on real Win11 | `qa/phase-7c-world-preview/RESULTS.md` | none |
| VSCodium live launch (Phase 6B1 closeout) | n/a | 13/13 on real Win11 | `qa/phase-6b1-vscodium/RESULTS.md` | none |
| NSIS install/uninstall lifecycle | n/a | verified on real Win11 | `qa/phase-7c5-cross-platform/RESULTS.md` | none |
| Window-state/userData paths (Linux + Win) | verified | verified (6B/6B1) | `qa/phase-6a-windows/RESULTS.md` | none |
| Case-mismatch detection on case-insensitive FS | hardened by code + real NTFS test | passes | Phase 6A code audit | none |
| `npm run build:win` Windows native build | n/a | verified on real Win11 | `qa/phase-7c5-cross-platform/RESULTS.md` | none |
| Live Windows file-based capture-server transport | n/a | working (commit `0a9eca8`) | `qa/visual-qa/transport.js` | none |
| WinBoat → libvirt/QEMU migration (`win11` guest @192.168.122.170, SSH) | n/a | confirmed | `phase-6a-windows-status.md` memory | none |
| `win11` ARM64 build | n/a | **NOT DONE** (Phase 6B1 explicit exclusion) | roadmap §"Explicitly not implemented" | owner-decision; not in 7D scope |
| Win11 SmartScreen reputation | n/a | known expected (unsigned) | `docs/SIGNING_READINESS.md` | signing is not a 7D lane |

**Net D5:** `PROVEN_COMPLETE` for the cross-platform beta envelope (Linux + Windows
x64) under `VisualQaRunner`. **Remaining 7D gap:** zero.

### D6 — Beta packaging

| Property | Status | Evidence | Gap | Recommended lane | Acceptance |
|---|---|---|---|---|---|
| Package version | `1.3.0-beta.3` | `package.json` | none | — | — |
| Linux artifact support | AppImage + tar.gz (x64) | `package.json` `build.linux.target` | none | — | covered |
| Windows artifact support | NSIS installer + portable `.exe` + MSI (x64) | `package.json` `build.win.target` | none | — | covered |
| `npm run dist:linux` | reproducible | `release/WRL-Forge-1.3.0-beta.2-linux-x64.{AppImage,tar.gz}` on disk | none | — | covered |
| `npm run dist:windows` | reproducible | built by Phase 6A/6B/7C5 (`release/` shows Linux only because Windows builds are produced on Win11 itself, not on this host) | owner-decision: rebuild Windows artifacts on the current `main` commit | 7D3 | re-build, re-checksum, record SHA-256 |
| Checksums | `SHA256SUMS-1.3.0-beta.2.txt`; `release:checksums` script | `package.json` `scripts.release:checksums` | none | — | covered |
| Release notes | `docs/BETA_RELEASE_NOTES.md`, `docs/RELEASES.md` | committed | none | — | covered |
| Signing readiness | documented (not signed) | `docs/SIGNING_READINESS.md` — never signed by design | signing is **not** a 7D lane | — | — |
| Private/public status | `private: true` in `package.json`; **public beta** published on GitHub as `v1.3.0-beta.2` (current `main` is `1.3.0-beta.3`, not yet released) | `docs/RELEASES.md`; `phase-public-beta-1.3.0-beta.2.md` memory; `release/latest-linux.yml` shows `1.3.0-beta.2` | `1.3.0-beta.3` is described in RELEASES.md but no GitHub release exists | 7D3 | owner-decision: publish `v1.3.0-beta.3` or hold |
| Artifact location policy | `release/` is gitignored; `release:checksums` writes there; the GitHub release page is the public mirror | `.gitignore`; `docs/RELEASES.md` | none | — | covered |
| Determinism | Phase 5A: deterministic ZIP with fixed 1980 timestamps; `electron-builder` AppImage/tar.gz deterministic enough for byte-identical builds | `src/world-project/zip-writer.js`; `package.json` `build.compression: "normal"`, `npmRebuild: false` | none | — | covered |
| License | `GPL-3.0-or-later` in `package.json`; per-release binary is UNLICENSED all-rights-reserved (relicensing was MIT → GPL at commit `2eb7c39`; historical MIT releases keep their permissions) | `docs/RELEASES.md`; `OPEN_SOURCE_PROVENANCE.md`; `phase-oss1-gpl3-transition.md` memory | per-release `LICENSE` text inside the bundle is the **historical** MIT — needs owner-decision on what the in-bundle LICENSE says now (README + GitHub release update are sufficient or is a bundle `LICENSE` rewrite needed?) | 7D3 | owner-decision; out of scope for code change |

**Net D6:** packaging pipeline and evidence are complete. The only 7D work is to
**re-run packaging on `main`** so the released artifact matches the source HEAD,
and to record the result. **No new packaging feature work.**

---

## 3. Phase 5 roadmap audit

Phase 5 in `docs/WRL_FORGE_ROADMAP.md` (lines 385–403) is titled "Embedded X_ITE
Preview" and is marked **⏳ planned**. Its three stated goals:

> 1. Integrate X_ITE as WRL Forge's embedded rendering engine — do not build a custom VRML/X3D renderer.
> 2. Isolate the preview from privileged Electron APIs (same contextIsolation/nodeIntegration discipline).
> 3. Preserve the external VSCodium workflow.
> 4. Support both Mall Item and World Project contexts.

Plus completion criteria:

> 1. Preview renders a real mall item and a real world sample correctly.
> 2. Security review confirms the preview surface has no more Electron privilege than it needs.
> 3. VSCodium-based editing/preview workflow still works unchanged for users who prefer it.

**Audit verdict:** `ALREADY_SATISFIED_NEEDS_ROADMAP_RECONCILIATION`.

Evidence:

- X_ITE is the only embedded engine — no custom renderer exists. `package.json`
  `dependencies` lists only `x_ite: ^15.1.10`. Per-product rule confirmed
  (`AGENTS.md` §"Locked product decisions").
- `contextIsolation: true` / `nodeIntegration: false` is enforced in
  `main.js:294–296`; every renderer (Mall, World, Editor) carries a strict CSP
  with no remote origin; preview URLs are blocked at the network layer
  (`main.js:210–213`); read-only IPC confined to `preview:load`/`world:previewLoad`;
  the `wrlworld:` scheme is asset-graph-allow-listed and project-root-confined.
- Mall preview lands in **Phase 2B1** (Phase 2A/2B0 prep); World preview in
  **Phase 4B**; both verified on real Win11 in Phase 7C2/7C3 (`qa:phase-7c-mall-preview`
  18/18 + `qa:phase-7c-world-preview` 22/22).
- Real mall item renders correctly (Phase 2B1 evidence); real world sample renders
  correctly (Phase 4B + 7C3 evidence).
- VSCodium is preserved as an explicit optional action; the passive launch was
  removed in **Phase 7B1** (`src/editor/mall-edit-flow.js`); the live launch
  closeout is **Phase 6B1** (13/13 on real Win11).

The **only** change 7D0 proposes to the roadmap is to:

- Replace "Phase 5 — Embedded X_ITE Preview ⏳" with a Phase 5 ⏳ note that says
  "Subsumed by Phase 2B (Mall) and Phase 4B (World); no remaining unimplemented
  work."
- Or, equivalently, move Phase 5 to the ✅ done list under its existing sub-phase
  references, with the rationale and the original sub-headings intact so history
  is not rewritten.

No code changes. No sub-lane work. **This is a one-line factual correction.**

---

## 4. Phase 6 dependency note

The roadmap's Phase 6 (Packaging) is still **incomplete**:

- **Mall Item deterministic package output** — MISSING. The Mall lane repacks
  the working `.edit.wrl` into the mall `.wrl` in place (with timestamped
  backup); there is no separate, uploadable Mall package artifact distinct from
  the repacked file.
- **Shared human-readable validation report** — MISSING across profiles. Mall
  validator output and World package-plan `REPORT.md` exist but are not unified.
- **True World upload-ready packaging** — blocked on `docs/WORLD_PACKAGE_QUESTIONS.md`.

**Effect on Phase 7D:** none. Phase 7D does not implement packaging; it does not
exercise the missing items. Phase 7D's D6 lane only re-runs the existing
`dist:linux` / `dist:windows` on the current source tree.

---

## 5. Phase 3 dependency note

Phase 3 has two open research items:

- Document the current CTR world-submission workflow as it actually exists today.
- Inspect Scott99's `worlduploader`/`itemuploader` tools as historical reference
  only (no code or asset copying).

**Effect on Phase 7D:** none. Neither item blocks 7D.

Phase 7D's deliverables (D1–D6) do not depend on knowing the live CTR submission
workflow, do not require Scott99 tooling documentation, and explicitly do not
implement packaging (which is where Phase 3's open items would matter most).
**Conclusion:** does not block Phase 7D.

---

## 6. Proposed Phase 7D implementation lane split

Three implementation lanes are recommended, each bounded, each gate-able:

### Phase 7D1 — Keyboard accessibility + large-project performance

**As-built lane name: `Phase: Accessibility + Performance`. See the roadmap
entry for the closeout status. The 7D1 label is preserved here for evidence
back-compat.**

| Aspect | Description |
|---|---|
| **Scope** | D1 `PARTIAL`/`MISSING` items + D2 ad-hoc measures; explicit exclusions below. |
| Repository actions | (a) Mall toolbar: add `role=toolbar`, `aria-label` on every action button, `aria-keyshortcuts`; add `Ctrl+R` (Repack) and `Ctrl+E` (Open in Native Editor) on the Mall lane only if not blocked by the GTK gotcha. (b) World toolbar: mirror. (c) Inspector findings rows: declare `role=list`, set `tabindex="-1"` + roving-tabindex parity with scene tree. (d) `← Back` focus return. (e) Re-measure native editor analyze() under the now-larger `main` (WD2-A added scene-tree + scope-graph work) to confirm 250 ms debounce still holds. (f) Measure X_ITE render time on the largest known fixture (`valid70/world.wrl` already exists; record median/max). (g) Add a small renderer-side memory sanity check on a large world. (h) No `Ctrl+L`/`Ctrl+O` for file dialogs — document the GTK gotcha and skip. |
| Explicit exclusions | Modifying P4 message text; changing X_ITE settings; raising the 250 ms debounce without evidence. |
| Prerequisites | none |
| Tests | Add Mall/World toolbar aria-label/keyshortcuts asserts; add inspector `role=list` + roving-tabindex tests; rerun `qa:phase-7b-native-editor/perf.js` and `qa:phase-7c-vision/orchestrate.js`; add a renderer memory test under a new `test/editor/perf-memory.test.js`. |
| Runtime QA | `npm run qa:vision`, `npm run qa:mall-preview`, `npm run qa:world-preview`, `npm test`, `npm run check`. |
| Cross-platform needs | Visual suites on Linux + Win11 (existing harnesses cover this). |
| Stop condition | All D1 PARTIAL/MISSING items closed or recorded as owner-decision; perf re-measure recorded; memory sanity check green. |

### Phase 7D2 — Crash recovery + session restoration (owner-decision-heavy)

**As-built: this section describes what was planned. The lane shipped as
**Phase Beta 2** under its owner-approved name; see
`docs/PHASE_BETA_2_CRASH_RECOVERY.md` for the as-built record and the
roadmap's `Phase Beta 2` entry for the closeout status. The 7D2 label is
preserved here for evidence back-compat.**

| Aspect | Description |
|---|---|
| **Scope** | D3 `MISSING` items + D4 owner decisions (active workspace / Mall / World restoration). |
| Repository actions | (a) Add a small "recovery file" path under `userData` that periodically snapshots the unsaved editor buffer (separate from `editor-session.json`, which is intentionally for the saved document); restore on launch when present. (b) Renderer-process gone handler: emit a single refresh-and-restore event. (c) Owner-decision: persist `currentPage` (mall/world/editor); restore on launch. (d) Owner-decision: persist most-recent Mall item and World root in `mall-session.json` / `world-session.json`. (e) Document the "explicit close never restores" rule in `docs/NATIVE_EDITOR_ARCHITECTURE.md`. |
| Explicit exclusions | Any UI redesign of the unsaved-buffer experience; any change to safe-save; any change to the .bak-* backup naming. |
| Prerequisites | Owner decisions on (c)/(d) before code lands. **Outcome:** (c) was partially approved — Restore returns the user to the editor workspace where the recovered buffer opens; the active page is always the editor on Restore. (d) was explicitly **deferred** per owner policy §4.4 / §4.5. |
| Tests | New `test/editor/recovery-store.test.js` + `test/editor/recovery-controller.test.js`; `EditorController.openFromRecovery` tested in `test/editor/editor-controller.test.js`; `recovery-prompt.js` added to the editor-page co-load list in `test/editor/script-load-order.test.js`. |
| Runtime QA | Re-run `qa:phase-7b-native-editor/orchestrate.js` to ensure crash-recovery state capture does not regress existing 15/15 (independent QA verdict pending). |
| Cross-platform needs | Linux-only test for the recovery file format; Windows self-test extension is optional (paths are cross-platform already). |
| Stop condition | All D3 MISSING closed or owner-deferred with explicit rationale; D4 owner decisions resolved and recorded; new tests green. **Outcome:** 1954/1954 `npm test` pass; D3 PARTIAL/MISSING closed; only (d) deferred. |

### Phase 7D3 — Linux + Windows beta verification + beta packaging refresh

**As-built lane name: `Phase: Cross Platform Beta`. See the roadmap entry for
the closeout status. The 7D3 label is preserved here for evidence back-compat.**

| Aspect | Description |
|---|---|
| **Scope** | D5 remaining + D6 packaging refresh; explicit exclusions below. |
| Repository actions | (a) Re-run `npm run dist:linux` on `main` and record SHA-256 in `docs/RELEASES.md`. (b) Re-run `npm run build:win` on the Win11 guest and record SHA-256 in `docs/RELEASES.md`. (c) Re-run the Tier-2 visual suites (`qa:vision`, `qa:mall-preview`, `qa:world-preview`) on Linux + Win11 and record pass counts. (d) Re-run Tier-1 packed self-test on Win11. (e) Confirm `release/SHA256SUMS-1.3.0-beta.3.txt` is generated. (f) Update `docs/RELEASES.md` table with the new artifact row. (g) Resolve the per-release `LICENSE` text question (see D6 table). |
| Explicit exclusions | Signing anything; publishing a GitHub Release (owner action); introducing a new packaging target; changing the deterministic 1980 ZIP timestamp. |
| Prerequisites | Owner-decision on (g) and on whether to publish `v1.3.0-beta.3` or hold. |
| Tests | `npm test`, `npm run check`, `npm run build:editor`. |
| Runtime QA | All existing Tier-1/Tier-2 suites must pass. |
| Cross-platform needs | Both platforms (by definition). |
| Stop condition | `dist:linux` + `build:win` artifacts on disk with SHA-256 in `release/SHA256SUMS-1.3.0-beta.3.txt`; visual suites pass; `docs/RELEASES.md` updated. |

### Cross-lane discipline

- Each lane is a separate stop-and-report gate.
- Production code changes are restricted to the lane scope above.
- No `git add .` / `git add -A`; per-file staging only.
- No memory updates with implementation results during 7D0 — 7D0 memory entry is
  reserved for the closeout only.

---

## 7. Documentation changes allowed in 7D0

| File | Change | Reason |
|---|---|---|
| `docs/PHASE_7D_BASELINE.md` | **NEW** — this file | deliverable |
| `docs/WRL_FORGE_ROADMAP.md` | one-line factual correction: Phase 5 status → ✅ (subsumed by 2B + 4B) with the existing sub-phase references preserved; **no** new sub-lane, **no** rewrite of history | this is a correction to a status error, not a plan rewrite |
| `MEMORY.md` (project) | one-line pointer when 7D0 closes | required by lane rules |

**Not changed in 7D0:** `docs/BETA_RELEASE_NOTES.md`, `docs/RELEASES.md`,
`docs/SIGNING_READINESS.md`, `docs/NATIVE_EDITOR_ARCHITECTURE.md`. Those updates
are scoped to 7D3 / 7D2 implementation lanes.

---

## 8. Open owner decisions (none pre-decided by 7D0)

| # | Decision | For lane | Why it matters |
|---|---|---|---|
| 1 | Restore the active workspace on next launch (currently always Mall)? | 7D2 | shapes the page-load sequence in main.js |
| 2 | Restore the most-recently-open Mall `.wrl` on next launch? | 7D2 | shapes whether a `mall-session.json` is added |
| 3 | Restore the most-recently-open World Project root on next launch? | 7D2 | shapes whether a `world-session.json` is added |
| 4 | Periodically autosave the unsaved editor buffer (separate from `editor-session.json`)? | 7D2 | adds an autosave cadence + recovery file |
| 5 | Publish `v1.3.0-beta.3` on GitHub now, or hold? | 7D3 | shapes the closeout step |
| 6 | Per-release `LICENSE` text inside the bundle — rewrite now to GPL or keep historical MIT for `1.3.0-beta.3`? | 7D3 | legal copy in shipped binary |
| 7 | Re-run `Ctrl+R` (Repack) / `Ctrl+E` (Open in Native Editor) shortcuts on Mall — confirmed safe given the GTK dialog gotcha? | 7D1 | shapes whether shortcuts land |

---

## 9. Production code changes in 7D0

**Zero.** 7D0 is recon and scope definition only.

---

## 10. Worktree discipline in 7D0

- `M AGENTS.md`, `?? AGENTS.archive.md`, `?? qa/qa-artifacts/` — preserved as-is.
- No stage, no commit, no push.
- Roadmap edit + this new file staged with explicit per-file `git add <path>`.
