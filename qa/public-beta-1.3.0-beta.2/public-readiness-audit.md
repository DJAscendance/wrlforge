# Public-Readiness Audit — WRL Forge 1.3.0-beta.2

Date: 2026-07-14 · Repo: `DJAscendance/wrlforge` (private during audit) · Baseline pushed: `c95b5a5..3ddd370`

This consolidates the pre-public audit gates. Detailed per-lane reports:
- Secrets/history: [`secret-scan-summary.md`](secret-scan-summary.md)
- Assets/redistribution: [`asset-license-review.md`](asset-license-review.md)
- PII/paths inventory: [`pii-path-inventory.md`](pii-path-inventory.md)

## 1. Secret & history scan — CLEAR (no blocker)
All 596 tracked files and all 71 commits / reachable blobs (`git rev-list --objects --all`) scanned. **Zero** API keys, tokens (AKIA/ghp_/gho_/AIza/sk-/xox-), passwords, private SSH keys, TLS private keys/certs, `.env` files, or auth cookies — in the tree or history. No public IPs; `192.168.122.x` VM address never entered the repo. All keyword hits are source identifiers or path-traversal test fixtures asserting secrets are *not* leaked.

Non-blocking notes:
- Commit-author email `ascendance@skate.fm` is in git metadata on all 71 commits (owner's own alternate address). Changing it would require history rewrite, which is prohibited for this lane. Retained as-is per owner posture.
- `/home/ryan/...` paths appear in historical `qa/**/RESULTS.json` evidence (low impact; no history rewrite warranted). User-facing docs sanitized (below).

## 2. Asset & redistribution audit — no unclear-ownership blocker
Every tracked `.wrl`, texture, screenshot, and doc asset reviewed. All fixtures are owner-authored or synthetic (1×1–2×3 px, 69–75 B placeholder textures; hand-authored `.wrl`). No historical Cybertown platform `.wrl`, ripped textures, or branded art. "Cybertown"/"blaxxun" appear only in descriptive comments. QA screenshots show WRL Forge's own UI. Owner icon SVGs are owner-created.

Compliance action taken: **`THIRD_PARTY_NOTICES.md` added** — the shipped editor bundle is built with esbuild `--legal-comments=none` (strips inline MIT banners), so attribution is reproduced there for x_ite, `@codemirror/*`, `@lezer/*`, Electron, esbuild, electron-builder (MIT), the x_ite-bundled fonts (PT Sans OFL, Droid Serif Apache-2.0, Ubuntu Mono UFL), and `@resvg/resvg-js` (MPL-2.0, build-time only).

## 3. Path / evidence sanitization — done for user-facing surfaces
Must-fix user-facing leaks corrected:
- `docs/VRML_PARSER.md` — replaced `/home/ryan/Projects/cybertown` with a generic description.
- `wrl-forge.desktop` — `/home/ryan/...` → `/home/user/Projects/wrlforge`.
Tier-2 public docs normalized: owner LAN hostname `host.lan` → `<host-share>` in `AGENTS.md`, `docs/PLATFORM_NOTES.md`, `docs/WINDOWS_NATIVE_QA_PLAN.md`, `docs/WINDOWS_QA_RUNBOOK.md`, `docs/WRL_FORGE_ROADMAP.md`. The functional `workspace-guard.js` default marker (overridable via `WRL_FORGE_HOST_SHARE`) is intentionally left in code. Historical `qa/**` evidence retains concrete technical detail (not falsified).

Screenshot sanitization: world-workspace screenshots printed the absolute project path in the scan header — the path band was redacted to `<your local project folder>` in the three published shots (`09/10/12`). Stale Mall-workspace screenshots (showed removed passive-VSCodium + `.edit.wrl` flow) and the VSCodium capture (showed `\\host.lan\`) were **excluded** from the manual.

## 4. License / copyright posture
- `package.json`: `license` `ISC` → **`UNLICENSED`**, `author` → **`Ryan Bundy`**, `build.copyright` → **`Copyright © 2026 Ryan Bundy. All rights reserved.`**
- Added `LICENSE` + `COPYRIGHT.md` (all-rights-reserved, source-available — **not** open source). No prior OSI license existed to conflict with.

## Verdict
**PASS — no blocker to public visibility.** No secrets in tree or history; no unclear-ownership distributable; third-party notices supplied; user-facing paths/hostnames sanitized; copyright/license posture set to all-rights-reserved.
