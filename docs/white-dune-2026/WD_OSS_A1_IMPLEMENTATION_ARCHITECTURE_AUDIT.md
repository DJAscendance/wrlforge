# WD-OSS-A1 — White Dune implementation & architecture audit

**Lane:** WD-OSS-A1 (research / architecture only)
**Date:** 2026-08-29
**Baseline:** `2eb7c39` (OSS-1, `chore: relicense WRL Forge under GPL-3.0-or-later`)
**Status:** research complete, **no production code changed, no upstream code imported**

> **What this lane is.** The first substantive lane after the GPL transition. It reads
> White Dune's implementation to decide what WRL Forge should learn from it *before*
> choosing the next implementation lane. It ports nothing. It changes no runtime
> behaviour. It does not start P4, WD2, or a Mac lane.

---

## 1. Provenance metadata

### 1.1 Artifacts inspected

| # | Artifact | Location | Nature |
|---|---|---|---|
| 1 | **white_dune 1.930 source** | `~/Projects/white-dune-archive/white_dune-1.930-source-evidence/extracted/white_dune-1.930/` | upstream source distribution, read-only, outside every Git repo |
| 2 | **white_dune upstream HEAD** | cloned to `/tmp/white-dune-current-audit/white_dune/` (scratch, **not** in WRL Forge, not a submodule, not committed) | `github.com/mufti11/white_dune`, commit **`62f9ab457004666143160909a7e348bf87c107e6`**, `Wed Sep 2 12:36:59 2020 +0200`, J. Scheurich, *"white_dune 1.956 update: minor bugfix: fixed X3D to C++ compiler"* |
| 3 | `wdune_1.956-1_amd64.deb` evidence | `~/Projects/white-dune-archive/wdune-1.956-deb-evidence/` | **binaries only, no source** — not used for architectural conclusions |

Artifact 3 was not used to draw any implementation conclusion. A `.deb` of statically
linked binaries proves nothing about implementation licensing or structure.

### 1.2 Upstream is dormant

Upstream `master` HEAD is **2020-09-02**. There are no tags and no branches other than
`master`. **White Dune has had no commit in roughly six years.**

This materially changes the strategic frame. White Dune is not an actively maintained
peer project to align with; it is a **large, finished, GPL-compatible implementation
corpus** to mine. There is no upstream to contribute back to, no roadmap to track, and
no maintenance stream that would keep a port in sync. Reuse decisions should therefore
be judged purely as *"is this code/idea worth owning permanently in WRL Forge?"*

### 1.3 Local 1.930 vs current upstream 1.956 — no material divergence

Structural comparison of the audit-relevant headers:

| file | 1.930 → 1.956 |
|---|---|
| `Command.h`, `CommandList.h`, `Proto.h`, `Path.h` | **identical** |
| `Scene3DView.h`, `SceneGraphView.h`, `FieldView.h`, `ChannelView.h`, `SceneTreeView.h` | **identical** |
| `Scene.h` | 18 changed lines |
| `Node.h` | 4 changed lines |

Whole-tree: **59 of ~1,300** `src/` files differ; the only files unique to upstream are
`src/nix`, `src/test.html`, `src/test.x3dv`, `src/Untitled.x2d` (scratch/dev leftovers).

**Conclusion: the local 1.930 archive is architecturally representative of current
upstream.** Every finding below applies to both unless stated otherwise.

### 1.4 License — verified per artifact, and it is **not uniform**

`OPEN_SOURCE_PROVENANCE.md` §2.1 warns not to assume uniform licensing. That warning is
**correct and load-bearing**, and this audit found the concrete instances.

Census over `src/` (`*.c`, `*.cpp`, `*.h`), re-run at closeout against **both** the
1.930 source artifact and the artifact-2 upstream clone at commit
`62f9ab457004666143160909a7e348bf87c107e6` (1.956).

**Scope note.** The census inputs are artifacts 1 and 2. Artifact 3, the `.deb`, contains
**zero** `.c`/`.cpp`/`.h` files and is not a census input. The earlier "identical in 1.930
and 1.956" label is **substantively confirmed** — both trees hold 1,303 files with
identical A1/A2/C counts — with one build-state caveat: the 1.930 archive's `config.h` is
`configure`-generated output (bucket B), whereas the pristine clone carries the checked-in
Visual-Studio variant (bucket D). That shifts exactly one file between B and D
(1.930: B=5, D=17 · 1.956: B=4, D=18) and reflects build state, **not** a licensing
divergence. The table below reports 1.930.

**Counting-criterion correction.** An earlier draft reported *1,243 carrying the grant /
60 not*. Independent QA, using a broader GPL search, reported **69** files outside its
matching set. The two searches were measuring different categories and neither figure is
reproducible without stating its rule, so the census was re-run under four explicitly
defined, mutually exclusive buckets. The bucket definitions — not the totals alone — are
the result:

| bucket | definition | count |
|---|---|---|
| **A1** | carries White Dune's own *GNU **General** Public License … either version 2 … or any later version* grant, and nothing else | **1,212** |
| **A2** | carries that same grant **and** an embedded third-party attribution block for incorporated snippets | **8** |
| **B** | machine-generated output (Bison/flex/autoconf), not hand-authored | **5** |
| **C** | wholly third-party vendored files under a different licence, with no White Dune grant | **61** |
| **D** | no standard licence grant (bare copyright line, or no header at all) | **17** |
| | **total** | **1,303** |

A1 + A2 = **1,220** files carrying the GPL-2.0-or-later grant. 1,303 − 1,220 = **83**
files that do not. Neither the earlier `1,243 / 60` nor QA's `69` is retained: the first
under-counted the non-grant remainder, the second used a looser GPL match. `1,220 / 83`
supersedes both, under the rule stated above.

**Bucket B — generated (5):** `parser.cpp`, `y.tab.h`, `swt/rc/y.tab.h` (Bison,
GPL-3.0-or-later *with the Bison special exception*), `lexer.cpp` (flex), `config.h`
(autoconf). The authored artifacts are `src/parser.y` and `src/lexer.l`.

**Bucket A2 — WD grant plus embedded third-party attribution (8):** `MyMesh.h`,
`NodeBackground.cpp`, `NodeExtrusion.cpp`, `NodeImageTexture3D.cpp`,
`NodeTextureBackground.cpp`, `Texture3DNode.cpp`, `WonderlandModuleExport.cpp`,
`WriteWonderlandCellRenderCode.cpp`. These are White Dune files that incorporate
snippets from FreeWRL, OpenVRML and Sun Microsystems. **They are the trap in this tree:**
they look like ordinary GPLv2+ White Dune files, and a per-file licence scan classifies
them as such, but each carries a second attribution block that a port must honour. Any
future reuse touching one of these must read past the first header block.

**Bucket D — no standard grant (17):** `gif.c/.h`, `mysnprintf.c/.h`, `quadric_simp.cpp/.h`,
`freewrl_define.h`, `ml_mesh_type.h`, `config.jpg_png_zlib.h`, `intercept.h`,
`png2PixelTexture.cpp`, `resource.c/.h`, `swt/tests.new/{config.h,mysnprintf.h,resource.c,resource.h}`.
These carry a bare copyright line or nothing at all. **Absence of a grant is not a
permissive grant** — treat every file here as unusable until its licence is established
from its real upstream.

The prior WD0-era record in `~/Projects/white-dune-archive/PROVENANCE.md` states "1,241
files under `src/` carry [GPLv2+]. Only 9 mention version 3", which is directionally right
but reads as though the remainder is negligible. **It is not.** Buckets **C** and **D** —
**78 files** — are vendored third-party libraries under their own, different licences, or
files with no grant at all:

| upstream component | files (examples) | license |
|---|---|---|
| **Poly2Tri** (constrained Delaunay triangulation) | `poly2tri.h`, `cdt.cpp/.h`, `sweep.cpp/.h`, `sweep_context.cpp/.h`, `advancing_front.cpp/.h`, `shapes.cpp/.h`, `utils.h` | **BSD-3-Clause**, Poly2Tri Contributors 2009–2010 |
| **FTGL** (OpenGL font/glyph vectorising) | `Vectoriser.cpp/.h`, `Contour.cpp/.h`, `PointFtgl.cpp/.h` | **MIT**, Henry Maddocks, Éric Beets, Sam Hocevar |
| **catmull-clark** (subdivision) | `subd.c/.h`, `subd_mesh.c/.h`, `buf.c/.h` | **MIT**, Slavomir Kaslev 2009–2017 |
| **OpenVRML** PNG loader | `pngLoad.c/.h` | **LGPL-2.1-or-later**, Chris Morley 1998 |
| **xloadimage** GIF reader | `kljcpyrght.h` (permissive); `gif.c/.h` carry **no grant** — bucket D | permissive (Kirk L. Johnson 1989–1990) — verify `gif.c/.h` against upstream before any use |
| **Graphics Gems IV** Euler angles | `EulerAngles.cpp/.h`, `QuatTypes.h` | Graphics Gems — *"can be used without restrictions"* |
| **SDL** joystick subset | `src/SDLjoystick/**` | SDL-derived (verify per file before any use) |
| **GNU Bison** generated output | `parser.cpp`, `y.tab.h`, `swt/rc/y.tab.h` | GPL-3.0-or-later **with the Bison special exception** — generated output, the real grammar is `src/parser.y` (bucket B) |
| **flex / autoconf** generated output | `lexer.cpp`, `config.h` | generated; authored artifact is `src/lexer.l` (bucket B) |
| **VR Juggler** Aflock tracker | `Aflock.cpp/.h` | **LGPL-2.0-or-later**, Iowa State University 1998–2000 |
| **GpsMathLib / gpsmath** | `GpsMathLib.cpp/.h`, `gpsdatum.h`, `gpsmath.h`, `gpsport.h` | **LGPL** |

**Practical consequences for any future port lane:**

1. `parser.cpp` is *machine-generated Bison output*, not hand-written White Dune code.
   The authored artifact is `src/parser.y` + `src/lexer.l`. Anyone citing "White Dune's
   parser" must cite the grammar, not the generated file. WRL Forge has its own
   hand-written tokenizer/parser and needs neither.
2. **Triangulation, subdivision, and glyph vectorising — three of the most attractive
   geometry algorithms in the tree — are not White Dune's code at all.** They are
   BSD/MIT upstreams that WRL Forge could take *directly from their own upstreams*,
   under more permissive terms, with cleaner provenance and active maintenance. Going
   through White Dune for them would be strictly worse.
3. The `.deb` (artifact 3) contains no source and establishes no implementation license.
   It is therefore **not** a census input, and no 1.956 census exists.
4. **Bucket A2 is the subtle risk.** Eight files carry White Dune's own GPLv2+ header
   *and* a second third-party attribution block. A scan that stops at the first header
   will misclassify them as clean White Dune code.
5. **Bucket D grants nothing.** Seventeen files carry no licence statement. They must be
   treated as unusable until resolved against their real upstream, never as permissive.

**White Dune's own authored code — the 1,220 files (A1 + A2) that matter for this audit
— carries `GPL-2.0-or-later`**, copyright Stephen F. White (1999–2002) and J. "MUFTI"
Scheurich and others. That is compatible with WRL Forge's `GPL-3.0-or-later` via the
"or later" election, exactly as `OPEN_SOURCE_PROVENANCE.md` §2.1 states.

The engineering conclusion is unchanged by the recount:

- White Dune-authored implementation **is** GPL-compatible with WRL Forge.
- The tree nevertheless contains **significant separately licensed vendored third-party
  code** (78 files across buckets C and D, plus 5 generated).
- **Poly2Tri, catmull-clark, FTGL and the SDL joystick subset should be sourced from
  their real upstreams**, not inherited through White Dune — better licences, cleaner
  provenance, active maintenance.

### 1.5 A stale statement in the external archive

`~/Projects/white-dune-archive/PROVENANCE.md` asserted *"WRL Forge is **MIT**. The two
are incompatible; nothing here may be copied…"* and pointed at the deleted
`GPL_PROVENANCE_BOUNDARY.md`. That file is **outside this repository**, so it is not part
of this lane's commit.

**Resolved at closeout.** It was corrected in place to record the `GPL-3.0-or-later`
transition (`2eb7c39`), the retirement of the clean-room prohibition, the surviving
per-file provenance duty, and the presence of separately licensed vendored code, while
retaining the superseded MIT-era rule clearly marked as historical. Authority for reuse
policy is now `OPEN_SOURCE_PROVENANCE.md` in this repository. That edit is reported
separately from this commit.

### 1.6 Consultation record

**White Dune WAS consulted in this lane**, deliberately and under the current policy.
Sources: artifacts 1 and 2 above. **No implementation code was copied, adapted,
translated, or imported into WRL Forge** in this lane; no `src/`, `renderer/`, `main.js`,
`preload.js`, `validator.js`, or script file was modified. No White Dune fixture, example
scene, or asset was copied. Historical statements in earlier WD-lane documents — that
WD0–WD1.5 subsystems were created without consulting White Dune — **remain true and were
not altered.**

---

## 2. Current WRL Forge baseline (from source, not from planning docs)

Established by reading the tree at `2eb7c39`; `npm run check` → **1102/1102 pass**.

| subsystem | module(s) | state |
|---|---|---|
| tokenizer / parser / AST | `src/vrml/{tokenizer,parser,ast}.js` | built, pure, byte-lossless tokenizer, recovery for Cybertown/Blaxxun quirks |
| source mapping | `src/vrml/source-map.js` | built (WD1.1), opt-in and lazy |
| edit algebra | `src/vrml/edit.js` | built (WD1.2), span patches; same-offset inserts rejected; canonical order `from` asc, insertion-first |
| node schema | `src/vrml/node-schema.js` | built + committed (WD1.3). 54 nodes, 312 ISO declarations, 541 x_ite fields, 232 X3D-only. Per field: `type`, `accessType`, `vrml97Declaration`, `profiles`, `order`, `defaultText`, `defaultValue` |
| node identity | `src/vrml/node-identity.js`, `document-transaction.js` | built (WD1.4), two-tier; **no production consumer yet** |
| scope graph | `src/vrml/{symbols,scope-graph}.js` | built (WD1.5-P1/P2A/P2B/P2C): DEF/USE, PROTO/EXTERNPROTO types, interface members + `IS`, ROUTE endpoints. **consumer-free** |
| diagnostics / analyzer | `src/vrml/{diagnostics,analyze}.js` | built; `analyze.js` flat + explicitly non-authoritative (`VRML040`–`VRML044` advisory) |
| editor | `src/editor/*`, `renderer/editor.{html,js}`, `browser/editor-view.js` | built (7B/7B1): CodeMirror 6, main-owns-every-path, sessions, verify-before-commit save, 5 themes, zoom |
| preview | `src/preview/*`, `renderer/{preview,world-preview,editor-preview}.js` | built (2B1/4B/7C1–7C3): X_ITE, split-view live preview of unsaved buffer, no temp file |
| world project | `src/world-project/*`, `renderer/world.{html,js}` | built (4A/4B/5A): read-only resolver, confined `wrlworld://`, deterministic ZIP bundle |
| packaging | `package-plan.js`, `zip-writer.js`, `bundle-builder.js` | built, `zlib` only |
| UI surfaces | Mall panel, World panel, native editor | three pages, no framework, strict CSP |
| **command/transaction model** | `document-transaction.js` + `edit.js` | **primitives only — no user-facing undo/redo, no command objects, no grouping** |

**The honest summary:** WRL Forge has an unusually strong *semantic and document
foundation* and a *complete text-editing + preview product*. It has **no authoring
layer at all** — no scene tree, no inspector, no node creation, no 3D manipulation, no
undo stack. WD1.4 identity and the entire WD1.5 scope graph are built, tested, and
**wired to nothing**.

---

## 3. White Dune architecture map

```
DuneApp (global singleton: `extern DuneApp *TheApp`)
  └── MainWindow  (14,913 lines, 194 preprocessor conditionals — the god object)
        └── Scene  (the document: live object graph + undo/redo + Proto registry)
              ├── Node*      338 Node*.cpp subclasses, one per node type
              ├── Proto      unified type descriptor: built-ins AND user PROTOs
              ├── Command    8 command types, undo/redo stacks
              └── SceneView  observer base — every view derives from it
                    ├── SceneTreeView    hierarchy tree, drag/drop reparent
                    ├── SceneGraphView   node-graph canvas: ROUTE + IS wiring
                    ├── FieldView        the field/property inspector
                    ├── Scene3DView      OpenGL viewport, picking, handles
                    ├── ChannelView      animation timeline (keys/channels)
                    └── NodeLabView      (COVER/VR lab extension)
  └── swt/         White Dune's own portable widget toolkit
        ├── motif/   win32/   generic/
```

---

## 4. Subsystem findings

### 4.1 Core scene/document architecture — **the decisive finding**

**White Dune's document is a live C++ object graph. The source text is not retained.**

**Precision note on comments.** An earlier draft of this audit said `src/lexer.l`
simply "discards comments at six separate points, each marked `/* eat up comments */`".
That marker is real, but the wording was too strong and is corrected here. At each of
those six sites the lexer first calls `toComment(yytext)` → `addToCurrentComment()`
(`lexer.l`, `parser.y:1590`), and the collected text is attached to the object graph as
a **`NodeComment`** (`NodeComment.cpp/.h`) held in `Node::m_commentsList`
(`Node.h:1353`), re-emitted on write via the `VRML_COMMENT` branches in `Node.cpp`. So
White Dune **does** carry comment text through a load/save round-trip.

That does not change the conclusion, because the question is not whether comment *text*
survives but whether the *document* does:

> White Dune may collect comments during parsing, but comments and other original
> lexical structure are not retained as a lossless source representation. Save/write
> paths regenerate document text from the live object graph. Therefore formatting,
> lexical placement and byte identity are not preserved.

There is no CST, no source map and no span retention: a comment survives as a *node in
a tree*, positioned by its graph attachment, not by the offset it occupied in the file.
Writing a file is a **full regeneration** from the object tree (`Node::writeFields`,
`Node::writeField`, `Proto::write`, `Scene::writeHead`). Whitespace, indentation,
numeric formatting, field ordering and a comment's exact placement are all re-derived.

`LOSSY_CORE_CONFIRMED`.

Representation details:

- **Node ownership / DEF-USE.** `Node` holds `ParentArray m_parents` — an array, not a
  single parent. **A `USE` is literally the same `Node` object appearing under more than
  one parent.** `isFirstUSE()` decides which occurrence writes `DEF` and which write
  `USE`; `needsDEF()` decides whether a name is required at all. This is genuinely
  elegant: USE-consistency is structural rather than checked.
- **Field storage.** `FieldValue **m_fields` + `int m_numFields` — fields are addressed
  by **integer index**, not by name. Every node type generates `xxx_Field()` accessors.
  Fast, and it makes `FieldCommand(node, fieldIndex, value)` trivially compact.
- **Node type.** `Node::m_proto` points at a `Proto`. **Built-in nodes and user PROTOs
  share one type-descriptor class.** `getType()` dispatches through the scene's PROTO
  map for user prototypes.
- **Identity.** Raw `Node *` pointer identity, valid for the process lifetime because
  the tree is never re-derived. Selection uses `Path` — an `int[]` of alternating field
  index / child index from the root.
- **Dirty tracking / lifecycle.** Node flags (`NODE_FLAG_TOUCHED`), a scene-level
  modified flag, and `Scene::UpdateViews(sender, type, hint)` broadcast.

**Would adopting any of this compromise WRL Forge's lossless core? Yes — catastrophically.**

Adopting White Dune's document representation would mean: comment placement re-derived
rather than preserved, formatting normalised, vendor quirks rewritten to canonical form,
and byte identity lost on every edit of every real Cybertown file. That is the precise failure mode `WD.md` §2
prohibits permanently ("a canonical scene graph", "an AST→text serializer used for
whole-document regeneration"). **`R4 — reject`, without qualification.**

The distinction to carry forward: White Dune's *object graph* is `R4`; several
*services layered on top of it* (`Proto` as unified type descriptor, the multi-parent
USE model, typed update hints) are `R2` and can be re-expressed as **derived projections**
over WRL Forge's text document without touching the core.

**On `Path` and structural identity.** White Dune uses exactly the structural-path
identity that WD1.4 measured and rejected (1,020+ wrong anchors). It works there *only*
because the tree is live and stable between edits. Corroborating evidence that it is
fragile even so: `Path` carries `bool m_ignoreStrangePath` and a
`printStrangePath(node, field, depth)` diagnostic — the implementation has a named
concept for "this path came out wrong". **This strengthens, rather than challenges,
WD1.4's rejection.** Do not revisit it.

### 4.2 Command, undo, redo and mutation model — **high value, high transferability**

This is the cleanest subsystem in the tree, and the smallest.

`src/Command.h` is ~20 lines of substance:

```
class Command {
    virtual void execute(SceneView *sender = NULL) = 0;
    virtual void undo() = 0;
    virtual int  getType() = 0;
};
```

Eight command types total (`FIELD_COMMAND`, `MFIELD_COMMAND`, `MOVE_COMMAND`,
`ROUTE_COMMAND`, `UNROUTE_COMMAND`, `SELECTION_COMMAND`, `NEXT_COMMAND`, `COMMAND_LIST`).
Every scene mutation in a 250,000-line application funnels through those eight.

Four transferable design decisions:

1. **Undo by value restoration, not inverse operation.** `FieldCommand` stores
   `m_oldValue` and `m_newValue`. `MoveCommand` stores *four* values —
   `m_oldValueSrc/m_newValueSrc/m_oldValueDest/m_newValueDest` — because a reparent
   mutates two container fields. Undo is "put the old values back", never "compute and
   apply the inverse". This eliminates an entire class of asymmetry bugs.
2. **Grouping by sentinel.** `NextCommand` is a **no-op marker** (`execute(){}`,
   `undo(){}`) pushed onto the stack to delimit a transaction. `Scene::undo()`
   (`src/Scene.cpp:4159`) pops and undoes until it hits the next sentinel. Grouping
   costs one class and no bookkeeping. `CommandList` provides explicit nesting as an
   alternative.
3. **Interactive drags collapse to one undo entry.** `Scene3DView::Handle3D`
   (`src/Scene3DView.cpp:1322`) calls `m_scene->addNextCommand()` and
   `m_scene->backupField(node, field)` **once**, guarded by `m_backedUp`, at the start
   of a drag. Every subsequent mouse-move mutates freely; the whole gesture is one undo
   step. `backupFieldsStart/Append/Done` generalises it to multi-field gestures.
4. **A single mutation funnel.** `NodeBox::setHandle` — a *viewport gizmo* — calls
   `m_scene->setField(this, size_Field(), new SFVec3f(...))`, the same entry point the
   inspector uses. Viewport, inspector, and menu commands cannot drift.

**Comparison with WRL Forge.** `document-transaction.js` and `edit.js` provide
*verification and patch primitives* — `verifyTransaction` proves byte-for-byte that an
edit set turned one exact text into another, and Tier-1 identity re-anchors across it.
That is a **stronger foundation than White Dune has**, and it is doing a different job.
What WRL Forge has no equivalent of is the **user-facing layer**: named reversible
operations, a stack, grouping, and selection preservation across undo.

The good news is that WRL Forge's document shape makes this *easier*, not harder:
because the document is text, the natural undo record is **the inverse span patch plus
the pre-edit text hash** — value restoration is already the native idiom, and
`verifyTransaction` can prove each undo step landed exactly. Identity survives via Tier-1
re-anchoring, which is precisely the case it was built for.

**Recommendation:** adopt the *taxonomy and the grouping discipline* (`R2`), implement
them natively over span patches. Do **not** port `Command.h`'s class hierarchy — it is
built on `Node *` pointers and would drag the object graph with it.

### 4.3 Scene tree / hierarchy UI

`src/SceneTreeView.{h,cpp}` (~28 KB). A `SceneView` subclass over the `swt` tree widget.

- Incremental maintenance, not rebuild: `UpdateNode(const Path *)`, `UpdateAddNode`,
  `UpdateRemoveNode`, `UpdateNodeName`, `DeleteItemRec`.
- **Field-aware insertion.** `InsertNodeRec(Node *node, int field, int position,
  STREEITEM relative)` and `InsertNodeListRec(NodeList *, int field, ...)` — the tree
  models *which field* a child sits in, not just parent→child. Correct for VRML97, where
  `Transform.children`, `Shape.geometry` and `Shape.appearance` are distinct slots.
- **PROTOs appear in the tree** via `InsertProtoRec(Proto *, int i, STREEITEM)`.
- Drag/drop reparent: `OnBeginDrag` / `OnDragEnter` / `OnDragOver` / `OnDrop`, with
  `m_currentDragField` tracking the target field, committing a `MoveCommand`.
- Rename propagates to ROUTEs: `renameNode(STREEITEM, RouteUpdate *)`.
- Selection sync through the shared `OnUpdate(sender, UPDATE_SELECTION, hint)` bus.

**Assessment.** The *architecture* — field-aware tree items, incremental update by
`Path`, drag/drop committing a real command, rename-propagates-to-ROUTEs — is `R2` and
directly instructive for WD2. The *implementation* is bound to `swt`'s `STREEITEM`
handles and is `R4`.

### 4.4 Field/property inspector — **the richest single finding**

Two parts: `src/FieldView.{h,cpp}` (the widget) and the **per-node field metadata
tables** in the 338 `Node*.cpp` constructors.

The widget is a custom-drawn two-column list (`DrawItem`, `GetColumnWidth`, `HitTest`,
`StartEditing`/`StopEditing`/`AbortEditing`, `StartTracking` for drag-scrubbing numerics,
plus copy/paste/delete of field values and a `PasteSymetricLastSelection(direction)` for
mirroring). It is `swt`-coupled — `R4` as code, `R3` as UX (in particular
drag-to-scrub and value mirroring).

**The metadata is the valuable part.** `src/Field.h`'s constructor is:

```
Field(int type, const MyString &name, FieldValue *value,
      ExposedField *exposedField = NULL,
      FieldValue *min = NULL, FieldValue *max = NULL,
      int nodeType = ANY_NODE, int flags = 0,
      const char **strings = NULL, const MyString &x3dName = "");
```

Per field, White Dune carries **five kinds of constraint that WRL Forge's
`node-schema.js` does not have at all**:

| constraint | White Dune | WRL Forge today |
|---|---|---|
| numeric **min** | `m_min` — e.g. `Sphere.radius` min `0.0` (`NodeSphere.cpp:49`), `Material.transparency` min `0.0` max `1.0` (`NodeMaterial.cpp:59`) | **absent** |
| numeric **max** | `m_max` | **absent** |
| **which node class** an SFNode/MFNode field accepts | `m_nodeType` — e.g. `Text.fontStyle` restricted (`NodeText.cpp:56`) | **absent** |
| **enumerated string values** | `m_strings` | **absent** |
| **X3D-differing default** | `m_x3dValue` / `addX3dDefault` | partially (`profiles` flags, single default) |

Alongside it, `Proto` maintains the four element arrays (`m_fields`, `m_eventIns`,
`m_eventOuts`, `m_exposedFields`) with explicit cross-maps `getExposedOfField()` /
`getFieldOfExposed()` and `lookupIsEventIn` / `lookupIsExposedField` /
`lookupIsField` — i.e. the same `exposedField` ↔ `set_x` / `x_changed` alias problem
WRL Forge solved in P2B, solved independently.

**Two cautions before anyone ports these tables.**

1. **They are not pure ISO.** `NodeMaterial.cpp` declares `mirror`, `reflSpecular`,
   `reflDiffuse`, `transSpecular`, `transDiffuse`, `reflSpecularExp`,
   `transSpecularExp` — Kambi/extension fields mixed into the base node. Copying the
   tables wholesale would contaminate WRL Forge's ISO-derived, profile-tagged schema,
   which is one of its genuine assets. Any reuse must be an **extraction with a
   profile filter**, validated against the ISO mirror — not a copy.
2. **The constraints are ISO facts, independently derivable.** `radius ≥ 0` and
   `transparency ∈ [0,1]` come from ISO/IEC 14772-1, which WRL Forge already mirrors at
   `wb-ct-scrape/specs/iso-14772-vrml97` and already parses in
   `scripts/build-node-schema.js`. **The cheaper and cleaner route is to extend the
   existing generator to extract ranges, value ranges, and node-class restrictions from
   the ISO reference, using White Dune as a cross-check oracle rather than a source.**
   That yields better provenance (facts, not code) and catches generator bugs.

This is the **top reuse candidate in the audit** — as `R2`/oracle, not `R1` copy.

### 4.5 Node creation and the node catalogue

- `Scene::createNode(const char *nodeType, int flags)` (`Scene.cpp:5189`) and
  `createNode(int nodeType)` (`:5204`) — factory by name or by type id, resolving
  through the PROTO map so **user PROTOs instantiate through the same call as built-ins**.
- `Proto::create(Scene *)` is virtual; each `ProtoXxx` subclass constructs its `NodeXxx`.
- **Categorisation is a bitmask.** `Node.h` defines node classes as bit flags
  (`GEOMETRY_NODE = 1 << 25`, `CHILD_NODE = 1 << 27`, plus `HANIM_CHILD_NODE`,
  `PARAMETRIC_GEOMETRY_NODE`, `PRIMITIVE_GEOMETRY_NODE`,
  `PRODUCT_STRUCTURE_CHILD_NODE`, …). `Proto::getNodeClass()` returns the mask.
- **Legality of insertion** is `matchNodeClass(nodeClass, childType)`, consulted from
  `SFNode.cpp`, `MFNode.cpp`, `NodeGroup.cpp`, `SceneGraphView.cpp` and `MainWindow.cpp`.
  This is what stops a `Material` being dropped into `Transform.children`.
- Copy/clone: `Node::copy()` is virtual per type; `MoveCommand(..., bool handleUSE)`
  distinguishes moving a node from moving a USE instance.

**Assessment.** The **node-class bitmask + `matchNodeClass` containment rule is the
single most reusable *design* in the tree for WD2**, and WRL Forge has no equivalent.
Without it, a scene-tree drag/drop or an "insert node" palette cannot tell a legal drop
from an illegal one. `R2` (re-derive the taxonomy from ISO's node-type groupings; use
White Dune's table as a cross-check).

### 4.6 3D viewport editing — **the best algorithmic find**

`src/Scene3DView.{h,cpp}` plus a **virtual handle protocol on `Node`** (`Node.h:744–786`):

```
virtual int   getMaxHandle();
virtual Vec3f getHandle(int handle, int *constraint, int *field);
virtual void  setHandle(int handle, const Vec3f &v);
virtual bool  validHandle(int handle);   virtual bool checkHandle(int handle);
virtual void  drawHandles();             virtual void updateHandles();
virtual void  transformForHandle(int handle);
virtual void  startSetMultiHandles();    virtual void endSetMultiHandles();
```

**Why this is good.** The viewport is *completely generic*. It knows only handle
indices. Each node type decides what its handles mean, and — critically —
`getHandle` returns **which field the handle edits** via its `int *field` out-parameter
and **what axis/plane it is constrained to** via `int *constraint`
(`CONSTRAIN_NONE/X/Y/Z/XY/YZ/ZX/SPHERE`, `Node.h:124–131`). So:

- gizmo → field is **declarative**, so undo integrates for free (`backupField(node, field)`);
- constraint is **per-handle**, so a Box corner, an Extrusion spine point and a NURBS
  control point each get correct drag behaviour from one driver;
- adding a manipulable node type is a ~40-line change in that node's file, with **zero**
  viewport changes.

`NodeBox` is the canonical 30-line example (`NodeBox.cpp:113–137`): 8 corner handles,
`getHandle` returns `size × corner × 0.5` and reports `size_Field()`, `setHandle` writes
back `v × 2 × corner` through `m_scene->setField`.

`Scene3DView::Handle3D` (`:1322`) is the driver: fetch old handle value → apply the
camera/scene quaternion chain to map screen motion into the node's local frame
(`viewrot * scenerot.conj() * oldrot.conj() * v` for world mode; `(scenerot*v)*scenerot.conj()`
for local mode) → apply per-axis constraint → start the undo group once → `setHandle`.

Also present: `getHit(x, y)` picking, `constrainPlane(...)`, rubber-band selection
(`m_rubberBandX/Y`), walk navigation (`startWalking`/`walk`/`stopWalking`), and
`InputDevice` abstraction covering mouse, joystick and spaceball.

**The coupling is narrower than it looks.** The *protocol* (`getMaxHandle`/`getHandle`/
`setHandle`/`constraint`/`field`) is pure math and pure data — no OpenGL. Only
`drawHandles()` is fixed-function GL (`glPushName`/`glLoadName`/`glPushMatrix`), and
X_ITE replaces that entirely. **The protocol is `R1`; `drawHandles` and the GL selection
buffer are `R4`.** This is the highest-value bounded adaptation in the audit.

### 4.7 Geometry / modelling

Substantial and uneven.

- **`MyMesh` / `MyMeshX`** (`MyMesh.h`, 84 KB; `MeshBasedNode.cpp`, 81 KB) — the shared
  mesh service: face extraction from `coordIndex`, `generateFaceNormals()`,
  `smoothNormals()` with crease angle, `generateTextureCoordinates()`,
  `optimize(epsilon)` / `optimizeCoordIndex()` / `optimizeVertices()` (vertex welding
  and index compaction), `onlyPlanarFaces()`, `getMaxNumberEdgesPerFace()`. **Genuinely
  valuable, genuinely reusable ideas** — every VRML authoring tool needs exactly these.
- **Triangulation** — Poly2Tri (**BSD-3-Clause, third-party**). Take from upstream, not
  from here.
- **Subdivision** — catmull-clark (**MIT, third-party**). Same.
- **`NodeIndexedFaceSet`** (152 KB, the largest node) — `flip(index)`, `swap(fromTo)`,
  `symetricFace(iface)`, `setNormalFromMesh`, `setTexCoordFromMesh`, `flipSide`,
  `toggleDoubleSided`, colour/normal/texcoord binding handling. Note there is **no
  general vertex/edge/face topological editing** in the Blender sense — editing is
  handle-based over `Coordinate.point` plus these targeted operations.
- **Parametric generators** — `NodeExtrusion` (28 KB), `NodeSuperExtrusion`,
  `NodeSuperRevolver` (Superformula), `NodeNurbsSurface` (62 KB), `NodeNurbsCurve`
  (40 KB), `NodeElevationGrid`, plus `toNurbs()` conversions on primitives
  (`NodeBox::toNurbs` builds a NURBS box). NURBS is a large, specialised, X3D-only
  subsystem.
- **HAnim** — a full humanoid-animation node family (`NodeHAnimHumanoid` 25 KB, joints,
  segments, sites, displacers, motion).

**Classification:** `MyMesh` services → **A (directly useful)**. Extrusion/ElevationGrid
handle editing → **A**. Superformula generators → **B (later)**. NURBS, HAnim, GPS/Geo
(`GpsMathLib.cpp`, 167 KB) → **C (too specialised)**. Triangulation/subdivision →
**D (take from the real upstreams)**.

### 4.8 ROUTE / event editing UI — **the strongest UX find**

`src/SceneGraphView.{h,cpp}` (104 KB) is a **node-graph canvas with sockets** — the
"nodes and wires" idiom, implemented for VRML in ~2000.

- Nodes *and* PROTOs are drawn as boxes: `DrawNode(dc, node, x, y)`,
  `DrawProto(dc, proto, x, y)`, unified by a small `NodeOrProto` variant class.
- **Sockets are eventIns/eventOuts.** `SocketHitTestNode(x, y, node, int *side)` returns
  the element index and which side of the box was hit; `destSide(elementType)` maps
  element kind → left/right. `DrawSocketName(dc, x, y, name, rightAlign)` labels them.
- **ROUTEs are wires:** `DrawRoutes(dc, node)`, `DrawRoute(dc, start, end, color)`,
  with `InvalidateRoute(start, end)` for incremental repaint.
- **`IS` connections are drawn too** — `DrawIs(dc, proto)` renders PROTO interface
  bindings on the same canvas as ROUTEs. Conceptually right: both are event plumbing.
- **Automatic layout:** `Position(node)`, `accountGraphSize()`, `accountGraphPosition()`,
  `YPosition(width, height)`, `GetYEndRouteBlock()`.
- Creating a route is drag-from-socket-to-socket; `RouteCommand` / `UnRouteCommand`
  make it undoable.

**Testing the brief's hypothesis** (§14: *White Dune at the UI layer, WRL Forge's
resolver underneath*): **the hypothesis holds, and more strongly than expected.**

White Dune's route legality check is *implicit* — it comes from the type system at the
moment of connection, with no separable verdict object, no notion of "provably absent",
no `unsupported`-vs-`unresolved` distinction for EXTERNPROTO, and no fail-closed
behaviour on damaged scopes. WRL Forge's P2C resolver answers **six independent
questions** per ROUTE (two node bindings, two endpoints, two directions, one type
verdict), was validated against an independent oracle over **245,540 ROUTEs in 4,466
unique documents with 0 wrong bindings**, and withholds answers it cannot prove. That is
categorically more rigorous.

So: **take `SceneGraphView`'s interaction model and layout algorithm; keep WRL Forge's
`routeVerdict` / `resolveRouteEndpoint` as the truth.** The two compose cleanly, because
the canvas needs exactly what `scope-graph.js` already exports (`routesFrom`, `routesTo`,
`routeEndpointFor`, `routeVerdict`) — and WRL Forge can render something White Dune
cannot: a wire drawn in a *distinct "unproven"* state rather than silently omitted.

### 4.9 PROTO / EXTERNPROTO / `IS` authoring

- `Proto` (`Proto.h`, 25 KB; `Proto.cpp`, 127 KB) is the unified type descriptor.
  Interface mutation: `protoInitializer`, `finishEvents()`, `addField`/`addEventIn`/
  `addEventOut`/`addExposedField`, `isDynamicFieldsProto()` for `Script` and PROTO
  interfaces whose fields users edit.
- `IS` resolution: `lookupIsEventIn`, `lookupIsEventOut`, `lookupIsField`,
  `lookupIsExposedField` (both by-name and by-`(node, field)` overloads),
  `getNumIsMSNodes` / `getIsMSNode` / `getIsMSNodeField` for the reverse index;
  `Node::handleIs()`; `Node::writeIs()`.
- `EXTERNPROTO`: `Node::writeProto(f, urn, ...)`, `Scene::writeExternProto`.
- `SceneProtoMap.cpp` (42 KB) maintains the scene's PROTO registry;
  `recreateNodePROTO` + `doWithBranch` re-instantiate instances when a PROTO definition
  changes — i.e. **editing a PROTO interface propagates to live instances**.
- `avoidElement` / `canWriteElement` gate what is legal to emit per X3D-vs-VRML97.

**Assessment.** The **unified `Proto` type descriptor** is `R2` and important: WRL Forge
currently answers "what fields does this node have?" from `node-schema.js` for built-ins
and from P2A/P2B scope resolution for user PROTOs. WD2's inspector needs **one** query
that answers for both, with the schema and the scope graph behind it. White Dune shows
the shape of that interface.

`Scene`'s propagate-interface-change-to-instances machinery is `R3` — the *requirement*
is real and easy to overlook when planning PROTO editing; the *implementation* is
object-graph-bound.

Do **not** import White Dune's `IS` semantics. WRL Forge's P2B is more rigorous (Table 4.4
as one 16-cell matrix, exact-token type equality, `ambiguous` on explicit/alias
collision, `unsupported`-vs-`unresolved` for EXTERNPROTO, innermost-only owner fixed on
descent, 0 wrong bindings over 23,246 `IS` statements). White Dune's is a working
lookup, not an adjudicated one.

### 4.10 Animation

`src/ChannelView.{h,cpp}` + `Interpolator.{cpp,h}` + ~20 `Node*Interpolator` types +
`AnimationDialog` / `CurveAnimationDialog`.

`ChannelView` is a real **keyframe timeline**: channels down, time across
(`DrawRulers(dc, xMin, xMax, ...)`, `DrawKeys(dc)`, `DrawSelection(dc)`), key selection
and dragging (`m_selectedChannel`, `m_selectedKey`, `m_anchor`, `m_selMin`),
`AddKey(chan, key, x)`, `GoToNextKey()`/`GoToLastKey()`, `AutoScale()`,
`CheckAutoScroll()`, rubber-band multi-key selection, `PointNearLine` hit-testing,
copy/paste of channels, and **`PasteSymetricLastSelection(direction)`** — paste an
animation mirrored across an axis, a small feature that reveals real authoring
experience. `findDrawableChannels()` / `isDrawableChannel(chan)` decide which
interpolator components are shown.

`Scene` carries playback (`UPDATE_TIME`), and `NodeCurveAnimation` drives motion along a
curve.

**Assessment.** `R3` (strong UX reference), `R2` for the channel-decomposition idea
(an `OrientationInterpolator`'s `keyValue` becomes N drawable scalar channels). The
implementation is `swt`-drawn and not portable. For WRL Forge this matters because
timeline UI is where "editor with preview" becomes "authoring tool", and the data model
is already fully described by ISO interpolator nodes that `node-schema.js` covers.

### 4.11 Script and interaction authoring

`ScriptEdit.cpp` (30 KB) + `EcmaScriptApp` + `EcmaScriptSettingsDialog` + `ScriptDialog`.

**White Dune does not embed a code editor.** `ObjectEdit`/`ScriptEdit` writes the script
body to a temp file (`swGetTempFile(m_editorFile, ".dune_ecmascript", ".js", 1024)`),
shells out with `system(m_command)` to the user's external editor, then **polls every
500 ms** (`swSetTimer(m_wnd, 500, editorTimerCallback, this)`) for changes, and registers
the temp file for deletion (`TheApp->AddToFilesToDelete`).

`EcmaScriptApp` is a **skeleton generator** with per-option toggles: emit `initialize()`,
`shutdown()`, `eventsProcessed()`, the list of available functions, allowed values,
allowed components, example usage, and `Math`/`Browser` object stubs.

**Assessment.** The editing mechanism is `R4` — **WRL Forge is already strictly ahead
here** (native CodeMirror 6, in-process, no temp file, verify-before-commit save). The
**script-skeleton generator is `R3`** and cheap: generating a correctly-shaped `Script`
body with the right `initialize`/`shutdown`/eventIn handler signatures, derived from the
node's declared interface, is a real convenience WRL Forge could offer using P2B's
interface members. **Note this is a scope expansion and is explicitly not proposed for
any current lane** — recorded only.

### 4.12 Import / export architecture

There is **no shared intermediate scene-conversion layer**. Export is a set of `virtual
int writeXxx(int filedes, int indent)` methods on `Node`, one family per target, plus
`Scene::writeXxx` drivers. Each exporter re-walks the tree independently.

Targets found (`Node.h`, `Scene.h`):

| target | entry point | 2026 relevance |
|---|---|---|
| VRML97 / X3DV | `Node::writeFields`, `Proto::write`, `Scene::writeHead` | **core** |
| X3D XML | `writeX3dProto` + expat in `parser.y` | **relevant** |
| C / C++ / Java source generation | `Scene::writeC`, `writeCDeclaration`, `writeCRoutes`, `writeCSendEvent`, … | niche |
| **Project Wonderland** Java modules | `WonderlandModuleExport.cpp` (162 KB) + `WriteWonderlandCellRenderCode.cpp` (**281 KB**) | **dead** — Wonderland ended ~2010 |
| RenderMan RIB | `Scene::writeRib`, `writeRibNextFrame` | niche (Aqsis) |
| POV-Ray | `Scene::writePovray`, `writePovrayNextFrame` | niche |
| AC3D | `Scene::writeAc3d` | mostly dead |
| CATT-Acoustic | `writeCattGeo`, `NodeCattExportRec/Src` | very niche |
| LDraw `.dat` (LEGO) | `Scene::writeLdrawDat` | very niche |
| OFF | `Scene::writeOff` | trivial |
| Kanim | `Scene::writeKanim` | Castle Game Engine |
| triangle/IFS helpers | `writeIndexedFaceSet`, `writeIndexedTriangleSet`, `writeTriangleSet`, `writeTriangles`, `writeIndexedLineSet` | **reusable shape** |

**Import is thin.** Beyond VRML97/X3D parsing, White Dune leans on external tools — the
`.deb` `Depends:`/`Suggests:` list (`imagemagick`, `view3dscene`, `povray`, `aqsis`,
`mencoder`, and suggested `meshlab`, `wings3d`, `freewrl`) is the import/convert story.

**Assessment.** The **absence** of a common conversion layer is the lesson: ~443 KB of
Wonderland code-generation is dead weight that a shared layer would have contained.
**`R4` for essentially every exporter.** The one `R2` idea is the small
`writeIndexedFaceSet` / `writeTriangleSet` family — the "reduce any geometry to a mesh,
then emit" seam that every exporter *should* have shared. WRL Forge should design that
seam first if it ever exports.

### 4.13 Multi-platform application architecture

- **`src/swt/`** — White Dune's **own portable widget toolkit**, with `motif/`, `win32/`
  and `generic/` backends, plus `rc/` resource compilation and its own `y.tab.h`. Every
  view is drawn against `swt`'s `SDC` device context and `STREE`/`STREEITEM` handles.
- `desktop/` carries integration for **cde, debian, fvwm2, irix, kde, macosx, olpc, twm,
  xfce** — a decade of platform drift preserved in-tree.
- Rendering: fixed-function OpenGL via freeglut, with optional Mesa/GLX off-screen paths.
- Build: hand-written `configure` + `configure.in` + `Makefile` + `buildscripts/`, plus
  MSVC `dune.vcxproj` and legacy `.dsp` files under `src/deprecated/`.
- `-4kids` launches a **deliberately simplified GUI** ("simple 3D modeller for kids",
  `man/dune.1:101`), and another mode runs it as a pure exporter/converter.

**Cross-platform lessons relevant to a future macOS lane** (recorded, not acted on):

1. Writing your own toolkit to get portability cost White Dune a permanent maintenance
   tax and left it visually alien on every platform. **Electron already solves this** —
   this is a strong argument *for* WRL Forge's existing stack, not against it.
2. `desktop/` shows that platform integration files accumulate and never get deleted.
   Keep macOS integration to what is verified working.
3. **`-4kids` is the interesting one.** A single application with a *simplified mode* is
   directly aligned with "approachable simple Blender for VRML/X3D". `R3`, and worth
   remembering when WD2's UI is designed: progressive disclosure is cheaper to build in
   from the start than to retrofit.

### 4.14 Testing and regression architecture — **WRL Forge is far ahead**

`test/` contains: `selftest.cpp` (**211 lines**, links the whole GUI app), three tiny CLI
printers (`printFieldNumber.cpp`, `printFieldType.cpp`, `printNodeType.cpp`), and six
shell/awk consistency checks (`testmenus.sh`, `testprotos.sh`, `testresourcenumbers.sh`,
`testtabs.sh`, `testx3domaddfield.sh`, `testxmlmgdiff.sh`, `testzeroclass.sh`) that lint
the *source tree* — that every node has a PROTO entry, that resource numbers are
consistent, that tabs are absent.

**There is no parser fixture suite, no round-trip corpus test, no exporter regression
test, no semantic oracle.** Regression is manual, backed by 214 example `.wrl`/`.x3dv`
scenes under `docs/typical_vrml_examples/` and `test/`.

**Assessment.** `R4`. WRL Forge's 1,102 automated tests, reproducible corpus harnesses
(`spikes/wd1-route-semantics/`), independently authored oracles, and mutation testing are
in a different category. The lesson is cautionary: **a 250,000-line, 25-year-old codebase
with no semantic test suite is exactly why it stopped being safely changeable.**

The GPL example scenes are potentially useful **fixture** material for a later lane, but
they are GPL content and would need a §4 provenance entry — deliberately **not** copied
here, and not recommended while WRL Forge's real Cybertown corpus is richer and already
in use.

### 4.15 Performance and scalability

- **Traversal:** `doWithBranch(callback, data, ...)` is the universal visitor, with
  `NODE_FLAG_TOUCHED` for visit-once semantics across DEF/USE sharing (necessary,
  because a USE node is genuinely the same object and would otherwise be visited twice).
- **Invalidation is typed and fine-grained.** `Scene::UpdateViews(sender, type, hint)` /
  `UpdateViewsNow` broadcast one of ~28 update types (`UPDATE_FIELD`, `UPDATE_ADD_NODE`,
  `UPDATE_REMOVE_NODE`, `UPDATE_ADD_ROUTE`, `UPDATE_DELETE_ROUTE`, `UPDATE_PROTO`,
  `UPDATE_SELECTION`, `UPDATE_REDRAW_3D`, `UPDATE_NODE_NAME`, …), carrying a typed
  `Hint` payload — `FieldUpdate`, `NodeUpdate`, `RouteUpdate`, `ProtoUpdate`
  (`Scene.h:1200–1240`). Each view decides what to do with each type; `SceneTreeView`
  and `SceneGraphView` both do incremental repaint rather than rebuild.
- **Route lookup:** per-node `m_inputs`/`m_outputs` adjacency lists, so route traversal
  is local rather than a scene scan.
- **Redraw:** `InvalidateRoute(start, end)` invalidates a wire's bounding region only.
- **Undo memory** is unbounded — every `FieldCommand` retains a full `FieldValue` copy,
  and an `MFieldCommand` on a large `Coordinate.point` retains the whole array. No cap,
  no coalescing beyond the drag grouping.

**Relevance to WRL Forge/Electron/X_ITE.** The **typed-hint update bus is `R2` and
directly applicable**: WD2 will have a scene tree, an inspector, a viewport and a code
editor all projecting one text document, and "reparse everything, rebuild every view on
every keystroke" will not hold up on real Cybertown worlds (~70 textures, nested
`Inline`). White Dune's answer — a typed notification carrying enough information for
each view to update incrementally — is the right shape. WRL Forge already has the
scheduler/debounce half of this in `src/preview/preview-scheduler.js`.

The unbounded undo memory is a **caution**, not a model: WRL Forge should cap undo depth
and, because its undo records are span patches over text rather than deep value copies,
should be far cheaper per entry by construction.

---

## 5. Code-quality and legacy-risk audit

Measured, not impressionistic:

| risk | evidence |
|---|---|
| **God object** | `MainWindow.cpp` = **14,913 lines**; `Scene.cpp` = 7,606; `Node.cpp` = 5,011; `Proto.cpp` = 3,575 |
| **Preprocessor density** | `MainWindow.cpp` = **194** `#if/#ifdef/#else/#endif` directives; `Scene.cpp` = 37 |
| **Global singleton** | `extern DuneApp *TheApp;` (`DuneApp.h:486`), referenced throughout, including from leaf node code |
| **Raw-pointer ownership** | commands hold bare `Node *` / `FieldValue *`; manual `ref()`/`unref()` reference counting in `MyMesh` |
| **UI/data coupling** | `Node::drawHandles()` calls OpenGL directly from the document model; `Node` includes rendering, export, and code-generation responsibilities in one 49 KB header |
| **Old C++** | pre-STL `Array`/`List`/`Map`/`Stack`/`MyString`, `#pragma once` + include guards, `strange_dummy_for_aix_gcc2_95` in `Command.h` (a workaround for a 1990s AIX compiler bug, still shipping) |
| **Assertion-as-error-handling** | `Scene::undo()` opens with `if (m_undoStack.empty()) { assert(0); return; }` |
| **Fixed-function OpenGL** | `glPushName`/`glLoadName` selection buffer, `glPushMatrix`, `glPushAttrib(GL_LIGHTING)` — removed from core profiles |
| **Dead export targets** | ~443 KB of Project Wonderland code generation for a platform discontinued ~2010 |
| **Weak tests** | see §4.14 |
| **Vendored third-party without a manifest** | 78 files (buckets C+D) across 10+ upstreams with 6 different licences, plus 8 more (bucket A2) whose second attribution block sits below a White Dune header — all discoverable only by reading headers |
| **Dormant upstream** | last commit 2020-09-02 |

**Nothing in this table argues against reuse.** It argues for **bounded, algorithmic,
translated reuse** — take protocols and math, leave classes and frameworks.

---

## 6. Reuse classification

### R1 — strong direct adaptation candidates

| # | White Dune source | symbols | target | effort | notes |
|---|---|---|---|---|---|
| R1-1 | `src/Node.h:744–786`, `src/Node.h:124–131`, `src/NodeBox.cpp:113–137` (and the ~30 other `getHandle`/`setHandle` implementations) | `getMaxHandle`, `getHandle(handle, *constraint, *field)`, `setHandle`, `validHandle`, `transformForHandle`, `CONSTRAIN_*` | new `src/authoring/handles/` (pure, `node:test`-able) | medium | Pure math + data. **No OpenGL in the protocol.** Excludes `drawHandles()`. GPL-2.0-or-later → compatible. |
| R1-2 | `src/Scene3DView.cpp:1322–1400` | `Handle3D` local/world quaternion mapping, per-axis constraint application | `src/authoring/` drag driver over X_ITE picking | medium | The frame-conversion math is the non-obvious part and is worth translating carefully. |

Both require a §4 `OPEN_SOURCE_PROVENANCE.md` entry (mode `translated` or `adapted`),
preserved upstream copyright attribution to Stephen F. White / J. Scheurich, and must be
proposed in a **separate owner-approved port lane** — not this one.

### R2 — architecture / algorithm inspiration

| # | subject | White Dune reference | WRL Forge target |
|---|---|---|---|
| R2-1 | **Field constraint metadata** (min / max / accepted node class / enumerated strings) | `src/Field.h` ctor; `NodeSphere.cpp:49`, `NodeMaterial.cpp:59`, `NodeText.cpp:56` | extend `scripts/build-node-schema.js` to extract from the **ISO mirror**; use White Dune as a cross-check oracle |
| R2-2 | **Node-class taxonomy + containment legality** | `Node.h` class bitmask; `Proto::matchNodeClass`; call sites in `SFNode.cpp`, `MFNode.cpp`, `NodeGroup.cpp` | `node-schema.js` + a new legality query for WD2 insert/drag-drop |
| R2-3 | **Command taxonomy + sentinel grouping + drag coalescing** | `Command.h`, `NextCommand.h`, `CommandList.h`, `Scene::undo` (`Scene.cpp:4159`), `backupField`/`backupFieldsStart` | new `src/authoring/commands/` over `edit.js` span patches + `document-transaction.js` |
| R2-4 | **Unified type descriptor for built-ins and user PROTOs** | `Proto.h` — `getField`/`getEventIn`/`getEventOut`/`getExposedField`, `getExposedOfField`/`getFieldOfExposed`, `lookupIs*` | one interface query over `node-schema.js` + `scope-graph.js` for the inspector |
| R2-5 | **Typed fine-grained update bus** | `Scene::UpdateViews`, ~28 `UPDATE_*` types, `Hint`/`FieldUpdate`/`NodeUpdate`/`RouteUpdate`/`ProtoUpdate` (`Scene.h:1164–1240`) | WD2 multi-view sync (tree ↔ inspector ↔ viewport ↔ code) |
| R2-6 | **Mesh service layer** | `MyMesh.h` — `generateFaceNormals`, `smoothNormals`, `generateTextureCoordinates`, `optimize`/`optimizeVertices`, `onlyPlanarFaces` | future `src/geometry/` |
| R2-7 | **Multi-parent USE model** | `Node::m_parents` (`ParentArray`), `isFirstUSE()`, `needsDEF()`, `MoveCommand(..., handleUSE)` | WD2's *projected* scene tree (a derived view, never the document) |
| R2-8 | **Graph auto-layout for the ROUTE canvas** | `SceneGraphView::Position`, `accountGraphSize`, `accountGraphPosition`, `YPosition` | ROUTE editing UI |
| R2-9 | **Shared "reduce to mesh, then emit" export seam** | `Scene::writeIndexedFaceSet`/`writeTriangleSet`/`writeTriangles` — and the ~443 KB that resulted from *not* generalising it | any future export lane |

### R3 — UX / workflow reference (concept only, no code)

- **R3-1** Node-graph ROUTE canvas with sockets and wires, **drawing `IS` bindings on the
  same canvas** (`SceneGraphView`) — the strongest UX idea in the tree.
- **R3-2** Keyframe timeline with per-component channels, autoscale, autoscroll,
  rubber-band key selection, and **mirrored paste** (`ChannelView`,
  `PasteSymetricLastSelection`).
- **R3-3** Drag-to-scrub numeric fields in the inspector (`FieldView::StartTracking`).
- **R3-4** **`-4kids` simplified-mode application** (`man/dune.1:101`) — progressive
  disclosure as a first-class mode. Directly aligned with the "approachable" goal.
- **R3-5** Field-aware scene tree — children shown under the *field* they occupy, not a
  flat parent→child list (`SceneTreeView::InsertNodeRec(node, field, …)`).
- **R3-6** PROTOs visible and editable in the tree (`InsertProtoRec`).
- **R3-7** Rename propagates to ROUTEs (`SceneTreeView::renameNode(item, RouteUpdate*)`).
- **R3-8** Editing a PROTO interface propagates to live instances
  (`recreateNodePROTO` + `SceneProtoMap`).
- **R3-9** Script skeleton generation from the declared interface (`EcmaScriptApp`).
  *Recorded only — a scope expansion, not proposed.*

### R4 — reject

See §9.

---

## 7. Capability-gap matrix

| capability | WRL Forge now | White Dune | gap | reuse | priority |
|---|---|---|---|---|---|
| **lossless source editing** | **strong** — text is the document, byte-exact through edits | **none** — comment *text* is carried as `NodeComment` graph members, but there is no source retention and every write is a full regeneration | White Dune is **behind**; nothing to take | R4 | — |
| **parser / semantics** | **strong** — 4 namespaces, fail-closed, corpus-validated (0 wrong bindings over 245,540 ROUTEs / 23,246 `IS`) | working, implicit, not adjudicated | White Dune is **behind** | R4 | — |
| **node schema** | 54 nodes, types/access/defaults/profiles | + **min/max, accepted node class, enumerated values, X3D defaults**, but polluted with vendor extensions | **real gap** | R2-1 | **high** |
| **node containment legality** | **absent** | node-class bitmask + `matchNodeClass` | **real gap — blocks WD2** | R2-2 | **high** |
| **undo / redo** | **absent** (transaction primitives only) | 8 commands, sentinel grouping, drag coalescing | **real gap — blocks WD2** | R2-3 | **high** |
| **scene tree** | **absent** (code outline only) | mature, field-aware, drag/drop reparent | **real gap** | R2-7, R3-5/6/7 | high |
| **field inspector** | **absent** | mature, edge-case-hardened | **real gap** | R2-1/4, R3-3 | high |
| **node creation** | **absent** | factory + class-filtered catalogue | **real gap** | R2-2 | high |
| **DEF/USE tools** | resolver built, no UI | structural (multi-parent) | UI gap | R2-7 | medium |
| **PROTO / EXTERNPROTO editing** | resolver built (P2A/P2B), no UI | full authoring + instance propagation | UI gap | R2-4, R3-8 | medium |
| **`IS` editing** | resolver built (P2B), no UI | working lookups + canvas display | UI gap | R3-1 | medium |
| **ROUTE editing** | resolver built (P2C), no UI | **node-graph canvas with sockets** | UI gap | R2-8, R3-1 | medium |
| **3D selection / picking** | preview only, no selection | GL selection buffer + rubber band | **real gap** | R1-2 (protocol), R4 (GL) | high |
| **transform gizmos** | **absent** | **per-node virtual handle protocol** | **real gap** | **R1-1** | **high** |
| **primitive creation** | **absent** | full, incl. `toNurbs` conversions | gap | R2-2 | medium |
| **mesh editing** | **absent** | handle-based + targeted IFS ops; no general topology editing | gap | R2-6 | low/medium |
| **Extrusion editing** | bounds math only (`extrusion-bounds.js`) | handle-based spine/scale editing | gap | R1-1 | medium |
| **animation / timeline** | **absent** | real keyframe timeline | gap | R3-2 | low/medium |
| **Script editing** | **strong** — native CodeMirror, no temp file | external editor + 500 ms polling | White Dune is **behind** | R4 (+R3-9) | — |
| **world / project asset management** | **strong** — resolver, case/missing/remote detection, confined scheme | none comparable | White Dune is **behind** | R4 | — |
| **import / export** | VRML97/gzip read+write | many targets, no shared layer, mostly dead formats | narrow gap (X3D XML) | R2-9 | low |
| **packaging** | **strong** — deterministic ZIP bundle, re-hashed manifest | `packager/` scripts only | White Dune is **behind** | R4 | — |
| **validation / diagnostics** | **strong** — profile-separated, confidence-tagged | minimal | White Dune is **behind** | R4 | — |
| **multi-platform** | Electron; Linux + native Win11 accepted | own toolkit, 8 desktop integrations, dormant | White Dune is **behind** | R4 (+R3-4) | — |

**Shape of the result:** WRL Forge leads on **everything document-, semantics-, and
product-related**, and has **nothing** in the authoring layer, where White Dune is mature.
The gaps cluster tightly: **undo, containment legality, gizmo handles, and inspector
constraint metadata** are the four that actually block progress, and all four have
concrete White Dune answers.

---

## 8. Top ten direct-reuse candidates (ranked)

Ranked by *(value to WRL Forge) × (cleanliness of the boundary)*. **Nothing below was
copied.** Each needs its own owner-approved lane and a §4 provenance entry.

| # | source | symbol(s) | why attractive | WRL Forge target | risk | category |
|---|---|---|---|---|---|---|
| 1 | `src/Node.h:744–786`, `:124–131`; `src/NodeBox.cpp:113–137` | handle protocol + `CONSTRAIN_*` | pure math/data; declares *which field* and *what constraint*; makes gizmos node-local and undo-integrated; adding a node type is ~40 lines | `src/authoring/handles/` | **low** — no GL in the protocol | **R1** |
| 2 | `src/Field.h` ctor + 338 `Node*.cpp` `addField`/`addExposedField` calls | `m_min`, `m_max`, `m_nodeType`, `m_strings` | fills the largest schema gap; every inspector needs it | `scripts/build-node-schema.js` (from ISO), White Dune as oracle | **medium** — tables include vendor extensions; must filter | **R2** |
| 3 | `src/Command.h`, `NextCommand.h`, `CommandList.h`, `Scene.cpp:4159`, `backupField*` | command taxonomy, sentinel grouping, drag coalescing | 8 commands cover a whole 3D editor; grouping costs one no-op class | `src/authoring/commands/` over `edit.js` | **low** — concepts only | **R2** |
| 4 | `src/Node.h` class bitmask; `Proto::matchNodeClass` (`Proto.cpp:2642`) | node-class taxonomy + containment rule | without it, drag/drop and node palettes cannot tell legal from illegal | `node-schema.js` legality query | **low** — re-derive from ISO | **R2** |
| 5 | `src/Scene3DView.cpp:1322` | `Handle3D` frame conversion | the local/world quaternion mapping is the non-obvious part of any gizmo | `src/authoring/` drag driver | **medium** — must be re-expressed for X_ITE cameras | **R1** |
| 6 | `src/SceneGraphView.{h,cpp}` | `SocketHitTestNode`, `DrawRoutes`, `DrawIs`, `Position`, `accountGraphPosition` | the best ROUTE/`IS` authoring UX for VRML that exists; layout algorithm is reusable | ROUTE editing view over P2C | **medium** — `swt`-drawn; take model + layout only | **R2/R3** |
| 7 | `src/Scene.h:1164–1240` | `UPDATE_*` types, `Hint`/`FieldUpdate`/`NodeUpdate`/`RouteUpdate`/`ProtoUpdate` | four WD2 views over one document need incremental, typed invalidation | WD2 view bus | **low** | **R2** |
| 8 | `src/Proto.h` | `getExposedOfField`/`getFieldOfExposed`, `lookupIs*`, element arrays | one interface query answering for built-ins *and* user PROTOs | inspector interface layer | **low** — WRL Forge's P2B semantics stay authoritative | **R2** |
| 9 | `src/MyMesh.h`, `MeshBasedNode.cpp` | `generateFaceNormals`, `smoothNormals`, `generateTextureCoordinates`, `optimizeVertices` | the mesh services every VRML authoring tool needs | `src/geometry/` | **medium** — `ref()`/`unref()` and `MFxxx` coupling | **R2** |
| 10 | `src/ChannelView.{h,cpp}` | `DrawKeys`, `DrawRulers`, `AddKey`, `AutoScale`, `findDrawableChannels`, `PasteSymetric*` | turns "editor with preview" into an authoring tool; channel decomposition is the key idea | future timeline | **high** — fully `swt`-drawn | **R3** |

**Explicitly excluded from this list:** Poly2Tri triangulation, catmull-clark
subdivision, and FTGL glyph vectorising. They are attractive, but they are **third-party
BSD/MIT code vendored into White Dune** (§1.4). Take them from their own upstreams under
their own, more permissive licenses — never via White Dune.

---

## 9. Things WRL Forge should explicitly NOT copy (R4)

1. **The document representation.** A live object graph as the source of truth, with
   comments reduced to `NodeComment` graph members and text regenerated on write. This would destroy the
   lossless core and is prohibited by `WD.md` §2. **The single most important reject.**
2. **`Path` structural identity** (`src/Path.h`). Already measured and rejected by WD1.4
   (1,020+ wrong anchors); White Dune's own `m_ignoreStrangePath` / `printStrangePath`
   confirm its fragility.
3. **Raw `Node *` pointer identity in commands.** Only valid because the tree is never
   re-derived; incompatible with a reparsed text document.
4. **`src/swt/`** — the entire custom widget toolkit (`motif/`, `win32/`, `generic/`).
   Electron already solves this.
5. **Fixed-function OpenGL**: `glPushName`/`glLoadName` selection-buffer picking,
   `glPushMatrix`, `glPushAttrib(GL_LIGHTING)`, and all of `drawHandles()`. Removed from
   core profiles; X_ITE owns rendering and picking.
6. **`MainWindow`'s structure** — 14,913 lines, 194 preprocessor conditionals.
7. **`extern DuneApp *TheApp`** global-singleton access from leaf code.
8. **Dead exporters** — Project Wonderland (~443 KB), CATT-Acoustic, LDraw `.dat`, AC3D,
   and the C/C++/Java source generators.
9. **External-editor-plus-500 ms-polling script editing** (`ScriptEdit.cpp`). WRL Forge's
   native editor is strictly better.
10. **The testing strategy** — a 211-line `selftest.cpp` and source-tree lint scripts.
11. **Pre-STL containers** (`Array`/`List`/`Map`/`Stack`/`MyString`) and compiler
    workarounds like `strange_dummy_for_aix_gcc2_95`.
12. **`assert(0)` as error handling** (`Scene::undo`).
13. **Unbounded undo memory** — full value copies with no cap or coalescing.
14. **White Dune's `IS`/ROUTE/scope semantics.** WRL Forge's P2B/P2C are more rigorous
    and corpus-validated. Reuse the **UI**, never the semantics.
15. **The vendored third-party copies** (Poly2Tri, FTGL, catmull-clark, OpenVRML
    `pngLoad`, xloadimage `gif`). Go to the real upstreams.
16. **GPL example scenes and fixtures** — not copied, and not recommended while the real
    Cybertown corpus is richer.
17. **`docs/typical_vrml_examples/`-style accumulation** and the 8-platform `desktop/`
    tree — platform integration that was never pruned.

---

## 10. Recommendation: P4 vs WD2

### Recommendation: **`NEW_INTERMEDIATE_LANE_FIRST`**

**Proposed lane: `WD1.6 — Semantic Consumer API`.**

**Reasoning.**

The audit changes the picture in a specific way. Before it, the choice looked like
"present the semantic results (P4)" vs "start building the authoring UI (WD2)". After
reading White Dune, a third fact is visible: **both P4 and WD2 are consumers of a query
layer that does not exist yet, and they need overlapping parts of it.**

- **Everything WD1.4 and WD1.5 built is consumer-free.** `node-identity.js`,
  `document-transaction.js`, `symbols.js` and `scope-graph.js` have **no production
  caller**. The very first consumer will discover the API shape, and doing that inside a
  UI lane means discovering it under UI pressure.
- **White Dune's answer to "what does a consumer need?" is `Proto`** — one type
  descriptor that answers interface questions for built-ins *and* user PROTOs
  identically (§4.9, R2-4). WRL Forge currently answers half from `node-schema.js` and
  half from the scope graph, with no unified query. **P4 needs this** (to report a Table
  4.4 violation you must know the node's effective interface). **WD2 needs the same
  thing** (to draw an inspector you must know the node's effective interface). Building
  it twice, or building it inside P4 shaped only for diagnostics, is the risk.
- **Two schema gaps block WD2 and are cheap to close now**: field constraints
  (min/max/node-class/enumerated values, R2-1) and node containment legality (R2-2).
  Both are ISO facts, both extend the existing generator, and both are pure-function
  work with no UI. Discovering them *during* WD2 would stall it.
- **P4's remaining question is genuinely narrow.** P2B found 1,481 Table 4.4 violations
  (99.6% the `exposedField` column); P2C found 0 direction violations and 1 type
  mismatch. So P4 is *presentation policy for one well-characterised finding class* —
  error vs `§9` compatibility warning vs profile. That is a real decision, but it is
  small, and it is much easier to make correctly once there is a consumer API that shows
  how the finding will actually be surfaced.
- **WD2 first would be premature.** It would need to invent, simultaneously: the
  consumer API, the undo/command layer, containment legality, constraint metadata, *and*
  the UI. White Dune's own history is the cautionary evidence — `MainWindow.cpp` at
  14,913 lines is what happens when UI grows faster than the layers under it.

**Scope of `WD1.6` (defined precisely, not implemented):**

1. **A unified node-interface query.** One function answering, for any node occurrence in
   a document: declared fields/eventIns/eventOuts/exposedFields with effective access,
   including alias expansion, resolving identically for built-in nodes
   (`node-schema.js`) and user PROTO/EXTERNPROTO instances (`scope-graph.js` P2A/P2B).
   Fail-closed: `unresolved` / `unsupported` / `ambiguous` propagate, never collapse.
2. **Schema extension — field constraints.** Extend `scripts/build-node-schema.js` to
   extract numeric `min`/`max`, enumerated allowed values, and accepted node class per
   SFNode/MFNode field **from the ISO mirror**. Regenerate and commit `node-schema.js`.
   Use White Dune's tables only as a cross-check oracle in a spike; record the
   consultation.
3. **Containment legality.** A node-class taxonomy derived from ISO node groupings, plus
   an `isLegalChild(parentNode, field, childNodeType, profile)` query.
4. **A findings model.** One structured representation for a semantic finding —
   location, rule, severity, confidence, profile classification (strict / compatibility /
   vendor) — that both a diagnostics surface (P4) and an authoring surface (WD2) can
   consume. This is the piece that makes P4 a *rendering* decision afterwards.
5. **No UI. No renderer change. No new dependency.** Pure `src/vrml/` + `scripts/`
   + tests, same shape as P1/P2A/P2B/P2C.

**Then:** `P4` (now a presentation lane over item 4, small), **then** `WD2` (which starts
with an undo/command layer and a scene-tree projection, both already de-risked).

This ordering is a **refinement** of the existing plan, not a replacement: it extracts
the shared substrate that P4 and WD2 were each going to have to invent, and it converts
the two hardest WD2 unknowns (constraints, legality) into pure-function work that the
existing test infrastructure covers well.

---

## 11. Staged roadmap — "simple Blender for VRML/X3D"

Seven stages. Each is a separately approvable lane with a user-visible outcome.

| # | stage | user-visible capability | architectural dependency | White Dune contribution | major risk |
|---|---|---|---|---|---|
| **1** | **WD1.6 — Semantic Consumer API** | none directly; unblocks everything after | WD1.4 identity, WD1.5 scope graph, `node-schema.js` | **R2-1** (constraints), **R2-2** (containment), **R2-4** (unified `Proto` query) | over-designing for hypothetical consumers — keep it to what stages 2–4 provably need |
| **2** | **P4 — Diagnostics presentation** | semantic findings surfaced in the editor: `IS`/ROUTE/scope results, Table 4.4 violations classified strict vs `§9` compatibility | stage 1's findings model | — (WRL Forge is ahead) | 1,481 corpus violations must not read as "your file is broken"; classification is the whole job |
| **3** | **WD2a — Scene tree + inspector (read/edit fields)** | see the scene as a tree; select a node; edit typed fields with real constraints; **undo/redo** | stage 1; **new command layer over `edit.js`** | **R2-3** (commands/grouping), **R2-5** (update bus), **R2-7**, **R3-3/5/6/7** | undo over span patches must preserve selection — Tier-1 re-anchoring is the mechanism and needs proving early |
| **4** | **WD2b — Node creation, deletion, reparenting** | insert nodes from a legality-filtered palette; delete; drag to reparent; copy/paste; DEF/USE aware | stage 3; containment legality from stage 1 | **R2-2**, **R2-7** (multi-parent USE), `MoveCommand`'s four-value undo shape | USE semantics: deleting one occurrence of a shared node is not deleting the node |
| **5** | **WD2c — 3D selection and transform gizmos** | click to select in the viewport; translate/rotate/scale with handles; selection synced with tree and inspector | stage 3/4; X_ITE picking | **R1-1** (handle protocol — *the* payoff), **R1-2** (frame math) | X_ITE picking capability must be spiked first; do **not** build a custom renderer |
| **6** | **WD2d — ROUTE + `IS` graph editor** | node-graph canvas: sockets, wires, drag-to-connect, `IS` bindings shown; illegal/unproven connections visibly distinct | stage 3; P2C resolver (built) | **R2-8** (layout), **R3-1** (the UX) | keep WRL Forge's `routeVerdict` authoritative — the canvas must render "unproven" rather than guess |
| **7** | **WD2e — Geometry + animation authoring** | primitive creation; `Coordinate`/`Extrusion`/`ElevationGrid` handle editing; keyframe timeline | stages 5/6; mesh services | **R2-6** (`MyMesh`), **R1-1** extended, **R3-2** (timeline) | scope creep — NURBS, HAnim, subdivision are **out**; take triangulation from Poly2Tri upstream if ever needed |

**Cross-cutting, at every stage** — the strengths that must not regress:

- text stays the document; every edit is a span patch (`WD.md` §2)
- ISO/IEC 14772-1 remains normative; vendor behaviour stays a tagged compatibility
  profile (`WD.md` §9)
- resolution stays fail-closed — `unresolved`/`unsupported`/`ambiguous` never collapse
  into a confident answer (`WD.md` §7)
- X_ITE remains the only renderer; runtime dependencies stay `x_ite`-only
- Mall Item / World Project / Generic profile separation holds
- every lane ships reproducible tests, and corpus claims ship with their denominator

**A note on "simple Blender".** The audit supports the ambition but suggests the framing
matters: White Dune *had* NURBS, HAnim, superformula generators, subdivision, and a
dozen exporters, and was still not approachable — because complexity accumulated with no
simplification mode until `-4kids` was bolted on. **The differentiator is not feature
count; it is that WRL Forge can be an authoring tool that never damages the file it
opens.** No other VRML editor can say that. Stages 3–6 should be judged on whether they
preserve that, and R3-4 (a simplified mode designed in, not retrofitted) should be a
stage-3 design input rather than a later addition.

---

## 12. Open questions for owner review

1. **Provenance policy — does *reading* require a register entry?**
   `OPEN_SOURCE_PROVENANCE.md` §4 says the register records material *"incorporated
   into"* WRL Forge, and the current entry ("None. No third-party implementation code
   has been copied, adapted, or translated") **remains factually true** after this lane.
   But §2.1 says *"'Conceptually informed only' — you read it, then wrote your own —
   should still be recorded."* This lane read a great deal and wrote no code, so no
   production code is yet "informed". Per the brief §30, **no register entry was
   invented.** The consultation is recorded in §1.6 of this document.
   **RESOLVED at closeout.** `OPEN_SOURCE_PROVENANCE.md` gained a **Research & Reference**
   section, distinct from and not replacing the production register, and this audit is its
   first record. The production register still reads "None — no third-party implementation
   code has been copied, adapted, or translated", which remains true.
2. **Stale external archive record.** `~/Projects/white-dune-archive/PROVENANCE.md` still
   states "WRL Forge is **MIT**. The two are incompatible; nothing here may be copied"
   and cites the deleted `GPL_PROVENANCE_BOUNDARY.md`. It also under-reports the vendored
   third-party licensing (§1.4). It is outside this repository, so it is not part of this
   commit.
   **RESOLVED at closeout** — corrected in place; see §1.5. Reported separately.
3. **Corpus guards.** `spikes/*/corpus.js` still **throws** on a White Dune path. `WD.md`
   §1 says this stays (corpus hygiene — a VRML97 semantics sweep should measure authored
   content, not a modelling tool's C++ tree), and this audit did not touch it. But R2-1
   proposes using White Dune's field tables as a **cross-check oracle** in a spike.
   **RESOLVED at closeout — and the answer is that no exemption is needed.** The guards are
   **unchanged**, and the boundary is: generic VRML97 semantic corpus sweeps must continue
   to exclude modelling-tool source trees, while a dedicated oracle reader may open named
   White Dune files by **explicit path**, never through generic corpus enumeration. A
   path-addressed reader never consults `corpus.js`, so the guard and the oracle do not
   interact. Any such oracle is read-only, non-normative (ISO adjudicates every
   discrepancy), and recorded under Research & Reference.
4. **Third-party upstreams.** If triangulation or subdivision is ever wanted, take
   Poly2Tri (BSD-3-Clause) and catmull-clark (MIT) from their own upstreams. Both are
   more permissive than GPL and would be `THIRD_PARTY_NOTICES.md` entries. Worth
   pre-approving in principle?
5. **X_ITE picking.** Stage 5 assumes X_ITE exposes usable pick/ray-intersection.
   **Unverified.** A small spike should precede any gizmo lane. Recorded, not run.
6. **`-4kids`-style simplified mode** (R3-4) — design input for WD2, or explicitly out of
   scope?

**No production defect was found during this audit.** The one behavioural observation
worth recording is not a defect: `src/vrml/node-schema.js` carries no field-level
`min`/`max`, accepted-node-class, or enumerated-value data. That is a **known scope
boundary** of WD1.3 (which extracted names, types, access categories and defaults), not a
bug — and closing it is R2-1 / stage 1 above.

---

## 13. Lane boundary attestation

- Files created: **this document only.**
- `src/`, `renderer/`, `main.js`, `preload.js`, `validator.js`, `scripts/`, parser, scope
  graph, node schema, editor, preview, packaging: **unmodified.**
- White Dune source: **read only.** Nothing copied, vendored, submoduled, committed, or
  imported. No fixture, example scene, or asset copied. The upstream clone lives at
  `/tmp/white-dune-current-audit/` and is outside every Git repository.
- P4, WD2, and Mac Silicon work: **not started.**
- `spikes/*/corpus.js` and every White Dune corpus guard: **unchanged.**

**Closeout amendment.** The audit lane itself wrote only this document. At closeout two
further changes were made and are reported with it:

- `OPEN_SOURCE_PROVENANCE.md` — added the **Research & Reference** section and this
  lane's record. Committed alongside this document.
- `~/Projects/white-dune-archive/PROVENANCE.md` — stale MIT-era statement corrected.
  **Outside this repository; not part of the commit**, reported separately.

No production source, script, test, generated schema or package metadata was modified in
either the audit or the closeout.
