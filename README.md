# WRL Forge

> A modern VRML97 creation, inspection, validation, and packaging workbench for Cybertown items and worlds.

**Build. Preview. Validate. Package.**

WRL Forge is an Electron app for Linux. Today it covers the **Mall Item** lane: gzip-transparent editing of Cybertown Revival Mall `.wrl` files, with Cybertown Mall upload-rule validation, an **embedded X_ITE Mall Item Fit preview** (Original vs. Cybertown Fit modes, transform-aware bounds, placement guides — preview only), and backup-before-overwrite repacking. An external editor (VSCodium, with the X_ITE extensions) is supported as an **optional** integration. A **native WRL editor** (Phase 7B) now ships so the app works on its own: a CodeMirror 6 workspace (opened from either lane) with VRML97 syntax highlighting, parser diagnostics, an AST outline, dirty tracking, a conservative safe save (verify-before-commit + timestamped backup + atomic rename), external-change conflict handling, gzip-transparent editing of plain **and** gzip `.wrl`, and five themes (Dark/Light/Terminal/Tokyo Night/High Contrast). It is driven by the built-in Phase 7A VRML97 parser (no second grammar) — see `docs/NATIVE_EDITOR_ARCHITECTURE.md`.

**Vision accommodations** are built in for low-vision users: a single **zoom** control (the toolbar `−`/`+`/Reset group or **Ctrl `+` / `-` / `0`**) enlarges the code **and** the whole interface together, the level is remembered between sessions, and a **High Contrast** theme (pure-black background, bright tokens) is one of the five themes.

The Mall Item Fit preview shows the item's authoritative, transform-aware world-space bounds and a proposed non-destructive fit (scale/offset) against the Cybertown rules (ground `Y=-1.75`, center `X=0`, max `Z<=+1`, max `10×10×10`, requested `125%`). It is **preview only** — it never rewrites your file; Apply/Bake is not implemented. Gzip-compressed items are decompressed in the main process and only local (`file://`) textures load — remote (http/https) URLs are blocked. See `docs/PREVIEW_ARCHITECTURE.md`.

A read-only **World Project** lane is now available alongside Mall Item (open it with **Open World Project…**): point it at a world project folder (or a primary `.wrl`) and it resolves the full local asset graph — every referenced texture, nested `Inline` WRL, and URL asset — following gzip and plain `.wrl` at any nesting depth, with **no arbitrary texture limit** (real worlds reach ~70). It reports missing files, filename-case mismatches, unsafe/absolute/traversal paths, remote references (surfaced, never fetched), duplicate references, and dependency cycles, and never modifies a project file.

The World Project lane now also has an **embedded X_ITE world preview** (Phase 4B): it renders the whole world — primary plus nested `Inline` (plain or gzip, at any depth), with each WRL resolving its relative textures from its **own** directory — with a viewpoint selector (including viewpoints authored inside nested Inlines), Reset View, navigation modes, and an explicit **Refresh Preview**. It is **read-only, local-only, and asset-graph-authorized**: X_ITE resolves every dependency through a confined `wrlworld://` scheme that serves only files the asset graph approved, gzip-decompressed, confined to the project root — missing, case-mismatched, remote, and unsafe references are surfaced but never loaded. A temporary parse error keeps the last valid scene (flagged stale) instead of clearing it. The world preview is **analysis + display only** — not an upload validator, packaging, or editor. See `docs/WORLD_PROJECT_ARCHITECTURE.md` and `docs/PREVIEW_ARCHITECTURE.md`.

The World Project lane now also has a **packaging audit + World Project Bundle** (Phase 5A). A read-only **Package Audit** shows exactly what a portable bundle would contain — the primary WRL, nested local WRL, and referenced local assets, each with project-relative path, type, byte size, content hash, referencing files, and dependency depth — plus totals, missing/case/unsafe/remote/cycle/repeated findings, and any **unused** files under the project root (reported, never auto-included). **Build World Project Bundle** is an explicit action that writes a **deterministic ZIP** (built with Node's `zlib` only — no third-party archive dependency) to a destination **outside** the project, containing the referenced files (byte-for-byte, structure preserved) plus a machine-readable `MANIFEST.json` and human-readable `REPORT.md`. Packaging is **blocked** when a required asset is missing, case-mismatched, absolute, escapes the root, or is remote; a dependency cycle is reported but does not block. It never repairs, renames, flattens, rewrites, or mutates the source, and never overwrites an existing bundle. The output is labelled **“WRL Forge World Project Bundle”** — a review + hand-off package that helps you inspect a world and prepare its files for **manual upload through the Cybertown website**. WRL Forge does not upload anything and by design never will (a locked product decision); it is not a server-certified upload format, and the exact CTR submission requirements are tracked as open questions in `docs/WORLD_PACKAGE_QUESTIONS.md`. See `docs/WORLD_PROJECT_ARCHITECTURE.md`.

The **Generic VRML97** lane is still planned.

```
npm start
```

Testing:

```
npm test    # node:test suite
npm run check   # full noninteractive gate: tests + syntax checks
```

See `AGENTS.md` for the full mission, architecture, and conventions, and `docs/WRL_FORGE_ROADMAP.md` for the phased plan.

## Platform

Linux is the first supported platform and is tested thoroughly. **Windows** is now
a **private beta** (Phase 6B, `1.1.0-beta.1`). Editor discovery is cross-platform
(Linux `codium`/`code`; Windows install-location search + `WRL_FORGE_EDITOR` /
`settings.json` override, with a clear "editor not found" message), filename-case
mismatches are caught even on case-insensitive Windows/macOS filesystems, and the
real GUI workflows were driven end-to-end on Windows 11: native file/folder
dialogs, the **X_ITE Mall + World preview render**, `.edit.wrl` generation, Package
Audit + World Project Bundle (ZIP hashes verified), NSIS install → Start-menu launch →
uninstall, and window-state persistence — plus a committed **37/37** packaged-
runtime self-test. The optional **VSCodium "Open in External Editor" launch is
verified on Windows 11** (Phase 6B1): real VSCodium auto-discovered and launched on a space/non-ASCII
`.edit.wrl`, both overrides + invalid-override fallback, single instance, clean
exit, sources unmutated (13/13, `qa/phase-6b1-vscodium/RESULTS.md`). See
`docs/PLATFORM_NOTES.md` for the platform-sensitive behavior and test matrix,
`qa/phase-6b-windows/RESULTS.md` for the beta evidence, and
`docs/BETA_RELEASE_NOTES.md` for install/testing instructions.

### Windows beta build (private, unsigned)

```
npm run build:win            # portable .exe + NSIS installer (x64), via electron-builder
npm run build:win:portable   # portable .exe only
```

Output lands in `release/` (git-ignored) as **Private Beta — Unsigned** artifacts
(`WRL Forge-1.2.0-beta.1-x64-PrivateBeta-Unsigned-*.exe` + `SHA256SUMS`). Because
they are **unsigned**, Windows SmartScreen shows the normal "Windows protected your
PC" / unknown-publisher warning on first launch — click **More info → Run anyway**
(signing does **not** eliminate this — see `docs/SIGNING_READINESS.md`). No code
signing, auto-update, Microsoft Store, or public release is configured; **Windows
ARM64 is unsupported**. World Project Bundles are for review + **manual upload
through the Cybertown website** (not a server-certified upload format; WRL Forge
performs no direct upload). Building the Windows target from Linux needs `wine`. See
`docs/BUILD.md` for details and the dependency/license notes.

## Inspiration and Acknowledgments

WRL Forge is inspired by the builders, creators, coders, and community members who helped make Cybertown such a memorable place and kept its creative spirit alive.

Special thanks to **Morning.star**, **scott99 (Mark)**, **LSS**, **Wovencroft**, **GeordieJohn**, and the many other world builders, ComTech members, coders, and friends I met along the way.

Their worlds, vehicles, tools, experiments, knowledge, and willingness to help others all contributed to the inspiration behind WRL Forge.

This project is an independent continuation of that creative spirit and is not presented as the work of, or officially endorsed by, the people named above.
