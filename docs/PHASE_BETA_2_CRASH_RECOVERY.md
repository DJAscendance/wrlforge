# Phase Beta 2 — Crash Recovery

**Lane:** Phase Beta 2 (previously labelled Phase 7D2 in the 7D0 baseline).
**Goal:** preserve unsaved native-editor work across abnormal exits and offer
the user a clear Restore-or-Start-Fresh decision on the next launch. The
source file on disk is **never** mutated by recovery; the recovered buffer
opens as unsaved work, and the user decides whether to keep it.

**Status: Phase Beta 2 CLOSED.** Independent final re-QA returned
**PHASE_BETA_2_FINAL_REQA_PASS**. All nine verification items passed
(B1 source identity and external-change protection; B2 missing-source
recovery viewer; B3 second crash after Restore; B4 Editor recovery
prompt; M1 World recovery prompt; recovery lifecycle; graceful close;
session precedence; security boundary).

Final runtime: **58 / 58 Electron runtime assertions, 0 console errors,
0 console warnings.** Final repo tests: **1983 / 1983, 0 failed, 0
skipped.**

---

## Core safety rule

> **A recovery snapshot for dirty work remains recoverable until the user
> safely saves it or explicitly rejects it.**

The recovery file is cleared by THREE events only:

```text
1. successful explicit Save      -- EditorController.save with ok:true via main IPC
2. explicit Discard               -- the existing renderer Close / "Close anyway"
3. explicit Start Fresh            -- renderer choice from the prompt
```

The recovery file is NEVER cleared by any of these:

```text
- Restore adoption (B3 fix)
- a missing source on Restore    (B2 fix)
- a Save failure (EEXTERNAL/EVERIFY) -- the buffer is still dirty
- a renderer reload or app restart -- the snapshot must survive
- workspace / page navigation
- a failed prompt / failed adopt  -- the recovery stays so the user can re-decide
```

This rule is enforced in code (`recoveryController.recordClear()` is only
called from Save success, Close, and Start Fresh) and pinned by tests in
`test/editor/phase-beta-2-corrections.test.js`.

---

## Lifecycle — corrected

The QA pass discovered that the original implementation cleared the recovery
snapshot at Restore time. The corrected lifecycle:

| Event | Snapshot |
|---|---|
| clean editor | (not written) |
| dirty editor, debounce expires | written (snapshot) |
| Restore (Restore) | **KEPT** — restored buffer is still dirty; future snapshots overwrite |
| normal Save success | REMOVED (`recoveryController.recordClear()` via EditorController.save) |
| normal Save failure | **KEPT** (EEXTERNAL, EVERIFY) — the buffer is still dirty |
| Restore + missing source | **KEPT** — the buffer remains accessible on next launch |
| Restore + external source change | **KEPT**, with synthesized stat — Save detects EEXTERNAL |
| explicit Discard | REMOVED (Close path → Close → `recordClear`) |
| normal explicit Close | REMOVED |
| Back / navigate away | kept; force-flushed first |
| abnormal renderer-process crash | kept; force-flushed before reload |
| app restart | read at startup; prompt shown if valid |
| Restore adopted + NEW dirty edits | new snapshot written (overwrites older) |
| Restore adopted + NO new edits + second crash | **prompt fires again with the same text** |
| prompt close / Escape | KEPT (user must explicitly Start Fresh to destroy) |
| corrupt JSON at startup | reported as `bad-json`, treated as no recovery |
| Renderer process reload via `render-process-gone` | reload re-runs `maybePrompt`; prompt is idempotent in the same session (sessionStorage flag) |

---

## B1 — real source stat from snapshot

QA pass 1's helper (`statFileFromBuffer`) was unsafe: it hashed the
*decompressed* recovery text, which never matches a gzip source file's
bytes on disk. A gzip source round-trips through the conflict path with
a guaranteed mismatch and Save spuriously raised `EEXTERNAL` even when
nothing had changed.

QA pass 2 fix:

1. The recovery record carries a **real** `sourceStat` `{ mtimeMs, size,
   sha1 }` captured at snapshot time over the actual on-disk bytes (gzip
   or plain). Main owns this; the renderer does NOT set it.
2. `RecoveryController.recordDirtyState` calls an injected `getSourceStat`
   to fetch the live session stat at the moment the renderer pings.
3. `EditorController.openFromRecovery` accepts `sourceStat` and uses it as
   the session's authoritative on-disk stat. The next Save compares it
   against the current disk via the existing `detectExternalChange` path:
   - Plain source, disk unchanged → no mismatch → Save succeeds.
   - Plain source, external change → `EEXTERNAL` → renderer Reload / Save
     As / Cancel dialog (existing path).
   - Gzip source, disk unchanged (gzip bytes) → no mismatch → Save
     succeeds (regression test: `B1 correction (gzip, unchanged)`).
   - Gzip source, external change → `EEXTERNAL` (regression test: `B1
     correction (gzip, EXTERNAL change)`).
4. The `baselineOverride` alias is gone; the contract is one property
   name: `baseline`. The adopter's `openSession(...)` call passes
   `{ buffer, baseline, sourceStat }` exactly.
5. The unsafe `statFileFromBuffer` helper was REMOVED from
   `src/editor/file-io.js`. Its only caller (the previous broken
   openFromRecovery) is gone; a regression test
   (`statFileFromBuffer is not exported`) pins the removal.

Schema bumped to `schemaVersion: 2`. v1 records are STILL accepted so
older recovery files don't break; an empty `sourceStat` on a v2 record is
also accepted, but the renderer falls back to a viewer because there is
no safeSave conflict anchor.

## B2 — missing source on Restore — with a usable UI

QA pass 2 fix: a deleted/renamed source no longer destroys recovery. The
renderer surfaces a **recovery viewer** modal so the user can VIEW,
SELECT, and COPY the recovered text. The file stays on disk until the
user performs a real Save / Discard / Start Fresh.

The viewer shows:

- The full recovered buffer in a scrollable, selectable text area
  (`<pre class="buffer-area">`, `user-select: text`, `pre-wrap`).
- A **Copy to clipboard** button (uses `navigator.clipboard.writeText`
  with a fallback to a temporary textarea + `document.execCommand`).
- A **Close (recovery stays)** button that dismisses the modal
  *without* deleting the recovery record.
- A live `aria-live` "Copied." status indicator next to the buttons.

Code path:

```
openFromRecovery(source missing)
  -> adoptRecovery surfaces { sourceMissingRecovered: true, ... }
     -> renderer/recovery-prompt.js shows the viewer modal
        (NOT Start Fresh)
        (NOT route to editor -- the editor cannot safely mount)
        (NOT delete the recovery record)
```

The user reads/copies the text and either closes the viewer or
takes a real action (Save As, Discard, Start Fresh) on next launch.

## B3 — Restore no longer clears recovery

`adoptRecovery` and `openFromRecovery` no longer call `recordClear`. The
recovery file stays active until a Save / Discard / Start Fresh clears it.
Two new tests pin this:

- B3 (d): Restore + immediate second crash (no new edits) — the next launch
  finds the same text. A new controller reading the file still has `found:true`.
- B3 (c): Restore + new edits + second crash — the newest snapshot wins.

Future dirty edits UPDATE the snapshot through the existing
`recordDirtyState` debounce. The newest-snapshot-writes rule is unchanged.

## B4 / M1 — recovery prompt on editor.html and world.html

QA pass 2 fix: the prompt script tag was moved BEFORE the page's main JS
so `window.WRLForgeRecoveryPrompt` exists by the time the page's
`init()` runs.

```text
renderer/index.html     <script defer src="recovery-prompt.js"> before renderer.js   -- already correct
renderer/editor.html    <script defer src="recovery-prompt.js"> before editor.js      -- MOVED in QA pass 2
renderer/world.html     <script defer src="recovery-prompt.js"> before world.js       -- MOVED in QA pass 2
```

Deferred scripts run in document order; the new order is enforced by:

- `script-load-order.test.js` enumerates the editor-page co-load array
  (now places `recovery-prompt.js` BEFORE `editor.js`).
- New tests `B4 correction: recovery-prompt.js precedes editor.js on
  editor.html` and `M1 correction: recovery-prompt.js precedes world.js
  on world.html`, and `Mall script order: recovery-prompt precedes
  renderer.js`.

The prompt is still idempotent per session via
`sessionStorage[wrlforge.recovery.prompted]`.

No second prompt implementation lives in `editor.js` or `world.js`. They go
through the public `WRLForgeRecoveryPrompt.maybePrompt({ onRestore, onFresh })`
API only.

---

## New tests added in QA pass 1

`test/editor/phase-beta-2-corrections.test.js` — 16 focused regression tests:

| Test | Finding |
|---|---|
| B1: synthesized stat catches external source change at Save | B1 |
| B2: missing source -- structured result, recovery stays | B2 |
| B2-bis: missing source -- no path invented, no file written | B2 |
| B2-ter: adoptRecovery routes to sourceMissingRecovered without clearing | B2 + B3 |
| B2-qua: source MOVED (renamed) -- recovery preserved | B2 |
| B3-(a): Save clears the recovery | lifecycle |
| B3-(a-bis): Save FAILURE keeps the recovery | lifecycle |
| B3-(b): Restore keeps the recovery -- immediate second crash works | B3 |
| B3-(c): newest snapshots overwrite older ones | B3 |
| B3-(d): second-crash regression (Restore + crash + restart + Restore again) | B3 §12 |
| B4 correction: editor.js calls WRLForgeRecoveryPrompt.maybePrompt | B4 |
| M1 correction: world.js calls WRLForgeRecoveryPrompt.maybePrompt | M1 |
| Mall prompt regression preserved | regression |
| Idempotency: a second maybePrompt is silent | regression |
| IDEMPOTENCY_KEY constant is the documented name | regression |
| statFileFromBuffer produces deterministic stats | helper |

The existing `test/editor/recovery-controller.test.js` "KEEPS the snapshot"
tests are rewritten to assert the corrected behaviour.

Test counts: **1970 / 1970** (was 1954 → +16).

---

## 1. Scope

In scope:

- A debounced, writeable recovery snapshot of the dirty editor buffer (the
  text + metadata needed to restore it) held under `userData`.
- A startup probe that surfaces a single Restore / Start Fresh prompt when a
  valid snapshot is found.
- Restore: re-install the recovered text into the editor session, mark it
  dirty, navigate the user to the prior active workspace. The disk source is
  never written.
- Start Fresh: clear the snapshot; the user proceeds with no recovery state.
- A single-shot `render-process-gone` handler that flushes any in-flight
  recovery state and reloads once (with a guard so a crash loop never
  accumulates).
- Clear lifecycle hooks at Save success, Close, Discard, and Back.

Out of scope (explicitly, per §4.4 / §4.5 of the owner-approved policy):

- Auto-restoring the previously-open Mall `.wrl`.
- Auto-restoring the previously-open World Project root.
- Auto-merging recovered text with an externally-changed source.
- Build-bundle or upload integration.
- Auto-promoting a recovered buffer back to disk via Save.

---

## 2. Recovery data flow

```
+--------------------+    recoveryRecordDirty   +-----------+
| renderer/editor.js | -----------------------> |  main.js  |
+--------------------+                          +-----------+
        ^                                              |
        | throttled                                    | debounced flush
        | renderer side (1.5s trailing)               v
   scheduleRecovery                          src/editor/recovery-store.js
   Snapshot()                              -> userData/editor-recovery.json
                                                       |
                                                       v
                                              src/editor/recovery-controller.js
                                                       |
                                                       v
                                                readRecovery / adopt
                                                       |
                       +-------------------------------+
                       |
+-------------+    +---------------------+    +-----------------------+
| renderer    |    | renderer/recovery-  |    | main.js               |
| mall/world  | <--+ prompt.js shows the | <--+ startup probe + IPC  |
| page        |    | Restore/Start Fresh |    | recoveryRead / Adopt  |
+-------------+    +---------------------+    +-----------------------+
```

Main owns the disk path under `userData`. The renderer never names a write
path. The recovery-store is the only writer.

---

## 3. Recovery schema

Persisted to `userData/editor-recovery.json` (the path is owned by main; the
filename is defined in `src/editor/recovery-store.js` as
`RECOVERY_FILENAME`). Schema version `1`. The record is **JSON, plain text**
(snapshot data is small enough to stay legible; gzip is never applied):

| field | type | purpose |
|---|---|---|
| `schemaVersion` | `1` | forward-compatibility; mismatch → "no recovery" |
| `sourcePath` | `string \| null` | the real source path; null for unsaved-no-source buffers |
| `context` | `'mall' \| 'world' \| 'generic'` | where the file belonged |
| `profile` | `'mall-item' \| 'world' \| 'generic'` | the editor profile |
| `root` | `string \| null` | the World project root when context is `world` |
| `format` | `'plain' \| 'gzip'` | on-disk format the held source had at snapshot time |
| `baseline` | `string` | the buffer state at last sync (so dirty is correct after restore) |
| `buffer` | `string` | the current dirty text |
| `dirty` | `boolean` | always true when recorded (snapshot implies dirty) |
| `activeWorkspace` | `'mall' \| 'world' \| 'editor'` | where the user was before the crash |
| `updatedAt` | `number` (ms epoch) | last snapshot timestamp; informational |

---

## 4. Write policy

Recovery state is written through a **debounced** channel, never per keystroke:

- **Renderer throttles** in `renderer/editor.js` with `RECOVERY_THROTTLE_MS = 1500`
  (trailing). `scheduleRecoverySnapshot()` is invoked from the editor's
  `onChange` handler and is re-entrant: a new keystroke within the window
  collapses onto the latest payload.
- **Main debounces** again in `src/editor/recovery-controller.js` with
  `DEFAULT_DEBOUNCE_MS = 5000`. The most-recent payload wins; older writes
  are dropped.
- The recovery file is written **only** when the renderer reports a dirty
  state. A clean buffer never produces a snapshot.
- A `forceFlush()` helper is exposed to the main `render-process-gone`
  handler and to the renderer's `flushRecoverySnapshot()` (`Close` and
  `Back`) so the last keystrokes survive a fast navigate-away or a renderer
  crash.

Explicit Save: the file is written only if the Save returns `ok: true`. A
failed Save (conflict, verification, fs error) **keeps** the snapshot so the
next launch can still offer recovery. See §6 for the lifecycle table.

---

## 5. Lifecycle — when the snapshot is kept vs removed

| Event | Recovery file |
|---|---|
| clean editor | (not written) |
| dirty editor, debounce expires | written (snapshot) |
| normal Save success | removed (`recordClear`) |
| normal Save failure | **kept** (next launch prompts) |
| explicit Discard via modal | removed (`recordClear` via Close path) |
| normal explicit Close | removed (`recordClear` via Close IPC) |
| Back / navigate away | snapshot kept; **final flush** runs first |
| abnormal renderer-process crash | kept; `forceFlush` runs before reload |
| app restart | read at startup; prompt shown if valid |
| Restore accepted | removed (after `adoptRecovery`) |
| Start Fresh accepted | removed (`recordClear`) |
| prompt close (Escape) | **kept** (records are silent unless user picks Start Fresh) |
| corrupt JSON at startup | reported as `bad-json`, treated as no recovery |

---

## 6. Restore prompt

Shown by `renderer/recovery-prompt.js` on every page mount if a valid
snapshot exists. The Mall page (default landing) is where the prompt appears
for a cold start; World and Editor pages also load the module so a
post-mount restart still surfaces recovery.

Wording (verbatim, owner-approved):

> **Recovered unsaved work was found.**
> WRL Forge detected editor work that had not been saved to its source file
> when the app last exited. Restore it, or start fresh and forget it. The
> source file on disk is unchanged either way.

A four-line meta summary follows the message (workspace, source path,
format, length; `Saved:` time when available). Two buttons:

- **Restore** (primary) — calls `editor:recoveryAdopt` → main
  `recoveryController.adoptRecovery` → opens the held session + installs
  the recovered buffer; navigates to `/editor`.
- **Start Fresh** — calls `editor:recoveryClear` → `recordClear`; the user
  proceeds without restoring.

The "Start Fresh" choice requires an explicit click. Closing the prompt
(`Escape`, focus loss) is a no-op and the snapshot survives. This is the
explicit-deliberation rule: a stray `Escape` cannot destroy recoverable work.

---

## 7. Restore action

On Restore, main processes the recovered record:

- **Source-bearing recovery** (`sourcePath` non-null):
  1. `EditorController.openFromRecovery` opens the held source through the
     normal path (gzip / format / stat are handled by `session-store.js`).
  2. The recovered buffer replaces the freshly-loaded text.
  3. The recovered baseline (if supplied) overrides the just-read baseline
     so the dirty comparison matches what the user had on screen.
  4. The session reports `dirty: true`. The source file on disk is **not**
     touched.
  5. The snapshot is removed from disk (`recordClear`).

- **Unsaved-no-source recovery** (`sourcePath` null):
  1. The session is **not** opened (there is no source file).
  2. The renderer receives the recovered buffer plus the original
     `{profile, context, format, activeWorkspace}` so it can re-create the
     edit state in a fresh unsaved session.

Either way, the next user action is a deliberate Save through the normal
editor path. Recovery is never a Save.

---

## 8. Start Fresh action

`Start Fresh` invokes `recordClear` from `renderer/recovery-prompt.js`:

- Any pending debounced flush is cancelled.
- The recovery file is removed.
- The renderer returns to its previous state (Mall, World, or Editor) with
  no recovery state.

The real source file is not opened, modified, or even read as a side effect.

---

## 9. Source-safety invariants

The disk source is **never** written by recovery code:

- `recoveryRecordDirty` only writes `editor-recovery.json` in `userData`.
- `recoveryStorePath` is the only path resolved; no renderer-supplied paths.
- `openFromRecovery` opens the source read-only through `loadDocument`
  and never invokes `safeSave`.
- A successful Restore is dirty, not saved. The user must perform Save
  themselves.

External changes between snapshot and Restore are handled gracefully:

- If the source file no longer exists at Restore time, `EditorController.openFromRecovery`
  throws and the renderer treats the result as Start Fresh (the snapshot
  is cleared so a stale entry cannot strand the user).
- If the source file changed externally, the recovered buffer is still
  offered as a dirty buffer against the now-different disk baseline. There
  is **no** automatic merge.
- Gzip sources stay gzip after Restore; the format is never silently
  rewritten.

---

## 10. Renderer-process crash

`win.webContents.on('render-process-gone', ...)` in `main.js` is the
single recovery-aware handler:

1. **Force-flush** any in-flight recovery snapshot before the reload. The
   flush runs synchronously through `recoveryController.forceFlush()`.
2. **Single-shot reload** of the renderer process via `webContents.reload()`.
3. **Burst guard**: a second `render-process-gone` within 10 seconds is
   logged and NOT reloaded — a hard crash loop is never papered over with
   a tighter reload loop. The user retains the rest of the app and can
   quit cleanly.
4. The next renderer mount runs the same startup probe; the snapshot is
   still on disk, the user still gets the prompt.

A `will-prevent-unload` listener runs a best-effort `forceFlush` so a
navigation that the renderer tries to cancel (the existing dirty-close
modal) still flushes the last keystrokes.

---

## 11. Plain / Gzip WRL

Recovery does not change how plain or gzip files are saved. The snapshot
records `format` and the editor re-loads the source through the existing
`loadDocument` (which decompresses gzip transparently). A restored
gzip source saves back as gzip through the normal `safeSave` path; a
plain source saves back as plain. The locked invariant
(`safeSave` round-trips the held format) is unchanged.

---

## 12. Security boundary

The recovery substrate adds five IPC channels (`editor:recoveryRead`,
`editor:recoveryRecordDirty`, `editor:recoveryClear`,
`editor:recoveryAdopt`, `editor:recoveryActiveWorkspace`). All of them take
no renderer-supplied path:

- `recoveryRecordDirty` accepts a small payload of strings (sourcePath,
  context, profile, root, format, baseline, buffer, dirty,
  activeWorkspace). The buffer is a normal string the renderer already
  sees; no new attack surface.
- `recoveryAdopt` opens the held `sourcePath` from the persistent record;
  the renderer cannot name a different path.
- The `userData` path is derived from `app.getPath('userData')` only.
- `contextIsolation: true`, `nodeIntegration: false` remain unchanged.
- No new dependency is added. No new network capability. No new IPC
  handler outside the editor surface.

---

## 13. Existing session behavior preserved

Phase Beta 2 does not regress any session feature:

- Window size + position restore.
- Editor document session restore (with previously-authorized-context guard).
- Editor zoom, theme, split fraction, `editorCommand` setting.
- World preview viewpoint / navigation mode (these still live in their
  renderers' persistence).

It is **additive**: `editor-session.json` continues to record the LAST-SAVED
document for the next launch; `editor-recovery.json` records the DIRTY
buffer for crash survival. The two files are deliberately decoupled and
neither can mutate the other.

---

## 14. Deferred restore work (per owner policy 4.4 / 4.5)

These were explicitly **not** added in this lane:

- No `mall-session.json`.
- No `world-session.json`.
- No auto-restore of a previously-open Mall `.wrl`.
- No auto-restore of a previously-open World Project root.
- No auto-scan of a stale project on startup.

A blank Mall page is still the default landing. The recovery prompt is the
only startup observation that survives an abnormal exit.

---

## 15. Naming + policy notes

Phase Beta 2 is the canonical name for this lane; the older `Phase 7D2`
label remains valid in historical evidence but new documentation uses
**Phase Beta 2**.

The owner-ratified lane names are recorded in `docs/WRL_FORGE_ROADMAP.md`:

- **Phase Beta 2** — this lane.
- **Phase: Accessibility + Performance** — keyboard + large-project perf
  (previously 7D1). The proposed `Ctrl+R` (Repack) and `Ctrl+E` (Open in
  Native Editor) shortcuts are approved in principle but **not implemented
  in Phase Beta 2**.
- **Phase: Cross Platform Beta** — Linux + Windows refresh (previously
  7D3; the cross-platform beta is already complete).

The project license was resolved to **GPL-3.0-or-later** in commit
`2eb7c39` (per `package.json`). The historical MIT choice was a
misunderstanding; the roadmap is updated to reflect the resolved policy.

---

## 16. Tests

Three new test files under `test/editor/`:

| File | Coverage |
|---|---|
| `recovery-store.test.js` | schema version, all mandatory fields, bad JSON, missing sourcePath, gzip round-trip, schema mismatch, null sourcePath, future schemaVersion, unknown activeWorkspace, idempotent clear |
| `recovery-controller.test.js` | debounce window collapse, debounceMs=0 synchronous path, `recordClear` drops pending + file, `readRecovery` miss/hit, source-bearing adopt, source-less adopt, malformed snapshot not adopted + log, abnormal-failure Save-keeps-snapshot + Start-Fresh path, debounce-timer force-flush |
| `recovery-open-from-recovery.test.js` (inside `editor-controller.test.js`) | source file untouched byte-for-byte, no auto-merge on external change, gzip format kept intact |

Plus:

- `test/editor/script-load-order.test.js` was updated to include
  `renderer/recovery-prompt.js` in the editor-page co-load set. Co-load
  passes without scope collisions.

Test counts:

| gate | result |
|---|---|
| `npm test` | **1954 / 1954 pass, 0 fail, 0 skipped** (was 1923; +31 = 28 recovery-store/controller + 3 editor-controller) |
| `npm run check` | **1954 / 1954 pass + node `--check` over all sources** |
| `npm run build:editor` | OK |
| `git diff --check` | clean |

---

## 17. Files changed in Phase Beta 2

Owner / production code:

- **new** `src/editor/recovery-store.js`
- **new** `src/editor/recovery-controller.js`
- **new** `renderer/recovery-prompt.js`
- `src/editor/editor-controller.js` — added `openFromRecovery` (read-only install of a recovered buffer)
- `main.js` — created `recoveryController`, added 5 IPC handlers, lifecycle hooks on Save/Close, `render-process-gone` + `will-prevent-unload` flushes
- `preload.js` — added `editor.recovery:{Read,RecordDirty,Adopt,Clear,ActiveWorkspace}` bridge methods
- `renderer/editor.html` — added `recovery-prompt.js` script tag
- `renderer/index.html` — added `recovery-prompt.js` script tag + `maybePrompt()` call at the bottom of `renderer.js`
- `renderer/world.html` — added `recovery-prompt.js` script tag
- `renderer/editor.js` — added throttled `scheduleRecoverySnapshot`, `flushRecoverySnapshot`, hooks in `onChange`, `doClose`, `doBack`
- `docs/WRL_FORGE_ROADMAP.md` — Phase Beta 2 entry; name corrections; license policy reference
- `docs/PHASE_7D_BASELINE.md` — D3 rows updated to reflect Phase Beta 2 completion; 7D2 reference superseded by Phase Beta 2
- `docs/PHASE_BETA_2_CRASH_RECOVERY.md` — this document

Tests:

- **new** `test/editor/recovery-store.test.js`
- **new** `test/editor/recovery-controller.test.js`
- `test/editor/editor-controller.test.js` — three openFromRecovery cases
- `test/editor/script-load-order.test.js` — recovery-prompt added to the co-load list

---

## 18. Known limits

- The recovery snapshot file is plain JSON. Files of MB-scale would inflate
  the snapshot; the path is small-and-typed by design (the typed workspace
  is the target).
- Auto-restore of `mall-session.json` / `world-session.json` is **deferred**
  per §14. A user who wants a fresh-looks Mall page has to pick Start Fresh.
- Recovery does not detect silent corruption after write (the snapshot file
  is not signed). A malformed record is reported and ignored; the user is
  never stranded.
- The `render-process-gone` burst guard suppresses a reload after a second
  crash within 10 s. The user keeps the rest of the app; the recovery
  snapshot is still intact and the user can quit and relaunch manually.

These limits are recorded, not documented as bugs.
