# Phase 5A — World Packaging visual QA

One serialized `VisualQaRunner` run (`orchestrate.js`) driving the packaging-audit
UI + one real deterministic bundle build through **one reused Electron
capture-server process**. The same sanctioned harness as the Mall/World visual
tests: concurrency 1, launch cap, cooldown, timeouts, PID tracking, graceful
teardown, leak check. No per-screenshot launches, no `pkill`/`killall`.

Run it: `node qa/phase-5a-world-packaging/orchestrate.js`
(machine-specific `RESULTS.json` is git-ignored; `screenshots/` are committed evidence.)

## Lifecycle (latest run)

| Field | Value |
|---|---|
| Launch count | **1** |
| PID | 987699 |
| Fixture states | 7 |
| Captures | 7 |
| Retries | 0 |
| Exit code | **0 (graceful)** |
| Leak check | `alive: false` |
| Survivors | `[]` |
| GNOME/mutter warnings | none observed |

## States captured

| # | State | Fixture | Result |
|---|---|---|---|
| 1 | READY | `nested` | status `ready`; 6 files (3 WRL + 3 textures), 847 B; manifest preview shown |
| 2 | 70 textures | `valid70` | status `ready`; 72 files, **71 unique textures**, no truncation |
| 3 | NEEDS REVIEW (unused) | `unused` | status `needs-review`; **3 unused files reported, none packaged** (3 packaged) |
| 4 | Cycle (safe) | `cycle` | status `needs-review`; bounded dependency cycle, **not blocking**; both WRLs + both textures packaged |
| 5 | BLOCKED | `broken` | status `blocked`; blocking = `missing-assets, case-mismatch, unsafe-path, remote-reference`; Build button disabled |
| 6 | Build Review Bundle | `nested` | real deterministic ZIP written to the **OS temp dir** (9 entries, 4023 B, sha256 recorded); output location shown; source unchanged |
| 7 | Narrow layout | `nested` | packaging section reflows to a single usable column at 720×900 |

## Non-mutation & safety

- The only write in the whole run is the QA bundle into a fresh OS-temp directory
  (`buildBundle` is refused outside `os.tmpdir()` and reachable only under
  `WRL_FORGE_CAPTURE_SERVER`). No committed fixture was modified.
- The blocked fixture (`broken`) produced **no bundle** — the Build action is
  refused (`EBLOCKED`) before any write.
- The deterministic ZIP validates under the system `unzip -t` and its entries'
  hashes match the manifest exactly (asserted by
  `test/world-project/bundle-builder.test.js` and the opt-in
  `test/visual/electron-world-packaging.test.js`).

## Screenshots

`screenshots/1-ready.png` · `2-seventy-textures.png` · `3-needs-review-unused.png`
· `4-cycle-safe.png` · `5-blocked.png` · `6-bundle-built.png` · `7-narrow-layout.png`
