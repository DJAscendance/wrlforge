# Public Repository & Release-Page Report — 1.3.0-beta.2

Verified in-browser on github.com after the visibility change + release publication (2026-07-14).

## Repository (public)
- **https://github.com/DJAscendance/wrlforge** — visibility **Public**; description + 11 topics shown; Issues + Discussions tabs present; Wiki/Projects off.
- **README renders**: the cyan **WRL** logo (`about-logo.png`) displays; title, "Public beta · prerelease · unsigned · x64" status, "Download the latest release" link, and the Cybertown **non-affiliation** callout all render. README/Contributing/License/Security tabs present. GitHub detected the LICENSE as "Other" (NOASSERTION) — correctly **not** shown as open source.
- Unauthenticated raw access: README = 200, logo PNG = 200, `docs/screenshots/01-native-editor.png` = 200.

## Release page (prerelease, not draft)
- **https://github.com/DJAscendance/wrlforge/releases/tag/v1.3.0-beta.2** — title "WRL Forge 1.3.0-beta.2 — First Public Beta"; Highlights, Downloads, SHA-256 verification instructions, Reporting-problems links, and non-affiliation Notes all render.
- **Assets (9)** attached and downloadable; GitHub's own SHA-256 badges match the verified manifest:
  - SHA256SUMS-1.3.0-beta.2.txt (625 B)
  - WRL-Forge-1.3.0-beta.2-linux-x64.AppImage (128 MB, 26c58a83…)
  - WRL-Forge-1.3.0-beta.2-linux-x64.tar.gz (121 MB, 68ca2d3b…)
  - WRL-Forge-1.3.0-beta.2-windows-x64.zip (154 MB, 38599dad…)
  - WRL-Forge-1.3.0-beta.2-x64.msi (120 MB, 29f59abf…)
  - WRL-Forge-Portable-1.3.0-beta.2-x64.exe (104 MB, dce1fd99…)
  - WRL-Forge-Setup-1.3.0-beta.2-x64.exe (105 MB, 286c94c5…)
  - + Source code (zip) and (tar.gz) auto-generated.
- Unauthenticated download of `SHA256SUMS-1.3.0-beta.2.txt` succeeded and matched.

## Issue forms & community
- **/issues/new/choose** renders all three structured forms — **Bug report**, **Installation problem**, **VRML compatibility issue** — plus contact links: **Report a security vulnerability** (→ SECURITY.md), **Questions & Discussion** (→ Discussions), **User Guide (screenshots & usage)**, **Troubleshooting**, and **Report a security vulnerability (private)** (→ GitHub Security advisories). Blank issues are "Maintainers only" (blank_issues_enabled: false).
- **Discussions** enabled and reachable; **Issues** enabled.
- **Private vulnerability reporting**: enabled (`PUT .../private-vulnerability-reporting` succeeded once public).

## Verdict
Public repository, documentation, screenshots, downloads (checksum-matched), issue forms, discussions, and security reporting are all **live and correct**.
