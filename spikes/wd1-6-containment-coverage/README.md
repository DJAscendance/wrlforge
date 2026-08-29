# WD1.6-C — containment coverage harness

Reproducible evidence for the WD1.6-C exit gate. Read-only, deterministic,
boundary-guarded, and runnable from this repository alone.

```
node --max-old-space-size=6144 spikes/wd1-6-containment-coverage/run.js
```

Flags: `--files=N` (cap discovered paths), `--out=DIR`, `--no-corpus`,
`--controls-only`, `--quiet`. Output lands in `out/`, which is **gitignored and
regenerable** — the harness is the durable artifact, not its output. The exit
code is the verdict.

## The question, and its denominator

> For **actual child-node placements** in SFNode/MFNode fields, how often can
> `childLegality` return a definitive `LEGAL`/`ILLEGAL` verdict rather than
> withholding one?

The unit is **one child node written into one node-valued field of one parent
node**. A `Transform` with eleven children is eleven placements. A
schema-shaped denominator (field *declarations*) would measure the schema; what
is at issue is whether C reaches the questions real documents actually pose.

Every figure in `metrics.md` carries its denominator. Documents are
de-duplicated by **decoded text**, never raw bytes — a `.wrz` and its `.wrl`
twin are one document, and byte-dedup overcounts (P2C measured ~32%).

## Files

| file | what it is |
| --- | --- |
| `sweep.js` | scene-graph traversal, placement enumeration, counters, reconciliation |
| `controls.js` | eight adversarial mutants over a fixed in-repo fixture |
| `run.js` | driver; writes `out/coverage.json` + `out/metrics.md`; exit code is the verdict |

Discovery, decoding, decoded-text identity, the input fingerprint and the
forbidden-path guard are **P2C's committed `spikes/wd1-route-semantics/corpus.js`,
reused unmodified** — the same arrangement P2C itself used for WD1.4's. No guard
was weakened and no new corpus root was added.

## Two traversal facts worth not re-deriving

1. **Not `ast.walk`.** `ast.walk` descends into a PROTO *interface declaration's
   default value*, and a node written there is not a scene-graph occurrence:
   P2A indexes no type reference for it, so `interfaceSourceOf` throws
   `ESCOPEPARSE`. That is an inherited P2A/WD1.6-B boundary, not C's to widen —
   a default value is a prototype's declared value, not a child placed in a
   parent's field. `forEachSceneNode` therefore walks document statements, PROTO
   *bodies*, and node-valued fields, and nothing else.
2. **A node body's `ROUTE`/`PROTO` statements land in `node.fields`** (WD.md §8).
   Dispatch on `type`, never on position.

## The controls are the point

A coverage script that only counts is not evidence: if a broken `childLegality`
produced the same report, the report proves nothing. Eight mutants — the six
failure modes C is arranged to prevent, plus both terminal flips — are injected
through `sweepDocument`'s `judge` parameter and must each change the harness's
own reported numbers or trip its reconciliation. No production file is edited,
so a control cannot leave a mutation behind.

The fixture's `PointSet { color Material {} }` placement earns its place: a
first draft omitted it, and the *exclusion-completeness-ignored* mutant survived
because `PointSet.color` was only ever reached by a candidate its positive-only
rule accepts. `run.js` now asserts every branch precondition before trusting a
kill.

## Reconciliation

`sweep.reconcile` fails the run when any partition does not sum to the placement
total, and — the safety property the whole lane is arranged around — when an
`ILLEGAL` is produced by anything other than an exclusion-complete rule. That is
checked over the **real corpus**, not only in the focused tests.

## Corpus ILLEGAL is a measurement, not a policy

Real content may be non-conforming, and C may be wrong. Every distinct legality
rule producing `ILLEGAL` is therefore reported with its count and sanitized
example document ids, for adjudication against ISO — never silently tallied.
Document ids are `group:relative/path`; no absolute path is ever emitted.
