# WD1.4 — stable node identity prototype: findings

**Status: complete, uncommitted. Recommendation: the two-tier hybrid identity
contract in §C7 — Strategy D for verified same-transaction re-anchoring, Strategy A2
unique DEF for persistence across unknown edits or reloads.**

Throwaway research prototype and architectural gate. No production module was added
or changed. See `README.md` for how the harness works and how to re-run it.

Sections 1–28 are the original findings. **Section 29 is superseded** — read the
**Closure Addendum (§C1–C9)** at the end for the binding recommendation, the S22
coverage closure, the transaction-integrity contract, the parse-identity invariant,
and the independent-review adjudication.

---

## 1. Git starting truth

| fact | value |
| --- | --- |
| branch | `main` |
| local HEAD | `94971a101e26f58369c939b97b3437daa7af819f` |
| live `origin/main` | `94971a101e26f58369c939b97b3437daa7af819f` |
| tracking | `origin/main`, ahead 0 / behind 0 |
| working tree | clean except the untracked `spikes/wd1-node-identity/` |
| worktrees | one primary worktree |

Both local HEAD and live remote HEAD equalled the expected commit before any file was
created.

## 2. Baseline test totals

`npm run check` before editing: **719 tests, 719 pass, 0 fail.**

## 3. Spike files created

All under `spikes/wd1-node-identity/`, all untracked:

| file | lines | role |
| --- | ---: | --- |
| `README.md` | — | harness design, isolation rules, how to run |
| `REPORT.md` | — | this document |
| `corpus.js` | — | discovery, boundary guards, streaming load, inventory |
| `identity.js` | — | candidate strategies A1, A2, B, C, D, E |
| `oracle.js` | — | correctness oracle and classification |
| `scenarios.js` | — | 30 deterministic edit scenarios + expectation model |
| `transaction.js` | — | Tier 1 transaction-integrity contract (closure) |
| `session.js` | — | parse sessions + parse-identity invariant (closure) |
| `report.js` | — | metric aggregation, deterministic JSON/markdown |
| `run.js` | — | driver |
| `test.js` | 83 tests | harness and adversarial tests |
| `fixtures/proto-in-mfnode-array.wrl` | — | spike-authored S22 coverage fixture (closure) |
| `out/results.json`, `out/metrics.md` | — | deterministic artifacts |
| `out/perf.json` | — | non-deterministic timing artifact |

Exact byte sizes are listed in §C9.

No production file was modified. No dependency, lockfile or package script changed.

## 4. Corpus roots (sanitized labels)

Eight groups: two in-repo, six real Cybertown roots inside `~/Projects/cybertown`.
Reports identify files as `group:relative/path`; no private absolute path appears in
any artifact.

`repo-fixtures`, `repo-spike-fixtures`, `ct-mall-items`, `ct-web-archive`,
`ct-mall-archive`, `ct-campus`, `ct-ng`, `ct-dev-assets`.

## 5. Corpus inventory

14,199 VRML files discovered; 2,286 unique parseable files loaded; 11,913 skipped.

| group | in repo | discovered | parsed | plain | gzip | recovered | AST nodes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| repo-fixtures | yes | 60 | 59 | 53 | 6 | 6 | 37,989 |
| repo-spike-fixtures | yes | 27 | 20 | 19 | 1 | 0 | 605 |
| ct-mall-items | no | 258 | 233 | 179 | 54 | 16 | 3,936,783 |
| ct-web-archive | no | 10,166 | 808 | 805 | 3 | 10 | 9,289,125 |
| ct-mall-archive | no | 2,765 | 749 | 435 | 314 | 14 | 11,516,136 |
| ct-campus | no | 656 | 218 | 58 | 160 | 22 | 3,883,465 |
| ct-ng | no | 265 | 197 | 127 | 70 | 32 | 3,386,840 |
| ct-dev-assets | no | 2 | 2 | 1 | 1 | 0 | 136,663 |

Skips: `duplicate-content` 7,947 · `char-budget-exhausted` 3,951 · `gzip-error` 10 ·
`over-size-cap` 4 · `decode-empty` 1. No `parse-error` skips — the parser completed
every file it was given, some with diagnostics (see "recovered" above).

**Coverage is deliberately not exhaustive**, and this is a real limit on the
conclusions. The 220 MB char budget was exhausted, so 3,951 files were never parsed.
`ct-web-archive` in particular contributed 808 of its 10,166 discovered files. This
report does **not** claim exhaustive Cybertown coverage.

> **Defect found and fixed during this lane.** The first full run spent the budget in
> a single pass over entries sorted globally by `group:path`. `ct-campus` and
> `ct-mall-archive` consumed all 220 MB and **four groups parsed nothing at all** —
> including both in-repo fixture groups the brief names as the starting corpus.
> `corpus.interleaveByGroup` now interleaves round-robin across groups so budget
> exhaustion truncates every group's tail evenly. Two regression tests pin it. Every
> number in this report comes from the corrected run.

## 6. AST and DEF/USE statistics

| metric | value |
| --- | ---: |
| characters parsed | 230,686,716 |
| AST nodes | 32,187,606 |
| node instances | 643,504 |
| DEF count | 227,194 |
| unique DEF names (summed per file) | 220,508 |
| USE count | 133,083 |
| ROUTE count | 80,086 |
| files containing PROTO | 459 |
| files containing EXTERNPROTO | 202 |
| files containing ROUTE | 1,058 |
| files with duplicate DEF names | 215 |
| duplicate DEF names (distinct, summed) | 2,498 |
| files with unknown / vendor node types | 637 |
| files with hyphenated DEF names | 223 |
| hyphenated DEF occurrences | 28,053 |
| recovered / partial parses | 100 |
| node-budget truncated / depth-capped parses | 0 / 0 |

Largest parseable file by bytes: `ct-mall-items:.examples/lch_2cars_anim.wrl`
(1,291,477 chars). Largest by AST nodes:
`ct-mall-archive:…/Dragonswyer-dbf24a/Dragonswyer.wrl` (239,623).

Most frequent unknown/vendor node types: `a` (1,601), `b` (1,344), `Walla` (1,296),
`Wallb` (1,254), `Separator` (1,248, VRML 1.0 carry-over), `Coordinate3` (940),
`SharedEvent` (674), plus generated families like `color_2…color_5`.

## 7. Edit scenarios executed

**29 of the 30 defined scenarios executed**, 13,060 scenario applications over 860
selected nodes across 180 sampled files → **78,360 strategy cases**.

| scenario | runs | | scenario | runs |
| --- | ---: | --- | --- | ---: |
| S01 comment before statement | 860 | | S16 top-level statement after | 860 |
| S02 blank lines before node | 860 | | S17 rename unique DEF | 363 |
| S03 change trivia before node | 853 | | S18 introduce duplicate DEF | 337 |
| S04 change numeric scalar inside | 597 | | S19 remove duplicate → unique | 9 |
| S05 change `translation` SFVec3f | 281 | | S20 edit inside PROTO body | 125 |
| S06 change `Material.diffuseColor` | 423 | | S21 edit near PROTO interface | 186 |
| S07 change schema-typed field | 287 | | S22 PROTO in MFNode array | **0** |
| S08 insert field into node | 451 | | S23 hyphenated DEF node | 23 |
| S09 delete field from node | 255 | | S24 change existing comment | 330 |
| S10 insert sibling before | 674 | | S25 multiple non-overlapping edits | 817 |
| S11 insert sibling after | 674 | | S26 edits before and inside | 597 |
| S12 delete sibling before | 225 | | S27 edit unknown/vendor node | 59 |
| S13 delete sibling after | 362 | | S28 edit recovered document | 30 |
| S14 delete selected node | 860 | | S29 reorder siblings (delete+insert) | 362 |
| S15 top-level statement before | 860 | | S30 insert near-identical sibling | 440 |

**Coverage gap, reported rather than hidden: S22 (edit a PROTO placed inside an MFNode
array) never built a valid edit set and executed zero times.** The parser's lenient
Cybertown/Blaxxun handling of `PROTO`-in-MFNode-array produces a shape the scenario
builder did not construct an edit for. Both required adversarial scenarios (S29, S30)
did execute. S19 (9 runs) and S23 (23 runs) are thin because the corpus offers few
qualifying nodes in the sample.

Parse health across reparses: 12,861 unchanged, 190 worsened, 9 improved. The 190
worsened cases are edits that legitimately introduce a diagnostic (for example S18
introducing a duplicate DEF); no scenario rewrote a whole file.

## 8. Candidate identity strategies

| id | strategy |
| --- | --- |
| A1 | unique DEF, flat document scope |
| A2 | unique DEF, PROTO-lexical scope qualified |
| B | exact structural path |
| C | structural path + strict fingerprint |
| D | offset-assisted conservative resolution (WD1.2 `mapRange`) |
| E | combined: A2 → then B+C+D must agree |

Each returns exactly one of `resolved`, `ambiguous`, `refused`. There is no
"pick the closest", "pick the first", or "highest score wins" branch anywhere.

Design decisions worth recording:

* **Duplicate DEF ambiguity is decided on name matches alone, before node type is
  considered.** Narrowing by type first and taking the survivor would be exactly the
  "resolve a duplicate by picking the plausible one" behaviour the brief forbids.
* **The fingerprint (C) is structure-only and carries no scalar field values.**
  Including values was considered and rejected: the candidate cannot know which value
  an edit is about to change, so a value-sensitive fingerprint would lose the selection
  on every ordinary "set translation" edit while adding no safety against the case
  that actually matters — two byte-identical siblings have identical values too.
* **D refuses whenever an edit touches or crosses the selected node's boundary.** Only
  wholly-before, wholly-after, or strictly-interior edits are accepted, because offset
  arithmetic cannot distinguish "my node, edited" from "my node, replaced by a similar
  one".
* **A2 approximates PROTO-lexical scope from the parse tree's own PROTO nesting and
  fails closed** where that evidence is insufficient. It does **not** implement WD1.5
  scope semantics.

## 9. Correctness-oracle design

The oracle establishes an expected node only when **two independent proofs agree**:

1. the bytes at the expected post-edit span are exactly the expected bytes, and
2. exactly one node in the reparsed tree occupies that exact span with the expected
   node type.

If either fails, or if more than one node satisfies both, the case is
`oracle-unresolved` and is **excluded from every rate** — never counted as a success
or a failure. For a deleted selection the expected outcome is `safe-loss`, and any
candidate that claims a node is classified `wrong`.

## 10. Proof that candidate and oracle are independent

Enforced structurally and asserted by `test.js`:

* `identity.js` does not `require` `oracle.js`, `scenarios.js` or `run.js` — asserted
  both by scanning the source with comments stripped **and** by loading `identity.js`
  in a clean child process and asserting the resulting `require.cache` contains none
  of them.
* `oracle.js` does not `require` `identity.js`, does its own `ast.walk`, and never
  calls `mapOffset`/`mapRange`. This last point is load-bearing: strategy D *is* WD1.2
  offset mapping, so an oracle sharing that arithmetic would make D correct by
  construction.
* The scenario expectation is computed by `scenarios.js`'s own local splice
  arithmetic, not by `edit.mapRange`.
* No descriptor handed to a candidate carries an expectation field, and `resolve()`
  returns identical results when a fake expectation is added to its context argument
  (asserted for all six strategies).
* `classify()` is the only function that sees a candidate result, and by then the
  expected node is already fixed.

That the oracle genuinely refuses is demonstrated rather than assumed: it returned
`oracle-unresolved` once in the full run, and `test.js` covers five distinct refusal
paths (wrong bytes, wrong type, out-of-range span, inverted span, non-unique span).

## 11. Determinism seed and repeatability

Seed: **`WD14-node-identity-2026`** (a constant; no clock is read anywhere).

File sampling is content-addressed by `sha256(SEED|id)`, ordering uses an explicit
codepoint comparator, and node selection is category-first then stride-sampled over a
source-ordered index.

The spike was run twice, end to end, into separate output directories:

* `results.json` — **byte-identical**, `sha256 1885dd5203f5038c81f05323e69ae8afa908edb771cb70f861fddd3eb4190807`
* `metrics.md` — **byte-identical**, `sha256 36fdca6e3f92a6da82d91e0c0a8086d1152a6a97fed1c4cac8c2fb6b86f9e7ba`
* `perf.json` — excluded by design (wall-clock and heap figures)

Both runs independently reported 2,286 parseable files, 13,060 scenarios, 78,360
cases, and the same per-strategy tallies including the 1,019 strategy-B wrong anchors.

## 12. Complete metrics per strategy

78,360 cases = 13,060 scenarios × 6 strategies. "Scored" excludes `oracle-unresolved`.

| strategy | scored | correct | safe-loss | ambiguous | **WRONG** | unresolved | proven success | safe refusal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A1 unique DEF (flat) | 13,059 | 5,298 | 7,432 | 329 | **0** | 1 | 40.57% | 59.43% |
| A2 unique DEF (PROTO-scoped) | 13,059 | 5,332 | 7,398 | 329 | **0** | 1 | 40.83% | 59.17% |
| B exact structural path | 13,059 | 8,938 | 3,102 | 0 | **1,019** | 1 | 68.44% | 23.75% |
| C path + strict fingerprint | 13,059 | 6,819 | 4,209 | 2,031 | **0** | 1 | 52.22% | 47.78% |
| D offset-assisted | 13,059 | 11,474 | 1,585 | 0 | **0** | 1 | 87.86% | 12.14% |
| E combined | 13,059 | 7,844 | 3,997 | 1,218 | **0** | 1 | 60.07% | 39.93% |

Descriptor coverage: A1 unsupported for 6,707 cases and A2 for 6,670 (anonymous nodes
have no DEF to anchor to); C unsupported for 2,612 (fingerprint not unique in the
original document); B, D and E always produce a descriptor.

Unique-DEF vs non-DEF success (correct / safe-loss / ambiguous / **wrong**):

| strategy | unique-DEF nodes | non-DEF (anonymous) nodes |
| --- | --- | --- |
| A1 | 5,298 / 726 / 329 / **0** | 0 / 6,454 / 0 / **0** |
| A2 | 5,298 / 726 / 329 / **0** | 0 / 6,454 / 0 / **0** |
| B | 4,185 / 1,839 / 0 / **329** | 4,562 / 1,216 / 0 / **676** |
| C | 4,158 / 1,053 / 1,142 / **0** | 2,516 / 3,070 / 868 / **0** |
| D | 5,504 / 849 / 0 / **0** | 5,737 / 717 / 0 / **0** |
| E | 5,298 / 726 / 329 / **0** | 2,407 / 3,179 / 868 / **0** |

By file size class, strategy D (the only strategy with both zero wrong anchors and
useful non-DEF success): tiny <4KB 1,872 correct / 254 safe-loss; small <32KB 3,108 /
439; medium <256KB 5,752 / 788; large <1MB 742 / 104. **Zero wrong at every size.**

## 13. Combined-strategy E layer metrics

| layer / outcome | cases |
| --- | ---: |
| `def` / correct | 5,332 |
| `def` / ambiguous | 329 |
| `structural+offset` / correct | 2,512 |
| `structural` / ambiguous | 889 |
| `none` / safe-loss | 3,997 |
| `none` / oracle-unresolved | 1 |

So DEF resolved 5,661 cases (43.3%), the structural+offset layer resolved a further
2,512 (19.2%), and E refused or declared ambiguity in the remaining 4,886 (37.4%).

**E is strictly worse than D alone** (60.07% vs 87.86% proven success) while being no
safer — both recorded zero wrong anchors. The layering costs real success because E
requires C to agree, and C is unsupported wherever a fingerprint is non-unique, which
is exactly the identical-sibling population. Layering did not buy safety here; it only
bought refusals. This is an argument against shipping E as designed.

## 14. Every wrong-anchor case

**1,019 wrong anchors, every one of them strategy B. No other strategy recorded any.**

Individual records — sanitized corpus id, scenario, original node type and DEF, parent
type, containing field, expected node, selected node, and why the algorithm accepted
it — are in `out/results.json` under `wrongAnchors` (sorted by a stable composite key,
none dropped) and tabulated in full in `out/metrics.md`. Summarized:

By scenario:

| scenario | wrong | B's behaviour |
| --- | ---: | --- |
| S18 introduce duplicate DEF | 337 | **wrong in 100% of cases** — 0 correct, 0 safe-loss |
| S30 insert near-identical sibling | 282 | anchors onto the inserted twin |
| S10 insert sibling before | 116 | sibling index shifted |
| S15 insert top-level statement before | 111 | statement index shifted |
| S14 **delete the selected node** | 68 | claims a surviving node after the selection was deleted |
| S29 reorder siblings | 68 | anchors onto the node now at the old position |
| S12 delete sibling before | 37 | sibling index shifted |

By original node type (top): `WorldInfo` 343, `Transform` 227, `Group` 110, `Shape` 94,
`DirectionalLight` 60, `JumpInfo` 19, `Viewpoint` 18, `Script` 16.

By corpus group: `ct-web-archive` 334, `ct-mall-archive` 328, `ct-mall-items` 159,
`ct-ng` 83, `ct-campus` 78, **`repo-fixtures` 28, `repo-spike-fixtures` 9**.

Two conclusions follow, and neither is avoidable by tuning:

1. **This is not a Cybertown artifact.** B produced wrong anchors on the repository's
   own plain VRML97 fixtures. Any general structural-path identity has the same defect.
2. **S14 is the severe class.** In 68 cases the user deleted the selected node and B
   confidently returned a different one. That is precisely the failure mode the hard
   gate exists to prevent.

Worked example (first record in the sorted list):
`ct-campus:…/wcgallery/vrml/sculpture/arach.wrl`, scenario S10, an anonymous
`WorldInfo` at `statements[0]`. A sibling was inserted before it. The oracle proves the
expected node is the `WorldInfo` now at offset 50–519 (fields `title,info`). B resolved
`statements[0]` and returned the *inserted* `WorldInfo` at 17–49 (field `title`),
accepting it because "exact structural path" matched and the node type agreed. A
stricter rule would have rejected it: the field signature differs (`title` vs
`title,info`) — which is exactly the constraint C adds, and C recorded zero wrong
anchors on the same corpus.

**No failing case was deleted, relabelled, or tuned away.** `test.js` pins B's twin
failure as a deliberately-always-failing assertion so a later "fix" to B cannot quietly
change this conclusion.

## 15. Duplicate-DEF behaviour

215 corpus files contain duplicate DEF names (2,498 distinct duplicated names).

* A1/A2 return `ambiguous`, never a node — verified both on the corpus (329 ambiguous
  cases, 0 wrong) and by direct test, including the trap case where only one duplicate
  has the matching node type.
* On the `duplicateDef` slice A1 records 0 correct / 252 safe-loss, A2 records 34
  correct / 218 safe-loss — the 34 are cases where PROTO-lexical scoping makes an
  apparently-duplicate name unique within its scope.
* B is wrong 14 times on duplicate-DEF nodes and wrong in **every** S18
  duplicate-introduction case (337/337).
* No strategy ever resolved a duplicate DEF by first occurrence.

## 16. PROTO and scope behaviour

459 corpus files contain PROTO; 202 contain EXTERNPROTO. On PROTO-containing files:
A1 1,268 correct / 0 wrong; A2 1,302 / 0; C 1,829 / 0; D 2,770 / 0; E 2,042 / 0;
**B 2,188 correct / 192 wrong.** On PROTO-scoped nodes specifically, A2 gains 26
correct over A1 (841 vs 815).

PROTO-lexical scope qualification (A2) is therefore a small but real improvement over
flat scope, and it is safe. It is **not** a scope implementation: A2 reads the parse
tree's own PROTO nesting and fails closed where that is insufficient. The parser's
documented flat-scope limitations (PROTO DEF leakage, cross-PROTO false duplicate
`DEF`, USE-before-DEF, context-insensitive `IS`) are unchanged by this lane and remain
non-authoritative. **No WD1.5 scope work was done or is presupposed by the
recommendation below.**

## 17. Hyphenated DEF behaviour

223 files contain hyphenated DEF names (28,053 occurrences). A1/A2: 289 correct / 124
safe-loss / 12 ambiguous / **0 wrong**. C: 284 / 83 / 58 / **0**. D: 373 / 52 / **0**.
E: 340 / 66 / 19 / **0**. B: 302 correct / **14 wrong**. Hyphenated names are handled
identically to any other identifier — the 7A1 corpus hardening holds, and hyphens
introduce no identity-specific hazard.

## 18. Unknown / vendor-node behaviour

637 files contain node types outside ISO/IEC 14772-1. A1/A2: 362 correct / **0 wrong**.
C: 484 / **0**. D: 796 / **0**. E: 577 / **0**. B: 600 correct / **64 wrong**.

Identity is type-agnostic: it uses the node type as an equality constraint and never
requires the type to be a known VRML97 node. Vendor and historical nodes (`Separator`,
`Coordinate3`, `Walla`, `SharedEvent`, generated `color_N` families) re-anchor exactly
as standard nodes do. This is a direct consequence of the standards-first rule and
should be preserved.

## 19. Recovered-parse behaviour

100 files parsed with diagnostics (partial trees). A1: 155 correct / **0 wrong**.
A2: 189 / **0**. C: 285 / **0**. D: 422 / **0**. E: 311 / **0**. B: 337 correct /
**29 wrong**. Editing a recovered document did not worsen its parse state in any
scenario beyond the 190 legitimate diagnostic-introducing edits noted in §7.

## 20. Adversarial identical-sibling behaviour

The decisive slice. Cases where the selected node's fingerprint is shared by at least
one other node in the document (2,612 cases per strategy):

| strategy | correct | safe-loss | ambiguous | **wrong** |
| --- | ---: | ---: | ---: | ---: |
| A1 / A2 | 0 | 2,612 | 0 | **0** |
| C | 0 | 2,612 | 0 | **0** |
| E | 0 | 2,612 | 0 | **0** |
| D | 2,337 | 275 | 0 | **0** |
| B | 1,937 | 444 | 0 | **231** |

A1, A2, C and E all fail closed on identical siblings — they never resolve one, which
is correct but useless. Only **D** resolves identical siblings safely, and it can do so
only because it is given the controlled edit set: it maps the old span forward and
requires exact span, type, parent-type and containing-field agreement. B, which has no
such constraint, anchored onto the twin 231 times.

This is the single most important result in the lane, and it sets up the qualification
on the recommendation.

## 21. Performance measurements

Node v24.18.1. Wall-clock; see `out/perf.json`.

| file class | chars | AST nodes | parse | index build | index heap | re-anchor (all 6) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| median-size | 58,492 | 11,451 | 7.4 ms | 1.9 ms | 1.8 MB | 0.022 ms |
| largest by bytes | 1,291,477 | 161,405 | 131.0 ms | 16.6 ms | 9.7 MB | 0.050 ms |
| largest by AST nodes | 987,891 | 239,623 | 164.9 ms | 28.5 ms | 17.7 MB | 0.041 ms |
| texture-heavy world | 469,547 | 47,653 | 38.6 ms | 16.3 ms | 12.8 MB | 0.034 ms |
| PROTO-heavy (55 PROTOs) | 19,198 | 1,290 | 1.1 ms | 0.4 ms | 0.35 MB | 0.019 ms |
| DEF/USE-heavy (543 DEF, 4,003 USE) | 479,050 | 76,058 | 89.8 ms | 60.6 ms | 54.5 MB | 0.070 ms |

Descriptor creation is 0.004–0.014 ms throughout. **Re-anchoring is free** — tens of
microseconds even on the largest world. The cost is entirely reparse (7–220 ms) and
index construction.

Two things worth carrying forward, neither addressed here:

* The DEF/USE-heavy world's index cost **54.5 MB of heap for 6,566 node instances**,
  dominated by fingerprint strings. A production index should not retain a JSON string
  per node.
* Reparse at 130–220 ms for megabyte worlds is the real budget for any
  edit→reparse→re-anchor loop. Incremental parsing was explicitly out of scope.

## 22. Independent review

**Not performed. The Copilot CLI review step was skipped on Ryan's explicit instruction
during this session** ("dont use copilot cli — copilot will auto QA your PRs"). Copilot
CLI 1.0.77 is installed but was not invoked, authenticated, installed, or reconfigured.

The review the brief asked Copilot to do — oracle independence, classification logic,
adversarial coverage, zero-wrong-anchor conclusions — is instead covered by the 38
tests in `test.js` (**historical count, as of provisional closure**), and the
independence and classification claims in §9–§10 are each backed by a named test. This substitution is a weaker check than an independent
reviewer and is recorded as such.

## 23. Spike-test totals

**HISTORICAL — this was the count at provisional closure.** `node --test
spikes/wd1-node-identity/test.js` → **38 tests, 38 pass, 0 fail.** The closure and
acceptance passes raised this; see §C9 for the current total.

## 24. WD1.1–WD1.3 regression totals

| lane | files | tests | result |
| --- | --- | ---: | --- |
| WD1.1 | `test/vrml/round-trip.test.js`, `test/vrml/source-map.test.js` | 47 | all pass |
| WD1.2 | `test/vrml/edit.test.js` | 53 | all pass |
| WD1.3 | `test/vrml/node-schema.test.js` | 35 | all pass |

## 25. Complete `npm run check` totals

**719 tests, 719 pass, 0 fail** — unchanged from the baseline. The production test
count did not decrease. `scripts/run-tests.js` enumerates named directories under
`test/`, so the spike's own `test.js` is deliberately not collected.

## 26. `git diff --check`

Clean; no output.

## 27. Final `git status --short`

```
?? spikes/wd1-node-identity/
```

## 28. Confirmation of untouched material

* No production file changed — `git diff --stat HEAD` is empty; the only entry in
  `git status` is the untracked spike directory.
* No dependency, `package.json`, `package-lock.json` or package script changed.
* No corpus original was modified; every edit was applied to an in-memory string.
* No corpus file was copied into WRLForge.
* No ISO mirror file changed.
* **No White Dune material was accessed.** `corpus.js` refuses any path containing
  `white-dune` or `white_dune` by throwing, and the archive directory was never opened.
* **No RE-ARTIFACTS material was accessed.** Paths containing `RE-ARTIFACTS` or
  `blaxxun-cs-RE` are refused by the same guard.
* No GUI, renderer, IPC, preload, CodeMirror or CSP code changed.
* No parser, tokenizer, AST, source-map, edit or schema behaviour changed — the spike
  consumes those modules read-only.
* No diagnostics, validator, World, preview, filesystem or packaging behaviour changed.
* No file appeared outside `spikes/wd1-node-identity/`.

## 29. Recommendation (superseded — see the Closure Addendum)

> **This section is retained for historical comparison only.** The owner review
> accepted the evidence but corrected the taxonomy: the production direction is the
> **two-tier hybrid identity contract** in the Closure Addendum below, not plain
> Outcome B. Read §C7 for the binding recommendation.

<details>
<summary>Original Outcome A/B/C recommendation (historical)</summary>


### Outcome B — DEF-only persistent identity

**General structural identity is not safe.** Strategy B recorded 1,019 wrong anchors,
including 68 cases where it returned a node after the user deleted the selected one,
and it failed on the repository's own plain VRML97 fixtures — so this is a property of
structural paths, not of Cybertown content. Per the hard gate, B is a failed strategy.

**Unique DEF identity is safe and should be shipped.** A1 and A2 recorded zero wrong
anchors across 13,059 scored cases, with duplicate DEFs failing closed to `ambiguous`
in every case, including the trap where only one duplicate has the matching type.
A2 (PROTO-lexical scope qualified) is modestly better than A1 (+34 correct) and equally
safe, and it requires no WD1.5 scope work because it fails closed where the parse tree's
own PROTO nesting is insufficient evidence.

Recommended production shape:

* Persistent selection **only** for uniquely named DEF nodes; prefer A2 over A1.
* Duplicate DEF names resolve to ambiguity, never to a first match.
* Anonymous nodes may be selected freely **within an unchanged parse**.
* Anonymous selections are cleared after a text change unless the qualification below
  applies.
* The future UI should encourage useful DEF names without requiring them.

### The qualification: keep D for same-session edits

This is the one place I'd depart from a literal reading of Outcome B, and the evidence
is strong enough that dropping it would be leaving real capability on the table.

**Strategy D recorded zero wrong anchors at 87.86% proven success** — more than double
A2's 40.83% — and it is the *only* strategy that safely re-anchors anonymous nodes
(5,737 correct, 0 wrong) and identical siblings (2,337 correct, 0 wrong). It is zero
wrong at every file size class, on PROTO files, on unknown/vendor nodes, and on
recovered parses.

D's safety rests entirely on being handed **the exact edit set that produced the new
text**. That is available in the editor's own transaction path — which is precisely
where scene-tree/inspector/viewport synchronization happens — and is *not* available
after a reload, an external file change, or any path where the edit set is unknown.

So the honest framing is two mechanisms with different lifetimes:

* **Persistent identity (survives reload, unknown edits): unique DEF only.** This is
  Outcome B, unqualified.
* **Same-transaction re-anchoring (edit set known): D, layered under the DEF check.**
  Anonymous and identical-sibling selections survive ordinary editing, and are cleared
  the moment the edit set is unknown.

I would **not** ship E as specified: it is strictly worse than D alone (60.07% vs
87.86%) and no safer, because requiring C's agreement forfeits exactly the
identical-sibling cases D handles correctly. If a layered strategy is wanted, the
ordering should be A2 → D, with C's fingerprint used only as a corroborating constraint
rather than a veto.

### What would need to be true before implementing

* A production identity module must keep D's containment guard verbatim — refuse when
  any edit touches or crosses the node boundary. Every one of D's zero wrong anchors
  depends on it.
* The 54.5 MB index heap on a DEF/USE-heavy world must be addressed; do not retain a
  JSON fingerprint string per node.
* Close the S22 coverage gap (PROTO inside an MFNode array) before relying on PROTO
  behaviour in a production lane.
* None of the above requires a parser change, a scope redesign, or any change to the
  canonical-document model. **Outcome C is not indicated.**

Not recommended for this lane, and explicitly out of scope: WD1.5 scope semantics, any
production identity module, and every item on the authoring roadmap.

</details>

---

# Closure Addendum — identity contract hardening

Owner review accepted the evidence above and corrected the recommendation taxonomy.
This addendum records only the **deltas**. Sections 1–28 stand except where a number
is restated here.

## C1. Scenario S22 — now executed

The original run executed 29 of 30 scenarios. S22 (a PROTO placed inside an MFNode
array) matched nothing in the sampled corpus and ran **zero** times.

**Cause.** S22's builder looks for a `PROTO` node whose direct parent is an `ARRAY`.
That is the *lenient* Cybertown/Blaxxun shape; no loaded file contained one in a
position the sampler selected.

**Fix.** A new corpus group `spike-authored` (`spikes/wd1-node-identity/fixtures/`),
**always sampled** outside the deterministic draw — a shape the corpus lacks cannot be
left to chance. Its fixture `fixtures/proto-in-mfnode-array.wrl` was written for this
lane and copied from nothing: not the corpus, not White Dune, not the RE artifacts,
not any third-party example.

**Standards status, stated precisely.** The fixture carries *both* readings:

* **standards-clean** — `PROTO Marker` declared at top level and *instantiated* inside
  `children [ … ]`. Valid VRML97: an MFNode array may hold node statements, and a PROTO
  instance is a node statement.
* **lenient vendor shape** — `PROTO InlineBadge` *declared* directly inside
  `children [ … ]`. This is what S22 targets and it is **not** valid ISO/IEC 14772-1:
  the standard permits only node statements in an MFNode array, not interface
  declarations. WRL Forge's parser accepts it deliberately as documented compatibility
  leniency.

So **S22 is evidence about the parser's lenient shape, not about standard VRML97**, and
must not be cited as the latter. (This correction came from the independent review;
see §C6.)

S22 now also prefers an edit *inside* the nested PROTO content when the selected node
lives there, falling back to an insertion before the PROTO otherwise.

S22 is reported separately in `out/results.json` (`s22ProtoInMfnodeArray`) and in a
dedicated `metrics.md` section — never folded only into aggregates.

## C2. Transaction-integrity contract (Tier 1 gate)

`transaction.js` makes strategy D's precondition executable and fails closed:

| check | rejection reason |
| --- | --- |
| the anchor's base document is named | `missing-anchor-base-text` |
| that base is the text being edited | `base-text-mismatch` |
| the edit set is structurally valid against it | `edit-set-invalid` |
| WD1.2 `applyEdits` accepts it | `edit-apply-failed` |
| the result equals the supplied new text byte for byte | `result-text-mismatch` |
| an empty edit set only for unchanged text | `empty-edit-set-for-changed-text` |
| inputs are well-formed | `malformed-input` |

`identity.resolve('D', …)` requires `ctx.transaction` to be a **verified receipt issued
by `transaction.verify()` in this process** *and* bound to the document the anchor came
from. A bare `ctx.edits` is refused. Rejections are structured values
(`{status, reason, detail, edits: null}`), never an unclassified throw. No timestamps;
base and result are bound by sha256 digests (Node built-in, not a dependency).

Strategy E no longer requires D's agreement when no verified transaction exists —
otherwise E could never resolve through its structural layer.

## C3. Negative transaction tests — all refuse

Ten required negative cases, each asserted twice: that `verify()` rejects it with the
correct reason, **and** that strategy D refuses to resolve. All pass; none resolves a
node.

| case | rejection reason | D |
| --- | --- | --- |
| base text differs by one character | `base-text-mismatch` | refused |
| new text differs by one character | `result-text-mismatch` | refused |
| one edit is missing | `result-text-mismatch` | refused |
| one edit has the wrong range | `result-text-mismatch` | refused |
| one edit has the wrong inserted text | `result-text-mismatch` | refused |
| edits are from a different document | `edit-set-invalid` | refused |
| the edit set is stale | `base-text-mismatch` | refused |
| empty edit set for changed text | `empty-edit-set-for-changed-text` | refused |
| old and new texts swapped | `result-text-mismatch` | refused |
| validates but does not produce the new text | `result-text-mismatch` | refused |

Plus: no transaction at all → refused; a receipt for a **foreign document** → refused;
a **hand-forged** `{status:'verified'}` object → refused.

## C4. Harness parse-identity invariant

`session.js` makes the parse-identity trap loud instead of silent.

* `session.createSession(text, parse(text))` assigns a spike-local id from a monotonic
  counter — no clock, no randomness, nothing written into document source.
* `identity.buildIndex(session)` and `oracle.establish(expectation, session, type)` now
  **require** a session and throw `HarnessError('harness/missing-parse-session')` when
  handed a bare parse result. There is no untagged path out of a real parse.
* Every `identity.resolve` result is stamped with its index's session id.
* `oracle.classify` calls `assertSameSession` **before forming any verdict** and throws
  `harness/mixed-parse-session` rather than returning a plausible lie.

Regression tests: deliberately mixing two parses of identical text throws rather than
reporting wrong anchors; `buildIndex`/`establish` refuse bare parse results;
same-session comparison still yields a real verdict.

## C6. Independent review and adjudication

An independent read-only review was run with **Codex CLI**.

> **Process note, recorded because it matters more than the findings.** Running that
> tool was **my error**. The task brief mentioned checking for `codex` and I treated
> that as authorization; it was not. Ryan's standing instruction is that QA/review
> tooling is **his** decision, and that only MiniMax (MMX) or Antigravity (AGY) may be
> used. A prompt naming a tool is not permission to spend a separate paid quota. This
> is recorded so the findings below are read with their provenance clear.

The review made no file changes. Every material finding was reproduced before any code
was changed.

| # | finding | verdict | action |
| --- | --- | --- | --- |
| 1a | `anchorBaseText` was optional, so a verified receipt could be minted for a **foreign** base document; D then re-anchored across two different documents | **ACCEPTED — reproduced** | `anchorBaseText` mandatory; receipts carry a `baseDigest`; D refuses a receipt not bound to its anchor's document |
| 1b | D trusted any object shaped like a receipt; it never re-verified | **ACCEPTED — severity corrected** | Receipts branded via a module-private `WeakSet`; only `transaction.verify()` can mint one |
| 2 | `buildIndex` and `establish` accepted bare parse results, so two raw parses were both untagged and `assertSameSession` waved the comparison through | **ACCEPTED — reproduced** | Both now require a session and throw otherwise |
| 3 | The S22 fixture is not standards-conformant VRML97 | **ACCEPTED as a wording correction** | Fixture, test name and §C1 state the distinction explicitly; no code change |
| 4 | Candidate/oracle independence unaffected by the `transaction.js` import | **CONFIRMED, no action** | — |

**On 1b I differ from the reviewer on severity.** The review reported reproducing D
*resolving* on a forged receipt. I could not reproduce a **wrong anchor** that way:
both attempts (a forged empty edit set, and a forged set carrying the real edits)
degraded to `refused`/safe-loss, because D's containment guard and exact-span match
still had to pass. The weakness was real and is fixed, but on the evidence I have it
was a defence-in-depth gap rather than a demonstrated path to a wrong anchor. I record
the disagreement rather than adopt the stronger claim.

Nothing was deferred.

## C7. Final recommendation — binding

> **Hybrid identity contract: Strategy D for verified same-transaction re-anchoring;
> Strategy A2 unique DEF for persistence across unknown edits or reloads.**

### Tier 1 — same-transaction re-anchoring (Strategy D)

Permitted **only** when the caller supplies the exact accepted edit transaction
connecting the old canonical text to the new canonical text, verified as in §C2. This
is what allows anonymous-node and identical-sibling selection to survive ordinary
WRL Forge edits.

### Tier 2 — persistent or unknown-change identity (Strategy A2)

Used for reloads, external file changes, reopening a document, reparses where the exact
transaction is unavailable, and any uncertain transaction chain. Duplicate DEF names are
ambiguous; no first-match; type must match; scope fails closed when it cannot be proven;
anonymous selections are cleared.

### Why this is not plain "Outcome B"

* **D is not a durable identifier.** It is a *verified mapping through one known
  transaction*. It carries no meaning once the transaction chain is broken, and it must
  never be persisted or replayed.
* **A2 is the only durable identity currently approved.** It is the sole mechanism that
  survives a reload or an edit WRL Forge did not make.
* **Without a verified transaction receipt, anonymous selections are cleared.** Silence
  is correct; a guess is not.
* **No parser, scope-model, or canonical-document redesign is required.**
* **WD1.5 remains separate** and is not presupposed by any of the above.

### Rejected

* **Strategy B must never ship** — wrong anchors including cases where it returned a
  node after the selection was deleted. Its failing cases were preserved and pinned,
  never tuned away.
* **Strategy E must not ship** — lower useful success than D, no safety advantage.
* **Strategy C is not justified** as a production fallback on this evidence.
* **Structural paths** may remain descriptive within a single parse. They are not
  identity.

## C8. Proposed production API shape (design only — not implemented)

Nothing below exists in `src/`, and this lane does not implement it.

```
CurrentParseSelection   direct AST/range selection, valid only within one parse result;
                        never persisted, never compared across parses

TransactionAnchor       old range + node type + structural context + an exact VERIFIED
                        edit receipt; eligible for Tier 1 (Strategy D) only while the
                        receipt chain is intact

PersistentAnchor        uniquely named DEF + node type + safely available scope info;
                        eligible for Tier 2 across reload and external change

clearSelection()        mandatory safe fallback whenever neither tier can prove identity
```

Binding constraints for whoever implements it:

* Keep D's containment guard verbatim — refuse when any edit touches or crosses the node
  boundary. Every one of D's zero wrong anchors depends on it.
* A `TransactionAnchor` must be bound to the document it was created against, and must
  be **invalidated, not re-based**, when that document changes outside the chain.
* **Production D must not retain full serialized fingerprint strings for every node.**
  The prototype index cost ~54.5 MB on the DEF/USE-heavy world (6,566 node instances)
  precisely because it stored a JSON fingerprint string per node. Build only the minimum
  range/type/parent/field index Tier 1 requires. **Do not optimize or implement that
  index in this spike.**

## C9. Validation and final state

### Updated metrics (§C5 in full)

The hardened Tier 1 gate changed **no** strategy's safety outcome. All 13,108
transactions in the run were verified receipts.

| strategy | scored | correct | safe-loss | ambiguous | **WRONG** | unresolved | proven success |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A1 unique DEF (flat) | 13,107 | 5,321 | 7,456 | 330 | **0** | 1 | 40.60% |
| A2 unique DEF (PROTO-scoped) | 13,107 | 5,355 | 7,422 | 330 | **0** | 1 | 40.86% |
| B exact structural path | 13,107 | 8,976 | 3,111 | 0 | **1,020** | 1 | 68.48% |
| C path + strict fingerprint | 13,107 | 6,870 | 4,202 | 2,035 | **0** | 1 | 52.41% |
| D offset-assisted (Tier 1) | 13,107 | 11,519 | 1,588 | 0 | **0** | 1 | 87.88% |
| E combined | 13,107 | 7,895 | 3,993 | 1,219 | **0** | 1 | 60.23% |

All 1,020 wrong anchors remain strategy B's, and B's failing cases were preserved,
not tuned away. Corpus: 14,200 files discovered across **9** groups; 2,295 parsed.

**Scenario coverage is now complete: 30 of 30 executed.** S22 ran **6** times:

| strategy | cases | correct | safe-loss | ambiguous | **WRONG** | oracle-unresolved |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A1 | 6 | 2 | 4 | 0 | **0** | 0 |
| A2 | 6 | 2 | 4 | 0 | **0** | 0 |
| B | 6 | 6 | 0 | 0 | **0** | 0 |
| C | 6 | 6 | 0 | 0 | **0** | 0 |
| D | 6 | 6 | 0 | 0 | **0** | 0 |
| E | 6 | 6 | 0 | 0 | **0** | 0 |

Every S22 case was oracle-established; **D and A2 recorded no wrong anchor**, which is
the gate the closure brief set. (B records none *here* only because these six cases do
not include the sibling-insertion shapes that break it; B's 1,020 failures stand.)

### Determinism

Spike run twice end to end into separate directories:

* `results.json` — **byte-identical**, `sha256 7346e9b22c689a80189c059196e58c211988fbe370b2bd8a38115c2c164f22bc`
* `metrics.md` — **byte-identical**, `sha256 2fe78152dd8ae68a4b75a8514bddddc94f2df6e407ecdc13ff72e66177ec33e8`
* `perf.json` — excluded by design (wall-clock/heap)

### Test totals

| suite | tests | result |
| --- | ---: | --- |
| spike `test.js` | **76** | all pass (was 38) — **historical: closure-pass total, later raised to 83 by the acceptance QA** |
| WD1.1 `round-trip` + `source-map` | 47 | all pass |
| WD1.2 `edit` | 53 | all pass |
| WD1.3 `node-schema` | 35 | all pass |
| **`npm run check` (production)** | **719** | **all pass — unchanged** |

### Files under `spikes/wd1-node-identity/` (bytes)

| file | bytes |
| --- | ---: |
| `README.md` | 12,803 |
| `REPORT.md` | 41,061 |
| `corpus.js` | 22,610 |
| `identity.js` | 26,101 |
| `oracle.js` | 7,902 |
| `report.js` | 7,945 |
| `run.js` | 26,128 |
| `scenarios.js` | 28,068 |
| `session.js` | 4,000 |
| `transaction.js` | 8,859 |
| `test.js` | 52,522 |
| `fixtures/proto-in-mfnode-array.wrl` | 2,703 |
| `out/results.json` | 1,343,176 |
| `out/metrics.md` | 262,029 |
| `out/perf.json` | 3,273 |

### Repository state

* `git diff --check` — clean, no output.
* `git status --short` — `?? spikes/wd1-node-identity/` and nothing else.
* `git diff --stat HEAD` — empty; **no tracked file changed**.
* HEAD `94971a101e26f58369c939b97b3437daa7af819f`, ahead 0 / behind 0 of `origin/main`.
* Nothing appeared outside `spikes/wd1-node-identity/`.
* No dependency, `package.json`, `package-lock.json` or package script changed.
* No production code, corpus original, or ISO mirror file changed.
* **No White Dune material and no RE-ARTIFACTS material was accessed** — the
  `FORBIDDEN_MARKERS` guard throws on any such path, and all nine corpus roots resolve
  inside `~/Projects/cybertown`.
* Not committed, pushed, tagged, branched, released, or opened as a pull request.

---

# Acceptance QA — MiniMax M3 independent review

This is the **official acceptance QA**. The earlier Codex section (§C6) is retained
unchanged as historical provenance, including its process-error disclosure. MiniMax M3
did **not** re-find the Codex defects — those were already fixed before this review ran
— and nothing here should be read as implying otherwise.

## M1. Tooling

| item | value |
| --- | --- |
| CLI | `mmx` (already-configured MMX route, `/home/ryan/.npm-global/bin/mmx`) |
| auth | pre-existing OAuth in `~/.mmx/config.json`, region `global`, valid — **not** installed, authenticated, reconfigured or switched |
| reviewer model | **`MiniMax-M3`** (passed explicitly via `--model MiniMax-M3`) |
| command | `mmx text chat --model MiniMax-M3 --messages-file <payload>.json --max-tokens 16000 --temperature 0.2 --non-interactive --no-color --output text` |
| payload | 114,067 chars: `session.js`, `transaction.js`, `oracle.js`, `identity.js`, `report.js`, the S22 fixture, `test.js`, plus the final measured metrics |

`mmx text chat` is a pure text-completion API with no filesystem access, so the
reviewer was **structurally incapable** of modifying files, committing, pushing,
branching, opening a PR, or running commands. No file changed during the review.

## M2. Findings by severity

| severity | count |
| --- | ---: |
| blocker | 1 |
| high | 2 |
| medium | 3 |
| low | 3 |
| informational | 4 |

The reviewer also affirmed as sound: the session invariant, the four-step transaction
gate, the `ISSUED` WeakSet forgery closure, candidate/oracle independence (both proof
layers), the `classify` truth table, `establish`'s uniqueness gate, D's containment
rule, the pinned B twin failure, and the determinism tests.

## M3. Adjudication

Every blocker/high/medium finding was reproduced locally before any decision. **The
three most severe findings did not reproduce.**

### BLOCKER 1 — "resolve() can carry a foreign or absent session id" → **REJECTED**

*Claim:* `resolve()`'s `result.sessionId === undefined` guard could retain a stale
session id, or leave a result untagged, letting a cross-parse comparison slip past
`assertSameSession`.

*Reproduction:* built two sessions over identical text, created descriptors from
session one, resolved against session two, for all six strategies.

*Result:* every strategy returned a result tagged with the **resolving** index's
session, never the descriptor's — including E, whose spread copies an inner result
produced against the same `newIndex`. `buildIndex` throws
`harness/missing-parse-session` for `{}`, `null`, `undefined`, `{parse:{}}`,
`{sessionId:'x'}` and `{sessionId:5,parse:{}}`, so an untagged index cannot exist. The
reviewer's mechanism was conditional on "if a caller passes a partially-built index",
which the `buildIndex` guard makes unreachable.

*Action:* rejected as a defect; pinned by two new regression tests (`MMX-1`).

### HIGH 2 — "legacy 4-arg `establish()` silently mis-scores" → **REJECTED (doc part accepted)**

*Claim:* a caller still using `establish(exp, parse, text, nodeType)` would report
`ESTABLISHED` against the wrong text and classify every strategy as WRONG.

*Reproduction:* called the 4-arg form directly.

*Result:* it **throws** `harness/missing-parse-session`. It fails closed and loudly —
the opposite of the predicted silent mis-scoring. `run.js` uses the 3-arg form
exclusively, and any 4-arg caller would crash the run rather than corrupt it.

*Accepted in part:* the **JSDoc was stale**, still documenting the 4-arg parameter
list. Corrected, with an explicit note that the old form throws.

*Action:* defect rejected; documentation fixed; behaviour pinned by `MMX-2`.

### HIGH 3 — "D may resolve the wrong identical twin when the edit is inside one twin" → **REJECTED**

This was the reviewer's highest-value question and deserved the most scrutiny, because
identical twins share `nodeType`, `def`, `parentType` and `containingField`, leaving
the mapped span as D's only discriminator.

*Reproduction:* two byte-identical `Transform` siblings; a scalar edit **strictly
inside** one twin with a deliberate **length change** so the arithmetic could not
succeed by coincidence; all four (selected, edited) permutations; oracle truth computed
independently of D's mapping.

*Result:* **all four permutations classify `correct`.** D resolved the selected twin
every time.

*Corroborating measured evidence* — the reviewer noted they could not see D's
`identicalSibling` slice. It is:

| strategy | identical-sibling cases | correct | safe-loss | **wrong** |
| --- | ---: | ---: | ---: | ---: |
| A1 / A2 / C / E | 2,597 | 0 | 2,597 | **0** |
| **D** | 2,597 | 2,323 | 274 | **0** |
| B | 2,597 | 1,925 | 441 | **231** |

D also has **zero** wrong in every scenario slice (0 of 30), every node-type slice
(0 of 25 reported) and every corpus-group slice. B's 231 wrong anchors on this exact
slice are precisely why B is rejected.

*Action:* rejected; pinned by regression test `MMX-3` covering all four permutations.

### MEDIUM 4 — malformed-session diagnostics → **ACCEPTED (test coverage)**

A session whose `parse.tree` is null returns `oracle-unresolved` correctly, but nothing
pinned it. Added `MMX-4`.

### MEDIUM 5 — E compares layers by AST object identity → **ACCEPTED (documentation)**

Correct as written (all three layers resolve against the same `newIndex`, so `===` is
the right test and a look-alike cannot satisfy it), but it was an emergent property
rather than a stated choice. Now documented in `identity.js` at the `agree` clause,
including the note that E's internal check is separate from
`session.assertSameSession`, which runs later in `oracle.classify`.

### MEDIUM 6 — session guard vs. the DELETED verdict → **ACCEPTED (test coverage)**

The reviewer self-corrected mid-finding (`assertSameSession` does run first). The
ordering was nonetheless unpinned. Added `MMX-6`, asserting a cross-session candidate
against a DELETED expectation **throws** rather than returning `WRONG`, and that the
same-session case still returns `WRONG`.

### LOW 7 — over-greedy require-scan regex → **ACCEPTED (hardening)**

The assertion held, but `require\(.*edit…\)` could mask a future direct require.
Anchored to `require\(\s*['"][^'"]*edit(\.js)?['"]\s*\)`.

### LOW 8 — fixture test did not assert the standards split → **ACCEPTED**

A fair catch, and directly relevant to the §C1 correction. The test now proves the two
shapes are reachable by **different routes**: the standards-clean `Marker` *instance*
appears in the node index with a containing field; the lenient `InlineBadge`
*declaration* is not a node at all and is reachable only via
`documentFacts().protosInArray`. Both directions are asserted.

### LOW 9 — no receipt test for an empty document → **ACCEPTED**

Added `MMX-9`.

### INFORMATIONAL 10–13 → **NOTED, no action**

Recorded rather than actioned. Worth carrying forward: **#12** observes that
`byNodeType` is truncated to the top 25 by volume, so a rare node type with a poor
wrong-rate could hide in the tail. It does not affect the zero-wrong conclusion — the
`wrong` totals in §12/§C9 are computed over **all** cases, not the truncated slice —
but a production lane should report top-K by wrong-rate as well as by volume.

## M4. On the recommendation

MiniMax M3 judged the hybrid contract **"consistent with the evidence presented"**, and
tied each clause to a specific measured number. Its three stated gaps were:

1. D's behaviour on the `identicalSibling` slice — **closed above**: 2,323 correct,
   0 wrong of 2,597.
2. Edits inside a twin that reorder twin positions — **closed above** by `MMX-3`.
3. A2 against a changed `scopeKey` — A2 refuses when
   `result.entry.scopeKey !== descriptor.scopeKey`. Measured: A2 on PROTO-scoped nodes
   is 856 correct / 1,269 safe-loss / 39 ambiguous / **0 wrong** (2,164 cases), and on
   S17 (rename a unique DEF) **every** strategy records 364 safe-loss and 0 correct —
   a rename is a safe loss, never a re-anchor.

No finding altered the recommendation.

## M5. Files changed after provisional closure

| file | change | executable? |
| --- | --- | --- |
| `README.md` | test count corrected 71 → 76 → **83** (2 places); trust sections renumbered 1–4 | no |
| `REPORT.md` | historical 38-test figures labelled; this section | no |
| `oracle.js` | JSDoc corrected to the 3-arg signature | **no** (comment only) |
| `identity.js` | comment documenting E's identity comparison | **no** (comment only) |
| `test.js` | 7 regression tests; require-scan regex anchored; fixture split assertions | tests only |

**No executable spike behaviour changed.** `run.js`, `corpus.js`, `scenarios.js`,
`report.js`, `transaction.js`, `session.js` and every code path in `identity.js` are
byte-identical in behaviour to the run that produced the artifacts. This was **verified
rather than asserted**: the spike was re-run and `out/results.json` and
`out/metrics.md` compared byte-for-byte against the preserved artifacts (see §M6).
`out/perf.json` is a captured non-deterministic performance snapshot and is **not**
claimed to be reproducible; it was preserved, not regenerated.

## M6. Artifact preservation — verified

The accepted findings changed only comments, documentation and tests, so the
deterministic artifacts were **preserved, not regenerated**. Rather than assert that,
the spike was re-run in full and its output compared byte-for-byte against the
preserved files:

```
=== ARTIFACT PRESERVATION CHECK ===
UNCHANGED: results.json
UNCHANGED: metrics.md
```

| artifact | sha256 | status |
| --- | --- | --- |
| `out/results.json` | `7346e9b22c689a80189c059196e58c211988fbe370b2bd8a38115c2c164f22bc` | unchanged, re-verified |
| `out/metrics.md` | `2fe78152dd8ae68a4b75a8514bddddc94f2df6e407ecdc13ff72e66177ec33e8` | unchanged, re-verified |
| `out/perf.json` | — | **captured non-deterministic snapshot**; preserved, not regenerated, and **not** claimed reproducible |

The re-run reproduced the same totals: 13,108 scenarios, 78,648 cases, D 11,519 correct
/ 0 wrong, B 1,020 wrong.

## M7. Acceptance validation

| check | result |
| --- | --- |
| spike tests | **83 pass / 0 fail** (76 + 7 MMX regressions) |
| WD1.1 `round-trip` + `source-map` | 47 pass |
| WD1.2 `edit` | 53 pass |
| WD1.3 `node-schema` | 35 pass |
| `npm run check` (production) | **719 pass / 0 fail — unchanged** |
| `git diff --check` | clean |
| `git diff --stat HEAD` | empty — no tracked file changed |
| `git status --short` | `?? spikes/wd1-node-identity/` only |
| files outside the spike | none created or modified |
| dependencies / lockfile / package scripts | unchanged |
| production source / corpus originals / ISO mirror | unchanged |
| White Dune / RE-ARTIFACTS | not accessed (`FORBIDDEN_MARKERS` guard throws) |

## M8. Recommendation

**ACCEPT WD1.4 for commit.**

The acceptance review raised one blocker and two high findings; all three were
reproduced against and **refuted by evidence**, and each is now pinned by a regression
test so it cannot silently become true. The six accepted findings were documentation,
test-coverage and hardening improvements — none changed executable behaviour, which was
verified by byte-identical artifact reproduction.

The zero-wrong-anchor result stands: **A1, A2, C, D and E record 0 wrong anchors across
78,648 cases; B records 1,020 and is permanently rejected.** The two-tier hybrid
contract (§C7) follows from that evidence, and the independent reviewer independently
judged it consistent with the data.

Still uncommitted and awaiting Ryan's approval.

## M9. Final file listing (bytes, post-acceptance)

| file | bytes |
| --- | ---: |
| `README.md` | 12,804 |
| `REPORT.md` | (this file) |
| `corpus.js` | 22,610 |
| `identity.js` | 26,572 |
| `oracle.js` | 8,305 |
| `report.js` | 7,945 |
| `run.js` | 26,128 |
| `scenarios.js` | 28,068 |
| `session.js` | 4,000 |
| `transaction.js` | 8,859 |
| `test.js` | 60,841 |
| `fixtures/proto-in-mfnode-array.wrl` | 2,703 |
| `out/results.json` | 1,343,176 |
| `out/metrics.md` | 262,029 |
| `out/perf.json` | 3,273 |

`git status --short` lists exactly one entry: `?? spikes/wd1-node-identity/`.
