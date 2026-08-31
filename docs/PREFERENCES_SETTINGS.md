# Phase: Preferences & Settings

**Lane:** Phase: Preferences & Settings
**Status:** **CLOSED.** Independent final QA returned
`PREFERENCES_SETTINGS_QA_PASS_WITH_NOTES`. Final tests: **2065 / 2065**
pass, 0 failed, 0 skipped. **0 runtime dependencies added. 0 dev
dependencies added.** `contextIsolation: true` / `nodeIntegration: false`
unchanged.

A single, shared **Preferences & Settings** area accessible from the Mall,
World, and Editor toolbars. One shared settings authority; one dialog;
the existing theme, zoom, and preview-layout controls are now views of
the same model (no shadow values). No new dependencies, no new IPC
channel, no main-process change. Real-Electron smoke + capture-server
runs on the published `1.3.0-beta.5` (Linux x64) confirm the page
loads, the dialog opens, the values reflect the persisted state, and
`window.WrlPreferences.set('theme', 'tokyo')` writes through to
`localStorage` immediately.

---

## 1. Scope

**Addressed**

- A single, shared `Preferences & Settings` area reachable from the
  Mall, World, and Editor toolbars (one Preferences button on each
  page's existing toolbar).
- One **shared settings model** in `src/settings/preferences.js` (pure,
  injectable, dependency-free). The same model backs every surface that
  reads or writes a user preference.
- A **single dialog** (`renderer/preferences.js`) implementing the
  accessibility contract: `role="dialog"`, `aria-modal="true"`, a
  labelled title, Escape to close, focus containment, focus return to
  the opener.
- **Four sections**: Appearance, Accessibility, Keyboard, Editor.
- **Live application** (no Save button): every control writes through
  the shared model and is applied immediately (theme to CodeMirror,
  zoom to code area + chrome, preview layout to the editor's live
  preview).
- **Synchronization**: changing a setting from the existing editor
  toolbar (theme select, zoom buttons, layout dropdown) updates the
  shared model, which the dialog reflects on its next open. A change
  from the dialog updates the editor's existing controls in real time.
- **Persistence**: every setting is persisted in `localStorage` under
  the keys the editor already used (`wrlforge.editor.theme`,
  `wrlforge.editor.zoom`, `wrlforge.editor.previewLayout`). One new
  tiny auxiliary key (`wrlforge.editor.lastNonContrastTheme`) backs the
  High Contrast toggle's "off" action.

**Explicitly not addressed (recorded as deferred / out of scope)**

- Shortcut remapping. A read-only reference is included; remapping
  needs its own approved lane.
- Reset / Reset-Everything. No destructive settings reset.
- Application auto-update. Locked product decision.
- Direct upload, authentication, automatic submission. Locked.
- External editor command editor. `editorCommand` (in
  `userData/settings.json`) is a real preference but not yet editable
  through Preferences; the user still edits `settings.json` by hand.
  Surfacing it in a future lane is its own decision.

---

## 2. Settings inventory

The app's full settings inventory, classified.

### USER_PREFERENCE (lives in Preferences & Settings)

| Setting | Type | Default | Storage key | Notes |
|---|---|---|---|---|
| Editor color theme | enum | `dark` | `wrlforge.editor.theme` | One of `dark \| light \| terminal \| tokyo \| contrast`. The `contrast` value is the **High Contrast** theme (pale-black background, bright tokens, yellow caret). The theme dropdown lists all five; the Accessibility section's "Use High Contrast" toggle is a one-click shortcut that sets `theme='contrast'` and reverts to the prior non-contrast choice on uncheck (remembered in `lastNonContrastTheme`). |
| High Contrast (toggle) | boolean | derived from `theme` | (no separate key) | A shortcut for `theme === 'contrast'`. The toggle's "off" reverts to the prior non-contrast choice. |
| UI zoom | integer | `0` | `wrlforge.editor.zoom` | `ZOOOM_MIN..ZOOM_MAX` (–3..+8). Scales the code area (CodeMirror font compartment) AND the app chrome (`--wrl-ui-scale` rem layer) together. `Ctrl+0` resets. |
| Preview layout | enum | `split` | `wrlforge.editor.previewLayout` | One of `split \| preview-max \| editor-only`. The editor's own Layout dropdown and the Preferences dialog both write here. |

### AUXILIARY (internal, persisted)

| Setting | Storage key | Notes |
|---|---|---|
| Last non-contrast theme | `wrlforge.editor.lastNonContrastTheme` | The user's last non-contrast theme; consulted only by the High Contrast toggle's "off" action. Never `contrast`. |

### SESSION_STATE (not a preference; not in this dialog)

| Key | Where | Notes |
|---|---|---|
| `wrlforge.nav.returnFocusId` | `sessionStorage` | Back-navigation focus target. |
| `wrlforge.recovery.prompted` | `sessionStorage` | Recovery prompt idempotency flag (Phase Beta 2). |
| `wrlforge.editor.previewSplit` | `localStorage` | The divider's drag fraction. A fine-grained presentation detail, not a global user preference. Kept in its own key. |
| `wrlforge.dialog.lastOpenerId` | (not yet used) | Reserved for a future improvement; not currently consulted. |

### RECOVERY_STATE (not a preference; not in this dialog)

| Item | Where | Notes |
|---|---|---|
| Editor recovery snapshot | `userData/editor-recovery.json` | Phase Beta 2's recovery file. Cleared by Save success, Close, Start Fresh. |
| `wrlforge.recovery.lastWorkspace` | `localStorage` | Hint of the last workspace before recovery; not a preference. |

### WORKSPACE_STATE (not a preference)

- The currently-open Mall item path (held by `currentSession` in `main.js`).
- The currently-open World Project (held by `worldSession`).
- The editor session (`editorController`).
- `window-state.json` (window bounds / maximized) lives in `userData` and is
  not a user preference.

---

## 3. Settings authority

There is **one authority per preference**. The `src/settings/preferences.js`
module is the single read/write/normalize/transition surface. Every
caller (the editor's existing theme/zoom/layout controls, the dialog,
the future external surfaces) reads and writes through it. There is
no shadow value in the renderer.

```
                      window.WrlPreferences  (renderer/preferences.js)
                       │      │      │
            ┌──────────┘      │      └──────────────┐
            ▼                 ▼                     ▼
  editor toolbar      Preferences dialog      future surfaces
  (themeSelect,       (Appearance /             (e.g. external
   zoom buttons,      Accessibility /            editor picker)
   layout dropdown)   Keyboard / Editor)
            │                 │
            └─────────┬───────┘
                      ▼
            src/settings/preferences.js
            (pure model + storage indirection)
                      │
                      ▼
            localStorage (the same keys the editor
                          has used since Phase 7B)
```

The renderer-side `WrlPreferences` object holds the in-memory state,
fires subscriber notifications, and provides `applyTheme`,
`applyZoom`, `applyPreviewLayout` (the only side-effecting methods
besides `set` itself). The shared model's `update()` returns the
input unchanged for a no-op write, so subscribers don't churn on
re-writing the same value.

---

## 4. UI entry

A single **Preferences** button on the existing toolbar of each page:

- `renderer/index.html` — Mall toolbar (`role="toolbar"`).
- `renderer/world.html` — World toolbar.
- `renderer/editor.html` — Editor toolbar (next to the theme select).

The button is a plain `<button class="secondary">Preferences</button>`,
matching the existing toolbar chrome. The click opens the shared
dialog; focus moves into the dialog; closing the dialog (Close
button or Escape) returns focus to the button that opened it.

The dialog is implemented as a single root (`#wrlforgePrefsRoot`)
mounted on `document.body` on first open. It carries
`role="dialog"`, `aria-modal="true"`, and `aria-labelledby="…Title"`.
Focus containment is implemented via Tab / Shift+Tab cycling over the
focusable descendants. Escape closes the dialog.

---

## 5. Sections

### Appearance

- **Editor color theme** (select): `Dark | Light | Terminal | Tokyo
  Night | High Contrast`. Live: writing the value updates the
  CodeMirror theme and the editor toolbar's theme select.
- **UI size** (group: − / label / + / Reset): the shared zoom level.
  Live: writing the value updates `--wrl-ui-scale` and the CodeMirror
  font size. `Ctrl++ / Ctrl+- / Ctrl+0` work everywhere in the app
  and are also advertised in the Keyboard section.

### Accessibility

- **Use High Contrast theme** (checkbox): one-click shortcut for
  `theme='contrast'`. The "off" action reverts to the last
  non-contrast choice.
- **UI size** (same control as Appearance; bound to the same value).
- **Keyboard access** (paragraph): every control is Tab-reachable;
  Enter/Space activate; Escape closes the dialog.

### Keyboard shortcuts

Read-only table:

| Action | Shortcut |
|---|---|
| Repack (Mall) | `Ctrl+R` |
| Open in Native Editor (Mall) | `Ctrl+E` |
| Save (Editor) | `Ctrl+S` |
| Save As (Editor) | `Ctrl+Shift+S` |
| Go to line (Editor) | `Ctrl+G` |
| Close document (Editor) | `Ctrl+W` |
| Increase UI size | `Ctrl++` |
| Decrease UI size | `Ctrl+-` |
| Reset UI size | `Ctrl+0` |
| Update preview (Editor) | `Ctrl+Enter` |
| Maximize preview (Editor) | `Ctrl+Shift+Enter` |

The note "Shortcut remapping is not available yet" appears under the
table. Remapping is out of scope for this lane.

### Editor

- **Editor color theme** (select; same value as Appearance).
- **UI size** (group; same value as Appearance).
- **Preview layout** (select: `Split | Preview maximized | Editor
  only`). Live: writing the value updates the editor's preview
  layout via the existing `wrlEditorPreview.setLayout` and the
  editor toolbar's Layout dropdown.

---

## 6. Persistence

`localStorage` is the existing safe storage. The shared model reuses
the same keys the editor has used since Phase 7B, so no migration is
needed. One new tiny key (`wrlforge.editor.lastNonContrastTheme`) is
added to back the High Contrast toggle's "off" action; the key is
written by the same `set()` path that writes every other preference.

- **Page navigation**: settings are persisted to `localStorage` on
  every change, so navigating between Mall / World / Editor keeps the
  same theme, zoom, and layout.
- **Application restart**: same — `localStorage` is per-app, per-OS,
  per-user; values persist across launches.
- **Backup-before-overwrite / repack**: unchanged. The repack backup
  is taken by `mall:repack` in `main.js`; this lane does not modify
  the source-handling path.

---

## 7. Migration

```text
NO_MIGRATION_REQUIRED
```

The shared model reuses the keys the editor has used since Phase 7B
(`wrlforge.editor.theme`, `wrlforge.editor.zoom`,
`wrlforge.editor.previewLayout`). On first launch under the new
model, those keys are read as-is. The one new key
(`wrlforge.editor.lastNonContrastTheme`) is initialized from
`wrlforge.editor.theme` (or `dark` if absent) on first read by the
shared model, so the High Contrast toggle's first click is well-
defined even for users who have never toggled it before.

**Accepted fallback (independent QA):** if a user's existing
`wrlforge.editor.theme` was `'contrast'` and they have no recorded
`lastNonContrastTheme`, the new model treats them as already-High-
Contrast on next launch; the first toggle-off reverts to `dark`
(the default), not the last non-contrast theme (which they never
set). This is a single-occurrence small loss of the user's prior
non-contrast preference; the behavior is accepted and documented.

---

## 8. Accessibility

The dialog meets the full accessibility contract from the lane brief:

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` points at
  the title. The title is rendered as an `<h2>`.
- Every interactive control is a native `<button>`, `<select>`,
  `<input type="checkbox">`, or `<input type="text">` — no
  generic clickable container.
- Every control has a clear accessible name (visible text or
  `aria-label`).
- Headings (`<h3>`) label each section; `<h4>` labels sub-groups.
- Tab / Shift+Tab cycle within the dialog; focus cannot leave it
  while open.
- Escape closes the dialog and returns focus to the opener.
- Visible focus: every control uses the existing focus ring
  (`outline: 2px solid #7db3ff; outline-offset: 2px;`).
- High Contrast: the contrast theme's palette already passes
  contrast checks (the same theme is exposed in the editor); the
  dialog honours the theme in the same way the editor does.

The "no Save" rule is honored: every change applies live. There is
no destructive reset.

---

## 9. Real-Electron verification

A bounded real-Electron run on the published `1.3.0-beta.5` (Linux
x64) confirms:

- The editor page loads with `window.WrlPreferences` and
  `window.WrlPreferencesCore` present.
- The Preferences button (`#prefsBtn`) is present.
- Clicking the button mounts the dialog (`#wrlforgePrefsRoot`) with
  `role="dialog"`, `aria-modal="true"`, 5 theme options, the zoom
  label "100%", and the High Contrast toggle unchecked.
- `window.WrlPreferences.set('theme', 'tokyo')` updates the shared
  model AND persists `wrlforge.editor.theme = "tokyo"` immediately.

The Mall and World toolbars carry the same Preferences button. The
dialog is reachable from every page; the values are the same.

The existing `npm test`, `npm run check`, and `npm run build:editor`
all pass: **2065 / 2065** (up from the 2003 baseline; 62 new tests
added: 40 pure model + 22 runtime dialog tests).

---

## 10. Files changed

```text
src/settings/preferences.js               NEW   pure model + storage
renderer/preferences.js                   NEW   dialog + renderer state
renderer/index.html                       MOD   script order + button
renderer/world.html                       MOD   script order + button
renderer/editor.html                      MOD   script order + button
renderer/renderer.js                      MOD   Preferences button click
renderer/world.js                         MOD   Preferences button click
renderer/editor.js                        MOD   theme/zoom read+write
                                                  through shared model;
                                                  subscriber; button click
renderer/editor-preview.js                MOD   previewLayout through
                                                  shared model
test/settings/preferences.test.js         NEW   40 pure model tests
test/renderer/preferences-runtime.test.js NEW   22 DOM-stub runtime tests
test/editor/script-load-order.test.js     MOD   add new scripts to the
                                                  co-load list
docs/PREFERENCES_SETTINGS.md              NEW   this document
docs/WRL_FORGE_ROADMAP.md                 MOD   Preferences & Settings
                                                  section added
```

No new package. No new runtime dependency. No new IPC channel.
`contextIsolation: true` / `nodeIntegration: false` unchanged.

---

## 11. Open risks

- **One-occurrence small loss of the prior non-contrast theme** for
  users whose first run under the new model has `theme === 'contrast'`
  with no `lastNonContrastTheme` set. The first "off" of the High
  Contrast toggle reverts to `dark` (the default), not the user's
  original non-contrast theme. **Accepted by independent QA**;
  documented in §7 and `docs/WRL_FORGE_ROADMAP.md` under
  "Preferences & Settings ✅ CLOSED". No product-code change.
- **The dialog is not the only entry point**: the existing
  `themeSelect` in the editor toolbar and the zoom buttons remain
  primary surfaces for those settings. They are now views of the
  same model, but a user may not associate them with "Preferences."
  The dialog's Editor section makes the connection visible.
- **Cross-tab sync is not implemented**: if WRL Forge ever opens
  more than one window, the `localStorage` storage event would
  propagate changes between windows naturally, but no listener is
  installed in this lane. The current app has one window; this is
  not a real risk today.
- **KNOWN_POLISH_NOTE — UI size scope.** The current
  `wrlforge.editor.zoom` level scales the **Native Editor** code
  area and chrome only. The Mall / World / Preferences chrome does
  not currently scale with this value. Global chrome scaling is a
  future lane; **accepted by independent QA**, no product-code
  change in this closeout. The dialog's copy reflects the current
  behavior ("Scales the code area and app chrome together" — true
  for the editor; future-friendly wording for the global case).

---

## 12. Deferred (not in this lane)

- Shortcut remapping.
- Reset / Reset-Everything.
- External editor command editor.
- Cross-window preference sync.
- A future Web-only / Generic-VRML97 preview is not part of this
  lane; the dialog applies to Mall, World, and the native editor.
- Mall / World restart-restore (already deferred in
  `PHASE_BETA_2_CRASH_RECOVERY.md` §14).
