# GPL Provenance Boundary — White Dune ↔ WRL Forge

**Status:** Phase WD0 deliverable. Engineering provenance guidance.
**Date:** 2026-08-06

> **This is an engineering provenance document, not legal advice.** It records what
> was found locally, and sets working rules for engineers and agents. It is not a
> legal opinion and does not substitute for one. If WRL Forge ever intends to ship
> anything derived from White Dune, get actual counsel first.

## 0. Owner-ratified position (Ryan, 2026-08-06)

These rules are not merely proposed — they are the approved direction for this lane
(`WD0_DISCOVERY_REPORT.md` §14):

1. **WRL Forge stays MIT** for now.
2. **White Dune remains an isolated GPL-2.0-or-later historical reference.**
3. **No White Dune source, fixtures, algorithms, icons, or implementation code** may be
   copied, adapted, translated, or imported into WRL Forge.
4. **VRML97 behaviour derives from ISO/IEC 14772; node metadata derives from the
   MIT-licensed X_ITE material** already available to WRL Forge (§5).
5. **`~/Projects/white-dune-archive/` stays outside Git.** The archive, source ZIP,
   Debian package, extracted files, binaries, and any other GPL content are never
   committed.

---

## 1. Package identity and license

Two distinct White Dune artifacts exist on this machine, plus one installed binary.
They are **different versions** and must not be conflated.

| | Source zip | Debian package | Installed binary |
|---|---|---|---|
| Version | **1.930** | **1.956-1** | **1.930** |
| Path | `~/Downloads/white_dune-1.930.zip` | `~/Downloads/wdune_1.956-1_amd64.deb` | `/usr/local/bin/dune` |
| Size | 46,894,963 bytes | 14,540,944 bytes | 60,679,888 bytes |
| SHA-256 | `96f6ab4120df94fa79de9855446472ab4a4eb31c8209aacfadf793952c8b2440` | `98da0e734d8c2046a80c5992edccdb24287d5e0ddc8ad6e6aa92abc7140a7396` | not checksummed (root-owned, not modified) |
| Contains source? | **YES** — 3,285 files, 1,291 C/C++ sources+headers | **NO** — 9 files, binaries + resources only | n/a (ELF) |
| Dated | 2020-07-22 | 2020-09-02 | installed 2026-07-15 |

**Operative license: `GPL-2.0-or-later`.**

Evidence:

- 1,241 files under `src/` carry the standard header *"either version 2 of the
  License, or (at your option) any later version"*. Only 9 mention version 3.
- `man/dune.1` `COPYRIGHT`: *"Copyright (C) 2000-2002 Stephen F. White and others …
  either version 2 of the License, or (at your option) any later version."*
- The tree ships **both** license texts — `LICENSE` (GPLv2, 18,092 bytes) and
  `COPYING`/`LICENSE.txt` (GPLv3, 35,141/35,147 bytes) — which is consistent with
  "v2 or later", not a contradiction.

**Copyright holders:** Stephen F. White (1999–2002) and others.
**Debian maintainer:** J. "MUFTI" Scheurich `<mufti11@web.de>`.

### 1.1 The `.deb` is not a source package

`dpkg-deb -c` lists exactly nine files: `usr/bin/dune` (109,306,368 bytes),
three shell scripts, two `.desktop` files, two PNG icons, and one RenderMan shader
(`usr/share/white_dune/shaders/phong.slx`).

There is **no `Source:` field** in its control file, no `debian/` directory, no
`.orig.tar.*` reference, no changelog, no examples, and no documentation.

> Do **not** describe `wdune_1.956-1_amd64.deb` as a source artifact. It proves the
> program's *existence, dependencies, and packaging*, and nothing about its
> implementation. Every implementation claim in the WD0 deliverables is sourced from
> the **1.930 source zip**, and is labelled as such.

A source artifact for **1.956** specifically has **not** been obtained. If exact
1.956 behaviour ever matters, the missing artifact is the upstream
`white_dune-1.956` source tarball. **Do not download it without Ryan's approval.**

### 1.2 The license incompatibility that governs everything below

| | License | Type |
|---|---|---|
| White Dune | GPL-2.0-or-later | **strong copyleft** |
| WRL Forge | MIT (`LICENSE`, commit `7909c2c`) | permissive |

GPL-2.0-or-later code **cannot** be incorporated into an MIT-licensed product while
leaving it MIT. Copying, adapting, or closely translating White Dune code into
WRL Forge would create an obligation to license the combined work under the GPL —
which would silently relicense Ryan's product.

**This is the whole reason the boundary exists.** It is not bureaucratic caution.

---

## 2. What may be studied

Reading GPL source to learn is lawful and is not itself a licensing event. The
following are safe inputs to WRL Forge design:

- **Facts and standards content.** Which VRML97 nodes exist, their fields, types,
  access types, and defaults. These come from **ISO/IEC 14772-1**, not from
  White Dune. A list of node names is the standard's content, not White Dune's
  expression.
- **Public observable behaviour.** What the program does: menu structure, CLI flags,
  dialog inventory, supported formats, error text visible to users.
- **UX and workflow concepts.** That a scene-tree panel pairs with a field inspector
  and a 3D view; that ROUTEs benefit from a graph canvas; that animation wants a
  channel/timeline view. Ideas and interaction patterns are not protected expression.
- **Architecture at the level of "what problems must be solved."** That a lossless
  editor must reconcile a tree with text; that transform handles need autoscaling.

## 3. What must remain isolated

- **All White Dune source files.** They live only in
  `~/Projects/white-dune-archive/` — a sibling of `~/Projects/cybertown`, deliberately
  outside every Git repository. Nothing was copied into WRL Forge, and nothing may be.
- **The 109 MB binary and the installed `/usr/local/bin/dune`.** Not vendored, not
  redistributed, not bundled.
- **Algorithms with a specific implementation shape.** NURBS evaluation, superformula
  generation, mesh subdivision, triangulation, the RIB/AC3D/CATT exporters. If WRL Forge
  ever needs one, derive it from published mathematics or a permissively licensed
  library — never from `src/Node*.cpp`.
- **Node field tables.** Even though field *names* are standards content, White Dune's
  particular tables are its expression. **Use `x_ite.d.ts` and the ISO mirror instead**
  (see §5) — this makes the question moot.

## 4. Clean-room implementation rules

1. **Never open a White Dune source file while writing WRL Forge code.** Study and
   implementation are separate sittings. If you need to check a behaviour mid-task,
   write down the *question*, close the editor, answer it from the ISO spec, and
   continue.
2. **Specify in behaviour, implement from the specification.** Anything learned from
   White Dune enters WRL Forge only as a plain-English capability statement in a
   design doc — never as pseudocode transcribed from `src/`.
3. **No transliteration.** Renaming identifiers, converting C++ to JavaScript, or
   restructuring control flow does not launder a derivative work.
4. **Cite the standard, not the program.** A WRL Forge comment may say
   *"ISO/IEC 14772-1 §6.52 — Transform applies translation after rotation"*. It must
   not say *"matches White Dune's NodeTransform.cpp"*.
5. **Prefer the MIT-licensed path when one exists.** For node metadata one does — §5.
6. **Agents inherit these rules.** Any subagent or workflow given a White Dune path
   must be told the material is GPL reference-only.

## 5. The clean path for node metadata (recommended)

WD0 established that **WRL Forge does not need White Dune for node metadata at all**:

- `node_modules/x_ite/dist/x_ite.d.ts` — **MIT**, already a root dependency — declares
  **all 54/54 VRML97 nodes** as `<Node>Proxy` interfaces. 472 fields were
  machine-extracted with name, VRML field type, and access type.
- The local ISO mirror at
  `/home/ryan/Projects/cybertown/wb-ct-scrape/specs/iso-14772-vrml97` yields **314
  normative field declarations across 54/54 nodes** — the authoritative VRML97 set.

Together these give a complete, license-clean schema. **X_ITE supplies runtime shape;
the ISO spec supplies normative truth and the strict-VRML97 filter** (x_ite.d.ts
carries 206 X3D-only fields that must not leak into a VRML97 export).

> **Recommendation: build all node metadata from these two sources and treat
> White Dune's node tables as off-limits.** This removes the highest-risk contact
> surface entirely, at no cost in capability.

Both third-party sources still need attribution discipline: X_ITE is already credited
in `THIRD_PARTY_NOTICES.md`; the ISO spec is a standards citation, not a dependency.

## 6. Test-fixture provenance

White Dune ships example scenes (`docs/typical_vrml_examples/`, `test/`, `warbird/`).
**These are GPL-licensed content files.**

- **Do not** copy White Dune `.wrl`/`.x3dv` files into `test/fixtures/`.
- WRL Forge fixtures must be authored in-repo, or drawn from the Cybertown corpus that
  already justifies this project.
- A White Dune example may be opened **locally, from the archive path**, to check that
  WRL Forge parses it. That is use, not redistribution. The file must not enter the repo.
- If a White Dune example ever exposes a parser bug, write a **new minimal fixture**
  that reproduces the construct. Do not commit the original.

## 7. Attribution

Studying GPL software to build an independent implementation creates no attribution
obligation, and WRL Forge should **not** imply endorsement or shared lineage.

What is appropriate:

- A single acknowledgement line — White Dune by Stephen F. White and J. Scheurich,
  GPL-2.0-or-later — as **historical prior art**, in a docs page, not in `LICENSE`.
- No White Dune code, name, or icon in shipped artifacts.
- No claim of compatibility, certification, or derivation.

What is **not** appropriate: adding White Dune to `THIRD_PARTY_NOTICES.md`. That file
lists code WRL Forge actually ships. Listing White Dune there would assert a
distribution relationship that does not exist and should not.

## 8. Review gates before any future reuse

Any proposal to use White Dune material beyond §2 stops until **all** of these hold:

1. **Ryan approves explicitly**, in the conversation where it is proposed.
2. The specific files and the specific reuse are named — not "referenced White Dune".
3. The licensing consequence is stated plainly, including whether WRL Forge would
   have to leave MIT.
4. A license-clean alternative has been searched for and documented as unavailable.
5. For anything shipping: real legal review.

**Default answer is no.** Nothing found in WD0 justifies reuse. Every capability
White Dune demonstrates is either reimplementable from the ISO spec, already present
in WRL Forge, or explicitly rejected as out of scope.

## 9. Repository separation (as implemented)

```
~/Projects/
├── cybertown/wrlforge/              MIT. No White Dune content. Ever.
│   └── docs/white-dune-2026/        WD0 docs — prose and CSV only
└── white-dune-archive/              GPL reference. Outside all Git repos.
    ├── wdune-1.956-deb-evidence/    binary deb: extracted/, control/, metadata/
    └── white_dune-1.930-source-evidence/
        └── extracted/white_dune-1.930/
```

Rules:

- `~/Projects/white-dune-archive/` **is never added to a Git repository** and never
  becomes a submodule of one.
- The originals in `~/Downloads/` are untouched — extraction was read-only
  (`dpkg-deb -x`, `unzip`), never `dpkg -i`.
- No system package was installed, removed, or modified during WD0.
- `/usr/local/bin/dune` was executed exactly once, with `--version`, under a
  throwaway `HOME`. It created no files and Ryan's real White Dune preferences were
  not touched.
- If the archive is ever backed up, it goes to the external drive per the workspace
  rules — **not** to any Git remote.

---

## 10. One-paragraph summary for a future agent

White Dune is **GPL-2.0-or-later**; WRL Forge is **MIT**. They are license-incompatible,
so no White Dune code may be copied, adapted, or translated into WRL Forge. Study it for
*capabilities and workflows*; take *facts* from ISO/IEC 14772-1 (mirrored locally at
`wb-ct-scrape/specs/iso-14772-vrml97`) and *node metadata* from the MIT-licensed
`x_ite.d.ts` already in `node_modules`. The GPL material lives only in
`~/Projects/white-dune-archive/`, outside every repository. When in doubt, stop and ask
Ryan — the default answer is no.
