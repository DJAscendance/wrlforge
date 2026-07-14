# Phase 7C5 — Windows Screenshot Manifest

Windows visual-QA screenshots are generated on the guest under
`C:\Projects\wrlforge\qa\phase-*\screenshots\` (regenerated per run; git-tracked
copies of the Linux equivalents already exist in-repo). Binary PNGs are **not**
committed from the guest; export, if needed, goes through the Phase 7C4.1 host-share
allowlist. The states captured (one PNG per id):

## Vision (`qa/phase-7c-vision/screenshots/`) — 9
01-dark-default · 02-contrast-default · 03-contrast-max-zoom · 04-zoom-min ·
05-zoom-mid · 06-chrome-and-panels-scaled · 07-modal-enlarged · 08-persist-set ·
09-persist-after-reload

## Native editor (`qa/phase-7b-native-editor/screenshots/`) — 15
01-mall-plain · 02-mall-gzip · 03-highlighting · 04-diagnostic-nav ·
05-advisories-separate · 06-dirty · 07-save-success · 08-world-primary ·
09-nested-referenced · 10-outline-nav · 11-conflict-dialog · 12-external-editor ·
13-theme-light · 14-theme-terminal · 15-theme-tokyo

## Mall live preview (`qa/phase-7c-mall-preview/screenshots/`) — 18
01-split-5050 · 02-unsaved-original · 03-unsaved-fit · 04-auto-update-after-edit ·
05-manual-update · 06-updating · 07-outdated-large · 08-syntax-error-lastvalid ·
09-recovery · 10-saved-fallback · 11-preview-max · 12-editor-only · 13-divider-moved ·
14-contrast-zoom · 15-local-texture · 16-remote-blocked · 17-large-manual ·
18-leak-after-close

## World live preview (`qa/phase-7c-world-preview/screenshots/`) — 22
01-primary-split · 02-unsaved-primary · 03-unsaved-nested · 04-auto-update ·
05-manual-update · 06-broken-primary-lastvalid · 07-broken-nested-lastvalid ·
08-recovery · 09-saved-fallback · 10-viewpoint-preserved · 11-viewpoint-fallback ·
12-nav-preserved · 13-newref-blocked · 14-find-new-files · 15-findings-blocked ·
16-preview-max · 17-editor-only · 18-contrast-zoom · 19-seventy-textures ·
20-nested-gzip · 21-leak-after-close · 22-project-switch-cleanup

Each Windows chip/state matched the Linux run (see `windows/RESULTS.md`).
