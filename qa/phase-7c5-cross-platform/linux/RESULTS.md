# Phase 7C5 — Linux Acceptance

Host: Linux x11 · Node v20.20.2 · npm 11.17.0 · git 2.43.0 · electron 41.7.1.
Run from the repo working tree. Visual QA exclusively through `VisualQaRunner`.

## Part 1 — automated gate + serialized visual suites

| Gate / suite | Runner | Result |
|---|---|---|
| `npm test` | — | 567/567, 0 fail |
| `npm run check` | — | exit 0 (tests + full `node --check` gate) |
| Vision accommodations | `qa:vision` | PASS 9/9 · 1 launch · 0 survivors |
| Native editor | `phase-7b-native-editor` | PASS 15/15 · 1 · 0 |
| Mall unsaved preview | `qa:mall-preview` | PASS 18/18 · leakOk · 1 · 0 |
| World unsaved preview | `qa:world-preview` | PASS 22/22 · overlays 0 / gens 0 · 1 · 0 |
| Existing Mall disk preview | `qa:visual` CLI | PASS 5/5 · 1 · 0 · fixtures byte-identical |
| Existing World disk preview | `phase-4b-world-preview` | PASS 12/12 · 1 · 0 |
| World packaging | `phase-5a-world-packaging` | PASS 7/7 · bundle → /tmp · 1 · 0 |

Safety: no launch loops (1 launch/suite; retries used 0), zero survivors, graceful
teardown, no `pkill`/`killall`, no fixture mutation, no `.edit.wrl`/temp preview
WRLs left in the repo, no historical Cybertown files modified. Working-tree changes
were regenerated QA evidence only.

Note: the existing Mall **disk** open flow (`openMallPath`) creates `.edit.wrl`
working copies — the Mall lane's documented edit model, distinct from the 7C
unsaved-buffer preview (no temp file). They were temp-confined and cleaned.

## Part 2 — stress / performance / leak

Pure bridge+scheduler harnesses (no Electron → no survivors; scratch inputs
hash-verified):

- Mall stress: 50→v50 & 100→v100 coalesce to 1 render; overlay=1; **0 overlays / 0 gens after close**; stale gen refused; 0 source writes; 2000 load+resolve @ 4 µs/op.
- World stress: primary & nested 50→1; 40 switches (overlay=1, prior sessions closed); 25 replacements avg 0.095 ms; 25 failed+repaired (25 stale refused); project-switch-with-pending → 0/0; 1000 viewpoint restores @ 2.4 ms; heap **4→3.9 MB flat** over 2000 loads; 3 files byte-identical.
- 7C5 supplement (exact matrix counts): requested 300 → render attempts 153 · coalesced 297 · stale ignored 50 · replacements 150/0 · overlays & gens 0/0 before & after (Mall & World) · pending 0/0 after reload+close · world fixtures identical.

Performance (`analyze()` hot path; median / max):
small 0.3/1.3 · repr-World 1.5/5.3 · 80 KB 7.8/22.4 · 327 KB 35.9/71.2 · 1 MiB
136.4/172.9 · 1.3 MiB 208.7/328.6 · script-heavy 33.8/81.2 · error-heavy 18.3/37.0
(ms). All medians < 250 ms editor debounce; >1 MiB uses the preview manual-Update
band. Bridge preview-request/scene-replacement 0.095 ms avg; heap flat across 2000
refreshes. X_ITE exposes no first-frame metric — none fabricated. No worker/main-
thread optimization warranted.

## Part 4 (Linux half) — regression isolation

Per-lane tests green: validator 10, url/case 6, backups 3, window-state 6,
world-project 110, world-recon 17, external-editor/mall-edit-flow 5, posture 6,
settings 5. Guardrails: `validator.js` and World scanner/packaging independent of
`src/vrml` + 7C overlay; parser required only by editor `language.js`; bundle uses
zlib only. E2E spot-checks: validator flags forbidden node (Sound); World scanner
71 textures / 0 missing / 0 remote.
