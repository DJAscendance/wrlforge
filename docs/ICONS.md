# WRL Forge — Application Icons

Phase 7C5.1. How the WRL Forge app icons are sourced, generated, applied, and
verified.

## Source artwork (owner-approved, never modified)

Four SVGs in `assets/` are the **only** icon source. They are owner-supplied and
must be preserved byte-for-byte — do not redraw, trace, recolor, optimize, minify,
or strip comments/metadata. Only owner-approved artwork may replace them.

| File | Role |
|---|---|
| `assets/wrl-forge-cyan.svg` | **Primary** — packaged/executable/window icon identity |
| `assets/wrl-forge-cyan-transparent.svg` | In-app / About branding on suitable backgrounds |
| `assets/wrl-forge-yellow.svg` | Approved **alternate** packaged-icon source |
| `assets/wrl-forge-yellow-transparent.svg` | Approved **alternate** in-app asset |

**Cyan opaque is the single executable identity.** There is no second product
edition or alternate executable. Yellow is retained and available, never the
default exe icon.

## Generation

```bash
npm run build:icons      # node scripts/build-icons.js
```

Rasterizes the SVGs into `assets/generated/icons/` (kept strictly separate from
the source artwork):

```
assets/generated/icons/
  windows/
    wrl-forge-cyan.ico               <- PRIMARY (build.win.icon points here)
    wrl-forge-cyan-transparent.ico
    wrl-forge-yellow.ico
    wrl-forge-yellow-transparent.ico
  linux/
    16x16.png 24x24.png 32x32.png 48x48.png 64x64.png 128x128.png 256x256.png 512x512.png
  runtime/
    icon.png          <- 256px cyan opaque; BrowserWindow window/taskbar icon
    about-logo.png    <- 256px cyan transparent; in-app branding
  MANIFEST.json       <- provenance: source hashes + every output + sizes
```

- **ICO sizes:** 16, 24, 32, 48, 64, 128, 256 (multi-image PNG-embedding `.ico`,
  read directly by modern Windows shells and Electron packaging).
- **PNG sizes:** 16, 24, 32, 48, 64, 128, 256, 512.

### Tooling / dependency

- **`@resvg/resvg-js`** (MPL-2.0, **devDependency**) — SVG→PNG rasterizer. Chosen
  because the repo had no rasterizer, it ships cross-platform prebuilt binaries
  (Linux + Windows) with no system libraries, and its Rust core renders
  deterministically. Build/tooling-only: never `require`d by app runtime code, so
  the runtime stays `x_ite`-only.
- The multi-resolution `.ico` container is assembled in **pure Node** by
  `scripts/build-icons.js` — no ICO/image-encoding dependency was added.

## Determinism

- Rendering runs with **system fonts disabled**. The SVGs carry a tiny "FORGE"
  caption whose rasterization would depend on installed fonts; it is sub-pixel at
  icon sizes and is intentionally not rendered. This removes the only source of
  cross-machine variance.
- **Per-platform determinism** is guaranteed and enforced: `test/assets/icon-generation.test.js`
  regenerates and asserts the committed bytes are identical, and `npm run build:icons`
  run twice is byte-identical.
- **Cross-platform** (Linux vs Windows) byte-identity is expected because the
  rasterizer is a single pinned Rust core, but is treated as a documented
  best-effort target rather than a hard guarantee — the enforced contract is
  per-platform determinism. Verified hashes for both platforms are recorded in
  `qa/phase-7c5-icon-closeout/`.

## Committed vs ignored

- **Committed:** the source SVGs and the entire generated tree
  (`assets/generated/icons/**`) — so a fresh checkout can package without first
  running the rasterizer, and CI/tests can verify the committed bytes.
- **Ignored:** nothing icon-specific beyond the usual `release/` build output and
  scratch. No temporary conversion files are committed.

## How the icon is applied

| Surface | Wiring |
|---|---|
| Dev BrowserWindow / Linux window / Windows dev taskbar | `main.js` → `assets/generated/icons/runtime/icon.png` |
| Packaged Windows exe, installer, shortcut, taskbar, Add/Remove entry | `build.win.icon` → `assets/generated/icons/windows/wrl-forge-cyan.ico` |
| All four choosable icons inside the installed app | `build.extraResources` → `resources/icons/wrl-forge-*.ico` |

There is no separate About screen in the app; branding is carried by the window /
taskbar icon. The transparent `about-logo.png` is generated and available for a
future in-app branding surface without weakening the renderer CSP.

### Choosing a different icon for your shortcut

All four variants ship in the installed app under `resources/icons/`. To use a
different one for a Start Menu / desktop shortcut, on Windows:

1. Right-click the shortcut → **Properties** → **Change Icon…**
2. **Browse** to `…\resources\icons\` inside the install location and pick e.g.
   `wrl-forge-yellow.ico`.

To change the identity of a *build* itself, set `WRL_FORGE_ICON` before building:

```bash
WRL_FORGE_ICON=yellow npm run build:win     # cyan (default) | cyan-transparent | yellow | yellow-transparent
```

The committed default and the executable identity remain cyan.

## Verifying output

```bash
npm run build:icons          # generate
npm run build:icons          # again — output is byte-identical
npm test                     # includes test/assets/icon-generation.test.js
```

The test suite checks: sources exist and are unchanged by generation; every ICO
has the expected entry sizes and each entry decodes as a square PNG; PNG
dimensions are correct; the committed tree matches a fresh regeneration; and the
build config points at the cyan ICO (never yellow).

## Replacing icons in a future branding change

1. Replace the relevant `assets/wrl-forge-*.svg` with **owner-approved** artwork
   (same filenames). Keep the four files byte-exact to what the owner supplied.
2. `npm run build:icons` to regenerate `assets/generated/icons/`.
3. `npm test` — the icon tests confirm dimensions, entries, and determinism.
4. Commit the changed source SVGs **and** the regenerated tree together.
