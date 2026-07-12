# WRL Forge

> A modern VRML97 creation, inspection, validation, and packaging workbench for Cybertown items and worlds.

**Build. Preview. Validate. Package.**

WRL Forge is an Electron app for Linux. Today it covers the **Mall Item** lane: gzip-transparent editing of Cybertown Revival Mall `.wrl` files, with Cybertown Mall upload-rule validation, an **embedded X_ITE Mall Item Fit preview** (Original vs. Cybertown Fit modes, transform-aware bounds, placement guides — preview only), backup-before-overwrite repacking, and VSCodium (with the X_ITE extensions) as the external editor.

The Mall Item Fit preview shows the item's authoritative, transform-aware world-space bounds and a proposed non-destructive fit (scale/offset) against the Cybertown rules (ground `Y=-1.75`, center `X=0`, max `Z<=+1`, max `10×10×10`, requested `125%`). It is **preview only** — it never rewrites your file; Apply/Bake is not implemented. Gzip-compressed items are decompressed in the main process and only local (`file://`) textures load — remote (http/https) URLs are blocked. See `docs/PREVIEW_ARCHITECTURE.md`.

A read-only **World Project** lane is now available alongside Mall Item (open it with **Open World Project…**): point it at a world project folder (or a primary `.wrl`) and it resolves the full local asset graph — every referenced texture, nested `Inline` WRL, and URL asset — following gzip and plain `.wrl` at any nesting depth, with **no arbitrary texture limit** (real worlds reach ~70). It reports missing files, filename-case mismatches, unsafe/absolute/traversal paths, remote references (surfaced, never fetched), duplicate references, and dependency cycles, and never modifies a project file. It does **not** yet render a world preview (planned Phase 4B) or package/upload anything. See `docs/WORLD_PROJECT_ARCHITECTURE.md`.

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

Linux is the first supported platform and is tested thoroughly. Windows
support is planned in the near future — reusable core logic (paths, process
launching, project/validation/packaging code) is written to stay
cross-platform-conscious now rather than deferred to a rewrite. See
`docs/PLATFORM_NOTES.md` for platform-sensitive behavior and the current
test matrix.

## Credits

Inspired by the Cybertown tools, vehicles, and world-building work of scott99 (Mark), whose contributions helped keep VRML creation alive.
