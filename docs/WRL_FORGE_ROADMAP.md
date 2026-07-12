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

## Phase 1 — Product Rename and Profile Foundation 🚧 (this lane)

- Rename `vrmlpad` → **WRL Forge** across package metadata, branding, docs, and launchers
- Introduce the explicit three-profile model (Mall Item / World Project / Generic VRML97) in documentation
- Sketch a validation-profile architecture (separate validator modules per profile, no shared Cybertown-specific logic)
- **No major feature implementation** — this phase is naming and documentation only

**Prerequisites:** none beyond the Phase 0 foundation.

**Risks:**
- Electron's `userData` path is derived from `package.json` `name`; renaming it silently loses saved window state without a migration fallback. *(Mitigated: `main.js` falls back to the old `~/.config/vrmlpad` path — see AGENTS.md "Rename note".)*
- Over-renaming internal symbols (IPC channels, bridge object names) purely for cosmetic consistency adds risk without user-facing benefit. *(Mitigated: `mall:*` channels and `window.vrmlpad` were deliberately retained.)*

**Completion criteria:**
- All user-facing branding (window title, panel UI, desktop launcher, package description) reads "WRL Forge"
- Existing Mall Item functionality verified unregressed (open/edit/validate/repack/backup/window-state)
- `AGENTS.md`, `CLAUDE.md`, `README.md`, and this roadmap reflect the expanded mission

## Phase 2 — Mall Item Fit and Placement ⏳

- Cybertown bounds visualization (beyond the current advisory local-bbox text)
- Calculated offset and scale suggestions for placing items within mall bounds
- Clear separation of preview-only reporting versus any future apply-transform action
- Deterministic reporting format for placement checks

**Prerequisites:** Phase 1 complete.

**Risks:**
- Silent geometry mutation would violate the non-destructive convention — any transform suggestion must be preview-only unless a separate, explicit "apply" action is designed and approved.
- Placement math must account for `Transform` translation/scale chains, which the current advisory check explicitly does not do (see `validator.js` bbox note) — getting this wrong produces confidently-wrong advice.

**Completion criteria:**
- Placement report shows both raw local bounds and a best-effort mall-space bounds estimate
- No geometry is ever mutated without an explicit, separate user action
- Existing advisory placement check behavior is preserved for users who don't need the new detail

## Phase 3 — World Project Recon ⏳

- Collect known-good world `.wrl`/project samples for reference
- Document the current CTR (Cybertown Revival) world-submission workflow as it actually exists today
- Determine actual texture-count and package-size limits for worlds (do not assume the old web form's ~20-texture limit is a real server constraint)
- Inspect Scott99's `worlduploader`/`itemuploader` tools (https://www.3dgrove.com) as historical workflow references only — no code or asset copying without established licensing/permission
- Define a world-specific validation rules profile, kept separate from `validator.js`'s Mall Item rules

**Prerequisites:** access to real-world sample files and/or documentation of the current submission process; Phase 1 complete.

**Risks:**
- Acting on assumed limits (e.g., encoding "20 textures" as a hard rule) would produce false validation failures for legitimate worlds.
- Reverse-engineering Scott99's tools beyond "workflow reference" risks license/IP issues — treat as read-only research, not a source to copy from.

**Completion criteria:**
- A documented (not yet enforced) world validation rule set, with each rule traceable to an actual confirmed constraint rather than an assumption
- Open questions about real server limits explicitly flagged as unresolved, not silently guessed

## Phase 4 — World Asset Resolver ⏳

- Open a project folder (not just a single file)
- Parse local URL references across the primary world file and any referenced VRML/Inline assets
- Discover textures and nested local assets, however many there are — no arbitrary local 20-texture limit
- Missing-file and filename-case mismatch diagnostics (case-sensitivity matters when the target server's filesystem is case-sensitive even if the author's isn't)
- Report of referenced-but-unused and used-but-missing assets

**Prerequisites:** Phase 3's world rules profile, at least in draft form.

**Risks:**
- Recursive/inline asset graphs could be large or cyclic — needs bounded traversal, not an assumption of a small flat file list.
- Case-mismatch detection needs to be genuinely cross-platform-aware (the author's Linux filesystem is case-sensitive; a naive dev might not think to check).

**Completion criteria:**
- Given a real multi-texture world project, the resolver correctly enumerates all referenced local assets and correctly flags at least one deliberately-broken reference (missing file, case mismatch) in a test fixture

## Phase 5 — Embedded X_ITE Preview ⏳

- Integrate X_ITE as WRL Forge's embedded rendering engine — do not build a custom VRML/X3D renderer
- Isolate the preview from privileged Electron APIs (same `contextIsolation`/`nodeIntegration` discipline as the rest of the app; the preview surface should not gain filesystem/IPC access beyond what it needs to load local assets)
- Preserve the external VSCodium workflow — "Open in Editor" remains available as an advanced action, it is not replaced
- Support both Mall Item and World Project contexts

**Prerequisites:** Phases 2 and 4 (placement math and asset resolution) provide the data the preview needs to be useful, though the embedded viewer itself could technically start earlier if scoped narrowly.

**Risks:**
- This is the highest-blast-radius phase — it's the one place a dependency (X_ITE, however it's integrated: bundled lib, iframe, etc.) enters the Electron app directly instead of running inside VSCodium's own extension host.
- Privilege isolation mistakes here are the most likely way this app could regress from "small companion tool" to "large surface area to secure."

**Completion criteria:**
- Preview renders a real mall item and a real world sample correctly
- Security review confirms the preview surface has no more Electron privilege than it needs
- VSCodium-based editing/preview workflow still works unchanged for users who prefer it

## Phase 6 — Packaging ⏳

- Deterministic Mall Item package output
- Deterministic World Project package output
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
