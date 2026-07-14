# Windows-Native Agent QA Plan

Status: **PLAN ONLY.** No harness code, no `package.json` scripts, and no Windows
rebuild are produced here. This document designs a Windows verification workflow for
**Claude Code CLI running directly inside the Windows 11 WinBoat VM**, so an agent can
build, test, and GUI-verify WRL Forge on real NTFS **without** the fragile Linux-side
FreeRDP/noVNC click injection that has dogged every prior Windows pass.

Companion: **`docs/PHASE_7C_PROPOSAL.md`** (the feature this harness must eventually
verify). Reuses `docs/VISUAL_QA_SAFETY.md` (launch-storm guardrails), `docs/BUILD.md`
(Windows build), the WinBoat environment (`\\host.lan\Data` share, `ELECTRON_RUN_AS_NODE`
selftest), and the existing `qa/visual-qa/` runner.

---

## 1. Goal

The Windows agent, running inside the VM, should be able to: pull/checkout an exact
commit → install deps → build the editor bundle → run automated tests → build Windows
artifacts → launch the unpacked/portable/installed app → run deterministic GUI QA →
capture screenshots, logs, JSON results, and process data → cleanly shut everything down
→ produce evidence — **without** relying on desktop-coordinate clicking.

---

## 2. Recommended Windows workspace

A **local NTFS clone**, not execution from the SMB mount:

```
C:\Projects\wrlforge
```

Requirements:
- A local Windows clone (running the 213 MB Electron from the SMB share is slow/flaky —
  see the WinBoat notes; clone locally).
- **Exact-commit checkout** for QA (detached HEAD at the requested SHA).
- **Clean status** before each run.
- Matching or documented **Node/npm** versions (pin one baseline — see §11).
- Git, Node, npm, Claude Code CLI, and VSCodium installed (VSCodium already is).
- Build artifacts (`release/`) and scratch QA files kept **outside** tracked source —
  scratch projects under `%TEMP%` or a dedicated `C:\wrlforge-qa\` directory.
- **No mutation of committed fixtures.** No direct work against historical Cybertown
  source files.

### Workspace isolation (enforced — Phase 7C4.1)

The above is now **enforced**, not just recommended. `qa/visual-qa/workspace-guard.js`
refuses to run Windows QA / builds from a workspace that is not a local NTFS clone:

- **Rejected on Windows:** UNC roots (`\\host.lan\Data\...`), mapped **network** drives
  (`DriveInfo.DriveType == Network`), and any path containing a known host-share marker
  (`host.lan`, extendable via `WRL_FORGE_HOST_SHARE`). Running `npm ci`/builds/fixture-
  writing QA from the SMB mount is what previously wiped `node_modules`.
- **Accepted:** a local clone such as `C:\Projects\wrlforge` (a `Fixed` drive). **Linux
  paths are never blocked** (the guard is a no-op off Windows).
- **On rejection** the command prints one message and exits non-zero:
  > Windows work must run from a local NTFS clone. Clone WRL Forge to `C:\Projects\wrlforge`
  > and retry. The host share may be used only to export finalized QA evidence.
- **Guarded commands:** `npm run qa:windows` (orchestrator), `npm run qa:visual`
  (visual-QA CLI), the packed Windows self-test (`qa/phase-6b-windows/win-selftest.js`,
  hard precondition), and `npm run build:win` / `build:win:portable` (via
  `qa/visual-qa/workspace-preflight.js`).

### Evidence export is allowlist-only

The share stays the evidence-out channel (§3), but export is allowlisted. The guard's
`filterEvidenceExport()` **never** exports `node_modules`, `.git`, source directories,
committed fixtures, `.edit.wrl` working copies, backup files (`.bak`/`.orig`/`~`/
`backups/`), build intermediates (`release/`/`dist/`/`win-unpacked/`/`vendor/`), or
Windows binaries (`.exe`/`.dll`/… — only with an explicit `allowBinaries` opt-in). Only
the evidence run directory (`RESULTS.md`, `results.json`, `environment.json`, PNGs, etc.)
crosses to the share.

---

## 3. Linux ↔ Windows sync model (owner-confirmed)

**Model: git for code in, shared SMB folder for evidence out.**

1. Linux implements, commits, and pushes to `origin/main`.
2. The Windows QA clone `git fetch` + checks out the **exact commit**.
3. The Windows agent performs **read-only QA plus evidence-only writes** (never edits
   production source while acting as QA).
4. **Evidence is returned through the shared SMB folder `\\host.lan\Data`** — the Windows
   agent writes a run directory there; the Linux side ingests it into
   `qa/runs/windows/<phase>/<timestamp>/` and commits it after redacting machine paths.
   (Chosen over a dedicated QA branch: it matches the existing WinBoat file-bridge
   workflow and avoids branch churn for what is essentially artifact transport.)
5. **Production fixes happen in the primary Linux clone** unless a Windows-only defect
   specifically requires a Windows branch.

Guardrails on the transport:
- The Windows agent computes **fixture hashes before and after** the run and includes both
  in the evidence; the Linux side refuses to ingest a run whose committed-fixture hashes
  changed.
- **Machine-specific absolute paths are redacted** (or excluded) before anything is
  committed on the Linux side.
- Large binaries (`release/*.exe`, `win-unpacked/`) stay git-ignored; only reproduction
  tooling (`.bat`/`.ps1`/`.js`) + evidence JSON/PNG/MD are committed.

Why this is safe and simple: git is the one-way channel for *code* (auditable, exact),
and the SMB share is the one-way channel for *artifacts* (no second remote, no push
rights needed from the VM). The Windows agent never has a path that mutates Linux source.

---

## 4. Windows QA harness

**Reuse `qa/visual-qa/` cross-platform.** The runner is already Node + `child_process`
`spawn` + newline-delimited JSON over stdin/stdout — nothing in the safety core is
Linux-specific. Only two host assumptions need parameterizing:
- the **`DISPLAY`/`WAYLAND_DISPLAY` refuse-to-run-blind** check → on Windows there is no
  `DISPLAY`; gate on an explicit `--allow-headed`/session-present check instead;
- the **`SIGTERM`** graceful signal → on Windows use `child.kill()` (maps to
  `TerminateProcess`) for the single tracked PID, and `taskkill /PID <pid> /T` **only**
  for the post-timeout child-tree cleanup.

New command **`npm run qa:windows`** (plus per-target variants), driving a three-tier
hierarchy:

### Tier 1 — Pure + packed-runtime self-tests
The existing `ELECTRON_RUN_AS_NODE` selftest, extended. No window opens. Covers: path
behavior, plain/gzip I/O, save + backup, conflict detection, authorization, session
restoration, bundle integrity, and parser/editor behavior. Already **45/45 green** on
packed beta.2 (`qa/phase-7b1-windows-closeout/`).

### Tier 2 — Application-internal visual harness
- **One Electron process**, the **existing stdin/stdout JSON capture server**
  (`WRL_FORGE_CAPTURE_SERVER=1`) — reused, not re-invented.
- JSON job queue; **main-controlled file opens**; renderer state commands; screenshots
  (`capturePage()` → PNG); DOM/state assertions; PID tracking; graceful teardown; leak
  checks.
- All the `VisualQaRunner` invariants (§6) hold on Windows unchanged.

### Tier 3 — Windows shell / integration smoke (PowerShell only)
Used **only** where application-internal automation can't reach: NSIS install/uninstall,
Start-Menu launch, native file dialogs, VSCodium foreground launch, SmartScreen/manual
publisher behavior, Windows shortcut behavior.

**Tooling recommendation: PowerShell (+ a few documented maintainer manual checks).**
Reject Playwright-Electron, Windows UI Automation, and Appium/WinAppDriver as a
**large, fragile automation stack** unjustified for a private unsigned beta. The existing
noVNC browser control stays available as a manual fallback for the handful of
genuinely-GUI checks (SmartScreen dialog, Start-Menu tile), but is not part of the
automated path.

---

## 5. Capture-server transport decision

**Keep newline-delimited JSON over child stdin/stdout. Do NOT add a localhost TCP capture
server.** This directly answers the "bind localhost / ephemeral port / random per-run
token / refuse-paths-outside-scratch / auto-shutdown" question: a stdin/stdout pipe has
**no network surface at all** — strictly safer than any bound port + token scheme — is
already cross-platform, already auto-shuts-down when stdin closes (`rl.on('close') →
app.quit()`), and already refuses non-temp paths (`inTemp()`). Adding a TCP server would
*introduce* the very attack surface the token/binding questions are trying to contain.

---

## 6. Windows `VisualQaRunner` invariants

Run the existing safety model natively on Windows:
- Concurrency exactly **1**; one reused Electron process per visual suite.
- Explicit **launch cap** (`maxLaunches`); readiness timeout; per-job timeout; cooldown.
- **PID and child-process tracking.**
- Graceful application close, then **targeted process-tree cleanup only after timeout**
  (`taskkill /PID <pid> /T` — the tracked PID's tree, **not** `/IM`).
- **No broad `taskkill /IM "WRL Forge.exe"`** except as a documented last-resort fallback.
- **Zero-survivor verification** (the `ELEAK` check; a survivor fails the run).
- Temp-confined scratch inputs; protection against fixture mutation.
- Machine-readable result JSON; screenshot manifest; environment/version capture.

---

## 7. Packaged-app automation

Test three targets: `release\win-unpacked\WRL Forge.exe`, the portable `.exe`, and the
NSIS-installed app. Each accepts the **same safe QA mode** as running from source:
spawn it with `WRL_FORGE_CAPTURE_SERVER=1` and pipe JSON jobs to its stdin (`stdio:
['pipe','pipe','inherit']`), exactly as `cli.js` does today for `electron .`.

QA mode must (and, with the existing env-gate, does):
- Be **unavailable/inert in normal launches** (env-gated; a double-clicked app never
  enters it).
- **Never weaken normal path authorization.**
- **Never expose remote control** (stdin pipe only; no port).
- **Refuse non-temp test paths** (`inTemp()` guard on `writePrimary`/`buildBundle`/editor
  scratch).
- Be clearly **documented** (this section + `docs/VISUAL_QA_SAFETY.md`).

---

## 8. Evidence format

A consistent run directory, written to `\\host.lan\Data\wrlforge-qa\...` on the VM and
ingested to:

```
qa/runs/windows/<phase>/<timestamp>/
```

Contents:
- `RESULTS.md` — human narrative + verification table (GO/CONDITIONAL/NO-GO).
- `results.json` — machine record (the `VisualQaRunner` RESULTS.json shape: `launchCount`,
  `launchesUsed`, `pids[]`, `captureCount`, `retries`, `exitEvents[]`, `survivors[]`,
  `perState[]`).
- `environment.json` — platform/arch/Node/Electron/Chromium versions, commit SHA, VM/host
  details.
- `processes-before.txt` / `processes-after.txt` — `tasklist` snapshots (survivor proof).
- `console.log` / `stderr.log` — captured child output.
- Screenshot manifest + `screenshots/*.png`.
- **Artifact hashes** (the built `.exe`s) and **fixture hashes before and after**.
- Installed-app metadata where applicable (install dir, shortcuts, uninstall entry).

Machine-specific absolute paths are **redacted or excluded** before the Linux side
commits. Large binaries remain git-ignored.

---

## 9. Windows agent runbook (Claude Code CLI, inside the VM)

1. Open **PowerShell** in the local clone (`C:\Projects\wrlforge`).
2. `git fetch` and **checkout the requested commit** (detached HEAD).
3. Confirm **clean status**.
4. `npm ci`.
5. Run **tests + syntax gate** (`npm test`, `npm run check`).
6. Build the editor bundle (`npm run build:editor`).
7. Build or unpack the Windows target (`npm run build:win` / `:portable`, or reuse
   `release\win-unpacked`).
8. Run **Windows self-tests** (Tier 1, `ELECTRON_RUN_AS_NODE`).
9. Run **serialized visual QA** (Tier 2, one reused process).
10. Run **installer/portable smoke** (Tier 3) when requested.
11. Confirm **no survivors**.
12. Collect evidence → drop the run directory to `\\host.lan\Data\wrlforge-qa\`.
13. Restore or remove scratch data.
14. Confirm **committed fixture hashes are unchanged**.
15. Return a **GO / CONDITIONAL GO / NO-GO** report.

The Windows agent **must not silently modify production code** while acting as an
independent QA agent.

---

## 10. Initial bootstrap (one-time Windows prerequisites)

Install/confirm once in the VM:
- **Git for Windows.**
- **Node.js 20+** — pin and document the same major/minor as the Linux baseline (§11).
- **npm** (bundled with Node).
- **Claude Code CLI.**
- **VSCodium** — already installed (`%LOCALAPPDATA%\Programs\VSCodium\`; use the
  `bin\codium.cmd` CLI shim, since `VSCodium.exe --version` opens a window).
- **PowerShell 7** — optional but convenient for the runbook/Tier 3 scripts.
- **Long-path support** — `git config --system core.longpaths true` (deep `node_modules`
  paths otherwise fail on checkout/`npm ci`).
- **Windows Defender / SmartScreen** — add a Defender exclusion for `C:\Projects\wrlforge`
  to avoid scan slowdowns; expect the SmartScreen "unknown publisher" prompt on unsigned
  builds (**More info → Run anyway** — expected, not a defect).
- **Local clone location** `C:\Projects\wrlforge`; standard user permissions (per-user
  NSIS install, no admin needed).
- **No Wine** (that is only for Linux→Windows cross-builds).
- **No MSVC / build tools** — `npmRebuild:false` and `x_ite` is pure JS (no native
  modules), so no C++ toolchain is needed.

Do not prescribe unneeded software.

---

## 11. Version baseline

Pin one Windows Node baseline matching the Linux dev version (record it in
`environment.json` each run so drift is visible). The packed runtime is fixed by
electron-builder (Electron 41.7.1 / Node 24.15.0 / Chromium 146 on beta.2) and is
captured automatically in every selftest JSON; the **host** Node version (used for
`npm ci`, tests, and the bundle build) is the one to pin. **Open decision** (§13):
which exact Node version to standardize on.

---

## 12. Implementation sequence (shared 7C0–7C5 slices)

Each slice lists **objective / expected files / automated tests / visual QA / security
gate / completion gate / risks / dependencies on later slices.**

### 7C0 — Final architecture + harness decisions
- **Objective:** lock the buffer-overlay design, the editor/preview UI (done —
  split-view), the security review, and the Windows QA architecture. **No production
  behavior change.**
- **Files:** `docs/PHASE_7C_PROPOSAL.md`, `docs/WINDOWS_NATIVE_QA_PLAN.md`, roadmap links.
- **Tests / Visual QA:** none (docs only); `npm test`/`check` unchanged.
- **Security gate:** threat model (proposal §10) reviewed and accepted.
- **Completion gate:** owner sign-off on the two docs; open decisions (§13) resolved or
  explicitly deferred.
- **Risks:** scope creep into 7C1 code. **Dependencies:** none.

### 7C1 — Preview overlay foundation
- **Objective:** session-scoped in-memory overlay, generation/version model,
  authorization wiring, the last-valid state machine — **pure, no editor UI**.
- **Files:** `src/preview/buffer-overlay.js` (new, pure); small hooks in
  `editor-controller.js` / `main.js` to hold `previewGeneration` and expose the overlay to
  the preview handlers; `test/preview/buffer-overlay.test.js` (new).
- **Tests:** overlay register/invalidate, session+generation rejection, Mall/World
  authorization, oversized-buffer cap, disk fallback, close cleanup (all non-visual).
- **Visual QA:** none yet.
- **Security gate:** overlay-adds-no-path invariant proven by test; symlink/traversal
  refusal under override.
- **Completion gate:** pure tests green; `npm run check` extended for the new files.
- **Risks:** generation races. **Dependencies:** 7C2/7C3 consume it.

### 7C2 — Mall unsaved preview
- **Objective:** editor split-view integration for Mall; Original/Fit from the buffer;
  last-valid; 600–800 ms debounce.
- **Files:** `renderer/editor.{html,js}` (split-view + lazy X_ITE + widened CSP),
  `renderer/preview.js` (buffer-source `load()`), `main.js` (`preview:load` buffer mode),
  `src/editor/ui-state.js` (preview status view-model).
- **Tests:** ui-state preview status; preview:load buffer-mode unit paths.
- **Visual QA:** Mall unsaved, Mall Fit unsaved, unsaved texture change, temp syntax error
  → last-valid, recovery after repair (Linux, one reused process).
- **Security gate:** CSP widened only to the existing Mall/World superset; no remote
  origin; remote-URL refusal under override verified.
- **Completion gate:** Linux visual QA green; no survivors; overlay empty after close.
- **Risks:** CSP regression on the editor page. **Dependencies:** 7C1.

### 7C3 — World unsaved preview
- **Objective:** primary override, nested-dependency override, viewpoint preservation,
  asset-graph interaction, "Rescan for preview".
- **Files:** `src/world-project/preview-source.js` (`resolveWorldRequest` override check),
  `main.js` (`world:previewLoad` buffer mode), `renderer/world-preview.js` +
  `renderer/editor.js` (World preview in the split), viewpoint-preservation helper.
- **Tests:** nested-WRL override served vs disk; gzip substitution; graph authorization
  under override; viewpoint match/fallback.
- **Visual QA:** World primary unsaved, nested override, viewpoint preservation, missing
  new dependency, stale generation, repeated-refresh cleanup, theme/layout (Linux).
- **Security gate:** override only for allow-list members; no new path authorized;
  case/traversal refusal intact.
- **Completion gate:** Linux visual QA green; overlay empty after close; no leak.
- **Risks:** viewpoint churn on refresh. **Dependencies:** 7C1.

### 7C4 — Windows-native QA harness
- **Objective:** cross-platform `VisualQaRunner`, `npm run qa:windows`, packaged-app
  automation, evidence collection, the VM runbook. **Independent of 7C1–7C3** — may run in
  parallel once 7C0 lands.
- **Files:** `qa/visual-qa/runner.js` (parameterize DISPLAY/SIGTERM), `qa/visual-qa/cli.js`
  (Windows spawn/target flags), `qa/phase-7c-windows/*` (orchestrator, PowerShell Tier-3
  scripts, evidence writer), `package.json` `qa:windows` script.
- **Tests:** runner unit tests extended with a Windows fake-process path (no real
  Electron).
- **Visual QA:** the Tier-2 suite runs on Windows against source + `win-unpacked` +
  portable + NSIS-installed.
- **Security gate:** stdin/stdout transport only (no TCP); non-temp paths refused;
  zero-survivor verified on Windows.
- **Completion gate:** a full Windows run produces a valid evidence directory on the share;
  fixture hashes unchanged.
- **Risks:** child-tree cleanup on Windows. **Dependencies:** none (parallel-safe).

### 7C5 — Cross-platform acceptance
- **Objective:** Linux full regression + Windows direct-agent QA + performance/leak
  testing + documentation + beta build.
- **Files:** docs updates, `RESULTS.md`/`RESULTS.json` for the 7C runs, a version bump.
- **Tests:** full `npm test`/`check`; perf gate (proposal §11).
- **Visual QA:** the full 7C state list on Linux; the Windows Tier-1/2/3 suite in the VM.
- **Security gate:** final threat-model review; no new privilege/scheme; CSP diff audited.
- **Completion gate:** GO from both platforms; evidence committed; roadmap Phase 7C marked
  done.
- **Risks:** platform-specific rendering diffs. **Dependencies:** 7C1–7C4.

You may resequence — 7C4 is deliberately parallelizable.

---

## 13. Open decisions for owner approval

1. Windows host **Node version** to pin as the QA baseline (§11).
2. Whether Tier-3 GUI checks (SmartScreen, Start-Menu tile) are **automated via noVNC** or
   **maintainer-manual** (proposed: manual, documented).
3. Evidence **retention** on the SMB share (auto-prune old runs vs. keep all).

---

## 14. Excluded (restated)

Direct Cybertown upload, authentication, server submission, custom renderer, AST-based
rendering, auto-formatting, scope-aware PROTO rewrite, Apply/Bake Transform, Windows
ARM64, signing, auto-update, Microsoft Store release, public release, and multiple
simultaneous Electron visual processes are **out of scope**. No large third-party
Windows-automation stack (Playwright-Electron/WinAppDriver/Appium) is adopted.
