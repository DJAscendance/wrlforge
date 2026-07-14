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

### Phase 5A — World Project Packaging Audit + World Project Bundle ✅

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
- [x] **Build World Project Bundle** (explicit action, requires a destination): a
  **deterministic ZIP** (Node `zlib` only — **no** third-party archive
  dependency; fixed 1980 timestamps) containing `project/<relpath>` (byte-for-byte,
  structure preserved), `MANIFEST.json`, `REPORT.md`, and a
  `READ-ME-FIRST.txt`, all labelled **“WRL Forge World Project Bundle”** — a review +
  manual hand-off package (uploaded by hand through the Cybertown website; not a
  server-certified upload format).
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

### Phase 6A — Windows Compatibility Recon + First Private Build ✅

Prepared and validated the existing app for Windows **without** changing Linux
behavior or adding product features. See `docs/PLATFORM_NOTES.md`,
`docs/BUILD.md`, and `qa/phase-6a-windows/`.

- [x] Audited Linux-only assumptions; the only in-code one was `spawn('codium')`.
  Made editor discovery cross-platform (`src/editor/editor-locator.js`): Linux
  `codium`/`code`, Windows install-location search + PATH shims, a configurable
  override (`WRL_FORGE_EDITOR` / `settings.json` `editorCommand`), and a clear
  "editor not found" message. Spaces/non-ASCII-safe launch args.
- [x] Hardened case-mismatch detection for **case-insensitive** filesystems: the
  directory listing (not `existsSync`) is now authoritative on every platform, so
  Windows/macOS catch an authored `Stone.PNG`→`stone.png` hazard instead of
  masking it. Explicit code-based test + verified on real NTFS.
- [x] Verified paths (drive letters/backslashes), gzip open, project scanning
  (nested + gzip, >20 and 70 textures), World Project Bundle ZIP + integrity, window-state
  / userData migration, and spaces/non-ASCII paths on **real Windows 11** via a
  packaged-runtime self-test (31/31).
- [x] Produced a **private, unsigned** Windows test build with **electron-builder**
  (MIT): portable `.exe` + NSIS installer, neutral placeholder icon, labelled
  **Private Test Build — Unsigned**. `electron` moved to `devDependencies`.
- [x] Verified the packaged app **launches** on Windows 11 (Mall + World lanes,
  correct branding, clean exit) and kept Linux fully green (234 unit tests + Mall/
  World-preview/packaging visual regressions).

**Explicitly not implemented** (unchanged exclusions): direct upload, auth,
upload-ready CTR packaging, auto-update, code signing, public releases, Microsoft
Store, asset repair, Apply/Bake, internal editor, and any new world/Mall features.
A broader Windows **beta** (signing, SmartScreen, live VSCodium launch, dialog-
driven flows, arm64) is a separate future lane.

### Phase 6B — Windows Beta Hardening ✅

Turned the Phase 6A private test build into a **beta candidate** (`1.1.0-beta.1`,
labelled **Private Beta — Unsigned**) by validating the real GUI workflows on
Windows 11. **No new product features** — hardening + validation only. See
`qa/phase-6b-windows/RESULTS.md`, `docs/SIGNING_READINESS.md`, and
`docs/BETA_RELEASE_NOTES.md`.

- [x] Fresh versioned x64 beta artifacts (portable + NSIS + `SHA256SUMS`), rebuilt
  with `CSC_IDENTITY_AUTO_DISCOVERY=false` and **verified genuinely unsigned** (PE
  cert table empty). Kept private + git-ignored; **no public GitHub Release**.
- [x] **Committed** packaged-runtime self-test (`win-selftest.js`, unlike 6A) —
  **37/37 on real Windows 11** (Electron 41.7.1 / Node 24.15): gzip, nested + gzip
  scan, 25 & 71-texture worlds, viewpoints, missing/remote/unsafe/case diagnostics,
  Package Audit, World Project Bundle + ZIP hash integrity + in-project/overwrite refusals,
  spaces + non-ASCII paths, **all editor-override cases incl. the invalid-override
  fall-through**, `.edit.wrl` generation, window-state/userData paths. Also green on
  Linux (CI-verifiable before the VM).
- [x] **Live GUI focused pass** on the beta build: portable + NSIS-installed launch,
  native file/folder dialogs, **X_ITE Mall Original/Fit preview renders on Windows**
  (the Phase 6A gap), gzip open, **X_ITE World preview + viewpoints render**,
  Package Audit + **World Project Bundle written outside the project (6/6 manifest hashes
  match)**, window-state persistence across portable↔installed (shared
  `%APPDATA%\wrl-forge`), clean exit, Start-menu launch, and **uninstall** (app +
  shortcuts removed, user projects untouched). Non-mutation verified (fixtures
  byte-identical).
- [x] **Signing-readiness audit** (`docs/SIGNING_READINESS.md`): cert format
  (OV/EV → token/KMS, not bare `.pfx`), env/config points (`CSC_*` / `win.sign` /
  `signtoolOptions`), RFC-3161 timestamping, CI implications (needs a Windows/cloud
  signing stage; signed artifacts aren't byte-reproducible → re-checksum after
  signing), secret handling. **No certificate purchased/generated/used.**
- [x] Linux stays fully green: 234 unit tests, syntax gate, and the Mall/World-
  preview/World-packaging visual regressions (20 pass) run **serially through the
  sanctioned harness**, no leaks (launch-storm guardrail preserved).

**Verdict (Phase 6B):** **CONDITIONAL GO** for a limited private Windows beta,
gated on one live check — a live VSCodium "Open in Editor" run (VSCodium was not
installed in the VM at 6B; the clear not-found path was verified instead) — plus
the standing scope facts that artifacts stay **Unsigned** (no SmartScreen-
elimination claim) and the World Project Bundle is **not** confirmed for direct Cybertown
upload.

### Phase 6B1 — VSCodium live-launch closeout ✅

Closed the one remaining Phase 6B condition. VSCodium **1.126.04524 (x64)** was
installed in the WinBoat Windows 11 VM via its official user-setup installer and
the **production editor path was driven end-to-end, 13/13**
(`qa/phase-6b1-vscodium/RESULTS.md` + `win-editor-verify.js` under the packaged
Electron-as-node): automatic install-location **discovery**; plain **and** gzip
`.wrl` → `.edit.wrl`; a genuine `buildLaunch`+`spawn` of VSCodium on an `.edit.wrl`
whose path has a **space and a non-ASCII character**; `editorCommand` **and**
`WRL_FORGE_EDITOR` overrides honored; **invalid override falls back** to discovery;
**single** editor instance (no launch loop); **clean exit** (no survivors); and
**source fixtures unmutated**. A live VSCodium window open on the `.edit.wrl` is
captured in `qa/phase-6b1-vscodium/screenshots/`. No product code changed — this is
verification + docs only. Linux stayed green (`npm test` / `npm run check`).

**Verdict (Phase 6B1):** **GO** for limited private Windows beta distribution. The
last live condition is closed; the only remaining items are the deliberate,
documented scope constraints of a private beta — artifacts remain **Unsigned**
(SmartScreen warning expected, **not** eliminated), **x64 only** (no Windows
ARM64), and the World Project Bundle is **not** confirmed for direct Cybertown (CTR)
upload. Public release, signing, direct upload, and auto-update remain out of scope.

**Explicitly not implemented** (unchanged exclusions): direct upload, auth,
upload-ready CTR packaging, auto-update, code signing (only readiness documented),
public releases, Microsoft Store, Apply/Bake, **Windows ARM64**, any new Mall/World
features beyond the Phase 7 editor/parser foundation below.

## Product Direction (locked, 2026-07-12) 🔒

Set after the Phase 6B1 closeout, before broader beta distribution:

1. **No direct uploads to Cybertown.** WRL Forge will not add authentication,
   networking, or submission code. Users upload through the Cybertown Mall or the
   existing Cybertown **website** workflow, by hand.
2. **No prototype / test-build / "unavailable feature" copy** in the user-facing
   application. Do not advertise absent features or ship disabled buttons for
   features that don't exist. Truthful runtime states (missing file, parse error,
   blocked remote URL, case mismatch, unsaved changes, editor-not-found,
   conservative bounds, unsupported syntax) stay. Automated tests, visual QA,
   safety guardrails, and honest errors are **kept**, never removed.
3. **VSCodium is an OPTIONAL external editor**, not a requirement. The integration
   (Linux + Windows, verified in Phase 6B/6B1) is preserved; the "editor not found"
   message appears only when the user requests the external-editor action. WRL
   Forge must eventually function without any external editor — see Phase 7.
4. The World review bundle is now labelled **"WRL Forge World Project Bundle"** — a
   review + manual hand-off package, not a server-certified upload format.
5. A **native WRL editor and a real VRML97 parser** are now a **beta requirement**
   (Phase 7), so the app stands on its own without VSCodium.

## Phase 7 — Native Editor and VRML97 Parser Foundation ⏳

Delivers the last hard beta requirement: a native editing experience backed by a
real tokenizer/structural parser, with the external editor demoted to optional.
X_ITE remains the ONLY renderer — **do not build a renderer**. See
`docs/NATIVE_EDITOR_ARCHITECTURE.md` for the full design; the parser produces a
reusable syntax tree feeding diagnostics, scene outline, asset-reference discovery,
`DEF`/`USE` validation, navigation, future formatting, safe targeted edits, and the
Mall/World validation profiles.

**Status:** Phase 7A (parser) and Phase 7B (native editor) have **shipped** and are
in production (see the ✅ sub-sections below). Within Phase 7C, planning (**7C0**) is
complete, the **7C4** Windows-native QA harness is **built**, **7C4.1** (Windows
Workspace Isolation Guard) is **built**, **Feature A (Vision Accommodations)** is
**built**, **7C1** (the pure buffer-overlay foundation) is **built**, **7C2** (the
Mall unsaved-buffer live preview) is **built**, and **7C3** (the World unsaved-buffer
live preview — primary + nested overrides, viewpoint preservation, Find new files) is
**built** and shipped in the native editor; and **7C5** (cross-platform acceptance +
private beta refresh) is **complete** — the full 7C feature set is accepted on both
Linux and native Windows 11 (local NTFS), with the refreshed private unsigned Windows
x64 beta `1.3.0-beta.1`. Phase 7D (beta polish) remains a **plan**. Anything still
plan-only ships no code without separate approval.

### Phase 7A — Parser Foundation ✅
**Shipped (parser-only lane).** A dependency-free, token-driven VRML97 tokenizer +
structural parser under `src/vrml/` (`tokenizer`, `parser`, `ast`, `diagnostics`,
`analyze`, `asset-refs`, `index`), producing a profile-neutral partial syntax tree
with exact source spans, stable diagnostic codes, bounded error recovery, and
explicit depth/node safety limits. Includes a semantic index (`DEF`/`USE`/`ROUTE`)
and a read-only AST asset-reference extractor validated for **parity** against the
production World Project scanner. Fixture corpus + `node:test` coverage under
`test/fixtures/vrml/` and `test/vrml/`; parser files wired into the `check` gate.
**No editing UI**, and **no change** to `validator.js` / World Project scanning /
Mall Fit / X_ITE preview / packaging / VSCodium / UI / save. See
`docs/VRML_PARSER.md` for grammar coverage, AST shape, diagnostic model, recovery,
safety limits, parity status, known limitations, and the Phase 7B integration
boundary. Design in `docs/NATIVE_EDITOR_ARCHITECTURE.md` (§ "Phase 7A scope").

**Phase 7A1 — Corpus Compatibility Corrections ✅.** Independent real-corpus QA
(Gemini, 2,124 Cybertown files) gave 7A a CONDITIONAL GO. Fixed three rejected
valid VRML97 forms — internal `-`/`+` in identifiers, multiline (LF/CRLF/CR)
strings incl. inline Script source, and case-sensitive header encoding — plus
lenient acceptance of the pervasive Cybertown/Blaxxun `ROUTE`/`PROTO`-inside-MFNode-
array pattern. Read-only corpus re-audit: diagnostics **−98.1%** (926,063 →
17,201), clean parses 961 → 1,745 of 2,124; remaining bulk is the documented
flat-scope duplicate-`DEF` limitation (NOT fixed — no PROTO-scope rewrite in this
lane). Parser-only; no production system changed. See `docs/VRML_PARSER.md`.

### Phase 7B — Native Editor ✅
Shipped a first-class native WRL editor so WRL Forge edits and safely saves plain
**and** gzip `.wrl` without any external editor. Built on **CodeMirror 6** (MIT,
local `@codemirror/*` + `@lezer/highlight`, bundled by esbuild → `renderer/vendor/`,
**no CDN**, all **devDependencies**; runtime deps stay `x_ite`-only). The existing
Phase 7A tokenizer/parser is the **sole** language authority — highlighting,
diagnostics, and the outline all derive from it; there is no second grammar.

Delivered: a new Editor workspace (`renderer/editor.html`/`editor.js`) reachable
from both lanes (Mall "Open in Native Editor" edits the real `.wrl` gzip-
transparently — no `.edit.wrl`; World "Open Primary WRL in Native Editor" plus a
per-dependency "Edit" that main authorizes against the scan graph). Line numbers,
undo/redo, search & replace, bracket matching, active-line highlight, VRML97
syntax highlighting, **authoritative** syntax diagnostics (click-to-navigate,
capped with a retained total) kept **separate** from a clearly-labelled
**non-authoritative** advisories panel (flat-scope VRML040–044; never blocks
saving), an AST outline (click-to-navigate), dirty tracking, cursor Ln/Col, a
conservative **safe save** (encode → conflict-guard → temp+fsync → verify-decode
→ timestamped backup → atomic rename → verify), external-change detection with a
**Reload / Save As / Cancel** dialog, Save As, Reload, Go-to-line, session
restore (confined to the previously-authorized context), optional "Open in
External Editor", and **four themes** (Dark/Light/Terminal/Tokyo Night, contrast-
checked, persisted). Security preserved: `contextIsolation:true`,
`nodeIntegration:false`, the narrow `window.vrmlpad.editor` bridge, and
**main-process path ownership** (the renderer sends text + intent + an opaque
sessionId, never a write path; Save As targets only a main-owned dialog path).

Verification: **382** non-visual tests; serialized **Linux visual QA 15/15**
(one Electron process via `VisualQaRunner`); a pure-Node **perf gate** (analyze()
< the 250 ms debounce across small/world/327 KB/1.3 MB/script-heavy/many-errors);
private unsigned **Windows x64** build with the editor packed in `app.asar` and 6
editor cases added to the Windows selftest (Linux-green; NTFS run is the WinBoat
step). See `docs/NATIVE_EDITOR_ARCHITECTURE.md` and
`qa/phase-7b-native-editor/RESULTS.md`. **Excludes** (Phase 7C): unsaved-buffer
X_ITE preview, live per-keystroke rendering, AST rewriting, formatting, scope-
aware PROTO analysis.

### Phase 7B1 — Native Editor Closeout ✅ (in progress)
Closes the issues from the independent Phase 7B review (Gemini, CONDITIONAL GO).
Removed the **passive external-editor launch**: opening a Mall `.wrl` no longer
launches VSCodium and never surfaces an "editor not found" message — the external
editor starts **only** through the explicit "Open in External Editor" action
(`src/editor/mall-edit-flow.js` extracts the passive-open vs explicit-launch logic
so it is unit-tested without Electron). Native editing still edits the real source
and never creates a `.edit.wrl`; the explicit external action ensures/refreshes the
`.edit.wrl` working copy. Corrected stale parser/editor documentation across the
agent guides and `docs/` (parser is wired into the native editor but has **not**
replaced the Mall validator / World scanner / preview resolver / packaging;
buffer-driven preview is Phase 7C, not 7B). Expanded `test/product-posture.test.js`
to scan `renderer/editor.html` + `renderer/editor.js` and guard native-editor
wording (no "planned", no unsaved-buffer-preview claim, no user-facing "Review
Bundle" label). The externally-triggered `world:buildReviewBundle` IPC channel and
its `buildReviewBundle` bridge/handler names are **intentionally retained** for
stability (internal, not user-facing). Real Windows 11 native-editor GUI
verification runs in this lane (WinBoat).

### Phase 7C — Editor + Preview Integration
Preview refresh from the unsaved editor buffer, debounced parsing, last-valid-scene
behavior, Mall Item and World Project contexts, reload/conflict handling, and the
safe save + backup workflow end-to-end. Being delivered one lane at a time, with a
stop-and-report gate between lanes.

**Planning — 7C0 ✅ complete.** `docs/PHASE_7C_PROPOSAL.md` (unsaved-buffer X_ITE
preview: buffer-overlay model, generation/stale model, last-valid state machine,
parser/X_ITE policy, security + threat model, collapsible editor split-view) and
`docs/WINDOWS_NATIVE_QA_PLAN.md` (Windows-native agent QA workflow, packaged-app
automation, evidence format, shared 7C0–7C5 slices).

**7C4 — Windows-native QA harness ✅ built.** `qa/phase-7c-windows/` +
`qa/visual-qa/` cross-platform (`qa:windows`); Tier 1 packed self-test + Tier 2
`VisualQaRunner` + evidence with a fixture-mutation NO-GO gate.

**7C4.1 — Windows Workspace Isolation Guard ✅ built.** `qa/visual-qa/workspace-guard.js`
refuses UNC / mapped-network-drive / host-share workspaces on Windows (the WinBoat
`\\host.lan\Data` share that broke `node_modules`), wired into `qa:windows`,
`qa:visual`, the Windows self-test, and the Windows build scripts; plus an
evidence-export allowlist (share is export-only, never node_modules/.git/source/
fixtures/backups/binaries). Linux paths are never blocked. See
`docs/WINDOWS_NATIVE_QA_PLAN.md` §"Workspace isolation".

**Feature A — Vision Accommodations ✅ built.** For low-vision users: one coherent
zoom level (Ctrl `+`/`-`/`0`, persisted) that scales **both** the CodeMirror code
area (a font compartment in `src/editor/browser/editor-view.js`) **and** the app
chrome (a `--wrl-ui-scale` rem layer in `renderer/editor.html`); a fifth **High
Contrast** theme; a toolbar zoom group. Pure zoom model in `src/editor/ui-state.js`;
visual QA `qa/phase-7c-vision/` (`qa:vision`). No main/preload/IPC/CSP change.

**7C1 — Buffer-overlay foundation ✅ built.** The pure, main-process-ready model for
previewing an unsaved buffer without writing a temp file — **no UI, no X_ITE, no CSP
or scheme change, nothing wired into a preview page yet.** Three dependency-free
modules under `src/preview/`: `buffer-overlay.js` (a session-scoped registry that
performs **byte substitution only** — it never authorizes a path, expands a graph,
resolves a renderer path, fetches, writes, or mutates a source; registration requires
an authorization **proof** the owning controller already obtained from the Mall
session / World scan graph, the narrow integration boundary), `preview-state.js` (the
pure last-valid-scene state machine — a failed newer render keeps the last good scene;
an older result never overrides a newer one), and `preview-scheduler.js` (a
clock-injected 700 ms debounce / coalescing coordinator, no real timer). Ordering is
by monotonic integers (`bufferVersion` per edit, `generation` per attempt) — never
timestamps. Size bands: auto-refresh ≤ **1 MiB**, manual Update above that, hard
refusal above **8 MiB** (refused, never truncated). 46 pure tests in
`test/preview/buffer-overlay.test.js`; wired into the `check` gate. See
`docs/PHASE_7C_PROPOSAL.md` §4–§10 and `docs/PREVIEW_ARCHITECTURE.md`.

**7C2 — Mall unsaved-buffer live preview ✅ built.** A split-view X_ITE preview of the
in-memory Mall editor buffer with **no temp file**. The renderer sends only
`{sessionId, text, bufferVersion}`; `src/preview/mall-preview-bridge.js` (pure/injectable,
`node:test`-able) resolves the editor session, confirms the held source **equals the
active authorized Mall item**, builds the `mallAuthorization` proof from *that* path, and
byte-substitutes the buffer through the 7C1 overlay (`editor:previewLoad`/`previewSaved`/
`previewAccept`/`previewClose` IPC). `renderer/editor-preview.js` + `editor.html`'s
`.preview-col` + draggable divider are the split-view (layout mode + split fraction
persisted; `Ctrl+Enter` Update, `Ctrl+Shift+Enter` maximize), **reusing `renderer/
preview.js` verbatim** (Original/Cybertown-Fit/guides/fit-report, remote-URL block) via an
injected source loader. Transport is direct string-swap with a `file://` base URL — **no
new scheme, no CSP origin** beyond the Mall X_ITE superset now on `editor.html`. Release
copy via `ui-state.js` `previewStatusModel` (Live / Updating… / Outdated / Showing last
good version / Showing saved version / Some parts missing / large-file / too-large). Auto
≤ 1 MiB (700 ms debounce, coalesced), manual Update 1–8 MiB, refused > 8 MiB. Last-valid
scene survives a temporary syntax error; older generations never replace newer; overlay +
generation counts are **0** after close (QA leak assertion). Nonvisual tests:
`test/preview/mall-preview-bridge.test.js` + `ui-state` preview models. Visual QA
`qa/phase-7c-mall-preview/` (`qa:mall-preview`): 18/18, 1 reused Electron process, 0
survivors, leak-clean; perf/stress `stress.js` (100 edits → 1 render). See
`docs/PREVIEW_ARCHITECTURE.md` §"Phase 7C2".

**7C3 — World unsaved-buffer live preview ✅ built.** The same split view previews an
unsaved **World** document — the primary or any authorized nested WRL — inside the
**full world scene**, no temp file, no new scheme. `src/preview/world-preview-bridge.js`
(pure/injectable, `node:test`-able) authorizes the held document against the **current
scan graph** (root match, graph membership, exact-case, realpath re-check), builds the
`worldAuthorization` proof, and installs the `wrlworld://` serving context; the shared
`editor:preview*` IPC routes by document context, and `editor:previewRescan` is the
explicit **Find new files** normal rescan (unsaved text never expands authorization —
new/missing/case/remote/unsafe buffer references are classified and surfaced only).
The unsaved **primary** is a string-swap with the primary's `wrlworld://` base; an
unsaved **nested** WRL substitutes inside `resolveWorldRequest` via an injectable
`overlayLookup` consulted only after root confinement + the allow-list (absent by
default → the workspace disk preview is byte-identical). `renderer/world-preview.js`
is reused verbatim (injected source) with opt-in viewpoint preservation (pure
`src/preview/viewpoint-preserve.js`: DEF → unique description → index → first →
default), navigation-mode restore, and X_ITE pre-validation of nested buffers (a
broken nested edit keeps the last good FULL scene). Saved fallback renders the whole
world from disk without dropping the unsaved overlay. Nonvisual tests:
`test/preview/world-preview-bridge.test.js`, `test/preview/viewpoint-preserve.test.js`,
`test/editor/script-load-order.test.js` (shared-scope co-load guard), `ui-state`
new-file chip model. Visual QA `qa/phase-7c-world-preview/` (`qa:world-preview`):
**22/22** outcome-gated states (incl. a 72-texture world, a nested gzip Inline, and
project-switch cleanup), 1 reused Electron process, 0 survivors, leak-clean; pure
perf/stress `stress.js` (coalescing, alternating document switches,
failed-then-repaired ordering, hash-verified no-write). Locked decisions carried
forward as implemented: 700 ms debounce, 50/50 default split, manual-only Find new
files, 1 MiB auto / 8 MiB hard bands, `Ctrl+Enter` / `Ctrl+Shift+Enter`, and the
split / preview-max / editor-only layouts. See `docs/PREVIEW_ARCHITECTURE.md`
§"Phase 7C3".

**7C5 — Cross-platform acceptance + private beta refresh ✅ complete.** The full 7C
feature set (vision accommodations, native editor, Mall + World unsaved-buffer
previews, last-valid/saved-version fallback, viewpoint & nav preservation, the
Windows-native QA harness) accepted on **both Linux and native Windows 11 Pro**
(libvirt/QEMU guest, local NTFS `C:\Projects\wrlforge`, driven headlessly over SSH).
567/567 tests + syntax gate on both OSes; Tier-1 packed self-test 55/55; all four
Windows GUI visual suites pass via a new **file-based capture transport** (see below);
`build:win` produces the unsigned portable + NSIS `1.3.0-beta.1`; full NSIS
install/uninstall lifecycle + VSCodium launch verified. Three acceptance-found defects
fixed (`f3107af` CRLF `.gitattributes`, `0a9eca8` Windows file transport, `84fdcea`
cross-platform `build:win`). Evidence: `qa/phase-7c5-cross-platform/`. The file
transport exists because a GUI-subsystem `electron.exe` on Windows has an
immediately-ended `process.stdin`, so the capture server reads jobs from
`WRL_FORGE_CAPTURE_JOBS_FILE` there (`qa/visual-qa/transport.js`); the POSIX stdin
path is unchanged.

### Phase 7D — Beta Polish
Keyboard accessibility, performance on large worlds, crash recovery, session
restoration, Windows + Linux verification (through the sanctioned VisualQaRunner —
no multi-process screenshot loops), and beta packaging.

## Deferred ⛔

Not scheduled into any phase above; requires explicit future direction before any design work begins:

- **Direct upload / authentication / server submission — will NOT be built** (locked product decision). Upload stays a manual Cybertown-website workflow.
- Upload-ready CTR packaging (gated on `docs/WORLD_PACKAGE_QUESTIONS.md`) — the World Project Bundle is review + manual hand-off only.
- Automatic destructive rewrites of user content (all mutation stays backup-first and, where relevant, preview-before-apply)
- Framework migration (e.g., introducing a UI framework/bundler to the renderer) — the current plain HTML/CSS/JS approach is intentional, see `AGENTS.md` Conventions
