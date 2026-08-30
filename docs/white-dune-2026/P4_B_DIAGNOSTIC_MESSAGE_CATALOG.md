# P4-B — Diagnostic Message Catalog (as built)

**Module:** `src/vrml/messages.js` · **Facade:** `vrml.messages`
**Predecessors:** P4-A · WD1.6-D · WD1.7-D · WD1.7-E1
**Status:** implemented, uncommitted, awaiting independent QA.

---

## 1. What this lane is

P4-A reads structured semantic facts and answers "how should a consumer show
it" — severity, ordering, visibility, save policy. P4-B answers "what words
should those visuals carry". It depends on P4-A's presentation shape and is
structurally unable to alter a fact, a severity, a group, a saveBlocking or a
compatibility classification — those are already frozen by P4-A.

```
semantic evidence       P4-A presentation          P4-B message        WD2
(WD1.5 / WD1.6 / WD1.7) -> severity, rank, order, -> title, summary, -> renders it
                          visibility, tags           detail
```

It is **message text**, not severity or policy. `src/vrml/index.js` already
said so in three places ("NO MESSAGE TEXT", "NO PRESENTATION", "severity is
P4's"); this lane is the module those notes were deferring to.

**Where P4-B stops.** It may not decide whether a finding is true, its
severity, group, saveBlocking, attention rank, ordering, visibility, or
compatibility classification. Those verdicts arrive already frozen and are
carried by identity from P4-A.

---

## 2. Architecture — text projection over a P4-A presentation

```js
const shown = presentation.presentSemanticFinding(finding);  // { finding, presentation }
const text = messages.messageForPresentation(shown);          // { id, title, summary, detail }
```

Three entry points, one dispatcher. Each accepts a presentation result from a
matching P4-A entry point and returns a frozen text-only object:

```
messageForSemanticFinding(presentationResult)    -> { id, title, summary, detail }
messageForAgreementFinding(presentationResult)   -> { id, title, summary, detail }
messageForAgreementStatus(statusPresentation)    -> { id, title, summary, detail }
messageForPresentation(presentationResult)       -> dispatches by presentation.origin
```

The message is never a copy of the finding; it is a sibling projection over
the P4-A result. The `finding` field of the presentation is held by identity
in P4-A and reaches the consumer unchanged; P4-B borrows only `code`,
`reason`, `basis`, the structured `presentation` fields, and the optional
`compatibility` attachment.

### Message result shape

```js
{
  id: 'use-not-bound',                  // stable internal identifier
  title: 'Reference name is not defined',  // one short line
  summary: 'A USE statement names ...',     // one short sentence
  detail: 'Optional short explanation.',    // or null
}
```

Four fields, frozen, plain strings, nothing else. The matrix test (`M-13`)
pins the exact key set so a regression that adds `severity`, `group`,
`saveBlocking`, `attentionRank`, `claim`, `iso`, `tags`, `compatibility`,
`origin`, or `visible` fails loudly.

---

## 3. Catalog coverage

Three catalog tables live on the module (not on the facade — they are the
reasoning, not the contract, the same split P4-A made for its policy tables).
Every entry is total and tight, asserted by the matrix guard:

| table | key | entries |
|---|---|---|
| `SEMANTIC_TEMPLATES` | `FINDING_CODE.*` | 11 |
| `AGREEMENT_FINDING_TEMPLATES` | `AGREEMENT_FINDING.*` | 3 |
| `ROLLUP_TEMPLATES` | `AGREEMENT_STATUS.*` | 5 |

Every `FINDING_CODE` value, every `AGREEMENT_FINDING` value, every
`AGREEMENT_STATUS` value, and every currently producible `(code, reason)`
combination has a message. The matrix test (`M-01` to `M-03`) asserts
total-and-tight, and `M-05` / `M-06` / `M-08` exercise every cell of the
`code × iso × confidence` and `agreement code × basis` cross products.

### Reason-aware detail

A finding code can carry different reasons. Where the reason changes what the
user needs to know, the template's `detailFor(ctx)` branches on `reason` and
the catalog produces distinct text. Where it doesn't, a per-code default
applies. The mutation test `M-6` proves that two semantically distinct reasons
(`INTERFACE_MEMBER_NOT_DECLARED` vs `EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE`)
produce distinct detail text, with one strict and one uncertain.

---

## 4. Strict wording

Proven violations use direct words. No hedging, no "may be", no "perhaps",
no "possibly". The strict finding's title and summary say what is wrong
without qualification. Examples:

| code | title | summary |
|---|---|---|
| `USE_NOT_BOUND` | Reference name is not defined | A USE statement names a name that is not bound by a DEF in this scope. |
| `NODE_TYPE_NOT_BOUND` | Node type is not defined | A node instance names a type that is not defined in this file. |
| `ROUTE_CONNECTION_REJECTED` | ROUTE connection is not allowed | The types of the ROUTE source eventOut and destination eventIn do not match. |
| `INTERFACE_DECLARATION_NONCONFORMING` | Interface declaration is not allowed here | A declaration in this interface position does not match the language grammar. |

The detail then names the ISO clause that is violated, with exact section
numbers from the local ISO mirror. Mutation `M-1` proves the regression:
injecting "may be invalid" or "perhaps" into a strict violation's text is a
catalog failure.

---

## 5. Uncertainty wording

Unsupported, withheld, ambiguous, invalid and recovered-but-not-stated
findings use uncertainty words. "Could not determine" and "WRLForge could
not determine" name the producer and the limit of what the file as written
allowed. Proven-invalid wording is reserved for findings where the substrate
returned a violation.

| code | title | summary |
|---|---|---|
| `IS_CONNECTION_REJECTED` (unprovable reason) | IS connection is not allowed | An IS statement does not match the prototype interface member by type or access. |
| rollup `WITHHELD` | Interface check withheld | WRLForge could not determine whether the local interface satisfies the implementation PROTO. |

The detail for unprovable findings is "WRLForge could not determine this
result from the file as written." Mutation `M-2` proves the regression:
changing "could not determine" to "is invalid" on an unprovable rollup is a
catalog failure.

---

## 6. Recovered wording

86.96% of WD1.6-D's corpus findings carry `confidence: recovered`. P4-B's
contract is that recovered findings keep their proven twin's strict wording
in title and summary. The detail (when non-null) is allowed to add one
sentence:

```
WRLForge recovered this result from damaged or incomplete syntax.
```

This is the ONLY recovery-aware addition. Title and summary stay direct,
matching the proven wording. Mutation `M-Bonus` (along with `M-7`'s
severity-shape guard) is the structural proof: P4-B never adds severity or
saveBlocking to a message, and recovered detail is the only wording change.

---

## 7. Compatibility wording

For the current E1 case — `blaxxun-contact` attached to a
`INTERFACE_DECLARATION_NONCONFORMING` finding with reason
`EXPOSED_FIELD_IN_SCRIPT_INTERFACE` — the catalog produces a two-sentence
detail:

```
A Script interface uses exposedField. ISO 6.40 forbids exposedField in a
Script interface; Annex A.3 admits only restrictedInterfaceDeclaration there.
blaxxun-contact is documented to accept this behavior. The content is not
VRML97-conforming. The behavior is not portable VRML97.
```

Three facts, all preserved:

1. **The strict fact.** ISO 6.40 forbids the construct.
2. **The runtime acceptance.** `blaxxun-contact` is documented to accept it.
3. **The portability verdict.** "Not portable VRML97" — exactly the wording
   §17 asks for, neither over-claiming (no "no other browser can ever accept
   it") nor under-claiming (no "safe" or "supported everywhere").

Forbidden words in the compat sentence: `safe`, `portable` (without `not`),
`valid`, `fixed`, `supported everywhere`. Mutation `M-3` proves the
regression: removing "not VRML97-conforming" from the compat sentence hides
the strict violation.

For `EXTRA_STANDARD` (if WD1.7-E1 ever grants it), the wording becomes
"ISO does not state a rule here. ${profile} is documented to define this
behavior." — same shape, distinct meaning: the construct is in a gap the
standard left open, and the runtime filled it.

---

## 8. ACCESS_DIFFERS

`AGREEMENT_ACCESS_DIFFERS` arrives at the catalog with
`AGREEMENT_BASIS = NOT_SPECIFIED_BY_ISO_4_9_2`, which P4-A presents as
`iso: NOT_STATED` and `claim: OBSERVATION` — INFO severity, not error. The
catalog produces:

- title: *Interface member access category differs*
- summary: *The local and target member names match and use the same field
  type, but use different access categories.*
- detail: *`<member>` uses `<local>` in the local declaration and `<target>`
  in the target. ISO 4.9.2 names "names and types" and does not state that
  access categories must match.*

Three deliberate properties:

1. The detail cites ISO 4.9.2 explicitly — the clause that is silent on
   access — so the user can verify the silence themselves.
2. The text never says "invalid" or "non-conforming".
3. The text never says "compatible with blaxxun" or any vendor name.

Mutation `M-4` proves the regression: claiming the title says "is invalid"
breaks the informational contract. Mutation `M-Bonus` proves the regression:
removing the ISO 4.9.2 citation leaves the user without the reason for the
informational classification.

---

## 9. Agreement text — member-level vs rollup

Member-level findings and rollup statuses are separate text families. A
rollup never claims a new per-member error: its title and summary name the
**check**, not a member.

| status | title | summary |
|---|---|---|
| `SATISFIED` | Interface check passed | The local EXTERNPROTO interface satisfies the implementation PROTO. |
| `VIOLATED` | Interface check failed | The local EXTERNPROTO interface does not satisfy the implementation PROTO. |
| `WITHHELD` | Interface check withheld | WRLForge could not determine whether the local interface satisfies the implementation PROTO. |
| `NOT_ATTEMPTED` | Interface check not attempted | WRLForge did not attempt the interface check because no implementation target was selected. |
| `INVALID` | Interface check invalid | The interface check request was not well-formed. |

The member-level findings (`MEMBER_MISSING`, `TYPE_MISMATCH`,
`ACCESS_DIFFERS`) describe what happened to one member. The rollup describes
whether the comparison was performed and whether it succeeded. Mutation `M-7`
is the matrix test for this distinction; the matrix guard `M-13` pins the
shape contract on every rollup.

---

## 10. Subject-name interpolation

When the finding carries a structured `name` (USE reference name, ROUTE
endpoint name, agreement member name), the catalog quotes it into the text
with curly quotation marks. Unusual characters survive verbatim because the
catalog returns plain strings — no HTML, no DOM construction, no escaping
that would mangle what the user wrote. The matrix test `M-13` and the
mutation `M-10` prove this:

- Name preserved verbatim in `detail`.
- Result is plain strings only (`typeof === 'string'` or `null`).
- No `innerHTML`, `createElement`, or `document.*` in the source.

When the name is `null` or empty, the text uses anaphoric language ("This
USE statement..." rather than "undefined..."). Mutation `M-Q9` proves the
regression: never producing the literal string "undefined" or "null" in
user-facing text.

---

## 11. Fail-closed rule

An unrecognized value at any entry point throws `EMESSAGEUNCLASSIFIED` —
the same fail-closed contract P4-A's `EPRESENTATIONUNCLASSIFIED` follows.
The thrown error code is the documented stable identifier for the catalog
to fail.

The matrix test `M-10` proves the dispatcher fails closed on a tampered
origin, and the matrix test `M-12` proves the catalog tables are
frozen and null-prototype (so an inherited `toString` or `constructor`
key cannot accidentally classify). There is no generic fallback message:
adding a new finding code without a catalog entry is a programming error
that throws, not a silent arrival.

---

## 12. P4-A boundary

P4-B carries no severity, group, saveBlocking, attention rank, ordering,
visibility or compatibility classification. Every one of those is P4-A's
decision, frozen by P4-A, and P4-B reads them only to decide whether the
text should mention compatibility or recovery. The matrix test `M-13`
asserts the shape contract; the mutation `M-7` proves the regression is
caught if the message object ever grows a `severity` field.

The same boundary holds for the catalog's vocabulary:

- No profile name appears as a string literal (compatibility comes from
  the attached record, never from a spelling here).
- No reason string is re-spelled (the catalog imports `REASON` from
  `scope-graph.js`).
- No ISO clause is re-spelled (the catalog cites clauses the finding
  itself carries, or names the section that is silent).

---

## 13. WD2 contract

P4-B gives WD2 exactly one thing: text. The result shape is frozen and
contains only `id`, `title`, `summary`, `detail`. WD2 chooses:

- which tab, panel or notification uses which fields.
- icons, colors, typography, layout, hover, click.
- whether to show title only, summary only, or both.
- whether to expose the `id` for filtering or hide it.
- whether `detail` is collapsible, expandable or always shown.
- localization, when the lane is approved.

WD2 never decides:

- whether a finding is true or uncertain (P4-A already decided).
- the severity of a finding (P4-A already decided).
- the group of a finding (P4-A already decided).
- the save policy (P4-A already decided, always `false`).
- the wording (P4-B already decided).

---

## 14. Localization deferral

P4-B does not introduce a translation framework. The text lives in ONE
place — the catalog tables in `src/vrml/messages.js` — so a future lane can
swap templates by language without rewriting call sites. No new runtime
dependency is introduced; runtime dependencies remain `x_ite`-only.

When localization is approved, the design that follows from P4-B's
structure is:

```
messages.semanticByLanguage = { 'en-US': SEMANTIC_TEMPLATES, 'ja-JP': ... }
messageForPresentation(...) -> pick template by current language
```

The shape (`{ id, title, summary, detail }`) is the same; the IDs are
language-neutral; the dispatcher entry points do not change.

---

## 15. Architecture boundaries

- `src/vrml/messages.js` — the catalog authority. Pure, deterministic,
  browser-safe. No `fs`, no `path`, no `zlib`, no `crypto`, no
  `child_process`, no Electron, no DOM. Asserted by source scan in the
  test suite (M-01 and the focused test `01`).
- `src/vrml/index.js` — `vrml.messages` facade, frozen, exposing only the
  consumer-facing surface. Catalog tables stay on the module, not on the
  facade.
- `test/vrml/messages.test.js` — Q1–Q10 + architecture (18 tests).
- `test/vrml/messages-matrix.test.js` — total-coverage matrix (13 tests).
- `test/vrml/messages-mutations.test.js` — M1–M10 + bonus + anchor hygiene
  (12 tests).

No UI, no locale files, no DOM, no runtime dependency. The package.json
`dependencies` field remains `["x_ite"]`.

---

## 16. Tests

| file | tests | what |
|---|---|---|
| `test/vrml/messages.test.js` | 18 | Q1–Q10 + architecture + dispatcher end-to-end |
| `test/vrml/messages-matrix.test.js` | 13 | M-01..M-13: total coverage, no catch-all, shape contract |
| `test/vrml/messages-mutations.test.js` | 12 | M-1..M-10 live mutation controls + bonus + anchor hygiene |

Total: **43** focused tests, on top of the existing **1809**. Full
`npm run check`: **1852 / 1852**, 0 failed, 0 skipped.

---

## 17. Deferred

- **P4-B does not become WD2.** The renderer, the icons, the colors and the
  panel layout are WD2's lane.
- **Localization** is a future lane. The catalog's data layout supports it
  without code changes.
- **Auto-fix / repair suggestions** — message text may give a small safe
  action when the correct action follows directly from the semantic fact
  (e.g. "Declare the missing member in the implementation PROTO."), but P4-B
  does not build a fix system. Multiple-repair scenarios are deferred.
- **Stable list identity / display key** — still deferred, the recipe is
  recorded in `P4_A_PRESENTATION_POLICY.md` §15.
- **`EXTRA_STANDARD` wording refinement** — the current wording is the
  minimum honest shape. If WD1.7-E1 grants more than one profile, the
  wording may evolve to name the documented behavior specifically.
