# Phase 7C2 — Mall unsaved-buffer live preview — QA results

Run: `npm run qa:mall-preview` (Linux, single reused Electron process via `VisualQaRunner`).
Stress: `node qa/phase-7c-mall-preview/stress.js` (pure, no Electron).

## Visual QA — 18/18 captures, 1 launch, 0 survivors, leak-clean

| # | State | Status chip observed |
|---|-------|----------------------|
| 01 | Mall editor, 50/50 split | **Live** |
| 02 | Unsaved source, Original mode | **Live** |
| 03 | Unsaved source, Cybertown Fit | **Live** |
| 04 | Auto-update after an edit (700 ms debounce) | **Live** |
| 05 | Manual Update | **Live** |
| 06 | Updating status (transient) | Live at settle; `Updating…` seen transiently |
| 07 | Large (>1 MiB) buffer edited — auto declines | **Large file — use Update to refresh** |
| 08 | Temporary syntax error — last valid scene retained | **Showing last good version** |
| 09 | Recovery after the syntax repair | **Live** |
| 10 | Saved-version fallback (reads disk, not the buffer) | **Showing saved version** |
| 11 | Preview maximized (editor + sidebar collapse) | **Live** |
| 12 | Editor-only layout (preview hidden, X_ITE idle) | n/a (Live before switch) |
| 13 | Divider moved + persisted | **Live** |
| 14 | High Contrast at enlarged zoom, with preview | **Live** |
| 15 | Local texture resolved from the source directory | **Live** |
| 16 | Remote texture blocked (advisory; never fetched) | **Live** |
| 17 | Large (>1 MiB) buffer, manual Update band | **Live** (manual Update) |
| 18 | Overlay + generation counts zero after close | **Live**; `leak {size:0, activeGenerations:0}` |

- `launches: 1 · survivors: 0 · leakOk: true` — one reused Electron process, zero
  orphans, and the overlay/active-generation counts are **0** after the session closes.
- Every source is a scratch file under the OS temp dir; no fixture mutated, no
  `.edit.wrl` and no temporary preview `.wrl` written.

## Perf / stress (pure) — PASS

- Coalescing: a burst of **50** and **100** rapid edits each fires **exactly one**
  render, of the **newest** version only (v50 / v100). No per-edit render storm.
- Overlay holds **exactly one** entry regardless of edit count; **0** after close.
- Throughput: 2000 authorize+register+resolve cycles in ~7 ms (~4 µs/op).
- A stale (older) generation is never accepted; no source is ever written.
- Debounce = **700 ms**, coalescing to the newest pending version (fake-clock, deterministic).

## Notes / honest limitations

- The `Updating…` chip is transient (X_ITE renders in well under the 1300 ms settle
  window), so the settled capture shows `Live`; the transition is covered by the
  pure state-machine unit tests and was observed transiently in intermediate runs.
- X_ITE does not expose a first-rendered-frame callback here, so per-frame GPU
  timing is not separately instrumented; renders complete within the settle window.
