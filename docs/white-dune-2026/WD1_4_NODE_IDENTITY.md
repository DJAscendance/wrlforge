# WD1.4 — stable node identity (as built)

Production contract for `src/vrml/node-identity.js` and
`src/vrml/document-transaction.js`. The evidence behind every decision here is
`spikes/wd1-node-identity/REPORT.md`; this file records only what shipped.

Both modules are **pure and browser-safe**: no `fs`, no Electron, no crypto, no
CodeMirror, no parser import. Nothing is written into a document — no synthetic
id, no comment, no sidecar, no second buffer. **There are no callers in
production yet**; this is the foundation a future scene tree / inspector
selection model resolves through, not a UI integration.

## The hard gate

A selection may be **lost**. A selection may be **ambiguous**. Identity may say
it cannot be proven. It may **never** confidently return a different node.

## Canonical document model (unchanged)

The exact source-text buffer is the document. Tokens, AST, source map, scene
tree, semantic indexes, inspector state, viewport state and node-selection
projections are derived and disposable. Identity is proven from a parse plus a
verified transaction, or from a safely unique DEF anchor — never stored.

## Public surface

`require('./src/vrml')` exposes two frozen facade objects, `documentTransaction`
and `nodeIdentity`. This is the whole public surface — deliberately narrower than
what the modules export.

| call | on | returns |
|---|---|---|
| `verifyTransaction({oldText, edits, newText})` | `documentTransaction` | verified receipt, or a structured rejection |
| `isVerifiedReceipt` | `documentTransaction` | is this still a live receipt? |
| `TX_ERROR` / `TX_STATUS` / `TX_REASON` | `documentTransaction` | stable constant tables |
| `createParseSession(text, parseResult)` | `nodeIdentity` | frozen session; unforgeable |
| `createCurrentSelection` / `resolveCurrentSelection` | `nodeIdentity` | Tier 0 |
| `createTransactionAnchor` / `resolveTransactionAnchor` | `nodeIdentity` | Tier 1 |
| `createPersistentAnchor` / `resolvePersistentAnchor` | `nodeIdentity` | Tier 2 |
| `isResolved` / `isAmbiguous` / `isRefused` | `nodeIdentity` | inspect a result |
| `IDENTITY_ERROR` / `IDENTITY_STATUS` / `ANCHOR_STATUS` / `IDENTITY_REASON` / `ANCHOR_KIND` | `nodeIdentity` | stable constant tables |

`isParseSession`, `assertParseSession`, `receiptBindsOldText`,
`receiptBindsNewText`, `receiptEdits`, `firstDivergence` and `CTX` remain module
exports — `node-identity.js` composes against them and the focused tests use
them — but they are **internal** and are not on the facade. `receiptEdits` in
particular exists for exactly one caller, Tier 1's span mapping; it returns a
frozen array of frozen edits and re-checks that on every call, so there is no
route from it back to mutable receipt state. There is **no** `resetParseSessions`
anywhere: a restartable counter is what made two documents able to display the
same session id.

Creation returns `{status:'created', anchor}` or
`{status:'unsupported', anchor:null, reason}`. Resolution returns a frozen
`{status:'resolved'|'ambiguous'|'refused', node, reason}` — never a bare `null`,
and never a node on a non-resolved status. Reason ids are stable
(`IDENTITY_REASON`, `TX_REASON`).

## Parse sessions

One exact text bound to one exact parse, with an id from a monotonic counter (no
clock, no random value, nothing written to disk or into source). Two parses of
byte-identical text are two **different** sessions, because AST nodes are
compared by object identity and that comparison is meaningless across parses.
Session membership lives in a module-private `WeakSet`, so a session-shaped
literal is rejected; a node from another session throws `EIDENTITYNODE`, and a
bare parse result throws `ETXSESSION`. There is no quiet path around the guard.

**`sessionId` is diagnostic only, and nothing authorizes on it.** Selections and
Tier 1 anchors are bound to the originating session **object** in a module-private
`WeakMap`; resolution compares objects. An earlier revision compared
`selection.sessionId !== session.sessionId`, and because the counter could be
restarted, two unrelated documents could both mint `ps1` — a selection made in the
first then returned `status: 'resolved'` with a node that did not exist in the
second document's tree, at a range spanning entirely different bytes. Both the
comparison and the reset helper are gone, and
`resolution never compares a session id -- the session OBJECT authorizes` pins it
by scanning the resolver bodies.

## Verified transactions

`verifyTransaction` validates the edit set through the accepted WD1.2 algebra,
applies it with WD1.2, and requires the result to equal `newText` **byte for
byte** — exact equality, not a digest, so the module stays crypto-free and
renderer-loadable. An empty edit set against changed text is refused under its
own reason.

The receipt is **ephemeral**: unforgeable (module-private `WeakMap`),
non-serializable (a JSON round-trip produces an inert object), bound to exactly
one `(oldText, newText)` pair, invalid the moment the transaction chain breaks,
and never to be persisted or replayed. It **may** be reused to re-anchor many
selections through the same transaction. It legitimately retains references to
both exact texts while it lives.

## Tier 1 — verified same-transaction re-anchoring

Anchor evidence: outer range, node type, DEF name, parent node type, containing
field, and the originating session id. No structural path, no field values, no
serialized node summary.

Resolution refuses unless the receipt is authentic, bound to the anchor's
document, and produces the new session's exact text; then the **containment
rule** applies — every edit must be wholly before, wholly after, or *strictly
inside* the node. A boundary-touching edit, a crossing edit, a whole-node
replacement and a deletion of the selection all refuse. The edit set is read
from the receipt, never from the caller. The mapped span must then be occupied
by exactly one node with matching type, DEF name, parent type and containing
field.

Tier 1 preserves anonymous nodes and byte-identical siblings across ordinary
edits. It is **not** durable and must never survive a reload, reopen, external
edit, unknown edit chain, serialization or persistence.

## Tier 2 — persistent DEF identity

A uniquely named DEF plus node type plus the PROTO-lexical scope the parse tree
itself proves. Order matters and is the safety property: collect every node with
that name in that scope → none is a safe loss → **more than one is ambiguous,
decided on the name alone** → only a single survivor is then required to match
node type. Never first-match, never closest-match. A renamed DEF is a safe loss.
Anonymous nodes have no persistent identity.

Fails closed where scope cannot be proven: an unnamed PROTO ancestor
(`proto-scope-not-provable`), and a parse that hit the node budget or depth cap,
which cannot prove uniqueness at all (`document-parse-incomplete`).

The anchor's `scopeKey` is an **opaque token** — do not parse, split or display
it. The tokenizer classifies identifiers by exclusion (deliberately, for real
corpora), so `/` and most punctuation are legal in a PROTO name; the scope chain
is therefore NUL-separated, the one class `isControl` can never emit. The
independent review of this lane found and this lane reproduced a **wrong anchor**
from the earlier `/` separator: `PROTO A/B` and `PROTO A { PROTO B }` spelled the
same key, so an anchor from one resolved confidently into the other. Pinned by
`Tier 2: a PROTO name that looks like a scope chain does not collide with one`.

This is **not** a scope engine and does not presuppose WD1.5.

## Rejected, and absent from the source

Structural-path identity (spike strategy B — *historically* 1,020 wrong anchors,
including 68 where it returned a node after the selection was deleted, as
recorded in the committed spike `REPORT.md`; 1,025 on the later corpus snapshot
below), fingerprint identity,
the combined strategy, sibling-index identity, closest-range matching, fuzzy
scoring, highest-score selection, retained source-text or JSON fingerprints,
hidden synthetic ids, identity comments, sidecar metadata, scene graph as
canonical state, whole-document regeneration, and AST object identity across
reparses. `test/vrml/node-identity.test.js` asserts these do not exist, by
source scan (comments stripped) and by behaviour.

**Deviation from `WD1_LOSSLESS_DOCUMENT_CORE_PLAN.md` §3, deliberate:** the plan
listed `src/vrml/node-path.js` — "a structural path from document root that
survives reparse". The WD1.4 spike disproved that design, so no such module
exists and none may be added. The plan also placed
`document-transaction.js` under `src/editor/`; it is in `src/vrml/` because it
must stay parser-adjacent, pure, and free of any editor dependency.

## Corpus conformance (production, not the prototype)

Focused unit tests prove the contract on authored fixtures; they cannot prove
that translating the accepted spike strategies into production code left no
corpus-dependent wrong anchor. A read-only sweep therefore drove the **production**
APIs through the committed spike's own corpus discovery, 30 scenarios,
deterministic seed and **independent oracle** (a scratchpad adapter — nothing in
`spikes/` was modified, and no generated result is committed). Production was
compared only to the oracle, never to a spike candidate's answer.

**These are an OBSERVED SNAPSHOT, taken 2026-08-06, not fixed constants.** Most of
the corpus lives in external workspace trees that change independently of this
repository, so a later sweep will legitimately sample a slightly different set.
Re-derive the numbers before quoting them; what is contractual is the **zero**, not
the totals.

**181 sampled files · 9 corpus groups · 868 selected nodes · 13,181 scenario
applications · 13,181 receipts, all verified · oracle established 13,180,
unresolved 1.**

| tier | eligible | correct | safe loss | ambiguous | **wrong** |
|---|---:|---:|---:|---:|---:|
| Tier 1 (verified transaction) | 13,181 | 11,582 | 1,598 | 0 | **0** |
| Tier 2 (persistent DEF) | 6,470 | 5,400 | 737 | 333 | **0** |

Tier 1 anchored every selected node (0 unsupported). Tier 2 declined 498 of 868
up front — 486 anonymous, 12 not unique in scope — which is the tier working as
specified, not a gap. By selection class: a **deleted** DEF was a safe loss all
370 times and a **renamed** DEF all 367 times; introducing a duplicate produced
`ambiguous` all 333 times (never a type-narrowed survivor); PROTO-scoped edits
resolved 140/140; hyphenated DEFs, vendor node types and recovered parses behaved
like any other node.

Re-running the committed spike unchanged on the same corpus reproduces the same
sample (13,181 scenarios / 868 nodes), and its Strategy D row is
`correct 11,582 · safe-loss 1,598 · ambiguous 0 · wrong 0` — **identical** to
production Tier 1. Its A2 row is `correct 5,400 · ambiguous 333 · wrong 0`, also
identical, with the safe-loss difference fully accounted for by production
declining to create an anchor at all where A2 carried an unsupported descriptor.
**No behavioural difference was found.** The stored spike artifact records the
*historical* 13,108 scenarios over 863 nodes; that gap is drift in the external
corpus trees between the two runs (2,295 → 2,292 unique parseable files),
reproduced by the unmodified spike itself, not a difference between prototype and
production — which is exactly why the totals above are labelled a snapshot.
Strategy B, still banned, produced 1,025 wrong anchors on this same corpus: the
positive control showing the harness detects wrong anchors when they exist, which
is what makes production's zero meaningful.

## Test coverage (as committed)

| suite | tests |
|---|---:|
| `test/vrml/document-transaction.test.js` | 36 |
| `test/vrml/node-identity.test.js` | 77 |
| **new production identity tests** | **113** |
| committed WD1.4 spike `spikes/wd1-node-identity/test.js` | 83 |
| complete `npm run check` | **832** |

`check` also syntax-checks both production modules and both test files.

## Memory and performance (observation, not an optimization lane)

Node v24, Linux. The spike's research index cost **54.5 MB** on a DEF/USE-heavy
world because it retained a serialized summary string per node. Production keeps
one small record per node instance and no per-node string:

| document | chars | AST nodes | node instances | index heap | anchor create | verify | Tier 1 resolve | Tier 2 resolve |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| synthetic DEF/USE-heavy (4,500 DEF, 1,500 USE) | 413,249 | 39,005 | 7,501 | **2.15 MB** | 0.001 ms | 0.445 ms | 0.003 ms | 0.001 ms |
| `test/fixtures/oversized.wrl` | 326,887 | 33,018 | 4 | 0.04 MB | 0.009 ms | 0.404 ms | 0.033 ms | — |
| `test/fixtures/preview/real-smartcar-lite.wrl` | 17,675 | 2,734 | 210 | 0.03 MB | 0.001 ms | 0.024 ms | 0.005 ms | 0.011 ms |
| `test/fixtures/world/valid70/world.wrl` | 6,929 | 652 | 286 | 0.10 MB | 0.001 ms | 0.019 ms | 0.003 ms | — |

≈300 bytes per node instance, a ~25× reduction against the spike at comparable
node counts. Re-anchoring is free; the cost of an edit→reparse→re-anchor loop is
the reparse (33–85 ms on these documents), unchanged by this lane. Incremental
parsing remains out of scope. The index is built lazily on first use, cached
against its session in a `WeakMap`, and released with the session.

## Compatibility

Standards-first and type-agnostic: node types are an equality constraint only,
so vendor and historical Cybertown/Blaxxun nodes, hyphenated DEF names, PROTO
instances, recovered parses and gzip-loaded documents (once decompressed to
canonical text) all behave identically. No Mall limit, placement rule, texture
rule, upload-size rule or viewer-specific behaviour appears here, and none may
be added — Cybertown and Blaxxun stay optional profiles outside the core.
