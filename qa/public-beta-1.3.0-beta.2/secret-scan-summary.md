# Pre-Public Secret / Credential Audit — WRL Forge

**Repo:** `/home/ryan/Projects/cybertown/wrlforge`
**Remote:** `https://github.com/DJAscendance/wrlforge.git`
**Scope:** Full working tree **and** all reachable git history (71 commits, single branch `main`).
**Date:** 2026-07-14
**Auditor:** automated read-only investigation (no tracked file modified).

---

## VERDICT

**CLEAR — no real secrets in tree or history.**

No API keys, access tokens, passwords, private SSH keys, TLS private keys, `.env`
files, auth cookies, cloud/database credentials, public IP addresses, or private VM
addresses were found in the working tree or in any reachable git blob. Two
**informational (non-blocking)** privacy notes are recorded below; neither is a
credential and neither blocks going public.

---

## Methodology & commands run

Enumeration:
- `git ls-files | wc -l` → 596 tracked files. Top dirs: `test/` (233), `qa/` (221), `src/` (47), `spikes/` (35), `assets/` (19), `docs/` (17), `renderer/` (10).
- `git rev-list --all --count` → 71 commits. `git branch -a` → only `main` / `origin/main`.
- `git ls-files | grep -iE '\.env|secret|credential|\.pem|\.key|\.p12|\.pfx|id_rsa|\.crt|cookie'` → **no matches** (no sensitive file types tracked).
- Reviewed `.gitignore`: correctly excludes `node_modules/`, `dist/`/`out/`/`build/`/`release/`, `*.log`, machine-specific `RESULTS.json`/`PERF.json`, `graphify-out/`, `renderer/vendor/`, OS junk.

Secret-shape grep (tree + every historical object via `$(git rev-list --all)`):
- Patterns: `AKIA[0-9A-Z]{16}`, `ghp_/gho_/ghs_[A-Za-z0-9]{36}`, `github_pat_`, `xox[baprs]-`, `sk-[A-Za-z0-9]{20,}`, `AIza[0-9A-Za-z_-]{35}`, `-----BEGIN * PRIVATE KEY-----`, `-----BEGIN CERTIFICATE-----`.
- **Result: zero matches** in tree and in all history.

Keyword grep (`api_key`, `secret`, `password=`, `token=`, `authorization:`, `bearer`, `client_secret`, `private_key`):
- All hits are benign source/test identifiers: VRML diagnostic code constants, session `_token` counters, `path-authorizer`/`buffer-overlay` authorization-*proof* logic, and path-traversal **test fixtures** (`../../etc/passwd`, `secret.wrl`, `TOP-SECRET-BUFFER-CONTENT`) that assert secrets are *not* leaked. No assigned credential values.

Identity / network / path grep across all history:
- `git log --all --format='%an <%ae> | %cn <%ce>'`
- Email regex over all blobs; IPv4 regex over all blobs; `/home/…`, `C:\Users\…`, private-range IP greps.
- Cloud/DB creds: `aws_`, `s3.amazonaws`, `stripe`, `heroku`, `firebase`, `mongodb+srv`, `postgres://`, `mysql://`, `redis://` → **zero matches**.

---

## Findings by category

### 1. API keys / tokens / passwords / private keys / TLS certs
**None.** Zero matches for all standard secret shapes in tree and full history.

### 2. `.env` files / auth cookies
**None tracked.** `.gitignore` would not even be the safeguard — no such files exist in history.

### 3. Emails
- `i@izs.me` — **benign.** Appears only inside `package-lock.json` as the npm `glob`
  deprecation notice string ("...may be purchased ... by contacting i@izs.me"). This
  is Isaac Schlueter's public npm contact embedded by npm itself, not a committed
  personal address. No action.
- `ascendance@skate.fm` — **INFORMATIONAL (non-blocking).** This is the **git commit
  author/committer email** on all 71 commits (`Ryan Bundy <ascendance@skate.fm>`). It
  does **not** appear in any blob/file content — only in commit metadata. It differs
  from the owner's known address (`ascendnetowner@gmail.com`). It is the owner's own
  personal email and will be publicly visible on every commit once the repo is public.
  Not a secret; flagged only so the owner can decide whether to keep it public. (If
  undesired, it can be replaced going forward via git config, or history rewritten with
  `git filter-repo --mailmap` before the first public push — optional, owner's call.)
- No other third-party personal emails found.

### 4. Internal / private URLs
All committed `http(s)://` hosts are benign:
- `cybertown.com` (the product's target platform), `www.3dgrove.com` and
  `create3000.github.io` (X_ITE upstream, cited in docs/roadmap), `registry.npmjs.org`
  (lockfile), `www.w3.org` (VRML/XML namespaces), `timestamp.digicert.com` (a doc
  *example* code-signing timestamp server in `docs/SIGNING_READINESS.md`).
- Test/fixture sentinels: `example.com`, `example.invalid`, `evil`, `cdn.evil`,
  `cdn.test`, `blocked`, `127.0.0.1` — all synthetic values in preview/CSP/URL-blocking
  tests. No internal service endpoints or credentialed URLs.

### 5. IP addresses
- Only `127.0.0.1` (localhost) appears, in tests. **No public IPs.**
- **No `192.168.122.x`** (or any `192.168.` / `10.` / `172.16–31.`) VM/private
  addresses are committed. The virt-manager Windows-guest IP noted in session memory
  never entered the repo. Clean.

### 6. Machine-specific usernames / home paths — INFORMATIONAL (non-blocking)
QA evidence files and one doc embed absolute paths that reveal the OS username `ryan`
and directory layout. These are **not secrets** (no credential value), but the owner
may wish to be aware they will be public:
- `/home/ryan/Projects/cybertown/wrlforge/...` — ~632 occurrences across history,
  predominantly in committed `qa/**/RESULTS.json` screenshot-path records and one line
  of `docs/VRML_PARSER.md` (audit-corpus path reference).
- `C:\Users\ryan\...` — Windows QA evidence (`qa/phase-6a-windows/`,
  `qa/phase-6b-windows/`, `qa/phase-6b1-vscodium/`, `qa/phase-7b1-windows-closeout/`):
  profile, AppData, and Temp paths under the `ryan` Windows profile.
- `file:///home/u/item/stone.png` — a **generic** test fixture path (not the real home
  dir); benign.

Impact: low — exposes only that the developer's local username is `ryan` and the
project's local checkout location. No remediation required for a public beta; optional
cleanup only if the owner objects to publishing the username. Recommend leaving as-is
unless there's a specific concern (rewriting history over cosmetic paths is not worth
the risk).

### 7. Screenshots / logs with sensitive info
- 258 tracked images — all are QA evidence screenshots of the WRL Forge editor/preview
  UI and VRML world test-fixture textures (`test/fixtures/world/**/img`). They depict
  application chrome and 3D content, not credentials, terminals with secrets, or PII.
- No `*.log`, `.pem`, `.p12`, `.pfx`, `.crt`, `.pdf`, or archive files are tracked
  (`.gitignore` excludes `*.log`; none exist in history).

### 8. package.json metadata
- `"author": ""` (empty) — nothing leaked. No `email`/`homepage`/`bugs` credentialed
  fields present.

---

## Commands (reproducible)

```bash
# enumeration
git ls-files | wc -l
git rev-list --all --count
git ls-files | grep -iE '\.env|secret|credential|\.pem|\.key|\.p12|\.pfx|id_rsa|\.crt|cookie'

# secret shapes across ALL history
git grep -nIE 'AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|ghs_[A-Za-z0-9]{36}|github_pat_|xox[baprs]-|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----' $(git rev-list --all)

# keyword patterns (tree + history)
git grep -nIiE 'api[_-]?key|secret|password[[:space:]]*[=:]|token[[:space:]]*[=:]|authorization:|bearer |client[_-]?secret|private[_-]?key'

# identities / IPs / paths across history
git log --all --format='%an <%ae> | %cn <%ce>' | sort -u
git grep -nIoE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' $(git rev-list --all)
git grep -nIE '192\.168\.|10\.[0-9]|172\.(1[6-9]|2[0-9]|3[01])\.' $(git rev-list --all)
git grep -nIE '/home/[a-z]+/' ; git grep -nIiE 'C:\\Users\\[A-Za-z]+'

# cloud / db creds
git grep -nIiE 'aws_|s3\.amazonaws|stripe|heroku|firebase|mongodb\+srv|postgres://|mysql://|redis://'
```

---

## Conclusion

The repository is **safe to make public** from a secret/credential standpoint. No
blocking issues. Two informational items — the `ascendance@skate.fm` commit-author
email and the `ryan` username in committed absolute paths — are the owner's own
non-sensitive identifiers, disclosed here purely so the publish decision is fully
informed. No history rewrite is required.
