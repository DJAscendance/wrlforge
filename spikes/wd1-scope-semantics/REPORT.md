# WD1.5 — scope semantics: findings and recommendation

**Recommendation: Outcome A — the current AST is sufficient.**
A production scope resolver can be built with **no parser change, no AST change,
and no identity redesign**. Details and the one optional (non-blocking) metadata
proposal are in §12–§13.

Research lane. **No production file was changed.** Nothing is committed.

---

## 1. What was built

A read-only prototype scope graph (`scope-model.js`, 1,359 lines including its
rule citations, no dependency)
over the production parse result, plus 59 independently authored expected-truth
cases, a corpus survey of 6,246 real VRML files, and a differential against the
current production analyzer. An external adversarial review (§14) raised one
High finding that was reproduced, accepted and fixed.

| deliverable | result |
|---|---|
| Authored expected-truth cases | **59/59 pass** (85/85 individual checks) |
| Spike tests | **40/40 pass** |
| Corpus files analysed | **6,246** (707,418,201 characters) |
| Determinism | `results.json` + `metrics.md` **byte-identical** across consecutive full runs |
| Production regression | **832/832** `npm run check`, unchanged |
| Disagreements where production is wrong against authored truth | **15** |
| Disagreements where the prototype is wrong against authored truth | **0** |

## 2. The taxonomy

Three namespaces, not one — see `standards-model.md` §1. Getting this wrong is
the root of most of the current analyzer's errors.

**Scope kinds:** `document`, `proto-body`, `proto-interface`,
`externproto-interface`, `script-interface`.

**Symbol kinds:** `node-def`, `proto-decl`, `externproto-decl`,
`proto-interface-member`, `script-interface-member`.

**Reference kinds:** `use`, `node-type`, `is`, `route-node`, `route-event`.

**Resolution statuses:** `resolved`, `unresolved`, `ambiguous`, `invalid`,
`unsupported`, `recovered` — each with a stable kebab-case `reason` id and source
ranges as evidence.

### The one structural insight

A scope carries **two independent parent links**, because VRML97's two lexical
namespaces nest differently:

| link | on a `document` scope | on a `proto-body` scope |
|---|---|---|
| `defParent` (node names) | `null` | **`null`** — 4.8.4 makes a PROTO's DEF/USE scope *separate*, in both directions |
| `typeParent` (node types) | `null` | the enclosing scope — nested PROTO declarations are local, but the body can still see outward |

`defParent === null` on a PROTO body is not an omission; it *is* rule D5. Lookup
stops there. This is **disjointness, not shadowing**, and every cross-PROTO
finding in this lane follows from it.

Scopes are **identities, never strings**. WD1.4 found a real wrong anchor caused
by a `/`-joined scope key (`PROTO A/B` colliding with `PROTO A { PROTO B }`); the
tokenizer classifies identifiers by exclusion, so `/`, `:`, `@` and `!` are all
legal in a name. Case `X44` and a dedicated test pin that the two spellings stay
distinct.

## 3. Rules established

Full tables with clause citations and confidence grades are in
`standards-model.md`. The load-bearing ones:

- **DEF/USE** (4.6.2, 4.8.4) — visibility is **textual and ordered**; a `USE`
  binds only a *preceding* declaration. Duplicates are **legal**, not errors.
  A PROTO body's names are invisible outside it and vice versa.
- **PROTO/EXTERNPROTO** (4.3.5, 4.8, 4.9) — no forward instantiation; no
  recursion; nested declarations are local; type names shall be unique per
  scope; an EXTERNPROTO interface is a declared **subset**, so a missing member
  is unknowable rather than wrong.
- **Interfaces and IS** (4.3.5, 4.3.6, 4.8.2–4.8.4, 6.40) — members unique per
  PROTO statement; `exposedField zzz` implies `set_zzz`/`zzz_changed`; `IS` only
  inside a PROTO body, binding the **innermost** interface; exact type match;
  access per Table 4.4; no double binding; no value-plus-IS.
- **ROUTE** (4.10.2) — endpoints **shall be defined before** the statement; exact
  type match; eventOut → eventIn only; `set_`/`_changed` shorthand; a repeat is
  ignored, not an error; ROUTEs may appear at top level, in a PROTO body, **or
  inside a node body**.
- **Script** (6.40) — its own per-instance namespace, declared with PROTO
  interface syntax, names unique per node, **no `exposedField` except `url`**.

## 4. Corpus

Roots and discovery are reused verbatim from the committed WD1.4 spike: the
spike's own fixtures, two in-repo fixture groups, and six approved Cybertown
roots inside `~/Projects/cybertown`. Files interleave round-robin across groups.

> **These figures are an OBSERVED SNAPSHOT, not fixed constants.** Most of the
> corpus lives in external workspace trees that change independently of this
> repository. They changed **twice during this lane** (14,204 → 14,205 discovered
> files, and `ct-mall-items` 262 → 263). Every run now records a
> `fingerprint` — SHA-256 over every discovered `id:size` — so a future
> difference is visibly an *input* change rather than an unstable analysis.
> Snapshot fingerprint: **`2736517340bce330`**.

**No cap or budget was reached: this is the whole discovered corpus**, minus the
skips below.

| | |
|---|---:|
| discovered | 14,210 |
| analysed | 6,246 |
| skipped | 7,964 |
| characters parsed | 707,418,201 |

Skips: 7,948 duplicate content (the roots overlap heavily — the same world
appears in an archive, a scrape and a working tree), 10 gzip errors, 4 over the
4 MB per-file cap, 1 empty after decode.

### Header versions — the finding that reframes every "recovered" number

| header | files | with any syntax diagnostic |
|---|---:|---:|
| `#VRML V2.0` | 6,115 | **120 (1.96%)** |
| `#VRML V1.0` | 106 | 106 (100%) |
| other / missing | 25 | — |

`.wrl` is also the extension of **VRML 1.0**, a different language. Those 106
files cannot be parsed by a VRML97 parser and must not be pretended otherwise.
They account for **105,134 of the 125,078** `node-type` references that resolve
to `recovered` — 84%. Read without that split, the recovery figures look like
parser weakness; read with it, the VRML97 parser recovers cleanly on **98.04%**
of real VRML97 files.

### Inventory

| metric | count | | metric | count |
|---|---:|---|---|---:|
| DEF declarations | 694,266 | | USE references | 342,087 |
| PROTO declarations | 3,634 | | of which nested | 22 |
| EXTERNPROTO declarations | 1,279 | | PROTO body scopes | 3,634 |
| PROTO interface members | 44,355 | | Script interface members | 134,272 |
| IS references | 27,756 | | ROUTEs | 323,377 |
| node type references | 1,859,416 | | resolved ProtoInstances | 63,013 |
| unknown/vendor node types | 3,459 | | recovered scopes | 381 |
| duplicate DEF names **within a scope** | 4,025 | | duplicate-DEF findings | 11,608 |

### Identifier characters

| | count |
|---|---:|
| identifiers containing `-` | 61,500 |
| identifiers containing `/` | **1** |
| identifiers with any character outside `[A-Za-z0-9_+-]` | 447 |
| **PROTO names that would collide under a joined scope key** | **0** |

The `/`-in-a-PROTO-name hazard WD1.4 found is **structural, not corpus-observed**:
zero real instances. It remains worth designing against — WD1.4 reproduced a real
wrong anchor from it, and the cost of using identities instead of strings is
nil — but this lane should not claim corpus evidence it does not have.

## 5. Resolution outcomes over the corpus

| reference kind | resolved | ambiguous | invalid | unresolved | unsupported | recovered |
|---|---:|---:|---:|---:|---:|---:|
| `use` | 335,211 | 760 | 46 | 2 | — | 6,068 |
| `node-type` | 1,730,835 | 44 | — | 3,459 | — | 125,078 |
| `route-node` | 641,917 | 683 | 5 | 2 | — | 4,147 |
| `route-event` | 641,567 | — | 5 | 198 | 4,969 | 15 |
| `is` | 25,623 | 21 | 2,050 | — | 26 | 36 |

Read against the standard, this corpus is remarkably clean: in the **undamaged**
files only **2** USEs and **2** ROUTE endpoints name something never declared
anywhere in their scope, and only **1** ROUTE in 323,377 has an event type
mismatch. (The `recovered` column is not error content — it is the model
declining to answer inside the 251 files that carry a syntax diagnostic; see §9.) These worlds shipped and
ran; the model agreeing with that is the strongest available evidence that the
rules are implemented correctly rather than merely strictly.

## 6. Current analyzer vs prototype

### On authored truth — 15 disagreements, production wrong in all 15

Because the expectations are independently authored, this table says who is
**right**, not merely who differs. There is **no** case where the prototype is
wrong and production is right.

| case | reference | expected | production | prototype |
|---|---|---|---|---|
| D02 | `USE Ball` | invalid / use-before-def | **resolved** | correct |
| D03 | `USE Ball` | ambiguous / duplicate-def-in-scope | **resolved** | correct |
| D04 | duplicate `Pivot` | not a duplicate (2 PROTO scopes) | **duplicate** | correct |
| D05 | `USE Inner` | unresolved / across-proto-boundary | **resolved** | correct |
| D06 | `USE Outer` | unresolved / across-proto-boundary | **resolved** | correct |
| D07 | duplicate `Hub` | not a duplicate (nested PROTOs) | **duplicate** | correct |
| D10 | `USE Thing` | ambiguous | **resolved** | correct |
| R30 | `ROUTE Clock` | ambiguous | **resolved** | correct |
| R36 | `ROUTE Clock` | unresolved / across-proto-boundary | **resolved** | correct |
| R37 | `ROUTE Path` | invalid / forward-reference | **resolved** | correct |
| X44 | duplicate `Hit` | not a duplicate (distinct scopes) | **duplicate** | correct |
| X49 | duplicate `Same` | not a duplicate (distinct scopes) | **duplicate** | correct |
| X50 | `USE Ball` (damaged doc) | recovered / scope-recovered | **resolved** | correct |
| X51 | `USE Loop` | invalid / self-referential | **resolved** | correct |
| X59 | `USE Foo` (absorbed scope) | recovered / scope-recovered | **resolved** | correct |

### On the corpus — counted observations, not verdicts

| disagreement | occurrences | production should |
|---|---:|---|
| production reports a duplicate DEF the scope model finds in **different scopes** | 505 names | **change** — false positive |
| production resolves a `USE` the model calls **ambiguous** | 760 | **change** — must not bind a shadowed name |
| production resolves a `USE` the model calls **invalid** (use-before-def / real cycle) | 41 | **warn** — advisory, not blocking |
| production resolves a ROUTE endpoint the model calls **ambiguous** | 683 | **change** |
| production resolves a `USE` the model **withholds** as `recovered` | 6,035 | **fail closed** — damaged scope, see §9 |
| production resolves a ROUTE endpoint the model **withholds** as `recovered` | 4,145 | **fail closed** |
| **prototype resolves anything production refuses** | **0** | — |

The last row matters most: the prototype is **strictly more conservative**. It
never claims a binding production declines to make. There is no case in 707 MB
of real VRML where adopting the scope model would newly resolve something.

## 7. The rule deliberately not implemented

ISO/IEC 14772-1 4.6.2: *"If multiple nodes are given the same name, each USE
statement refers to the closest node with the given name preceding it."*

That is a **fully specified, deterministic language rule** — not a heuristic —
and it is recorded as normative-explicit in `standards-model.md`. The prototype
still returns `ambiguous` for that case and does **not** pick the closest
declaration.

The reason is that the resolver's consumers are identity, rename and refactoring,
where WD1.4's hard gate applies. Implementing closest-preceding here would place
a ranking function on the exact code path WD1.4 banned ranking from, and a rename
that silently rebinds the *other* `DEF Ball` is precisely the "confidently wrong"
outcome the gate exists to prevent.

**Recorded design decision:** if a future viewer-fidelity feature needs the
browser's answer, it belongs in a separately named `languageSemantics` query with
its own documentation, and it must never feed identity, rename or navigation.
This is a genuine strictness gap, and it is a choice, not an oversight.

## 8. Strict standard vs compatibility

Classified, never silently normalised into the language rules.

| construct | occurrences | strict VRML97 | recommendation |
|---|---:|---|---|
| ROUTE inside an MFNode array | 56,449 | not conforming (Annex A `mfnodeValue`) | **parser recovery, already shipped** — keep; classify, never error |
| PROTO/EXTERNPROTO inside an MFNode array | 36 | not conforming | same |
| event bound to an `exposedField` **declaration** (`eventIn X IS someExposedField`) | 1,940 | violates Table 4.4 / 4.8.3 | **compatibility profile** — see below |
| `exposedField` in a `Script` node | 1,577 | forbidden by 6.40 | **compatibility warning** |
| interface declarations in a non-Script node body | 0 observed | not conforming (Annex A) | **compatibility warning** if it ever appears |
| hyphen/plus in identifiers | 61,500 | conforming (Annex A `IdRestChars`) | **standard** — not a compatibility item at all |

### The 1,940 exposedField bindings deserve their own note

Every single access mismatch in the corpus has an `exposedField` on the
**declaration** side: 892 `eventIn IS exposedField`, 662 `field IS exposedField`,
386 `eventOut IS exposedField`. That uniformity was investigated rather than
assumed: the Cybertown `Avatar` PROTO declares essentially its whole interface as
`exposedField` and then binds `eventOut SFTime touchTime IS touchTime`,
`eventIn SFTime G0 IS gesture1`, `field SFVec3f initialPosition IS translation`.

This is genuinely non-conforming — 4.8.3 is explicit that an interface
`exposedField` may be bound only by a definition `exposedField`. It is also
harmless in practice, because an `exposedField` supplies both an eventIn and an
eventOut, and the entire Cybertown avatar system was built this way and ran in
Blaxxun Contact.

The prototype keeps `status: invalid` (the strict answer) but tags the resolution
`compat/event-bound-to-exposedfield-declaration`, so a compatibility profile can
downgrade it to a warning **without the core rule changing**. That separation is
the whole point: strict behaviour and vendor tolerance are different layers.

The remaining **8** mismatches (`field IS eventOut`, `eventOut IS field`) have no
compatibility story and are simply broken.

## 9. Recovery and partial parses

> **This section was rewritten after an external review.** The original claimed an
> *asymmetry* — that a partial tree can prove presence but not absence, so only
> negative results downgrade. That claim was wrong, and §10.3 records the case
> that disproved it.

The correct rule is **symmetric refusal**:

- A partial tree can prove a declaration **exists** somewhere in the text.
- It **cannot** prove **which scope owns it** — and scope membership is the whole
  question a `USE` asks.

Parser recovery *moves scope boundaries*. An unclosed PROTO swallows every
following top-level statement into its body, so the absorbed scope both sees
declarations that were never inside it and — because a PROTO body has no
`defParent` — is blind to the real outer ones. The declaration set of a damaged
scope is therefore untrustworthy in **both** directions.

So in a damaged scope **every lexical answer is withheld** as `recovered`:
positive, negative and unique alike. Schema facts are exempt, because a built-in
node type or a built-in event is a clause-6 fact with no scope dependency.
Ambiguity is left standing: it binds nothing, so it cannot be confidently wrong.

Corpus cost of the correction, all of it confined to the 251 files carrying a
syntax diagnostic:

| | before | after |
|---|---:|---:|
| `use` resolved | 340,661 | 335,211 |
| `use` recovered | 33 | **6,068** |
| `route-node` resolved | 646,062 | 641,917 |
| `route-node` recovered | 2 | **4,147** |

That is 1.6% of USE references moving from an asserted binding to an explicit
refusal. Given the alternative is a silently wrong binding, it is the right
trade — and it leaves the headline property intact: the prototype still never
resolves anything production refuses.

Syntax errors are attributed to the **innermost** containing scope. Without that,
one stray error would mark the document scope recovered and suppress every honest
"not declared" answer in the file. A hard parse cap (`truncated` / `depthCapped`)
is different in kind — the tree is genuinely aborted — so it marks the **entire**
graph unprovable, matching WD1.4 Tier 2's `document-parse-incomplete`.

Three constructs fail closed structurally, with no diagnostic needed:

| construct | reason id |
|---|---|
| PROTO with no provable name | `proto-scope-not-provable` |
| PROTO whose body holds no node statement (Annex A `protoBody` requires one) | `proto-body-not-provable` — 73 in the corpus |
| any scope inside a truncated/depth-capped parse | `document-parse-incomplete` |

## 10. Three prototype defects the evidence found

None was found by inspection. Two came from running the corpus, one from an
external adversarial review. All three now have regression cases **and** tests.

### 10.1 The acyclicity rule was applied too broadly

An early revision flagged `DEF S Script { field SFNode myself USE S }` as
`invalid / self-referential-use` — **489 times** in the corpus.

The standard is precise, and the first reading of it was not. §4.4.2 says a VRML
file contains a directed acyclic graph, but the normative constraint with
consequences is **§4.4.4**: *"The transformation hierarchy shall be a directed
acyclic graph; results are undefined if a node in the transformation hierarchy is
its own ancestor."* And §4.4.4 also says a descendant of a `Script` node is **not**
part of the transformation hierarchy. 4.6.2 points at 4.4.4 by name for exactly
this question.

A Script holding a reference to itself is therefore a **standard idiom**, not a
cycle. Fixed: 450 of the 489 are now
`resolved / self-reference-outside-transformation-hierarchy`; the remaining 41
are real cycles through grouping nodes. Pinned by case `X56` and two tests.

### 10.2 Node-body ROUTE and PROTO statements were being skipped

The parser collects a node body's `ROUTE` / `PROTO` / `EXTERNPROTO` statements
into the node's **`fields`** array (only interface declarations get their own
array). An early revision iterated `node.fields` assuming every entry was a
field, silently dropping **5,444 real ROUTEs** — which then surfaced as 10,888
"unmatched endpoints" in the differential rather than as an obvious crash.

Fixed by dispatching on `type`. ROUTEs rose from 317,933 to 323,377 — exactly the
5,444 — and both unmatched buckets went to zero. Pinned by cases `R57`/`P58`.

**This is the single most important implementation warning for the production
lane** and is repeated in the plan document.

### 10.3 A damaged scope could manufacture a unique binding — the accepted external finding

Raised as a **High** finding in the external review. The reviewer's own example
did not reproduce — in it the ordering rule (`use-before-def`) already refuses,
and contrary to their second finding the PROTO body scope *was* correctly marked
recovered, because `UNCLOSED_BRACE` is reported at the `PROTO` keyword and so
falls inside `Proto.range`.

But the **mechanism** they identified was real, and a constructed case proves it:

```
DEF Foo Group { }              <- stays in document scope
PROTO P [ ] { Shape { }        <- brace never closed
DEF Foo Transform { }          <- absorbed into P's body
Group { children [ USE Foo ] } <- absorbed into P's body
```

| | `USE Foo` |
|---|---|
| brace present (truth) | `ambiguous` — two `DEF Foo` in document scope |
| brace missing (was) | **`resolved` → bound to the Transform** |

Absorption left exactly one candidate visible, and `defParent === null` hid the
other. The old code returned a single confident binding where the honest answer
is ambiguity — a **confidently wrong** result, the one outcome WD1.4's hard gate
forbids.

Fixed by `guardLexical`: any lexical resolution is downgraded to `recovered` when
the scope it was decided in, or the scope holding the declaration it found, could
not be proven. Schema resolutions are deliberately exempt. Pinned by case `X59`
(which asserts *both* the damaged and the undamaged answer) and three tests,
including one that a built-in node type is **not** suppressed by recovery.

**This is why the lane ran an adversarial review at all.** Two of the three
defects would have shipped into the production design document as stated
principles.

## 11. Performance

Node v24, Linux. Scope-graph build over an existing parse, 5 iterations averaged:

| document | chars | parse | scope build | scopes | symbols | refs |
|---|---:|---:|---:|---:|---:|---:|
| `real-smartcar-lite.wrl` | 17,675 | 1.50 ms | 0.28 ms | 1 | 14 | 263 |
| `world/valid70/world.wrl` | 6,929 | 0.49 ms | 1.43 ms | 1 | 0 | 286 |
| `oversized.wrl` | 326,887 | 17.91 ms | 0.32 ms | 1 | 0 | 4 |
| synthetic (200 PROTO, 4,000 DEF/USE, 2,000 ROUTE) | 324,561 | 57.05 ms | **33.52 ms** | 401 | 2,601 | 18,801 |

The whole corpus — 6,242 files, 707 MB, parsed **and** scope-analysed — runs in
~80 s single-threaded.

Scope construction costs **~0.6× a parse** on a deliberately scope-heavy document
and far less on ordinary ones. **Rebuilding the whole graph after each parse is
affordable**, so incremental scope analysis is not needed and should not be built.

Two quadratic hazards were found and removed during the lane (duplicate-ROUTE
detection and the USE differential both used a linear search inside a loop). A
timed test pins the first at under 3 s for 400 ROUTEs.

## 12. Why Outcome A, not B

Outcome B would require a parser or AST metadata change. Each candidate was
tested against the real parser; none survived as a blocker.

| candidate gap | resolution |
|---|---|
| No `incomplete` flag on `Proto` | Not needed. Annex A `protoBody` requires ≥1 node statement, so `body.length === 0` is already non-conforming — the structural signal and the failure signal coincide. |
| No `incomplete` flag on an unclosed node body | Not needed. `VRML023` is reported at the node's own `typeRange`, so range containment attributes it correctly. |
| No flag for a missing interface `[` | Not needed. `VRML020` carries `expected: '['` and lands inside `Proto.range`. |
| `PROTO P []` with no `{` reports outside `Proto.range` | Caught structurally by the empty-body rule above. |
| Interface ownership ambiguous | Not ambiguous. `Proto.interfaces` and `Node.interfaces` are separate arrays on separate node types. |
| Which PROTO encloses an `IS` | Recoverable by traversal position. No AST change. |
| Declaration ordering for D2/P3/R2 | Every range carries `start.offset`; `Proto.range.end.offset` gives P3's boundary. |

**Every rule in `standards-model.md` graded normative-explicit or
normative-derived is implemented and passing against the current AST.**

### The one thing that would be *nicer*, and is not required

Recovery is currently detected through **diagnostic range containment plus
structural invariants** rather than an explicit flag. That works — 58/58 cases,
6,242 files, and a documented fail-closed asymmetry — but it couples a scope
module to diagnostic ranges, which is a real ergonomic cost.

**Optional, deferrable, non-blocking:** an additive `incomplete: true` on `Proto`
and `ExternProto` when brace/bracket recovery fires, mirroring the flag `Node`
already carries. It changes no range, no text, no existing field and no
behaviour. It is a **nice-to-have for a later lane, explicitly not a prerequisite**,
and Outcome A does not depend on it.

## 13. Proposed production design (not implemented)

### Placement

Two new pure modules under `src/vrml/`, matching WD1.3/WD1.4 conventions:

- `src/vrml/symbols.js` — the taxonomy constants and the `Scope`/`Symbol`/
  `Reference`/`Resolution` shapes. Data and predicates only.
- `src/vrml/scope-graph.js` — construction and resolution.

Both **pure and browser-safe**: no `fs`, no Electron, no crypto, no CodeMirror.

### Inputs

Only a parse result (`tree`, `syntaxDiagnostics`, `truncated`, `depthCapped`) and
`node-schema.js`. **Not** the source text, **not** the source map, **not** a
compatibility profile at construction time — the profile is a *rendering* choice
applied to already-tagged resolutions, so one graph serves every profile.

### Minimal public surface

Deliberately small; adding to it is a decision, not a convenience.

| call | returns |
|---|---|
| `buildScopeGraph(parseResult)` | the graph |
| `resolve(graph, referenceId)` | a frozen `Resolution` |
| `referencesTo(graph, symbolId)` | every reference bound to one declaration — the building block for rename and find-all-references |
| `defIsUniqueInScope(graph, symbolId)` | `{unique, reason}` — the scope-aware DEF uniqueness query |
| `SCOPE_KIND` / `SYMBOL_KIND` / `REFERENCE_KIND` / `STATUS` / `REASON` / `COMPAT` | stable constant tables |

Rename planning, ROUTE validation and IS validation are **consumers** of
`referencesTo` and the resolution list — not additional entry points.

### Identity integration (recorded, not built)

WD1.4 Tier 2 currently approximates PROTO-lexical scope from the parse tree's own
PROTO nesting and fails closed where that is insufficient. A scope graph would
let Tier 2 ask `defIsUniqueInScope` instead of computing an opaque `scopeKey`.

Hard constraints on that future change:

1. **The identity contract does not change.** Tiers, statuses, reasons and the
   hard gate stay exactly as accepted.
2. **Production identity must not depend on the scope graph** — it stays usable
   with none present. The scope graph would be an *optional, better* evidence
   source, injected, never required.
3. It may only make Tier 2 **more** conservative or equally so. The corpus shows
   zero cases where scope-awareness newly *resolves* something, so this is a
   safe direction by construction.
4. The 13,181-application conformance sweep must be re-run and must still show
   **zero wrong anchors** before any such change is accepted.

### Diagnostics integration (recorded, not built)

Reuse the existing `Diagnostic` shape and `CODE` table; **do not rewrite it**.
New codes slot into the free range after `VRML044`. Recommended posture:

| condition | severity | note |
|---|---|---|
| duplicate DEF **in one scope** | **warning** | legal per 4.6.2 — the current `VRML040` *error* is the wrong severity **and** the wrong scope |
| USE before DEF | error | advisory-only, per the standing editor posture |
| USE/ROUTE across a PROTO boundary | error | advisory-only |
| ROUTE forward reference | error | advisory-only |
| IS type / access mismatch | error, **downgraded to warning** when tagged `compat/*` | 1,940 real files depend on this |
| anything `recovered` | **not reported at all** | never surface a diagnostic derived from a scope that could not be proven |

`VRML040`–`VRML044` remain advisories that never block a save. This lane proposes
no change to that posture.

### Incremental behaviour

**Rebuild the whole graph after each parse.** §11 shows it costs a fraction of
the parse it follows. Do not build incremental scope analysis.

## 14. External review and adjudication

One read-only adversarial review was run by Ryan through the Antigravity CLI
against this spike at `main` @ `5328262`. It reported 0 blockers, 1 High, 1 Low
and 1 informational finding. Every material finding was reproduced locally before
being accepted or rejected; nothing was taken on assertion.

| # | severity | finding | verdict | evidence |
|---|---|---|---|---|
| 1 | High | A damaged parse can yield a spurious positive `resolved` binding | **ACCEPTED** | The reviewer's own example did **not** reproduce (`use-before-def` refuses first), but the mechanism is real. A constructed case — an unclosed PROTO absorbing a trailing `DEF`/`USE` pair while `defParent === null` hides the outer duplicate — turned an `ambiguous` document into a single confident binding. Fixed by `guardLexical`; regression case `X59` + 3 tests. See §10.3. |
| 2 | Low | `markRecovery()` may miss an unclosed PROTO because the diagnostic falls outside `ownerRange` | **REJECTED as stated, ACCEPTED as a design note** | Disproven for the PROTO case: `UNCLOSED_BRACE` is reported at the **`PROTO` keyword**, which is inside `Proto.range`, so the body scope *is* marked recovered — verified directly. The reviewer's underlying advice (don't depend on diagnostic range containment) is nonetheless the same conclusion this report already reached independently in §12, and is preserved there as the optional `Proto.incomplete` metadata proposal. |
| 3 | Informational | Table 4.4 compatibility classification is sound | **CONFIRMED** | Agrees with §8; no change. |

The review also independently verified candidate/oracle independence, the
two-parent-link scope design, the absence of any ranking or nearest-match
heuristic, IS/ROUTE semantics, determinism, and that no production file was
touched.

**Disagreement preserved:** finding 2 is recorded as rejected-as-stated rather
than silently folded into finding 1, because its stated failure mode does not
occur and a future reader should not go looking for a bug that is not there.

## 15. Boundaries observed

- No White Dune source, binary, fixture, example or algorithm was opened,
  searched or consulted. No `RE-ARTIFACTS`, no `blaxxun-cs-RE`, no `Downloads`,
  no other implementation's code. The guard **throws** rather than skipping, and
  is applied twice independently.
- The ISO mirror was read, never modified. Prose is paraphrased; only short
  identifying phrases are quoted.
- No corpus file was written, moved, copied into the repo, or mutated.
- No production file changed. No dependency, lockfile or package script changed.
- No commit, push, branch, tag, release or PR.
- No scene-tree, inspector, viewport, renderer, editor or UI work.
