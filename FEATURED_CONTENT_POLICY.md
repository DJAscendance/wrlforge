# Featured Content Policy — artwork, models, and scenes

WRL Forge the **software** is licensed `GPL-3.0-or-later` ([`LICENSE`](LICENSE)).

VRML worlds, models, textures, and other creative works are **separate copyrighted
works**. A 3D scene does not become GPL because a GPL program can open it, preview it,
or feature it on a website. This document governs that separate category.

> Engineering and curation policy, not legal advice.

---

## 1. The separation, stated plainly

| | governed by |
|---|---|
| WRL Forge source, docs, build tooling | `GPL-3.0-or-later` |
| A `.wrl` you open in WRL Forge | your rights, untouched |
| A `.wrl` featured on the WRL Forge website | its creator's rights + the permission recorded here |
| Test fixtures authored for this repository | `GPL-3.0-or-later` with the rest of the repo |

Nothing in the software license reaches a user's own content, and nothing in it
relicenses a contributor's artwork.

## 2. Contributors keep their copyright

An artist who submits a world or model for display **retains full copyright in it**.

WRL Forge asks only for the permission it actually needs, and asks for it explicitly:

- **host** the file on project infrastructure;
- **display** and **preview** it in the browser and in the application;
- **feature** it on the website, with credit;
- **redistribute** it as a downloadable file — **only where separately and explicitly
  agreed**.

Redistribution is opt-in, never assumed. A permission to *show* a world is not a
permission to *hand it out*.

**Artwork contributors are never asked to GPL their art.** If a creator chooses an open
content licence (CC BY, CC0, or similar) that is welcome and simplifies everything
downstream — but it is their choice, not a condition of being featured.

## 3. Rights categories

Every featured item is classified into exactly one:

### 1 — Project-owned
Authored by Ryan Bundy or produced for WRL Forge. Rights are clear; the project may
display and redistribute freely.

### 2 — Contributor-submitted with permission
The creator holds copyright and has granted the permissions in §2. Record **which**
permissions were granted, and from whom.

### 3 — Open-licensed or public domain
Published under a licence that permits the intended use (CC BY, CC BY-SA, CC0, public
domain dedication). Record the exact licence and honour its attribution terms.

### 4 — Historical or community content, rights status unresolved
Classic Cybertown-era worlds and objects whose creator is unknown, unreachable, or whose
permission has not been obtained.

**Category 4 is the one that needs discipline.** For these:

- record what is actually known, and mark what is not known as *unknown* — never fill a
  gap with a guess;
- do **not** assert ownership, licence, or public-domain status that has not been
  established;
- do **not** redistribute as a download without owner review;
- treat display as a separate decision from redistribution, made case by case;
- honour a takedown request from a credible rights holder promptly and without argument.

Age is not a licence. Abandonment is not a licence. A file being widely mirrored is not
a licence.

## 4. Required metadata

Each featured item carries a record with these fields. Unknown values are written as
`unknown`, not omitted and not invented:

| field | notes |
|---|---|
| Title / object name | as the creator named it, where known |
| Creator / artist | person or handle; `unknown` if genuinely unknown |
| Original source | world, city, site, or archive it came from |
| Original date / era | year or period |
| Category | 1–4 from §3 |
| Licence or permission basis | licence name, or how permission was obtained |
| Attribution URL / contact | where the creator wants to be linked, if anywhere |
| Redistribution permitted | yes / no / display-only |
| Display scope | website · in-app · both |
| Recorded by / date | who established this, and when |

## 5. Attribution is displayed, not filed away

The creator's credit belongs **with the object**, visible to whoever is looking at it —
not buried in a metadata file. The WRL Forge website should show, alongside a featured
item: its title, its creator, its era, and its rights basis or licence.

**The website lives in a separate repository** (the `wrlforge-site` project) and is not
modified by this repository. This section records the requirement; implementing the
credit display there is follow-up work for that repository.

## 6. Repository fixtures

The `.wrl` files and textures under `test/`, `spikes/`, and `qa/` are **synthetic,
hand-authored** samples created for this project — placeholder geometry and 1×1-pixel
textures. They contain no historical Cybertown platform content. They are project-owned
(category 1) and are licensed with the repository.

Do not add real platform content, or anyone else's world, to the repository as a
fixture. When a bug needs a reproduction file, use content you authored or are clearly
authorised to distribute — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## 7. When in doubt

Ask the owner before featuring. An unresolved rights question is resolved by finding the
answer or declining to publish — never by publishing and hoping.
