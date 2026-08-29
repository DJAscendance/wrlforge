# `spikes/wd1-7-external-proto` — WD1.7-A evidence harness

Read-only, deterministic, boundary-guarded measurement of how EXTERNPROTO is
actually used in the Cybertown/blaxxun corpus. Supports
`docs/white-dune-2026/WD1_7_A_EXTERNAL_PROTO_EVIDENCE.md`.

**This is not a resolver, and must never become one.** See "Retrieval is not
resolution" below.

## Run

```bash
node spikes/wd1-7-external-proto/controls.js            # 8/8 controls must fire
node --max-old-space-size=6144 spikes/wd1-7-external-proto/run.js
node spikes/wd1-7-external-proto/run.js --files=600     # fast, capped
node spikes/wd1-7-external-proto/run.js --controls-only
```

Flags: `--files=N`, `--out=DIR`, `--controls-only`, `--quiet`.
Output goes to `out/` (gitignored, regenerable). **The harness is the durable
artifact, not its output.**

The **exit code is the verdict**: non-zero if any control stops firing or any
counted partition fails to reconcile arithmetically.

## Modules

| file | role |
|---|---|
| `extract.js` | **Pure.** Parse result → EXTERNPROTO declarations, URL-candidate classification, ISO 4.9.3 selectable-PROTO list. No `fs`, so it cannot become a filesystem lookup. |
| `sweep.js` | Corpus reuse, probe-key derivation, counters, the ISO 4.9.2 directional subset check. |
| `controls.js` | 8 adversarial controls. Each states an invariant **and** the mutant that breaks it. |
| `run.js` | Driver: two-pass sweep, reconciliation, `out/evidence.json` + `out/metrics.md`. |

## Boundary

Discovery, decoding, decoded-text de-duplication and the forbidden-path guard are
P2C's committed `spikes/wd1-route-semantics/corpus.js`, reused **unmodified**.
That guard **throws** — never silently skips — on any path containing
`white-dune`, `RE-ARTIFACTS`, `blaxxun-cs-RE`, `Downloads` or `node_modules`.
Control **C1** asserts it is live on all three prohibited markers independently,
so weakening it fails the run instead of quietly widening the boundary.

Nothing here writes to a corpus tree, copies corpus content into this repository,
or emits an absolute path: records are sanitized `group:relative/path` ids.

## Denominators

Three, and they are not interchangeable — quoting a figure against the wrong one
is how P2C's ROUTE count was inflated 2.3× before it was caught:

- **discovered raw paths** — every file the guarded walk finds.
- **unique decoded documents** — SHA-256 over the *decoded* text. A `.wrz` and its
  `.wrl` twin are **one** document; byte-level dedup overcounted P2C by ~32%.
- **written URL candidates** — individual strings inside EXTERNPROTO URL lists.

Every emitted percentage carries its numerator and denominator.

## Retrieval is not resolution

The probe is **deliberately generous**: longest-suffix, case-insensitive,
host- and scheme-blind, across every discovered path. That makes its output an
**upper bound** — a reference it cannot find is definitively dead in this
archive; a reference it finds is *merely a candidate*.

Its matching rule is exactly the "first filesystem match wins / nearest path
wins" heuristic that WD1.7 production is forbidden to use. It lives here, in
`spikes/`, behind an exported `GENEROUS_PROBE_POLICY` marker, precisely so that
the measurement can be generous while production stays narrow.

In particular the probe is **host-blind**, which production must not be:
`www.cybertown.com`, `objects.cybertown.com` and `www.blaxxun.com` are distinct
namespaces that the probe deliberately conflates to produce an upper bound.
Production maps each origin explicitly and fails closed on an unmapped one — see
§15.1 of the design document. The probe's ambiguity figure is therefore
**upper-bound discovery ambiguity**, not intrinsic runtime ambiguity.

**A capped run (`--files=N`) builds its target index from the same N paths**, so
unswept targets score as "not found". The report prints a non-comparability
banner whenever `swept < discovered`. Only a full sweep bounds dead references.

## Determinism

Codepoint ordering throughout · no clock · no PRNG · no locale collation · no
network. The corpus roots are external workspace trees that change independently,
so every run records an **input fingerprint** over the discovered file set: a
changed number is visibly an *input* change rather than an unstable analysis.
