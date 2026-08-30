# WD1.7-E0 — Compatibility policy and evidence ratification

**Status:** decision/evidence lane. **RATIFIED BY THE OWNER on 2026-08-29** (D1–D5,
§17). **No production code changed by this lane.** **Predecessor:** WD1.7-D CLOSED
(`75fd303`). **Successor:** the ratified implementation lane **WD1.7-E1**, as built
in [`WD1_7_E1_BLAXXUN_CONTACT_PROFILE.md`](WD1_7_E1_BLAXXUN_CONTACT_PROFILE.md).
**Verdict:** `WD1_7_E_POLICY_READY_FOR_OWNER_RATIFICATION` — **with a scope
correction**: the profile that is now nameable does **not** classify the findings
WD1.7-D produces. See §12 and §16.

**This lane opened evidence that WD1.7-A could not.** On 2026-08-29 the owner
lifted the read restriction on `blaxxun-cs-RE` (including
`modeling-tools/RE-ARTIFACTS/` and the FreeWRL checkout) for this lane. That
changed the answer. WD1.7-A's DECISION-1 recommendation ("no profile is
nameable") was correct **on the evidence A was allowed to see** and is now
superseded — see §7.

**Nothing was copied.** No blaxxun source, decompilation output, documentation
file, image or asset was copied, adapted, translated or vendored into WRL Forge.
No credential, member-data, licence-key or login/crypto artifact was opened.

**Publication form (owner decision D3, ratified 2026-08-29).** This repository is
public and the evidence artifacts are **proprietary vendor documentation**. Every
behaviour below is therefore recorded as a **precise paraphrase** plus its
attribution, product generation, reference-root-relative path and evidence tier —
**never as a quotation of the vendor's prose**. The evidence trail is unchanged
in strength: a reviewer holding the same material can open the cited file and
check the paraphrase. Node type names, API names and version numbers are facts
and are recorded verbatim; sentences are not.

---

## 1. The decision question, stated exactly

WD1.7-D emits `MEMBER_MISSING`, `TYPE_MISMATCH` (basis `ISO_4_9_2`) and
`ACCESS_DIFFERS` (basis `NOT_SPECIFIED_BY_ISO_4_9_2`), and reserves a third axis:

```js
compatibility: null   // NOT EVALUATED
```

Filling that slot requires answering four questions **per behaviour**:

1. What exact behaviour or deviation is being classified?
2. Relative to what strict ISO semantic fact?
3. What evidence shows a **named** implementation or profile **accepts** it?
4. What exact implementation/profile name does that evidence support?

WD1.7-A could answer 1, 2 and 4-partially, and could not answer 3 for anything.
This lane can now answer all four for a **specific, bounded set of behaviours** —
which is not the set WD1.7-D reports on.

---

## 2. Evidence hierarchy (proposed, ratification-ready)

Four tiers. The names are chosen so a reader cannot mistake tier for certainty
about ISO — these grade **compatibility evidence only** (§17).

| tier | name | what qualifies | may support a named claim? |
|---|---|---|---|
| **A** | `VENDOR_DOCUMENTED` | A normative sentence in the vendor's own shipped documentation, or vendor-authored capability/sample content that intentionally exercises the behaviour, or reproducible execution in the named implementation. | **Yes**, on its own. |
| **B** | `HISTORICAL_OPERATIONAL` | Production content known to have run against a named runtime, where the behaviour cannot be explained as dead or unreached syntax. | **Only with explicit qualification**, and never for a behaviour Tier A contradicts. |
| **C** | `CORPUS_OBSERVED` | The construct occurs in archived content. | **No.** Proves the pattern existed, not that anything accepted it. |
| **D** | `INFERRED` | "Probably tolerated", "looks like a Blaxxun extension", reasoning from prevalence. | **No.** Never publishable as a compatibility verdict. |

Two rules that make the tiers load-bearing rather than decorative:

- **A tier is a property of one behaviour, not of a source.** The same document
  is Tier A for a sentence it states and no evidence at all for a behaviour it
  does not mention. §5 depends on this.
- **Prevalence never promotes a tier.** 46,945 corpus occurrences of a construct
  is Tier C at 46,945 as surely as it is at 1.

### 2.1 Sub-tiers inside A, because they are not equally strong

| sub-tier | meaning | weakness a reviewer must know |
|---|---|---|
| `A1` documented | the vendor states the behaviour in shipped documentation | documentation can describe intent rather than shipped behaviour |
| `A2` vendor-authored content | vendor sample/capability content exercises it | shows the vendor expected it, not that every version does it |
| `A3` executed | reproduced in the named runtime, recorded | strongest; not yet performed (§13) |

Every claim in this lane is **A1**, one is **A2**. **None is A3.** The vendor's
own authoring guide hedges its extension nodes in writing: it states that no
test suites exist for them and declines to claim full support for them. That
hedge is precisely why A1 must not be presented as A3.

---

## 3. ISO and compatibility cannot be the same field

Unchanged from WD1.6-D and WD1.7-D, restated because E is the lane that would
break it:

```
strict ISO fact          — what ISO/IEC 14772-1 says
external evidence        — what a configured archive proves about a target
compatibility            — what a NAMED runtime is evidenced to accept
```

A legacy browser accepting an ISO violation does not make the content
ISO-conforming. `compatibility` is a **sibling projection**, added alongside,
and may never mutate `strictLocal`, `external.interface`,
`external.implementationClass`, resolution provenance, `iso`, or `rule`.

In `semantic-findings.js` this is already structurally guaranteed: `iso` is
computed from the answer's own `reason` by `ISO_BY_REASON`, inside the single
`finding()` construction path, and no producer can supply it. E must not add a
second construction path.

**The strict result is never normalized away.** If execution someday proves
blaxxun Contact accepted a `MEMBER_MISSING`, the finding still reads
`basis: ISO_4_9_2`; the compatibility slot separately records the acceptance.

### 3.1 Two kinds of compatibility claim, kept apart

These must never share one bucket:

| kind | meaning | example |
|---|---|---|
| `EXTRA_STANDARD` | ISO is **silent**; the vendor defined something in the space ISO left open | the `urn:inet:blaxxun.com:node:` mechanism (ISO 4.9.1 explicitly permits "some other implementation-dependent mechanism") |
| `TOLERATED_VIOLATION` | ISO **forbids** it; the named runtime accepts it anyway | `exposedField` inside a `Script` node (ISO 6.40 forbids) |

Collapsing them into one `legacy-compatible` label destroys the only distinction
a remediation decision turns on. Recommended: keep both, as separate values of a
`classification` field.

---

## 4. Vendor extension vs vendor tolerance

The same split, applied to nodes rather than findings:

| | vendor **extension** | vendor **tolerance** |
|---|---|---|
| what it is | a capability the vendor defined and documented | non-conforming input the runtime does not reject |
| authored on purpose? | yes | usually not |
| ISO posture | silent (4.9.1 permits the mechanism) | violated |
| example | `BspGroup`, `Occlusion`, `Layer3D` via URN | `exposedField` in `Script`; `ROUTE` inside an MFNode array |
| remediation advice | "portable only on this runtime" | "this is a defect that one runtime forgave" |

These are different messages to an author. One profile bucket cannot carry both.

---

## 5. What the newly opened evidence actually proves

Source: **blaxxun interactive's own shipped administrator/authoring
documentation**, found in two independent product generations in the local
install trees:

| generation | path (evidence root, not copied) |
|---|---|
| Virtual Worlds Platform **5.1** | `blaxxun-cs-RE/install/blaxxun interactive/Virtual Worlds Platform/csadmin/doc/reference/3dauthoring9.html` |
| Community Server **7.0** | `blaxxun-cs-RE/install-7.0/csadmin/doc/3dauthoring/3dextensions2.html`, `3dscripting7.html`, `3ddesignrules13.html`, `3dmisc3.html` |

That the same sentences appear in **two shipped generations years apart** is
itself evidence: this is settled documented behaviour, not a draft note.

| # | behaviour (vendor's own words, abbreviated) | ISO posture | tier | classification |
|---|---|---|---|---|
| **V1** | For a built-in referenced by `urn:inet:blaxxun.com:node:X`, the documentation states that the **native node's own interface** is the one used, and that the interface written in the `EXTERNPROTO` statement is not. | ISO **silent** — 4.9.1 permits an implementation-dependent mechanism; 4.9.2's subset rule is simply not consulted | A1 (×2 generations) | `EXTRA_STANDARD` |
| **V2** | The documentation states that the client parses `PROTO`, `ROUTE` and `EXTERNPROTO` statements **in every position where a node value is expected**. | ISO **violated** — A.2 permits none of these in an MFNode array | A1 (×2 generations) | `TOLERATED_VIOLATION` |
| **V3** | The documentation states that `exposedField` declarations **are permitted in a Script node interface**, and the same page warns that content relying on it is not portable to other VRML browsers. | ISO **violated** — 6.40 forbids | A1 | `TOLERATED_VIOLATION` |
| **V4** | A registry of 25 documented extension node types reachable by URN: `Background2D Bitmap BspGroup BspTree Camera Cell CellGroup CompositeTexture3D CoordinateInterpolator2D CullGroup Curve2D ImageTexture Inclusion Inline Inline2 KeySensor Layer2D Layer3D MenuSensor MouseSensor MovieTexture2 NodeType NurbsSurface Occlusion Selection` | ISO **silent** | A1 | `EXTRA_STANDARD` |
| **V5** | The documentation states that `Browser.createVrmlFromString` **resolves `PROTO` declarations made in the top-level file**, and marks that behaviour non-standard in its own text. | ISO **violated** | A1 | `TOLERATED_VIOLATION` |
| **V6** | The documentation describes `blaxxun3D` (the Java applet) as implementing **a strict subset** of VRML97, and its migration guidance directs authors to **remove `PROTO`, `EXTERNPROTO` and `Script`** as unsupported language features. | n/a | A1 | **a different profile** — see §7.2 |
| **V7** | `Browser.getName()` returns `GLView` **or** `blaxxunCC3D`, guarded together in one condition | n/a | A2 (`captest.wrl`, vendor-authored) | identity strings, **not** a behaviour |

**V6 corroborated independently.** The decompiled blaxxun Java client
(`re-artifacts/java-decompiled/blaxxun/k.java`) matches `proto`/`externproto` as
*unrecognised node types* and skips to the balanced closing brace. It implements
no prototype resolution at all. Read as behavioural corroboration only; no code
was taken.

### 5.1 What the evidence does **not** prove — the load-bearing gap

**V1 is scoped to URN references to blaxxun built-ins.** The documentation says
nothing about an EXTERNPROTO whose target is an ordinary `.wrl` file. So:

> There is **no Tier A or Tier B evidence** that blaxxun Contact accepted
> `MEMBER_MISSING`, `TYPE_MISMATCH`, or an access-category difference **against a
> file target**.

And WRL Forge never resolves a URN: `src/external-proto/reference-forms.js:129`
classifies `urn:` as `routable: false` / `URN_NOT_RETRIEVABLE`, so WD1.7-C never
selects a URN target and WD1.7-D never produces an agreement record for one.

**Therefore V1 — the one documented rule that speaks directly to EXTERNPROTO
interface agreement — applies exactly and only where WD1.7-D has no finding to
classify.** That is the scope correction in §12.

---

## 6. Profile-naming audit

| candidate name | evidence | scope it would cover | problems | recommendation |
|---|---|---|---|---|
| **`blaxxun-contact`** | A1 ×2 shipped doc generations (§5); the product names itself `blaxxun Contact` / `blaxxunContact` / `blaxxun Contact 3D` throughout | V1–V5, V7 | evidence is documentation, not execution; version boundaries are coarse | **ADOPT** as the one nameable profile, with §6.1's contract |
| `blaxxun-3d` | A1 (V6) + decompilation corroboration | a *stricter-than-ISO subset*, no PROTO/EXTERNPROTO/Script | it is a **restriction** profile, not a tolerance profile; nothing in the Cybertown corpus targets it | **DEFER** — real, evidenced, but no consumer |
| `Blaxxun/GLView` | none for a second behaviour | — | asserts an equivalence and a second behaviour the evidence denies | **RETIRE** |
| `glview` | A2 only, as a `getName()` string | — | a product identity string, not a resolution behaviour | **RETIRE as a profile**; keep only as a runtime-identity token if a runtime-detection feature ever needs one |
| `blaxxun` (bare) | — | — | ambiguous across **two vendor implementations with opposite behaviour** (Contact tolerates; blaxxun3D forbids) — V6 makes this concretely wrong, not merely vague | **RETIRE** |
| `cybertown-compat` | Tier C only | — | Cybertown is content, not a runtime (§8) | **RETIRE** |
| `legacy-vrml` / `legacy-cybertown` | Tier D | — | names no artifact, no version, nothing falsifiable | **RETIRE** |

### 6.1 The `blaxxun-contact` profile contract

Every public profile must answer five questions. This one can:

| question | answer |
|---|---|
| **What artifact defines it?** | blaxxun interactive's shipped *3D Authoring* documentation, as published with Virtual Worlds Platform 5.1 and Community Server 7.0. |
| **What version/family?** | blaxxun Contact 3D, **4.x–5.x**. The docs name 4.1, 4.3, 5.0 explicitly. It does **not** cover blaxxun3D (§6, `blaxxun-3d`) and does **not** cover Bitmanagement BS Contact 6.x, a successor product under different ownership. |
| **What behaviours belong to it?** | Exactly V1–V5. A closed list, extended only by adding evidence. |
| **What evidence supports them?** | One cited sentence per behaviour, at a cited path, in a named product generation (§5). |
| **What would falsify membership?** | A behaviour **not** described in that documentation set is **not** in the profile — absence of a sentence is the falsifier. Additionally, an A3 execution result contradicting a documented sentence supersedes the sentence. |

**Inclusion rule, stated so it can be tested:** a behaviour enters
`blaxxun-contact` if and only if a citable normative sentence in the named
documentation set describes the runtime accepting or defining it. Prevalence,
authorship and plausibility grant no membership.

---

## 7. Blaxxun / GLView decision

**RETIRE the compound term `Blaxxun/GLView`** — unchanged from WD1.7-A
DECISION-1, and now on stronger evidence: the vendor's shipped documentation
never documents a `GLView` EXTERNPROTO behaviour, and `GLView`/`blaxxunCC3D`
remain two `Browser.getName()` values guarded together in one vendor-authored
condition.

**What changes** is the second half of DECISION-1. A recommended it because *no*
profile was nameable. One now is — `blaxxun-contact` — but it is named from
**vendor documentation**, not from a browser-identity string. The slash stays
retired either way.

### 7.2 One vendor is not one profile

blaxxun interactive shipped at least two VRML implementations with **opposite**
posture on the very constructs at issue (paraphrased from the shipped
documentation of each):

```
blaxxun Contact 3D 4.x-5.x   tolerates ROUTE/PROTO in node-value position,
                             Script exposedField, URN built-in override
blaxxun3D (Java applet)      supports no PROTO, no EXTERNPROTO, no Script at all
```

Any profile named `blaxxun` without a product would be wrong for one of them.

---

## 8. Cybertown decision

Cybertown is **not** a browser and must never be modelled as one. It splits into
three things that already have owners:

| Cybertown thing | correct home | why |
|---|---|---|
| 80KB gzip cap, required `WorldInfo`, forbidden nodes, texture and placement rules | **Mall Item profile** (`validator.js`) | packaging/upload policy of one website. `AGENTS.md` already forbids leaking it sideways. |
| project folders, nested `Inline`, ~70 textures, no cap | **World Project profile** | a different problem shape, already separate |
| `EXTERNPROTO … bxx/shared.wrl`, `BspTree`, `Occlusion`, `HUD`, Script `exposedField` | **`blaxxun-contact`**, if evidenced — attributed to the *runtime*, not to the site | Cybertown authored **for** blaxxun Contact; the acceptance was the browser's, not the site's |
| "authors did this a lot" | **`CORPUS_OBSERVED` (Tier C)** | an observation, never a compatibility verdict |

**`cybertown-compat` is retired.** Authorship by Cybertown is Tier C. It proves
the pattern existed; the browser proves what was accepted.

Mall/World policy must not enter the core semantic layer, and the core semantic
layer must not learn a site name.

---

## 9. `ACCESS_DIFFERS` — the first policy test

> What may WRL Forge truthfully say today when the local and target declarations
> agree on name and type but differ in access category?

**Answer: (D) unknown — `NOT_EVALUATED`.** `compatibility` stays `null` for this
finding.

| candidate answer | verdict | why |
|---|---|---|
| **A. observed only** | true but already said | `AGREEMENT_FINDING.ACCESS_DIFFERS` + `basis: NOT_SPECIFIED_BY_ISO_4_9_2` is *exactly* "observed, unclassified". A `compatibility` value repeating it adds nothing. |
| B. accepted by a named implementation | **not supported** | V1 covers URN targets only (§5.1). No documentation addresses access drift against a file target. |
| C. compatible with a named profile | **not supported** | same gap, and one step stronger. |
| **D. unknown** | **correct** | the honest answer, and it is what `null` already means. |

**Explicitly forbidden by this policy:** turning A's `65 / 1,169 = 5.56%` into
"blaxxun accepts access drift". That figure is Tier C, from an explicitly
non-production generous probe, and prevalence never promotes a tier (§2).

**It also stays out of the ISO axis.** U7 is unspecified; `ACCESS_DIFFERS` must
not become an ISO violation, and mutation control **M4** already fails the suite
if it does.

---

## 10. Policy for ISO violations that a runtime tolerated

`MEMBER_MISSING` and `TYPE_MISMATCH` are ISO 4.9.2 errors (N4). If execution
ever proves a named runtime accepted such content:

```
strict:          basis ISO_4_9_2, finding unchanged, VIOLATED unchanged
compatibility:   { profile: 'blaxxun-contact',
                   classification: 'TOLERATED_VIOLATION',
                   tier: 'A3', evidence: [...] }
```

Three invariants:

1. The strict finding is **byte-identical** whether or not a profile is attached.
   Testable, and it should be tested exactly that way.
2. `TOLERATED_VIOLATION` and `EXTRA_STANDARD` stay separate values (§3.1).
3. Acceptance is **per profile version family**. "blaxxun Contact 5.0 accepted
   it" is not "blaxxun Contact accepted it" unless the evidence spans the family.

---

## 11. Required policy matrix

`D ev?` = does WD1.7-D produce a record for this today.
`Obs?` = observed in the corpus (Tier C).
`Accept proven?` = is there Tier A/B evidence that a **named** runtime accepts it.

| # | case | strict ISO fact | D ev? | Obs? | accept proven? | candidate classification | allowed today? | additional evidence required |
|---|---|---|---|---|---|---|---|---|
| 1 | exact interface agreement | conforming (4.9.2) | yes (`SATISFIED`) | yes | n/a | none — nothing to classify | **n/a**, `compatibility: null` | none |
| 2 | target **superset** | conforming (4.9.2, `local ⊆ target`) | yes (`SATISFIED`, `targetOnlyMemberCount`) | yes | n/a | none | **n/a**, `null` | none |
| 3 | `ACCESS_DIFFERS` (file target) | ISO **silent** (U7) | yes | yes (65/1,169, Tier C) | **no** | — | **NO** — stays `null` (§9) | A3 execution, or vendor doc addressing file targets |
| 4 | `MEMBER_MISSING` | **violated** (4.9.2 N4) | yes | yes (59/1,169, Tier C, upper bound) | **no** | would be `TOLERATED_VIOLATION` | **NO** — stays `null` | A3 execution against a file target |
| 5 | `TYPE_MISMATCH` | **violated** (4.9.2 N4) | yes | yes (2/1,169, Tier C) | **no** | would be `TOLERATED_VIOLATION` | **NO** — stays `null` | A3 execution |
| 6 | URN built-in: local interface ignored (**V1**) | ISO **silent** (4.9.1 permits the mechanism) | **no** — C never resolves a URN | yes (513/2,672 = 19.20%) | **YES, A1 ×2** | `EXTRA_STANDARD` | **YES**, but there is no D record to attach it to (§12) | none for the claim; a consumer for it |
| 7 | vendor extension node (**V4**: `BspGroup`, `Occlusion`, `Layer3D`, …) | ISO **silent** | no (containment/`UNSUPPORTED`) | yes, heavily | **YES, A1** | `EXTRA_STANDARD` | **YES** — a registry is defensible | per-node interface transcription |
| 8 | `ROUTE`/`PROTO` in an MFNode array (**V2**) | **violated** (A.2) | no — parser recovery, shipped | yes | **YES, A1 ×2** | `TOLERATED_VIOLATION` | **YES** — names a rule already shipped unnamed | none |
| 9 | `exposedField` in a `Script` node (**V3**) | **violated** (6.40) | no — WD.md §9 compatibility row | yes | **YES, A1** | `TOLERATED_VIOLATION` | **YES** | none |
| 10 | `IS` binding an `exposedField` (Table 4.4, P2B's 1,481) | **violated** (4.4) | no — P2B/WD1.6-D | yes (1,481) | **no** — vendor docs are silent; only a migration script's header asserts it | — | **NO** — stays `null` | A3 execution, or vendor doc |
| 11 | historically observed malformed syntax (digit-leading DEF, duplicate interface names) | **violated** (A.2 `Id`; 4.3.5) | no | yes | **no** | — | **NO** | A3 execution |
| 12 | unknown/unclassified deviation | varies | varies | varies | **no** | — | **NO** — `null` is the default and means NOT EVALUATED | — |

**Read row 6 against rows 3–5.** That is the whole finding: the one documented
EXTERNPROTO interface rule covers the reference form WRL Forge deliberately does
not resolve, and says nothing about the ones it does.

---

## 12. What E would actually deliver — the scope correction

WD1.7-E was chartered as the lane that classifies WD1.7-D's output. **The
evidence does not support that lane.** Rows 3–5 of §11 all stay `null`.

The evidence *does* support a different, real deliverable — rows 6–9 — and those
belong to `semantic-findings.js`, the parser's recovery path and a vendor
extension registry, **not** to `proto-agreement.js` or `src/proto-enrichment/`.

**Owner's refinement, ratified with D2 and binding on the implementation lane:**

> The profile contract may **document** V1–V5, but the implementation attaches
> compatibility **only where an existing structured semantic observation exactly
> maps to a documented behaviour.** A behaviour with no such observation stays in
> the evidence registry. No finding is invented to make a documented behaviour
> visible.

WD1.7-E1 found that to be **one of the five** — V3. See §7 of the E1 document.

Recommended shape:

- **E is renamed and rescoped** to a documented-vendor-behaviour profile over
  `semantic-findings.js`'s reserved slot, covering V1–V5.
- **WD1.7-D's records are left alone.** `enrichment.compatibility` stays `null`
  and its no-profile-identifier boundary test stays passing. That is not a
  deferral; it is the correct terminal answer on current evidence.
- Whether it keeps the label "WD1.7-E" is cosmetic. It is no longer an external
  PROTO lane, so a new number outside WD1.7 would describe it better.

---

## 13. Is runtime evidence required?

**For the recommended scope: no.** V1–V5 are A1, in two shipped generations.

**For rows 3–5 and 10: yes, and only execution will do it.** No documentation
addresses them.

Execution is **feasible and already largely built** — which is why this section
is specific rather than aspirational:

| requirement | status |
|---|---|
| implementation | blaxxun Contact **5.2** (`blaxxuncc3d.ocx`), verified rendering 2001 VRML |
| version family | 4.x–5.x; 5.3 installer also present (`servers-installs-bxfiles/blaxxunContact53.exe`) |
| acquisition | already local; installers carry a dated provenance record (`servers-installs-bxfiles/PROVENANCE-2026-08-14.md`) |
| host | the existing offline Windows guest that already runs it under IE |
| network | **must stay offline.** Fixtures served from the guest's own filesystem or a loopback stub — never the live internet |
| minimal fixture | four synthetic `.wrl` pairs (declaring file + target library), one each for exact agreement, member-missing, type-mismatch, access-differs; each drives an observable |
| observable acceptance criterion | the scene renders **and** a `Script` in the declaring file reports the instance responded on the disputed member — rendering alone proves only that the file parsed |
| provenance boundary | observations recorded as behavioural notes. **No binary redistributed, no decompilation, no code copied.** |

**Not performed.** E0's job was to decide whether it is needed, and it is —
for rows 3–5 and 10 only. It needs its own approved lane.

---

## 14. Constraints on a future E result shape

High-level only; no API is designed here.

**Required**

- `compatibility` stays a **single reserved slot**, `null` by default, `null`
  meaning **NOT EVALUATED** — not "no profile accepts this", not "strict VRML97".
- When non-null it must carry, at minimum: `profile` (an exact name),
  `classification` (`EXTRA_STANDARD` | `TOLERATED_VIOLATION`), `tier`
  (§2/§2.1), and `evidence[]` (citable, one entry per supporting artifact).
- It must remain answerable, from the record alone: *why was this classified*,
  *what runtime is claimed*, *what evidence proves it*, *what strict fact remains
  underneath*.
- Filling it must be **provably unable** to change `iso`, `rule`, `basis`,
  `status`, `reason` or `confidence`. A before/after byte-identity test is the
  right proof.

**Forbidden**

- `compatible: true`. No boolean, no `isCompatible()`, no coercion — three of the
  states are not booleans, exactly as `AGREEMENT_STATUS` already argues.
- A profile enum with speculative members. The enum holds names that are
  *earned*, and today that is one.
- Any severity, colour, message, ordering, suppression or save policy. **P4 owns
  presentation** (§15 of the lane brief, and WD1.6-D's standing rule).
- Deriving compatibility from prevalence, authorship or file path.

---

## 15. Terminology table

| term | recommendation | evidence |
|---|---|---|
| `Blaxxun/GLView` | **RETIRE** | no second behaviour exists; two `getName()` values of one family |
| "GLView compatibility" | **RETIRE** | product identity string, not a documented behaviour |
| "Blaxxun compatibility" (bare) | **RETIRE** | ambiguous across Contact and blaxxun3D, which behave oppositely (V6) |
| **`blaxxun-contact`** | **KEEP — adopt** | A1 in two shipped doc generations; contract in §6.1 |
| `blaxxun-3d` | **DEFER** | real and evidenced (V6), but a restriction profile with no consumer |
| "Cybertown compatibility" / `cybertown-compat` | **RETIRE** | Cybertown is content and packaging policy, not a runtime (§8) |
| "legacy VRML compatibility" | **RETIRE** | names no artifact, no version; unfalsifiable |
| `EXTRA_STANDARD` / `TOLERATED_VIOLATION` | **KEEP — adopt** | §3.1; the distinction remediation turns on |
| Tier `A`/`B`/`C`/`D` (§2) | **KEEP — adopt** | needed to keep prevalence out of verdicts |

---

## 16. Implement-E-now decision

**YES — a named profile is defensible (`blaxxun-contact`) — but NOT over
WD1.7-D's findings.**

- Rows 6–9 of §11 are ratifiable now and would be a genuine improvement: they
  attach evidence to three behaviours WRL Forge **already ships unnamed** (parser
  recovery, the Script `exposedField` warning, the URN mechanism).
- Rows 3–5 and 10 stay `compatibility: null`, permanently on current evidence,
  and unblock only via §13's execution lane.
- WD1.7-D therefore needs **no change at all** — which is the cheapest possible
  outcome and the correct one.

---

## 17. Owner decisions — RATIFIED 2026-08-29

Five. All five were ratified on **2026-08-29**; the recommended default was
adopted in every case. The `recommended` column is kept as the record of what was
proposed, and the `ratified` column records what was decided.

| # | decision | recommended | ratified |
|---|---|---|---|
| **D1** | Adopt `blaxxun-contact` (§6.1) as the one public profile name, and retire the rest (§15). | **Yes.** | **ADOPTED.** `blaxxun-3d` deferred; every other candidate retired. |
| **D2** | Accept the scope correction: E is rescoped to V1–V5 over `semantic-findings.js`, and WD1.7-D is left unchanged with `compatibility: null`. | **Yes.** | **ADOPTED**, with the §12 refinement above. |
| **D3** | **Publication.** This repository is public. May short, attributed sentences of blaxxun's proprietary documentation be quoted as evidence in a committed doc? | **Yes, with the quotes kept to single attributed sentences** — that is identification and analysis, and the profile is not falsifiable without them. If not, the doc must cite path + paraphrase only, and this file needs an edit before it is ever committed. | **DECLINED — paraphrase only.** Evidence paths + precise paraphrase are recorded; no verbatim vendor sentence is committed. This file was edited accordingly. See the publication note above §1. |
| **D4** | Record the newly permitted evidence roots under `OPEN_SOURCE_PROVENANCE.md` §4.1 *Research & Reference* (studied, nothing incorporated), and amend §3 to distinguish *reading* from *incorporating* for these trees — the S5 backlog item WD1.7-A recorded. | **Yes.** Owner's file; not edited here. | **ADOPTED.** Recorded in WD1.7-E1 as record **WD1.7-E0**. |
| **D5** | Authorize the offline runtime lane in §13 for rows 3–5 and 10. | **Defer.** It is the only path, but it is a whole lane and rows 3–5/10 are honest as `null` meanwhile. | **DEFERRED.** No Contact 5.2/5.3 execution and no runtime fixtures in E1. |

**Not requested and not recommended:** any decompilation, binary analysis, or new
reverse-engineering work. §13 is black-box execution of an already-installed
product, and nothing in this lane needs more than that.

---

## 18. What this lane changed in the record

- **WD1.7-A DECISION-1 second half is superseded.** Its recommendation stands on
  the slash; its "no profile is nameable" conclusion was correct for A's evidence
  boundary and is no longer correct for this one.
- **WD1.7-A §4.2's verdict is refined, not overturned.** A concluded Root B held
  "essentially no usable technical evidence" because the *Community Server
  binaries* never resolved an EXTERNPROTO. That is still true. The evidence
  found here is not in the binaries — it is in the **documentation and installers
  shipped alongside them**, which A's boundary did not permit opening.
- **WD.md §9's table can be re-sourced.** Rows 1 and 3 ("parser recovery",
  "compatibility profile") now have a named, citable vendor artifact behind them
  rather than an unnamed disposition. That is a documentation change for the
  rescoped lane, not for E0.

---

## 19. Reproducing this lane's evidence

Read-only, no extraction, no execution:

```bash
R=~/Projects/cybertown/blaxxun-cs-RE

# V1, V2, V4 -- CS 7.0 generation
sed -e 's/<[^>]*>//g' "$R/install-7.0/csadmin/doc/3dauthoring/3dextensions2.html"

# V1, V2, V4 -- VWP 5.1 generation, same sentences
sed -e 's/<[^>]*>//g' "$R/install/blaxxun interactive/Virtual Worlds Platform/csadmin/doc/reference/3dauthoring9.html"

# V3, V5
sed -e 's/<[^>]*>//g' "$R/install-7.0/csadmin/doc/3dauthoring/3dscripting7.html"

# V6
sed -e 's/<[^>]*>//g' "$R/install-7.0/csadmin/doc/3dauthoring/3ddesignrules13.html"
sed -e 's/<[^>]*>//g' "$R/install-7.0/csadmin/doc/3dauthoring/3dextensions3.html"

# V4 registry
rg -o --text 'urn:inet:blaxxun\.com:node:[A-Za-z0-9_]+' \
   "$R/install/blaxxun interactive/Virtual Worlds Platform/csadmin/doc" \
   "$R/install-7.0/csadmin/doc" | sed 's/.*node://' | sort -u
```

Corpus figures are **not** re-measured here; they are quoted from WD1.7-A with
their denominators, and every one of them is Tier C.
