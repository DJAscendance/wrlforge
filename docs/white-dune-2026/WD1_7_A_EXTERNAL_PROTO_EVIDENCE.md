# WD1.7-A — External PROTO resolution: evidence and resolver contract

**Status:** recon + design gate, **independent QA PASS, ratified and closed.**
No production code changed by this lane.
**Predecessor:** WD1.6 COMPLETE (`3cfbdba`, A→B→C→D).
**Deliverable:** the evidence, standards boundary, dependency model, provenance
model and proposed API that a later WD1.7 implementation lane can safely build on.
**Next lane:** WD1.7-B — external PROTO retrieval substrate (§16).

**Two binding contract corrections were folded in after independent QA**, and
they supersede any earlier reading of this document:

- **F1 — traversal recursion identity is a tuple**, `(decodedContentHash,
  selectedProtoName)`, **not** a content hash alone. Content alone reports a
  false cycle when one library serves two prototypes. → **§10.1**
- **F2 — archive mapping is origin/prefix-aware**, never a host-stripped search
  of one generic root. Distinct origins are distinct namespaces; an unmapped
  origin fails closed. → **§15.1**, with **§15.2** (equivalent content does not
  erase retrieval provenance) and **§15.3** (candidate fallback order).

Read `WD.md` §7 (identity hard gate), §8.1 (4.9.2 asymmetry), §9 (standards-first)
and `OPEN_SOURCE_PROVENANCE.md` §3/§6 (evidence boundary) before this document.

---

## 1. The one-sentence result

VRML97 already specifies external prototype resolution far more completely than
this project had assumed — ISO 4.9.3 settles target selection, 4.9.2 settles
interface verification and its *direction*, and 4.5.2/4.5.3 settle candidate
order and base-document choice — so the open questions in WD1.7 are almost
entirely about **retrieval, ambiguity and provenance**, which ISO does not
address at all, and **not** about semantics, which it does.

That split is the architecture. Retrieval is configuration-driven, fallible and
must fail closed. Semantics is already owned by P2A/P2B/P2C and WD1.6-B/C/D and
must not be re-implemented.

---

## 2. Evidence classes used in this document

| label | meaning |
|---|---|
| **FACT-ISO** | proven from the repository's ISO/IEC 14772-1 mirror, clause cited |
| **FACT-CORPUS** | measured by the committed harness, numerator + denominator given |
| **FACT-IMPL** | proven from historical implementation/tooling evidence |
| **FACT-CODE** | proven from WRL Forge's own source, by execution not by reading comments |
| **INFERENCE** | reasoned from the above; labelled, never presented as measured |
| **PROPOSED** | design put forward for owner ratification |
| **DECISION** | owner decision required before implementation |
| **DEFERRED** | recorded, deliberately not resolved in this lane |

---

## 3. The normative EXTERNPROTO model (Question A)

Every row below was read from
`~/Projects/cybertown/wb-ct-scrape/specs/iso-14772-vrml97/markdown/part1/`.

### 3.1 What ISO settles

| # | clause | fact | confidence |
|---|---|---|---|
| N1 | 4.9.1 | EXTERNPROTO "is equivalent to the PROTO statement" bar two things: the implementation is external, and no local defaults are given. | FACT-ISO |
| N2 | 4.9.1 | The implementation may live in a VRML file with an appropriate PROTO **or "using some other implementation-dependent mechanism"**. A non-file reference is therefore *conforming*, not an error. | FACT-ISO |
| N3 | 4.9.2 | The local interface's names and types "shall be a **subset** of those defined in the implementation." | FACT-ISO |
| N4 | 4.9.2 | Declaring a member with a **non-matching name** is an error; declaring one with a matching name but **different type** is an error. | FACT-ISO |
| N5 | 4.9.2 | Until the definition loads, exposedField initial values come from (1) the instantiation, else (2) the field type's default. eventOuts start at the type default. | FACT-ISO |
| N6 | 4.9.2 | Events sent to an instance **may be ignored** until the implementation is found. | FACT-ISO |
| N7 | 4.9.3 | Multiple URL strings are searched "in the order of preference" per 4.5.2. | FACT-ISO |
| N8 | 4.9.3 | When a URL refers to a VRML file, **"the first PROTO statement found in the VRML file (excluding EXTERNPROTOs)"** defines the prototype. The target's name need not match the EXTERNPROTO's name. | FACT-ISO |
| N9 | 4.9.3 | Results are **undefined** if a URL refers to a non-VRML file. | FACT-ISO |
| N10 | 4.9.3 | Browsers **shall** recognise a URL ending `#name` as selecting the PROTO named `name` in that file. | FACT-ISO |
| N11 | 4.5.2 | `url` is MFString; entries are "multiple locations to search in **decreasing order of preference**"; try each until one yields interpretable data. | FACT-ISO |
| N12 | 4.5.3 | The base document for an EXTERNPROTO is: (1) **the file in which the prototype is instantiated**, if the statement is part of a prototype definition; (2) the file containing the script, for `createVrmlFrom*`; (3) otherwise the file the statement was read from. | FACT-ISO |
| N13 | 4.8.4 | A PROTO establishes a DEF/USE scope separate from the scene and from nested PROTOs — **disjointness, both directions**. Nested PROTOs are local to the encloser. | FACT-ISO |
| N14 | 4.8.4 | "A prototype may not be instantiated inside its own implementation (i.e. recursive prototypes are illegal)." | FACT-ISO |
| N15 | 4.3.7 / A.2 | Grammar: `EXTERNPROTO nodeTypeId [ externInterfaceDeclarations ] URLList`. Brackets optional for a single URL. No `IS` form in an extern interface declaration. | FACT-ISO |

**N8 and N12 are the two rules most likely to be got wrong, and both are load-bearing.**

N8's parenthesis is not decoration. `3d/externprotos/bxx/shared.wrl` — the single
most-referenced library in the Cybertown corpus — opens with `EXTERNPROTO HUD`
at line 7 and only then declares `PROTO BlaxxunZone` at line 16. A resolver that
selected "the first prototype statement" would bind a fragment-less reference to
**HUD**; ISO binds it to **BlaxxunZone**. Control `C4` in the harness pins this
exact shape.

N12 means an EXTERNPROTO written *inside a PROTO body* does not resolve against
the file it is written in — it resolves against the file where the enclosing
prototype is **instantiated**. That is a per-instantiation base, not a
per-document one, so a resolver keyed only on "the document that declared it" is
wrong for that case. It is also unmeasurable without instantiation context, which
is why §8 proposes the base document be a **required explicit input** rather than
something the resolver infers.

### 3.2 What ISO does **not** specify

Each of these is `NOT SPECIFIED BY ISO`. Inventing a rule for one and presenting
it as standard behaviour is the §9 failure mode.

| # | question | status |
|---|---|---|
| U1 | Any filesystem or archive lookup. ISO speaks of URLs and browsers, never of roots, directories or archives. | NOT SPECIFIED |
| U2 | **gzip compression.** The string `gzip` does not occur anywhere in Part 1. 4.5.1 names only `.wrl`, `model/vrml` and `x-world/x-vrml`. Compressed VRML is universal practice and entirely extra-standard. | NOT SPECIFIED |
| U3 | Case sensitivity of URL resolution. | NOT SPECIFIED (a URL/filesystem property, not a VRML one) |
| U4 | What "interpretable data" means precisely in 4.5.2 — how hard a browser must try before moving to the next candidate. | NOT SPECIFIED |
| U5 | Ambiguity. ISO assumes a URL denotes one resource; it has nothing to say about two archive roots offering different bytes for one URL. | NOT SPECIFIED |
| U6 | Whether N14's recursion prohibition extends across files through EXTERNPROTO chains. N1's "equivalent to PROTO" makes the extension a reasonable reading, but ISO does not state it. | NOT SPECIFIED — **INFERENCE only** |
| U7 | Whether an access-category difference (`field` vs `exposedField`) between the local declaration and the target violates 4.9.2. The clause names "names and types" and is silent on access. | NOT SPECIFIED |
| U8 | Timeout, retry, or failure behaviour for an unreachable URL. 4.5.2 says only that the node type defines the default behaviour when no URL is interpretable. | NOT SPECIFIED |

U7 matters more than it looks. WD1.6-B/P2B already proved that **1,481** corpus
`IS` statements violate Table 4.4 on the `exposedField` axis; the same
authoring habit plausibly produces access drift between an EXTERNPROTO and its
target. The harness therefore reports access differences as **their own outcome**,
never folded into "mismatch" — folding them in would be WRL Forge inventing U7's
answer and then measuring its own invention.

---

## 4. Evidence-root boundary (lane brief §6)

### 4.1 Root A — `wb-ct-scrape/blaxxun-proto-modifications`

| question | answer |
|---|---|
| inspected? | **Yes**, read-only. |
| what it is | A **derived search-report package** generated `2026-08-29T12:46:31Z` by its own committed `search_repo.sh` over `wb-ct-scrape`. |
| provenance | Self-describing: `README.md`, `KEY_REFERENCES.md`, `SEARCH_METADATA.txt`. States "original archive files were not changed or copied". |
| redistribution | Reports are derived text over an existing workspace archive. The **underlying** VRML content is period Cybertown/blaxxun material of unestablished per-file licence. |
| PII / security | None observed in the reports consulted. |
| usable evidence | **Yes, high value.** It is a pointer index, not new material — it told this lane where to look, and every claim below was then verified against the primary file. |

Root A's own stated limit is adopted here verbatim: *"A matching line is evidence
of a textual reference, not proof that the referenced PROTO resolves."*

### 4.2 Root B — `blaxxun-cs-RE/re-artifacts`

| question | answer |
|---|---|
| inspected? | **Bounded listing-level inspection only.** No decompilation output, credential file, log, or member-data file was opened. |
| boundary rules found | Three, all pre-existing: (a) `OPEN_SOURCE_PROVENANCE.md` §3 — reverse-engineering artifacts of proprietary tools (`RE-ARTIFACTS`, `blaxxun-cs-RE`) are **implementation-prohibited**; (b) the workspace `CLAUDE.md` — the tree **must not be pushed to GitHub or any host** until identifying information is scrubbed; (c) the tree's own `README.md` — *"license terms prohibit reverse engineering — this corpus is for personal preservation/interoperability of defunct software"*, and `FEATURE-MAP.md` — *"Do not distribute the binaries."* |
| provenance | A copy of a live blaxxun Community Server / VWP 5.1 install pulled from a libvirt guest on 2026-07-13, plus Ghidra decompilation output for 4.0 / 4.1 / 7.0. |
| redistribution | **Not established, and presumed prohibited.** |
| PII / security | **Yes.** `etc/license`, `access.key`, ISAM member data files, `idserver` login/crypto decompilation, `id-strings.tsv`, a repo-level `.env.local`, and a machine/IP-identifying README. None was opened. |
| usable technical evidence for **this** question | **Essentially none, for a structural reason.** |

That last row is the finding, not an evasion. **EXTERNPROTO resolution is a
VRML *browser* behaviour.** Root B is the blaxxun **Community Server** — the
multiuser presence/chat/identity backend (`idserver`, `mnserver`, `txserver`,
`soserver`, …). Its binaries never resolve an EXTERNPROTO; the client did. The
38 `.wrl` files inside Root B are *shipped product content*, and are a strict
subset in kind of what Root A already indexes under a cleaner boundary.

**Verdict: not blocked, and no boundary was bypassed.** The lane did not need
Root B's restricted material and did not consume it. The committed harness is
*structurally unable* to read it: `spikes/wd1-route-semantics/corpus.js` inherits
WD1.4's `FORBIDDEN_MARKERS` guard, which **throws** — never skips — on any path
containing `blaxxun-cs-RE`, `RE-ARTIFACTS` or `white-dune`. Control **C1** asserts
that guard is live on all three markers independently, so a future edit that
weakened it fails the run rather than quietly widening the boundary.

### 4.3 A third tree the brief did not name

`blaxxun-cs-RE/modeling-tools/RE-ARTIFACTS/` is a **different** tree from Root B
and carries its own explicit rule, in its own first paragraph:

> *"This document is the single file in `RE-ARTIFACTS/` that a future WRLForge
> agent may read for guidance."* — `SAFE_WRLFORGE_RESEARCH_HANDOFF.md`

That rule was honoured: only that file was read, and only its index and the
EXTERNPROTO-relevant lines. It contributed one requirement (§2.12: *"MUST support
EXTERNPROTO references to vendor libraries"*, *"SHOULD ship a registry of known
vendor libraries"*) and one caution — it is **stale on licensing**, describing
WRL Forge as MIT (§1.3, §8.1). WRL Forge has been `GPL-3.0-or-later` since
OSS-1 (`2eb7c39`). Its licensing sections must not be relied on.

The same directory also holds a **FreeWRL** checkout (`modeling-tools/freewrl-git`)
— a GPL VRML97 browser with a real EXTERNPROTO resolver, and the single most
relevant open-source comparison available locally. It was **not** read: it sits
under a path marker that `OPEN_SOURCE_PROVENANCE.md` §3 declares
implementation-prohibited, and reuse from that location would be indefensible on
provenance even though FreeWRL itself is GPL. See **DECISION-4**.

---

## 5. Historical behaviour inventory (Question B)

Every row was verified against the primary file, not against Root A's index alone.
No public compatibility profile is named here — that is WD1.7-D's job at the
earliest, and §19 of the lane brief forbids it now.

| # | behaviour | evidence | ISO relationship | likely classification | confidence |
|---|---|---|---|---|---|
| H1 | Absolute `http://www.cybertown.com/externprotos/bxx/shared.wrl#ProtoName` as the standard library reference | `3d/home/0108000000000000/property/vrml/000/home.wrl:22`; **41.73%** of all candidates | **Conforming.** 4.9.3 + 4.5.3 + N10. | strict VRML97; a *retrieval* problem only because the host is gone | high |
| H2 | `urn:inet:blaxxun.com:node:HUD` as **first** candidate, with an `http://…/nodes.wrl#HUD` fallback second | `3d/externprotos/bxx/shared.wrl:14` | **Conforming.** N2's "other implementation-dependent mechanism" + N11's ordered fallback. | vendor-specific *naming* of a built-in, inside a conforming URL list | high |
| H3 | `HUD` is a blaxxun browser built-in ("built-in with Contact 4.0 or higher" — the file's own comment) with no ISO equivalent | ibid. line 6; `scripts/add_hud_shim.py` | Extension node. ISO neither defines nor forbids it. | vendor extension node | high |
| H4 | `BlaxxunZone`, `SharedEvent`, `SharedObject`, `SharedObjectEvent` are **ordinary PROTOs**, not browser built-ins | `3d/externprotos/bxx/shared.wrl:16,86,192,406` | Fully conforming VRML97. | authored content, not a compatibility item | high |
| H5 | A library whose **first statement is an EXTERNPROTO**, so 4.9.3's exclusion clause decides fragment-less selection | ibid. lines 7 vs 16 | Conforming; exercises N8 precisely. | strict VRML97 (a resolver-correctness trap, not a vendor quirk) | high |
| H6 | gzip-compressed payload served under a plain `.wrl` name | `scripts/resolve_vrml_deps.py`: *"decompresses gzip-compressed .wrl (blaxxun serves them that way regardless of name)"*; corpus measurement §6 Q7 | **NOT SPECIFIED BY ISO** (U2). | server/transport convention, universal in this corpus | high |
| H7 | Dead external host: `EXTERNPROTO Bot` → `http://www.colonycity.com/…/mcp.wrl#Bot`; X_ITE *blocks forever* on the fetch | `scripts/fix_outlands.py` header | Conforming reference; U8 (failure behaviour) unspecified. | archive-era decay + a live argument against network retrieval | high |
| H8 | `field SFString linkURL IS url` where the interface declares `exposedField` — blaxxun accepted it, X_ITE rejects the **whole file** | `scripts/convert_vrml_compat.py` header | Violates Table 4.4 (P2B: **1,481** corpus instances, 99.6% the `exposedField` column) | already-adjudicated compatibility item; **not** an EXTERNPROTO behaviour | high |
| H9 | Duplicate PROTO interface field names (`numberOfChoices` declared 10× in one interface) | `scripts/convert_shared_site.py` header | Violates 4.3.5 uniqueness | authoring defect, repaired by a migration tool | high |
| H10 | DEF names beginning with a digit (`1c`, `2c`, …) | ibid. | Violates the A.2 `Id` production | authoring defect | high |
| H11 | Case-insensitive matching needed to resolve archived references | `scripts/resolve_vrml_deps.py`: *"matches case-insensitively, because Wayback preserves case the HTML does not"* | U3 — not a VRML question | **archive/recovery tooling convention**, emphatically not a language rule | high |
| H12 | "Shared roots" fallback when a reference resolves above any individual world | ibid. | Not a standards behaviour at all | migration heuristic — see §11 | high |

**H8 deserves emphasis because it is the most likely thing to be misfiled.** It is
an `IS`/Table 4.4 issue that was *found while converting files that also use
EXTERNPROTO*. It is not an external-prototype behaviour, it is already owned by
P2B, and importing it into WD1.7 would duplicate a resolved lane.

---

## 6. Blaxxun / GLView assessment (lane brief §8)

The recorded requirement — *"Blaxxun/GLView EXTERNPROTO compatibility, with its
own tests and upstream justification"* — treats `Blaxxun` and `GLView` as two
things joined by a slash. The evidence says they are **not two behaviours**.

The only substantive corpus evidence for `GLView` is blaxxun's own
browser-capability sample, `captest.wrl`, shipped from four blaxxun developer
hosts in the archive:

```
var b=Browser.getName();
if (!((b == 'GLView') ||(b == 'blaxxunCC3D'))) return;
```

**FACT-CORPUS.** `GLView` and `blaxxunCC3D` are two values of `Browser.getName()`
for the *same vendor's* browser family, guarded together in one condition by
blaxxun's own code. `GLView` is a **product/engine identity string**, not a
distinct EXTERNPROTO resolution behaviour. Every other `GLView` hit in the
workspace is either the same `captest.wrl` under a different capture path, or
unrelated prose in CVN newsletter HTML.

Within WRL Forge, `GLView` occurs **only** in WD1.6's own planning text and in
`semantic-findings.js`'s comment listing candidate profile names it deliberately
declined to choose — plus a test that **bans** the string from the module. There
is no upstream requirement document behind the slash.

**Assessment: still-unresolved terminology, resting on one vendor family.**

- There is **no evidence** of GLView as a separate EXTERNPROTO behaviour.
- There **is** evidence of one vendor browser family (blaxxun Contact / CC3D,
  earlier GLView) whose extension surface WRL Forge may eventually profile.
- The genuinely evidenced EXTERNPROTO-adjacent vendor behaviours are H2 (URN
  candidates) and H3 (extension nodes such as `HUD`, `BspGroup`) — both of which
  are *conforming uses of ISO mechanisms*, not deviations from them.

**Recommendation: retire the slash.** Do not carry `Blaxxun/GLView` forward as a
compound requirement; it implies an equivalence the evidence does not support and
a second behaviour that does not exist. See **DECISION-1**.

---

## 7. Corpus baseline (Question B, measured)

> Numbers are produced by `spikes/wd1-7-external-proto/`, read-only,
> boundary-guarded, deterministic, with 8 adversarial controls that must all fire
> before any number is emitted, and an arithmetic reconciliation of every
> partition that sets the exit code.

**The full-corpus figures are in `spikes/wd1-7-external-proto/out/metrics.md`**
(regenerable; `out/` is gitignored). The table below is the *trial* stratum and
is labelled as such — see §7.2 for why the distinction is not cosmetic.

### 7.1 Denominators, stated first

Three different denominators appear, and quoting a figure against the wrong one
is how P2C's ROUTE count was inflated 2.3× before it was caught:

- **discovered raw paths** — every VRML file the guarded walk finds.
- **unique decoded documents** — de-duplicated by SHA-256 over the *decoded*
  text. A `.wrz` and its `.wrl` twin are **one** document; byte-level dedup
  overcounted P2C by ~32%.
- **written URL candidates** — individual strings inside EXTERNPROTO URL lists.
  This is the denominator for every form/fragment/probe figure.

### 7.2 Why the probe's denominator is fragile

The retrieval probe indexes targets from **the same paths it sweeps**. On a
capped run, a reference whose target lies in the unswept remainder is scored
"not found". The harness now prints an explicit non-comparability banner whenever
`swept < discovered`, because a capped dead-reference rate reads as a finding and
is an artefact. Only a full sweep bounds dead references.

### 7.3 Full corpus (all 20,545 discovered paths)

| measure | value | denominator |
|---|---:|---|
| unique decoded documents | **8,246** | 20,545 raw paths (15 read errors) |
| documents declaring EXTERNPROTO | **12.18%** (1,004/8,246) | unique documents |
| raw paths declaring EXTERNPROTO | 12.73% (2,616/20,545) | raw paths |
| EXTERNPROTO declarations | **1,667** (4,236 by raw path) | unique documents |
| written URL candidates | **2,672** (max **5** per declaration) | — |
| declarations using a bracketed list | 695 · single string 972 | 1,667 declarations |
| declarations with no URL at all | **0** | 1,667 declarations |

The 8,246 unique-document denominator is **the same figure WD1.6-C and WD1.6-D
measured** over the same roots, which is a useful cross-lane consistency check
rather than a coincidence.

**Reference forms** (denominator 2,672 candidates):

| form | count | share | example |
|---|---:|---:|---|
| `absolute-http` | 1,115 | **41.73%** | `http://www.cybertown.com/externprotos/bxx/shared.wrl#BlaxxunZone` |
| `bare-relative` | 662 | 24.78% | `slot.wrl` |
| `urn` | 513 | **19.20%** | `urn:inet:blaxxun.com:node:BspGroup` |
| `root-relative` | 189 | 7.07% | `/externprotos/nurbs_xite.wrl#NurbsSurface` |
| `parent-relative` | 145 | 5.43% | `../../ent_complex/elevator/elevator.wrl#CasinoElevator` |
| `dot-relative` | 43 | 1.61% | `./house_proto.wrl#HouseProto` |
| `empty` | 5 | 0.19% | `""` |
| `absolute-file` · `protocol-relative` · `windows-path` | **0** | 0% | — |

Three things in that table drive design decisions:

- **`urn:` is 19.20%, not a curiosity.** Nearly one candidate in five is not
  retrievable by *any* filesystem or network mechanism, and per N2 that is
  **conforming**. A resolver that scored these as failures would report a 19%
  false dead-reference rate. They need their own status
  (`UNSUPPORTED_REFERENCE`), which is why §10 defines one.
- **`absolute-http` at 41.73% is the dominant form**, and its host has been gone
  for two decades. Archived-URL → configured-root mapping is therefore the
  central retrieval problem, not an edge case.
- **Zero `windows-path`, zero `protocol-relative`, zero `file://`.** Three forms
  the lane brief asked about do not occur. They still need *classification* so
  they can be refused safely, but not resolution support.

**Fragment usage** (denominator 2,672): `#name` present **68.23%** (1,823);
absent **31.77%** (849). Percent-encoding **0**; query strings **0**;
empty fragments **0**.

> **Roughly one reference in three is fragment-less**, so ISO 4.9.3's positional
> "first PROTO **excluding EXTERNPROTOs**" rule is not an optional refinement —
> it decides 849 real references. Locator extensions: `.wrl` 2,153, n/a (urn)
> 513, none 6. **Not one `.wrz` or `.gz` reference exists in the entire corpus**,
> which is §7.4's point exactly.

**Does the "excluding EXTERNPROTOs" clause change the answer?** 1,677 of 8,246
documents declare a top-level PROTO; **10.02%** of those (168) open with an
EXTERNPROTO *and* declare a PROTO — the shape where ignoring the exclusion binds
the wrong target. 168 documents is small as a share and large as a count.

**Generous retrieval probe** (denominator 2,672 — upper bound, §8):

| outcome | count | share |
|---|---:|---:|
| unique target found | 1,193 | 44.65% |
| **AMBIGUOUS** (≥2 semantically distinct targets) | **826** | **30.91%** |
| not found anywhere in the archive | 134 | 5.01% |
| not probeable (`urn:`, empty) | 519 | 19.42% |

Of the 1,193 unique hits, **1,130 were case-exact and 63 differed only in case** —
so case-insensitivity buys about 5.3% more hits, which corroborates
`resolve_vrml_deps.py`'s reasoning (H11) while confirming it is a *recovery*
convenience rather than a necessity.

> **What 30.91% is, stated precisely.** It is an **upper-bound discovery
> ambiguity under an unconfined archive probe** — the probe is host-blind,
> scheme-blind and case-insensitive across every discovered path, so it
> deliberately conflates namespaces that §15.1 requires production to keep apart.
>
> It is **not** the claim that 30.91% of real-runtime EXTERNPROTO references are
> intrinsically ambiguous. Most of this figure is an artefact of searching one
> flat archive for references that were written against several distinct origins
> (`www.cybertown.com`, `objects.cybertown.com`, `www.blaxxun.com`), plus repeated
> Wayback captures of the same logical site that genuinely differ.
>
> What it does establish is the design constraint: **an unconfined,
> host-stripping lookup cannot distinguish these cases at all.** That is the
> empirical argument for origin-aware mapping (§15.1), for `AMBIGUOUS_SOURCE`
> being a first-class outcome, and against every "first match wins" heuristic.
> Production, being origin-scoped and narrower, should resolve much of this
> either to a single target or to an honest `NOT_FOUND` — but it must never
> resolve it by silently picking one.

**ISO 4.9.2 subset check**, where exactly one target was found and the named
PROTO existed in it (denominator 1,169; a further 23 found a target that did not
contain the named PROTO):

| outcome | count | share |
|---|---:|---:|
| subset satisfied (conforming) | 1,048 | **89.65%** |
| declared member **missing** from target — N4 error | 59 | 5.05% |
| declared member **type mismatch** — N4 error | 2 | 0.17% |
| declared member **access differs** — ISO-silent (U7) | 65 | 5.56% |

Two readings matter. First, **type mismatches are nearly absent (2)** while
**access differences are 32× more common (65)** — the same asymmetry P2B found
in Table 4.4, where 99.6% of 1,481 violations sat in the `exposedField` column.
Authors got types right and access wrong, consistently. That is precisely why
§14.1 insists access be reported as its own outcome: folding 65 ISO-silent cases
into 2 genuine errors would misreport the corpus by an order of magnitude.
Second, the 59 member-missing cases are real 4.9.2 errors — but the probe is
generous, so some fraction will be *wrong-target* artefacts rather than authoring
errors. **That figure is an upper bound and must not be quoted as a defect count.**

### 7.4 Compression (denominator 20,545 raw paths)

| measure | count | share |
|---|---:|---:|
| gzip by magic bytes | 6,517 | 31.72% |
| gzip-signalling extension (`.wrz`/`.gz`/`.x3dz`) | 58 | 0.28% |
| **gzip content behind a plain `.wrl` name** | **6,462** | **31.45%** |
| plain content behind a gzip-signalling name | 3 | 0.01% |

**The extension does not signal compression; only the magic bytes do.** 6,462
files are compressed behind a plain `.wrl` name against 58 that announce it —
a ratio of 111:1 — and 3 files announce compression they do not have. This
independently confirms `resolve_vrml_deps.py`'s note that *"blaxxun serves them
that way regardless of name"*, and combined with §7.3's finding that **no
reference anywhere names a `.wrz` or `.gz` target**, it settles the layering:
content sniffing is mandatory, extension dispatch is unusable, and
`readWrlSource`'s existing magic-byte detection is already the correct
mechanism to reuse.

---

## 8. Retrieval is not resolution (lane brief §10)

This is the single most important architectural boundary in WD1.7, and the
harness is built to make it impossible to blur.

```
written candidate  --(RETRIEVAL)-->  bytes  --(DECODE)-->  text
        |                                                    |
        |                                              (PARSE)
        |                                                    v
        +-------------(SEMANTIC RESOLUTION: 4.9.3 + 4.9.2)--> proven target
```

- **"We obtained these bytes from configured root X"** is retrieval. It is
  fallible, configuration-dependent, and says nothing about meaning.
- **"This is the unique PROTO implementation this EXTERNPROTO refers to"** is
  semantic resolution. It requires: a *uniquely* selected artifact, a parse, and
  4.9.3 target selection that succeeded without ambiguity.

The harness's probe is **deliberately generous** — longest-suffix,
case-insensitive, host- and scheme-blind, across every discovered path. That
makes its output an **upper bound**: a reference the probe cannot find is
definitively dead in this archive; a reference it finds is *merely a candidate*.
Production must be strictly narrower. The probe's matching rule is exactly the
"first filesystem match wins / nearest path wins" heuristic the lane brief
rejects, and it is fenced off in the module header, in the exported
`GENEROUS_PROBE_POLICY` marker, and by the fact that it lives in `spikes/`.

**WD1.7 should support deterministic local/archive inputs only. No network
retrieval.** H7 is the argument: a dead host did not degrade gracefully, it hung
the viewer forever. Production semantic correctness must not depend on live
network state, and a resolver whose answer changes with DNS is not reproducible.
If HTTP retrieval is ever wanted, it belongs behind a **supplied retrieval
capability** — an injected interface the caller provides — never an ambient
`fetch`. See **DECISION-3**.

---

## 9. Proposed provenance model (lane brief §15)

External proof must be reproducible by a third party from the record alone.
Every field below exists because a specific question cannot be answered without
it; fields that only *might* be useful are omitted, because an over-broad record
is how sidecar semantic state gets normalised into existence (WD.md §2).

| field | answers | why it cannot be dropped |
|---|---|---|
| `declarationRef` | *What asked for this?* | The source EXTERNPROTO, by span. Anchors the answer to the document. |
| `candidateIndex` + `writtenUrl` | *Which candidate was used?* | 4.5.2 order is normative; "the URL resolved" is meaningless when three were written. |
| `baseDocument` | *Resolved against what?* | 4.5.3/N12 makes the base a **required input**, and for a PROTO-body EXTERNPROTO it is the instantiating file, not the declaring one. |
| `evidenceSourceId` | *Which configured root supplied it?* | Makes the answer reproducible under a *named* configuration rather than under this machine's disk. |
| `artifactPath` | *Which file supplied the bytes?* | Root-relative. Never absolute — an absolute path leaks the owner's layout into the record. |
| `retrievedBytesHash` | *What bytes?* | Distinguishes two roots holding *different* content for one URL from two holding the *same*. |
| `decodedContentHash` | *What text?* | The canonical identity. A `.wrz`/`.wrl` twin pair is one document; byte identity would call it two. |
| `wasGzipped` | *Was it compressed?* | U2 — extra-standard, measured at 55.83% behind plain names. A decoding fact, never inferred from the name. |
| `selectedProtoName` + `selectionRule` | *Which PROTO, and by which rule?* | `fragment` (N10) vs `first-excluding-externproto` (N8) are different proofs with different failure modes. |
| `selectionWasUnique` | *Was it unique?* | The §7 hard gate. More than one match is `AMBIGUOUS`, decided before any filtering. |
| `dependencyChain` | *What led here?* | A list of `(decodedContentHash, selectedProtoName)` tuples (§10.1). Cycle detection and provenance both need the path, not just the endpoint. |
| `status` + `reason` | *What is actually known?* | §10. |

**Two things this record is not.** It is **not** node identity — WD1.4's two-tier
identity governs *nodes inside a document* and must not be extended to name
external artifacts; content identity and editor node identity are different
concepts and are kept apart deliberately (lane brief §15). And it is **not**
written anywhere: it is a derived value returned by a query, never a hidden id,
an identity comment, or sidecar state (WD.md §2 "Prohibited, permanently").

---

## 10. Proposed status taxonomy (lane brief §25)

Six independently answerable questions, kept six — the design lesson P2C paid
for with ROUTE endpoints. A lost *artifact* must never resurface as a missing
*PROTO*.

**Retrieval statuses** (about bytes):

| status | meaning |
|---|---|
| `RETRIEVED` | Exactly one configured source supplied bytes for exactly one candidate. |
| `NOT_FOUND` | No configured source supplied bytes for any candidate. Fully explored. |
| `AMBIGUOUS_SOURCE` | ≥2 sources supplied **semantically different** content for one candidate. |
| `UNSUPPORTED_REFERENCE` | The reference is not retrievable *by kind* — a `urn:`, a `javascript:`, an unmodelled scheme. **Not** a failure: N2 makes it conforming. |
| `NOT_RETRIEVED_BY_POLICY` | Well-formed and remote, and network retrieval is disabled. Distinct from `NOT_FOUND`: nothing was proven absent. |
| `DECODE_FAILED` | Bytes retrieved; gzip magic present but inflation failed, or the text is undecodable. |
| `LIMIT_EXCEEDED` | A configured size/expansion-ratio bound was hit. §12. |

**Resolution statuses** (about meaning):

| status | meaning |
|---|---|
| `RESOLVED` | Unique artifact, parsed, and a unique target PROTO selected under a named rule. |
| `TARGET_PARSE_FAILED` | Retrieved and decoded, but not a parseable VRML document. Covers N9's "results are undefined". |
| `TARGET_PROTO_NOT_FOUND` | Parsed; the named fragment (N10) or any selectable PROTO (N8) is absent. |
| `TARGET_PROTO_AMBIGUOUS` | Parsed; the fragment names ≥2 top-level PROTOs in one file. |
| `DEPENDENCY_CYCLE` | The chain re-entered the **same `(decodedContentHash, selectedProtoName)` tuple** already on the active traversal stack. |
| `NOT_ATTEMPTED` | Retrieval did not produce a unique artifact, so resolution was never asked. |

**Three deliberate choices.**

`AMBIGUOUS_SOURCE` and `TARGET_PROTO_AMBIGUOUS` stay separate: one is a
configuration problem the user can fix by narrowing roots, the other is a
property of the target file that no configuration will change.

There is **no generic `ERROR`**, per lane brief §25.

**`RECOVERED` is deliberately absent.** In P2A/P2B/P2C `recovered` describes a
*scope* whose boundaries the parser may have moved, and it is an upfront gate
that withholds every lexical claim. A damaged *external target* is a different
thing: it produces `TARGET_PARSE_FAILED`, or a successful parse whose scope
graph carries its own `recovered` confidence through the existing machinery.
Reusing the word for both would make a WD1.6 consumer's `confidence` check mean
two different things — exactly the "do not reuse existing WD1.6 status names
where their semantics would be misleading" hazard.

### 10.1 Traversal recursion identity

**Ratified after independent QA (correction F1).** The recursion identity for a
successfully selected external prototype is the **tuple**:

```
cycleKey = (decodedContentHash, selectedProtoName)
```

**Content identity alone is not sufficient, and using it produces false
positives.** One decoded document routinely declares several prototypes — that is
exactly what ISO 4.9.3's `#name` mechanism exists to serve, and what
`bxx/shared.wrl` does with `BlaxxunZone`, `SharedEvent`, `SharedObject` and
`SharedObjectEvent`. So:

```
library.wrl#Alpha  ->  library.wrl#Beta      LEGITIMATE. Same artifact, different
                                             prototype. Must remain resolvable.

library.wrl#Alpha  ->  library.wrl#Beta
                   ->  library.wrl#Alpha     GENUINE CYCLE. The tuple re-enters
                                             the ACTIVE traversal stack.
```

A content-hash-only stack would reject the first case as a dependency cycle and
lose a conforming reference. Path-keyed detection has the opposite defect: two
archive paths holding identical bytes are one artifact, and a path key would fail
to close the loop. The tuple is the only key that gets both right.

Three boundaries on this identity, so it is not over-read:

1. **It is scoped to the active traversal stack**, not to a global visited-set.
   Re-entering a tuple already *completed* elsewhere in the graph is reuse, not
   recursion.
2. **`TARGET_PROTO_AMBIGUOUS` fires first.** If the target declares the selected
   name more than once, resolution has already stopped before traversal, so the
   tuple is never formed from an unproven selection.
3. **This is external dependency *traversal* identity only.** It is not WD1.4
   persistent editor node identity, not canonical document identity, and not a
   hidden source identity. WD.md §7's hard gate governs the first of those and is
   untouched by this; conflating them is the failure this note exists to prevent.

---

## 11. Historical conversion tooling — what to reuse, what to refuse (lane brief §20)

| tool | problem solved | was it standards-correct resolution? | reuse? |
|---|---|---|---|
| `resolve_vrml_deps.py` | Enumerate every external reference a world makes | **Partly.** Relative-to-referring-file (4.5.3 case 3) and ordered fallback are correct. Case-insensitive matching and "shared roots" fallback are recovery heuristics. | **Concepts yes, algorithm no.** Adopt: gzip-by-content, resolve-relative-to-the-referrer, caller-**supplied** roots, and its self-test discipline. Reject: case-insensitive matching and shared-root fallback as *semantic* rules. |
| `fix_outlands.py` | Dead `EXTERNPROTO Bot`; X_ITE hangs forever on the fetch | No — a migration shim. Replaces the dead type with an inert local PROTO of identical interface. | **No.** But it is the primary evidence for the no-network policy (§8), and it models honest failure: *"The bots do not appear; nothing is invented to stand in for them."* |
| `add_hud_shim.py` | `HUD` is a blaxxun built-in X_ITE lacks | No — an additive compatibility shim. | **No.** It rewrites source. Note its restraint: it skips files that already declare their own `HUD`. |
| `convert_vrml_compat.py` | Table 4.4 `field … IS`-an-`exposedField` | No — a source rewrite. | **No.** Already owned by P2B. |
| `convert_shared_site.py` | Duplicate interface names; digit-leading DEFs | No — repairs authoring defects. | **No.** |

**The line WD1.7 must not cross.** Four of these five *rewrite the document*.
Resolving an EXTERNPROTO must never rewrite the canonical source (lane brief §27):
no `EXTERNPROTO → PROTO` substitution, no URL rewriting, no inlining, no
dead-reference replacement, no interface cleanup. Every one of those is a
separate, explicit, opt-in **migration** feature — a different product surface
from semantic truth — and each would need its own approved lane.

Three heuristics are rejected outright as semantics, per lane brief §20:
**first filesystem match wins**, **nearest path wins**, **guess a replacement**.
Note that the harness's own probe implements the first of these *on purpose*, as
an upper-bound measurement, and is fenced off in `spikes/` for exactly that reason.

---

## 12. Security and root-boundary design (lane brief §26)

The eventual resolver is a file/dependency resolver driven by untrusted document
content. This section defines required production safeguards; it is not licence
to build them now.

| threat | required safeguard |
|---|---|
| **Root escape** via `../../../../etc/passwd` | Resolve to an absolute path, then `realpath`, then verify the result is **inside** a configured root. Verify **after** symlink resolution, never before. This is the World Project lane's existing pattern and must be reused, not re-invented. |
| **Symlinks** | Refuse to follow, or follow-then-re-verify containment. WD1.4's corpus walk already **skips** symlinks so it cannot escape or loop; production needs the stricter re-check because a target may legitimately be a link. |
| **Absolute / root-relative references** | A written `/some/path/file.wrl` is a **URL-root-relative reference**, not permission to read the workstation's filesystem root. It resolves through the mapping configured for the **base document's URL origin**, or not at all — never as `/some/path/file.wrl` on this machine. Same for `absolute-file`. |
| **Unmapped external origin** | An `http://` reference whose origin has no configured mapping fails closed — `NOT_RETRIEVED_BY_POLICY`. Never host-stripped into a generic root search. |
| **Network URLs** | Not retrieved. `NOT_RETRIEVED_BY_POLICY`. |
| **Decompression bombs** | Bound **both** the decompressed size and the expansion ratio, and stream rather than `gunzipSync` a hostile input. → `LIMIT_EXCEEDED`. |
| **Very large files** | A configured byte cap, applied before decode. |
| **Malformed gzip** | Already handled by `readWrlSource`, which throws a clear prefixed error rather than returning garbage. Map to `DECODE_FAILED`. |
| **Recursive cycles** | Detect on the **`(decodedContentHash, selectedProtoName)` tuple** — see §10.1. Not on path (two paths to identical content are one artifact, and a path-keyed detector misses the loop), and **not on content alone** (that reports a false cycle for a second PROTO in the same library). → `DEPENDENCY_CYCLE`. |
| **Duplicate / overlapping roots** | Two roots yielding *identical decoded content* is **not** ambiguity for the immediately selected prototype; two yielding *different* content is `AMBIGUOUS_SOURCE`. Distinguishing these is required. But equivalent content is **not** licence to discard location provenance — see §15.2. |
| **Case sensitivity** | Production resolves **case-sensitively, enforced in software** — the directory listing is authoritative, never the host filesystem's own behaviour. Inheriting it would make one reference resolve on a case-insensitive NTFS/APFS volume and fail on ext4, so results would not be reproducible across Linux/Windows/macOS. (This is the rule `src/editor/editor-locator.js` already follows for filename-case detection.) Case-insensitive matching is an archive-recovery convention (H11) and belongs to a migration tool. A case-only near-miss is *reported* as a distinct finding, never silently promoted to a match. |
| **Traversal depth** | Bounded. But **not by an arbitrary constant**: see DEFERRED-2. |

**Configured roots are the boundary, and the boundary is real.** No reference,
however written, may read a byte outside them.

---

## 13. Strict vs external semantics — the layering (lane brief §14, §23)

```
SOURCE TEXT (canonical)
      |
      v
LOCAL SEMANTICS  (P2A/P2B/P2C, WD1.6-A/B/C)          <-- UNCHANGED by WD1.7
      |
      v
strict result:  status: unsupported
                reason: EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE
                        EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE

SOURCE + EXPLICIT RESOLVER CONFIG + EXPLICIT BASE
      |
      v
EXTERNAL DEPENDENCY EVIDENCE  (WD1.7, new)
      |
      v
external facts: retrieval status, provenance, target interface, target class

strict result  +  external evidence
      |
      v
ENRICHED QUERY  (a NEW, SEPARATELY NAMED entry point)
      |
      v
strict:   { status: 'unsupported', reason: ... }      <-- still verbatim
external: { status: 'RESOLVED', firstBodyNode: 'Transform', ... }

... + compatibility evidence  -->  future classification (WD1.7-D at the earliest)
... all semantic data          -->  P4 presentation policy
```

**The invariant, stated so it can be tested:** calling any existing WD1.6 query
*without* a resolver context must produce byte-identical results to today. The
strict field is never overwritten, never upgraded, and never removed; external
evidence is only ever **added alongside** it. That is the difference between
"enriched" and "silently changed", and it is the whole reason the brief insists
`strict.status` must not become `legal` because an archived file was found.

---

## 14. Integrating with B, C and D — no second resolver (lane brief §15–17)

### 14.1 WD1.6-B — effective interface

**Today (FACT-CODE):** `interface-query.js:147` marks an EXTERNPROTO's interface
`resolved` but **not `complete`**, citing 4.9.2. `scope-graph.js` returns
`EXTERNPROTO_INTERFACE_NOT_LOCALLY_VERIFIABLE` for a member the local declaration
omits — `unsupported`, never `unresolved`, because the declaration may be a
strict subset.

**That `complete: false` flag is already the integration seam,** and it exists
because P2B got 4.9.2's asymmetry right the first time. B does not need a second
interface resolver; it needs an **evidence argument**.

**Proposed:** a separate enriched entry point accepts an optional
`externalEvidence` object and returns B's verdict unchanged, plus an
`external` sibling carrying: the target's declared members, and the 4.9.2
**directional** comparison — `local ⊆ target`. Three outcomes are reported
separately and never merged: `agrees`, `member-missing-from-target` (N4 error),
`type-mismatch` (N4 error). An access-only difference is reported as its own
outcome because U7 is unspecified — the harness measured **65** such cases
against **2** genuine type mismatches, so the distinction is not hypothetical;
collapsing them would misreport the corpus 32-fold.

**Superset is normal and must not be flagged.** N3 makes `local ⊆ target` the
*conforming* shape. Control C5 pins the direction precisely because a symmetric
equality check would flag every well-formed library and catch nothing extra.

### 14.2 WD1.6-C — prototype implementation class

**Today (FACT-CODE):** `containment.js:344` maps an `EXTERNPROTO_INTERFACE`
candidate origin to `unsupported` /
`EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE`. **This is correct and must not
change.** It is a true statement about local evidence.

**Proposed:** external evidence can prove the class, because ISO 4.8.3's rule —
"the first node type determines how instantiations of the prototype can be
used" — applies to the target's PROTO body exactly as it does to a local one.
Once a target is `RESOLVED`, C's *existing* 4.8.3 machinery runs against the
target's first body node. No new class rule is written.

The enriched result carries both, side by side:

```
strictLocal:                    unsupported / EXTERNPROTO_CLASS_NOT_LOCALLY_VERIFIABLE
externalImplementationEvidence: RESOLVED / firstBodyNode: Transform / class: children
```

A `strictLocal` that silently became `legal` would be the exact failure the brief
names. **C is not modified in WD1.7-A, and should not be modified in WD1.7-B.**

### 14.3 WD1.6-D — the reserved compatibility slot

**Today (FACT-CODE):** `semantic-findings.js` reserves `compatibility` and always
sets it `null`, meaning **NOT EVALUATED**; a test bans any profile identifier
(`/blaxxun/i`, `/glview/i`, `/cybertown-compat/i`, `/vendor-extension/i`) from
the module. **86.96%** of corpus findings carry `confidence: recovered`.

**Do not populate it in WD1.7-A** (lane brief §19). What this lane can say is
what evidence would justify a claim. A compatibility statement must answer four
questions, and today WD1.7 can answer only three:

| question | can WD1.7 evidence answer it? |
|---|---|
| Does ISO permit / prohibit / not-specify it? | **Yes** — the ISO axis already exists and is computed by a committed table. |
| What corpus proves the behaviour occurs? | **Yes** — with numerator and denominator. |
| What confidence? | **Yes** — carried through from the substrate. |
| **Accepted by what named behaviour or profile?** | **No.** §6 shows the one candidate name is a browser-identity string, not a behaviour. |

**Therefore the slot stays `null` until a profile is named on evidence, and D
stays decoupled from filesystem resolution** — evidence is *passed to* a
projection, never *fetched by* it. D's job is projecting verdicts into findings;
giving it a resolver would make a pure projection depend on disk.

---

## 15. Proposed public API (lane brief §24)

Names are illustrative; shapes are the proposal. **Deliberately small** — the
brief warns against exposing a low-level resolver API just because the
implementation needs helpers.

```js
// ---- configuration: explicit, inert, no ambient anything -----------------
createResolverContext({
  sources: [                       // ORDERED. No default. No implicit CWD.
    // Each entry maps ONE external URL namespace onto ONE archive location.
    // `origin` (or a longer URL prefix) is what makes the mapping explicit --
    // see §15.1. Distinct origins are distinct namespaces and never merge.
    { id: 'ct-web',
      origin: 'http://www.cybertown.com',
      root: '/abs/archive/root' },          // realpath-verified boundary
    { id: 'ct-objects',
      origin: 'http://objects.cybertown.com',
      root: '/abs/archive/root' },
    { id: 'bxx-web',
      origin: 'http://www.blaxxun.com',
      root: '/abs/other/root' },
  ],
  // An origin with no configured mapping FAILS CLOSED. It is never guessed at,
  // and never stripped down to a bare path searched against a generic root.
  network: false,                  // DEFAULT false. true requires an injected retriever.
  retriever: null,                 // injected capability; never an ambient fetch
  limits: { maxBytes, maxDecodedBytes, maxExpansionRatio, maxDepth },
  caseSensitive: true,             // DEFAULT true. Insensitivity is a migration concern.
}) -> ResolverContext              // frozen, reusable, holds no mutable per-document state

// ---- the one primary query ----------------------------------------------
resolveExternalPrototype(parseResult, externProtoNode, {
  context,                         // required
  baseDocument,                    // REQUIRED. ISO 4.5.3/N12 -- never inferred.
}) -> ExternalPrototypeEvidence

// ExternalPrototypeEvidence
// {
//   retrieval:  { status, reason, candidateIndex, writtenUrl, evidenceSourceId,
//                 artifactPath, retrievedBytesHash, wasGzipped },
//   resolution: { status, reason, selectedProtoName, selectionRule,
//                 selectionWasUnique, decodedContentHash },
//   candidates: [ { index, writtenUrl, form, status, reason } ],  // ALL of them
//   interface:  { declaredMembers } | null,
//   implementationClass: { firstBodyNode, class } | null,
//   dependencyChain: [ { decodedContentHash, selectedProtoName }, ... ],  // §10.1
//   provenance: { ...§9 }
// }

// ---- whole-document view, for a scene tree or a package audit ------------
buildExternalDependencyGraph(parseResult, { context, baseDocument })
  -> { nodes, edges, cycles, unresolved, ambiguous }
```

**`candidates` reports every written candidate with its own status**, not just
the winner. 4.5.2 order is normative, and "candidate 0 was a `urn:` we cannot
retrieve, candidate 1 resolved" is the single most common shape in this corpus
(H2) — collapsing it to one status would discard the interesting half.

**Private, and staying private:** URL parsing and form classification, suffix and
root matching, the artifact cache, gzip decode plumbing, the parse cache, cycle
bookkeeping. Callers get evidence, not a filesystem.

**Two absences are deliberate.** There is no `resolveAll(document)` convenience
that would invite a whole-corpus ambient sweep. And there is **no** enrichment
entry point in this proposal that mutates a WD1.6 result — enrichment is a new,
separately named query whose output *contains* the strict result verbatim.

### 15.1 Archive mapping is origin-aware, never originless

**Ratified after independent QA (correction F2).** The corpus does not reference
one host. It references at least `www.cybertown.com`, `objects.cybertown.com`
and `www.blaxxun.com`, and those are **different namespaces that happen to be
archived nearby**. Two of them can legitimately hold a *different* file at the
same path.

So the required shape is:

```
external URL namespace  ->  explicit configured mapping  ->  archive root/prefix
```

and explicitly **not**:

```
strip the host  ->  search one generic filesystem root
```

The second is the harness probe's rule (§8), and it is generous on purpose to
produce an upper bound. As a *production* rule it would silently merge three
namespaces and pick whichever file surfaced first — the "first filesystem match
wins" heuristic §11 rejects.

Two consequences follow, and both are contracts rather than preferences:

- **Mapping is by origin, or by a longer URL prefix where an origin is too
  coarse.** A prefix is a superset of an origin, so the configuration shape must
  admit one without needing a second mechanism.
- **An unmapped origin fails closed** — `NOT_RETRIEVED_BY_POLICY`, meaning
  *nothing was proven absent*. It must never degrade into `NOT_FOUND`, which
  would assert a fact the resolver never established.

Exact property names are **WD1.7-B's** to fix. What WD1.7-A ratifies is the
invariant, not the spelling.

### 15.2 Equivalent content does not erase retrieval provenance

Also ratified after independent QA. §12 says two roots holding *identical
decoded content* are not an ambiguity — and that is true **for the immediately
selected prototype**, whose meaning is fully determined by that text.

It is not true for what comes next. Identical copies can sit under **different
base contexts**, and ISO 4.5.3/N12 resolves a target's own nested relative
references against *its* base. So two byte-identical libraries reached through
different archive locations can have dependency subtrees that diverge.

Therefore the provenance record retains, at minimum:

```
evidenceSourceId · artifactPath (archive-relative) · base context · decodedContentHash
```

**Collapsing to "same decoded hash → discard location provenance" is
prohibited.** Content identity answers *what this text is*; it does not answer
*where it was retrieved from*, and only the second can resolve the next hop.

### 15.3 Candidate fallback order

ISO 4.5.2 (N11) makes the written order normative. Evaluation walks candidates
in that order and **continues** past every non-terminal outcome:

```
UNSUPPORTED_REFERENCE · NOT_RETRIEVED_BY_POLICY · NOT_FOUND · DECODE_FAILED
LIMIT_EXCEEDED · AMBIGUOUS_SOURCE · TARGET_PARSE_FAILED
TARGET_PROTO_NOT_FOUND · TARGET_PROTO_AMBIGUOUS
```

It **stops** on `RESOLVED`.

**Every evaluated candidate keeps its own outcome in provenance** — the walk
records a list, not a winner. `AMBIGUOUS_SOURCE` continuing is the subtle one:
an ambiguous *candidate* has not resolved anything, so 4.5.2's "try the next
location" still applies, and a later candidate may resolve unambiguously. What
must never happen is an ambiguous candidate being *silently resolved* by picking
one of its targets.

---

## 16. Implementation decomposition (lane brief §20)

| lane | scope | depends on | tests | QA gate |
|---|---|---|---|---|
| **WD1.7-B — retrieval substrate** | `ResolverContext`, source roots, boundary enforcement, gzip-by-content decode, artifact + decoded identity, candidate iteration in 4.5.2 order, retrieval statuses. **No VRML semantics at all.** | nothing new | root escape, symlink, absolute/root-relative, malformed gzip, bomb limits, duplicate roots identical vs different content, ordered fallback, `urn:` → `UNSUPPORTED_REFERENCE` | 0 reads outside configured roots, proven adversarially |
| **WD1.7-B2 — World Project integration** | A thin consumer that feeds B's discovered EXTERNPROTO dependencies into the existing asset graph and package plan, closing §19. **No resolver of its own.** | B | EXTERNPROTO target appears in the asset graph; a missing one **blocks** packaging; a remote one is reported as `remote-reference` | World Project grows **no** second EXTERNPROTO URL resolver |
| **WD1.7-C — target selection (4.9.3)** | Fragment (N10) vs first-PROTO-excluding-EXTERNPROTO (N8); `TARGET_PROTO_*` statuses; cycle detection on the §10.1 tuple; dependency graph | B | the `shared.wrl` shape (C4); missing fragment; ambiguous fragment; non-VRML target (N9); self-reference; two-file cycle; **same-file second-PROTO transition is NOT a cycle** | 0 wrong target selections against an independently authored oracle |
| **WD1.7-D — interface & class enrichment** | 4.9.2 directional subset check; 4.8.3 class from the target's first body node; the enriched B and C entry points | C, WD1.6-B, WD1.6-C | subset satisfied / member-missing / type-mismatch / access-differs; class derivation; **regression: no context ⇒ byte-identical strict results** | strict-local results provably unchanged |
| **WD1.7-E — compatibility classification** | Populating `compatibility` | D + a **named** profile | — | **BLOCKED on DECISION-1.** Do not start until a profile is named on evidence. |

**Recommended next lane: WD1.7-B.** It is the only one with no semantic surface,
so it can be proven purely adversarially, and everything else sits on it.
Starting at C or D would mean building semantics on an unproven retrieval layer.

**WD1.7-B2 is deliberately a *consumer*, not a feature of the core.** The
architecture is:

```
WD1.7-B retrieval substrate
        -> small dependency-discovery integration
                -> World Project asset graph / package plan
```

The alternative — letting `src/world-project/` grow its own EXTERNPROTO URL
handling — would create the second semantic authority this whole lane argues
against, and would do it in the module that already carries a
field-name-anchored regex that caused §19.

---

## 17. Future test matrix (lane brief §28)

**Synthetic normative** (original fixtures, no restricted material):
single relative dependency · ordered candidate fallback where candidate 0 is
unretrievable · `#Fragment` selection · **fragment-less selection where the file
opens with an EXTERNPROTO** (the `shared.wrl` shape) · missing file · missing
target PROTO · fragment naming a duplicated PROTO → ambiguous · two roots,
identical content → **not** ambiguous · two roots, different content → ambiguous ·
nested dependency (depth ≥ 3) · self-referential cycle · two-file cycle ·
**`library.wrl#Alpha` → `library.wrl#Beta` is NOT a cycle** (F1's false-positive
guard) · **`Alpha` → `Beta` → `Alpha` in one file IS a cycle** · gzip
target under a `.wrl` name · malformed gzip · decompression-ratio bomb ·
non-VRML target (N9) · `urn:` candidate · interface subset satisfied · member
missing from target · type mismatch · access-only difference · external class
derivation · root-escape attempt via `../../../` · symlink pointing outside a root ·
**no-context regression: every WD1.6 query byte-identical.**

**Historical fixtures — what may and may not be committed:**

| evidence | committable? | why |
|---|---|---|
| `bxx/shared.wrl` structure (EXTERNPROTO-then-PROTO ordering) | **As an original synthetic reproduction**, citing the observed file | The *shape* is the test subject; the content is period blaxxun material of unestablished licence. |
| `urn:` + HTTP fallback candidate list | **Synthetic reproduction** | Same reasoning; the pattern is trivially reproducible. |
| gzip-behind-`.wrl` | **Synthetic** — the repo already has gzip/CRLF twin fixtures under `.gitattributes -text` | No archive bytes needed. |
| Anything from `blaxxun-cs-RE` | **No** | `OPEN_SOURCE_PROVENANCE.md` §3. |
| Anything from `modeling-tools/RE-ARTIFACTS` | **No** | Its own single-readable-file rule. |
| Cybertown corpus `.wrl` bytes | **No, by default** | Per-file licence unestablished. → **DECISION-2.** |

The rule that falls out: **reproduce the shape, cite the evidence, commit
neither.** Every synthetic fixture should carry a comment naming the observed
file that motivated it, so the fixture is traceable without redistributing
anything.

---

## 18. Reusable external implementation ideas (lane brief §22)

**NONE ADOPTED.**

FreeWRL — a GPL VRML97 browser with a genuine EXTERNPROTO resolver, the single
most relevant comparison available — is present locally at
`blaxxun-cs-RE/modeling-tools/freewrl-git`. It was **not read**, because that
path sits inside a tree `OPEN_SOURCE_PROVENANCE.md` §3 declares
implementation-prohibited, and provenance-by-location is not a defensible record
even for genuinely GPL upstream code. White Dune was not consulted: ISO settles
every semantic question this lane asked (§3), so there was nothing an
implementation could adjudicate, and §21 forbids browsing implementation code
merely to fill a report.

If a future lane wants FreeWRL as corroboration, it needs a **clean upstream
checkout outside the prohibited tree** plus a §4.1 Research & Reference
provenance entry. See **DECISION-4**.

---

## 19. A defect found on the way (not part of the brief)

**FACT-CODE, proven by execution, not by reading comments.**

`src/world-project/url-fields.js` extracts references with
`/\b(\w*[Uu]rl)\b\s*(\[[^\]]*\]|"[^"]*")/g` — a **field-name-anchored** regex.
An EXTERNPROTO's URL list has no field name, so it never matches. Executed:

```js
extractUrlRefs('EXTERNPROTO Z [] "bxx/shared.wrl#BlaxxunZone"\nInline { url "child.wrl" }')
// -> [ { nodeType: 'Inline', field: 'url', value: 'child.wrl' } ]     <-- EXTERNPROTO absent
```

`src/vrml/asset-refs.js:16-18` documents this precisely as a *"known shared gap"*.
But three places state the opposite:

- `src/world-project/asset-graph.js:6` — "following nested Inline / EXTERNPROTO .wrl"
- `docs/WORLD_PROJECT_ARCHITECTURE.md:59` — "Follows nested `Inline`/EXTERNPROTO `.wrl` children"
- `docs/WRL_FORGE_ROADMAP.md:159-160` — checked off as delivered

**Consequence, and it is not cosmetic.** `package-plan.js` derives its blocking
findings (`missing-assets`, `remote-reference`, `case-mismatch`, `unsafe-path`)
entirely from the asset graph. Because EXTERNPROTO references never enter that
graph, a **World Project Bundle can omit every PROTO library a world depends on
and still report `ready`** — and a remote EXTERNPROTO such as
`http://www.cybertown.com/externprotos/bxx/shared.wrl#BlaxxunZone`, which would
otherwise be a *blocking* `remote-reference`, is silently invisible. Given
EXTERNPROTO appears in **12.18%** (1,004/8,246) of unique corpus documents — and
**41.73%** of its candidates are absolute remote URLs that the blocking rules
exist to catch — this is not rare.

This is **out of scope for WD1.7-A** and nothing was changed. It is reported
because the docs overclaim, and because closing it is a natural early consumer of
WD1.7-B. → **DECISION-5.**

---

## 20. Owner decision ledger

**DECISION-1 — Retire the compound term "Blaxxun/GLView".**
*Evidence:* §6. `GLView` and `blaxxunCC3D` are two `Browser.getName()` values of
one vendor family, guarded together in blaxxun's own `captest.wrl`. No evidence
of a distinct GLView EXTERNPROTO behaviour exists anywhere in the workspace.
*Options:* (a) retire the slash; treat vendor compatibility as one unnamed
evidence question until a profile is earned. (b) Keep the term. (c) Name a
profile now.
*Recommended:* **(a).** *Consequence:* WD1.7-E stays blocked, `compatibility`
stays `null`, and WD1.6-D's no-profile-name test keeps passing — which is the
posture D deliberately chose.

**DECISION-2 — May restricted-provenance corpus evidence become committed fixtures?**
*Evidence:* §17. Per-file licence for Cybertown/blaxxun VRML is unestablished.
*Options:* (a) synthetic reproductions only, each citing the observed file.
(b) Commit small real excerpts. (c) Case-by-case.
*Recommended:* **(a).** *Consequence:* slightly more fixture-authoring effort;
zero redistribution risk; fixtures stay readable and minimal.

**DECISION-3 — Network retrieval policy.**
*Evidence:* §8, H7 — a dead host hung X_ITE forever rather than failing.
*Options:* (a) no network, ever, in semantic resolution. (b) Optional injected
retriever, default off. (c) Built-in HTTP.
*Recommended:* **(a) for WD1.7-B/C/D, with (b) reserved** as a later injected
capability. *Consequence:* results are reproducible and independent of DNS;
genuinely remote references report `NOT_RETRIEVED_BY_POLICY`, which is honest.

**DECISION-4 — May FreeWRL be consulted as corroboration?**
*Evidence:* §18. GPL and locally available, but only inside a prohibited tree.
*Options:* (a) not needed — ISO settles the semantics. (b) Clean upstream
checkout outside the tree + a §4.1 provenance entry. (c) Read it in place.
*Recommended:* **(a) now, (b) if a future lane needs it.** (c) is not acceptable
on provenance grounds. *Consequence:* none for WD1.7-B/C/D.

**DECISION-5 — What to do about the World Project EXTERNPROTO gap (§19)?**
*Evidence:* §19, proven by execution.
*Options:* (a) correct the three overclaiming docs now, fix the scanner in a
later lane that consumes WD1.7-B. (b) Fix the scanner immediately. (c) Leave both.
*Recommended:* **(a).** **Ratified after QA:** the functional fix is owned by
**WD1.7-B2**, a thin consumer of the WD1.7-B substrate — not by a second, ad-hoc
URL extractor inside `src/world-project/`, which would violate the
one-semantic-authority doctrine. *Consequence:* documentation stops overclaiming
once the backlog in §21 is worked; the code fix lands on a proven substrate.
**Nothing was changed in this lane** — the defect is confirmed, reproduced by
independent QA, and deferred.

---

## 21. Stale-document backlog (recorded, not worked)

Found while gathering evidence. **Nothing here was changed in this lane** — the
closeout scope is the WD1.7-A contract only, and a documentation sweep is its own
task.

| # | artifact | problem |
|---|---|---|
| S1 | `blaxxun-cs-RE/modeling-tools/RE-ARTIFACTS/SAFE_WRLFORGE_RESEARCH_HANDOFF.md` | §1.3/§8.1 describe WRL Forge as MIT. It has been `GPL-3.0-or-later` since `2eb7c39`. |
| S2 | `docs/WORLD_PROJECT_ARCHITECTURE.md:59` | Claims the scanner "Follows nested `Inline`/EXTERNPROTO `.wrl` children". It does not — §19. |
| S3 | `src/world-project/asset-graph.js:6` | Same overclaim in a source comment. |
| S4 | `docs/WRL_FORGE_ROADMAP.md:159-160` | EXTERNPROTO asset discovery is checked off as delivered; it is not. |
| S5 | Research/viewing restrictions across `WD.md`, `OPEN_SOURCE_PROVENANCE.md` and workspace policy | Several blanket prohibitions are **overbroad**: they are worded as bans on *reading*, when the actual risk they guard is *copying and redistribution*. |

**S5 is the one worth stating carefully**, because getting it wrong in either
direction is costly. A future documentation-policy normalization must distinguish:

```
permission to inspect / study        (a research question)
permission to copy / adapt / redistribute   (a licensing question)
```

Conflating them cost this lane real capability: FreeWRL — GPL, and the single
most relevant open-source EXTERNPROTO resolver — was left unread purely because
of the *path it sits under* (§18), not because of anything about the software.

Normalizing S5 must **not** weaken the protections that are genuinely load-bearing:

- **PII and credentials** — the Root B tree holds real 2001 member data and
  plaintext credentials (§4.2). Unchanged, non-negotiable.
- **Redistribution limits** on proprietary and RE material — unchanged.
- **Corpus-boundary contamination** — `FORBIDDEN_MARKERS` must keep **throwing**
  on `blaxxun-cs-RE`, `RE-ARTIFACTS` and `white-dune` for *generic enumeration*.
  That guard is what makes this lane's numbers publishable, and control C1 exists
  to prove it is live. Widening "may I read a named file" must never widen "may a
  sweep enumerate this tree".

---

## 22. Open risks

**BLOCKING (for WD1.7-E only)**
- No compatibility profile can be named on current evidence (§6, DECISION-1).

**NON-BLOCKING**
- The World Project packaging gap (§19) — real, reproduced by independent QA,
  out of scope here; owned by **WD1.7-B2** (DECISION-5).
- The stale-document backlog (§21), S1–S5. S1 in particular:
  `SAFE_WRLFORGE_RESEARCH_HANDOFF.md` claims MIT; do not rely on its §1.3/§8.
- N12's instantiation-relative base for a PROTO-body EXTERNPROTO is correctly
  modelled as a required input, but no corpus measurement of how often that case
  arises was made.

**DEFERRED**
- **DEFERRED-1:** U6 — whether N14's recursion prohibition extends across files
  via EXTERNPROTO chains. Cycle *detection* is required regardless; whether a
  cycle is an ISO **error** or merely unresolvable is unsettled, so
  `DEPENDENCY_CYCLE` deliberately states the fact without judging it.
- **DEFERRED-2:** the traversal depth bound. Lane brief §18 forbids an arbitrary
  cap without evidence, and the full-corpus dependency-depth distribution should
  set it. Until then the cap is configuration, not a constant.
- **DEFERRED-3:** U7 — access-category differences. Reported as their own
  outcome; no rule invented.
- **DEFERRED-4:** S5 in §21 — normalizing the overbroad *reading* prohibitions
  without weakening the PII, credential, redistribution and corpus-boundary
  protections they are tangled up with.

---

## 23. Reproducing the evidence

```bash
node spikes/wd1-7-external-proto/controls.js          # 8/8 controls must fire
node --max-old-space-size=6144 spikes/wd1-7-external-proto/run.js
node spikes/wd1-7-external-proto/run.js --files=600   # fast, capped (see §7.2)
```

Read-only · boundary-guarded (throws on `blaxxun-cs-RE`, `RE-ARTIFACTS`,
`white-dune`) · deterministic (codepoint ordering, no clock, no PRNG) ·
de-duplicated by **decoded** text · every partition arithmetically reconciled,
with the exit code staking the claim. `out/` is gitignored and regenerable —
the harness is the durable artifact, not its output.
