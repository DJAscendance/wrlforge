# World Project Recon (Phase 3A)

Read-only reconnaissance of real Cybertown world projects to establish how worlds
are actually structured and referenced — so the World Project profile is built on
confirmed constraints, not inherited assumptions. Every claim below is traceable
to evidence gathered by `qa/world-recon/` over the corpus.

> **Phase 4A update:** the recon logic documented here has been **promoted into
> production** at `src/world-project/` (resolver + read-only workspace); the
> `qa/world-recon/*` modules are now thin re-exports of it, and
> `npm run recon:world` still works. See `docs/WORLD_PROJECT_ARCHITECTURE.md`.
> The draft rules below remain **advisory** — the production profile reports
> confidence-tagged findings but enforces no hard gate (there is no
> packaging/upload step yet).

## Corpus examined

| Source | What it is | Scale |
|---|---|---|
| `campuscolony/ctgit-archive-master/places/` | Archived Cybertown places | **71 places**; 60 with a resolvable primary `.wrl` |
| `ctr/spa/assets/worlds/hitek_col/` | CTR (Cybertown Revival) bundled reference world | same `hi-tek` world, shipped as the submission reference |
| `hi-tek` place | Multi-asset reference world | 140 files, 3.1 MB; 5 `.wrl`, textures under `vrml/img/`, HTML under `content/` |

Recon tool: `node qa/world-recon/cli.js <root.wrl>` (add `--json` for the full
graph). It is pure Node — **no Electron, no rendering** — so it does not touch the
visual-QA guardrails.

## What worlds actually look like

- **Compression is mixed.** Of the first 200 archive `.wrl` files, **132 are gzip,
  73 are plain** VRML97. The loader must be gzip-transparent per file (magic-byte
  detection — `src/preview/wrl-source.js` already does this; recon reuses it).
- **Nested composition via `Inline`.** Worlds are not single files: `hi-tek.wrl`
  inlines `crater4.wrl`, `beam.wrl`, etc. (5 `.wrl` in the graph, nesting depth 1;
  nested children are themselves gzip). Traversal must follow `Inline`/EXTERNPROTO
  and be **bounded and cycle-safe** (recon caps at `maxWrlNodes`/`maxDepth`).
- **Paths are relative to each referring file's own directory**, POSIX-style
  (`img/wall.jpg`, `sound/engine.wav`, sibling `crater4.wrl`). Resolution must be
  per-file, not per-project-root.
- **Conventional layout:** `vrml/` (world `.wrl` + a local `img/` and `sound/`),
  plus sibling `content/`/`images/` HTML for in-world info panels.

## URL-field taxonomy (what the resolver must parse)

Confirmed field/value shapes in the corpus:

- **Field names are case-insensitive** and include suffix forms: `url`, `Url`
  (e.g. `Background { Url "img/city3.jpg" }`), and the standard `frontUrl`/… family.
- **Both MFString forms:** single `url "crater4.wrl"` and bracketed
  `url [ "a.jpg" "b.jpg" ]` (often spanning multiple lines).
- **Inline script pseudo-schemes:** `Script { url "vrmlscript: …" }` /
  `"javascript: …"` / `"ecmascript: …"` embed code, **not** a fetchable URL.
  hi-tek alone has **43** of these — they must be classified as inline script, not
  as remote references or missing files. (Recon initially miscounted them; fixed.)
- **Remote references** appear but are rare: hi-tek has exactly **1**
  (`http://cybertown.com/cgi-bin/cybertown/neighbor?ID=…`), an Anchor to a live
  CGI endpoint. These are surfaced, never followed.
- **Anchor → HTML** targets (`htm/…`, `.html`) are ordinary references and show up
  as `other`-kind assets.

## Confirmed constraint: the "~20 textures" limit is NOT a server rule

The old web submission form's ~20-texture guidance does **not** reflect an actual
world constraint. Evidence across the primary-`.wrl` graph of each place:

| Metric | Value |
|---|---|
| Places analyzed | 60 |
| Places with **>20** unique textures | **18** |
| Max unique textures (hi-tek) | **70** |
| Others over 20 | homes 48, convention 45, cafe 39, theatre 38, nightclub 34, enter 33, movies 33, cyberhood 30, amp 25, jail 24, … |

These counts are a **lower bound** — they count only textures reachable from each
place's primary world graph; textures referenced solely by non-primary `.wrl` files
in a place would push the totals higher. **Do not encode any fixed texture cap** in
the World Project profile; doing so would fail legitimate worlds.

## Draft World Project validation rules (NOT enforced)

Kept deliberately separate from `validator.js` (Mall Item rules). Each rule traces
to corpus evidence; enforcement is deferred to a later phase.

1. **Accept gzip and plain `.wrl`.** (Evidence: 132/73 split.) — *confirmed*
2. **Resolve every `url` relative to its referring file**, POSIX separators,
   case-insensitive field names, both single and MFString values. — *confirmed*
3. **Follow `Inline`/EXTERNPROTO composition with bounded, cycle-safe traversal.**
   (Evidence: nested gzip children; potential for cycles.) — *confirmed*
4. **No fixed texture/asset count limit.** Report counts; never fail on volume.
   (Evidence: up to 70+.) — *confirmed*
5. **Classify inline `vrmlscript:`/`javascript:`/`ecmascript:` as script, not a
   URL.** (Evidence: 43 in hi-tek.) — *confirmed*
6. **Flag used-but-missing local assets** and **case-only mismatches** (the author's
   Linux FS is case-sensitive; a case-sensitive target server will 404 a
   `Wall.JPG` reference to `wall.jpg`). No case mismatches were found in this
   corpus, but the check is required for cross-platform safety. — *check needed*
7. **Surface remote references** (rare, e.g. neighbor CGI links) without following
   them. — *confirmed*

## Open questions — explicitly UNRESOLVED (do not guess)

- **Real server package-size limit** for a world submission — unknown. Not derivable
  from the archive. Needs the current CTR submission process / operator confirmation.
- **Whether any texture/asset count limit exists at all** on the target server —
  no evidence of one; the ~20 figure is disproven as a hard rule, but the true
  ceiling (if any) is unconfirmed.
- **Supported texture/audio formats on the live renderer** — the corpus uses
  jpg/gif/png and wav; X_ITE support per format is a separate verification (and any
  such preview check must run through `npm run qa:visual`, never ad-hoc Electron).
- **Scott99 `worlduploader`/`itemuploader`** (3dgrove.com) — to be consulted as a
  historical *workflow reference only*; no code/asset copying without licensing.

## Recon tooling

- `qa/world-recon/url-fields.js` — full URL-field extraction (all MFString entries,
  case-insensitive fields, remote/local/inline-script classification).
- `qa/world-recon/asset-graph.js` — bounded, cycle-safe dependency graph:
  assets by kind, per-file-relative resolution, missing + case-mismatch diagnostics,
  remote refs surfaced. Fully unit-tested with injected fs (no real files).
- `qa/world-recon/cli.js` — `npm run recon:world -- <root.wrl> [--json]`.

Tests: `test/world-recon/` (non-visual, part of `npm test`).
