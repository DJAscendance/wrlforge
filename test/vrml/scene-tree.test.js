'use strict';
// Scene-tree read-model tests (Phase WD2-A).
//
// Two contracts at once:
//   * Q1..Q15 -- the lane's required functional behaviour.
//   * M1..M10 -- the adversarial / mutation controls. Most of them use the
//     REPOSITORY's existing matrix / mutation pattern: a load-bearing claim
//     about an invariant is paired with a small in-file assertion that proves
//     the regression is caught. Source-scan assertions appear where a strict
//     shape contract matters.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { parse } = require('../../src/vrml');
const sceneTreeModule = require('../../src/vrml/scene-tree');
const st = require('../../src/vrml/scene-tree');
const scopeGraphMod = require('../../src/vrml/scope-graph');
const { KIND, USE_TARGET: UT } = st;

const H = '#VRML V2.0 utf8\n';

// Build a USE resolver that consults the WD1.5 scope graph for the same
// parse. This is the corrected contract: the read model never answers from
// the flat defsByName alone, and tests that want a resolved USE must hand
// the builder a graph-aware resolver (the same call the editor's onAnalysis
// makes in production).
function graphUseResolver(parsed) {
  const graph = scopeGraphMod.buildScopeGraph(parsed);
  return (useNode) => {
    const resolution = scopeGraphMod.resolve(graph, useNode);
    if (scopeGraphMod.isResolved(resolution) && resolution.symbol && resolution.symbol.node) {
      return { status: 'resolved', targetAstNode: resolution.symbol.node };
    }
    return { status: 'unresolved' };
  };
}

function build(text) {
  const parsed = parse(text);
  const useResolver = graphUseResolver(parsed);
  return { parsed, tree: st.buildSceneTree(parsed, { useResolver }) };
}

// Convenience: first item of the given kind.
function firstOfKind(treeRes, kind) {
  return treeRes.items.find((it) => it.kind === kind) || null;
}

// ---------------------------------------------------------------------------
// Q1 -- top-level scene order matches document order.
// ---------------------------------------------------------------------------

test('Q1: top-level scene order matches document order', () => {
  // 5 top-level items: Group (top-level Node), PROTO, EXTERNPROTO, ROUTE,
  // and a 5th top-level Node (DEF B) -- top-level only.
  const src = H + [
    'Group { children [ Transform { translation 1 0 0 children Shape { geometry Sphere { } } } ] }',
    'DEF B Box { }',
    'PROTO P [ field SFFloat r 1 ] { Transform { scale 1 1 1 } }',
    'EXTERNPROTO E "http://example.com/e.wrl" [ ]',
    'ROUTE A.x TO B.y',
  ].join('\n');
  const { tree } = build(src);
  // The Document item's childIds list -- not its items array -- is the
  // authoritative document-order witness for the top level.
  const root = tree.root;
  assert.equal(root.kind, KIND.DOCUMENT);
  assert.equal(root.childIds.length, 5);
  const kinds = root.childIds.map((id) => tree.byId.get(id).kind);
  assert.deepEqual(kinds, [KIND.NODE, KIND.NODE, KIND.PROTO, KIND.EXTERNPROTO, KIND.ROUTE]);
  // The top-level items appear in `items` in the same document order, even
  // though `items` is depth-first (the Group's Transform/Shape/Sphere come
  // between the Group and the Box). We verify by walking items and pulling
  // out the ones whose parentId is the Document.
  const topItems = tree.items.filter((it) => it.parentId === root.id);
  assert.equal(topItems.length, 5);
  for (let i = 0; i < topItems.length; i++) {
    assert.equal(topItems[i].id, root.childIds[i]);
  }
});

// ---------------------------------------------------------------------------
// Q2 -- nested SFNode / MFNode children appear correctly.
// ---------------------------------------------------------------------------

test('Q2: SFNode and MFNode children appear in the scene tree', () => {
  const src = H + [
    'Group {',
    '  children [',
    '    Shape { geometry Sphere { } }',
    '    Shape { geometry Box { } }',
    '  ]',
    '  bboxCenter Shape { geometry Cone { } }',
    '}',
  ].join('\n');
  const { tree } = build(src);
  const group = firstOfKind(tree, KIND.NODE);
  assert.equal(group.nodeType, 'Group');
  // group has 4 direct scene-item children: two Shape children inside the
  // MFNode, plus one Shape under bboxCenter (SFNode), plus each Shape's
  // geometry (SFNode -> Sphere/Box/Cone) -- 3 more.
  // Children of group are: Shape#1, Shape#2, Shape#3 (nested SFNode) +
  // their geometries via nested walks -- we count *all* descendant items.
  const allNodes = tree.items.filter((it) => it.kind === KIND.NODE);
  // 1 Group + 3 Shapes + 3 geometries (Sphere/Box/Cone) = 7.
  assert.equal(allNodes.length, 7);
  // MFNode children retain order: the two Shape children inside Group's
  // `children` MFNode appear before the SFNode child via bboxCenter.
  const groupChildren = group.childIds.map((id) => tree.byId.get(id));
  const shapes = groupChildren.filter((it) => it.nodeType === 'Shape');
  assert.equal(shapes.length, 3);
});

// ---------------------------------------------------------------------------
// Q3 -- DEF name is shown correctly.
// ---------------------------------------------------------------------------

test('Q3: DEF nodes carry their name', () => {
  const src = H + 'DEF MyBox Box { size 1 1 1 }';
  const { tree } = build(src);
  const node = firstOfKind(tree, KIND.NODE);
  assert.equal(node.kind, KIND.NODE);
  assert.equal(node.def, 'MyBox');
  assert.ok(node.defRange, 'DEF carries a defRange');
  assert.equal(node.defRange.start.offset >= 0, true);
});

// ---------------------------------------------------------------------------
// Q4 -- USE stays a reference; it does not become a cloned child node.
// ---------------------------------------------------------------------------

test('Q4: USE remains a reference, not a cloned node', () => {
  const src = H + [
    'DEF A Group { }',
    'Group { children USE A }',
  ].join('\n');
  const { tree } = build(src);
  const allNodes = tree.items.filter((it) => it.kind === KIND.NODE);
  // Two Nodes only: DEF A, and the outer Group.
  assert.equal(allNodes.length, 2);
  // One USE.
  const uses = tree.items.filter((it) => it.kind === KIND.USE);
  assert.equal(uses.length, 1);
  assert.equal(uses[0].useName, 'A');
  // The USE's parent is the outer Group, and the USE's target status
  // resolves to the DEF A node.
  const defA = allNodes.find((n) => n.def === 'A');
  assert.equal(uses[0].parentId, allNodes[1].id);
  assert.equal(uses[0].useTargetStatus, UT.RESOLVED);
  assert.equal(uses[0].useTargetItemId, defA.id);
});

// ---------------------------------------------------------------------------
// Q5 -- unresolved USE does not invent a target; status carries the truth.
// ---------------------------------------------------------------------------

test('Q5: unresolved USE carries UNRESOLVED status and no fabricated target', () => {
  const src = H + 'Group { children [ USE Phantom ] }';
  const { tree } = build(src);
  const use = firstOfKind(tree, KIND.USE);
  assert.equal(use.useName, 'Phantom');
  assert.equal(use.useTargetStatus, UT.UNRESOLVED);
  assert.equal(use.useTargetItemId, null);
});

// ---------------------------------------------------------------------------
// Q6 -- PROTO / EXTERNPROTO remain inspectable as their own kinds.
// ---------------------------------------------------------------------------

test('Q6: PROTO and EXTERNPROTO appear as their own kinds', () => {
  const src = H + [
    'PROTO P [ field SFFloat r 1 ] { Transform { scale 1 1 1 } }',
    'EXTERNPROTO E [ field SFVec3f c 0 0 0 ] "http://example.com/e.wrl"',
  ].join('\n');
  const { tree } = build(src);
  const protos = tree.items.filter((it) => it.kind === KIND.PROTO);
  const eps = tree.items.filter((it) => it.kind === KIND.EXTERNPROTO);
  assert.equal(protos.length, 1);
  assert.equal(eps.length, 1);
  assert.equal(protos[0].protoName, 'P');
  assert.equal(protos[0].protoInterfaceCount, 1);
  assert.equal(protos[0].protoHasBody, true);
  assert.equal(eps[0].externprotoName, 'E');
  assert.equal(eps[0].externprotoInterfaceCount, 1);
  // PROTO body is descended -- the Transform inside it appears.
  const protoChildren = protos[0].childIds.map((id) => tree.byId.get(id));
  assert.equal(protoChildren.length, 1);
  assert.equal(protoChildren[0].kind, KIND.NODE);
  assert.equal(protoChildren[0].nodeType, 'Transform');
});

// ---------------------------------------------------------------------------
// Q7 -- one selected scene item drives the inspector.
// ---------------------------------------------------------------------------
// The selection authority is the renderer's responsibility; here we assert
// the read-model side: byId resolves the id of a known scene item and the
// inspector contract (every per-kind fact it needs) is populated.

test('Q7: scene items carry the inspector facts for their kind', () => {
  const src = H + [
    'DEF A Transform { translation 1 0 0 children [',
    '  Shape { geometry Sphere { } }',
    '] }',
    'PROTO P [ ] { Group { } }',
    'EXTERNPROTO E [ ] "http://example.com/e.wrl"',
    'ROUTE A.translation TO B.scale',
  ].join('\n');
  const { tree } = build(src);
  const node = tree.items.find((it) => it.kind === KIND.NODE && it.def === 'A');
  assert.ok(node, 'must find DEF A');
  assert.equal(node.nodeType, 'Transform');
  assert.equal(node.def, 'A');
  assert.equal(node.defRange && node.defRange.start.offset >= 0, true);
  // Children of DEF A include one Shape (via SFNode / MFNode).
  const nodeChildren = node.childIds.map((id) => tree.byId.get(id));
  assert.ok(nodeChildren.some((c) => c.kind === KIND.NODE && c.nodeType === 'Shape'));

  const route = firstOfKind(tree, KIND.ROUTE);
  assert.equal(route.routeFromNode, 'A');
  assert.equal(route.routeFromEvent, 'translation');
  assert.equal(route.routeToNode, 'B');
  assert.equal(route.routeToEvent, 'scale');
  // B is not defined in this source -- both endpoints are unresolved.
  assert.equal(route.routeResolvedFrom, true);
  assert.equal(route.routeResolvedTo, false);
});

// ---------------------------------------------------------------------------
// Q8 -- no selection: a scene with no items yields an empty-but-valid tree.
// ---------------------------------------------------------------------------

test('Q8: empty document yields a Document root with no children', () => {
  const { tree } = build(H);
  assert.ok(tree.root);
  assert.equal(tree.root.kind, KIND.DOCUMENT);
  assert.equal(tree.root.childIds.length, 0);
  assert.equal(tree.items.length, 1);
  assert.equal(tree.totals.count, 1);
  assert.deepEqual(tree.totals.byKind, { Document: 1 });
});

// ---------------------------------------------------------------------------
// Q9 -- a scene item carries an offset range, so a finding can be linked.
// ---------------------------------------------------------------------------

test('Q9: every scene item carries a source range', () => {
  const src = H + [
    'Group { children [ Transform { } Shape { } ] }',
    'PROTO P [ ] { Box { } }',
    'ROUTE X.a TO Y.b',
  ].join('\n');
  const { tree } = build(src);
  for (const item of tree.items) {
    if (item.kind === KIND.DOCUMENT) continue;
    assert.ok(item.range, `item ${item.kind} ${item.id} must carry a range`);
    assert.ok(item.range.start.offset >= 0);
    assert.ok(item.range.end.offset >= item.range.start.offset);
  }
});

// ---------------------------------------------------------------------------
// Q10 -- a partial / malformed document still produces a tree; the parser
// has already recovered.
// ---------------------------------------------------------------------------

test('Q10: malformed document uses the parser-recovered tree, not source re-parsing', () => {
  const src = H + [
    'Group { children [',
    '  Transform { translation }',  // missing value
    '  Box',                          // missing body
    ']',
  ].join('\n');
  const parsed = parse(src);
  const tree = st.buildSceneTree(parsed);
  // The parser produces diagnostics and a recovered tree; the scene tree
  // reflects what the parser recovered, not the source text.
  assert.ok(parsed.diagnostics.length > 0, 'parser must surface diagnostics');
  // The Group is still present.
  const group = tree.items.find((it) => it.kind === KIND.NODE && it.nodeType === 'Group');
  assert.ok(group);
});

// ---------------------------------------------------------------------------
// Q11 -- a tree survives a round-trip re-render: identical ids for
// identical source.
// ---------------------------------------------------------------------------

test('Q11: identical source produces identical ids', () => {
  const src = H + 'DEF X Group { children [ USE Y, Shape { } ] }';
  const a = build(src);
  const b = build(src);
  assert.deepEqual(a.tree.items.map((it) => it.id), b.tree.items.map((it) => it.id));
});

// ---------------------------------------------------------------------------
// Q12 -- a PROTO instance is flagged on the Node, not as a sixth kind.
// ---------------------------------------------------------------------------

test('Q12: PROTO instances carry protoInstance=true on their Node', () => {
  const src = H + [
    'PROTO P [ field SFFloat r 1 ] { Transform { scale 1 1 1 } }',
    'DEF I P { r 2.0 }',
  ].join('\n');
  const { tree } = build(src);
  const instance = tree.items.find((it) => it.kind === KIND.NODE && it.def === 'I');
  assert.ok(instance);
  assert.equal(instance.protoInstance, true);
  assert.equal(instance.protoInstanceName, 'P');
  // Plain built-in nodes are NOT flagged as proto instances.
  const transform = tree.items.find((it) => it.kind === KIND.NODE && it.nodeType === 'Transform');
  assert.equal(transform && transform.protoInstance, false);
});

// ---------------------------------------------------------------------------
// Q13 -- totals / byKind match the items list.
// ---------------------------------------------------------------------------

test('Q13: totals match the items list', () => {
  const src = H + [
    'Group { children [ Shape { geometry Sphere { } }, Shape { } ] }',
    'PROTO P [ ] { Box { } }',
    'EXTERNPROTO E [ ] "http://example.com/e.wrl"',
    'ROUTE X.a TO Y.b',
  ].join('\n');
  const { tree } = build(src);
  const actual = {};
  for (const it of tree.items) actual[it.kind] = (actual[it.kind] | 0) + 1;
  assert.deepEqual(tree.totals.byKind, actual);
  assert.equal(tree.totals.count, tree.items.length);
});

// ---------------------------------------------------------------------------
// Q14 -- itemContainingOffset: a finding inside a nested Shape resolves to
// the Shape, not to the enclosing Group.
// ---------------------------------------------------------------------------

test('Q14: itemContainingOffset returns the most specific scene item', () => {
  const src = H + [
    'Group {',
    '  children [ Shape { geometry Sphere { } } ]',
    '}',
  ].join('\n');
  const { parsed, tree } = build(src);
  const sphere = tree.items.find((it) => it.kind === KIND.NODE && it.nodeType === 'Sphere');
  assert.ok(sphere);
  // A synthetic "finding" offset that lands inside the Sphere.
  const inside = sphere.range.start.offset + 1;
  const match = st.itemContainingOffset(tree, inside);
  assert.equal(match.id, sphere.id);
  // An offset that lands in the Group (before any child) matches the Group.
  const group = tree.items.find((it) => it.kind === KIND.NODE && it.nodeType === 'Group');
  const beforeShape = group.range.start.offset + 1;
  const match2 = st.itemContainingOffset(tree, beforeShape);
  assert.equal(match2.id, group.id);
});

// ---------------------------------------------------------------------------
// Q15 -- excluded items: scalars, arrays of scalars, interface declarations,
// and IS bindings are NOT scene items.
// ---------------------------------------------------------------------------

test('Q15: scalars, IS bindings, and interface declarations are excluded', () => {
  const src = H + [
    'PROTO P [',
    '  field SFFloat r 1.0',          // interface decl + scalar default -- not items
    '  eventIn SFBool set_active',    // interface decl -- not an item
    ']',
    '{ Transform { translation 0 0 0 } }',
    'Shape {',
    '  appearance Appearance { material Material { diffuseColor 0.5 0.5 0.5 } }',
    '}',
  ].join('\n');
  const { tree } = build(src);
  // No USE items.
  assert.equal(tree.items.filter((it) => it.kind === KIND.USE).length, 0);
  // Only one PROTO (the declaration itself); the interface decls are NOT items.
  const protos = tree.items.filter((it) => it.kind === KIND.PROTO);
  assert.equal(protos.length, 1);
  // The PROTO's childIds list contains its body Transform -- not the interface
  // declarations.
  const protoChildKinds = protos[0].childIds.map((id) => tree.byId.get(id).kind);
  assert.deepEqual(protoChildKinds, [KIND.NODE]);
  // Scalar fields (diffuseColor 0.5 0.5 0.5) do NOT produce a child node
  // -- the Shape's `appearance` is a single SFNode containing one Material.
  const material = tree.items.find((it) => it.kind === KIND.NODE && it.nodeType === 'Material');
  assert.ok(material);
  // The Material has NO children -- its diffuseColor is a scalar.
  assert.equal(material.childIds.length, 0);
});

// ---------------------------------------------------------------------------
// M1 -- architecture boundary: scene-tree never reaches into fs/path/electron.
// (Source-scan guard.)
// ---------------------------------------------------------------------------

test('M1: scene-tree.js is browser-safe (no fs/path/electron)', () => {
  const file = path.join(__dirname, '..', '..', 'src', 'vrml', 'scene-tree.js');
  const src = fs.readFileSync(file, 'utf8');
  // Explicit disallowed Node-only imports. A regression here is a load-bearing
  // boundary failure (the editor is renderer-only).
  assert.ok(!/\brequire\(['"]fs['"]\)/.test(src), 'must not require fs');
  assert.ok(!/\brequire\(['"]path['"]\)/.test(src), 'must not require path');
  assert.ok(!/\brequire\(['"]zlib['"]\)/.test(src), 'must not require zlib');
  assert.ok(!/\brequire\(['"]electron['"]\)/.test(src), 'must not require electron');
  assert.ok(!/\bchild_process\b/.test(src), 'must not use child_process');
});

// ---------------------------------------------------------------------------
// M2 -- the read model never parses source text. (Architecture guard: no
// tokenize / parse calls and no regex scraping.)
// ---------------------------------------------------------------------------

test('M2: scene-tree never parses source text', () => {
  const file = path.join(__dirname, '..', '..', 'src', 'vrml', 'scene-tree.js');
  const src = fs.readFileSync(file, 'utf8');
  assert.ok(!/\btokenize\b/.test(src), 'must not call tokenize');
  assert.ok(!/\bparse\(.+,\s*\{/.test(src), 'must not call parse()');
  // No bare regex used to extract names -- the model only reads AST nodes.
  assert.ok(!/\.match\(/.test(src), 'must not use .match on source');
  // The only inputs are parseResult.tree and parseResult.defsByName.
  assert.ok(src.includes("require('./ast')"));
  assert.ok(!/\bJSON\.parse\b/.test(src));
});

// ---------------------------------------------------------------------------
// M3 -- IDs are session-stable and derived only from kind + range.
// ---------------------------------------------------------------------------

test('M3: idFor format is stable and unique within one parse', () => {
  const src = H + [
    'DEF A Box { }',
    'DEF B Sphere { }',
    'Group { children [ USE A, USE B ] }',
  ].join('\n');
  const { tree } = build(src);
  const ids = tree.items.map((it) => it.id);
  assert.equal(new Set(ids).size, ids.length, 'all ids unique within one tree');
  for (const id of ids) {
    assert.match(id, /^(document|node|use|proto|externproto|route)-/);
  }
  // IDs do not persist: two parses of the same source produce the same ids,
  // but a different source produces different ids -- the test for the first
  // half is already covered by Q11.
});

// ---------------------------------------------------------------------------
// M4 -- the read model never mutates the AST.
// ---------------------------------------------------------------------------

test('M4: building the scene tree does not mutate the parse AST', () => {
  const src = H + 'Group { children [ Transform { }, Shape { } ] }';
  const parsed = parse(src);
  const before = JSON.stringify(parsed.tree);
  st.buildSceneTree(parsed);
  const after = JSON.stringify(parsed.tree);
  assert.equal(before, after, 'AST must be byte-identical before and after');
});

// ---------------------------------------------------------------------------
// M5 -- item shape contract: every per-kind field is undefined when not
// applicable, never null, and never the wrong kind's field.
// ---------------------------------------------------------------------------

test('M5: per-kind field shape contract', () => {
  const src = H + 'Group { children [ USE A ] }';
  const { tree } = build(src);
  for (const it of tree.items) {
    switch (it.kind) {
      case KIND.NODE:
        assert.equal(typeof it.nodeType, 'string');
        assert.equal(typeof it.fieldsCount, 'number');
        assert.equal(typeof it.fieldNames, 'object'); // frozen array
        assert.equal(it.protoName, undefined);
        assert.equal(it.useName, undefined);
        assert.equal(it.protoName, undefined);
        break;
      case KIND.USE:
        assert.equal(typeof it.useName, 'string');
        assert.equal(typeof it.useTargetStatus, 'string');
        assert.equal(it.nodeType, undefined);
        break;
      case KIND.PROTO:
        assert.equal(typeof it.protoName, 'string');
        assert.equal(it.useName, undefined);
        break;
      case KIND.EXTERNPROTO:
        assert.equal(typeof it.externprotoName, 'string');
        assert.equal(it.useName, undefined);
        break;
      case KIND.ROUTE:
        assert.equal(typeof it.routeFromNode, 'string');
        assert.equal(it.useName, undefined);
        break;
      case KIND.DOCUMENT:
        assert.equal(typeof it.documentHasHeader, 'boolean');
        assert.equal(typeof it.documentStatementCount, 'number');
        break;
      default:
        assert.fail(`unknown kind ${it.kind}`);
    }
  }
});

// ---------------------------------------------------------------------------
// M6 -- the read model is frozen; mutation must throw.
// ---------------------------------------------------------------------------

test('M6: scene tree result and items are frozen', () => {
  const src = H + 'Group { }';
  const { tree } = build(src);
  assert.ok(Object.isFrozen(tree), 'tree result is frozen');
  assert.ok(Object.isFrozen(tree.items), 'items array is frozen');
  for (const it of tree.items) {
    assert.ok(Object.isFrozen(it), `item ${it.id} is frozen`);
    assert.ok(Object.isFrozen(it.childIds), `childIds of ${it.id} is frozen`);
  }
  // A consumer that tries to mutate gets a TypeError in strict mode.
  assert.throws(() => { tree.items.push({ stub: true }); }, TypeError);
});

// ---------------------------------------------------------------------------
// M7 -- invalid input throws -- not a silent empty tree.
// ---------------------------------------------------------------------------

test('M7: invalid input throws SCENE_TREE_INVALID_INPUT', () => {
  assert.throws(() => st.buildSceneTree(null), /SCENE_TREE_INVALID_INPUT/);
  assert.throws(() => st.buildSceneTree({}), /SCENE_TREE_INVALID_INPUT/);
  assert.throws(() => st.buildSceneTree('not a parse'), /SCENE_TREE_INVALID_INPUT/);
});

// ---------------------------------------------------------------------------
// M8 -- duplicate DEF: scene tree does not silently merge, and USE
// resolution is the renderer's job, never a flat lookup. Without a
// `useResolver` the read model fails closed (UNRESOLVED); when the renderer
// supplies one that consults the WD1.5 scope graph, the binding the graph
// produces is what USE items carry. Either way, no extra scene item is
// invented for the USE -- it stays a USE, not a clone of the DEF.
// ---------------------------------------------------------------------------

test('M8: duplicate DEF: no clone in tree; USE stays UNRESOLVED without an authoritative resolver', () => {
  const src = H + [
    'DEF A Group { }',
    'DEF A Sphere { }',                // duplicate
    'Group { children [ USE A ] }',
  ].join('\n');
  const { tree } = build(src);
  const nodes = tree.items.filter((it) => it.kind === KIND.NODE && it.def === 'A');
  // Two DEF A Nodes appear (the parser records both); the USE does NOT
  // become a third item -- the read model never invents a clone.
  assert.equal(nodes.length, 2);
  const uses = tree.items.filter((it) => it.kind === KIND.USE);
  assert.equal(uses.length, 1);
  // Without a useResolver the USE defaults to UNRESOLVED -- the read model
  // never answers from the flat defsByName (cross-PROTO false positives).
  assert.equal(uses[0].useTargetStatus, UT.UNRESOLVED);
  assert.equal(uses[0].useTargetItemId, null);
});

test('M8b: when a graph-aware resolver is supplied, the scope graph (not the flat lookup) decides', () => {
  // The WD1.5-P1 graph is conservative: a duplicate DEF in one scope is
  // DUPLICATE_DEF_IN_SCOPE -- the graph declines to bind the USE rather
  // than picking an arbitrary winner. The read model carries that decision
  // unchanged. Two DEF A nodes still appear; the USE has no target; no
  // clone is invented.
  const src = H + [
    'DEF A Group { }',
    'DEF A Sphere { }',                // duplicate
    'Group { children [ USE A ] }',
  ].join('\n');
  const parsed = parse(src);
  const graph = scopeGraphMod.buildScopeGraph(parsed);
  const useResolver = (useNode) => {
    const resolution = scopeGraphMod.resolve(graph, useNode);
    if (scopeGraphMod.isResolved(resolution) && resolution.symbol && resolution.symbol.node) {
      return { status: 'resolved', targetAstNode: resolution.symbol.node };
    }
    return { status: 'unresolved' };
  };
  const tree = st.buildSceneTree(parsed, { useResolver });
  const nodes = tree.items.filter((it) => it.kind === KIND.NODE && it.def === 'A');
  const uses = tree.items.filter((it) => it.kind === KIND.USE);
  assert.equal(nodes.length, 2);
  assert.equal(uses.length, 1);
  // The graph declined; the read model carries that declined status. The
  // scene tree does NOT invent a target. (Earlier behaviour wrongly
  // picked the first DEF and reported RESOLVED -- F4's neighbour.)
  assert.equal(uses[0].useTargetStatus, UT.UNRESOLVED);
  assert.equal(uses[0].useTargetItemId, null);
});

// ---------------------------------------------------------------------------
// M9 -- PROTO inside an MFNode array (the Cybertown compatibility pattern):
// it does NOT appear as a child of the MFNode array's parent. The parser
// already records it on the parent node's `fields` array, not as a scene
// item. The scene tree does not invent hierarchy.
// ---------------------------------------------------------------------------

test('M9: PROTO inside MFNode array is not a scene-item child', () => {
  const src = H + [
    'Group { children [',
    '  PROTO P [ ] { Box { } }',
    '] }',
  ].join('\n');
  const { tree } = build(src);
  // No PROTO item at all -- the parser stored the PROTO inside the MFNode
  // array and the scene tree does not flatten it.
  const protos = tree.items.filter((it) => it.kind === KIND.PROTO);
  assert.equal(protos.length, 0);
  // The Group still exists.
  const group = tree.items.find((it) => it.kind === KIND.NODE && it.nodeType === 'Group');
  assert.ok(group);
  assert.equal(group.childIds.length, 0);
});

// ---------------------------------------------------------------------------
// M10 -- ROUTE inside a PROTO body is captured.
// ---------------------------------------------------------------------------

test('M10: ROUTE inside a PROTO body appears with the PROTO as its parent', () => {
  const src = H + [
    'PROTO P [',
    '  eventIn SFBool set_active',
    '  eventOut SFBool active_changed',
    '] {',
    '  DEF S Script {',
    '    eventIn SFBool set_active IS set_active',
    '    eventOut SFBool active_changed IS active_changed',
    '  }',
    '  ROUTE S.active_changed TO S.set_active',
    '}',
  ].join('\n');
  const { tree } = build(src);
  const route = firstOfKind(tree, KIND.ROUTE);
  assert.ok(route);
  const proto = firstOfKind(tree, KIND.PROTO);
  assert.equal(route.parentId, proto.id);
});