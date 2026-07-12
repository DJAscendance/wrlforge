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
