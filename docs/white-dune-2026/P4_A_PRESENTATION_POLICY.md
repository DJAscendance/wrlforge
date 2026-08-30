# P4-A — Semantic Findings Presentation Policy (as built)

**Module:** `src/vrml/presentation.js` · **Facade:** `vrml.presentation`
**Predecessors:** WD1.5-P1/P2A/P2B/P2C · WD1.6-B/C/D · WD1.7-C/D/E0/E1
**Status:** implemented, uncommitted, awaiting independent QA.

---

## 1. What this lane is

Every module below P4 answers *what is true about this document*. P4 answers the
one question all of them refuse:

```
semantic evidence            P4 presentation policy          WD2
(WD1.5 / WD1.6 / WD1.7)  ->  severity, rank, order,     ->   renders it
                             visibility, tags, save
```

It is **presentation policy**, not semantic reinterpretation and not WD2 UI
construction. `src/vrml/index.js` already said so in three separate places
("NO POLICY", "NO PRESENTATION", "severity is P4's"); this lane is the module
those notes were deferring to.

**Where P4 stops.** It may not decide whether an ISO fact is true, whether a
PROTO resolves, whether an EXTERNPROTO target matches, whether a class is legal,
or whether compatibility evidence is earned. Those verdicts arrive already
frozen and are carried by identity.

---

## 2. Architecture — a sibling projection

```js
presentSemanticFinding(finding) -> Object.freeze({
  finding,                        // the input, BY IDENTITY, unmodified
  presentation: Object.freeze({ ... }),
})
```

The finding is never copied, re-emitted, or field-mapped into the presentation.
A consumer wanting `code`, `reason`, `rule`, `range`, `detail` or `evidence`
reads them from `finding`, where they remain the producing authority's answer
rather than P4's paraphrase. `presentation` carries no semantic field of its own
— asserted by an exact key-set test.

P4 has no access to `createFinding` or `attachCompatibility`, contains no
`Object.assign` over a finding, and contains no assignment to a finding field.
Mutation control **M9** proves the identity requirement is load-bearing.

### Two families, one policy core

| family | record | entry point |
|---|---|---|
| WD1.6-D semantic findings | `{ code, iso, confidence, reason, compatibility, … }` | `presentSemanticFinding` |
| WD1.7-D interface agreement | `{ code, basis, name, localType, … }` | `presentAgreementFinding` |
| WD1.7-D agreement **rollup status** (not a finding) | `AGREEMENT_STATUS` value | `presentAgreementStatus` |

Each family gets its **own explicit entry point**. Sniffing a record's shape to
guess its family is the `WD.md` §7 failure mode wearing a new hat. What they
share is the policy core: both are normalized onto the same two axes and run
through the **one** severity table in the repository.

---

## 3. The severity contract

Severity is a pure function of one derived value, `CLAIM`:

```
SEVERITY_BY_CLAIM = { violation: error, undetermined: warning, observation: info }
```

`CLAIM` comes from one table over two axes:

| `iso` | answer conclusive? | claim | severity |
|---|---|---|---|
| `prohibited` | yes | `violation` | **error** |
| `prohibited` | no  | `violation` | **error** |
| `undefined`  | yes | `violation` | **error** |
| `undefined`  | no  | `violation` | **error** |
| `not-stated` | yes | `observation` | **info** |
| `not-stated` | no  | `undetermined` | **warning** |

Read the *shape*, not just the values. Where the ISO axis asserts a normative
claim, the confidence axis is **not consulted at all** — that is §5/§6 of the
lane charter expressed as data rather than as a comment. Only `not-stated`,
where there is no normative claim to preserve, splits at all.

Both terminal ISO results are errors because WD1.6-D's own header records that
7.2.1 makes both conformance failures — 7.2.1(2)–(3) for a violated relationship
and 7.2.1(7) for behaviour the standard declares undefined. The distinction
between them is preserved on the `iso` field and in the attention rank, never
flattened away.

**The agreement family uses the same vocabulary, not a second one:**

```
ISO_BY_AGREEMENT_BASIS = { 'iso-4.9.2': prohibited, 'not-specified-by-iso-4.9.2': not-stated }
```

so `MEMBER_MISSING` and `TYPE_MISMATCH` are errors and `ACCESS_DIFFERS` is info,
without a single line of code that mentions `ACCESS_DIFFERS` by name.

---

## 4. The confidence contract

`confidence` is presented, never folded into severity:

```js
confidence: { status, class, recovered }
```

* `status` — the substrate's own `STATUS` value, **verbatim**, or `null` for the
  agreement family (which has no scope-graph status and must not borrow one).
* `class` — `conclusive` when `status === 'resolved'`, `inconclusive` otherwise.
* `recovered` — `status === 'recovered'`.

`class` is deliberately **not** called "proven": an `unresolved` USE has *proven*
an absence (P1 downgrades to `recovered` whenever absence is not provable), so
"proven" would be a claim about the *document*, while this axis is a claim about
the *answer*. The filter tag is `conclusive` / `inconclusive` for the same
reason.

**Why this is not a severity input in disguise.** `class` reaches severity in
exactly one row of the table above — the row where no normative claim exists. A
strictly serious finding with `recovered` confidence presents at the identical
severity as its proven twin, verified across the full `ISO_RESULT × STATUS`
cross product and enforced by mutation control **M2**.

---

## 5. Recovered-confidence default

86.96% of WD1.6-D's corpus findings carry `confidence: recovered`. P4 makes them
usable without pretending they are absent:

* `visible: true` — **always**, for every category. Nothing is suppressed before
  the user chooses a filter (mutation control **M3**).
* `FILTER_TAG.RECOVERED` — its own tag, **additional** to `inconclusive`, never
  instead of it. This is the axis a UI filters on.
* Lower attention: `CONFIDENCE_RANK` puts `recovered` last (5 of 5) *within* its
  severity band, so a proven error outranks a recovered one without either
  crossing a severity boundary.

P4 supplies that metadata. It does not destroy an occurrence, and there is no
`hidden` / `suppressed` / `dismissed` concept in the module to regress into.

---

## 6. The compatibility contract

**Compatibility never downgrades a strict severity.** A construct ISO prohibits
and blaxxun Contact tolerates is still an error; the profile is an annotation
beside it (mutation control **M1**).

```js
compatibility: null | {
  profile, classification, behavior, evidenceTier, evidenceSubtier,
  tolerated,           // the named runtime accepts a prohibited construct
  portable: false,     // ALWAYS. A runtime acceptance is not portability.
  downgradesSeverity: false,  // ALWAYS. Stated as data so a regression fails.
}
```

`null` keeps meaning exactly what WD1.6-D reserved it to mean — **NOT
EVALUATED**, not "no profile accepts this". Every value shown is re-expressed
from the attached record's own fields; P4 does not consult the registry, does not
name a profile, and cannot decide that evidence is earned. `presentation.js`
contains no profile identifier and no classification string literal — the
constants are imported from `src/vrml/compatibility.js`.

**No duplicate item.** A compatibility attachment annotates the one finding it
belongs to. `presentDocumentFindings` returns exactly one presentation per input
occurrence (mutation control **M7**), so the display is

```
ERROR  interface-declaration-nonconforming / exposed-field-in-script-interface
       [blaxxun-contact · tolerated · not portable]
```

and never two unrelated entries. `TOLERATED_VIOLATION` sets `tolerated: true`
with `portable: false`; `EXTRA_STANDARD` sets `tolerated: false` with
`portable: false`. Neither implies safe, recommended, portable, fixed or valid.

**WD1.7-E1's posture is untouched.** `src/vrml/compatibility.js` is still not on
the facade. P4 presents an attachment that is already on a finding; obtaining one
is E1's own decision, and publishing `withCompatibility` is E1's to make.

---

## 7. `ACCESS_DIFFERS`

WD1.7-D emits it with `basis = NOT_SPECIFIED_BY_ISO_4_9_2`, `status = satisfied`
and `compatibility = null`. P4 presents it as:

```
severity: info · claim: observation · iso: not-stated
tags: [information, conclusive, not-specified-by-iso]
compatibility: null
```

It is filterable separately from normative failures on the
`not-specified-by-iso` tag, and it is never an error (mutation control **M5**).
Its 4.9.2 sibling `MEMBER_MISSING` in the same family *is* an error — the split
is the basis, not the code.

---

## 8. Unsupported / withheld / ambiguous

> Neither LEGAL nor ILLEGAL is a fallback. Both require proof.

The presentation preserves that doctrine by distinguishing **known invalid**
(`claim: violation`) from **could not determine** (`claim: undetermined`).

| input | claim | severity |
|---|---|---|
| `confidence: unsupported`, `iso: not-stated` | `undetermined` | warning |
| `confidence: ambiguous`, `iso: not-stated` | `undetermined` | warning |
| `confidence: recovered`, `iso: not-stated` | `undetermined` | warning |
| `confidence: invalid`, `iso: not-stated` | `undetermined` | warning |
| agreement rollup `withheld` | `undetermined` | warning |
| agreement rollup `not-attempted` | `undetermined` | warning |
| agreement rollup `invalid` | `undetermined` | warning |

None of these is presented as a proven error (mutation control **M6**). An
uncertain answer that *also* carries a normative violation keeps the violation's
severity — the two are independent.

`presentAgreementStatus` exists because WD1.7-D's `withheld` produces **no
finding at all** (turning unknown into missing is the gate D exists for), so the
rollup status is the only place "the comparison could not be made" can reach a
consumer. It returns a deliberately **different shape** so it cannot be mixed
into a findings list, and it mints no occurrence. `attention: false` only for
`satisfied`.

---

## 9. Save policy

```
saveBlocking === false
```

on **every** result P4 can produce — semantic findings, agreement findings and
rollup statuses alike — verified over the full axis cross product and enforced by
mutation control **M4**. There is no parameter that changes it.

An author must always be able to save an incomplete, invalid, recovered or
work-in-progress VRML document in order to go on fixing it. A lower-level
serialization or integrity failure that makes writing physically impossible is a
different thing and is not a P4 decision.

---

## 10. Export / package policy — deliberately absent

P4-A implements **no** export gate and has **no** `exportBlocking` field.

World Project packaging already owns a blocking authority
(`src/world-project/package-plan.js` → `plan.blocking`, consumed by
`bundle-builder.js` and `main.js`), and Mall Item upload rules belong to
`validator.js`. A generic gate here would be a third opinion on a question two
profiles already answer. Deferred; if a generic export concept is ever needed it
gets its own lane.

---

## 11. Ordering

One deterministic order, in `orderPresentations` — the single `.sort()` call in
the module. `presentDocumentFindings` delegates to it.

| # | dimension |
|---|---|
| 1 | `attentionRank` |
| 2 | span **start** offset (range-less ⇒ `Infinity`, sorts last) |
| 3 | span **end** offset |
| 4 | `origin` (codepoint) |
| 5 | `code` (codepoint) |
| 6 | `reason` / `basis` (codepoint) |
| 7 | subject name (codepoint) |
| 8 | **input index** — the last resort |

`attentionRank` is one integer combining three nested scales:

```
severityRank * 100  +  strictnessRank * 10  +  confidenceRank
error 0 / warning 1 / info 2 / hint 3
prohibited 0 / undefined 1 / not-stated 2
resolved 0 / unresolved 1 / ambiguous 2 / invalid 3 / unsupported 4 / recovered 5
```

Severity dominates **absolutely**: no confidence value can lift a warning above
an error, and proven errors surface before recovered warnings — while confidence
never touches severity itself.

Within one rank the list **follows the file** (dimension 2). A range-less finding
sorts *last* within its rank, never first, and never throws. Dimension 8
guarantees stability without merging or dropping anything; mutation control
**M8** proves dimensions 2–8 are load-bearing by showing the output otherwise
depends on producer emission order.

---

## 12. Visibility and filter/group metadata

Binding default: **all findings shown**. No semantic category is globally hidden,
including `recovered`, `unsupported` and compatibility-observed.

`FILTER_TAG` — one finding carries several, in a fixed order (severity,
confidence, rule source, compatibility):

| axis | tags |
|---|---|
| severity | `errors` · `warnings` · `information` |
| confidence | `conclusive` **or** `inconclusive`; plus `recovered` where it applies |
| rule source | `strict-iso` **or** `not-specified-by-iso`; plus `compatibility` where attached |

`FINDING_GROUP` — which part of the language, for a UI that wants sections:
`node-names` · `node-types` · `prototype-interface` · `event-routing` ·
`scene-structure` · `external-interface`.

`ROUTE_NODE_NOT_BOUND` is grouped under `event-routing` rather than `node-names`
even though ISO 4.6.2 is the rule it breaks: the author sees a ROUTE statement,
and grouping is about where they will look. The ISO axis is untouched by it.

No UI tab is hard-coded. These are semantic tags a UI consumes.

---

## 13. No deduplication

`presentDocumentFindings` returns exactly one presentation per input occurrence,
in a frozen array of the same length. Two source locations are two findings even
when `code`, `reason` and subject name are identical (mutation control **M10**).
Grouping metadata is supplied; grouping is never destructive. Whatever
de-duplication the semantic layer already performs — WD1.6-D's three structural
rules — is preserved untouched, because P4 never re-runs it.

---

## 14. Message ownership — deferred to P4-B

P4-A owns **no user-facing prose**. There is no message authority for semantic
findings anywhere in the repository (`diagnostics.makeDiagnostic` takes a message
from its caller), and writing one is a catalogue of hundreds of sentences whose
wording must not over-claim for an `unsupported` or `recovered` answer. A
consumer has `code`, `reason` and `rule` and can render them.

Documented as **P4-B**. A test asserts `presentation.js` carries no `message`,
`title`, `summary` or `description` field, so the deferral is visible rather than
an omission.

---

## 15. No display key

WD2 will want stable list identity. P4-A does **not** mint one: WD2 does not
exist, an array index is stable within a render pass, and a key here is one more
thing that must not be confused with WD1.4 node identity.

If it is ever needed, the recipe is a **presentation-only, batch-scoped**
derivation from already-owned facts — `origin`, `code`, `reason`, span offsets
and occurrence index within the batch. It is never persisted into a file and
never an AST identity.

---

## 16. No context parameter

Presentation is a pure function of the finding. There is no product concept that
legitimately varies it: the owner's ratified policy (WD1.7-E0) is that
compatibility never creates an alternate severity mode, so `blaxxun-contact` is
not a mode. A speculative `{ target, documentMode, expertLevel }` object would be
a place for one to grow, so there is no parameter at all.

---

## 17. The complete matrix guard

`test/vrml/presentation-matrix.test.js` enumerates **every** structured
vocabulary the substrate exports and asserts P4 has an intentional policy for
each — total *and* tight, so a stale entry for a removed value fails too.

| vocabulary | source | P4 table |
|---|---|---|
| `FINDING_CODE` (11) | `semantic-findings` | `GROUP_BY_FINDING_CODE` |
| `ISO_RESULT` (3) | `semantic-findings` | `CLAIM_BY_ISO`, `STRICTNESS_RANK` |
| `STATUS` (6) | `scope-graph` | `CONFIDENCE_CLASS_BY_STATUS`, `CONFIDENCE_RANK` |
| `CLAIM` (3) | P4 | `SEVERITY_BY_CLAIM` |
| `SEVERITY` (4) | `diagnostics` | `SEVERITY_RANK` |
| `AGREEMENT_FINDING` (3) | `proto-agreement` | `GROUP_BY_AGREEMENT_CODE` |
| `AGREEMENT_BASIS` (2) | `proto-agreement` | `ISO_BY_AGREEMENT_BASIS` |
| `AGREEMENT_STATUS` (5) | `proto-agreement` | `AGREEMENT_STATUS_PRESENTATION` |
| `COMPATIBILITY_CLASSIFICATION` (2) | `compatibility` | `COMPATIBILITY_PRESENTATION` |

**No catch-all.** Every table is read through one throwing accessor,
`classify()`; there is no `default:`, no `|| SEVERITY.WARNING`, and no direct
`TABLE[value]` index in the policy path — all three are asserted by source scan.
Every table is frozen and **null-prototype**, so `toString` and `constructor` are
not accidentally classified values. An unrecognized value throws
`EPRESENTATIONUNCLASSIFIED`.

The full `ISO_RESULT × STATUS` severity matrix (18 cells) and the
`AGREEMENT_STATUS` severity map (5 cells) are written out as literals in the
test. Changing any cell is a visible change to the policy, not a silent
derivation.

---

## 18. Public API

Published on `vrml.presentation` (frozen):

```
presentSemanticFinding(finding)   -> { finding, presentation }
presentAgreementFinding(finding)  -> { finding, presentation }
presentAgreementStatus(status)    -> status presentation (NOT a finding)
presentDocumentFindings(findings) -> frozen ordered array, 1:1 with input
orderPresentations(results)       -> frozen ordered array (the ONE ordering)

SEVERITY            (=== diagnostics.SEVERITY, by identity)
FINDING_ORIGIN · CLAIM · CONFIDENCE_CLASS · FINDING_GROUP · FILTER_TAG
PRESENTATION_ERROR  { SHAPE, UNCLASSIFIED }
```

The **policy tables** (`CLAIM_BY_ISO`, `SEVERITY_BY_CLAIM`,
`CONFIDENCE_CLASS_BY_STATUS`, `GROUP_BY_*`, `ISO_BY_AGREEMENT_BASIS`,
`COMPATIBILITY_PRESENTATION`, `AGREEMENT_STATUS_PRESENTATION`, the three rank
scales) are exported from the module for this lane's own tests and are
**not** on the facade — the same split WD1.6-D made for `ISO_BY_REASON`. They are
how the decision is made, not what it is.

### The presentation record

| field | meaning |
|---|---|
| `origin` | `FINDING_ORIGIN.*` — which evidence family produced the finding |
| `group` | `FINDING_GROUP.*` — which part of the language it is about |
| `severity` | `SEVERITY.*` — a pure function of `claim`, and of nothing else |
| `claim` | `CLAIM.*` — what kind of statement the finding makes |
| `iso` | `ISO_RESULT.*`, normalized across both families |
| `confidence` | `{ status, class, recovered }` — presented, never folded into severity |
| `compatibility` | the projection, or `null` for NOT EVALUATED |
| `attentionRank` | integer; lower means look first; severity dominates |
| `visible` | **always** `true` |
| `saveBlocking` | **always** `false` |
| `tags` | frozen `FILTER_TAG.*` array, fixed order |

---

## 19. What WD2 no longer has to decide

* which findings are errors, warnings or information;
* whether a recovered or unsupported answer is an error;
* whether a compatibility profile changes a severity;
* what order a findings list is in, and what happens to a range-less finding;
* what is visible by default;
* which findings block a save (none);
* how to group or filter without re-deriving the semantics;
* how to keep two occurrences of one code distinct.

What WD2 still owns: rendering, wording (until P4-B), icons, colours, layout,
which tabs exist, and which filters it offers.

---

## 20. Browser boundary

`presentation.js` requires only `./diagnostics`, `./semantic-findings`,
`./scope-graph`, `./proto-agreement` and `./compatibility` — all pure and
browser-safe. It touches no `fs`, `path`, `zlib`, `crypto`, `child_process`,
network, Electron or DOM API, asserted by source scan. Runtime dependencies
remain `x_ite` only.

---

## 21. Tests

| file | tests | what |
|---|---|---|
| `test/vrml/presentation-fixtures.js` | — | shared real + synthetic records |
| `test/vrml/presentation.test.js` | 26 | Q1–Q10 policy fixtures + architecture |
| `test/vrml/presentation-matrix.test.js` | 12 | the complete matrix guard |
| `test/vrml/presentation-mutations.test.js` | 11 | M1–M10 live mutation controls + anchor hygiene |

Real findings are used wherever the substrate can produce the shape under test.
Synthetic finding-shaped records appear only for a range-less finding and a
recovered strict violation — shapes the substrate cannot currently emit — and are
built entirely from published vocabulary values.

---

## 22. Deferred

* **P4-B** — the user-facing message catalogue.
* A generic export/package gate — the existing profile authorities keep it.
* A presentation display key — recipe recorded in §15.
* Publishing `src/vrml/compatibility.js` on the facade — WD1.7-E1's decision.
* **WD2** — scene tree, inspector, viewport. P4-A exists to make it easier, not
  to absorb it.
