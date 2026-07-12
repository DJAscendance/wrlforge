# Embedded Preview — Architecture

Two **separate** embedded-X_ITE previews now ship, one per profile. This file
documents the Mall Item Fit preview first (Phase 2B1), then the World Project
preview (Phase 4B). They share X_ITE and the process-wide network guard but keep
their renderer controllers and security surfaces distinct — no Mall placement
rule applies to a world, and no world scheme is reachable from the Mall lane.

# Mall Item Fit Preview — Architecture (Phase 2B1)

How the embedded X_ITE Mall Item Fit preview is wired into the production app,
and the invariants that keep it safe and preview-only. This is the first point
X_ITE enters `main.js`/`renderer/` (roadmap Phase 2B/5); it is scoped to the
Mall Item lane.

## Shared modules — `src/preview/`

The Phase 2A/2B0 spike modules were promoted here (single source of truth; the
spike now references them, no duplicate implementations):

| Module | Purity | Role |
|---|---|---|
| `fit-math.js` | pure (dual CommonJS/browser export) | Cybertown fit rules → proposed scale/offset/violations from a world-space bbox |
| `extrusion-bounds.js` | pure (dual export) | exact VRML97 Extrusion cross-section sweep (scale+orientation), conservative fallback |
| `bbox-traversal.js` | browser-only (needs X_ITE `X3D` globals) | transform-aware world bbox by walking the parsed scene graph |
| `guides.js` | pure (dual export) | non-exported guide VRML (ground/center/Z-limit/cage/item-box) |
| `texture-base.js` | pure (Node `path` only) | source-directory `file://` base URL + `safeResolve` path confinement |
| `wrl-source.js` | main-process (fs/zlib) | read + gzip-detect/decompress a source file |
| `url-policy.js` | pure | remote-URL block predicate + preflight remote-URL scan |

Pure/browser modules keep no Electron or filesystem dependency, so they are
unit-tested under `node:test` (`test/preview/*.test.js`) independent of the
renderer. `wrl-source.js` is the only privileged module and lives in the main
process.

## Process boundaries

```
 main process (privileged)                renderer (isolated, no Node)
 ─────────────────────────                ────────────────────────────
 preview:load (role)  ───────────────►    window.vrmlpad.loadPreview(role)
   readWrlSource()  (fs + gunzip)            → decompressed TEXT + baseURL
   fileDirUrl()     (source dir base URL)    → renderer/preview.js:
   scanRemoteUrls() (advisory)                   browser.baseURL = baseURL
                                                 createX3DFromString(text)   ← X_ITE never sees gzip
 session.webRequest.onBeforeRequest  ◄──       computeSceneBBox(scene)       (src/preview/bbox-traversal)
   isBlockedPreviewUrl() cancels remote        computeFit(bbox)              (src/preview/fit-math)
```

- **Gzip**: the main process decompresses; X_ITE receives plain UTF-8 text via
  `createX3DFromString`. X_ITE is never asked to fetch or parse gzip bytes.
- **`preview:load` is read-only** and takes a `role` (`'source'` | `'edit'`),
  not a path. It reads only the currently-open item or its `.edit.wrl` sibling
  (tracked in `currentSession`, set only by `openMallFile`). There is no
  write-capable preview channel.

## Original vs. Cybertown Fit

- **Original** — the item's authored transforms, exactly as loaded.
- **Cybertown Fit** — a **preview-only parent `Transform`** (uniform
  `scale = proposedAppliedScale`, `translation = offset`) wrapping the item,
  plus the non-exported guide layer. `world = scale·local + offset` reproduces
  `fit-math`'s proposed bounds. This transform is composed as VRML text at render
  time and loaded into X_ITE; it is **never** written to the loaded text, the
  `.edit.wrl`, the source `.wrl`, textures, or the repacked artifact.

Authoritative bounds are always computed from the **Original** scene (authored
transforms), independent of the display mode.

## Authoritative vs. advisory bounds

The transform-aware X_ITE bounds drive the Fit panel and are authoritative for
placement. The text `validator.js` still owns the static Mall checks (header,
WorldInfo, size, forbidden nodes, textures, URLs, DEF/USE). Its rule-8
"Placement/bbox (advisory, untransformed local coords only)" **soft** line is
**suppressed in the renderer** whenever the preview is present, so two different
bounding systems never show conflicting placement verdicts. All other validator
checks are shown unchanged.

## Security layers (defense in depth)

1. **Read-only, path-free preview IPC** (`role` selector, `currentSession`).
2. **`texture-base.safeResolve`** rejects `../`, absolute paths, drive letters.
3. **`url-policy.isBlockedPreviewUrl`** wired into
   `session.webRequest.onBeforeRequest('<all_urls>')` — cancels every remote
   request (http/https/ws/wss/ftp/protocol-relative) at the network layer.
4. **CSP meta** in `renderer/index.html` lists no remote origin (`default-src
   'none'`; only local `self`/`file`/`data`/`blob`).
5. **`contextIsolation:true` / `nodeIntegration:false`** unchanged — the renderer
   has no Node/`require`/`process`.

Missing/case-mismatched textures surface as warnings without breaking bounds.
Remote URLs are surfaced as warnings and never fetched.

## Confidence

- `exact` — determinate geometry/frames.
- `conservative` — an ambiguous/degenerate Extrusion spine used a
  non-shrinking overestimate (bounding ball); the panel says so.
- `unavailable` — bounds could not be computed (e.g. a temporary parse error);
  the item is **not** marked compliant.

## Refresh & editing

VSCodium (or VS Code) is the **optional external editor** (launched on open when
present unless suppressed; re-launchable via **Open in Editor**); a native WRL
editor + VRML97 parser are planned (Phase 7, `docs/NATIVE_EDITOR_ARCHITECTURE.md`).
The preview updates on an explicit **Refresh Preview** button
(no continuous reload/flicker). A temporary parse error keeps the last valid
scene, shows a parse warning, and allows manual retry.

## Not implemented (out of scope for this lane)

Apply Transform, Bake Transform, coordinate rewriting, wrapper insertion, and
automatic fitted-file saving are **not** implemented. The fit is proposed and
previewed only.

## Test hooks (non-interactive, opt-in via env)

- `WRL_FORGE_SMOKE_TEST` — one-line security/preview-surface report, then quit.
- `WRL_FORGE_PREVIEW_FIXTURE` — load a fixture, print bbox/fit JSON, then quit.
- `WRL_FORGE_PREVIEW_CAPTURE` (+ `_MODE`, `WRL_FORGE_WIN_SIZE`,
  `WRL_FORGE_NO_EDITOR`) — drive the real open→validate→preview path and save a
  PNG (QA screenshots).

None of these hooks are active during normal use.

# World Project Preview — Architecture (Phase 4B)

The embedded X_ITE **world** preview. It is a **separate profile** from the Mall
Item preview above: a distinct renderer controller (`renderer/world-preview.js`)
that applies **no** Cybertown Fit, fit-math, guides, bounds compliance, 80KB cap,
or forbidden-node rules. A world is rendered and analysed as authored.

## The problem it solves

A world is not one file: it is a primary WRL plus nested `Inline` children (plain
or gzip, at any depth), each referencing textures relative to **its own**
directory, across possibly ≥70 unique textures. X_ITE resolves those nested
references itself. The preview must let it do so while keeping every read (a)
gzip-transparent, (b) per-file-relative, (c) inside the production asset graph,
and (d) confined to the project root — with **no** remote fetch.

## The `wrlworld://` scheme

Instead of pointing X_ITE at `file://`, the preview uses a privileged, standard,
LOCAL-only scheme `wrlworld://project/<relpath>` (registered in `main.js` via
`protocol.registerSchemesAsPrivileged` before app-ready; handler installed with
`protocol.handle` in `whenReady`). Because it is a standard hierarchical scheme:

- each nested WRL's relatives resolve against **its own** `wrlworld://` URL
  (per-file bases — a texture in `parts/deep/more.wrl` resolves under
  `parts/deep/`, not the primary's dir);
- `../` **clamps at the authority root** (the project root) at the URL layer, so
  traversal above the root is structurally impossible before the handler runs.

App resources (the X_ITE bundle, WASM, `world.html`) stay on the default `file://`
handler — only world **content** routes through the authorized handler. The scheme
is added to `url-policy.ALLOWED_SCHEMES` so the process-wide network guard doesn't
cancel it (a unit test asserts the two agree); the real access control is the
handler's allow-list, not that predicate.

```
 main process (privileged)                    renderer (isolated, no Node)
 ─────────────────────────                    ────────────────────────────
 world:previewLoad  ───────────────────────►  window.vrmlpad.world.loadPreview()
   worldSession.last (held primary)             → decompressed primary TEXT + baseURL
   buildAuthorizedSet(graph)  ── installs ──►     browser.baseURL = wrlworld://project/<dir>/
   buildPreviewPayload(scan)                       createX3DFromString(text)   ← X_ITE never sees gzip
 protocol.handle('wrlworld', …) ◄───────────    X_ITE fetches nested Inline / textures
   resolveWorldRequest(worldPreview, url)          as wrlworld:// URLs
     confine to root → allow-list → serve         → served ONLY if asset-graph-authorized
     (gunzip WRL text / raw asset bytes)           → missing/case/remote/unsafe = Not Found (warning)
 session.webRequest.onBeforeRequest  ◄──────     inline vrmlscript: never evaluated (CSP: no unsafe-eval)
   still cancels every remote scheme
```

## Authorization (`src/world-project/preview-source.js`)

Pure/injectable (fs reads injected), unit-tested without Electron or X_ITE:

- `buildAuthorizedSet(graph)` — the read allow-list: readable WRL nodes + present
  (exact-case) local assets **only**. Missing / case-mismatched / remote /
  absolute / traversal references are deliberately excluded.
- `worldAssetUrl` / `worldBaseUrl` — build the per-segment-encoded `wrlworld://`
  URLs (spaces and other URL-significant chars survive).
- `resolveWorldRequest(preview, url, deps)` — map URL → abs path, confine to the
  project root (defense in depth over the scheme's clamping), check the
  allow-list, serve gunzipped text for WRL / raw bytes for assets. `503` when no
  preview is active, `403` off-scheme/outside-root, `404` not-authorized.
- `buildPreviewPayload(scan, deps)` — the renderer-facing payload: decompressed
  primary text, `wrlworld://` base URL (no absolute path leaked), advisory counts,
  and the remote/missing/case/unsafe lists. The allow-list is installed into the
  handler separately; it is **not** sent to the renderer.

## Preview-only, read-only invariants

- `world:previewLoad` reads only `worldSession`'s held primary — never a
  renderer-supplied path — and never writes.
- The scheme handler only ever **reads** authorized files; there is no write path.
- A temporary parse error (`createX3DFromString` throws) keeps the last valid
  scene (no `replaceWorld`), flags it stale, and waits for a manual Refresh —
  identical discipline to the Mall preview.
- No project file is mutated (asserted by tests). The parse-fail/recover visual
  scenario swaps bytes only in a scratch project under the OS temp dir, via a
  capture-server-only hook (never reachable in normal use).
- `contextIsolation: true` / `nodeIntegration: false` unchanged; `world.html`'s
  CSP lists no remote origin.

## Viewpoints & navigation

Viewpoints are discovered live from X_ITE after load
(`getActiveLayer().getUserViewpoints()`), with `EnableInlineViewpoints` on so
viewpoints authored **inside nested Inlines** appear in the selector. Selection
binds via `browser.bindViewpoint(layer, node)`; Reset View calls
`getActiveViewpoint().resetUserOffsets()`; navigation mode sets the active
`NavigationInfo` type (feature-detected).

## Test hooks / QA

- `world:previewLoad` + the `wrlworld://` handler are exercised by
  `test/world-project/preview-source.test.js` (authorization, serving,
  non-mutation, no-Mall-rules) with the real filesystem, no Electron.
- The capture-server (`WRL_FORGE_CAPTURE_SERVER`) `world` job gained a `preview`
  flag (drive `world:previewLoad` + the scheme handler), an optional `viewpoint`
  index, and a QA-only scratch `writePrimary` (temp-dir-confined) for the
  parse-fail→recover sequence.
- One serialized `VisualQaRunner` run of all 10 states lives in
  `qa/phase-4b-world-preview/` (`orchestrate.js`, `RESULTS.md`, `RESULTS.json`);
  the opt-in `test/visual/electron-world-preview.test.js` is the regression test.

None of these hooks are active during normal use.
