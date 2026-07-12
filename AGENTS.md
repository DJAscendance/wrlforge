# AGENTS.md

## Mission

**WRL Forge** — *Build. Preview. Validate. Package.*

WRL Forge is a modern VRML97 creation, inspection, validation, and packaging workbench, growing to serve three audiences:

1. **Cybertown Mall item creators** — the original and currently complete lane.
2. **Cybertown world builders** — planned. Worlds are a different shape of problem than items (many local textures, project folders, no 80KB cap) and must not inherit mall-item restrictions by default.
3. **General VRML97 users** — planned. Generic VRML97 inspection/preview with no Cybertown-specific validation unless a Cybertown profile is explicitly enabled.

The project was previously named `vrmlpad` and scoped narrowly to Cybertown Mall items. That narrow tool is the working foundation this expansion builds on — it is not being replaced or rewritten, it is being kept and grown into one profile of a larger workbench. See `docs/WRL_FORGE_ROADMAP.md` for the phased plan.

It does **not** implement its own text editor, syntax highlighter, or (today) a 3D renderer. VSCodium plus the `create3000.x-ite-vscode` / `create3000.x3d-vscode-syntax-highlighting` extensions (already installed) provide VRML97 syntax highlighting and live 3D preview (`X3D: Preview 3D Model`, `Ctrl+Alt+X`), and remain the current editor for all lanes. WRL Forge's job today is the two things those extensions can't do for Cybertown Mall items:

1. **Gzip transparency** — the mall's actual upload files are gzip-compressed `.wrl` (a real VRML text file inside, but the bytes on disk are binary). VSCodium can't usefully open that. WRL Forge decompresses to a plain sibling file for editing and recompresses on save.
2. **Cybertown Mall validation** — the upload rules from `../new-items/CLAUDE.md` (80KB gzip cap, required `WorldInfo`, forbidden nodes, texture rules, DEF/USE integrity, placement bounds) are mall-item-specific and not something a generic VRML/X3D extension checks. These rules apply to the **Mall Item** profile only — do not apply them to World Project or Generic VRML97 validation.

### Future direction: embedded preview

An embedded X_ITE preview is **approved for a future scoped phase** (see roadmap Phase 5) — this is no longer a permanent prohibition. When that phase happens: integrate X_ITE as the rendering engine (it is already maintained and used via the VSCodium extension), do not build a custom VRML/X3D renderer, and keep VSCodium available as an advanced "Open in Editor" action rather than removing it. Do not begin that work without a dedicated planning/approval pass — it is not in scope for incremental lanes unless explicitly requested.

### Unverified assumptions — do not encode as fact

- The old Cybertown item-upload web form limited items to 20 local textures. This may be a limitation of that specific web form, **not** a Cybertown server-side limit. World Projects must not inherit an arbitrary 20-texture cap; the actual limit (if any) needs to be determined (see roadmap Phase 3) before being enforced anywhere.
- Direct upload to any Cybertown server is **not yet approved** functionality. Do not build upload/auth integration without explicit direction.

## Long-term profile model

### Mall Item (current, working foundation)

- Open plain or gzip `.wrl`
- Create a plain `.edit.wrl` working copy
- Launch the external editor (VSCodium)
- Validate Cybertown Mall item rules
- Show Cybertown placement, offsets, scaling, and bounds (advisory today)
- Backup and repack
- Prepare final item packages and reports (future: roadmap Phase 6)

### World Project (planned, not yet implemented)

- Open a primary world `.wrl` or project folder
- Discover referenced textures and local VRML assets
- Support many local textures — no arbitrary 20-file UI limit
- Detect missing files, filename-case mismatches, external paths, and unused assets
- Preview the complete world
- Validate using a **world-specific** rules profile, separate from mall-item rules
- Prepare a deterministic submission package and report

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
- `preload.js` — contextBridge, exposes `window.vrmlpad.{openMall, openMallPath, check, repack, revealInFolder}` to the renderer. Keep `contextIsolation: true` / `nodeIntegration: false`; add new capabilities as new IPC handlers, not by relaxing this. This constraint applies to any future embedded X_ITE preview too — isolate it from privileged Electron APIs.
- `renderer/` — plain HTML/CSS/JS status panel (no framework, no bundler), currently the Mall Item lane's UI. Additional profiles (World Project, Generic VRML97) should get their own clearly-labeled views/panels rather than overloading this one, when that work begins.
- `validator.js` — pure function `validate(text) -> { results, ok, gzipBytes, rawBytes }`. No filesystem access. Mirrors the Mall Item rules in `../new-items/CLAUDE.md` and `../new-items/README.md`, generically rather than the hardcoded per-item logic in files like `../new-items/vette-blue/corvette-study/validate.py`. If the mall rules change, update both this file and the new-items docs together — they must not drift. **This file is Mall Item-specific**; a future World Project validator is a separate module, not an extension of this one.

### Rename note (vrmlpad → WRL Forge)

- `package.json` `name` changed from `vrmlpad` to `wrl-forge`. Electron derives `app.getPath('userData')` from this name by default, so the userData directory moved from `~/.config/vrmlpad` to `~/.config/wrl-forge`.
- `main.js` migrates window-state on first read: if no `window-state.json` exists at the new path, it falls back to the old `~/.config/vrmlpad/window-state.json` path before defaulting. This is read-only migration (it doesn't delete or move the old file); it's a small enough surface that a fuller migration system isn't warranted.
- The `mall:*` IPC channels and `window.vrmlpad` bridge name were deliberately **not** renamed in this lane — see Architecture above.

## Conventions

- Backups before any overwrite of a real mall `.wrl` — never repack without the `mall:repack` backup step. This non-destructive/backup-first convention is mandatory for every profile, not just Mall Item — World Project packaging must follow the same rule when it's built.
- `.edit.wrl` working copies are disposable/regenerable; don't treat them as the source of truth, the mall `.wrl` (or its most recent backup) is.
- No bundler, no framework dependency for the renderer — this app is intentionally small. If it starts needing state management or routing, that's a sign scope has crept beyond what's warranted and should be reconsidered, not just built out.
- Keep `validator.js` pure and dependency-free (only Node's built-in `zlib`) so it stays trivially testable and reusable outside Electron if needed later. Any future World Project / Generic VRML97 validator modules should follow the same pure-function, no-filesystem-access shape.
- Existing Mall Item functionality (gzip handling, `.edit.wrl` workflow, backup/repack, validation) must not regress as new profiles are added. Treat it as a contract, not a first draft to be casually altered.

## Workflow (Mall Item lane)

1. `npm start` (== `electron .`) launches the panel.
2. "Open mall .wrl…" → picks a file, writes `.edit.wrl`, launches VSCodium.
3. Edit in VSCodium; use `Ctrl+Shift+P` → `X3D: Preview 3D Model` for a live view.
4. WRL Forge re-validates automatically every few seconds; check the panel before repacking.
5. "Repack & Save to mall .wrl" backs up and writes the gzip mall file.

## Known gotchas (found during build/verification)

- GTK's file-open dialog does not reliably accept `Ctrl+L` + typed path + `Return` in this environment — typed text can land in the fuzzy-search box instead of the location bar. Navigating via the folder tree/breadcrumbs is reliable; keep that in mind if scripting or automating file selection.
- A file opened from an untrusted folder (e.g. `/tmp`) puts VSCodium in Restricted Mode, which disables the X_ITE preview extension with no obvious error — the `X3D: Preview 3D Model` command simply won't appear in the command palette. This is why `.edit.wrl` siblings are written next to the mall file inside the already-trusted `~/Projects/cybertown` tree rather than to a temp directory.
