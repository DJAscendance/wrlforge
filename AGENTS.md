# AGENTS.md

## Mission

**WRL Forge** — *Build. Preview. Validate. Package.*

WRL Forge is a modern VRML97 creation, inspection, validation, and packaging workbench, growing to serve three audiences:

1. **Cybertown Mall item creators** — the original and currently complete lane.
2. **Cybertown world builders** — planned. Worlds are a different shape of problem than items (many local textures, project folders, no 80KB cap) and must not inherit mall-item restrictions by default.
3. **General VRML97 users** — planned. Generic VRML97 inspection/preview with no Cybertown-specific validation unless a Cybertown profile is explicitly enabled.

The project was previously named `vrmlpad` and scoped narrowly to Cybertown Mall items. That narrow tool is the working foundation this expansion builds on — it is not being replaced or rewritten, it is being kept and grown into one profile of a larger workbench. See `docs/WRL_FORGE_ROADMAP.md` for the phased plan.

It does not yet implement its own text editor or syntax highlighter, and (today) no 3D renderer. An **optional** external editor — VSCodium plus the `create3000.x-ite-vscode` / `create3000.x3d-vscode-syntax-highlighting` extensions — provides VRML97 syntax highlighting and live 3D preview (`X3D: Preview 3D Model`, `Ctrl+Alt+X`) when installed. A **native WRL editor + a real VRML97 parser are now a planned beta requirement (Phase 7)** so the app works without any external editor; VSCodium is an integration, not a dependency. See `docs/NATIVE_EDITOR_ARCHITECTURE.md`. WRL Forge's job today is the two things a generic editor can't do for Cybertown Mall items:

1. **Gzip transparency** — the mall's actual upload files are gzip-compressed `.wrl` (a real VRML text file inside, but the bytes on disk are binary). VSCodium can't usefully open that. WRL Forge decompresses to a plain sibling file for editing and recompresses on save.
2. **Cybertown Mall validation** — the upload rules from `../new-items/CLAUDE.md` (80KB gzip cap, required `WorldInfo`, forbidden nodes, texture rules, DEF/USE integrity, placement bounds) are mall-item-specific and not something a generic VRML/X3D extension checks. These rules apply to the **Mall Item** profile only — do not apply them to World Project or Generic VRML97 validation.

### Platform

Linux is the first supported platform and must be thoroughly tested — every lane's validation happens on Linux first. **Windows** now has a validated **private, unsigned test build** (Phase 6A): editor discovery is cross-platform (`src/editor/editor-locator.js` — Linux `codium`/`code`, Windows install-location search + `WRL_FORGE_EDITOR`/`settings.json` override, clear not-found message), filename-case detection works on case-insensitive filesystems (the directory listing, not `existsSync`, is authoritative), and the app is packaged with `electron-builder` (MIT; portable `.exe` + NSIS installer, `npm run build:win`, needs `wine` from Linux). Keep reusable core logic cross-platform-conscious (use `path.join`, no hardcoded separators or `/home/<user>` paths). Do not delay Linux work to speculatively build Windows support first. See `docs/PLATFORM_NOTES.md` and `docs/BUILD.md` for platform-sensitive behavior, the Windows test matrix, and build instructions.

### Open-source components

Prefer open-source components; the current stack is:

- **Electron** — application shell.
- **VSCodium** — **optional** external editor (not bundled; the user's existing installation, with the `create3000.x-ite-vscode` / `create3000.x3d-vscode-syntax-highlighting` extensions). Optional, not required — a native editor is planned for Phase 7.
- **X_ITE** (MIT) — the approved VRML/X3D rendering and preview engine, both for VSCodium's live-preview extension today and for the embedded-preview direction below. See `spikes/xite-mall-fit/` for the Phase 2A technical spike and `spikes/xite-mall-fit/NOTES.md` for what was verified about its API.
- **Node.js built-ins** — `zlib`, `fs`, `path`, `child_process`, `node:test` — preferred over adding a dependency where they suffice (e.g. no external test framework; see `package.json`'s `test`/`check` scripts).

Do not build a custom VRML/X3D renderer under any circumstances — X_ITE is the approved engine for that.

### Embedded preview status

An embedded X_ITE preview now ships for the **Mall Item** lane (Phase 2B1) **and** the **World Project** lane (Phase 4B): `x_ite` (MIT, v15.1.10) is a root dependency loaded locally (never a CDN), integrated per the isolation discipline below. The **optional** external editor stays available ("Open in External Editor"; a Mall item still auto-launches it on open when one is installed, but opening never *requires* an editor and never surfaces an "editor not found" message unless the user requests the external-editor action) — the embedded previews did not replace it, and a native editor is planned for Phase 7. The two previews are **separate profiles**: the Mall Item preview (`renderer/preview.js`) does Original/Cybertown Fit with placement bounds; the World Project preview (`renderer/world-preview.js`, Phase 4B) renders a whole world (nested Inline, gzip, ≥70 textures) with **no** Mall placement/fit/cap rules, routing every dependency through a confined, asset-graph-authorized `wrlworld://` scheme (see `docs/PREVIEW_ARCHITECTURE.md` / `docs/WORLD_PROJECT_ARCHITECTURE.md`). The **Generic VRML97** embedded preview (**Phase 5**) is still a separate future phase requiring its own approval; shipping the World preview does not license opportunistic X_ITE integration into the Generic lane. Do not build a custom VRML/X3D renderer under any circumstances — X_ITE is the approved engine. Shared preview/fit modules live in `src/preview/`; the World preview reuses the shared gzip reader but **not** the Mall fit/guide math.

A narrowly-scoped **technical spike** at `spikes/xite-mall-fit/` (Phase 2A) is a deliberate exception to "don't begin that work without approval" — it was explicitly commissioned to de-risk Phase 5/2B by proving out X_ITE's bounding-box behavior and a preview-only fit calculation, in complete isolation from the production app (its own Electron main process, no shared IPC surface, no production code path touches it). It does **not** constitute the "dedicated planning/approval pass" Phase 5 itself still requires, and does not license further opportunistic X_ITE integration into `main.js`/`renderer/` outside of an explicitly approved lane.

### Unverified assumptions — do not encode as fact

- The old Cybertown item-upload web form limited items to 20 local textures. This may be a limitation of that specific web form, **not** a Cybertown server-side limit. World Projects must not inherit an arbitrary 20-texture cap; the actual limit (if any) needs to be determined (see roadmap Phase 3) before being enforced anywhere.
- Direct upload to any Cybertown server **will not be built** (locked product decision, 2026-07-12). WRL Forge adds no upload/auth/networking code; users upload by hand through the Cybertown Mall / website. Do not present the absence of direct upload as a missing or roadmap feature.

## Long-term profile model

### Mall Item (current, working foundation)

- Open plain or gzip `.wrl`
- Create a plain `.edit.wrl` working copy
- Optionally launch an external editor (VSCodium), if one is installed (native editor planned, Phase 7)
- Validate Cybertown Mall item rules
- Show Cybertown placement, offsets, scaling, and bounds (advisory today)
- Backup and repack
- Prepare final item packages and reports (future: roadmap Phase 6)

### World Project (read-only resolver + workspace + preview + packaging audit shipped — Phase 4A/4B/5A)

A read-only asset resolver and workspace now ships (`src/world-project/`,
`renderer/world.html`, confined `world:*` IPC). It can:

- Open a primary world `.wrl`/`.wrz` **or** a project folder (with primary-file
  detection; ambiguity is surfaced, never guessed)
- Discover referenced textures and local VRML assets across nested `Inline` WRL
  (gzip and plain, bounded + cycle-safe), with **no arbitrary texture limit**
- Detect missing files, filename-case mismatches, absolute/traversal (unsafe)
  paths, remote references (surfaced, never fetched), duplicates, and cycles
- Report via a world-specific profile (`src/world-project/profile.js`) that is
  **structurally separate** from `validator.js` — none of the Mall Item rules
  apply, and historical figures (the ~20-texture web-form limit) are never
  presented as current server rules (confidence-tagged findings)

- **Preview** the whole world in an embedded X_ITE canvas (Phase 4B): primary +
  nested `Inline` (plain/gzip, any depth), each WRL resolving relatives from its
  **own** directory, ≥70 textures, viewpoint discovery/selection (incl. nested
  Inlines), Reset View, navigation modes, explicit Refresh, stale/last-valid-scene
  on a temporary parse error. It routes every dependency through a confined
  `wrlworld://` scheme served **only** from the asset-graph allow-list (readable
  WRL + present exact-case assets), gzip-decompressed, confined to the project
  root. Missing/case/remote/unsafe refs are surfaced but never loaded; inline
  scripts never run. It is a **separate profile** — no Mall fit/placement/cap
  rules — and is **analysis + display only** (never marks a project upload-ready).

- **Audit + package** the project into a portable **WRL Forge World Project Bundle**
  (Phase 5A): `src/world-project/package-plan.js` derives a **deterministic** plan
  (packaged file set = primary + nested local WRL + present approved assets, each with
  project-relative path / type / bytes / sha256 / referencing WRL / depth; totals;
  missing/case/unsafe/remote/cycle/repeated findings; **unused** files reported but
  never auto-included). **Build World Project Bundle** (the one explicit write action)
  writes a deterministic ZIP (`zip-writer.js`, Node `zlib` only — **no** archive
  dependency) via `bundle-builder.js` to a destination **outside** the project,
  containing `project/<relpath>` (byte-for-byte), `MANIFEST.json`, `REPORT.md`, and
  the `WRL Forge World Project Bundle` label. Blocking rules: missing/case/absolute/
  traversal/remote/unreadable block; cycles don't. It refuses blocked/in-project/
  overwrite and re-hashes every file against the manifest. It is a **review + manual
  hand-off bundle** — the user uploads it by hand through the Cybertown website;
  WRL Forge performs **no direct upload** and claims no server-certified format
  (open questions in `docs/WORLD_PACKAGE_QUESTIONS.md`).

**Will not be built** (locked product decision): **direct upload**, authentication,
networking/submission code. **Not** implemented and each its own future approved
lane: automatic path repair, copy, rename, delete, Apply/Bake. The **VRML97 parser**
foundation is now **built** (Phase 7A) — a dependency-free, token-driven tokenizer +
structural parser under `src/vrml/` (see `docs/VRML_PARSER.md`) that ships
*alongside* existing systems and changes none of them; it is not yet wired into any
production path. The **native editor** on top of it remains a planned beta
requirement (Phase 7B, see `docs/NATIVE_EDITOR_ARCHITECTURE.md`). Everything except the single Build-World-
Project-Bundle action is read-only; that action writes only a portable bundle to a
caller-chosen destination and never mutates the source project. See
`docs/WORLD_PROJECT_ARCHITECTURE.md` and `docs/WORLD_PACKAGE_QUESTIONS.md`.

### Generic VRML97 (planned, not yet implemented)

- Open plain or gzip VRML97
- Inspect syntax and structure
- Resolve local assets
- Preview and report scene information
- Apply **no** Cybertown-specific validation unless the user opts into a Cybertown profile

Do not copy Mall Item validation rules into World Project or Generic VRML97 code paths as though they universally apply — each profile gets its own validator, sharing only genuinely generic infrastructure (gzip handling, file I/O, asset parsing primitives).

## Architecture

- `main.js` — Electron main process. Owns all filesystem/IPC logic:
  - `isGzip()` sniffs the gzip magic bytes (`1f 8b`) — file identity is by content, not extension. A `.wrl` on disk may be gzip or plain text; both are valid mall artifacts at different pipeline stages.
  - `editPathFor()` derives the plain working-copy path: `<name>.wrl` → `<name>.edit.wrl`, written next to the mall file so it inherits VSCodium's workspace trust for `~/Projects/cybertown` (untrusted folders run extensions in Restricted Mode, which silently disables 3D preview — always keep edit files inside a trusted tree).
  - `openMallFile()` — decompress-if-needed, write `.edit.wrl`, `spawn('codium', [editFile], { detached: true })`.
  - `mall:check` — re-validate the current `.edit.wrl` on demand (polled every 3s by the renderer while a file is open).
  - `mall:repack` — backup the existing mall file (`<name>.wrl.bak-<timestamp>`), then write the edited text back, gzip by default.
  - `loadWindowState()` / `saveWindowState()` — window position/size persistence, with a fallback that reads the pre-rename `vrmlpad` userData directory if the new `wrl-forge` one has no saved state yet (see "Rename note" below).
  - The `mall:*` IPC channel names and the `window.vrmlpad` bridge object name are retained from the pre-rename codebase. They are internal symbols, not user-facing branding — do not rename them purely for cosmetic consistency; only rename when a real World Project / Generic VRML97 IPC surface is added alongside them.
- `preload.js` — contextBridge, exposes `window.vrmlpad.{openMall, openMallPath, check, repack, revealInFolder, loadPreview, openInEditor}` to the renderer. Keep `contextIsolation: true` / `nodeIntegration: false`; add new capabilities as new IPC handlers, not by relaxing this. This constraint applies to the embedded X_ITE preview too — it is isolated from privileged Electron APIs.
- `src/preview/` — shared preview/fit modules (Phase 2B1), single source of truth reused by both the production app and the isolated spike (no duplicate implementations): `fit-math.js`, `extrusion-bounds.js`, `bbox-traversal.js` (browser-only), `guides.js`, `texture-base.js`, `wrl-source.js` (main-process), `url-policy.js`. Pure/browser modules keep no Electron/fs dependency so they are `node:test`-able; only `wrl-source.js` touches the filesystem and runs in the main process. See `docs/PREVIEW_ARCHITECTURE.md`.
- `src/editor/editor-locator.js` (Phase 6A) — cross-platform external-editor discovery (pure/injectable: `platform`/`env`/`existsSync` injected). `resolveEditor` (Linux `codium`/`code` on PATH; Windows VSCodium/VS Code install-location search + PATH shims; `WRL_FORGE_EDITOR`/settings override) + `buildLaunch` (spaces/non-ASCII-safe spawn args; `.cmd` shims via the shell with both command and file double-quoted). `main.js`'s `launchEditor` uses it and returns a structured `{ launched, reason, hint }` so the renderer can show a clear "editor not found" message. `src/settings/app-settings.js` (Phase 6A) — read-only `settings.json` under userData (today just `editorCommand`). Both `node:test`-covered for Linux **and** Windows via injected platform/env (`test/editor/`, `test/settings/`).
- `main.js` preview surface (Phase 2B1) — a **read-only** `preview:load` IPC (role `'source'`/`'edit'`, never a renderer-supplied path; gzip decompressed in main so X_ITE only sees plain text), an `mall:openInEditor` re-launch action, and a `session.webRequest` network guard that cancels every remote request (`url-policy.isBlockedPreviewUrl`). There is **no** write-capable preview channel.
- `renderer/` — plain HTML/CSS/JS (no framework, no bundler). `index.html` + `renderer.js` are the Mall Item lane's UI; `renderer/preview.js` owns the embedded X_ITE preview (Original/Cybertown Fit modes, guide toggles, refresh) and the fit report. `index.html` carries a strict CSP (no remote origin). The Fit mode transform and guides are **preview-only** — never written to any file. `world.html` + `world.js` are the **World Project** lane's separate workspace (Phase 4A): a read-only asset table / dependency view over the resolved graph, sharing the one BrowserWindow + preload (so it gets the same `window.vrmlpad` bridge, plus `window.vrmlpad.world.*`). As of Phase 4B it also loads X_ITE and `renderer/world-preview.js` (a **separate** controller from `renderer/preview.js` — no Mall fit/guide/placement logic), so its CSP now permits X_ITE's LOCAL needs only (`'wasm-unsafe-eval'`, `blob:` workers, and the LOCAL `wrlworld:` scheme in `img/media/connect-src`), still with no remote origin. Phase 5A adds `renderer/world-packaging.js` (packaging section: status badge / totals / blocking / unused list / manifest preview / output location / a read-only Package Audit + an explicit Build World Project Bundle button). Navigation between the two pages is main-controlled (`app:goto`, whitelisted). Each new profile gets its own clearly-labeled page rather than overloading another.
- `src/world-project/` — the **World Project** profile (Phase 4A): the promoted, production home of the Phase 3A recon logic. Pure/injectable modules (`url-fields`, `path-policy`, `image-size`, `asset-graph`, `profile`, `project-stats`, `session`) plus the one main-process fs module (`project-loader`), and (Phase 4B) `preview-source` (read-authorization + serving for the embedded preview: `wrlworld://` URL builders, `buildAuthorizedSet`, `resolveWorldRequest`, `buildPreviewPayload`; fs injectable, unit-tested without Electron), and (Phase 5A) the packaging trio: `package-plan` (deterministic plan + manifest + report, injectable), `zip-writer` (deterministic ZIP on Node `zlib` only — **no** third-party archive dependency), and `bundle-builder` (the one file-writing module; blocked/in-project/overwrite refusals + re-hash-vs-manifest). `qa/world-recon/*` re-export the resolver (single source of truth). **Separate from `validator.js`** — no Mall Item rule is applied to a World Project. Read-only except the single explicit review-bundle write.
- `main.js` World Project surface (Phase 4A/4B/5A) — confined `world:*` IPC (`openFolder`/`openPrimaryFile`/`choosePrimary`/`scan`/`refresh`/`describe`/`reveal`/`revealRoot`/`openPrimaryInEditor`, plus Phase 4B `previewLoad`, plus Phase 5A read-only `packageAudit` and the one explicit write action `buildReviewBundle`). The main process owns every project path (held in a `ProjectSession`); the renderer can only pick among detected candidates and never supplies a path. `buildReviewBundle` prompts a main-process Save dialog (default OUTSIDE the project) and refuses blocked/in-project/overwrite. Phase 4B registers a privileged, standard, LOCAL-only `wrlworld://` scheme (`registerSchemesAsPrivileged` before app-ready; `protocol.handle` in `whenReady`) whose handler serves only asset-graph-authorized files confined to the project root — X_ITE's world dependencies never touch `file://` or the network. The capture-server (`WRL_FORGE_CAPTURE_SERVER`) `world` job gained a `preview` flag (+ `viewpoint`, + temp-dir-confined QA-only `writePrimary`) and Phase 5A `packageAudit` / temp-dir-confined QA-only `buildBundle` flags, so the preview + packaging states screenshot through the same single reused Electron process (see `docs/VISUAL_QA_SAFETY.md`).
- `validator.js` — pure function `validate(text) -> { results, ok, gzipBytes, rawBytes }`. No filesystem access. Mirrors the Mall Item rules in `../new-items/CLAUDE.md` and `../new-items/README.md`, generically rather than the hardcoded per-item logic in files like `../new-items/vette-blue/corvette-study/validate.py`. If the mall rules change, update both this file and the new-items docs together — they must not drift. **This file is Mall Item-specific**; a future World Project validator is a separate module, not an extension of this one.

### Rename note (vrmlpad → WRL Forge)

- `package.json` `name` changed from `vrmlpad` to `wrl-forge`. Electron derives `app.getPath('userData')` from this name by default, so the userData directory moved from `~/.config/vrmlpad` to `~/.config/wrl-forge`.
- `main.js` migrates window-state on first read: if no `window-state.json` exists at the new path, it falls back to the old `~/.config/vrmlpad/window-state.json` path before defaulting. This is read-only migration (it doesn't delete or move the old file); it's a small enough surface that a fuller migration system isn't warranted.
- The `mall:*` IPC channels and `window.vrmlpad` bridge name were deliberately **not** renamed in this lane — see Architecture above.

## Conventions

- Backups before any overwrite of a real mall `.wrl` — never repack without the `mall:repack` backup step. This non-destructive/backup-first convention is mandatory for every profile, not just Mall Item. World Project packaging (Phase 5A) honours it by never mutating the source at all: it only ever writes a *new* World Project Bundle to a destination outside the project, refuses to overwrite an existing bundle, and refuses to write inside the project root.
- `.edit.wrl` working copies are disposable/regenerable; don't treat them as the source of truth, the mall `.wrl` (or its most recent backup) is.
- No bundler, no framework dependency for the renderer — this app is intentionally small. If it starts needing state management or routing, that's a sign scope has crept beyond what's warranted and should be reconsidered, not just built out.
- Keep `validator.js` pure and dependency-free (only Node's built-in `zlib`) so it stays trivially testable and reusable outside Electron if needed later. Any future World Project / Generic VRML97 validator modules should follow the same pure-function, no-filesystem-access shape.
- Existing Mall Item functionality (gzip handling, `.edit.wrl` workflow, backup/repack, validation) must not regress as new profiles are added. Treat it as a contract, not a first draft to be casually altered.

## Workflow (Mall Item lane)

1. `npm start` (== `electron .`) launches the panel.
2. "Open mall .wrl…" → picks a file, writes `.edit.wrl`, launches VSCodium, and loads the item into the embedded preview.
3. Edit the working copy (in a native editor when available, or click "Open in External Editor" to use VSCodium if installed); the embedded preview shows **Original** and **Cybertown Fit** modes with transform-aware bounds and placement guides. Click "Refresh Preview" after external edits.
4. WRL Forge re-validates automatically every few seconds; check the panel and fit report before repacking. The Fit preview is **display-only** — it never rewrites your file (Apply/Bake is not implemented).
5. "Repack & Save to mall .wrl" backs up and writes the gzip mall file — the actual `.edit.wrl` text, never a preview-fitted transform.

## Known gotchas (found during build/verification)

- GTK's file-open dialog does not reliably accept `Ctrl+L` + typed path + `Return` in this environment — typed text can land in the fuzzy-search box instead of the location bar. Navigating via the folder tree/breadcrumbs is reliable; keep that in mind if scripting or automating file selection.
- A file opened from an untrusted folder (e.g. `/tmp`) puts VSCodium in Restricted Mode, which disables the X_ITE preview extension with no obvious error — the `X3D: Preview 3D Model` command simply won't appear in the command palette. This is why `.edit.wrl` siblings are written next to the mall file inside the already-trusted `~/Projects/cybertown` tree rather than to a temp directory.
