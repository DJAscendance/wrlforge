# WD0 — Discovery Report: WRL Forge 2026 Visual Authoring Upgrade

**Phase:** WD0 — research, archival inspection, architecture discovery, planning only.
**Date:** 2026-08-06
**Repository:** `~/Projects/cybertown/wrlforge` @ `0f1fb9d` (branch `main`, clean)
**Companion documents:** `GPL_PROVENANCE_BOUNDARY.md`,
`WD1_LOSSLESS_DOCUMENT_CORE_PLAN.md`, `WHITE_DUNE_WRLFORGE_FEATURE_MATRIX.csv`,
`VRML97_NODE_SUPPORT_MATRIX.csv`

---

## 1. Executive summary

Three findings determine the shape of this programme.

**1. WRL Forge's parser is already a lossless document foundation — this was not
previously known.** The Phase 7A tokenizer attaches whitespace, comma, and comment
trivia to every token with exact spans. Reconstructing source from the token stream is
**byte-exact on 53/53 parseable fixtures, 0 mismatches**. Combined with the exact
`range` already on every AST node, this means WRL Forge needs **span-anchored text
patching, not a CST and not a serializer**. Text outside an edit is never touched, so
losslessness is structural rather than a feature to build and defend. This removes what
would otherwise have been the largest and riskiest piece of work.

**2. The node metadata problem is already solved, license-cleanly, inside
`node_modules`.** `x_ite.d.ts` — MIT, already a root dependency — declares **all 54/54
VRML97 nodes** with **472** typed fields including access types. The local ISO mirror
supplies **314 normative declarations across 54/54 nodes**. Together they give a
complete typed schema **with zero GPL contact**. The gap between them is the exact
strict-mode filter the brief asks for: X_ITE exposes **206 X3D-only fields** across
those same nodes that must not leak into a VRML97 export.

**3. White Dune's source *is* available locally — which raises the licensing stakes,
not lowers them.** The `.deb` Ryan expected is **binary-only** (9 files, no source, no
`Source:` field). But a separate `white_dune-1.930.zip` in `~/Downloads` is the **full
GPL source distribution** (3,285 files, 1,291 C/C++ sources), and White Dune 1.930 is
**installed** at `/usr/local/bin/dune`. The license is **GPL-2.0-or-later**; WRL Forge
is **MIT**. These are incompatible. Because real source is sitting on disk, the
clean-room boundary must be explicit and enforced rather than theoretical.

**The gap is narrower than expected.** WRL Forge already has the parser, spans, trivia,
recovery, an embedded X_ITE viewport, an unsaved-buffer live preview with no temp file,
viewpoint preservation, atomic verified saves, hash-based conflict detection, and a
disciplined security boundary. What is missing is a **write path** (there is no
serializer of any kind), **stable node identity**, **scope-correct DEF/USE**, and the
**GUI surfaces** themselves.

**Recommended next lane: WD1, scoped to the write foundation, with identity behind a
prototype gate.** First three PRs in §11.

---

## 2. Session and Git truth

Verified at session start and unchanged since:

```
branch:    main
HEAD:      0f1fb9d  Merge pull request #3 from DJAscendance/release/v1.3.0-beta.3-public
status:    clean  (git status --short → empty)
remote:    origin  https://github.com/DJAscendance/wrlforge.git (fetch/push)
worktrees: 1 — /home/ryan/Projects/cybertown/wrlforge  [main]   (no linked worktrees)
tests:     584 total, 584 pass, 0 fail   (node scripts/run-tests.js)
```

**The working tree was clean on arrival**, so the instruction to preserve unrelated
dirty/untracked files had nothing to protect. No file outside
`docs/white-dune-2026/` was created, modified, or deleted in this repository.

Recent history for context: `7909c2c` relicensed the project **MIT** (PR #1), `c916d7e`
fixed Linux desktop file opens, `ef85b81` prepared **1.3.0-beta.3**.

---

## 3. White Dune artifacts: provenance

### 3.1 What was searched

| Check | Result |
|---|---|
| Exact expected path `~/Downloads/wdune_1.956-1_amd64.deb` | **found** |
| `find ~/Downloads -maxdepth 2` for `*dune*` | found the above **plus `white_dune-1.930.zip`** |
| `dpkg-query -W 'wdune*'`, `'*dune*'`, `dpkg -l \| grep -i dune` | **no packages installed** |
| `snap list` | snap not installed |
| `command -v dune wdune white_dune whitedune dune4kids` | only `/usr/local/bin/dune` |
| `apt-cache show wdune` | `E: No packages found` |
| `dpkg -S /usr/local/bin/dune` | not owned by any package |

### 3.2 The three artifacts

| | **Source zip** | **Debian package** | **Installed binary** |
|---|---|---|---|
| Path | `~/Downloads/white_dune-1.930.zip` | `~/Downloads/wdune_1.956-1_amd64.deb` | `/usr/local/bin/dune` |
| Version | **1.930** | **1.956-1** | **1.930** (`--version`) |
| Bytes | 46,894,963 | 14,540,944 | 60,679,888 |
| SHA-256 | `96f6ab4120df94fa79de9855446472ab4a4eb31c8209aacfadf793952c8b2440` | `98da0e734d8c2046a80c5992edccdb24287d5e0ddc8ad6e6aa92abc7140a7396` | — |
| `file` | Zip archive (stored) | Debian binary package 2.0, xz | ELF 64-bit PIE, not stripped |
| Contents | 3,285 files; **1,291 C/C++ sources+headers**; 338 `Node*.cpp` | **9 files** | — |
| Origin date | 2020-07-22 | 2020-09-02 | installed 2026-07-15 |

**The versions differ.** The installed binary and the source are **1.930**; the `.deb`
is **1.956-1**. No source for 1.956 exists locally. Claims in these deliverables about
*implementation* come from the **1.930 source**; claims about *packaging and
dependencies* come from the **1.956 `.deb`**. They are labelled accordingly.

### 3.3 Was actual source code available? — **Yes, but not from the `.deb`**

The `.deb` contains, in full:

```
usr/bin/dune                                109,306,368 bytes  (statically-linked)
usr/bin/gitview.sh, run_dune_and_aqsis.sh, run_dune_and_povray.sh
usr/share/applications/dune.desktop, dune4kids.desktop
usr/share/pixmaps/dune.png, dune4kids.png
usr/share/white_dune/shaders/phong.slx      (RenderMan shader)
```

No source, no docs, no man pages, no examples, **and no `Source:` field** in its
control file. It is a pure binary package.

> **The `.deb` must not be described as White Dune's source repository.** What *is*
> the source is the separate `white_dune-1.930.zip`, which Ryan already has. Nothing
> further needs downloading. If exact **1.956** behaviour ever matters, the missing
> artifact is the upstream `white_dune-1.956` source tarball — **do not fetch it
> without approval.**

### 3.4 Installed-package findings

`/usr/local/bin/dune` is White Dune, **manually installed** (root-owned, in
`/usr/local`, owned by no package — consistent with `make install` from the 1.930
source). Identity confirmed two ways: `strings` shows `VrmlScene`, `PureVrmlH`,
`X3domExpH`, `<!DOCTYPE X3D PUBLIC`; and `dune --version` prints `white_dune 1.930`.

Two White Dune helper scripts sit beside it (`run_dune_and_aqsis.sh`,
`run_dune_and_povray.sh`, both dated 2020-07-22).

The single `--version` invocation ran under a throwaway `HOME`, **created no files**,
and did not touch Ryan's real White Dune preferences. No GUI was launched. Nothing was
installed, removed, or altered. `dune --help` is **not supported** (`No such file or
directory: --help`) — CLI capabilities were therefore read from `man/dune.1` in the
source tree instead of by execution.

### 3.5 Dependency and toolkit findings

From the `.deb` control file:

```
Depends: gimp, gpaint, audacity, gedit, git, lxterminal, imagemagick, aqsis,
         ttf-bitstream-vera, xfonts-base, view3dscene, mencoder, freeglut3-dev,
         povray, mjpegtools, vpx-tools, kdialog, awk, bash
Suggests: freewrl, meshlab, wings3d
```

- **Rendering:** OpenGL via `freeglut3-dev`; offline rendering via `povray`/`aqsis`.
- **GUI toolkit:** the source contains an `swt` directory; `man/dune.1` describes
  "3 different GUIs" and Motif-era desktop integrations
  (`desktop/{cde,fvwm2,irix,twm,kde,xfce,macosx,olpc,debian}`).
- **Architectural contrast worth noting:** White Dune *integrates by spawning desktop
  applications* — GIMP for textures, gedit for text, Audacity for audio, kdialog for
  prompts, lxterminal for shells. WRL Forge deliberately moved the other way: Phase 7B1
  **removed** the passive VSCodium launch, and the native editor exists precisely so the
  product does not depend on other installed apps. **Do not reintroduce spawn-based
  integration.**

---

## 4. WRL Forge architecture: verified findings

Every claim below was read from the implementation, not inferred from filenames.

### 4.1 Runtime and boundaries

Electron. `main.js` (1,263 lines) owns every filesystem path; `preload.js` exposes the
`window.vrmlpad` bridge (kept for stability); the renderer sends `{sessionId, text}` and
**never a path** (`preload.js:53-55`). Path authorization is centralised in
`src/editor/path-authorizer.js`; nested world reads are confined to the `wrlworld://`
scheme. IPC surface: **18 `editor:*` channels, 12 `world:*` channels**.

### 4.2 The VRML97 parser (`src/vrml/`, 1,171 lines)

Dependency-free, pure, profile-neutral, token-driven recursive descent.

- **`tokenizer.js` (349)** — the critical finding. `leadingTrivia` on every token
  captures whitespace, VRML's comma-as-whitespace, and comments, each with exact
  `{offset,line,column}` spans and original lexemes. CRLF and lone CR are handled
  exactly. **Verified byte-exact round-trip on 53/53 fixtures.**
- **`parser.js` (512)** — recovery-oriented like a language server: one malformed field
  gives one diagnostic and a usable partial tree, resyncing at `}`/`]`/next statement.
  Bounded (`maxDepth 256`, `maxNodes 100000`) with guaranteed loop progress. Leniently
  accepts Cybertown/Blaxxun `ROUTE`/`PROTO` inside MFNode arrays (`parseArray`).
- **`ast.js` (94)** — plain objects with a `type` discriminator; **`range` on every
  node**. `walk()` deliberately skips `leadingTrivia`.
- **`analyze.js` (89)** — DEF/USE/ROUTE index. **Flat scope, and its own header says so**
  (`analyze.js:9`).
- **`index.js` (57)** — façade splitting `syntaxDiagnostics` (authoritative) from
  `semanticDiagnostics` (advisory).

**The parser has exactly one production consumer: `src/editor/language.js`.** It is not
wired into `validator.js`, World scanning, preview resolution, packaging, or URL
extraction — consistent with `CLAUDE.md`.

### 4.3 There is no serializer — confirmed

A grep for `serialize|stringify|unparse|emit|toSource|toText|format` across `src/`,
`main.js`, `validator.js`, and `renderer/*.js` returns only unrelated matches
(`formatFromGzip`, `formatLabel`, `serializeScan` — a scan-graph JSON helper). **Nothing
converts a tree back to VRML text.** Every write is `fs.writeFileSync(path, text)` of
text the app never generated.

This is the single largest functional gap, and also why WRL Forge is currently lossless
by construction.

### 4.4 Document state and mutation

`src/editor/wrl-document.js` (78 lines) is a **plain-text** descriptor:
`{sourcePath, format, baseline, text, stat}`. Dirty is *derived* (`text !== baseline`),
never stored. There is **no tree, no node identity, and no semantic mutation model**.

**Undo/redo** is CodeMirror 6 `history()` in the renderer
(`src/editor/browser/editor-view.js:199`) — text-level only. §4.10 explains why this is
an asset.

### 4.5 File I/O — a genuine strength

`src/editor/file-io.js` (213): external-change detection by size + mtime + **SHA-1
content hash** (hash is the tiebreaker, so an identical rewrite is not a conflict);
`safeSave` does encode → conflict-guard → temp sibling → `fsync` → **decode-verify** →
timestamped backup → atomic rename, and never leaves a half-written destination.
Gzip round-trips exactly; a gzip source is never silently rewritten as plain.

### 4.6 Preview (Phase 7C)

X_ITE **15.1.10** embedded, the only approved renderer. `src/preview/buffer-overlay.js`
(398) provides a session-scoped, **byte-substitution-only** overlay that requires an
authorization proof and never authorizes a path — this is how the **unsaved buffer**
previews with **no temp file**, for both Mall and World. `preview-state.js` keeps the
last valid scene; `preview-scheduler.js` debounces at 700 ms with an injected clock;
`viewpoint-preserve.js` restores camera by DEF → description → index → first → default.

**This is the mechanism a GUI editor needs, already built and accepted on Linux and
Windows 11.**

### 4.7 Profiles

**Mall Item** — `validator.js` (135 lines), **regex-based, not parser-based**: header,
`WorldInfo`, 80 KB gzip cap, forbidden nodes (`Inline`, `EXTERNPROTO`, `Sound`,
`DirectionalLight`, H-Anim), no external URLs, ≤1 `ImageTexture`, DEF/USE integrity,
advisory bbox. **World Project** — `src/world-project/` (9 modules): cycle-safe asset
graph, case-mismatch detection, bounded traversal, ZIP bundle via Node `zlib` only.
Read-only except the single explicit bundle action.

### 4.8 Node metadata — absent in WRL Forge, available in `node_modules`

No node table, no field-type schema. The only node-type knowledge anywhere is
`src/preview/bbox-traversal.js` hardcoding a handful of names for fit math, and
`src/world-project/url-fields.js` matching url-bearing fields **lexically by regex**.

But `node_modules/x_ite/dist/x_ite.d.ts` (23,857 lines, 362 `*Proxy` interfaces)
declares **54/54** VRML97 nodes, from which **472 fields** were machine-extracted with
name, VRML type, and access type:

```
Transform:  ('center','SFVec3f','inputOutput')  ('children','MFNode','inputOutput') …
TimeSensor: ('cycleInterval','SFTime','inputOutput')  ('startTime','SFTime','inputOutput') …
```

`X3DUOM.xml` also ships but is **only an extension delta** — 31 nodes, 6 overlapping
VRML97 — not the full model. **Use `x_ite.d.ts`, not `X3DUOM.xml`.**

### 4.9 Standards material

The ISO mirror at
`/home/ryan/Projects/cybertown/wb-ct-scrape/specs/iso-14772-vrml97` (both parts, `raw/`
HTML + `markdown/`, with `manifest.jsonl` checksums) yields the authoritative **54**
node names from clause 6 and **314 normative field declarations across 54/54 nodes**.

One caveat for tooling: the markdown layer is lossy for at least `Shape`, whose
declaration renders as `**Shape {**` outside its code fence and defeats a naive
extractor — `Shape` does have exactly two VRML97 fields (`appearance`, `geometry`). Any
generator must handle both forms and assert its own coverage.

### 4.10 Tests

**584 tests, 584 pass, 0 fail.** 60 test files. Fixtures are byte-pinned via
`.gitattributes` (`-text` on `test/fixtures/**`) so gzip and CRLF twins survive
cross-platform. **25 of 54** VRML97 nodes appear in a fixture; 29 do not.

---

## 5. Major reusable foundations

| Foundation | Why it matters for visual authoring |
|---|---|
| **Trivia-preserving tokenizer with exact spans** | Makes lossless editing structural. Removes the need for a CST. |
| **`range` on every AST node** | Every GUI edit can target an exact byte span. |
| **Recovery-oriented parser** | A half-typed field still yields a usable tree — required for live GUI sync. |
| **Buffer overlay (7C)** | GUI edit → live preview with no temp file, already accepted on two platforms. |
| **Viewpoint preservation** | A gizmo drag must not reset the camera. Already solved. |
| **`safeSave` + hash conflict detection** | Authoring generates far more writes; this path is already conservative. |
| **CodeMirror `history()`** | If GUI edits are dispatched as CodeMirror transactions, undo/redo unifies with typing **for free**. |
| **`x_ite.d.ts` (MIT)** | Complete typed node schema with no GPL contact. |
| **Local ISO mirror** | Normative VRML97 truth and the strict-mode filter. |
| **Pure-module discipline + 584 tests** | Every new core module is unit-testable in Node without Electron. |

---

## 6. Major architectural gaps

| # | Gap | Impact | Addressed in |
|---|---|---|---|
| G1 | **No serializer / write path** | Nothing can change a document programmatically | WD1 (as *patching*, not serialization) |
| G2 | **No stable node identity** | GUI selection cannot survive an edit | WD1.4 — **prototype gate** |
| G3 | **Flat semantic scope** | DEF/USE/ROUTE/IS not trustworthy; renames unsafe | WD1.5 |
| G4 | **No node/field schema wired in** | No typed inspector, no palette, no ROUTE validation | WD1.3 (generate from x_ite.d.ts + ISO) |
| G5 | **No viewport picking** | X_ITE preview is display-only; no selection, no gizmos | WD4 |
| G6 | **No profile enforcement on write** | X3D-only fields could leak into VRML97 export (**206 identified**) | WD1.3 + WD1.6 |
| G7 | **`validator.js` is regex-based** | Two parallel notions of "valid" | **out of scope** — needs its own lane |
| G8 | **Fixture coverage 25/54 nodes** | Node-specific regressions could pass CI | grow alongside WD3+ |

---

## 7. Key risks

1. **Identity (G2) is the only genuinely hard problem in WD1.** Everything else is
   mechanical. A wrong anchor silently edits the wrong node — strictly worse than
   losing the selection. **Mitigation:** prototype gate with a zero-wrong-anchor
   requirement; fallback to DEF-name-only identity.
2. **Scope correction (WD1.5) is user-visible.** It promotes VRML040–044 from advisory
   to authoritative. On a corpus where 7A1 achieved a 98.1% diagnostic reduction, a
   regression means the scope model is wrong, not the corpus.
3. **Scope creep into `validator.js`/World/packaging.** `CLAUDE.md` forbids routing
   these through the parser without an approved lane. Consolidation is tempting and
   must be resisted.
4. **X3D leakage (G6).** Quantified at 206 fields. Must be enforced at the write path,
   not in the UI, or it will eventually be bypassed.
5. **GPL contamination.** Real source is on disk. **Mitigation:** the archive lives
   outside all repos; node metadata comes from MIT sources; see
   `GPL_PROVENANCE_BOUNDARY.md`.
6. **Ambition vs. the locked product decisions.** No direct upload, X_ITE is the only
   renderer, no third-party archive library, runtime deps stay `x_ite`-only. A visual
   authoring environment invites violating all four.
7. **Windows parity cost.** Every GUI surface must be re-verified on Windows 11 through
   `VisualQaRunner` with the file-based capture transport and the workspace guard.

---

## 8. Recommended product direction

**Build the authoring GUI as a set of views over the text buffer — never as a parallel
model.**

Concretely: the document stays text; the tree, inspector, and viewport are *projections*
of a parse; and every GUI action becomes a **span-anchored patch applied as a CodeMirror
transaction**. The code editor updates because it *is* the document; undo unifies
because CodeMirror already tracks it; the preview updates because the 7C overlay already
watches the buffer. The brief's "unified source of truth" requirement is then satisfied
by construction rather than by synchronisation code — and no new IPC channel, CSP
change, or renderer is required.

Two supporting positions:

- **Standards handling should be a write-time gate, not a UI convention.** Profile
  (VRML97 / X3D / Mall / World) is checked where patches are produced, so an X3D-only
  field cannot reach a VRML97 document by any path.
- **Keep White Dune as a capability map, not an architectural model.** Its UI
  vocabulary is worth borrowing — `SceneTreeView`, `FieldView`, `ChannelView` (animation
  channels), `NodeLabView` (ROUTE canvas), `Scene3DView`. Its *implementation* model —
  tree-as-truth, whole-file rewrite on save, spawn-the-desktop integration, NURBS
  modelling, C/Java codegen, spaceball and shutterglasses — is either wrong for this
  product or obsolete. The feature matrix marks 8 capabilities `REJECT`.

---

## 9. Evaluation of the proposed WD1–WD9 sequence

> **Owner decision, 2026-08-06: the amendment and both scope changes below were
> APPROVED, with one refinement — see §14.** The approved sequence is
> `WD1-Read → WD2 → WD1-Write → WD3 → WD4`. Mesh modelling is reduced rather than
> dropped outright: no *general* mesh-modelling system, but focused `IndexedFaceSet`
> editing is retained.

**Verdict: approved in substance, with one structural amendment and two scope changes.**

**Amendment — split WD1, and put WD2 inside the split.** As written, WD1 conflates the
*read* side (spans, identity, scope) with the *write* side (patching, transactions).
WD2 (read-only tree) needs only the read side and carries no write risk. Recommended:

```
WD1-Read   source-map, node identity, scope-aware DEF/USE/IS     ← includes the hard part
WD2        read-only scene tree + selection sync                 ← proves identity on real files
WD1-Write  patch algebra, node schema, transaction layer
WD3        typed inspector, one editable field family
```

This surfaces the riskiest problem (identity) against real user interaction **before**
any write capability exists, and delivers something visible sooner. The slice table in
`WD1_LOSSLESS_DOCUMENT_CORE_PLAN.md` §9 is ordered so the pure, zero-risk work
(WD1.1–WD1.3) can land regardless of how this is decided.

**Scope changes:**

- **WD6** — no general mesh-modelling system. White Dune's own `README.txt` concedes its
  mesh features "can not compare" to dedicated modellers, and WRL Forge's users are
  editing existing Cybertown content, not modelling from scratch. **Retain the practical
  VRML-native tools**: primitives, `Transform`, `Material`, textures, `Extrusion`, and
  focused `IndexedFaceSet` editing. *(Owner-refined: the original recommendation was to
  drop mesh editing entirely; targeted `IndexedFaceSet` work is in scope.)*
- **WD9** — X3D support means `.x3dv` classic encoding first (the tokenizer's `#VRML`
  header check is the single blocking point) and XML `.x3d` only if there is real
  demand. Not the full X3D 4.0 surface.

**Otherwise the ordering is sound**: it moves from read to write, from scalar fields to
structure, and from static to animated — each step depending only on the ones before it.

---

## 10. Safest first vertical slice

**A read-only scene tree with bidirectional selection sync** — click a tree node,
the editor selects its source span; move the cursor, the tree highlights the enclosing
node.

Why this one:

- **Zero write risk.** No patching, no serializer, no possibility of corrupting a file.
- It exercises **exactly** the machinery WD1 must get right — spans, identity,
  re-anchoring after a text edit — under real use, where the failure mode is a wrong
  highlight rather than a wrong edit.
- Every input already exists: `buildOutline()` produces span-anchored entries today.
- It is immediately useful on 70-texture Cybertown worlds even with no editing at all.

---

## 11. Recommended first three PRs

Additive, pure, unit-testable in Node, touching no existing behaviour. See
`WD1_LOSSLESS_DOCUMENT_CORE_PLAN.md` §9 for detail.

1. **WD1.1 — round-trip contract test + `src/vrml/source-map.js`.** Promotes WD0's
   ad-hoc byte-exactness check into a permanent CI guard, then adds offset ⇄ token ⇄
   node lookup. Locks in the property the whole design rests on before anything can
   erode it.
2. **WD1.2 — `src/vrml/edit.js` patch algebra + property tests.** Overlap detection,
   deterministic ordering, offset remapping. Pure string in/out, zero callers.
3. **WD1.3 — `scripts/build-node-schema.js` + committed `src/vrml/node-schema.js`.**
   Generated from `x_ite.d.ts` + the ISO mirror, asserting 54/54 nodes and ≥314
   declarations, with every X3D-only field tagged. Unblocks WD3 and proves the
   license-clean metadata path end to end.

---

## 12. Validation performed

| Check | Result |
|---|---|
| WRL Forge source files changed | **none** — all writes confined to `docs/white-dune-2026/` |
| Dependencies / lockfiles changed | **none** — `package.json`, `package-lock.json`, `node_modules/` untouched |
| System packages installed/removed | **none** — no `apt`, no `dpkg -i`, no `snap`, no `sudo` |
| White Dune files copied into WRL Forge | **none** — archive is `~/Projects/white-dune-archive/`, outside all repos |
| Originals preserved | `~/Downloads/*.deb` and `*.zip` untouched; extraction read-only |
| `git diff --check` | clean (no whitespace errors, no conflict markers) |
| `git status --short` | only the 5 new untracked files under `docs/white-dune-2026/` |
| Test suite | **584 pass / 0 fail** — unchanged from baseline |
| CSV consistency | both files validated: required columns present, row counts and quoting checked |
| Commits / pushes / tags / PRs | **none** |

### Commands that could not be run

- **`dune --help`** — unsupported by the binary (`No such file or directory: --help`).
  CLI capabilities were read from `man/dune.1` in the 1.930 source instead.
- **`sha256sum` of `/usr/local/bin/dune`** — deliberately skipped; root-owned system
  file, and the version was already established by `--version`.
- **Fetching White Dune 1.956 source** — deliberately not attempted; requires approval.
- **Browser QA** — not needed; no existing WRL Forge capability required visual
  verification for this phase.

### Confidence labelling

Every capability claim carries its evidence in the matrices. White Dune capabilities are
marked `confirmed` (40), `probable` (6), or `not_found` (12) — `probable` means the
capability is implied by a dialog/class name but not stated in `man/dune.1` or
`README.txt`. WRL Forge claims are all `confirmed` against a file path or command
output, except `confirmed-external` (3), which means the capability exists in a
dependency or standards mirror rather than in WRL Forge itself.

---

## 13. Licensing and provenance risks

Full treatment in `GPL_PROVENANCE_BOUNDARY.md`. Summary:

1. **License incompatibility is the headline risk.** White Dune is
   **GPL-2.0-or-later** (1,241 source files carry the v2-or-later header; `man/dune.1`
   confirms; © Stephen F. White 1999–2002 and others). WRL Forge is **MIT**. Copying,
   adapting, or transliterating would oblige relicensing the product under the GPL.
2. **Source is physically present**, so the risk is real rather than hypothetical.
   Mitigated by keeping the archive outside every repository and by sourcing all node
   metadata from MIT/standards material.
3. **Fixtures are a quiet trap.** White Dune ships example `.wrl` scenes; they are GPL
   content and must never enter `test/fixtures/`.
4. **Attribution should be minimal and accurate.** A historical-prior-art
   acknowledgement in docs is appropriate. Adding White Dune to
   `THIRD_PARTY_NOTICES.md` would be **wrong** — that file lists code WRL Forge ships.
5. **No licensing obligation was created during WD0.** Nothing was copied, linked,
   redistributed, or published.

---

## 14. Owner-approved decisions (Ryan, 2026-08-06)

**WD0 is approved.** The following are the recorded, owner-approved direction for this
lane. They supersede the recommendations elsewhere in this document wherever they differ.

1. **WRL Forge stays MIT** for now.
2. **White Dune remains an isolated GPL-2.0-or-later historical reference.**
3. **No White Dune source, fixtures, algorithms, icons, or implementation code** may be
   copied, adapted, translated, or imported into WRL Forge.
4. **VRML97 behaviour derives from ISO/IEC 14772; node metadata derives from the
   MIT-licensed X_ITE material** already available to WRL Forge.
5. **Revised sequence APPROVED:**
   `WD1-Read → WD2 (read-only scene tree + selection sync) → WD1-Write → WD3 (typed
   field inspector) → WD4 (viewport transform editing)`.
6. **Stable node identity has a hard safety gate:** zero wrong anchors; losing a
   selection is acceptable; selecting or editing the *wrong* node is never acceptable;
   **uniquely named `DEF` nodes are the approved fallback** if general structural
   identity cannot meet the zero-wrong-anchor bar.
7. **`validator.js`, World scanning, packaging, and preview resolution stay out of this
   lane** (G7 confirmed out of scope).
8. **VRML040–VRML044 do NOT become authoritative yet.** Scope-aware diagnostics must
   first be tested against the real Cybertown corpus and reviewed separately.
   *(This revises the WD1.5 recommendation — the scope model is still built, but the
   diagnostics stay advisory until that review.)*
9. **Reduced product scope approved:** no general mesh-modelling system; retain the
   practical VRML-native tools (primitives, `Transform`, `Material`, textures,
   `Extrusion`, focused `IndexedFaceSet` editing); `.x3dv` classic encoding before any
   XML `.x3d` consideration.
10. **`~/Projects/white-dune-archive/` stays outside Git.** The archive, source ZIP,
    Debian package, extracted files, binaries, and any other GPL content are never
    committed.

**Next lane: WD1.1 only.** Not started in the WD0 session.

---

## 15. Principal-engineer recommendation

WRL Forge is closer to a visual authoring environment than the scope of this brief
assumes, and the reason is a decision made back in Phase 7A: the tokenizer preserves
trivia and exact spans. That one choice means losslessness does not have to be built —
it has to be *not broken*. Combined with `x_ite.d.ts` supplying a complete typed node
schema under MIT, the two pieces that would normally dominate a project like this are
already in hand.

So the right move is **not** to build a CST, a serializer, or a scene-graph document
model. It is to treat the text as canonical, express every GUI action as a
span-anchored patch dispatched through CodeMirror, and let the code editor, the undo
stack, and the live preview follow for free. That design is smaller, safer, and matches
what the brief actually asks for — a GUI and a source editor operating on **one**
document — better than a tree-as-truth model ever could.

The single real unknown is **stable node identity across edits**. Everything else in
WD1 is mechanical work with obvious tests. I would put identity behind an explicit
prototype gate against the real Cybertown corpus, hold it to *zero wrong anchors*, and
be willing to ship DEF-name-only identity if the general case will not meet that bar —
a restricted feature that is always correct beats a general one that occasionally edits
the wrong node.

Start with the three pure PRs in §11. They are individually reviewable, carry no
integration risk, and the first of them permanently protects the property everything
else depends on.
