# Native WRL Editor + VRML97 Parser — Architecture Plan

Status: **PLAN ONLY** (Phase 7). No production editor or parser code ships in the
current lane unless separately approved after this architecture review. This
document is the design that Phases 7A–7D (see `docs/WRL_FORGE_ROADMAP.md`) build
against.

## Why

Per the locked product direction (2026-07-12), WRL Forge must eventually **function
without any external editor**. VSCodium stays as an *optional* "Open in External
Editor" integration, but a native editor + a real VRML97 parser are now a **beta
requirement**. X_ITE remains the ONLY renderer — this plan adds a *parser* and an
*editor*, **never a renderer**.

## Non-negotiable constraints (from `AGENTS.md` / `CLAUDE.md`)

- **No renderer.** X_ITE is the only approved rendering engine. The parser produces
  a syntax tree for analysis/editing; the preview keeps going through X_ITE via the
  existing `src/preview/` (Mall) and `src/world-project/preview-source.js` +
  `wrlworld://` (World) paths.
- **Renderer stays plain HTML/CSS/JS**, no UI framework/bundler (a framework
  migration is explicitly Deferred). The editor component must fit that model — see
  "Editor component strategy" for the dependency decision this forces.
- **No opportunistic dependencies.** Any editor library is a dependency decision
  that requires re-reading the "Mission" section of `AGENTS.md` first. The parser
  itself adds **zero** dependencies (pure Node/JS, like `validator.js` and the
  world-project modules).
- **Separate profiles.** Mall Item and World Project remain distinct. The parser is
  profile-neutral; validation/diagnostics layer the Mall vs. World rules on top of
  the shared tree. Never apply Mall rules to a World file or vice-versa.
- **Safety first.** Editing stays backup-first; no destructive auto-rewrites. The
  gzip-transparent `.wrl` model and the existing `.edit.wrl` disposable-sibling
  behavior are preserved (the native editor edits the working buffer; save repacks
  exactly as today).

---

## Part A — VRML97 Parser  ✅ SHIPPED (Phase 7A + 7A1)

**Status: implemented as a parser-only lane.** The design below was built out under
`src/vrml/` with zero new dependencies; see **`docs/VRML_PARSER.md`** for the
as-shipped grammar coverage, AST shape, diagnostic-code table, recovery strategy,
safety limits, asset-reference parity status, performance numbers, known
limitations, and the recommended Phase 7B editor-integration boundary. Part B
(the native editor) remains **PLAN ONLY**. Nothing in Part A changed any existing
production system (`validator.js`, World scanning, previews, packaging, VSCodium,
UI, save).

**Phase 7A1 corrected three real-corpus incompatibilities** found by independent QA
— internal `-`/`+` in identifiers, multiline strings (inline Script source), and
case-sensitive header encoding — and leniently accepts the pervasive
Cybertown/Blaxxun `ROUTE`/`PROTO`-inside-MFNode-array pattern (98.1% corpus
diagnostic reduction). **The flat, non-authoritative semantic scope is retained and
documented**: the future editor (7B+) must NOT surface `DEF`/`USE`/`ROUTE`
duplicate/unresolved diagnostics as authoritative until a scope-aware analysis lane
replaces the flat document scope (PROTO-body DEF leakage, cross-PROTO false
duplicates, USE-before-DEF, context-insensitive `IS`). See `docs/VRML_PARSER.md`
§ "Known unsupported semantics / limitations".

A real **tokenizer + structural parser**, not a regex approximation. Lives in a new
dependency-free module tree, e.g. `src/vrml/`:

```
src/vrml/
  tokenizer.js     UTF-8 char stream → token stream (with line/col spans)
  parser.js        token stream → syntax tree (VrmlNode/Field/Route/Proto…)
  ast.js           node/field/value type definitions + tree helpers
  diagnostics.js   Diagnostic {severity, code, message, span} model
  index.js         parse(text, {profile}) → { tree, diagnostics, defs, routes }
```

The parser is **pure and injectable** (text in, tree + diagnostics out — no fs, no
Electron), so it unit-tests against committed fixtures exactly like
`validator.js`/`package-plan.js`. Gzip is handled *outside* the parser (the main
process already decompresses to plain UTF-8 before anything sees the text; see
`src/files/vrml-file.js` and `readWrlSource`).

### A.1 Tokenizer

Emits tokens with a `{ line, column, offset, length }` span each (1-based line/col,
0-based offset) so every downstream diagnostic and outline entry has a precise
location. Token kinds:

- **Header** — the `#VRML V2.0 utf8` first line (and non-header `#` comments).
- **Comment** — `#` to end-of-line (retained as trivia, not dropped, so the tree can
  support future formatting round-trips).
- **Identifier / keyword** — node type names, field names, and the reserved words
  `DEF`, `USE`, `ROUTE`, `TO`, `IS`, `PROTO`, `EXTERNPROTO`, `TRUE`, `FALSE`, `NULL`.
- **Punctuation** — `{ } [ ] .` (field/node grouping; `.` for `ROUTE a.b TO c.d`).
- **Number** — VRML97 int32 (incl. `0x` hex) and float/double (incl. `e` exponent,
  leading `.`, signs); the tokenizer classifies, the parser coerces per field type.
- **String** — double-quoted with `\"` and `\\` escapes; multi-line tolerated;
  unterminated-string is a recoverable diagnostic.
- **Whitespace** — spaces, tabs, newlines, and commas (VRML97 treats `,` as
  whitespace inside MF values); retained as trivia for span accuracy.

Tokenizer errors (bad character, unterminated string) become diagnostics with a
span and the stream resynchronizes at the next newline/delimiter.

### A.2 Structural parser

Consumes tokens into a syntax tree. Grammar coverage (VRML97 / ISO-IEC-14772-1):

- **Header** node at the tree root; a missing/invalid header is a diagnostic, not a
  fatal stop.
- **Nodes** — `NodeType { field* }`, arbitrarily **nested node bodies** (SFNode /
  MFNode field values contain child nodes recursively).
- **Fields** — `fieldName value`, incl. `exposedField`/`eventIn`/`eventOut`/`field`
  when they appear inside `PROTO` interface declarations.
- **SF and MF values** — all VRML97 field types: `SFBool`, `SFInt32`, `SFFloat`,
  `SFTime`, `SFString`, `SFColor`, `SFVec2f`, `SFVec3f`, `SFRotation`, `SFImage`,
  `SFNode`, and their `MF*` list forms (`[ … ]`, comma-optional). **Vectors and
  rotations** parse as fixed-arity float tuples (Vec3f = 3, Rotation = 4, Color = 3)
  with arity diagnostics.
- **`DEF` / `USE`** — `DEF name Node…` records a definition in a scope table; `USE
  name` references it. Unknown `USE`, duplicate `DEF`, and forward/`USE`-before-`DEF`
  are diagnostics (see `DEF`/`USE` validation below).
- **`ROUTE`** — `ROUTE nodeA.eventOut TO nodeB.eventIn`, resolved against the `DEF`
  table; dangling endpoints are diagnostics.
- **`PROTO`** — `PROTO name [ interface-decls ] { body }`; the interface fields and
  the body (including nested nodes and `IS` mappings) parse into a proto-definition
  subtree. Instantiating a proto by name is recognized as a node type.
- **`EXTERNPROTO`** — `EXTERNPROTO name [ interface-decls ] [ "url" … ]`; URLs are
  captured as **asset references** (surfaced to the World asset graph, never
  fetched), matching the existing remote/local URL policy.
- **`Script`** — the `Script` node with `url` fields, and **inline script text**
  (`javascript:` / `vrmlscript:` bodies) captured as opaque string content with a
  span (not executed, not deeply parsed — consistent with today's
  `url-fields`/`url-policy` handling).
- **Comments, strings/escapes, numbers** — retained/normalized as above.

### A.3 Error recovery

The parser is **recovery-oriented** (like a language-server parser, not a compiler
that aborts on the first error): on an unexpected token it emits a diagnostic and
resynchronizes at the next safe boundary (`}`, `]`, or a top-level node start), so a
single typo yields **one** diagnostic and a still-usable partial tree — which is
what powers "last valid scene" preview behavior and inline squiggles while typing.

### A.4 Reusable syntax tree — consumers

One tree, many uses (all read-only over the tree unless noted):

| Consumer | Uses |
|---|---|
| **Syntax diagnostics** | tokenizer + parser diagnostics with line/column spans |
| **Scene outline** | node hierarchy + `DEF` names for a tree/outline panel |
| **Asset-reference discovery** | `url`/`ImageTexture`/`Inline`/`EXTERNPROTO`/`Script` URL fields → feeds the existing Mall texture-base + World asset-graph logic |
| **`DEF`/`USE` validation** | scope table: undefined `USE`, duplicate `DEF`, unused `DEF` (info) |
| **Navigation to definitions** | `USE`/`ROUTE`/`IS` endpoint → the `DEF`/interface span |
| **Future formatting** | trivia-preserving tree enables a canonical pretty-printer (not in 7A) |
| **Safe targeted edits** | span-anchored edits (e.g. a scale/offset write) without full-file rewrites |
| **Mall & World validation profiles** | `validator.js` (Mall) and the World profile layer their rules on the shared tree instead of re-scanning text |

**Migration note:** `validator.js` and `src/world-project/*` currently do targeted
text/URL scans. The parser does **not** rip those out; Phase 7A ships the parser +
tree alongside them, and later phases can progressively back the existing
diagnostics with the tree. No behavior change is bundled into 7A.

---

## Part B — Native Editor

A native editing surface so the app works without VSCodium. It edits the same
working buffer the app already manages (Mall `.edit.wrl`; World primary/opened file
via the read-only resolver + an explicit editable buffer), and saving repacks
through the existing gzip-transparent, backup-first path.

### B.1 Required capabilities (Phase 7B/7C)

- Plain **and** gzip `.wrl` (gzip decompressed in main, edited as plain UTF-8).
- Line numbers; selection + keyboard navigation; search **and** replace.
- Undo/redo; bracket/brace matching.
- VRML97 **syntax highlighting** (driven by the tokenizer).
- **Diagnostics** with line/column positions (driven by the parser), shown inline +
  in a list, debounced.
- **Safe save with backup** (reuse the existing `backupPath` + repack flow); **dirty
  state** tracking; **reload/conflict handling** when the on-disk file changes under
  an unsaved buffer.
- Mall Item **and** World Project contexts (correct profile + preview wired per lane).
- **Optional** "Open in External Editor" — kept, never required.
- **Preview refresh from the current editor buffer** (Phase 7C): the embedded X_ITE
  preview re-renders from the *unsaved* buffer via debounced parsing + last-valid
  scene, reusing `src/preview/` and the `wrlworld://` world path — no new renderer.

### B.2 Editor component strategy (open decision for the review)

The renderer is intentionally framework-free, and adding a UI framework/bundler is
Deferred. Three candidate approaches, in recommended order:

1. **Vendored, dependency-light editor core (recommended to evaluate first).** A
   small MIT-licensed editor (e.g. CodeMirror 6 core modules) vendored as local
   `file:` assets under the CSP, with a **hand-written VRML97 language mode** fed by
   our tokenizer. Pro: mature editing/undo/search/selection for free. Con: it's a
   dependency — **must** clear the `AGENTS.md` "Mission" dependency gate and the
   strict CSP (no CDN; all assets local, no remote fetch), and must not drag in a
   bundler. Decide at the review whether this counts as an approved editor lane the
   way `x_ite` was approved as the renderer lane.
2. **Minimal custom editor** on a `<textarea>`/`contenteditable` overlay with a
   tokenizer-driven highlight layer, gutter, and our own undo stack. Pro: zero deps,
   fully in-house, matches the plain-JS ethos. Con: we re-implement selection/undo/
   search correctness (real work; accessibility + large-file performance are the
   risk areas called out in Phase 7D).
3. **Status quo / external only** — rejected for beta: it violates decision (5)
   (must function without an external editor).

**Recommendation:** spike option 1 behind the dependency gate; fall back to option 2
if the gate/CSP/bundler constraints don't cleanly hold. This choice is explicitly
deferred to the architecture review, not made here.

### B.3 What the editor does NOT do

No rendering (X_ITE only), no networking/upload, no auto-formatting-on-save in 7B,
no destructive auto-rewrites (all saves backup-first), and no direct-upload hooks.

---

## Recommended Phase 7A scope (parser-only, shippable slice)

The smallest independently-valuable, low-risk first lane — **parser + tests, no
UI**:

1. `src/vrml/tokenizer.js` — full VRML97 token set with line/col spans + recoverable
   tokenizer diagnostics.
2. `src/vrml/parser.js` + `ast.js` — nodes, fields, SF/MF values, nested bodies,
   `DEF`/`USE`, `ROUTE`, `PROTO`, `EXTERNPROTO`, `Script`/inline script text,
   comments/strings/numbers/vectors/rotations, with error recovery.
3. `src/vrml/diagnostics.js` + `index.js` — `parse(text, {profile})` →
   `{ tree, diagnostics, defs, routes, assetRefs }`.
4. **Fixture corpus** from *real* VRML97 files — Mall items and World projects,
   plain and gzip (decompressed before parsing) — under `test/fixtures/vrml/`,
   including deliberately malformed files to lock error-recovery behavior.
5. `test/vrml/*.test.js` — tokenizer spans, each grammar construct, `DEF`/`USE` +
   `ROUTE` resolution, asset-reference extraction parity with the existing
   URL-field scanners, and recovery (one typo → one diagnostic, tree still usable).
6. Wire `node --check` for the new files into the `check` gate; **no** production
   editor UI, **no** changes to `validator.js`/world-project behavior in 7A.

Deliverable: a proven, dependency-free parser + tree that Phases 7B/7C build the
editor, highlighting, diagnostics, outline, and buffer-driven preview on top of —
with the editor-component dependency decision (B.2) made at the review, not before.
