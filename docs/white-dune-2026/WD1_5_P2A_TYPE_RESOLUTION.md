# WD1.5-P2A — PROTO/EXTERNPROTO type-name resolution (as built)

An additive lane over the committed WD1.5-P1 scope graph: the **node-type**
namespace, resolved. Two production files change (`src/vrml/symbols.js`,
`src/vrml/scope-graph.js`), one focused test file is added, and **no production
consumer is wired to any of it.** `analyze.js`, the diagnostics table, node
identity, the editor, the renderer, the validator and the World scanner all run
unchanged on their own code paths.

The design rationale, the ISO clause citations and the confidence grades live in
`WD1_5_SCOPE_SEMANTICS_PLAN.md` and `spikes/wd1-scope-semantics/`; nothing here
supersedes them. `WD1_5_P1_SCOPE_GRAPH.md` remains accurate for DEF/USE.

---

## 1. Scope of the lane

**Implemented:** built-in node-type lookup through the committed WD1.3 schema ·
`PROTO` declaration symbols · `EXTERNPROTO` declaration symbols · node-type
references from node/ProtoInstance syntax · type-name resolution · declaration
ordering · type-scope visibility through `typeParent` · duplicate and ambiguous
handling · recursion · recovery-aware refusal · listing references to a
declaration · stable statuses and reasons.

**Deliberately absent, each its own later lane:** PROTO interface fields ·
EXTERNPROTO interface validation · `IS` · Script interfaces · ROUTE endpoints and
events · event direction and type compatibility · diagnostics emission ·
analyzer/validator integration · identity integration · façade exposure · rename
· scene tree · any WD2 work.

VRML97 has **no distinct `ProtoInstance` syntax**. A prototype instance *is* a
node statement whose type token happens to name a declared prototype, so exactly
one node-type reference is minted per `Node`, and which of the three things that
name denotes is the question resolution answers rather than a fact the parser
supplies.

## 2. Namespace separation

The load-bearing rule of the lane, and the usual way VRML97 scope is got wrong.

| namespace | declared by | referenced by | P2A |
|---|---|---|---|
| node name | `DEF` | `USE`, ROUTE endpoints | P1 |
| **node type** | **`PROTO`, `EXTERNPROTO`** | **a node instance's type token** | **P2A** |
| interface member | PROTO/Script `field`/`eventIn`/`eventOut`/`exposedField` | `IS`, ROUTE event parts | P2B |

Built-in node names are **not lexical symbols at all** — they are clause-6 schema
lookups. `Transform` is declared nowhere in a file, so asking a scope graph to
"resolve" it lexically is a category error.

The two namespaces share **scope objects** and share nothing else: separate
symbol lists, separate reference lists, separate name maps, separate accessors.
`DEF Ball Ball { }` under `PROTO Ball` is one DEF and one type reference to one
PROTO, none of them a duplicate of any other. A single merged name map would
make them collide, and each would then be reported as a duplicate of the other.

Field names, event names, Script interface names and ROUTE endpoint names are
**not** type declarations and never enter this namespace.

## 3. The type-scope model

**P2A adds no new scope kind.** A "type scope" is not a new region: it is the
existing `document` / `proto-body` scope viewed through its **second, independent
parent link**, which P1 recorded and never walked.

| scope | `defParent` (node names) | `typeParent` (node types) |
|---|---|---|
| `document` | `null` | `null` |
| `proto-body` | **`null`** — 4.8.4 disjointness | the **enclosing** scope |

Node-name lookup stops at a PROTO boundary because there is nowhere to go. Type
lookup walks **outward**, because 4.8.4 restricts where a nested declaration is
*visible* (P5) without blinding a nested body to its enclosing declarations (P6).
The two walks never consult each other's link, and a test pins that: a PROTO body
has `defParent === null` yet still resolves an enclosing PROTO type.

A `PROTO`/`EXTERNPROTO` declares into the scope it is **written in**, never into
the body it opens — so a nested `PROTO Knob` belongs to its outer PROTO's type
scope, and the document cannot see it.

Scopes remain **object identities**. Nothing derives a scope's identity from a
name, a path, a delimiter-joined string or a hash. WD1.4 reproduced a real wrong
anchor from a `/`-joined key, because Annex A defines `Id` by exclusion and
`PROTO A/B` spells the same joined key as `PROTO A { PROTO B }`. Both spellings
are tested here and cannot meet. Two same-named PROTOs produce two distinct scope
objects; a nameless one enters no name map at all and so can neither be found nor
collide.

## 4. Built-in types come from the committed schema, and nowhere else

`isVRML97Node(name)` from `src/vrml/node-schema.js` is asked, and its answer is
used. P2A holds **no second built-in list** — a duplicated table would drift the
moment the schema is regenerated — and a test asserts that no built-in node name
appears as a literal anywhere in the resolver.

How the committed schema distinguishes the four cases, **measured rather than
assumed**:

| class | how the schema says so | count |
|---|---|---:|
| VRML97 built-in | `isVRML97Node(name) === true` | 54 |
| shared VRML97/X3D | every one of the 54 carries `profiles: ['vrml97','x3d']` | 54 |
| **X3D-only node type** | **none exist in the committed schema** | **0** |
| unknown / vendor | `getNodeSchema(name) === null` | — |

WD1.3's "232 X3D-only" figure counts **fields**, not nodes. So an X3D node name
that VRML97 does not have (`MetadataString`) is simply *unknown* here — which is
the correct strict answer, and is reached without P2A redesigning or duplicating
the distinction. P2A consumes the schema's classification; it does not restate it.

## 5. Declaration order, duplicates and recursion

Resolution order for one node-type reference. Each step is load-bearing.

| # | condition | answer |
|---|---|---|
| 1 | no name recovered | `invalid / missing-name` |
| 2 | a declaration of this name **encloses** the reference | `invalid / recursive-proto-instance` |
| 3 | more than one declaration of this name **anywhere in the chain** | `ambiguous / duplicate-proto-declaration` |
| 4 | exactly one, already complete | `resolved / ok` (+ `detail: proto-shadows-builtin`) |
| 5 | declared in a visible scope but only later | `invalid / proto-instance-before-declaration` |
| 6 | a clause-6 built-in spelling | `resolved / node-type-is-builtin` (no symbol) |
| 7 | otherwise | `unresolved / node-type-unknown` |

**The whole table is reached only when the recovery gate has passed** (§6). Steps
2–7 are all lexical claims — ambiguity included — and none may be made from an
unprovable `typeParent` chain.

**Visibility is completion, not naming.** A declaration's `visibleFrom` is the
**end offset of the whole declaration** (4.8.4, "after the completion of the
prototype definition"), compared with `<=`. This is a *different rule* from
4.6.2's DEF visibility, which starts at the name token, and must not be copied
from it. The two almost always agree, because an instance between a declaration's
name and its closing brace is enclosed by it and step 2 answers first — so the
boundary is pinned by a direct assertion rather than left to coincide.

**Recursion is checked before ordering** (step 2 before step 5). 4.8.4 states two
separate rules — instantiate only after completion, and never inside the
definition — and an instance inside its own body breaks both. Recursion is the
specific and useful diagnosis; the ordering rule would otherwise always win,
since a definition is never "complete" inside itself.

**Duplicates are decided on the NAME ALONE, over the WHOLE scope.** 4.8.1 makes
duplicate type names undefined behaviour, and the resolver refuses to choose. It
never narrows by: declaration kind (`PROTO` vs `EXTERNPROTO`), built-in status,
body shape, interface count, declaration order, or position. Each of those was
mutation-tested as a live tiebreak and each is caught.

The **whole-scope** part is a deliberate conservatism worth stating plainly.
Ambiguity is judged over every same-name declaration the chain owns — *not* over
those already visible at the reference's offset. So in

```
PROTO P [ ] { Box { } }
P { }                      <- ambiguous, not bound to the first declaration
PROTO P [ ] { Cone { } }
```

the middle reference is refused. It is not a well-defined reference that happens
to be followed by a problem: 4.8.1 leaves the file's binding for `P` undefined the
moment the second declaration exists. Binding it by position would also make
`resolve` disagree with `typeDeclIsUniqueInScope`, which has always answered over
the whole scope — and two queries giving different accounts of one duplicate is
how a caller ends up trusting the wrong one. **`resolve`, `referencesTo` and
`typeDeclIsUniqueInScope` therefore share one policy**; `referencesTo` follows for
free, since only `resolved` results are indexed.

A same-name declaration in a *nested* scope is a different matter and is **not** a
duplicate of its outer namesake (4.8.4 P5 makes a nested prototype local to its
enclosing prototype). Each is unique where it is, and `typeDeclIsUniqueInScope`
says so for both. A *reference* that can see both still gets `ambiguous` rather
than the innermost — the same strictness gap the plan records for DEF, since
ranking is what the hard gate forbids.

Mutual recursion needs no special case: `A` cannot instantiate `B` before `B`
completes; `B` may instantiate `A`, which is complete and does not enclose it.

**A built-in spelling used before a later same-spelling declaration is refused**
(`invalid / proto-instance-before-declaration`), not reported as the built-in.
4.8.1 leaves that undefined and the committed plan establishes no result for it,
so it fails closed. Claiming `node-type-is-builtin` there would assert the file's
own declaration out of existence. The same holds for `EXTERNPROTO`.

**A local declaration outranks the schema** when it takes a built-in's spelling.
4.8.1 calls that undefined; the lexical declaration is what the file actually
says, so it takes the binding and the collision is reported as `detail`, which
never changes the status, the reason or the bound declaration. A consumer that
ignores `detail` is correct.

## 6. Recovery — the same symmetric refusal, extended

**A damaged scope withholds every lexical type answer: positive, negative and
unique alike.** A partial tree can prove a declaration *exists*; it cannot prove
*which scope owns it*, and scope membership is the whole question. Parser
recovery moves scope boundaries — an unclosed PROTO swallows the following
statements into its body, so the absorbed scope sees a declaration set that never
existed.

- a reference in a damaged scope → `recovered`
- a reference whose **declaration's** scope is damaged → `recovered`, even when
  the reference's own scope is clean (both ends must be provable; this path is
  separately tested and separately mutation-tested)
- a reference whose own scope is clean but whose **`typeParent` chain crosses a
  damaged scope** → `recovered` (see below)
- a hard parse cap (`truncated`/`depthCapped`) → the whole graph withholds
- `typeDeclIsUniqueInScope` in a damaged scope answers `{unique:false}` with the
  recovery reason — declining to assert uniqueness, not asserting duplication
- damage never falls back to another scope, and a nested declaration never leaks
  outward through it

### The whole chain must be provable

A DEF lookup never leaves its own scope — `defParent` is null on a proto body —
so P1's guard, which checks the reference's scope and the found declaration's
scope, sees everything a DEF answer depends on.

A type lookup is different in kind: it **walks outward** along `typeParent`
(4.8.4 P6). Its answer therefore depends on every scope in that chain, including
ones it never had to read — because it found an answer sooner, or found none at
all. Any unprovable link can hold a same-name declaration that would have changed
the answer:

```
Group { children [ Shape { }        <- brace never closed: document scope damaged
PROTO Inner [ ] { Transform { } }   <- Inner's OWN body scope parses clean
```

`Transform` sits in a provably clean scope, so a scope-local guard is satisfied —
yet the answer depends on there being no `PROTO Transform` in the document scope,
which is exactly the scope that cannot be proven. `guardTypeChain` closes this for
every lexical answer.

### Schema fact vs occurrence binding

Plan §7 exempts "schema resolutions" from recovery. That exemption is correct **for
the schema question** and P2A keeps it: `nodeSchema.isVRML97Node(name)` answers
"is this spelling a clause-6 built-in?" with no scope dependency, unguarded, for
any caller, in any document however damaged.

It does **not** extend to the occurrence question. 4.8.1 lets a prototype take a
built-in's spelling, and §5 above honours that — a local declaration outranks the
schema. So `resolved / node-type-is-builtin` is not merely "this spelling is
built-in"; it is the further claim that *no such declaration is in scope here*.
That is a lexical absence claim, and a damaged scope cannot support it.

P2A originally applied the §7 exemption to the occurrence claim. That let three
unprovable answers through, each reproduced and each now a regression test:

| unsafe answer | how it arose |
|---|---|
| `resolved / node-type-is-builtin` | from a directly damaged scope, and via a damaged `typeParent` chain |
| `unresolved / node-type-unknown` | clean own scope, damaged chain — a confident "declared nowhere" |
| `invalid / recursive-proto-instance` | an unclosed body extended a declaration's range over statements it never held, so valid source was called illegal recursion |
| `ambiguous / duplicate-proto-declaration` | recovery merged two scopes, fabricating a duplicate the author never wrote |

### Ambiguity is withheld too

The plan lets **DEF** ambiguity stand under damage, on the ground that it binds
nothing. That does not carry over to node types, and the difference is worth
stating because the first correction to this lane got it wrong.

`ambiguous` binds nothing, but it still **asserts** something: *two or more
declarations of this name share the scope you asked about*. Recovery can
manufacture exactly that, because an unclosed body swallows the statements after
it and merges scopes the author kept apart:

```
PROTO Outer [ ] { PROTO Knob [ ] { Box { } } Shape { }   <- closing brace missing
PROTO Knob [ ] { Cone { } }    <- absorbed into Outer's body
Knob { }                       <- absorbed too
```

Written correctly, the two `Knob`s are in **different** scopes and `Knob { }`
binds the document-level one. One brace short, both declarations and the
reference land in `Outer`'s body, and a resolver that trusts ambiguity reports a
duplicate that does not exist in the source. Withholding costs a diagnosis;
asserting invents one.

### Precedence

Recovery **dominates**, and is asked once, up front — not applied per branch:

1. graph ownership and projection validity (in `resolve`, before this)
2. is the name token present? — a token fact, not a lexical claim
3. **is the document complete and the entire `typeParent` chain provable?** — if
   not, `recovered`, full stop
4. only then: recursion · duplicates · declaration order · local declarations ·
   built-ins · unknown names

The externally observable rule: **no lexical status other than `recovered` may
escape an unprovable type chain** — and under recovery no symbol, no
`candidateCount`, no evidence and no `detail` is returned either.

Structuring this as a gate rather than a wrapper per branch is deliberate. A
per-branch guard is one `return` away from a leak, and this lane leaked twice
that way: the wrapped branches were safe and the unwrapped ones silently were
not.

The P1 attribution rule is unchanged: an error is attributed to the **innermost**
containing scope, so an undamaged sibling PROTO keeps answering. Recovery
attribution stays coarser than the research prototype's, because P2A still
creates no interface scopes — strictly *more* conservative, and the measured
cause of every corpus difference in §10.

## 7. EXTERNPROTO — the declaration name, and nothing else

P2A resolves an `EXTERNPROTO` **declaration name**. It does **not** implement or
claim: complete external interface knowledge, remote resource loading, URL
resolution, network access, external file parsing, interface-member completeness,
or validation against the real implementation. The `url` is data on the AST node
and is never an input to resolution; a test asserts the resolver reaches for no
network or filesystem capability at all.

4.9.2 makes an EXTERNPROTO interface a **subset** of the real implementation's,
so a member absent from the declaration is **unknowable locally, never
authoritative absence**. P2A declares no interface members, so it cannot make
that mistake today — but the declaration symbol carries `interfaceIsSubset: true`
(and `false` for a local `PROTO`) precisely so a later lane cannot mistake local
silence for a proven negative. That is the whole of P2A's EXTERNPROTO interface
handling; the member semantics are P2B.

## 8. Internal API

Additive. Every P1 call keeps its name, its shape and its behaviour.

| call | returns |
|---|---|
| `typeDeclarations(graph)` | frozen, source-ordered `TypeDeclSymbol[]` |
| `typeReferences(graph)` | frozen, source-ordered `NodeTypeReference[]` |
| `typeResolutions(graph)` | frozen `Resolution[]`, in reference source order |
| `typeDeclFor(graph, protoAstNode)` | one declaration, or `null` |
| `typeReferenceFor(graph, nodeAstNode)` | one reference, or `null` |
| `typeDeclIsUniqueInScope(graph, declOrNode)` | frozen `{unique, reason}` |
| `referencesTo(graph, symbolOrNode)` | **generic** — now accepts either namespace |
| `resolve(graph, reference)` | accepts a node-type reference projection |

**Separate accessors, not a merged list.** `symbols`, `references` and
`resolutions` still mean DEF declarations, USE references and USE answers. Folding
both namespaces into one sequence would silently change every existing caller's
counts and would put two unrelated kinds of name in one list.

`referencesTo` stays generic because its meaning does not vary by kind: *every
reference this graph authoritatively bound to this declaration*. A DEF symbol
yields USE references; a type declaration yields node-type references; the two
can never mix, since a reference binds only within its own namespace. Only
`resolved` references appear — an ambiguous, invalid, unresolved or recovered
reference is not "probably this one", and including it is how a rename corrupts a
document.

`resolve` deliberately does **not** coerce an AST `Node`. P1 established that a
`Node` handed to `resolve` is an error, and silently reinterpreting it as
"resolve its type name" would turn an existing refusal into an answer to a
question the caller did not ask. Pass `typeReferenceFor(graph, node)` instead.
`symbolFor` likewise stays DEF-only, and `typeDeclIsUniqueInScope` /
`defIsUniqueInScope` each reject the other namespace's symbol.

A type declaration records: kind, namespace, name, declaration AST node, owning
type scope, declaration range, source order, `isExtern`, `interfaceIsSubset`,
`visibleFrom`. Nothing else — no interface members, no body summary, no
declaration subtree copy, and none of WD1.4's permanently rejected identity
strategies.

**No façade exposure.** `src/vrml/index.js` is untouched; exposure remains
WD1.5-P4, and a test pins its absence.

## 9. Authored-case conformance

Graded through an adapter **outside** the repository, against the committed,
independently authored expected-truth literals in
`spikes/wd1-scope-semantics/cases.js`. No production test imports the spike, and
the research prototype's answers are never used as the grade.

Cases selected (every one with a `node-type` expectation or a
`duplicate-proto-declaration` finding): **D09 P11 P12 P13 P14 P15 P16 P17 P18 P58
X52** — 11 cases, **14 checks, 14 pass, 0 fail**.

Observed across those cases: 26 built-in resolutions · 5 PROTO resolutions · 1
EXTERNPROTO resolution · 2 unresolved · 1 ambiguous · 2 invalid · 0 unsupported ·
0 recovered.

**Wrong declaration bindings: 0.** That is the contractual result; everything
else in this section is an observation.

## 10. Corpus observations

> **A SNAPSHOT, NOT A CONSTANT.** Most of the corpus lives in external workspace
> trees that change independently of this repository. Every run records a
> fingerprint — SHA-256 over every discovered `id:size` — so a future difference
> is visibly an *input* change rather than an unstable analysis.
> **P2A snapshot fingerprint: `ca56568688d2402d`.** P1's was `4d120ed92531d94f`
> and the WD1.5 research spike's was `2736517340bce330`; these are different input
> sets and their totals are not comparable directly. The corpus grew from 6,248
> analysed files at P1 to 6,251 during this lane's first sweep
> (`61462c383d91cd39`) and 6,253 at the adjudication re-run — it drifted twice in
> one day, which is precisely why the fingerprint is recorded.

Read-only, same roots, same boundary guard (a forbidden path **throws**), no
corpus file read outside the approved groups, nothing copied or mutated, and all
generated output kept outside Git.

| | |
|---|---:|
| files discovered | 14,217 |
| unique files analysed | 6,253 |
| characters parsed | 708,550,924 |
| skipped: duplicate content / gzip error / over size cap / empty | 7,950 / 10 / 3 / 1 |
| VRML97 (`#VRML V2.0`) | 6,120 |
| **VRML 1.0 (a different language, counted separately)** | **108** |
| other or missing header | 25 |
| PROTO declarations | 3,634 |
| EXTERNPROTO declarations | 1,279 |
| nested (non-document-scope) declarations | 23 |
| unnamed declarations | 0 |
| type scopes | 9,887 |
| recovered type scopes | 322 |
| **node-type references** | **1,860,213** |

Resolution outcomes: 1,593,969 built-in · 26,207 PROTO · 36,800 EXTERNPROTO ·
3,439 unresolved unknown/vendor · 199,755 recovered · 43 ambiguous · **0
instance-before-declaration** · **0 recursive** · 0 missing-name.

33 duplicate declaration groups. 0 references shadow a built-in.

**The measured price of the §6 chain guard: 74,609 built-in occurrence claims
withheld** — 4.0% of all type references — plus 20 unknown-type answers and 6
prototype bindings. Every one of them sat in or below a scope the parse could not
prove. That is the correct trade against a silently wrong binding, and it is
almost entirely one shape: files whose *document* scope carries a syntax error,
where every node in the file is consequently below an unprovable scope.

**Against the research prototype over the same parses: 74,636 differences.** The
prototype still implements the pre-adjudication contract, so nearly all of them
are the guard itself:

| difference (prototype → production) | count |
|---|---:|
| `resolved/node-type-is-builtin` → `recovered/scope-recovered` | 74,609 |
| `unresolved/node-type-unknown` → `recovered/scope-recovered` | 20 |
| `resolved/ok` → `recovered/scope-recovered` | 6 |
| `ambiguous/duplicate-proto-declaration` → `recovered/scope-recovered` | 1 |

**Every one is production refusing where the prototype answered**; there is no
difference in the other direction. **Zero cases where production resolves
anything the prototype refuses**, and **zero wrong declaration bindings** across
1.86 M references.

Withholding ambiguity under damage cost exactly **2 references** on this corpus
(45 → 43 ambiguous, 199,753 → 199,755 recovered), measured against an unchanged
input fingerprint so the delta is the correction and nothing else. Two is a small
number; the fabricated duplicate in §6 is why it is the right two.

A corpus observation is not a standards rule. Nothing above was promoted into §5.

## 11. Performance

Rebuilt per parse; no incremental analysis, and none may be added.

| source | chars | AST nodes | type scopes | decls | type refs | parse ms | graph ms | type queries ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| small clean, built-ins only | 80 | 9 | 1 | 0 | 4 | 0.02 | 0.01 | 0.00 |
| PROTO-heavy authored | 33,029 | 3,205 | 201 | 200 | 2,601 | 5.92 | 3.16 | 0.08 |
| EXTERNPROTO-heavy authored | 32,209 | 2,605 | 1 | 200 | 2,001 | 3.50 | 2.19 | 0.05 |
| nested-PROTO authored | 36,209 | 3,405 | 401 | 400 | 2,601 | 4.45 | 2.93 | 0.06 |
| large real fixture (`oversized.wrl`) | 326,887 | 33,018 | 1 | 0 | 4 | 38.94 | 0.27 | 0.00 |

Graph construction runs at roughly **0.5× the parse it follows**. Heap delta for
a scope-heavy document is single-digit MB and is released with the graph.

Scaling, on a synthetic declaration-heavy source generated outside the repository
(50→800 declarations, 500→8,000 instances — a 16× range):

| declarations × instances | type refs | graph ms | µs per reference |
|---|---:|---:|---:|
| 50 × 500 | 651 | 0.53 | 0.81 |
| 100 × 1,000 | 1,301 | 1.08 | 0.83 |
| 200 × 2,000 | 2,601 | 1.93 | 0.74 |
| 400 × 4,000 | 5,201 | 4.04 | 0.78 |
| 800 × 8,000 | 10,401 | 10.23 | 0.98 |

Per-reference cost is flat across the range. **No quadratic behaviour**, and no
optimisation was added for a cost that has not appeared.

## 12. Known, deliberate limits

1. **PROTO interface default values are still not traversed** (P1 limit 1,
   inherited unchanged). A node instance written inside
   `PROTO P [ field SFNode d Box { } ] { … }` therefore mints no type reference.
   Which scope owns such a construct is an interpretation question the committed
   standards model does not settle, and interpretation-grade behaviour fails
   closed. The research prototype does not traverse them either.
2. **Recovery attribution is coarser than the prototype's** (P1 limit 2), because
   no interface scopes exist. Strictly more conservative; it is the measured cause
   of all 10 corpus differences.
3. **A vendor type and a forgotten declaration answer alike** —
   `unresolved / node-type-unknown`. P2A cannot tell one from the other, and
   inventing a distinction it cannot prove would be a guess. What it *can* prove —
   that a declaration exists but is not yet visible — has its own status.
4. **Single-file only.** The standard scopes names to one file (D1), so a
   single-file type graph is complete for its own question. `EXTERNPROTO` targets
   and `Inline` children are cross-file and belong to a separate lane.
5. **No consumer, no diagnostics, no façade.** Nothing user-visible changes;
   `VRML040`–`VRML044` remain advisories that never block a save.

## 13. What P2A changed, and what it did not

Added: `test/vrml/type-resolution.test.js`, this note, and one `node --check`
entry in the `check` script. Modified: `src/vrml/symbols.js` (three new kinds, six
new reasons, two new projection factories, two new shape predicates, an additive
`detail` field on a resolution), `src/vrml/scope-graph.js` (type declaration and
reference collection, the `typeParent` lookup, `resolveNodeType`, six new
queries), and two assertions in `test/vrml/symbols.test.js`.

Those two assertions pinned the P1 lane boundary — *"publish no kind you cannot
construct"* — by listing `proto-decl`, `externproto-decl` and `node-type` as
absent. P2A constructs all three, so the invariant is unchanged and the boundary
moved: the three are now pinned as **present** in the table test, and the
absent-list narrowed to what P2B/P2C will build. `src/vrml/symbols.js`'s own P1
header already recorded this as the planned additive change.

### Adjudication changes (post-review, pre-commit)

A targeted review of this lane raised the built-in-under-recovery question of §6
as a possible hard-gate breach. It was one, and the following were changed before
any commit:

1. **Recovery gate added** (`typeChainWithholds`, `scope-graph.js`). Every lexical
   type answer requires the whole `typeParent` chain provable. Closed four
   unprovable answers; §6 has the reproductions. The WD1.3 schema's own authority
   is untouched — `isVRML97Node` still answers, unguarded, for any caller.
   Introduced first as a per-branch wrapper (`guardTypeChain`), which still let
   ambiguity through; restructured into a single up-front gate so no branch can
   leak, and so precedence is a property of the shape rather than of remembering
   to wrap.
2. **Duplicate ambiguity widened to whole-scope** (§5), so `resolve`,
   `referencesTo` and `typeDeclIsUniqueInScope` share one policy instead of two.
3. **Built-in-before-later-declaration pinned** as `invalid /
   proto-instance-before-declaration` (§5) — previously untested behaviour.
4. **25 tests added**, 65 → 90, including a regression test per defect; each was
   confirmed to fail against the resolver it corrects. Two existing P2A tests were
   rewritten because they encoded the defective contract.
5. A dead duplicate `case NODE.EXTERNPROTO:` label in `visitValue` was removed —
   unreachable, behaviour-neutral, introduced by this lane.

No public API was added or removed for any of it, and no consumer was wired.

Unchanged: parser, tokenizer, AST, source map, edit algebra, generated node
schema, node identity, `analyze.js`, every diagnostic code and severity,
save-blocking posture, the façade, the renderer, the editor, the preview, the
validator, World scanning, packaging, dependencies, the lockfile, the package
version, and every other npm script. No fixture and no corpus file was mutated,
and no White Dune or RE material was accessed.

## 14. Next lane

**WD1.5-P2B** — PROTO/EXTERNPROTO **interface members** and `IS` validation
(4.3.5, 4.8.2, 4.8.3, Table 4.4, 6.40), including the EXTERNPROTO subset rule
this lane records but does not act on. **WD1.5-P2C** — ROUTE endpoints, event
names, directions and type compatibility. Still with no consumer wired. Façade
exposure and diagnostics wiring remain P4; identity integration remains P5 and is
gated on re-running the WD1.4 conformance sweep to zero wrong anchors.
