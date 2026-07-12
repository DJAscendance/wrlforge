# Phase 4B — World Project Preview visual QA

Read-only embedded X_ITE world preview, driven through **one reused Electron
capture-server** by `VisualQaRunner` (concurrency 1, launch cap 2, cooldown,
timeouts, graceful teardown, PID tracking, leak check). Reproduce with:

```
node qa/phase-4b-world-preview/orchestrate.js
```

Machine-readable per-state debug + lifecycle is written to `RESULTS.json`.

## Lifecycle (last run)

| Metric | Value |
|---|---|
| Launch count | **1** |
| PID | 949983 |
| Fixtures driven | 11 |
| Captures | 12 |
| Retries | 0 |
| Exit code | **0** (graceful) |
| Leak check | `alive:false` |
| Survivors | `[]` |
| GNOME/mutter warnings | none observed |

One launch, clean graceful exit, no leak — the launch-storm class of failure
stays structurally impossible (see `docs/VISUAL_QA_SAFETY.md`).

## States captured (`screenshots/`)

| # | State | File | Result |
|---|---|---|---|
| 1 | Empty World Project | `01-empty-state.png` | placeholder, no preview |
| 2 | Small local world | `02-small-world.png` | renders; viewpoint `Entry` |
| 3 | Nested Inline world | `03-nested-inline.png` | renders; viewpoints `Front, Top, Panel` (Panel is authored **inside the nested Inline**) |
| 4 | > 20 textures | `04-more-than-20-textures.png` | 25 textures present, no truncation |
| 5 | Seventy-texture world | `05-seventy-textures.png` | 71 textures present, no truncation |
| 6 | Multiple viewpoints | `06-multiple-viewpoints.png` | 3 viewpoints; index 2 (`Panel`) bound |
| 7 | Missing / case-mismatch | `07-missing-case-warnings.png` | scene renders; missing + case surfaced, both refused by the scheme (`Not Found`) |
| 8 | Remote / unsafe blocked | `08-remote-unsafe-blocked.png` | remote + absolute/traversal surfaced, never fetched; `/etc/hosts` and `../../escape.png` clamped-and-refused |
| 9a | Scratch good | `09a-scratch-good.png` | renders |
| 9b | Temporary parse failure | `09b-parse-fail-keeps-last.png` | **last valid scene kept**, `STALE — LAST VALID SCENE` badge, parser error shown |
| 9c | Recovered | `09c-recovered.png` | re-renders after the primary is valid again |
| 10 | Narrow responsive layout | `10-narrow-layout.png` | preview + summary reflow, remain usable at 720×900 |

## What the run proves

- **Per-file relative base paths**: the nested world's `parts/tex/wall art.png`
  (a space in the filename, two directory levels below the primary) and
  `parts/deep/tex/lamp.png` resolve from *each WRL's own* directory via the
  hierarchical `wrlworld://` scheme.
- **Gzip transparency**: gzip primary *and* gzip nested Inline are served
  decompressed — X_ITE never sees gzip bytes.
- **Asset-graph authorization**: only readable WRL nodes + present exact-case
  assets are served. Missing, case-mismatched, absolute, traversal, and remote
  references all come back `Not Found` / are never requested.
- **Inline scripts do not execute**: the CSP (no `unsafe-eval`) blocks X_ITE from
  evaluating a `vrmlscript:` Script node; it surfaces as a runtime warning, the
  scene still renders.
- **No mutation**: the committed fixtures are byte-identical before and after
  (asserted by `test/world-project/preview-source.test.js` and
  `test/visual/electron-world-preview.test.js`). The parse-fail/recover sequence
  writes only to a scratch project under the OS temp dir.

This is **preview + analysis only** — not an upload validator, packaging, or
editor. No project file is modified and the project is never marked upload-ready.
