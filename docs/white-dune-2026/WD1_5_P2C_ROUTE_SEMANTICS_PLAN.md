# WD1.5-P2C — ROUTE endpoint resolution and event direction/type compatibility

> **Historical record.** Written before WRL Forge moved to `GPL-3.0-or-later`.
> Its clean-room rules and its references to the deleted
> `GPL_PROVENANCE_BOUNDARY.md` are **superseded** by `/OPEN_SOURCE_PROVENANCE.md`
> and `/WD.md` §1. Its provenance statements about what was consulted at the time
> remain accurate. See `README.md` in this directory.

Status: **AS BUILT. Implemented, validated, UNCOMMITTED — awaiting owner
adjudication and independently routed QA.**

This document was authored as a plan and has been rewritten to record what was
actually built. Where the implementation deviates from the plan, §26 says so.

Predecessors, all committed and green:

| lane | what it owns | commit |
|---|---|---|
| WD1.5-P1 | DEF/USE scope graph — the **node-name** namespace | `66783c1` |
| WD1.5-P2A | PROTO/EXTERNPROTO type-name resolution — the **node-type** namespace | `5176d28` |
| WD1.5-P2B | interface members + `IS` — the **interface-member** namespace | `51ff283` |

Baseline this lane was built on: `main` @
`51ff2839fdbd50d2db4f7949e56e1110cbc72b33`, `npm run check` = **1048 pass / 0
fail / 0 skip**. After P2C: **1102 pass / 0 fail / 0 skip**.

P2C is the fourth and final semantic-resolution lane of WD1.5. It resolves the
two endpoints of a `ROUTE` and judges whether the connection is legal. It does
**not** deliver events, wire diagnostics, or touch any consumer.

---

## 1. Scope and non-goals

### Delivered

For each `ROUTE sourceNode.sourceEvent TO destNode.destEvent`, **six
independently observable answers**:

1. which DEF declaration `sourceNode` names;
2. which DEF declaration `destNode` names;
3. the source endpoint (effective access kind + field-type token) on that node;
4. the destination endpoint, likewise;
5. the **direction** verdict for each side;
6. the **type-compatibility** verdict for the pair.

Plus: a recovery proof gate, a stable internal result vocabulary, resolved-only
reverse indexes (`routesFrom` / `routesTo`), and corpus + adversarial validation.

### Explicit non-goals, all honoured

- **No runtime event delivery**, event cascade, fan-in/fan-out, loop detection
  (4.10.3–4.10.5) or timestamp model. P2C is lexical/static only.
- **No diagnostics emission and no consumer wiring.** `analyze.js`'s
  `VRML042`/`VRML043`/`VRML044` are byte-identical; P2C does not replace, feed
  or silence them. That is **P4**'s decision (§22).
- **No `Script` execution**, no `EXTERNPROTO` URL loading, no networking, no I/O
  of any kind. `interfaceEndpoint`'s existing no-I/O contract is inherited whole
  and pinned by a source scan (test 50).
- **No public façade** (`src/vrml/index.js` untouched), no renderer, no editor,
  no scene tree, no inspector.
- **No node-identity change**, no rename/refactor tooling.
- **No `closest preceding` duplicate-DEF resolution** — see §12.
- **No fix to the deferred `codeOnly()` regex-literal blind spot.** Out of scope
  per the lane brief; recorded here only so it is not rediscovered as new.

---

## 2. Standards citations and confidence grades

Sources: the local ISO/IEC 14772-1 mirror at
`~/Projects/cybertown/wb-ct-scrape/specs/iso-14772-vrml97` (clause text and
Annex A grammar) and the committed WD1.3 schema. **No White Dune material and no
other editor's implementation material was consulted** — see
`GPL_PROVENANCE_BOUNDARY.md`.

Grades: **normative-explicit** = the clause states the rule outright ·
**normative-derived** = follows from a normative statement plus the grammar ·
**interpretation** = the standard is silent or ambiguous and the lane must fail
closed.

| # | Rule | Clause | Grade |
|---|---|---|---|
| R1 | A ROUTE statement is `ROUTE <name>.<field/eventName> TO <name>.<field/eventName>`. Whitespace around the periods is optional. | 4.3.9 | normative-explicit |
| R2 | `routeStatement ::= ROUTE nodeNameId . eventOutId TO nodeNameId . eventInId` | Annex A.2 | normative-explicit |
| R3 | `nodeBodyElement` admits `routeStatement`, so a ROUTE may appear **inside a node body** wherever fields may appear. | Annex A.3, 4.10.2 | normative-explicit |
| R4 | ROUTE statements may appear at the top level of a file, **in a prototype definition**, or inside a node wherever fields may appear. | 4.10.2 | normative-explicit |
| R5 | **Nodes referenced in a ROUTE statement shall be defined before the ROUTE statement.** | 4.10.2 | normative-explicit |
| R6 | **A node given a name using DEF may be referenced by name later in the same file with USE *or ROUTE* statements.** ROUTE node names are the *same* namespace, under the *same* scoping rule, as USE. | 4.6.2 | normative-explicit |
| R7 | Node names are limited in scope to a single VRML file **or prototype definition**. | 4.6.2 | normative-explicit |
| R8 | A PROTO establishes a DEF/USE name scope separate from the rest of the scene and from nested PROTOs, **in both directions**. | 4.8.4 | normative-explicit |
| R9 | If multiple nodes share a name, each **USE** refers to the closest preceding one. The clause says *USE*; it does not restate the rule for ROUTE. | 4.6.2 | normative-explicit for USE; **interpretation** for ROUTE → §12 |
| R10 | **Routes may be established only from eventOuts to eventIns.** | 4.10.2 | normative-explicit |
| R11 | **The types of the eventIn and the eventOut shall match exactly.** Explicitly illegal: SFFloat→SFInt32, **SFFloat→MFFloat**. | 4.10.2 | normative-explicit |
| R12 | When routing to or from an eventIn/eventOut **(or the eventIn or eventOut part of an exposedField)**, the `set_` or `_changed` part of the name is **optional**. If a ROUTE to an eventIn named *zzz* finds no eventIn of that name, the browser **shall then try** `set_zzz`; from an eventOut named *zzz*, then `zzz_changed`. | 4.10.2 | normative-explicit |
| R13 | An exposedField named *zzz* can be referred to as `set_zzz` and treated as an eventIn, and as `zzz_changed` and treated as an eventOut. | 4.7 | normative-explicit |
| R14 | Declaring `exposedField zzz` in a PROTO interface is equivalent to declaring `field zzz` + `eventIn set_zzz` + `eventOut zzz_changed`. | 4.8.2 | normative-explicit |
| R15 | EXTERNPROTO semantics are exactly a PROTO's bar local defaults; its declared names/types are authoritative locally. | 4.9.2, 4.3.7 | normative-explicit |
| R16 | An EXTERNPROTO interface's names and types **shall be a subset** of the implementation's — so local **absence** is unknowable, not false. | 4.9.2 | normative-explicit |
| R17 | Events can be routed to eventIns of Script nodes and eventOuts of Script nodes can be routed to eventIns of other nodes. | 4.12.1 | normative-explicit |
| R18 | Redundant routing is ignored — a repeated identical routing path is ignored from the second occurrence on. | 4.10.2 | normative-explicit (see §14, *not* a P2C status) |
| R19 | Whether R12's fallback fires when the written name **is** found but is **not an event** (e.g. it names a `field`). | 4.10.2 | **RESOLVED BY OWNER ADJUDICATION** → §11.3 |
| R20 | Whether R8's PROTO disjointness governs ROUTE node names is not restated in 4.8.4 — but R6 places ROUTE in the same namespace as USE and R7 scopes that namespace to the prototype definition. | 4.6.2 + 4.8.4 | normative-derived (corpus-validated, §17) |

**R6 is the decisive citation for this whole lane.** It names ROUTE alongside
USE, in the DEF/USE clause, which is what licenses P2C to reuse P1 wholesale
rather than build a second node-name lookup. R10+R11+R12 are the decisive
citations for the compatibility model, and **R12 is the one that makes ROUTE
differ from `IS`** — see §11.

---

## 3. Parser/AST — **no parser change was required, and none was made**

`parser.js:333-360` builds, and `ast.js` declares (`NODE.ROUTE = 'Route'`):

```js
{ type: 'Route',
  from: { node, nodeRange, event, eventRange, range },
  to:   { node, nodeRange, event, eventRange, range },
  range }
```

Every token P2C needs is retained, and both sides are separately addressable
with their **own** spans. Four facts follow, all confirmed during
implementation:

1. **Every token and range P2C needs is present.** Node name, event name and
   both spans, per side.
2. **The two sides are exactly distinguishable**, and a damaged node name is
   distinguishable from a damaged event name on the *same* side (`A`/`null`).
3. **Recovery is fail-closed by construction**: a side the parser could not read
   degrades to `null`, never to a *wrong* name. P2C therefore never has to
   defend against a plausible-but-invented endpoint spelling — only against a
   *moved scope boundary*, which is what the §13 gate is for.
4. **ROUTE-in-node-body parses cleanly** (R3), and `scope-graph.js` already
   dispatched on `type` so a body ROUTE lands in `node.fields` without being
   mistaken for a field.

> **Confirmed as built: no tokenizer change, no parser change, no AST change.**
> `git diff` shows zero lines in `parser.js`, `tokenizer.js`, `ast.js`,
> `node-schema.js`, `analyze.js`, `diagnostics.js` and `index.js`.

---

## 4. P1 integration — ROUTE node names reuse the DEF namespace unchanged

R6 puts ROUTE node names in the **node-name** namespace P1 already owns, so P2C
builds **no second DEF table** and performs **no** proximity, structural-path,
sibling-index, first-textual-match or fuzzy lookup (WD.md §7).

What P1 supplies, and what P2C uses from each:

| P1 facility | P2C use |
|---|---|
| DEF symbols with `scope`, `visibleFrom`, `node`, `nodeType` | the binding, and the AST node the endpoint is acquired on |
| `lookupDef(state, scope, name, beforeOffset)` | R5's *defined before the ROUTE* rule, unchanged |
| `defParent` = `null` on a proto body | R8 disjointness, structurally rather than by a check |
| `guardLexical` | the second defence on a positive binding (§13) |
| `lookupDefAnyPosition` | telling R5's "declared later" from "never declared" |
| `declaredOutsideChain` | the cross-PROTO-boundary answer |

**R5 needed no new machinery.** P1's `beforeOffset` parameter and the DEF
symbol's `visibleFrom` already express "declared before this reference". P2C
passes the **ROUTE statement's own start offset**, and both endpoints of one
ROUTE share it — 4.10.2 scopes the rule to the *statement*, not to either name
token (pinned by test 46b).

### Verified by test (`route-semantics.test.js` 6, 7)

| case | expected | observed |
|---|---|---|
| ROUTE outside a PROTO naming a PROTO-body DEF | unresolved | **unresolved**, `def-not-visible-across-proto-boundary` |
| ROUTE inside a PROTO naming an outer DEF | unresolved | **unresolved**, same reason |
| ROUTE inside a PROTO naming its own body DEF | resolved | **resolved** |
| same DEF spelling inside and outside; ROUTE inside | binds the **inner** one | **binds the inner one** (`TouchSensor`, not the outer `TimeSensor`) |

P1's scope model gives ROUTE R8 disjointness in **both** directions for free. No
ROUTE-specific visibility exception exists in the standard, and none was built.

---

## 5. P2A integration

Endpoint acquisition needs the **resolved type** of the DEF'd node, which is
exactly P2A's answer. P2C creates no second type resolver and re-runs no type
lookup: it reads the existing resolution through
`state.typeReferenceByAstNode` → `state.resolutionByReference`, the same two-hop
`acquireEndpoint` already performed.

Every non-`resolved` P2A outcome is a **withheld endpoint**, never a guessed
one, reported as `route-endpoint-node-type-unresolved` (test 32) — and the DEF
binding survives it.

---

## 6. P2C-0 — the endpoint extraction, as built

P2B's `acquireEndpoint(state, reference)` already implemented the whole
endpoint-acquisition problem for all four origins: `builtin-schema`,
`proto-interface`, `externproto-interface`, `script-interface`, including 4.7
alias expansion, the X3D-only-field exclusion (232 fields), the
Script-declarations-before-clause-6 precedence, and the EXTERNPROTO
positive/absence split.

**It was consumed unchanged. It was not forked, copied or re-derived.**

The obstacle was purely a signature one: `acquireEndpoint` took an **`IS`
reference projection**. The shape built is the one the plan recommended:

```js
// NEW module-private helper -- the whole existing body below the Script branch.
function acquireEndpointOn(state, targetNode, name, nameRange) { … }

// UNCHANGED public behaviour: the Script-IS branch, then delegate.
function acquireEndpoint(state, reference) {
  if (reference.endpointName == null) …
  if (reference.form === sym.IS_FORM.SCRIPT_INTERFACE) { … }   // IS-only, stays
  return acquireEndpointOn(state, reference.hostNode,
                           reference.endpointName, reference.endpointRange);
}
```

`acquireEndpointOn` is **module-private**: not exported from `scope-graph.js`,
not re-exported from `symbols.js`, not in the façade. Pinned by test
(`interface-is.test.js` boundary test asserts all three).

### The one behavioural assumption — PROVEN, not assumed (test 43)

`acquireEndpoint` read the Script own-interface scope from
`reference.hostInterfaceScope`; the generalized helper derives it from
`state.interfaceScopeByAstNode.get(targetNode)`. **Test 43 pins the equivalence
by object identity** over five fixtures covering every shape an `IS` host takes:
a Script with declarations, a Script without, a non-Script node, a Script nested
in a PROTO body, and a Script whose interface is damaged. All host references
satisfied `r.hostInterfaceScope === interfaceScopeFor(graph, r.hostNode)`.

The structural reason it holds: `hostInterfaceScope` is the `scriptIface` minted
in `visitNode` with `ownerNode = node`, and `interfaceScopeByAstNode` is keyed
by exactly that `ownerNode`. A `Proto`/`ExternProto` is a different AST node
type, so the two can never collide on one key.

### Behaviour preservation, verified before P2C proceeded

`interface-is.test.js` passed **51/51 unedited** and `npm run check` returned
**1048/1048** immediately after the extraction and before any ROUTE code
existed. That gate was run and passed as its own step.

### Rejected alternatives, unchanged from the plan

- **Copy the logic into a P2C function** — a second endpoint authority.
- **Export `acquireEndpoint` from the façade** — premature public surface.
- **Synthesize a fake `IS` reference per ROUTE endpoint** — manufactures a
  projection that claims to be something it is not.

---

## 7. The ROUTE projection and reference model, as built

A ROUTE contributes **four** references, in two pairs, deliberately kept
separate so a lost node never masquerades as a missing event:

| reference | kind | namespace | resolves via |
|---|---|---|---|
| source + destination node | `route-node` | `node-name` | P1 DEF lookup (§4) |
| source + destination event | `route-event` | **`null`** | endpoint acquisition on the resolved node (§6) |

`namespace: null` on a `route-event` is part of its **shape predicate**, not an
omission: an event name is answered by a node's public interface, never looked
up in a lexical scope, and a projection claiming otherwise is not a route-event.

A `route-event` carries its paired `nodeReference`, so the two questions stay
separately answerable without a consumer re-deriving the link.

### Independence is enforced, not merely intended

A `route-event` whose `route-node` did not resolve is **not evaluated at all**:
it propagates the node's own status and reason verbatim, and
`route-endpoint-unknown-field` is structurally unreachable from that path.
**Test 47 asserts this as a prohibition** over three shapes (unresolved,
ambiguous, declared-later).

### Ownership is fixed on descent, never searched

`visitStatement`'s `NODE.ROUTE` case (previously a bare `return`) and
`visitValue`'s now call `b.addRoute(stmt, ctx.scope)` — the scope comes from the
walk's own context. **Test 38 scans `addRoute`'s body and fails if `contains(`
appears in it**, so the recon harness's innermost-containment approximation
cannot reach production.

A `Set` guard in the builder makes a ROUTE reachable by both dispatch paths
count once. It is a counting safeguard only; no binding depends on it.

---

## 8–9. Source and destination node resolution

Both sides run the identical procedure, independently, each with its own
reference, status and reason:

```
1. graph ownership / projection validity                (assertMember)
2. is there a node name at all?                         -> invalid / missing-name
3. THE GATE (§13)                                       -> recovered, full stop
4. P1 lookup in the ROUTE's own DEF scope, beforeOffset = ROUTE STATEMENT start
5. >1 candidates     -> ambiguous     (decided on the NAME ALONE)
   exactly 1         -> resolved      (then guardLexical)
   0, declared later -> unresolved / route-node-not-defined-before-route
   0, declared behind a PROTO boundary -> unresolved / def-not-visible-across-proto-boundary
   0                 -> unresolved / def-not-declared-in-scope
```

Step 5's ordering is P1/P2A/P2B's, unchanged: **ambiguity is decided before any
type or access filtering.** Test 4 makes this load-bearing — its two same-named
DEFs are a `TimeSensor` and a `TouchSensor`, and only one has the named
`fraction_changed` eventOut, so a resolver that narrowed duplicates by "which
one has the event" would confidently bind the wrong one. It answers `ambiguous`.

There is **no normative asymmetry between the two sides at the node level** —
R5, R6, R7 and R8 all speak of "nodes referenced in a ROUTE statement", both of
them. The asymmetry is entirely at the **event** level (§11).

---

## 10. Endpoint acquisition

Delegated to `acquireEndpointOn` (§6) with the DEF-resolved target node. All
four origins, the X3D-only exclusion (test 19) and the EXTERNPROTO split (tests
23, 23b) come along unchanged.

The **only** P2C-specific addition is R12's shorthand, which **wraps** the call
rather than living inside it (`acquireRouteEndpoint`). Pushing it down into
`acquireEndpointOn` would silently change `IS` semantics, which have no such
shorthand.

One small translation layer exists: the shared helper reports its two lexical
outcomes under `IS`-named reasons (P2B needed them first), and
`routeEndpointLookup` remaps them to `route-endpoint-node-type-unresolved` /
`route-endpoint-unknown-field`. One endpoint authority, two vocabularies — a
consumer switching on a ROUTE result never has to know P2B exists.

---

## 11. exposedField and the two alias mechanisms

### 11.1 The conclusion, confirmed as built

> **exposedField base names ARE legal ROUTE endpoint spellings** — R12,
> normative-explicit. So are the explicit `set_`/`_changed` event names.
> Both spellings are legal on both sides.

This is **not** derived from `IS`. P2B's rule comes from 4.8.3 about `IS`; R12
says this about ROUTE. Two separate explicit clauses, reached independently.
`directionCapable()` treats an `exposedField` as satisfying either side, which
is the ROUTE-only allowance — and there is **no 4×4 matrix for ROUTE**. Table
4.4 is not imported, and the source contains no second matrix.

### 11.2 Two mechanisms, composing, in a fixed order

| | **4.7 / 4.8.2 alias expansion** (P2B, reused) | **4.10.2 ROUTE shorthand** (P2C-only) |
|---|---|---|
| direction | a *declaration* `exposedField zzz` also **occupies** `set_zzz` and `zzz_changed` | a *written* bare `zzz` **falls back to** `set_zzz` / `zzz_changed` |
| lives in | `effectiveEntriesOf` / `builtinEndpoint` | `acquireRouteEndpoint`, a ROUTE-only wrapper |
| applies to | `IS` and ROUTE alike | **ROUTE only** |
| reported as | detail `route-endpoint-via-implicit-alias` | detail `route-endpoint-via-shorthand` |

They are distinguishable in the result, which is the point (test 13 vs test 44).

**Order is normative and is preserved:** the written name is tried **first**,
the alias only after. Candidate order is `[written, written + "_changed"]` for a
source and `[written, "set_" + written]` for a destination — never both
directions, never the reverse. **Test 45 makes it load-bearing**: its fixture
declares both `eventOut SFFloat zzz` and `eventOut SFBool zzz_changed`, with
deliberately different types, so an alias-first or set-based lookup binds the
wrong declaration visibly.

### 11.3 R19 — **RESOLVED BY OWNER ADJUDICATION**

> **R19 resolved by owner adjudication: direction-specific exact event lookup
> occurs first; if the required event direction is not found under the written
> spelling, §4.10.2 fallback applies even when another access kind such as a
> field has that spelling.**

4.10.2's condition is that an eventIn/eventOut **of that name** is not found —
the lookup is for an event of a given *direction*, not for a name of any kind.
So a written `zzz` that exists only as a `field` has not found the required
event, and `set_zzz`/`zzz_changed` is tried. Stopping at the field because the
spelling matched reads a condition the clause does not state.

Implemented in `acquireRouteEndpoint`. Three tests make the choice visible
rather than incidental:

- **44** — `field SFFloat zzz` alongside `eventIn SFFloat set_zzz` and
  `eventOut SFFloat zzz_changed`; a ROUTE writing `.zzz` on both ends resolves
  through the fallback, and the test *also* asserts the rejected reading's
  outcome (a direction error) did **not** occur.
- **44b** — the boundary: with `zzz` declared only as a field and no fallback
  event anywhere, the honest answer is the direction failure. Not a binding of
  the field as an event, and not `unknown-field` — the name *was* found.
- **44c** — the safety edge: an EXTERNPROTO miss does **not** license the
  fallback (below).

#### The fallback's precondition is the safety property

The fallback fires only when the required event is **provably** not there: the
interface is fully known and either genuinely lacks the name, or holds it under
a non-event access. An `unsupported` EXTERNPROTO miss, an `ambiguous` interface
or a `recovered` scope prove nothing about absence, so the fallback does not
fire and the honest non-answer is returned instead.

This was not in the plan and is the lane's one substantive design addition. The
reason it matters: falling back past an EXTERNPROTO miss could bind `set_zzz` in
an implementation that *also* declares a real `eventIn zzz` — and R12 says the
written name wins. That would be a **wrong endpoint binding**, which the hard
gate forbids outright.

---

## 12. DEF visibility, duplicates, and the deliberate strictness gap

- **Declaration before reference is REQUIRED** for ROUTE (R5), via P1's
  `beforeOffset`. Reported as `route-node-not-defined-before-route` and
  distinguishable from never-declared (test 46).
- **PROTO disjointness applies, both directions** (R7 + R8, via R6; §4).
- **`USE` is irrelevant to ROUTE node names.** A ROUTE names a *DEF*, per R6. It
  never names a `USE` occurrence, and P2C does not resolve one.

### Duplicate DEF names → `ambiguous`, not "closest preceding"

R9 defines the browser's rule (*closest preceding*) for **USE** and does not
restate it for ROUTE. Even where it plainly applies, P2C returns `ambiguous` and
**does not implement it** — inheriting P2B's deliberate strictness gap verbatim,
for the same reason:

> P2C's consumers are identity and rename, where WD.md §7's hard gate forbids
> ranking. A tool that renames "the closest preceding `N`" and is wrong has
> silently rewired someone's world.

If viewer fidelity ever needs the browser's answer it belongs in a separately
named `languageSemantics` query that never feeds identity — exactly as WD.md
§8.1 already records for `IS`.

---

## 13. The recovery proof gate, as built

Follows P2A/P2B's ratified architecture: **one upfront proof gate, before any
branch exists**, not a per-branch guard.

### Six independently gated questions

The gate is not monolithic — a provable node binding **survives** an unprovable
endpoint, exactly as P2B's G5 lets a binding survive a lost endpoint:

| # | question | withheld when |
|---|---|---|
| Q1 | source node binding | document incomplete · ROUTE's DEF scope recovered |
| Q2 | destination node binding | same, evaluated independently |
| Q3 | source endpoint | Q1 not `resolved` · P2A type not `resolved` · target's interface scope recovered |
| Q4 | destination endpoint | same, independently |
| Q5 | direction verdict (per side) | that side's endpoint not acquired |
| Q6 | type verdict (pair) | **either** endpoint not `resolved` |

### Gates, and what each actually defends

- **G1** — `state.documentIncomplete`. **Honestly redundant by construction**
  and kept anyway. `markRecovery`'s cap branch marks every scope recovered
  *and* stamps the same `document-parse-incomplete` reason, so G2 fires next and
  returns a byte-identical answer. Unlike P2B's G1 it does not even own its
  reason. Retained because the redundancy is a property of that blanket pass,
  not of the rule; **the enabling invariant is pinned by test 49**, which
  asserts the blanket marking directly and states the subsumption outright
  rather than fabricating a kill.
- **G2** — the ROUTE's own enclosing DEF scope is `recovered`. An unclosed body
  absorbs the statements after it and **moves which scope the ROUTE is in**.
  **Load-bearing and mutation-killed** (test 49): removing it makes a damaged
  scope fabricate a duplicate-DEF ambiguity the author never wrote.
  Its *unique* contribution is the negative and ambiguous claims; on a
  **positive** binding it is doubly covered by P1's `guardLexical`, which is
  asserted in the same test rather than glossed over.
- **G3** — P2A's type resolution for the target node is not `resolved`.
  Withholds Q3/Q5/Q6 or Q4/Q5/Q6 **only** (test 32). Arrives through
  `acquireEndpointOn`.
- **G4** — the target's owning interface scope is `recovered` (test 33).
  Inherited unchanged from `interfaceEndpoint`.

### What a damaged construct must never manufacture — all tested

| # | fabrication | test |
|---|---|---|
| 1 | a positive node binding | 37 |
| 2 | a confident *missing* DEF | 9 |
| 3 | a duplicate/ambiguity claim | 10, 49 |
| 4 | an endpoint absence | 33 |
| 5 | a direction verdict | 35 |
| 6 | a **compatible** ROUTE verdict | 36 (and the whole-verdict recovery path) |

Items 2, 3 and 6 are the ones that look safe to let stand because they bind
nothing. They are still **assertions**, and recovery can fabricate every one.

**Safe refusal is always acceptable. A wrong node or event binding is a hard
failure.**

---

## 14. Stable result vocabulary, as built

Additive only. No existing `STATUS`, `REASON`, `SYMBOL_KIND` or
`REFERENCE_KIND` value changed meaning. Existing reasons are reused wherever
semantically correct rather than duplicated under new names.

### `REFERENCE_KIND` — the two P2B declared absent

```
ROUTE_NODE:  'route-node'
ROUTE_EVENT: 'route-event'
```

The taxonomy is now **complete** for WD1.5; `symbols.test.js` no longer names a
not-yet-built kind and instead asserts both are genuinely constructible.

### New constant: `ROUTE_SIDE`

```
SOURCE: 'source'   DESTINATION: 'destination'
```

Added because the two sides are not symmetric at the event level and every ROUTE
query takes a side explicitly — no code path infers one from the other.

### Statuses — the existing six, unchanged

`resolved` · `unresolved` · `ambiguous` · `invalid` · `unsupported` ·
`recovered`.

### Reused reasons (no new spelling)

`ok` · `missing-name` · `def-not-declared-in-scope` ·
`duplicate-def-in-scope` · `def-not-visible-across-proto-boundary` ·
`document-parse-incomplete` · `scope-recovered` · `proto-scope-not-provable` ·
`duplicate-interface-member` · `interface-scope-not-provable` ·
`externproto-interface-not-locally-verifiable`

### New reasons (7, exactly as planned)

| reason | meaning |
|---|---|
| `route-node-not-defined-before-route` | R5 — declared in this scope, but after the ROUTE |
| `route-endpoint-node-type-unresolved` | G3 — P2A did not resolve the target's type |
| `route-endpoint-unknown-field` | the resolved interface genuinely has no such endpoint, after **both** alias mechanisms. **Never** for an EXTERNPROTO |
| `route-source-not-an-event-out` | R10 — the source endpoint can supply no eventOut |
| `route-dest-not-an-event-in` | R10 — the destination can accept no eventIn |
| `route-type-mismatch` | R11 — the two field-type tokens are not equal |
| `route-type-unknown` | a field-type token one side cannot identify. **Never a silent pass** |

### Non-binding `detail` values (2)

- `route-endpoint-via-shorthand` — bound through R12's fallback (§11.3's hook);
- `route-endpoint-via-implicit-alias` — bound through 4.7 expansion.

### Three separate results, never one collapsed verdict

- `resolveRouteNode(graph, ref)` → a resolution (Q1/Q2)
- `resolveRouteEndpoint(graph, ref)` → a resolution (Q3/Q4 **and** Q5)
- `routeVerdict(graph, astRoute)` → a frozen verdict (Q6 + the pair answer)

**Deviation from the plan, recorded:** the plan sketched a bespoke
`routeVerdict` enum (`ok | source-direction-invalid | …`). As built, the verdict
carries the house `{status, reason}` pair plus a `side` field naming which end
defeated it. That expresses every planned value without introducing a second
result vocabulary a consumer would have to learn, and keeps `switch (status)`
working uniformly across all four lanes. The direction verdict lives on the
endpoint resolution (`invalid` + a direction reason) because it is a fact about
one endpoint, not about the pair.

**R18 (redundant routing) is deliberately NOT a P2C status**, as planned.
4.10.2 says a repeated route "is ignored" — a *runtime* de-duplication rule, not
a lexical error. `analyze.js`'s existing `VRML044 Duplicate ROUTE` warning stays
where it is; P2C neither reproduces nor contradicts it. No runtime scheduling or
deduplication machinery was built.

---

## 15. Internal APIs, as built

Additive; nothing existing changed shape. All are exports of
`src/vrml/scope-graph.js` **only** — the façade is untouched.

```js
// collections (frozen, deterministic source order, fresh array per call)
routeReferences(graph)          // both kinds, grouped per ROUTE
routeNodeReferences(graph)
routeEventReferences(graph)
routeResolutions(graph)

// lookups (a lookup, never a resolution -- null means "no projection")
routeNodeReferenceFor(graph, astRouteNode, side)
routeEventReferenceFor(graph, astRouteNode, side)
routeEndpointFor(graph, routeEventReference)

// questions
resolveRouteNode(graph, routeNodeReference)
resolveRouteEndpoint(graph, routeEventReference)
routeVerdict(graph, astRouteNode)

// reverse indexes
routesFrom(graph, defSymbolOrAstNode)
routesTo(graph, defSymbolOrAstNode)
```

`side` is `'source' | 'destination'` and an invalid one throws `ESCOPEREF`.
Every returned projection is branded, frozen and rejected across graphs via the
existing `assertMember` path (test 8, test 39).

`routeEndpointFor` is an addition beyond the plan's list: it returns the endpoint
record even when the endpoint then failed the **direction** test, so a consumer
reporting a direction error can still say what the author actually named.

### Reverse-index rule — fully proven only

> **An edge enters `routesFrom` / `routesTo` only when the WHOLE ROUTE
> resolved**: both node bindings, both endpoints, both directions and an exact
> type match.

**Deviation from the plan, recorded and deliberate.** The plan said "a resolved
node binding **and** a resolved endpoint". As built the bar is the whole ROUTE,
because a `routesFrom` entry claims *"this node drives that node"* — a statement
about both ends. An edge admitted on one resolved side would be a half-proven
relationship presented as a whole one, and a scene-tree or rename consumer has
no way to tell the difference. Anything less than `resolved` remains readable
through `routeReferences`, where its status travels with it. Test 40 pins this
against four ROUTEs (clean, direction error, unresolved node, ambiguous node) —
only the clean one is indexed.

An index entry records both endpoints' resolved symbols, both endpoint records
and the ROUTE's range, and is frozen. Ordering is source order.

---

## 16. Script behaviour

Nothing new. R17 confirms Scripts are ordinary ROUTE endpoints, and
`acquireEndpointOn` already implements the precedence P2B established:

1. a `Script` instance's **own** `restrictedInterfaceDeclaration` members
   (`script-interface`), consulted **before** clause 6;
2. falling through to Script's built-in schema fields (`url`, `directOutput`,
   `mustEvaluate`).

Both halves are tested (21, 22). No JavaScript, Java, URL or dynamic property is
executed or read, and Script *fields* are never treated as ROUTE events.

---

## 17. Corpus measurements — re-run THROUGH THE PRODUCTION PATH

Read-only, boundary-guarded (the `white-dune` / `RE-ARTIFACTS` / `blaxxun-cs-RE`
markers **throw**), deterministic (codepoint ordering, no clock, no PRNG).
Discovery reuses the accepted `spikes/wd1-node-identity/corpus.js` boundary.

> ### The harness is now IN THE REPOSITORY — and this section was re-measured
>
> The figures originally recorded here came from a harness that lived in a
> **session scratchpad** and vanished with it. Independent QA could not rerun
> either the sweep or the oracle and returned `BLOCKED — EVIDENCE INSUFFICIENT`.
> That objection was correct: a hard zero-wrong-bindings gate whose measurement
> cannot be reproduced is an assertion, not evidence.
>
> A reproducible read-only harness now lives at **`spikes/wd1-route-semantics/`**
> and every figure below has been **re-measured through it**. See §17.4 for the
> exact rerun command and §17.1 for the damage-metric reconciliation that was
> previously left open.
>
> The re-measurement **reproduced every semantic figure exactly** and changed no
> production code. Two figures moved and both are accounted for: one drifted
> corpus file, and a deliberately **stronger** oracle (§17.3).

**Input fingerprint (original run):**
`7d05d4523c234d5628789b27d9789774c7b3ff8866c7de93cf3d6a54a6c96d70`

**Input fingerprint (reproducible harness, this measurement):**
`38c8fcb23c3ddf453a6bf093675c40858df30af2d18ddf33d05fd6bad2122fa4`

**Input fingerprint (closeout re-run, after independent QA):**
`0c6025732aec317030b465ac467484a5c1cf5914a146c68ac479597b64ebb253`

The fingerprints differ because the corpus roots are **external workspace trees
that change independently of this repository** — which is exactly the input
change the fingerprint exists to make visible, and is a different fact from the
analysis being unstable. The drift is **one file** (14,225 → 14,226 discovered),
and §17.3 tracks its ±1 consequences.

The closeout re-run drifted again, on the **raw-path** side only: 14,226 →
**14,227** discovered, 14,208 → **14,212** read (read/decode errors 18 → **15**),
574,073 → **574,083** raw-path ROUTEs. The newly readable files carry content
already present under another path, which is why the unique-document count does
not move with them. It moved **nothing semantic**: the canonical
denominator is still **4,466** unique decoded documents and **245,540** ROUTEs,
the whole damage grid, all five partitions, both direction zeros, the single
type mismatch and every oracle figure below reproduced **exactly**, and all
three hard gates still read zero. The figures in this section are therefore left
as measured rather than restated — a drifting *input* is not a changing *result*,
and the fingerprints are what tell the two apart.

The planning figures were produced by a **recon harness that reimplemented the
intended algorithm over the public API**, because `acquireEndpointOn` did not
exist yet, and located a ROUTE's scope by innermost containment. The figures
below come from the **production path** — the real `scope-graph.js`, the real
gate, the real reverse indexes — and are the correctness evidence. The planning
figures are retained as comparison only.

### Denominators

| quantity | planning recon | **as built** | note |
|---|---|---|---|
| files discovered | 14,225 | **14,226** | +1 — corpus drift; the roots are external trees that change independently, which is exactly what the fingerprint exists to make visible |
| files read and decoded | 14,209 | **14,208** | |
| **unique by DECODED TEXT — the canonical denominator** | 4,464 | **4,465** | 4,466 on re-measurement (§17.3) |
| duplicate-content files skipped | 9,745 | **9,743** | 9,745 on re-measurement |
| read/decode errors | 15 | **18** | 15 on re-measurement |
| files damaged (≥1 error diagnostic) | 576 | **212** | **now reconciled as a DEFINITION difference — §17.1**; re-measured 213 |

> **A dedupe trap worth recording.** The first production sweep deduplicated by
> **raw bytes** and reported 6,264 unique files and 323,923 ROUTEs — a ~32%
> overcount against the plan. The cause is gzip: a `.wrz` and its plain `.wrl`
> twin are different bytes and identical content. Deduplicating by **decoded
> text** reproduces the planning denominator to within the one drifted file.
> Any future sweep must dedupe after `readWrlSource`, not before.

### ROUTE totals

| | planning | **as built** |
|---|---|---|
| ROUTE statements | 245,540 | **245,540** — exact (re-measured: 245,540, exact again) |
| …in damaged files | 36,472 | **11,173** | — see §17.1; the 11,173 figure re-measured **exactly**, and its definition is now written down |

> **The raw-path ROUTE total is 574,073.** It appears nowhere else in this
> document and is recorded here because its size is the point: counting ROUTEs
> per *discovered path* rather than per *unique decoded document* inflates the
> denominator by 2.3×, since a heavily duplicated world contributes its ROUTEs
> once per copy. Any figure quoted without its denominator is unusable.

### Node resolution (245,540 per side)

| outcome | plan src | **built src** | plan dst | **built dst** |
|---|---|---|---|---|
| `resolved` | 243,430 | **243,430** | 243,314 | **243,314** |
| `recovered` (scope unprovable) | 1,908 | **1,908** | 1,903 | **1,903** |
| `ambiguous` (duplicate DEF) | 201 | **201** | 317 | **317** |
| `invalid` (missing name) | 0 | **0** | 5 | **5** |
| `unresolved` (not declared) | 1 | **1** | 1 | **1** |
| `unresolved` (**not defined before** the ROUTE, R5) | 0 | **0** | 0 | **0** |

**Every node-resolution figure reproduces exactly.**

### Endpoint outcomes

| outcome | plan src | **built src** | plan dst | **built dst** |
|---|---|---|---|---|
| `resolved` | 234,250 | **234,249** | 234,333 | **234,332** |
| `unresolved` — node type unresolved (G3) | 8,957 | **8,957** | 8,947 | **8,947** |
| `unresolved` — unknown field | 175 | **175** | 11 | **11** |
| `unsupported` — **EXTERNPROTO not locally verifiable** | 47 | **48** | 7 | **8** |
| `ambiguous` — duplicate interface member | 1 | **1** | 16 | **16** |
| `recovered` | — | **1,908** | — | **1,903** |
| propagated node `ambiguous` | — | **201** | — | **317** |

The ±1 on `resolved` and `unsupported` follows from the one drifted file. Every
other figure is exact.

### Direction and type

| verdict | planning | **as built** |
|---|---|---|
| source direction **invalid** | 0 | **0** |
| destination direction **invalid** | 0 | **0** |
| type **mismatch** | 1 | **1** |
| type **unknown** | 0 | **0** |
| whole ROUTE `resolved / ok` | — | **233,983** |

### Endpoint origins (a figure the plan did not measure)

| origin | source | destination |
|---|---|---|
| `builtin-schema` | 210,346 | 131,842 |
| `script-interface` | 10,194 | 88,892 |
| `proto-interface` | 13,310 | 13,207 |
| `externproto-interface` | 399 | 391 |

### Alias and shorthand usage

| mechanism | source | destination | total |
|---|---|---|---|
| **4.10.2 ROUTE shorthand** (P2C-only) | 380 | 169 | **549** (plan: 551) |
| 4.7 implicit alias expansion (P2B, shared) | 106 | 41,164 | 41,270 |

**549 endpoints bind ONLY through R12's fallback.** Omitting the rule would
report every one of them as an unknown endpoint — 549 false positives — which is
what makes it load-bearing on real content rather than a spec nicety. The
destination-side alias figure (41,164) is the ordinary `set_X` idiom and is
P2B's mechanism, not P2C's.

### 17.1 The damaged-file numbers — reconciled, and one half unrecoverable

This was the central QA block. It is no longer recorded as "a definition
difference" without the definitions: `corpus.js` now computes **three** damage
definitions side by side, over **both** denominators, for **both** files and the
ROUTEs they contain. "Damaged" was never one property, and the grid is what makes
the question answerable rather than assertable.

| definition | means |
|---|---|
| `syntax-error` | truncated **or** depth-capped **or** any *syntax* diagnostic of severity `error` |
| `syntax-any` | truncated **or** depth-capped **or** any *syntax* diagnostic of **any** severity |
| `any-diagnostic` | the above **plus** `analyze.js`'s flat VRML040–VRML044 **semantic advisories** |

Measured (fingerprint `38c8fcb2…`):

| definition | damaged raw paths | damaged unique docs | ROUTEs in damaged raw paths | ROUTEs in damaged unique docs |
|---|---:|---:|---:|---:|
| `syntax-error` | 498 | **213** | 25,702 | **11,173** |
| `syntax-any` | 504 | 216 | 25,702 | 11,173 |
| `any-diagnostic` | 1,625 | **585** | 93,846 | **41,159** |

**The implementation's pair is fully reproduced and its definition is now
recorded.** `syntax-error` × unique decoded documents = **213** files and
**11,173** ROUTEs. The ROUTE figure is **exact** against the 11,173 above; the
file count is 212 + the one drifted file.

**The planning pair is only half-explained, and the other half is not
recoverable.** `any-diagnostic` × unique decoded documents gives **585** files
against the planning harness's 576 — within corpus drift and a plausible
inclusion detail, and clearly the right *family*: the jump from 213 to 585 is
driven entirely by the semantic advisories, which is the one definitional choice
that could produce a number of that size. But the same cell gives **41,159**
ROUTEs against the planning harness's 36,472, and **no measured definition
reproduces 36,472** — not either denominator, not any of the three damage
definitions, not raw-byte de-duplication (which would have moved the unique-file
count to ~6,264 and the planning harness reported 4,464, so it did dedupe by
decoded text).

> **Verdict: `historical planning metric definition unrecoverable`.** The
> planning harness lived in a prior session's scratchpad and cannot be diffed.
> Its damage metric is therefore **retired**, not reconciled, and replaced by the
> named reproducible metrics above. §17.2 discharges the obligation that actually
> matters.

### 17.2 Why retiring that number is safe — the completeness proof

The question a reviewer needs answered is not whether an old number matches. It
is:

> **Can a ROUTE whose required semantic evidence is unprovable be silently
> excluded from the hard-gate comparison?**

**No, and the audit fails rather than shrinks if that ever changes.** Three
independent properties, all checked in code by `run.js`:

1. **Total classification.** Every one of the 245,540 ROUTEs is partitioned into
   exactly one `status/reason` bucket for **each** of the five questions, and
   each partition is asserted to **sum to 245,540**. All five do. A ROUTE that
   escaped classification makes the audit **FAIL**.
2. **No silent projection loss.** ROUTEs the production path declines to project
   at all are counted separately: **0**. That count is also a failure condition,
   which matters because the leniently-accepted ROUTE-inside-an-MFNode-array
   construct is exactly where such a loss would hide (deviation 9).
3. **The unprovable population is named and counted per ROUTE**, not inferred
   from a file count:

| population | count |
|---|---:|
| ROUTEs whose own answer rests on **recovery** | **1,908** |
| ROUTEs whose own answer rests on an **unsupported** EXTERNPROTO | **56** |
| ROUTEs whose own answer rests on **either** | **1,964** |
| unique documents containing ≥1 such ROUTE (**ROUTE-relevant** recovery) | **55** |

Two consistency checks fall out, and both hold exactly:

* **1,908** equals the `recovered` source-node count in the partition table.
  Same population, reached two different ways.
* ROUTEs the oracle did **not** grade = **11,173**, which is exactly the
  `syntax-error` × unique-docs ROUTE count. The oracle grades precisely the
  complement of the damaged set — 234,367 graded + 11,173 ungraded = **245,540**,
  with nothing in between.

Note how much smaller **55** is than **213**: a document having a syntax error is
*not* the same as that document having a ROUTE whose answer depends on it. That
distinction is the reason the single "damaged files" number was misleading in both
harnesses, and it is why the report now keeps "file has some diagnostic", "ROUTE
lives in a damaged file" and "this ROUTE's own evidence is unprovable" as three
separate measurements.

### 17.3 Re-measurement deltas

Everything semantic reproduced **exactly**: all node-resolution figures, all
endpoint outcomes, both direction zeros, the single type mismatch, the whole-ROUTE
`resolved/ok` count of 233,983, all four endpoint origins, and the alias +
shorthand total of 41,819 (549 shorthand + 41,270 alias). Two figures moved:

| figure | as built | re-measured | why |
|---|---:|---:|---|
| unique decoded documents | 4,465 | **4,466** | one drifted corpus file; the fingerprint records it |
| oracle endpoint comparisons | 341,984 | **467,989** | a **stronger oracle**, not a discrepancy — see below |

The original oracle abstained on any endpoint it could not settle from the
committed schema alone, which meant every PROTO, Script and EXTERNPROTO target.
The reproducible oracle derives its **own** interface tables for all four
namespaces from the parse tree — its own PROTO interface lists, its own Script
`restrictedInterfaceDeclaration` members with clause-6 fallthrough, and its own
4.9.2 EXTERNPROTO asymmetry — so it now grades **37% more endpoint sites**. It
still abstains where it genuinely cannot settle a question, and every abstention
is counted by reason rather than dropped:

| abstention reason | count |
|---|---:|
| `node-not-bound` (no node to read an interface from) | 519 |
| `unknown-node-type` | 115 |
| `externproto-not-locally-verifiable` (4.9.2) | 54 |
| `duplicate-type-declaration-at-one-level` | 40 |
| `collided-effective-name` (4.3.5 — neither declaration is intended) | 17 |
| **total uncomparable** | **745** |

Node bindings are **fully** comparable: 468,734 compared, 468,734 in agreement,
**0** uncomparable — the same 468,734 the original run reported.

**All three hard gates pass on the reproducible harness: 0 wrong node bindings,
0 wrong endpoint bindings, 0 confident conclusions from an unprovable scope.**

`confident-from-unprovable` is now checked as a **per-scope invariant** rather
than taken on trust. Recovery is a whole-scope property — a damaged scope
withholds every lexical answer, positive included — so a scope that produced any
`recovered` answer *and* a confident (`resolved`/`unresolved`) one is
self-contradictory. That is checkable without trusting either the oracle or the
resolver's own account of which scopes it marked recovered. `missing-name`
remains excluded, and only it: it is a token fact that sits above the gate in
every namespace.

#### The invariant's key is corpus-scoped, not universal — an AUDIT-METRIC caveat

`0 confident-from-unprovable` is a **measured result for this corpus**, and the
invariant that measures it groups all of a ROUTE's answers under the ROUTE
statement's own enclosing DEF scope. That grouping is empirically sound **here**
because every observed recovery-bearing endpoint result is a **G2** case — the
ROUTE's own scope is the recovered one. The corpus contains **no G4-only
example**: no ROUTE whose own scope is clean while a target's *owning interface
scope* is independently recovered.

Such a shape is theoretically constructible. Its answers would be correct —
production already withholds an endpoint whose required interface scope is
unprovable, which is exactly what **G4** is (§13) and what test 33 pins — but a
single ROUTE-scope key would file the clean node bindings and the withheld
endpoint under one scope and could report a **false-positive** "mixed
recovered/confident scope". A future corpus exhibiting G4 without G2 would
therefore need a more granular provability key **in the audit harness**.

This is a limitation of the evidence metric, not of production semantics. One
ROUTE-scope key is **not** claimed to be a universal proof for every possible
cross-scope recovery topology. The harness is deliberately left unchanged: it is
measured against a real corpus, and speculatively re-keying it for a shape no
input exhibits would trade a checkable property for an untested one.

### 17.4 How to rerun this audit

```sh
# The harness's own tests (17): independence guards, read-only scan,
# boundary guard, determinism, and the oracle's own reading.
node --test spikes/wd1-route-semantics/test.js

# The full audit. Exit code IS the verdict.
node --max-old-space-size=6144 spikes/wd1-route-semantics/run.js

# Adversarial controls only, no corpus (~1 s).
node spikes/wd1-route-semantics/run.js --controls-only
```

Flags: `--files=N` (caps the work, not the discovery, so the fingerprint still
describes the whole input set), `--out=DIR`, `--no-corpus`, `--controls-only`,
`--quiet`.

| property | value |
|---|---|
| harness | `spikes/wd1-route-semantics/` — `corpus.js`, `oracle.js`, `sweep.js`, `controls.js`, `run.js`, `test.js`, `README.md` |
| output | `out/audit.json` (machine-readable) + `out/metrics.md`. **Gitignored and regenerable** — the harness is the durable artifact |
| discovery boundary | reuses `spikes/wd1-node-identity/corpus.js`; `white-dune` / `white_dune` / `RE-ARTIFACTS` / `blaxxun-cs-RE` / `Downloads` / `node_modules` **throw**, checked twice independently |
| decoded-content dedup | read through the production `readWrlSource` **first**, then SHA-256 over the UTF-8 bytes of the **decoded** text. Never over raw bytes — a `.wrz` and its `.wrl` twin are one document |
| input fingerprint | SHA-256 over every discovered `id:size` line in codepoint order |
| reporting | `group:relative/path` only; no absolute path, no clock, no timing figure in any artifact |
| determinism | two full runs over an unchanged corpus produce byte-identical `audit.json` |
| oracle independence | `oracle.js` **throws at load** if `scope-graph.js` or `symbols.js` is already in `require.cache`; `run.js` loads it first; `test.js` re-proves it transitively in a clean child process, proves the guard fires by violating it, and allow-lists the oracle's entire require surface to three neutral modules |
| exit code | non-zero if any hard gate fails, if a partition does not sum, if a ROUTE is unclassified, or if an adversarial control stops firing |

`audit.json` carries the corpus fingerprint, all discovery counts, the full damage
grid, ROUTE totals on both denominators, all five partitions, direction/type
outcomes, endpoint origins, the oracle comparison totals with abstention reasons,
the three hard-gate counts, and the per-control results.

### The headline result

> **Across 245,540 authored ROUTEs the corpus contains 0 direction violations
> and exactly 1 type mismatch** — reproduced through the production path.

That is a striking contrast with P2B, which found **1,481** genuine Table 4.4
violations in the same corpus. It is a real property of the content, not a blind
detector: **every zero-count classifier is proven reachable by an adversarial
control** — in the focused suite, and now also by a control the *audit itself*
runs, before the corpus, on every invocation. `run.js` reports a dead detector
loudly and fails, because a corpus zero measured by a detector that cannot fire
is not evidence of anything.

| classifier | corpus | focused test | audit control (`controls.js`) |
|---|---|---|---|
| reversed direction — source | 0 | tests 14, 15 | `direction-source-not-event-out` |
| reversed direction — destination | 0 | tests 14, 15 | `direction-dest-not-event-in` |
| field-as-event | 0 | test 16 (both sides), 44b | `field-as-event` |
| type mismatch | 1 | tests 25, 26, 27 | `type-mismatch` |
| R12 shorthand — source | 486* | tests 44, 45 | `shorthand-source` |
| R12 shorthand — destination | 41,333* | tests 44, 45 | `shorthand-destination` |
| R19 fallback past a wrong-kind exact spelling | — | tests 44, 44b, 44c | `r19-fallback-past-wrong-kind` |
| unknown endpoint | 186 | tests 17, 18, 19 | `unknown-endpoint` |
| forward DEF reference (R5) | 0 | test 46 | `forward-def-reference` |
| duplicate / ambiguous DEF | 518 | test 12 | `duplicate-def` |
| PROTO scope isolation | — | tests 6, 7 | `nested-proto-isolation` |
| EXTERNPROTO `unsupported` | 56 | tests 23b, 44c | `externproto-unsupported` |
| EXTERNPROTO declared-resolves (the 4.9.2 *other* half) | 790 | test 23 | `externproto-declared-resolves` |
| recovered scope withholds every answer | 1,908 | test 49 | `recovered-scope-withholds` |

All **14** fire. \* the two shorthand rows are the audit's combined
alias-or-shorthand metric (written name ≠ declared member), whose total of
**41,819** matches 549 shorthand + 41,270 alias exactly; the focused suite
separates the two mechanisms.

### Wrong-binding oracle

An **independently authored** expected-truth model
(`spikes/wd1-route-semantics/oracle.js` — **in the repository**, no longer a
scratchpad file) derives its answers from the **parse tree and the committed
WD1.3 schema alone**. It implements its own PROTO lexical stack and 4.8.4
disjointness, its own DEF visibility and "defined before the ROUTE" rule, its own
4.6.2 duplicate refusal, its own 4.7/4.8.2 alias expansion, its own reading of
4.10.2's fallback procedure and R19 precondition, and its own direction and
exact-type expectations.

It is **structurally prevented from importing the thing it grades**, three ways
(§17.4): a load-time assertion that fails if `scope-graph.js` or `symbols.js` is
already in `require.cache` — with `run.js` loading the oracle first so the check
is a real precondition — a clean-child-process test proving the absence
*transitively*, and an allow-list of its entire require surface. A fourth test
violates the guard deliberately and asserts it throws, because a guard never
observed to fire is a comment.

It grades only files with **no error diagnostics** — its own scope model, like
the resolver's, cannot be trusted over a tree whose boundaries moved — and
abstains, with a named and counted reason, on any site it cannot settle.

| measure | as built | **reproducible harness** |
|---|---|---|
| files graded | 4,253 | **4,253** |
| node bindings compared | 468,734 | **468,734** |
| node bindings in agreement | 468,734 | **468,734** |
| node bindings uncomparable | — | **0** |
| **wrong node declaration bindings** | **0** | **0** |
| endpoint bindings compared | 341,984 | **467,989** (§17.3 — a stronger oracle) |
| endpoint bindings in agreement | 341,984 | **467,989** |
| endpoint bindings uncomparable | — | **745**, itemised by reason in §17.3 |
| **wrong endpoint declaration bindings** | **0** | **0** |
| **confident conclusions from an unprovable scope** | **0** | **0** |

A *safe refusal* where the oracle would bind is counted as agreement, not as a
wrong binding — the hard gate permits losing an answer and forbids inventing
one. The reverse direction is counted strictly: a confident binding where the
oracle sees no unique preceding declaration is a wrong binding.

> **`missing-name` is excluded from the "confident from unprovable" count, and
> deliberately.** It is a TOKEN fact — "this reference has no name to look up" —
> true whatever the surrounding scopes turn out to be, and it sits above the gate
> in `resolveNodeType` (P2A), `resolveIsReference` (P2B) and
> `resolveRouteNodeReference` alike. The first sweep counted 10 such cases before
> the carve-out; all 10 were `invalid/missing-name` on a truncated ROUTE in one
> file. With it excluded the count is **0**.

**All three hard gates pass.**

---

## 18. Historical compatibility-profile candidates

Recorded per WD.md §9 — classified and preserved, never normalized into language
rules, and **P4 decides presentation, not P2C**.

| # | idiom | plan | **as built** | disposition |
|---|---|---|---|---|
| H1 | R12 base-name shorthand (`T.fraction` for `fraction_changed`) | 551 | **549** | **CONFORMING.** Not a compatibility item at all — R12 is normative-explicit. Listed only because it *looks* like vendor laxity and **must never be reported as one** |
| H2 | duplicate DEF names reachable from a ROUTE | 518 | **518** (201 src + 317 dst) | strict-reading `ambiguous` (§12). Browsers apply *closest preceding*; that belongs in a `languageSemantics` query, never in identity |
| H3 | EXTERNPROTO endpoint absent from the local declaration | 54 | **56** (48 src + 8 dst) | `unsupported`, inherited from P2B. **Not an error** |
| H4 | ROUTE in a file whose parse is damaged | 36,472 | **11,173** | withheld by G1/G2. Volume is a property of the corpus and of the counting definition (§17), not of ROUTE |
| H5 | ROUTE endpoint on a node whose type is unresolvable | ~8,950/side | **8,957 / 8,947** | withheld by G3. Largely EXTERNPROTO-heavy Cybertown content |
| H6 | duplicate interface member reachable from a ROUTE | 17 | **17** (1 src + 16 dst) | `ambiguous`; the 4.3.5 explicit/alias collision P2B already adjudicated |
| H7 | `SFString` → `MFString` route | 1 | **1** | **genuine R11 violation.** SF→MF is explicitly illegal |

**H7, identified exactly** (the plan predicted the type pair; this confirms the
site): `ct-campus:ctgit-archive-master/places/banners/3d/cafe_ban1.wrl`, routing
an `eventOut SFString par_changed` into an `eventIn MFString set_parameter` — a
Script driving an `Anchor`'s `parameter`. One authored bug in 245,540 ROUTEs.

**H1, with real examples** from the sweep, all conforming:

- `.fraction` → `fraction_changed` (source) and → `set_fraction` (destination),
  in `ct-mall-archive:public/items/dartbrd-089dc3/dartbrd.wrl`
- `.value` → `value_changed` (source), in
  `ct-campus:ctgit-archive-master/places/jail/vrml/avatar/jailbird.wrl`

**H1 is the finding most likely to be misread.** R12's base-name shorthand is
conforming VRML97 and must **never** be surfaced as a warning.

Note the asymmetry worth carrying to P4: P2B's 1,481 Table 4.4 violations were
concentrated in the `exposedField` column of an `IS` rule the corpus authors
plainly did not internalize. ROUTE's rules — eventOut→eventIn, exact type — were
followed essentially universally. **P4 should not assume the P2B remediation
volume repeats here; for ROUTE the strict reading is nearly free.**

---

## 19. Test matrix, as built

`test/vrml/route-semantics.test.js` — **54 tests, all passing**. The plan's 48
cases are all present; six of them needed a second or third case to pin a
boundary honestly, which is why the count is 54 rather than 48.

| group | tests | covers |
|---|---|---|
| Node resolution | 1–10 | clean pair · missing source/dest DEF · duplicate source/dest DEF · same spelling in two scopes · PROTO isolation both directions · cross-graph rejection · fake absence · fake ambiguity |
| Endpoint acquisition | 11–23b | built-in eventOut/eventIn · 4.7 alias both sides · illegal source/destination direction · unknown source/destination endpoint · **X3D-only endpoint rejected** · PROTO endpoint · Script own-interface · Script clause-6 fallthrough · EXTERNPROTO declared · EXTERNPROTO absent → `unsupported` |
| Type | 24–28 | equal · SFFloat→SFInt32 · **SF→MF both ways** · SFNode equality with no look inside · unknown type |
| Recovery | 29–37 | truncated ROUTE · missing event name · hard parse cap · unresolved P2A type · damaged PROTO interface · unrelated damage does not suppress · fabricated direction · fabricated type mismatch · **fabricated wrong binding** |
| Structural safety | 38–42 | no nearest/closest/fuzzy/ranking (**source scan and behaviour**) · frozen/branded projections · resolved-only reverse indexes · deterministic ordering · P1/P2A/P2B lists unchanged |
| Research additions | 43–48 | **43** host-interface-scope equivalence · **44/44b/44c** R19 · **45** R12 order · **46/46b** R5 · **47** node-failure independence · **48** ROUTE in a node body and in an MFNode array |
| Mutation | 49 | G2 killed · G1 subsumption pinned honestly · `guardLexical` second defence pinned · R12 fallback neutering observable |
| Lane boundary | 50 | consumer-free · no I/O · façade shut · `acquireEndpointOn` private |

Every test has an explicit semantic purpose; none was added to reach a number.

### Predecessor boundary tests that MOVED, and why

Four assertions existed specifically to mark the P2B/P2C frontier and are now
false by design. Each was updated, not deleted:

| file | assertion | now |
|---|---|---|
| `symbols.test.js` | `REFERENCE_KIND` literal table | includes both ROUTE kinds + `ROUTE_SIDE` |
| `symbols.test.js` | "no kind is published that nothing constructs" | asserts both are **constructed**; the taxonomy is complete |
| `type-resolution.test.js` | "ROUTE is absent, not stubbed" | renamed; now asserts P2C built its **own** lists and did not join P1's/P2A's |
| `interface-is.test.js` | "begins no part of P2C" | renamed; now asserts P2C is likewise **consumer-free** and `acquireEndpointOn` stayed private |

`interface-is.test.js`'s 51 focused tests passed **unedited** through the P2C-0
extraction gate; the boundary assertion above was edited only afterwards, once
the lane it described had legitimately landed.

---

## 20–21. Implementation slicing and production files

**Deviation from the plan, per the lane brief:** the plan proposed P2C-0 as its
own commit. The brief directed a single uncommitted lane, so P2C-0 was
implemented as an **internal behaviour-preserving slice** and validated as its
own gate (51/51 + 1048/1048) rather than as a separately committed precursor.

> **P2C-0 was implemented as an internal behaviour-preserving slice, not a
> separately committed precursor.**

### Files changed

| file | change |
|---|---|
| `src/vrml/symbols.js` | +2 `REFERENCE_KIND`, +1 `ROUTE_SIDE` constant, +7 `REASON`, +2 detail values, +`createRouteNodeReference` / `createRouteEventReference` / `createRouteVerdict`, +2 shape predicates |
| `src/vrml/scope-graph.js` | P2C-0 extraction; ROUTE capture in `visitStatement`/`visitValue`; the ROUTE engine; the gate; verdicts; reverse indexes; 13 exported queries |
| `test/vrml/route-semantics.test.js` | **new** — the 54-test matrix |
| `test/vrml/symbols.test.js` | two boundary assertions moved (§19) |
| `test/vrml/type-resolution.test.js` | one boundary assertion moved |
| `test/vrml/interface-is.test.js` | one boundary assertion moved |
| `package.json` | registered the new test file in `check` |
| `docs/white-dune-2026/WD1_5_P2C_ROUTE_SEMANTICS_PLAN.md` | this file, as built |
| `WD.md` | §3 status table + a §8.2 subsection |

**Verified NOT changed** (`git diff` is empty for each): `tokenizer.js` ·
`parser.js` · `ast.js` · `node-schema.js` · `analyze.js` · `index.js` ·
`diagnostics.js` · `source-map.js` · `edit.js` · `node-identity.js` ·
`document-transaction.js` · `validator.js` · every renderer, editor, preview and
world-project module.

---

## 22. The exact P2C / P4 boundary

**P2C ends** the moment a correct, gated, internal answer exists for all six
questions of §1, reachable only through `scope-graph.js`'s own exports.

**P4 owns** every question of the form "what should the user see?":

- whether `route-source-not-an-event-out` / `route-dest-not-an-event-in` /
  `route-type-mismatch` are errors, warnings or compatibility notes;
- whether `unsupported` (EXTERNPROTO) is shown at all;
- whether ambiguous node bindings are surfaced or suppressed;
- the fate of `VRML042`/`VRML043`/`VRML044`, which P2C leaves untouched;
- the still-open P2B handoff: how the **1,481** Table 4.4 violations are
  presented. **P2C adds nothing to that count** and must not be read as
  precedent for it — see §18's asymmetry note.

---

## 23. Risks, and how each was closed

| # | risk | outcome |
|---|---|---|
| R-1 | The §6 refactor silently changes `IS` behaviour | **Closed.** 51/51 unedited + 1048/1048 at the extraction gate; test 43 pins the one assumption by object identity |
| R-2 | R12's shorthand leaks into `IS` | **Closed.** Shorthand lives in `acquireRouteEndpoint`; `acquireEndpointOn` contains no fallback; test 45 pins order |
| R-3 | A containment search reaches production from the recon harness | **Closed.** Scope fixed on descent; test 38 scans `addRoute`'s body for `contains(` |
| R-4 | R19 decided incidentally | **Closed by owner adjudication** (§11.3), tagged with a detail value, both readings pinned by 44/44b/44c |
| R-5 | Corpus cleanliness breeds complacency and the gates go untested | **Closed.** Mutation test 49 is the acceptance gate, not corpus cleanliness; adversarial controls prove each zero-count classifier is reachable |
| R-6 | `ambiguous` is "fixed" into closest-preceding | **Open by design** (§12), with the `languageSemantics` escape hatch named |
| R-7 | Reverse indexes accumulate probable edges | **Closed.** Whole-ROUTE bar (§15); test 40 |
| R-8 | Corpus drift looks like an analysis defect | **Closed.** Fingerprint recorded in §17; the one drifted file is tracked to its ±1 consequences in §17.3 |
| R-9 | The corpus evidence cannot be rerun by an independent reviewer | **Closed.** The harness is in the repository at `spikes/wd1-route-semantics/`, with the rerun command, the dedup rule, the fingerprint algorithm and the independence proof recorded in §17.4. This risk was **realised** before it was closed — QA returned `BLOCKED — EVIDENCE INSUFFICIENT` on exactly it |

---

## 24. Hard stops — none were hit

1. The §6 extraction **was** behaviour-preserving.
2. No parser, AST, node-schema, `analyze.js` or façade change proved necessary.
3. No design pressure toward nearest/closest/fuzzy/ranked matching survived.
4. No EXTERNPROTO URL was loaded, and the one place that tempted it (R19's
   fallback past an `unsupported` miss) was closed by refusing instead.
5. Corpus measurement through the production path reproduces every **semantic**
   planning figure exactly (§17), and now does so from a **reproducible,
   in-repository harness** rather than a vanished scratchpad.

   One planning figure is **not** reconciled and is not claimed to be: the
   planning harness's damage metric (576 files / 36,472 ROUTEs). §17.1 measures
   three damage definitions over both denominators, reproduces the
   implementation's own pair exactly (213 / 11,173) and writes its definition
   down, but no measured definition reproduces 36,472. That metric is recorded
   as **`historical planning metric definition unrecoverable`** and retired.
   §17.2 proves separately -- by total partition arithmetic, a zero
   unprojected-ROUTE count and a per-ROUTE census of the unprovable population --
   that retiring it excludes no recovery-bearing ROUTE from the hard gates.

---

## 25. Definition of done

- [x] P2C-0 landed as an internal slice; `interface-is.test.js` 51/51 **unedited**
      at that gate
- [x] All six §1 answers implemented, independently observable, gated per §13
- [x] R12 shorthand implemented with normative candidate order
- [x] Reverse indexes contain **only** fully-resolved relationships
- [x] 54 focused tests pass; G2 killed by mutation, G1's redundancy pinned with a
      written rationale rather than a ceremonial kill
- [x] Corpus sweep re-run **through the production path** with an independently
      authored oracle
- [x] The corpus sweep and oracle are **reproducible from the repository**
      (`spikes/wd1-route-semantics/`, 17 harness tests), deterministic
      (two full runs byte-identical), and re-measured: every semantic figure
      reproduced, all three hard gates **0**, all five partitions summing
      exactly to 245,540
- [x] The damaged-file discrepancy is **resolved**: the implementation's
      definition reproduced exactly and written down; the planning harness's
      retired as unrecoverable, with a separate completeness proof (§17.2) that
      retiring it omits no recovery-bearing ROUTE
- [x] `npm run check` green on Linux (**1102/1102**)
- [x] No diff in `parser.js` / `tokenizer.js` / `ast.js` / `node-schema.js` /
      `analyze.js` / `index.js`
- [x] This document updated to *as built*, including deviations
- [ ] Windows CI — **not run**; this lane is uncommitted and unpushed by
      instruction
- [ ] `WD.md` §3 marked committed — deferred until the lane is actually committed

---

## 26. Deviations from the plan, collected

1. **P2C-0 is an internal slice, not a separate commit** (§20) — per the lane
   brief's single-lane, no-commit instruction.
2. **The verdict uses the house `{status, reason}` pair plus `side`**, not a
   bespoke enum (§14) — every planned value is expressible and no second result
   vocabulary is introduced.
3. **The direction verdict lives on the endpoint resolution**, not on the pair
   verdict (§14) — it is a fact about one endpoint.
4. **Reverse indexes require the WHOLE ROUTE**, not merely a resolved node and
   endpoint (§15) — a half-proven edge is indistinguishable from a proven one to
   a consumer.
5. **The R12 fallback does not fire past a non-provable miss** (§11.3) — an
   addition the plan did not anticipate, closing a wrong-endpoint-binding hazard
   on EXTERNPROTO, ambiguous and recovered interfaces.
6. **`routeEndpointFor` was added** to the API list (§15), so a direction error
   can still report what the author named.
7. **`ROUTE_SIDE` was added** as a published constant (§14).
8. **54 tests rather than 48** (§19) — six boundaries needed a second case.
9. **`visitValue`'s `NODE.ROUTE` case now records the ROUTE** rather than
   returning, so a ROUTE leniently accepted inside an MFNode array projects
   (test 48). The plan did not call this out; dropping it would have silently
   lost those ROUTEs.

### Added after independent QA (evidence-hardening pass, no production change)

10. **The corpus harness and oracle moved into the repository** at
    `spikes/wd1-route-semantics/` (§17.4). The plan assumed a scratchpad harness
    was acceptable; QA's `BLOCKED — EVIDENCE INSUFFICIENT` verdict established it
    is not. The evidence-hardening pass itself made **no production-semantic
    change**: `src/vrml/scope-graph.js` and `src/vrml/symbols.js` are
    **byte-identical from the start to the end of that pass**, and the audit
    found no production defect.

    Read that precisely — it is a statement about the *hardening diff*, not
    about the tree. Those two files legitimately **differ from the committed
    baseline** (`51ff283`) because they carry the uncommitted P2C
    implementation that was under audit. Two diffs are in play and only one of
    them is empty:

    | diff | contents |
    |---|---|
    | **P2C implementation diff** vs `51ff283` | the ROUTE resolution semantics being audited — non-empty by design |
    | **evidence-hardening diff** | harness, tests and documentation only — **zero** production bytes |
11. **The oracle grades 37% more endpoint sites** (467,989 vs 341,984) by
    deriving its own PROTO, Script and EXTERNPROTO interface tables instead of
    abstaining on every non-built-in target (§17.3). Still 0 wrong bindings.
12. **The damage metric is a grid, not a number** -- three definitions over two
    denominators (§17.1). The planning harness's pair is retired as
    unrecoverable rather than reconciled by assertion, and §17.2 proves
    separately that retiring it omits no recovery-bearing ROUTE.
13. **`confident-from-unprovable` is now a per-scope invariant** rather than a
    figure taken from the oracle: a scope producing both a `recovered` and a
    confident answer is self-contradictory, which is checkable without trusting
    either side (§17.3).
14. **Test 43 was strengthened, and only the test.** It previously compared
    `reference.hostInterfaceScope` against `interfaceScopeFor(graph, hostNode)`
    -- the same value fetched twice from one internal map, so it would have held
    even if that map were wrong. It now derives the expected owner from **AST
    containment** plus the scopes' own published `ownerNode` **reverse**
    projection, never calling `interfaceScopeFor`, and asserts both the
    owns-a-scope and owns-nothing outcomes actually occur. Production semantics
    were not touched to accommodate it; the suite remains 54/54.
