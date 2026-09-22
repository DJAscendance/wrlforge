# Mall upload-size contract

**Scope:** the Mall Item profile only. World Project and Generic VRML97 have no
upload-size cap and none of the rules below apply to them.

## The limit

```
MALL_UPLOAD_MAX_BYTES = 80 * 1024   // 81,920 bytes
```

**80 KiB — `80 * 1024` = 81,920 bytes.** Binary KiB, not a decimal 80,000. The
constant is written as the arithmetic it comes from so the rule, not a literal,
is what the code states. It is defined once in `validator.js` and exported;
nothing else in the codebase may restate it. The renderer receives it on every
payload as `mallUploadMaxBytes` rather than duplicating the number.

The comparison is **inclusive**:

| measured artifact | verdict |
|---|---|
| 81,920 B | PASS |
| 81,921 B | FAIL |

> **Correction note.** An earlier revision of this contract stated the limit as
> "81,290 bytes, exactly — not `80 * 1024`". That was a transposed numeric typo
> (81,290 for 81,920) which was then described as an exact owner-confirmed
> value. It never was. The owner-confirmed rule is `80 * 1024`. Any surviving
> reference to 81,290, 81,291, or an 8,470 B Ragnum headroom is wrong.

## The three numbers

The gate applies to the **actual `.wrl` file that will be uploaded**. WRLForge
used to recompress the decompressed text with Node zlib level 9 and present that
prediction as the upload size. Those are different numbers, and the difference
is large enough to invert the verdict: the shipping "Ragnum Red" item is a
72,820 B gzip artifact (PASS, 9,100 B of headroom) whose text re-encodes under
Node zlib to a size well over the limit (FAIL). The artifact was packed with a
stronger encoder; WRLForge's prediction said nothing about it.

The predicted number is **not portable**. It depends on the zlib build Node was
linked against: the historical Linux baseline produced 87,187 B, while macOS
arm64 / Node 26 against a shared system zlib produces 87,366 B for the same
text. On every environment validated for this regression the prediction still
exceeds the 81,920 B limit while the measured artifact passes — that inversion
is the contract, not any single byte count. Tests therefore assert the
inversion, never a hard-coded predicted size.

So three facts are reported, and never merged:

| field | meaning |
|---|---|
| `textBytes` | UTF-8 byte length of the text being validated. Not an artifact size. |
| `artifactBytes` | Measured byte length of the real gzip upload artifact, or `null`. Never synthesised from text. |
| `predictedRepackBytes` | What a WRLForge zlib level-9 repack **would** write for this text. Advisory pre-flight only — never the current upload size. |

## Authority and status

```
sizeAuthority : 'measured' | 'none'
sizeStatus    : 'pass' | 'fail' | 'stale' | 'unknown'
sizeReason    : 'measured' | 'stale-artifact' | 'no-gzip-artifact' | 'unverified-artifact'
```

A hard size PASS or FAIL exists **only** when both hold:

```
artifactBytes !== null   AND   artifactMatchesText === true
```

and then `artifactBytes <= 81920` decides it. In every other state the size row
is severity `info` with `pass: null`, so an unverified size can neither approve
nor fail the item.

### State matrix

| state | `artifactBytes` | `artifactMatchesText` | `sizeAuthority` | `sizeStatus` |
|---|---|---|---|---|
| gzip artifact matching the text | measured | `true` | `measured` | `pass` / `fail` |
| gzip artifact, text has been edited | measured | `false` | `none` | `stale` |
| gzip artifact, identity unproven or stream corrupt | measured | `null` | `none` | `unknown` |
| plain `.wrl`, no gzip artifact packed | `null` | `null` | `none` | `unknown` |
| artifact just written by repack | measured **after** the write | `true` | `measured` | `pass` / `fail` |

Only a **gzip** file counts as a Mall upload artifact. A plain `.wrl` on disk is
the editable source; when it matches the buffer its byte count is already
reported as `textBytes`, so counting it again as an "upload artifact" would
claim an upload that was never packed.

A freshly repacked artifact is **measured from the file that was written**, never
from the pre-write prediction.

## `ok` vs `mallReady`

`ok` keeps its established meaning: every **hard structural** rule passed. It
does not imply the item is uploadable — a structurally perfect document with
nothing packed has no proven size.

`mallReady` is the stricter question: `ok && sizeStatus === 'pass'`. It is never
true while the size is `stale` or `unknown`.

The UI must not describe an unverified item as "Mall ready", "Upload ready", or
size PASS. It says **NOT VERIFIED**.

## Where each responsibility lives

```
main.js                    owns filesystem access; the repack handler is thin
src/mall/repack.js         composes the safe write, then asks Lane A for the verdict
src/editor/file-io.js      the ONLY writer: preservation, candidate guards, atomic swap
src/mall/artifact-size.js  measures the file and PROVES it matches the text
validator.js               evaluates supplied facts; stays filesystem-free
renderer/renderer.js       displays the supplied result; hard-codes no limit
```

`validate(text, sizeContext)` takes facts, never paths:

```js
validate(text, { artifactBytes: 72820, artifactIsGzip: true, artifactMatchesText: true })
```

`mallPayload(base, validation)` assembles IPC payloads and **throws** if the
validator result would shadow a measured file fact. That guard exists because the
collision already shipped once: `main.js` set the real artifact byte count and
then spread `...validate(text)` over it, so the text-derived number silently won.

## UI

Three tiles, each naming the source of its number:

```
text bytes (decompressed)   upload size (measured)   predicted WRLForge repack size
        335,924                    72,820                      87,187
                                    PASS
Upload size measured from the gzip artifact on disk. Limit 81,920 B.
```

Example values, from the Ragnum Red measurement on the historical Linux
baseline. The first two are fixed properties of that artifact; the third is
whatever the running Node's zlib produces, so it varies by build (see above).

Stale and unknown states show `-` in the measured tile — a stale artifact is a
real measurement of a *different* document — plus the state in words:

```
upload size (measured)          upload size (measured)
          -                               -
       STALE                        NOT VERIFIED
Upload size not verified for     Upload size not verified —
current edits — the existing     no gzip upload artifact exists.
artifact is stale. …             …
```

`PASS` / `FAIL` / `STALE` / `NOT VERIFIED` are always present as text and in the
tile's `aria-label`, so the state never depends on colour alone.

## Fixtures

`test/fixtures/gzip-encodings/` holds two committed byte-exact pairs. Both
prove that the same VRML text can be a legal gzip `.wrl` at very different
sizes; they differ in what they say about the limit.

**Encoding variance** — `twin-small.wrl.gz` (451 B) and `twin-large.wrl.gz`
(81,781 B) both decompress to `twin.plain.wrl` (81,753 B), giving identical
`textBytes` and identical `predictedRepackBytes` from a ~181× difference in
measured bytes. Under the corrected 81,920 B ceiling **both PASS** — 81,781 B is
under 80 KiB, so `twin-large.wrl.gz` is *not* an over-limit artifact and must
not be described as one.

**Limit straddle** — `limit-twin-small.wrl.gz` (589 B, PASS) and
`limit-twin-large.wrl.gz` (120,063 B, FAIL) both decompress to
`limit-twin.plain.wrl` (120,030 B). The large form is stored (DEFLATE level 0)
and clears the ceiling by 38,143 B, so the straddle is deliberate and robust
rather than a fragile one-byte margin.

Every one of these files is pinned by exact byte count and SHA-256 in
`test/preview/fixture-byte-contract.test.js` and must never be regenerated by a
test.

## Repack write safety (Lane B)

Measuring the artifact honestly is only half the contract. The other half is not
destroying it. `mall:repack` used to back up, `writeFileSync` straight onto the
real upload artifact, and *then* measure what it had already replaced — so an
over-limit result was discovered after the damage, and a well-packed artifact
was re-encoded on every save.

Repack now runs this order, and every step before the write is a step that can
refuse without touching the destination:

```
1. preservation   unchanged gzip artifact -> NO write at all
2. encode         exact candidate bytes, in memory
3. verify         the candidate must decode back to exactly this text
4. measure        candidate.length
5. ceiling        over 81,920 B -> ESIZE, refused before any mutation
6. temp sibling   write + fsync + close
7. read back      the temp must decode to exactly this text
8. backup         timestamped copy of the prior artifact
9. rename         atomic replace
10. measure       the REAL file now on disk  <- Lane A
11. validate      the verdict, from that measurement
```

**Unchanged gzip preservation.** Step 1 is a true no-op: no encode, no temp, no
backup, no new mtime, `writtenBytes: 0`, `preserved: true`. Identity must be
*proven* by exact decompressed-text comparison; anything unprovable falls
through to the normal write. This is what keeps Ragnum Red's 72,820 B
Zopfli-packed artifact alive — a Node zlib re-encode of the same text lands over
the limit, so re-packing an unchanged file would turn a valid item into a
rejected one.

Preservation deliberately runs **before** the ceiling. A file that needs no
write has no candidate, so ESIZE can never apply to it.

**The verified pre-write candidate is not the upload size.** Steps 3–5 protect
the write; they never report it. The candidate byte count is labelled a
*candidate* in the payload (`candidateBytes`) and in the UI. Lane A's measured
artifact remains the only authoritative upload size — after a successful write,
after a preserved no-op, and after a refusal, where it describes the untouched
artifact that survived.

**Two verifications, not one.** The candidate check proves the *encoder*; the
temp read-back proves the *bytes that reached the disk*. Neither substitutes for
the other, and both must pass before a backup is taken.

**No write means no backup.** A preserved repack creates no `.bak-` file,
because there is no overwrite to protect against. A real overwrite still creates
its normal timestamped backup, immediately before the atomic rename. A rename
failure therefore leaves that backup on disk next to an intact original — a
copy, not a partial write.

**Plain output is not gated.** `asGzip: false` writes a plain `.wrl` through the
same temp/verify/backup/atomic discipline but gets no upload ceiling and no
preservation shortcut: a plain file is the editable source, not an upload
artifact, so its size state stays `no-gzip-artifact` rather than inventing a
PASS.

`src/editor/file-io.js` stays profile-neutral throughout. It takes `maxBytes` as
a number and never imports `validator.js`; `src/mall/repack.js` supplies
`MALL_UPLOAD_MAX_BYTES`.

## Out of scope here

This contract describes how size is **measured and reported**, and how a repack
**refuses to damage** the artifact it measures. It deliberately does not change
WRLForge's compression *strategy*: a changed document is still encoded with Node
zlib level 9. Preservation removes the needless re-encode of an unchanged file;
it does not make WRLForge pack as well as Zopfli. A stronger encoder, and Save
As preservation policy, remain separate work.
