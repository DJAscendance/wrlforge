# WD1.6 — Semantic Consumer API — implementation plan

**Status:** PLAN ONLY. Nothing in this document is implemented. No production
source, script, test, generated schema or package metadata is modified by the
lane that wrote it.

**Baseline:** `cd7e333` (WD-OSS-A1 closeout), 1,102/1,102 tests passing.

**Predecessors:** WD1.1 source map · WD1.2 edit algebra · WD1.3 node schema ·
WD1.4 node identity · WD1.5-P1 DEF/USE scope graph · P2A type resolution ·
P2B interface members + `IS` · P2C ROUTE endpoints.

**Successors this lane exists to serve:** P4 (diagnostics presentation) and WD2
(scene tree / inspector / viewport).

---

## 1. Lane objective

WD1.5 built four namespaces' worth of correct, fail-closed VRML97 semantics and
**shipped them to nobody**. `src/vrml/symbols.js` and `src/vrml/scope-graph.js`
are not in the `src/vrml/index.js` facade, have no production callers, and are
described in every P-lane doc as "internal and consumer-free". WD1.3's schema is
exported but carries only names, types, access categories and defaults.

Two different consumers are now queued behind that gap, and **both need the same
three things**:

| consumer | needs |
|---|---|
| **P4** — diagnostics presentation | a structured finding it can classify and render |
| **WD2** — scene tree / inspector | a node's editable interface, its field constraints, and whether a candidate child is legal |

If each builds its own access layer over `scope-graph.js`, they will diverge on
the only thing that matters — **what happens when the answer is not provable** —
and the §7/WD.md fail-closed guarantee will be re-litigated twice, badly.

**WD1.6's objective is therefore narrow and defensive:** publish one consumer
layer over the existing semantic substrate, adding the two pieces of
standards-derived metadata that substrate provably lacks, **without inventing a
second resolver and without softening a single fail-closed status.**

WD1.6 is a **substrate lane**. It ships no UI and changes no behaviour a user
can see.

---

## 2. Inherited architecture — the rules WD1.6 does not get to revisit

These are settled. WD1.6 inherits them whole.

1. **The source text is the document** (WD.md §2). Every projection WD1.6 adds
   is derived, disposable, and rebuilt from a parse. Nothing is persisted,
   nothing is written into source, nothing survives a reparse.
2. **Identity may be lost or ambiguous; it may never be confidently wrong**
   (WD.md §7). No structural paths, no fuzzy matching, no candidate ranking.
3. **Recovery is an upfront proof gate, not a late annotation** (P2A). A damaged
   scope withholds *every* lexical answer, positive included.
4. **Three lexical namespaces plus schema lookups** — never conflated. Built-in
   node and field names are schema facts, not lexical symbols.
5. **PROTO scopes are disjoint in both directions** (ISO 4.8.4), not shadowed.
6. **EXTERNPROTO is asymmetric** (4.9.2): what it declares locally is
   authoritative; what it omits is `unsupported`, never `unresolved`.
7. **Table 4.4 governs `IS`; ROUTE has no Table 4.4** and its own opposite-running
   `set_`/`_changed` shorthand (4.10.2).
8. **ISO/IEC 14772-1 is the only normative authority** (WD.md §9). Vendor
   behaviour is classified and preserved, never promoted into a language rule.

### 2.1 The single most important structural finding

`scope-graph.js:1468`, `acquireEndpointOn(state, targetNode, name, nameRange)`,
**already is the unified interface lookup this lane has been asked to design.**
It resolves one name on one node across all four target shapes — built-in schema,
`Script` user declarations ahead of clause 6, PROTO interface, EXTERNPROTO
interface — with alias expansion, `ENDPOINT_ORIGIN` tagging and fail-closed
statuses, and P2C already extracted it precisely so `IS` and ROUTE would share
**one** endpoint authority rather than two.

It is module-private, and it answers **one name at a time**.

> **WD1.6-B is not a new resolver. It is the enumeration generalization of a
> function that already exists and is already corpus-validated.**

That reframes the largest deliverable in this lane from "design an interface
query" to "publish, in whole-interface form, the authority `IS` and ROUTE have
already been graded against over 245,540 ROUTEs and 23,246 `IS` statements with
zero wrong bindings." Any design that introduces a *second* traversal is wrong on
arrival.

---

## 3. Explicit non-goals

WD1.6 contains **none** of the following. Each is listed with where it does belong.

| excluded | belongs to |
|---|---|
| typed view update bus | WD2, multi-view synchronization |
| command / undo / redo stack | WD2a |
| White Dune handle protocol; `Handle3D` frame math | WD2c, after its own spike |
| X_ITE picking / ray intersection | a dedicated spike **before** WD2c |
| ROUTE canvas | WD2d |
| scene tree, inspector, node palette — any UI at all | WD2 |
| diagnostic **presentation** policy (severity, visibility, wording) | P4 |
| porting or adapting White Dune code | not scheduled; needs owner approval |
| renderer, Electron, main-process, IPC, CSP change | — |

Also excluded, and worth stating because they are tempting adjacent work:

- **No change to `analyze.js`.** It stays flat and non-authoritative. WD1.6 does
  not route `VRML040`–`VRML044` through the scope graph; that is P4's call.
- **No change to `validator.js`, World Project scanning, packaging or the preview
  resolver.** They run on their own code paths (AGENTS.md), and WD1.6 does not
  become their new spine.
- **No `languageSemantics` query.** P2B deliberately declined ISO 4.6.2's
  closest-preceding duplicate-name rule because its consumers are identity and
  rename. WD1.6's consumers are the same two. If viewer fidelity ever needs the
  browser's answer, it is a separately named query that never feeds identity —
  and it is not this lane.

---

## 4. Current API inventory

Read at `cd7e333` before designing anything, so WD1.6 does not republish what
already exists.

### 4.1 Published today — `src/vrml/index.js`

`parse` · `tokenize` · `analyze` · `createSourceMap` · `edit` · `nodeSchema` ·
`documentTransaction` (narrowed) · `nodeIdentity` (narrowed) · `ast` ·
`diagnostics` · `assetRefs` · `TT` · `KEYWORDS` · `DEFAULT_LIMITS`.

The facade's own comment establishes the convention WD1.6 must follow:

> *"NARROWED ON PURPOSE … a facade is the wrong place to publish 'you could also
> reach in here'. What follows is the whole intended public surface … Adding to
> it is a decision, not a convenience."*

### 4.2 Built but unpublished — `scope-graph.js`

Exports ~55 names across four groups: constants (`STATUS`, `REASON`, `NAMESPACE`,
`ACCESS`, `ENDPOINT_ORIGIN`, `SCOPE_KIND`, `SYMBOL_KIND`, `REFERENCE_KIND`,
`IS_FORM`, `ROUTE_SIDE`, `SCOPE_ERROR`), predicates (`isResolved`,
`isUnresolved`, `isAmbiguous`, `isInvalid`, `isRecovered`), construction
(`buildScopeGraph`), and per-namespace queries (`resolve`, `resolveIs`,
`resolveRouteNode`, `resolveRouteEndpoint`, `routeVerdict`, `membersOf`,
`interfaceScopeFor`, `routesFrom`, `routesTo`, …).

**This is a rich, correct, low-level surface.** WD1.6 does not replace it and
does not wrap all of it. It adds the three *consumer-shaped* queries §5–§8
define, and publishes a deliberately narrow selection of the above alongside them.

### 4.3 Built but unpublished — `symbols.js`

The taxonomy and the frozen shape constructors. **Stays internal.** Consumers
need the constant tables (to `switch` on a status) and the predicates; they do
not need `createIsVerdict`. WD1.6 re-exports the constants **through**
`scope-graph.js`, which already re-exports them, and never adds `symbols.js` to
the facade.

### 4.4 The two genuine gaps

| gap | evidence |
|---|---|
| **field constraints** | `getFieldSchema('Transform','bboxSize')` returns `{type, accessType, vrml97Declaration, profiles, order, defaultText, defaultValue}`. No `min`, no `max`, no enum, no accepted node class. Verified at `cd7e333`. |
| **containment legality** | nothing anywhere answers "may a `Box` be a `Transform.children` entry". `children` is `MFNode` and that is all the schema knows. |

### 4.5 Diagnostics shape

`diagnostics.js` is 70 lines: `SEVERITY`, a stable `CODE` table, and
`makeDiagnostic(severity, code, message, range, extra)`.

**It bakes `severity` and a human `message` into the record at construction
time.** That is exactly the presentation policy WD1.6 must not decide, and it is
the structural reason §8 introduces a parallel shape rather than extending this
one.

---

## 5. WD1.6-B — unified effective-interface query

### 5.1 What it answers

> Given a node occurrence in a parsed document, what is its **effective public
> interface** — every field and event a consumer may show, edit, or route —
> regardless of whether its type is built-in, `Script`, PROTO or EXTERNPROTO?

### 5.2 Form

A **pure function returning a frozen projection**, matching the repository's
existing convention (`symbols.js` hands out frozen shapes; scope-graph queries
are pure functions over a graph). Not a class, not a facade object with internal
state, not a live view.

```js
// src/vrml/interface-query.js
effectiveInterfaceOf(graph, astNode) -> EffectiveInterface | null
```

`null` only when `astNode` is not a node occurrence in `graph`'s parse. A foreign
object or a graph mismatch **throws** `SCOPE_ERROR.GRAPH` / `SCOPE_ERROR.PARSE`,
per the existing rule that a cross-document mixup is a programming error, not a
lost lookup.

### 5.3 Shape

```
EffectiveInterface (frozen)
  node          the AST node occurrence
  nodeType      written type name
  origin        ENDPOINT_ORIGIN.*  builtin-schema | script-interface
                                  | proto-interface | externproto-interface
  status        STATUS.*           resolved | unresolved | ambiguous
                                  | unsupported | recovered | invalid
  reason        REASON.*
  complete      boolean — see 5.5, the load-bearing field
  members       frozen array of EffectiveMember
  byName        frozen Map: effective written name -> EffectiveMember
  detail        REASON.* | null    non-binding observation
  evidence      frozen array

EffectiveMember (frozen)
  name              declared name (`zzz`)
  writtenNames      frozen array of every name that reaches this member
                    (`['zzz','set_zzz','zzz_changed']` for an exposedField)
  type              field-type token, exact; null if unknown
  access            ACCESS.*  declared access
  effectiveAccess   ACCESS.*  access for the name actually used
  declarationOrigin ENDPOINT_ORIGIN.*
  declRange         source range of the declaration, or null
  profiles          frozen array, from the schema (`['vrml97','x3d']`)
  vrml97Legal       boolean — isFieldAllowed(node, field, 'vrml97')
  viaAlias          boolean
  constraints       FieldConstraints | null   (WD1.6-A; null until then)
  status            STATUS.*   per-member, see 5.6
  reason            REASON.*
```

### 5.4 Implementation constraint — one authority, not two

The lane's **first** task is to generalize `acquireEndpointOn` (§2.1) from
one-name lookup to whole-interface enumeration, keeping the by-name path as a
thin call into the shared machinery. The rule is:

> After WD1.6, `resolveIs`, `resolveRouteEndpoint` and `effectiveInterfaceOf`
> must all reach the interface through the **same** code. If a refactor leaves
> two traversals, the refactor is wrong.

**Regression bar:** P2B's and P2C's existing test suites and corpus results must
be **bit-identical** after the generalization. This is a pure refactor plus an
enumeration entry point; any behaviour change is a defect.

### 5.5 `complete` — the field that keeps this honest

An interface can be **soundly enumerated but not exhaustive**. The canonical case
is EXTERNPROTO: 4.9.2 makes every member it declares authoritative, while its
silence about others is unknowable, since the declaration may be a strict subset.

Collapsing that into `status: 'resolved'` would tell WD2's inspector "this is the
whole interface" when it is not.

- `status` answers **"is what I returned trustworthy?"**
- `complete` answers **"is what I returned all of it?"**

| target | status | complete |
|---|---|---|
| built-in, resolved type | `resolved` | `true` |
| `Script` with user declarations | `resolved` | `true` |
| local PROTO, provable interface | `resolved` | `true` |
| **EXTERNPROTO** | `resolved` | **`false`** |
| unresolved node type (P2A) | `unresolved` | `false` |
| recovered interface scope | `recovered` | `false` |
| duplicate PROTO declaration | `ambiguous` | `false` |

**A consumer that ignores `complete` degrades to "shows fewer members than
exist", never to "invents a member".** That is the correct failure direction, and
it is why `complete` is a separate boolean rather than a status value.

### 5.6 Per-member status

Members carry their own status because one interface can mix provable and
unprovable members — an alias collision (P2B rule 2) makes exactly one name
`ambiguous` while every other member remains `resolved`.

An `ambiguous` member is **present in `members` and absent from `byName`**. It
is visible as a declaration that exists, and unreachable as a binding target.
Preferring one side of a 4.3.5-prohibited collision is candidate ranking — the
§7 failure mode — and is not done here.

---

## 6. WD1.6-A — field constraints

### 6.1 The honest finding first

Measured against the ISO mirror at
`~/Projects/cybertown/wb-ct-scrape/specs/iso-14772-vrml97/markdown/part1/`:

| what | result |
|---|---|
| `"in the range"` in `nodesRef.md` | **5 occurrences** |
| `"shall be greater than"` | 18 |
| `"greater than or equal to"` | 7 |
| **π and ∞ in range bounds** | rendered as **`<img>` GIF references**, not text |

Example, `nodesRef.md:1324`:

```
field shall be in the range \[0, ![](.../Images/infinity.gif)).
```

**Numeric field constraints in VRML97 are sparse, prose-bound, and partly
encoded as images.** A regex sweep over this prose would produce a table that is
mostly absent and occasionally wrong — the worst possible outcome for a
constraint system, because a wrong `max` silently rejects legal author input.

**Consequence for the plan: numeric constraint extraction is deliberately
scoped small, high-precision, and expected to leave most fields unconstrained.**
This is not a shortfall to engineer around; it is what the standard supports.

### 6.2 Fail-closed direction — inverted from everything else in WD1.5

Everywhere else in this substrate, absence means "cannot prove, withhold". For
constraints the safe direction is the opposite:

> **Absence of a constraint means `not represented`, and a consumer must treat
> it as "no constraint is known" — permitting the value.**

A constraint system that rejects on absence would reject nearly every legal
VRML97 field, since most have no extractable constraint. The danger here is
false *rejection*, not false acceptance, so:

- `constraints: null` — nothing known. **Do not validate.**
- `constraints: { min: 0, minInclusive: true }` — known, partial. Validate only
  the stated facet.
- Never synthesize a bound from a default value, a type, or a sibling field.
- Never fall back to White Dune's value (§11).

### 6.3 Shape

```
FieldConstraints (frozen, every facet optional)
  min, max              number
  minInclusive          boolean   ISO distinguishes [0, ∞) from (-∞, ∞)
  maxInclusive          boolean
  allowedValues         frozen array of exact strings
  acceptedNodeClasses   frozen array of NODE_CLASS.*      (SFNode/MFNode)
  acceptedNodeTypes     frozen array of exact type names  (SFNode/MFNode)
  provenance            frozen { section, source }        e.g. '6.52', 'iso-nodesRef'
  notes                 CONSTRAINT_NOTE.* | null
```

`CONSTRAINT_NOTE` names constraints that exist normatively but are **not
representable** — so the schema records *that a constraint exists and was not
captured*, rather than staying silent and implying freedom:

- `NON_MACHINE_EXTRACTABLE` — stated in prose only
- `CONTEXT_DEPENDENT` — depends on a sibling field's value
  (`IndexedFaceSet.colorIndex` vs `colorPerVertex`)
- `CROSS_FIELD_CARDINALITY` — "there shall be one more `skyAngle` than
  `skyColor`" (`nodesRef.md:320`)
- `BOUND_IS_SYMBOLIC` — the bound is π or ∞, image-encoded in the mirror

### 6.4 Extraction strategy

Extend `scripts/build-node-schema.js`; the generated `node-schema.js` stays
committed and the runtime keeps needing neither generator nor mirror.

Three tiers, **in descending confidence**:

1. **Enumerated node-class lists — high confidence, the real win.** `concepts.md`
   contains **8** explicit `"The following node types are …"` lists:
   scene-graph-unaffected · grouping · children · **not valid as children** ·
   light source · sensor · environmental sensor · interpolator. These are literal
   `<li>` enumerations of node names — deterministically extractable, and they
   are the substrate for §7. Extract with an exact-count assertion per list.
2. **Regular per-field node restrictions — medium confidence.** The pattern *"The
   `<field>` field, if specified, shall contain a `<Type>` node"* recurs
   (`Appearance.material`, `Appearance.textureTransform`, `Shape.geometry`,
   `IndexedFaceSet.color`/`normal`/`texCoord`, …). Extract with a **strict**
   pattern; anything not matching exactly is left absent, never guessed. This is
   the tier a White Dune cross-check earns its place on (§11).
3. **Numeric bounds — low yield, extract conservatively.** Only unambiguous
   textual forms. Symbolic/image bounds get `BOUND_IS_SYMBOLIC` and no numeric
   value. **Expect most fields to end with `constraints: null`, and say so in the
   generated counts.**

`--check` must verify the generated file matches a fresh extraction, as today.

### 6.5 The count is a deliverable

The generator emits, and `node-schema.test.js` asserts, how many fields carry
each facet. A future regression that silently drops half the constraint table
must fail a test, not go unnoticed. **A constraint count without its denominator
is unusable** — the P2C lesson, applied here.

---

## 7. WD1.6-C — containment legality

### 7.1 Query

```js
// src/vrml/containment.js
childLegality(graph, parentNode, fieldName, candidate, opts) -> ContainmentVerdict
```

`candidate` is a written type name **or** an AST node occurrence. `opts.profile`
defaults to `'vrml97'`.

### 7.2 Verdict — never a bare boolean

```
ContainmentVerdict (frozen)
  status    LEGAL | ILLEGAL | UNSUPPORTED | UNRESOLVED | AMBIGUOUS | INVALID
  reason    CONTAINMENT_REASON.*
  arity     'SFNode' | 'MFNode' | null
  required  frozen array of NODE_CLASS.* / type names the field accepts
  actual    frozen array of NODE_CLASS.* the candidate belongs to, or null
  detail, evidence
```

The §7 gate applies unchanged: **`ILLEGAL` is a positive claim of illegality and
must be provable.** Anything unprovable is `UNRESOLVED` / `UNSUPPORTED` /
`AMBIGUOUS` — never silently `ILLEGAL`, because a WD2 drag-and-drop that refuses
a legal move on an unprovable answer is the same class of defect as a wrong
identity resolution.

### 7.3 Decision order

1. Field exists on the parent's effective interface (§5)? Else `UNRESOLVED`.
2. Field is `SFNode`/`MFNode`? Else `INVALID` — a category error.
3. Parent type resolved by P2A? Else `UNRESOLVED`.
4. Field carries `acceptedNodeClasses`/`acceptedNodeTypes` (§6)? **Else
   `UNSUPPORTED`** — reason `CONTAINMENT_METADATA_ABSENT`. Not `LEGAL`.
5. Candidate type resolved? Else `UNRESOLVED`.
6. Candidate built-in → class membership from the extracted tables → `LEGAL` /
   `ILLEGAL`.
7. Candidate is a PROTO → §7.4.
8. Candidate is an EXTERNPROTO → §7.5.

### 7.4 PROTO — the boundary this lane documents rather than guesses

ISO 4.8.4 gives a prototype's node class as that of **the first node in its
body**. That is a genuinely available fact: the parse tree holds the body, and
P2A resolves the first node's type.

**But it is only provable when the body is provable.** A `recovered` PROTO body,
an unnamed PROTO, or a first node whose own type is unresolved all make the class
unknowable — and a recovered parse **moves scope boundaries**, so the "first
node" may not be the author's first node at all (WD.md §8, rule 3).

**Decision: implement the provable case, and return `UNRESOLVED` for every other
one.** Never infer a PROTO's class from its name, its interface shape, or how it
is used elsewhere. Where the first node is itself a PROTO instance, resolve
transitively with a cycle guard; a cycle is `UNRESOLVED`, not an error.

### 7.5 EXTERNPROTO — `UNSUPPORTED`, always

An EXTERNPROTO has **no body**, so 4.8.4's first-node rule has nothing to read,
and the implementation is not loaded and never will be here. Its class is not
absent — it is **unknowable**. Reason: `EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE`,
inheriting P2B/P2C's asymmetry rule verbatim.

A consumer should treat `UNSUPPORTED` as *permit with a caveat*, not *forbid* —
otherwise WD2 would refuse every legal EXTERNPROTO placement in the corpus.

### 7.6 Profiles

`opts.profile` selects the class tables. `'vrml97'` uses the extracted ISO
tables. A Cybertown/Blaxxun compatibility profile may add acceptances; it may
**never** remove one, and it never changes a `LEGAL` into an `ILLEGAL`. Profile
layering is additive-only, so a permissive profile can never make WRL Forge
reject standard content — the Mall-rules-leaking-downward failure AGENTS.md
warns about.

---

## 8. WD1.6-D — structured semantic findings model

### 8.1 Why a parallel shape, not an extension

`diagnostics.js` takes `severity` **as its first constructor argument** and a
human `message` as its third. Both are presentation decisions. WD1.6 is
explicitly forbidden from making them (§3), so extending that record would force
this lane to decide P4's policy at construction time.

**Decision: a parallel `SemanticFinding` shape plus a one-way adapter.**

> `semanticFinding → diagnostic` is a P4-owned mapping. WD1.6 ships the shape and
> a *reference* adapter; P4 owns the policy the adapter encodes.

There is exactly one diagnostic universe at the consumer boundary, because
findings only ever reach the UI **through** the adapter. The two shapes are not
competing models: one is semantics, one is presentation, and the arrow between
them runs one way.

### 8.2 Shape

```
SemanticFinding (frozen)
  code          FINDING_CODE.*     stable, never renumbered
  rule          normative citation — 'ISO 4.10.2', 'ISO Table 4.4'
  subject       { kind, node, symbol, reference }  what the finding is ABOUT
  range         { start, end }     exact source range
  policyClass   POLICY_CLASS.*     see 8.3
  confidence    STATUS.*           the substrate's own status, unchanged
  profile       'vrml97' | 'cybertown-compat' | 'vendor-extension' | null
  detail        REASON.* | null
  evidence      frozen array
  presentationHint PRESENTATION_HINT.* | null   advisory ONLY
```

Deliberately **absent**: `severity`, `message`, `visible`. Those are P4's.

### 8.3 `policyClass` — the compatibility question, answered structurally

This is the field that carries P2B's 1,481 Table 4.4 violations without
prejudging them.

| value | meaning |
|---|---|
| `STRICT_VIOLATION` | ISO says non-conforming, no profile accepts it |
| `STRICT_INCOMPATIBLE_PROFILE_ACCEPTED` | ISO says non-conforming; a WRL Forge compatibility profile accepts it |
| `VENDOR_EXTENSION` | outside ISO; observed and classified |
| `NOT_PROVABLE` | the substrate could not decide |
| `CONFORMING` | ISO-legal; carried when a consumer asked |

`policyClass` and `confidence` are **orthogonal and both required**. "ISO says
this is illegal" and "we are sure" are different claims: a `STRICT_VIOLATION`
with `confidence: 'recovered'` is a finding P4 should probably suppress, and
that is only expressible if both fields exist.

**Worked example — P2B's 1,481.** WD1.6 emits:

```
code: IS_ACCESS_INCOMPATIBLE
rule: 'ISO Table 4.4'
policyClass: STRICT_INCOMPATIBLE_PROFILE_ACCEPTED
confidence: STATUS.RESOLVED
profile: 'cybertown-compat'
```

WD1.6 does **not** decide whether that renders as an error, a warning, a
compatibility notice, or nothing. P4 does. Both facts — *"ISO forbids it"* and
*"this corpus does it 1,481 times and the compatibility profile accepts it"* —
survive to the point of decision, which is the entire requirement.

### 8.4 Producers

A finding is **derived on request** from existing verdicts —
`isConnectionVerdict`, `routeVerdict`, `resolve`, `resolveIs`,
`nodeIsBindingIssues` — never stored, never a fourth source of truth. If the
substrate and a finding disagree, the substrate is right and the derivation has a
bug.

---

## 9. Fail-closed and recovery semantics

**Recovery is an upfront proof gate, not a late annotation.** WD1.6 adds a
consumer layer, which is precisely where that rule is most likely to be
"simplified" away — a consumer API is under constant pressure to return something
convenient.

Rules, binding on every query in this lane:

1. **No query collapses statuses.** `unresolved`, `unsupported`, `ambiguous`,
   `recovered` and `invalid` stay distinct at the API boundary. No
   `if (!isResolved) return null`.
2. **No query offers a "just give me the answer" mode.** No `{ strict: false }`,
   no `orDefault`, no truthy-coercion convenience wrapper. A caller that wants
   one writes it, visibly, in its own code.
3. **A recovered scope withholds positive answers too.** Inherited from P2A
   unchanged, and the reason is not squeamishness: recovery *moves scope
   boundaries*, so an unclosed PROTO can absorb statements and manufacture a
   unique binding out of an ambiguous one.
4. **Constraint absence is the one inversion, and it is scoped.** §6.2 —
   `constraints: null` permits, because false rejection is the live danger there.
   It applies to **constraints only**, never to bindings, interfaces or
   containment.
5. **`ILLEGAL` is a positive claim** and must be provable (§7.2).
6. **`complete: false` is not an error.** It is a normal, common, correct answer
   (every EXTERNPROTO), and a consumer that treats it as failure is misusing it.

### 9.1 A test asserts the absence of the shortcut

Following `node-identity.test.js`'s precedent of asserting rejected designs are
absent **by source scan and by behaviour**, WD1.6 ships a test that scans its own
modules for status-collapsing patterns and a behavioural matrix proving every
status survives every query path. The failure mode being guarded is a
well-meaning future simplification, and prose in a plan does not prevent it.

---

## 10. Standards provenance

Every new schema property records where it came from. `constraints.provenance`
carries `{ section, source }`.

| property | authority |
|---|---|
| node-class membership | `concepts.md` §4.6.5–4.6.10, enumerated lists |
| per-field accepted node type | `nodesRef.md` per-node prose, strict pattern |
| numeric bounds | `nodesRef.md` per-field prose |
| field type / access / default | WD1.3, unchanged |
| Table 4.4 | `concepts.md` §4.3.5 / 4.7, already implemented |
| ROUTE rules | `concepts.md` §4.10.2, already implemented |

**If a property cannot be derived reliably from the ISO mirror, it is absent —
recorded as `NON_MACHINE_EXTRACTABLE` where the constraint is known to exist.**
No White Dune value is ever substituted (§11). No X3D-only fact leaks into a
VRML97 answer: `isFieldAllowed(node, field, 'vrml97')` gates every member, which
matters because 232 x_ite fields are X3D-only.

---

## 11. White Dune oracle boundary

### 11.1 Is it necessary?

**Optional, and recommended only for §6.4 tier 2.**

- Tier 1 (enumerated class lists) — **no oracle.** The lists are explicit; a
  count assertion is stronger evidence than a second implementation's agreement.
- Tier 3 (numeric bounds) — **no oracle.** Yield is too low to be worth it, and
  White Dune's bounds are its own engineering choices, not ISO's.
- Tier 2 (per-field accepted node types) — **oracle useful.** This is the tier
  extracted by prose pattern-matching, where a silent miss is plausible and
  invisible. A second, independently derived table is a real check on
  *recall* — the thing a self-consistent extractor cannot check about itself.

**Decision: build it only if tier-2 extraction shows unexplained gaps. Start
without it.**

### 11.2 If built

Location `spikes/wd1-6-schema-oracle/`, and per `OPEN_SOURCE_PROVENANCE.md` §6
as amended at A1 closeout:

- read-only; **explicit named file paths only**, never corpus enumeration
- **no corpus-guard exemption, and none needed** — a guard rejects a *root
  offered to enumeration*; a path-addressed reader never enumerates, so the two
  never meet. Needing to weaken a guard means the tool is enumerating when it
  should be addressing.
- `spikes/*/corpus.js` **unchanged**
- **never normative.** Every discrepancy is adjudicated against ISO. A White Dune
  value never lands in `node-schema.js` — its only output is *"look at field X
  again"*.
- deterministic, machine-readable summary; recorded under
  `OPEN_SOURCE_PROVENANCE.md` §4.1 Research & Reference
- **no code copied.** If any is ever adapted, a §4 production register entry
  lands first.

---

## 12. Profile and compatibility representation

Three separable facts, kept separate at every layer:

| fact | where it lives |
|---|---|
| what ISO says | `policyClass` (§8.3) + `rule` citation |
| what a WRL Forge profile accepts | `profile` + `STRICT_INCOMPATIBLE_PROFILE_ACCEPTED` |
| how sure we are | `confidence` (§8.2) |

Binding rules:

- Profiles are **additive**: a compatibility profile may accept more; it may
  never reject what ISO permits (§7.6).
- A compatibility acceptance **never** rewrites the ISO fact. `policyClass`
  still says the standard forbids it. WD.md §9: never silently normalize vendor
  behaviour into standard behaviour.
- Mall Item rules **never** enter this layer. WD1.6 is standards core; the Mall
  profile is `validator.js`, structurally separate, and the three profile layers'
  rules do not leak downward or sideways.
- The default profile is `'vrml97'`. Cybertown compatibility is **opt-in**.

---

## 13. Module boundaries

Three modules, not one `consumer-api.js`.

| module | depends on | exports | internal |
|---|---|---|---|
| `src/vrml/interface-query.js` | `scope-graph`, `node-schema`, `symbols` (constants) | `effectiveInterfaceOf`, `INTERFACE_STATUS` helpers | enumeration internals |
| `src/vrml/containment.js` | `interface-query`, `node-schema`, `scope-graph` | `childLegality`, `NODE_CLASS`, `CONTAINMENT_REASON` | class-table lookup, PROTO first-node walk |
| `src/vrml/semantic-findings.js` | `scope-graph`, `symbols` (constants) | `FINDING_CODE`, `POLICY_CLASS`, `findingsFor*`, `toDiagnostic` adapter | derivation helpers |

**Dependency direction is strictly one-way:**

```
node-schema ──┐
              ├──> interface-query ──> containment
scope-graph ──┤
              └──> semantic-findings
```

- `containment` depends on `interface-query`; **never the reverse.**
- `semantic-findings` depends on neither of the other two — it derives from
  scope-graph verdicts, so a consumer wanting only findings pulls no schema
  machinery.
- **No cycle is possible**, and a test asserts the module graph is acyclic.
- `scope-graph.js` gains an **internal** enumeration entry point for §5.4. It
  gains no new public export.

### 13.1 Facade policy

`src/vrml/index.js` gains **one** narrowed sub-object per module, following the
`nodeIdentity` precedent — consumer operations plus the constant tables needed to
`switch` on a result. `symbols.js` stays unpublished. `scope-graph.js`'s ~55
low-level exports stay unpublished; WD1.6's whole point is that consumers use the
consumer layer.

### 13.2 Purity and lifetime

All three modules are **pure and browser-safe**: no `fs`, no Electron, no
CodeMirror — the same constraint `symbols.js` and `scope-graph.js` already meet,
and what keeps them `node:test`-able and reusable in the renderer.

All returned projections are **frozen** and **scoped to one scope graph**, which
is scoped to one parse. Holding one across a reparse is the WD1.4 cross-document
mistake in a new costume: bind to the graph object, never to an id.

---

## 14. Test matrix

`test/vrml/interface-query.test.js` · `containment.test.js` ·
`semantic-findings.test.js`, plus additions to `node-schema.test.js`. No new
framework; `node:test` as everywhere else.

### 14.1 Effective interface

built-in node · `Script` with user declarations · `Script` user declaration
shadowing clause 6 · PROTO · nested PROTO · PROTO instantiated before
declaration · EXTERNPROTO locally-declared member · EXTERNPROTO absent member
(`complete: false`) · exposedField alias triple in `writtenNames` · alias
collision → member present, `byName` absent · duplicate declaration · reference
before declaration · recovered scope withholds positively · unnamed PROTO ·
X3D-only field excluded under `'vrml97'` · frozen-shape assertions · foreign
graph throws `SCOPE_ERROR.GRAPH`.

**The regression bar (§5.4):** a matrix asserting `effectiveInterfaceOf` and
`resolveIs`/`resolveRouteEndpoint` agree on every name they both answer, over
the P2B/P2C fixtures. Disagreement means two traversals exist.

### 14.2 Constraints

non-negative scalar · bounded `[0,1]` · inclusive vs exclusive bound · enumerated
string set · SFNode accepted class · MFNode accepted class · unconstrained field
→ `null` · known-but-not-extractable → `NON_MACHINE_EXTRACTABLE` · symbolic bound
→ `BOUND_IS_SYMBOLIC`, no numeric value · cross-field cardinality
(`Background.skyAngle`) · **facet counts match the generator** · `--check`
round-trip · no X3D-only constraint under `'vrml97'`.

### 14.3 Containment

legal built-in child (`Transform.children` ← `Shape`) · illegal built-in child
(`Transform.children` ← `Box`, from the explicit *not valid as children* list) ·
SFNode arity (`Shape.geometry`) · wrong arity → `INVALID` · PROTO whose first
node is provable · PROTO with recovered body → `UNRESOLVED` · PROTO cycle →
`UNRESOLVED` · EXTERNPROTO → `UNSUPPORTED` · field without class metadata →
`UNSUPPORTED`, **never** `LEGAL` · profile adds an acceptance · profile cannot
remove one · unresolved candidate type → `UNRESOLVED`.

### 14.4 Findings

strict violation · compatibility acceptance (a real Table 4.4 case) ·
`STRICT_VIOLATION` + `confidence: recovered` · unresolved · unsupported ·
ambiguous · exact source range · frozen shape · adapter produces a valid
`diagnostics.js` record · **adapter is the only path to a severity** ·
finding never contradicts its source verdict.

### 14.5 Structural

module graph acyclic · no `fs`/Electron import in any of the three · §9.1
status-collapse source scan · facade exports exactly the intended surface.

---

## 15. Corpus and evidence plan

**A full corpus sweep is not required to call WD1.6 complete.** Its queries are
projections over machinery already graded at zero wrong bindings on 245,540
ROUTEs and 23,246 `IS` statements; re-measuring the same bindings through a new
accessor would mostly re-derive P2B/P2C's result.

**Two targeted measurements do carry weight**, because they answer questions the
existing evidence does not:

1. **Projection equivalence (required).** Over the P2C corpus, assert
   `effectiveInterfaceOf` agrees with `resolveIs`/`resolveRouteEndpoint` on
   **every** name they both answer. Expected: **exact** agreement. This is the
   §5.4 one-authority guarantee measured rather than asserted — and it is cheap,
   since the harness exists.
2. **Containment metadata coverage (recommended).** How many SFNode/MFNode field
   occurrences in the corpus land on a field with extracted class metadata? This
   sizes how often WD2 will get `UNSUPPORTED` — the difference between a useful
   feature and a permanently caveated one. A low number is a finding, not a
   failure.

Both reuse `spikes/wd1-route-semantics/`'s existing harness conventions:
read-only · boundary-guarded (a forbidden path **throws**) · deterministic ·
sanitized `group:relative/path` identifiers · **de-duplicated by decoded text,
never raw bytes** (byte-dedup overcounted by ~32%) · every figure quoted **with
its denominator** · reproducible from the repository, never a session scratchpad.
That last clause is not ceremony: it is what earned P2C a
`BLOCKED — EVIDENCE INSUFFICIENT` verdict the first time.

Corpus guards stay unchanged.

---

## 16. Consumer proof 1 — P4 diagnostics

> *Task: inspect an `IS` or ROUTE finding and build a diagnostic record.*

```js
const { buildScopeGraph } = require('./scope-graph');
const { findingsForDocument, POLICY_CLASS } = require('./semantic-findings');
const { effectiveInterfaceOf } = require('./interface-query');

const graph = buildScopeGraph(parseResult);

for (const f of findingsForDocument(graph)) {
  // 1. Suppress anything the substrate could not prove.
  if (f.confidence !== STATUS.RESOLVED) continue;

  // 2. P4's policy — WD1.6 supplied the facts, not this decision.
  const severity =
    f.policyClass === POLICY_CLASS.STRICT_VIOLATION            ? 'error'
  : f.policyClass === POLICY_CLASS.STRICT_INCOMPATIBLE_PROFILE_ACCEPTED
      ? (settings.cybertownCompat ? 'info' : 'warning')
  : f.policyClass === POLICY_CLASS.VENDOR_EXTENSION            ? 'hint'
  : null;
  if (!severity) continue;

  // 3. Context for the message, through the same query the inspector uses.
  const iface = effectiveInterfaceOf(graph, f.subject.node);
  const member = iface && iface.byName.get(f.subject.name);

  emit(diagnostics.makeDiagnostic(
    severity, f.code,
    `${f.rule}: ${f.subject.name}` +
      (member ? ` is ${member.effectiveAccess} ${member.type}` : ''),
    f.range,
  ));
}
```

**Proof obligations met:** the 1,481 Table 4.4 cases arrive classified, not
pre-judged; suppression-on-unprovable is expressible in one line; `severity` is
chosen by P4 and nowhere else; the same interface query serves message
construction.

---

## 17. Consumer proof 2 — WD2 inspector / tree

> *Task: select a node, get its editable interface and constraints, and ask
> whether a candidate child type is legal.*

```js
const iface = effectiveInterfaceOf(graph, selectedNode);

if (iface.status !== STATUS.RESOLVED) return renderUnknownNode(iface.reason);

for (const m of iface.members) {
  if (!m.vrml97Legal) continue;                  // no X3D-only field in a VRML97 doc
  if (m.status !== STATUS.RESOLVED) { renderUneditable(m); continue; }
  if (m.access === ACCESS.EVENT_IN || m.access === ACCESS.EVENT_OUT) {
    renderEventRow(m); continue;                 // routable, not editable
  }
  renderEditor(m, m.constraints);                // null => no clamping (§6.2)
}

if (!iface.complete) {
  renderNotice('This EXTERNPROTO may declare more than is visible here.');
}

// Drag-and-drop / child picker
const v = childLegality(graph, selectedNode, 'children', draggedType);
switch (v.status) {
  case 'LEGAL':       return allowDrop();
  case 'ILLEGAL':     return refuseDrop(`${draggedType} is not a children node`);
  case 'UNSUPPORTED': return allowDropWithCaveat(v.reason);  // NOT a refusal
  default:            return allowDropWithCaveat(v.reason);
}
```

**Proof obligations met:** one query serves the whole inspector; `constraints:
null` degrades to an unclamped editor rather than a broken one; `complete: false`
is surfaceable; an unprovable containment answer **permits** — the failure
direction §7.2 requires.

**Both consumers use the same two entry points with no special-casing**, which is
the §18 API-shape test. The one asymmetry — P4 reads `findingsFor*`, WD2 does not
— is a genuine difference in task, not an awkward fit, and it is why
`semantic-findings.js` is a separate module (§13).

---

## 18. Performance and caching

Guiding constraint: **only performance choices that affect API correctness are
decided here.**

- **Build the scope graph once per parse**, as today. Rebuilding per query is the
  only real risk, and it is a correctness risk as much as a speed one: two graphs
  from one parse would hand out projections that fail object-identity binding.
- **Cache effective interfaces per `(graph, astNode)`** in a `WeakMap` keyed on
  the graph. Dies with the graph, cannot outlive a reparse, and the memoized
  value is frozen so sharing is safe.
- **Class-membership tables are static generated data** — a module-level frozen
  `Map`, built once at require time.
- **No lazy materialization inside a returned projection.** A frozen object whose
  fields are populated on access is a live view wearing a frozen costume, and it
  can observe a state the caller never asked about.
- **No cross-parse caching. No identity-keyed cache.** Bind to the graph object,
  never to a `sessionId` — the WD1.4 counter-reuse defect.

Expected cost is a small multiple of the existing scope-graph build, which is
already measured as affordable. **If profiling later disagrees, the answer is to
narrow what consumers ask for, not to weaken the lifetime rules.**

---

## 19. Migration and no-regression guarantees

1. **No existing public API changes.** WD1.6 only adds.
2. **`analyze.js` untouched**; `VRML040`–`VRML044` keep their current advisory
   behaviour and remain non-authoritative until P4.
3. **`validator.js`, World Project scanning, packaging, preview resolution,
   URL extraction untouched.** They keep their own code paths.
4. **The generated `node-schema.js` grows a `constraints` field on some fields.
   No existing property changes.** `getFieldSchema` callers are unaffected;
   `builtinEndpoint` reads `type` and `vrml97Declaration`, both unchanged.
5. **P2B and P2C behaviour is bit-identical** after the §5.4 refactor. Their
   suites are the gate.
6. **1,102 existing tests keep passing**; WD1.6 only adds tests.
7. **No new runtime dependency.** Runtime deps stay `x_ite`-only.
8. **No renderer, main-process, preload, IPC or CSP change.**
9. **Corpus guards unchanged.**

---

## 20. Implementation sequence

**Three sub-lanes**, split because each is independently provable — not for
ceremony. Dependency direction (§13) decides the order.

### WD1.6-A — schema constraints and class tables
Extend `scripts/build-node-schema.js`; regenerate and commit `node-schema.js`;
extend `node-schema.test.js` with facet counts and `--check`.
**Exit:** class tables extracted with exact-count assertions; constraint facets
counted with denominators; every existing schema property unchanged; 1,102 still
green.
*Foundational — §6 tier 1 is the substrate for §7, and constraints hang off §5's
members. Nothing else can start clean without it.*

### WD1.6-B — unified effective-interface query
Generalize `acquireEndpointOn` to enumeration (§5.4); add
`src/vrml/interface-query.js`; wire constraints from A; facade sub-object.
**Exit:** P2B/P2C bit-identical; projection-equivalence measurement exact (§15.1);
full §14.1 matrix.
*Second, because it consumes A's metadata and is the largest correctness risk in
the lane — it touches shared machinery `IS` and ROUTE both depend on.*

### WD1.6-C — containment legality
Add `src/vrml/containment.js` over A's tables and B's query.
**Exit:** §14.3 matrix; coverage measurement (§15.2); `UNSUPPORTED` never
degrades to `LEGAL`.

### WD1.6-D — semantic findings model
Add `src/vrml/semantic-findings.js` + reference adapter.
**Exit:** §14.4 matrix; both §16/§17 consumer proofs compile against the real
API; no `severity` reachable except through the adapter.

**D is independent of A/B/C** — it derives from scope-graph verdicts only — so it
may run in parallel with C, or first if P4 is prioritized over WD2. **A → B → C
is a hard chain.**

Each sub-lane is a separate STOP + report with a GO/NO-GO, per the repository's
staged-execution rule.

---

## 21. Exit criteria

WD1.6 is complete when:

1. `effectiveInterfaceOf` answers for built-in, `Script`, PROTO and EXTERNPROTO
   through **one** authority, proven by the equivalence measurement.
2. `childLegality` answers with a status-bearing verdict, never a bare boolean,
   and never returns `LEGAL` on absent metadata.
3. `node-schema.js` carries class tables and whatever constraints are honestly
   extractable, with counts and denominators asserted.
4. `SemanticFinding` carries ISO legality, profile acceptance and confidence as
   **separate** fields, and no severity.
5. Both consumer proofs compile and run against the real API.
6. Every fail-closed status survives every query path (§9.1).
7. P2B/P2C bit-identical; 1,102 existing tests green; new tests added.
8. No production code outside `src/vrml/` and `scripts/build-node-schema.js`
   changed; no new runtime dependency; corpus guards unchanged.
9. Every new standards-derived property cites its ISO section.

---

## 22. Risks and open questions

### Risks

| risk | mitigation |
|---|---|
| **§5.4 refactor regresses `IS`/ROUTE.** The highest-impact risk in the lane — it touches machinery two shipped namespaces depend on. | Pure refactor, bit-identical bar, P2B/P2C suites as the gate, equivalence measurement. Do it first inside B, alone, before enumeration is added. |
| **Constraint extraction produces a table that is wrong rather than absent.** A wrong `max` silently rejects legal input. | Strict patterns; absent-by-default; facet counts asserted; optional oracle for tier 2 only. |
| **A consumer treats `UNSUPPORTED` as "forbidden".** Would make WD2 refuse every legal EXTERNPROTO placement. | Named explicitly in §7.5/§17; the consumer proof demonstrates the permit-with-caveat path. |
| **`complete: false` ignored**, so an inspector implies an EXTERNPROTO's interface is exhaustive. | Separate boolean, not a status; degrades to showing fewer members, never inventing one. |
| **Two diagnostic universes emerge.** | One-way adapter; severity unreachable except through it; asserted by test. |
| **Cache outlives its parse.** | `WeakMap` keyed on the graph object; no id-keyed cache; the WD1.4 lesson. |

### Open questions for owner review

1. **Sub-lane granularity.** Four sub-lanes (A/B/C/D) with four GO/NO-GO gates,
   or fold C into B? *Recommendation: keep them separate — C's failure mode
   (over-refusal in a future UI) is different in kind from B's (wrong interface),
   and they deserve separate evidence.*
2. **Should D run first?** If P4 is the next lane after WD1.6, D unblocks it and
   is independent of A/B/C. *Recommendation: run A→B→C→D unless P4 is confirmed
   as the immediate successor.*
3. **Is the oracle authorized in principle** if tier-2 extraction shows gaps
   (§11), or should it be a separate approval at that moment? *Recommendation:
   separate approval — it is genuinely optional and may prove unnecessary.*
4. **Compatibility-profile naming.** `'cybertown-compat'` is used throughout as a
   placeholder. The real name is a product decision, and it appears in
   `SemanticFinding.profile`, so it should be settled before D ships.
5. **Does WD2 need a node-*creation* template** (default field values for a new
   node)? WD1.3 already has `defaultValue`, so this may be a thin addition to
   B — or it may belong to WD2. *Not planned here; flagged because it is the most
   likely "while you're in there" request.*
6. **Corpus measurement scope.** §15 proposes one required and one recommended
   measurement. Confirm the recommended one is wanted before B starts, since it
   shapes C's evidence.

### Owner adjudication (2026-08-29)

The six open questions above are settled. These decisions are authoritative and
supersede the recommendations recorded with each question.

1. **Sub-lane granularity — A, B, C and D remain four separate sub-lanes.** C is
   not folded into B. Each receives implementation → local validation → STOP
   uncommitted → independent QA → its own closeout commit.
2. **Order is A → B → C → D.** D does not run first, even though it is
   independent and would unblock P4.
3. **The White Dune oracle is not pre-authorized.** WD1.6-A starts without one.
   If tier-2 extraction exposes a recall question that ISO source, generator
   assertions and existing tests cannot settle, the lane STOPS and documents the
   exact gap; building `spikes/wd1-6-schema-oracle/` requires separate owner
   approval at that moment. Generic corpus guards are not weakened either way.
4. **Compatibility-profile naming is deferred to WD1.6-D**, where the historical
   behaviour's actual provenance is adjudicated. `'cybertown-compat'` is a
   placeholder in this document and must **not** be established as a production
   semantic API identifier in A, B or C — no placeholder constant that later
   becomes accidental API.
5. **Node-creation templates are out of scope for WD1.6.** WD1.3 already records
   default values; A adds semantic metadata only. Node creation belongs to WD2.
6. **The real-corpus containment-coverage measurement is approved, but it belongs
   to WD1.6-C** — not A and not B.

---

## 23. Lane boundary attestation

- Files created by this planning lane: **this document only.**
- `src/`, `renderer/`, `scripts/`, tests, generated schema, package metadata:
  **unmodified.**
- `spikes/*/corpus.js` and every corpus guard: **unmodified.**
- No White Dune code read, copied, adapted or translated in this lane. The audit
  it builds on is recorded under `OPEN_SOURCE_PROVENANCE.md` §4.1.
- P4, WD2, Mac work, X_ITE picking spike: **not started.**
- This document was written uncommitted for owner review; the review is
  recorded in §22 under **Owner adjudication (2026-08-29)**.
