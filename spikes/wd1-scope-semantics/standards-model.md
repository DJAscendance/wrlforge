# WD1.5 — VRML97 scope semantics, from the standard

Every rule below is derived from **ISO/IEC 14772-1** (VRML97), read from the
repository-local mirror at
`~/Projects/cybertown/wb-ct-scrape/specs/iso-14772-vrml97/markdown/part1/`
(`concepts.md`, `grammar.md`, `nodesRef.md`). Clause numbers are the standard's
own. Prose is **paraphrased**; only short identifying phrases are quoted, and
only where the exact wording is the point.

No White Dune material, no `RE-ARTIFACTS`, and no other implementation's source
was consulted. Node and field metadata comes from the committed WD1.3 schema
(`src/vrml/node-schema.js`), itself built from the same ISO mirror plus the
MIT-licensed `x_ite.d.ts` — see `OPEN_SOURCE_PROVENANCE.md`.

## Confidence grades

Each rule carries a grade, and the prototype's behaviour follows from it:

| grade | meaning | prototype behaviour |
|---|---|---|
| `normative-explicit` | a sentence of the standard states it | enforced |
| `normative-derived` | follows from Annex A plus a clause | enforced |
| `interpretation` | a reasonable reading; not stated outright | **fails closed** — reports `unsupported`/`recovered` rather than asserting |

Nothing in this lane is enforced at `interpretation` grade without saying so.

---

## 1. The namespaces are not one namespace

VRML97 has **three** distinct name spaces. Conflating any two is the most common
way to get scope wrong, so the model names them:

| namespace | what lives in it | who looks it up |
|---|---|---|
| **node name** | `DEF` names | `USE`, ROUTE endpoints |
| **node type** | `PROTO` / `EXTERNPROTO` declaration names | a node instance's type token |
| **interface member** | a PROTO interface's and a Script's `field`/`eventIn`/`eventOut`/`exposedField` names | `IS`, ROUTE event parts |

Built-in node type names and built-in field names are **not lexical symbols at
all** — they are schema lookups (clause 6). `Transform` is not declared anywhere
in a file; asking the scope graph to "resolve" it is a category error. The
prototype answers that question separately (`node-type-is-builtin`) so the two
never merge.

## 2. DEF and USE — clause 4.6.2, 4.8.4

| # | rule | clause | grade |
|---|---|---|---|
| D1 | A `DEF` name is limited in scope to a single VRML file, a single prototype definition, or a single `createVrmlFromString` string. | 4.6.2 | explicit |
| D2 | A `USE` binds the node with that name **preceding it** in the file or prototype definition. Visibility is **textual and ordered**, not graph-wide. | 4.6.2 | explicit |
| D3 | If several nodes share a name, a `USE` binds *the closest preceding one*. Duplicates are therefore **legal and fully defined**, not an error. | 4.6.2 | explicit |
| D4 | A `USE` with no preceding declaration of that name has no binding. | 4.6.2 (by D2) | derived |
| D5 | A `PROTO` establishes a `DEF`/`USE` scope **separate from the rest of the scene and separate from any nested `PROTO`**. | 4.8.4 | explicit |
| D6 | A name `DEF`ed inside a prototype may not be `USE`d outside it. | 4.8.4 | explicit |
| D7 | A name `DEF`ed outside a prototype may not be `USE`d inside it. | 4.8.4 | explicit |
| D8 | `USE` does not copy: the same node gains an additional parent. | 4.6.2 | explicit |
| D9 | The **transformation hierarchy** shall be acyclic; results are undefined if a node in it is its own ancestor. | 4.4.4 | explicit |
| D10 | A descendant of a `Script` node is **not** in the transformation hierarchy unless it is also reachable from a node that is. So D9 does not reach it. | 4.4.4 | explicit |

**D5 is disjointness, not shadowing.** A PROTO body's node-name scope has no
parent: lookup stops there rather than continuing outward. This is the single
most important structural consequence in the whole lane, and it is why the
prototype's `Scope` carries a `defParent` that is `null` on a PROTO body while
its `typeParent` still points outward.

**D3 vs. tool safety.** D3 fully determines what a *browser* does. It does not
determine what an *editor* may safely do. WD1.4's hard gate — a tool may lose a
target, may say it cannot prove one, may never act on the wrong one — means a
rename or a re-anchor must not silently pick "the closest preceding". The
prototype therefore returns `ambiguous` for D3 and **does not implement the
closest-preceding rule at all**. A future runtime-semantics query may implement
it under its own name; it must never feed identity. See `REPORT.md` §7.

**Run-time name scope (4.4.6) is a different thing** and is deliberately out of
scope for this lane. It concerns which nodes a *running browser* considers named
— `Inline` children and prototype instances each open one — and is about
instances, not source text. WD1.5 models the **lexical** scope of a single file.

## 3. PROTO and EXTERNPROTO — clause 4.3.5, 4.8, 4.9

| # | rule | clause | grade |
|---|---|---|---|
| P1 | `PROTO` defines a new node type usable exactly like a built-in one. | 4.8.1 | explicit |
| P2 | Node type names shall be unique in each file; results are undefined if a prototype takes the name of a built-in or of an earlier prototype in the same scope. | 4.8.1 | explicit |
| P3 | A prototype may be instantiated **only after its definition completes**. There is no forward reference. | 4.8.4 | explicit |
| P4 | A prototype may not be instantiated inside its own implementation — recursive prototypes are illegal. | 4.8.4 | explicit |
| P5 | Prototype definitions nested inside a prototype definition are **local to the enclosing prototype**. | 4.8.4 | explicit |
| P6 | A nested body may still instantiate a type declared in an enclosing scope: type lookup walks outward. | 4.8.4 (P5 restricts the declaration's reach, not the body's view) | derived |
| P7 | A prototype definition consists of at least one node statement plus any number of ROUTE / PROTO / EXTERNPROTO statements. An empty body is not conforming. | 4.3.5, Annex A `protoBody` | explicit |
| P8 | The **first node** of the definition determines where instances may be used. | 4.8.3 | explicit |
| P9 | `EXTERNPROTO` is `PROTO` with the body elsewhere and no field defaults. | 4.9.1 | explicit |
| P10 | An `EXTERNPROTO` interface shall be a **subset** of the real implementation's. A name absent from the declaration is therefore **unknowable locally**, not wrong. | 4.9.2 | explicit |
| P11 | An `EXTERNPROTO` URL ending `#name` selects that PROTO from the target file; otherwise the file's first PROTO is used and its name need not match. | 4.9.3 | explicit |

P10 is why the prototype answers `unsupported / externproto-interface-is-subset`
rather than `unresolved` for an unrecognised event on an EXTERNPROTO instance.
Reporting an error there would be a false positive by construction.

## 4. Interfaces and IS — clause 4.3.5, 4.3.6, 4.8.2, 4.8.3, 4.8.4

| # | rule | clause | grade |
|---|---|---|---|
| I1 | `field` / `eventIn` / `eventOut` / `exposedField` names shall be unique **within each PROTO statement**, and need not be unique **between** PROTO statements. | 4.3.5 | explicit |
| I2 | An `exposedField` *zzz* is equivalent to a field *zzz*, an eventIn *set_zzz* and an eventOut *zzz_changed*. | 4.8.2 | explicit |
| I3 | If an interface declares `exposedField` *zzz*, it shall not also declare an eventIn/eventOut named *set_zzz* or *zzz_changed*. | 4.3.5 | explicit |
| I4 | `IS` may appear only in the body of a node **inside a prototype definition**. | 4.3.6 | explicit |
| I5 | `IS` shall refer to a member of the prototype's interface declaration; results are undefined otherwise. | 4.8.3 | explicit |
| I6 | Inside a **nested** prototype, `IS` refers to the **innermost** prototype's declarations. | 4.8.4 | explicit |
| I7 | The field/event **types** shall match exactly. `SFColor`↔`SFVec3f` and `SFColor`↔`MFColor` are both illegal. | 4.8.3 | explicit |
| I8 | Access types shall map per **Table 4.4** (reproduced below as data, not prose). | 4.8.3 | explicit |
| I9 | A node member bound by **more than one** `IS` is undefined. Several nodes binding the *same* interface member is fine. | 4.8.3 | explicit |
| I10 | A field given both an initial value and an `IS` binding is undefined. | 4.8.3 | explicit |
| I11 | An `exposedField` in the *interface* may be bound only by an `exposedField` in the *definition*. | 4.8.3 | explicit |

**Table 4.4** — rows: access in the prototype **definition** (the node inside the
body); columns: access in the prototype **declaration** (the interface).

|  | exposedField | field | eventIn | eventOut |
|---|---|---|---|---|
| **exposedField** | yes | yes | yes | yes |
| **field** | no | yes | no | no |
| **eventIn** | no | no | yes | no |
| **eventOut** | no | no | no | yes |

## 5. ROUTE — clause 4.10.2, 4.10.5

| # | rule | clause | grade |
|---|---|---|---|
| R1 | A ROUTE may appear at the top level, in a prototype definition, or **inside a node wherever fields may appear**. | 4.10.2 | explicit |
| R2 | Nodes referenced by a ROUTE **shall be defined before the ROUTE statement**. No forward references. | 4.10.2 | explicit |
| R3 | Endpoint node names are `DEF` names, so they resolve in the enclosing node-name scope and inherit rule D5 — a ROUTE cannot cross a PROTO boundary. | 4.10.2 + 4.8.4 | derived |
| R4 | eventIn and eventOut types **shall match exactly**. | 4.10.2 | explicit |
| R5 | Routes go from an eventOut to an eventIn only. | 4.10.2 | explicit |
| R6 | The `set_` prefix and `_changed` suffix are optional: a browser retries `zzz` as `set_zzz` / `zzz_changed`. | 4.10.2 | explicit |
| R7 | A repeated identical route is **ignored**, not an error. | 4.10.2 | explicit |
| R8 | Fan-in and fan-out are legal; fan-in evaluation order is implementation dependent. | 4.10.5 | explicit |

## 6. Script interfaces — clause 6.40, Annex A

| # | rule | clause | grade |
|---|---|---|---|
| S1 | A Script declares its own events and fields using **the same syntax as a prototype definition**. | 6.40 | explicit |
| S2 | Each declared name shall be **unique for that Script node**. | 6.40 | explicit |
| S3 | **`exposedField` is not allowed in a Script node**, except the built-in `url`. | 6.40 | explicit |
| S4 | A Script body may also carry the `IS` forms (`eventIn type name IS name`, etc.) — this is what lets a Script participate in a PROTO interface. | Annex A `scriptBodyElement` | explicit |
| S5 | A Script's declared members form their **own namespace**, per node instance — not a document-level one. | 6.40 (S2) | derived |
| S6 | A Script interface is what a ROUTE endpoint resolves against when the endpoint node is a Script. | 4.10.2 + 6.40 | derived |

## 7. What Annex A allows structurally

Read directly from the grammar, because several of these determine where the
traversal must look:

- `statement ::= nodeStatement | protoStatement | routeStatement` — a file's top
  level carries nodes, PROTO/EXTERNPROTO and ROUTE, in any order.
- `nodeBodyElement ::= fieldId fieldValue | fieldId IS fieldId | eventInId IS
  eventInId | eventOutId IS eventOutId | routeStatement | protoStatement` — so a
  **node body may contain ROUTE and PROTO statements**. (WRL Forge's parser
  collects these into the node's `fields` array; the prototype must dispatch on
  type, not assume every entry is a field. Missing this cost 5,444 real ROUTEs
  in an early revision.)
- `mfnodeValue ::= nodeStatement | [ ] | [ nodeStatements ]` — an MFNode array
  holds **only node statements**. ROUTE, PROTO and EXTERNPROTO inside `[ … ]` are
  **not** conforming VRML97; WRL Forge's parser accepts them deliberately as a
  Cybertown/Blaxxun compatibility measure, and this lane classifies them as such.
- `scriptBodyElement ::= nodeBodyElement | restrictedInterfaceDeclaration | …IS…`
  where `restrictedInterfaceDeclaration` covers `eventIn`/`eventOut`/`field` but
  **not** `exposedField` — the grammar agrees with 6.40 S3.
- `rootNodeStatement ::= node | DEF nodeNameId node` — a prototype body's first
  statement cannot be a `USE`.
- `Id` is defined by exclusion: any UTF-8 character except the control range,
  and except the listed delimiters; digits and `+`/`-` are barred only as the
  **first** character. `/`, `:`, `@` and `!` are therefore all legal inside an
  identifier — which is exactly why a scope must be an identity and never a
  string built by joining names (WD1.4 found a real wrong anchor from that).

## 8. Rules this lane deliberately does not model

- **4.4.6 run-time name scope** — an instance-level, browser-level concept
  (`Inline` and prototype instances each open one). Lexical scope is the
  question here; run-time scope belongs to a viewer, not an editor.
- **The closest-preceding duplicate rule (D3)** — specified, understood,
  recorded, and deliberately not implemented in the resolver. See §2.
- **Cross-file resolution** — `EXTERNPROTO` targets and `Inline` children.
  The standard scopes names to a single file (D1), so a single-file scope graph
  is complete for its own question; anything cross-file is a separate lane.
- **VRML 1.0** — a different language that also uses `.wrl`. 106 files in the
  sampled corpus are V1.0, and neither the parser nor this model reads them.
