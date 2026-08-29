# WD1.7-B2 — World Project EXTERNPROTO Dependency Integration (as built)

Closes `F3-WORLD-PROJECT-SCANNER-EXTERNPROTO-OMISSION`, the defect recorded in
`WD1_7_A_EXTERNAL_PROTO_EVIDENCE.md` §19 and deferred there by **DECISION-5**.

**Predecessors:** WD1.7-A (evidence + resolver contract, `bca801e`) and
WD1.7-B (retrieval substrate, `26169d8`). B is closed and is consumed, never
reopened.

---

## 1. The defect, reproduced before it was fixed

World Project dependency discovery is anchored on url-**named** fields
(`src/world-project/url-fields.js`, `/\b(\w*[Uu]rl)\b\s*(\[[^\]]*\]|"[^"]*")/g`).
An EXTERNPROTO's URL list has no field name at all — ISO A.2 gives
`EXTERNPROTO nodeTypeId [ externInterfaceDeclarations ] URLList` — so no
EXTERNPROTO reference ever entered the asset graph.

Executed against `scanProject` → `buildPackagePlan` at `26169d8`, on

```vrml
#VRML V2.0 utf8

EXTERNPROTO MissingLibrary [] "missing_lib.wrl#Missing"

Inline {
  url "local.wrl"
}
```

| observation | before |
|---|---|
| `graph.references` | `Inline` / `url` / `local.wrl` / `present` — **one** entry |
| `graph.missing` | `[]` |
| `graph.externProtos` | key absent |
| `plan.status` | **`ready`** |
| `plan.blocking` | `[]` |
| `plan.files` | `local.wrl`, `world.wrl` |

`missing_lib.wrl` was omitted from every list, and the bundle reported `ready`.
The fixture is now `THE DEFECT FIXTURE` in
`test/world-project/externproto-deps.test.js` and control **M1** proves the
assertion depends on discovery rather than on a coincidence.

---

## 2. Architecture — B2 is a consumer, twice over

```
VRML source (the document; unchanged, never rewritten)
        |
        v
src/vrml/parser + src/vrml/ast          <- the ONE syntax authority
        |
        v
src/world-project/externproto-deps.js   <- WD1.7-B2 (this lane)
  discoverExternProtoGroups   pure: AST -> declarations + ordered candidates
  ISO 4.5.3 base gate         nested-in-PROTO => withheld, never guessed
        |
        v
src/external-proto (public facade)      <- the ONE retrieval authority
  classifyReference / createResolverContext / retrieveExternalCandidate
        |
        v
src/world-project/asset-graph.js  -> graph.externProtos
src/world-project/package-plan.js -> packaged files, findings, blocking codes
        |
        X   B2 STOPS HERE
```

**Where B2 stops.** It knows whether one candidate *artifact* was obtained and
decoded. It does not know, does not ask, and must not be read as answering:

- which PROTO inside the artifact a reference selects (ISO 4.9.3),
- whether a written `#fragment` exists in the target,
- whether a fragment-less reference's first-PROTO rule succeeds,
- whether the target parses as usable VRML,
- what the retrieved artifact's **own** dependencies are.

All of that is **WD1.7-C**. `retrievable` is therefore deliberately not spelled
`resolved`, exactly as B's `RETRIEVED` is not spelled `RESOLVED`.

### Two things B2 refuses to be

1. **Not a second EXTERNPROTO parser.** The original defect exists precisely
   because discovery was lexical. Fixing it by widening that regex into
   `EXTERNPROTO\s+…` would create a second grammar, and a second grammar drifts
   from the first. Declarations come from the AST. A test asserts, behaviourally,
   that no PROTO-matching regex exists in `externproto-deps.js`, `url-fields.js`
   or `asset-graph.js`, and that `url-fields.js` **still** cannot see an
   EXTERNPROTO — the fix did not take the forbidden route.
2. **Not a second resolver.** Classification, URL/archive routing, exact-case
   lookup, symlink containment, gzip-by-magic decoding and every resource bound
   are B's. World Project performs no filesystem access of its own for a
   candidate; a source scan asserts `externproto-deps.js` contains no `fs`
   require, no `existsSync`, no `readFileSync`, no case folding and no `zlib`.

---

## 3. The dependency-group model

An EXTERNPROTO URL list is an **ordered fallback** (ISO 4.5.2, "decreasing order
of preference"), **not** a set of independent mandatory files. Flattening it into
N unrelated dependencies would report three missing libraries where the author
wrote one dependency with two backups.

One record per **declaration**:

| field | meaning |
|---|---|
| `referrer` / `referrerRelative` / `depth` | the declaring `.wrl` in the walk |
| `declarationIndex` | source order within that document (parse-lifetime only) |
| `name` | the declared node type name |
| `nestedInProto` / `enclosingProto` | ISO 4.5.3 context |
| `base` | `declaring-document` · `context-required` · `unavailable` |
| `status` | the folded group status (below) |
| `candidates[]` | **ordered**, one per written string |
| `range` | the declaration's source span |

and per candidate: `index`, `writtenUrl` (verbatim), `form`, `locator`,
`fragment` (verbatim provenance), `status`, `reason`, `artifactPath`.

**No hidden identity is written anywhere.** `declarationIndex` and the AST node
identity behind it are parse-lifetime only; nothing is stamped into source and no
sidecar state is kept — WD.md §2/§7.

### Group status

Folded from the candidate outcomes, with a stated precedence:

| status | when | rationale |
|---|---|---|
| `retrievable` | any candidate `RETRIEVED` | strongest available fact; a **later** candidate succeeding satisfies the group (4.5.2). Not "resolved". |
| `indeterminate` | any `UNREADABLE_ARTIFACT` / `DECODE_FAILED` / `LIMIT_EXCEEDED` / `AMBIGUOUS_SOURCE` | outranks `missing`: if a candidate could not be read, "missing" claims more than the evidence supports |
| `missing` | any `NOT_FOUND` | a provable absence outranks a policy refusal — it names a concrete, fixable file |
| `not-portable` | any `NOT_RETRIEVED_BY_POLICY` | nothing explored, nothing bundleable |
| `unsupported` | every candidate `UNSUPPORTED_REFERENCE` | conforming forms this substrate cannot fetch |
| `context-required` | nested in a PROTO body | ISO 4.5.3; **no retrieval attempted** |
| `unprovable` | recovery-damaged, or no base | recovery may not manufacture certainty |
| `no-candidates` | provably empty URL list | |

**Every candidate is evaluated and every outcome is kept.** WD1.7-A §15.3: the
fallback walk stops only on `RESOLVED`, which this lane cannot produce, so there
is no winner to record — the record is a list.

---

## 4. ISO 4.5.3 / N12 — the hard gate

N12 (`WD1_7_A_EXTERNAL_PROTO_EVIDENCE.md` §3.1) gives three bases. Two matter
here:

- **case (3)** — the statement is not part of a prototype definition, so the base
  is the file it was read from. B2 uses the declaring document. Retrieval runs.
- **case (1)** — the statement **is** part of a prototype definition, so the base
  is *the file in which that prototype is instantiated*. That is a
  per-instantiation base, unknowable from a per-document scan.

**No nested declaration is ever resolved against the declaring file.** Such a
declaration is reported `base: context-required`, its candidates carry
`status: null` (no retrieval status is invented), and the file it *would* have
resolved to is not packaged on that basis. Guessing here would be a confident
wrong answer — the one failure mode WD.md §7 forbids outright.

Control **M2** applies the mutation directly: forcing `nestedInProto: false` on
the same declaration makes the resolver confidently return
`retrievable` + `lib/hud.wrl`. Production returns `context-required` + `null`.

### Measured prevalence

Measured **through the production module** (`discoverExternProtoGroups`), not a
hand-rolled walk, over P2C's committed boundary-guarded corpus module reused
unmodified (`spikes/wd1-route-semantics/corpus.js`), de-duplicated by **decoded**
text, input fingerprint `d7cb9accb55b60d00218e784929a089e0dffa36f351ec0d26e7dc5988e783941`:

| quantity | value |
|---|---|
| raw discovered paths | 20,545 |
| **unique decoded documents** | **8,246** |
| documents declaring EXTERNPROTO | 1,004 (12.18% of 8,246) |
| documents the parser could not enumerate at all | 0 |
| **EXTERNPROTO declarations** | **1,667** |
| top-level (base = declaring document) | 1,666 (**99.94%** of 1,667) |
| **inside a PROTO body (base = instantiating file)** | **1 (0.06%)** |
| declarations touched by a parser ERROR span → `unprovable` | 26 (1.56%), in 16 documents |
| declarations with no URL list written | 0 |
| declarations with a provably empty URL list | 0 |
| **written candidates** | **2,672** |

Those figures reconcile exactly with WD1.7-A §7 (1,004/8,246 documents; 2,672
candidates), which is the point of quoting the same denominators.

Candidate forms, through B's production classifier (denominator 2,672):

| form | n | % |
|---|---|---|
| `absolute-http` | 1,116 | 41.77% |
| `bare-relative` | 661 | 24.74% |
| `urn` | 513 | 19.20% |
| `root-relative` | 189 | 7.07% |
| `parent-relative` | 145 | 5.43% |
| `dot-relative` | 43 | 1.61% |
| `empty` | 5 | 0.19% |

**One candidate classifies differently from WD1.7-A §7.3, and B is right.** A
reported 41.73% absolute-http / 24.78% bare-relative; B reports 1,116 / 661
instead of 1,115 / 662. The single candidate that moved is
`" http://www.blaxxun.com/vrml/protos/nodes.wrl#HUD"` — written with a **leading
space**. A's spike classifier inspected the raw string and saw no scheme; B trims
first (keeping both `writtenUrl` and `trimmed`, so the trimming stays visible)
and sees the absolute URL that is actually there. Nothing in B2 changed to
produce this; it is the closed B classifier applied to the same corpus.

The 26 `unprovable` declarations are real recovery cases, not false positives.
The largest family is `children EXTERNPROTO BspTree[…]` — an EXTERNPROTO written
as the *value* of a `children` field rather than inside its MFNode array — where
the parser reports `VRML022` and recovery genuinely moves the statement
boundaries. Withholding there is the doctrine working, not a gap.

The single nested case is
`ct-web-archive:homes/Mardi_Gras_Parade-190400/…/xr48k.wrl` — `EXTERNPROTO HUD`
inside `PROTO Avatar`, **zero parser diagnostics**, candidates
`urn:inet:blaxxun.com:node:HUD` and
`http://www.blaxxun.com/vrml/protos/nodes.wrl#HUD`. So N12 is **rare, real and
clean**: not a parser artefact, and not a hypothetical the gate could be dropped
for.

**No retrieval percentage is quoted from the corpus.** Doing so would require
inventing origin mappings for `www.cybertown.com` / `objects.cybertown.com` /
`www.blaxxun.com`, and WD1.7-A §15.1 makes an unmapped origin fail closed by
design. The measurement above is a *declaration-shape* measurement and is
labelled as one.

---

## 5. Retrieval-status mapping

Nothing is collapsed. Each B status keeps its own name and its own consequence:

| B status | group status | package effect |
|---|---|---|
| `RETRIEVED` | `retrievable` | artifact packaged (deduped by absolute path) |
| `NOT_FOUND` | `missing` | **blocks** — `externproto-missing` |
| `NOT_RETRIEVED_BY_POLICY` | `not-portable` | **blocks** — `externproto-not-portable` |
| `UNSUPPORTED_REFERENCE` | `unsupported` | needs-review |
| `AMBIGUOUS_SOURCE` | `indeterminate` | **blocks** — `externproto-indeterminate` |
| `UNREADABLE_ARTIFACT` | `indeterminate` | **blocks** — `externproto-indeterminate` |
| `DECODE_FAILED` | `indeterminate` | **blocks** — `externproto-indeterminate` |
| `LIMIT_EXCEEDED` | `indeterminate` | **blocks** — `externproto-indeterminate` |
| *(withheld)* | `context-required` / `unprovable` / `no-candidates` | needs-review |

`missing` is **not** the catch-all. A `urn:inet:blaxxun.com:node:HUD` names a
built-in: it is `unsupported`, never a missing file, a broken path or invalid
VRML. An absolute `http(s)` reference is `not-portable` (analogous to the
existing `remote-reference` rule), never "not found" — nothing was explored, so
nothing is absent.

### Policy

The World Project maps to **one archive-local source**, id `world-project`,
rooted at the project root the project already knows, **with no URL prefix** — a
project folder is a directory, not a host, and owns no URL namespace. So:

- an absolute `http(s)` candidate → `NOT_RETRIEVED_BY_POLICY` / `unmapped-origin`
  (never fetched, never host-stripped into a search of the project tree),
- a URL-root-relative `/protos/x.wrl` → `NOT_RETRIEVED_BY_POLICY` /
  `no-url-namespace-for-base`,
- a candidate escaping the root → `NOT_RETRIEVED_BY_POLICY` /
  `outside-source-root` (archive space refuses, it does not clamp).

The root comes from explicit project state. No `process.cwd()`, no repository
root, no home directory, no global archive search, no nearest-match.

---

## 6. Package readiness

**`ready` means, and has always meant:** every *required* file the scan accounted
for is present under the project root at its exact written case and was read and
hashed, so the bundle can be reproduced portably. It has never meant "this world
is semantically valid VRML97". B2 widens *accounted for* to include external
prototype libraries; it does not change the meaning.

The defect fixture can no longer produce `ready`: it produces `blocked` with
`externproto-missing`, while `local.wrl` remains discovered exactly as before.
Control **M4** flips only the group status and shows the verdict follows it — the
rule is live, not decorative.

Every retrieved candidate artifact is packaged, conservatively and on purpose:
which entry of an ordered fallback a browser settles on depends on target
interpretability, a WD1.7-C fact. Packaging only the first would silently break
the author's fallback chain on evidence this lane does not have.

**What readiness still cannot prove, and says so rather than pretending:** that a
retrieved artifact contains the named PROTO, and what that artifact's own
references are. A retrieved library is packaged; its textures and nested `Inline`
children are **not** yet walked. That is traversal, and traversal is WD1.7-C's.

---

## 7. Files

| file | change |
|---|---|
| `src/world-project/externproto-deps.js` | **new** — the whole B2 consumer |
| `src/world-project/asset-graph.js` | per-node EXTERNPROTO scan; `externProtos` / `externProtoErrors` / four stats; header comment corrected (it claimed EXTERNPROTO following) |
| `src/world-project/package-plan.js` | packaged artifacts, `findings.externProtos`, `externProtoReview`, `externProtoErrors`, three blocking codes, report sections; `ready` documented |
| `test/world-project/externproto-deps.test.js` | **new** — 45 focused tests incl. M1–M4 |
| `test/external-proto/architecture-boundary.test.js` | the zero-coupling audit narrowed to a one-entry consumer allow-list + facade-only + one-way assertions |
| `package.json` | `node --check` for the new module |
| `docs/WORLD_PROJECT_ARCHITECTURE.md` | EXTERNPROTO section; stale "follows … EXTERNPROTO" corrected; `ready` and the new blocking codes documented |
| `docs/WRL_FORGE_ROADMAP.md` | stale checkbox corrected; EXTERNPROTO note added |

No new runtime dependency. `x_ite` remains the sole runtime dependency.

---

## 8. Open risks

**NON-BLOCKING**
- `buildAssetGraph` now parses each walked `.wrl` (bounded by `maxWrlNodes`, 200
  by default). Discovery could not come from anywhere else without creating a
  second grammar.

**DEFERRED TO WD1.7-C**
- A retrieved library's **own** references are not walked, so a bundle can still
  omit a texture that only an external PROTO library uses. Discovering the
  library was the defect; traversing into it is dependency traversal.
- No claim that a retrieved artifact contains the named PROTO. `#fragment`
  lookup, the 4.9.3 first-PROTO rule, `TARGET_PROTO_*` and cycle detection are
  all absent by design.
- `context-required` declarations stay unresolved until instantiation context
  exists. At 1/1,667 this blocks nothing measurable today.

**DEFERRED TO THE STALE-DOCUMENT LANE**
- `SAFE_WRLFORGE_RESEARCH_HANDOFF.md` licensing history, the reverse-engineering
  viewing policy, the custom-renderer rationale, and unrelated historical
  planning docs (WD1.7-A §21, S1–S5) are untouched here.
