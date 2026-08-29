# WD1.6-D — structured semantic findings over the real corpus

Reproducible, read-only, deterministic evidence for the WD1.6-D projection.

```
node --max-old-space-size=6144 spikes/wd1-6-findings-coverage/run.js
node spikes/wd1-6-findings-coverage/run.js --controls-only   # no corpus needed
node spikes/wd1-6-findings-coverage/run.js --files=800        # capped smoke run
```

`out/` is gitignored and regenerable. **The harness is the durable artifact, not
its output** — WD1.5-P2C's `BLOCKED — EVIDENCE INSUFFICIENT` verdict came from a
hard gate whose measurement could not be rerun.

## What it measures, and why each measurement exists

WD1.6-D is a projection. It re-measures nothing P2B or P2C already proved: their
binding correctness was graded at zero wrong bindings over 23,246 `IS`
statements and 245,540 ROUTEs, and D copies those verdicts verbatim. Re-deriving
them through a new accessor would spend a corpus run to re-learn a known fact.

Four questions are genuinely new, and each is a gate the run's **exit status**
depends on:

| # | question | denominator | required |
|---|---|---|---|
| Q1 | does `findingsForDocument` ever throw on real content? | unique decoded documents | 0 |
| Q2 | did every ISO classification come from the committed table rather than `isoFor`'s fallback? | findings produced | 0 fallbacks, 0 mismatches |
| Q3 | does any finding contradict the verdict it was projected from? | findings with a re-askable reference | 0 |
| Q4 | does any finding carry a presentation field, or a populated compatibility profile? | findings produced | 0 |

Q2 has a static half that is stronger than any corpus run —
`test/vrml/semantic-findings.test.js` asserts the ISO table is **total** over
`REASON`. What the corpus adds is the dynamic half: whether real content lands on
a reason that is classified `NOT_STATED` by omission rather than by decision.

The distributions (by code, by ISO result, by confidence, by code/reason) are
reported **for reading, never gated on**. Real Cybertown content is
non-conforming in places earlier lanes adjudicated as normatively correct
findings, and a corpus count is a measurement, not a verdict on anybody's file.

## Adversarial controls

Four mutants are compiled **in memory** — the repository file is never written —
and each must move a named gate away from its honest value. A control that stops
firing fails the run.

| mutant | defect it proves the harness can catch |
|---|---|
| `status-collapse` | a recovered/ambiguous answer reported as a plain `unresolved`, so a consumer can no longer suppress an untrustworthy finding |
| `hard-coded-iso` | a producer deciding the ISO axis itself, so an unprovable answer accuses the document of non-conformance |
| `presentation-leak` | a severity arriving in the semantic record, so every consumer inherits an invisible policy |
| `authority-bypass` | reporting a containment answer WD1.6-C withheld — a second containment engine |

## Boundary

Discovery, decoding, decoded-text de-duplication and the forbidden-path guard are
`spikes/wd1-route-semantics/corpus.js`, reused **unmodified**. Nothing here
writes to a corpus tree, copies corpus content into this repository, or reads a
White Dune / `RE-ARTIFACTS` path — the inherited guard **throws** on one rather
than skipping it. Reported identifiers are sanitized `group:relative/path`; no
absolute path enters any artifact. No clock, no PRNG, codepoint ordering
throughout.

De-duplication is by **decoded text**, never raw bytes: a `.wrz` and its `.wrl`
twin are one document. The unique-document denominator is the same one WD1.6-C
used, which is why the containment cross-check below is exact.

## Result at the WD1.6-D baseline

Corpus input fingerprint
`d7cb9accb55b60d00218e784929a089e0dffa36f351ec0d26e7dc5988e783941` —
20,545 discovered paths, 12,284 duplicate-content paths, 15 read errors,
**8,246 unique decoded documents**, 410 of them damaged.

```
220,359 findings over 8,246 documents
  query throws          0 / 8,246 documents
  ISO fallbacks         0 / 220,359 findings
  ISO mismatches        0 / 220,359 findings
  contradictions        0 / 217,727 re-checked
  shape violations      0 / 220,359 findings
  compatibility set     0 / 220,359 findings
  controls              4 / 4 caught
```

**Cross-checks against closed lanes, on the same 8,246-document denominator:**

| figure | earlier lane | WD1.6-D | agreement |
|---|---:|---:|---|
| containment `ILLEGAL` placements | 1,139 (WD1.6-C) | 1,139 | exact |
| ROUTE type mismatches | 1 (P2C) | 1 | exact |
| ROUTE direction violations | 0 (P2C) | 0 | exact |
| `IS` in an interface declaration list | 20 (P2B) | 20 | exact |

Two P2B-era figures differ, in **opposite directions**, and the difference is a
denominator one rather than a disagreement: P2B's counts predate the canonical
decoded-text denominator this harness and WD1.6-C share.

| figure | P2B | WD1.6-D |
|---|---:|---:|
| Table 4.4 access violations | 1,481 | 1,692 |
| `exposedField` in a Script interface | 1,577 | 1,457 |

They are not evidence of a projection error: the contradiction gate re-asks the
substrate for every one of these findings and disagreed 0 times in 217,727
re-checks, so D's numbers **are** the substrate's numbers for this corpus.

## The one design observation this run produced

**86.96% of findings (191,614) carry `confidence: recovered`, and 80.7% of all
findings are a single reason — `node-type-not-bound/scope-recovered`.** They come
from 410 damaged documents, where a moved scope boundary makes every node
occurrence individually unprovable; the worst single document produces 7,201
findings.

That is correct behaviour and D does not suppress it: WD1.6-D is forbidden from
deciding visibility, and `confidence` exists precisely so a consumer can. It is
recorded here because it is the load-bearing input to **P4's** first policy
decision, and a one-line filter (`f.confidence !== STATUS.RESOLVED`) is
demonstrated in the P4 reference consumer in
`test/vrml/semantic-findings.test.js`.
