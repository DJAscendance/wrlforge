# WD1.5 — what WRL Forge does today

An audit of production behaviour as of `5328262`, read-only. **No production file
was changed in this lane.** Rule ids (`D…`, `P…`, `I…`, `R…`, `S…`) refer to
`standards-model.md`.

Everything semantic lives in one 89-line module, `src/vrml/analyze.js`, and its
own header already says what this audit confirms:

> Scope model (7A): a single flat document scope. PROTO bodies introduce their
> own scope in VRML97; treating them flatly can under-report a shadowed name […]
> Ordering (USE-before-DEF) is likewise not enforced yet.

The audit's job is to say exactly how far that goes, and what the AST can prove.

## Summary table

| # | area | production behaviour | classification |
|---|---|---|---|
| 1 | DEF collection | `ast.walk` over the whole tree; every `Node` with a `def` lands in one flat `defsByName` map | **flat-scope artifact** |
| 2 | Duplicate DEF | any repeat of a name **anywhere in the document** raises `VRML040` as an **error** | **false positive** (cross-scope) + **wrong severity** |
| 3 | USE resolution | `defsByName.has(name)` — existence anywhere, ignoring order and PROTO boundaries | **false negative** (D2, D5–D7) |
| 4 | USE ordering | not checked | **false negative** (D2) |
| 5 | PROTO declarations | parsed and kept on the AST; **never indexed, never resolved, never checked** | **analyzer limitation** |
| 6 | ProtoInstance recognition | none — a `PROTO`-declared type and an unknown vendor type are indistinguishable downstream | **analyzer limitation** |
| 7 | Nested PROTO traversal | structurally parsed; not treated as a scope by anything | **flat-scope artifact** |
| 8 | IS parsing | parsed on both shapes (node-body `Field.value` of type `Is`, and `InterfaceDecl.is`) with ranges | **correct but incomplete** (parse only) |
| 9 | IS analysis | **none** — no ownership, no type check, no access check, no placement check | **analyzer limitation** |
| 10 | ROUTE endpoints | resolved against the same flat `defsByName` | **false negative** (R2, R3) |
| 11 | ROUTE events | **not checked at all** — no existence, type or direction check | **analyzer limitation** |
| 12 | Duplicate ROUTE | detected, document-wide, keyed on the four name parts | **correct but incomplete** (not scope-aware) |
| 13 | Script interfaces | parsed into `node.interfaces`; **never indexed** | **analyzer limitation** |
| 14 | Recovered parses | `truncated` / `depthCapped` exposed on the result; semantics run regardless and say nothing about confidence | **parser + analyzer limitation** |
| 15 | Source ranges | present on **every** AST node, plus `defRange`, `nameRange`, `typeRange`, `isRange`, `fieldTypeRange` | **correct and authoritative** |
| 16 | Node/field schema | complete and separate (WD1.3), correctly *not* mixed into lexical scope | **correct and authoritative** |

## The four flat-scope artifacts, reproduced

Each was run against production `parse()` and the result recorded. These are
authored cases `D02`, `D03`/`D04`, `D05`/`D06`, `R36` in `cases.js`.

```
PROTO A [] { Group { children [ DEF X Shape {} ] } }
PROTO B [] { Group { children [ DEF X Shape {} ] } }
```
→ production: `VRML040 Duplicate DEF 'X'` (**error**).
→ standard (D5): two independent scopes. **False positive.**

```
Group { children [ USE Ball  DEF Ball Shape {} ] }
```
→ production: `uses[0].resolved === true`, no diagnostic.
→ standard (D2): nothing precedes the `USE`. **False negative.**

```
PROTO Widget [] { Group { children [ DEF Inner Shape {} ] } }
Group { children [ USE Inner ] }
```
→ production: `resolved === true`.
→ standard (D6): a PROTO-scoped name is invisible outside. **False negative.**

```
DEF Clock TimeSensor {}
PROTO Anim [] { … ROUTE Clock.fraction_changed TO Path.set_fraction }
```
→ production: `resolvedFrom === true`.
→ standard (R3 + D7): the ROUTE cannot see `Clock`. **False negative.**

## What the current AST *can* prove

This is the decisive part of the audit, because it decides Outcome A vs B vs C.
Every item below was verified against the real parser, not assumed.

| evidence needed | available today? | how |
|---|---|---|
| Which construct owns an interface declaration | **yes** | `Proto.interfaces` / `ExternProto.interfaces` vs `Node.interfaces` are separate arrays on separate node types |
| Whether a node is a `Script` | **yes** | `node.nodeType === 'Script'` |
| PROTO body containment | **yes** | `Proto.body` is its own array; nesting is structural |
| Which PROTO encloses an `IS` | **yes** | by traversal position; no AST change needed |
| Both sides of an `IS`, with ranges | **yes** | `Field.value` (`type: 'Is'`, `name`, `nameRange`) and `InterfaceDecl.is`/`isRange` |
| Declaration order / textual precedence | **yes** | every range carries `start.offset` |
| Where a PROTO declaration *ends* (for P3) | **yes** | `Proto.range.end.offset` |
| ROUTE endpoint node and event names + ranges | **yes** | `Route.from/to.{node,nodeRange,event,eventRange}` |
| Node-body ROUTE / PROTO statements | **yes, but** | they are appended to `node.fields`, so a consumer must dispatch on `type` rather than assume "field". Easy to get wrong — this lane did, and lost 5,444 ROUTEs until it was fixed. |
| An unnamed PROTO | **yes** | `Proto.name === null` |
| A PROTO whose body failed to open | **yes, indirectly** | `body.length === 0`, which Annex A `protoBody` already makes non-conforming (P7) — so the structural signal and the error signal coincide |
| A node body that never closed | **yes, indirectly** | `VRML023 UNCLOSED_BRACE` is reported at the node's **own** `typeRange`, so range containment attributes it correctly |
| A PROTO body that never closed | **yes, indirectly** | `VRML023` is reported at the `PROTO` **keyword** range, inside `Proto.range` |
| A missing interface `[` | **yes, indirectly** | `VRML020 EXPECTED_TOKEN` with `expected: '['`, inside `Proto.range` |
| Hard parse caps | **yes** | `result.truncated` / `result.depthCapped` |

### The one place the indirect signals are weak

`PROTO P [ ]` followed by no `{` reports `VRML020` at the **next** token, which
lies *outside* `Proto.range` — so range containment does not attribute it to the
PROTO. That single case is nonetheless caught structurally: the resulting
`body.length === 0` is already non-conforming under P7, so the prototype marks
the body scope `proto-body-not-provable` without needing the diagnostic at all.

**Conclusion: no `Node`, `Proto`, `Field` or `Route` AST shape had to change to
build a complete, fail-closed scope graph.** The recovery signals are indirect
rather than explicit, which is a real ergonomic cost and is the basis of the
optional metadata proposal in `REPORT.md` §12 — but it is a cost, not a blocker.

## What production gets right and must be preserved

- **Ranges everywhere.** Nothing in this lane needed a range that did not exist.
- **Separation of parse from analysis.** `analyze.js` is a pass over a finished
  tree, which is exactly the shape a scope pass wants.
- **Recovery-oriented parsing.** A partial tree with one diagnostic per problem
  is what makes fail-closed scope resolution possible at all.
- **Schema kept out of lexical scope.** WD1.3 answers "does this node have this
  field"; `analyze.js` never confuses that with "is this name declared". The
  scope model preserves the split.
- **The lenient MFNode acceptance** (ROUTE/PROTO inside `[ … ]`). 56,449 real
  ROUTEs in the corpus depend on it. It is non-conforming, and this lane
  classifies it as compatibility — it does not propose removing it.

## Advisory posture, unchanged by this lane

`CLAUDE.md` and `AGENTS.md` record that `VRML040`–`VRML044` are **advisories
only** in the native editor and never block a save. Everything this audit calls a
false positive or false negative is inside that advisory set, so **no shipped
behaviour is currently wrong in a way that blocks a user**. That is why this lane
is a design gate and not a hotfix.
