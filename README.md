# WRL Forge

> A modern VRML97 creation, inspection, validation, and packaging workbench for Cybertown items and worlds.

**Build. Preview. Validate. Package.**

WRL Forge is an Electron app for Linux. Today it covers the **Mall Item** lane: gzip-transparent editing of Cybertown Revival Mall `.wrl` files, with Cybertown Mall upload-rule validation, an **embedded X_ITE Mall Item Fit preview** (Original vs. Cybertown Fit modes, transform-aware bounds, placement guides — preview only), backup-before-overwrite repacking, and VSCodium (with the X_ITE extensions) as the external editor.

The Mall Item Fit preview shows the item's authoritative, transform-aware world-space bounds and a proposed non-destructive fit (scale/offset) against the Cybertown rules (ground `Y=-1.75`, center `X=0`, max `Z<=+1`, max `10×10×10`, requested `125%`). It is **preview only** — it never rewrites your file; Apply/Bake is not implemented. Gzip-compressed items are decompressed in the main process and only local (`file://`) textures load — remote (http/https) URLs are blocked. See `docs/PREVIEW_ARCHITECTURE.md`.

A read-only **World Project** lane is now available alongside Mall Item (open it with **Open World Project…**): point it at a world project folder (or a primary `.wrl`) and it resolves the full local asset graph — every referenced texture, nested `Inline` WRL, and URL asset — following gzip and plain `.wrl` at any nesting depth, with **no arbitrary texture limit** (real worlds reach ~70). It reports missing files, filename-case mismatches, unsafe/absolute/traversal paths, remote references (surfaced, never fetched), duplicate references, and dependency cycles, and never modifies a project file.

The World Project lane now also has an **embedded X_ITE world preview** (Phase 4B): it renders the whole world — primary plus nested `Inline` (plain or gzip, at any depth), with each WRL resolving its relative textures from its **own** directory — with a viewpoint selector (including viewpoints authored inside nested Inlines), Reset View, navigation modes, and an explicit **Refresh Preview**. It is **read-only, local-only, and asset-graph-authorized**: X_ITE resolves every dependency through a confined `wrlworld://` scheme that serves only files the asset graph approved, gzip-decompressed, confined to the project root — missing, case-mismatched, remote, and unsafe references are surfaced but never loaded. A temporary parse error keeps the last valid scene (flagged stale) instead of clearing it. The world preview is **analysis + display only** — not an upload validator, packaging, or editor. See `docs/WORLD_PROJECT_ARCHITECTURE.md` and `docs/PREVIEW_ARCHITECTURE.md`.

The World Project lane now also has a **packaging audit + review bundle** (Phase 5A). A read-only **Package Audit** shows exactly what a portable bundle would contain — the primary WRL, nested local WRL, and referenced local assets, each with project-relative path, type, byte size, content hash, referencing files, and dependency depth — plus totals, missing/case/unsafe/remote/cycle/repeated findings, and any **unused** files under the project root (reported, never auto-included). **Build Review Bundle** is an explicit action that writes a **deterministic ZIP** (built with Node's `zlib` only — no third-party archive dependency) to a destination **outside** the project, containing the referenced files (byte-for-byte, structure preserved) plus a machine-readable `MANIFEST.json` and human-readable `REPORT.md`. Packaging is **blocked** when a required asset is missing, case-mismatched, absolute, escapes the root, or is remote; a dependency cycle is reported but does not block. It never repairs, renames, flattens, rewrites, or mutates the source, never overwrites an existing bundle, and is labelled **“Review Bundle — Not Confirmed for Direct Cybertown Upload.”** **Direct upload is not implemented** and no current-server compatibility is claimed — the open questions that gate a true upload-ready packager are in `docs/WORLD_PACKAGE_QUESTIONS.md`. See `docs/WORLD_PROJECT_ARCHITECTURE.md`.

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
validated for a private test build (Phase 6A): editor discovery is cross-platform
(Linux `codium`/`code`; Windows install-location search + `WRL_FORGE_EDITOR` /
`settings.json` override, with a clear "editor not found" message), filename-case
mismatches are caught even on case-insensitive Windows/macOS filesystems, and
paths/gzip/scanning/Review-Bundle/window-state were verified on real Windows 11.
See `docs/PLATFORM_NOTES.md` for platform-sensitive behavior and the test matrix.

### Windows test build (private, unsigned)

```
npm run build:win            # portable .exe + NSIS installer (x64), via electron-builder
npm run build:win:portable   # portable .exe only
```

Output lands in `release/` (git-ignored) as **Private Test Build — Unsigned**
artifacts. Because they are **unsigned**, Windows SmartScreen shows the normal
"Windows protected your PC" / unknown-publisher warning on first launch — click
**More info → Run anyway**. No code signing, auto-update, Microsoft Store, or
public release is configured. Building the Windows target from Linux needs `wine`.
See `docs/BUILD.md` for details and the dependency/license notes.

## Credits

Inspired by the Cybertown tools, vehicles, and world-building work of scott99 (Mark), whose contributions helped keep VRML creation alive.
