# Phase 7B1 — Native Editor Closeout: focused visual QA (Linux)

Focused serialized visual pass proving the **passive-launch removal**. Run through
the single sanctioned harness (`VisualQaRunner`, concurrency 1, one reused Electron
process, launch cap, post-run leak check). **No** per-screenshot launches, **no**
`pkill`/`killall`.

```
node qa/phase-7b1-native-closeout/orchestrate.js
```

## Result

`launches: 1 · captures: 3/3 · survivors: 0 · graceful exit · RESULT: PASS`

| # | State | Screenshot | What it proves |
|---|---|---|---|
| 01 | Mall `.wrl` opened (real `openMallPath → openMallFile`) | `screenshots/01-mall-open-passive.png` | Workspace loads normally (preview + validation + fit report); **no external editor launched**, **no "editor not found" banner**. Subtitle: "An external editor (VSCodium) is optional." |
| 02 | Native editor opened **explicitly** | `screenshots/02-native-editor-explicit.png` | The native editor is an explicit user action; CodeMirror workspace renders (outline, diagnostics, Ln/Col). |
| 03 | External editor requested **explicitly** | `screenshots/03-external-editor-explicit.png` | The external-editor action is reachable and wired only as an explicit action. |

The Electron process was spawned with `WRL_FORGE_NO_EDITOR=1`, so no VSCodium
process is ever started during QA. Independently, the production code no longer
calls `launchEditor` on open at all.

## Where the behavior is proven deterministically

A screenshot cannot show the *absence* of a spawned process, so the passive-launch
posture is proven by unit + posture tests (stronger, deterministic):

- `test/editor/mall-edit-flow.test.js`
  - opening a Mall file writes the working copy but **never launches** an editor;
  - the explicit external action **launches** the editor, and **(re)creates** the
    `.edit.wrl` working copy when missing;
  - native editing opens the **real source** (plain and gzip) and creates **no**
    `.edit.wrl` sibling.
- `test/product-posture.test.js` — the "editor not found" message is surfaced only
  by the explicit external action, never from `applyState` on open; the native
  editor surface (`renderer/editor.html` + `renderer/editor.js`) is now scanned.

## Regression

The full Phase 7B editor visual matrix was re-run after the refactor:
`qa/phase-7b-native-editor/` → **15/15**, 1 launch, 0 survivors, graceful exit —
confirming the native-editor GUI is unaffected by the mall-open refactor.
