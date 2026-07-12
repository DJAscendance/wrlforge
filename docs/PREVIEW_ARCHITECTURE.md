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

VSCodium remains the editor (auto-launched on open; re-launchable via **Open in
VSCodium**). The preview updates on an explicit **Refresh Preview** button
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
