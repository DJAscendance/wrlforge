# Windows icon screenshot manifest — Phase 7C5.1

| File | What it shows |
|---|---|
| `exe-embedded-icon-256.png` | 256px icon extracted from `release/win-unpacked/WRL Forge.exe` via Win32 PrivateExtractIcons — the cyan "WRL" artwork embedded by electron-builder. |
| `installed-exe-icon-256.png` | 256px icon extracted from the installed `%LOCALAPPDATA%\Programs\WRL Forge\WRL Forge.exe` — byte-identical to the win-unpacked extract. |

Note: the icon lives on the window/taskbar/exe resource, not the rendered web
contents, so resource extraction (above) is the primary proof; visual confirmation
is the extracted PNGs themselves. Embedded-executable evidence is by PE resource
inspection, not a desktop screenshot.
