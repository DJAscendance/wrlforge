# WD1.6-B — projection equivalence

Measures the one claim WD1.6-B's design rests on:

> `effectiveInterfaceOf` reaches a node's interface through the **same** code the
> shipped `IS` (WD1.5-P2B) and ROUTE (P2C) endpoint resolutions reach it through.

§5.4 of `docs/white-dune-2026/WD1_6_SEMANTIC_CONSUMER_API_PLAN.md` states that as
a rule. A rule that is only stated is a comment; this measures it.

## Reproduce

```sh
node --test spikes/wd1-6-interface-projection/test.js          # 11 harness tests
node --max-old-space-size=6144 spikes/wd1-6-interface-projection/run.js
node spikes/wd1-6-interface-projection/run.js --files=200 --quiet
```

Flags: `--files=N` caps the **work**, not discovery, so a capped run is visibly
capped and the fingerprint still describes the whole input set. `--out=DIR`,
`--quiet`. **The exit code is the verdict** — non-zero on any mismatch.

Artifacts land in the gitignored `out/`: `equivalence.json`, `equivalence.md`.

## Inputs and de-duplication

Discovery, the boundary guard and the de-duplication rule are **not
reimplemented**. `spikes/wd1-route-semantics/corpus.js` is required read-only and
supplies all three unchanged:

- **read-only**, in place, outside the repo; nothing is copied in;
- a **forbidden path throws** (`white-dune`, `white_dune`, `RE-ARTIFACTS`,
  `blaxxun-cs-RE`, `Downloads`, `node_modules`) — never skipped, because a silent
  skip would let a root change cross the GPL boundary quietly;
- **de-duplicated by DECODED text**, never raw bytes: a `.wrz` and its `.wrl`
  twin are one document, and byte-dedup overcounted an earlier sweep by ~32%;
- sanitized `group:relative/path` identifiers, never an absolute path;
- deterministic — codepoint ordering, no clock, no PRNG.

An `inputFingerprint` over the discovered set is reported, so corpus drift is
visibly an **input** change rather than an unstable analysis. The corpus roots are
external trees that change independently: this sweep saw **20,545 raw paths /
8,246 unique decoded documents**, against P2C's 14,226 / 4,466 at its measurement.
Different denominator, same corpus convention — which is exactly why a figure is
never quoted here without one.

## What is compared, and at what level

At the **lowest available acquisition level**, never against a verdict. The goal
is interface-**acquisition** equivalence; Table 4.4, ROUTE direction legality and
type matching are downstream policy and are deliberately out of scope.

| leg | shipped side | projection side |
|---|---|---|
| IS | `isConnectionVerdict(...).endpoint` — minted from acquisition *before* Table 4.4 | `byName[writtenName]` |
| ROUTE | `routeEndpointFor(...)` — the record acquisition produced, *before* the direction rule | `byName[normalized]` |
| authority | `acquireEndpointFor(graph, node, name)` | every enumerated `byName` entry |

The third leg matters: without it a pass could mean the authority merely agreed
with itself. Legs 1 and 2 prove the *shipped* paths agree with the projection.

Compared fields: `origin`, `effectiveName`, `access`, `type`, and `declRange`.
`declRange` is compared **only for a declared endpoint** — a clause-6 built-in is
declared nowhere in the file, so acquisition reports the *reference's* range while
the projection honestly reports `null`; comparing those compares two different
questions. The authority leg additionally compares `status`, `reason`, `form` and
`viaAlias`.

### ROUTE shorthand normalization

A ROUTE reports its endpoint under the name the author **wrote**, even when
4.10.2's fallback fired and a different declaration answered. The projection has
no such rule — it enumerates declarations and their 4.7 alias names, and 4.10.2
shorthand runs in the opposite direction.

So the harness reconstructs ROUTE's own spelling before looking the name up.
That normalization lives **here**, in the measurement: `interface-query.js` never
manufactures a shorthand binding, and nothing in `compare.js` is imported by
production. `test.js` proves the un-normalized comparison would report a false
mismatch, so the normalization is observed rather than assumed.

## Uncomparable cases are counted, never dropped

- **Script-form `IS`** — `field SFBool run IS go` *declares* its own endpoint, so
  there is no lookup on a node to agree or disagree with. Uncomparable by
  construction, not by omission.
- **no endpoint acquired** — acquisition returned no record, bucketed by status.
- **ROUTE node half unresolved** — the node binding failed, so the endpoint
  question was never asked.

## Result

| | |
|---|---|
| raw paths discovered | 20,545 |
| unique decoded documents examined | 8,246 |
| node occurrences in those documents | 2,098,360 |
| node occurrences projected | 260,516 |
| declaration members enumerated | 1,430,202 |
| written-name bindings enumerated | 2,738,796 |
| IS endpoints compared | 12,961 |
| ROUTE endpoints compared | 806,416 |
| bindings compared to the shared authority | 2,738,729 |
| **total comparisons** | **3,558,106** |
| **mismatches** | **0** |

Uncomparable: 26,436 ROUTE endpoints not acquired · 16,068 Script-form `IS` ·
1,366 + 58 + 31 `IS` with no endpoint acquired (unresolved / invalid / recovered).

`0 mismatches` is a **measured result for this corpus at this fingerprint**, not a
universal proof. What makes it durable is that the projection is built *from* the
authority rather than beside it: enumeration generates candidate names and every
binding answer comes back through `acquireEndpointFor`.

## Self-tests first

`test.js` runs 11 authored cases before any corpus path is opened, and every
negative detector is proven to fire — a wrong access, origin, name, type and
`declRange`; an absent and a non-resolved binding; a wrong `form`, `viaAlias`,
`status` and `reason`; the boundary guard; and the false mismatch an
un-normalized shorthand comparison would produce. A detector never observed to
fire is an assertion, not evidence.

`test.js` is **not** collected by `npm run check` — `scripts/run-tests.js`
enumerates named directories under `test/` — so the production test count is
unaffected.
