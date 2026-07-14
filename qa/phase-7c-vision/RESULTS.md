# Feature A — Vision Accommodations — Visual QA

**Result: PASS** — 9/9 states captured through **one reused Electron process**
(1 launch, 0 survivors, graceful exit, no launch loop, no fixture mutation).

Run: `npm run qa:vision` (Linux, X11). Sanctioned harness `VisualQaRunner`
(concurrency 1, launch cap, cooldown, timeout, PID tracking, leak check) — the
same one the 7B run uses. Machine-specific `RESULTS.json` (abs paths/PIDs) is
git-ignored; this file and `screenshots/*.png` are the committed evidence.

All scratch inputs are temp-confined (`os.tmpdir()`), refused by the capture
server if outside temp, and removed after the run — nothing is written into the
repo or a real project.

## States captured

| # | Screenshot | What it verifies |
|---|---|---|
| 01 | `01-dark-default.png` | Dark theme, default zoom (100%) — baseline |
| 02 | `02-contrast-default.png` | High Contrast theme at default zoom |
| 03 | `03-contrast-max-zoom.png` | High Contrast at **maximum zoom (180%)** — the low-vision target: pure black, bright saturated tokens, whole chrome scaled |
| 04 | `04-zoom-min.png` | **Minimum zoom (70%)** — compact code + chrome |
| 05 | `05-zoom-mid.png` | Mid-range zoom |
| 06 | `06-chrome-and-panels-scaled.png` | Toolbar, status bar, Outline + Diagnostics panels all scaled together |
| 07 | `07-modal-enlarged.png` | The Go-to-line modal scaled at enlarged zoom |
| 08 | `08-persist-set.png` | Sets zoom (150%), persisted to `localStorage` |
| 09 | `09-persist-after-reload.png` | **No zoom directive** — after a full editor-page reload the persisted 150% is reapplied on init, proving zoom persistence across a renderer reload |

## Confirmed

- **No survivors** — leak check reported `alive:false`; `survivors: 0`.
- **No launch loop** — exactly **1** Electron launch for all 9 captures.
- **No fixture mutation** — inputs are scratch temp files; committed fixtures untouched.
- **No scratch left in the repo** — temp dir removed after the run.
- One coherent zoom level scales **both** the CodeMirror code area (font
  compartment) and the app chrome (`--wrl-ui-scale` rem layer); the X_ITE canvas
  is never CSS-transformed (no preview on this page yet).
- The UI copy is release-quality: `−  150%  +  Reset`, `Theme: High Contrast` —
  no preview/beta/phase/version jargon on the working surface.
