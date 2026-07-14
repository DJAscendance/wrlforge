# Phase 7C — Unsaved-Buffer X_ITE Preview — Architecture Proposal

Status: **PARTIALLY BUILT.** This document is the architecture proposal; the design
below is the authority for the whole lane. **Built so far:** 7C4 (Windows QA
harness), 7C4.1 (workspace guard), Feature A (vision accommodations), and **7C1 —
the pure buffer-overlay foundation** (`src/preview/buffer-overlay.js`,
`preview-state.js`, `preview-scheduler.js`; §4–§10, §12 first block). **Not built:**
7C2 (Mall unsaved preview UI + X_ITE), 7C3 (World unsaved preview), 7C5 (acceptance).
7C1 adds **no** editor preview UI, no X_ITE on the editor page, no CSP or scheme
change, and nothing wired into `preview:load`/`world:previewLoad` — it is the
main-process-ready model only. The Windows-native QA workflow that Phase 7C's
cross-platform acceptance depends on is a companion document:
**`docs/WINDOWS_NATIVE_QA_PLAN.md`**.

See `docs/NATIVE_EDITOR_ARCHITECTURE.md` (as-built Phase 7B), `docs/PREVIEW_ARCHITECTURE.md`
(the two existing X_ITE previews), `docs/VRML_PARSER.md` (the Phase 7A parser), and
`docs/VISUAL_QA_SAFETY.md` (the launch-storm guardrails). This proposal **reuses** all
of them and forks none.

---

## 1. Objective

Let a user edit VRML in the native editor and preview the current **in-memory,
unsaved** buffer through X_ITE — without saving first, without ever writing the source
file, and without adding a renderer. It must work for both profiles, which do **not**
share all behavior:

- **Mall Item** documents (Original + Cybertown Fit modes, guides, fit math).
- **World Project** primary and nested WRL documents (asset-graph-authorized, per-file
  relative resolution, viewpoints, navigation).

X_ITE remains the only renderer. The Phase 7A parser drives editor assistance only; it
is **not** the render authority.

---

## 2. Current architecture (reviewed at code level)

### 2.1 Mall preview (`renderer/preview.js`, `main.js` `preview:load`)
- `window.vrmlpad.loadPreview(role)` → IPC `preview:load` (role `'source'`|`'edit'`,
  **never a path**). Main reads the held session file via `readWrlSource()`
  (gzip-transparent), returns `{ text, baseURL: fileDirUrl(target), remoteUrls }`.
- Renderer sets `browser.baseURL = meta.baseURL` (a `file://` **dir** URL) and calls
  `browser.createX3DFromString(meta.text)` → `replaceWorld()`. **The document itself is
  passed to X_ITE as a string**; only textures are fetched (from the `file://` base).
- Original vs Fit: Fit wraps the body in a **preview-only** parent `Transform` + guide
  layer composed at render time; never written anywhere. Bounds always computed from the
  Original scene (`computeSceneBBox` → `computeFit`).
- Last-valid: module var `lastGoodText`; on parse error the canvas is **not** cleared.
- Remote blocked at the network layer (`onBeforeRequest` → `isBlockedPreviewUrl`) and by
  page CSP.

### 2.2 World preview (`renderer/world-preview.js`, `src/world-project/preview-source.js`)
- Privileged standard scheme `wrlworld://project/<relpath>` (`registerSchemesAsPrivileged`
  pre-ready `main.js:33`; `protocol.handle` in `whenReady` `main.js:129`).
- `world:previewLoad` sets a main-process global `worldPreview = { projectRoot,
  authorized: buildAuthorizedSet(graph) }` and returns `buildPreviewPayload(scan)` =
  `{ text (primary, decompressed), baseURL: wrlworld://project/<dir>/, advisories… }`.
- Renderer sets `browser.baseURL = payload.baseURL` + `createX3DFromString(payload.text)`.
  **The primary is passed as a string; nested Inlines and textures are fetched** through
  the handler.
- `resolveWorldRequest(preview, url)` maps URL→abs path, confines to root, checks the
  allow-list (readable WRL + present exact-case assets only), serves gunzipped WRL text
  (`model/vrml`) or raw asset bytes. `503` no-preview, `403` off-scheme/outside-root,
  `404` not-authorized.
- Viewpoints discovered live (`getUserViewpoints`, `EnableInlineViewpoints` on);
  navigation via `getActiveNavigationInfo().type`; Reset via `resetUserOffsets()`.
  Last-valid via `haveValidScene`.

### 2.3 Editor (`src/editor/*`, `renderer/editor.{html,js}`)
- Main owns the path. Renderer sends **text + intent + an opaque `sessionId`**, never a
  write path. `sessionId` is a monotonic integer (document-generation); `_require`
  throws `ESTALE` if the renderer's id ≠ current.
- A **per-edit monotonic `version`** already exists — but **only** in the renderer
  CodeMirror layer (`editor-view.js:146`), used for stale-analysis drop. It never
  crosses IPC today.
- `editor.html` CSP is strict `default-src 'none'; connect-src 'none'; script-src 'self'
  file:` — **there is no X_ITE, iframe, or webview on the editor page yet.**
- Parser analysis: `language.analyze()` over `src/vrml`, **250 ms debounce on the
  renderer thread, synchronous**.
- World reference opens authorized three ways by `authorizeWorldReference`
  (lexical-root + scan-graph membership + realpath).

### 2.4 The key consequence for 7C
Because **the edited document is already handed to X_ITE as a string** in both profiles,
overriding the *unsaved primary* buffer requires **no scheme change at all** — swap the
string, keep the base URL. Only **nested World WRLs** are fetched through `wrlworld://`,
so only those need a handler-level override. This is the pivot the whole design turns on.

---

## 3. Recommended editor-preview UX (owner-confirmed)

**Collapsible, drag-resizable split-view inside `editor.html`.** Editor pane on one
side, an X_ITE canvas pane on the other (horizontal split by default; the divider is
draggable and the pane collapses to a handle).

```
┌──────────────┬───────────────┐
│ editor.js    │  X_ITE canvas │
│ (CodeMirror) │  [preview]    │
│  1 #VRML...  │   ◇ status:   │
│  2 Shape {   │     Current   │
│  ...         │  [Refresh]    │
└──────────────┴───────────────┘
  drag divider ↔  /  collapse ▸
```

Why this over the alternatives:
- **vs. separate preview page/mode:** a split keeps the edit↔preview loop live — you see
  the diagnostic squiggle and the rendered result together, which is the whole point of
  "editor-plus-preview work." A separate page loses the editor view and forces a buffer
  round-trip on every toggle.
- **vs. a second BrowserView/webview:** rejected. No webview (locked), and a second
  renderer breaks the "single reused process" simplicity that the QA safety model
  depends on.

Rules that keep it safe and cheap:
- **Lazy X_ITE.** The preview pane initializes X_ITE (`await X3D()`) **only when first
  opened**. Editor-only sessions pay nothing and keep the current strict surface.
- **CSP widening is to a known superset, not a new privilege.** `editor.html`'s CSP is
  widened to the **exact** set the Mall/World pages already ship (`img-src`/`media-src`/
  `connect-src` add `file: data: blob: wrlworld:`; `script-src` adds `'wasm-unsafe-eval'`;
  `worker-src 'self' blob:`). No new scheme is registered; `wrlworld://` privilege
  already exists process-wide.
- **Reuse the controllers.** Load the existing page-scope preview controllers
  (`window.wrlPreview` for Mall, `window.wrlWorldPreview` for World) into the editor
  renderer behind the pane. Do **not** fork them; the profile is chosen from the editor
  session `context` (`mall`|`world`).

Layout: the split is CSS fl/grid with a draggable divider; the canvas uses relative
sizing so resizing the window or dragging the divider reflows without a re-launch. The
preview pane shows the status chip (§8), a **Refresh Preview** button, a **Return to
saved-on-disk scene** button, and (World) the existing viewpoint/nav/reset controls.

---

## 4. Buffer-overlay model

A **main-process, session-scoped, in-memory** overlay. New module
**`src/preview/buffer-overlay.js`** — pure/injectable (no fs, no Electron), unit-tested
like the other `src/preview/*` modules. It holds at most one active override per editor
session:

```
BufferOverride {
  sessionId,        // must equal the editor controller's current sessionId
  generation,       // main-held monotonic previewGeneration at registration time
  profile,          // 'mall' | 'world'
  originAbsPath,    // the real source path of the edited doc (Mall + World)
  projectRelPath,   // World only: the doc's path relative to project root
  bufferText,       // the unsaved UTF-8 text (always plain; never gzip)
  bufferVersion,    // the renderer per-edit version this text corresponds to
  byteLength        // for the oversized-buffer cap (§10)
}
```

**Invariants (the safety core):**
- **A buffer override never authorizes a new path.** For Mall the override abs path must
  equal the session's held source path; for World it must already be a member of the
  authorized allow-list (`buildAuthorizedSet`). An override is a *substitution* of bytes
  for an already-authorized path, never a new grant.
- **Keyed by `sessionId` + `generation` + path.** A request carrying a stale session or
  generation gets no override (falls back to disk / is ignored).
- **Plain text only.** The overlay stores the decompressed buffer; gzip never enters it.
  When the nested-WRL handler would have gunzipped a disk file, it instead serves the
  overlay text directly.

### 4.1 Mall
Preview the unsaved Mall source through the existing **Original** and **Cybertown Fit**
modes. The primary is a string to `createX3DFromString`, so the override simply supplies
`bufferText` instead of the disk read. Placement guides, fit calculations, scale
reporting, and local-texture behavior are unchanged (textures still resolve from the
`file://` source dir). No preview transform is ever written to the document. Remote assets
stay blocked.

### 4.2 World
- **Editing the primary:** preview the world with the primary overridden in memory —
  again a string swap for the payload `text`; base URL unchanged. All nested assets keep
  loading from the project graph.
- **Editing a nested WRL:** preview the *full* world with only that nested dependency
  overridden. Implemented as a check at the **top of `resolveWorldRequest`** (before the
  disk read): if the requested abs path == the active override `originAbsPath` **and** the
  override `generation` == current, serve `model/vrml` from `bufferText`; otherwise fall
  through to the existing allow-list disk path. Graph confinement, exact-case, and the
  allow-list are all still enforced — the override rides on top of them, it does not
  bypass them.
- **Newly authored references not in the last scan:** they are unauthorized → `404`
  (identical to today's missing-asset behavior; X_ITE simply fails to load them, surfaced
  as a missing-asset advisory). Do **not** auto-rescan the graph on a debounced preview
  (expensive; surfaces transient half-typed states). Provide an explicit **"Rescan for
  preview"** affordance — a lightweight, preview-only graph refresh — that the user
  triggers when they've added a dependency. (Open decision: manual-only vs. auto after a
  bounded idle — see §15.)

---

## 5. Scheme and transport design

**Recommendation: extend the existing schemes/transport with a session-scoped in-memory
override (design option 1). Reject `wrlbuffer://`, reject blob/object URLs, reject
broad filesystem exposure.**

| Case | Mechanism | Scheme/CSP/transport change |
|---|---|---|
| Mall primary | pass `bufferText` to `createX3DFromString`; keep `file://` base | **none** |
| World primary | pass `bufferText` as payload `text`; keep `wrlworld://` base | **none** |
| World nested | override check at top of `resolveWorldRequest` | **none** (same handler) |

Why not the alternatives:
- **`wrlbuffer://` (a new scheme):** adds a second privileged scheme to register, a
  second CSP origin, and a second allow-list to keep in sync with `url-policy`. Buys
  nothing — the primary isn't fetched at all, and the nested case is already inside the
  authorized `wrlworld://` handler where the override belongs.
- **blob/object URLs:** introduce lifecycle churn (create/revoke, stale-URL
  invalidation, renderer-reload cleanup) and a base-URL identity problem (a `blob:` URL
  has no directory, so relative textures wouldn't resolve). The string-swap keeps the
  original source-directory identity for free.
- **Passing source with a hand-set base URL:** this is exactly what we already do; the
  override is the minimal delta on top of it.

The recommendation addresses each required concern:
- **Relative URL resolution / nested Inline / original source-directory identity:**
  preserved — the base URL is unchanged, so relatives resolve against the real source dir
  (Mall) or the per-file `wrlworld://` dir (World).
- **Gzip dependencies:** unchanged — the overlay holds plain text; the handler serves it
  directly in place of a gunzip.
- **CSP changes:** only the editor page is widened, to the existing Mall/World superset.
  No page gains a remote origin.
- **Scheme privilege registration:** none added.
- **Session expiration / buffer-version validation / stale-URL invalidation / renderer
  reloads / multiple sequential documents:** handled by the generation model (§6) — a
  request that doesn't match the current `{sessionId, generation}` gets no override.
- **Memory cleanup:** deleting the single overlay entry (§9); no URLs to revoke.
- **Protection against arbitrary path access:** the override cannot introduce a path;
  it can only substitute bytes for an already-authorized one.

---

## 6. Update and versioning model

Every preview request derives / carries:
`{ sessionId, docIdentity (originAbsPath / projectRelPath), bufferVersion, generationId,
profile, originPath|relPath }`.

- **Promote the renderer's monotonic `version` to the buffer version that crosses IPC.**
  It already bumps on every edit in `editor-view.js`; 7C surfaces it on the preview
  request so main can tag the overlay and the result.
- **Main holds a per-session monotonic `previewGeneration`.** Bumped on every new preview
  request, every document switch, and session close.
- **A result older than `currentPreviewGeneration` is discarded** — an older X_ITE render
  can never replace a newer one.
- **Coalescing:** only the newest generation is in flight; a new request supersedes any
  pending one (the pending render is ignored on completion).
- **Closed session / document switch:** bumps the generation and **clears the overlay**,
  so a late request finds no override (World nested falls back to disk; a closed session
  can't serve buffer content). The UI reports which `bufferVersion` is currently
  rendered.

**Debounce:** the preview refresh debounce is **separate from and longer than** the
parser's 250 ms analysis debounce — proposed **600–800 ms** with coalescing. X_ITE is
**never** reloaded per keystroke. The explicit **Refresh Preview** button bypasses the
debounce and forces an immediate attempt (see §7).

---

## 7. Parse and preview policy

The Phase 7A parser and X_ITE are **separate authorities**: the parser drives editor
assistance; X_ITE decides whether a scene renders. Parser-clean does **not** mean
runtime-valid, and parser-rejected does not mean unrenderable (the parser leniently but
imperfectly handles Cybertown/Blaxxun extensions X_ITE accepts).

| Situation | Auto (debounced) | Manual Refresh |
|---|---|---|
| Parser reports no syntax errors | **attempt preview** | attempt |
| Parser reports recoverable syntax errors | **do not attempt** → mark `Stale` (avoids reload storms on obviously-incomplete edits) | **attempt** (X_ITE may accept it) |
| Parser throws unexpectedly | keep last valid → `Failed(parser)` | retry |
| X_ITE rejects parser-clean text | `Failed(scene-load)`, distinct from syntax diag | retry |
| Parser rejects a Cybertown/Blaxxun ext. X_ITE accepts | not auto-attempted | **attempt** — advisories never block, so it renders |

**Net rule:** *auto*-preview gates on "no SYNTAX errors"; *manual* Refresh **always**
attempts X_ITE regardless of advisories. This avoids unnecessary X_ITE reloads during
half-typed edits while still letting historically lenient content render on demand.

---

## 8. Last-valid-scene state machine

States: **Current · Updating · Stale · Failed · UsingLastValid.** Reuse the existing
`lastGoodText` (Mall) and `haveValidScene` (World) — the machine formalizes them; it does
not replace the canvas-retention behavior that already exists.

```
                edit buffer
   Current ─────────────────────▶ Stale
      ▲                             │ debounce fires (no syntax errors)
      │ success                     │ or Refresh pressed
      │                             ▼
      └──────────────────────── Updating
                                    │
              success ┌─────────────┼─────────────┐ parser-fault / X_ITE reject
                      ▼             ▼             ▼
                  Current        Current       Failed
                                              (+ UsingLastValid: keep last scene,
                                                 never clear canvas)
```

- **edit** → `Stale` (buffer differs from the rendered version).
- **debounce/Refresh** → `Updating`.
- **success** → `Current` (records the rendered `bufferVersion`).
- **parser fault or X_ITE scene-load reject** → `Failed` **and** `UsingLastValid`: the
  last valid scene stays on screen; the status chip explains why the newest buffer isn't
  shown.
- **"Return to saved-on-disk scene"** action → drops the overlay, re-previews the disk
  file (the Phase 7B disk-based path), lands in `Current` for the saved bytes.

The UI distinguishes **four** error surfaces so they never blur together:
1. Editor **syntax diagnostics** (authoritative, from the parser).
2. **X_ITE scene-load failure** (runtime reject of parser-clean text).
3. **Missing or blocked asset** (unauthorized/absent/remote reference).
4. **Stale** preview state (buffer newer than the rendered scene).

---

## 9. Resource and lifecycle safety

Explicit cleanup, tied to the generation model:
- **Overlay entries:** cleared on session close, document switch, and generation bump.
- **X_ITE browser instance:** one per editor renderer, lazy-created; a scene is swapped
  via `replaceWorld` (existing pattern), and the instance is discarded when the renderer
  is torn down on navigate-away (`loadFile`).
- **Object/blob URLs:** **none used** → nothing to revoke (a deliberate benefit of the
  string-swap design).
- **Scheme overlay entries / timers / event listeners:** the debounce timer is cleared on
  teardown; listeners are the existing controller ones.
- **Workers:** none added in 7C (§10).
- **Preview generations:** superseded generations are ignored on completion.
- **Closed windows / navigation between pages:** the single-window navigation already
  discards the renderer and its browser instance.

**Leak detection in QA:** extend the existing `VisualQaRunner` `ELEAK` zero-survivor
check with an **overlay-registry-empty assertion** after session close, plus a
memory-before/after check across repeated refreshes (§11). **No preview run may create an
Electron launch loop** — all visual QA goes through the single reused process.

---

## 10. Security review

Preserved unchanged: `contextIsolation:true`, `nodeIntegration:false`, the narrow
`window.vrmlpad.editor` preload, main-process path ownership, Mall-context authorization,
World-root + graph authorization, local-only asset loading, remote-URL blocking, no
Script execution, no unrestricted renderer filesystem access.

**Threat model:**

| Threat | Mitigation |
|---|---|
| Forged session IDs | `_require` throws `ESTALE`; the overlay is keyed to the current `sessionId` — a forged/old id gets no override |
| Stale renderer requests | generation drop (§6); older generation never overrides or renders |
| Path traversal | unchanged `requestToAbsPath`/root confinement; the overlay adds no path |
| Symlink escape | unchanged `realpathInside` / `authorizeWorldReference`; override rides on an already-authorized path |
| Unauthorized graph files | override abs path must be in `buildAuthorizedSet` (World) or the held session path (Mall) |
| Buffer spoofing | overlay keyed to `{sessionId, generation, path}`; wrong tuple → no override |
| Cross-document buffer leakage | one override per session; document switch clears it and bumps generation |
| Remote URL attempts | `onBeforeRequest` network guard + page CSP (no remote origin added) |
| Script URLs / inline vrmlscript | CSP has no `unsafe-eval`; scripts never evaluated |
| Oversized buffers | byte cap in the overlay (`byteLength`); above it, refuse the preview with a clear status (reuse the parser's existing safety limits for analysis) |
| Preview DoS via rapid edits | 600–800 ms debounce + coalescing + a single in-flight generation |

---

## 11. Performance plan

**Measurable gates** across: a small Mall item, a representative World, a 327 KB source,
a 1.3 MB source, a script-heavy source, a syntax-error-heavy source, a World with 70+
textures, and nested gzip Inlines.

**Measure:**
- editor-to-preview debounce latency (keystroke → `Updating`);
- X_ITE scene-replacement time;
- time to first rendered frame;
- memory before and after repeated refreshes (leak signal);
- resource cleanup after document switches (overlay empty, one browser instance);
- behavior during 50–100 rapid edits (coalescing holds; no launch loop; no unbounded
  queue);
- main-thread stalls during analysis + preview.

**Worker decision:** **do not add an off-thread parser worker in 7C.** The Phase 7B perf
gate already clears the 250 ms analysis budget at 1.3 MB on the renderer thread. Add a
worker only if 7C's measured main-thread stalls (analysis + preview marshalling) exceed
budget on the large/script-heavy fixtures — measure first, default to no worker. A worker
would add message-passing complexity and a second copy of the buffer; it is not justified
by tidiness alone.

---

## 12. Testing proposal

**Non-visual automated tests** (Node `node:test`, no Electron):
- buffer-overlay registration and invalidation;
- session + generation rejection (stale id, stale generation);
- Mall authorization (override only for the held session path);
- World graph authorization (override only for allow-list members);
- nested-WRL override served in place of disk;
- gzip dependency resolution (overlay plain text substitutes for a gunzip);
- relative-texture resolution unchanged under override;
- stale preview-result rejection;
- debounce and coalescing (newest generation wins);
- last-valid-scene state machine transitions;
- disk fallback (override cleared → disk path);
- document switching clears the overlay;
- editor-close cleanup (overlay empty);
- remote-URL refusal under override;
- symlink and traversal refusal under override;
- oversized-buffer handling (cap → refuse);
- parser/X_ITE disagreement state handling (auto vs. manual policy §7).

**Serialized visual QA states** (one reused `VisualQaRunner` process, per
`docs/VISUAL_QA_SAFETY.md`): Mall unsaved preview; Mall Fit from unsaved text; unsaved
local-texture change; temporary syntax error with last-valid scene; recovery after syntax
repair; World primary unsaved preview; nested WRL unsaved override; viewpoint
preservation; missing new dependency; stale generation rejection; repeated-refresh
cleanup; theme/layout combinations; disk-preview fallback. All scratch inputs are
temp-confined copies — never committed fixtures.

---

## 13. Mall preview requirements (reuse/adapt map)

Preserve: Original mode, Cybertown Fit mode, transform-aware bounds (computed from the
Original scene), ground/placement guides, requested/max/applied scale reporting,
local-texture behavior, remote-URL blocking, last-valid-scene behavior, the existing
disk-based preview fallback.

- **Reuse unchanged:** `src/preview/bbox-traversal.js`, `fit-math.js`,
  `extrusion-bounds.js`, `guides.js`, `texture-base.js`, `url-policy.js`, `wrl-source.js`.
- **Adapt:** `renderer/preview.js` `load()` to accept a **buffer-text source** in
  addition to today's `loadPreview('edit')`; `main.js` `preview:load` gains a
  buffer-source mode that reads the overlay instead of disk (still no renderer-supplied
  path — the renderer passes `sessionId`, main resolves the held path and the overlay).

---

## 14. World preview requirements (reuse/adapt map)

Preserve: primary + nested `Inline`, plain and gzip dependencies, per-file relative path
resolution, large texture counts, viewpoint discovery/selection, navigation modes, Reset
View, asset-graph authorization, missing/case/remote/unsafe diagnostics, the existing
disk-based preview fallback.

- **Reuse unchanged:** `buildAuthorizedSet`, `worldBaseUrl`/`worldAssetUrl`,
  `requestToAbsPath`, `buildPreviewPayload`, the `wrlworld://` handler shell.
- **Adapt:** `resolveWorldRequest` gains the top-of-function override check (§4.2);
  `world:previewLoad` gains a buffer-source mode for the primary; `renderer/world-preview.js`
  `load()` accepts the buffer payload.

**Viewpoint state on refresh:** preserve the current viewpoint when it still exists after
a refresh (match by DEF name → description → index, in that order); fall back to the
default viewpoint when the current one was removed or renamed; **never reset navigation on
every edit.** Reset View stays an explicit user action.

---

## 15. Open decisions for owner approval

These do not block the design; they are tuning choices to confirm during 7C0/implementation:
1. Exact preview debounce value (proposed **600–800 ms**) — tune against the perf gate.
2. "Rescan for preview" behavior in World (7C3): **manual-only** vs. auto after a bounded
   idle. Proposed default: manual-only for the first cut.
3. Oversized-buffer preview cap (byte threshold) — proposed to align with the parser's
   existing safety limit.
4. Whether the split defaults to horizontal or vertical, and whether the pane state
   persists per session (proposed: horizontal, persisted).

---

## 16. Implementation sequence (slices)

Detailed per-slice objective / files / tests / visual QA / security gate / completion
gate / risks / dependencies live in **`docs/WINDOWS_NATIVE_QA_PLAN.md` §"Implementation
sequence"** (shared with the Windows harness slice). Summary:

- **7C0 — Architecture + harness decisions.** This document + the Windows plan; buffer
  overlay design, editor/preview UI decision (done), security review, Windows QA
  architecture decision. **No production behavior change.**
- **7C1 — Preview overlay foundation. ✅ built.** `src/preview/buffer-overlay.js` +
  `preview-state.js` + `preview-scheduler.js`, the generation/version model, the
  authorization proof boundary, the last-valid state machine, the debounce coordinator,
  and 46 pure tests (`test/preview/buffer-overlay.test.js`). **No editor UI integration
  — nothing is wired into a preview page.**
- **7C2 — Mall unsaved preview.** Editor split-view integration, Original/Fit from the
  buffer, last-valid, debounce, Linux QA.
- **7C3 — World unsaved preview.** Primary override, nested-dependency override, viewpoint
  preservation, asset-graph interaction, "Rescan for preview", Linux QA.
- **7C4 — Windows-native QA harness.** See the Windows plan; **independent of 7C1–7C3**
  and may run in parallel once the harness decision lands.
- **7C5 — Cross-platform acceptance.** Linux full regression, Windows direct-agent QA,
  performance/leak testing, documentation, beta build.

## 17. Excluded (restated)

Direct Cybertown upload, authentication, server submission, custom renderer, AST-based
scene rendering, automatic formatting, scope-aware PROTO semantic rewrite, Apply/Bake
Transform, Windows ARM64, signing, auto-update, Microsoft Store release, public release,
and multiple simultaneous Electron visual processes are **out of scope** and not proposed
here.
