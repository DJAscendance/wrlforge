# WD1.5 — scope semantics discovery and design gate

**Throwaway research prototype and architectural gate. Not production code.**

Nothing under `src/`, `renderer/`, `test/` or `qa/` requires anything in this
directory, and nothing here is wired into the application. The lane answers one
question before any scene tree, rename, DEF/USE navigation, ROUTE graph, PROTO
tooling or inspector work begins:

> What exact scope and symbol semantics does WRL Forge need, what can the current
> AST prove, and what is the smallest safe production implementation plan?

Read **`REPORT.md`** for the findings and the recommendation. Read
**`standards-model.md`** for the rules and their clause citations, and
**`current-behavior.md`** for the audit of what production does today. This file
explains how the harness is put together and how to re-run it.

## Running it

```sh
# The spike's own tests (38). Not part of `npm run check` -- see "Isolation".
node --test spikes/wd1-scope-semantics/test.js

# Full run: authored cases + the whole discovered corpus (~80 s).
# Writes results.json / metrics.md / perf.json under out/.
node --max-old-space-size=6144 spikes/wd1-scope-semantics/run.js

# Authored cases only, no corpus, no perf.
node spikes/wd1-scope-semantics/run.js --quick
```

Flags: `--files=N`, `--chars=N`, `--out=DIR`, `--no-corpus`, `--no-perf`,
`--quick`. The `--max-old-space-size` bump is a convenience for the largest
corpus roots, not a requirement of the algorithm — corpus loading streams.

## Files

| file | role |
| --- | --- |
| `standards-model.md` | The VRML97 rules, by clause, each with a confidence grade. |
| `current-behavior.md` | Audit of production behaviour and of what the AST can prove. |
| `scope-model.js` | The **prototype** scope graph. Read-only over a production parse. |
| `cases.js` | The **independently authored** expected-truth cases. May not see the model. |
| `corpus.js` | Corpus discovery and scope inventory. Read-only, boundary-guarded. |
| `run.js` | Driver: grade cases → differential → corpus → render artifacts. |
| `test.js` | 38 tests, mostly about the harness rather than the rules. |
| `REPORT.md` | Findings, disagreements, and the Outcome A/B/C recommendation. |
| `out/` | Generated. `results.json` and `metrics.md` are deterministic; `perf.json` is not. |

There are **no fixture files**. Every authored case is a string literal inside
`cases.js`, original to this lane and copied from nothing.

## What makes the result trustworthy

### 1. The model cannot grade itself

The whole claim would be worthless if the expectations were derived from the code
under test. Independence is enforced structurally, not by convention:

* `cases.js` **requires nothing at all** — not `scope-model.js`, not `run.js`,
  not even Node built-ins. Every status and reason is a bare string literal,
  written by hand from the standard. The duplication against
  `scope-model.js`'s constant tables is the point.
* `test.js` proves it three ways: a source scan with comments stripped, an
  assertion that the literals are present as literals, and loading `cases.js` in
  a **clean child process** whose `require.cache` is then asserted to contain
  neither `scope-model.js` nor `corpus.js`.
* `scope-model.js` is likewise forbidden from requiring `cases.js`.

Corpus observations are held to a *lower* standard on purpose: they are counted
and reported, never promoted to truth. Only the authored cases decide who is
right in the differential table.

### 2. The banned behaviours are absent, by scan and by behaviour

WD1.4's hard gate carries forward unchanged: a tool may lose a target, may report
that it cannot prove one, and may **never** confidently act on the wrong one.

`test.js` asserts that the words `score`, `closest`, `nearest`, `bestMatch` and
`fuzzy` do not appear in `scope-model.js` (comments stripped), and separately
that two candidates yield `ambiguous` with `symbolId: null` and never a node.
A stronger, behavioural version runs over **every** authored case: no resolution
on a non-`resolved` status may carry a symbol.

This includes deliberately **not** implementing the standard's own
closest-preceding rule for duplicate names (ISO/IEC 14772-1 4.6.2). That rule is
real, it is recorded in `standards-model.md`, and implementing it here would put
a ranking function on the exact path WD1.4 banned ranking from. See `REPORT.md`
§7.

### 3. A damaged scope refuses every lexical answer

A partial tree can prove a declaration **exists**. It cannot prove **which scope
owns it** — and scope membership is the whole question a `USE` asks. Parser
recovery *moves scope boundaries*: an unclosed PROTO swallows the following
top-level statements into its body, so the absorbed scope sees a declaration set
that never existed and is simultaneously blind to the real outer one.

So in a damaged scope every lexical answer — positive, negative and unique alike
— is withheld as `recovered`. Schema facts (a built-in node type, a built-in
event) are exempt, having no scope dependency. Ambiguity stands, because it binds
nothing.

An earlier revision claimed the weaker rule that only *negative* results need
downgrading. An external review challenged it and the claim did not survive: a
case exists where an unclosed PROTO turns a genuinely `ambiguous` document into
one confident binding. `test.js` pins the corrected rule and that regression.

Syntax errors are attributed to the **innermost** containing scope, not to every
enclosing one. Without that, one stray error anywhere would mark the document
scope recovered and suppress every honest "not declared" answer in the file.

### 4. Determinism

One recorded seed (`WD15-scope-semantics-2026`) and no clock, no PRNG, no locale
collation, and no reliance on filesystem traversal order:

* Discovery, ordering and group interleaving are reused verbatim from the
  committed WD1.4 spike, which already solved them deterministically.
* Every emitted list is sorted by source offset with an explicit codepoint
  tiebreak — never `localeCompare`.
* `results.json` and `metrics.md` contain no timestamp, no timing and no absolute
  path; `test.js` asserts both. Two runs are compared byte-for-byte.
* `perf.json` holds wall-clock and heap figures, is therefore **not**
  deterministic, and is deliberately excluded from that comparison.

**The inputs are not frozen even though the analysis is.** The corpus roots are
external workspace trees that change independently of this repository, and they
changed **twice during this lane** (14,204 → 14,205 discovered files). Every run
therefore records a `fingerprint`: a SHA-256 over every discovered `id:size`. If
it changes, the input changed — which is a different thing from the analysis
being unstable, and the artifact now says which happened.

## Corpus handling

Discovery, de-duplication, group interleaving and the boundary guard are
**reused from the committed WD1.4 spike** (`spikes/wd1-node-identity/corpus.js`)
rather than reimplemented. That spike is not modified and nothing here writes
into it. Files are read through the production loader
(`src/preview/wrl-source.js`, so gzip is handled exactly as the app handles it)
and parsed with the production parser.

Hard rules, enforced in code rather than by care:

* **Read-only.** No corpus file is ever written, moved or copied into this repo.
  `test.js` asserts `corpus.js` calls no write API at all.
* **Boundary-guarded.** Paths containing `white-dune`, `white_dune`,
  `RE-ARTIFACTS`, `blaxxun-cs-RE`, `Downloads` or `node_modules` **throw**
  rather than being skipped — a silent skip would let a future root change cross
  the boundary quietly. The guard is applied twice, independently: once inside
  WD1.4's discovery and again on every path this module opens.
* **Sanitized reporting.** Files are identified as `group:relative/path`. No
  private absolute path is written to any artifact.
* **Streaming.** Text, tree and scope graph are released once counters are taken.

## Isolation from production

`scripts/run-tests.js` enumerates named directories under `test/`, so `test.js`
here is **not** collected by `npm run check` and the production test count is
unaffected.

This lane adds no dependency, changes no lockfile, adds no package script, and
modifies no production module. It consumes four production modules, all pure and
all read-only: `src/vrml` (parse), `src/vrml/ast.js` (the `NODE` discriminators),
`src/vrml/node-schema.js` (WD1.3 field data), and `src/preview/wrl-source.js`
for gzip-aware reading.

## Deliberately out of scope

* **Any production scope module.** No `src/vrml/scope-graph.js`, no
  `src/vrml/symbols.js`. The design for them is in `REPORT.md` and
  `docs/white-dune-2026/WD1_5_SCOPE_SEMANTICS_PLAN.md`; the implementation is a
  separate approved lane.
* **Changing production identity.** WD1.4's contract is accepted and untouched.
  How a scope resolver should eventually *improve* Tier 2 is recorded, not built.
* **Run-time name scope (4.4.6)**, cross-file resolution, `Inline` traversal, and
  incremental scope analysis.
* **WD2 scene-tree work** — inspector, viewport, palette, ROUTE graph, timeline,
  PROTO tooling, export profiles.

Scope is standards-first: it is evaluated across ordinary VRML97, real Cybertown
content, vendor and unknown nodes, PROTO-heavy files, Script-heavy files and
recovered parses. No Cybertown placement, Mall, texture, file-size or export rule
is encoded in it, and Cybertown/Blaxxun permissiveness is classified as
compatibility rather than promoted into the language rules.
