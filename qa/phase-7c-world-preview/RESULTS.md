# Phase 7C3 — World Unsaved-Buffer Live Preview — Visual QA Results

**RESULT: PASS — 22/22 states, 22/22 gates, 1 Electron launch, 0 survivors, leak-clean.**

- Run: 2026-07-13 (Linux, `npm run qa:world-preview`), single reused capture-server
  process (PID 840040), concurrency 1, 0 retries, graceful exit code 0
  (`VisualQaRunner` + lock, per `docs/VISUAL_QA_SAFETY.md`).
- All projects were **scratch worlds staged under the OS temp dir** (a primary with
  two DEF'd viewpoints + textured floor, a plain nested `rooms/hall.wrl`, a **gzip**
  nested `gz/vault.wrl`, an on-disk unreferenced `newthing.wrl`; a findings world
  with a `CASE.PNG`; a 72-texture world; a second world for the project switch).
  No historical fixture was touched; **no temporary WRL / `.edit.wrl` was written**
  (the stress harness additionally hash-verifies the source tree).
- Each state was gated on its **observable outcome** (status chip, edited-document
  identity, bound viewpoint, navigation choice, buffer findings, texture count,
  overlay/generation leak counts) — not just on a PNG existing.

| # | State | Chip observed | Gate |
|---|-------|---------------|------|
| 01 | World primary opened, split preview | Live | context=world, editedIsPrimary ✔ |
| 02 | Unsaved **primary** edit rendered in the full scene | Live | scene valid ✔ |
| 03 | Unsaved **nested** edit rendered in the full scene | Live | editing `rooms/hall.wrl` ✔ |
| 04 | Auto-update after edit (700 ms debounce) | Live | ✔ |
| 05 | Manual Update | Live | ✔ |
| 06 | Temporarily broken **primary** | Showing last good version | prior full scene retained ✔ |
| 07 | Temporarily broken **nested** WRL | Showing last good version | prior full scene retained (X_ITE pre-validation) ✔ |
| 08 | Recovery after repair | Live | ✔ |
| 09 | Show saved version (full world from disk) | Showing saved version | ✔ |
| 10 | Viewpoint preserved across a refresh | Live | bound `DEF Above` ("Overview") kept ✔ |
| 11 | Viewpoint fallback after removal | Live | fell back to first (`Entry`/"Front door") ✔ |
| 12 | Navigation mode preserved | Live | WALK kept ✔ |
| 13 | New file reference blocked before rescan | New file reference found — choose Find new files | newRefs=1, not loaded ✔ |
| 14 | Find new files (save → rescan → fresh Update) | Live | newRefs=0, renders ✔ |
| 15 | Missing / case / remote / unsafe findings | Live | all four categories surfaced, none loaded ✔ |
| 16 | Preview maximized | Live | layout ✔ |
| 17 | Editor-only layout | Live | layout ✔ |
| 18 | High Contrast at enlarged zoom | Live | ✔ |
| 19 | World with **72 textures** | Live | uniqueTextures=72 ✔ |
| 20 | Nested **gzip** Inline | Live | 3 WRL nodes, scene valid ✔ |
| 21 | Overlay/generation counts after close | Live → leak | size=0, activeGenerations=0 (both bridges) ✔ |
| 22 | Project switch cleanup (second scratch world) | Live → leak | size=0, activeGenerations=0 ✔ |

Scene-replacement time (renderer-measured, request → X_ITE scene settled):
**~0.58–0.81 s** across all successful states (min 572 ms, max 808 ms — the 72-texture
world); failed updates settle in ~2–3 ms because the last good scene is never cleared.

Raw per-state payloads (chip, generations, bound viewpoint, nav choice, buffer
findings, leak counts) are in `RESULTS.json`; screenshots in `screenshots/`.

A same-day regression run of the Phase 7C2 Mall suite (`npm run qa:mall-preview`)
stayed green: 18/18, 1 launch, 0 survivors, leak-clean.
