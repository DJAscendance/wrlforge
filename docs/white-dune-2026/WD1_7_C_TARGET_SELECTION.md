# WD1.7-C — External PROTO target selection and dependency traversal (as built)

The lane that may finally say **RESOLVED**.

WD1.7-B obtains bytes. WD1.7-B2 accounts for the artifacts a World Project
bundle must carry. Neither answers the two questions this lane owns:

> Which PROTO declaration does this EXTERNPROTO candidate select?

> What external-PROTO dependency chain follows from the selected implementation?

Predecessors: `WD1_7_A_EXTERNAL_PROTO_EVIDENCE.md` (contract),
`WD1_7_B_RETRIEVAL_SUBSTRATE.md` (retrieval), and
`WD1_7_B2_WORLD_PROJECT_INTEGRATION.md` (the World Project consumer).

---

## 1. Scope, and where C stops

```
local EXTERNPROTO declaration
  + ordered written candidate URLs        (ISO 4.5.2 / N11)
  + an explicit base document             (ISO 4.5.3 / N12)
  + a WD1.7-B ResolverContext
        |
        v  candidate 0, then 1, then 2 ...
   retrieval (WD1.7-B)          -> bytes + decoded text + provenance
        v
   parse (src/vrml)             -> the ONE syntax authority
        v
   ISO 4.9.3 target selection   -> fragment (N10) or first-PROTO (N8)
        v
   first RESOLVED candidate     -> the walk stops here, and only here
        v
   semantic dependency traversal (WD1.5-P2A instantiations)
        v
   external dependency graph, with cycles on the ratified tuple
```

C **stops before**: ISO 4.9.2 interface subset comparison, implementation-class
derivation, WD1.6-B/C enrichment, compatibility classification, and any
presentation policy. Those are WD1.7-D and WD1.7-E (the latter still **BLOCKED**
on DECISION-1). `compatibility` remains `null` and is not named anywhere in this
lane.

C also **rewrites nothing**. No `EXTERNPROTO → PROTO` substitution, no url
repair, no inlining, no dead-reference replacement (WD1.7-A §11). Every AST
handle a result exposes is a parse-lifetime projection of the caller's own
parse — derived, disposable, never a persistent identity and never written
anywhere (WD.md §2/§7).

---

## 2. Module placement, and why it is split

C is the first lane to span **both sides of the browser boundary**.

| module | side | question |
|---|---|---|
| `src/vrml/proto-target.js` | **pure / browser-safe** | Which PROTO does *this document* supply? What does *this implementation* depend on? |
| `src/proto-resolution/external-resolver.js` | Node | Which *candidate* supplies it? (ISO 4.5.2 walk) |
| `src/proto-resolution/dependency-graph.js` | Node | What *follows* from it? (4.5.3 bases, traversal, cycles) |
| `src/proto-resolution/index.js` | Node | the public facade |

**ISO 4.9.3 is a statement about a document, not about a filesystem.** Given a
parse result and a written fragment, selection needs no URL, no base document, no
archive root and no retrieval — so it lives beside the parser, stays free of
`fs`/`zlib`/`crypto`, and is published narrowly on the `src/vrml` facade as
`protoTarget`. Only the orchestration that walks a candidate list and recurses
across documents is Node-side.

Import direction, asserted mechanically in
`test/proto-resolution/architecture-boundary.test.js`:

```
src/proto-resolution   (Node)
  |-- require('../external-proto')   PUBLIC FACADE ONLY, never an inner module
  `-- require('../vrml')             PUBLIC FACADE ONLY, never parser/scope-graph

src/vrml            unchanged: still loads with no fs, zlib, crypto or electron
src/external-proto  unchanged: acquires no dependency on C
src/world-project   unchanged: does not consume C (see §11)
```

`src/proto-resolution` is **not** inside `src/external-proto/`: B's boundary
audit asserts that directory is exactly its six retrieval modules and contains no
PROTO semantics at all, and that assertion is worth keeping.

---

## 3. The public API

```js
const {
  resolveExternalPrototype, buildExternalDependencyGraph, createResolutionSession,
  RESOLUTION_STATUS, RESOLUTION_REASON, TRAVERSAL_STATUS,
  SELECTION_STATUS, SELECTION_RULE,
} = require('./src/proto-resolution');

// pure, and separately reachable
const { protoTarget } = require('./src/vrml');
// protoTarget.selectPrototypeTarget(parseResult, { fragment })
// protoTarget.externProtoCandidates(parseResult, externProtoAstNode)
// protoTarget.prototypeDependencies(scopeGraph, documentOrProtoAstNode)
```

`SELECTION_STATUS` / `SELECTION_RULE` are re-exported **by object identity**, not
copied: a candidate's `selection.status` and a direct `selectPrototypeTarget`
call must compare equal, and two frozen tables with the same keys would not make
that obvious.

### `selectPrototypeTarget(parseResult, { fragment })`

```
{ status, reason, rule, fragment,
  selectedProtoName, declaration, declarationRange, nameRange,
  matches: [{ name, range }], topLevelProtoCount }
```

### `resolveExternalPrototype({ context, baseDocument, parseResult, declaration, session }, deps)`

```
{ status, reason, declarationName, declarationRange, baseDocument,
  selectedCandidateIndex,
  candidates: [ { index, writtenUrl, range, evaluated, retrieval, selection } ],
  target: { evidenceSourceId, artifactPath, retrievedBytesHash,
            decodedContentHash, wasGzipped,
            selectedProtoName, selectionRule, selectionWasUnique, declarationRange,
            base: { sourceId, path },
            parseResult, declaration } | null }
```

`baseDocument` is **required** and is never inferred (§6). `deps` is B's
injectable fs surface, passed straight through — C performs no filesystem access
of its own.

### `buildExternalDependencyGraph(parseResult, { context, baseDocument, root, instantiationBase, maxDepth }, deps)`

```
{ root: <nodeId>,
  nodes:  [ { id, kind, depth, documentBase, instantiationBase, cycleKey,
              evidenceSourceId, artifactPath, decodedContentHash,
              retrievedBytesHash, wasGzipped, selectedProtoName, selectionRule } ],
  edges:  [ { from, to, declarationName, declarationRange, declaringPrototypeName,
              via, occurrences, baseDocument, traversal, resolution, cycleKey } ],
  cycles: [ { cycleKey, chain, at, declarationName } ],
  incompleteness: [ { reason, at, evidence } ],
  complete, maxDepth }
```

`complete` is **derived**, never assigned: it is exactly
`incompleteness.length === 0`. See *The completeness contract* in §10.

---

## 4. ISO 4.9.3 — fragment-less selection (N8)

> the first PROTO statement found in the VRML file **(excluding EXTERNPROTOs)**

**Top-level means a direct member of the document's statement list**, read off
the AST. Three exclusions fall out of that one rule:

| shape | selected? | why |
|---|---|---|
| `EXTERNPROTO V [] "v.wrl"` before `PROTO T` | **no** | an `ExternProto` is a different AST type; the filter keeps `Proto` |
| `PROTO Outer [] { PROTO Inner ... }` | `Inner` **no** | `Inner` is not in the document's statement list |
| `Group { PROTO Inner ... }` | `Inner` **no** | likewise — and this is why selection reads the STATEMENT LIST, not the scope graph |

The third row is the trap. A PROTO written inside a node body (non-conforming,
accepted by this parser's recovery) *is* in the document's **type scope**, so a
scope-graph-based rule would select it. Statement membership is the structural
fact ISO names.

N8's parenthesis is not decoration:
`3d/externprotos/bxx/shared.wrl` — the most-referenced library in the Cybertown
corpus — opens with `EXTERNPROTO HUD` and only then declares `PROTO BlaxxunZone`.
Including EXTERNPROTOs binds every fragment-less reference to the wrong
prototype. That is mutation control **M1**.

---

## 5. ISO 4.9.3 — fragment selection (N10)

`library.wrl#ProtoName` selects the **top-level** `PROTO ProtoName`:

- **exact written name**, case-sensitive; no trimming, no case folding, no
  nearest match — all three are candidate ranking (WD.md §7);
- EXTERNPROTOs and nested PROTOs are excluded, as above;
- exactly one match → `RESOLVED`;
- zero → `TARGET_PROTO_NOT_FOUND` / `fragment-names-no-top-level-proto`;
- two or more → `TARGET_PROTO_AMBIGUOUS`, binding **nothing**, with every
  matching declaration kept as evidence. The first does **not** win — mutation
  control **M2**.

A written `#` with nothing after it is `TARGET_PROTO_NOT_FOUND` /
`empty-fragment`. It is **not** re-read as a fragment-less reference: switching
selection rules on the author's behalf is exactly the confident-different-answer
the hard gate forbids. It is a property of the reference, so it needs no
document proof and is decided before the document is examined.

### Duplicate names: the two rules are not the same rule

Fragment-less selection identifies **the first statement**, and a later duplicate
of that name does not erase which one was first — `PROTO Dup` twice still has a
first `PROTO Dup`. Fragment selection asks for **the one named X**, and two of
them make the reference unprovable. The lane implements two rules because ISO
states two rules.

---

## 6. The recovery proof gate

Parser recovery may help display damaged source. It may not manufacture target
certainty. Three gates run before either selection rule, and then a per-rule
proof:

| gate | status / reason |
|---|---|
| no parse tree | `TARGET_PARSE_FAILED` / `parse-tree-absent` |
| `truncated` or `depthCapped` | `TARGET_PARSE_FAILED` / `parse-limits-exceeded` |
| no `#VRML` header | `TARGET_PARSE_FAILED` / `no-vrml-header` |

The header gate is how a non-VRML target is represented. ISO 4.9.3/N9 says the
result is **undefined** for a non-VRML file; a headerless artifact is the
strongest locally provable statement of that, and it is reported as its own
reason rather than as a generic damage report. It is **not** called
`ISO_PROHIBITED` — nothing prohibits it.

### Fragment-less: the PREFIX rule

The claim is *"no top-level PROTO precedes this one"*, which depends only on the
text up to the candidate declaration's **end**. So:

> withhold when any ERROR diagnostic starts at or before
> `selected.range.end.offset`.

- Damage **before** the declaration can have absorbed an earlier top-level PROTO
  into an unclosed statement, or promoted a nested one. Withheld.
- Damage **inside** the declaration moves its own extent. An unclosed body's
  `UNCLOSED_BRACE` anchors at the construct's *start*, so it is caught by the
  same offset comparison. Withheld.
- Damage **strictly after** the declaration cannot make an earlier declaration
  appear. **Not** withheld — WD1.7-C brief §13 explicitly warns against blindly
  rejecting unrelated later damage.

### Fragment: the ENUMERATION rule

The claim is *"this is the unique top-level PROTO named X"*. A duplicate could
sit anywhere, so damage anywhere is relevant:

> withhold when any ERROR diagnostic exists in the document.

Reported as `TARGET_PARSE_FAILED` / `top-level-enumeration-unprovable`. The same
rule also guards the fragment-less **assertion of absence**: a damaged document
cannot support "this file declares no selectable PROTO" either, and
`topLevelProtoCount` is reported as `null` rather than `0` in that case.

`RECOVERED` is deliberately **not** a status here (WD1.7-A §10). In P2A/P2B/P2C
it describes a *scope* whose boundaries the parser may have moved; reusing the
word for a damaged external target would make a WD1.6 consumer's `confidence`
check mean two different things.

---

## 7. RETRIEVED is not RESOLVED — the candidate walk

ISO 4.5.2/N11 makes written order normative: entries are "multiple locations to
search in decreasing order of preference". The walk evaluates candidates in
authored order and **continues past every non-terminal outcome**:

```
UNSUPPORTED_REFERENCE · NOT_RETRIEVED_BY_POLICY · NOT_FOUND · UNREADABLE_ARTIFACT
DECODE_FAILED · LIMIT_EXCEEDED · AMBIGUOUS_SOURCE          <- retrieval outcomes
TARGET_PARSE_FAILED · TARGET_PROTO_NOT_FOUND · TARGET_PROTO_AMBIGUOUS  <- C's
```

It **stops on `RESOLVED`, and only on `RESOLVED`.**

The load-bearing case is *candidate 0 retrieved cleanly and then failed
selection*. A resolver that stops on `RETRIEVED` returns the wrong library and
never looks at candidate 1 — mutation control **M3**.

`AMBIGUOUS_SOURCE` continuing is the subtle one: an ambiguous candidate has
resolved nothing, so 4.5.2's "try the next location" still applies. What must
never happen is an ambiguous candidate being silently resolved by picking one of
its targets, and it is not: `selection` stays `null` for it.

**After a candidate resolves, later candidates are not semantically evaluated.**
They keep their place, their index and their written spelling, and carry
`evaluated: false` — they are **not** given a failure status they never earned.

**Every evaluated candidate keeps its own outcome.** Four things stay
distinguishable and are never folded together:

```
artifact unavailable            retrieval.status, selection === null
artifact retrieved, no target   retrieval RETRIEVED + selection TARGET_PROTO_NOT_FOUND
artifact retrieved, bad parse   retrieval RETRIEVED + selection TARGET_PARSE_FAILED
artifact retrieved, ambiguous   retrieval RETRIEVED + selection TARGET_PROTO_AMBIGUOUS
```

### The headline status when nothing resolves

The reported `status` is the **first semantically evaluated candidate's**, because
4.5.2's order is a statement of preference: the most-preferred candidate that
actually produced a document is the one whose failure the author most needs to
see. When no candidate produced a document at all, the result is
`NOT_ATTEMPTED` / `no-candidate-retrieved` — nothing about a target was
established, and saying otherwise would assert a fact nobody proved. Every other
outcome is still in `candidates`, so choosing a headline discards nothing.

---

## 8. Status model — three vocabularies, kept three

| layer | table | values |
|---|---|---|
| **retrieval** (bytes) | `RETRIEVAL_STATUS` (WD1.7-B) | `RETRIEVED` `NOT_FOUND` `AMBIGUOUS_SOURCE` `UNSUPPORTED_REFERENCE` `NOT_RETRIEVED_BY_POLICY` `DECODE_FAILED` `LIMIT_EXCEEDED` `UNREADABLE_ARTIFACT` |
| **resolution** (meaning) | `RESOLUTION_STATUS` (C) | `RESOLVED` `TARGET_PARSE_FAILED` `TARGET_PROTO_NOT_FOUND` `TARGET_PROTO_AMBIGUOUS` `NOT_ATTEMPTED` |
| **traversal** (the walk) | `TRAVERSAL_STATUS` (C) | `EXPANDED` `REUSED` `DEPENDENCY_CYCLE` `DEPTH_LIMIT_EXCEEDED` `CONTEXT_REQUIRED` `NOT_RESOLVED` |

There is **no generic `ERROR`** (WD1.7-A §10). Nuance lives in `reason` values
under a stable status rather than in new statuses.

`DEPENDENCY_CYCLE` is a **traversal** status, not a resolution one, and that is a
decision rather than a filing convenience: a target inside a cycle is still
*proven*. The resolution says so; the edge says the walk stopped.

`RESOLUTION_REASON` adds only what a status cannot carry:
`ok` · `declaration-unprovable` · `no-candidates` · `no-candidate-retrieved`.
The first is B2's gate for the same reason B2 has it — recovery moves statement
boundaries, so a damaged EXTERNPROTO's url list is not provable and no candidate
is retrieved from it.

---

## 9. ISO 4.5.3 / N12 — the base document

> (1) the file in which the prototype is **instantiated**, if the statement is
> part of a prototype definition; … (3) otherwise the file the statement was
> read from.

`resolveExternalPrototype` takes `baseDocument` as a **required** argument and
never infers it. The graph builder computes it, per declaration, from the
declaration's **owning prototype** — which the scope graph already proved
(`symbol.scope.kind === 'proto-body'`, `scope.ownerNode`), never from an AST
ancestor walk.

Each traversal frame carries two bases:

```
frame.documentBase       where THIS frame's document lives           (case 3)
frame.instantiationBase  where this frame's prototype is instantiated (case 1)
```

and the rule is one line:

```js
const base = (declaringPrototype === frame.root)
  ? frame.instantiationBase     // the frame was entered by instantiating it
  : frame.documentBase;         // declared AND instantiated inside this document
```

Which prototype owns the declaration decides which file, so the base **cannot be
a per-frame constant**. Defaulting either way to "the artifact this frame came
from" is right for one case and wrong for the other — mutation control **M6**.

When a child frame is created:

```
child.documentBase      = where the TARGET artifact was retrieved from
child.instantiationBase = frame.documentBase   (the file that declared the
                                                EXTERNPROTO, and therefore the
                                                file the target is instantiated in)
```

### The fixture that pins it

```
worlds/main.wrl   EXTERNPROTO Outer [] "../lib/outer.wrl"   Outer {}
lib/outer.wrl     PROTO Outer [] { EXTERNPROTO Dep [] "dep.wrl"  ... Dep {} ... }
worlds/dep.wrl    PROTO WorldsDep [] { ... }
lib/dep.wrl       PROTO LibDep    [] { ... }
```

`dep.wrl` exists in **both** directories. ISO requires `worlds/dep.wrl`
(`WorldsDep`), because `Outer` is instantiated from `worlds/main.wrl`. The naive
answer — the copy sitting beside the library the statement is written in — is
`lib/dep.wrl`. The suite asserts `WorldsDep` and the M6 mutant produces `LibDep`.

The companion case is also tested: the **same** `lib/outer.wrl` instantiated from
`other/main.wrl` resolves `other/dep.wrl` instead. One library, two instantiation
bases, two different dependencies.

### Missing context

A `Proto` root with no `instantiationBase` yields
`traversal: CONTEXT_REQUIRED`, **no** retrieval attempt, and `complete: false`.
This is the same withholding WD1.7-B2 performs for the same clause — B2 records
`context-required` because a per-document scan cannot know the instantiating
file. **C is the lane allowed to supply it**, and it supplies it only from a
proven semantic instantiation. B2's `context-required` records are *not* globally
converted into resolved dependencies.

---

## 10. Dependency traversal, cycles, and bounds

### Instantiations, not declarations

Traversal follows what WD1.5-P2A **proves**, through
`protoTarget.prototypeDependencies`:

```
node occurrence -> P2A type resolution -> EXTERNPROTO decl  =>  an edge
                                       -> local PROTO decl  =>  traverse THROUGH it
                                       -> built-in          =>  not a dependency
                                       -> anything else     =>  WITHHELD, with
                                                                P2A's own reason
```

There is **no second type resolver**: no name lookup, no nearest declaration, no
first-match, no built-in table of C's own. A duplicate `PROTO`/`EXTERNPROTO`
declaration is `ambiguous` to P2A and therefore `WITHHELD` here, never bound to
either one.

Two traversal rules:

1. **Nested PROTO definitions are pruned.** An implementation is realized where
   the prototype is *instantiated* (4.8.3), so descending into a definition
   nobody instantiates would report dependencies of code that never runs. The
   instantiation, if there is one, is itself a node-type occurrence and is found
   as such.
2. **A local PROTO is traversed through, not reported as an edge.** `via` records
   the chain of local prototype names an external dependency was reached by.

One **edge per declaration**, not per instantiation; `occurrences` keeps the
count, and the first occurrence supplies the span.

### Inherited semantic coverage, and why it changes `complete`

WD1.5-P2A deliberately does **not** descend into PROTO interface *default*
values (`scope-graph.js`, "KNOWN, DELIBERATE LIMITS OF P1", limit 1), so a node
written only as an interface default carries no type reference in the scope graph
and cannot appear as a dependency:

```vrml
EXTERNPROTO DefaultDep [] "dep.wrl"
PROTO Wrapper [ field SFNode thing DefaultDep {} ] { Group {} }
Wrapper {}
```

C does **not** resolve that occurrence. Re-walking the subtree with a private
name lookup is exactly the second type authority this lane refuses to become, and
that refusal is unchanged.

What *did* change (QA finding **F-WD17C-01**, owner adjudication 2026-08-29) is
the **claim C makes about its own walk**. Reporting `complete: true` over a
document whose reached prototypes contain regions C structurally cannot see is a
knowingly false claim, and it is indistinguishable to a consumer from "the region
was examined and held nothing". So:

> When the traversal **reaches** a prototype whose interface defaults contain one
> or more node occurrences, C invents no edge, records the **region** as
> structured evidence, and withholds `complete`.

The gate is a **syntactic coverage audit**, not resolution. It asks one question
of the AST — *does this unindexed region contain a `Node` occurrence at all?* —
and never asks what the written spelling means: not built-in vs. prototype, not
which declaration wins, not whether one exists. `writtenTypeName` is carried as
evidence and is a **token, never a binding**.

It is scoped by shape, not by the mere presence of a default:

| interface member | gate fires? | why |
|---|---|---|
| `field SFFloat amount 1` | no | no node-type occurrence to lose |
| `field SFString label "hello"` | no | ditto |
| `field SFNode thing NULL` | no | an explicit absence, not an occurrence |
| `field SFNode thing USE Somewhere` | no | a `USE` names a DEF, not a type |
| `field SFNode thing DefaultDep {}` | **yes** | an unindexed node occurrence |
| `field SFNode thing Group {}` | **yes** | conservative — see below |
| `field MFNode things [ A {} , … ]` | **yes** | every occurrence counted, nested included |
| any EXTERNPROTO interface member | never | Annex A.2 gives it no defaults at all |

**The built-in row is deliberate conservatism.** C has no authoritative binding
for that position, so it cannot say the occurrence *is* the built-in. False
incompleteness is preferable to false completeness, and reducing the withholding
by adding an ad-hoc name check is precisely the trade this lane will not make. A
later WD1.5 enhancement that indexes those regions would make the gate narrower
or unnecessary; that is a separate lane, and nothing here presumes it.

**Reachability is the dependency walk's own.** The audit rides the same queue as
the traversal rather than re-deriving a boundary that could drift from it, so the
scope is exactly: the root when it is a `Proto`, plus every local PROTO expanded
through. A prototype nothing instantiates is never dequeued — it contributes no
dependency, and it contributes no gap.

### Cycle identity

```
cycleKey = decodedContentHash + NUL + selectedProtoName      (WD1.7-A §10.1, F1)
```

NUL-separated for WD1.4's reason: a separator that can occur inside either
component makes two different pairs collide.

Checked against the **ACTIVE TRAVERSAL STACK ONLY**.

| shape | verdict |
|---|---|
| `A -> A` (same artifact, same prototype) | `DEPENDENCY_CYCLE` |
| `A -> B -> A` across two files | `DEPENDENCY_CYCLE` |
| `library.wrl#Alpha -> library.wrl#Beta` | **legitimate**, `EXPANDED` |
| `library.wrl#Alpha -> #Beta -> #Alpha` | `DEPENDENCY_CYCLE` |
| `Root -> A -> Shared`, `Root -> B -> Shared` | **not a cycle** |

A content-hash-only key rejects the same-file case (**M4**); a global visited-set
rejects DAG reuse (**M5**); a path key fails to close a loop between two archive
paths holding identical bytes. The tuple plus the active stack is the only
combination that gets all three right.

A cycle does **not** make the graph incomplete. Detecting one is a complete and
correct answer about a recursive chain.

### DAG reuse vs. provenance

An already-expanded target is reused (`REUSED`, `to` pointing at the existing
node) only when the target **and both of its base contexts** match:

```
memoKey = cycleKey + documentBase + instantiationBase
```

Collapsing on content alone would erase what WD1.7-A §15.2 forbids erasing: two
byte-identical libraries reached through different locations resolve their *own*
relative references differently, so their subtrees can legitimately diverge. The
diamond fixture (`Root -> A -> Shared`, `Root -> B -> Shared`) therefore produces
**two** `EXPANDED` nodes with the **same** `cycleKey` and different
`instantiationBase` values — reuse is not applied, and neither is a cycle.

### Resource bounds

`maxDepth` is **`null` by default**. WD1.7-A ratified no magic maximum and this
lane invents none: cycles already terminate through the active-stack key, so a
depth bound is resource protection rather than correctness. When a caller sets
one, reaching it produces `DEPTH_LIMIT_EXCEEDED` **and `complete: false`** — a
safety cap may never manufacture completeness. The bound does not unprove the
target: the edge's `resolution.status` is still `RESOLVED`.

### The completeness contract

`graph.complete` is a claim about **the walk**, not about the document:

> No dependency-bearing semantic region this traversal **reached** is known to lie
> outside the semantic authorities C consumes, and no traversal, context or
> resource condition prevented a complete answer.

It is derived from `incompleteness`, so a reason cannot be added without also
becoming visible evidence. Four conditions force `complete: false`, and they
split cleanly in two — the first pair leaves an edge **present** but its subtree
unwalked, the second pair means an edge may be **missing altogether**:

| `INCOMPLETENESS_REASON` | what happened | evidence |
|---|---|---|
| `CONTEXT_REQUIRED` | ISO 4.5.3/N12 case (1) with no known instantiating file | `declarationName`, `declaringPrototypeName`, `range`, `via` |
| `DEPTH_LIMIT_EXCEEDED` | an explicitly configured bound stopped the walk | `declarationName`, `range`, `via`, `depth`, `maxDepth` |
| `UNINDEXED_INTERFACE_DEFAULT` | a reached prototype's interface default holds a node occurrence P2A does not index | the pure layer's region record, verbatim |
| `TYPE_BINDING_WITHHELD` | P2A withheld a type binding **without** proving the name undeclared | `writtenTypeName`, `range`, `via`, `occurrences`, `resolutionStatus`, `resolutionReason` |

Each record is `{ reason, at, evidence }`, where `at` is the graph node whose
region raised it. Evidence is **derived, parse-lifetime** material — names,
spans, counts and P2A's own published status — and carries no hidden persistent
identifier (WD.md §2/§7).

**`TYPE_BINDING_WITHHELD` was adjudicated alongside F-WD17C-01**, because it is
the same false-completeness shape one level down. A `WITHHELD` occurrence is not
an edge, so an enumeration silently omits it. The question is whether that
omission is *provably* harmless, and P2A's own answer decides:

| P2A answer | edge may be missing? | effect on `complete` |
|---|---|---|
| `unresolved` / `node-type-unknown` | **no** — the chain was proven and a whole-scope lookup found zero declarations | stays `true` |
| `recovered` (any reason) | yes — the scope proves nothing | `false` |
| `ambiguous` / `duplicate-proto-declaration` | yes — one of the duplicates could be an EXTERNPROTO | `false` |
| `invalid` / `proto-instance-before-declaration` | yes — a declaration exists, later in the file | `false` |
| `invalid` / `recursive-proto-instance`, `missing-name` | yes | `false` |

The `node-type-unknown` exemption matters in practice: an unrecognised vendor
node type is a very common corpus shape, and it is a **complete** answer — P2A
proved no declaration of that name exists anywhere in the reference's chain, so
nothing is hiding behind it. Every other withheld answer is compatible with a
declaration existing. The exposed field is `declarationMayExist` on the
dependency record; it is a statement about P2A's answer, **not a candidate and
not a binding**.

**Two things are deliberately NOT on the list.** A `DEPENDENCY_CYCLE` is a
complete and correct answer about a recursive chain. A `NOT_RESOLVED` edge was
*enumerated* — it is present in `edges` carrying its own retrieval reason — not
omitted. Neither makes a graph incomplete, and the boundary audit asserts neither
can acquire an incompleteness reason by drift.

### Parse reuse

`createResolutionSession()` returns an **operation-scoped, disposable** parse
cache keyed by `decodedContentHash`. There is no module-level cache: a global one
would outlive the configuration it was built under. What is shared is the
**parse** (a function of the text alone); what is *not* shared is retrieval and
base provenance, for the §15.2 reason above.

---

## 11. Relationship to WD1.7-B and WD1.7-B2

**B is unchanged.** C consumes `retrieveExternalCandidate` through the public
facade only — never `routing.js`, `retrieval.js`, `reference-forms.js`,
`resolver-context.js`, `url-origin.js` or B's `_internals`. B's own boundary
audit gains exactly one allow-list entry
(`src/proto-resolution/external-resolver.js`), which is the deliberate record
that a second consumer now exists.

**B2 is unchanged, and its rule still holds:** package **every locally
retrievable fallback artifact**. That is not in conflict with C selecting one
semantic winner — they answer different questions. B2 must bundle what a viewer
might reach for; C reports what the standard says the reference means. Neither
may be rewritten into the other, and B2's 45 focused tests and 155 World Project
tests are green unchanged.

### World Project recursive asset discovery — `DEFERRED_TO_POST_C_WORLD_PROJECT_CONSUMER`

WD1.7-B2 deferred *assets referenced only inside selected external libraries*
because it could not know which target implementation was selected. C now
supplies that prerequisite, and the deferral is nonetheless **kept**, for three
reasons that are policy rather than semantics:

1. Wiring C into `asset-graph.js` / `package-plan.js` changes **what blocks a
   bundle**. A texture reachable only from a selected library becoming a blocking
   dependency is a packaging-policy decision, not something C's proof settles.
2. It would put **two authorities** in `package-plan.js` over "which artifacts
   drive asset discovery": B2's conservative all-fallbacks inventory and C's
   single semantic winner. §39 requires they stay distinguishable; merging them
   inside a closed module is where that distinction gets lost.
3. It requires re-entering the World Project asset walker with a *different
   referrer and base* mid-scan — a materially broader change to a closed lane
   than a thin consumer.

Per WD1.7-C brief §38 the core is proven first and the packaging integration gets
its own approved lane. Nothing in C is weakened to accommodate it: the resolver
and the graph are general, take an explicit context, and are not coupled to any
profile. Today **no production module consumes C**, and the boundary audit
asserts it.

---

## 12. Strict WD1.6 semantics are untouched

C adds external evidence. It does not mutate a strict-local answer.

`WD1.6-C` still answers an EXTERNPROTO child
`UNSUPPORTED` / `externproto-class-not-locally-verifiable`, and the suite asserts
it explicitly. `interface-query.js`, `containment.js` and `semantic-findings.js`
contain no reference to retrieval, to orchestration or to a resolver context, so
there is no path by which an external fact could reach them. WD1.7-D will add
external evidence *alongside* the strict result, containing it verbatim.

---

## 13. Tests

| suite | tests | of which added by the F-WD17C-01 correction |
|---|---|---|
| `test/vrml/proto-target.test.js` | 56 | 15 |
| `test/proto-resolution/external-resolver.test.js` | 21 | — |
| `test/proto-resolution/dependency-graph.test.js` | 23 | — |
| `test/proto-resolution/graph-completeness.test.js` | 17 | 17 (new file) |
| `test/proto-resolution/mutation-controls.test.js` | 10 | 3 |
| `test/proto-resolution/architecture-boundary.test.js` | 24 | 2 |
| **new total** | **151** | **37** |

Full suite: **1464 → 1615**, 0 failures, 0 skipped. `npm run check` exits 0.
(The pre-correction C total was 114 / 1578.)

Fixtures are **real files on a real filesystem** under the OS temp directory
(`test/proto-resolution/fixture-archive.js`), because exact-case lookup, symlink
containment and gzip-by-magic are B's contracts and C must be proven to sit on
top of them rather than around them.

### Mutation controls

Each takes the **current** production source, applies one targeted defect, and
loads the result from a temp directory with relative requires rewritten to
absolute paths — so only the mutated module differs from production, and the
repository is never altered. Every substitution must match **exactly once**, so a
mutation whose anchor was reworded fails loudly instead of passing vacuously
(asserted by a control of its own).

| # | defect | expected failure | caught by |
|---|---|---|---|
| M1 | include EXTERNPROTO in N8 selection | binds `VendorThing`, not `ActualTarget` | fragment-less selection tests |
| M2 | first fragment-name match wins | duplicate `#Dup` resolves confidently | ambiguity test |
| M3 | stop the walk on `RETRIEVED` | candidate 1 never evaluated; target with a `null` name | candidate-order tests |
| M4 | cycle key = content hash alone | same-file `Alpha -> Beta` becomes a cycle | same-document tests |
| M5 | global visited-set for cycles | DAG reuse becomes a cycle | shared-dependency test |
| M6 | nested base forced to the declaring file | `LibDep` selected instead of `WorldsDep` | ISO 4.5.3 fixture |
| M7 | graph ignores the reported coverage gap | the QA fixture returns `complete: true` | F-WD17C-01 test |
| M8 | pure detector reports no unindexed region | `coverageGaps` empties, so the graph has nothing to withhold on | coverage-gap tests |
| M9 | graph ignores `declarationMayExist` | a duplicate-declaration document returns `complete: true` | withheld-binding tests |

---

## 14. Corpus / evidence

**No new corpus percentage is claimed.** WD1.7-A §8 is explicit that its probe is
deliberately generous — longest-suffix, case-insensitive, host- and scheme-blind
— and therefore an **upper bound on discovery**, not a production resolution
rate. Turning it into one would require an authoritative origin/root
configuration that does not exist, and inventing archive mappings to produce a
success percentage is exactly what WD1.7-C brief §46 forbids.

What this lane rests on instead is reproducible in-repo evidence: 114 focused
tests over synthetic normative fixtures, six live mutation controls, and the
predecessor measurements C did not re-derive and does not restate as its own
(B2's 1,667 declarations / 2,672 candidates, and the corrected classification
table). The B/B2 baseline — `absolute-http 1,116`, `bare-relative 661`,
`urn 513`, `root-relative 189`, `parent-relative 145`, `dot-relative 43`,
`empty 5` — is unchanged by this lane.

---

## 15. Open risks

| risk | class | note |
|---|---|---|
| PROTO interface **default values** carry no type reference in the WD1.5 scope graph, so a dependency written only as an interface default is invisible to traversal | INHERITED LIMIT, **DISCLOSED** | QA finding **F-WD17C-01**. C still creates no second resolver for the region — it reports the region and withholds `graph.complete` (§10, *Inherited semantic coverage*). Closing the limit itself means changing the scope graph, which is a separate WD1.5 lane; until then the conservative gate stands, including for occurrences that would turn out to be built-ins |
| The coverage gate can withhold completeness for a node default that holds only a **built-in** | ACCEPTED CONSERVATISM | C has no authoritative binding for that position; reducing the withholding needs an ad-hoc name check, which is the second type authority the lane refuses. False incompleteness is preferable to false completeness |
| `externProtoCandidates` duplicates ~20 lines of AST reading with `src/world-project/externproto-deps.js`'s `writtenCandidatesOf` + damage check | NON-BLOCKING | both read the same AST fields, so there is no second *grammar*; consolidating means editing closed B2 and was not done here |
| World Project recursive asset discovery inside a selected library | `DEFERRED_TO_POST_C_WORLD_PROJECT_CONSUMER` | §11 |
| ISO 4.9.2 interface subset comparison, implementation-class derivation | `DEFERRED_TO_D` | not started, and mechanically excluded by the boundary audit |
| `compatibility` classification | `DEFERRED_TO_E` | BLOCKED on DECISION-1; the slot stays `null` and no profile is named |
| `WD.md` §3's status table still shows WD1.5-P2C as "implemented, uncommitted" and does not list the WD1.7 lanes | `DEFERRED_TO_STALE_DOC_LANE` | outside this lane's scope; no broad stale-doc cleanup performed |
