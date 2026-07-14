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
| `buffer-overlay.js` | pure (Phase 7C1) | session-scoped unsaved-buffer registry — byte substitution only, never a new grant |
| `preview-state.js` | pure (Phase 7C1) | last-valid-scene state machine (idle/updating/current/failed/showing-last-valid/outdated/closed) |
| `preview-scheduler.js` | pure (Phase 7C1) | clock-injected 700 ms debounce / coalescing coordinator (no real timer) |

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

VSCodium (or VS Code) is the **optional external editor**, launched **only** via the
explicit **Open in External Editor** action (opening a file never launches it); the
built-in native WRL editor + VRML97 parser shipped in Phase 7A/7B
(`docs/NATIVE_EDITOR_ARCHITECTURE.md`). The preview updates on an explicit
**Refresh Preview** button
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

## Phase 7C1 — unsaved-buffer overlay foundation (built; not yet wired)

The three pure `src/preview/` 7C1 modules are the **main-process-ready model** for
previewing an unsaved editor buffer through X_ITE **without writing a temp file**.
Phase 7C1 ships the model **only** — there is no editor preview UI, no X_ITE on the
editor page, no CSP or scheme change, and nothing calls these modules from
production yet. 7C2 (Mall) and 7C3 (World) wire them into `preview:load` /
`world:previewLoad`.

### The overlay is a byte substitution, never a new grant
`buffer-overlay.js` holds at most **one override per editor session**, keyed by
`{ sessionId, generation, path }`. It performs byte substitution for a path that is
**already authorized** and does nothing else: it never authorizes a new path, never
expands a World asset graph, never resolves a renderer-supplied path, never fetches
remote content, never writes a temp file, never mutates the source, and never
persists across restarts. It re-implements **none** of `src/editor/path-authorizer.js`
or the World graph.

### Authorization boundary (the narrow integration contract)
`register()` **requires** an authorization *proof* that the owning main-process
controller already obtained from the real authority:

- **Mall** — `mallAuthorization(path)` → `{ ok:true, profile:'mall',
  source:'mall-session', path }`; the caller supplies this only when `path` is the
  session's held Mall source.
- **World** — `worldAuthorization(path, { inGraph })` → `{ ok, profile:'world',
  source:'world-graph', inGraph, path }`; the caller sets `inGraph:true` only when
  the path is a member of the current scan's authorized WRL set
  (`buildAuthorizedSet`), confined to the project root by the existing realpath rule.

`defaultVerifyAuthorization` rejects any proof that is missing, `ok:false`, for a
different path/profile, or carries the wrong `source`/`inGraph`. The overlay thus
cannot invent a grant; it can only substitute bytes for a path the caller already
proved. A later controller may inject a stricter verifier, never a looser one.

### Version & generation model (monotonic integers, never timestamps)
- **`bufferVersion`** — the renderer's per-edit monotonic version, promoted onto the
  register call. A newer version replaces; a `register()` with a version `<=` the
  stored one for the same document is rejected (`ESTALEVERSION`). A newer buffer
  version is never replaced by an older one.
- **`generation`** — a per-session monotonic preview-attempt counter.
  `beginGeneration()` bumps it; `acceptGeneration()` accepts **only** the current
  generation (an older one is `stale`, an already-accepted one is `replayed`).
  `resolve()` serves the overlay **only** when the request's generation equals the
  session's current generation, else `stale`.

`resolve()` returns a six-way structured result and **never reads disk**: `overlay`
(serve buffer text), `disk` (a different authorized path — caller does its normal
disk read), `missing` (open session, no overlay), `stale` (older generation),
`unauthorized` (identity spoof — path matches but profile/doc does not), `closed`
(unknown/closed session).

### Size thresholds
`classifyBufferSize()` bands a buffer into three tiers, so later UI can decide how it
refreshes — **without ever silently truncating text**:

| Tier | Bound | Behavior |
|---|---|---|
| `auto` | ≤ 1 MiB (`AUTO_REFRESH_MAX_BYTES`) | eligible for debounced auto-refresh |
| `manual` | 1 MiB – 8 MiB | valid preview, **manual Update only** |
| `refused` | > 8 MiB (`HARD_MAX_BYTES`) | hard refusal — `register()` throws `EBUFFERTOOLARGE`, stores nothing |

The 8 MiB hard ceiling bounds worst-case transient in-memory copies (overlay + IPC +
X_ITE parse) while clearing every realistic source — a WRL's bulk is binary textures,
not VRML text, and the largest measured perf fixture is ~1.3 MB.

### Last-valid-scene state machine (`preview-state.js`)
A pure, frozen-state machine over `idle · updating · current · failed ·
showing-last-valid · outdated · closed`. Its guarantee: a **failed newer render keeps
the last valid scene on screen** (`showing-last-valid`) rather than clearing the
canvas, and an **older success or failure never changes the state once a newer
generation has begun** (completions are ignored unless `generation ===
requestedGeneration`). It tracks requested/displayed/last-valid generations, current
& displayed buffer versions, a `haveLastValid` flag, and a distinct `failureCategory`
(`syntax` / `parser` / `scene-load` / `missing-asset`) so the four error surfaces
never blur. It is independent of user-facing wording — 7C2 maps states to copy.

### Debounce / coalescing (`preview-scheduler.js`)
A clock-**injected** coordinator (no real timer; tests pass an `at` millisecond
value): auto-refresh coalesces rapid edits into the newest pending version and slides
the due time to `newest-edit + 700 ms`; an explicit Update bypasses the debounce;
buffers over 1 MiB are declined for auto but allowed for manual; exactly one pending
request is held per session; `cancel()` clears it on document switch / session close.

### Cleanup lifecycle (no overlay survives its session)
`invalidateDocument()` drops the entry but keeps the session open (document
close/switch) and bumps the generation so in-flight requests go stale;
`invalidateSession()` drops the entry and marks the session **closed forever** (a
later `resolve` returns `closed`, a later `register`/`beginGeneration` throws
`ECLOSED`); `clear()` wipes everything (renderer reload / shutdown). A failed
registration stores nothing. Leak-assertion surface for QA: `size`,
`activeGenerationCount`, `sessionIdsWithEntries()`, and text-free `describe()` — which
**never** exposes buffer contents.

### Phase 7C2 integration contract (for the next lane)
`preview:load` gains an **editor-session buffer-source mode**: the renderer sends the
editor `sessionId` (never a path); main resolves the held path + the overlay by
`sessionId`, calls `resolve()`, and passes `overlay.text` to `createX3DFromString`
with the unchanged `file://` base URL. For World nested WRLs, a `resolve()` override
check goes at the **top of `resolveWorldRequest`** (before the disk read); the
allow-list, exact-case, and root confinement still gate it. Main drives
`beginGeneration`/`acceptGeneration`, feeds the scheduler a single real timer, and
maps `preview-state` to release-quality chip copy. None of that exists yet.
