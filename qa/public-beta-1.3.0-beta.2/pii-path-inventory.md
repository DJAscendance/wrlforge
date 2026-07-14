# Sanitization Inventory — WRL Forge → PUBLIC repo

Read-only inventory produced before making the repo public. Scope: **tracked files only**
(`git ls-files` + `git grep`). No files were edited.

## Scan coverage

| Category | Pattern | Hits |
| --- | --- | --- |
| Owner Linux home path | `/home/ryan/...` | 48 lines |
| Windows user-profile path | `C:\Users\ryan\...` | 33 lines |
| VM IP address | `192.168.122.x` / any `192.168` | **0** (none in tracked files) |
| Disposable scratch path | `/tmp/claude-...` | **0** (none in tracked files) |
| Non-published personal email | any `@` except `ascendnetowner@gmail.com` | **0 personal** (1 false positive: a third-party `glob` deprecation notice `i@izs.me` in `package-lock.json` — leave) |
| Owner LAN host-share name | `host.lan` / `\\host.lan\Data` | 30+ lines |
| Windows test-guest name | libvirt domain `win11` | several lines |

**Generic-target note:** `C:\Projects\wrlforge` is the **already-sanitized recommended clone
path** used throughout the docs — it is NOT a leak. Do **not** flag or change it.

## Priority summary

- **MUST-FIX before public (user-facing):** 2 files — `docs/VRML_PARSER.md`, `wrl-forge.desktop`.
- **SHOULD-FIX (dev/QA docs that reveal owner LAN topology):** 4 files — `docs/PLATFORM_NOTES.md`,
  `docs/WINDOWS_NATIVE_QA_PLAN.md`, `docs/WINDOWS_QA_RUNBOOK.md`, `docs/WRL_FORGE_ROADMAP.md`
  (+ `AGENTS.md`, dev-internal, lowest of this tier).
- **NICE-TO-SANITIZE (internal QA evidence / test data — DO NOT alter technical substance):** the
  `qa/**` evidence artifacts, the `test/` and `qa/` source files, and the functional
  `workspace-guard` marker.
- **LEAVE (byte-locked fixtures / functional evidence):** the `real-smartcar-lite.wrl` author
  comment and captured Windows path-handling evidence (see notes).

Recommended replacement conventions: `/home/ryan` → `/home/user`; `C:\Users\ryan` → `C:\Users\user`;
`host.lan` → `<host-share>`; libvirt domain `win11` → `<windows-test-host>`.

---

# TIER 1 — MUST-FIX (user-facing)

## docs/VRML_PARSER.md  (public architecture doc)

| Line | Matched string | Category | Recommended replacement | Notes |
| --- | --- | --- | --- | --- |
| 261 | `` `/home/ryan/Projects/cybertown`, `` | Owner Linux home path | `` `/home/user/Projects/cybertown` `` (or `<local Cybertown corpus>`) | Corpus-audit context. Substance ("audit over the available Cybertown corpus") is preserved; only the home prefix is personal. |

## wrl-forge.desktop  (installed launcher — ships to users)

| Line | Matched string | Category | Recommended replacement | Notes |
| --- | --- | --- | --- | --- |
| 5 | `Exec=/home/ryan/Projects/cybertown/wrlforge/launch.sh` | Owner Linux home path | `Exec=/home/user/Projects/wrlforge/launch.sh` | This file is a per-machine template; a public reader must edit it anyway. Genericize, or ship it as `wrl-forge.desktop.example` with a placeholder. |
| 6 | `Path=/home/ryan/Projects/cybertown/wrlforge` | Owner Linux home path | `Path=/home/user/Projects/wrlforge` | Same as above. |

---

# TIER 2 — SHOULD-FIX (dev/QA docs revealing owner LAN topology)

`host.lan` is the owner's real SMB-share hostname; `win11` is the owner's libvirt guest name.
`C:\Projects\wrlforge` in these files is the generic target — **keep it**.

## docs/PLATFORM_NOTES.md

| Line | Matched string | Category | Recommended replacement | Notes |
| --- | --- | --- | --- | --- |
| 203 | `WinBoat `\\host.lan\Data` SMB share` | Owner LAN host-share | `\\<host-share>\Data` | Guidance stays valid with a placeholder host. |
| 314 | libvirt domain `win11`, local NTFS `C:\Projects\wrlforge` | Windows test-guest name | `<windows-test-host>` (keep `C:\Projects\wrlforge`) | Only the domain name is machine-specific. |

## docs/WINDOWS_NATIVE_QA_PLAN.md

| Line | Matched string | Category | Recommended replacement | Notes |
| --- | --- | --- | --- | --- |
| 11, 51, 53, 85, 197, 236 | `\\host.lan\Data` / `host.lan` | Owner LAN host-share | `\\<host-share>\Data` / `<host-share>` | Multiple occurrences describing the evidence-return share. |
| 31, 55, 58, 224, 258, 261 | `C:\Projects\wrlforge` | (generic target) | **KEEP** | Already the recommended generic clone path — not a leak. |

## docs/WINDOWS_QA_RUNBOOK.md

| Line | Matched string | Category | Recommended replacement | Notes |
| --- | --- | --- | --- | --- |
| 6 | `Never install/build/test/write fixtures from `\\host.lan`` | Owner LAN host-share | `\\<host-share>` | |
| 20 | `cd C:\Projects\wrlforge` | (generic target) | **KEEP** | Generic clone path. |

## docs/WRL_FORGE_ROADMAP.md

| Line | Matched string | Category | Recommended replacement | Notes |
| --- | --- | --- | --- | --- |
| 543 | `\\host.lan\Data` share that broke `node_modules` | Owner LAN host-share | `\\<host-share>\Data` | |
| 629 | libvirt/QEMU guest, local NTFS `C:\Projects\wrlforge` | Windows test-guest / (generic target) | genericize guest ref to `<windows-test-host>`; keep `C:\Projects\wrlforge` | |

## AGENTS.md  (dev-internal — lowest of this tier)

| Line | Matched string | Category | Recommended replacement | Notes |
| --- | --- | --- | --- | --- |
| 222 | `WinBoat `\\host.lan\Data` SMB share` | Owner LAN host-share | `\\<host-share>\Data` | Dev-internal doc; `C:\Projects\wrlforge` on same line is the generic target — keep. |

---

# TIER 3 — NICE-TO-SANITIZE (internal QA evidence & test data)

> Guidance from the task: sanitize irrelevant personal/machine detail but **do not alter the
> substance of technical evidence**. For captured Windows evidence, the `C:\Users\ryan\...` strings
> are the literal proof that path handling works with a real user profile — genericizing the
> username to `user` is acceptable (it keeps assertions valid) but is optional and must be done
> consistently on both sides of any assertion.

## Linux screenshot-path evidence — `out` fields (home-prefix only)

These are absolute output paths recorded by `VisualQaRunner`. Only the `/home/ryan` prefix is
personal; everything after is meaningful evidence. Recommend prefix-swap to `/home/user` (or a
relative `qa/...` path) if regenerated; otherwise leave as low-risk internal evidence.

| File | Lines | Matched string (prefix) | Recommended replacement |
| --- | --- | --- | --- |
| qa/phase-7b1-native-closeout/RESULTS.json | 13, 18, 31 | `/home/ryan/Projects/cybertown/wrlforge/qa/...` | `/home/user/Projects/wrlforge/qa/...` (prefix only) |
| qa/phase-7c-mall-preview/RESULTS.json | 58, 88, 118, 148, 178, 208, 238, 268, 298, 328, 358, 388, 418, 448, 478, 508, 538, 568 (18) | same prefix | prefix-swap only |
| qa/phase-7c-world-preview/RESULTS.json | 133, 194, 255, 316, 377, 438, 499, 560, 621, 676, 737, 797, 858, 923, 984, 1059, 1120, 1181, 1242, 1302, 1363, 1462 (22) | same prefix | prefix-swap only |

## Windows path-handling evidence — `C:\Users\ryan\...`

Captured self-test output and result JSON proving win32 path handling. **Genuine evidence** — the
username is incidental test data. Optional: genericize `ryan` → `user`.

| File | Lines | Category | Notes |
| --- | --- | --- | --- |
| qa/phase-6a-windows/RESULTS.md | 45 | Windows user-profile path | `C:\Users\ryan\AppData\Roaming\wrl-forge\window-state.json` — evidence of userData location. |
| qa/phase-6a-windows/selftest-result.json | 149, 154, 159 | Windows user-profile path | Captured `detail` fields. |
| qa/phase-6b-windows/selftest-6b-result.json | 25, 195, 210 | Windows user-profile path | Captured `detail` fields. |
| qa/phase-6b1-vscodium/editor-verify-result.json | 9, 18, 23, 28, 33, 38, 43, 48, 53 | Windows user-profile path | VSCodium install path + temp edit paths. |
| qa/phase-7b1-windows-closeout/selftest-b2-win-result.json | 25, 125, 175, 190, 195 | Windows user-profile path | Captured `detail` fields. |
| qa/phase-7b1-windows-closeout/selftest-b2-win-console.txt | 3, 23, 33, 36, 37 | Windows user-profile path | Console PASS lines. |
| qa/phase-7b1-windows-closeout/diag-editor-out.txt | 7, 8 | Windows user-profile path | Captured VSCodium resolveEditor/buildLaunch (line 8 has 3 occurrences). |
| qa/phase-7b1-windows-closeout/RESULTS.md | 6 | Owner Linux home path + share | `share `\\host.lan\Data` → Linux `/home/ryan`` — describes the mount mapping. |

## Tracked source files with `ryan`/`host.lan` as functional test data

| File | Lines | Category | Recommended action |
| --- | --- | --- | --- |
| qa/phase-6b-windows/win-selftest.js | 82, 83, 322, 341 | Windows user-profile path in assertions | Functional `path.win32.join` assertions. `ryan` → `user` on both sides keeps tests green; optional. |
| qa/phase-6b-windows/win-selftest.js | 98 | `\\host.lan\Data\wrlforge` test input | Functional guard test input. `host.lan` → `<host-share>` optional; keep behavior. |
| qa/phase-7b1-windows-closeout/diag-editor.js | 14 | `C:\Users\ryan\x.edit.wrl` arg | Diagnostic script literal; `ryan` → `user` optional. |
| qa/phase-7b1-windows-closeout/diag-editor.bat / run-selftest-b2.bat / tasklist-diag.bat | 3 / 6 / 3, 11 | `\\host.lan\Data\Projects\cybertown\wrlforge` | Owner-machine share paths baked into batch launchers. `host.lan` → `<host-share>`; these were run-from-share helpers, low reuse value. |
| qa/phase-6b-windows/run-selftest-6b.bat | 2 | `\\host.lan\Data\...` (comment) | Comment; genericize `host.lan`. |
| test/visual-qa/workspace-guard.test.js | 19, 21, 26, 32, 60, 67 | `host.lan` + `/home/ryan` as test inputs | Functional guard tests. `/home/ryan` (line 60) is a "valid local Linux path" fixture → `/home/user`; `host.lan` inputs exercise the host-share rejection and can stay or map to `<host-share>` consistently. |
| qa/phase-7c-windows/windows-agent-report.md | 17 | `\\host.lan\Data` SMB share | Narrative evidence; genericize `host.lan`. |
| qa/phase-7c5-cross-platform/RESULTS.md | 47 | libvirt domain `win11` | Environment description; `win11` → `<windows-test-host>` optional. |
| qa/phase-7c5-cross-platform/windows/RESULTS.md | 4 | libvirt domain `win11` | Same. |
| qa/phase-7c5-cross-platform/windows/environment.json | 7 | libvirt domain `win11` | Environment metadata. |
| qa/phase-6b1-vscodium/RESULTS.md | 63 | `Win11` (screenshot caption) | Refers to Windows 11 OS, not the domain name — arguably fine; leave. |

## Functional default marker (production tooling)

| File | Line | Matched string | Category | Recommended action |
| --- | --- | --- | --- | --- |
| qa/visual-qa/workspace-guard.js | 33 | `const DEFAULT_HOST_SHARE_MARKERS = ['host.lan'];` | Owner LAN host-share (but **functional default**) | This is the guard's default marker (overridable via `WRL_FORGE_HOST_SHARE`). It encodes the owner's real share name. Either leave (functional) or change the default to a neutral token and document the override. Comments at lines 5, 7 also mention `host.lan`. |

---

# LEAVE — do not change

| File | Line | Matched string | Reason |
| --- | --- | --- | --- |
| spikes/xite-mall-fit/fixtures/real-smartcar-lite.wrl | 6 | `"Made By: Ryan"` | VRML author comment inside a **byte-exact** fixture (`.gitattributes -text`). It is content authorship, not a path/machine leak. Editing corrupts the gzip/byte-locked fixture and breaks tests. |
| test/fixtures/preview/real-smartcar-lite.wrl | 6 | `"Made By: Ryan"` | Same byte-locked fixture (second copy). Leave. |
| package-lock.json | 3075 | `...contacting i@izs.me` | Third-party (`glob`) deprecation notice — not the owner's email. Leave. |

---

## Notes for the sanitization pass

1. The two **TIER 1** files are the only public-facing leaks. Fixing them unblocks going public.
2. `C:\Projects\wrlforge` appears ~10 times and is the **intended generic** clone path — a global
   find/replace on `ryan` will not touch it; do not "fix" it.
3. For any assertion-bearing source (`win-selftest.js`, `workspace-guard.test.js`), change **both
   sides** of each equality if you genericize, so tests keep passing.
4. Regenerating the `qa/**/RESULTS.json` runs on a public clone at `/home/user/...` would naturally
   sanitize all 43 Linux screenshot paths without hand-editing evidence.
