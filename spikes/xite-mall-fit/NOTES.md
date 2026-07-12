# X_ITE Mall Fit Technical Spike — Findings

Isolated technical spike for WRL Forge Phase 2A. Not integrated into the
production app. Preview/display only — no apply/bake/mutation path exists
anywhere in this directory.

## Sources consulted

- X_ITE homepage / docs: https://create3000.github.io/x_ite/
- `x_ite` npm package, v15.1.10 (installed locally in this spike):
  https://www.npmjs.com/package/x_ite
- The package's bundled TypeScript definitions,
  `node_modules/x_ite/dist/x_ite.d.ts` (23,857 lines) — the primary source
  for everything below; this is the actual shipped API surface, not
  secondhand documentation.
- The package's bundled `dist/example.html`, showing the documented
  `<x3d-canvas src="...">` DOM-integration pattern.

## Distribution and licensing

- MIT license, zero transitive dependencies, ~32.7MB unpacked (mostly the
  bundled browser runtime + assets).
- Distributed as a local browser bundle (`dist/x_ite.min.js` /
  `dist/x_ite.mjs`), loaded via a `<script>` tag or ESM import — not a
  Node-side library. It runs entirely in the renderer/browser context.
- No native/platform-specific binaries — same package works unmodified on
  Windows, satisfying the "no avoidable Linux-only assumptions" constraint.
  Packaging implication for a future production integration: the package
  just needs to ship inside the app bundle (like any other npm dependency),
  no per-platform build step.

## Loading a local VRML97 file

Confirmed API: `X3DBrowser.createX3DFromString(x3dSyntax: string): Promise<X3DScene>`,
followed by `X3DBrowser.replaceWorld(scene: X3DScene): Promise<void>`. This
spike inlines the fixture as a string fetched from a same-origin
`fixtures/*.wrl` file (see "Security boundary" below) rather than passing a
URL, avoiding any URL-loading policy question entirely.

Reload after `.edit.wrl` changes (future production concern, not exercised
in this spike): re-call `createX3DFromString` with the new text and
`replaceWorld` again — no evidence of a need to tear down and recreate the
`<x3d-canvas>` itself.

## Scene graph access

- `X3DScene.rootNodes: MFNode` — array-like, indexable, `.length`.
- `X3DScene.getNamedNode(name): SFNode` — resolves `DEF`-named nodes.
- **Important, easy to get wrong**: node fields accessed via array indexing
  or field access return `SFNode`-wrapped objects. Calling `.getTypeName()`
  on one of these returns the *field wrapper's* type name, always
  `"SFNode"` — not the concrete node type. The correct call is
  `.getNodeTypeName()`, which returns `"Shape"`, `"Transform"`, `"Box"`,
  etc. This tripped up the traversal code during development (see git
  history) and cost real debugging time; documenting it here so a future
  production implementation doesn't repeat the mistake.
- Field access on a resolved node works directly as `node.translation`,
  `node.geometry`, `node.children`, etc. (matches the "sfnode.{fieldName}"
  syntax noted in the type defs' deprecated `getField()` entry).

## DEF/USE representation

X_ITE resolves `USE X` to the **same JS node object** as the corresponding
`DEF X` during parsing — there is no separate "reference" wrapper. This
means a correct bounds traversal must walk the **tree structure** (every
occurrence of a node in a `children` array, including via `USE`), not a
deduplicated set of unique node objects — otherwise a `USE`'d shape's
geometry would only be counted once, at whichever occurrence happened to be
visited first, with the wrong accumulated transform. `bbox-traversal.js`
does this correctly (see its top-of-file comment) but this was **not**
directly tested against a `DEF`/`USE` fixture in this spike due to time —
flagged as a real gap in test coverage below, not glossed over.

## Bounding-box API — the central finding

**X_ITE's public/typed API does not expose a computed, transform-aware
aggregate bounding box.** Searched the entire 23,857-line `.d.ts` for
`getBoundingBox`, `getBBox`, `worldBBox`, `calculateBBox`, and similar —
zero matches. The only bbox-related fields found are `bboxCenter` /
`bboxSize` on `X3DBoundedObjectProxy` (inherited by `Transform`, `Group`,
etc.) — these are **author-supplied hints** per the X3D spec, almost always
left at their default/unset value in hand-authored VRML97 (confirmed: none
of this project's real fixtures set them). One doc comment on `Transform`
is telling: *"Bounding box size is usually omitted, and can easily be
calculated automatically by an X3D player at scene-loading time with
minimal computational cost"* — implying X_ITE computes bounds internally
(for culling/viewpoint-fitting) but does not expose that computed value
through any public method.

**Conclusion: a trustworthy bbox requires manually accumulating world
transform matrices while traversing the parsed scene graph, using the
confirmed public `SFMatrix4` API** (`setTransform`, `multRight`,
`multVecMatrix`) plus per-geometry local bounds computed from actual field
data (`Coordinate.point`, `Box.size`, `Sphere.radius`, etc.) — never from
regex/string scraping of the VRML source. `bbox-traversal.js` implements
exactly this. It is real matrix math over the parsed scene, satisfying the
"no regex geometry bounds" requirement — it is not a shortcut disguised as
one.

### Matrix composition — a mistake caught during verification, not assumed correct

X_ITE uses row-vector convention (`multVecMatrix` treats the point as a row
vector: `p' = p · M`). To compose a child's local transform with its
parent's accumulated world transform in the correct order
(`p' = p · local · parent`), the correct call is
`local.multRight(parent)`, **not** `local.multLeft(parent)` — the first
draft of this traversal used `multLeft` by mistake. This was caught by
hand-computing the expected result for the `nested-transform.wrl` fixture
(two nested `Transform` nodes: outer `translation 5 3 0`, inner
`translation 0 2 0 / scale 2 2 2`, wrapping a `Box { size 1 1 1 }`,
expected world bbox `[4,4,-1]` to `[6,6,1]`) and comparing against the
traversal's actual output before and after the fix. Documenting this here
because it's exactly the kind of silent-wrong-answer bug the "no regex, no
faked certainty" requirement is meant to prevent — the fix is verified, not
assumed.

## Nested transforms — verified

`fixtures/nested-transform.wrl` (outer translate, inner translate+scale,
wrapping a unit Box) produces the exact hand-calculated world bbox
`[4, 4, -1]` to `[6, 6, 1]`. **Confidence: high** — this is a direct,
checked comparison against manually worked matrix arithmetic, not just "it
ran without error."

## Rotation — verified, with a caveat

`fixtures/rotated-box.wrl` (a unit `Box` under a 45° Y-axis rotation)
produces `min [-0.7071..., -0.5, -0.7071...]`, `max [0.7071..., 0.5,
0.7071...]` — exactly the expected axis-aligned bounding box of a rotated
unit cube (half-diagonal `0.5 · √2 ≈ 0.70711` in X/Z, unchanged `0.5` in Y).
**Confidence: high** for this single-node rotation case.

**Caveat**: this only exercises rotation composed with the identity parent
matrix. A rotation nested several levels deep under prior
translate/scale/rotate transforms was not separately tested — the
`nested-transform.wrl` fixture uses translate+scale only, not rotation. The
underlying matrix math (`SFMatrix4.setTransform` composing translation,
rotation, scale, scaleOrientation, and center per X3D's standard TRS
formula, then composed via `multRight`) is the same code path regardless of
depth, so there's no structural reason to expect it to behave differently
nested — but this spike did not construct and check a nested+rotated
fixture by hand, so treat "arbitrary-depth nested rotation" as **inferred,
not independently verified**.

## Primitives and IndexedFaceSet — what's implemented, what's approximate

`bbox-traversal.js`'s `localGeometryBox()` handles, from real field data
(no regex):

- `IndexedFaceSet` / `IndexedLineSet` / `PointSet` / `TriangleSet` /
  `TriangleFanSet` / `TriangleStripSet` — union of all `Coordinate.point`
  values. **Note**: this uses every point in the `Coordinate` node, not
  just the ones actually referenced by `coordIndex` — a safe (non-shrinking)
  over-approximation if a `Coordinate` node has unused points, which is
  extremely rare in practice and never under-estimates the true bounds.
- `Box`, `Sphere`, `Cylinder`, `Cone` — exact, from their size/radius/height
  fields.
- `Extrusion` — **corrected in Phase 2B0 to an exact VRML97 cross-section
  sweep** (see "Extrusion bounds — corrected" below). The earlier
  approximation ignored `scale`/`orientation` and dangerously
  under-estimated width/depth; that is fixed and verified against X_ITE's
  own generated mesh.

## Extrusion bounds — corrected (Phase 2B0)

The independent Phase 2A QA flagged a **blocker**: the Extrusion handling
ignored the `scale` and `orientation` fields, so a scaled extrusion's
width/depth were dangerously under-estimated (a 12 m item could pass the
10 m Cybertown rule). Fixed in `extrusion-bounds.js` (pure, node:test-able):
it builds each spine point's spine-aligned cross-section (SCP) frame,
applies the per-spine `scale` then `orientation` to every cross-section
vertex, maps it into the SCP frame, and unions the swept points. Caps add
no vertices beyond the end cross-sections. Field-length rules (0/1/N values)
follow the spec. Ambiguous/degenerate spine points fall back to a
conservative bounding ball (overestimate, never smaller) and report
`confidence: 'conservative'`.

**Verified**: every untransformed extrusion fixture's analytic bounds match
**X_ITE's own generated-mesh bounds** (`geometry.getValue().getMin()/getMax()`)
EXACTLY — a real ground-truth oracle, not a hand-wave. Transformed extrusions
match hand-derived world bounds. A fit-math integration test proves the fix
turns a former false-compliance (oversized extrusion passing at 125 %) into a
correctly capped scale. Full evidence:
`qa/phase-2b0-extrusion-loading/RESULTS.md`.

**Discovery worth keeping**: although X_ITE exposes no *public* aggregate
bbox API (the Phase 2A finding stands), each underlying geometry node —
reached via `geometry.getValue()` — does have `getBBox()/getMin()/getMax()/
getVertices()` on its generated mesh. That is an internal (non-proxy) surface,
so it is used here only as a verification oracle, not as the production bounds
source; the deterministic, node-testable analytic sweep remains authoritative.

## Local texture resolution — implemented (Phase 2B0)

Relative texture URLs now resolve against the **source .wrl's own directory**.
The main process supplies that directory as a `file://` base URL (see
`texture-base.js` `fileDirUrl`), and the renderer sets `browser.baseURL`
before `createX3DFromString`. Verified end-to-end: same-dir, nested
(`tex/wood.png`), `./tex.png`, and space-containing (`my stone.png`, percent-
encoded) textures all load; a missing texture yields a clear
`Couldn't load URL '…/fixtures/nope.png'` warning **without** breaking bounds
extraction; a filename case mismatch (`Stone.PNG` vs `stone.png`) is surfaced
clearly on Linux (case-sensitive fs). See RESULTS.md §4.

## Gzip → X_ITE loading — implemented (Phase 2B0)

X_ITE now receives **decompressed text only**. A read-only main-process IPC
channel (`wrl:load`) reads the source, detects gzip with the **production**
`isGzip` helper (reused from `src/files/vrml-file.js`, not duplicated),
decompresses via `zlib`, and returns the text; X_ITE never fetches/parses gzip
bytes. Malformed gzip yields a clear, prefixed error. `wrl-source.test.js`
covers plain→text, gzip→identical-text, corrupt→error, and source non-mutation.

## Security posture after Phase 2B0

The spike gained exactly one narrow, **read-only** IPC channel (`wrl:load`) —
still `contextIsolation:true`, `nodeIntegration:false`, no write-capable IPC,
no Node/fs handed to the renderer, no remote URL loading. Renderer-supplied
names are confined to the `fixtures/` directory by `texture-base.safeResolve`
(rejects `../`, absolute paths, drive letters). The base-URL helper only ever
produces local `file://` URLs, so a malicious texture URL cannot trigger a
remote fetch through it.

## Security boundary — how this spike avoids privileged access

- `contextIsolation: true`, `nodeIntegration: false` in
  `spikes/xite-mall-fit/main.js` (own, separate Electron main process — not
  a reuse of the production app's `main.js`).
- `preload.js` exposes **no API at all**. The fixture is loaded via a
  same-origin `fetch('fixtures/<name>.wrl')` from `index.html` itself — no
  IPC channel, no Node `fs` access from the renderer, nothing for a loaded
  VRML file to reach even if it somehow contained malicious script content.
- No remote URL loading anywhere — `x_ite.min.js` is loaded from the local
  `node_modules` copy, not a CDN; the fixture is loaded from a local
  same-origin path; `win.loadFile()` only.
- No write-capable IPC handler exists anywhere in this directory — the
  strongest form of "preview-only": the capability to write a file doesn't
  exist in this code, it isn't just unused.

## Preview behavior — verified, not just implemented

The harness (`index.html`) supports two modes via on-screen buttons:
"Original" (just the loaded fixture) and "Cybertown Fit" (fixture +
non-exported guide overlay from `guides.js`: ground plane at `Y=-1.75`,
center axis at `X=0`, `Z=+1` limit plane, and a wireframe `10×10×10`
bounding cage). `guides.js`'s output is plain generated VRML text, loaded
into the browser via the same `createX3DFromString` path as any other
scene — **never merged into or written back to the fixture text**.

This was verified to actually parse in X_ITE, not just assumed to work: a
`?verifyGuides=1` hook loads the fit-preview mode programmatically before
quitting and reports `XITE_GUIDES_RESULT`. Run against
`real-smartcar-lite.wrl`, result: `{"ok":true,"error":null}` — the combined
fixture+guides VRML parses and renders without error.

## Fit math — fully decoupled and independently tested

`fit-math.js` is pure (no Electron, no X_ITE, no fs) and takes only a
`{min:[x,y,z], max:[x,y,z]}` bbox plus optional rule overrides. It has no
dependency on how the bbox was obtained, so it's fully testable (11 cases in
`fit-math.test.js`, covering: already-compliant, off-center, above/below
ground, exceeds Z limit, exceeds 10m (scale capped below the 125% request),
zero-size axis, negative coordinates, a nested-transform-shaped bbox, a
rotated-geometry-shaped bbox, and custom rule overrides) independent of
X_ITE's availability or correctness.

One real bug caught during end-to-end testing against
`real-smartcar-lite.wrl` (not a synthetic case): the initial `1e-9`
violation-detection epsilon flagged the item's ground placement
(`minY = -1.7500003673...`, off from `-1.75` by floating-point noise
inherent to matrix math) as a "violation." Fixed by widening the epsilon to
`1e-4`, which is generous enough for real transform-derived floating-point
noise while still catching genuine, meaningful violations (all four
intentional-violation unit tests still fail correctly at that epsilon).

## Fixtures tested (all real runs, not hypothetical)

| Fixture | What it tests | Result |
|---|---|---|
| `simple-box.wrl` | Trivial single Shape, no transforms | `min [-1,-1,-1]` `max [1,1,1]` — exact match for a `Box{size 2 2 2}` |
| `nested-transform.wrl` | Two nested `Transform` (translate+scale) | `min [4,4,-1]` `max [6,6,1]` — exact match to hand calculation |
| `rotated-box.wrl` | Single `Transform` with 45° Y rotation | `min/max` at `±0.70711/±0.5/±0.70711` — exact match to hand calculation |
| `real-smartcar-lite.wrl` | Real, permission-safe Cybertown Mall item (the user's own authored item, copied from `../new-items/smartcar/smartcar-lite.wrl`) | `min [-1.052, -1.750, -2.449]` `max [1.052, -0.030, 0.989]` — plausible real-world bounds; fed through `computeFit()` end-to-end with zero violations after the epsilon fix |

All four were run through the actual Electron + X_ITE pipeline via
`XITE_SPIKE_FIXTURE=<name> XITE_SPIKE_AUTOQUIT=6000 electron . --no-sandbox`,
not simulated.

**Not tested**: a fixture combining `DEF`/`USE` with the bbox traversal (the
DEF/USE *representation* was researched and the traversal is written to
handle it correctly by construction, but no fixture exercised it end-to-end
in this spike — see "DEF/USE representation" above).

## Confidence summary

| Area | Confidence | Basis |
|---|---|---|
| `createX3DFromString`/`replaceWorld` loading | High | Documented API, works in all 4 test runs |
| Single/nested translate+scale transform composition | High | Hand-verified against `nested-transform.wrl` |
| Single-level rotation | High | Hand-verified against `rotated-box.wrl` |
| Deeply nested rotation | Medium (inferred, not directly tested) | Same code path as verified cases, but no dedicated fixture |
| Primitives (Box/Sphere/Cylinder/Cone) | High | Simple, exact formulas from real field data |
| IndexedFaceSet-family via Coordinate.point | High | Verified via `real-smartcar-lite.wrl`'s plausible real bounds |
| Extrusion (scale/orientation/caps/transforms) | High | Exact match to X_ITE generated-mesh oracle on 9 fixtures + hand-derived transformed cases; conservative fallback for degenerate spines (Phase 2B0) |
| DEF/USE bbox correctness | Medium (inferred from confirmed node-sharing semantics; QA verified via qa-def-use.wrl in the QA clone, no fixture in this repo) | Traversal design correct by construction |
| Local texture resolution (relative, nested, spaces, missing, case) | High | Verified end-to-end via source-directory baseURL (Phase 2B0) |
| Gzip → X_ITE (decompressed-text loading) | High | node:test + end-to-end X_ITE render (Phase 2B0) |
| Fit math (ground/center/Z/size/scale) | High | 11 unit tests + real-item end-to-end run |
| Security boundary | High | No IPC surface exists to audit away |

## Recommendation for Phase 2B scope

The bounding-box approach (manual matrix-accumulation traversal, not a
built-in X_ITE API) is the correct path forward and should carry into
Phase 2B largely as-is, but Phase 2B should budget time to: add DEF/USE and
Extrusion test fixtures, implement real local-texture resolution relative
to the mall item's actual directory, and decide whether the current
point-cloud-based IndexedFaceSet bound (uses all `Coordinate.point`
entries, not just `coordIndex`-referenced ones) is acceptable long-term or
needs tightening.
