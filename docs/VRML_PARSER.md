# VRML97 Parser (Phase 7A / 7A1)

Status: **SHIPPED (parser-only lane).** A real, dependency-free VRML97 tokenizer +
structural parser lives under `src/vrml/`. It ships **alongside** the existing
production systems (`validator.js`, World Project scanners, X_ITE previews,
packaging) and does **not** change any of them.

**Now consumed by the Phase 7B native editor** (`docs/NATIVE_EDITOR_ARCHITECTURE.md`)
as its **sole** language authority: `src/editor/language.js` runs one `parse()`
per debounced analysis and derives highlighting, syntax diagnostics, non-
authoritative advisories, and the AST outline from it — there is **no second
grammar or regex mode** anywhere in the editor. The editor still routes nothing
else through the parser: `validator.js`, World scanning, previews, and packaging
are unchanged. The flat, non-authoritative semantic scope is honored — the editor
surfaces VRML040–044 (`DEF`/`USE`/`ROUTE`) only as clearly-labelled advisories,
never as authoritative errors, and never blocks saving on them.

> **Phase 7A1 — Corpus Compatibility Corrections.** Independent real-corpus QA
> (Gemini, ~2,124 Cybertown files) gave Phase 7A a CONDITIONAL GO and found three
> valid VRML97 forms the tokenizer/parser rejected. All three are now fixed
> (details inline below):
> 1. **Identifier characters** — internal `-`/`+` (e.g. `phb_left-COORD`,
>    `house3mini-ROT-INTERP`) are valid non-leading identifier chars.
> 2. **Multiline strings** — quoted strings (notably inline Script source) may span
>    LF/CRLF/lone-CR line breaks.
> 3. **Header encoding case** — `#VRML V2.0 utf8` is now validated case-SENSITIVELY
>    (`UTF8` is flagged, non-fatally).
>
> A fourth, pervasive **Cybertown/Blaxxun** pattern was also identified and
> accepted leniently: **ROUTE/PROTO/EXTERNPROTO statements embedded inside an MFNode
> `children [ ... ]` array** (not strict VRML97, but ubiquitous in real worlds).
> Measured corpus diagnostics fell **98.1%** (926,063 → 17,201); clean parses rose
> from 961 to 1,745 of 2,124. The remaining bulk is the **flat-scope duplicate-DEF**
> limitation (see "Semantic limitations"), which is intentionally NOT fixed here.

## Module layout

```
src/vrml/
  diagnostics.js   Diagnostic model: {severity, code, message, range, expected?, related?} + stable CODE table
  ast.js           AST node types (NODE.*), span helpers (mergeRange), depth-first walk(), factories
  tokenizer.js     char stream -> token stream, exact spans, trivia/comments, LF+CRLF; tokenize(text)
  parser.js        token stream -> partial syntax tree with recovery + safety limits; parse(text, opts)
  analyze.js       semantic index over the AST: DEF/USE/ROUTE resolution + diagnostics; analyze(tree)
  asset-refs.js    read-only url-field extraction from the AST, parity with the production scanner
  index.js         facade: parse(text, {profile}) -> { tree, tokens, comments, diagnostics, defs, routes, uses, assetRefs, ... }
```

Pure and injectable: text in, tree + diagnostics + index out. **No fs, no
Electron.** Gzip is handled *outside* the parser — the main process decompresses
to plain UTF-8 first (`src/preview/wrl-source.js` `readWrlSource`), exactly as the
World asset-graph resolver already does.

## Token-driven, not regex-driven

The tokenizer classifies characters into tokens; the parser consumes **tokens**
and never re-scans source text. Small regexes appear only inside single-character
lexical helpers (header shape, number reconstruction) — never as the parsing
architecture. This is the completion-gate requirement and is enforced by review.

## Tokenizer

Every token carries an exact source span and its original lexeme:

```
range.start / range.end = { offset (0-based), line (1-based), column (1-based) }
lexeme                  = the raw source text of the token
leadingTrivia           = [{ kind: 'whitespace'|'comma'|'comment', lexeme, range }, ...]
```

Trivia (whitespace, VRML's comma-as-whitespace, and comments) is **preserved** as
leading trivia on the following token, and comments are also collected in a flat
list — so a future formatter can round-trip and the editor can render comment
folding. **LF and CRLF** both advance the line counter exactly once (a lone CR
too); identical content with either line ending produces identical line/column
spans (asserted by test).

Token classes: `header`, `id`, `keyword`, `bool`, `string`, `number`, `lbrace`,
`rbrace`, `lbracket`, `rbracket`, `period`, `eof` (`comment` appears only as
trivia). Keywords tokenized as `keyword`: `DEF USE ROUTE TO PROTO EXTERNPROTO IS
NULL field eventIn eventOut exposedField`; `TRUE`/`FALSE` tokenize as `bool`.
Numbers classify as `int` / `float` / `hex` (`0x…`), including exponent notation,
leading/trailing dot, and signs; the parser coerces per position (no field-type
schema in 7A). `.` disambiguates: `.5` is a float, `a.b` is `id period id` (for
`ROUTE`).

**Identifier grammar (7A1).** Per ISO/IEC 14772-1, an identifier may not *start*
with a digit or `+`/`-` (those begin numbers), but `+`/`-` ARE valid as
non-leading characters — so `phb_left-COORD`, `house3mini-ROT-INTERP`, and
`name+suffix` are single identifiers. Numeric literals are unaffected: `-1`,
`+2e-3` lex as numbers, and `1-2` / `foo -1` split correctly (a hyphen after a
number begins a new signed literal, never number-identifier glue); `12abc` / `2x3`
are still flagged invalid numbers. Whitespace separates tokens, so `foo-1` (no
space) is deliberately one identifier per the greedy grammar.

**Multiline strings (7A1).** Quoted strings MAY span multiple lines (LF, CRLF, or
lone CR) — inline Script bodies frequently do. The decoded string **value**
normalizes every line break to `\n`; the exact **lexeme** slices from source
(preserving CR); `\"`/`\\` escapes work across line breaks; and line/column stay
exact after the string. An unterminated string runs to EOF and emits exactly
**one** bounded `UNTERMINATED_STRING` diagnostic (no cascade).

## AST shape

Plain objects with a `type` discriminator (`NODE.*`) and a `range` on **every**
node. Key shapes:

- `Document { header, statements[], range }`
- `Header { version, encoding, comment, range }`
- `Node { nodeType, typeRange, def, defRange, fields[], interfaces[], range }` — a node instance; `def` set for `DEF name Node`
- `Use { name, nameRange, range }`
- `Field { name, nameRange, value, isBinding, range }` — value is a value node or, when `isBinding`, an `Is`
- `Is { name, nameRange, range }` — `field IS interfaceName`
- `Route { from{node,event,…}, to{node,event,…}, range }`
- `Proto { name, interfaces[], body[], range }`
- `ExternProto { name, interfaces[], url, range }`
- `InterfaceDecl { access, fieldType, name, default, range }` — `field`/`eventIn`/`eventOut`/`exposedField`
- Values: `Bool`, `Number {value, numeric, valid, lexeme}`, `String {value, raw}`, `Null`, `Numbers {values[]}` (a bare run of ≥1 numbers — SFVec*/SFRotation/SFColor/MFFloat), `Array {items[]}` (a bracketed `[ … ]`).

Field values are parsed **without a field-type schema**: a bare run of numbers
becomes a single `Numbers` node (arity is *not* checked in 7A), an identifier
starts an SFNode, `[ … ]` an MF array, `"…"` an SFString, `TRUE`/`FALSE` a Bool,
`NULL` a Null, `DEF`/`USE` a node reference. This is the standard typeless VRML97
approach; per-field arity/type validation needs a node/field-type table and is
Phase 7B+.

The tree is **profile-neutral** and **renderer-neutral** — designed for
diagnostics, scene outline, go-to-definition, `DEF`/`USE` resolution, `ROUTE`
validation, asset-reference extraction, syntax highlighting, safe targeted edits,
and future formatting — not around one validator or the renderer.

## Diagnostic model + stable codes

`{ severity, code, message, range, expected?, related? }`. `severity` ∈ `error |
warning | info | hint`. `related` carries e.g. the first-definition span for a
duplicate `DEF`. **Codes are stable** (never renumbered):

| Code | Meaning |
|---|---|
| `VRML001` | Missing `#VRML V2.0 utf8` header (error, non-fatal) |
| `VRML002` | Non-canonical header — wrong version/encoding, incl. wrong-case `UTF8` (warning, non-fatal) |
| `VRML010` | Unterminated string |
| `VRML011` | Invalid number literal |
| `VRML012` | Unexpected character |
| `VRML020` | Expected token (with `expected`) |
| `VRML021` | Unexpected token |
| `VRML022` | Expected a field value |
| `VRML023` | Unclosed `{` |
| `VRML024` | Unclosed `[` |
| `VRML025` | Expected a node |
| `VRML026` | Expected an identifier |
| `VRML027` | Expected an interface declaration |
| `VRML030` | Maximum nesting depth exceeded |
| `VRML031` | Token limit exceeded (reserved) |
| `VRML032` | Node limit exceeded |
| `VRML040` | Duplicate `DEF` (related → first) |
| `VRML041` | Unresolved `USE` |
| `VRML042` | Unresolved `ROUTE` source |
| `VRML043` | Unresolved `ROUTE` destination |
| `VRML044` | Duplicate `ROUTE` (warning) |

## Recovery strategy

Recovery-oriented, like a language-server parser: on an unexpected token the
parser emits **one** diagnostic and resynchronizes at a safe boundary — closing
`}`, closing `]`, the next plausible top-level statement, or the next field/node
start (`syncInBody`) — so one malformed field or node does not destroy the rest of
the file. Every loop is guaranteed to make progress (a no-consume iteration
force-advances one token), so malformed input can never cascade into dozens of
meaningless diagnostics or hang.

**Cybertown/Blaxxun leniency (7A1).** Strict VRML97 permits only nodeStatements
inside an MFNode `[ ... ]`, but real Cybertown worlds embed
`ROUTE`/`PROTO`/`EXTERNPROTO` statements directly inside `children [ ... ]`. Rather
than desync the array (which cascaded tens of thousands of diagnostics across the
corpus), `parseArray` accepts these by delegating to the same handlers used in a
node body — the embedded ROUTE is still indexed and resolved by the semantic pass.
This is a deliberate real-content compatibility choice, documented as a lenient
extension, not strict-spec behavior.

## Safety limits

Explicit and configurable via `parse(text, { maxDepth, maxNodes })`:

- `maxDepth` (default **256**) — nesting depth cap; on exceed, `VRML030` and the
  over-deep subtree is skipped (its braced block is consumed), parsing continues.
- `maxNodes` (default **100000**) — total node-count cap; on exceed, `VRML032` and
  parsing stops cleanly, returning the partial tree collected so far.

Malformed/adversarial input (thousands of unbalanced brackets/braces,
unterminated strings, invalid numbers) is proven by test to terminate with a
finite token stream and a usable partial tree — **no infinite loop or unbounded
recursion**.

## DEF / USE / ROUTE analysis

`analyze(tree)` (also run by `index.parse`) builds:

- `defs` / `defsByName` — every `DEF` declaration; duplicates → `VRML040` with a
  related span to the first.
- `uses` — every `USE` with a `resolved` flag; unresolved → `VRML041`.
- `routes` — every `ROUTE` with `resolvedFrom` / `resolvedTo`; dangling endpoints
  → `VRML042` / `VRML043`; exact duplicates → `VRML044` (warning).

Syntax and semantics are **separable**: `result.syntaxDiagnostics` vs
`result.semanticDiagnostics`. Scope model in 7A is a single flat document scope
(see Known limitations). No runtime type validation is attempted.

## Asset-reference parity

`asset-refs.js` extracts url-bearing references from the **AST** (not a text
regex), reusing the production classifier (`src/world-project/url-fields.js`
`isRemote`/`isInlineScript`) so remote/local/inline-script classification cannot
drift. Inline Script bodies (`javascript:` / `vrmlscript:` / `ecmascript:`) are
recognized and classified as `inline-script`, never as file dependencies.

**Parity status:** `extractUrlTriples(tree)` matches the production
`extractUrlRefs(text)` `{nodeType, field, value}` output **exactly** across all
committed `.wrl` fixtures (30+ files, plain and gzip). One **intentional,
documented** difference: a `url "…"` that appears only inside a **comment** is
matched by the production lexical regex but correctly **ignored** by the
AST-based extractor (`test/fixtures/vrml/comments.wrl`). This is the AST being
*more* correct, not a regression. A **known shared gap**: `EXTERNPROTO` URLs have
no `url` field name, so neither scanner treats them as url-field refs.

**The production scanner is not replaced in Phase 7A.** The AST extractor is an
additive, comparison-validated helper.

## Fixture corpus

`test/fixtures/vrml/` (compact, original/derived — no third-party historical files
committed). Binary/CRLF fixtures are reproduced by `_generate.js`
(`valid-gzip.wrl`, `crlf.wrl`, `plain-twin.wrl`) with a `.gitattributes`
(`* -text`) so git does not rewrite line endings. Covers: minimal valid; Mall- and
World-shaped samples; nested nodes; `DEF`/`USE`; `ROUTE`; `PROTO`; `EXTERNPROTO`;
`IS`; Script interfaces + inline code; MFString URL arrays; comments (incl.
url-in-comment); escaped strings; CRLF; hex + exponent numbers; `NULL`; malformed
brace/bracket; unterminated string; invalid number; duplicate `DEF`; unresolved
`USE`; invalid `ROUTE`; recovery-with-valid-content-after-an-error; and (7A1)
hyphenated identifiers, multiline inline Script source (`multiline-script.wrl` +
its CRLF twin), and header-case checks. Real production fixtures under
`test/fixtures/{,preview/,world/}` are also parsed.

## Performance (indicative, one dev machine)

| Input | Bytes | Tokens | Parse |
|---|---|---|---|
| Mall item (`valid-plain.wrl`) | 299 | 51 | ~2.6 ms |
| World (`world/small`) | 320 | 58 | ~0.6 ms |
| World (`valid70`, gzip, 71 textures) | 6.9 KB | 1,223 | ~8.6 ms |
| World (`smartcar-lite`) | 17.7 KB | 3,163 | ~11 ms |
| Largest local fixture (`oversized.wrl`) | 327 KB | 33,028 | ~74 ms |
| Synthetic deep (depth 200) | 4.6 KB | 1,205 | ~4.5 ms |
| Synthetic large (5,000 shapes) | 505 KB | 105,002 | ~189 ms |

Scaling is linear-ish (8× input ≈ 8× time in the test harness); no quadratic
behavior. No aggressive optimization was applied — that is deferred.

## Real-corpus results (7A1)

Read-only audit over the available Cybertown corpus (`/home/ryan/Projects/cybertown`,
excluding `wrlforge*` worktrees), 3 MB/file cap, gzip-transparent — using Gemini's
exact discovery logic for comparability:

- Discovered: **2,129** `.wrl`/`.wrz`; skipped **5** (4 over 3 MB, 1 gzip-inflate
  error, 0 read errors); **attempted 2,124** (plain **486** + gzip **1,638** = 2,124).
- Total diagnostics **926,063 → 17,201** (**−98.1%**); files with diagnostics
  **1,163 → 379**; clean parses **961 → 1,745**. No depth/node-limit hits; parse
  memory bounded (per-file, GC between batches). Slowest ~284 ms / largest ~1.29 MB.
- **Count reconciliation** of the Gemini report's arithmetic (total 2,124; plain
  486; gzip 1,639; plain+gzip = 2,125): the "2,124" is the *attempted-parse* count,
  not discovery (2,129). The 1-file gap is the single **gzip-inflate-error** file —
  it is gzip by magic bytes (so Gemini's 1,639) but never parsed (so attempted =
  2,124, and this audit's parsed-only gzip count = 1,638). Reconciled; the measured
  reduction is **98.1%**, not the projected "95%+".
- **Remaining diagnostics** are dominated by `VRML040` duplicate-`DEF` (**15,638**,
  ~91%) — the flat-scope limitation below, deliberately not "fixed" in 7A1 — plus
  small residual `VRML021/020/022` from genuinely malformed/unusual files.

## Known unsupported semantics / limitations

- **No field-type schema.** Bare numeric runs are captured as `Numbers` with no
  arity check (`SFVec3f` vs `SFRotation` vs `MFFloat` are not distinguished
  syntactically). Per-field type/arity validation is Phase 7B+.
- **Semantic scope is FLAT and NOT authoritative (retained in 7A1).** `DEF`/`USE`/
  `ROUTE` resolve against a single whole-document table. Consequences the editor
  must NOT present as authoritative until scope-aware analysis lands:
  - **PROTO-body DEF leakage** — a `DEF` inside a `PROTO` body is visible document-wide.
  - **False duplicate-DEF** across separate `PROTO` scopes (the dominant remaining
    corpus diagnostic — real worlds legitimately reuse names per scope).
  - **USE-before-DEF** resolves (order not enforced).
  - **Context-insensitive `IS`** — `IS` is accepted syntactically without checking it
    occurs inside a `PROTO`/Script interface context.
  These are intentionally out of 7A1 scope (no PROTO-scope rewrite); a later
  scope-aware analysis lane addresses them. Until then, `VRML040`/`VRML041`/
  `VRML044` are advisory.
- **No runtime/type validation, no rendering.** The parser produces a syntax tree
  only; X_ITE remains the sole renderer.
- **Cybertown/Blaxxun lenient extension.** ROUTE/PROTO inside MFNode arrays is
  accepted (see Recovery) — a real-content compatibility choice, not strict VRML97.

## Recommended Phase 7B editor-integration boundary

Consume the parser as a pure module: `const { parse } = require('src/vrml')`.

- **Syntax highlighting** ← `tokenize(text)` token kinds + spans (incremental
  re-tokenize on edit).
- **Diagnostics (inline + list)** ← `result.diagnostics` (already ranged;
  debounce parsing on the editor buffer).
- **Scene outline** ← walk `result.tree` for `Node` hierarchy + `def` names.
- **Go-to-definition** ← `result.defsByName` / `uses` / `routes` endpoint spans.
- **Safe targeted edits** ← per-node `range` spans (edit by span, no full rewrite).
- **Buffer-driven preview** ← parse the unsaved buffer; on the *last valid* tree,
  keep the existing X_ITE path (`src/preview/` for Mall, `wrlworld://` for World).
  **Do not** add a renderer.

The editor component dependency decision (vendored CodeMirror core vs. minimal
custom editor) stays open for the Phase 7B review — see
`docs/NATIVE_EDITOR_ARCHITECTURE.md` § B.2.
