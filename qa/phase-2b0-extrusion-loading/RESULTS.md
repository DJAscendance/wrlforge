# Phase 2B0 — Extrusion / Gzip / Texture Remediation Results

Evidence for the remediation lane that clears the independent Phase 2A QA's
**CONDITIONAL GO** blockers. All runs are real (Electron + X_ITE v15.1.10 on
Linux), not simulated.

Artifacts in this directory:
- `oracle-raw.json` — raw analytic-vs-X_ITE-mesh comparison output.
- `input-hashes.md5` — md5 of every fixture/texture input (non-mutation proof).
- `screenshots/` — visual verification PNGs (see §5).

---

## 1. The blocker, reproduced then fixed

The pre-fix `bbox-traversal.js` ignored the `Extrusion` `scale`/`orientation`
fields and expanded the raw cross-section half-diagonal on all three axes.

**Reproduction** (fixture `qa-extrusion-scale.wrl`, 2×2 cross-section, `scale [3 3]`,
vertical spine y=−5..5, true bounds X:[−3,3] Y:[−5,5] Z:[−3,3]):

| | X | Y | Z |
|---|---|---|---|
| Pre-fix output | **[−1.414, 1.414]** | [−6.414, 6.414] | **[−1.414, 1.414]** |
| True / post-fix | [−3, 3] | [−5, 5] | [−3, 3] |

The pre-fix X/Z half-width of 1.414 vs the true 3 is the **dangerous width/depth
underestimate** the QA flagged. Post-fix output is exact (see §2).

---

## 2. Extrusion bounds — analytic vs X_ITE generated-mesh oracle

The fix computes the true VRML97 cross-section sweep (per-spine `scale` +
`orientation`, mapped through the spine-aligned cross-section frame) in the pure
`extrusion-bounds.js` module. Every untransformed extrusion fixture's analytic
world bounds were compared against **X_ITE's own generated-mesh bounds**
(`geometry.getValue().getMin()/getMax()`) as an independent ground-truth oracle:

| Fixture | Analytic (ours) | X_ITE mesh oracle | Match | Confidence |
|---|---|---|---|---|
| `ext-default.wrl` | [-1, 0, -1] .. [1, 4, 1] | [-1, 0, -1] .. [1, 4, 1] | EXACT | exact |
| `ext-uniform-scale.wrl` | [-2, 0, -2] .. [2, 3, 2] | [-2, 0, -2] .. [2, 3, 2] | EXACT | exact |
| `ext-per-spine-scale.wrl` | [-2, 0, -2] .. [2, 4, 2] | [-2, 0, -2] .. [2, 4, 2] | EXACT | exact |
| `ext-orientation-spine.wrl` | [-1.76777, 0, -1.76777] .. [1.76777, 4, 1.76777] | [-1.76777, 0, -1.76777] .. [1.76777, 4, 1.76777] | EXACT | exact |
| `ext-multi-orientation.wrl` | [-2, 0, -2] .. [2, 4, 2] | [-2, 0, -2] .. [2, 4, 2] | EXACT | exact |
| `ext-scale-orientation.wrl` | [-3.53553, 0, -3.53553] .. [3.53553, 4, 3.53553] | [-3.53553, 0, -3.53553] .. [3.53553, 4, 3.53553] | EXACT | exact |
| `ext-negative-coords.wrl` | [-1, -5, -1] .. [1, -1, 1] | [-1, -5, -1] .. [1, -1, 1] | EXACT | exact |
| `ext-car-like.wrl` | [-1.8, 0, -0.7] .. [1.8, 3, 0.7] | [-1.8, 0, -0.7] .. [1.8, 3, 0.7] | EXACT | exact |
| `qa-extrusion-scale.wrl` | [-3, -5, -3] .. [3, 5, 3] | [-3, -5, -3] .. [3, 5, 3] | EXACT | exact |

**All EXACT** — the analytic sweep matches X_ITE's real tessellated geometry to
< 1e-3 on every axis, including the rounded 9-point car-like profile with taper.

### Transformed extrusions (analytic vs hand-derived)

Parent-transform composition was verified separately (local-frame oracle can't
see parent transforms):

| Fixture | Expected world bounds | Result |
|---|---|---|
| `ext-transformed.wrl` (translate [5 1 0] scale [2 1 1]) | [3,1,−1]..[7,3,1] | MATCH |
| `ext-rotated-parent.wrl` (90° Y rotation, swaps X/Z extents) | [−0.5,0,−2]..[0.5,2,2] | MATCH |
| `ext-nonuniform-parent-scale.wrl` (scale [3 1 0.5]) | [−3,0,−0.5]..[3,2,0.5] | MATCH |

### Underestimate-safety

- For determinate spine frames the result is **exact** (equal to X_ITE's mesh).
- For a degenerate/ambiguous spine point (repeated points; a straight spine
  whose rotation about its own tangent is browser-defined) the module falls back
  to a **conservative bounding ball** of radius `max‖scale·crossSection‖` around
  that spine point. Because the frame and orientation rotations are
  distance-preserving, that ball provably contains every possible cross-section
  vertex regardless of frame choice — an overestimate, never smaller. Such
  results carry `confidence: 'conservative'` and a warning
  (`extrusion-bounds.test.js` "degenerate repeated spine point…").

### False-compliance regression (fit-math integration)

`extrusion-fit-regression.test.js`: a 2×2 cross-section `scale [6 6]` (true 12 m
width) on a short spine. Old bounds saw ~2.8 m → **no size violation, passed at
125 %**. Corrected bounds see 12 m → size rule fires, compliant scale capped at
`10/12 = 0.833`. The corrected bounds force a *smaller* compliant scale than the
old underestimate — proving the bug caused real false-compliance.

---

## 3. Gzip → X_ITE loading

The spike now loads via a **read-only** main-process IPC channel (`wrl:load`)
that reads the source, detects gzip with the **production** `isGzip` magic-byte
helper (reused from `src/files/vrml-file.js`), decompresses with `zlib`, and
hands X_ITE **decompressed text only** (`createX3DFromString`). X_ITE is never
asked to fetch/parse gzip bytes.

| Check | Result |
|---|---|
| Plain WRL → expected text, `wasGzipped:false` | pass (`wrl-source.test.js`) |
| Gzipped WRL → text identical to plain twin, `wasGzipped:true` | pass |
| Corrupt gzip (magic bytes, broken body) → clear prefixed error | pass |
| Source file byte-identical after reads (md5) | pass |
| Gzipped fixture parses + renders + bounds in X_ITE (`gz-gzipped-twin.wrl`, `textured-gzipped.wrl`) | pass (end-to-end run) |

---

## 4. Relative texture base path

Before `createX3DFromString`, the renderer sets `browser.baseURL` to the
`file://` URL of the **source .wrl's own directory** (supplied by the main
process). Relative texture URLs resolve there, not against `index.html`.

| Fixture | Texture ref | Result |
|---|---|---|
| `textured-same-dir.wrl` | `stone.png` | loads, no warning |
| `textured-nested.wrl` | `tex/wood.png` | loads, no warning |
| `textured-dotslash.wrl` | `./stone.png` | loads, no warning |
| `textured-spaces.wrl` | `my stone.png` | loads, no warning (percent-encoded) |
| `textured-missing.wrl` | `nope.png` | clear warning, **bounds still computed** |
| `textured-case-mismatch.wrl` | `Stone.PNG` (file is `stone.png`) | clear warning on Linux (case-sensitive) |

Missing-texture warning (verbatim): `Couldn't load URL
'file:///…/fixtures/nope.png' for ImageTexture. TypeError: Failed to fetch` —
note it resolves against the **source directory**, confirming baseURL works. The
case-mismatch warning names `Stone.PNG`, making the Linux case issue diagnosable.

**Security**: the `wrl:load` channel is read-only and confines names to the
approved `fixtures/` directory via `texture-base.safeResolve` (rejects `../`,
absolute paths, drive letters — `texture-base.test.js`). No write-capable IPC,
no Node/fs exposed to the renderer, `contextIsolation:true`, `nodeIntegration:false`,
no remote (http/https) base URL ever produced.

---

## 5. Screenshots (`screenshots/`)

| File | View |
|---|---|
| `01-qa-extrusion-original.png` | QA regression fixture, Original mode |
| `02-qa-extrusion-fit.png` | Same, Cybertown Fit mode + guides (bbox [−3,−5,−3]..[3,5,3]) |
| `03-per-spine-scale-fit.png` | Per-spine-scaled extrusion, Fit mode |
| `04-oriented-fit.png` | Orientation-about-spine extrusion, Fit mode |
| `05-transformed-fit.png` | Transformed extrusion, Fit mode |
| `06-gzip-textured.png` | Gzip-loaded textured fixture |
| `07-missing-texture.png` | Missing-texture case (renders untextured, no crash) |
| `08-real-smartcar-extrusion-fit.png` | Real permission-safe Cybertown item (contains Extrusion), Fit mode |

---

## 6. Non-mutation

`input-hashes.md5`: 30 fixture/texture inputs, md5-identical before and after all
testing. The sibling source item `../new-items/smartcar/smartcar-lite.wrl` was
also md5-unchanged. No guide geometry is ever written into any `.wrl`.
