# Phase 7C5.1 — App-icon integration + QA-record closeout

Scoped closeout (not a new product phase). Integrates the four owner-approved
`assets/wrl-forge-*.svg` sources into a deterministic app-icon pipeline, applies
the cyan opaque icon as the single executable identity, ships all four variants
for user "Change Icon", and corrects the independent 7C5 QA report against real
evidence. Accepted on **Linux and native Windows 11**.

- **Baseline:** `c95b5a5` (7C5 accepted).
- **Closeout commits:** `1cbbb68` (icon integration) + `5c9af96` (byte-exact
  `.gitattributes` for icon assets) + the evidence/report commit.
- **Version unchanged:** `1.3.0-beta.1` (icon assets only; no product-phase bump).

## Verdict

| Gate | Result |
|---|---|
| Linux tests + syntax gate | ✅ 580/580 (55 files), `npm run check` exit 0 |
| Windows tests + syntax gate (local NTFS) | ✅ 580/580, exit 0 (same commit) |
| Icon determinism (per-platform, ×2) | ✅ byte-identical on Linux and on Windows |
| Icon determinism (cross-platform) | ✅ Linux == Windows byte-identical (15 files incl. MANIFEST) |
| Source SVGs preserved | ✅ before==after; byte-identical across platforms after `-text` |
| ICO validity | ✅ 4 variants × 7 entries (16→256), `file`/ImageMagick/PIL + PIL decode |
| ICO embedded in exe | ✅ win-unpacked + installed exe carry all sizes 16→256; 256px = cyan WRL |
| Choosable icons shipped | ✅ 4 `.ico` in `resources/icons/` (win-unpacked + installed) |
| `build:win` portable + NSIS | ✅ built natively, unsigned, ICO passed electron-builder |
| Registry `DisplayVersion` | ✅ `1.3.0-beta.1` (read from HKCU uninstall key, not inferred) |
| NSIS install → launch → uninstall | ✅ installs, boots (xite + preview), self-quits, uninstalls clean |
| Fixtures integrity | ✅ 172 fixtures byte-identical before/after (no mutation) |
| Process survivors | ✅ 0 before/after every launch (dev, installed, portable) |
| Portable handshake | ⚠️ unchanged known limitation (stub doesn't forward stdout); not a failure |
| Icon tests | ✅ `test/assets/icon-generation.test.js` + product-posture guards |

## Icon structure

```
assets/
  wrl-forge-cyan.svg  wrl-forge-cyan-transparent.svg  wrl-forge-yellow.svg  wrl-forge-yellow-transparent.svg   (source, byte-exact)
  generated/icons/
    windows/  wrl-forge-{cyan,cyan-transparent,yellow,yellow-transparent}.ico   (cyan = primary; all 4 choosable)
    linux/    16x16 … 512x512 png (cyan)
    runtime/  icon.png (cyan 256; BrowserWindow)  about-logo.png (cyan transparent 256)
    MANIFEST.json
```

Generation: `npm run build:icons` (`scripts/build-icons.js`, `@resvg/resvg-js`
devDependency + pure-Node ICO assembler, system fonts disabled). See `docs/ICONS.md`.

## Part-1 QA-report correction

`qa/phase-7c-windows/gemini-qa-report-7c5.md` (previously outside the repo) is
corrected: Linux total "224/224" → real **55 files / 567→580 tests**; "Leaks: 0" →
evidence-based no-survivor wording; installed `DisplayVersion` now read from the
HKCU registry, not inferred from a filename. Verdict retained: **GO**.

## Evidence

- `environment-linux.json`, `windows/environment-windows.json`
- `source-svg-hashes-before.txt`, `source-svg-hashes-after.txt`
- `generated-icon-hashes-linux.txt`, `windows/generated-icon-hashes-windows.txt`
- `ico-entry-report.txt`
- `windows/artifact-hashes.txt`
- `windows/` registry evidence in `../phase-7c-windows/gemini-qa-report-7c5.md` §6
- `windows/fixture-hashes-before.txt` / `after.txt`
- `windows/processes-before.txt` / `after.txt`, `windows/installed-smoke.out.txt`
- `windows/rogue-dirs-inventory.txt` (the two archived+deleted C:\ scratch dirs)
- `windows/screenshots/` (exe-embedded + installed exe 256px icons)

Excluded from git (kept on host): full npm logs, the rogue-dirs archive zip, and
all release binaries (`release/` is git-ignored).
