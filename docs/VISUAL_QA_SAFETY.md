# Visual QA Safety

**Why this document exists.** On 2026-07-12 the GNOME Shell compositor crashed
with SIGSEGV and dropped the desktop to the login screen. Root cause: a *storm*
of Electron launches — the old screenshot QA ran **one Electron process per
capture**, driven by an unbounded external loop with no concurrency guard, no
launch cap, no teardown, and no PID accounting (87 launches over the session,
accelerating to ~1/second right before the crash). Rapidly mapping many
GPU-accelerated windows into mutter on the NVIDIA X11 session tipped the
compositor over. No work was lost, but the whole session died.

These rules and the `qa/visual-qa/` orchestrator make that class of failure
structurally impossible. **Follow them for any work that opens the real app.**

## Hard rules

1. **One Electron process at a time.** Concurrency is exactly `1`. Never run two
   visual runs, and never launch the app in a loop.
2. **Reuse, don't relaunch.** Drive many fixtures/screenshots through a single
   long-lived **capture-server** process (`WRL_FORGE_CAPTURE_SERVER=1`), not one
   process per capture.
3. **Go through the orchestrator.** `qa/visual-qa/` (`VisualQaRunner` + `cli.js`)
   is the only sanctioned way to run a visual batch. It owns the lock, the cap,
   the cooldown, the timeouts, teardown, and the leak check.
4. **Cap + cooldown + bounded retries.** A run may spawn at most `maxLaunches`
   Electron processes total (retries included), with a `cooldownMs` gap between
   launches and at most `retriesPerLaunch` retries.
5. **Track PIDs; fail on leaks.** Every spawned PID is tracked; after teardown
   the runner asserts it is gone. A survivor fails the run.
6. **Graceful shutdown, then a single targeted signal.** Ask the server to quit
   and await its exit; only then `SIGTERM` the **one tracked PID**. **Never**
   `pkill`, `killall`, or any process-name-wide kill.
7. **Non-visual work never opens a window.** `npm test` runs only non-visual
   tests. Visual tests live in `test/visual/` and run only via
   `npm run test:visual` **and** with `WRL_FORGE_ALLOW_VISUAL=1`.

## Commands

| Command | Opens Electron? | What it runs |
|---|---|---|
| `npm test` | No | Non-visual unit tests, incl. the orchestrator's own tests (fake child processes). |
| `npm run check` | No | `npm test` + `node --check` syntax gate over all source. |
| `npm run test:visual` | **Yes** | Real-Electron integration tests in `test/visual/` (guarded by `WRL_FORGE_ALLOW_VISUAL=1`). |
| `npm run qa:visual -- <jobs.json> [--max=N] [--cooldown=MS] [--retries=N]` | **Yes** | A serialized screenshot/preview batch through one reused process. |

## Jobs file (`qa:visual`)

A JSON array; each job runs in order through the same process:

```json
[
  { "id": "def-use", "fixture": "/abs/scratch/def-use.wrl", "mode": "fit", "size": "900x600", "out": "/abs/out/def-use.png" },
  { "id": "extrusion", "fixture": "/abs/scratch/qa-extrusion-scale.wrl", "json": true }
]
```

- `out` → screenshot job: the **real** open→validate→preview flow (writes a
  `.edit.wrl`, so point it at **scratch copies**, never committed fixtures).
- `json` (no `out`) → read-only preview-debug job: reports authoritative
  bounds/fit without mutating anything.
- `mode`: `fit` | `original` (optional). `size`: `WxH` (optional).

**World Project jobs (Phase 4A).** A job with a `world` key drives the read-only
**World** workspace instead of the Mall preview, in the *same* reused process
(the capture server navigates the one window to `world.html`):

```json
[
  { "id": "empty",   "world": null,                                          "size": "1100x760", "out": "/abs/out/w-empty.png" },
  { "id": "valid",   "world": { "root": "/abs/scratch/mini",   "primary": "/abs/scratch/mini/world.wrl" },   "out": "/abs/out/w-valid.png" },
  { "id": "broken",  "world": { "root": "/abs/scratch/broken", "primary": "/abs/scratch/broken/world.wrl" }, "out": "/abs/out/w-broken.png" },
  { "id": "narrow",  "world": { "root": "/abs/scratch/mini",   "primary": "/abs/scratch/mini/world.wrl" },   "size": "680x900", "out": "/abs/out/w-narrow.png" }
]
```

- `world: null` → the empty-project state. `world: { root, primary }` → the main
  process (trusted) points the confined scan at that project and screenshots the
  result. World scanning is **read-only** (it never writes a `.edit.wrl` or
  anything else), so world `root/primary` may point at any readable project; use
  scratch copies anyway to keep runs hermetic.

**World preview jobs (Phase 4B).** A world job may also drive the embedded X_ITE
world preview through the real read-only `world:previewLoad` path + the confined
`wrlworld://` handler:

```json
[
  { "id": "nested",  "world": { "root": "/abs/fx/nested", "primary": "/abs/fx/nested/world.wrl" }, "preview": true, "size": "1000x760", "out": "/abs/out/nested.png" },
  { "id": "multi-vp","world": { "root": "/abs/fx/nested", "primary": "/abs/fx/nested/world.wrl" }, "preview": true, "viewpoint": 2, "out": "/abs/out/vp.png" }
]
```

- `preview: true` → after the read-only scan, drive `world:previewLoad` and the
  scheme handler and render in X_ITE; the job result carries a `preview` debug
  object (status, discovered viewpoints, counts, warnings). Read-only.
- `viewpoint: <index>` → bind that discovered viewpoint before capture.
  `reset: true` → Reset View before capture.
- `writePrimary: <text>` → **QA-only** scratch-primary swap used to drive the
  parse-fail→recover sequence inside ONE reused process. It is refused unless the
  primary path is under the OS temp dir, and is reachable only under
  `WRL_FORGE_CAPTURE_SERVER` — it never touches a real project file.

**World packaging jobs (Phase 5A).** A world job may also drive the read-only
packaging audit and (QA-only) an actual review-bundle build:

```json
[
  { "id": "audit",  "world": { "root": "/abs/fx/nested", "primary": "/abs/fx/nested/world.wrl" }, "packageAudit": true, "size": "1100x860", "out": "/abs/out/audit.png" },
  { "id": "build",  "world": { "root": "/abs/fx/nested", "primary": "/abs/fx/nested/world.wrl" }, "buildBundle": "/abs/tmp/nested-review-bundle.zip", "out": "/abs/out/build.png" }
]
```

- `packageAudit: true` → after the read-only scan, drive `world:packageAudit` and
  render the packaging section; the job result carries a `packageAudit` debug
  object (status, totals, blocking codes, unused count). Read-only.
- `buildBundle: <destPath>` → **QA-only** deterministic bundle build via the real
  `bundle-builder`. It is refused unless `destPath` is under the OS temp dir, and
  is reachable only under `WRL_FORGE_CAPTURE_SERVER` — it never writes a real
  destination and never inside a project. The job result carries a `bundle`
  summary (outPath, bytes, entryCount) or `bundleError`.

The full Phase 4B run (all 10 required states, one launch, graceful exit, no
leak) lives at `qa/phase-4b-world-preview/orchestrate.js`
(`RESULTS.md` / `RESULTS.json`), and the Phase 5A packaging run (7 states incl. a
real bundle build to the OS temp dir) at `qa/phase-5a-world-packaging/`, both
driven by `VisualQaRunner` directly — the same harness the visual tests use.

## Lifecycle logging

`cli.js` emits one JSON line per event: `run:start`, `launch` (with count + PID),
`ready`, `capture:start` / `capture:done` (fixture, ms), `cooldown`,
`shutdown:request`, `exit` (code), `terminate` (on escalation), `leak:check`,
`retry:scheduled`, `run:done`, `survivors`. Non-zero exit on any failure
(timeout, cap, leak, job error) so callers can gate on it.

## Guardrails checklist before a visual run

- [ ] Fixtures for screenshot jobs are **scratch copies**, not repo fixtures.
- [ ] `DISPLAY` (or `WAYLAND_DISPLAY`) is set; the CLI refuses to run blind.
- [ ] `--max` is small (a single-digit cap). Never remove the cap.
- [ ] Nothing else is holding the lock (`/tmp/wrl-forge-visual-qa.lock`).
- [ ] After the run, `survivors` is `[]` and no `app-wrl-forge` scope remains
      (`systemctl --user list-units 'app-wrl-forge*'` or `pgrep -af electron`).

## Stop conditions

Abort immediately (and do not retry in a loop) if: multiple windows appear,
rapid retries begin, a child does not exit, `journalctl` shows new
`Can't update stage views actor … needs an allocation` / `GNOME Shell crashed`
lines, or `survivors` is non-empty.

## Windows (Phase 7C4)

All seven hard rules above hold unchanged on Windows. Two host assumptions are
platform-parameterized rather than Linux-only (see `docs/WINDOWS_NATIVE_QA_PLAN.md`):

- **No `DISPLAY`/`WAYLAND_DISPLAY` concept.** `cli.js` and the `qa:windows`
  orchestrator instead require an explicit `--allow-headed` flag on `win32` --
  pass it to confirm an interactive session is present before Electron launches.
- **Escalation kill.** `runner.js`'s `_forceCleanup` uses an injectable
  `killChild` (see `killerFor(platform)`). On POSIX it's still the original
  single-pid `SIGTERM`. On `win32` it's `taskkill /PID <pid> /T /F` -- scoped to
  the one tracked pid's **tree** (never `/IM`, never process-name-wide), because
  a bare `TerminateProcess` on Electron's main pid orphans its renderer/GPU
  helper children.

New flags on `cli.js` (and the same flags on `qa:windows`'s orchestrator):
`--target=source|win-unpacked|portable|installed` selects what gets spawned
(`source` still launches `electron .`; the packaged targets spawn
`release\win-unpacked\WRL Forge.exe`, a `release\*portable*.exe`, or an
installed exe via `--exe=<path>` directly, over the same
`WRL_FORGE_CAPTURE_SERVER` stdin/stdout protocol).

Windows equivalents for the guardrails checklist: use `tasklist` (or Task
Manager) instead of `pgrep -af electron`/`systemctl --user list-units` to
confirm no survivor remains; the lock file still lives under `os.tmpdir()`
(`%TEMP%\wrl-forge-visual-qa.lock`).

`qa:windows` (`qa/phase-7c-windows/orchestrate.js`) drives Tier 1 (the
committed `qa/phase-6b-windows/win-selftest.js`, run as node under whichever
Electron binary the target resolves to) and Tier 2 (this same `VisualQaRunner`)
back-to-back, then writes an evidence run directory (`RESULTS.md`,
`results.json`, `environment.json`, `processes-before/after.txt`,
`fixture-hashes-before/after.json`) via `qa/visual-qa/evidence.js` -- a GO
verdict requires Tier 1 to pass, Tier 2 to report zero survivors, and no
committed fixture hash to have changed. Tier 3 (NSIS install/uninstall,
Start-Menu shortcut, capture-server smoke against the installed exe) is
`qa/phase-7c-windows/tier3-smoke.ps1`, run deliberately by a maintainer --
it installs and uninstalls the app, so it is not wired into any unattended
pipeline. SmartScreen and native-dialog checks remain maintainer-manual.
