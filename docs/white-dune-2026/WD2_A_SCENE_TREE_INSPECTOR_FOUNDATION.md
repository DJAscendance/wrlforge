# WD2-A — Read-Only Scene Tree and Inspector Foundation (as built)

**Lane:** WD2-A · **Status:** **CLOSED** — independent final re-QA passed
(`WD2_A_FINAL_REQA_PASS`): 70 / 70 Electron runtime assertions, 0 console
errors, 0 console warnings; full repository tests **1923 / 1923**, 0 failed,
0 skipped. Implemented and corrected through two QA rounds (F1–F5 first,
C1–C5 second).

## 1. What this lane is

The first user-interface consumer of the completed P4 chain. A read-only
scene tree and a read-only inspector that sit beside the existing native
editor's Outline panel and consume the same parse the diagnostics come from.
No editing. No mutation. No localisation. No semantic re-decision.

```
buffer text
  → editor-view.js (esbuild bundle)
  → language.js → vrml.parse
  → { highlights, diagnostics, advisories, outline, parseResult }
  → editor.js (renderer binding)
      → sceneBridge.scopeGraph.buildScopeGraph(parseResult)
      → useResolver = (use) => scopeGraph.resolve(graph, use)
      → sceneBridge.sceneTree.buildSceneTree(parseResult, { useResolver })
      → sceneBridge.semanticFindings.findingsForDocument(graph)   // graph, not parseResult
      → sceneBridge.presentation.presentDocumentFindings()        // P4-A ordering
  → scene-tree view       (DOM, ARIA tree, keyboard nav)
  → inspector view        (DOM, facts + diagnostics via P4-B)
  → shared selection      (the only authority either subscribes to)
```

The corrected path is **scope-graph first, USE resolver second, scene
tree third, findings fourth**. `findingsForDocument` REQUIRES a scope
graph; a raw `parseResult` throws `ESCOPEGRAPH` and that throw is now
surfaced via `console.error` instead of silently turning into `[]`.

## 2. Modules added

| file | role |
|---|---|
| `src/vrml/scene-tree.js` | pure read-model projection. Browser-safe. Frozen output. |
| `src/editor/scene-selection.js` | single selection authority shared by both views. Dual use (CommonJS + browser). |
| `renderer/scene-tree.js` | scene-tree DOM binding, ARIA tree semantics, roving-tabindex keyboard nav. |
| `renderer/scene-inspector.js` | inspector DOM binding, facts table, linked diagnostics. |

The bundled editor view (`src/editor/browser/editor-view.js`, esbuild) now
re-exports a `window.WRLForgeSceneBridge` carrying the scene-tree, P4-A
presentation, P4-B messages, and semantic-findings facades — a thin re-export
of already-bundled vrml/ modules, not a second load.

`renderer/editor.html` loads the three new scripts in load-order before
`editor.js`. `test/editor/script-load-order.test.js` pins that order.

## 3. Scene-tree source model

The scene tree is built from the `parseResult` carried on the
`onAnalysis` callback the editor-view bundle already produces
(`src/editor/language.js` exposes it; the bundle forwards it). There is NO
second parse and NO regex scraping of source text — `test/vrml/scene-tree.test.js`
asserts this by source scan (`M2`).

It walks the AST exactly once, emits an item per inspectable construct, and
freezes the result. Items are intentionally included or excluded as listed
below; the test `Q15` pins the exclusions.

| kind | included? | reason |
|---|---|---|
| top-level `Node` (with or without DEF) | yes | the scene's authored entries |
| nested `Node` reached through SFNode / MFNode fields | yes | composition hierarchy the user expects to navigate |
| `USE` reference | yes | a USE is inspectable on its own; it is NOT a cloned child |
| `PROTO` declaration (descend into body) | yes | declaration + body items |
| `EXTERNPROTO` declaration | yes | declaration + interface list |
| `ROUTE` statement (at any nesting level) | yes | graph edge in the authored scene |
| `PROTO` instance flag on a `Node` | yes | `protoInstanceName` set when nodeType matches a PROTO declaration name |
| scalar / array / string / bool / null | NO | not inspectable |
| `IS` binding | NO | lives on a field declaration; inspector shows via the field |
| `InterfaceDecl` | NO | parent PROTO/EXTERNPROTO carries the inspectable shape |
| `ROUTE` / `PROTO` / `EXTERNPROTO` inside an MFNode array | NO | parser-accepted Cybertown compatibility pattern; treating it as a scene item would invent hierarchy |
| duplicate `DEF` (two Nodes with the same name) | NO cloning | both Nodes are still emitted as their own items; the WD1.5 scope graph decides USE binding (`DUPLICATE_DEF_IN_SCOPE` -> `UNRESOLVED`, never an arbitrary pick) |

### 3.1 USE resolution authority

USE items carry `useTargetStatus` and `useTargetItemId`. These are decided
by the renderer -- the single authority -- via a `useResolver` callback it
passes to `buildSceneTree`. The renderer builds the resolver from the
WD1.5 scope graph and `scopeGraph.resolve(graph, useNode)`; the read model
itself NEVER answers from the flat `defsByName` (that lookup is
cross-scope-blind and would resolve an outer `USE` to a DEF declared inside
a PROTO body -- F4). With no resolver, USE items default to `UNRESOLVED`.

## 4. Item identity

Item ids are session-stable strings of the form `<kind>-<startOffset>-<endOffset>`.
They are derived purely from a kind and the source range, so:

- the same parse fed in twice produces the same ids,
- the same item id appears in document order across re-renders of the same parse,
- after a reparse an id may refer to nothing; the renderer clears the
  selection when that happens.

They are **NOT** persisted into files, **NOT** authoritative node identity
(WD1.4 §7 forbids durable ids in the document), and **NOT** used as a parse
or load-bearing UI key in any other context. `Q11` proves the determinism;
`M3` asserts the format and uniqueness.

## 5. Selection authority

`src/editor/scene-selection.js` is a single factory
(`createSelectionController()`) shared by the scene-tree view and the
inspector. There is exactly one selection id at a time. Setting the same id
twice is a no-op. Listeners fire in subscription order; faulty listeners
are caught and do not break the others. Unsubscribe returns a token.

`test/editor/scene-selection.test.js` covers Q7 (one selection drives both
views), M8 (one factory, one export — no parallel authority), and the
single-authority invariant.

## 6. Inspector contract

The inspector renders the facts the read model already owns, never a
re-derived semantic verdict.

| kind | facts shown |
|---|---|
| Node | node type, DEF, PROTO instance name, fields count, field names list, source range |
| Use | name, resolution (resolved/unresolved), field name under which the USE appears, source range |
| Proto | name, has-body, interface-member count, source range |
| ExternProto | name, interface-member count, source range |
| Route | from/to node + event, from/to resolved, source range |
| Document | header presence, statement count |

Linked diagnostics use the **range** the finding carries, not text, not
labels, not severity. They go through `presentDocumentFindings` (P4-A) for
ordering and `messageForPresentation` (P4-B) for text. The view paints the
severity chip's color and stops there.

| scenario | rendered |
|---|---|
| document open, no selection | "No selection. Choose an item in the scene tree." |
| selected item, no linked findings | "No diagnostics for this item." |
| selected item with findings | ordered rows: severity chip + title + summary + (optional) detail |

`Q8` (no selection) and `Q9` (diagnostic linkage by range) and `Q14` (most-
specific item by offset) are the load-bearing tests.

## 7. P4-A use

The inspector consumes `vrml.presentation`'s full surface and never reaches
into the policy tables. Severity, ordering, visibility, saveBlocking,
attentionRank, tags, claim, iso, confidence, and compatibility come straight
from the presentation record. The view's only styling is a CSS class on the
severity chip.

`presentation.visible` is always true on every result P4 produces today;
the view honours that without filtering.

## 8. P4-B use

The inspector consumes `vrml.messages`'s `{ id, title, summary, detail }`
shape verbatim. It never maps a code to prose, never rewrites a title, never
adds a default sentence. The result object is rendered as plain DOM text;
no HTML interpolation, no `innerHTML`, no `escape`.

## 9. Accessibility

The scene tree uses `role="tree"` with `role="treeitem"` per row,
`aria-level`, `aria-selected`, `aria-expanded`, and a roving tabIndex.
Keyboard navigation: `ArrowDown`/`ArrowUp` (row stepping), `Home`/`End`
(first/last), `Enter`/`Space` (select). The inspector renders a labelled
region and a `<h3>` heading for the diagnostics section.

`Q7` proves selection drives the inspector. No mouse-only path.

## 10. Save policy

WD2-A adds no save gate. WD2-A does not look at `presentation.saveBlocking`
to disable the Save button. The renderer's existing `editor.js` toolbar
model is the single authority for Save enablement, and it never consults
the scene tree or the inspector.

## 11. Compatibility display

When P4-A emits a `compatibility` annotation on a finding, the inspector
renders it through P4-B's wording — three facts: the strict verdict, the
named runtime's tolerance, the portability verdict. It does not turn
compatibility into a second error. It does not reduce strict severity. It
does not invent profile support.

`E1` is the only profile P4 today can present; this lane consumes whatever
P4-A produces without conditionals on the profile name.

## 12. Empty states

- no document open → scene tree shows "No document.", inspector shows
  "No selection."
- document open, no selection → inspector shows "No selection. Choose an
  item in the scene tree."
- selected item with no diagnostics → "No diagnostics for this item."

These are local labels — no second diagnostic message catalog.

## 13. Read-only boundary

WD2-A adds none of: field editing, node creation, deletion, drag-and-drop,
reparenting, rename, DEF editing, PROTO editing, ROUTE editing, auto-fix,
quick-fix. The selection authority has no mutating API surface beyond
`setSelection`/`clearSelection`. The DOM bindings expose only `setSceneTree`,
`setFindings`, `focusById`, `rowForId`, `focusOffset`.

## 14. Large scenes

The read model is depth-first and emits items in a single pass. The
inspector and the scene tree do not render every item into the DOM at once
when the tree is large (CSS `max-height: 16rem` on the tree,
`max-height: 26rem` on the inspector, native scrolling). No virtualization
dependency was added. The 100 000-node parser cap and the depth cap remain
the authoritative bounds.

## 15. Browser boundary

`src/vrml/scene-tree.js` requires only `./ast`. `test/vrml/scene-tree.test.js`
asserts by source scan that it never reaches `fs`/`path`/`zlib`/`electron`
(`M1`) and never re-parses source text (`M2`). The renderer's
`scene-tree.js` and `scene-inspector.js` are DOM-only and contain no
`require`/`import`. The selection authority is pure data and is unit-tested
in Node with no DOM.

No network call, no `fs`, no `child_process`, no Electron API in any new
file. No `blaxxun-cs-RE` reference anywhere.

## 16. Public API

The narrow consumer surface this lane exposes:

| symbol | location | why it must be public |
|---|---|---|
| `vrml.sceneTree.buildSceneTree` | facade | the WD2 scene-tree consumer entry |
| `vrml.sceneTree.itemContainingOffset` | facade | a future inspector / palette / outline wants to attach findings to the most-specific item |
| `vrml.sceneTree.itemById` | facade | the selection authority's id-keyed lookup is the read-model's `byId` |
| `vrml.sceneTree.KIND` / `USE_TARGET` | facade | stable vocabulary for branching |
| `createSelectionController` | preload-style dual | one selection authority, one factory |
| `WRLForgeSceneSelection` | window global | the renderer page's bridge to the selection authority |
| `WRLForgeSceneBridge` | window global (editor bundle) | the renderer's narrow entry into the bundled pure vrml modules |
| `WRLForgeSceneTree` / `WRLForgeInspector` | window global | the DOM bindings the editor page wires up |

Internal helpers (`idFor`, `rangeCopy`, `makeItem`, `finalizeItem`) stay on
the module and are not on the facade — the same split P4-A made.

## 17. Tests

| file | tests | what |
|---|---|---|
| `test/vrml/scene-tree.test.js` | 26 | Q1–Q15 + M1–M7 + M8 + M8b + M9 + M10 |
| `test/editor/scene-selection.test.js` | 10 | selection behaviour + M8 architecture scan |
| `test/editor/scene-inspector-integration.test.js` | 9 | F1 corrected end-to-end path + reproduction that the old wiring threw ESCOPEGRAPH silently + C1 itemById wiring + C2 no-double-presentation |
| `test/vrml/scene-tree-fixes.test.js` | 17 | F2 nested DOM rendering, F3 ownership, F4 cross-PROTO + same-scope USE, F5 read-only Map set/delete/clear + C3 size/iteration + C4 ARIA + C5 facade hygiene |
| `test/renderer/editor-wd2-runtime.test.js` | 5 | Runtime binding under DOM stubs: nested rows + ARIA, USE verdict tag, P4-B through inspector with selection, itemById fallback, keyboard selection |

Total: **67** new tests. Full `npm test` + `npm run check`:
**1923 / 1923**, 0 failed, 0 skipped (1852 baseline + 67 new + 4 unrelated shifts
in the disputed test files were already passing).

Focused baselines unchanged:
- P4-A: **49**
- P4-B: **43**
- WD1.7-D: **171**
- semantic-findings matrix: passing
- proto-enrichment (incl. compatibility-null): **222** passing
- external-proto/architecture-boundary: **passing** (the QA1 disputed file)
- proto-enrichment/architecture-boundary: **passing** (the QA1 disputed file)
- proto-resolution/architecture-boundary: **passing** (the QA1 disputed file)
- product-posture: **passing** (the QA1 disputed file)
- world-project/externproto-deps: **passing** (the QA1 disputed file)

## 18. WD2-A correction passes

Independent QA on the WD2-A patch surfaced ten findings across two
rounds. Each was reproduced against the previous implementation, fixed,
and pinned with a regression test that fails under the old behaviour.

| finding | round | where |
|---|---|---|
| **F1** `findingsForDocument(a.parseResult)` threw `ESCOPEGRAPH`; the renderer's catch turned it into `rawFindings = []`, so the inspector rendered "No diagnostics" on a document with real semantic issues. | first | `renderer/editor.js` builds the scope graph first and passes the graph; ESCOPEGRAPH now surfaces via `console.error`. The `src/editor/browser/editor-view.js` bundle's `WRLForgeSceneBridge` exposes `scopeGraph.buildScopeGraph` + `scopeGraph.resolve`. `test/editor/scene-inspector-integration.test.js` pins both the corrected end-to-end path and the old wiring's loud failure. |
| **F2** Scene-tree rendering iterated `tree.root.childIds` only, so nested grandchildren never reached the DOM. | first | `renderer/scene-tree.js`'s `buildSceneTreeDom` walks `tree.items` (depth-first document order) and skips only the Document root. `aria-level` is derived from `item.depth + 1`. `test/vrml/scene-tree-fixes.test.js` covers nested rows, nested USEs, depth-first order, and a source-scan guard against re-introducing the old loop. |
| **F3** The inspector filtered findings with `isInside(range, item)`, which is true for every ancestor of the smallest containing item -- a nested finding appeared on the Document, the Group, and the Shape at once. | first | `renderer/scene-inspector.js`'s filter uses `itemContainingOffset(tree, finding.range.start.offset)` and matches `owner.id === selectedItem.id`. `renderer/editor.js` passes `itemContainingOffset` to the inspector's deps. Two separate invalid USEs stay two separate findings (no dedup). `test/vrml/scene-tree-fixes.test.js` covers the rule and the duplicate-USEs case. |
| **F4** USE items resolved from the flat `defsByName`, which is cross-scope-blind -- an outer `USE Inner` was reported RESOLVED against a DEF declared inside a PROTO body (4.8.4 forbids this). | first | `src/vrml/scene-tree.js`'s `emitUse` consults a `useResolver` callback; the renderer supplies one that calls `scopeGraph.resolve(graph, useNode)`. Without a resolver, USE defaults to UNRESOLVED (fail closed) -- the read model never answers from the flat lookup. `test/vrml/scene-tree-fixes.test.js` covers cross-PROTO UNRESOLVED, same-scope RESOLVED, and a resolver that throws surfaces the error. The old M8 was split into M8 (no clone, UNRESOLVED without resolver) and M8b (the graph decides when one is supplied). |
| **F5** `Object.freeze(tree)` did not freeze the `byId` and `defsByName` Maps, which were handed to the renderer as plain mutable Maps. | first | `src/vrml/scene-tree.js` wraps both Maps in read-only Proxies that throw TypeError on `set`/`delete`/`clear`; `get`/`has`/size/iteration remain usable. The renderer code (which only reads) keeps working unchanged. `test/vrml/scene-tree-fixes.test.js` proves `set`/`delete`/`clear` throw while `get` still returns the item. |
| **C1** `renderer/editor.js`'s `initSceneViews()` did not pass `itemById` to the Inspector, so any selection fell through to the empty state. | second | `renderer/editor.js` now wires `itemById: sceneBridge.sceneTree.itemById` into the Inspector deps; `test/editor/scene-inspector-integration.test.js` asserts the wiring by source scan, and `test/renderer/editor-wd2-runtime.test.js` exercises a real selection on the Document, a Node, and a USE -- the Inspector changes from "No selection." to the selected item's data. |
| **C2** The Inspector called `presentDocumentFindings` a second time on already-presented `{finding, presentation}` records, which threw `EPRESENTATIONSHAPE` and silently dropped every diagnostic. | second | `renderer/scene-inspector.js`'s `renderFindings` now iterates the P4-A presented records directly; it never re-presents. P4-A order is preserved. `test/editor/scene-inspector-integration.test.js` pins both the no-re-presentation rule and the reverse-must-throw contract. |
| **C3** The read-only Map Proxy returned `undefined` for `tree.byId.size` and `tree.defsByName.size` (Map's `size` getter reads the receiver's `[[MapData]]`, and the receiver was the Proxy, not the Map). | second | `src/vrml/scene-tree.js`'s `readOnlyMap` trap now returns `target.size` directly for that one key. `test/vrml/scene-tree-fixes.test.js` proves `size` works on both maps; `get`, `has`, `keys`, `values`, `entries`, `forEach`, `for...of`, `Symbol.iterator` all continue to work; `set`, `delete`, `clear` still throw. |
| **C4** Leaf tree rows carried `aria-expanded="false"` -- a false claim about UI state, since leaves are not expandable. | second | `renderer/scene-tree.js`'s `makeRow` now omits `aria-expanded` entirely on leaves and sets `aria-expanded="true"` only on parents (whose children are always rendered -- WD2-A has no expand/collapse). `test/vrml/scene-tree-fixes.test.js` proves the rule for every parent/leaf pair and pins it by source scan. |
| **C5** `vrml.interfaceQuery.resolve` was a public facade entry with zero consumers -- the renderer's USE resolver goes through `WRLForgeSceneBridge.scopeGraph.resolve` instead. | second | `src/vrml/index.js`'s `publicInterfaceQuery` no longer publishes `resolve`; the bundled `scopeGraph.resolve` remains the authoritative USE resolver. `test/vrml/interface-query.test.js` asserts `vrml.interfaceQuery.resolve === undefined` and `test/vrml/scene-tree-fixes.test.js` source-scans the renderer + bundle for absence of `interfaceQuery.resolve` and presence of `scopeGraph.resolve`. |

## 19. Deferred (out of WD2-A)

- field editing / node creation / node deletion
- drag-and-drop / reparenting
- rename, DEF editing, PROTO editing, ROUTE editing
- auto-fix / quick-fix
- localisation
- A3 Contact runtime evidence
- V2 semantic-finding lane
- `blaxxun-3d` profile
- post-C World Project consumer
- WD.md §9 re-sourcing
- stale-doc cleanup
- starting any WD2 editing lane

## 20. Files added or modified

Added:
- `src/vrml/scene-tree.js`
- `src/editor/scene-selection.js`
- `renderer/scene-tree.js`
- `renderer/scene-inspector.js`
- `test/vrml/scene-tree.test.js`
- `test/editor/scene-selection.test.js`
- `test/editor/scene-inspector-integration.test.js`
- `test/vrml/scene-tree-fixes.test.js`
- `test/renderer/editor-wd2-runtime.test.js`
- `docs/white-dune-2026/WD2_A_SCENE_TREE_INSPECTOR_FOUNDATION.md` (this file)

Modified (minimal, additive):
- `src/vrml/index.js` (added `vrml.sceneTree` facade; corrected wiring:
  `findingsForDocument` requires a graph, never a parseResult; `resolve`
  was removed from the interface-query facade in round two -- C5, no
  production consumer)
- `src/editor/language.js` (exposes `parseResult` on `analyze` result)
- `src/editor/browser/editor-view.js` (forwards `parseResult` to `onAnalysis`;
  re-exports `WRLForgeSceneBridge` with the `sceneTree`, `presentation`,
  `messages`, `semanticFindings`, and `scopeGraph` facades for the renderer)
- `renderer/editor.html` (loads the three new scripts; adds Scene tree +
  Inspector sidebar sections with CSS)
- `renderer/editor.js` (mounts the scene-tree view + inspector via the
  shared selection authority; the `onAnalysis` path builds the scope graph
  first, supplies a graph-aware `useResolver` to `buildSceneTree`, and
  calls `findingsForDocument(graph)` -- never `findingsForDocument(parseResult)`;
  the Inspector receives `itemById` + `itemContainingOffset` + `messages`
  + `presentation` + the already-presented records array)
- `test/editor/script-load-order.test.js` (pins the new script order + new
  page-scope globals)
- `test/vrml/interface-query.test.js` (facade surface test pins the
  absence of `resolve` on `publicInterfaceQuery`)
- `test/vrml/scene-tree.test.js` (`build` helper now passes a graph-aware
  `useResolver`; M8 split into M8 + M8b to pin the corrected shape)
- `scripts/run-tests.js` (registers `test/renderer` as a collected
  directory)
- `package.json` (registers the new files with `node --check`)

The renderer's existing outline + diagnostics + advisories panels are
unchanged.