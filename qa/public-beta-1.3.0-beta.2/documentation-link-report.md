# Documentation Link & Wording Report — public beta 1.3.0-beta.2

Checker: [`check-doc-links.js`](check-doc-links.js) (repo-relative + file-relative resolution; skips http/mailto/anchors).

## Relative links & images
**Checked 51 relative link(s)/image(s) across 12 doc files → all resolve. OK.**
Files: README.md, CHANGELOG.md, CONTRIBUTING.md, COPYRIGHT.md, LICENSE, SECURITY.md, SUPPORT.md, THIRD_PARTY_NOTICES.md, docs/INSTALLATION.md, docs/TROUBLESHOOTING.md, docs/RELEASES.md, docs/SCREENSHOTS_AND_USAGE.md. All 14 `docs/screenshots/*.png` references resolve.

## YAML validity
`.github/ISSUE_TEMPLATE/{bug-report,installation-problem,vrml-compatibility,config}.yml` and `.github/workflows/{ci,release}.yml` all parse via `yaml.safe_load`.

## Wording / compliance sweep (across README + all public docs + issue forms)
- "Review Bundle" (old user-facing term): **none** ✓
- "Shufle" misspelling: **none** ✓
- Unqualified "open source": **none** (only accurate negations) ✓
- `/home/ryan`, `C:\Users\ryan`, `host.lan`: **none** in public files ✓
- Copyright string: uniformly `Copyright © 2026 Ryan Bundy` ✓
- Stray `1.3.0-beta.1` in core user docs: **none** (historical refs retained only in phase/history docs) ✓
- Non-affiliation statement present in README + user guide + release notes ✓

## GitHub-render checks (performed on the public repo/release page)
Recorded in `release-page-report.md` after publication (README + logo render, image relative paths resolve on github.com, issue forms open, discussions available, release assets download, checksums match).
