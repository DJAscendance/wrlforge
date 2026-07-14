# WRL Forge 1.3.0-beta.2 — First Public Beta — Release Results

Date: 2026-07-14 · Repo: `DJAscendance/wrlforge` · Tag: `v1.3.0-beta.2` · Release commit: `2eea330`

## Verdict: **GO**
WRL Forge 1.3.0-beta.2 is published as an unsigned x64 public prerelease for Linux and Windows, with verified AppImage, tar.gz, NSIS EXE, MSI, portable EXE, and ZIP downloads; public documentation, screenshots, issue forms, discussions, and security reporting are live.

## Gate summary
| Gate | Result | Evidence |
|---|---|---|
| Phase 7C5.1 push (`c95b5a5..3ddd370`) | done, no history rewrite | — |
| Secret & history audit | **CLEAR** | [secret-scan-summary.md](secret-scan-summary.md) |
| Asset/redistribution audit | no blocker; THIRD_PARTY_NOTICES added | [asset-license-review.md](asset-license-review.md) |
| PII/path sanitization | user-facing surfaces sanitized | [pii-path-inventory.md](pii-path-inventory.md), [public-readiness-audit.md](public-readiness-audit.md) |
| Copyright/license posture | UNLICENSED / all-rights-reserved, author = Ryan Bundy | LICENSE, COPYRIGHT.md |
| Version surfaces | 1.3.0-beta.2 consistent | package.json, docs, artifacts |
| CI (Ubuntu + Windows) | **green** | run 29333420248 |
| Release workflow (native builds → draft prerelease) | **success** | run 29333915323 |
| Documentation links / YAML / wording | 51/51 links ok, YAML valid, sweep clean | [documentation-link-report.md](documentation-link-report.md) |
| Linux artifact verification | AppImage launches, zero survivors; tar.gz runnable | [linux-build-results.md](linux-build-results.md) |
| Windows artifact verification | MSI + NSIS full lifecycle; ZIP runnable; portable per documented limitation | [windows-build-results.md](windows-build-results.md) |
| Checksums | all 6 verified vs manifest | [SHA256SUMS-1.3.0-beta.2.txt](SHA256SUMS-1.3.0-beta.2.txt) |
| GitHub settings | description, 11 topics, Issues + Discussions, 21 labels, forms | [github-settings-report.md](github-settings-report.md) |
| Public visibility + release publish | see [release-page-report.md](release-page-report.md) | release page |

## Two defects found and fixed during this lane
1. `f2fce00` — `npm test` shell-glob failure on Windows CI → Node file-enumerating runner (`scripts/run-tests.js`).
2. `2eea330` — electron-builder `zip`/`msi` output-name collision failed the Windows build → ZIP assembled from `win-unpacked` in the workflow.

## Artifacts
See [release-artifacts.md](release-artifacts.md) and [results.json](results.json). Six canonical x64 downloads + `SHA256SUMS-1.3.0-beta.2.txt`. All embed version 1.3.0-beta.2 (MSI ProductVersion normalizes to 1.3.0.0), ship the cyan icon, unsigned by design.

## Known limitations (carried into the public beta)
Unsigned Windows → SmartScreen; portable EXE stdout-handshake QA limitation; historical VRML extensions may differ; parser advisories advisory-only (X_ITE authoritative); x64-only; no direct upload (manual World Project Bundle hand-off). Not affiliated with Cybertown.
