# Screenshot Manifest — docs/screenshots/ (public beta 1.3.0-beta.2)

14 curated screenshots for `docs/SCREENSHOTS_AND_USAGE.md`, sourced from current accepted-app QA runs. All show WRL Forge's own UI; none show old icons, "Review Bundle" wording, misspelled "Shuffle", passive-VSCodium behavior, unimplemented features, or (after redaction) private paths.

| File | Source QA capture | Sanitization |
|---|---|---|
| 01-native-editor.png | phase-7b-native-editor/03-highlighting | clean (shows `item.wrl`, no path) |
| 02-editor-diagnostics.png | phase-7b-native-editor/04-diagnostic-nav | clean |
| 03-editor-save-state.png | phase-7b-native-editor/06-dirty | clean |
| 04-live-preview-original.png | phase-7c-mall-preview/02-unsaved-original | clean |
| 05-live-preview-fit.png | phase-7c-mall-preview/03-unsaved-fit | clean |
| 06-live-preview-updating.png | phase-7c-mall-preview/04-auto-update-after-edit | clean |
| 07-live-preview-lastvalid.png | phase-7c-mall-preview/08-syntax-error-lastvalid | clean |
| 08-live-preview-recovered.png | phase-7c-mall-preview/09-recovery | clean |
| 09-world-open.png | phase-4b-world-preview/03-nested-inline | **path band redacted** → `<your local project folder>` |
| 10-world-diagnostics.png | phase-4b-world-preview/07-missing-case-warnings | **path band redacted** |
| 11-world-nested-edit.png | phase-7c-world-preview/03-unsaved-nested | clean (relative names only) |
| 12-world-viewpoints.png | phase-4b-world-preview/06-multiple-viewpoints | **path band redacted** |
| 13-world-bundle.png | phase-5a-world-packaging/6-bundle-built | clean ("WRL Forge World Project Bundle", manual-upload framing) |
| 14-accessibility-contrast.png | phase-7c-vision/02-contrast-default | clean (High Contrast, `vision.wrl`) |

## Excluded (would have violated the no-stale / no-PII rules)
- All `phase-2b1-production-fit` Mall-workspace screenshots — **stale**: show the removed passive-VSCodium + `.edit.wrl` workflow, and a `-home-ryan-` scratch path.
- `phase-6b1-vscodium/*` — leak `\\host.lan\` (owner SMB hostname) and a cmd error. "Using VSCodium" is documented as text-only, pointing at the visible "External editor" button.

## Redaction method
ImageMagick (system tool, not a project dependency): `convert <src> -fill '#12161c' -draw 'rectangle 14,152 1086,216' -font DejaVuSansMono -pointsize 13 -fill '#8b949e' -annotate ... <dst>`. This replaces the owner's absolute path with a generic `<your local project folder>` label; no technical substance is altered.
