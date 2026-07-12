# WRL Forge

> A modern VRML97 creation, inspection, validation, and packaging workbench for Cybertown items and worlds.

**Build. Preview. Validate. Package.**

WRL Forge is an Electron app for Linux. Today it covers the **Mall Item** lane: gzip-transparent editing of Cybertown Revival Mall `.wrl` files, with Cybertown Mall upload-rule validation, backup-before-overwrite repacking, and VSCodium (with the X_ITE extensions) as the external editor/preview.

Two more lanes — **World Project** and **Generic VRML97** — are planned but not yet implemented.

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
