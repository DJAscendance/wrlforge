# Phase 7B — Native Editor visual QA + performance (Linux)

Reproduce:

```
node qa/phase-7b-native-editor/orchestrate.js   # serialized visual QA (one Electron process)
node qa/phase-7b-native-editor/perf.js          # analyze() performance gate (pure Node)
```

## Visual QA

Driven through the single sanctioned `VisualQaRunner` (concurrency 1, launch cap,
cooldown, readiness/per-job timeouts, graceful teardown, PID tracking, post-run
leak check). Every source opened is a **scratch** file under the OS temp dir; the
capture server refuses any editor target outside temp. Saves and the staged
external change land only on those scratch files — never a real project.

**Result: PASS** — 15/15 captures · **1 Electron launch** · 0 survivors · graceful
exit(0) · no runError. Screenshots in `./screenshots/`.

| # | State | Evidence (page status) |
|---|-------|------------------------|
| 01 | Plain Mall WRL | `item.wrl` · Plain · 9 outline rows |
| 02 | Gzip Mall WRL | `item.wrl` · **gzip** (transparent load) |
| 03 | Syntax highlighting | tokenizer-driven colors, nested outline |
| 04 | Syntax diagnostic + navigate | `broken.wrl` · **6 diagnostics**, click-to-reveal |
| 05 | Advisories separated | `advisory.wrl` · **0 diagnostics / 1 advisory** (duplicate DEF), in its own non-authoritative panel |
| 06 | Dirty state | `dirty.wrl` · ● Modified · "Unsaved changes" |
| 07 | Save success | `save.wrl` · dirty → **"Saved"** (real conservative save) |
| 08 | World primary WRL | `world.wrl` · 6 outline rows |
| 09 | Nested referenced WRL | `inner.wrl` opened via a graph-**authorized** reference |
| 10 | Outline navigation | click an outline entry → reveal source range |
| 11 | External-change conflict | **"File changed on disk"** dialog: Reload / Save As / Cancel; edit preserved, source not clobbered |
| 12 | Optional external editor | delegates to the launcher (not-found message under `WRL_FORGE_NO_EDITOR`) |
| 13 | Theme — Light | dark text on light bg |
| 14 | Theme — Terminal | high-contrast green on black |
| 15 | Theme — Tokyo Night | lavender text on deep blue-black |

The default **Dark** theme is shown in states 01–12.

## Performance gate (`analyze()` = parse + highlight + diagnostics + advisories + outline)

The editor's hot path is the single `analyze()` pass, run on a **250 ms** debounce
after edits (keystrokes never parse synchronously). Measured in pure Node (median
of repeated runs):

| Profile | Bytes | Median | Max | Highlights | Diag |
|---------|------:|-------:|----:|-----------:|-----:|
| small Mall item | 608 | 0.2 ms | 0.9 ms | 53 | 0 |
| representative World | 6,929 | 1.4 ms | 3.0 ms | 1,222 | 0 |
| ~327 KB file | 326,887 | 40.5 ms | 73.1 ms | 33,027 | 0 |
| ~1.3 MB corpus | 1,634,435 | 224.3 ms | 317.2 ms | 165,135 | 0 |
| script-heavy | 257,296 | 41.4 ms | 96.0 ms | 25,501 | 0 |
| many recoverable errors | 108,016 | 22.0 ms | 49.6 ms | 26,001 | 770 |

**Result: PASS** — every profile's median stays under the 250 ms debounce.

**Known limitation:** the synthetic ~1.3 MB corpus (224 ms median) approaches the
debounce budget. The debounce keeps *typing* responsive regardless (a reparse only
fires after a pause), but the post-idle reparse of a >~1 MB file is a visible
~220 ms of main-thread work. Realistic inputs are far smaller: Mall items are
capped at 80 KB and typical worlds land under ~350 KB (40 ms). Off-thread parsing
is a future optimization (7C+), not a 7B blocker.

_Numbers are machine-specific; `RESULTS.json` / `PERF.json` (git-ignored) hold the
raw run output with absolute paths and PIDs._
