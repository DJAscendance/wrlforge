# World Project Architecture (Phase 4A)

The **World Project** lane is a read-only asset resolver and workspace for
Cybertown world projects. It promotes the proven Phase 3A recon logic (see
`docs/WORLD_PROJECT_RECON.md`) into production `src/world-project/`, wires it
behind confined main-process IPC, and renders it in a dedicated workspace page.

It is a **sibling** of the Mall Item lane, not an extension of it: World Project
analysis never applies Mall Item rules, and the Mall Item lane is unchanged.

**This lane is read-only.** It opens, scans, reports, and (Phase 4B) previews.
It does not repair paths, copy/rename/delete assets, package, or upload. The
embedded X_ITE world preview added in Phase 4B is itself read-only, local-only,
and asset-graph-authorized — see "World preview (Phase 4B)" below.

## Module layout (`src/world-project/`)

All modules are pure and dependency-light except `project-loader.js` (the one
filesystem-touching module, run in the main process). Everything the loader and
graph touch is injectable, so the whole set is unit-tested without a real tree.

| Module | Role | fs? |
|---|---|---|
| `url-fields.js` | Lexical URL-field extraction: every `url`/`*Url` value, with enclosing **node type** + **field name**; classifies inline-script vs remote vs local. | no |
| `path-policy.js` | Classifies one authored reference: `local` / `traversal` / `absolute-local` / `remote-http` / `remote-protocol` / `remote-other` / `inline-script` / `malformed`, and resolves local paths. | no |
| `image-size.js` | Header-only PNG/GIF/JPEG/BMP dimension parsing (no image library, bounded read). | no |
| `asset-graph.js` | Bounded, cycle-safe dependency walk following nested `Inline`; emits per-reference records + diagnostics (missing / case / remote / unsafe / cycles / duplicates) + scene counts. | injected |
| `profile.js` | The World Project rule profile: `MALL_ONLY_RULES` (what must NOT apply) + confidence-tagged findings. | no |
| `project-stats.js` | Summarizes a scan into the Project Summary counts. | no |
| `project-loader.js` | Detects the primary world file in a folder; runs a scan with real fs (sizes + texture dimensions). | **yes** (main) |
| `session.js` | Holds the open project; enforces single-flight scanning, keep-last-good-on-error, candidate-validated primary selection. | no |
| `preview-source.js` | (Phase 4B) Read-authorization + serving for the embedded X_ITE preview: `wrlworld://` URL builders, `buildAuthorizedSet`, `resolveWorldRequest` (confine + allow-list + gzip-decompress), `buildPreviewPayload`. | injected |

`qa/world-recon/url-fields.js` and `qa/world-recon/asset-graph.js` are now thin
re-exports of the production modules (single source of truth); `npm run
recon:world` still works as a read-only CLI over the same logic.

## How the asset graph works

Given a **primary** `.wrl`, the walker:

1. Reads it gzip-transparently (shared `src/preview/wrl-source.js` — magic-byte
   detection; both plain and gzip `.wrl`/`.wrz` are supported at any nesting
   depth).
2. Extracts every URL reference (all MFString entries, case-insensitive field
   names, node type recorded).
3. Classifies each reference relative to **its own directory** and the project
   root, and resolves local ones.
4. Follows nested `Inline`/EXTERNPROTO `.wrl` children (each resolved relative to
   its own directory), **bounded** by `maxWrlNodes`/`maxDepth` and made
   **cycle-safe** by a visited set (cycles are reported, never re-entered).
5. Records, per reference: referrer, node type, field, authored url,
   project-relative path, resolved path, local/remote, existence, exact-case,
   asset kind, byte size, texture dimensions, depth, parent, duplicate flag,
   warnings.

Malformed nested files are recorded as `unreadable` nodes without aborting the
rest of the walk. Nothing is ever written.

### More than 20 textures

There is **no** texture/asset count limit anywhere in this lane. The historical
~20-texture figure was a web-form limit, not a server rule (real worlds reach
~70). The resolver, the summary counts, the asset table, and the filters all
handle 24, 70, and more unique textures without truncation. `uniqueTextures`
counts **distinct present** texture files, independent of how many times each is
authored (duplicate references are counted separately).

## Diagnostics

Every reference gets one status, surfaced (never acted on):

- `present` — resolves to a real, exact-case local file
- `missing` — local target not on disk
- `case-mismatch` — exists only under a different case (breaks on a
  case-sensitive server even though the author's fs may be case-insensitive)
- `unsafe` — an absolute path or one that escapes the project root
- `remote` — http(s), protocol-relative, or other network scheme (surfaced,
  **never fetched**)
- `inline-script` — `vrmlscript:`/`javascript:`/`ecmascript:` code, not an asset

Confidence tagging (`profile.js`) keeps historical assumptions from being shown
as current rules: `confirmed`, `historical`, `runtime-warning`, `performance`,
`unknown`.

## IPC & security

The main process owns every project path. The renderer never supplies an
arbitrary scan path — it can only pick among candidates the main process
detected.

| Channel | Purpose |
|---|---|
| `app:goto` | Navigate the one window between `index.html` (Mall) and `world.html` (World). Page name is whitelisted. |
| `world:openFolder` | Dialog → detect primary candidates in a folder. |
| `world:openPrimaryFile` | Dialog → open a single primary `.wrl`/`.wrz` (its folder is the root). |
| `world:choosePrimary` | Resolve ambiguity by choosing a **detected** candidate (validated). |
| `world:scan` / `world:refresh` | Scan/rescan the held project (single-flight). |
| `world:previewLoad` | (Phase 4B) Ensure a scan, install the asset-graph read-authorization set into the `wrlworld://` handler, and return the decompressed primary text + base URL + advisory counts/warnings. **No** renderer path. |
| `world:describe` | Report the open project (for restoring the view). |
| `world:reveal` / `world:revealRoot` | Reveal a path in the OS file manager, **confined to the project root** and only if it exists. |
| `world:openPrimaryInEditor` | Explicit-only VSCodium launch on the primary (opening a project never auto-launches the editor). |

There is **no write-capable World Project IPC**. `contextIsolation: true` /
`nodeIntegration: false` are unchanged. As of Phase 4B the `world.html` page
carries a strict CSP that permits X_ITE's LOCAL needs only — `'wasm-unsafe-eval'`
for its WASM decoders, `blob:` workers, and the LOCAL-only `wrlworld:` preview
scheme in `img-src`/`media-src`/`connect-src` — with **no** remote origin
anywhere. The `session.webRequest` remote-request guard from the Mall lane
remains installed process-wide.

## World preview (Phase 4B)

A read-only embedded X_ITE preview renders the whole world. It is a **separate
profile** from the Mall Item preview (`renderer/world-preview.js`, not
`renderer/preview.js`): **no** Cybertown Fit, fit-math, guides, bounds
compliance, 80KB cap, or forbidden-node rules apply to a world.

**Why a custom scheme.** X_ITE resolves nested `Inline` and textures itself. To
keep that resolution (a) gzip-transparent, (b) per-file (each WRL resolves
relatives from its own directory), and (c) inside the asset graph, the preview
points X_ITE at a privileged, standard, LOCAL-only `wrlworld://project/<relpath>`
scheme instead of `file://`. Because it is hierarchical, `../` clamps at the
authority root (the project root) at the URL layer, and a nested WRL's relatives
resolve against its own `wrlworld://` URL. App resources (the X_ITE bundle, WASM,
`world.html`) stay on the default `file://` handler; only world **content**
routes through the authorized handler.

**Authorization (`src/world-project/preview-source.js`).** `buildAuthorizedSet()`
derives the read allow-list from the production asset graph: readable WRL nodes +
present (exact-case) local assets **only**. `resolveWorldRequest()` maps a request
URL to an absolute path, confines it to the project root (defense in depth on top
of the scheme's own clamping), checks the allow-list, and serves gzip-decompressed
text for WRL nodes / raw bytes for assets. Missing, case-mismatched, absolute,
traversal, and remote references are **not** authorized → X_ITE gets a `Not Found`
and surfaces a runtime warning; inline `vrmlscript:` never evaluates (the CSP has
no `unsafe-eval`). The module is pure/injectable and unit-tested
(`test/world-project/preview-source.test.js`) without Electron or X_ITE.

**Process boundary.** `world:previewLoad` (main) reads only `worldSession`'s held
primary — never a renderer path — decompresses it, installs the authorized set
into the scheme handler, and returns the primary text + `wrlworld://` base URL +
advisory counts/warnings. The renderer sets `browser.baseURL` and
`createX3DFromString(text)`; X_ITE then fetches every dependency through the
confined scheme. Nothing is written.

**UX.** Preview canvas, loading/status line, viewpoint selector (discovers
nested-Inline viewpoints via `EnableInlineViewpoints`), Reset View, navigation
mode, explicit **Refresh Preview**, loaded-vs-missing counts, remote/unsafe/
missing/case warnings, and a stale badge. A temporary parse error keeps the last
valid scene (does not clear the canvas) and flags it stale until a successful
Refresh. The existing summary / filters / asset table / dependency view are
unchanged; the preview sits above them and reflows to a usable single column at
narrow widths.

Verified by `test/world-project/preview-source.test.js` (authorization/serving,
non-mutation, no-Mall-rules), the opt-in `test/visual/electron-world-preview.test.js`,
and one serialized `VisualQaRunner` run of all 10 states
(`qa/phase-4b-world-preview/`, `RESULTS.md`).

## Workspace UI (`renderer/world.html` + `world.js`)

A separate page sharing the one BrowserWindow and preload (so it gets the same
`window.vrmlpad` bridge, including `window.vrmlpad.world.*`). It renders:

- **Project Summary** — root, primary, plain/gzip, WRL count, references, unique
  textures, local assets, missing, case mismatches, remote, unsafe, cycles,
  duplicates, inline scripts, viewpoints, scripts, approx bytes.
- **Findings** — confidence-tagged, text-labelled (`ERROR`/`WARNING`/`INFO`, not
  colour-only).
- **Asset table** — Status / Asset / Type / Referenced by / Size / Depth / Notes,
  with filters: All, Present, Missing, Case mismatch, Remote, Unsafe, Repeated,
  Nested WRL. Wraps in a horizontal-scroll container.
- **Dependency view** — each WRL with its references beneath it; cycles and
  repeats flagged.
- **States** — no project / scanning / ambiguous-primary chooser / loaded /
  error, with text status wording (`Present`/`Missing`/`Warning`/`Blocked`/
  `Unknown`/`Needs review`).
- **World preview** (Phase 4B) — embedded X_ITE canvas with viewpoint selector,
  Reset View, navigation mode, Refresh Preview, loaded-vs-missing counts, and a
  stale badge (see "World preview (Phase 4B)" above).
- **Actions** — Refresh Scan, Reveal Project Folder, Open Primary WRL in
  VSCodium, ← Mall Item workspace. No repair/delete/copy/rename/package/upload.

## Refresh

External edits are picked up on an explicit **Refresh Scan** only (no automatic
file watcher this lane). Scanning is single-flight (`session.js` refuses an
overlapping scan); a transient parse error keeps the last good result visible
(marked stale); scan time and status are shown.

## Not in this lane

Automatic path repair, asset copy/rename/delete, packaging, direct upload,
Apply/Bake transforms, Windows packaging — each needs its own approved lane. The
Phase 4B world preview is **analysis + display only**; it never repairs, copies,
packages, uploads, edits, or marks a project upload-ready.
