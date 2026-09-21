# Mall upload-size contract

**Scope:** the Mall Item profile only. World Project and Generic VRML97 have no
upload-size cap and none of the rules below apply to them.

## The limit

```
MALL_UPLOAD_MAX_BYTES = 81290
```

81,290 bytes, exactly. Not `80 * 1024`, not 80,000, and not a rounded "80 KB"
display value. It is defined once in `validator.js` and exported; nothing else
in the codebase may restate it. The renderer receives it on every payload as
`mallUploadMaxBytes` rather than duplicating the number.

The comparison is **inclusive**:

| measured artifact | verdict |
|---|---|
| 81,290 B | PASS |
| 81,291 B | FAIL |

## The three numbers

The gate applies to the **actual `.wrl` file that will be uploaded**. WRLForge
used to recompress the decompressed text with Node zlib level 9 and present that
prediction as the upload size. Those are different numbers, and the difference
is large enough to invert the verdict: the shipping "Ragnum Red" item is a
72,820 B gzip artifact (PASS, 8,470 B of headroom) whose text re-encodes to
87,187 B under Node zlib (FAIL). The artifact was packed with a stronger
encoder; WRLForge's prediction said nothing about it.

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

and then `artifactBytes <= 81290` decides it. In every other state the size row
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
main.js                    owns filesystem access
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
Upload size measured from the gzip artifact on disk. Limit 81,290 B.
```

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

`test/fixtures/gzip-encodings/` holds committed byte-exact proof that the same
VRML text can be a legal gzip `.wrl` on either side of the limit:
`twin-small.wrl.gz` (451 B, PASS) and `twin-large.wrl.gz` (81,781 B, FAIL) both
decompress to `twin.plain.wrl`, giving identical `textBytes` and identical
`predictedRepackBytes`. Only the measurement differs. Their bytes are pinned by
SHA-256 in `test/preview/fixture-byte-contract.test.js` and must never be
regenerated by a test.

## Out of scope here

This contract describes how size is **measured and reported**. It deliberately
does not change WRLForge's compression strategy: `mall:repack` still writes Node
zlib level 9, which can inflate a Zopfli-packed artifact. That defect — plus
unchanged-artifact preservation and a size-regression guard — is separate work.
