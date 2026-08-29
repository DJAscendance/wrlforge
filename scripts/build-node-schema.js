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
//      their field types, their declaration categories, and their defaults.
//   2. `x_ite.d.ts` from the MIT-licensed `x_ite` package already in this repo's
//      dependency tree. Supplies the CURRENT X3D runtime shape, and by
//      subtraction identifies fields that exist in X3D but NOT in VRML97.
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

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const OUT_FILE = path.join(REPO, 'src', 'vrml', 'node-schema.js');
const XITE_DTS = path.join(REPO, 'node_modules', 'x_ite', 'dist', 'x_ite.d.ts');

// Bump when the OUTPUT SHAPE changes (not for a source-data refresh). Recorded
// in the generated file so a stale schema is identifiable from the file alone.
const GENERATOR_VERSION = '1.0.0';

// Where the ISO mirror usually sits relative to this repo. Overridable; never
// baked into the generated output.
const DEFAULT_ISO_DIRS = [
  path.join(REPO, '..', 'wb-ct-scrape', 'specs', 'iso-14772-vrml97'),
];

const NODE_REF = path.join('raw', 'part1', 'nodesRef.html');

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
    blockHtml
      .replace(/<IMG[^>]*>/gi, '')
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

    const field = { name, type, declaration, defaultText, order: fields.length };
    fields.push(field);
    previous = field;
  }

  return fields;
}

const isBalanced = (text) => (text.match(/\[/g) || []).length === (text.match(/\]/g) || []).length;

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

  return { nodes, report, sourcePath: nodeRefPath, html };
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
  };
  const notes = {
    vrml97Only: [], accessTypePromotions: [], uncertainDefaults: [],
    missingProxies: [], unresolvedFields: [],
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
      fields[f.name] = record;
    }

    // Whatever x_ite still has for this node exists in X3D but not in VRML97.
    for (const [name, f] of remaining) {
      counts.x3dOnly += 1;
      if (!f.accessType || !f.type) { counts.unresolved += 1; notes.unresolvedFields.push(`${node.name}.${name}`); }
      fields[name] = {
        type: f.type,
        accessType: f.accessType,
        vrml97Declaration: null,
        profiles: ['x3d'],
        order: null,
      };
    }

    schema[node.name] = {
      name: node.name,
      section: node.section,
      profiles: ['vrml97', 'x3d'],
      fields,
    };
  }

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
  'profiles', 'order', 'defaultText', 'defaultValue', 'defaultUncertain', 'fields'];

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

function render({ schema, counts, provenance }) {
  const data = literal(sortDeep(schema), 0);
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
// Phase WD1.3. A machine-readable inventory of the VRML97 node and field
// interface, tagged so a strict-VRML97 consumer can never be handed an X3D-only
// field by accident.
//
// SOURCES (both license-clean; see OPEN_SOURCE_PROVENANCE.md)
//   * ISO/IEC 14772-1 (VRML97), clause 6 node reference -- NORMATIVE for the
//     VRML97 node set, field names, field types, declaration categories, and
//     default values.
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
Object.freeze(PROFILES);

const NODE_NAMES = Object.freeze(Object.keys(NODES));

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

module.exports = {
  nodes: NODES,
  counts: COUNTS,
  provenance: PROVENANCE,
  profiles: PROFILES,
  getNodeSchema,
  getFieldSchema,
  listNodeNames,
  listFields,
  isFieldAllowed,
  isVRML97Node,
  isVRML97Field,
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
  const named = explicit || process.env.WRL_FORGE_ISO_MIRROR;
  if (named) {
    if (fs.existsSync(path.join(named, NODE_REF))) return path.resolve(named);
    fail(`no ISO mirror found at the path given (${NODE_REF} is missing under it): ${named}`);
  }
  const candidates = [...DEFAULT_ISO_DIRS];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, NODE_REF))) return path.resolve(dir);
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
    xiteSource: {
      package: 'x_ite',
      version: xite.version,
      file: 'dist/x_ite.d.ts',
      sha256: sha256(xite.source),
    },
    whiteDuneUsed: false,
  };

  return { text: render({ schema, counts, provenance }), counts, notes };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(USAGE); return; }

  const isoDir = resolveIsoDir(args.iso);
  const { text, counts, notes } = generate(isoDir);

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

module.exports = { generate, resolveIsoDir, normalizeDefault, ACCESS_BY_DECLARATION, NODE_REF };
