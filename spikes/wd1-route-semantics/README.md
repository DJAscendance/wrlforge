# WD1.5-P2C — reproducible ROUTE-semantics corpus audit

**Read-only evidence harness. Not production code.**

Nothing under `src/`, `renderer/`, `test/` or `qa/` requires anything in this
directory, and nothing here is wired into the application. It exists to make one
claim rerunnable by someone who did not write it:

> Across the whole discovered corpus, WD1.5-P2C's ROUTE resolver produces **0
> wrong node bindings**, **0 wrong endpoint bindings** and **0 confident
> conclusions from an unprovable scope** — measured through the *production*
> code path and graded by an *independent* expected-truth model.

The lane's earlier corpus figures were produced by a harness that lived in a
session scratchpad and vanished with it. Independent QA could not rerun them and
returned `BLOCKED — EVIDENCE INSUFFICIENT`. That is the gap this directory
closes: the harness is the durable artifact, and its output is regenerable.

## Running it

```sh
# The harness's own tests (17). Not part of `npm run check` -- see "Isolation".
node --test spikes/wd1-route-semantics/test.js

# Full audit over the whole discovered corpus. Writes out/audit.json and
# out/metrics.md. Exit code IS the verdict: non-zero if any hard gate fails.
node --max-old-space-size=6144 spikes/wd1-route-semantics/run.js

# Adversarial controls only -- no corpus, ~1 second.
node spikes/wd1-route-semantics/run.js --controls-only
```

Flags: `--files=N` (cap the work, not the discovery), `--out=DIR`, `--no-corpus`,
`--controls-only`, `--quiet`.

The `--max-old-space-size` bump is a convenience for the largest corpus roots,
not a requirement of the algorithm — the sweep streams and releases each
document's tree, graph and scope evidence before moving to the next.

## Files

| file | role |
| --- | --- |
| `corpus.js` | Discovery, decoded-content de-duplication, damage denominators. Read-only, boundary-guarded. |
| `oracle.js` | The **independently authored** expected-truth model. May not see what it grades. |
| `sweep.js` | The **production-path** measurement and the differential against the oracle. |
| `controls.js` | Authored adversarial inputs proving every zero-count detector still fires. |
| `run.js` | Driver: controls → corpus → gates → artifacts. |
| `test.js` | 17 tests, about the harness rather than about VRML97. |
| `out/` | Generated, gitignored, regenerable. `audit.json` is the machine-readable evidence. |

There are **no fixture files**. Every authored input is a string literal inside
`controls.js` or `test.js`, original to this lane and copied from nothing.

## What makes the result trustworthy

### 1. The oracle cannot grade itself

The whole claim is worthless if the expectations come from the code under test.
Independence is enforced structurally, three ways, and `test.js` proves each:

* **A load-time guard.** `oracle.js` throws if the production ROUTE resolver is
  already in `require.cache` when it loads. `run.js` therefore requires the
  oracle **first**, before `sweep.js` pulls the resolver in — which is what makes
  the check a real precondition rather than a foregone one. A test violates it
  on purpose and asserts it throws, because a guard never observed to fire is a
  comment.
* **A clean child process.** `oracle.js` is loaded **alone** and `require.cache`
  is then asserted to contain neither `scope-graph.js` nor `symbols.js`. This
  proves absence *transitively*, through every module the oracle reaches at any
  depth — which a source scan cannot do.
* **An allow-listed require surface.** Every `require(...)` argument in
  `oracle.js` is extracted and compared against an explicit list of three. A new
  dependency fails the test rather than being caught by a careful reader.

What the oracle *may* use is narrow, and all of it is semantically neutral
infrastructure that predates the lane: `parse()` for tokens and an AST, and
WD1.3's committed `node-schema.js` as standards **fact data**. Grading against a
different parser would grade the parser; the schema answers "what fields does
`TimeSensor` have", not "what does this ROUTE mean".

Everything semantic is derived in `oracle.js` from the clause text and
**duplicates the production tables on purpose**: its own PROTO lexical stack and
4.8.4 disjointness, its own "defined before the ROUTE" rule (4.10.2), its own
duplicate-name refusal (4.6.2), its own 4.7/4.8.2 alias expansion, its own
4.10.2 shorthand fallback and R19 precondition, its own direction and exact-type
expectations.

### 2. The comparison is asymmetric, deliberately

WD.md §7's hard gate says an answer may be **lost** and may be declared
**unprovable**, and may never confidently be a **different** one. So:

| production | oracle | counted as |
| --- | --- | --- |
| refuses | binds | **agreement** — a safe refusal is permitted |
| binds X | binds X | agreement |
| binds X | binds Y | **WRONG BINDING** |
| binds X | binds nothing | **WRONG BINDING** — strictly |
| anything | abstains | **uncomparable**, counted by named reason |

An oracle that abstained on everything would also report zero wrong bindings, so
every abstention is counted and reported by reason, and `test.js` pins that the
oracle actually commits to answers on authored inputs.

### 3. The zero-count detectors are proven reachable

`controls.js` holds one authored input per classifier the corpus reports zero or
near-zero for — forward DEF reference, duplicate DEF, both direction errors,
field-as-event, type mismatch, both shorthand directions, the R19 fallback past a
wrong-kind exact spelling, unknown endpoint, EXTERNPROTO unsupported *and*
EXTERNPROTO declared-resolves, nested PROTO isolation, and a recovered scope.
Each **must** make its detector fire. `run.js` runs them **before** the corpus and
says so plainly if one stops firing, because a corpus zero means nothing after
that point.

### 4. Nothing is silently excluded

§10's question is not "does an old number match" but "can a ROUTE whose evidence
is unprovable be quietly dropped out of the comparison?" The audit answers no,
by construction:

* Every parsed ROUTE is partitioned into exactly one `status/reason` bucket for
  each of the **five** questions (source node, destination node, source
  endpoint, destination endpoint, compatibility).
* `run.js` asserts each partition **sums** to the ROUTE total. A ROUTE that
  escaped classification makes the audit **fail**, not shrink.
* A ROUTE the production path declines to project at all is counted separately
  and also fails the audit.
* `confident-from-unprovable` is checked as a **per-scope invariant** rather than
  taken on trust: recovery is a whole-scope property, so a scope that produced
  any `recovered` answer *and* a confident (`resolved`/`unresolved`) one is
  self-contradictory. `missing-name` is excluded, and only that — it is a token
  fact that sits above the gate in every namespace.

  **Scope of that invariant.** It groups a ROUTE's answers under the ROUTE
  statement's own enclosing DEF scope, which is empirically sound for this
  corpus: every observed recovery-bearing endpoint result is a case where that
  same scope is the recovered one. The corpus holds no example of the other
  shape — a clean ROUTE scope whose target's *owning interface scope* is
  independently recovered — which would need a more granular provability key
  **here in the harness** to avoid a false positive. Production is unaffected:
  it already withholds an endpoint whose required interface scope is unprovable.
  The key is deliberately left as-is rather than speculatively re-worked for a
  shape no input exhibits.

### 5. Damage is measured as several things, never one

The historical 576-vs-212 disagreement was recorded as a "measurement-definition
difference" without the definitions ever being written down. So `corpus.js`
computes **three** damage definitions side by side —

| name | means |
| --- | --- |
| `syntax-error` | truncated, depth-capped, or any syntax diagnostic of severity `error` |
| `syntax-any` | truncated, depth-capped, or any syntax diagnostic of any severity |
| `any-diagnostic` | the above, plus `analyze.js`'s flat VRML040–VRML044 advisories |

— each over **both** denominators (raw discovered paths, unique decoded
documents), for **both** files and the ROUTEs they contain. That grid is what
makes the question answerable instead of assertable. `syntax-error` is canonical
and gates the oracle: only an error, a truncation or a depth cap can actually
move a scope boundary, which is the one kind of damage that can manufacture a
wrong lexical answer.

Separately, and not the same measurement:

* **unique documents with ROUTE-relevant recovery** — the document contains at
  least one ROUTE whose own answer rests on recovery;
* **ROUTEs whose own semantic answer depends on unprovable evidence** — the
  safety population, counted per ROUTE rather than per file.

"This file has some diagnostic", "this ROUTE lives in a damaged file" and "this
ROUTE's own required evidence is unprovable" are three different numbers, and the
report keeps them apart.

### 6. The canonical denominator, and the gzip trap

**Unique by DECODED source text.** Files are read through the production loader
(`src/preview/wrl-source.js`, so gzip is handled exactly as the app handles it)
and identity is SHA-256 over the UTF-8 bytes of the decoded text — taken
**after** decompression, never over the raw bytes.

This is load-bearing. A `.wrz` and its plain `.wrl` twin are different bytes and
identical content; an earlier sweep deduplicated raw bytes and reported 6,264
"unique" files and 323,923 ROUTEs, a ~32% overcount. `test.js` pins the rule with
a gzip round-trip.

The **input fingerprint** is a separate thing: SHA-256 over every discovered
`id:size` in codepoint order. The corpus roots are external workspace trees that
change independently of this repository, so a changed count is an *input* change
— which is a different fact from the analysis being unstable, and the artifact
says which happened.

### 7. Corpus handling

Discovery, de-duplication, group interleaving and the boundary guard are
**reused from the committed WD1.4 spike** (`spikes/wd1-node-identity/corpus.js`),
exactly as WD1.5-P1's spike reused them. That spike is not modified and nothing
here writes into it.

* **Read-only.** No corpus file is ever written, moved or copied into this repo.
  `test.js` asserts `corpus.js` calls no filesystem write API.
* **Boundary-guarded.** A path containing `white-dune`, `white_dune`,
  `RE-ARTIFACTS`, `blaxxun-cs-RE`, `Downloads` or `node_modules` **throws**
  rather than being skipped — a silent skip would let a future root change cross
  the GPL boundary quietly (WD.md §1). The guard is applied twice, independently.
* **Sanitized reporting.** Files are identified as `group:relative/path`. No
  private absolute path is written to any artifact; `test.js` asserts it.
* **Deterministic.** Codepoint ordering, no clock, no PRNG, no timing figure in
  any emitted artifact. Two runs over an unchanged corpus are byte-identical.

## Isolation from production

`scripts/run-tests.js` enumerates named directories under `test/`, so `test.js`
here is **not** collected by `npm run check` and the production test count is
unaffected — the same isolation the WD1.4 and WD1.5 spikes have.

This lane adds no dependency, changes no lockfile, adds no package script, and
modifies no production module. It consumes four production modules, all pure and
all read-only: `src/vrml` (parse), `src/vrml/node-schema.js` (WD1.3 fact data),
`src/preview/wrl-source.js` (gzip-aware reading), and — in `sweep.js` and
`controls.js` only, never in `oracle.js` — `src/vrml/scope-graph.js`, the module
under audit.

## Deliberately out of scope

* **Changing P2C semantics.** This is an evidence lane. R19, the refusal to fall
  back past an ambiguous/recovered/unsupported lookup, the whole-ROUTE reverse
  index bar, exact type equality and the EXTERNPROTO asymmetry have all passed
  targeted QA and are measured here, not revised.
* **P4** — diagnostics, compatibility-profile presentation, remediation.
* **WD2** — scene tree, inspector, viewport.
* **The deferred `codeOnly()` regex-literal weakness** in the P2B suite. It
  remains a separate test-hygiene item. `test.js`'s own `stripComments` has the
  same limitation and says so, with an assertion that fails loudly if either
  scanned file ever gains a regex literal.
