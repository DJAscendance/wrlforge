# WRL Forge Roadmap

Status key: ✅ done · 🚧 current lane · ⏳ planned · ⛔ deferred (not approved)

This roadmap is scoped in phases. Each phase lists prerequisites, risks, and completion criteria. Do not begin a phase without prior approval — this document describes the plan, it is not itself authorization to start implementation.

## Phase 0 — Existing Foundation ✅

The working `vrmlpad` tool, now the Mall Item lane of WRL Forge.

- Gzip-transparent file handling (`isGzip`, decompress/recompress)
- External VSCodium editing via `.edit.wrl` sibling files
- Cybertown Mall item validation (`validator.js`)
- Backup-before-overwrite repack workflow
- Status-panel UI with live re-validation polling
- Window position/size persistence

**Completion criteria:** met — this phase is the shipped, working state as of the rename.

## Phase 1 — Product Rename and Profile Foundation ✅

- Rename `vrmlpad` → **WRL Forge** across package metadata, branding, docs, and launchers
- Introduce the explicit three-profile model (Mall Item / World Project / Generic VRML97) in documentation
- Sketch a validation-profile architecture (separate validator modules per profile, no shared Cybertown-specific logic)
- Git baseline established, automated test foundation added (`npm test` / `npm run check`)
- **No major feature implementation** — this phase is naming, documentation, and infrastructure only

**Prerequisites:** none beyond the Phase 0 foundation.

**Risks:**
- Electron's `userData` path is derived from `package.json` `name`; renaming it silently loses saved window state without a migration fallback. *(Mitigated: `main.js` falls back to the old `~/.config/vrmlpad` path — see AGENTS.md "Rename note".)*
- Over-renaming internal symbols (IPC channels, bridge object names) purely for cosmetic consistency adds risk without user-facing benefit. *(Mitigated: `mall:*` channels and `window.vrmlpad` were deliberately retained.)*

**Completion criteria:** met.
- All user-facing branding (window title, panel UI, desktop launcher, package description) reads "WRL Forge"
- Existing Mall Item functionality verified unregressed (open/edit/validate/repack/backup/window-state)
- `AGENTS.md`, `CLAUDE.md`, `README.md`, and this roadmap reflect the expanded mission
- A git repository with a clean baseline commit exists, and a `node:test` suite covers the extracted pure modules plus `validator.js`

## Phase 2A — Fit Engine and X_ITE Technical Spike 🚧 (this lane)

- A pure, independently-tested fit-math module encoding the Cybertown Mall Item fit rules (ground `Y=-1.75`, center `X=0`, max `Z<=+1`, max dims `10x10x10`, default requested scale `125%`), decoupled from how a bounding box is obtained
- An isolated technical spike (`spikes/xite-mall-fit/`) proving out X_ITE as the bounds source: load a VRML97 item, derive a transform-aware world-space bounding box by walking the parsed scene graph (no regex/string scraping of geometry), and render a non-exported guide overlay (ground plane, center axis, Z-limit plane, 10m cage)
- Explicitly **not** integrated into the production app — the spike has its own isolated Electron process, its own fixtures, no shared IPC surface with `main.js`
- Explicitly display-only — no apply/bake/mutation path exists in the spike

**Prerequisites:** Phase 1 complete.

**Risks:**
- Silent geometry mutation would violate the non-destructive convention — mitigated by the spike having no write-capable code path at all, not just an unused one.
- X_ITE might not expose a trustworthy, transform-aware bounding box — confirmed during this phase: it does not expose one publicly, so bounds are computed via manual `SFMatrix4` world-transform accumulation over the parsed scene graph instead (see `spikes/xite-mall-fit/NOTES.md`).

**Completion criteria:** met.
- Fit-math module has `node:test` coverage of the required edge cases (compliant, off-center, above/below ground, exceeds Z limit, exceeds 10m, zero-size axis, negative coordinates, nested-transform, rotated, custom rules)
- Spike demonstrates transform-aware bbox extraction (verified against a nested-transform fixture and a rotated fixture by hand-calculation, plus a real Cybertown Mall item) and honestly documents where confidence is lower (Extrusion, DEF/USE, texture resolution — see NOTES.md)
- Findings are recorded in `spikes/xite-mall-fit/NOTES.md` to inform Phase 2B scoping

## Phase 2B0 — Extrusion / Gzip / Texture Remediation ✅ (this lane)

A narrow remediation lane required by the independent Phase 2A QA's
**CONDITIONAL GO** before any Phase 2B production UI work. Kept inside the
isolated spike — no production app code changed.

- **Extrusion bounds corrected**: the QA blocker (scale/orientation ignored →
  dangerous width/depth underestimate) is fixed with an exact VRML97
  cross-section sweep (`spikes/xite-mall-fit/extrusion-bounds.js`), verified
  EXACT against X_ITE's own generated-mesh bounds on 9 fixtures plus
  hand-derived transformed cases, with a conservative (never-smaller) fallback
  for ambiguous spines.
- **Gzip → X_ITE**: X_ITE now receives decompressed text only, via a read-only
  main-process channel reusing the production `isGzip` helper.
- **Relative textures** resolve against the source `.wrl`'s directory
  (`browser.baseURL`); missing/case-mismatch textures warn clearly without
  breaking bounds.
- Security posture preserved (`contextIsolation:true`, `nodeIntegration:false`,
  read-only IPC confined to `fixtures/`, no write path).

**Completion criteria:** met. Evidence:
`qa/phase-2b0-extrusion-loading/RESULTS.md`; tests in
`spikes/xite-mall-fit/*.test.js`. This closes Phase 2B's open items (Extrusion
accuracy, local texture resolution, gzip-to-X_ITE), so **Phase 2B is now
unblocked** pending its own approved lane.

## Phase 2B — Mall Item Fit Production UI ✅

Delivered as **Phase 2B1** (the production integration lane; Phase 2B0 above was
the preceding remediation). The proven spike modules were promoted to
`src/preview/` (single source of truth — the spike now references them, no
duplicate implementations), `x_ite` (MIT, v15.1.10) was added to the root
dependencies, and an embedded X_ITE preview was wired into the Mall Item
workspace. This is the first point X_ITE enters `main.js`/`renderer/`.

- Embedded X_ITE preview *inside the production app*, loaded via a read-only
  main-process channel (`preview:load`, role-based, gzip decompressed in main;
  X_ITE only ever receives plain text).
- **Original** vs. **Cybertown Fit** modes. Fit mode applies a **preview-only**
  parent `Transform` (scale+offset from the authoritative bounds) plus the
  non-exported guide overlay — never written to any file.
- Cybertown guide overlays (ground plane, center axis, Z-limit plane, 10m cage,
  optional item box) with per-guide toggles, reusing the Phase 2A guide layer.
- Live bounds/scale/offset/rule report from the shared `fit-math` module, driven
  by the transform-aware X_ITE bounds (`bbox-traversal`); honest confidence
  (exact | conservative | unavailable).
- The validator's advisory untransformed placement line is **suppressed** when
  authoritative bounds are present, so placement verdicts never conflict.
- Layered texture/URL security: read-only path-free IPC, `safeResolve`
  confinement, `session.webRequest` remote-request cancellation, strict CSP,
  `contextIsolation`/`nodeIntegration` unchanged. Remote URLs are blocked and
  tested; path traversal is blocked and tested.
- A permanent in-repository DEF/USE fixture (`test/fixtures/preview/def-use.wrl`)
  plus an Electron preview test that verifies both occurrences are counted.

**Prerequisites:** met — Phase 2A reviewed; Phase 2B0 resolved Extrusion
accuracy, local texture resolution, and gzip-to-X_ITE loading.

**Completion criteria:** met. Evidence:
`qa/phase-2b1-production-fit/RESULTS.md`, `docs/PREVIEW_ARCHITECTURE.md`, and the
78-test suite (incl. Electron smoke + preview tests). No geometry is mutated;
the fit is preview-only. Apply/Bake Transform remains **not** implemented
(deferred; requires a separate approved lane).

**Explicitly not implemented in this lane:** Apply Transform, Bake Transform,
coordinate rewriting, wrapper insertion, automatic fitted-file saving.

## Phase 3 — World Project Recon 🔄

**Phase 3A (recon + asset graph) landed** — see `docs/WORLD_PROJECT_RECON.md` and the
read-only `qa/world-recon/` analyzer (`npm run recon:world`). Evidence gathered over
71 archived places + the CTR bundled world.

- [x] Collect known-good world `.wrl`/project samples for reference (campuscolony archive of 71 places; CTR `hitek_col`)
- [x] Determine actual texture-count limits — **the ~20-texture web-form figure is NOT a server constraint** (18/60 places exceed 20; max 70 unique in hi-tek). Package **size** limit remains unresolved (flagged).
- [x] Draft a world-specific validation rules profile, kept separate from `validator.js`'s Mall Item rules (documented, **not enforced**)
- [ ] Document the current CTR (Cybertown Revival) world-submission workflow as it actually exists today — *open (needs operator/process input)*
- [ ] Inspect Scott99's `worlduploader`/`itemuploader` tools (https://www.3dgrove.com) as historical workflow references only — no code or asset copying without established licensing/permission — *open*

**Prerequisites:** access to real-world sample files and/or documentation of the current submission process; Phase 1 complete.

**Risks:**
- Acting on assumed limits (e.g., encoding "20 textures" as a hard rule) would produce false validation failures for legitimate worlds.
- Reverse-engineering Scott99's tools beyond "workflow reference" risks license/IP issues — treat as read-only research, not a source to copy from.

**Completion criteria:**
- A documented (not yet enforced) world validation rule set, with each rule traceable to an actual confirmed constraint rather than an assumption
- Open questions about real server limits explicitly flagged as unresolved, not silently guessed

## Phase 4 — World Asset Resolver 🔄

**Phase 4A (production resolver + read-only workspace) landed** — see
`docs/WORLD_PROJECT_ARCHITECTURE.md`. The Phase 3A recon logic was promoted into
`src/world-project/` (single source of truth; `qa/world-recon/*` re-export it),
wired behind confined read-only `world:*` IPC, and rendered in a dedicated
`renderer/world.html` workspace (summary, filterable asset table, dependency
view). The embedded world preview followed in **Phase 4B** (below); still no
packaging/upload.

- [x] Open a project folder (not just a single file), with primary-file
  detection (ambiguity surfaced, never guessed) — plus direct primary-file open
- [x] Parse local URL references across the primary world and nested
  `Inline`/EXTERNPROTO assets (gzip + plain, bounded + cycle-safe)
- [x] Discover textures and nested local assets, however many — **no** arbitrary
  20-texture limit (fixtures + tests cover 24 and 70 unique textures)
- [x] Missing-file, filename-case-mismatch, absolute/traversal (unsafe), remote,
  duplicate, and dependency-cycle diagnostics
- [x] Read-only workspace UI (summary, filters, dependency view) sharing the one
  window; Mall Item lane unchanged; profile kept separate from `validator.js`
- [x] Non-mutation verified (fixtures byte-identical before/after scanning) and
  one controlled `VisualQaRunner` visual run of the workspace states

**Prerequisites:** Phase 3's world rules profile (draft) — met.

**Risks (addressed):**
- Recursive/inline asset graphs could be large or cyclic — bounded traversal
  (`maxWrlNodes`/`maxDepth`) + visited-set cycle safety; cycles are reported.
- Case-mismatch detection is done in code (not leaning on the local fs), so it
  catches a hazard that a case-insensitive dev machine would mask.

**Completion criteria:** met — the resolver enumerates all referenced local
assets in a real multi-texture project (`test/fixtures/world/mini`, 25 textures)
and flags deliberately-broken references (`test/fixtures/world/broken`: missing,
case mismatch, unsafe, remote).

### Phase 4B — World Preview ✅

The embedded X_ITE **world** preview landed — it renders a complete world,
honouring the gzip/nested-Inline asset graph the Phase 4A resolver produces. See
`docs/WORLD_PROJECT_ARCHITECTURE.md` and `docs/PREVIEW_ARCHITECTURE.md`.

- [x] Read-only preview loaded from decompressed text (`world:previewLoad`),
  taking **no** renderer-supplied path — main owns every project path.
- [x] Controlled local dependency resolution: X_ITE resolves nested Inline /
  textures through a privileged, standard, LOCAL-only `wrlworld://` scheme whose
  handler serves **only** asset-graph-authorized files (readable WRL nodes +
  present exact-case assets), gzip-decompressed, confined to the project root.
  Each nested WRL resolves relative URLs from its **own** directory.
- [x] Plain/gzip primary **and** plain/gzip nested Inline; >20 and ≥70 textures
  with no truncation; repeated deps; bounded dependency cycles; per-file bases;
  filenames with spaces.
- [x] Viewpoint discovery + selection (including viewpoints authored inside
  nested Inlines, via `EnableInlineViewpoints`), Reset View, navigation modes,
  loading / warning / stale / failure states, loaded-vs-missing counts, and an
  explicit **Refresh Preview**. Temporary parse error keeps the last valid scene
  (flagged stale).
- [x] Missing / case-mismatch / remote / unsafe references surfaced but never
  loaded; inline scripts never executed (CSP blocks eval). No project mutation
  (fixtures byte-identical before/after; parse-fail/recover writes only a scratch
  project under the OS temp dir). No Mall Item rules applied in World mode.
- [x] One serialized `VisualQaRunner` run of all 10 states
  (`qa/phase-4b-world-preview/`): one launch, graceful exit, no leak.

**Explicitly not implemented in this lane** (unchanged from Phase 4A): asset
repair, file copy/rename/delete, packaging, direct upload, Apply/Bake transforms,
Windows packaging. World preview is **analysis + display only**; it never marks a
project upload-ready.

### Phase 5A — World Project Packaging Audit + Review Bundle ✅

A narrow packaging slice for the World Project lane (the world half of Phase 6),
kept read-only except for one explicit user action. See
`docs/WORLD_PROJECT_ARCHITECTURE.md` (“Packaging”) and
`docs/WORLD_PACKAGE_QUESTIONS.md`.

- [x] **Package Audit** (read-only): a deterministic package plan from the
  production asset graph — packaged file set (primary + nested local WRL + present
  approved assets) with project-relative path, asset type, byte size, content hash
  (sha256), referencing WRL files, and dependency depth; totals (files / bytes /
  WRL count / unique textures); findings (missing / case / unsafe / remote /
  cycles / repeated); and **unused** files under the root (reported, never
  auto-included). Repeated references packaged once; plain + gzip WRL; >20 and ≥70
  textures.
- [x] **Build Review Bundle** (explicit action, requires a destination): a
  **deterministic ZIP** (Node `zlib` only — **no** third-party archive
  dependency; fixed 1980 timestamps) containing `project/<relpath>` (byte-for-byte,
  structure preserved), `MANIFEST.json`, `REPORT.md`, and a
  `READ-ME-FIRST.txt`, all labelled **“Review Bundle — Not Confirmed for Direct
  Cybertown Upload.”**
- [x] **Blocking rules**: missing / case-mismatch / absolute / traversal / remote
  / unreadable references block packaging; cycles are reported but do **not** block
  (local + bounded). Build refuses a blocked project, an in-project destination,
  and overwriting an existing file; it re-hashes every file against the manifest.
- [x] **Non-mutation** verified (source byte-identical across audit + real build;
  bundle contents/hashes match the manifest; deterministic output). One serialized
  `VisualQaRunner` run of all packaging states (`qa/phase-5a-world-packaging/`).
- [x] Open questions for a **true** upload-ready packager (archive/layout format,
  size cap, asset-count limits, allowed types, naming/case, primary-world naming,
  auth + submission workflow) documented in `docs/WORLD_PACKAGE_QUESTIONS.md`.

**Explicitly not implemented:** direct upload, authentication, automatic repairs,
path rewriting, renaming, asset deletion, source mutation, Apply/Bake transforms,
internal editing, Windows packaging. Packaging is **analysis + a review bundle
only**; it never uploads and claims no current-server compatibility.

## Phase 5 — Embedded X_ITE Preview ⏳

- Integrate X_ITE as WRL Forge's embedded rendering engine — do not build a custom VRML/X3D renderer
- Isolate the preview from privileged Electron APIs (same `contextIsolation`/`nodeIntegration` discipline as the rest of the app; the preview surface should not gain filesystem/IPC access beyond what it needs to load local assets)
- Preserve the external VSCodium workflow — "Open in Editor" remains available as an advanced action, it is not replaced
- Support both Mall Item and World Project contexts

See Phase 2A for the earlier, narrowly-scoped X_ITE technical spike that precedes this phase's embedded production integration, and Phase 2B for the Mall Item-specific slice of embedded preview that phase already covers — this phase is the full production integration across both Mall Item and World Project contexts, not the first place X_ITE is evaluated.

**Prerequisites:** Phases 2 and 4 (placement math and asset resolution) provide the data the preview needs to be useful, though the embedded viewer itself could technically start earlier if scoped narrowly — Phase 2A/2B already exercise that option for the Mall Item profile specifically.

**Risks:**
- This is the highest-blast-radius phase — it's the one place a dependency (X_ITE, however it's integrated: bundled lib, iframe, etc.) enters the Electron app directly instead of running inside VSCodium's own extension host.
- Privilege isolation mistakes here are the most likely way this app could regress from "small companion tool" to "large surface area to secure."

**Completion criteria:**
- Preview renders a real mall item and a real world sample correctly
- Security review confirms the preview surface has no more Electron privilege than it needs
- VSCodium-based editing/preview workflow still works unchanged for users who prefer it

## Phase 6 — Packaging ⏳

The **World Project** half landed early as **Phase 5A** above (deterministic
package audit + review bundle, `docs/WORLD_PROJECT_ARCHITECTURE.md` “Packaging”).
Remaining for this phase: the Mall Item equivalent, and — gated on
`docs/WORLD_PACKAGE_QUESTIONS.md` being answered — a *true* upload-ready world
package format (the Phase 5A review bundle is explicitly **not** confirmed for
direct upload).

- Deterministic Mall Item package output
- Deterministic World Project package output *(Phase 5A: review-bundle form done; server-format-confirmed form pending the open questions)*
- Human-readable validation report (shared format across profiles where it makes sense)
- **No direct upload** — packaging produces a file/folder ready for a human to submit, it does not submit anything itself

**Prerequisites:** Phases 1–5 substantially complete, since packaging depends on validation and asset resolution being trustworthy.

**Risks:**
- "Deterministic" needs to mean actually reproducible (same input → byte-identical or at least content-identical output), which constrains things like timestamp embedding in package metadata.

**Completion criteria:**
- Re-running packaging on unchanged input produces an equivalent package
- Validation report clearly states pass/fail per rule with enough detail to act on
- No network calls are made by the packaging step

## Deferred ⛔

Not scheduled into any phase above; requires explicit future direction before any design work begins:

- An internal text editor (Monaco/CodeMirror or custom) — VSCodium remains the editor indefinitely unless this is revisited
- Authentication
- Direct upload to any Cybertown server
- Automatic destructive rewrites of user content (all mutation stays backup-first and, where relevant, preview-before-apply)
- Framework migration (e.g., introducing a UI framework/bundler to the renderer) — the current plain HTML/CSS/JS approach is intentional, see `AGENTS.md` Conventions
