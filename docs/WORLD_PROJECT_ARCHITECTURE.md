# World Project Architecture (Phase 4A)

The **World Project** lane is a read-only asset resolver and workspace for
Cybertown world projects. It promotes the proven Phase 3A recon logic (see
`docs/WORLD_PROJECT_RECON.md`) into production `src/world-project/`, wires it
behind confined main-process IPC, and renders it in a dedicated workspace page.

It is a **sibling** of the Mall Item lane, not an extension of it: World Project
analysis never applies Mall Item rules, and the Mall Item lane is unchanged.

**This lane is read-only.** It opens, scans, and reports. It does not repair
paths, copy/rename/delete assets, package, upload, or preview. World preview
(embedded X_ITE) is a later lane (Phase 4B), not part of this one.

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
| `world:describe` | Report the open project (for restoring the view). |
| `world:reveal` / `world:revealRoot` | Reveal a path in the OS file manager, **confined to the project root** and only if it exists. |
| `world:openPrimaryInEditor` | Explicit-only VSCodium launch on the primary (opening a project never auto-launches the editor). |

There is **no write-capable World Project IPC**. `contextIsolation: true` /
`nodeIntegration: false` are unchanged; the `world.html` page carries a strict
CSP with no remote origin and no wasm (no preview engine loads here). The
`session.webRequest` remote-request guard from the Mall lane remains installed
process-wide.

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
- **Actions** — Refresh Scan, Reveal Project Folder, Open Primary WRL in
  VSCodium, ← Mall Item workspace. No repair/delete/copy/rename/package/upload/
  preview.

## Refresh

External edits are picked up on an explicit **Refresh Scan** only (no automatic
file watcher this lane). Scanning is single-flight (`session.js` refuses an
overlapping scan); a transient parse error keeps the last good result visible
(marked stale); scan time and status are shown.

## Not in this lane

World X_ITE preview, automatic path repair, asset copy/rename/delete,
packaging, direct upload, Apply/Bake transforms, Windows packaging — each needs
its own approved lane. World preview is the proposed **Phase 4B**.
