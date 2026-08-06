# WD1.4 — stable node identity prototype

**Throwaway research prototype and architectural gate. Not production code.**

Nothing under `src/`, `renderer/`, or `qa/` requires anything in this directory, and
nothing here is wired into the application. The lane exists to answer one question
before any visual-authoring UI is designed:

> Can WRL Forge preserve a node selection across realistic edits with **zero wrong
> anchors**?

A selection may be lost. A selection may be reported as ambiguous. The system may
say it cannot prove identity. It may **never** confidently select a different node.
One wrong anchor fails the strategy that produced it.

Read `REPORT.md` for the findings and the recommendation. This file explains how the
harness is put together and how to re-run it.

## Running it

```sh
# The spike's own tests (83). Not part of `npm run check` — see "Isolation" below.
node --test spikes/wd1-node-identity/test.js

# The full run. Writes results.json / metrics.md / perf.json under out/.
node --max-old-space-size=6144 spikes/wd1-node-identity/run.js

# A fast smoke run over a small sample.
node spikes/wd1-node-identity/run.js --quick --files=8 --nodes=2 --no-perf
```

Flags: `--files=N`, `--nodes=N`, `--out=DIR`, `--no-perf`, `--quick`.

The `--max-old-space-size` bump is a convenience for the largest corpus roots, not a
requirement of the algorithm — corpus loading streams (see below).

## The document model this lane assumes

Unchanged from WD1.1/WD1.2, and deliberately not revisited here:

* **The exact source text buffer is the canonical document.**
* Tokens, AST, source map, scene tree, semantic indexes and any future inspector or
  viewport state are **derived, disposable projections**.
* Identity is therefore something that must be *proven from the current parse*, never
  something stored in the document.

Consequently the spike introduces **no** CST, **no** AST-to-text serializer, **no**
whole-document regeneration, **no** synthetic ids written into source, **no** identity
comments, **no** sidecar metadata, and **no** second buffer. It only ever reads a
parse and applies span patches through the accepted WD1.2 algebra.

## Files

| file | role |
| --- | --- |
| `corpus.js` | Discovers, reads and inventories real VRML across 9 corpus groups. Read-only, boundary-guarded, deterministic. |
| `identity.js` | The **candidate** strategies (A1, A2, B, C, D, E). May not see the oracle. |
| `oracle.js` | The **correctness oracle**. May not see the candidates. |
| `scenarios.js` | The 30 deterministic edit scenarios and their expectation model. |
| `transaction.js` | The Tier 1 transaction-integrity contract that gates strategy D. |
| `session.js` | Parse sessions and the harness parse-identity invariant. |
| `report.js` | Metric aggregation and deterministic markdown/JSON rendering. |
| `run.js` | The driver: sample → select → edit → reparse → resolve → classify → report. |
| `test.js` | 83 tests, mostly about the harness rather than the strategies. |
| `fixtures/` | Spike-authored VRML97 written for this lane. Copied from nothing. |
| `REPORT.md` | The findings, the wrong anchors, and the recommendation. |
| `out/` | Generated artifacts. `results.json` and `metrics.md` are deterministic; `perf.json` is not. |

## The four things that make the result trustworthy

### 1. Candidate/oracle independence

The safety claim is worthless if the candidate can see the answer. Independence is
enforced structurally, not by convention:

* `identity.js` **must not** `require` `oracle.js` or `scenarios.js`, and never
  receives a scenario expectation. Its entire contract is
  `createDescriptor(strategy, originalIndex, entry)` and
  `resolve(strategy, descriptor, newIndex, { edits })`.
* `oracle.js` **must not** `require` `identity.js`, does its **own** `ast.walk` of the
  reparsed tree, and never calls `mapOffset`/`mapRange`. That last point matters
  specifically: strategy D is *built* on WD1.2 offset mapping, so an oracle that used
  the same arithmetic would make D correct by construction.
* `test.js` proves both — by scanning the source with comments stripped, **and** by
  loading `identity.js` in a clean child process and asserting the resulting
  `require.cache` contains neither module.
* `classify()` is the only function that sees a candidate result, and by then the
  expected node is already fixed.

The oracle establishes an expected node only when **two independent proofs agree** —
the exact post-edit span *and* the exact post-edit source text — and only when exactly
one node in the reparsed tree satisfies both with the right node type. Anything else
is reported as `oracle-unresolved` and is **excluded from every rate**, never counted
as a success.

### 2. The parse-identity invariant (enforced, not merely documented)

`classify` compares candidate to oracle by **object identity**. Both sides must
therefore come from the **same** parse of the edited text: two parses of identical
text produce structurally equal but non-identical trees, so a cross-parse comparison
reports *every* strategy as `wrong`. That is the worst possible failure mode here —
a silent 100% failure that looks exactly like a genuine safety finding. It bit this
harness for real during development.

It is now an executable invariant rather than a comment:

* Every parse is wrapped by `session.createSession(text, parse(text))`, which assigns
  a spike-local id from a monotonic counter (no clock, no randomness, nothing written
  into document source).
* `identity.buildIndex(session)` carries that id, and **every** result returned by
  `identity.resolve` is stamped with the index's session id.
* `oracle.establish(expectation, session, nodeType)` tags its result the same way.
* `oracle.classify` calls `session.assertSameSession` **before forming any verdict**
  and throws a structured `HarnessError` (`harness/mixed-parse-session`) rather than
  returning a plausible-looking lie. Comparing a tagged result against an untagged one
  throws `harness/missing-parse-session`.

Two results that both carry no session are permitted, so unit tests can still exercise
the classification truth table with synthetic objects.

`test.js` proves the invariant by deliberately mixing two parses of identical text and
asserting the harness *rejects the comparison* instead of reporting wrong anchors.

### 3. The transaction-integrity contract (Tier 1 gate on strategy D)

Strategy D re-anchors by mapping the selected node's old span forward through a set of
edits. That is safe **only** if those edits are exactly the edits that turned the exact
old canonical text into the exact new canonical text. Given a stale, partial, foreign or
mismatched edit set, D's arithmetic is still perfectly self-consistent — it just
describes a document that does not exist, and it will confidently return a node.

The original spike measured D under the implicit assumption that the edit set was always
truthful, because the harness generated both. A production caller cannot be trusted to
keep that assumption, so `transaction.js` makes it executable and fails closed:

1. **base identity** — the text the anchor was created against is the text being edited
   (`base-text-mismatch`);
2. **structural validity** — ranges are integers, ordered, in-bounds, non-overlapping
   (`edit-set-invalid`);
3. **application** — WD1.2 `applyEdits` accepts the set (`edit-apply-failed`);
4. **exact result** — applying it reproduces the supplied new text *byte for byte*
   (`result-text-mismatch`), with `empty-edit-set-for-changed-text` called out separately
   because "I made no edits" against changed text is the signature of a caller that lost
   its transaction log.

Only a receipt clearing all four permits D to resolve. `identity.resolve('D', …)`
requires `ctx.transaction` to be a **verified** receipt — a bare `ctx.edits` is refused,
because an unverified edit set is precisely the untrustworthy input this exists to reject.
Rejections are structured values (`{status, reason, detail, edits: null}`), never an
unclassified throw.

`test.js` covers ten negative cases — one-character base drift, one-character result
drift, a missing edit, a wrong range, wrong inserted text, edits from another document,
a stale set, an empty set for changed text, swapped old/new texts, and a set that
validates but does not produce the supplied text. Each is asserted twice: that
`verify` rejects it with the right reason, and that **strategy D refuses to resolve**.

### 4. Determinism

One recorded seed (`WD14-node-identity-2026`) and no clock, no PRNG, no locale
collation, and no reliance on filesystem traversal order:

* File sampling is **content-addressed** — files sort by `sha256(SEED|id)`. A
  directory listed in a different order produces the same sample.
* Ordering everywhere uses an explicit codepoint comparator (`corpus.byCodepoint`),
  never `String.prototype.localeCompare`.
* Node selection is category-first then stride-sampled over a source-ordered index.
* `results.json` and `metrics.md` contain no timestamp, no timing and no absolute
  path. Two runs are compared byte-for-byte.
* `perf.json` holds wall-clock and heap figures, is therefore **not** deterministic,
  and is deliberately excluded from that comparison.

## Corpus handling

Discovery walks 9 groups: `spike-authored` (this directory's own `fixtures/`), 2 in-repo
(`test/fixtures`, `spikes/xite-mall-fit/fixtures`) and 6 real Cybertown roots inside
`~/Projects/cybertown`. Files are read through the **production** loader
(`src/preview/wrl-source.js`, so gzip is handled exactly as the app handles it) and
parsed with the **production** parser.

**`spike-authored` is always sampled**, outside the deterministic draw and outside the
file limit. It exists to cover shapes the real corpus does not contain — scenario S22
(a PROTO declaration directly inside an MFNode array) matched nothing anywhere in the
sampled corpus — so leaving its inclusion to an arbitrary draw would defeat the point.
The fixtures are tiny and do not meaningfully shift any aggregate. They are authored
for this lane and copied from nothing: not from the corpus, not from White Dune, not
from the RE artifacts, not from any third-party example.

Hard rules, enforced in code rather than by care:

* **Read-only.** No corpus file is ever written, moved or copied into this repo. Every
  edit is applied to an in-memory string.
* **Boundary-guarded.** Paths containing `white-dune`, `white_dune`, `RE-ARTIFACTS`,
  `blaxxun-cs-RE`, `Downloads` or `node_modules` are refused. No White Dune material
  and no proprietary modeling-tool research artifact is opened, and symlinks are
  rejected so a link cannot walk out of a permitted root.
* **Sanitized reporting.** Artifacts identify files as `group:relative/path`. No
  private absolute path is written to any report.
* **Streaming.** `load()` keeps only metadata per file; text and parse trees are
  released once statistics are taken, and `materialize()` re-reads on demand. An
  earlier non-streaming version exhausted a 4 GB heap on this corpus.

## Isolation from production

`scripts/run-tests.js` enumerates named directories under `test/`, so `test.js` here is
**not** collected by `npm run check` and the production test count is unaffected.

This lane adds no dependency, changes no lockfile, adds no package script, and modifies
no production module. It consumes exactly three production modules, all pure and all
read-only: `src/vrml` (parse), `src/vrml/ast.js` (walk), `src/vrml/edit.js` (WD1.2 span
patches), plus `src/preview/wrl-source.js` for gzip-aware reading.

## Deliberately out of scope

Not attempted here, and not to be merged into this lane:

* **WD1.5 scope semantics.** The parser's semantic scope is flat and is documented as
  non-authoritative (PROTO DEF leakage, cross-PROTO duplicate `DEF`, USE-before-DEF).
  Strategy A2 approximates PROTO-lexical scope from the parse tree's own PROTO nesting
  and **fails closed** where that evidence is insufficient; it does not implement scope
  resolution. Where flat scope limits a conclusion, `REPORT.md` says so.
* Any production identity module (`src/vrml/node-path.js`,
  `src/editor/document-transaction.js`, scene-tree code, persistent storage).
* Parser optimization or incremental parsing. The goal is safety evidence, not speed.
* Everything in the authoring roadmap — inspector, viewport, palette, ROUTE graph,
  timeline, PROTO tooling, mesh/UV editing, export profiles.

Identity is standards-first: it is evaluated across ordinary VRML97, real Cybertown
content, vendor/unknown nodes, PROTO-containing files, DEF/USE-heavy scenes and large
worlds. No Cybertown placement, Mall, texture, file-size or export rule is encoded in
it.
