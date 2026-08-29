# WD1.7-D — External PROTO Interface & Class Enrichment (as built)

**Status:** implemented, uncommitted, awaiting independent QA.
**Predecessor:** WD1.7-C (`WD1_7_C_TARGET_SELECTION.md`), closed at `562a4f4`.
**Successor:** WD1.7-E — compatibility classification — remains **BLOCKED**.

---

## 1. What D is for

WD1.6 answers every semantic question it can answer from the document in front of
it. Two it deliberately could not:

| question | clause | WD1.6's strict answer |
|---|---|---|
| Does the local `EXTERNPROTO` interface agree with the implementation? | 4.9.2 | not asked — the implementation is not present |
| What class does an `EXTERNPROTO` instantiate as? | 4.8.3 | `UNSUPPORTED` / `EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE` |

WD1.7-C now proves *which* implementation an `EXTERNPROTO` refers to. D consumes
that proof and answers both, as **evidence sitting beside** the strict answers.

### The governing rule

> **External evidence may ENRICH a strict-local semantic answer. It may never
> silently MUTATE one.**

Structurally, not by promise. No WD1.6 query accepts a resolver context, a
dependency graph or an evidence argument — `childLegality` still takes four
arguments and `protoImplementationClass` two, and neither has a parameter through
which evidence could arrive. Nothing in `src/vrml` requires `src/proto-enrichment`
or `src/proto-resolution`. The strict verdict D *reports* is obtained by calling
the strict authority with the arguments a caller holding no evidence would use.

---

## 2. The pipeline, and where D stops

```
local EXTERNPROTO declaration
        +
WD1.7-C selected-target proof   (artifact, PROTO, base, parse, declaration)
        |
        +--> declared interface comparison        ISO 4.9.2   -> external.interface
        |
        +--> external implementation class        ISO 4.8.3   -> external.implementationClass
        |         (continuing through C's PROVEN edges when the
        |          first body node is itself an EXTERNPROTO)
        v
provenance-bearing external semantic evidence
        +
strictLocal (unchanged, independently observable)
        +
compatibility: null                                            <- WD1.7-E, BLOCKED
```

**D stops there.** It does not retrieve, select a target, route a URL, compute an
ISO 4.5.3 base, traverse dependencies, decide UI severity, write a message, alter
`childLegality`, touch World Project packaging, or name a compatibility profile.

---

## 3. Module placement

| module | side | owns |
|---|---|---|
| `src/vrml/proto-agreement.js` | **pure**, browser-safe | ISO 4.9.2 declared-interface comparison over two scope graphs |
| `src/vrml/containment.js` | **pure**, browser-safe | ISO 4.8.3 — now reachable from a declaration as well as an occurrence |
| `src/proto-enrichment/external-enrichment.js` | **Node** | consuming C's proof and graph; composing the two answers |
| `src/proto-enrichment/index.js` | **Node** | the D facade |

4.9.2 is a statement about **two documents**, not about a filesystem — it takes
two parses and two declarations and has never heard of a URL, a base, an archive
or a retrieval. So it lives beside the parser, exactly as WD1.7-C's pure selector
does. The import direction is strictly downward:

```
src/proto-enrichment  ->  src/proto-resolution  ->  src/external-proto
        `------------->  src/vrml  <-------------------------'
```

`src/vrml` requires none of them, stays free of `fs`/`zlib`/`crypto`, and is
asserted so in a child process by both boundary suites.

---

## 4. Public API

| symbol | where | why |
|---|---|---|
| `protoAgreement.compareInterfaceAgreement(localGraph, localDecl, targetGraph, targetDecl)` | `src/vrml` | the 4.9.2 answer; pure, so a renderer-side consumer can use it |
| `protoAgreement.notAttempted(localDecl)` | `src/vrml` | the record for a caller whose C outcome proved no target — so `NOT_ATTEMPTED` is constructed by the owner, not spelled by each consumer |
| `protoAgreement.AGREEMENT_STATUS` / `MEMBER_STATUS` / `AGREEMENT_FINDING` / `AGREEMENT_BASIS` / `AGREEMENT_REASON` | `src/vrml` | the tables a consumer must branch on |
| `containment.protoImplementationClass(graph, declAstNode)` | `src/vrml` | ISO 4.8.3 entered at a **declaration**; published so that an externally proven class is not derived by a second implementation |
| `enrichExternalPrototype(params)` | `src/proto-enrichment` | the one D operation |
| `createEnrichmentSession()` | `src/proto-enrichment` | an operation-scoped, disposable scope-graph cache; optional, never global |
| `ENRICHMENT_STATUS` / `ENRICHMENT_REASON` / `EXTERNAL_CLASS_STATUS` / `EXTERNAL_CLASS_REASON` | `src/proto-enrichment` | D's own branching tables |
| the five `AGREEMENT_*` tables | `src/proto-enrichment` | re-exported **by identity** from `src/vrml`, so one import suffices and the two can never be different objects |

Nothing else is exposed. The class walk, the provenance projector and the
dependency-graph lookups are this lane's composition, not its contract.

---

## 5. ISO 4.9.2 — the direction is the whole rule

> "The names and types of the fields and events of the EXTERNPROTO … shall be a
> **subset** of those defined in the prototype definition." — 4.9.2

```
local  ⊆  target
```

| situation | verdict |
|---|---|
| target declares the same member | member `SATISFIED` |
| target declares **more** than the local declaration | **conforming.** No finding. Counted in `targetOnlyMemberCount` |
| target declares no member of that name | `MEMBER_MISSING`, basis `ISO_4_9_2`, member `VIOLATED` |
| name matches, declared field type differs | `TYPE_MISMATCH`, basis `ISO_4_9_2`, member `VIOLATED` |

A target superset is the *normal* shape of a library prototype whose users
declare only the members they touch. Mutation control **M1** reverses the
direction and proves the suite catches it.

Comparison is **exact**: exact name equality (no case folding, no fuzzy match, no
ordinal position), and exact field-type token equality — no promotion, no
coercion, no SF↔MF relationship, and for `SFNode`/`MFNode` no inspection of the
node type inside. The same rule 4.8.3's `IS` comparison uses, for the same
reason. Declaration order is recorded as evidence (`member.sourceOrder`) and
decides nothing.

Every problem is reported; comparison never stops at the first.

---

## 6. Declarations, not alias-expanded bindings

ISO 4.7 says a declared `exposedField zzz` **may be referred to** as `set_zzz`
and `zzz_changed`. That is three *written names* for **one declaration**, and
4.9.2 is a statement about what an interface **declares**.

So D compares **declaration members** — `scope-graph.membersOf`, which is
WD1.5-P2B's authority for what one interface scope declares. The alias authority
(`writtenNamesFor`) and the effective-binding projection
(`interfaceQuery.effectiveInterfaceOf`) are **not imported** by
`proto-agreement.js`, and a boundary test asserts their absence.

Comparing written bindings instead would demand that a conforming target declare
`set_zzz` and `zzz_changed` as members in their own right — which ISO 4.3.5
actually *prohibits* alongside the `exposedField`. Mutation control **M5**
implements exactly that defect and the suite catches it.

A local `field foo` against a target `exposedField foo` therefore finds the
declared name and type; it is **not** a missing member. It raises the
access-category question below instead.

---

## 7. Access categories are **not** an ISO 4.9.2 rule (U7)

4.9.2 names "names and types". It is **silent** on access categories. WD1.7-A
recorded that silence as open question **U7** and measured, in its explicitly
non-production global probe, **65** access-only differences against **2** genuine
type mismatches — folding them together would misreport the shape 32-fold.

So an access difference is:

* its own finding code, `ACCESS_DIFFERS`;
* carrying basis **`NOT_SPECIFIED_BY_ISO_4_9_2`**;
* emitted **symmetrically** — neither ordering of the two categories is the
  conforming one;
* emitted **alongside** a type mismatch, never instead of it;
* and it **never changes a member's status**.

It is not labelled conforming, non-conforming, legal, illegal or a compatibility
failure, because no normative source in the mirrored standard supports any of
those. Mutation control **M4** promotes it to a violation and the suite catches
it.

**Out of scope, recorded:** 4.9.2 also describes runtime *initial-value* behaviour
for exposedFields and eventOuts (WD1.7-A N5/N6) — where an instance's values come
from until the definition loads. D does not simulate a browser loading lifecycle,
propagate instance values or initialise events; its comparison target is
**declared names and declared field types**, plus the separately observed access
category.

---

## 8. Uncertainty is never absence

`SATISFIED` is a claim about **all** members. `VIOLATED` is a claim about **one**.
That asymmetry is the safety property, and it decides the rollup order:

* any member `VIOLATED` → the agreement is `VIOLATED` (a proven violation is not
  unproven by another member's uncertainty);
* else any member `WITHHELD` → `WITHHELD`;
* else `SATISFIED`.

Two upfront scope gates, both withholding **every** answer including the positive
ones — a recovered interface can manufacture a member as easily as it can lose
one:

| gate | effect |
|---|---|
| local interface not provable (`documentIncomplete`, or the scope recovered) | `WITHHELD` / `LOCAL_INTERFACE_NOT_PROVABLE`, no members compared |
| target interface not provable | `WITHHELD` / `TARGET_INTERFACE_NOT_PROVABLE` — an absent name is **not** evidence of absence |

Per member:

| condition | outcome |
|---|---|
| local name absent, or local type token outside Annex A.2 | `WITHHELD` / `LOCAL_MEMBER_NOT_PROVABLE` |
| the local interface declares the name twice (4.3.5 prohibits it) | `WITHHELD` / `LOCAL_MEMBER_AMBIGUOUS` |
| the target declares the name more than once | `WITHHELD` / `TARGET_MEMBER_AMBIGUOUS`, `targetDeclaration: null` |
| the matching target declaration's type token is outside Annex A.2 | `WITHHELD` / `TARGET_MEMBER_NOT_PROVABLE` |

No first match, no last match, no nearest match, no ranking. Mutation control
**M6** resolves the duplicate by taking the first and the suite catches it.

The provability gate is `scope-graph.interfaceScopeIsProvable`, a minimal
generalisation of the two gates `interfaceMemberIsUniqueInScope` already applied,
asked about the **scope** rather than about one member — because a consumer
proving a member *absent* has no member to ask about. The field-type vocabulary
is `scope-graph.isFieldTypeToken`, publishing Annex A.2's own twenty-token
`fieldType` production rather than deriving a nineteen-token set from the WD1.3
schema. Both are facade-private, and neither is a new table.

---

## 9. Consuming WD1.7-C — D re-resolves nothing

D takes C's resolution record as a **required** argument and reads:

| field | used for |
|---|---|
| `status` / `reason` | only `RESOLVED` supplies a target |
| `declarationRange` | proving the resolution is *about* this declaration — an identity check on evidence, not a name match |
| `target.parseResult` / `target.declaration` | the two inputs 4.9.2 and 4.8.3 need |
| `target.evidenceSourceId`, `artifactPath`, `retrievedBytesHash`, `decodedContentHash`, `wasGzipped` | provenance |
| `target.selectedProtoName`, `selectionRule`, `selectionWasUnique`, `declarationRange`, `base` | provenance |
| `baseDocument`, `selectedCandidateIndex`, the winning candidate's `writtenUrl` | provenance |

There is **no** second target selector, candidate walk, fragment interpretation,
URL router or retrieval path in this lane; the boundary suite asserts the absence
of `selectPrototypeTarget`, `retrieveExternalCandidate`, `resolveExternalPrototype`
and `buildExternalDependencyGraph` by name from the pure half and by import
restriction from the Node half.

### The C outcome matrix

| C `status` | D |
|---|---|
| `RESOLVED` | `ENRICHED` — both questions asked |
| `TARGET_PARSE_FAILED` | `NOT_ATTEMPTED` |
| `TARGET_PROTO_NOT_FOUND` | `NOT_ATTEMPTED` |
| `TARGET_PROTO_AMBIGUOUS` | `NOT_ATTEMPTED` |
| `NOT_ATTEMPTED` (including every retrieval failure underneath it) | `NOT_ATTEMPTED` |

In every `NOT_ATTEMPTED` case C's own status and reason are preserved on
`external.resolution`, the interface record is `AGREEMENT_STATUS.NOT_ATTEMPTED`,
no class is guessed, and `strictLocal` is still there and still strict.

### Provenance and paths

Only archive-relative paths reach a D record — WD1.7-B's contract — so no host
absolute path can leak through a report. A test asserts it on the serialised
projection.

Every AST handle D carries (`target.parseResult`, `target.declaration`, an
`InterfaceDecl` on a member) is a **parse-lifetime projection** of an operation's
own parse: derived, disposable, never a persistent identity, never written
anywhere (WD.md §2/§7). The full C record — every candidate, its retrieval and
its selection — stays the caller's; D projects rather than copies, so there is no
second drifting copy of C's evidence.

---

## 10. One class authority

`containment.js` already derived a prototype's implementation class from ISO
4.8.3, inside `resolveCandidateType`. D needed the same derivation entered at a
**declaration** rather than at an occurrence. It was **extracted**, not
duplicated:

```
stepIntoPrototype(graph, decl, derivation, seenDecls)   one 4.8.3 step
runClassWalk(graph, startNode, derivation, seenDecls)   the occurrence loop
    |                                        |
resolveCandidateType   (occurrence)     protoImplementationClass  (declaration)
    |                                        |
childLegality  (WD1.6-C)                external class proof  (WD1.7-D)
```

There is exactly one `firstBodyNode`, one `stepIntoPrototype`, one cycle guard,
one recovered-body gate and one leading-`USE` rule in the repository — asserted
by source scan. `containment.test.js` **52** pins the equivalence across five
shapes: both entry points must return the same `nodeType`, `status`, `reason` and
`derivation`. Mutation control **M7** moves `firstBodyNode` to the *last* body
node and shows **both** entry points move together — which is the actual proof
that there is one authority and not two.

`resolveCandidateType`'s behaviour is unchanged; the extraction preserved branch
order exactly, and the two new fields it now reports (`stoppedAt`,
`externProtoDeclaration`) are additive evidence that no WD1.6 branch reads.

### The strict-local answer is untouched

`protoImplementationClass` answers an `ExternProto` declaration **strictly**:
`UNSUPPORTED` / `EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE`, `classes: []`, with
the declared *type name* as `nodeType` (that much is local) and no class. It has
no parameter through which external evidence could arrive.

---

## 11. External class proof, including the EXTERNPROTO first body node

Generation 0 is the selected implementation itself; the walk is WD1.6-C's.

When the first body node is itself an `EXTERNPROTO`:

```vrml
EXTERNPROTO Base [] "base.wrl"
PROTO Wrapper [] { Base {} }
```

…the strict-local walk cannot finish, and **D does not go and look.** It asks
C's dependency graph which target *that exact declaration* resolved to, and
continues at that prototype:

1. locate the graph node for the current target by its **public provenance** —
   `decodedContentHash` + `selectedProtoName`, which *is* WD1.7-A §10.1's
   ratified recursion identity, compared field by field rather than rebuilt as a
   key (a second key builder is a second identity waiting to disagree with C's);
2. find the edge from that node whose `resolution.declarationRange` is the
   declaration's own span;
3. dispatch on C's `traversal` status.

| C evidence | D |
|---|---|
| `EXPANDED` / `REUSED` with a `RESOLVED` resolution | continue at `edge.resolution.target` |
| `DEPENDENCY_CYCLE` | `UNRESOLVED` / `EXTERNAL_CLASS_CYCLE` — a cycle is a complete answer about the dependency and is **not** a node class |
| `DEPTH_LIMIT_EXCEEDED` | `UNRESOLVED` / `EXTERNAL_DEPENDENCY_DEPTH_LIMITED` |
| `NOT_RESOLVED` | `UNRESOLVED` / `EXTERNAL_DEPENDENCY_NOT_RESOLVED` |
| `CONTEXT_REQUIRED` (carries no resolution, so no edge matches) | `UNRESOLVED` / `EXTERNAL_DEPENDENCY_NOT_PROVEN` |
| no dependency graph supplied | `UNSUPPORTED` / `DEPENDENCY_GRAPH_NOT_SUPPLIED` |
| a graph built over another document | `UNSUPPORTED` / `TARGET_NOT_IN_DEPENDENCY_GRAPH` |
| two graph nodes share the target under different ISO 4.5.3 bases | `AMBIGUOUS` / `DEPENDENCY_GRAPH_NODE_AMBIGUOUS` — their subtrees may legitimately differ, so choosing one is ranking |

C's graph is a DAG by construction (a back edge to an ancestor is detected as a
cycle before it can become `REUSED`), and D keeps a visited-node guard anyway: a
proof that cannot terminate is worse than one that withholds.

The result is **one** 4.8.3 derivation accumulated across generations —
`derivation: ['Wrapper', 'Base']` with `nodeType: 'Shape'` — plus one provenance
record per external generation followed, in order.

### Vocabulary

`implementationClass.status` uses `EXTERNAL_CLASS_STATUS`, which **renames
nothing**: `PROVEN` is the scope graph's own `STATUS.RESOLVED` and the five
uncertain values are `CONTAINMENT_STATUS`'s own, by identity. `reason` carries
either a `CONTAINMENT_REASON` (the 4.8.3 walk finished there) or an
`EXTERNAL_CLASS_REASON` (D could not follow with the evidence it was given); the
two tables are asserted **disjoint** so `reason` stays readable.

---

## 12. Interface and class are independent

They need different evidence and are answered independently:

* **Interface agreement** needs the selected **root** target and nothing more. It
  does **not** require `graph.complete`. A test pins the case where an unrelated
  `UNINDEXED_INTERFACE_DEFAULT` region makes C's graph incomplete while the root
  target's interface is fully provable — the 4.9.2 answer is still `SATISFIED`.
* **Class proof** may need to follow a first-body chain into another document,
  and withholds on its own record when it cannot. A test pins
  `interface: SATISFIED` beside `implementationClass: UNRESOLVED`.

Globally blocking D because some unrelated branch of C's walk is incomplete would
be a false negative with no normative basis.

---

## 13. Containment is **not** redesigned

D exposes the externally proven implementation class and **stops**. It does not
add an evidence parameter to `childLegality`, does not wrap it, and does not make
any strict call depend on configured filesystem state. A caller wanting an
externally informed containment answer composes:

```
external implementationClass.nodeType   ->   existing WD1.6-C containment
```

which is a consumer decision, not a semantic one. `childLegality` remains
independently observable and byte-for-byte unchanged: a boundary test runs it
before and after a full enrichment over the same declaration and asserts the same
`status` and `reason`.

**No false ILLEGAL.** WD1.6-C's doctrine is unchanged and unreachable from here:
missing class evidence, an incomplete C traversal, an ambiguous resolution and
recovery all preserve uncertainty. D never returns `LEGAL` or `ILLEGAL` at all —
those values are not in `EXTERNAL_CLASS_STATUS`.

---

## 14. No presentation, no compatibility

No record in this lane carries a severity, a message, a colour, a visibility, a
suppression rule or a save policy — asserted by source scan and by shape. What a
UI does with a finding is P4's decision, exactly as WD1.6-D established.

`compatibility` is present, **always `null`**, and reserved. No
compatibility-profile identifier — no vendor, browser or historical dialect name
— is spelled anywhere in `src/vrml/proto-agreement.js` or `src/proto-enrichment/`;
a boundary test asserts it on the raw source, comments included. WD1.7-E owns
that classification and is BLOCKED. D's job is to produce evidence E can
classify, kept deliberately unclassified: the ISO axis (`AGREEMENT_BASIS`) and
the observation (`AGREEMENT_FINDING`) are separate fields, so E can attach a
profile without rewriting either.

---

## 15. World Project boundary

D is **not** wired into `asset-graph`, `package-plan` or bundle status, and no
packaging policy changed. WD1.7-B2's rule is unchanged: a bundle still packages
every locally retrievable fallback artifact, because a viewer may reach for one C
did not select. The post-C World Project consumer remains deferred
(`DEFERRED_TO_POST_C_WORLD_PROJECT_CONSUMER`) — it changes what *blocks* a
bundle, which is a packaging-policy decision needing its own approved lane.

---

## 16. Tests

| suite | count |
|---|---|
| `test/vrml/proto-agreement.test.js` | 35 |
| `test/proto-enrichment/external-enrichment.test.js` | 32 |
| `test/proto-enrichment/mutation-controls.test.js` | 9 |
| `test/proto-enrichment/architecture-boundary.test.js` | 22 |
| `test/vrml/containment.test.js` **52–56** (declaration entry point) | 5 |
| **focused total** | **103** |

Full suite: **1718 / 1718**, up from WD1.7-C's 1615.

### Mutation controls

| # | defect | caught by |
|---|---|---|
| M1 | reject an extra **target** member (subset direction reversed) | target-superset fixture |
| M2 | report a missing local member as satisfied | `MEMBER_MISSING` fixture |
| M3 | ignore a declared field-type difference | `TYPE_MISMATCH` fixture |
| M4 | promote an access difference to an ISO violation | access-only fixture |
| M5 | demand `set_foo` / `foo_changed` as target **declarations** | alias-trap fixture |
| M6 | let the first duplicate target member win | duplicate-target fixture |
| M7 | select the **last** body node as 4.8.3's first | both class entry points move together |
| M8 | let external evidence overwrite `strictLocal` | strict-answer fixture |
| M8b | (structural) reach a WD1.6 query from external evidence | no such parameter exists; before/after `childLegality` identical |

Mutants are built from the current production source, every anchor must match
exactly once, and they are written to the OS temp directory — the repository is
never touched.

---

## 17. Corpus evidence — deliberately not reproduced

WD1.7-A's exploratory global probe reported, over an explicitly **non-production**
denominator of 1,169 checked targets: 1,048 subset satisfied (89.65%), 59 member
missing (5.05%), 2 type mismatch (0.17%), 65 access differs (5.56%).

D does **not** reproduce those figures and does not publish a production rate.
Doing so would require inventing archive mappings for the external corpus roots
purely to produce a percentage, which the lane brief forbids and which would
manufacture a resolution rate that says more about the invented mapping than
about the content. The four buckets are instead pinned as behavioural fixtures,
so the taxonomy A measured is the taxonomy D implements. Reproducing A's numbers
against a **recorded** archive mapping and the same file-set fingerprint remains
available as its own evidence exercise.

---

## 18. Deliberate limits

| limit | why it is truthful |
|---|---|
| The external class proof needs a C dependency graph to cross a document boundary. Without one it withholds. | D has no traversal and no base computation of its own; building either is the second resolver the lane refuses to become. |
| A `CONTEXT_REQUIRED` edge cannot be distinguished from an absent one. | C deliberately records no resolution for it (ISO 4.5.3 case (1) with no known instantiating file), and both outcomes withhold identically. |
| Duplicate declared names withhold rather than applying ISO 4.6.2's *closest preceding* rule. | The same deliberate strictness gap WD.md §8.1 records: these consumers are identity- and rename-shaped, where §7 forbids ranking. |
| A declaration from another parse returns `INVALID` rather than throwing. | `interfaceScopeFor` is a **lookup**: `null` means "this graph holds no projection for it". D reports the ill-formed question rather than inventing a verdict. |
| 4.9.2's runtime initial-value semantics are not modelled. | See §7 — out of scope, and nothing in WD1.7's design needs it for interface agreement. |
