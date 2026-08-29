'use strict';
// Deterministic VRML97 / X3D node-and-field schema generator (Phase WD1.3).
//
//   node scripts/build-node-schema.js            # regenerate src/vrml/node-schema.js
//   node scripts/build-node-schema.js --check    # verify the committed file is current
//   node scripts/build-node-schema.js --help
//
// MAINTAINER TOOL, NOT A BUILD STEP. `npm install`, `npm test`, `npm start` and
// every packaging script run WITHOUT this generator and WITHOUT its inputs: the
// generated module is committed, and that committed file is what the product and
// the tests consume. Only a maintainer regenerating the schema needs the ISO
// mirror on disk.
//
// ---------------------------------------------------------------------------
// LICENSING -- read before changing an input
// ---------------------------------------------------------------------------
//
// Exactly two inputs, both license-clean, per OPEN_SOURCE_PROVENANCE.md:
//
//   1. ISO/IEC 14772-1 (VRML97), Web3D Consortium's published copy, mirrored
//      locally. NORMATIVE AUTHORITY for which nodes and fields exist in VRML97,
//      their field types, their declaration categories, their defaults, and
//      (WD1.6-A) their node classes, accepted node types and value ranges. Two
//      clauses are read: `nodesRef.html` for the interface, `concepts.html` for
//      the clause 4 semantics.
//   2. `x_ite.d.ts` from the MIT-licensed `x_ite` package already in this repo's
//      dependency tree. Supplies the CURRENT X3D runtime shape, and by
//      subtraction identifies fields that exist in X3D but NOT in VRML97. It is
//      NOT used as a source of constraint metadata: an X3D-only field gets
//      `constraints: null`, always.
//
// **No White Dune source, binary, fixture, example, icon, node table, or
// algorithm was consulted to build this generator or its output.** That is a
// provenance FACT about this file, recorded because a reviewer cannot infer it
// from the diff -- not a standing prohibition. WRL Forge is GPL-3.0-or-later and
// GPL-compatible reuse is permitted project-wide (OPEN_SOURCE_PROVENANCE.md);
// the node metadata problem simply happens to be solved entirely by the two
// standards inputs above.
//
// This generator reads standards material and emits FACTS extracted from it --
// node names, field names, type tokens, access categories, default literals. It
// deliberately copies NO prose: no descriptions, no clause text, no tables of
// explanation. What lands in the repository is a machine-readable interface
// inventory, not a reproduction of the standard.
//
// ---------------------------------------------------------------------------
// EXTRACTION NOTES -- why the raw HTML, and the three anomalies it contains
// ---------------------------------------------------------------------------
//
// The mirror carries both `raw/` (byte-exact 1997 HTML) and `markdown/` (a
// lossy rendering). This reads `raw/part1/nodesRef.html` ONLY. The markdown
// layer drops the markup that distinguishes a field name from its default, and
// WD0 already found it mangling `Shape`'s declaration.
//
// The 1997 HTML is regular but not uniform, and three anomalies would each
// silently cost data if parsed naively. All three are handled and asserted:
//
//   A. `Shape` (6.41) puts its opening `Shape {` line in a <P> element OUTSIDE
//      the <PRE> that holds its two field declarations. A parser keyed on
//      "<PRE> starting with <B>Name {" therefore finds 53 nodes, not 54. This
//      generator is keyed on SECTION HEADINGS instead, and takes the first <PRE>
//      inside each section, so Shape parses like any other node.
//   B. `Anchor` and `Transform` sections contain ADDITIONAL <PRE> blocks (prose
//      examples) that also open with `<B>Name {`. Taking the first <PRE> per
//      section, rather than every matching <PRE> in the file, avoids them.
//   C. Headings and the table of contents disagree on whitespace: one heading
//      has a space after `</A>` and two TOC entries use `&nbsp;` where the rest
//      use a space. A regex demanding a literal space finds 53 nodes in one and
//      52 in the other -- both wrong, both plausible-looking. Whitespace is
//      therefore matched as `(?:\s|&nbsp;)*` throughout, and the node set is
//      cross-checked across THREE independent signals (headings, TOC, and the
//      declaration blocks) which must all agree before anything is emitted.
//
// Within a declaration block the markup is equally irregular: a field's name and
// its default may sit in one <B> region or in two separate ones; a <B> region
// may hold only whitespace; the `#` comment may fall inside or outside the bold;
// a comment may wrap across lines because an <IMG> renders an infinity sign; and
// `Extrusion.crossSection`'s default wraps onto a second, fully-bold line. Every
// one of these is handled below and covered by test/vrml/node-schema.test.js.
//
// `Script` declares three PLACEHOLDER lines ("and any number of:
// eventIn eventType eventName", ...) describing user-defined interface entries.
// They are templates, not fields, and are excluded -- counted and reported, not
// silently dropped.
//
// ---------------------------------------------------------------------------
// WD1.6-A -- a fourth anomaly, and the absence rule
// ---------------------------------------------------------------------------
//
//   D. The two mathematical symbols in a field's '#' range annotation are GIF
//      IMAGES, not text. WD1.3 stripped every <IMG> because it only ever wanted
//      the text left of the '#', which was harmless then and is not now:
//      stripping turns CylinderSensor.maxAngle's "[-2pi,2pi]" into "[-2,2]", a
//      range that looks perfectly machine-readable and is wrong by a factor of
//      pi. Images are now SUBSTITUTED by sentinel, a pi-valued bound is emitted
//      as the SYMBOL it is and never as a rounded float, and any third image in
//      a declaration block is a hard failure.
//
// The absence rule governs everything this phase emits, and it runs the OPPOSITE
// way from the fail-closed semantics elsewhere in this repository:
//
//     constraints: null  means  NO MACHINE-REPRESENTED CONSTRAINT IS AVAILABLE
//
// It never means the field is unrestricted, and a consumer must not clamp or
// reject on the strength of it. A wrong constraint silently rejects legal input;
// a missing one only declines to check. Where the standard clearly states a
// restriction this shape cannot carry, a typed `note` says so explicitly --
// which is a different answer again from `null`.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const OUT_FILE = path.join(REPO, 'src', 'vrml', 'node-schema.js');
const XITE_DTS = path.join(REPO, 'node_modules', 'x_ite', 'dist', 'x_ite.d.ts');

// Bump when the OUTPUT SHAPE changes (not for a source-data refresh). Recorded
// in the generated file so a stale schema is identifiable from the file alone.
const GENERATOR_VERSION = '1.1.0';

// Where the ISO mirror usually sits relative to this repo. Overridable; never
// baked into the generated output.
const DEFAULT_ISO_DIRS = [
  path.join(REPO, '..', 'wb-ct-scrape', 'specs', 'iso-14772-vrml97'),
];

const NODE_REF = path.join('raw', 'part1', 'nodesRef.html');
const CONCEPTS_REF = path.join('raw', 'part1', 'concepts.html');

// Glyph sentinels (WD1.6-A). The 1997 pages render the two mathematical symbols
// that appear in field-range annotations as GIFs, not text: an unbounded end of
// a range is <IMG SRC=".../infinity.gif"> and a pi-valued bound is
// <IMG SRC=".../pi.gif">. Stripping the markup -- which is what WD1.3 did, since
// it only ever wanted the part left of the '#' -- silently turns
//
//     # [-2<pi>,2<pi>]   into   # [-2,2]
//
// a range that looks perfectly machine-readable and is wrong by a factor of pi.
// The images are therefore SUBSTITUTED, not removed, and any third image inside
// a declaration block is a hard failure rather than a silent loss.
//
// U+0003/U+0004 cannot occur in the source HTML, so they can never collide with
// real content -- the same reasoning as BOLD_IN/BOLD_OUT below.
const PI_GLYPH = '\u0003';
const INFINITY_GLYPH = '\u0004';
const GLYPH_BY_IMAGE = Object.freeze({ 'pi.gif': PI_GLYPH, 'infinity.gif': INFINITY_GLYPH });
const GLYPH_WORD = Object.freeze({ [PI_GLYPH]: 'pi', [INFINITY_GLYPH]: 'infinity' });
const GLYPHS = new RegExp(`[${PI_GLYPH}${INFINITY_GLYPH}]`, 'g');
const spellGlyphs = (text) => text.replace(GLYPHS, (g) => GLYPH_WORD[g]);

// VRML97 declaration category -> X3D access type (ISO/IEC 14772-1 4.7 / 6.40;
// the X3D names are the ones X_ITE reports). The VRML97 spelling is KEPT
// alongside the normalized name -- ROUTE validation needs to speak both.
const ACCESS_BY_DECLARATION = Object.freeze({
  field: 'initializeOnly',
  eventIn: 'inputOnly',
  eventOut: 'outputOnly',
  exposedField: 'inputOutput',
});

const DECLARATIONS = Object.keys(ACCESS_BY_DECLARATION);

// Numeric components per element, for turning a default literal into structured
// values. Types absent here are not numeric tuples.
const TUPLE_ARITY = Object.freeze({
  SFVec2f: 2, MFVec2f: 2,
  SFVec3f: 3, MFVec3f: 3,
  SFColor: 3, MFColor: 3,
  SFRotation: 4, MFRotation: 4,
});

const SCALAR_NUMERIC = new Set(['SFFloat', 'SFTime', 'SFInt32', 'MFFloat', 'MFInt32']);

const fail = (message) => { throw new Error(`build-node-schema: ${message}`); };

// ---------------------------------------------------------------------------
// ISO/IEC 14772-1 extraction
// ---------------------------------------------------------------------------

// The 1997 pages are ISO-8859-1. Read as latin1 so byte -> char is total and
// deterministic; every token this generator keeps is then asserted ASCII.
const readLatin1 = (file) => fs.readFileSync(file, 'latin1');

const WS = '(?:\\s|&nbsp;)*';

// Sentinels standing in for <B>/</B> while the rest of the markup is stripped.
// U+0001/U+0002 cannot occur in the source HTML, so they can never collide with
// real content. Named rather than written inline: an invisible control character
// in committed source is unreviewable.
const BOLD_IN = '\u0001';
const BOLD_OUT = '\u0002';
const BOLD_REGION = /\u0001([^\u0002]*)\u0002/g;

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

// Replace every <IMG> in a declaration block with the glyph sentinel it renders.
// An unrecognised image is a hard failure: WD1.3 dropped images because it never
// read the range comment, and a silent drop there is exactly how "[-2pi,2pi]"
// becomes "[-2,2]".
function substituteGlyphs(html, context) {
  return html.replace(/<IMG[^>]*>/gi, (tag) => {
    const src = (tag.match(/SRC="([^"]*)"/i) || [])[1];
    const base = src ? src.split('/').pop() : null;
    const glyph = base ? GLYPH_BY_IMAGE[base] : null;
    if (!glyph) fail(`${context}: unrecognised image in a declaration block: ${JSON.stringify(src)}`);
    return glyph;
  });
}

const isDeclarationLine = (text) => new RegExp(`^(${DECLARATIONS.join('|')})\\s`).test(text.trim());

// Section headings: the primary node-set signal.
function isoHeadings(html) {
  const re = new RegExp(`<A NAME="([A-Za-z0-9_]+)"></A>${WS}(\\d+\\.\\d+)${WS}([A-Za-z0-9_]+)</H2>`, 'g');
  return [...html.matchAll(re)]
    .filter((m) => m[1] === m[3]) // 6.1 Introduction anchors "6.1", not a node name
    .map((m) => ({ name: m[3], section: m[2], index: m.index }));
}

// Table of contents: an independent signal over the same set.
function isoTocNames(html) {
  const re = new RegExp(`<A HREF="#([A-Za-z0-9_]+)">(\\d+\\.\\d+)${WS}([A-Za-z0-9_]+)</A>`, 'g');
  return new Set([...html.matchAll(re)].filter((m) => m[1] === m[3]).map((m) => m[3]));
}

// Parse one node's declaration block into ordered field records.
function parseDeclarationBlock(nodeName, blockHtml, report) {
  // <IMG> only ever renders a maths glyph inside a trailing comment; dropping it
  // first keeps comment wrapping from being mistaken for structure. Bold markers
  // are preserved as sentinels because they are the ONLY thing separating a
  // field name and its default from the surrounding alignment whitespace.
  const body = decodeEntities(
    substituteGlyphs(blockHtml, nodeName)
      .replace(/<B>/gi, BOLD_IN)
      .replace(/<\/B>/gi, BOLD_OUT)
      .replace(/<[^>]+>/g, ''),
  ).replace(/\r/g, '');

  const fields = [];
  let previous = null;

  for (const line of body.split('\n')) {
    const plain = line.split(BOLD_IN).join('').split(BOLD_OUT).join('');
    const bold = [...line.matchAll(BOLD_REGION)]
      .map((m) => m[1]).join(' ').replace(/\s+/g, ' ').trim();

    if (!isDeclarationLine(plain)) {
      // A fully-bold line that is not a declaration continues the PREVIOUS
      // default across a line wrap (`Extrusion.crossSection`). Recognised only
      // while that default has an unclosed bracket, so it can never swallow the
      // node header or the closing brace.
      if (previous && bold && previous.defaultText && !isBalanced(previous.defaultText)) {
        previous.defaultText = `${previous.defaultText} ${bold}`.replace(/\s+/g, ' ').trim();
        report.continuations.push(`${nodeName}.${previous.name}`);
      }
      continue;
    }

    // `Script`'s "and any number of" placeholders put the whole declaration --
    // access category included -- inside the bold region. Nothing else does.
    if (isDeclarationLine(bold)) {
      report.templates.push(`${nodeName}: ${plain.trim()}`);
      previous = null;
      continue;
    }

    const tokens = plain.split('#')[0].trim().split(/\s+/).filter(Boolean);
    const [declaration, type, name] = tokens;
    if (!declaration || !type || !name) fail(`${nodeName}: unparsable declaration ${JSON.stringify(plain)}`);
    if (!ACCESS_BY_DECLARATION[declaration]) fail(`${nodeName}.${name}: unknown declaration category ${declaration}`);

    let defaultText = null;
    if (bold) {
      const parts = bold.split(/\s+/);
      // Hard cross-check: the bold region must begin with the same field name
      // the plain-text declaration gave. This is what catches a mis-paired bold
      // region rather than letting it become a wrong default.
      if (parts[0] !== name) {
        fail(`${nodeName}: bold region names ${JSON.stringify(parts[0])} but the declaration names ${JSON.stringify(name)}`);
      }
      defaultText = parts.slice(1).join(' ').split('#')[0].trim() || null;
    }

    for (const token of [declaration, type, name]) {
      // eslint-disable-next-line no-control-regex
      if (/[^\x20-\x7E]/.test(token)) fail(`${nodeName}: non-ASCII token ${JSON.stringify(token)}`);
    }

    if (defaultText !== null && spellGlyphs(defaultText) !== defaultText) {
      fail(`${nodeName}.${name}: a mathematical glyph reached the default value -- ${JSON.stringify(spellGlyphs(defaultText))}`);
    }

    // WD1.6-A: everything right of the '#'. ISO/IEC 14772-1 4.1.3 defines this
    // annotation as the field's value range; WD1.3 discarded it.
    const hash = plain.indexOf('#');
    const rangeText = hash < 0 ? null : (plain.slice(hash + 1).trim().replace(/\s+/g, ' ') || null);

    const field = { name, type, declaration, defaultText, rangeText, order: fields.length };
    fields.push(field);
    previous = field;
  }

  return fields;
}

const isBalanced = (text) => (text.match(/\[/g) || []).length === (text.match(/\]/g) || []).length;

// ---------------------------------------------------------------------------
// WD1.6-A -- standards-derived semantic metadata
// ---------------------------------------------------------------------------
//
// Three independent ISO/IEC 14772-1 structures, each extracted by an explicit
// parser keyed on the structure it actually reads. Nothing here interprets
// arbitrary prose, scores candidates, or infers a fact from a field's name.
//
//   1. NODE CLASSES      clause 4 "The following node types are ..." enumerations
//   2. ACCEPTED NODES    clause 4 Table 4.3, plus four exact clause 6 sentence
//                        templates that must AGREE with it
//   3. VALUE RANGES      the '#' range annotation on each clause 6 declaration
//
// The absence rule is the load-bearing one, and it runs the opposite way from
// the rest of this repository's fail-closed semantics: a field with no extracted
// metadata gets `constraints: null`, which means "no machine-represented
// constraint is available" and NEVER "the standard permits anything here". A
// consumer must not clamp or reject on the strength of a null. A wrong
// constraint silently rejects legal input; a missing one only declines to check.

// --- node classes ----------------------------------------------------------

// The normative lead-in, whitespace-tolerant. One section wraps it across a line
// ("The following\nnode types are pointing-device sensors"), and a regex
// demanding a literal space finds 9 of the 10 -- a plausible-looking undercount.
const NODE_CLASS_PHRASE = /The\s+following\s+node\s+types\s+are/g;

// Stable id for each normative enumeration, keyed on the exact label the
// standard uses between that phrase and its colon. Every discovered label must
// appear here and every id here must be discovered, so a source-format change or
// a new/renamed enumeration fails loudly instead of quietly changing coverage.
//
// These are SEMANTIC classes from the standard. They are deliberately not a node
// palette: there is no "Common" or "Favorites" here, and a node may belong to
// none, one, or several of them (Anchor is grouping + children + sensor +
// pointing-device sensor).
const NODE_CLASS_IDS = Object.freeze({
  'in the scene graph but not affected by the transformation hierarchy': 'notAffectedByTransformationHierarchy',
  'geometry nodes': 'geometry',
  'grouping nodes': 'grouping',
  'children nodes': 'children',
  'not valid as children nodes': 'notValidAsChildren',
  'light source nodes': 'lightSource',
  'sensor nodes': 'sensor',
  'environmental sensors': 'environmentalSensor',
  'pointing-device sensors': 'pointingDeviceSensor',
  'interpolator nodes, each based on the type of value that is interpolated': 'interpolator',
});

const stripTags = (html) => decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// Nearest preceding clause heading -- the class's normative citation.
function sectionAt(html, index) {
  const before = html.slice(0, index);
  const matches = [...before.matchAll(/<A NAME="(\d+(?:\.\d+)*)"><\/A>/g)];
  if (!matches.length) fail(`no enclosing clause heading before offset ${index}`);
  return matches[matches.length - 1][1];
}

// Members are <LI><A HREF="nodesRef.html#Name">Name</A>. The href fragment and
// the link text are two independent spellings of the same fact and must agree,
// which is what catches a mis-sliced region rather than letting it emit a
// half-list.
function listMembers(region, label) {
  const out = [];
  for (const m of region.matchAll(/<LI>\s*<A HREF="nodesRef\.html#([A-Za-z0-9_]+)">([A-Za-z0-9_]+)<\/A>/g)) {
    if (m[1] !== m[2]) fail(`node class ${JSON.stringify(label)}: link ${m[1]} names ${m[2]}`);
    out.push(m[2]);
  }
  return out;
}

function extractNodeClasses(html, knownNodeNames) {
  const classes = {};
  const phrases = [...html.matchAll(NODE_CLASS_PHRASE)];
  if (!phrases.length) fail('concepts: found no "The following node types are" enumeration');

  for (let i = 0; i < phrases.length; i += 1) {
    const start = phrases[i].index;
    const afterPhrase = start + phrases[i][0].length;
    // Bounded by whatever comes first: the next enumeration or the next heading.
    const nextPhrase = i + 1 < phrases.length ? phrases[i + 1].index : html.length;
    const nextHeading = html.slice(afterPhrase).search(/<H[1-6][ >]/i);
    const end = Math.min(nextPhrase, nextHeading < 0 ? html.length : afterPhrase + nextHeading);

    const colon = html.indexOf(':', afterPhrase);
    if (colon < 0 || colon > end) fail(`node class enumeration at ${start} has no ':' introducing its members`);
    const label = stripTags(html.slice(afterPhrase, colon));
    const id = NODE_CLASS_IDS[label];
    if (!id) fail(`unknown normative node-class label ${JSON.stringify(label)}`);
    if (classes[id]) fail(`node class ${id} enumerated twice`);

    const tail = html.slice(colon + 1, end);
    // Two realisations of the same enumeration. Most are a <UL>; two are a
    // <TABLE> laying several <UL> columns side by side; one (4.4.4) is written
    // inline in the sentence itself. Nothing else is accepted.
    const ul = tail.search(/<UL[ >]/i);
    const table = tail.search(/<TABLE[ >]/i);
    let members;
    let form;
    if (ul >= 0 && (table < 0 || ul < table)) {
      const region = tail.slice(ul).match(/<UL[\s\S]*?<\/UL>/i);
      if (!region) fail(`node class ${id}: unterminated <UL>`);
      members = listMembers(region[0], label);
      form = 'list';
    } else if (table >= 0) {
      const region = tail.slice(table).match(/<TABLE[\s\S]*?<\/TABLE>/i);
      if (!region) fail(`node class ${id}: unterminated <TABLE>`);
      members = listMembers(region[0], label);
      form = 'list';
    } else {
      // Inline: "... hierarchy: A, B, ..., and Z." Terminated by the sentence's
      // own full stop. Every member is validated against the node set below, so
      // a mis-terminated slice cannot survive as a plausible list.
      const stop = tail.indexOf('.');
      if (stop < 0) fail(`node class ${id}: inline enumeration is unterminated`);
      members = tail.slice(0, stop).split(',')
        .map((part) => stripTags(part).replace(/^and\s+/, '').trim())
        .filter(Boolean);
      form = 'inline';
    }

    if (!members.length) fail(`node class ${id}: enumerated no members`);
    const seen = new Set();
    for (const name of members) {
      if (seen.has(name)) fail(`node class ${id}: ${name} listed twice`);
      seen.add(name);
      if (!knownNodeNames.has(name)) fail(`node class ${id}: ${name} is not a node in clause 6`);
    }
    classes[id] = { id, label, section: sectionAt(html, start), form, members };
  }

  const missing = Object.values(NODE_CLASS_IDS).filter((id) => !classes[id]);
  if (missing.length) fail(`node-class enumerations not found: ${missing.join(', ')}`);
  return classes;
}

// --- Table 4.3: valid node types per SFNode/MFNode field --------------------

// ISO/IEC 14772-1 Table 4.3 spells PixelTexture as two words in the "Valid Node
// Types for Field" cell for Appearance.texture. No node is named "Pixel
// Texture": 6.37 defines PixelTexture, and 6.3's own prose for that very field
// reads "(ImageTexture, MovieTexture, or PixelTexture)". A typesetting slip in
// the 1997 document, corrected here, asserted at the point of use, and applied
// nowhere else. This table exists to hold exactly this kind of case; if it ever
// grows past a handful of entries the extraction has stopped being mechanical
// and needs redesigning rather than extending.
const TABLE_4_3_NAME_FIXUPS = Object.freeze({ 'Pixel Texture': 'PixelTexture' });

// The cell text the table uses to defer to a node CLASS rather than name types.
const TABLE_4_3_CLASS_CELLS = Object.freeze({ 'Valid children nodes': 'children' });

function extractTable43(html, knownNodeNames) {
  const anchor = html.indexOf('<A NAME="Table4.3">');
  if (anchor < 0) fail('concepts: Table 4.3 anchor not found');
  const table = html.slice(anchor).match(/<TABLE[\s\S]*?<\/TABLE>/i);
  if (!table) fail('concepts: Table 4.3 has no table body');

  const rows = [...table[0].matchAll(/<TR>([\s\S]*?)<\/TR>/gi)]
    .map((m) => [...m[1].matchAll(/<T[DH]>([\s\S]*?)<\/T[DH]>/gi)].map((c) => stripTags(c[1])));
  if (!rows.length) fail('concepts: Table 4.3 has no rows');

  const header = rows[0].join('|');
  if (header !== 'Node Type|Field|Valid Node Types for Field') {
    fail(`concepts: Table 4.3 header changed: ${JSON.stringify(header)}`);
  }

  const out = [];
  let node = null;
  for (const row of rows.slice(1)) {
    if (row.length !== 3) fail(`concepts: Table 4.3 row has ${row.length} cells: ${JSON.stringify(row)}`);
    const [nodeCell, fieldCell, valueCell] = row;
    // An empty first cell continues the previous node -- the table's own
    // row-grouping convention.
    if (nodeCell) node = nodeCell;
    if (!node) fail(`concepts: Table 4.3 row ${JSON.stringify(row)} has no node`);
    if (!knownNodeNames.has(node)) fail(`concepts: Table 4.3 names unknown node ${node}`);
    if (!fieldCell) fail(`concepts: Table 4.3 row for ${node} has no field`);

    const entry = { node, field: fieldCell };
    const classId = TABLE_4_3_CLASS_CELLS[valueCell];
    if (classId) {
      entry.classes = [classId];
    } else {
      entry.types = valueCell.split(',').map((t) => t.trim()).filter(Boolean).map((raw) => {
        const fixed = TABLE_4_3_NAME_FIXUPS[raw];
        if (fixed !== undefined) {
          if (knownNodeNames.has(raw)) fail(`concepts: Table 4.3 fixup for ${JSON.stringify(raw)} is no longer needed`);
          if (!knownNodeNames.has(fixed)) fail(`concepts: Table 4.3 fixup target ${fixed} is not a node`);
          return fixed;
        }
        if (!knownNodeNames.has(raw)) fail(`concepts: Table 4.3 names unknown node type ${JSON.stringify(raw)} for ${node}.${fieldCell}`);
        return raw;
      });
      if (!entry.types.length) fail(`concepts: Table 4.3 gives no node types for ${node}.${fieldCell}`);
    }
    out.push(entry);
  }
  return out;
}

// --- clause 6 sentence templates: a second, independent accepted-node signal --

// Four EXACT normative sentence shapes, each binding a field name to a node type
// with no free gap between them. The tightness is the whole point: allowing an
// arbitrary gap makes "The source field specifies the sound source for the Sound
// node" bind Sound.source to Sound, which is wrong -- its real answer is
// AudioClip or MovieTexture. Recall is deliberately sacrificed; a field no
// template matches simply gets nothing from this signal.
const ACCEPTED_SENTENCE_FORMS = [
  (f) => `\\b${f}\\s+field\\s+(?:contains|specifies)\\s+(?:a|an|one)\\s+([A-Za-z0-9_]+)\\s+node\\b`,
  (f) => `\\b${f}\\s+field,\\s*if\\s+specified,\\s*shall\\s+(?:contain|specify)\\s+(?:a|an|one)\\s+([A-Za-z0-9_]+)\\s+node\\b`,
  (f) => `\\b${f}\\s+field\\s+shall\\s+(?:contain|specify)\\s+(?:a|an|one)\\s+([A-Za-z0-9_]+)\\s+node\\b`,
  (f) => `\\b${f}(?:\\s+field)?\\s+is\\s+not\\s+NULL,\\s*it\\s+shall\\s+(?:contain|specify)\\s+(?:a|an|one)\\s+([A-Za-z0-9_]+)\\s+node\\b`,
];

// -> node type, or null when the templates find nothing or disagree. A captured
// word that is not itself a node name is DISCARDED, not guessed at: "contains a
// geometry node" names a class, and answering it with a type would be an
// invention.
function acceptedTypeFromProse(prose, field, knownNodeNames, report) {
  const found = new Set();
  for (const form of ACCEPTED_SENTENCE_FORMS) {
    for (const m of prose.matchAll(new RegExp(form(field), 'g'))) {
      if (knownNodeNames.has(m[1])) found.add(m[1]);
    }
  }
  if (found.size === 1) return [...found][0];
  if (found.size > 1) report.push(`${field}: clause 6 templates disagree (${[...found].sort().join(', ')})`);
  return null;
}

// --- value ranges -----------------------------------------------------------

const RANGE_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
// A signed optional coefficient on one glyph, optionally divided by an integer:
// -infinity, infinity, pi, -2pi, pi/2.
const RANGE_SYMBOL = new RegExp(`^[+-]?\\d*[${PI_GLYPH}${INFINITY_GLYPH}](?:/\\d+)?$`);
const INTERVAL = /^([[(])\s*([^,]*?)\s*,\s*([^,\])]*?)\s*([\])])$/;
const BRACKETED = '(?:\\[[^\\]]*\\]|\\([^)]*\\))';
const PER_COMPONENT = new RegExp(`^(${BRACKETED})\\s*,\\s*(${BRACKETED})$`);
const DISJUNCTIVE = new RegExp(`^(${BRACKETED})\\s+or\\s+(.+)$`);
const EXTERNAL_REF = /^see\s+\d/;

// Categories for a constraint the standard clearly states but this schema shape
// cannot carry. Emitting one is a positive statement -- "a normative restriction
// exists here and is not represented" -- which is different from `null`, and
// very different from claiming the field is unrestricted.
const NOTE = Object.freeze({
  BOUND_IS_SYMBOLIC: 'BOUND_IS_SYMBOLIC',
  PER_COMPONENT_RANGE: 'PER_COMPONENT_RANGE',
  DISJUNCTIVE_RANGE: 'DISJUNCTIVE_RANGE',
  NON_MACHINE_EXTRACTABLE: 'NON_MACHINE_EXTRACTABLE',
});

const parseEndpoint = (text) => {
  const t = text.trim();
  if (RANGE_NUMBER.test(t)) return { numeric: Number(t) };
  if (RANGE_SYMBOL.test(t)) return { symbolic: spellGlyphs(t), pi: t.includes(PI_GLYPH) };
  return null;
};

// -> { min?, minInclusive?, minSymbolic?, max?, maxInclusive?, maxSymbolic?,
//      note? } or null. Fails loudly on an annotation form it does not know,
// so a source-format change surfaces as an error rather than as lost coverage.
function parseRange(qualifiedName, text) {
  const note = (category) => ({ note: { category, source: spellGlyphs(text) } });

  const single = text.match(INTERVAL);
  if (single) {
    const [, openBracket, lowText, highText, closeBracket] = single;
    const low = parseEndpoint(lowText);
    const high = parseEndpoint(highText);
    if (!low || !high) fail(`${qualifiedName}: unparsable range endpoint in ${JSON.stringify(spellGlyphs(text))}`);
    const out = {};
    if ('numeric' in low) { out.min = low.numeric; out.minInclusive = openBracket === '['; }
    else { out.minSymbolic = low.symbolic; out.minInclusive = openBracket === '['; }
    if ('numeric' in high) { out.max = high.numeric; out.maxInclusive = closeBracket === ']'; }
    else { out.maxSymbolic = high.symbolic; out.maxInclusive = closeBracket === ']'; }
    // A pi-valued bound is recorded as the symbol it is. Multiplying it out
    // would put a rounded float in a normative slot, and the standard's value is
    // the symbol, not any particular truncation of it. Infinity needs no note --
    // "no bound in that direction" is fully represented by the absence of a
    // numeric one alongside the symbol.
    if (low.pi || high.pi) Object.assign(out, note(NOTE.BOUND_IS_SYMBOLIC));
    return out;
  }
  // Different bounds for different components of one tuple (SFRotation: axis in
  // [-1,1], angle unbounded). A single min/max would be wrong for one of them.
  if (PER_COMPONENT.test(text)) return note(NOTE.PER_COMPONENT_RANGE);
  // An interval OR a sentinel value (bboxSize: (0,infinity) or -1 -1 -1).
  // Emitting the interval alone would reject the field's own default.
  if (DISJUNCTIVE.test(text)) return note(NOTE.DISJUNCTIVE_RANGE);
  // A cross-reference to another clause (PixelTexture.image -> 5.5, SFImage).
  if (EXTERNAL_REF.test(text)) return note(NOTE.NON_MACHINE_EXTRACTABLE);
  return fail(`${qualifiedName}: unrecognised range annotation ${JSON.stringify(spellGlyphs(text))}`);
}

function extractIso(isoDir) {
  const nodeRefPath = path.join(isoDir, NODE_REF);
  if (!fs.existsSync(nodeRefPath)) fail(`ISO node reference not found at ${NODE_REF} under the given mirror`);
  const html = readLatin1(nodeRefPath);

  const headings = isoHeadings(html);
  const toc = isoTocNames(html);
  const report = { templates: [], continuations: [] };

  const nodes = [];
  const declarationBlocks = new Set();
  for (let i = 0; i < headings.length; i += 1) {
    const end = i + 1 < headings.length ? headings[i + 1].index : html.length;
    const section = html.slice(headings[i].index, end);
    const block = section.match(/<PRE>([\s\S]*?)<\/PRE>/);
    if (!block) fail(`${headings[i].name}: section ${headings[i].section} has no declaration block`);
    declarationBlocks.add(headings[i].name);
    nodes.push({
      name: headings[i].name,
      section: headings[i].section,
      // Clause 6 running text for this node, used ONLY by the accepted-node
      // sentence templates. Kept per-section so a sentence can never be read
      // against the wrong node.
      prose: stripTags(section),
      fields: parseDeclarationBlock(headings[i].name, block[1], report),
    });
  }

  // Three independent signals must agree before anything is emitted. Any
  // disagreement means the extraction is wrong in a way that would otherwise
  // show up as a quietly missing node.
  const headingNames = new Set(nodes.map((n) => n.name));
  const missingFromToc = [...headingNames].filter((n) => !toc.has(n));
  const missingFromHeadings = [...toc].filter((n) => !headingNames.has(n));
  if (missingFromToc.length || missingFromHeadings.length) {
    fail(`node set disagrees between headings and table of contents: `
      + `heading-only ${JSON.stringify(missingFromToc)}, toc-only ${JSON.stringify(missingFromHeadings)}`);
  }
  for (const node of nodes) {
    if (!declarationBlocks.has(node.name)) fail(`${node.name}: no declaration block signal`);
    if (!node.fields.length) fail(`${node.name}: parsed zero field declarations`);
    const seen = new Set();
    for (const f of node.fields) {
      if (seen.has(f.name)) fail(`${node.name}.${f.name}: duplicate field declaration`);
      seen.add(f.name);
      const isEvent = f.declaration === 'eventIn' || f.declaration === 'eventOut';
      if (!isEvent && f.defaultText === null) fail(`${node.name}.${f.name}: ${f.declaration} has no extractable default`);
      if (isEvent && f.defaultText !== null) fail(`${node.name}.${f.name}: ${f.declaration} unexpectedly carries a default`);
      if (f.defaultText !== null && !isBalanced(f.defaultText)) {
        fail(`${node.name}.${f.name}: default ${JSON.stringify(f.defaultText)} has unbalanced brackets`);
      }
    }
  }

  // WD1.6-A. Clause 4 carries the semantic metadata; clause 6 carries the
  // interface. Both are read, and the two accepted-node signals must agree.
  const conceptsPath = path.join(isoDir, CONCEPTS_REF);
  if (!fs.existsSync(conceptsPath)) fail(`ISO concepts clause not found at ${CONCEPTS_REF} under the given mirror`);
  const conceptsHtml = readLatin1(conceptsPath);

  const nodeClasses = extractNodeClasses(conceptsHtml, headingNames);
  const table43 = extractTable43(conceptsHtml, headingNames);

  const nodeValued = new Set(['SFNode', 'MFNode']);
  const byQualifiedName = new Map();
  for (const node of nodes) {
    for (const f of node.fields) byQualifiedName.set(`${node.name}.${f.name}`, { node, field: f });
  }

  // Table 4.3 must describe fields that actually exist, and only node-valued
  // ones -- its own title says so.
  for (const entry of table43) {
    const target = byQualifiedName.get(`${entry.node}.${entry.field}`);
    if (!target) fail(`concepts: Table 4.3 names unknown field ${entry.node}.${entry.field}`);
    if (!nodeValued.has(target.field.type)) {
      fail(`concepts: Table 4.3 lists ${entry.node}.${entry.field}, which is ${target.field.type}, not SFNode/MFNode`);
    }
    if (entry.classes) {
      for (const id of entry.classes) if (!nodeClasses[id]) fail(`concepts: Table 4.3 cites unknown node class ${id}`);
    }
    target.field.acceptedNodeTypes = entry.types || null;
    target.field.acceptedNodeClasses = entry.classes || null;
    target.field.acceptedSource = 'table-4.3';
  }

  // The second signal. Where both speak they must agree; a clause 6 sentence
  // contradicting Table 4.3 is a contradiction in the extraction, not a fact to
  // pick between.
  const proseReport = { disagreements: [], proseOnly: [] };
  for (const node of nodes) {
    for (const f of node.fields) {
      if (!nodeValued.has(f.type)) continue;
      const fromProse = acceptedTypeFromProse(node.prose, f.name, headingNames, proseReport.disagreements);
      if (!fromProse) continue;
      if (f.acceptedNodeTypes) {
        if (!f.acceptedNodeTypes.includes(fromProse)) {
          fail(`${node.name}.${f.name}: clause 6 says ${fromProse}, Table 4.3 says ${f.acceptedNodeTypes.join(', ')}`);
        }
        continue;
      }
      if (f.acceptedNodeClasses) continue; // the table's class answer is the broader, normative one
      f.acceptedNodeTypes = [fromProse];
      f.acceptedSource = 'clause-6-sentence';
      proseReport.proseOnly.push(`${node.name}.${f.name} = ${fromProse}`);
    }
  }

  return {
    nodes, report, sourcePath: nodeRefPath, html, conceptsHtml, nodeClasses, table43, proseReport,
  };
}


// Assemble one field's constraint record, or null when nothing was extracted.
// Keys are inserted in a fixed order so the emitted literal is deterministic
// without the record-ordering machinery below having to recurse into it.
function buildConstraints(qualifiedName, f) {
  const range = f.rangeText === null ? null : parseRange(qualifiedName, f.rangeText);
  const rules = [];
  if (range) rules.push('declaration-range');
  if (f.acceptedSource) rules.push(f.acceptedSource);
  if (!rules.length) return null;

  const out = {};
  const put = (key, value) => { if (value !== undefined) out[key] = value; };
  if (range) {
    put('min', range.min);
    put('minSymbolic', range.minSymbolic);
    put('minInclusive', range.minInclusive);
    put('max', range.max);
    put('maxSymbolic', range.maxSymbolic);
    put('maxInclusive', range.maxInclusive);
  }
  if (f.acceptedNodeTypes) out.acceptedNodeTypes = [...f.acceptedNodeTypes];
  if (f.acceptedNodeClasses) out.acceptedNodeClasses = [...f.acceptedNodeClasses];
  if (range && range.note) out.note = { category: range.note.category, source: range.note.source };
  out.rules = rules;
  return out;
}

// ---------------------------------------------------------------------------
// Default-value normalization
// ---------------------------------------------------------------------------
//
// Values are read, never evaluated: no code from a parsed file is executed and
// no default is supplied from memory. When a literal cannot be normalized with
// confidence the exact declaration text is preserved and the record is marked
// uncertain, rather than guessed at.

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function splitStrings(text) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1].replace(/\\(.)/g, '$1'));
  return out;
}

// -> { value } on success, { uncertain: true } when the literal is not one this
// slice can normalize safely.
function normalizeDefault(type, text) {
  if (text === null) return { absent: true };
  const inner = text.replace(/^\[/, '').replace(/\]$/, '').trim();
  const isMulti = type.startsWith('MF');

  if (type === 'SFNode') {
    return text === 'NULL' ? { value: null } : { uncertain: true };
  }
  if (type === 'MFNode') {
    return inner === '' ? { value: [] } : { uncertain: true };
  }
  if (type === 'SFBool') {
    if (text === 'TRUE') return { value: true };
    if (text === 'FALSE') return { value: false };
    return { uncertain: true };
  }
  if (type === 'SFString') {
    const strings = splitStrings(text);
    return strings.length === 1 ? { value: strings[0] } : { uncertain: true };
  }
  if (type === 'MFString') {
    if (inner === '') return { value: [] };
    const strings = splitStrings(text);
    return strings.length ? { value: strings } : { uncertain: true };
  }

  // Numeric scalars, tuples, and their MF forms. Commas are VRML whitespace.
  const tokens = inner.split(/[\s,]+/).filter(Boolean);
  if (tokens.some((t) => !NUMBER.test(t))) return { uncertain: true };
  const numbers = tokens.map(Number);
  if (numbers.some((n) => !Number.isFinite(n))) return { uncertain: true };

  if (SCALAR_NUMERIC.has(type)) {
    if (!isMulti) return numbers.length === 1 ? { value: numbers[0] } : { uncertain: true };
    return { value: numbers };
  }

  const arity = TUPLE_ARITY[type];
  if (arity) {
    if (numbers.length % arity !== 0) return { uncertain: true };
    const tuples = [];
    for (let i = 0; i < numbers.length; i += arity) tuples.push(numbers.slice(i, i + arity));
    if (!isMulti) return tuples.length === 1 ? { value: tuples[0] } : { uncertain: true };
    return { value: tuples };
  }

  // SFImage: a width/height/components header followed by pixel words. Kept as
  // a flat numeric list -- the standard's own representation.
  if (type === 'SFImage') return { value: numbers };

  return { uncertain: true };
}

// ---------------------------------------------------------------------------
// X_ITE typings extraction
// ---------------------------------------------------------------------------
//
// Each `<Name>Proxy` interface in x_ite.d.ts declares its fields FLAT, inherited
// ones included, each preceded by a doc comment carrying the access type and the
// X3D field type. No inheritance walk is needed, and none is attempted -- the
// generator asserts that every ISO field is found on the leaf interface, which
// would fail loudly if a future x_ite release stopped flattening.

function interfaceBody(source, fromIndex) {
  const open = source.indexOf('{', fromIndex);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(open + 1, i); }
  }
  return '';
}

function extractXite(dtsPath) {
  if (!fs.existsSync(dtsPath)) fail(`x_ite typings not found at ${path.relative(REPO, dtsPath)}`);
  const source = fs.readFileSync(dtsPath, 'utf8');
  const byNode = new Map();
  for (const m of source.matchAll(/^\s*interface\s+([A-Za-z0-9_]+)Proxy(?:\s+extends\s[^\n]*)?$/gm)) {
    const fields = [];
    for (const f of interfaceBody(source, m.index).matchAll(/\/\*\*([\s\S]*?)\*\/\s*(?:readonly\s+)?([A-Za-z0-9_]+)\s*\??:/g)) {
      const accessType = (f[1].match(/access type '([A-Za-z]+)'/) || [])[1] || null;
      const type = (f[1].match(/and type ([A-Za-z0-9]+)\./) || [])[1] || null;
      fields.push({ name: f[2], accessType, type });
    }
    byNode.set(m[1], fields);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'node_modules', 'x_ite', 'package.json'), 'utf8'));
  return { byNode, version: pkg.version, source };
}

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------

function build(iso, xite) {
  const counts = {
    nodes: iso.nodes.length,
    isoDeclarations: 0,
    xiteFields: 0,
    shared: 0,
    vrml97Only: 0,
    x3dOnly: 0,
    unresolved: 0,
    accessTypePromotions: 0,
    uncertainDefaults: 0,
    // WD1.6-A. Every count carries its denominator: `fieldsExamined` is every
    // field record emitted (VRML97 and X3D-only), `vrml97FieldsExamined` the
    // VRML97 interface alone, which is the only one clause 4 and clause 6 speak
    // about. A facet that collapses to zero because the ISO source changed shape
    // is a test failure, not a quiet loss.
    fieldsExamined: 0,
    vrml97FieldsExamined: 0,
    fieldsWithConstraints: 0,
    fieldsWithNumericMin: 0,
    fieldsWithNumericMax: 0,
    fieldsWithSymbolicMin: 0,
    fieldsWithSymbolicMax: 0,
    fieldsWithInclusiveMin: 0,
    fieldsWithExclusiveMin: 0,
    fieldsWithInclusiveMax: 0,
    fieldsWithExclusiveMax: 0,
    fieldsWithAllowedValues: 0,
    fieldsWithAcceptedNodeTypes: 0,
    fieldsWithAcceptedNodeClasses: 0,
    nodeValuedVrml97Fields: 0,
    fieldsWithConstraintNote: 0,
    nodeClasses: 0,
    nodeClassMemberships: 0,
  };
  const notes = {
    vrml97Only: [], accessTypePromotions: [], uncertainDefaults: [],
    missingProxies: [], unresolvedFields: [], constraintNotes: {},
  };
  const schema = {};

  for (const node of iso.nodes) {
    const xiteFields = xite.byNode.get(node.name);
    if (!xiteFields) { notes.missingProxies.push(node.name); }
    const remaining = new Map((xiteFields || []).map((f) => [f.name, f]));
    counts.xiteFields += (xiteFields || []).length;

    const fields = {};
    for (const f of node.fields) {
      counts.isoDeclarations += 1;
      const accessType = ACCESS_BY_DECLARATION[f.declaration];
      const match = remaining.get(f.name);
      if (match) {
        remaining.delete(f.name);
        counts.shared += 1;
        if (match.type && match.type !== f.type) {
          fail(`${node.name}.${f.name}: ISO type ${f.type} conflicts with x_ite type ${match.type}`);
        }
        if (match.accessType && match.accessType !== accessType) {
          counts.accessTypePromotions += 1;
          notes.accessTypePromotions.push(`${node.name}.${f.name}: VRML97 ${f.declaration} (${accessType}) -> X3D ${match.accessType}`);
        }
      } else {
        counts.vrml97Only += 1;
        notes.vrml97Only.push(`${node.name}.${f.name}`);
      }

      const normalized = normalizeDefault(f.type, f.defaultText);
      if (normalized.uncertain) {
        counts.uncertainDefaults += 1;
        notes.uncertainDefaults.push(`${node.name}.${f.name} (${f.type}) = ${JSON.stringify(f.defaultText)}`);
      }

      const record = {
        type: f.type,
        accessType,
        vrml97Declaration: f.declaration,
        profiles: match ? ['vrml97', 'x3d'] : ['vrml97'],
        order: f.order,
      };
      if (match && match.accessType && match.accessType !== accessType) record.x3dAccessType = match.accessType;
      if (f.defaultText !== null) {
        record.defaultText = f.defaultText;
        if ('value' in normalized) record.defaultValue = normalized.value;
        else record.defaultUncertain = true;
      }

      // WD1.6-A. `null` means NO MACHINE-REPRESENTED CONSTRAINT IS AVAILABLE --
      // never "the standard permits anything here".
      const constraints = buildConstraints(`${node.name}.${f.name}`, f);
      record.constraints = constraints;
      counts.vrml97FieldsExamined += 1;
      if (f.type === 'SFNode' || f.type === 'MFNode') counts.nodeValuedVrml97Fields += 1;
      if (constraints) {
        counts.fieldsWithConstraints += 1;
        if ('min' in constraints) counts.fieldsWithNumericMin += 1;
        if ('max' in constraints) counts.fieldsWithNumericMax += 1;
        if ('minSymbolic' in constraints) counts.fieldsWithSymbolicMin += 1;
        if ('maxSymbolic' in constraints) counts.fieldsWithSymbolicMax += 1;
        if (constraints.minInclusive === true) counts.fieldsWithInclusiveMin += 1;
        if (constraints.minInclusive === false) counts.fieldsWithExclusiveMin += 1;
        if (constraints.maxInclusive === true) counts.fieldsWithInclusiveMax += 1;
        if (constraints.maxInclusive === false) counts.fieldsWithExclusiveMax += 1;
        if (constraints.allowedValues) counts.fieldsWithAllowedValues += 1;
        if (constraints.acceptedNodeTypes) counts.fieldsWithAcceptedNodeTypes += 1;
        if (constraints.acceptedNodeClasses) counts.fieldsWithAcceptedNodeClasses += 1;
        if (constraints.note) {
          counts.fieldsWithConstraintNote += 1;
          const bucket = notes.constraintNotes[constraints.note.category] || [];
          bucket.push(`${node.name}.${f.name} -- ${constraints.note.source}`);
          notes.constraintNotes[constraints.note.category] = bucket;
        }
      }
      fields[f.name] = record;
    }

    // Whatever x_ite still has for this node exists in X3D but not in VRML97.
    for (const [name, f] of remaining) {
      counts.x3dOnly += 1;
      if (!f.accessType || !f.type) { counts.unresolved += 1; notes.unresolvedFields.push(`${node.name}.${name}`); }
      // An X3D-only field has no clause 4 or clause 6 statement about it, so it
      // gets no constraint metadata -- ever. This is what keeps an X3D fact out
      // of the VRML97 projection.
      fields[name] = {
        type: f.type,
        accessType: f.accessType,
        vrml97Declaration: null,
        profiles: ['x3d'],
        order: null,
        constraints: null,
      };
    }

    // Membership in the ten clause 4 enumerations. Complete FOR THOSE TEN: an
    // empty array is the positive fact "in none of them", not missing data.
    // Classes overlap freely -- Anchor is in four.
    const classes = Object.values(iso.nodeClasses)
      .filter((c) => c.members.includes(node.name)).map((c) => c.id).sort();
    counts.nodeClassMemberships += classes.length;

    schema[node.name] = {
      name: node.name,
      section: node.section,
      profiles: ['vrml97', 'x3d'],
      classes,
      fields,
    };
  }

  counts.nodeClasses = Object.keys(iso.nodeClasses).length;
  for (const node of Object.values(schema)) counts.fieldsExamined += Object.keys(node.fields).length;

  if (counts.unresolved) {
    fail(`${counts.unresolved} x_ite field(s) lack an access type or type; refusing to emit: `
      + notes.unresolvedFields.join(', '));
  }
  if (notes.missingProxies.length) {
    fail(`no x_ite proxy interface for: ${notes.missingProxies.join(', ')}`);
  }
  return { schema, counts, notes };
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------
//
// Byte-for-byte determinism: every object is emitted with SORTED keys, nodes and
// fields in ASCII order (never locale collation), LF line endings, and no clock
// reading anywhere. Provenance is recorded as input CHECKSUMS rather than a
// generation timestamp, so regenerating from unchanged inputs is a no-op diff.

// Fixed key order for emitted records. One list serves both shapes: a node
// record starts at `name`, a field record at `type`, and neither ever holds a
// key belonging only to the other. Keys outside the list sort alphabetically
// after it, so a future addition is still deterministic.
const ORDER = ['name', 'section', 'type', 'accessType', 'vrml97Declaration', 'x3dAccessType',
  'profiles', 'order', 'defaultText', 'defaultValue', 'defaultUncertain', 'constraints',
  'classes', 'fields'];

function literal(value, indent) {
  const pad = '  '.repeat(indent);
  const inner = '  '.repeat(indent + 1);
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const flat = value.every((v) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean');
    if (flat) return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    return `[\n${value.map((v) => inner + literal(v, indent + 1)).join(',\n')},\n${pad}]`;
  }
  // Emitted in INSERTION order. Ordering is decided by the callers below
  // (`orderRecord` / `sortPlain` / `sortDeep`), never here -- a key-preference
  // list applied indiscriminately would also reorder a FIELD MAP that happens to
  // contain a field literally named `type` (NavigationInfo has one).
  const keys = Object.keys(value);
  if (!keys.length) return '{}';
  const parts = keys.map((k) => `${inner}${/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k)}: ${literal(value[k], indent + 1)}`);
  return `{\n${parts.join(',\n')},\n${pad}}`;
}

// ASCII order, explicitly NOT localeCompare -- collation is locale-sensitive and
// would make the output depend on the generating machine's environment.
const asciiSort = (keys) => [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

// A RECORD's keys go in the fixed ORDER above; anything unlisted follows in
// ASCII order so a future field stays deterministic.
function orderRecord(record) {
  const keys = [...Object.keys(record)].sort((a, b) => {
    const ai = ORDER.indexOf(a); const bi = ORDER.indexOf(b);
    if (ai !== bi) return (ai < 0 ? ORDER.length : ai) - (bi < 0 ? ORDER.length : bi);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const out = {};
  for (const k of keys) out[k] = record[k];
  return out;
}

// A plain MAP's keys go in ASCII order, recursively.
function sortPlain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = {};
  for (const k of asciiSort(Object.keys(value))) out[k] = sortPlain(value[k]);
  return out;
}

// Nodes and field names sort as maps; the records inside them use ORDER.
function sortDeep(schema) {
  const out = {};
  for (const nodeName of asciiSort(Object.keys(schema))) {
    const node = schema[nodeName];
    const fields = {};
    for (const fieldName of asciiSort(Object.keys(node.fields))) {
      fields[fieldName] = orderRecord(node.fields[fieldName]);
    }
    out[nodeName] = orderRecord({ ...node, fields });
  }
  return out;
}

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

function render({ schema, counts, provenance, nodeClasses }) {
  const data = literal(sortDeep(schema), 0);
  const classes = literal(sortPlain(nodeClasses), 0);
  const meta = literal(sortPlain(provenance), 0);
  const stats = literal(sortPlain(counts), 0);
  return `'use strict';
// GENERATED FILE -- DO NOT EDIT BY HAND.
//
// Regenerate with:
//
//     node scripts/build-node-schema.js
//
// Verify the committed copy is current with:
//
//     node scripts/build-node-schema.js --check
//
// Phases WD1.3 and WD1.6-A. A machine-readable inventory of the VRML97 node and
// field interface, tagged so a strict-VRML97 consumer can never be handed an
// X3D-only field by accident, plus the standards-derived semantic metadata a
// scene tree, inspector or diagnostic layer needs: node classes, accepted node
// types per node-valued field, and field value ranges.
//
// READ THIS BEFORE USING \`constraints\`: a \`null\` means NO MACHINE-REPRESENTED
// CONSTRAINT IS AVAILABLE. It does NOT mean the field is unrestricted, and
// nothing may be clamped or rejected on the strength of it. A present record is
// not exhaustive either -- a \`note\` marks a normative restriction that this
// shape cannot carry. This is metadata for consumers to reason with, not a
// validator.
//
// SOURCES (both license-clean; see OPEN_SOURCE_PROVENANCE.md)
//   * ISO/IEC 14772-1 (VRML97), clause 6 node reference -- NORMATIVE for the
//     VRML97 node set, field names, field types, declaration categories,
//     default values and field value ranges.
//   * ISO/IEC 14772-1 (VRML97), clause 4 concepts -- NORMATIVE for the node
//     class enumerations and for Table 4.3, the valid node types of each SFNode
//     and MFNode field.
//   * x_ite.d.ts from the MIT-licensed x_ite package already depended on by this
//     repository -- the current X3D runtime shape, used to tag which fields are
//     X3D-only.
//
// NO WHITE DUNE MATERIAL WAS USED -- a provenance fact about this generated
// file: no White Dune source, node table, fixture, or algorithm contributed to
// it, directly or indirectly. WRL Forge is GPL-3.0-or-later and GPL-compatible
// reuse is permitted project-wide (OPEN_SOURCE_PROVENANCE.md); this schema is
// simply derived from the two standards sources above and nothing else.
//
// This file contains extracted interface FACTS -- names, types, access
// categories, default literals. It reproduces no standards prose.
//
// DETERMINISM: no generation timestamp is recorded, deliberately. Provenance is
// the checksums of the exact inputs (see PROVENANCE below), so regenerating from
// unchanged sources produces a byte-identical file and an empty diff. Nodes,
// fields, and object keys are emitted in a fixed order; line endings are LF.

// Measured at generation time from the sources below -- not carried over from
// any earlier estimate.
const COUNTS = ${stats};

const PROVENANCE = ${meta};

const NODES = ${data};

// WD1.6-A. The enumerated node classes of ISO/IEC 14772-1 clause 4, each with
// the clause it is stated in and its members in the order the standard lists
// them. Semantic classes, NOT a node palette: no "Common", no "Geometry"
// grouping invented for a UI, and a node may be in none, one or several.
//
// Complete for the ten enumerations the standard introduces with the words "The
// following node types are". Other normative groupings exist that are written as
// running prose in other shapes -- drag sensors (4.6.7.4), time-dependent nodes
// (4.6.9), bindable children nodes (4.6.10) -- and are deliberately NOT here:
// each would need its own English-sentence parser. A node's \`classes\` array
// therefore means "in none of THESE ten", not "in no normative class at all".
const NODE_CLASSES = ${classes};

// How each constraint fact was obtained, so a reviewer can trace any single
// value back to the structure it came from. A field's constraints record cites
// these by id in its \`rules\` array.
const CONSTRAINT_RULES = {
  'declaration-range': {
    standard: 'ISO/IEC 14772-1',
    clause: '4.1.3',
    source: 'raw/part1/nodesRef.html',
    description: "the '#' value-range annotation on a clause 6 field declaration",
  },
  'table-4.3': {
    standard: 'ISO/IEC 14772-1',
    clause: '4.6.5',
    source: 'raw/part1/concepts.html',
    description: 'Table 4.3, "Nodes with SFNode or MFNode fields"',
  },
  'clause-6-sentence': {
    standard: 'ISO/IEC 14772-1',
    clause: '6',
    source: 'raw/part1/nodesRef.html',
    description: 'an exact normative sentence template naming the node type a field shall contain',
  },
};

// Categories for a constraint the standard states but this schema shape cannot
// carry. A note is a POSITIVE statement that a normative restriction exists and
// is not represented -- unlike \`constraints: null\`, and unlike any claim that
// the field is unrestricted.
const CONSTRAINT_NOTES = [
  'BOUND_IS_SYMBOLIC',
  'PER_COMPONENT_RANGE',
  'DISJUNCTIVE_RANGE',
  'NON_MACHINE_EXTRACTABLE',
];

const PROFILES = ['vrml97', 'x3d'];

// Deep-freeze the whole tree once at load. The schema is shared, process-wide,
// read-only truth: a consumer that mutated a field record would silently corrupt
// every later reader. Freezing is done here rather than by emitting frozen
// literals so the data above stays readable and diffable.
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

deepFreeze(NODES);
deepFreeze(COUNTS);
deepFreeze(PROVENANCE);
deepFreeze(NODE_CLASSES);
deepFreeze(CONSTRAINT_RULES);
Object.freeze(PROFILES);
Object.freeze(CONSTRAINT_NOTES);

const NODE_NAMES = Object.freeze(Object.keys(NODES));
const NODE_CLASS_NAMES = Object.freeze(Object.keys(NODE_CLASSES));
const EMPTY = Object.freeze([]);

function checkProfile(profile) {
  if (profile === undefined || profile === null) return null;
  if (!PROFILES.includes(profile)) {
    const err = new Error(\`unknown profile \${JSON.stringify(profile)}; expected one of \${PROFILES.join(', ')}\`);
    err.code = 'ESCHEMAPROFILE';
    throw err;
  }
  return profile;
}

const inProfile = (record, profile) => profile === null || record.profiles.includes(profile);

/**
 * The schema record for a node, or null when the name is not a standard node.
 *
 * Lookups return null for an unknown name rather than throwing -- an unknown
 * node is an ordinary fact about a document (a PROTO, a vendor extension), not
 * a programming error. An unknown PROFILE does throw (code ESCHEMAPROFILE),
 * because that can only be a caller bug and silently answering as if it were
 * X3D would defeat the point of the tagging.
 *
 * @param {string} name Node name, case-sensitive as VRML97 is.
 * @returns {object|null} Frozen; never mutate it.
 */
function getNodeSchema(name) {
  return Object.prototype.hasOwnProperty.call(NODES, name) ? NODES[name] : null;
}

/**
 * The schema record for one field of one node, or null if either is unknown.
 *
 * @param {string} nodeName
 * @param {string} fieldName
 * @returns {object|null} Frozen; never mutate it.
 */
function getFieldSchema(nodeName, fieldName) {
  const node = getNodeSchema(nodeName);
  if (!node) return null;
  return Object.prototype.hasOwnProperty.call(node.fields, fieldName) ? node.fields[fieldName] : null;
}

/**
 * Every standard node name, ASCII-sorted.
 *
 * @param {object} [options]
 * @param {'vrml97'|'x3d'} [options.profile] Restrict to nodes in that profile.
 * @returns {string[]} A fresh array; the caller may sort or splice it freely.
 */
function listNodeNames(options = {}) {
  const profile = checkProfile(options.profile);
  return NODE_NAMES.filter((name) => inProfile(NODES[name], profile));
}

/**
 * Every field name of a node, ASCII-sorted.
 *
 * @param {string} nodeName
 * @param {object} [options]
 * @param {'vrml97'|'x3d'} [options.profile] Restrict to fields in that profile.
 *   \`'vrml97'\` is the strict filter: X3D-only fields are excluded.
 * @returns {string[]} A fresh array; empty for an unknown node.
 */
function listFields(nodeName, options = {}) {
  const profile = checkProfile(options.profile);
  const node = getNodeSchema(nodeName);
  if (!node) return [];
  return Object.keys(node.fields).filter((f) => inProfile(node.fields[f], profile));
}

/**
 * Is this field legal on this node in this profile?
 *
 * The one call a writer should make before emitting a field: with
 * \`profile: 'vrml97'\` it is false for every X3D-only field, which is what stops
 * an X3D field leaking into a VRML97 document.
 *
 * @param {string} nodeName
 * @param {string} fieldName
 * @param {'vrml97'|'x3d'} [profile] Omit to ask "is it known at all".
 * @returns {boolean}
 */
function isFieldAllowed(nodeName, fieldName, profile) {
  const field = getFieldSchema(nodeName, fieldName);
  if (!field) return false;
  return inProfile(field, checkProfile(profile));
}

/**
 * Is this a standard VRML97 node?
 *
 * @param {string} name
 * @returns {boolean}
 */
function isVRML97Node(name) {
  const node = getNodeSchema(name);
  return !!node && node.profiles.includes('vrml97');
}

/**
 * Is this field part of the node's VRML97 interface (as opposed to X3D-only)?
 *
 * @param {string} nodeName
 * @param {string} fieldName
 * @returns {boolean}
 */
function isVRML97Field(nodeName, fieldName) {
  return isFieldAllowed(nodeName, fieldName, 'vrml97');
}

/**
 * The clause 4 node classes a node belongs to, ASCII-sorted.
 *
 * An empty array is a POSITIVE answer -- "in none of the ten enumerated classes"
 * -- for a known node, and the same empty array is all an unknown name gets. Ask
 * getNodeSchema() first if the difference matters.
 *
 * @param {string} name
 * @returns {string[]} Frozen; shared, never mutate it.
 */
function getNodeClasses(name) {
  const node = getNodeSchema(name);
  return node ? node.classes : EMPTY;
}

/**
 * The node names in one clause 4 class, in the order the standard lists them,
 * or an empty array for an unknown class id.
 *
 * @param {string} classId One of NODE_CLASS_NAMES.
 * @returns {string[]} Frozen; shared, never mutate it.
 */
function listNodesInClass(classId) {
  const record = Object.prototype.hasOwnProperty.call(NODE_CLASSES, classId) ? NODE_CLASSES[classId] : null;
  return record ? record.members : EMPTY;
}

/**
 * The standards-derived constraint metadata for one field, or \`null\`.
 *
 * \`null\` means NO MACHINE-REPRESENTED CONSTRAINT IS AVAILABLE. It does NOT mean
 * the field is unrestricted, that a value was validated, or that the standard
 * permits anything -- an unknown node and a field ISO says nothing extractable
 * about answer identically. **Do not clamp or reject a value on the strength of
 * a null**, and do not treat a present record as exhaustive: a \`note\` says a
 * further normative restriction exists that this shape cannot carry.
 *
 * Never populated for an X3D-only field.
 *
 * @param {string} nodeName
 * @param {string} fieldName
 * @returns {object|null} Frozen; never mutate it.
 */
function getFieldConstraints(nodeName, fieldName) {
  const field = getFieldSchema(nodeName, fieldName);
  return field ? field.constraints : null;
}

module.exports = {
  nodes: NODES,
  counts: COUNTS,
  provenance: PROVENANCE,
  profiles: PROFILES,
  nodeClasses: NODE_CLASSES,
  nodeClassNames: NODE_CLASS_NAMES,
  constraintRules: CONSTRAINT_RULES,
  constraintNotes: CONSTRAINT_NOTES,
  getNodeSchema,
  getFieldSchema,
  listNodeNames,
  listFields,
  isFieldAllowed,
  isVRML97Node,
  isVRML97Field,
  getNodeClasses,
  listNodesInClass,
  getFieldConstraints,
};
`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/build-node-schema.js [options]

Regenerates src/vrml/node-schema.js from ISO/IEC 14772-1 and the MIT-licensed
x_ite typings. Maintainer tool -- normal installs, tests and builds use the
committed output and do NOT need the ISO mirror.

Options:
  --iso <dir>    ISO/IEC 14772 mirror root (the directory holding raw/part1/).
                 Defaults to ../wb-ct-scrape/specs/iso-14772-vrml97 relative to
                 the repository, or $WRL_FORGE_ISO_MIRROR when set.
  --out <file>   Output path. Defaults to src/vrml/node-schema.js.
  --check        Do not write; exit non-zero if the committed file is out of date.
  --help         Show this message.
`;

function resolveIsoDir(explicit) {
  // A path the caller NAMED -- via --iso or WRL_FORGE_ISO_MIRROR -- never falls
  // back to the built-in guess. Quietly generating from a different mirror than
  // the one asked for is exactly the sort of helpfulness that produces a schema
  // nobody can account for.
  const hasMirror = (dir) => fs.existsSync(path.join(dir, NODE_REF)) && fs.existsSync(path.join(dir, CONCEPTS_REF));
  const named = explicit || process.env.WRL_FORGE_ISO_MIRROR;
  if (named) {
    if (hasMirror(named)) return path.resolve(named);
    fail(`no ISO mirror found at the path given (${NODE_REF} is missing under it): ${named}`);
  }
  const candidates = [...DEFAULT_ISO_DIRS];
  for (const dir of candidates) {
    if (hasMirror(dir)) return path.resolve(dir);
  }
  fail(`no ISO mirror found (looked for ${NODE_REF} under: ${candidates.join(', ')}).\n`
    + '  Pass --iso <dir>, or set WRL_FORGE_ISO_MIRROR.\n'
    + '  This tool is maintainer-only; the committed schema needs no mirror.');
  return null;
}

function parseArgs(argv) {
  const args = { check: false, help: false, iso: null, out: OUT_FILE };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--iso') { args.iso = argv[++i]; }
    else if (a === '--out') { args.out = path.resolve(argv[++i]); }
    else if (a.startsWith('--iso=')) args.iso = a.slice(6);
    else if (a.startsWith('--out=')) args.out = path.resolve(a.slice(6));
    else fail(`unknown argument ${JSON.stringify(a)} (try --help)`);
  }
  return args;
}

function generate(isoDir) {
  const iso = extractIso(isoDir);
  const xite = extractXite(XITE_DTS);
  const { schema, counts, notes } = build(iso, xite);
  counts.scriptTemplatesExcluded = iso.report.templates.length;

  const provenance = {
    generator: 'scripts/build-node-schema.js',
    generatorVersion: GENERATOR_VERSION,
    // Identities only -- never absolute paths from the generating machine.
    isoSource: {
      standard: 'ISO/IEC 14772-1 (VRML97)',
      file: NODE_REF.split(path.sep).join('/'),
      sha256: sha256(iso.html),
    },
    isoConceptsSource: {
      standard: 'ISO/IEC 14772-1 (VRML97)',
      file: CONCEPTS_REF.split(path.sep).join('/'),
      sha256: sha256(iso.conceptsHtml),
    },
    xiteSource: {
      package: 'x_ite',
      version: xite.version,
      file: 'dist/x_ite.d.ts',
      sha256: sha256(xite.source),
    },
    whiteDuneUsed: false,
  };

  return {
    text: render({ schema, counts, provenance, nodeClasses: iso.nodeClasses }),
    counts,
    notes,
    nodeClasses: iso.nodeClasses,
    proseReport: iso.proseReport,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(USAGE); return; }

  const isoDir = resolveIsoDir(args.iso);
  const { text, counts, notes, nodeClasses, proseReport } = generate(isoDir);

  const summary = [
    `nodes                  ${counts.nodes}`,
    `ISO declarations       ${counts.isoDeclarations}`,
    `x_ite fields           ${counts.xiteFields}`,
    `shared                 ${counts.shared}`,
    `VRML97-only            ${counts.vrml97Only}${notes.vrml97Only.length ? `  (${notes.vrml97Only.join(', ')})` : ''}`,
    `X3D-only               ${counts.x3dOnly}`,
    `unresolved             ${counts.unresolved}`,
    `access-type promotions ${counts.accessTypePromotions}`,
    `uncertain defaults     ${counts.uncertainDefaults}`,
    `Script templates       ${counts.scriptTemplatesExcluded} (excluded: not fields)`,
    '',
    `node classes           ${counts.nodeClasses}`,
    ...Object.values(nodeClasses).map((c) => `  ${c.id.padEnd(36)} ${String(c.members.length).padStart(2)}  (${c.section}, ${c.form})`),
    `class memberships      ${counts.nodeClassMemberships} across ${counts.nodes} nodes`,
    '',
    `fields examined        ${counts.fieldsExamined} (${counts.vrml97FieldsExamined} VRML97, ${counts.fieldsExamined - counts.vrml97FieldsExamined} X3D-only)`,
    `with constraints       ${counts.fieldsWithConstraints} / ${counts.vrml97FieldsExamined} VRML97`,
    `  numeric min          ${counts.fieldsWithNumericMin} / ${counts.vrml97FieldsExamined}`,
    `  numeric max          ${counts.fieldsWithNumericMax} / ${counts.vrml97FieldsExamined}`,
    `  symbolic min         ${counts.fieldsWithSymbolicMin} / ${counts.vrml97FieldsExamined}`,
    `  symbolic max         ${counts.fieldsWithSymbolicMax} / ${counts.vrml97FieldsExamined}`,
    `  inclusive/exclusive  min ${counts.fieldsWithInclusiveMin}/${counts.fieldsWithExclusiveMin}, max ${counts.fieldsWithInclusiveMax}/${counts.fieldsWithExclusiveMax}`,
    `  allowed values       ${counts.fieldsWithAllowedValues} / ${counts.vrml97FieldsExamined}`,
    `  accepted node types  ${counts.fieldsWithAcceptedNodeTypes} / ${counts.nodeValuedVrml97Fields} node-valued`,
    `  accepted node classes ${counts.fieldsWithAcceptedNodeClasses} / ${counts.nodeValuedVrml97Fields} node-valued`,
    `  notes                ${counts.fieldsWithConstraintNote} / ${counts.vrml97FieldsExamined}`,
    ...Object.keys(notes.constraintNotes).sort().map((k) => `    ${k.padEnd(26)} ${notes.constraintNotes[k].length}`),
    ...(proseReport.proseOnly.length ? ['', `clause-6-only accepted: ${proseReport.proseOnly.join(', ')}`] : []),
    ...(proseReport.disagreements.length ? [`clause-6 disagreements: ${proseReport.disagreements.join('; ')}`] : []),
  ].join('\n  ');
  process.stdout.write(`build-node-schema:\n  ${summary}\n`);

  const existing = fs.existsSync(args.out) ? fs.readFileSync(args.out, 'utf8') : null;
  if (args.check) {
    if (existing === text) { process.stdout.write(`  ${path.relative(REPO, args.out)} is up to date\n`); return; }
    process.stderr.write(`build-node-schema: ${path.relative(REPO, args.out)} is OUT OF DATE; run without --check\n`);
    process.exitCode = 1;
    return;
  }
  if (existing === text) { process.stdout.write(`  ${path.relative(REPO, args.out)} unchanged\n`); return; }
  fs.writeFileSync(args.out, text);
  process.stdout.write(`  wrote ${path.relative(REPO, args.out)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  generate, resolveIsoDir, normalizeDefault, parseRange, buildConstraints,
  ACCESS_BY_DECLARATION, NODE_REF, CONCEPTS_REF, NODE_CLASS_IDS,
};
