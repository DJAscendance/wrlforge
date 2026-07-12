# Phase 2B1 — Production Mall Item Fit Preview: QA Results

Evidence for the production integration of the X_ITE Mall Item Fit preview into
the WRL Forge application. All runs are real (Electron 41 + embedded X_ITE
v15.1.10 on Linux, `DISPLAY=:1`), not simulated. Mutation-capable steps used
scratch copies of the fixtures; the repository fixtures were hashed before and
after (`input-hashes.md5`).

## Automated tests

`npm test` / `npm run check` — **78 tests, 78 pass, 0 fail, 0 skip.**

- Pure `node:test` (72): fit-math (11), extrusion-bounds (15), extrusion-fit
  regression (1), texture-base (9), wrl-source (4), url-policy (8), validator,
  vrml-file, backups, window-state.
- Electron smoke (1): real app launch — title, `window.vrmlpad` bridge,
  `contextIsolation:true`, `nodeIntegration:false`, **preview canvas present,
  X_ITE initialised, Original/Fit controls present, CSP meta present**, clean exit.
- Electron preview (5): drive the real app + X_ITE against fixtures via the
  `WRL_FORGE_PREVIEW_FIXTURE` hook and assert authoritative bounds/fit/security:
  DEF/USE (both occurrences), corrected Extrusion (exact + scale capped),
  gzip source load, remote-URL block, missing-texture warning.

## Authoritative bounds / fit — real app runs (values captured from the app)

| Fixture | Authoritative bbox (world) | Confidence | Fit result |
|---|---|---|---|
| `def-use.wrl` | X:[-1,6] Y:[-1,1] Z:[-1,1] | exact | DEF at origin + USE @ +5 both counted |
| `qa-extrusion-scale.wrl` | [-3,-5,-3]..[3,5,3] | exact | 10m tall → **max compliant 100%, proposed 100% (not 125%)** |
| `gz-gzipped-twin.wrl` | [-1.5,-2,-2.5]..[1.5,2,2.5] | exact | gzip decompressed in main process, X_ITE got plain text |
| `oversized-box.wrl` (20m) | [-10,-1,-1]..[10,1,1] | exact | **max compliant 50%, proposed applied 50%** |
| `remote-texture.wrl` | [-1,-1,-1]..[1,1,1] | exact | remote texture blocked, bounds still computed |
| `textured-missing.wrl` | [-1,-1,-1]..[1,1,1] | exact | missing `nope.png` warned, bounds still computed |

The requested 125% scale is **never** reported as applied when a smaller
compliant scale is required (see oversized/extrusion rows and screenshot 05).

## Security — remote loading & traversal

- `url-policy.js` `isBlockedPreviewUrl()` blocks http/https/ws/wss/ftp/
  protocol-relative; allows file/data/blob (unit-tested, 8 cases).
- Wired into `session.webRequest.onBeforeRequest` (`<all_urls>`) in `main.js`:
  the `remote-texture.wrl` run shows the http texture producing
  `Couldn't load URL 'http://example.com/texture.png' … Failed to fetch` — the
  request is refused at the network layer; bounds still compute.
- CSP meta tag lists **no remote origin** (`default-src 'none'`; only
  `self`/`file`/`data`/`blob` for local schemes) — a second, independent layer.
- Path traversal / absolute paths / drive letters rejected by
  `texture-base.safeResolve` (unit-tested). The production preview channel does
  not even accept a renderer-supplied path — it reads only the currently-open
  item or its `.edit.wrl` (role selector), never an arbitrary path.
- No write-capable preview IPC exists; `contextIsolation:true`,
  `nodeIntegration:false` unchanged (smoke test asserts both).

## Screenshots (`screenshots/`)

| File | View |
|---|---|
| `00-empty-state.png` | No file open |
| `01-simple-original.png` | Original mode, simple primitive |
| `02-simple-fit-guides.png` | Cybertown Fit + guides (ground/center/Z/cage) |
| `03-def-use-fit.png` | DEF/USE item, Fit mode |
| `04-extrusion-fit.png` | Scaled+oriented Extrusion, Fit mode |
| `05-oversized-scale-reduced.png` | 20m item → proposed applied scale **50%** (reduced) |
| `06-smartcar-fit.png` | Real permission-safe Cybertown Smartcar (contains Extrusion), Fit |
| `07-textured-original.png` | Local relative texture loads |
| `08-gzip-textured.png` | Gzip-compressed textured item |
| `09-missing-texture-warning.png` | Missing texture (renders untextured, no crash) |
| `10-remote-url-blocked.png` | Remote-URL rejection fixture |
| `11-malformed-parse-error.png` | Malformed VRML → "BOUNDS UNAVAILABLE", honest confidence |
| `12-remote-url-blocked-warnings.png` | Tall view: rules + "Remote URL(s) blocked (never fetched)" warning |
| `13-missing-texture-warnings.png` | Tall view: missing-texture warning panel |
| `14-def-use-full-report.png` | Tall view: full fit report + suppressed advisory placement line |
| `15-responsive-small.png` | 620×680 window — layout reflows, no horizontal overflow |

## Non-mutation

`input-hashes.md5`: 40 repository fixture/texture inputs, md5-identical after all
QA (mutation-capable capture runs used scratch copies). No `.edit.wrl` or backup
files leaked into the repository. No guide geometry or fit transform is ever
written into any `.wrl` — the fit is preview-only (a parent Transform composed at
render time, never serialised).
