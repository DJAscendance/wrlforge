# WD1.5-P1 — the production DEF/USE scope graph (as built)

Two pure modules, `src/vrml/symbols.js` and `src/vrml/scope-graph.js`, plus their
focused tests. **No production consumer is wired to them.** `analyze.js`, the
diagnostics table, node identity, the editor, the renderer, the validator and the
World scanner all run unchanged on their own code paths.

This file records what P1 actually built. The design rationale, the ISO clause
citations and the confidence grades live in
`WD1_5_SCOPE_SEMANTICS_PLAN.md` and `spikes/wd1-scope-semantics/`; nothing here
supersedes them.

---

## 1. Scope of the lane

**Implemented:** scope creation for DEF/USE · DEF declarations · USE references ·
authoritative DEF/USE resolution · `referencesTo` · `defIsUniqueInScope` ·
recovery-aware refusal · stable statuses and reasons.

**Deliberately absent, each its own later lane:** PROTO/EXTERNPROTO type-name
resolution · ProtoInstance validation · PROTO interface members · `IS` ·
ROUTE endpoints and events · Script interfaces · event-type compatibility ·
diagnostics emission · rename planning · identity integration.

PROTO structure is inspected **only** to place DEF/USE scope boundaries.

## 2. API

`buildScopeGraph(parseResult)` returns an **opaque frozen handle**. All state is
module-private, keyed by that handle in a `WeakMap`, so no `Map`, `Set` or index
is reachable from a consumer.

| call | returns |
|---|---|
| `buildScopeGraph(parseResult)` | the graph handle |
| `resolve(graph, referenceOrUseNode)` | a frozen `Resolution` |
| `referencesTo(graph, symbolOrDefNode)` | frozen, source-ordered `Reference[]` |
| `defIsUniqueInScope(graph, symbolOrDefNode)` | frozen `{unique, reason}` |
| `documentScope` · `scopes` · `symbols` · `references` · `resolutions` | frozen, fresh arrays |
| `scopeOf` · `symbolFor` · `referenceFor` | one projection, or `null` |
| `isScopeGraph` · `isResolved` / `isUnresolved` / `isAmbiguous` / `isInvalid` / `isRecovered` | predicates |
| `SCOPE_ERROR` · `NAMESPACE` · `SCOPE_KIND` · `SYMBOL_KIND` · `REFERENCE_KIND` · `STATUS` · `REASON` | frozen constant tables |

**No `nodeSchema` argument.** DEF/USE is purely lexical; built-in node and field
names are clause-6 schema lookups and never lexical symbols, so P1 needs none.
WD1.5-P2 (type names, `IS`, ROUTE events) will need it and may add it.

**Not exposed through `src/vrml/index.js`.** Façade exposure is WD1.5-P4 in the
committed plan (§12), so P1 leaves the facade untouched and a test pins that.

`scopeOf` / `symbolFor` / `referenceFor` are **lookups, not resolutions**: `null`
means "this graph holds no such projection", never "not declared". Only `resolve`
answers a language question, and it always answers with a status and a reason.

### Input validation fails closed

A parse result is required **whole**: `tree` (a `Document` or `null`),
`syntaxDiagnostics` (an array), `truncated` and `depthCapped` (booleans). The
last three are the only evidence a scope has that it cannot be trusted, so they
are **required rather than defaulted** — a caller passing `{tree}` alone would
otherwise get a graph that believes every scope is provable, which fails *open*
and is exactly the state that manufactures a confident binding out of damaged
text.

## 3. Scope model

Scopes are **object identities**. Nothing derives a scope's identity from a name,
a path, a delimiter-joined string or a hash — WD1.4 reproduced a real wrong
anchor from a `/`-joined key, because the tokenizer classifies identifiers by
exclusion and `PROTO A/B` spells the same joined key as `PROTO A { PROTO B }`.

| scope | `defParent` | `typeParent` |
|---|---|---|
| `document` | `null` | `null` |
| `proto-body` | **`null`** | the enclosing scope |

`defParent === null` on a PROTO body is not an omission; it **is** ISO/IEC
14772-1 4.8.4. Lookup terminates there because there is nowhere to go, not
because a special case says so. This is **disjointness, not shadowing**, and it
holds in both directions.

`typeParent` is recorded for WD1.5-P2 and **never walked** by P1.

A PROTO body scope is created for a `PROTO` wherever the parser puts one:
top-level, nested, inside a node body (`node.fields`), or inside an MFNode array
(the accepted Cybertown/Blaxxun compatibility path). An `EXTERNPROTO` declares a
node *type*, has no body and carries no field defaults (4.9.1), so it owns no
DEF scope.

## 4. Symbol and reference model

A **DEF symbol** records: kind, namespace, name, declaration AST node, owning
scope object, declaration range, source order, node type, and `visibleFrom` (the
offset from which 4.6.2's "preceding it" is satisfied). Nothing else — no
structural path, no fingerprint, no sibling index, no serialized summary, no
field values. Every one of those is a permanently rejected WD1.4 strategy.

A **USE reference** records: kind, namespace, name, AST node, owning DEF scope,
range, source order, offset, and `insideScript`.

Node types are an equality constraint only, never a namespace member. **Unknown
and vendor node types participate in DEF/USE exactly as standard ones do.**

## 5. Resolution semantics

In order, for a USE:

1. no name recovered → `invalid / missing-name`
2. more than one **preceding** declaration → `ambiguous / duplicate-def-in-scope`
3. exactly one, and the USE sits inside the node it names →
   `resolved / self-reference-outside-transformation-hierarchy` under a Script
   (4.4.4 puts a Script's descendants outside the transformation hierarchy),
   otherwise `invalid / self-referential-use`
4. exactly one otherwise → `resolved / ok`
5. declared in this scope but only later → `invalid / use-before-def`
6. declared only beyond a PROTO boundary →
   `unresolved / def-not-visible-across-proto-boundary`
7. otherwise → `unresolved / def-not-declared-in-scope`

A symbol is attached **only** on `resolved`. Ambiguity is decided on the **name
alone**, before node type is considered: narrowing duplicates by type and taking
the survivor is how a confident wrong answer gets produced.

### The rule this resolver refuses to implement

4.6.2 states the browser's answer exactly — a `USE` binds the **closest preceding**
declaration. That is normative-explicit, it is recorded, and this resolver still
returns `ambiguous`. Its consumers are identity, rename and refactoring, where
silently rebinding the other `DEF Ball` is precisely the failure WD1.4's gate
exists to prevent. If viewer fidelity ever needs the browser's answer it belongs
in a separately named `languageSemantics` query that never feeds identity, rename
or navigation.

## 6. Recovery — symmetric refusal

**A damaged scope withholds every lexical answer: positive, negative and unique
alike.** A partial tree can prove a declaration *exists*; it cannot prove *which
scope owns it*, and scope membership is the whole question a USE asks. Parser
recovery moves scope boundaries — an unclosed PROTO swallows the following
statements into its body, so the absorbed scope sees a declaration set that never
existed and, having no `defParent`, is blind to the real outer one.

A scope is recovered when:

| trigger | reason |
|---|---|
| `truncated` / `depthCapped` — the whole graph | `document-parse-incomplete` |
| an error diagnostic inside it | `scope-recovered` |
| a PROTO with no provable name | `proto-scope-not-provable` |
| a PROTO body with no node statement (Annex A `protoBody`) | `proto-body-not-provable` |
| an error **no scope contains** — the whole graph | `scope-recovered` |

Errors are attributed to the **innermost** containing scope. Without that a
single stray error would mark the document scope recovered and suppress every
honest "not declared" answer in the file. Recovery **never** falls back to an
enclosing scope, and `defIsUniqueInScope` in a recovered scope answers
`{unique:false}` with the recovery reason — declining to assert uniqueness, not
asserting duplication.

The last row was added after an external adversarial review (§12). An error
lying outside `tree.range`, or carrying no range at all, has no innermost
containing scope; dropping it would leave every scope marked clean on the
strength of damage the model just admitted it could not place — fail-open by
construction. Unlocalized damage is unlocalized, so the **whole graph** fails
closed, as it already does for a hard parse cap. A document-scope-only fallback
would be insufficient: a PROTO body has no `defParent`, so marking the document
protects nothing inside one.

## 7. Cross-graph object safety

Every projection is branded with the opaque owner token of the graph that minted
it, in a module-private `WeakMap`. **Shape is not proof**: a hand-rolled object
with a valid shape, or a projection from a different parse of byte-identical
text, is rejected with a structured error (`ESCOPEGRAPH` / `ESCOPEPARSE` /
`ESCOPEREF` / `ESCOPESYMBOL`). Membership is object identity and nothing else —
no id, no name, no hash, no path is compared. Shape predicates
(`isScopeShape`, …) exist separately and never authorize a lookup.

## 8. Known, deliberate limits

1. **PROTO interface defaults are not traversed.** A DEF written inside
   `PROTO P [ field SFNode d DEF X Shape {} ] { … }` is invisible, so a USE of it
   answers `unresolved` rather than binding. Which scope owns such a declaration
   is an interpretation question the committed standards model does not settle,
   and interpretation-grade behaviour fails closed. A *node's* own interface
   defaults **are** traversed — the owning scope is not in doubt there. Pinned by
   test so the limit stays deliberate.
2. **Recovery attribution is coarser than the research prototype's**, because P1
   creates no interface scopes. An error inside a Script or EXTERNPROTO interface
   is attributed to the enclosing DEF scope instead of to that interface. Strictly
   **more** conservative: it can only turn `resolved` into `recovered`.
3. **No incremental maintenance**, by design. Rebuild per parse; measured at
   ~0.3–0.4× the parse it follows.

## 9. Determinism

Every published list is sorted by source offset with a codepoint tiebreak — never
`localeCompare`. `sourceOrder` is assigned **after** sorting, because construction
order is not source order (a node's interface defaults are visited before its
fields while the text interleaves them). No clock, no PRNG, no crypto, no
filesystem, no Node-only API. Two builds over one parse agree exactly.

## 10. Conformance results

**The contractual result is `wrong declaration bindings === 0`.** Everything else
in this section is an observation.

Against the committed, independently authored expected-truth cases
(`spikes/wd1-scope-semantics/cases.js`, graded through an adapter **outside** the
repository so no production test imports the spike): **37/37 DEF/USE checks pass,
0 failures, 0 wrong bindings.**

> **The corpus figures below are an OBSERVED SNAPSHOT, not fixed constants.**
> Most of the corpus lives in external workspace trees that change independently
> of this repository, and it has already drifted twice across this lane's
> lifetime. Every run records a fingerprint — SHA-256 over every discovered
> `id:size` — so a future difference is visibly an *input* change rather than an
> unstable analysis. **Snapshot fingerprint: `4d120ed92531d94f`.** The WD1.5
> research spike's snapshot was `2736517340bce330`; the two are different input
> sets, so comparing their totals directly is meaningless.

| | |
|---|---:|
| files analysed | 6,248 |
| characters parsed | 707,614,067 |
| DEF declarations | 694,288 |
| USE references | 342,141 |
| PROTO body scopes | 3,634 |
| recovered scopes | 320 |
| VRML 1.0 files (a different language, counted separately) | 106 |

Production resolution outcomes: 335,257 `resolved` · 6,076 `recovered` ·
760 `ambiguous` · 46 `invalid` · 2 `unresolved`.

Against the research prototype over the same parses: **8 differences in 2 files**,
every one of them `prototype resolved/ok → production recovered/scope-recovered`,
cause confirmed by inspection as limit 2 in §8. **Zero cases where production
resolves anything the prototype refuses**, and **zero wrong declaration
bindings**. Generated conformance output is deliberately not committed.

## 11. What P1 changed, and what it did not

Added: `src/vrml/symbols.js`, `src/vrml/scope-graph.js`,
`test/vrml/symbols.test.js`, `test/vrml/scope-graph.test.js`, this note, and four
`node --check` entries in the `check` script.

Unchanged: parser, tokenizer, AST, source map, edit algebra, node schema, node
identity, `analyze.js`, every diagnostic code and severity, save-blocking
posture, the facade, the renderer, the editor, the preview, the validator, World
scanning, packaging, dependencies and the lockfile. `VRML040`–`VRML044` remain
advisories that never block a save; P1 adds no user-visible diagnostic.

## 12. External review (MiniMax M3, read-only)

One blocker, two mediums, adjudicated against local reproduction:

| finding | verdict | evidence |
|---|---|---|
| **Blocker** — un-attributable error diagnostics leave a damaged document marked clean, producing a confident binding | **Mechanism ACCEPTED, stated cause REJECTED** | The stated cause — diagnostics with a null or `-1` range — does **not** occur: **0** in 6,248 files / 707 MB; the parser derives every range from a token. The reviewer's own `@@@@` example produces a positioned diagnostic and does not reproduce. But the mechanism is real: **6** real corpus files carry an error outside `tree.range` (a stray byte before the header). In all 6, and in every input that could be constructed, a second attributable diagnostic marked the document anyway, so **0** files showed the fail-open outcome. Fixed regardless — the hazard is structural and the measured cost is **zero changed corpus outcomes**. Same call the lane made for `/`-joined scope keys, which also had zero corpus instances. |
| **Medium** — equal-span scopes tie-break non-deterministically | **REJECTED as stated** | Misreading. `markRecovery` marks **every** scope whose span equals the minimum; there is no single winner to tie-break. Ties mark all tied scopes, which is both deterministic and the conservative outcome. |
| **Medium** — the MFNode-depth test is weaker than it looks (one `DEF Ball`, so the assertion cannot discriminate) | **ACCEPTED** | Correct, and about the test rather than the code. The fixture now carries a second `DEF Ball` after the USE, so a resolver ignoring ordering fails it. Verified: a mutant that drops the `visibleFrom` ordering check now fails 5 tests instead of 4. |

The reviewer also confirmed areas 1–4 and 6–14 sound, and independently verified
the absence of ranking, identity integration and analyzer integration.
Disagreement is preserved rather than folded away: the tie-break finding is
recorded as rejected because its stated failure mode does not occur, and a
future reader should not go looking for a bug that is not there.

## 13. Next lane

**WD1.5-P2** — PROTO/EXTERNPROTO type-name resolution, `IS` validation and ROUTE
validation, still with **no consumer wired**. It inherits `typeParent`, which P1
records and never walks. Façade exposure and diagnostics wiring remain P4;
identity integration remains P5 and is gated on re-running the WD1.4 conformance
sweep to zero wrong anchors.
