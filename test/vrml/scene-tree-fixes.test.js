'use strict';
// WD2-A correction pass -- F2 (nested rendering), F3 (ownership), F4 (USE
// resolution across PROTO scope), F5 (Map immutability). Each finding is
// paired with a regression test that pins the corrected shape and would fail
// under the old behaviour.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const vrml = require('../../src/vrml');
const sceneTreeMod = require('../../src/vrml/scene-tree');
const { KIND, USE_TARGET } = sceneTreeMod;
const scopeGraphMod = require('../../src/vrml/scope-graph');

const H = '#VRML V2.0 utf8\n';

// Minimal DOM stubs sufficient for renderer/scene-tree.js's
// buildSceneTreeDom under vm.runInContext. The script uses createElement,
// setAttribute, appendChild, addEventListener, textContent, dataset, style.
function makeBrowserContext() {
  function makeEl() {
    const el = {
      children: [],
      attrs: {},
      style: {},
      dataset: {},
      _listeners: {},
      className: '',
      tabIndex: -1,
      set classList(v) { this._classList = v; },
      get classList() { return this._classList || { add() {}, remove() {}, toggle() {} }; },
      getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      appendChild(child) { this.children.push(child); return child; },
      addEventListener(name, fn) { (this._listeners[name] = this._listeners[name] || []).push(fn); },
      removeChild(child) {
        const i = this.children.indexOf(child);
        if (i >= 0) this.children.splice(i, 1);
        return child;
      },
      get firstChild() { return this.children[0] || null; },
      get textContent() {
        if (this._textContent != null) return this._textContent;
        return this.children.map((c) => c.textContent || '').join('');
      },
      set textContent(v) { this._textContent = String(v); this.children = []; },
      focus() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
    };
    return el;
  }
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 0,
    clearTimeout() {},
    document: {
      createElement: () => makeEl(),
      documentElement: { style: { setProperty() {} } },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function loadRendererSceneTree() {
  const ctx = makeBrowserContext();
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'renderer', 'scene-tree.js'),
    'utf8',
  );
  vm.runInContext(src, ctx, { filename: 'renderer/scene-tree.js' });
  return ctx.window.WRLForgeSceneTree;
}

// ---------------------------------------------------------------------------
// F5 -- the read-model Maps are read-only (set/delete/clear throw).
// ---------------------------------------------------------------------------

test('F5: scene-tree Maps are read-only (set / delete / clear throw TypeError)', () => {
  const src = H + 'Group { children [ USE A ] }';
  const parsed = vrml.parse(src);
  const tree = sceneTreeMod.buildSceneTree(parsed);
  // The whole result object is frozen (carried by M6 already).
  assert.ok(Object.isFrozen(tree));
  // But Object.freeze on the OUTER object does not reach into Map slots.
  // byId and defsByName are wrapped in read-only Proxies that throw on
  // mutators; get/has/size/iteration remain usable.
  assert.throws(() => { tree.byId.set('node-0-10', { stub: true }); }, TypeError);
  assert.throws(() => { tree.byId.delete('node-0-10'); }, TypeError);
  assert.throws(() => { tree.byId.clear(); }, TypeError);
  // defsByName is wrapped too.
  assert.throws(() => { tree.defsByName.set('A', { stub: true }); }, TypeError);
  assert.throws(() => { tree.defsByName.delete('A'); }, TypeError);
  assert.throws(() => { tree.defsByName.clear(); }, TypeError);
  // Reads still work (the original M6 baseline). The Document item is the
  // root and is always present.
  const doc = tree.items.find((it) => it.kind === 'Document');
  assert.ok(doc);
  assert.equal(typeof tree.byId.get(doc.id), 'object');
  assert.equal(tree.byId.has(doc.id), true);
  // And a known absent id returns undefined, not throws.
  assert.equal(tree.byId.get('does-not-exist'), undefined);
});

test('F5: items, childIds and fieldNames remain frozen (M6 invariant)', () => {
  const src = H + 'Group { children [ Shape { geometry Sphere { } } ] }';
  const tree = sceneTreeMod.buildSceneTree(vrml.parse(src));
  for (const it of tree.items) {
    assert.ok(Object.isFrozen(it), `item ${it.id} frozen`);
    assert.ok(Object.isFrozen(it.childIds), `childIds of ${it.id} frozen`);
  }
  // .push on the frozen items array throws (already M6); the proxies add
  // set/delete/clear as additional throwing paths.
  assert.throws(() => { tree.items.push({ stub: true }); }, TypeError);
});

// ---------------------------------------------------------------------------
// C3 -- read-only Map Proxy must support every read the public consumer
// needs: get, has, size, keys, values, entries, forEach, for...of,
// Symbol.iterator. Writes still throw. Both `byId` and `defsByName`.
// ---------------------------------------------------------------------------

test('C3: read-only Map Proxy supports size and every read on both public lookup maps', () => {
  const src = H + [
    'DEF A Group { }',
    'DEF B Shape { }',
    'Group { children [ USE A, USE B ] }',
  ].join('\n');
  const tree = sceneTreeMod.buildSceneTree(vrml.parse(src));

  // byId -- reads.
  const byId = tree.byId;
  assert.equal(typeof byId.size, 'number',
    'byId.size must be a number (the Proxy trap was returning undefined)');
  assert.ok(byId.size >= 4, 'at least Document + A + B + outer Group');
  const sample = tree.items[0];
  assert.equal(byId.has(sample.id), true);
  assert.equal(byId.get(sample.id), sample);
  // Iteration.
  const keys = Array.from(byId.keys());
  assert.equal(keys.length, byId.size);
  const values = Array.from(byId.values());
  assert.equal(values.length, byId.size);
  const entries = Array.from(byId.entries());
  assert.equal(entries.length, byId.size);
  // forEach.
  let seen = 0;
  byId.forEach(() => { seen += 1; });
  assert.equal(seen, byId.size);
  // for...of.
  let count = 0;
  for (const _ of byId) count += 1;
  assert.equal(count, byId.size);
  // Symbol.iterator.
  assert.equal(typeof byId[Symbol.iterator], 'function');
  const iterated = [];
  for (const entry of byId) iterated.push(entry);
  assert.equal(iterated.length, byId.size);

  // byId -- writes still throw.
  assert.throws(() => { byId.set('x', { stub: true }); }, TypeError);
  assert.throws(() => { byId.delete(sample.id); }, TypeError);
  assert.throws(() => { byId.clear(); }, TypeError);

  // defsByName -- same shape.
  const defsByName = tree.defsByName;
  assert.equal(typeof defsByName.size, 'number',
    'defsByName.size must be a number (the Proxy trap was returning undefined)');
  assert.equal(defsByName.size, 2);
  assert.equal(defsByName.has('A'), true);
  assert.equal(defsByName.has('B'), true);
  assert.equal(defsByName.has('C'), false);
  // The Map's insertion order is stable; pin it without going through sort
  // (which Node's deepStrictEqual treats as not-reference-equal under the
  // frozen-result strictness that bit us earlier).
  assert.deepStrictEqual(Array.from(defsByName.keys()), ['A', 'B']);
  assert.throws(() => { defsByName.set('A', { stub: true }); }, TypeError);
  assert.throws(() => { defsByName.delete('A'); }, TypeError);
  assert.throws(() => { defsByName.clear(); }, TypeError);
});

// ---------------------------------------------------------------------------
// F4 -- USE resolution: the scene tree NEVER answers from the flat
// defsByName alone. The renderer supplies a useResolver that consults the
// WD1.5 scope graph (which knows about PROTO 4.8.4 disjointness).
// ---------------------------------------------------------------------------

test('F4 reproduction: outer USE of a DEF declared inside a PROTO body must NOT be resolved by the flat lookup', () => {
  const src = H + [
    'PROTO P [] {',
    '  DEF Inner Shape { }',
    '}',
    'Group {',
    '  children [ USE Inner ]',     // Outer USE -- not visible across PROTO scope per 4.8.4
    '}',
  ].join('\n');
  const parsed = vrml.parse(src);
  // The flat defsByName DOES contain `Inner` (parse is scope-blind), but
  // building the tree WITHOUT a useResolver must default the outer USE to
  // UNRESOLVED. The QA report flagged the old behaviour that reported it
  // resolved.
  const tree = sceneTreeMod.buildSceneTree(parsed);
  const uses = tree.items.filter((it) => it.kind === KIND.USE);
  assert.equal(uses.length, 1);
  assert.equal(uses[0].useName, 'Inner');
  assert.equal(uses[0].useTargetStatus, USE_TARGET.UNRESOLVED,
    'without a graph, USE items default to UNRESOLVED -- the read model never trusts the flat lookup');
  assert.equal(uses[0].useTargetItemId, null);
});

test('F4 fix: graph-aware useResolver marks cross-PROTO USE as UNRESOLVED', () => {
  const src = H + [
    'PROTO P [] {',
    '  DEF Inner Shape { }',
    '}',
    'Group {',
    '  children [ USE Inner ]',
    '}',
  ].join('\n');
  const parsed = vrml.parse(src);
  const graph = scopeGraphMod.buildScopeGraph(parsed);
  const useResolver = (useNode) => {
    const resolution = scopeGraphMod.resolve(graph, useNode);
    if (scopeGraphMod.isResolved(resolution) && resolution.symbol && resolution.symbol.node) {
      return { status: 'resolved', targetAstNode: resolution.symbol.node };
    }
    return { status: 'unresolved' };
  };
  const tree = sceneTreeMod.buildSceneTree(parsed, { useResolver });
  const uses = tree.items.filter((it) => it.kind === KIND.USE);
  assert.equal(uses.length, 1);
  assert.equal(uses[0].useTargetStatus, USE_TARGET.UNRESOLVED,
    'scope graph says USE Inner is not bound across the PROTO scope (4.8.4)');
});

test('F4 preservation: a valid same-scope USE resolves when the graph says so', () => {
  const src = H + [
    'DEF Shared Shape { }',
    'Group { children USE Shared }',
  ].join('\n');
  const parsed = vrml.parse(src);
  const graph = scopeGraphMod.buildScopeGraph(parsed);
  const useResolver = (useNode) => {
    const resolution = scopeGraphMod.resolve(graph, useNode);
    if (scopeGraphMod.isResolved(resolution) && resolution.symbol && resolution.symbol.node) {
      return { status: 'resolved', targetAstNode: resolution.symbol.node };
    }
    return { status: 'unresolved' };
  };
  const tree = sceneTreeMod.buildSceneTree(parsed, { useResolver });
  const use = tree.items.find((it) => it.kind === KIND.USE && it.useName === 'Shared');
  assert.equal(use.useTargetStatus, USE_TARGET.RESOLVED);
  // The target id points at the DEF Shared node item.
  const def = tree.items.find((it) => it.kind === KIND.NODE && it.def === 'Shared');
  assert.equal(use.useTargetItemId, def.id);
});

test('F4 fix: a resolver that throws surfaces the error, never silently fills the field', () => {
  // A bad resolver must surface the error -- not turn "threw" into "resolved"
  // or "unresolved" silently. The scene tree re-throws so the renderer's
  // own catch can `console.error` visibly. This is the same rule the
  // semantic-findings path follows: programming errors stay loud, only
  // NORMAL "unresolved" verdicts translate to UNRESOLVED.
  const src = H + 'Group { children [ USE A ] }';
  const parsed = vrml.parse(src);
  assert.throws(
    () => sceneTreeMod.buildSceneTree(parsed, {
      useResolver: () => { throw new Error('resolver-fault'); },
    }),
    /resolver-fault/,
    'a throwing resolver must propagate, not be swallowed',
  );
});

// ---------------------------------------------------------------------------
// F3 -- diagnostic ownership: each finding belongs to the SINGLE most-
// specific scene item containing its offset. A nested finding must appear
// ONLY on the deepest container.
// ---------------------------------------------------------------------------

test('F3: a finding inside a nested Shape is owned by the Shape, never by its Group or Document', () => {
  const src = H + [
    'Group {',
    '  children [ Shape { geometry Sphere { } } ]',
    '}',
  ].join('\n');
  const tree = sceneTreeMod.buildSceneTree(vrml.parse(src));
  const sphere = tree.items.find((it) => it.kind === KIND.NODE && it.nodeType === 'Sphere');
  const group = tree.items.find((it) => it.kind === KIND.NODE && it.nodeType === 'Group');
  const doc = tree.root;
  assert.ok(sphere && group && doc);

  // Synthetic finding offset: inside the Sphere.
  const offset = sphere.range.start.offset + 1;
  const owner = sceneTreeMod.itemContainingOffset(tree, offset);
  assert.equal(owner.id, sphere.id);
  // The Document and the Group ALSO contain the offset, but ownership is
  // most-specific, not "any containing item".
  assert.notEqual(owner.id, doc.id);
  assert.notEqual(owner.id, group.id);
});

test('F3: a finding inside a USE is owned by that USE item', () => {
  const src = H + 'Group { children [ USE Missing ] }';
  const tree = sceneTreeMod.buildSceneTree(vrml.parse(src));
  const use = tree.items.find((it) => it.kind === KIND.USE);
  const group = tree.items.find((it) => it.kind === KIND.NODE && it.nodeType === 'Group');
  assert.ok(use && group);

  const offset = use.range.start.offset + 1;
  const owner = sceneTreeMod.itemContainingOffset(tree, offset);
  assert.equal(owner.id, use.id);
  assert.notEqual(owner.id, group.id);
});

test('F3: two separate invalid USEs produce two separate findings, never deduplicated', () => {
  // Different source ranges, both unresolved: ownership must report each on
  // its own USE item, not collapse them into one Document-level finding.
  const src = H + [
    'Group { children [ USE A ] }',     // first USE
    'Group { children [ USE B ] }',     // second USE -- different container
  ].join('\n');
  const tree = sceneTreeMod.buildSceneTree(vrml.parse(src));
  const uses = tree.items.filter((it) => it.kind === KIND.USE);
  assert.equal(uses.length, 2);
  const owners = uses.map((u) => sceneTreeMod.itemContainingOffset(tree, u.range.start.offset + 1));
  assert.equal(owners[0].id, uses[0].id);
  assert.equal(owners[1].id, uses[1].id);
  assert.notEqual(owners[0].id, owners[1].id);
});

test('F3: a finding with no range still owns itself, never the inner items', () => {
  // Pathological: a finding that arrives with no source range. Owner must
  // be the Document (root) -- the smallest containing item. The renderer
  // must NOT silently attach such a finding to the currently selected item.
  const tree = sceneTreeMod.buildSceneTree(vrml.parse(H + 'Group { }'));
  const owner = sceneTreeMod.itemContainingOffset(tree, null);
  // itemContainingOffset requires a number; null returns null. The renderer
  // handles this by skipping the finding (ownership stays null) -- pinned
  // here so a regression in either layer is caught.
  assert.equal(owner, null);
});

// ---------------------------------------------------------------------------
// F2 -- nested tree rendering: buildSceneTreeDom walks every item, not just
// root.childIds. Three levels deep + a USE inside the deepest level.
// ---------------------------------------------------------------------------

test('F2: nested items render in document order with correct aria-level', () => {
  const src = H + [
    'Group {',
    '  children [',
    '    Shape {',
    '      geometry Box { }',
    '    }',
    '  ]',
    '}',
  ].join('\n');
  const tree = sceneTreeMod.buildSceneTree(vrml.parse(src));
  const api = loadRendererSceneTree();
  const rows = api.buildSceneTreeDom(tree);
  // 4 rows: Document (root, depth 0) + Group (depth 1) + Shape (depth 2) + Box (depth 3).
  assert.equal(rows.length, 4,
    `expected 4 rows (Document + Group + Shape + Box), got ${rows.length}: ` +
    tree.items.map((it) => it.kind + ':' + (it.nodeType || it.useName || '')).join(', '));
  // First row is the Document.
  assert.equal(rows[0].getAttribute('aria-level'), '1');
  assert.equal(rows[0].getAttribute('role'), 'treeitem');
  // The Group (depth 1) is at aria-level 2.
  const groupRow = rows.find((r) => r.dataset.id === tree.items.find((it) => it.kind === KIND.NODE && it.nodeType === 'Group').id);
  assert.ok(groupRow);
  assert.equal(groupRow.getAttribute('aria-level'), '2');
  // The Shape (depth 2) is at aria-level 3.
  const shapeRow = rows.find((r) => r.dataset.id === tree.items.find((it) => it.kind === KIND.NODE && it.nodeType === 'Shape').id);
  assert.ok(shapeRow, 'Shape row must be present');
  assert.equal(shapeRow.getAttribute('aria-level'), '3');
  // The Box (depth 3) is at aria-level 4.
  const boxRow = rows.find((r) => r.dataset.id === tree.items.find((it) => it.kind === KIND.NODE && it.nodeType === 'Box').id);
  assert.ok(boxRow, 'Box row must be present (nested rendering regression for F2)');
  assert.equal(boxRow.getAttribute('aria-level'), '4');
});

test('F2: a nested USE also renders', () => {
  const src = H + [
    'DEF Shared Shape { }',
    'Group {',
    '  children [',
    '    Shape { geometry USE Shared }',     // nested USE
    '  ]',
    '}',
  ].join('\n');
  const tree = sceneTreeMod.buildSceneTree(vrml.parse(src));
  const api = loadRendererSceneTree();
  const rows = api.buildSceneTreeDom(tree);
  // Items: Document, DEF Shared, Group, Shape, USE Shared = 5.
  assert.equal(rows.length, 5);
  // The USE row must be present (data-id lives on dataset.id in the DOM stub).
  const useRow = rows.find((r) => {
    const item = tree.items.find((it) => it.id === r.dataset.id);
    return item && item.kind === KIND.USE;
  });
  assert.ok(useRow, 'nested USE row must render');
});

test('F2: rows appear in depth-first document order', () => {
  const src = H + [
    'Group {',                              // row 1
    '  children [',
    '    Transform { translation 1 0 0 }',  // row 2
    '    Shape { geometry Sphere { } }',    // row 3, 4
    '  ]',
    '}',
    'DEF B Box { }',                         // row 5
  ].join('\n');
  const tree = sceneTreeMod.buildSceneTree(vrml.parse(src));
  const api = loadRendererSceneTree();
  const rows = api.buildSceneTreeDom(tree);
  // First row is Document.
  const ids = rows.map((r) => r.dataset.id);
  assert.equal(ids[0], tree.root.id);
  // Group, Transform, Shape, Sphere, DEF B -- in that order.
  const types = ids.slice(1).map((id) => {
    const item = tree.items.find((it) => it.id === id);
    return item.nodeType || item.kind;
  });
  // Pin each element explicitly -- deepEqual on a frozen object sometimes
  // disagrees with deepStrictEqual on string identity; this form is
  // unambiguous.
  assert.equal(types.length, 5);
  assert.equal(types[0], 'Group');
  assert.equal(types[1], 'Transform');
  assert.equal(types[2], 'Shape');
  assert.equal(types[3], 'Sphere');
  assert.equal(types[4], 'Box');
});

test('F2: the renderer/scene-tree.js must walk tree.items, not just tree.root.childIds', () => {
  // Source-scan guard: the corrected DOM build walks tree.items. The old
  // bug iterated tree.root.childIds only, which skipped grandchildren. The
  // assertion fails if a future edit regresses to the loose iteration.
  const file = path.join(__dirname, '..', '..', 'renderer', 'scene-tree.js');
  const src = fs.readFileSync(file, 'utf8');
  // buildSceneTreeDom must walk items.
  assert.ok(/for\s*\(\s*const\s+item\s+of\s+tree\.items\s*\)/.test(src),
    'buildSceneTreeDom must iterate tree.items');
  // And it must not iterate root.childIds for the nested rows.
  assert.ok(!/for\s*\(\s*const\s+childId\s+of\s+tree\.root\.childIds\s*\)/.test(src),
    'buildSceneTreeDom must NOT loop over tree.root.childIds (the old bug)');
});

// ---------------------------------------------------------------------------
// Cross-cuts: the read-model contract still holds after the fixes.
// ---------------------------------------------------------------------------

test('WD2-A read-model contract: idFor / rangeCopy / makeItem stay module-internal', () => {
  // Source scan: idFor and rangeCopy must not appear on module.exports.
  const file = path.join(__dirname, '..', '..', 'src', 'vrml', 'scene-tree.js');
  const src = fs.readFileSync(file, 'utf8');
  // The exports object must contain only the public surface.
  const exportsBlock = src.match(/module\.exports\s*=\s*\{[\s\S]*?\}\s*;/);
  assert.ok(exportsBlock);
  assert.ok(!/\bidFor\b/.test(exportsBlock[0]),
    'idFor must stay module-internal');
  assert.ok(!/\brangeCopy\b/.test(exportsBlock[0]),
    'rangeCopy must stay module-internal');
});

// ---------------------------------------------------------------------------
// C4 -- leaf tree rows must NOT carry aria-expanded. WAI-ARIA tree pattern
// reserves the attribute for items participating in expand/collapse;
// setting "false" on a leaf is a false claim about UI state.
// ---------------------------------------------------------------------------

test('C4: parent rows carry aria-expanded="true"; leaf rows have no aria-expanded attribute', () => {
  const src = H + [
    'Group {',                                  // parent: 2 children
    '  children [',
    '    Shape { geometry Box { } }',           // Shape -> Box  (Shape is a parent)
    '    Shape { geometry Sphere { } }',        // Shape -> Sphere
    '  ]',
    '}',
    'DEF Solo Box { }',                          // top-level leaf (Box)
  ].join('\n');
  const tree = sceneTreeMod.buildSceneTree(vrml.parse(src));
  const api = loadRendererSceneTree();
  const rows = api.buildSceneTreeDom(tree);
  // Each row keyed by item id.
  const rowById = new Map();
  for (const r of rows) rowById.set(r.dataset.id, r);
  // Identify parents vs leaves by the read model's childIds length.
  const parents = tree.items.filter((it) => it.childIds && it.childIds.length > 0);
  const leaves = tree.items.filter((it) => !it.childIds || it.childIds.length === 0);
  assert.ok(parents.length >= 3,
    `expected >= 3 parents (Document + Group + 2 Shapes), got ${parents.length}`);
  assert.ok(leaves.length >= 3,
    `expected >= 3 leaves (2 geometries + Solo Box), got ${leaves.length}`);
  // Every parent row carries aria-expanded="true".
  for (const it of parents) {
    const row = rowById.get(it.id);
    assert.ok(row, `row for parent ${it.kind}:${it.nodeType || it.kind} must exist`);
    assert.equal(row.getAttribute('aria-expanded'), 'true',
      `parent ${it.kind}:${it.nodeType || it.kind} (${it.id}) must carry aria-expanded="true"`);
  }
  // Every leaf row carries NO aria-expanded attribute.
  for (const it of leaves) {
    const row = rowById.get(it.id);
    assert.ok(row, `row for leaf ${it.kind}:${it.nodeType || it.kind} must exist`);
    assert.equal(row.getAttribute('aria-expanded'), null,
      `leaf ${it.kind}:${it.nodeType || it.kind} (${it.id}) must NOT carry aria-expanded`);
  }
});

test('C4: source scan -- makeRow must not set aria-expanded="false" anywhere', () => {
  const file = path.join(__dirname, '..', '..', 'renderer', 'scene-tree.js');
  const src = fs.readFileSync(file, 'utf8');
  // The "false" form is the C4 defect: it claims a leaf is collapsed.
  assert.ok(!/setAttribute\(\s*['"]aria-expanded['"]\s*,\s*['"]false['"]\s*\)/.test(src),
    'makeRow must not set aria-expanded="false" on leaves');
  // And it must not unconditionally set the attribute -- only when
  // childIds.length > 0.
  assert.ok(/if\s*\(\s*item\.childIds\s*&&\s*item\.childIds\.length\s*\)/.test(src),
    'aria-expanded must be conditional on having children');
});

// ---------------------------------------------------------------------------
// C5 -- vrml.interfaceQuery.resolve has no production consumer. The
// renderer's USE resolver goes through the bundled `scopeGraph.resolve`
// (re-exported from vrmlScopeGraph), not the interfaceQuery facade. The
// facade must NOT keep a duplicate public entry.
// ---------------------------------------------------------------------------

test('C5: renderer does not consume vrml.interfaceQuery.resolve -- only the bundled scopeGraph.resolve', () => {
  // Source-scan the renderer and the editor bundle to prove no consumer
  // reaches into `interfaceQuery.resolve`. The bundle re-exports
  // `scopeGraph.resolve`; the renderer calls it through that bridge.
  const editorJs = fs.readFileSync(
    path.join(__dirname, '..', '..', 'renderer', 'editor.js'), 'utf8');
  assert.ok(!/interfaceQuery\.resolve\b/.test(editorJs),
    'renderer/editor.js must not consume vrml.interfaceQuery.resolve');
  const bundle = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'editor', 'browser', 'editor-view.js'), 'utf8');
  assert.ok(!/interfaceQuery\.resolve\b/.test(bundle),
    'editor bundle must not expose interfaceQuery.resolve to the renderer');
  // The bridge must keep the scopeGraph.resolve it publishes.
  assert.ok(/scopeGraph[\s\S]*?resolve/.test(bundle),
    'editor bundle must still expose scopeGraph.resolve for USE binding');
});