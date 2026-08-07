# WD1.5-P2B — PROTO/EXTERNPROTO interface members and `IS` (as built)

Status: **implemented, uncommitted, internal and consumer-free.** The design
below is what shipped; where the implementation session found the plan wrong or
unimplementable, the section says so and §23 lists every such change in one
place. The standards rationale is unchanged throughout — only claims about
behaviour, APIs and measurements were rewritten from projected to measured.

**As-built summary**

| | |
|---|---|
| production files changed | `src/vrml/symbols.js`, `src/vrml/scope-graph.js` |
| test files | `test/vrml/interface-is.test.js` (new, 51 tests), `test/vrml/symbols.test.js`, `test/vrml/type-resolution.test.js` |
| harness | one `node --check` entry added to `package.json` |
| suite | **1048 pass / 0 fail / 0 skip** (baseline 997, +51) |
| corpus | 14,224 discovered · 4,460 parsed · **0 wrong bindings** · **0 confident answers from an unprovable scope** |
| parser / AST / schema | **unmodified**, as designed |
| consumers wired | **none** |

Predecessors: **WD1.5-P1** (`WD1_5_P1_SCOPE_GRAPH.md`, DEF/USE) and **WD1.5-P2A**
(`WD1_5_P2A_TYPE_RESOLUTION.md`, PROTO/EXTERNPROTO type names), both accepted and
merged. Successor: **WD1.5-P2C** (ROUTE endpoints).

Everything here inherits WD.md §7's hard gate without reopening it:

> A binding may be **lost**. A binding may be reported **ambiguous**. This lane
> may say a construct is too damaged to answer. It may **never** confidently bind
> a reference to the **wrong** declaration, or return a confident compatibility
> verdict it cannot prove.

---

## 1. Scope and non-goals

### In scope

1. **PROTO interface declarations** — `field` / `eventIn` / `eventOut` /
   `exposedField` members: name, type, access kind, default-value span,
   ownership, duplicates, exact source ranges, recovery.
2. **EXTERNPROTO interface declarations** — the same, minus defaults, plus an
   explicit statement of what the 4.9.2 subset rule can and cannot prove locally.
3. **Script interface declarations** — the `restrictedInterfaceDeclaration` set a
   `scriptBody` may contain, and the three `… IS …` forms Annex A gives it.
4. **`IS` connections** — which interface a given `IS` consults, whether the
   named member exists, access-kind legality (Table 4.4), and field-type
   compatibility (4.8.3).

### Explicit non-goals

Not built, not wired, not designed here:

- ROUTE endpoint resolution, event direction, ROUTE type checking — **P2C**.
- Diagnostics emission, `analyze.js` integration, `validator.js` integration,
  public façade exposure — **P4**.
- Node-identity integration — **P5**, gated on re-running the WD1.4 sweep.
- Renderer, editor, scene tree, inspector, rename/refactoring — **WD2**.
- Networking, URL fetching, external PROTO loading, runtime introspection.
- Script execution of any kind: no JavaScript, no Java, no `url` following, no
  browser bindings, no event delivery, no dynamic property discovery. P2B is
  strictly **structural and static**.
- Any consumer at all. Like P1 and P2A, this lane ships with **no production
  caller**.

---

## 2. Standards citations and confidence grades

Sources: the local ISO/IEC 14772-1 mirror at
`~/Projects/cybertown/wb-ct-scrape/specs/iso-14772-vrml97` (clause text and
Annex A grammar) and the committed WD1.3 schema. **No White Dune material, and no
other editor's implementation material, was consulted** — see
`GPL_PROVENANCE_BOUNDARY.md`.

Grades: **normative-explicit** = the clause states the rule outright ·
**normative-derived** = follows from a normative statement plus the grammar ·
**interpretation** = the standard is silent or ambiguous and the lane must fail
closed.

| # | Rule | Clause | Grade |
|---|---|---|---|
| S1 | An `exposedField` named *zzz* may be referred to as `set_zzz` (eventIn) and `zzz_changed` (eventOut). | 4.7 | normative-explicit |
| S2 | Declaring `exposedField zzz` in a PROTO interface is **equivalent to** declaring `field zzz`, `eventIn set_zzz`, `eventOut zzz_changed`. | 4.8.2 | normative-explicit |
| S3 | `IS` statements shall refer to fields or events defined in the prototype declaration; results undefined if the referent does not exist. | 4.8.3 | normative-explicit |
| S4 | Results undefined if the **type** of the associated field/event does not match the interface's declared type. SF↔MF is explicitly illegal, as is SFColor↔SFVec3f. | 4.8.3 | normative-explicit |
| S5 | Table 4.4 gives the legal access-kind mappings, **directionally**: rows are the prototype *definition* side, columns the *declaration* side. | 4.8.3 Table 4.4 | normative-explicit |
| S6 | Associating an exposedField in the definition with an eventIn/eventOut in the declaration may use the shorthand name (`translation`) **or** the explicit event name (`set_translation` / `translation_changed`). | 4.8.3 | normative-explicit |
| S7 | Results undefined if one field/eventIn/eventOut of a node in the definition is associated with **more than one** interface member. Multiple definition-side members mapping to **one** interface member is **valid**. | 4.8.3 | normative-explicit |
| S8 | Results undefined if a field is both given an initial value and associated by `IS`. | 4.8.3 | normative-explicit |
| S9 | Nested prototype definitions are local to the enclosing prototype. `IS` inside a nested prototype's implementation may refer to the declarations of the **innermost** prototype. | 4.8.4 | normative-explicit (see §6, Q5) |
| S10 | `IS` may appear inside the prototype definition **wherever fields may appear**. | 4.8.3 | normative-explicit |
| S11 | An EXTERNPROTO interface's names and types **shall be a subset** of the implementation's. A non-matching name is an error; a matching name with a different type is an error. | 4.9.2 | normative-explicit |
| S12 | EXTERNPROTO does not specify default field/exposedField values locally. | 4.9.1, 4.9.2 | normative-explicit |
| S13 | `scriptBodyElement` admits only `restrictedInterfaceDeclaration` — `eventIn` / `eventOut` / `field`. **`exposedField` is not a legal user declaration in a Script body.** | Annex A.3 | normative-explicit |
| S14 | A Script body's `IS` interface forms are exactly three: `eventIn T n IS n`, `eventOut T n IS n`, `field T n IS n`. There is **no** `exposedField … IS …` form. | Annex A.3 | normative-explicit |
| S15 | A PROTO `interfaceDeclaration` and an `externInterfaceDeclaration` have **no `IS` form at all**; `IS` in an interface *list* is non-conforming. | Annex A.2 | normative-explicit |
| S16 | `nodeBodyElement ::= fieldId IS fieldId \| eventInId IS eventInId \| eventOutId IS eventOutId` — the three are **syntactically identical** (`Id IS Id`); the distinction is semantic only. | Annex A.3 | normative-explicit |
| S17 | Script's own `url` **is** an exposedField (clause 6.40's node signature). S13 forbids *user-declared* exposedFields, not Script's built-in one. | 6.40 | normative-derived |
| S18 | Whether `IS` in a nested body may *also* reach an **outer** interface is not stated; 4.8.4 names only the innermost. | 4.8.4 | **interpretation** → fail closed, §6 Q5 |
| S19 | Field, eventIn, eventOut and exposedField names **shall be unique in each PROTO statement**, but are **not required to be unique between different PROTO statements**. | 4.3.5 | normative-explicit |
| S20 | A PROTO containing `exposedField zzz` **shall not** also contain an eventIn or eventOut named `set_zzz` or `zzz_changed`. | 4.3.5 | normative-explicit |
| S21 | An `IS` statement's left-hand name is a field/exposedField/eventIn/eventOut **from the node's own public interface**; the right-hand name is one from the prototype's interface declaration. | 4.3.6 | normative-explicit |
| S22 | Only the body of a node statement **inside a prototype definition** may contain `IS` statements. | 4.3.6 | normative-explicit |
| S23 | EXTERNPROTO semantics are **exactly the same as a PROTO statement's**, except that default field/exposedField values are not specified locally; an EXTERNPROTO interface declaration **is** a PROTO interface declaration bar initial values. A locally declared member is therefore a positive local statement of the type's public interface. | 4.9.2, 4.3.7 | normative-explicit |

S23 is the decisive citation for §9's positive/absence split: it makes what an
EXTERNPROTO *does* declare locally authoritative in exactly the way a PROTO's
declaration is, while S11's subset rule constrains only what it does **not**
declare.

S19 and S20 are the decisive citations for §4.6's uniqueness model and §7.2's
implicit-alias collision rule: both are stated outright rather than derived. S21
is the decisive citation for §8's endpoint model — the definition side is the
containing node's own interface, which is a schema question for a built-in and an
interface question for a Script or PROTO instance. S22 is the decisive citation
for §7.4.

---

## 3. Existing AST/parser facts — **no parser change is required**

Verified against `src/vrml/parser.js` and `src/vrml/ast.js` at `383cd64`.

`NODE.INTERFACE` (`InterfaceDecl`) already carries everything P2B needs:

| field | meaning | present |
|---|---|---|
| `access` | `field` / `eventIn` / `eventOut` / `exposedField` | ✅ |
| `fieldType`, `fieldTypeRange` | the type token and its span | ✅ (`null` when unrecovered) |
| `name`, `nameRange` | the member name and its span | ✅ (`null` when unrecovered) |
| `default` | the default value node, PROTO/Script only | ✅ |
| `is`, `isRange` | the `IS` target name and span (Script form) | ✅ |
| `range` | the whole declaration, from the access keyword | ✅ |

`NODE.PROTO` carries `name` / `nameRange` / `interfaces[]` / `body[]` / `range`;
`NODE.EXTERNPROTO` carries `name` / `nameRange` / `interfaces[]` / `url` /
`range`. A node-body `IS` is a `NODE.FIELD` with `isBinding: true` whose `value`
is a `NODE.IS` carrying `name` / `nameRange`; the field's own `nameRange` is the
definition-side endpoint name. That is exactly the `Id IS Id` pair S16 describes.

Consequences:

- **Both `IS` sites are already distinguishable and fully ranged.** No new AST
  node, no new field, no re-parse.
- **S8 is detectable**: a field given a value and a field given `IS` are two
  separate `node.fields` entries with the same `name`.
- **S7 is detectable**: two `isBinding` entries with the same field `name` in one
  node.
- **S15 is detectable**: `is != null` on a declaration inside a
  `Proto`/`ExternProto` `interfaces[]` array.
- **S13 is detectable**: `access === 'exposedField'` on a declaration in a
  non-Script `interfaces[]` array — and, per §5, the parser only ever populates
  `node.interfaces` for node bodies, so a Script check is a node-type check.

Two **additive, optional** parser refinements are noted and **deliberately not
required**: the access keyword has no span of its own (only the declaration's
start), and the `IS` keyword token has no span of its own. Neither is needed for
any semantic answer in this lane; both are diagnostics-anchoring conveniences
that belong to P4 if they are ever wanted. **P2B must not change the parser.**

---

## 4. Interface-member symbol model

### 4.1 A third namespace, in its own tables

`NAMESPACE.INTERFACE_MEMBER` is already declared in `src/vrml/symbols.js` and
already unused. P2B populates it, in **separate tables and separate lookup maps**
from both `NODE_NAME` and `NODE_TYPE`. A `DEF Ball`, a `PROTO Ball` and a
`field SFBool Ball` are three unrelated declarations and must never collide.

### 4.2 An interface is a scope, and it has **no parent link**

The three scope kinds `symbols.test.js` already pins as *absent* are exactly the
ones P2B adds:

| new `SCOPE_KIND` | owner | may an `IS` resolve in it? |
|---|---|---|
| `proto-interface` | a `Proto` declaration | **yes** — the only lookup target |
| `externproto-interface` | an `ExternProto` declaration | **no** — it has no body, so no `IS` is lexically inside it. It *is* consulted as an **endpoint namespace** (§8/§9), which is a different question from hosting an `IS` lookup |
| `script-interface` | a `Script` node instance | **no** — it *declares* members; it does not host `IS` lookups |

Crucially, an interface scope carries **neither `defParent` nor `typeParent`**.
It is not reached by walking any chain. This is the same structural technique P1
used for 4.8.4 disjointness: the outward walk is impossible because there is
nowhere to walk to, not because a special case forbids it.

### 4.3 How an `IS` reaches its interface: a carried owner, never a search

During traversal the builder carries an `isOwner` — the innermost enclosing
`proto-interface` scope — down the tree, exactly the way P1 carries
`insideScript`. It is **rebuilt on descent, never mutated**, and:

- entering a `Proto` body sets `isOwner` to that PROTO's interface scope;
- entering an `ExternProto` sets nothing (no body exists);
- entering a `Script` node does **not** change `isOwner` — a Script inside a
  PROTO body still `IS`-binds to the enclosing PROTO's interface (S9, S10), and
  the corpus confirms this is the dominant real shape (§10);
- at document level `isOwner` is `null`, and any `IS` there is invalid (§7.4).

There is **no nearest-enclosing search, no range containment test, no ancestor
walk** to find the owner. Those are the WD.md §7 rejected strategies in a new
costume; recovery moves ranges, and a containment search over moved ranges is how
P2A first produced a wrong answer.

### 4.4 Ownership representation

An interface member symbol records its owning **interface scope object** — an
identity, never a name, never a path, never a delimiter-joined key. WD1.4 already
paid for a `/`-joined scope key once; nothing here reintroduces one.

### 4.5 Script members share the representation, not the ownership

Script and PROTO members use one abstract shape (name, type, access, ranges,
owner) but different `SYMBOL_KIND` and different owning scope kind:

- `SYMBOL_KIND.PROTO_INTERFACE_MEMBER` — owned by a `proto-interface` **or** an
  `externproto-interface` scope (the owning scope kind distinguishes the two; this
  matches the two symbol kinds `symbols.test.js` already names).
- `SYMBOL_KIND.SCRIPT_INTERFACE_MEMBER` — owned by a `script-interface` scope.

They are never merged into one lookup table. A Script's `field SFBool run` and its
enclosing PROTO's `field SFBool run` are two different declarations in two
different scopes that happen to share a spelling.

### 4.6 Uniqueness and duplicates

**Member uniqueness is per interface scope, on the name alone**, decided before
type or access is considered — the same rule P1/P2A use for DEF and type names,
for the same reason: narrowing duplicates by some secondary attribute and taking
the survivor is precisely how a confident wrong answer is produced. S19 states
this outright: names "shall be unique in each PROTO statement, but are not
required to be unique between different PROTO statements".

Two same-named members in **one** interface → the name is ambiguous in that
interface; an `IS` naming it returns `ambiguous`, never a pick.
Two same-named members in **distinct** interfaces (including a nested PROTO's) →
**not** a duplicate. Different scope, different namespace instance.

**Implicit-alias collisions count, and the standard says so.** Per S2,
`exposedField zzz` also occupies `set_zzz` and `zzz_changed`, and **S20 forbids
declaring them alongside it outright**. An interface declaring both
`exposedField zzz` and `eventIn set_zzz` therefore has a genuine duplicate on
`set_zzz` — a stated prohibition, not an inference. The uniqueness index is built
over **effective member names** (§7.2), not over written names only. The corpus
contains 3 such collisions (§10).

---

## 5. PROTO / EXTERNPROTO / Script interface semantics

### 5.1 PROTO

Members come from `proto.interfaces[]` only. `field` and `exposedField` may carry
a default; `eventIn` and `eventOut` may not. Members are visible to any `IS`
inside that PROTO's body — **including before the declaration completes**, because
an interface is a member set, not an ordered visibility chain. 4.8.4's "after the
completion of the definition" governs *instantiation* of the type (P2A's
`visibleFrom`), not intra-body `IS` lookup, and the two must not be conflated.

**Inherited limit (P1 limit 1, P2A limit 1):** interface **default values** are
not traversed for DEF/type purposes, and P2B does not change that. A `Script`
buried inside a PROTO interface default value therefore mints no interface scope.
This is deliberate, fails closed, and must be pinned by test as in P1/P2A.

### 5.2 EXTERNPROTO

Members come from `ext.interfaces[]`. Per S12 no defaults exist; a `default`
present on an EXTERNPROTO member is non-conforming (corpus count: **0**). An
EXTERNPROTO owns an `externproto-interface` scope so its members have an owner,
can be listed and uniqueness-checked, **and can serve as the definition-side
endpoint namespace for an instance of that type** (§8/§9) — per S23 the
declaration states the same facts a PROTO's would. **No `IS` ever resolves *in*
one**, because no `IS` is ever lexically inside an EXTERNPROTO; that is separate
from the scope being consulted for an endpoint elsewhere.

### 5.3 Script

Members come from `node.interfaces[]` where `node.nodeType === 'Script'`. Per S13
`exposedField` is not a legal user declaration there; per S17 that prohibition
does not touch Script's own built-in `url` exposedField, which is a clause-6
schema fact and not a lexical declaration at all.

The corpus carries **1,577** user-declared `exposedField`s inside Script bodies
(§10). Per WD.md §9 that is a **compatibility-profile observation**, recorded and
tagged — never silently normalized into conforming behaviour, and never promoted
into the language rules. It does not block anything in P2B.

A declaration in `node.interfaces[]` on a **non-Script** node type is
non-conforming (corpus count: **0**), and is recorded rather than accepted as a
Script-equivalent interface.

---

## 6. The eleven model questions, answered

1. **Where do interface member symbols live?** In per-interface tables keyed by
   the owning interface scope object, in the `interface-member` namespace, held in
   the graph's private `INTERNALS` state. Never in the DEF or type tables.
2. **Is each interface its own scope rather than part of `defParent`/`typeParent`
   lookup?** Yes. Its own `SCOPE_KIND`, and **no parent link of either sort**.
3. **How is ownership represented?** By the interface scope **object identity**.
4. **How does `IS` reach the enclosing interface without walking unrelated outer
   interfaces?** By a carried `isOwner` fixed at build time (§4.3). No chain
   exists to walk, so an outward leak is structurally impossible.
5. **May a nested PROTO body's `IS` refer to an *outer* PROTO's interface?**
   **No — innermost only.** 4.8.4 names the innermost prototype explicitly (S9)
   and is silent on the outer case (S18). Under WD.md §7 an interpretation-grade
   permission fails closed. This is also empirically free: across **27,756** `IS`
   statements the corpus contains **zero** that would need an outward walk (§10).
   A member found only in an outer interface therefore answers
   `unresolved / interface-member-not-declared`, and the outer hit is reported as
   non-binding `detail` so a future diagnostic can explain it.
6. **How are Script members represented relative to PROTO members?** Same
   abstract shape, different `SYMBOL_KIND`, different owning scope kind (§4.5).
7. **Do they share one representation with different ownership?** Yes — one
   shape, two kinds, never one table.
8. **Two same-named members in one interface?** Ambiguous on the name alone
   (§4.6). No pick, ever.
9. **Same name in distinct nested interfaces?** Not a duplicate. Distinct scopes.
10. **What object identity prevents cross-interface binding?** The interface
    scope object, plus the existing `symbols.js` owner-token branding: a
    projection from another graph — even from a second parse of byte-identical
    text — is rejected, not resolved.
11. **What does member uniqueness mean?** Exactly one member with that
    **effective** name (written or implicit-alias, §7.2) in that one interface
    scope, asserted only when that scope is provable.

---

## 7. The `IS` binding model

### 7.1 One `IS`, two independent questions

An `IS` is modelled as **one `REFERENCE_KIND.IS` reference** answering the
**declaration-side** (RHS) lookup, plus a **separate compatibility verdict** that
additionally needs the **definition-side** (LHS) endpoint.

They are kept separable on purpose: the LHS endpoint can be unknowable (the
containing node's type does not resolve) while the RHS binding is perfectly
provable, and collapsing the two would throw away a good answer. Conversely a
failed RHS lookup makes compatibility unaskable — there is nothing to be
compatible *with*.

| side | syntax | namespace | authority |
|---|---|---|---|
| LHS (definition) | the field/event name on the containing node | **not lexical** for built-ins | WD1.3 schema, or a Script/PROTO interface |
| RHS (declaration) | the interface member name | `interface-member` | the innermost enclosing `proto-interface` scope |

### 7.2 Effective names — implicit alias expansion

Per S1/S2/S6, alias expansion applies on **both** sides, and it **changes the
effective access kind**. This is the single subtlest rule in the lane.

Given a declared `exposedField zzz` of type `T`, the interface effectively holds:

| effective name | effective access | type |
|---|---|---|
| `zzz` | `exposedField` | `T` |
| `set_zzz` | `eventIn` | `T` |
| `zzz_changed` | `eventOut` | `T` |

Table 4.4 is applied to the **effective** access, never the written one. Binding
`set_zzz` and then testing it as an `exposedField` would wrongly accept a
definition-side `field`.

Expansion is **generated on demand into the member index, not written anywhere**.
A `field`/`eventIn`/`eventOut` declaration generates **no** aliases.

**There is no precedence between an explicit declaration and an implicit alias.**
If an effective name is occupied by both the alias generated from
`exposedField zzz` and an explicit `eventIn set_zzz` / `eventOut zzz_changed`,
that effective name is **duplicate and ambiguous** (§4.6) — S20 prohibits the
combination outright, so neither declaration is the "intended" one. Lookup must
not prefer the explicit declaration, must not prefer the alias, and must not
apply first-match, source-order, best-candidate or any other ranking. It returns
`ambiguous / duplicate-interface-member` and binds nothing. Resolving this by
ranking is exactly the WD.md §7 failure mode.

The same rule gives the LHS its effective endpoint on a built-in node — see §8.

### 7.3 Resolution order (the upfront gate first)

```
1. graph ownership / projection validity        (assertMember, as P1/P2A)
2. is there an RHS name at all?                 -- a token fact, not lexical
3. THE GATE: is every provability precondition met?   -- if not: recovered, full stop
4. is there an enclosing PROTO interface?       -- if not: invalid
5. RHS member lookup (effective names)          -- resolved / unresolved / ambiguous
6. LHS endpoint acquisition                     -- may answer "unavailable"
7. access compatibility (Table 4.4)             -- only with 5 and 6 both proven
8. field-type compatibility (exact equality)    -- only with 5 and 6 both proven
```

Steps 5–8 each produce a stable status; none of them is reached from a damaged
scope, because step 3 already returned.

### 7.4 `IS` with no enclosing PROTO body

`invalid / is-outside-proto-body`. S10 and **S22** both scope `IS` to a node body
inside a prototype definition, and Annex A gives no other host. 4.3.6 is explicit:
"The body of a node statement that is inside a prototype definition may contain IS
statements." The corpus contains **102** of these (§10) — real,
non-conforming, Cybertown-authored content. It is a first-class classified answer,
not a parse failure.

### 7.5 Multiplicity (S7, S8)

Two additional per-node checks, both structural and both statically decidable:

- **`duplicate-is-for-endpoint`** — the same definition-side endpoint name bound
  by `IS` more than once in one node (S7: undefined). Note that *many* endpoints
  binding to *one* interface member is explicitly **valid** and must not be
  flagged.
- **`field-valued-and-is`** — the same field both given a value and `IS`-bound in
  one node (S8: undefined).

Both are properties of a node, not of a single reference, and are exposed as a
per-node query rather than folded into an `IS` resolution.

---

## 8. Built-in endpoints come from the WD1.3 schema — and one gap

Per **S21**, the definition-side name is one "from the node's public interface" —
so the endpoint namespace is decided by the containing node, not by the PROTO. For
an ordinary built-in node that is a schema question. Its authority is
`src/vrml/node-schema.js` and **nothing else**. P2B builds **no second endpoint
table**.

```
getFieldSchema(nodeType, fieldName) -> { type, accessType, vrml97Declaration, profiles, … }
```

`vrml97Declaration` is precisely the VRML97 access kind Table 4.4 needs
(`field` / `eventIn` / `eventOut` / `exposedField`), and `type` is the field type.
**X3D-only leakage is already prevented**: a field whose `vrml97Declaration` is
`null` is X3D-only and must be treated as **not a VRML97 endpoint**, exactly as
`isVRML97Field` decides. There are 232 such fields.

### The gap: implicit event aliases are absent from the schema

Verified at `383cd64`:

```
getFieldSchema('Transform', 'translation')        -> exposedField SFVec3f
getFieldSchema('Transform', 'set_translation')    -> null
getFieldSchema('Transform', 'translation_changed')-> null
```

The schema records **declared** interface names only. The implicit `set_zzz` /
`zzz_changed` aliases of an exposedField are a **clause 4.7/4.8.2 language rule**,
not an extra ISO declaration — so this is correct generator behaviour, and the
schema must **not** be regenerated to add them.

P2B therefore applies the §7.2 expansion to schema lookups too:

1. exact `getFieldSchema(nodeType, name)` with a non-null `vrml97Declaration`;
2. otherwise, if `name` is `set_X` / `X_changed` and `X` resolves to a VRML97
   **exposedField**, the endpoint is that exposedField with effective access
   `eventIn` / `eventOut`;
3. otherwise `is-endpoint-unknown-field`.

Corpus impact: **11,681** endpoints hit directly, **8** only via alias expansion,
**34** resolve to neither (§10). Small, real, and wrong without it.

### When the node type is not resolvable

If the containing node's type does not answer `resolved` from **P2A**, P2B
**does not guess the endpoint**. Formally: the endpoint is available only when
`resolveNodeType` on that node returns `resolved`, and then the endpoint
namespace is decided by what it resolved to:

| P2A result | endpoint namespace | origin |
|---|---|---|
| `resolved`, `reason === node-type-is-builtin` | the WD1.3 schema for that node type | `builtin-schema` |
| `resolved` to a `PROTO_DECL` | that PROTO's `proto-interface` scope | `proto-interface` |
| `resolved` to an `EXTERNPROTO_DECL` | that EXTERNPROTO's `externproto-interface` scope — **positive when the effective member is locally declared**, `unsupported` only when it is locally absent (§9) | `externproto-interface` |
| `resolved` to a Script instance's own interface | that `script-interface` scope | `script-interface` |
| `unresolved` / `ambiguous` / `invalid` / `recovered` | none | — |

Every non-`resolved` P2A outcome yields `is-endpoint-node-type-unresolved`, and
**no** access or type verdict is returned. The RHS binding still stands on its
own.

Note the shape of the EXTERNPROTO row: it is **not** a blanket refusal. Lookup
proceeds normally against the local declaration — including §7.2 alias
expansion — and only the *miss* branch diverges, answering `unsupported`
instead of `unresolved`. The three interface-backed origins share one code path;
the EXTERNPROTO difference is confined to how absence is reported.

The corpus has **962** `IS` statements on non-built-in node types, so this path
is load-bearing, not theoretical.

---

## 9. The EXTERNPROTO subset rule — conclusion

S11 requires the declared interface to be a **subset of the implementation's**.
Answering the prompt's questions precisely:

| question | answer |
|---|---|
| subset of what? | the **implementation's** interface — the PROTO found at the EXTERNPROTO's URL |
| compared when? | at load/resolution of the external definition |
| does ordering matter? | **no** — it is a set relation |
| do names matter? | **yes** — a non-matching name is an error |
| do types matter? | **yes** — a matching name with a different type is an error |
| do access kinds matter? | **yes**, derived: 4.9.2 enumerates the four categories separately (normative-derived, not explicit) |
| do defaults matter? | **no** — S12 says defaults are not given locally |

**What P2B can honestly enforce now: nothing about the subset relation.** The
implementation is not available without fetching a URL, and P2B does no
networking. What it *can* do locally is verify the declaration is well-formed —
name present, type token present, access legal, no duplicate effective name.

### The positive / absence split — the precise fail-closed boundary

The subset rule is **asymmetric**, and this is the load-bearing distinction of
this section. `interfaceIsSubset` constrains only one direction.

**A locally declared member is positive local information.** Per **S23** an
EXTERNPROTO interface declaration *is* a PROTO interface declaration bar initial
values — 4.9.2's "exactly the same as for a PROTO statement". When the requested
effective member is explicitly represented in the local declaration (including
the §7.2 exposedField aliases, which S23 carries across along with the rest of
PROTO interface semantics), the document itself states its **name, declared
access kind and type**. P2B uses that declaration directly, exactly as it would a
PROTO's, and access/type compatibility proceeds from it.

**Loading the implementation is not a precondition for using a member the
EXTERNPROTO explicitly declares.** A future external-resolution lane may find
that the implementation violates the subset contract, but that is a fact about
the *implementation* — it does not retroactively erase a public interface the
current document declares in plain text. Refusing here would be conservatism
without a safety payoff: it discards information the standard says is present.

**Local absence is where the subset rule bites.** Because the declaration may be
a strict subset, a member's absence from it is **not** evidence the implementation
lacks it. So:

| requested effective member | answer |
|---|---|
| **locally declared** (written name or §7.2 alias) | positive endpoint from the local declaration; origin `externproto-interface`; compatibility proceeds |
| **locally absent** | `STATUS.UNSUPPORTED / externproto-interface-not-locally-verifiable` |

The absence case must be `unsupported` — **never** `unresolved /
is-endpoint-unknown-field`, and never a confident negative member-existence
claim. `unresolved` would assert "no such member", which is precisely what
cannot be known without the implementation. This is the first real use of the
long-published `unsupported` status, which is exactly what it was reserved for.

Under no circumstance does P2B fetch, load or follow the EXTERNPROTO URL to
decide either branch.

---

## 10. Corpus measurements

> **As built.** The planning figures are kept below for comparison; the
> implementation sweep's own figures are here. Two methodology differences
> explain every material delta, and both were verified rather than assumed:
>
> 1. **De-duplication key.** Planning hashed **raw bytes**; the implementation
>    sweep hashes **decoded text**, so a gzip `.wrl` and its plain twin collapse
>    to one file instead of two. Measured directly over the same discovered set:
>    **6,262** distinct raw-byte files vs **4,463** distinct decoded texts. That
>    is the whole of the 6,252 → 4,460 difference, and the implementation figure
>    covers the same *distinct content* more tightly.
> 2. **Corpus drift.** 14,216 → **14,224** discovered, a different fingerprint.
>    The roots are external trees that change independently; this is an input
>    change, not an analysis change.
>
> Counts that are content-shape rather than file-count facts came out
> **identical** to planning, which is the useful cross-check: `IS` with no
> enclosing PROTO = **102**, `IS` in an interface declaration list = **20**.
>
> **Implementation sweep**
>
> - fingerprint `f63631cc33e12b38056e5d724a9aceedc4460d8517aac3a46dece080b9a2f5a4`
> - discovered **14,224** · parsed **4,460** · duplicate content 9,740 ·
>   unreadable/other 24 · syntactically damaged **212**
>
> | measurement | count |
> |---|---|
> | interface scopes: proto / externproto / script | 3,031 / 1,210 / 9,519 |
> | interface members, total | 137,916 |
> | — PROTO (exposedField/eventIn/eventOut/field) | 10,702 / 7,459 / 5,301 / 3,140 |
> | — EXTERNPROTO | 5,570 / 1,501 / 1,499 / 3,753 |
> | — Script | 1,278 / 38,663 / 26,197 / 32,853 |
> | — with a default value | 45,524 |
> | — missing name / missing type | **0 / 0** |
> | `IS` statements, total | **23,246** |
> | — node-body form / Script form | 10,558 / 12,688 |
>
> **Declaration-side (RHS) outcomes**
>
> | outcome | count |
> |---|---|
> | `resolved / ok` | 23,106 |
> | `invalid / is-outside-proto-body` | **102** |
> | `ambiguous / duplicate-interface-member` | 15 |
> | `recovered / interface-not-provable-for-reference` | 23 |
> | `unresolved / interface-member-not-declared` | **0** |
> | bound via implicit alias | **0** |
> | found only in an OUTER interface | **0** |
>
> The last two confirm the plan's key prediction: **innermost-only lookup costs
> nothing on real content**, and no RHS name in the corpus needs alias expansion.
>
> **Connection verdicts**
>
> | outcome | count |
> |---|---|
> | `resolved / ok` | 20,262 |
> | `invalid / is-access-incompatible` | **1,481** |
> | `unresolved / is-endpoint-node-type-unresolved` | 1,337 |
> | `unresolved / is-endpoint-unknown-field` | 26 |
> | `unsupported / externproto-…-not-locally-verifiable` | **0** |
>
> **Endpoint origins:** built-in schema 8,735 · script-interface 12,629 ·
> proto-interface 308 · externproto-interface 71 · acquired via alias 7.
>
> **Compatibility-profile shapes:** user `exposedField` in a Script body
> **1,278**; `IS` in an interface declaration list **20**.
>
> ### The one substantial new finding: 1,481 access incompatibilities
>
> 6.4% of corpus `IS` statements land on a `no` cell of Table 4.4, and **every
> one is the `exposedField` COLUMN** — a PROTO/Script interface `exposedField`
> associated with a definition-side `field`, `eventIn` or `eventOut`. The
> dominant shapes are `field T x IS <exposedField>` inside a Script (the
> `field SFVec3f initialPosition IS translation` idiom) and
> `eventOut T x IS <exposedField>` on a built-in.
>
> Because this is by far the highest-impact semantic call in the lane, the matrix
> orientation was re-verified against the ISO mirror **after** the measurement
> rather than trusted: 4.8.3's table (rows = prototype *definition*, columns =
> prototype *declaration*) matches the implemented matrix cell for cell, and the
> prose states the asymmetry outright — "An exposedField in the prototype
> interface may be associated only with an exposedField in the prototype
> definition". The findings are therefore **real non-conformances in authored
> Cybertown content**, not a transposition bug.
>
> Nothing is surfaced: P2B wires no consumer. **Open question for P4** — whether
> this shape should reach a user as an error, or as a WD.md §9
> compatibility-profile warning given how widespread and evidently intentional it
> is. It is flagged, not decided, here.
>
> ---
>
> **Planning measurements follow, unchanged.**

Read-only, boundary-guarded (the committed WD1.4 discovery, which refuses
`white-dune`, `white_dune`, `RE-ARTIFACTS`, `blaxxun-cs-RE`, `Downloads`,
`node_modules`), deterministic, run from a scratchpad script that wrote nothing
into the repository or the corpus. No corpus file was modified.

- **Discovered file set fingerprint** (sha256 over `id:size`, codepoint-ordered):
  `59ce32e16560b653f9ad3734688ec5024f040dd64d197956ead1596ac1dc13ef`
- Discovered **14,216**; parsed **6,252** after content de-duplication and caps;
  **253** parsed files carry syntax damage.

| measurement | count |
|---|---|
| PROTO declarations | 3,634 |
| — nested PROTO declarations | 22 |
| — empty interface list | 183 |
| EXTERNPROTO declarations | 1,279 |
| PROTO interface members | 31,342 |
| — `exposedField` / `eventIn` / `eventOut` / `field` | 12,767 / 8,700 / 6,275 / 3,600 |
| — with a default value | 16,347 |
| EXTERNPROTO interface members | 13,013 |
| — `exposedField` / `eventIn` / `eventOut` / `field` | 5,952 / 1,598 / 1,650 / 3,813 |
| Script nodes | 13,219 |
| Script interface declarations | 134,272 |
| **`IS` statements, total** | **27,756** |
| — in a Script interface declaration (`… IS …` form) | 15,013 |
| — in a node body (`fieldId IS fieldId`) | 12,743 |
| — inside a **nested** PROTO body | 90 |
| — in a syntactically damaged file | 4,199 |
| ROUTE statements (P2C's problem) | 266,936 |

**RHS resolution against the innermost interface only:**

| outcome | count |
|---|---|
| direct hit on the innermost interface | **27,654** |
| hit only via implicit alias expansion | **0** |
| found only in an **outer** interface | **0** |
| not found anywhere | **0** |
| no enclosing PROTO at all (§7.4) | **102** |

27,654 + 102 = 27,756 — every `IS` accounted for. **The innermost-only rule
(§6 Q5) costs nothing on real content.**

**LHS endpoints (node-body `IS` only):**

| outcome | count |
|---|---|
| built-in field, direct schema hit | 11,681 |
| built-in field, only via implicit alias (§8) | 8 |
| built-in node, unknown field | 34 |
| non-built-in node type (needs P2A) | 962 |

**Non-conforming shapes found (compatibility-profile items, WD.md §9):**

| shape | count | representative |
|---|---|---|
| user `exposedField` in a Script body (S13) | 1,577 | `ct-campus:…/property/vrml/008/home.wrl` — `exposedField SFBool run` |
| `IS` inside a PROTO **interface list** (S15) | 20 | `ct-campus:…/bank/vrml/templates/tvrcDrive.wrl` — `exposedField SFColor diffColorLow IS diffColorLow` |
| `IS` with no enclosing PROTO (§7.4) | 102 | `ct-campus:…/club/vrml/club_proto.wrl` — `diffuseColor IS floorColor` |
| duplicate member name, PROTO interface | 18 (8 identical) | `ct-campus:…/property/vrml/008/home.wrl` — `exposedField SFString name` |
| duplicate member name, EXTERNPROTO interface | 70 (all 70 identical) | `ct-mall-archive:…/suburbs/orog.wrl` — `field SFInt32 numberOfChoices` |
| exposedField/implicit-alias collision | 3 | — |
| EXTERNPROTO member with a default (S12) | 0 | — |
| interface declarations on a non-Script node | 0 | — |
| member with a missing name or missing type | 0 | — |

Every zero above was **proven reachable** by running the same classifier over an
authored adversarial file that produces each branch — a zero here means "measured
absent", not "never tested".

Type distribution across all interface members (top): `SFTime` 7,254 ·
`MFString` 5,230 · `SFBool` 4,933 · `MFNode` 4,675 · `SFVec3f` 4,205 ·
`SFInt32` 3,585 · `SFString` 3,246 · `SFFloat` 2,763 · `SFRotation` 2,344 ·
`MFFloat` 1,777 · `SFColor` 1,121 · `MFVec3f` 906 · `SFNode` 888 · `SFVec2f` 792 ·
`MFRotation` 314 · `MFInt32` 194 · `MFVec2f` 63 · `MFColor` 61 · `SFImage` 4.

---

## 11. Access-kind compatibility matrix (Table 4.4)

**Directional. Rows are the prototype *definition* side (the LHS endpoint);
columns the *declaration* side (the RHS interface member).** Do not transpose, do
not assume symmetry, and do not collapse `exposedField` into "field + two events"
— S5's row and column for `exposedField` are deliberately different.

| definition ↓ \ declaration → | `exposedField` | `field` | `eventIn` | `eventOut` |
|---|---|---|---|---|
| **`exposedField`** | yes | yes | yes | yes |
| **`field`** | no | yes | no | no |
| **`eventIn`** | no | no | yes | no |
| **`eventOut`** | no | no | no | yes |

Confidence: **normative-explicit** (S5), with the prose of 4.8.3 independently
agreeing in both directions — "an exposedField in the prototype interface may be
associated only with an exposedField in the prototype definition" (the
`exposedField` **column**) and "an exposedField in the prototype definition may be
associated with either a field, eventIn, eventOut or exposedField in the prototype
interface" (the `exposedField` **row**).

Special rules:

- The matrix is applied to **effective** access after alias expansion (§7.2), not
  to written access.
- A `no` cell is `invalid / is-access-incompatible`, with both access kinds and
  both spans as evidence.
- The three "results are undefined if…" bullets of 4.8.3 (eventIn↔field/eventOut,
  eventOut↔field/eventIn, field↔eventIn/eventOut) are the same `no` cells stated
  in prose; they are **not** additional rules and get no separate reason.
- The matrix is a table in one place, consulted once. `accessType` in the WD1.3
  schema is the X3D spelling (`inputOnly`/`outputOnly`/`initializeOnly`/
  `inputOutput`); **use `vrml97Declaration`**, which is already the VRML97
  spelling, and do not build a second mapping.

---

## 12. Field-type compatibility

**Exact equality of the type token. No promotion, no coercion, no SF↔MF
relationship, no default-value influence.**

S4 states it and gives two worked counter-examples: `SFColor`↔`SFVec3f` is
illegal despite both being three floats, and `SFColor`↔`MFColor` is illegal in
both directions. There is no compatible-but-unequal case anywhere in 4.8.3.

- Node-valued types (`SFNode` / `MFNode`) follow the identical rule; the *node
  type* inside them is **not** checked — the standard imposes no such constraint
  at the `IS` boundary, and inventing one would be interpretation-grade.
- Defaults never affect compatibility (S8 makes a valued-and-`IS` field undefined
  regardless of the value).
- Everything needed is decidable statically **provided both sides are known**.
- Authority is the type token: the interface member's `fieldType` on one side,
  and the WD1.3 schema's `type` (or the other interface's `fieldType`) on the
  other. **No second field-type table is created.** A type token the schema does
  not recognise is `is-type-unknown`, not a silent pass.

---

## 13. The recovery proof gate

P2A's binding lesson: **prove the whole relevant chain once, up front, before
returning any lexical conclusion.** A per-branch guard is one `return` away from a
leak, and P2A leaked exactly that way before adjudication. P2B adopts the same
structure — a single `interfaceChainWithholds(state, reference)` called at step 3
of §7.3, with nothing below it reachable from a damaged construct.

### What must be provable

| # | precondition | why |
|---|---|---|
| G1 | the document is not `truncated` / `depthCapped` | a hard cap aborts the tree; no scope is provable |
| G2 | the enclosing **PROTO body** scope is not `recovered` | an unclosed body absorbs following statements, moving *which* interface an `IS` belongs to |
| G3 | the owning **interface** scope is not `recovered` | an unclosed `[` absorbs following statements into the interface list, **manufacturing members** |
| G4 | for a Script-form `IS`, the **script-interface** scope is not `recovered` | same fabrication hazard on the declaring side |
| G5 | for any endpoint verdict, P2A returns `resolved` for the containing node's type | §8 — otherwise the endpoint is a guess |

G1–G4 gate the RHS binding. G5 additionally gates §11/§12 verdicts only, so a
provable RHS binding survives an unprovable endpoint.

### What a damaged construct must never manufacture

Each of these is an **assertion** recovery is capable of fabricating, so each sits
**below** the gate — including the negative and ambiguous ones, which is the part
that is easy to get wrong:

- a positive binding (`resolved`) — a moved boundary can invent the only match;
- **a negative "member does not exist"** — a truncated interface list loses
  members, so absence is unprovable;
- **a duplicate/ambiguity claim** — an unclosed list absorbs a second declaration
  that was never in this interface;
- a `legal`/`illegal` access verdict;
- a `compatible`/`incompatible` type verdict;
- a uniqueness assertion;
- the identity of the owning interface.

P1/P2A precedent is followed exactly: a uniqueness query on a damaged scope
answers `{unique:false, reason:<recovery reason>}` — **declining to assert
uniqueness, not asserting duplication.**

### Interface-scope recovery attribution

Adding real interface scopes **improves** P1's limit 2 (recovery attributed too
coarsely because no interface scopes existed). A syntax error inside an interface
list now attributes to the innermost containing scope, which is the interface — as
in P1, strictly more conservative than not attributing it, and it can only turn
`resolved` into `recovered`.

**Load-bearing, not decorative:** 4,199 corpus `IS` statements live in
syntactically damaged files. Mutation tests (§16) must prove that removing any
gate condition changes an outcome.

### As built: the gate holds, and three conditions are not what the plan assumed

The gate shipped exactly as designed — one `interfaceChainWithholds` called
before any lexical branch, with G5 in `acquireEndpoint` gating endpoint verdicts
only. The corpus confirms it works: **0 confident answers from an unprovable
scope** across 23,246 `IS` statements.

The mutation suite then found that **three of the five conditions are not
independently observable where the plan placed them.** Each was investigated
rather than asserted away, per the lane's own instruction not to retain
ceremonial gates:

| gate | finding | resolution |
|---|---|---|
| **G1** | Not the sole defence. A hard cap also makes `markRecovery` blanket-mark every scope, so G2 still withholds. What G1 uniquely supplies is the **precise reason**: removing it degrades `document-parse-incomplete` into the vaguer `interface-not-provable-for-reference`. | Kept. Mutation-observable (the reason changes), and the test records that it is a diagnostic-quality condition, not a safety one. |
| **G3** (reference side) | **Subsumed by G2, always.** A proto-body scope's `ownerRange` is the whole `Proto` node, which *contains* its own interface list, so every diagnostic marking an interface unprovable marks the body unprovable too. No fixture reaches the branch. | Kept, and the mutation suite exercises G3 where it **is** independently observable — `interfaceEndpoint`, whose interface belongs to a *different* declaration whose body is unrelated to the reference. The containment that makes the reference-side check redundant is now **pinned by test** (test 35b), so if it ever stops holding the suite fails rather than a gap opening silently. |
| **G4** | Its *recovered* half is subsumed the same way; its **absence** half is not. A `… IS …` written in a non-Script node's interface list parses cleanly and has no interface scope to answer from, and nothing else withholds it. | Kept. Mutated through the absence branch, which is genuinely sole-defence. |
| **G5** | **Redundant by construction.** Removing the status check alone changes no outcome, because `createResolution` drops the symbol on any non-resolved status *and* `node-type-is-builtin` is only ever returned with `resolved` — so neither the interface path nor the schema path is reachable from an unproven type. | Kept as the single explicit, readable gate. Not mutated; instead test 36b **pins both invariants** across all four non-resolved P2A shapes, so G5 becomes the live guard the moment either changes. |

**Mutation result: G1–G4 mutated, all four observable and caught; G5 covered by
a pinned-invariant test instead.** Reporting five mutation kills would have been
the easy answer and a false one.

---

## 14. Internal result vocabulary

Reuse `STATUS` unchanged — all six values already exist and `unsupported` finally
gets its intended first use (§9). Result shape is `symbols.js`'s existing
`createResolution` (`status`, `reason`, `reference`, `symbol` only when
`resolved`, `candidateCount`, `detail`, `evidence`), unchanged.

### New `REASON` values (the whole proposed set — 14)

Naming follows P1/P2A conventions: lowercase, hyphenated, namespace-prefixed
where it disambiguates.

**Interface-member namespace**

| reason | with status | meaning |
|---|---|---|
| `interface-member-not-declared` | `unresolved` | no member of that effective name in the innermost interface |
| `duplicate-interface-member` | `ambiguous` | two+ members share that effective name in one interface |
| `is-outside-proto-body` | `invalid` | no enclosing PROTO interface (§7.4) |
| `is-target-name-missing` | `invalid` | the parse recovered no RHS name |

**Compatibility**

| reason | with status | meaning |
|---|---|---|
| `is-access-incompatible` | `invalid` | a `no` cell of Table 4.4 |
| `is-type-mismatch` | `invalid` | type tokens are not equal (S4) |
| `is-type-unknown` | `unresolved` | a type token neither side can identify |
| `duplicate-is-for-endpoint` | `invalid` | S7 — one endpoint bound twice in one node |
| `field-valued-and-is` | `invalid` | S8 — valued and `IS`-bound in one node |

**Endpoint availability**

| reason | with status | meaning |
|---|---|---|
| `is-endpoint-node-type-unresolved` | `unresolved` | P2A did not resolve the containing node's type (§8) |
| `is-endpoint-unknown-field` | `unresolved` | resolved built-in **or PROTO/Script interface**, but no such field/event even after alias expansion. **Never used for an EXTERNPROTO** — see the next row |
| `externproto-interface-not-locally-verifiable` | `unsupported` | §9 — the effective member is **absent** from the local EXTERNPROTO declaration, and absence is not authoritative under the subset rule. A member the EXTERNPROTO **does** declare resolves positively and never reaches this reason |

**Recovery**

| reason | with status | meaning |
|---|---|---|
| `interface-scope-not-provable` | `recovered` | G3/G4 — the interface's extent is unprovable |
| `interface-not-provable-for-reference` | `recovered` | G2 — the enclosing body is unprovable, so the owning interface is in doubt |

Existing reasons are reused where they already fit: `ok`,
`document-parse-incomplete` (G1), `scope-recovered`, `missing-name`.

**Non-binding `detail`** (never changes status, reason or the bound symbol —
exactly P2A's `proto-shadows-builtin` precedent):

- `member-found-in-outer-interface-only` — §6 Q5's explanatory hint;
- `member-via-implicit-alias` — the binding came from §7.2 expansion;
- `exposed-field-in-script-interface` — S13 compatibility observation;
- `is-in-interface-declaration-list` — S15 compatibility observation.

Compatibility observations are **`detail`, not status**, per WD.md §9: classified
and preserved, never promoted into the language rules and never silently
normalized away.

---

## 15. Internal API

> **As built.** Every accessor below shipped with the proposed name and meaning.
> Additions the plan did not list:
>
> - `isReferencesTo(graph, memberOrNode)` — the `IS` counterpart of P1's
>   `referencesTo`, indexing **`resolved` bindings only** (P1's rule, unchanged).
>   The plan described the index (`isReferencesByMember`) but gave it no accessor.
> - `sym.ACCESS`, `sym.ENDPOINT_ORIGIN`, `sym.IS_FORM` — published constant
>   tables, re-exported from `scope-graph`, so a consumer branches on a committed
>   string rather than a literal.
> - `createEndpoint` / `createIsVerdict` / `createNodeIsIssues` projection
>   factories in `symbols.js`.
>
> One semantic clarification, forced by an inconsistency the tests caught:
> **`endpoint.effectiveName` is the name of the DECLARATION the written name
> denotes**, not the written name itself — `set_flag` reports `flag`. The
> built-in path already behaved that way (the schema record found is the base
> field); the interface path initially returned the written alias, so the two
> disagreed. `endpoint.name` carries the written spelling, so echoing it in
> `effectiveName` would have said nothing.
>
> `nodeIsBindingIssues` returns a frozen `{status, reason, issues[]}` record —
> the plan specified the query but not its shape. It carries a status because it
> must be able to withhold under damage like everything else.

Additive only. Existing P1/P2A exports keep their exact current meaning —
`symbols`, `references` and `resolutions` stay DEF/USE; `typeDeclarations`,
`typeReferences`, `typeResolutions` stay node-type. The interface-member namespace
gets its **own** accessors, exactly as P2A did rather than folding lists together.

```js
// --- listing -------------------------------------------------------------
interfaceScopes(graph)                  // frozen, source-ordered
interfaceMembers(graph)                 // every member symbol, source-ordered
isReferences(graph)                     // every IS reference, source-ordered
isResolutions(graph)                    // RHS answers, in isReferences order

// --- lookup (never a resolution) -----------------------------------------
interfaceScopeFor(graph, astNode)       // Proto | ExternProto | Script -> scope | null
interfaceMemberFor(graph, astNode)      // InterfaceDecl -> member symbol | null
isReferenceFor(graph, astNode)          // Field(isBinding) | InterfaceDecl -> reference | null
membersOf(graph, interfaceScope)        // frozen, source-ordered

// --- questions -----------------------------------------------------------
resolveIs(graph, referenceOrNode)       // RHS binding: the §7.3 gated answer
interfaceMemberIsUniqueInScope(graph, memberOrNode)   // {unique, reason}
isConnectionVerdict(graph, referenceOrNode)           // §7.1's second half
nodeIsBindingIssues(graph, nodeAstNode)               // S7/S8, per node
```

`isConnectionVerdict` returns a frozen record, deliberately **not** a
`createResolution` (it answers a compatibility question, not a lookup):

```js
{
  status,            // resolved | invalid | unresolved | unsupported | recovered
  reason,            // a §14 reason
  member,            // the bound interface member, or null
  endpoint: {        // the definition side, or null when unavailable
    origin,          // 'builtin-schema' | 'proto-interface'
                     //   | 'externproto-interface' | 'script-interface'
    name,            // the written endpoint name
    effectiveName,   // after §7.2 expansion
    access,          // effective VRML97 access kind
    type,            // field type token
    range,
  },
  declaredAccess,    // effective access of the interface member
  declaredType,
  detail,            // non-binding observation, or null
  evidence,          // frozen, source-ordered spans
}
```

`origin` distinguishes the four endpoint namespaces of §8. `externproto-interface`
is a **fully populated positive endpoint** like the other three — `name`,
`effectiveName`, `access`, `type` and `range` all come from the local
declaration, and downstream code must not special-case it into a weaker answer.
The EXTERNPROTO difference lives entirely in the *miss* branch, where `endpoint`
is `null` and the status is `unsupported` rather than `unresolved`. A consumer
that wants to know whether an endpoint was locally declared reads `origin`; it
must not infer it from the status.

Every returned object is frozen and **branded with the graph's owner token**, and
every accepted argument is checked with `assertMember` — a projection from another
graph, even from a second parse of byte-identical text, must be rejected, not
resolved.

### Data structures (all private, in `INTERNALS`)

```
interfaceScopes            : []                                   // frozen projections
membersByInterfaceScope    : Map<scope, Map<effectiveName, member[]>>
memberByAstNode            : WeakMap<InterfaceDecl, member>
interfaceScopeByAstNode    : WeakMap<Proto|ExternProto|Script, scope>
isReferenceByAstNode       : WeakMap<Field|InterfaceDecl, reference>
isResolutionByReference    : Map<reference, resolution>
isReferencesByMember       : Map<member, reference[]>   // resolved bindings only
```

`isReferencesByMember` indexes **only** `resolved` bindings — an ambiguous,
invalid, unresolved or recovered reference is not "probably this member", and
including it is how a future rename corrupts a document (P1's rule, unchanged).

Ordering is `byPosition` (source offset, then codepoint tiebreak) as in P1/P2A;
no `localeCompare`, no clock, no PRNG.

---

## 16. Test matrix

New file `test/vrml/interface-is.test.js`, following
`type-resolution.test.js`'s shape, plus updates to `test/vrml/symbols.test.js`
(§17). Every case authored independently of the implementation.

**Declarations and ownership**

1. PROTO interface members: all four access kinds, name/type/access/ranges.
2. EXTERNPROTO interface members; no defaults; `interfaceIsSubset` honoured in
   the §9 sense — it governs **absence** only, and does not weaken what the
   declaration positively states (proven by 28a).
3. Script interface members, all three legal forms.
4. Same member name in two **distinct** PROTO interfaces → not a duplicate.
5. Duplicate member name in **one** interface → ambiguous, no pick.
6. `DEF X` + `PROTO X` + `field SFBool X` coexist with **no** collision across
   the three namespaces.
7. Nested PROTO interface ownership: inner and outer members stay separate.
8. Empty interface list; interface list with a single member.
9. Member uniqueness query, clean and damaged.

**`IS` binding**

10. `IS` in a nested PROTO body binds the **innermost** interface.
11. `IS` naming a member that exists **only in the outer** interface →
    `unresolved`, with `member-found-in-outer-interface-only` as non-binding
    `detail`.
12. `IS` naming a member of no interface → `unresolved`.
13. `IS` with no enclosing PROTO → `invalid / is-outside-proto-body`.
14. `IS` inside a Script inside a PROTO binds the PROTO's interface.
15. Implicit alias on the RHS: `set_zzz` / `zzz_changed` against
    `exposedField zzz`, with effective access asserted.
16. `exposedField zzz` **and** an explicit `eventIn set_zzz` in one interface →
    `ambiguous / duplicate-interface-member` on `set_zzz`, **no symbol chosen**
    (**S20**, a stated prohibition). Assert explicitly that neither the explicit
    declaration nor the alias is returned — there is no winner, no precedence and
    no first-match (§7.2). Repeat for `zzz_changed` / `eventOut`.
17. Malformed member name / malformed type token → no lexical claim.
17b. S19 directly: one name duplicated within a PROTO is a violation; the same
    name across two PROTOs is not.

**Endpoints and compatibility**

18. Built-in node field endpoint, direct schema hit.
19. Built-in endpoint via implicit alias (`Transform.set_translation`).
20. Built-in node, unknown field → `is-endpoint-unknown-field`.
21. An **X3D-only** field name must **not** be accepted as a VRML97 endpoint.
22. All 16 Table 4.4 cells — 7 legal, 9 illegal — asserted individually.
23. Valid field↔field connection; valid eventIn↔eventIn; valid eventOut↔eventOut.
24. Wrong access kind → `is-access-incompatible`.
25. Wrong field type, including `SFColor`↔`SFVec3f` and `SFColor`↔`MFColor`.
26. `SFNode`/`MFNode` bind on type token alone; inner node type is **not** checked.
27. P2A-recovered node type feeding endpoint lookup →
    `is-endpoint-node-type-unresolved`, **while the RHS binding still resolves**.
28a. EXTERNPROTO-typed node, endpoint **explicitly declared** in the local
    EXTERNPROTO interface → endpoint **acquired** from that declaration, with
    `origin === 'externproto-interface'`; access and type compatibility proceed
    from the local declaration exactly as for a PROTO. Assert both a legal and an
    illegal Table 4.4 pairing here, so the endpoint is proven usable rather than
    merely non-null.
28b. EXTERNPROTO-typed node, endpoint **absent** from the local declaration →
    `unsupported / externproto-interface-not-locally-verifiable`, `endpoint`
    `null`. Assert it is **not** `unresolved`, **not**
    `is-endpoint-unknown-field`, and that no confident absence claim is made.
28c. Implicit alias on a **locally declared EXTERNPROTO `exposedField zzz`**:
    `set_zzz` / `zzz_changed` acquire positively via §7.2 with effective access
    `eventIn` / `eventOut` — S23 carries the alias rule across with the rest of
    PROTO interface semantics — while an alias of a **non-declared** member still
    answers 28b's `unsupported`.
28d. Neither 28a nor 28b performs any URL access: assert with an injected loader
    that would throw if called, mirroring the no-networking guarantee.
29. S7 multiplicity: one endpoint bound twice → invalid; many endpoints → one
    member → **valid**.
30. S8: field valued **and** `IS`-bound → invalid.

**Recovery (each with a byte-identical clean control)**

31. Damaged interface list manufacturing a **fake duplicate** → withheld.
32. Truncated interface list manufacturing a **fake absence** → withheld.
33. Unclosed PROTO body moving which interface an `IS` belongs to → withheld.
34. Hard parse cap (`truncated` / `depthCapped`) → `document-parse-incomplete`.
35. Damage in an **unrelated** scope must **not** suppress a clean answer.
36. **Gate-condition tests**: every one of G1–G5 must be shown load-bearing, as
    P2A's 15/15 mutant suite did. As built, G1–G4 are mutated in test 36 and each
    mutation changes at least one outcome; G5 is redundant by construction (§13)
    and so cannot yield an independent mutation kill — test 36b pins its two
    enabling invariants instead, making G5 the live guard the moment either
    changes.

**Structural safety**

37. Cross-graph handles: a member/reference from graph A rejected by graph B,
    including for byte-identical text.
38. Frozen/opaque projections: no reachable Map, Set or internal array.
39. Source scan asserting the **absence** of the WD.md §7 rejected strategies —
    no `closest`, no fuzzy/score/rank, no structural path, no fingerprint, no
    sibling index, no hidden id, no nearest-range matching.
40. Determinism: two builds over one text produce identical ordering.

**Compatibility profile (classified, never normalized)**

41. `exposedField` in a Script body → members still declared, `detail` records it.
42. `IS` inside a PROTO interface list → `detail` records it.

---

## 17. P1/P2A integration points

- `src/vrml/symbols.js` — add 3 `SCOPE_KIND`s, 2 `SYMBOL_KIND`s, 1
  `REFERENCE_KIND` (`is`), 14 `REASON`s, 4 `detail` values, and the new projection
  factories and shape predicates. `NAMESPACE.INTERFACE_MEMBER` already exists.
- `test/vrml/symbols.test.js` **lines 91–101** currently assert that
  `proto-interface`, `externproto-interface`, `script-interface`,
  `proto-interface-member`, `script-interface-member` and `is` are **absent**.
  P2B constructs all six, so those assertions move from *absent* to *present* and
  the absent-list narrows to P2C's `route-node` / `route-event`. The invariant —
  *publish no kind you cannot construct* — is unchanged; only the boundary moves.
  This is the same transition P2A made.
- `src/vrml/scope-graph.js` — interface scope creation, member collection, the
  carried `isOwner`, `resolveIs`, the compatibility verdict, and the new
  accessors. `visitNode` must dispatch `node.interfaces` on node type; `visitProto`
  and `visitExternProto` gain interface scopes.
- `src/vrml/node-schema.js` — **read-only consumer**. Not regenerated, not edited.
- `scripts/run-tests.js` / the `check` script — one new test file and one
  `node --check` entry, matching P2A.
- **Unchanged**: `analyze.js`, `parser.js`, `tokenizer.js`, `ast.js`,
  `node-identity.js`, `edit.js`, the diagnostics table, the validator, the World
  scanner, the editor, the renderer. No production consumer is wired.

---

## 18. Implementation slicing

**Recommendation: one coherent P2B implementation lane, one branch, one commit** —
the same shape P2A shipped in. The four slices below are *internal ordering*, not
separate PRs. Splitting them would publish `SYMBOL_KIND`s with no resolver, or a
resolver with no gate, and either state violates the standing *publish no kind you
cannot construct* invariant. There is no reviewable intermediate.

| slice | content | done when |
|---|---|---|
| **P2B-1** | interface scopes, member symbols, ownership, listing/lookup/uniqueness queries | tests 1–9, 37–40 pass |
| **P2B-2** | `IS` references, carried `isOwner`, RHS binding, **the §13 gate built first** | tests 10–17, 31–36 pass |
| **P2B-3** | endpoint acquisition (schema + interfaces + alias expansion), Table 4.4, type equality, S7/S8 | tests 18–30 pass |
| **P2B-4** | corpus sweep, compatibility-profile classification, adversarial + mutation hardening, this doc rewritten "as built" | full suite + corpus sweep clean |

**Build the gate in P2B-2, not P2B-4.** P2A's defect was a gate added after the
branches existed; adding it late is what let three unprovable answers through.

Expected test-count growth is comparable to P2A's (+~90 on 997), and no existing
test's meaning changes except the two boundary assertions in §17.

---

## 19. P2B / P2C boundary

| P2B owns | P2C owns |
|---|---|
| interface member declarations (PROTO, EXTERNPROTO, Script) | ROUTE endpoints — `nodeNameId . eventId` |
| the `interface-member` namespace | `route-node` / `route-event` reference kinds |
| `IS` binding, access and type compatibility | ROUTE event direction (eventOut → eventIn) |
| implicit alias expansion (§7.2) — **built here, reused there** | ROUTE type compatibility |
| the endpoint-acquisition helper (§8), including the EXTERNPROTO positive/absence split (§9) — **built here, reused there** | resolving ROUTE node names via P1's DEF scope |

The two overlaps are deliberate and one-directional: alias expansion and endpoint
acquisition are P2B deliverables that P2C **consumes unchanged**. P2C must not
fork either, and P2B must not implement any part of ROUTE. The corpus holds
**266,936** ROUTEs — 9.6× the `IS` count — so P2C is the larger lane and benefits
most from these two being right first.

**The EXTERNPROTO split is written for P2C's benefit, not just P2B's.** A ROUTE
endpoint on an EXTERNPROTO-typed node is the same question in a different
syntax, so P2C inherits both halves unchanged and must not re-derive either:

- a ROUTE naming an `eventIn`/`eventOut` **explicitly declared** by the
  EXTERNPROTO gets a real endpoint — access kind and type from the local
  declaration — and can be direction- and type-checked **without loading the
  external implementation**;
- a ROUTE naming an endpoint **absent** from the declaration answers
  `unsupported / externproto-interface-not-locally-verifiable`. P2C must not
  report a dangling or invalid ROUTE there, because the implementation may well
  declare it.

Had P2B kept the blanket-unsupported rule, P2C would have been unable to check
any ROUTE touching an EXTERNPROTO instance — and the corpus has 1,279 EXTERNPROTO
declarations against 266,936 ROUTEs, so that would have been a large, permanent
and unnecessary blind spot.

---

## 20. Risks and hard-stop conditions

| # | risk | mitigation |
|---|---|---|
| R1 | Alias expansion applied without adjusting **effective access**, silently accepting a `field` where an `eventIn` was required. | §7.2 states it; test 15 asserts effective access explicitly. |
| R2 | Table 4.4 transposed. It is asymmetric — 7 legal cells of 16 — so a transposition still "works" on the diagonal and fails only on the `exposedField` row/column. | All 16 cells tested individually (test 22); the row/column prose in §11 is the independent check. |
| R3 | An outward interface walk creeping in "because the member is obviously there". | Structurally impossible: interface scopes carry no parent link (§4.2). Test 11 pins the refusal. |
| R4 | A per-branch recovery guard instead of the upfront gate — P2A's exact defect. | Gate built first (§18); tests 36 and 36b prove each condition load-bearing. |
| R5 | EXTERNPROTO local **silence** mistaken for authoritative absence. | `unsupported`, never `unresolved` (§9); test 28b. |
| R5b | The opposite over-correction: refusing a member the EXTERNPROTO **does** declare, because "EXTERNPROTO means unverifiable". S23 makes the local declaration authoritative for what it states; blanket refusal discards real information and would blind P2C's ROUTE checking (§19). | The split is stated in §8's table and §9; test 28a proves positive acquisition and 28c proves alias acquisition. |
| R5c | Reaching for the URL to decide either branch. | No networking anywhere in P2B (§1); test 28d injects a loader that throws if called. |
| R6 | Regenerating `node-schema.js` to add `set_*`/`*_changed`. | Explicitly forbidden (§8) — they are a language rule, not an ISO declaration. Schema stays read-only. |
| R7 | A second field-type or access-kind table drifting from WD1.3. | One matrix, one place; use `vrml97Declaration`, not `accessType` (§11/§12). |
| R9 | An effective-name collision (`exposedField zzz` + explicit `set_zzz`) resolved by preferring one declaration — "the explicit one is obviously what the author meant". S20 prohibits the combination outright, so there is no author intent to recover; any preference is candidate ranking, the WD.md §7 failure mode. | No precedence rule exists anywhere in §7.2; test 16 asserts neither declaration is returned. |
| R8 | Compatibility shapes (Script `exposedField`, `IS`-in-interface-list) normalized into conforming behaviour. | `detail` only, never status (§14); WD.md §9. |

**Hard stops — stop and ask Ryan rather than improvise:**

- any production-code change outside `symbols.js` / `scope-graph.js` and the two
  test files;
- any parser or AST change;
- any need to regenerate `node-schema.js`;
- any case where the standard's silence would have to be resolved by ranking,
  scoring or "closest match" to produce an answer;
- discovering a corpus shape that cannot be classified as conforming, compatible,
  recoverable or unsupported.

---

## 21. Definition of done for the implementation session

1. `interface-is.test.js` covers every case in §16, including the 16 Table 4.4
   cells, the four-part EXTERNPROTO endpoint case (28a–28d) and the 5
   gate-condition tests (4 mutations in test 36, plus the G5 pinned-invariant
   test in 36b), and passes.
1b. Both EXTERNPROTO directions are proven: a locally declared member yields a
   usable positive endpoint, and a locally absent one yields `unsupported` —
   neither collapsed into the other, and neither reached by touching a URL.
2. `npm run check` passes with **zero** regressions against the 997 baseline.
3. A corpus sweep over the same fingerprinted file set reports **zero** wrong
   bindings and **zero** confident answers from damaged scopes, on the P1/P2A
   pattern.
4. Every §16 recovery case has a byte-identical clean control.
5. The source scan (test 39) confirms no rejected identity strategy is present.
6. `node-schema.js`, `parser.js`, `ast.js`, `analyze.js` are **unmodified**.
7. No production consumer is wired; `VRML040`–`VRML044` remain advisories.
8. This document is rewritten as **"(as built)"**, with measured counts replacing
   projected ones and any adjudication changes recorded, as P2A did.
9. `WD.md` §3's status table gains a WD1.5-P2B row.

---

## 22. Unresolved questions

None block implementation. Two are recorded as **decided-by-fail-closed**, each
with a corpus cost of zero — a later lane may revisit them with evidence, but the
implementation session should not reopen either:

1. **Q5 / S18 — may a nested `IS` reach an outer interface?** Decided: **no**.
   4.8.4 names only the innermost prototype and is silent on the outer case.
   Corpus cost of the strict reading: **0 of 27,756**.
2. **EXTERNPROTO access-kind matching in the subset rule (§9).** 4.9.2 states
   names and types explicitly and enumerates the four categories separately;
   access matching is normative-**derived**, not explicit. Still moot for P2B
   after the §9 correction: P2B *uses* an EXTERNPROTO's locally declared access
   kind for Table 4.4, but it never **matches** that declaration against an
   implementation's, which is the only place the question arises. It matters
   only to a future external-resolution lane.

The P2A note's forward citation (4.3.5, 4.8.2, 4.8.3, Table 4.4, 6.40) was
checked against the mirror and is **correct**: 4.3.5 is "PROTO statement syntax"
and carries S19/S20, two rules this plan initially derived rather than cited. The
full load-bearing set is **4.3.5, 4.3.6, 4.7, 4.8.2, 4.8.3 (Table 4.4), 4.8.4,
4.9.2, 6.40** and **Annex A.2/A.3**; the as-built note should list 4.3.6 and
Annex A alongside P2A's citation.

---

## 23. As-built deviations, adjudications and findings

Everything the implementation session changed relative to the plan, in one place.
Nothing here reopens a standards question; each is either a plan claim that was
not implementable as written, or a measurement the plan could not have made.

### The two adjudication corrections, confirmed in code

Both were adjudicated before implementation and are recorded here as *shipped*,
because they are the two decisions most likely to be re-litigated later:

1. **EXTERNPROTO — positive local declaration is usable; local absence is
   `unsupported`.** 4.9.2 makes an EXTERNPROTO interface declaration a PROTO
   interface declaration bar initial values, so what it declares locally is
   authoritative and compatibility proceeds from it **without loading anything**.
   Only the *miss* branch diverges: `unsupported /
   externproto-interface-not-locally-verifiable`, never `unresolved`, because the
   declaration may be a strict subset of the implementation's. One shared lookup
   path serves all three interface-backed origins; the EXTERNPROTO difference is
   confined to how absence is reported. Tests 28a–28d; 28b additionally proves
   the two answers are genuinely different by giving the *same spelling* on a
   PROTO and getting the confident negative.
2. **Alias collision — no candidate wins.** `exposedField zzz` plus an explicit
   `eventIn set_zzz` yields `ambiguous / duplicate-interface-member` and binds
   **nothing**. No explicit-beats-alias, no first-match, no source order. Test 16
   asserts *neither* declaration is returned, in both alias directions.

### Deviations from the plan

| # | plan said | as built | why |
|---|---|---|---|
| D1 | §12: "a type token **the schema** does not recognise is `is-type-unknown`" | Recognition comes from **Annex A.2's `fieldType` production** (20 tokens), not from the schema | Not implementable as written. A set derived from the committed schema is **19** tokens: `MFTime` is a legal VRML97 field type that no clause-6 built-in field uses, so a schema-derived check would report a perfectly legal `field MFTime` member as unknown. The schema stays authority for *what type a node's field has*; the grammar is authority for *which tokens are field types*. Test 25c pins schema ⊆ grammar so the two cannot drift. |
| D2 | §13: five mutation-observable gate conditions | **G1–G4 mutated and caught; G5 covered by a pinned-invariant test** | See §13's as-built table. Three conditions are not independently observable where the plan placed them; each was investigated and either relocated (G3), narrowed to its observable branch (G4), reclassified as diagnostic-quality (G1), or pinned by invariant (G5). |
| D3 | §17: "add … the new projection factories" | Also added `isReferencesTo`, `ACCESS`, `ENDPOINT_ORIGIN`, `IS_FORM` | §15. The plan named the private index but no accessor for it, and left the three constant tables as bare string literals. |
| D4 | §15: `endpoint.effectiveName` "after §7.2 expansion" | The **declaration's** name (`set_flag` → `flag`) | Ambiguous as written, and the two endpoint paths disagreed until it was settled. `endpoint.name` already carries the written spelling. |
| D5 | (unstated) | Interface scopes are held **out of** `scopes(graph)` and out of `markRecovery`'s innermost-scope competition, with their own additive attribution pass | Not a refinement — a correctness requirement the plan missed. An interface scope's range is a strict subset of its owning construct's, so letting it compete would displace the enclosing DEF scope as innermost and **un-mark** it, turning a `recovered` USE answer back into a confident one. That is a loosening of a P1 safety property. The separate pass can only turn `resolved` into `recovered`. |
| D6 | §5.3: a non-Script node's interface list is "recorded" | It mints **no** interface scope and no members; a `… IS …` written in one fails closed at G4 | The plan did not say what "recorded" meant for an `IS`. Corpus cost 0, and it is now G4's only independently observable branch. |
| D7 | §17: "`test/vrml/symbols.test.js` **lines 91–101**" move from absent to present | Also `type-resolution.test.js`'s two boundary tests | Expected boundary movement, but the plan named only one file. Five assertions moved; **no behavioural P1/P2A test changed**. |

### One test-quality defect found and fixed in a predecessor

`type-resolution.test.js`'s "no second built-in list" scan read **raw source**,
so it failed on P2B's comment explaining why
`getFieldSchema('Transform','set_translation')` is null by design — exactly the
naive-source-scan trap this lane was warned about. The fix strips **comments
only**, deliberately *not* reusing the neighbouring `codeOnly` helper: that one
also strips string literals, which would have made the check vacuous, since a
real hard-coded built-in table lives inside string literals. The invariant is
unchanged and the check is now stronger than before.

### Vacuity found and fixed

Two recovery assertions were written as `for (const ref of isReferences(graph))`
over a **capped** parse. The parser abandons the subtree it caps on, so the list
was empty and the loops passed without asserting anything. Fixtures now trip the
cap with a deep *sibling* so the construct under test survives, and both tests
assert the list is non-empty first.

### Definition of done — status

1. ✅ §16 matrix implemented, 51 tests, including all 16 Table 4.4 cells, 28a–28d
   and the mutation suite. 2. ✅ 1048/1048, zero regressions against the 997
   baseline. 3. ✅ Corpus sweep: **0 wrong bindings, 0 confident answers from an
   unprovable scope**, graded against an independently written oracle that walks
   the AST with its own PROTO stack and its own alias expansion — 19,631 sites,
   full agreement. 4. ✅ Every recovery case has a byte-identical clean control.
   5. ✅ Source scan clean. 6. ✅ `node-schema.js`, `parser.js`, `ast.js`,
   `analyze.js` unmodified. 7. ✅ No consumer wired; `VRML040`–`VRML044` remain
   advisories. 8. ✅ This document. 9. ✅ `WD.md` §3 status table.

### Open questions handed forward

- **The 1,481 access incompatibilities** (§10). Real, standards-correct findings
  on authored content. Whether they surface to a user as an error or as a WD.md
  §9 compatibility-profile warning is **P4's call**, not P2B's.
- The two `decided-by-fail-closed` questions in §22 stand, both still at corpus
  cost **0** on the implementation sweep.
