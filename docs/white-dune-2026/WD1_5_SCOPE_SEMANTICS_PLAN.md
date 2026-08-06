# WD1.5 — scope semantics: production plan

**Status:** design gate deliverable. **Nothing here is implemented.**
**Gate outcome: A — the current AST is sufficient.**

Evidence: `spikes/wd1-scope-semantics/` (`REPORT.md` for findings,
`standards-model.md` for the rules and their ISO clause citations,
`current-behavior.md` for the audit of production as of `5328262`). This file
records only what a future production lane should build.

The exact source-text buffer remains the canonical document. A scope graph is a
**derived, disposable projection** — like tokens, the AST, the source map and the
semantic index. Nothing about it is written into a document, persisted, or given
an identity that survives a reparse. Semantic operations continue to produce
source-text patches through the accepted WD1.2 algebra.

---

## 1. Why this lane exists

`src/vrml/analyze.js` uses a single flat document scope, by design and with the
limitation documented in its own header. Against 59 independently authored
expected-truth cases it is wrong in **15** — every one a false positive or false
negative that a scene tree, a rename, a DEF/USE navigator or a ROUTE graph would
inherit.

The four flat-scope artifacts, all reproduced against the real parser:

1. **Cross-PROTO duplicate DEF** reported as an error (`VRML040`) when 4.8.4 makes
   the two scopes independent — 505 names in the corpus.
2. **USE-before-DEF** reported as resolved; 4.6.2 requires a *preceding*
   declaration.
3. **PROTO DEF leakage** in both directions; 4.8.4 forbids both.
4. **ROUTE endpoints treated as global**, ignoring both ordering (4.10.2) and the
   PROTO boundary.

All four are inside the `VRML040`–`VRML044` advisory set, which never blocks a
save — so **nothing shipped is broken today**. This is a gate before scene-tree
work, not a hotfix.

## 2. What the gate established

| question | answer |
|---|---|
| Can the current AST prove VRML97 scope? | **Yes.** Every normative-explicit and normative-derived rule is implemented and passing with no parser or AST change. |
| Do source ranges suffice? | Yes — every AST node carries one, plus `defRange`/`nameRange`/`typeRange`/`isRange`. |
| Can PROTO/interface ownership be reconstructed? | Yes — `Proto.interfaces` and `Node.interfaces` are separate arrays on separate node types; enclosure is structural. |
| Can recovery fail closed safely? | Yes — via diagnostic range containment plus structural invariants, **provided positive lexical results are withheld too** (§7). |
| Is an identity redesign needed? | **No.** WD1.4's contract is untouched. |
| Would adopting it newly resolve anything? | **No** — 0 cases in 707 MB. The model is strictly more conservative. |

## 3. Taxonomy to implement

Three namespaces, not one — node names, node types, interface members. Built-in
node and field names are **schema lookups, not lexical symbols**; do not merge
the two.

**Scopes:** `document`, `proto-body`, `proto-interface`, `externproto-interface`,
`script-interface`.
**Symbols:** `node-def`, `proto-decl`, `externproto-decl`,
`proto-interface-member`, `script-interface-member`.
**References:** `use`, `node-type`, `is`, `route-node`, `route-event`.
**Statuses:** `resolved`, `unresolved`, `ambiguous`, `invalid`, `unsupported`,
`recovered` — each with a stable kebab-case reason id and source-range evidence.

### The one structural rule to get right

A scope has **two independent parent links**:

- `defParent` — node names. **`null` on a PROTO body.** ISO/IEC 14772-1 4.8.4
  makes a PROTO's DEF/USE scope separate from the rest of the scene *and* from
  nested PROTOs, in **both** directions. This is disjointness, not shadowing:
  lookup stops there.
- `typeParent` — node types. Points outward, because a nested body may still
  instantiate a type declared in an enclosing scope.

**Scopes must be identities, never strings.** WD1.4 found a real wrong anchor
from a `/`-joined scope key: the tokenizer classifies identifiers by exclusion,
so `PROTO A/B` and `PROTO A { PROTO B }` spell the same joined key. The corpus
contains **zero** such names, so this is a structural hazard rather than an
observed one — but the cost of using identities is nil, so there is no reason to
take the risk.

## 4. Module design

Two new pure modules under `src/vrml/`, matching WD1.3/WD1.4 convention:

| module | contents |
|---|---|
| `src/vrml/symbols.js` | taxonomy constants; `Scope`/`Symbol`/`Reference`/`Resolution` shapes; predicates |
| `src/vrml/scope-graph.js` | construction and resolution |

Both **pure and browser-safe**: no `fs`, no Electron, no crypto, no CodeMirror,
no editor import.

**Inputs:** a parse result (`tree`, `syntaxDiagnostics`, `truncated`,
`depthCapped`) and `node-schema.js`. **Not** the source text, **not** the source
map, and **not** a compatibility profile — the profile is a rendering choice
applied to already-tagged resolutions, so one graph serves every profile.

**Minimal public surface** (via the `src/vrml` facade, narrowed as WD1.4's was):

| call | returns |
|---|---|
| `buildScopeGraph(parseResult)` | the graph |
| `resolve(graph, referenceId)` | a frozen `Resolution` |
| `referencesTo(graph, symbolId)` | every reference bound to one declaration |
| `defIsUniqueInScope(graph, symbolId)` | `{unique, reason}` |
| constant tables | `SCOPE_KIND`, `SYMBOL_KIND`, `REFERENCE_KIND`, `STATUS`, `REASON`, `COMPAT` |

Rename planning, ROUTE validation and IS validation are **consumers** of
`referencesTo` and the resolution list — not extra entry points.

## 5. Non-negotiables carried from WD1.4

- A tool may lose a target. It may say it cannot prove one. It may **never**
  confidently act on the wrong one.
- No first-match, no closest-match, no nearest-range, no structural path, no
  fuzzy matching, no scoring, no ranking.
- Ambiguity is decided on the **name alone**, before any type filtering.
- No resolution carries a symbol unless its status is `resolved`.
- Fail closed wherever scope cannot be proven.

### Including one rule the standard states and this design refuses

4.6.2 defines duplicate-name resolution exactly: a `USE` binds *the closest
preceding* declaration. The resolver must still return **`ambiguous`** and must
**not** implement that rule, because its consumers are identity, rename and
refactoring, where silently rebinding the other `DEF` is the precise failure the
hard gate exists to prevent.

If viewer fidelity ever needs the browser's answer, it belongs in a separately
named `languageSemantics` query with its own documentation. **It must never feed
identity, rename or navigation.**

## 6. Implementation warnings

These cost real time in the spike. All three have regression cases and tests
there.

1. **A node body's `ROUTE` / `PROTO` / `EXTERNPROTO` statements land in
   `node.fields`.** Only interface declarations get their own array. Iterating
   `node.fields` as if every entry were a field silently drops them — it cost
   **5,444 real ROUTEs** in the spike before it was caught. Dispatch on `type`.
2. **The acyclicity rule binds the transformation hierarchy, not the scene
   graph.** 4.4.4 is the operative clause and it excludes `Script` descendants,
   so `DEF S Script { field SFNode myself USE S }` is a standard idiom, not a
   cycle. Getting this wrong produced **489** false positives on real content.
3. **Never trust a positive lexical result from a damaged scope** — see §7. This
   one was caught by adversarial review rather than by the corpus, and it is the
   only defect found in this lane that could produce a confidently wrong binding.

## 7. Recovery

**A damaged scope refuses every lexical answer.** Not "negatives only" — an
earlier draft of this plan said that, and an external adversarial review
disproved it.

- A partial tree can prove a declaration **exists**.
- It **cannot** prove **which scope owns it**, and scope membership is the whole
  question a `USE` asks.
- Parser recovery *moves scope boundaries*: an unclosed PROTO swallows the
  following top-level statements into its body, so the absorbed scope sees a
  declaration set that never existed and — because a PROTO body has no
  `defParent` — is blind to the real outer declarations.

The concrete failure, which the production implementation must not reproduce:

```
DEF Foo Group { }              <- stays in document scope
PROTO P [ ] { Shape { }        <- brace never closed
DEF Foo Transform { }          <- absorbed into P's body
Group { children [ USE Foo ] } <- absorbed into P's body
```

With the brace present this is **ambiguous** (two `DEF Foo` in document scope).
With it missing, the absorbed body holds exactly one `Foo`, and a resolver that
trusts positive results returns a single confident binding — a **confidently
wrong** answer, the one outcome the hard gate forbids.

So: downgrade a lexical resolution to `recovered` whenever the scope it was
decided in, **or** the scope holding the declaration it found, could not be
proven. **Schema resolutions are exempt** — a built-in node type or a built-in
event is a clause-6 fact with no scope dependency, and suppressing those would be
pointless conservatism. Ambiguity stands, since it binds nothing.

Measured cost on the corpus: ~5,450 USE and ~4,145 ROUTE bindings move from
asserted to withheld, entirely inside the 251 files carrying a syntax
diagnostic — 1.6% of USE references. That is the correct trade against a silently
wrong binding.

Attribute a syntax error to the **innermost** containing scope, never to every
enclosing one, or a single stray error will suppress every honest "not declared"
answer in the file. A hard parse cap (`truncated`/`depthCapped`) is different in
kind and marks the **whole** graph unprovable, matching Tier 2's
`document-parse-incomplete`.

Three constructs fail closed structurally with no diagnostic needed:
`proto-scope-not-provable` (unnamed PROTO), `proto-body-not-provable` (Annex A
`protoBody` requires ≥1 node statement), and `document-parse-incomplete`.

## 8. Strict vs compatibility

Cybertown/Blaxxun behaviour is an **optional profile layer**, never the core rule.
Tag the resolution; let the profile decide how to render it.

| construct | corpus | strict | disposition |
|---|---:|---|---|
| ROUTE inside an MFNode array | 56,449 | non-conforming | parser recovery, already shipped — keep, never error |
| PROTO inside an MFNode array | 36 | non-conforming | same |
| event bound to an `exposedField` declaration | 1,940 | violates Table 4.4 | **compatibility profile** — tag `compat/*`, downgrade to warning |
| `exposedField` in a `Script` node | 1,577 | forbidden by 6.40 | compatibility warning |
| hyphen/plus identifiers | 61,500 | **conforming** | not a compatibility item at all |

The 1,940 are one idiom, not 1,940 mistakes: the Cybertown `Avatar` PROTO
declares its whole interface as `exposedField` and binds events to it. Harmless
in practice, non-conforming on paper. Keep the strict status; let the profile
downgrade it.

## 9. Diagnostics

Reuse the existing `Diagnostic` shape and `CODE` table. **Do not rewrite the
diagnostics system in this lane.** New codes slot in after `VRML044`.

| condition | severity |
|---|---|
| duplicate DEF **in one scope** | **warning** — legal per 4.6.2; today's `VRML040` error is the wrong severity *and* the wrong scope |
| USE before DEF | error |
| USE/ROUTE across a PROTO boundary | error |
| ROUTE forward reference | error |
| IS type/access mismatch | error, downgraded to warning when tagged `compat/*` |
| anything `recovered` | **not reported** |

`VRML040`–`VRML044` remain **advisories that never block a save**. This plan
proposes no change to that posture.

## 10. Identity integration

WD1.4's contract is **accepted and unchanged**. A scope graph would eventually let
Tier 2 ask `defIsUniqueInScope` instead of computing an opaque `scopeKey`, under
four hard constraints:

1. Tiers, statuses, reasons and the hard gate stay exactly as accepted.
2. Production identity **must not depend** on the scope graph — it stays usable
   with none present. Injected, optional, never required.
3. It may only make Tier 2 **more** conservative or equally so. The corpus shows
   zero cases where scope-awareness newly resolves something, so this is safe by
   construction.
4. The 13,181-application conformance sweep must be re-run and must still show
   **zero wrong anchors** before acceptance.

## 11. Incremental behaviour

**Rebuild the whole graph after each parse.** Measured cost is ~0.6× a parse on a
deliberately scope-heavy document (200 PROTO, 4,000 DEF/USE, 2,000 ROUTE: 33.5 ms
scope vs 57.1 ms parse) and far less on ordinary ones. **Do not build incremental
scope analysis.**

## 12. Suggested staging

One lane at a time, with a stop-and-report gate between each.

| stage | scope |
|---|---|
| **WD1.5-P1** | `symbols.js` + `scope-graph.js` construction and DEF/USE resolution; no diagnostics wired anywhere; unit tests. |
| **WD1.5-P2** | PROTO/EXTERNPROTO type resolution, IS validation, ROUTE validation; still no consumer. |
| **WD1.5-P3** | Corpus conformance sweep re-using the spike harness; require agreement with the spike and zero new resolutions vs the current analyzer. |
| **WD1.5-P4** | Facade exposure + diagnostics wiring behind the existing advisory posture; `analyze.js` reasons re-pointed at the scope graph. |
| **WD1.5-P5** *(optional, separate approval)* | Tier 2 identity integration, gated on re-running the WD1.4 conformance sweep to zero wrong anchors. |

## 13. Explicitly not in this plan

- Any change to the parser, tokenizer, AST, source map, WD1.2 edit algebra, or
  WD1.4 identity.
- Run-time name scope (4.4.6), cross-file resolution, `Inline` traversal.
- The closest-preceding duplicate rule (§5).
- Incremental scope analysis (§11).
- A canonical scene graph, a CST, whole-document regeneration, hidden source
  identifiers, sidecar semantic state, a second document buffer, or parser object
  identity across reparses.
- WD2 scene-tree work: inspector, viewport, palette, ROUTE graph, timeline,
  PROTO tooling, export profiles.

## 14. Optional, deferrable, non-blocking

Recovery is currently detected through diagnostic range containment plus
structural invariants. That works and is proven, but it couples a scope module to
diagnostic ranges. A later lane **may** add an additive `incomplete: true` to
`Proto` and `ExternProto` when brace/bracket recovery fires, mirroring the flag
`Node` already carries. It changes no range, no text, no existing field and no
behaviour.

**Outcome A does not depend on it.** It is a nice-to-have, not a prerequisite,
and it must not be smuggled into WD1.5-P1.
