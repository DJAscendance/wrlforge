# CLAUDE.md

This project is **WRL Forge** (formerly `vrmlpad`). See `AGENTS.md` for the full mission (including the three-profile model: Mall Item, World Project, Generic VRML97), architecture, conventions, and known gotchas — it applies equally here. See `docs/WRL_FORGE_ROADMAP.md` for the phased build-out plan and which phase is currently active.

A couple of Claude-specific notes on top of that:

- This is a tool-building project, not an item-authoring one. Don't pull in `../new-items/CLAUDE.md` conventions about VRML content itself (forbidden nodes, placement, etc.) except insofar as the Mall Item `validator.js` needs to check for them — this repo's job is the tool, not the mall items. Those conventions are Mall Item-specific; do not assume they apply to World Project or Generic VRML97 code.
- Before adding any dependency (editor component, 3D lib, UI framework), re-read the "Mission" section in `AGENTS.md`. For the current Mall Item lane, the default answer is that VSCodium + the installed X_ITE extensions already cover it. An embedded X_ITE preview is approved as a *future* phase (roadmap Phase 5) but is not a license to add rendering dependencies opportunistically in unrelated lanes — check the roadmap phase before building toward it.
- Don't rename internal symbols (IPC channel names, the `window.vrmlpad` bridge, variable names) purely for branding consistency with the new product name. `AGENTS.md` explains which ones were intentionally kept during the rename and why.
