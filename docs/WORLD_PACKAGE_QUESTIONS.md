# World Package — Open Questions for Morning.star / CTR maintainers

**Status: BLOCKING for any upload-ready packager.** The Phase 5A packaging lane
produces a **review bundle** (a deterministic ZIP of the referenced project files
plus a manifest and report) that is explicitly **“Not Confirmed for Direct
Cybertown Upload.”** It intentionally does **not** implement direct upload,
authentication, or a claim of current-server compatibility.

Before WRL Forge can build a *true* upload-ready package or submit a world, the
following must be answered by Morning.star or the current Cybertown Revival (CTR)
world maintainers. Each is a real unknown today — the Phase 5A bundle format is a
**best-effort placeholder**, not a specification, and must not be presented to
users as server-correct.

## 1. Required archive / layout format
- Does the server expect a **ZIP**, a specific compressed tar, a bare folder, or
  a legacy `.wrl.gz` + loose-assets layout?
- Is there a **required internal directory structure** (e.g. everything flat, or
  a fixed `world/` + `textures/` split), or is project-relative structure (what
  the review bundle preserves) acceptable?
- Is a **manifest/index file** required inside the package, and if so in what
  exact format (name, schema)? The Phase 5A `MANIFEST.json` is WRL Forge's own —
  not known to be what the server reads.

## 2. Maximum total package size
- Is there a **hard total-size cap** for an uploaded world (compressed and/or
  uncompressed)? Phase 3A recon left this **unresolved** — the ~20-texture figure
  was disproven as a texture *count* rule, but a package **byte** limit was never
  confirmed.

## 3. Asset count limits
- Are there limits on **number of textures**, **number of `Inline`/WRL files**,
  or **total asset count**? (Recon evidence: real worlds reach ~70 unique
  textures, so any count limit is higher than the historical web-form figure —
  the exact ceiling, if any, is unknown.)

## 4. Allowed file types
- Which **image formats** are accepted (PNG/JPEG/GIF only, or also BMP/TGA)?
- Are **audio** and **movie** assets allowed, and in which formats?
- Are **gzip-compressed WRL** (`.wrl.gz` / `.wrz`) children accepted server-side,
  or must WRL be plain text? (WRL Forge packages whatever the author used,
  byte-for-byte — it does not transcode.)

## 5. Naming / case requirements
- Is the server filesystem **case-sensitive**? (WRL Forge already blocks
  case-mismatched references defensively, but the authoritative rule is unknown.)
- Are there **character/length restrictions** on filenames (spaces, Unicode,
  path depth)? The review bundle permits spaces (e.g. `wall art.png`); server
  tolerance is unconfirmed.

## 6. Primary-world naming requirements
- Must the primary world file have a **specific name** (e.g. `world.wrl`,
  `index.wrl`) or live at a **specific path** within the package?
- How does the server **identify the primary** among multiple WRL files? (WRL
  Forge detects it by “no other WRL inlines it”, and surfaces ambiguity rather
  than guessing — the server's own rule may differ.)

## 7. Authentication & submission workflow
- What is the **actual submission channel** today (web form, direct file drop,
  operator-mediated, a tool like Scott99's historical `worlduploader`)?
- What **authentication** does it require, and what are the **acceptance /
  rejection** criteria and feedback?
- Is there a **staging/preview** step on the server side before a world goes live?

---

Until these are answered, WRL Forge's packaging lane stays **analysis + review
bundle only**: it never uploads, never authenticates, and never tells a user a
world is “ready for the server.” See `docs/WORLD_PROJECT_ARCHITECTURE.md`
(“Packaging”) and the roadmap Phase 6.
