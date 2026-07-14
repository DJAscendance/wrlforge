# Asset & License Review — Public-Beta Readiness (1.3.0-beta.2)

Scope: redistribution safety of **tracked** and **packaged** assets in WRL Forge
before the repo becomes **public** (source-available, all-rights-reserved posture;
third-party components keep their own licenses).

Method: `git ls-files` inventory (596 tracked files); direct inspection of
`assets/**`, `test/fixtures/**`, `spikes/**`, `qa/**`, `renderer/**`, `docs/**`;
dependency license metadata + LICENSE files under `node_modules/**`; provenance
scan of every `.wrl` and every raster texture.

Two severity lanes are distinguished throughout:

- **SHIPS** — included in the packaged app (`package.json` `build.files`:
  `main.js`, `preload.js`, `validator.js`, `src/**`, `renderer/**`, runtime icons,
  plus electron-builder's automatic inclusion of production `dependencies` and the
  Electron runtime). Redistribution obligations here are real.
- **REPO-ONLY** — tracked in git and thus visible once public, but **not** in the
  packaged artifact (`test/**`, `spikes/**`, `qa/**`, `docs/**`, dev tooling,
  `devDependencies`). Lower severity; only matters as public source.

---

## 1. Categorized inventory

### 1a. Owner-created artwork — SHIPS (runtime icons) — CLEAR
- `assets/wrl-forge-{cyan,cyan-transparent,yellow,yellow-transparent}.svg` — hand-authored SVG (design comments in source, flat-banded, `crispEdges`). REPO-ONLY source.
- `assets/generated/icons/**` — deterministically generated from the SVGs by `scripts/build-icons.js` (`@resvg/resvg-js`). Linux PNGs + `runtime/{icon,about-logo}.png` **SHIP**; Windows `*.ico` **SHIP** as `extraResources`.
- **Status:** owner-created, all-rights-reserved is correct. No third-party derivation. Fine.

### 1b. Test / spike / world fixtures — REPO-ONLY — CLEAR (synthetic)
- `.wrl` files under `test/fixtures/**`, `spikes/xite-mall-fit/fixtures/**` — all hand-authored/synthetic VRML97. The most "real-looking" one, `real-smartcar-lite.wrl` (both copies), carries an explicit provenance line: *"Hand-authored VRML97. No brand names, no badges, no scan data."* `WorldInfo` author is "Ryan".
- Raster textures (`stone.png`, `my stone.png`, `wood.png`, `world/**/img/*.png`, `t000..t070`, etc.) — **1×1 to 2×3 pixel placeholders, 69–75 bytes each**. Procedurally trivial, not photographic/branded content.
- All `http(s)` URLs in fixtures resolve to `example.com` / `example.invalid` (synthetic).
- Only two fixtures mention "Cybertown" and none contain platform content — both are **comments**: `ext-oversize-scale.wrl` ("exceeding the 10m Cybertown limit") and `vrml/world-sample.wrl` ("Original, permission-safe World-shaped sample (**not a real Cybertown world**)"). No "blaxxun" content matches.
- **Status:** no historical Cybertown platform files, textures, or worlds are present. Nothing implies ownership of Cybertown. **Keep as-is.**

### 1c. QA screenshots — REPO-ONLY — CLEAR
- `qa/phase-*/screenshots/*.png` (~120 images) are screenshots of WRL Forge's **own** UI rendering the synthetic fixtures above. No third-party or Cybertown content depicted. Keep.
- Supporting `.bat` / `.ps1` / `.md5` / `.md` files under `qa/**` are owner-authored harness artifacts. Keep.

### 1d. `docs/**` — REPO-ONLY — CLEAR
- No images, PDFs, or binaries tracked under `docs/` — Markdown only. Keep.

### 1e. Bundled third-party JS
- `renderer/vendor/wrl-editor.bundle.js` — **gitignored / generated** (confirmed via `git check-ignore`; `.gitignore` lists `renderer/vendor/`). Not tracked, so not a public-source concern — **but it SHIPS** (matched by `renderer/**`) and is built from CodeMirror + `@lezer` (see §2). No third-party JS is vendored into `src/**` or `renderer/*.js` directly.
- No fonts, archives (`.zip/.gz/.tar`), or other binaries are tracked in the repo.

---

## 2. Per-dependency license status

Runtime dep is `x_ite` only; everything else is a `devDependency`. Electron-builder
bundles production `dependencies` (x_ite) and the Electron runtime into the artifact;
`devDependencies` are **not** packaged **except** as already-compiled output baked into
`renderer/vendor/wrl-editor.bundle.js` (CodeMirror/@lezer).

| Component | Version | License | LICENSE file present in node_modules | Ships in artifact? | Notice needed |
|---|---|---|---|---|---|
| `x_ite` | ^15.1.10 | **MIT** | `LICENSE.md` (© 2009 Holger Seelig + contributors) | **YES** (asar) | **YES** |
| ↳ fonts bundled by x_ite: PT Sans | — | **SIL OFL 1.1** | `dist/assets/fonts/PT_Sans/OFL.txt` | **YES** (inside x_ite) | recommended |
| ↳ Droid Serif | — | **Apache-2.0** | `dist/assets/fonts/Droid/DroidSerif Apache License.txt` | **YES** | recommended |
| ↳ Ubuntu Mono | — | **Ubuntu Font Licence 1.0** | `dist/assets/fonts/Ubuntu/Ubuntu LICENCE.txt` | **YES** | recommended |
| `@codemirror/state` | ^6.7.1 | **MIT** | `LICENSE` | **YES** (in editor bundle) | **YES** |
| `@codemirror/view` | ^6.43.6 | **MIT** | `LICENSE` | **YES** | **YES** |
| `@codemirror/language` | ^6.12.4 | **MIT** | `LICENSE` | **YES** | **YES** |
| `@codemirror/commands` | ^6.10.4 | **MIT** | `LICENSE` | **YES** | **YES** |
| `@codemirror/lint` | ^6.9.7 | **MIT** | `LICENSE` | **YES** | **YES** |
| `@codemirror/search` | ^6.7.1 | **MIT** | `LICENSE` | **YES** | **YES** |
| `@lezer/highlight` | ^1.2.3 | **MIT** | `LICENSE` | **YES** | **YES** |
| `@lezer/common` (transitive) | — | **MIT** | `LICENSE` | **YES** | **YES** |
| `electron` | ^41.7.1 | **MIT** | `LICENSE` | **YES** (runtime; builder adds Electron + Chromium/ffmpeg license blobs automatically) | auto-handled by builder |
| `esbuild` | ^0.24.2 | **MIT** | `LICENSE.md` | **NO** (build tool) | optional |
| `electron-builder` | ^26.15.3 | **MIT** | `LICENSE` | **NO** (build tool) | optional |
| `@resvg/resvg-js` | ^2.6.2 | **MPL-2.0** | `LICENSE` | **NO** (icon build tool) | optional |

Notes:
- **x_ite** ships its own font license files inside `dist/assets/fonts/**`, so the OFL/Apache/Ubuntu texts physically travel with the fonts in the asar — obligation is largely self-satisfied, but they should still be acknowledged in a notices file.
- **`@resvg/resvg-js` is MPL-2.0** (weak, file-level copyleft) but is a **build-time devDependency only** (icon rasterization). It is not distributed, so MPL source-availability obligations are **not** triggered by the app artifact.
- **CodeMirror/@lezer attribution gap:** the editor bundle is built with
  `esbuild … --legal-comments=none`, which **strips** the MIT copyright/permission
  banners from the shipped `wrl-editor.bundle.js`. MIT requires the notice be retained
  "in all copies or substantial portions." Because the banners are removed from the
  distributed file, the MIT notice must be supplied **externally** via a
  THIRD_PARTY_NOTICES document accompanying the build. See §4.

---

## 3. Historical / unclear-ownership fixtures — findings

**None found.** Every `.wrl`, texture, screenshot, and doc asset is owner-authored,
synthetic, or a screenshot of WRL Forge's own UI. There is **no** original Cybertown
platform `.wrl`, no ripped texture, no branded/photographic art, and no content that
implies ownership of the Cybertown platform.

| Item | Provenance | Recommendation |
|---|---|---|
| `test/fixtures/**`, `spikes/**` `.wrl` | Hand-authored synthetic VRML97 | **Keep** |
| all fixture `.png` textures | 1–3 px placeholder swatches (69–75 B) | **Keep** |
| `real-smartcar-lite.wrl` | Hand-authored, self-declared "no scan data" | **Keep** (provenance line is good practice; leave it) |
| `qa/**/screenshots/*.png` | Screenshots of WRL Forge UI + synthetic fixtures | **Keep** |
| comment mentions of "Cybertown"/"10m limit" | Descriptive comments only | **Keep** — no relabel needed |

No remove/relabel actions required for redistribution safety.

---

## 4. THIRD_PARTY_NOTICES — needed? **YES**

A `THIRD_PARTY_NOTICES.md` (or `.txt`) shipped with the app and tracked in the repo is
recommended, and is **effectively required** to satisfy the CodeMirror/@lezer MIT
attribution that `--legal-comments=none` strips from the bundle. Minimum contents:

**Bundled in the application (MIT — reproduce copyright + permission notice for each):**
- **x_ite** — MIT — © 2009 Holger Seelig and contributors
- **@codemirror/state, @codemirror/view, @codemirror/language, @codemirror/commands, @codemirror/lint, @codemirror/search** — MIT — © Marijn Haverbeke and CodeMirror contributors
- **@lezer/highlight, @lezer/common** — MIT — © Marijn Haverbeke and Lezer contributors
- **Electron** — MIT — © GitHub Inc. and Electron contributors (electron-builder also emits `LICENSES.chromium.html` / ffmpeg notices into the packaged output automatically — leave those in place)

**Fonts bundled inside x_ite (shipped in the asar):**
- **PT Sans** — SIL Open Font License 1.1
- **Droid Serif** — Apache License 2.0
- **Ubuntu Mono / Ubuntu** — Ubuntu Font Licence 1.0

**Build-time only (optional to list; not distributed):**
- esbuild — MIT; electron-builder — MIT; @resvg/resvg-js — **MPL-2.0**

Simplest compliant approach: add a `generate-notices` step (or hand-assemble) that
concatenates each dependency's `node_modules/<pkg>/LICENSE*` verbatim, plus the three
x_ite font license files, into `THIRD_PARTY_NOTICES`.

---

## 5. Housekeeping flags (not redistribution BLOCKERs)

- **`package.json` `"license": "ISC"` contradicts the all-rights-reserved posture.** ISC is a permissive OSS license; publishing with it would (mis)grant OSS rights to WRL Forge's own code. Change to `"UNLICENSED"` (or `"SEE LICENSE IN LICENSE"`) and add a top-level `LICENSE` file stating the all-rights-reserved / source-available terms **before** going public.
- **`"author": ""` empty** — set to Ryan Bundy for clarity.
- No tracked `LICENSE`, `NOTICE`, or `THIRD_PARTY_NOTICES` file currently exists (grep returned nothing).

---

## 6. Verdict

- **No redistribution BLOCKER from unclear-ownership assets.** All fixtures/textures/
  screenshots are owner-authored or synthetic; nothing is historical Cybertown content.
- **One real compliance item before public beta:** ship + track a
  `THIRD_PARTY_NOTICES` file (CodeMirror/@lezer MIT banners are stripped from the
  distributed editor bundle; x_ite/Electron/fonts should be acknowledged).
- **Two housekeeping fixes:** correct the `package.json` license field to match the
  all-rights-reserved posture and add a `LICENSE` file; set the author field.
