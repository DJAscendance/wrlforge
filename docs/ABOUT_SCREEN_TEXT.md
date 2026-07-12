# About screen — planned text

This is the **approved short-form** Inspiration/Acknowledgments text for a future
in-app **About** screen (not yet implemented). The README carries the longer,
full-form version under "Inspiration and Acknowledgments"; this shorter paragraph
is the one to surface in the UI when an About screen is built.

Keep the names styled exactly as below (do not normalize casing/punctuation):
**Morning.star**, **scott99 (Mark)**, **LSS**, **Wovencroft**, **GeordieJohn**.

> Special thanks to **Morning.star**, **scott99 (Mark)**, **LSS**,
> **Wovencroft**, **GeordieJohn**, and the many other world builders, ComTech
> members, coders, and friends I met along the way.

WRL Forge is an independent continuation of the creative spirit of the Cybertown
community and is **not** presented as the work of, or officially endorsed by, the
people named above.

## Product description (for the About screen)

When the About screen is built, describe the product truthfully and without
prototype / test-build / "coming soon" wording. Suggested framing:

> **WRL Forge** — a VRML97 creation, inspection, validation, and packaging
> workbench for Cybertown Mall items and worlds. Edit gzip-transparent `.wrl`
> files, preview them with the embedded X_ITE engine, validate against Cybertown
> Mall rules, and build a **WRL Forge World Project Bundle** to review and upload
> by hand through the Cybertown website. An external editor (VSCodium) is optional.

Notes for whoever implements the screen:

- Do **not** claim features that don't exist yet. The native in-app editor and VRML97
  parser **shipped** (Phase 7A/7B) and may be described as built. The unsaved-buffer
  X_ITE preview is **Phase 7C and not built** — do not mention it. Direct Cybertown
  upload **will not be built** — do not present it as planned or coming.
- WRL Forge performs **no direct upload** and will not (locked product decision);
  don't frame that as a limitation or "coming soon."
- Keep the app version dynamic (read it from `package.json`), and keep the
  "Unsigned" note on Windows builds where relevant.
