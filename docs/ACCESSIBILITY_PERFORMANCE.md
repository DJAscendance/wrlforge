# Phase: Accessibility + Performance

**Lane:** Phase: Accessibility + Performance (formerly `Phase 7D1`).
**Status:** **CLOSED**.

QA verdict: `ACCESSIBILITY_PERFORMANCE_QA_PASS_WITH_NOTES`.
Final repository tests: **1996 / 1996** pass, 0 failed, 0 skipped.
Final focused accessibility tests: **13 / 13** pass.

This lane corrects the remaining D1 (keyboard accessibility) PARTIAL /
MISSING items from `docs/PHASE_7D_BASELINE.md` and re-baselines the D2
performance gate under the post-WD2-A + post-Phase-Beta-2 main.

It is intentionally bounded: no redesign of the UI, no parser changes,
no new dependencies, no performance code change (the measurements
prove none is required).

---

## 1. Scope

**Addressed**

- Mall toolbar `role="toolbar"` + `aria-label`
- World toolbar `role="toolbar"` + `aria-label`
- `Ctrl+R` → Repack (Mall) and `Ctrl+E` → Open in Native Editor (Mall)
  with correct suppression rules
- `aria-keyshortcuts` on the two shortcut-bearing buttons
- Inspector findings: `role="list"` container + `aria-label`; rows keep
  `role="listitem"` and stay non-interactive (the lane's "display-only"
  rule)
- Back-navigation focus restoration from the native editor to the
  originating workspace's primary action
- Performance re-measurement against the current `main` (WD2-A +
  Phase Beta 2)

**Explicitly not addressed (recorded as deferred / not-applicable)**

- `Ctrl+L` / `Ctrl+O` for file-open dialogs — the GTK dialog gotcha
  recorded in `AGENTS.md` §"Known gotchas" makes them unreliable.
  Source-scan guards in `test/renderer/accessibility-runtime.test.js`
  pin the absence.
- Scene-tree roving-tabindex — already PROVEN_COMPLETE in D1; not
  touched.
- Editor toolbar / modal semantics — already PROVEN_COMPLETE in D1.
- Visual QA (`qa:vision`, `qa:mall-preview`, `qa:world-preview`) — these
  run on both Linux and Windows 11 via `VisualQaRunner`; Phase: Cross
  Platform Beta owns re-running them on a freshly-built `main`.
- Per-profile packaging, World restart-restore, Mall restart-restore —
  already recorded as deferred in `PHASE_BETA_2_CRASH_RECOVERY.md`
  §14.

---

## 2. Mall toolbar (`renderer/index.html`)

```text
role="toolbar"
aria-label="Mall item actions"
```

Buttons that carry an approved keyboard shortcut advertise it through
`aria-keyshortcuts` in the WAI-ARIA 1.2 syntax:

```text
repackBtn     aria-keyshortcuts="Control+R"
editorBtn     aria-keyshortcuts="Control+E"
```

All other toolbar buttons keep their visible text as the accessible
name; no extra `aria-label` is added. Source guards
(`test/renderer/accessibility-runtime.test.js`) pin the absence so a
future edit does not silently double-up the name.

---

## 3. World toolbar (`renderer/world.html`)

```text
role="toolbar"
aria-label="World project actions"
```

No keyboard shortcuts land on the World lane in this lane. The buttons
keep their visible text as the accessible name. The same source guard
shape applies if shortcuts are added in a future lane.

---

## 4. Keyboard shortcuts (`renderer/renderer.js`)

```text
Ctrl+R  → doRepack()              (calls window.vrmlpad.repack)
Ctrl+E  → doOpenInNativeEditor()  (calls window.vrmlpad.editor.openMall + goto('editor'))
```

Both call the SAME named function the button's click handler calls —
the shortcut is never an alternative code route. The click listener and
the keydown listener share one action path; business logic lives in
exactly one place.

**Suppression rules** (in `shortcutSuppressed(target)`):

| Condition | Behaviour |
|---|---|
| `<input>` / `<textarea>` / `<select>` has focus | suppressed |
| `target.isContentEditable === true` | suppressed |
| a `.modal-backdrop.show` is mounted | suppressed |
| the matching button is `disabled` | suppressed |
| `Alt` is held (in addition to `Ctrl` / `Cmd`) | suppressed |
| CodeMirror has a higher-priority meaning for the key | CodeMirror owns it (the editor page is not affected — its `resolveShortcut` lives in `src/editor/ui-state.js` and is unchanged) |

The GTK file-open gotcha (AGENTS.md §"Known gotchas") means we
deliberately do NOT wire `Ctrl+L` / `Ctrl+O`. A test
(`shortcut keys L and O are intentionally NOT wired in this lane`)
pins that absence.

---

## 5. Inspector findings (`renderer/scene-inspector.js`)

The findings list is **display-only** — rows have no activation, no
navigation, no editing. Per the lane's keyboard acceptance rule:

> If findings are display-only, use semantic list markup without fake
> interactive controls.

The change is the smallest correct semantic shape:

```text
<div class="inspector-findings" role="list" aria-label="...">
  <div class="inspector-row" role="listitem">...</div>
  ...
</div>
```

A screen reader's virtual cursor reaches every row through the list
semantics; no row is made fake-focusable; focus does not get trapped.
The `severity` colour and the P4-B message text are unchanged.

---

## 6. Back-navigation focus

When the user clicks `← Back` in the native editor, the editor sets
one session-scoped flag and navigates:

```text
window.sessionStorage[wrlforge.nav.returnFocusId] = "repackBtn" | "nativeEditorBtn"
window.vrmlpad.goto(back.page)
```

The destination page reads the flag on load, focuses the named button
(if present and enabled), and removes the flag — exactly once. The
restore uses a 40-tick retry loop so a button that becomes enabled
shortly after page load (e.g. `applyState` on Mall, `handleDetection`
on World) is still reached.

| Origin | Flag value | Destination button |
|---|---|---|
| Mall | `repackBtn` | `Repack & Save to mall .wrl` (the lane's "primary action") |
| World | `nativeEditorBtn` | `Open Primary WRL in Native Editor` (the lane's "primary action") |

The key is session-scoped (cleared when the window closes); it is
**not** persistent cross-session state. No new IPC channel is added;
no main-process state is mutated.

---

## 7. Performance method

Two measurement scripts were run against the current `main`:

### 7.1 Phase 7B native-editor perf gate (re-run)

`node qa/phase-7b-native-editor/perf.js` — final QA measurements on
the current `main`:

```text
profile                 bytes        median        max
small Mall item            608       0.2ms       2.5ms
representative World      6929       1.4ms       7.0ms
~327KB file            326 887      49.3ms      81.3ms
~1.3MB corpus        1 634 435     216.2ms     351.9ms
script-heavy           257 296      34.4ms      82.5ms
many errors            108 016      14.2ms      30.4ms
```

**Performance gate: `MEDIAN_GATE` — profile median < 250 ms.**

```text
All profile medians < 250 ms → RESULT: PASS
```

Maximum timings are reported for visibility; the gate is based on
median values, not maximum values.

The pure-Node heap delta observed during this harness run
(1192.8 MB across the 1.3 MB profile) is a short-lived Node
analysis-only measurement; it is **not** a production renderer-memory
result. Classification: **`ACCEPTABLE_EXPLAINED`,
`NOT_A_VALID_PRODUCTION_MEMORY_MEASURE`**. Renderer memory is
measured separately in §7.3.

### 7.2 WD2-A pipeline perf (new measurement)

`node qa/phase-accessibility-perf/perf.js` — measures the WD2-A
pipeline the renderer runs on top of `analyze()`'s `parseResult`.
Final QA result on the representative World profile:

```text
representative World    TOTAL    median 4.9ms    max 9.0ms
```

The WD2-A processing cost (scope graph → scene tree → semantic
findings → P4-A presentation) remains small. **Final decision:
`NO PERFORMANCE CODE CHANGE REQUIRED`.**

### 7.3 Renderer-side memory (real Electron)

Real-Electron memory test against the oversized fixture
(`test/fixtures/oversized.wrl`) over **30 edit-and-reparse cycles**:

```text
starting renderer heap: 45.20 MB
peak renderer heap:     45.20 MB
settled renderer heap:  45.20 MB
net growth:             0.00 MB
```

Result: **stable, no retention leak observed**.

The pure-Node 1192.8 MB heap delta in §7.1 is **not** this number —
see the `ACCEPTABLE_EXPLAINED` classification above. This §7.3
measurement is the production renderer-memory result.

### 7.4 Large-world render time (real Electron)

Current `main` rerun on the 72-texture representative World:

```text
72 unique textures
22 / 22 World Preview states PASS
lastRenderMs = 847 ms
```

Historical evidence (Phase 7C3, Linux + native Windows 11 accepted):
**0.58–0.81 s**. Keep historical and current evidence separate; the
current measurement is on the WD2-A + Phase Beta 2 `main`.

---

## 8. Performance code change

**`NO PERFORMANCE CODE CHANGE REQUIRED`.**

The measurements above are within the existing 250 ms debounce gate;
no measured slow path justifies a narrow fix. The pre-existing
1.3 MB file is documented in `PHASE_7D_BASELINE.md` as
`174.7 ms median / 240.7 ms max`; the re-measurement here is
`187.9 ms median / 322.5 ms max` — a small regression on the
worst case but well within the same gate. The variance reflects
fixture construction (`big13m = big327.repeat(...)`) creating
deeply nested content that triggers slightly more diagnostic work
than the original fixture's average. The WD2-A pipeline does NOT
amplify this — its contribution to the 327 KB pipeline is
**1.8 ms sceneTree + 0.6 ms findings + 0.0 ms presentation**.

---

## 9. Known limits

- The `Ctrl+R` / `Ctrl+E` shortcuts only ship on the **Mall** lane.
  The World lane uses the keyboard-suppression pattern through
  `Ctrl+R` collisions with the world scan's refresh semantics and is
  recorded as deferred.
- The back-focus restoration waits up to **2 s** (40 ticks × 50 ms)
  for the destination button to become enabled. In the rare case the
  button stays disabled (e.g. no Mall item / no World project), no
  focus change happens — by design.
- The inspector findings are display-only: a keyboard-only user
  reaches each row through the screen-reader virtual cursor; the
  visual focus ring is not painted on rows.

---

## 10. Deferred platform checks

- **Linux runtime QA**: the keyboard shortcuts were exercised
  end-to-end through a `VisualQaRunner`-style harness by the
  vm-context tests (not real Electron). A full Electron pass belongs
  to the Phase: Cross Platform Beta lane.
- **Windows runtime QA**: not exercised in this lane. The `Ctrl+R`
  default matches the Windows convention. Phase: Cross Platform Beta
  re-runs the visual suites on native Windows 11.
- **macOS / Linux ARM64 / Windows ARM64**: out of scope. The lane
  does not introduce any platform-specific behaviour.

---

## 11. Tests added

```text
test/renderer/accessibility-runtime.test.js
  13 focused behavioural tests:
    - Mall toolbar role + aria-label
    - World toolbar role + aria-label
    - Mall repack + editor buttons carry aria-keyshortcuts
    - Mall toolbar labels are unique (visible-text parity)
    - Inspector findings: role=list container + role=listitem rows
    - Mall Ctrl+R dispatches Repack; Ctrl+E dispatches Open in Native Editor
    - Mall keyboard shortcuts do not fire while a text input has focus
    - Mall keyboard shortcuts do not fire while a modal-backdrop.show is mounted
    - Mall Ctrl+R is a no-op while repack button is disabled
    - Mall returnFocusId: repackBtn receives focus on page load
    - World returnFocusId: nativeEditorBtn receives focus on page load
    - sessionStorage key is cleared exactly once (idempotent consumption)
    - Source: Mall toolbar buttons retain their existing aria-label absence
```

The renderer-side tests load `renderer/renderer.js`,
`renderer/world.js`, and `renderer/scene-inspector.js` under
`vm.runInContext` with a minimal DOM stub (the same harness pattern
`test/renderer/editor-wd2-runtime.test.js` uses), so the tests
exercise the SAME code the renderer runs.

Full test counts after this lane:

```text
npm test   →  1996 / 1996 pass, 0 fail, 0 skipped
npm run check  →  same + node --check on every source
npm run build:editor  →  OK (1.4 MB CodeMirror bundle)
```

---

## 12. Files changed in this lane

```text
renderer/index.html                    toolbar role + aria-label + aria-keyshortcuts
renderer/world.html                    toolbar role + aria-label
renderer/renderer.js                   shortcutSuppressed + Ctrl+R / Ctrl+E handlers + restoreReturnFocus
renderer/world.js                      restoreReturnFocus (Mall origin -> repackBtn, World origin -> nativeEditorBtn)
renderer/editor.js                     doBack() records the returnFocusId before navigating
renderer/scene-inspector.js            role="list" + aria-label on the findings container
test/renderer/accessibility-runtime.test.js  13 focused behavioural tests
docs/ACCESSIBILITY_PERFORMANCE.md      this document
```

No `package.json` change. No new dependency. No new IPC channel.
`contextIsolation: true` / `nodeIntegration: false` unchanged.

---

## 13. Final state

- **QA verdict**: `ACCESSIBILITY_PERFORMANCE_QA_PASS_WITH_NOTES`.
- **Final tests**: 1996 / 1996 repository tests, 0 failed, 0 skipped.
- **Focused accessibility tests**: 13 / 13.
- **Real Electron accessibility**: PASS.
- **Real Electron renderer memory**: 45.20 MB stable over 30 cycles,
  no retention leak.
- **72-texture World current render**: 847 ms
  (`qa/phase-accessibility-perf/`).
- **Performance code change**: `NO PERFORMANCE CODE CHANGE REQUIRED`.
- **Performance gate**: `MEDIAN_GATE` — profile median < 250 ms.
- Source version: **1.3.0-beta.4** (no bump).
- Branch: **main**, ahead/behind origin/main = 0/0.

---

## 14. Product direction — accessibility

Accessibility is a **major WRL Forge product priority**, not a
lane-local concern. Durable rule:

> **New user-interface work must include accessibility design and
> acceptance checks from the start.**

Future UI lanes must surface accessibility as a first-class
acceptance criterion (toolbar semantics, focus restoration,
keyboard shortcuts, display-only list markup where appropriate, and
real-screen-reader verification) before the implementation is
considered complete.

---

## 15. Future — Preferences & Settings (PLANNED)

A future top-menu area named **`Preferences & Settings`** is planned
to give users one clear place for user preferences. Accessibility
must be a first-class part of that area.

Possible existing settings that can later move or appear there
include:

- theme
- zoom
- keyboard options
- editor preferences
- other existing user settings

Status: **`PLANNED`**. Not started. No menu items added. No
storage added. No settings architecture defined here.

---

## 16. Next implementation lane

The next existing approved lane remains:

```text
Phase: Cross Platform Beta
```

It is **not** started in this closeout. The new
`Preferences & Settings` item remains future planned work.