# WD1.7-B — external PROTO retrieval substrate

**Status:** implemented, independent QA **PASS**, then **two URL-semantics
corrections applied**; awaiting focused QA of those corrections. Uncommitted.
**Predecessor:** WD1.7-A (`bca801e`), recon + resolver contract, QA-passed and ratified.
**Module:** `src/external-proto/` — the first `fs`-bound VRML module in the repository.

**Two corrections were applied after independent QA passed**, and they supersede
the corresponding entries in §17 of this document's first revision:

- **C1 — default HTTP/HTTPS ports canonicalize.** `http://h` == `http://h:80`,
  `https://h` == `https://h:443`; non-default ports and the two schemes stay
  distinct. → §6, §8
- **C2 — URL-space excess `..` is clamped at the namespace root**, not refused.
  Archive space, where the root is a filesystem boundary, still refuses. → §8, §11
**Consumers:** none. Like P2A/P2B/P2C and WD1.6-A/B/C/D before it, this lane ships
a substrate and wires it into nothing.

Read `docs/white-dune-2026/WD1_7_A_EXTERNAL_PROTO_EVIDENCE.md` first — §8
(retrieval is not resolution), §9 (provenance), §10 (statuses), §12 (security),
§15/§15.1–15.3 (API and the origin-aware mapping correction F2) and §16 (lane
decomposition) are this lane's brief, and are treated as binding.

---

## 1. What B does, in one sentence

> Given an explicitly configured retrieval context, a base document, and one
> written external reference candidate, deterministically attempt to obtain and
> safely decode the corresponding artifact while preserving complete provenance
> and uncertainty.

A `RETRIEVED` result means exactly:

> WRL Forge deterministically obtained and decoded one candidate artifact under
> the configured retrieval policy.

It does **not** mean *"this artifact contains the correct PROTO implementation"* —
that is ISO 4.9.3 target selection, and it is WD1.7-C's. It does **not** mean the
bytes are syntactically valid VRML97 either: B never parses what it retrieved, so
`RETRIEVED` carries no claim about the document's contents. It does not even mean
the text decoded cleanly — a `RETRIEVED` result may carry `utf8Valid: false`,
which is an observation for C to act on, not a verdict B has reached.

The vocabulary keeps the distinction visible: this lane's success status is
`RETRIEVED`, never `RESOLVED`.

## 2. What B deliberately does not do

Absent from `src/external-proto/`, and asserted absent by
`test/external-proto/architecture-boundary.test.js`:

| not here | owner |
|---|---|
| ISO 4.9.3 target selection; `#fragment` lookup; first-PROTO-excluding-EXTERNPROTO | WD1.7-C |
| PROTO interface comparison (4.9.2), first-body-node class derivation | WD1.7-D |
| dependency traversal, the `(decodedContentHash, selectedProtoName)` cycle key | WD1.7-C |
| compatibility classification / profile naming | WD1.7-E (blocked on DECISION-1) |
| World Project asset-graph and package-plan integration | WD1.7-B2 |
| any network retrieval | nobody, until DECISION-3 |
| any source rewriting, migration or repair | a separate, explicit migration lane |

The fragment is **split off and carried verbatim** because it is URL syntax and
would otherwise become part of a filename. It is never read.

## 3. Pipeline

```
caller (WD1.7-C, later WD1.7-B2)
    |
    |  context: frozen ResolverContext          (explicit, inert, no ambient state)
    |  baseDocument: { sourceId, path }         (REQUIRED -- ISO 4.5.3/N12)
    |  writtenUrl, candidateIndex               (ONE candidate)
    v
reference-forms.js   classify by KIND        -> UNSUPPORTED_REFERENCE, before any fs
    v
routing.js           configured mapping      -> NOT_RETRIEVED_BY_POLICY | NOT_FOUND
    v                (origin/prefix, base-relative, containment)
retrieval.js         exact-case lookup       -> NOT_FOUND (incl. case-mismatch)
                     realpath containment    -> NOT_RETRIEVED_BY_POLICY (symlink-escape)
                     bounded read            -> LIMIT_EXCEEDED | UNREADABLE_ARTIFACT
                     gzip-by-magic decode    -> DECODE_FAILED | LIMIT_EXCEEDED
                     hashing + UTF-8 report
    v
frozen retrieval evidence  ------------------> RETRIEVED | AMBIGUOUS_SOURCE
    |
    X  B STOPS HERE. The retrieved text is never parsed by this lane.
```

## 4. Module location and the browser boundary

`src/external-proto/` — a new directory, chosen over the two obvious homes:

- **not `src/vrml/`.** That directory is the browser-safe semantic core: the
  renderer and the editor load `require('./src/vrml')`, and it currently pulls in
  no `fs`, `zlib`, `crypto`, `child_process` or `electron`. A retrieval substrate
  is inherently Node-side, and putting it there would make one careless
  `require` contaminate the renderer bundle. Two tests spawn a child process,
  require the facade, and assert (a) no `external-proto` module is loaded and
  (b) no module the facade loads declares a Node capability.
- **not `src/world-project/`.** WD1.7-C, WD1.7-D and WD1.7-B2 all consume it.
  Making one profile the owner of a cross-profile authority is the shape
  WD1.7-A §16 argues against when it makes B2 a *consumer* rather than a second
  resolver.

Import direction is one-way and asserted:

```
renderer / editor semantic layer      (browser-safe, capability-free)
        ^   structured evidence: plain frozen data, no handles
Node-side retrieval substrate         src/external-proto
        |   pure helpers only
src/files/vrml-file.js                gzip magic-byte authority (reused)
```

In-lane graph — acyclic, one-way, and asserted:

```
url-origin.js        (no in-lane deps)   THE origin canonicalization authority
  ^        ^
  |        |
reference-forms.js   resolver-context.js
        ^      ^
        |      |
       routing.js
        ^
        |
    retrieval.js  ->  index.js (facade)
```

B is **not** exported from the `src/vrml` facade, and nothing in `src/`,
`renderer/`, `qa/`, `main.js`, `preload.js` or `validator.js` requires it.

## 5. Public API

```js
const {
  createResolverContext, retrieveExternalCandidate, classifyReference, sourceById,
  REFERENCE_FORM, RETRIEVAL_STATUS, RETRIEVAL_REASON, CLASSIFY_REASON, ROUTE_REASON,
  DEFAULT_LIMITS,
} = require('./src/external-proto');
```

### `createResolverContext(config) -> ResolverContext` (frozen)

```js
{
  sources: [ { id, root, prefix? } ],   // ORDERED. No default. No implicit cwd.
  limits?: { maxBytes, maxDecodedBytes, maxExpansionRatio },
  network?: false,                       // true is REFUSED, not ignored
}
```

### `retrieveExternalCandidate({ context, baseDocument, writtenUrl, candidateIndex }, deps?) -> evidence` (frozen)

```js
{
  candidateIndex, writtenUrl,
  reference: { form, scheme, fragment, locator, origin, originPath },
  base: { sourceId, path },
  target: { origin, path } | null,          // the absolute URL, when in URL space
  requestedPath: string | null,             // archive-relative, prefix stripped
  consideredSourceIds: [ id, ... ],
  status, reason,
  attempts: [ { sourceId, status, reason, caseActual } ],
  matches:  [ { evidenceSourceId, artifactPath, retrievedBytesHash,
                decodedContentHash, wasGzipped, rawBytes, decodedBytes, utf8Valid } ],
  artifact: <one match> | null,             // non-null only on RETRIEVED
  text: string | null,                      // non-null only on RETRIEVED
}
```

`deps` is an injectable `fs` surface (`readdirSync`/`realpathSync`/`statSync`/
`readFileSync`) so the case, symlink and I/O-failure boundaries are testable —
including host filesystems this machine does not have.

**There is no candidate-list helper.** ISO 4.5.2 fallback stops on *interpretable
data*, and whether a retrieved artifact is interpretable is only knowable after
parsing and target selection. A list walker here would inevitably mistake
`RETRIEVED` for *"the EXTERNPROTO resolved"* (WD1.7-A §15.3), so C orchestrates
the fallback and B answers one candidate at a time.

## 6. ResolverContext contract

- **No default sources.** There is no built-in Cybertown mapping, and a test
  asserts no origin literal, owner path, `process.cwd` or `process.env` appears
  in the module.
- **`root` must be absolute.** A relative root resolves against the process cwd —
  the exact ambient dependency this lane exists to eliminate.
- **`prefix` is a URL prefix, not merely an origin.** `http://h` and
  `http://h/3d/` are the same mechanism at two granularities, so one mechanism
  covers both (WD1.7-A §15.1). It is normalised to
  `{ origin: 'scheme://host[:port]', pathPrefix: '/…/' }`, always slash-terminated.
- **A source with no `prefix` is archive-local.** It can host a base document and
  answer relative references inside itself, but owns no URL namespace, so no
  absolute-http or URL-root-relative reference can route into it. That is the
  shape WD1.7-B2 needs for a World Project folder, which genuinely has no origin.
- **Origins are canonicalized by one authority, `url-origin.js`** (correction
  C1). Scheme and host are lowercased, IDN hosts become punycode, port numbers
  normalize, and the **default port for the scheme is elided**:

  | | |
  |---|---|
  | `http://example.com` == `http://example.com:80` | default elided |
  | `https://example.com` == `https://example.com:443` | default elided |
  | `http://example.com` != `http://example.com:8080` | non-default kept |
  | `https://example.com` != `https://example.com:8443` | non-default kept |
  | `http://example.com` != `https://example.com` | scheme is part of the origin |
  | `http://example.com:443` != `http://example.com` | 443 is not *http*'s default |

  This is URL canonicalization and nothing more: an origin still has to be
  explicitly configured, and there is still no host stripping, no suffix search
  and no unknown-origin fallback. **The path is never canonicalized this way** —
  it is case-sensitive and is never handed to the WHATWG parser, which would
  percent-encode and re-spell it into a different filename.

  Configuration and written references share the *same* function, because two
  independently written canonicalizers is how a configured mapping ends up
  silently unreachable. An architecture test asserts no other module in the lane
  constructs an origin or calls `new URL`.

- **Userinfo is refused, not dropped.** `new URL('http://user@h/').origin` is
  `http://h`; accepting that would let
  `http://attacker@www.cybertown.com/x.wrl` map to the configured Cybertown
  archive.
- **`network: true` throws.** Accepting a flag for a capability that does not
  exist would be a lie in the configuration surface.
- **Everything is frozen**, and the caller's own config object is neither frozen
  nor retained.

### Limits are WRL Forge security policy, not ISO

ISO/IEC 14772-1 says nothing about file size, compression or archives
(WD1.7-A §3.2, U1/U2). Defaults:

| limit | default | what it bounds |
|---|---:|---|
| `maxBytes` | 16 MiB | artifact bytes read from disk |
| `maxDecodedBytes` | 64 MiB | decoded VRML source bytes |
| `maxExpansionRatio` | 100 | decoded ÷ retrieved |

## 7. Reference classification

Classification happens **before anything touches a filesystem**.

| form | routable | notes |
|---|---|---|
| `absolute-http` | yes | 41.73% of corpus candidates; routed by configured mapping |
| `bare-relative` · `dot-relative` · `parent-relative` | yes | resolved against the **explicit** base |
| `root-relative` | yes | URL-root-relative; needs the base's URL namespace |
| `urn` | no | **conforming** per ISO 4.9.1/N2; 19.20% of candidates |
| `file` · `protocol-relative` · `windows-path` | no | zero in the corpus; classified so they can be refused |
| `unknown-scheme` | no | `javascript:`, `data:`, `ftp:`, `ws:`, control characters |
| `empty` | no | names nothing; 0.19% of candidates |

Three spellings are refused rather than interpreted, each with its own reason:
a **query string** (an archive cannot honour it), **percent-encoding** (decoding
manufactures `%2e%2e%2f` traversal spellings; zero corpus instances), and a
**backslash** (not a URL separator; converting it is a recovery convention).

A Windows drive letter is detected **before** scheme parsing, or `C:` reads as a
one-character URL scheme.

## 8. Routing and origin behaviour

```
external URL namespace -> explicit configured mapping -> archive root
```

and never `strip the host -> search one generic root`.

- **Unmapped origin ⇒ `NOT_RETRIEVED_BY_POLICY`**, never `NOT_FOUND`. Nothing was
  explored, so nothing is absent.
- **Longest configured prefix wins.** A longer prefix is a strictly more specific
  statement about the same namespace; honouring the broader one would make the
  specific mapping unreachable. Because every prefix is slash-terminated, a
  longer match is always segment-aligned — `/3d/` never captures `/3dx/`.
- **Equally-specific mappings are a candidate set, not an order-decided winner.**
  All of them are attempted, and the verdict comes from *content*: identical
  decoded content is one artifact, differing content is `AMBIGUOUS_SOURCE`.
  Configured order therefore never silently picks a winner.
- **Relative references in URL space are re-routed.** A `../` that leaves one
  mapping's prefix may land in another mapping, or in none — in which case it
  fails closed.
- **Dot-segments are removed from every URL-space path** — absolute-http,
  URL-root-relative and relative alike — *before* mapping, so
  `http://h/a/../lib/x.wrl` and `http://h/lib/x.wrl` route identically and a
  `..` can never survive into an archive lookup.
- **Excess `..` is CLAMPED at the URL namespace root** (correction C2), as
  RFC 3986 specifies and every URL consumer does:

  ```
  base  http://example.com/a/b/world.wrl
  ../foo.wrl                  -> http://example.com/a/foo.wrl
  ../../foo.wrl               -> http://example.com/foo.wrl
  ../../../foo.wrl            -> http://example.com/foo.wrl      clamped
  ../../../../../../foo.wrl   -> http://example.com/foo.wrl      clamped
  ```

  **Clamping grants no reach.** The clamped URL must still match a configured
  mapping — one that leaves every prefix is `NOT_RETRIEVED_BY_POLICY` /
  `unmapped-origin` — and §10 and §11 then apply in full. A URL namespace root
  is not a filesystem boundary, and no filesystem has been touched at this point.
- **Archive space still refuses** (§11). There the configured root *is* a
  filesystem boundary, so clamping would normalise an escape into a legal in-root
  read. `outside-source-root` remains.
- **An interior empty segment (`a//b`) is refused in both spaces.** That is a
  malformed path, not a dot-segment rule; collapsing it would look up a file the
  document did not name.

## 9. Base-document semantics

`baseDocument` is a **required input** and is never inferred, because ISO 4.5.3
(N12) makes it context-dependent: an EXTERNPROTO written inside a PROTO body
resolves against the file where the enclosing prototype is **instantiated**, not
the file it was written in. That is unknowable from the declaration alone.

B accepts `{ sourceId, path }` — an archive-relative POSIX path inside a
configured source — which is sufficient to express both a URL-origin base (via
the source's prefix) and a purely archive-local base. Choosing the *correct*
base for a given EXTERNPROTO occurrence is WD1.7-C's; B's contribution is making
it impossible to omit. A malformed base **throws** rather than becoming a
retrieval status, so a wiring mistake in C or B2 cannot masquerade as a missing
file.

## 10. Exact case, enforced in software

Every requested path component must match a real directory entry with exact
written case. The directory **listing** is authoritative — never `existsSync`,
which answers `true` for `BXX/shared.wrl` on a case-insensitive NTFS/APFS volume
and would make one reference resolve on Windows and die on ext4.

A case-only near-miss is **reported** (`reason: 'case-mismatch'`, with the actual
archive spelling in `attempts[].caseActual`) and never promoted to a hit.
Case-insensitive recovery is an archive convention (WD1.7-A §12, H11) and belongs
to a migration tool. A test simulates a case-insensitive kernel and proves the
strict result is unchanged.

## 11. Root and symlink containment

```
classify -> normalise in URL/archive semantics -> resolve inside a configured root
         -> realpath BOTH ends -> verify containment -> read
```

Containment uses `path.relative`, never `startsWith` — `/root/foobar` starts with
`/root/foo`. Containment is verified **after** symlink resolution, so a symlinked
file, a symlinked directory and a nested symlink chain that leave the root are
all refused (`NOT_RETRIEVED_BY_POLICY` / `symlink-escape`), while a symlink that
stays inside is allowed and a configured root that *is* a symlink still works.

An escape is a **refusal, not an absence**: the bytes exist and we declined to
read them.

### The two roots are different kinds of thing

```
URL namespace normalization   !=   filesystem/archive-root containment
```

A URL namespace root (`scheme://host/`) is a naming boundary: climbing above it
is meaningless, so it is clamped. A configured archive root is a **security**
boundary: climbing above it is an escape, so it is refused. Correction C2 changed
only the first, and four mutation controls (9–12) pin the distinction — including
one that proves a URL-normalised `/foo.wrl` is still looked up **inside** the
configured root and never on the workstation.

## 12. No network

`network: true` throws at construction. No module in the lane requires `http`,
`https`, `net`, `dns`, `child_process` or `electron`, and none contains `fetch(`,
`XMLHttpRequest` or `WebSocket` — asserted by source audit over every file in the
lane. An `http://` reference is retrievable **only** through explicit configured
archive evidence; otherwise it is `NOT_RETRIEVED_BY_POLICY`, which asserts
nothing about whether the network resource exists.

## 13. Compression and decoding

- **gzip is decided by magic bytes only** (`1f 8b`), reusing `src/files/vrml-file.js`'s
  `isGzip` — the existing production authority — rather than forking it. The
  extension is unusable as an oracle: 6,462 corpus files are gzip behind a plain
  `.wrl` name against 58 that announce it, and 3 announce compression they do not
  have (WD1.7-A §7.4).
- **`readWrlSource` is deliberately not reused for the read itself.** It reads
  whole files unbounded and has no cap to hand zlib, so reusing it would lose the
  decompression bound. Same magic-byte detection, same `gunzipSync`, bounded.
- **Decompression is bounded inside zlib**, not measured afterwards: the cap
  passed as `maxOutputLength` is `min(maxDecodedBytes, floor(rawBytes ×
  maxExpansionRatio))`. `maxOutputLength` permits exactly the cap and throws
  `ERR_BUFFER_TOO_LARGE` above it, so a small hostile input is never fully
  expanded in memory first. Which bound was hit is derived from which of the two
  produced the cap, so `expansion-ratio-limit` and `decoded-bytes-limit` stay
  distinct reasons.
- **Raw bytes are capped before allocation** via `stat`, then re-checked against
  the bytes actually read.
- **UTF-8 is reported, not enforced.** `src/preview/wrl-source.js`, the existing
  source-loading authority, decodes with `Buffer#toString('utf8')`, which
  substitutes U+FFFD rather than rejecting. B preserves that behaviour and adds
  an observation, `utf8Valid`. → §16, open question 1.

## 14. Status taxonomy

Retrieval statuses only. `RESOLVED`, `TARGET_PARSE_FAILED`,
`TARGET_PROTO_NOT_FOUND`, `TARGET_PROTO_AMBIGUOUS`, `DEPENDENCY_CYCLE` and
`NOT_ATTEMPTED` are WD1.7-C's and are asserted absent.

| status | reasons | meaning |
|---|---|---|
| `RETRIEVED` | — | exactly one artifact obtained and decoded |
| `NOT_FOUND` | `not-in-configured-sources` · `case-mismatch` · `not-a-regular-file` · `reference-names-no-file` | proven absent within the configured sources |
| `AMBIGUOUS_SOURCE` | `multiple-sources-differing-content` | ≥2 candidate sources, semantically different content |
| `UNSUPPORTED_REFERENCE` | `empty-reference` · `urn-not-retrievable` · `file-scheme-unsupported` · `protocol-relative-unsupported` · `windows-path-unsupported` · `unknown-scheme-unsupported` · `malformed-http-url` · `query-string-unsupported` · `percent-encoding-unsupported` · `backslash-separator-unsupported` · `control-character-unsupported` | not retrievable **by kind**; a `urn:` here is conforming, not an error |
| `NOT_RETRIEVED_BY_POLICY` | `unmapped-origin` · `no-url-namespace-for-base` · `outside-source-root` · `empty-path-segment` · `symlink-escape` | refused; **nothing was proven absent** |
| `DECODE_FAILED` | `gzip-inflate-failed` | bytes retrieved, inflation failed |
| `LIMIT_EXCEEDED` | `raw-bytes-limit` · `decoded-bytes-limit` · `expansion-ratio-limit` | a configured bound was hit |
| `UNREADABLE_ARTIFACT` | `artifact-read-failed` · `directory-unreadable` · `realpath-failed` | located inside a root, bytes unobtainable |

There is no generic `ERROR`.

### `UNREADABLE_ARTIFACT` — a WD1.7-B implementation finding

An addition to WD1.7-A §10's ratified seven, flagged for QA rather than folded in
silently. The A taxonomy has no cell for *"the artifact was located inside a
configured root and its bytes could not be read"* (`EACCES`, `EIO`, an
unreadable directory). Reporting that as `NOT_FOUND` would assert an absence
nobody established; reporting it as `DECODE_FAILED` would claim bytes nobody
got. Keeping independently answerable questions independently answerable is the
discipline P2C paid for with ROUTE endpoints, so it gets its own name. Absence is
still distinguished at the errno level: `ENOENT`/`ENOTDIR` prove absence, every
other errno proves only that we could not look.

## 15. Provenance

Fields exist because a specific question cannot be answered without them
(WD1.7-A §9):

| field | answers |
|---|---|
| `candidateIndex` + `writtenUrl` | which candidate, spelled exactly as authored (whitespace included) |
| `reference.form` / `.fragment` | what kind, and the fragment carried verbatim for C |
| `base` | resolved against what — ISO 4.5.3/N12 |
| `target` + `requestedPath` | the absolute URL and the archive-relative path actually looked up |
| `evidenceSourceId` | which **configured** root supplied it — reproducible under a *named* configuration, not under this machine's disk |
| `artifactPath` | which file, archive-relative |
| `retrievedBytesHash` / `decodedContentHash` | SHA-256 of artifact bytes and of decoded source; a `.wrz`/`.wrl` twin shares the second and differs on the first |
| `wasGzipped`, `rawBytes`, `decodedBytes`, `utf8Valid` | decoding facts, none inferred from a name |
| `attempts` | every candidate source's own outcome, including a case near-miss |
| `matches` | every source that answered — location provenance is **never** collapsed by equal content (§15.2) |

**No absolute host path appears in any result.** Configured roots are an
implementation detail, not semantic truth; a test serialises a result and asserts
neither the root nor the OS temp directory occurs in it. No raw `Buffer` is
exposed either. Every returned structure is frozen, and none of it is written
anywhere — this is a derived value returned by a query, never sidecar state
(`WD.md` §2).

## 16. Duplicate configured sources

| case | verdict |
|---|---|
| one source answers | `RETRIEVED` |
| ≥2 answer, **identical** decoded content | `RETRIEVED`; `matches` retains **every** source |
| ≥2 answer, **different** decoded content | `AMBIGUOUS_SOURCE`; no text, no chosen artifact |
| any candidate source errors (decode/limit/unreadable) | that status, even if another succeeded |

The last row is fail-closed on purpose: content that cannot be compared cannot be
called unambiguous. *(WD1.7-B implementation finding — WD1.7-A did not specify a
mixed success/error case.)*

Identical content does **not** license discarding location provenance
(WD1.7-A §15.2): byte-identical libraries reached through different archive
locations sit under different base contexts, and a later hop's relative
references resolve against the base, not the hash.

## 17. Open questions for QA

> **Resolved by the post-QA corrections, recorded so the history is legible.**
> Two entries in this list previously read *"default ports are not elided"* and
> *"`..` above the root is refused rather than discarded"*. Both were adjudicated
> by the owner and are now C1 and C2 above. Items 1 and 2 below were reviewed and
> explicitly **approved unchanged** by independent QA.

1. **UTF-8 policy is inherited, and it is a pre-existing ambiguity.**
   `readWrlSource` substitutes U+FFFD for invalid UTF-8 rather than rejecting, so
   B does the same and reports `utf8Valid: false`. Whether *external* retrieval
   should instead fail is a real decision; changing project-wide decoding was
   explicitly out of scope for this lane.
2. **`UNREADABLE_ARTIFACT`** — see §14.
3. **Mixed success/error across duplicate sources is terminal** — see §16.
4. **No real-corpus retrieval measurement was produced.** Defining archive
   root/origin mappings for the Cybertown archive is an owner policy decision
   that is not recorded anywhere, and manufacturing one to generate a percentage
   would produce a number whose denominator is an invention. Synthetic
   adversarial proof is this lane's evidence.

## 18. Relationship to the rest of WD1.7

```
WD1.7-B  retrieval substrate          <- this lane
   |
   +-> WD1.7-B2  World Project integration
   |       consumes B to discover EXTERNPROTO dependencies; adds NO second
   |       resolver. The confirmed World Project defect (asset discovery misses
   |       EXTERNPROTO dependencies) is UNTOUCHED here.
   |
   +-> WD1.7-C   target selection (4.9.3): fragment vs first-PROTO-excluding-
   |             EXTERNPROTO, TARGET_* statuses, the (decodedContentHash,
   |             selectedProtoName) cycle key, the dependency graph
   |
   +-> WD1.7-D   interface (4.9.2) + class enrichment over WD1.6-B/C
   |
   +-> WD1.7-E   compatibility classification -- BLOCKED on DECISION-1
```

## 19. Tests

`test/external-proto/` — **137 focused tests** (116 before the corrections), none
imported from `spikes/`.

| file | tests | proves |
|---|---:|---|
| `reference-forms.test.js` | 20 | every form classified; every refusal has its own reason; default-port canonicalization; purity |
| `resolver-context.test.js` | 15 | no defaults, no ambient state, absolute roots, refused prefixes, prefix canonicalization, freezing |
| `routing.test.js` | 33 | origin mapping, default-port matrix, prefix precedence, base semantics, URL clamping vs archive refusal |
| `retrieval.test.js` | 42 | exact case, symlink containment, gzip, limits, provenance, ambiguity, the clamped-URL decoy |
| `security-controls.test.js` | 12 | twelve live mutations, each caught |
| `architecture-boundary.test.js` | 15 | browser boundary, one-way graph, single origin authority, no network/write/target semantics |

The mutation controls copy the lane into a scratch directory, apply one textual
mutation, and prove both that the mutant produces the dangerous answer and that
the real build produces the safe one. Nothing in the repository is modified.
