# `docs/white-dune-2026/` — historical lane records

These are the **as-written and as-built records** of the WD0–WD1.5 lanes. They are
history: they describe what was decided, what was built, and — importantly for
provenance — what was and was not consulted at the time.

## The licensing posture changed after these were written

Every document here predates WRL Forge's transition to **`GPL-3.0-or-later`**. They were
written while the project was MIT-licensed, and several carry the clean-room rules that
followed from that: *do not consult White Dune*, *opening White Dune source is a STOP
condition*, and similar.

**Those instructions are superseded.** Current policy lives in:

- [`/OPEN_SOURCE_PROVENANCE.md`](../../OPEN_SOURCE_PROVENANCE.md) — what may be reused,
  from where, and how provenance is recorded;
- [`/WD.md`](../../WD.md) §1 — the same rules stated for the document-core lane.

GPL-compatible open-source implementation material, White Dune included, **may** now be
studied and reused with preserved notices and recorded provenance.

## `GPL_PROVENANCE_BOUNDARY.md` was removed

That document existed solely to enforce the MIT-era clean-room boundary. It was deleted
from `main` during the GPL transition and is preserved in Git history. Several documents
here still cite it; treat those citations as pointing at history, and
`/OPEN_SOURCE_PROVENANCE.md` as the live rule.

## What is still true

The **provenance statements** in these documents remain accurate and valuable:

> "No White Dune material and no other editor's implementation material was consulted."

That is a fact about how `src/vrml/` was actually built — independently, from ISO/IEC
14772-1 and the MIT-licensed `x_ite.d.ts`. It is deliberately preserved, not corrected.
A future lane that *does* reuse upstream material records that separately, in
`/OPEN_SOURCE_PROVENANCE.md` §4.

The directory keeps its name. Renaming it would create large, meaningless churn across
history for no gain.
