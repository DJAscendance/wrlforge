# WD1.7-E1 — the `blaxxun-contact` compatibility profile

**As built.** The lane that fills the third axis WD1.6-D reserved.

**Predecessor:** [`WD1_7_E_COMPATIBILITY_POLICY_DECISION.md`](WD1_7_E_COMPATIBILITY_POLICY_DECISION.md)
(WD1.7-E0), **ratified by the owner on 2026-08-29**.
**Production baseline:** WD1.7-D CLOSED (`75fd303`).
**Status:** implemented, **uncommitted**, awaiting independent QA.

**WD1.7-D is unchanged.** Not deferred — *finished*. `ACCESS_DIFFERS`,
`MEMBER_MISSING` and `TYPE_MISMATCH` against an ordinary `.wrl` target remain
`compatibility: null`, and that is the correct terminal answer on current
evidence, not a gap this lane failed to close.

---

## 1. What this lane is, in one paragraph

WD1.6-D built a structured semantic finding with two axes that must never merge —
`iso` (what the standard says) and `confidence` (how sure the substrate is it read
the construct correctly) — and reserved a **third**, always `null`, for a question
it declined to guess at: *is there evidence that a named implementation accepts
this?* WD1.7-E0 opened the vendor's own shipped documentation and found the answer
for a bounded set of behaviours. This lane records that evidence in a closed
registry and attaches it to the findings it exactly explains.

It attaches it to **one**. That is the honest result, and §7 is the whole of it.

---

## 2. Owner-ratified decisions this lane implements

| # | decision | as implemented |
|---|---|---|
| **D1** | Adopt `blaxxun-contact` as the one earned public profile name. | `COMPATIBILITY_PROFILE` has exactly one member. `blaxxun-3d` is **deferred** (real, evidenced, no consumer); `Blaxxun/GLView`, `glview`, bare `blaxxun`, `cybertown-compat`, `legacy-vrml` and `legacy-cybertown` are **retired** and asserted absent by test. |
| **D2** | E is rescoped. WD1.7-D is left alone. | `src/vrml/proto-agreement.js` and `src/proto-enrichment/` are **untouched**. A dedicated regression suite proves the three D findings stay `null`. |
| **D3** | Evidence paths + precise paraphrase. No verbatim proprietary sentences in a public repository. | The E0 document was edited: every vendor-manual quotation is now a paraphrase with attribution, generation, reference-root-relative path and tier. `compatibility.js` stores paraphrases only. |
| **D4** | Record the authorized evidence roots under *Research & Reference*. | `OPEN_SOURCE_PROVENANCE.md` §3 now distinguishes **reading** from **incorporating**, and §4.1 carries record **WD1.7-E0** stating the boundary explicitly. |
| **D5** | Defer the runtime lane. | **No** execution of `blaxxun Contact` 5.2 or 5.3, and **no** runtime fixtures. No claim in this lane carries the executed (`a3`) tier. |

---

## 3. The module

`src/vrml/compatibility.js` — pure, browser-safe, **consumer-free**.

It requires exactly two modules (`./semantic-findings`, `./scope-graph`) and
nothing else. No `fs`, no `path`, no `zlib`, no `crypto`, no network, no
`__dirname`. It is **not** published on `src/vrml/index.js`, exactly as
WD1.5-P1, P2A, P2B, P2C and WD1.7-D each landed internal first — so no production
code path can have started depending on a profile name inside this lane.

It owns: profile identifiers, behaviour identifiers, classifications, evidence
tiers, evidence metadata, and the mapping from an existing semantic observation to
an earned record. It owns **no** parsing, type resolution, PROTO resolution, target
selection, class derivation, UI severity, filesystem access or runtime detection.

---

## 4. The profile contract

`blaxxun-contact` answers the five questions a public profile must:

| question | answer |
|---|---|
| **What artifact defines it?** | blaxxun interactive's shipped *3D Authoring* documentation, as published with **Virtual Worlds Platform 5.1** and **Community Server 7.0**. |
| **What version/family?** | **blaxxun Contact 3D, 4.x–5.x.** It does *not* cover the vendor's Java applet client (a stricter-than-ISO subset that supports no PROTO, EXTERNPROTO or Script at all), and it does *not* cover the successor product shipped under different ownership. |
| **What behaviours belong to it?** | Exactly the five in §6. A closed list, extended only by adding evidence. |
| **What evidence supports them?** | One paraphrased rule per behaviour, at a cited reference-root-relative path, in a named product generation. |
| **What would falsify membership?** | **Absence** of a statement in that documentation set. Additionally, a recorded execution result that contradicts a documented statement supersedes it. |

**Inclusion rule, stated so it can be tested:** a behaviour enters the profile if
and only if a citable normative statement in the named documentation set describes
the runtime accepting or defining it. Prevalence, authorship and plausibility grant
no membership.

---

## 5. Evidence tiers, and why prevalence is not one

| tier | value | may support a named claim alone? |
|---|---|---|
| `VENDOR_DOCUMENTED` | `a` | **Yes** |
| `HISTORICAL_OPERATIONAL` | `b` | only with explicit qualification |
| `CORPUS_OBSERVED` | `c` | **No** |
| `INFERRED` | `d` | **No** |

Sub-tiers inside A: `a1` documented · `a2` vendor-authored content · `a3` executed.

Two rules make the tiers load-bearing:

1. **A tier belongs to one behaviour claim, not to a source.** A document is Tier A
   for a rule it states and *no evidence at all* for a rule it does not mention.
   Section 7 turns entirely on this.
2. **Prevalence never promotes a tier.** A construct observed 46,945 times is
   `CORPUS_OBSERVED` at 46,945 exactly as surely as it is at 1.

**Every registered behaviour is `a1`. None is `a3`.** Nothing here has been
reproduced by running the product, and the vendor's own authoring guide hedges its
extension-node support in writing — which is exactly why documented must not be
presented as executed. That rule is enforced at **module load**: a registry entry
whose tier is not `VENDOR_DOCUMENTED` makes the module throw, so a table weakened
to Tier C cannot ship even if a test were deleted.

---

## 6. Classification — two kinds of claim, never one bucket

| value | meaning | remediation message |
|---|---|---|
| `EXTRA_STANDARD` | ISO is **silent**; the vendor defined something in the space ISO left open. | "portable only on this runtime" |
| `TOLERATED_VIOLATION` | ISO **forbids** it; the named runtime accepted it anyway. | "a defect one runtime forgave" |

Collapsing them into one `legacy-compatible` label would destroy the only
distinction an author's decision turns on.

**`TOLERATED_VIOLATION` does not downgrade anything.** It is not "treat this error
as a warning". The strict finding underneath is byte-for-byte what it was.

---

## 7. The behaviour registry, and what each one maps to

The critical distinction this lane rests on, and the owner's ratified refinement:

> The profile contract may **document** V1–V5, but the implementation attaches
> compatibility **only where an existing structured semantic observation exactly
> maps to a documented behaviour.**

| id | behaviour | class | tier | current WRL Forge observation | state |
|---|---|---|---|---|---|
| **V1** | `urn-native-node-interface-override` — a built-in reached through the vendor URN scheme is instantiated with the **native** node's interface; the declared EXTERNPROTO interface is not the one used. | `EXTRA_STANDARD` | `a1` ×2 generations | **none.** `src/external-proto/reference-forms.js` classifies `urn:` as not retrievable, so WD1.7-C never selects a URN target and WD1.7-D never produces an agreement record for one. | **registry-only** |
| **V2** | `node-value-position-statements` — `PROTO`, `EXTERNPROTO` and `ROUTE` accepted in every node-value position, including inside an MFNode array. | `TOLERATED_VIOLATION` | `a1` ×2 generations | **none.** `parser.js`'s array reader delegates to the ordinary handlers and emits **no diagnostic and no finding at all**. | **registry-only** — see §8 |
| **V3** | `script-interface-exposed-field` — an `exposedField` accepted in a `Script` node's interface. | `TOLERATED_VIOLATION` | `a1` | **exact.** `FINDING_CODE.INTERFACE_DECLARATION_NONCONFORMING` + `REASON.EXPOSED_FIELD_IN_SCRIPT_INTERFACE`, emitted only for a Script body. | **IMPLEMENTED** |
| **V4** | `urn-native-extension-nodes` — a registry of 25 native extension node types addressable through the vendor URN scheme. | `EXTRA_STANDARD` | `a1` | **none** carrying URN + extension-node identity together. | **registry-only** |
| **V5** | `create-vrml-from-string-top-level-protos` — `Browser.createVrmlFromString` resolves PROTO declarations from the top-level file. | `TOLERATED_VIOLATION` | `a1` | **none.** A runtime API behaviour with no static-source counterpart; WRL Forge models no browser API. | **registry-only** |

**Registry-only is a successful outcome, not a stub.** The evidence for all four is
fully recorded and queryable through `behaviorEvidence()`; what is absent is a
fabricated finding to display it. Manufacturing an observation so a documented
behaviour becomes visible would invert the relationship — the evidence exists to
*explain* observations, not to generate them.

**V4 blesses no bare node name.** The documented capability is the URN *mechanism*.
A document that writes `BspTree` directly has not used it, and `compatibility.js`
never consults the 25-name list to classify a node. A mutation that makes it do so
is control **M6**.

---

## 8. Why V2 is registry-only, stated plainly

V2 is the one case where a reasonable reader would expect an implementation, so
the reasoning is recorded rather than left to inference.

WRL Forge **already ships** the lenient behaviour: `parser.js` accepts `ROUTE`,
`PROTO` and `EXTERNPROTO` inside an MFNode array by delegating to the same handlers
used in a node body. It does so **silently** — no diagnostic code, no advisory, no
semantic finding. There is nothing to attach evidence to.

Creating something to attach it to would mean minting a new `FINDING_CODE` and a
new `REASON` in the substrate, and then emitting a new `PROHIBITED` finding for
**every document in the corpus** that uses the construct. That is a material change
to what WD1.6-D reports, on a closed lane, with no corpus measurement in this lane
to characterize it. It is a real and defensible piece of work — the construct
genuinely is non-conforming under Annex A.2, and `WD.md` §9 already names it — but
it is **its own lane, with its own corpus evidence**, not a side effect of
recording a vendor citation.

Marking the parser's existing recovery findings instead would be
compatibility-by-proximity: the recovery path is shared with unrelated failures,
and a profile that swept them all in would be asserting something the vendor
documentation does not say. That mutation is control **M5**.

---

## 9. The result model

```js
{
  profile:        'blaxxun-contact',
  behavior:       'script-interface-exposed-field',
  classification: 'tolerated-violation',
  tier:           'a',            // VENDOR_DOCUMENTED
  subtier:        'a1',           // documented, NOT executed
  detail:         null,
  evidence: [ {
    vendor:     'blaxxun interactive',
    product:    'blaxxun Contact 3D',
    generation: 'Community Server 7.0',
    kind:       'vendor-documentation',
    subtier:    'a1',
    root:       'blaxxun-cs-RE',            // a KEY, never a host path
    path:       'install-7.0/csadmin/doc/3dauthoring/3dscripting7.html',
    claim:      '<WRL Forge’s own paraphrase of the documented rule>',
  } ],
}
```

**There is no boolean.** `compatible: true` cannot express "ISO forbids it and this
runtime took it anyway", which is the state that matters most — the same argument
`AGREEMENT_STATUS` already makes for WD1.7-D. No `isCompatible()`, no coercion.
Control **M8** proves the key set is exactly the seven above.

**`null` still means NOT EVALUATED.** Not "strict VRML97", not "no runtime accepts
this", not "incompatible", not "unknown browser". Most findings are `null` and will
stay `null`.

**No presentation.** No severity, message, colour, ordering, suppression, save
policy or recommendation appears on a record or in the module. **P4 owns
presentation** and exists so it can decide those from facts.

**No runtime detection.** Nothing reads `Browser.getName()`, a user agent, an
ActiveX registration or a platform. The profile describes documented evidence about
an implementation; it is not sniffed from whatever the user is running. `GLView`
stays retired as a compatibility profile name.

---

## 10. How the single finding-construction authority survived

`semantic-findings.js` gained exactly one function, `attachCompatibility(source,
attachment)`. It re-emits the caller's own strict fields **verbatim** through
`createFinding`, the module's one constructor, and has **no parameter** through
which `code`, `subject`, `range`, `iso`, `rule`, `confidence`, `reason`, `detail`
or `evidence` could be supplied. A caller wanting a different ISO result would
still have to change `ISO_BY_REASON` — which is the property WD1.6-D bought.

`compatibility.js` therefore supplies only the opaque slot value. It does not know
how to build a finding, and `semantic-findings.js` does not know what a profile is:
the dependency runs one way, and neither file names anything from the other's
domain. The existing WD1.6-D posture tests, which scan `semantic-findings.js` and
`src/vrml/index.js` for any profile identifier, pass **unmodified**.

Attaching returns a **new frozen record**; the caller's finding is never mutated.
When nothing is earned, the input is handed back unchanged.

---

## 11. Proof that compatibility cannot alter a strict fact

For the one implemented mapping, the projected finding is compared to the strict
one field by field:

- `code`, `iso`, `confidence`, `reason`, `detail` — equal by value.
- `subject`, `range`, `rule` — **the same objects**, by identity.
- `evidence` — deep-equal, and a *fresh frozen array*: the one constructor hands
  every finding its own copy, so two findings can never share a mutable array.
- The full key sets are identical, and the only members that differ are
  `compatibility` and that fresh `evidence` array.

`iso` is `PROHIBITED` before and `PROHIBITED` after. The runtime accepted it; the
standard still forbids it; the finding still says so.

---

## 12. The WD1.7-D gate

`test/proto-enrichment/compatibility-null.test.js` runs the **real** enrichment
pipeline over ordinary `.wrl` targets and asserts:

| WD1.7-D finding | strict basis | strict status | `compatibility` |
|---|---|---|---|
| `MEMBER_MISSING` | `iso-4.9.2` | `violated` | **`null`** |
| `TYPE_MISMATCH` | `iso-4.9.2` | `violated` | **`null`** |
| `ACCESS_DIFFERS` | `not-specified-by-iso-4.9.2` | `satisfied` | **`null`** |
| conforming target | — | `satisfied` | **`null`** |

It also asserts the two ways this could quietly stop being true:

- **V1 must not leak.** The URN rule is registered, classified `EXTRA_STANDARD`,
  and confirmed to be in the registry-only set with no route to a D record. It
  covers URN references; WD1.7-D only ever reports on file targets. The one
  documented rule that speaks directly to external-prototype interfaces applies
  exactly and only where there is no finding to attach it to.
- **Prevalence must not become evidence.** The corpus figures (5.56% access drift,
  59 missing members) are Tier C and classify nothing.

Structurally, a WD1.7-D finding carries no `reason` field at all, so the registry
lookup cannot hit one even by accident — asserted, not assumed.

---

## 13. Mutation controls

Each takes the real production source, applies one targeted defect (every anchor
matching **exactly once**), loads the mutant from the OS temp directory with
relative requires rewritten, and proves the defect changes the answer the
production suite asserts.

| # | defect | observed |
|---|---|---|
| **M1** | a `CORPUS_OBSERVED` entry enters the registry | module **throws at load** — the table cannot be constructed |
| **M2** | the URN rule classifies a file-target `ACCESS_DIFFERS` | mutant returns the URN record; production returns `null` |
| **M3** | attaching compatibility rewrites `iso`/`rule` | mutant yields `not-stated`/`null`; production yields `prohibited` |
| **M3b** | attaching rewrites `reason`/`confidence` | mutant yields `ok`/`recovered`; production carries both verbatim |
| **M4** | a second construction path downgrades a tolerated violation | mutant yields `iso: 'not-stated'`; production has no such path |
| **M5** | all parser recovery swept under V2 | mutant classifies every finding in the fixture; production classifies none |
| **M6** | the V4 registry blesses an unknown node name | mutant classifies `NotAKnownNodeType`; production returns `null` |
| **M7** | `blaxxun-3d` / `glview` added to the public registry | mutant exposes three profiles; production exposes one |
| **M8** | the record collapses to `compatible: true` | mutant grows the key; production's key set is exact |

---

## 14. What this lane did **not** do

- No change to `src/vrml/proto-agreement.js` or `src/proto-enrichment/`.
- No new finding, diagnostic or reason anywhere in the substrate.
- No URN made retrievable; no WD1.7-B or WD1.7-C routing semantics touched.
- No `blaxxun Contact` executed; no runtime fixtures; no `a3` claim.
- No World Project wiring; no P4; no WD2.
- No runtime dependency. `dependencies` is still `["x_ite"]`.
- No stale-doc cleanup. `WD.md` §9's table can now be re-sourced against a named,
  citable vendor artifact for its "parser recovery" and "compatibility profile"
  rows — deliberately **left for its own pass**, since `WD.md` is a
  project-instruction file.

---

## 15. Open and deferred

| item | why it is open |
|---|---|
| **The A3 runtime lane** | The only path to classifying `ACCESS_DIFFERS`, `MEMBER_MISSING`, `TYPE_MISMATCH` and P2B's 1,481 Table 4.4 violations. Black-box execution of an already-installed `blaxxun Contact` against synthetic fixtures, offline. Needs its own authorization (WD1.7-E0 §13, D5 deferred). |
| **V2 as a semantic finding** | Defensible and real (§8), but it changes WD1.6-D's output corpus-wide and needs its own corpus measurement. |
| **`blaxxun-3d`** | Real and evidenced, a *restriction* profile rather than a tolerance one, with no WRL Forge consumer. Deferred, not rejected. |
| **A consumer** | Like every predecessor lane, E1 is consumer-free. Nothing calls `withCompatibility()` in production yet; P4 is where that decision belongs. |
| **Post-C World Project consumer** | Unchanged from WD1.7-C/D, and unaffected by this lane. |
| **`WD.md` §9 re-sourcing** | Named above; its own pass. |
