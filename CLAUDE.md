# CLAUDE.md

This project is **WRL Forge** (formerly `vrmlpad`). See `AGENTS.md` for the full mission (including the three-profile model: Mall Item, World Project, Generic VRML97), architecture, conventions, and known gotchas — it applies equally here. See `docs/WRL_FORGE_ROADMAP.md` for the phased build-out plan and which phase is currently active.

A couple of Claude-specific notes on top of that:

- This is a tool-building project, not an item-authoring one. Don't pull in `../new-items/CLAUDE.md` conventions about VRML content itself (forbidden nodes, placement, etc.) except insofar as the Mall Item `validator.js` needs to check for them — this repo's job is the tool, not the mall items. Those conventions are Mall Item-specific; do not assume they apply to World Project or Generic VRML97 code.
- Before adding any dependency (editor component, 3D lib, UI framework), re-read the "Mission" section in `AGENTS.md`. The Mall Item lane now has an embedded X_ITE preview (Phase 2B1 — `x_ite` MIT is a root dependency; see `docs/PREVIEW_ARCHITECTURE.md`), but that is **not** a license to add rendering dependencies opportunistically in unrelated lanes: X_ITE is the only approved renderer, and the broader Phase 5 embedded preview (World Project / Generic VRML97) still needs its own approved lane. Do not build a custom VRML/X3D renderer. Shared preview/fit modules live in `src/preview/` — reuse them, don't duplicate.
- Don't rename internal symbols (IPC channel names, the `window.vrmlpad` bridge, variable names) purely for branding consistency with the new product name. `AGENTS.md` explains which ones were intentionally kept during the rename and why.
