'use strict';
// WD1.4 spike -- deterministic node selection and edit-scenario generation.
//
// THROWAWAY PROTOTYPE.
//
// Every scenario is generated from the ORIGINAL parse and carries, alongside its
// edit set, an EXPECTATION computed by this module's own per-scenario
// arithmetic:
//
//   expectation.kind === 'preserved' -> { start, end, text }  the exact span and
//       exact source text the selected node must occupy after the edits
//   expectation.kind === 'deleted'   -> the selected node's text was removed;
//       any node a strategy returns is a wrong anchor
//
// The expectation is deliberately NOT computed with src/vrml/edit.js's
// `mapOffset`/`mapRange`. Strategy D uses that mapping, so reusing it here would
// make D correct by construction. Instead each scenario knows where it put its
// own edits and computes the resulting span by direct arithmetic
// (`classifyEdits` below), and the oracle then re-verifies that expectation
// against the reparsed text before trusting it.
//
// Determinism: node selection is by explicit category-then-stride rules over a
// source-ordered index. There is no randomness anywhere in this file.

const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { NODE, walk } = require(path.join(REPO_ROOT, 'src', 'vrml', 'ast.js'));
const nodeSchema = require(path.join(REPO_ROOT, 'src', 'vrml', 'node-schema.js'));
const { VRML97_NODE_TYPES } = require('./corpus');

// ---------------------------------------------------------------------------
// Local, dependency-free splicing
// ---------------------------------------------------------------------------
//
// Used only to render an expected node text. Kept local (rather than calling
// edit.applyEdits) so the expectation shares no code path with the candidate
// strategies -- see the independence note above.
function spliceAll(text, edits) {
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
  let out = '';
  let cursor = 0;
  for (const e of sorted) {
    out += text.slice(cursor, e.from) + e.insert;
    cursor = e.to;
  }
  return out + text.slice(cursor);
}

// ---------------------------------------------------------------------------
// Edit classification -- the whole expectation model
// ---------------------------------------------------------------------------
//
// Relative to the selected node's half-open span [s, e):
//
//   before   edit.to   <= s     (an insertion AT s counts here: the inserted
//                                text lands in front of the node, pushing it right)
//   after    edit.from >= e     (an insertion AT e lands behind the node)
//   inside   s < edit.from and edit.to < e   (strictly interior)
//   covering edit.from <= s and edit.to >= e and it is not an insertion
//   straddling  anything else -- the scenario is dropped rather than guessed at
function classifyEdits(edits, s, e) {
  let beforeDelta = 0;
  let insideDelta = 0;
  const inside = [];
  for (const ed of edits) {
    const isInsertion = ed.from === ed.to;
    const delta = ed.insert.length - (ed.to - ed.from);
    if (ed.to <= s) { beforeDelta += delta; continue; }
    if (ed.from >= e) { continue; }
    if (ed.from > s && ed.to < e) { insideDelta += delta; inside.push(ed); continue; }
    if (!isInsertion && ed.from <= s && ed.to >= e) return { kind: 'deleted' };
    return { kind: 'straddling' };
  }
  return { kind: 'preserved', beforeDelta, insideDelta, inside };
}

function buildExpectation(text, edits, s, e) {
  const cls = classifyEdits(edits, s, e);
  if (cls.kind !== 'preserved') return { kind: cls.kind };
  const rebased = cls.inside.map((ed) => ({ from: ed.from - s, to: ed.to - s, insert: ed.insert }));
  return {
    kind: 'preserved',
    start: s + cls.beforeDelta,
    end: e + cls.beforeDelta + cls.insideDelta,
    text: spliceAll(text.slice(s, e), rebased),
  };
}

// ---------------------------------------------------------------------------
// Document facts the scenarios need
// ---------------------------------------------------------------------------

/**
 * Collect the AST facts scenario construction needs, in one walk: every Field
 * with its span, every NUMBER value with its span, every PROTO, and the
 * top-level statement spans.
 */
function documentFacts(parseResult) {
  const fields = [];
  const numbers = [];
  const protos = [];
  const protosInArray = [];
  const tree = parseResult.tree;
  if (!tree) return { fields, numbers, protos, protosInArray, statements: [] };

  walk(tree, (node, parent) => {
    if (node.type === NODE.FIELD && node.range) fields.push(node);
    else if (node.type === NODE.NUMBER && node.range && node.valid) numbers.push(node);
    else if (node.type === NODE.PROTO && node.range) {
      protos.push(node);
      if (parent && parent.type === NODE.ARRAY) protosInArray.push(node);
    }
  });
  const statements = (tree.statements || []).filter((s) => s && s.range);
  return { fields, numbers, protos, protosInArray, statements };
}

const spanOf = (n) => (n && n.range ? { start: n.range.start.offset, end: n.range.end.offset } : null);
const inside = (span, s, e) => span && span.start > s && span.end < e;

function fieldsInside(facts, s, e) {
  return facts.fields.filter((f) => inside(spanOf(f), s, e));
}

function numbersInside(facts, s, e) {
  return facts.numbers.filter((n) => inside(spanOf(n), s, e));
}

// ---------------------------------------------------------------------------
// Node selection
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { id: 'unique-def', test: (en, ix) => en.defName !== null && (ix.byDef.get(en.defName) || []).length === 1 },
  { id: 'duplicate-def', test: (en, ix) => en.defName !== null && (ix.byDef.get(en.defName) || []).length > 1 },
  { id: 'hyphen-def', test: (en) => en.defName !== null && en.defName.includes('-') },
  { id: 'anonymous', test: (en) => en.defName === null },
  { id: 'proto-scoped', test: (en) => en.scopeKey !== '' },
  { id: 'unknown-type', test: (en) => !VRML97_NODE_TYPES.has(en.nodeType) },
  { id: 'identical-siblings', test: (en, ix) => (ix.byFingerprint.get(en.fingerprint) || []).length > 1 },
  { id: 'array-member', test: (en) => en.path.length > 0 && en.path[en.path.length - 1].index !== null },
];

/**
 * Choose up to `limit` selected nodes from a file, deterministically.
 *
 * One representative per interesting category first (earliest in source order),
 * then stride-sampled fill-ins so ordinary nodes are represented too. The result
 * is source-ordered and de-duplicated.
 */
function selectNodes(index, limit) {
  const chosen = new Map();
  for (const cat of CATEGORIES) {
    if (chosen.size >= limit) break;
    for (const en of index.entries) {
      if (chosen.has(en.order)) continue;
      if (!cat.test(en, index)) continue;
      chosen.set(en.order, { entry: en, category: cat.id });
      break;
    }
  }
  if (index.entries.length > 0) {
    const stride = Math.max(1, Math.floor(index.entries.length / Math.max(1, limit)));
    for (let i = 0; i < index.entries.length && chosen.size < limit; i += stride) {
      const en = index.entries[i];
      if (!chosen.has(en.order)) chosen.set(en.order, { entry: en, category: 'stride' });
    }
  }
  return [...chosen.values()].sort((a, b) => a.entry.order - b.entry.order).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Scenario construction helpers
// ---------------------------------------------------------------------------

const mkEdit = (from, to, insert) => ({ from, to, insert });

// A syntactically valid, self-contained node to use as an inserted sibling.
const FILLER_NODE = 'WorldInfo { title "wd14-spike" }';

function siblingsOf(index, entry) {
  const p = entry.path;
  if (p.length === 0) return null;
  const last = p[p.length - 1];
  if (last.index === null) return null;
  const prefix = p.slice(0, -1).map((s) => `${s.key}${s.index === null ? '' : `[${s.index}]`}`).join('/');
  const peers = index.entries.filter((en) => {
    if (en.path.length !== p.length) return false;
    const ep = en.path[en.path.length - 1];
    if (ep.key !== last.key || ep.index === null) return false;
    const epr = en.path.slice(0, -1).map((s) => `${s.key}${s.index === null ? '' : `[${s.index}]`}`).join('/');
    return epr === prefix;
  }).sort((a, b) => a.path[a.path.length - 1].index - b.path[b.path.length - 1].index);
  const at = peers.findIndex((en) => en.order === entry.order);
  if (at === -1) return null;
  return { peers, at, prev: peers[at - 1] || null, next: peers[at + 1] || null };
}

// The top-level statement whose span encloses the selected node.
function enclosingStatement(facts, entry) {
  for (const stmt of facts.statements) {
    const sp = spanOf(stmt);
    if (sp && sp.start <= entry.start && sp.end >= entry.end) return sp;
  }
  return null;
}

// A different, valid number lexeme of a different length than `lexeme`.
function alternativeNumber(lexeme) {
  return lexeme.trim() === '7.25' ? '8.5' : '7.25';
}

// A writable VRML97 field of `nodeType` that the node does not already carry.
function unusedSchemaField(nodeType, presentNames) {
  const schema = nodeSchema.getNodeSchema(nodeType);
  if (!schema) return null;
  const names = Object.keys(schema.fields).sort();
  for (const name of names) {
    const f = schema.fields[name];
    if (presentNames.has(name)) continue;
    if (!f.profiles.includes('vrml97')) continue;
    if (f.vrml97Declaration !== 'field' && f.vrml97Declaration !== 'exposedField') continue;
    if (typeof f.defaultText !== 'string' || f.defaultText.length === 0) continue;
    if (f.type.endsWith('Node') || f.type.endsWith('String')) continue; // keep the inserted text simple
    return `${name} ${f.defaultText}`;
  }
  return null;
}

// A typed scalar field inside the node that the WD1.3 schema recognises, with a
// type-correct replacement value.
function typedFieldEdit(entry, facts) {
  const schema = nodeSchema.getNodeSchema(entry.nodeType);
  if (!schema) return null;
  for (const field of fieldsInside(facts, entry.start, entry.end)) {
    const f = schema.fields[field.name];
    if (!f || !f.profiles.includes('vrml97')) continue;
    const v = field.value;
    if (!v || !v.range) continue;
    const sp = spanOf(v);
    if (!inside(sp, entry.start, entry.end)) continue;
    const current = null;
    if (f.type === 'SFBool' && v.type === NODE.BOOL) {
      return { edit: mkEdit(sp.start, sp.end, v.value ? 'FALSE' : 'TRUE'), field: field.name, type: f.type, current };
    }
    if (f.type === 'SFFloat' && v.type === NODE.NUMBERS && v.values.length === 1) {
      return { edit: mkEdit(sp.start, sp.end, '0.625'), field: field.name, type: f.type, current };
    }
    if (f.type === 'SFVec3f' && v.type === NODE.NUMBERS && v.values.length === 3) {
      return { edit: mkEdit(sp.start, sp.end, '1.5 0 -3'), field: field.name, type: f.type, current };
    }
    if (f.type === 'SFColor' && v.type === NODE.NUMBERS && v.values.length === 3) {
      return { edit: mkEdit(sp.start, sp.end, '0.25 0.5 0.75'), field: field.name, type: f.type, current };
    }
  }
  return null;
}

// A named field's value span inside the node (used for translation/diffuseColor).
function namedFieldValueEdit(facts, entry, fieldName, replacement, arity) {
  for (const field of fieldsInside(facts, entry.start, entry.end)) {
    if (field.name !== fieldName) continue;
    const v = field.value;
    if (!v || v.type !== NODE.NUMBERS || v.values.length !== arity) continue;
    const sp = spanOf(v);
    if (!inside(sp, entry.start, entry.end)) continue;
    if (entry.text === replacement) continue;
    return mkEdit(sp.start, sp.end, replacement);
  }
  return null;
}

// The whitespace run immediately before the node.
function leadingWhitespaceSpan(text, start) {
  let i = start;
  while (i > 0 && /\s/.test(text[i - 1])) i -= 1;
  return i === start ? null : { start: i, end: start };
}

// ---------------------------------------------------------------------------
// The scenario table
// ---------------------------------------------------------------------------
//
// Every entry returns either null (not applicable to this file/node) or
// `{ edits, tags, expectationOverride? }`. Numbering matches the WD1.4 brief.

const SCENARIOS = [
  {
    id: 'S01-comment-before-statement',
    build: ({ facts, entry }) => {
      const stmt = enclosingStatement(facts, entry);
      if (!stmt) return null;
      return { edits: [mkEdit(stmt.start, stmt.start, '# wd1.4 spike comment\n')], tags: ['trivia'] };
    },
  },
  {
    id: 'S02-blank-lines-before-node',
    build: ({ entry }) => ({ edits: [mkEdit(entry.start, entry.start, '\n\n\n')], tags: ['trivia'] }),
  },
  {
    id: 'S03-change-trivia-before-node',
    build: ({ text, entry }) => {
      const ws = leadingWhitespaceSpan(text, entry.start);
      if (!ws) return null;
      const replacement = text.slice(ws.start, ws.end) === '\n\t' ? '\n  ' : '\n\t';
      return { edits: [mkEdit(ws.start, ws.end, replacement)], tags: ['trivia'] };
    },
  },
  {
    id: 'S04-change-numeric-scalar-inside',
    build: ({ facts, entry }) => {
      const nums = numbersInside(facts, entry.start, entry.end);
      if (nums.length === 0) return null;
      const n = nums[0];
      const sp = spanOf(n);
      return { edits: [mkEdit(sp.start, sp.end, alternativeNumber(n.lexeme))], tags: ['inside-value'] };
    },
  },
  {
    id: 'S05-change-translation-sfvec3f',
    build: ({ facts, entry }) => {
      const e = namedFieldValueEdit(facts, entry, 'translation', '1.5 0 -3', 3);
      return e ? { edits: [e], tags: ['inside-value', 'typed-field'] } : null;
    },
  },
  {
    id: 'S06-change-material-diffusecolor',
    build: ({ facts, entry }) => {
      const e = namedFieldValueEdit(facts, entry, 'diffuseColor', '0.25 0.5 0.75', 3);
      return e ? { edits: [e], tags: ['inside-value', 'typed-field'] } : null;
    },
  },
  {
    id: 'S07-change-schema-typed-field',
    build: ({ facts, entry }) => {
      const t = typedFieldEdit(entry, facts);
      return t ? { edits: [t.edit], tags: ['inside-value', 'typed-field', `type:${t.type}`] } : null;
    },
  },
  {
    id: 'S08-insert-field-into-node',
    build: ({ entry }) => {
      const node = entry.node;
      if (!node.fields.length) return null;
      const first = node.fields[0];
      if (!first.range) return null;
      const at = first.range.start.offset;
      if (!(at > entry.start && at < entry.end)) return null;
      const present = new Set(node.fields.map((f) => f.name));
      const decl = unusedSchemaField(entry.nodeType, present);
      if (!decl) return null;
      return { edits: [mkEdit(at, at, `${decl}\n  `)], tags: ['inside-structure'] };
    },
  },
  {
    id: 'S09-delete-field-from-node',
    build: ({ entry, facts }) => {
      const node = entry.node;
      if (node.fields.length < 2) return null;
      // Delete a LATER field: deleting the first would also be legal, but a
      // later one keeps the node's opening bytes untouched, which is what makes
      // this a clean "structure changed inside" case.
      const target = node.fields[node.fields.length - 1];
      const sp = spanOf(target);
      if (!inside(sp, entry.start, entry.end)) return null;
      if (fieldsInside(facts, sp.start, sp.end).length > 0) return null; // avoid nested-node fields
      return { edits: [mkEdit(sp.start, sp.end, '')], tags: ['inside-structure'] };
    },
  },
  {
    id: 'S10-insert-sibling-before',
    build: ({ index, entry }) => {
      const sib = siblingsOf(index, entry);
      if (!sib) return null;
      return { edits: [mkEdit(entry.start, entry.start, `${FILLER_NODE}\n`)], tags: ['sibling'] };
    },
  },
  {
    id: 'S11-insert-sibling-after',
    build: ({ index, entry }) => {
      const sib = siblingsOf(index, entry);
      if (!sib) return null;
      return { edits: [mkEdit(entry.end, entry.end, `\n${FILLER_NODE}`)], tags: ['sibling'] };
    },
  },
  {
    id: 'S12-delete-sibling-before',
    build: ({ index, entry }) => {
      const sib = siblingsOf(index, entry);
      if (!sib || !sib.prev) return null;
      if (sib.prev.end > entry.start) return null;
      return { edits: [mkEdit(sib.prev.start, sib.prev.end, '')], tags: ['sibling'] };
    },
  },
  {
    id: 'S13-delete-sibling-after',
    build: ({ index, entry }) => {
      const sib = siblingsOf(index, entry);
      if (!sib || !sib.next) return null;
      if (sib.next.start < entry.end) return null;
      return { edits: [mkEdit(sib.next.start, sib.next.end, '')], tags: ['sibling'] };
    },
  },
  {
    id: 'S14-delete-selected-node',
    build: ({ entry }) => ({ edits: [mkEdit(entry.start, entry.end, '')], tags: ['destructive'] }),
  },
  {
    id: 'S15-insert-top-level-statement-before',
    build: ({ facts, entry }) => {
      const stmt = enclosingStatement(facts, entry);
      if (!stmt) return null;
      return { edits: [mkEdit(stmt.start, stmt.start, `${FILLER_NODE}\n`)], tags: ['top-level'] };
    },
  },
  {
    id: 'S16-insert-top-level-statement-after',
    build: ({ facts, entry }) => {
      const stmt = enclosingStatement(facts, entry);
      if (!stmt) return null;
      return { edits: [mkEdit(stmt.end, stmt.end, `\n${FILLER_NODE}`)], tags: ['top-level'] };
    },
  },
  {
    id: 'S17-rename-unique-def',
    build: ({ index, entry }) => {
      if (entry.defName === null) return null;
      if ((index.byDef.get(entry.defName) || []).length !== 1) return null;
      const node = entry.node;
      if (!node.defRange) return null;
      const sp = { start: node.defRange.start.offset, end: node.defRange.end.offset };
      if (!inside(sp, entry.start, entry.end)) return null;
      const renamed = `${entry.defName}_wd14`;
      if (index.byDef.has(renamed)) return null;
      return { edits: [mkEdit(sp.start, sp.end, renamed)], tags: ['def-rename'] };
    },
  },
  {
    id: 'S18-introduce-duplicate-def',
    build: ({ index, entry }) => {
      if (entry.defName === null) return null;
      const sib = siblingsOf(index, entry);
      if (!sib) return null;
      // The duplicate is inserted BEFORE the selection on purpose: a strategy
      // that silently resolves a duplicate DEF by first match would land on the
      // impostor, and that is exactly what must be caught.
      const twin = `DEF ${entry.defName} ${entry.nodeType} { }\n`;
      return { edits: [mkEdit(entry.start, entry.start, twin)], tags: ['duplicate-def', 'adversarial'] };
    },
  },
  {
    id: 'S19-remove-duplicate-making-def-unique',
    build: ({ index, entry }) => {
      if (entry.defName === null) return null;
      const peers = index.byDef.get(entry.defName) || [];
      if (peers.length !== 2) return null;
      const other = peers.find((p) => p.order !== entry.order);
      if (!other) return null;
      if (!(other.end <= entry.start || other.start >= entry.end)) return null;
      return { edits: [mkEdit(other.start, other.end, '')], tags: ['duplicate-def'] };
    },
  },
  {
    id: 'S20-edit-inside-proto-body',
    build: ({ facts, entry }) => {
      if (entry.scopeKey === '') return null;
      const nums = numbersInside(facts, entry.start, entry.end);
      if (nums.length > 0) {
        const sp = spanOf(nums[0]);
        return { edits: [mkEdit(sp.start, sp.end, alternativeNumber(nums[0].lexeme))], tags: ['proto'] };
      }
      return { edits: [mkEdit(entry.start, entry.start, '\n')], tags: ['proto'] };
    },
  },
  {
    id: 'S21-edit-near-proto-interface',
    build: ({ facts }) => {
      const proto = facts.protos.find((p) => p.interfaces && p.interfaces.length && p.interfaces[0].range);
      if (!proto) return null;
      const at = proto.interfaces[0].range.start.offset;
      return { edits: [mkEdit(at, at, '# wd1.4 interface note\n  ')], tags: ['proto'] };
    },
  },
  {
    id: 'S22-edit-proto-in-mfnode-array',
    // A PROTO declaration sitting directly inside an MFNode array -- the lenient
    // Cybertown/Blaxxun shape the parser accepts. The sampled corpus contained no
    // instance of it, so `fixtures/proto-in-mfnode-array.wrl` (authored for this
    // lane, copied from nothing) supplies one.
    //
    // Two edit shapes, preferring the one the brief actually asks for: an edit
    // INSIDE the nested PROTO content when the selected node lives there,
    // otherwise an insertion BEFORE the PROTO in the array.
    build: ({ facts, entry }) => {
      const proto = facts.protosInArray[0];
      if (!proto || !proto.range) return null;
      const pStart = proto.range.start.offset;
      const pEnd = proto.range.end.offset;

      // Preferred: the selection is nested inside this PROTO's body. Change a
      // scalar strictly inside the selected node so the node survives, its outer
      // span is provable, and the edit genuinely exercises nested PROTO content.
      if (entry.start > pStart && entry.end < pEnd) {
        const nums = numbersInside(facts, entry.start, entry.end);
        if (nums.length > 0) {
          const sp = spanOf(nums[0]);
          return {
            edits: [mkEdit(sp.start, sp.end, alternativeNumber(nums[0].lexeme))],
            tags: ['proto', 'mfnode-array', 'inside-nested-proto'],
          };
        }
      }
      // Fallback: insert before the PROTO in the array.
      return {
        edits: [mkEdit(pStart, pStart, '# wd1.4 proto-in-array\n')],
        tags: ['proto', 'mfnode-array', 'before-proto'],
      };
    },
  },
  {
    id: 'S23-edit-node-with-hyphenated-def',
    build: ({ facts, entry }) => {
      if (entry.defName === null || !entry.defName.includes('-')) return null;
      const nums = numbersInside(facts, entry.start, entry.end);
      if (nums.length > 0) {
        const sp = spanOf(nums[0]);
        return { edits: [mkEdit(sp.start, sp.end, alternativeNumber(nums[0].lexeme))], tags: ['hyphen-def'] };
      }
      return { edits: [mkEdit(entry.start, entry.start, '\n')], tags: ['hyphen-def'] };
    },
  },
  {
    id: 'S24-change-existing-comment',
    build: ({ parseResult }) => {
      const comments = parseResult.comments || [];
      const c = comments.find((x) => x.range && x.range.end.offset > x.range.start.offset);
      if (!c) return null;
      const sp = { start: c.range.start.offset, end: c.range.end.offset };
      return { edits: [mkEdit(sp.start, sp.end, '# wd1.4 replaced comment text')], tags: ['trivia', 'comment'] };
    },
  },
  {
    id: 'S25-multiple-non-overlapping-edits',
    build: ({ facts, index, entry }) => {
      const parts = [];
      const stmt = enclosingStatement(facts, entry);
      if (stmt) parts.push(mkEdit(stmt.start, stmt.start, '# wd1.4 a\n'));
      const nums = numbersInside(facts, entry.start, entry.end);
      if (nums.length > 0) {
        const sp = spanOf(nums[0]);
        parts.push(mkEdit(sp.start, sp.end, alternativeNumber(nums[0].lexeme)));
      }
      const sib = siblingsOf(index, entry);
      if (sib) parts.push(mkEdit(entry.end, entry.end, `\n${FILLER_NODE}`));
      if (parts.length < 2) return null;
      // Guard: the statement-start insertion and the interior edit can coincide
      // only in degenerate trees; reject rather than emit an overlapping set.
      const sorted = [...parts].sort((a, b) => a.from - b.from);
      for (let i = 1; i < sorted.length; i += 1) if (sorted[i].from < sorted[i - 1].to) return null;
      return { edits: parts, tags: ['multi-edit'] };
    },
  },
  {
    id: 'S26-edits-before-and-inside',
    build: ({ facts, entry }) => {
      const nums = numbersInside(facts, entry.start, entry.end);
      if (nums.length === 0) return null;
      const sp = spanOf(nums[0]);
      return {
        edits: [
          mkEdit(entry.start, entry.start, '# wd1.4 before\n'),
          mkEdit(sp.start, sp.end, alternativeNumber(nums[0].lexeme)),
        ],
        tags: ['multi-edit'],
      };
    },
  },
  {
    id: 'S27-edit-unknown-vendor-node',
    build: ({ facts, entry }) => {
      if (VRML97_NODE_TYPES.has(entry.nodeType)) return null;
      const nums = numbersInside(facts, entry.start, entry.end);
      if (nums.length > 0) {
        const sp = spanOf(nums[0]);
        return { edits: [mkEdit(sp.start, sp.end, alternativeNumber(nums[0].lexeme))], tags: ['unknown-node'] };
      }
      return { edits: [mkEdit(entry.start, entry.start, '\n')], tags: ['unknown-node'] };
    },
  },
  {
    id: 'S28-edit-recovered-document',
    build: ({ file, entry }) => {
      if (!file.recovered) return null;
      return { edits: [mkEdit(entry.start, entry.start, '# wd1.4 recovered-doc note\n')], tags: ['recovered'] };
    },
  },
  {
    id: 'S29-reorder-siblings-delete-insert',
    build: ({ text, index, entry }) => {
      const sib = siblingsOf(index, entry);
      if (!sib || !sib.next) return null;
      const next = sib.next;
      if (next.start < entry.end) return null;
      const body = text.slice(entry.start, entry.end);
      const edits = [
        mkEdit(entry.start, entry.end, ''),
        mkEdit(next.end, next.end, `\n${body}`),
      ];
      // The move is explicit, so the expected post-edit position is arithmetic,
      // not inference: everything after the deletion shifts left by the deleted
      // length, and the re-inserted copy starts one newline after that point.
      const shifted = next.end - (entry.end - entry.start);
      return {
        edits,
        tags: ['reorder', 'adversarial'],
        expectationOverride: {
          kind: 'preserved',
          start: shifted + 1,
          end: shifted + 1 + body.length,
          text: body,
        },
      };
    },
  },
  {
    id: 'S30-insert-near-identical-same-type-sibling',
    build: ({ text, index, entry }) => {
      const sib = siblingsOf(index, entry);
      if (!sib) return null;
      const body = text.slice(entry.start, entry.end);
      if (body.length > 4096) return null;
      // A twin of the selection inserted immediately in front of it. When the
      // selection is anonymous this is a byte-identical clone -- the single most
      // dangerous input for any index- or shape-based identity scheme.
      const twin = entry.defName === null
        ? body
        : body.replace(/^DEF\s+\S+\s+/, '');
      return { edits: [mkEdit(entry.start, entry.start, `${twin}\n`)], tags: ['adversarial', 'identical-sibling'] };
    },
  },
];

/**
 * Build every applicable scenario for one selected node.
 *
 * @returns {object[]} `{ id, edits, tags, expectation }`, source-order stable.
 */
function buildScenarios(context) {
  const out = [];
  for (const scenario of SCENARIOS) {
    let built;
    try {
      built = scenario.build(context);
    } catch {
      built = null; // a scenario that cannot be constructed is simply skipped
    }
    if (!built || !built.edits || built.edits.length === 0) continue;
    // Reject any malformed or overlapping edit set at construction time rather
    // than letting applyEdits throw mid-run.
    const sorted = [...built.edits].sort((a, b) => a.from - b.from || a.to - b.to);
    let bad = false;
    for (let i = 0; i < sorted.length; i += 1) {
      const e = sorted[i];
      if (!Number.isInteger(e.from) || !Number.isInteger(e.to) || e.from > e.to
        || e.from < 0 || e.to > context.text.length) { bad = true; break; }
      if (i > 0 && e.from < sorted[i - 1].to) { bad = true; break; }
      if (i > 0 && e.from === sorted[i - 1].from && e.from === e.to) { bad = true; break; }
    }
    if (bad) continue;

    const expectation = built.expectationOverride
      || buildExpectation(context.text, built.edits, context.entry.start, context.entry.end);
    if (expectation.kind === 'straddling') continue;

    out.push({ id: scenario.id, edits: built.edits, tags: built.tags || [], expectation });
  }
  return out;
}

module.exports = {
  SCENARIOS,
  CATEGORIES,
  classifyEdits,
  buildExpectation,
  documentFacts,
  selectNodes,
  buildScenarios,
  spliceAll,
};
