# WD1 — Lossless Scene-Document Core: Implementation Plan

> **Historical record.** Written before WRL Forge moved to `GPL-3.0-or-later`.
> Its clean-room rules and its references to the deleted
> `GPL_PROVENANCE_BOUNDARY.md` are **superseded** by `/OPEN_SOURCE_PROVENANCE.md`
> and `/WD.md` §1. Its provenance statements about what was consulted at the time
> remain accurate. See `README.md` in this directory.

**Status:** Phase WD0 deliverable — a plan, not an implementation.
**Date:** 2026-08-06
**Audience:** the agent or engineer who executes WD1. Read this with
`docs/white-dune-2026/WD0_DISCOVERY_REPORT.md` and `AGENTS.md`.

> **Owner-approved direction (Ryan, 2026-08-06)** — see `WD0_DISCOVERY_REPORT.md` §14
> for the full list. The three that change this plan:
>
> - **Sequence approved:** `WD1-Read → WD2 → WD1-Write → WD3 → WD4`. WD2 (read-only
>   scene tree + selection sync) lands between the read and write halves of WD1.
> - **VRML040–VRML044 do NOT become authoritative in WD1.5.** Build the scope model;
>   keep the diagnostics **advisory** until they have been tested against the real
>   Cybertown corpus and reviewed separately. §6 and §9 reflect this.
> - **Identity gate confirmed:** zero wrong anchors, with **uniquely named `DEF` nodes**
>   as the approved fallback (§5, §10).
>
> **Next lane is WD1.1 only.**

---

## 0. The finding that shapes this entire plan

**WRL Forge's tokenizer already round-trips source byte-exactly.**

Concatenating every token's `leadingTrivia` lexemes followed by its own `lexeme`
reproduces the input exactly. Measured over every parseable VRML fixture in the repo:

```
TOKEN-STREAM ROUND-TRIP over 60 VRML files
  byte-exact : 53
  MISMATCH   : 0
  skipped    : 7 (gzip/non-utf8)
```

Whitespace, VRML's comma-as-whitespace, comments, CRLF vs LF, and the `#VRML` header
are all preserved with exact `{offset,line,column}` spans
(`src/vrml/tokenizer.js:155` `readTrivia`, `:118` `tryHeader`).

This changes the answer to the brief's central question.

> **WRL Forge does not need a CST, and it does not need an AST→text serializer.**
>
> It needs **span-anchored text patching**. The AST already carries an exact
> `range` on every node (`src/vrml/ast.js`); an edit is therefore a byte-range
> replacement against text that is never regenerated. Text outside the edited span is
> not merely *preserved* — it is **never touched**, so preservation is structural
> rather than a property to be tested for.

A serializer would be strictly worse: it would have to *reproduce* formatting the
patch approach never disturbs, and every node type would become a new way to corrupt
a file.

**Consequence for the brief's lossless checklist** — comments, whitespace, field
order, numeric spelling, unknown/vendor nodes, unrecognised fields, `DEF`/`USE`
identity, `PROTO` scopes, `IS` mappings, `ROUTE` statements, source ranges, and user
formatting outside the edited region are all preserved **by construction**, not by
feature work. WD1's job is to make *edits* safe, not to make *preservation* work.

---

## 1. Present limitations (verified, with locations)

| # | Limitation | Evidence | Severity |
|---|---|---|---|
| L1 | No serializer / writer of any kind | grep for `serialize\|stringify\|unparse\|emit\|toSource` across `src/`, `main.js`, `renderer/` returns only unrelated hits | blocks all GUI editing |
| L2 | Document model is plain text | `src/editor/wrl-document.js` — `{sourcePath, format, baseline, text, stat}`. No tree, no identity | blocks selection stability |
| L3 | No stable node identity | nothing anywhere assigns or persists a node ID | blocks GUI selection across edits |
| L4 | Semantic scope is flat and non-authoritative | `src/vrml/analyze.js:9` — "a single flat document scope"; PROTO DEF leakage, cross-PROTO false duplicates, USE-before-DEF unchecked, context-insensitive `IS` | blocks trustworthy DEF/USE/ROUTE |
| L5 | No node/field schema | no `SFVec3f`-style table in repo; only `src/preview/bbox-traversal.js` hardcodes a few node names for fit math | blocks typed inspector |
| L6 | Full reparse per keystroke-batch | `src/editor/language.js:161` `analyze()` re-parses whole text | perf risk only — **measure before acting** |
| L7 | `validator.js` is regex-based, not parser-based | `validator.js:46,62,71,86` all `RegExp` over raw text | pre-existing; **out of WD1 scope** |
| L8 | Undo is text-level only | `src/editor/browser/editor-view.js:199` `history()` — CodeMirror 6 | see §4, this is an asset not a defect |

---

## 2. Proposed canonical document model

### 2.1 Text remains the single source of truth

```
        ┌──────────────── canonical ────────────────┐
        │   doc.text  (the exact bytes on the way    │
        │              to/from disk)                 │
        └───────────────────┬───────────────────────┘
                            │ parse()  (pure, derived, disposable)
                            ▼
        tokens ── tree(range on every node) ── scope index ── schema view
                            │
                            │ every GUI action emits
                            ▼
                {from, to, insert}   ← text patch, span-anchored
                            │
                            ▼
                 applied as a CodeMirror transaction
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
  code editor         undo history        preview overlay
  (updates free)      (unified free)      (fires free, 7C path)
```

**Rejected alternative:** a tree-as-truth model with the text projected from it. That
requires a serializer (L1), makes every node type a corruption vector, and would
rewrite regions the user did not touch. It is the White Dune model, and it is exactly
what the brief says not to do.

### 2.2 Why "one document" falls out for free

The brief requires that GUI and code editor never drift. With text-as-truth and
patches applied as CodeMirror transactions, they *cannot* drift — there is only one
buffer. Three properties come at no additional cost:

1. **GUI edit → code editor updates.** It *is* a CodeMirror transaction.
2. **GUI edit → undo/redo works, unified with typing.** CodeMirror's `history()`
   already tracks it. A gizmo drag and a hand-typed character land in the same undo
   stack, in the order the user performed them.
3. **GUI edit → preview updates.** `renderer/editor.js` already debounces buffer
   changes into `editor:previewLoad`; the Phase 7C overlay
   (`src/preview/buffer-overlay.js`) substitutes the unsaved bytes with no temp file.
   A GUI edit is just another buffer change.

> **No new sync mechanism, no new IPC channel, and no CSP/security change is required
> for WD1.** This is the single biggest reason to prefer this design.

### 2.3 Security posture is unchanged

`main` owns every path; the renderer sends `{sessionId, text}` and never a path
(`preload.js:53-55`, `src/editor/path-authorizer.js`). GUI edits are renderer-side
text edits, saved through the existing authorized `editor:save`. **WD1 must not add a
path-bearing channel.** If a WD1 design ever needs one, that is a stop condition (§12).

---

## 3. New modules

All pure (no `fs`, no Electron), unit-testable in Node, matching the existing
`src/vrml/` and `src/preview/` house style.

| Module | Responsibility |
|---|---|
| `src/vrml/source-map.js` | Offset ⇄ token ⇄ AST-node lookup. `nodeAt(offset)`, `tokenAt(offset)`, `pathTo(node)`. Read-only index built from one `parse()`. |
| `src/vrml/node-path.js` | **Stable identity.** A structural path from document root (e.g. `stmt[2].field("children").item[4]`) that survives reparse. Plus `resolve(tree, path)` and `rebase(oldPath, edits)`. |
| `src/vrml/edit.js` | **Patch algebra.** `replaceSpan`, `insertBefore`, `removeSpan`; `applyEdits(text, edits)` with overlap detection, deterministic ordering, and offset remapping. Pure string in/out. |
| `src/vrml/scope.js` | **Scope-aware DEF/USE/ROUTE/IS** replacing `analyze.js`'s flat model (L4). PROTO bodies are real scopes; USE-before-DEF is an error; `IS` resolves against the enclosing PROTO interface. |
| `src/vrml/node-schema.js` | Generated node/field metadata: name, VRML type, access type, default, VRML97-vs-X3D flag. **Generated, not hand-written** — see §3.1. |
| `src/editor/document-transaction.js` | Binds a semantic intent (`setFieldValue(nodeId, field, value)`) to a validated patch set, then to one CodeMirror transaction. Owns validate-before-commit. |

### 3.1 `node-schema.js` is generated from two license-clean sources

Do **not** hand-author this, and do **not** consult White Dune (see
`GPL_PROVENANCE_BOUNDARY.md`).

- **Runtime shape** — `node_modules/x_ite/dist/x_ite.d.ts` (**MIT**, already a root
  dependency). All **54/54** VRML97 nodes appear as `<Node>Proxy` interfaces;
  **472 fields** were machine-extracted in WD0 with name, VRML type, and access type.
- **Normative VRML97 truth** — the local ISO mirror
  `/home/ryan/Projects/cybertown/wb-ct-scrape/specs/iso-14772-vrml97`. Clause 6 yields
  **314 normative declarations across 54/54 nodes**.

The difference is the **strict-VRML97 filter**: x_ite.d.ts carries **206 X3D-only
fields** across those same 54 nodes. Concretely — `Material` +17
(`diffuseTexture`, `normalScale`, …), `Shape` +7 (`bboxDisplay`, `castShadow`, …),
`IndexedFaceSet` +4, `TimeSensor` +4, `Transform` +3 (`bboxDisplay`, `metadata`,
`visible`).

> Every field carries a `profiles: ['vrml97'] | ['x3d'] | both` tag. **A field tagged
> x3d-only is unwritable while the document is in VRML97 mode.** This is the brief's
> "no silent X3D leak" requirement, enforced at the only place that writes.

Ship the generator (`scripts/build-node-schema.js`) **and** its committed output, the
way `renderer/vendor/wrl-editor.bundle.js` is regenerated but unlike it the output
*is* committed — it is small, reviewable, and must not require a build step at runtime.

**Caveat to verify during WD1.1:** the ISO markdown layer is lossy in at least one
place — `Shape`'s declaration renders as `**Shape {**` outside its code fence, which
defeats a naive extractor. The generator must handle both forms (WD0's corrected
extractor does) and **assert 54/54 nodes and ≥314 declarations**, failing the build
otherwise. Prefer `raw/part1/nodesRef.html` if markdown proves unreliable elsewhere.

---

## 4. Transactions, undo, and validation

### 4.1 Model

A GUI action produces an **intent**, not text:

```
setFieldValue(nodeId="stmt[2].field(children).item[4]", field="translation",
              value=[1.5, 0, -3])
```

`document-transaction.js` then:

1. **Resolves** `nodeId` against the current tree (`node-path.resolve`).
   Fails closed if it no longer resolves.
2. **Type-checks** against `node-schema` — correct arity, correct field type, allowed
   in the active profile (VRML97 vs X3D vs Mall vs World).
3. **Renders the value only** — `"1.5 0 -3"` — never the enclosing node.
4. **Computes one patch** replacing the field value's exact span.
5. **Validates** by parsing the *resulting* text; if new syntax errors appear that
   were not there before, **abort and commit nothing**.
6. **Dispatches** one CodeMirror transaction, annotated so history groups it.

Steps 5–6 give "validation before commit" and "atomic transaction" together: nothing
reaches the buffer until the post-state is known good.

### 4.2 Grouped edits

A gizmo drag produces many intents. Use CodeMirror's `addToHistory` /
transaction-annotation grouping so a whole drag undoes as one step, while a
click-to-set-value stays its own step. This is a CodeMirror configuration concern, not
a new undo engine — **do not write one** (L8 is an asset).

### 4.3 Recovery from temporarily invalid source

Already solved and reusable:

- The parser is recovery-oriented — one bad field yields one diagnostic and a still-usable
  partial tree (`src/vrml/parser.js:9-13`, `syncInBody`).
- The preview keeps the last valid scene (`src/preview/preview-state.js`), with status
  copy already written (`src/editor/ui-state.js` `previewStatusModel`).

**Rule:** while the document has syntax errors, the scene tree shows the last good tree
marked stale, and **GUI edits are disabled** — an intent cannot be safely anchored in a
tree that does not match the text. Typing always remains enabled.

### 4.4 External file changes

Reuse `src/editor/file-io.js` `detectExternalChange` (size + mtime + SHA-1, hash is the
tiebreaker) and `safeSave`'s `EEXTERNAL` refusal. On external change: invalidate node
identities, reparse, re-anchor selection by path, and tell the user. **Do not weaken
`safeSave`'s temp→fsync→verify→backup→rename sequence.**

---

## 5. Stable identity — the one genuinely hard problem

Everything else in WD1 is mechanical. This is not.

**Approach: structural paths, re-anchored per parse.** A node's identity is its
position in the tree, not a synthetic ID. Advantages: no state to persist, survives
reload and external change, and is meaningful in diagnostics.

The problem: a text edit above a node shifts its offsets and may change its path.
Mitigations, in order of preference:

1. **Prefer `DEF` names when present** — `DEF Foo Transform` is stable across nearly
   any edit and is what a user thinks of as the node's name.
2. **Re-anchor after every reparse** by resolving the previous path; if it fails, fall
   back to nearest-enclosing-node at the previous offset, remapped through the applied
   edits.
3. **Accept selection loss as a legal outcome.** If re-anchoring fails, clear the
   selection and say so. A wrong anchor silently editing the wrong node is far worse.

> **This is the part that must be prototyped before commitment (§10).** Build it
> against the real Cybertown corpus, not synthetic fixtures — hyphenated DEF names,
> `PROTO`-in-MFNode-array, and 70-texture worlds are the adversarial cases, and they
> are exactly what `src/vrml` was corpus-hardened against in 7A1.

---

## 6. Scope-aware DEF/USE/PROTO/IS (L4)

`analyze.js`'s flat model produces false positives that `CLAUDE.md` already forbids
surfacing as authoritative. WD1 needs real scoping because **an editor that renames or
moves nodes must know which `USE` actually binds to which `DEF`.**

Required semantics, from ISO/IEC 14772-1:

- **§4.6.2** — `DEF` names are scoped to the file; a `PROTO` body is a separate scope.
- **§4.8** — a `PROTO`'s body cannot see the enclosing file's `DEF`s, and vice versa.
- **§4.8.3** — `IS` binds a body field to the enclosing `PROTO`'s interface only.
- **USE before DEF** is invalid; resolution is lexical, not whole-file existence.
- `EXTERNPROTO` interfaces are declarations without bodies.

**Owner decision (2026-08-06): `VRML040`–`VRML044` stay ADVISORY in WD1.5.** Build the
scope model and use it internally — an editor that renames or moves nodes needs correct
binding regardless — but do **not** promote these diagnostics to authoritative. That
promotion requires a separate review, gated on running the new scope model against the
real Cybertown corpus and comparing diagnostic counts against the 7A1 baseline.

Deliverable for that review: a corpus diff report (added/removed diagnostics per file),
not just a total. A large swing in either direction means the scope model is wrong.

---

## 7. Testing strategy

| Layer | Test |
|---|---|
| **Round-trip contract** | Promote WD0's ad-hoc check into `test/vrml/round-trip.test.js`: for every fixture, token-stream reconstruction is byte-identical. **This is WD1's guard rail** — it must run in CI and must never regress. |
| **Patch algebra** | Property tests: random non-overlapping edits applied in any order give the same result; overlapping edits are rejected, not silently merged. |
| **Lossless edit** | For each fixture: change one field, assert (a) the field changed, (b) **every other byte is identical**, (c) comments/blank lines/CRLF intact, (d) diagnostics count did not increase. |
| **Identity** | Apply N random edits; assert every previously-resolved node either re-anchors to the same node or reports failure — **never to a different node**. |
| **Schema** | Assert 54/54 nodes, ≥314 ISO declarations, and that every x3d-only field is tagged. Fail the build on drift. |
| **Profile** | Assert an x3d-only field cannot be written in VRML97 mode. |
| **Scope** | Fixtures for PROTO shadowing, cross-PROTO same-name `DEF` (currently a false duplicate), USE-before-DEF, and `IS` inside a nested PROTO. |
| **Byte contract** | `.gitattributes` already pins `-text` on `test/fixtures/**`. New fixtures with CRLF or gzip twins must not break it — `test/preview/fixture-byte-contract.test.js` already guards this. |

Baseline to preserve: **584 tests, 584 pass, 0 fail** (`node scripts/run-tests.js`,
2026-08-06).

---

## 8. What extends safely vs. what needs replacing

**Extend safely (additive, no behaviour change):**
`src/vrml/tokenizer.js` (already lossless — do not touch), `src/vrml/ast.js` (spans
already present), `src/vrml/parser.js` (recovery already correct),
`src/editor/file-io.js`, `src/preview/*` (7C overlay, state machine, scheduler,
viewpoint preservation), `src/editor/ui-state.js`.

**Needs replacement:**
`src/vrml/analyze.js` — flat scope is wrong, not incomplete (L4). Replace with
`scope.js`; keep `analyze.js` exporting the old shape until callers migrate.

**Needs prototyping before commitment:**
Stable identity (§5), and whether incremental reparse is needed at all (L6) —
**measure on the largest real world first**; a 700 ms debounce already exists.

**Explicitly out of WD1 scope:**
`validator.js` (L7 — regex-based, works, leave it), World scanning, packaging, preview
resolution, X3D XML/`.x3dv` support, any renderer work, any new dependency.

---

## 9. Slices (reviewable PRs)

Each is independently reviewable, independently revertable, and leaves `main` green.

| Slice | Content | Risk | User-visible |
|---|---|---|---|
| **WD1.1** | Round-trip contract test + `source-map.js`. Pure, additive, zero callers. | very low | no |
| **WD1.2** | `edit.js` patch algebra + property tests. Zero callers. | very low | no |
| **WD1.3** | `scripts/build-node-schema.js` + committed `node-schema.js` + assertions. Data only. | low | no |
| **WD1.4** | `node-path.js` identity + re-anchoring, **prototype first** (§10). | **high** | no |
| **WD1.5** | `scope.js` + migrate `analyze.js` callers. **VRML040–044 stay ADVISORY** (owner decision); produce the corpus diff report for a later, separate promotion review. | medium | no |
| **WD1.6** | `document-transaction.js` + wire **one** field family end-to-end behind a flag. | medium | yes |

WD1.1–WD1.3 are near-zero-risk and can land quickly. **WD1.4 is the gate.**

Per the approved sequence, **WD2 (read-only scene tree + selection sync) lands after the
read-side slices (WD1.1, WD1.4, WD1.5) and before the write-side ones (WD1.2, WD1.3,
WD1.6).** WD1.2 and WD1.3 are pure and have no callers, so they may land early without
enabling any write path.

### Recommended first three PRs

1. **WD1.1** — round-trip contract test + `source-map.js`. Locks in the property the
   whole design rests on before anything can erode it.
2. **WD1.2** — patch algebra with property tests. Pure, no integration surface.
3. **WD1.3** — generated node schema. Unblocks WD3's inspector and proves the
   license-clean metadata path end to end.

All three are additive, testable in Node, and touch no existing behaviour.

---

## 10. Prototype gate before WD1.4

Do **not** commit to the identity model until a throwaway spike (in `spikes/`, not
`src/`) shows, on the real Cybertown corpus:

- re-anchor success rate after realistic edits;
- **zero** cases of anchoring to the *wrong* node (a hard requirement — a
  lower success rate is acceptable, a wrong anchor is not);
- behaviour on hyphenated DEF names, `PROTO`-in-MFNode-array, and duplicate `DEF`s.

If wrong-anchoring cannot be driven to zero, stop and escalate. **Owner-approved
fallback: identity restricted to *uniquely named* `DEF` nodes**, with GUI editing
available only for those. Note "uniquely named" is load-bearing — a duplicate `DEF` is
ambiguous and must be excluded, not resolved by first-match. `analyze.js` already tracks
`duplicateDefs`, so the exclusion set is available today.

---

## 11. Migration and compatibility

- **File format:** unchanged. Patching cannot alter bytes it does not target; gzip
  round-trip stays in `file-io.js`.
- **Existing lanes:** Mall and World are untouched. WD1 adds modules; it removes none.
- **Sessions:** `src/editor/session-store.js` persists sessions; node identity is
  derived, not persisted — nothing to migrate.
- **Diagnostics:** WD1.5 is the only user-visible change, and it makes currently-hidden
  advisories authoritative. Ship with release notes.
- **Windows:** all new modules are pure JS with no path handling — no Windows-specific
  risk. `qa/visual-qa/workspace-guard.js` still applies to any QA run.

---

## 12. Hard stop conditions

Stop and report to Ryan — do not work around any of these:

1. **The round-trip contract test fails** on any fixture. The design premise is broken;
   everything downstream is invalid.
2. **A patch changes bytes outside its target span** in any test.
3. **Identity re-anchors to the wrong node** even once (§10).
4. **WD1 appears to need a new IPC channel that carries a path**, or any CSP change.
   The security model is not WD1's to renegotiate.
5. **A new runtime dependency looks necessary.** Root runtime deps are `x_ite` only.
6. **White Dune source is opened while writing WRL Forge code** — see
   `GPL_PROVENANCE_BOUNDARY.md`.
7. **`validator.js`, World scanning, packaging, or preview resolution** would need to
   route through the parser. That needs its own approved lane.
8. **Test count drops below 584** or any test fails.
9. **Scope work (WD1.5) changes diagnostics on the Cybertown corpus more than expected**
   — 7A1 achieved a 98.1% diagnostic reduction; a regression there means the scope
   model is wrong. Report the corpus diff; do **not** promote VRML040–044 to
   authoritative in this lane (owner decision).

---

## 13. Files likely involved

**New:** `src/vrml/source-map.js`, `node-path.js`, `edit.js`, `scope.js`,
`node-schema.js`; `src/editor/document-transaction.js`;
`scripts/build-node-schema.js`; `test/vrml/round-trip.test.js`, `edit.test.js`,
`node-path.test.js`, `scope.test.js`, `node-schema.test.js`;
`test/editor/document-transaction.test.js`.

**Modified:** `src/vrml/index.js` (export new modules), `src/editor/language.js`
(consume `scope.js`), `renderer/editor.js` + `src/editor/browser/editor-view.js`
(dispatch GUI transactions — WD1.6 only),
`test/editor/script-load-order.test.js` (if any editor-page script is added).

**Must NOT be modified:** `src/vrml/tokenizer.js`, `validator.js`,
`src/world-project/*`, `src/preview/buffer-overlay.js`, `package.json` dependencies.
