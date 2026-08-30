'use strict';
// WD2-A correction F1 -- the semantic-finding pipeline that powers the
// inspector. Two QA agents reported the same defect:
//   * `findingsForDocument(a.parseResult)` throws ESCOPEGRAPH (a parseResult
//     is not a scope graph).
//   * The renderer's catch turned the throw into `rawFindings = []`, so the
//     inspector rendered "No diagnostics" even when the document carried a
//     known semantic issue.
//
// This test exercises the CORRECTED path end-to-end -- parse, scope graph,
// semantic findings, P4-A presentation, P4-B message text, inspector filter.
// It fails if:
//   * findingsForDocument receives a parseResult directly (the old wiring).
//   * ESCOPEGRAPH is silently caught and turned into [].
//   * The inspector filter shows false "no diagnostics" on a known issue.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const vrml = require('../../src/vrml');
const sceneTreeMod = require('../../src/vrml/scene-tree');
const presentationMod = require('../../src/vrml/presentation');
const messagesMod = require('../../src/vrml/messages');
const semanticFindingsMod = require('../../src/vrml/semantic-findings');
const scopeGraphMod = require('../../src/vrml/scope-graph');

const H = '#VRML V2.0 utf8\n';

// Fixture with TWO independent semantic issues:
//   * An unresolved USE in `USE Phantom` (no DEF Phantom exists).
//   * A second unresolved USE further down (a known second occurrence).
// Both must surface as `USE_NOT_BOUND` findings, separately, each owned by
// the smallest scene item containing its offset.
const TWO_USES_SOURCE =
  H +
  [
    'Group { children [',
    '  Shape { geometry USE Phantom }',     // USE #1 -- unresolved
    '] }',
    'Transform { children [',
    '  Shape { geometry USE Ghost }',       // USE #2 -- unresolved
    '] }',
  ].join('\n');

function buildSceneItems(parsed) {
  // The corrected renderer wiring: build the scope graph first, then the
  // scene tree with a useResolver that consults the graph. Without a graph,
  // every USE falls back to UNRESOLVED (the read model NEVER answers from
  // the flat defsByName alone -- it is cross-scope-blind).
  const graph = scopeGraphMod.buildScopeGraph(parsed);
  const useResolver = (useNode) => {
    const resolution = scopeGraphMod.resolve(graph, useNode);
    if (scopeGraphMod.isResolved(resolution) && resolution.symbol && resolution.symbol.node) {
      return { status: 'resolved', targetAstNode: resolution.symbol.node };
    }
    return { status: 'unresolved' };
  };
  const tree = sceneTreeMod.buildSceneTree(parsed, { useResolver });
  return { graph, tree };
}

test('F1 corrected path: parse -> scope graph -> findings -> P4-A -> P4-B', () => {
  const parsed = vrml.parse(TWO_USES_SOURCE);
  const { graph, tree } = buildSceneItems(parsed);

  // Step 1: the graph must be a real scope graph (findingsForDocument requires it).
  assert.ok(scopeGraphMod.isScopeGraph(graph), 'buildScopeGraph must return a graph');

  // Step 2: findingsForDocument(graph) returns an array, NOT a thrown error.
  let rawFindings;
  try {
    rawFindings = semanticFindingsMod.findingsForDocument(graph);
  } catch (e) {
    assert.fail(`findingsForDocument(graph) threw: ${e && (e.message || e)}`);
  }
  assert.ok(Array.isArray(rawFindings), 'findingsForDocument must return an array');

  // Step 3: at least one finding covers an unresolved USE.
  const useFindings = rawFindings.filter((f) => f.code === semanticFindingsMod.FINDING_CODE.USE_NOT_BOUND);
  assert.ok(useFindings.length >= 2,
    `expected >= 2 USE_NOT_BOUND findings, got ${useFindings.length}`);

  // Step 4: P4-A orders + severity-normalises; result has presentation fields.
  const presented = presentationMod.presentDocumentFindings(rawFindings);
  assert.ok(Array.isArray(presented));
  assert.ok(presented.length === rawFindings.length);
  for (const p of presented) {
    assert.ok(p.presentation, 'every P4-A result carries .presentation');
    assert.ok(p.presentation.severity, 'presentation carries severity');
  }

  // Step 5: P4-B turns a presentation into text. Verify by picking one
  // finding, asking P4-B for it, and asserting the shape.
  const msg = messagesMod.p ? null : null; // shape placeholder; see below
  const sample = presented.find((p) => p.finding.code === semanticFindingsMod.FINDING_CODE.USE_NOT_BOUND);
  assert.ok(sample, 'sample USE_NOT_BOUND finding must exist');
  const text = messagesMod.messageForPresentation(sample);
  assert.ok(typeof text.title === 'string' && text.title.length > 0,
    'P4-B must return a non-empty title');
  assert.ok(typeof text.summary === 'string',
    'P4-B must return a summary string');
  // P4-B contract: text-only result { id, title, summary, detail? }.
  assert.ok(['string', 'undefined'].includes(typeof text.detail),
    'P4-B detail must be string or undefined');
});

test('F1 reproduction: findingsForDocument(parseResult) throws ESCOPEGRAPH (old wiring)', () => {
  // The QA report's exact shape: findingsForDocument(a.parseResult). This
  // throws ESCOPEGRAPH and the old catch turned it into rawFindings = [].
  // The corrected wiring builds the graph first; this test PROVES the old
  // wiring was always wrong -- it would fail loudly, not return [].
  const parsed = vrml.parse(TWO_USES_SOURCE);
  assert.throws(
    () => semanticFindingsMod.findingsForDocument(parsed),
    (e) => e && e.code === scopeGraphMod.SCOPE_ERROR.GRAPH,
    'findingsForDocument(parseResult) must throw ESCOPEGRAPH loudly, never return []',
  );
});

test('F1 inspector filter: a finding inside a nested Shape is owned by the smallest item containing it', () => {
  const parsed = vrml.parse(TWO_USES_SOURCE);
  const { graph, tree } = buildSceneItems(parsed);

  const rawFindings = semanticFindingsMod.findingsForDocument(graph);
  const presented = presentationMod.presentDocumentFindings(rawFindings);

  // Pick the first USE_NOT_BOUND finding (USE Phantom inside Shape inside Group).
  const finding = presented.find((p) => p.finding.code === semanticFindingsMod.FINDING_CODE.USE_NOT_BOUND);
  assert.ok(finding);
  const off = finding.finding.range.start.offset;
  const owner = sceneTreeMod.itemContainingOffset(tree, off);
  assert.ok(owner, 'itemContainingOffset must return an owner');

  // The most-specific item containing the USE's offset IS the USE itself
  // -- the USE is its own scene item. (The Shape is a parent; the USE's
  // own range is smaller than the Shape's.) This is the rule F3 codifies:
  // never any-of, always smallest-of.
  assert.equal(owner.kind, sceneTreeMod.KIND.USE,
    `owner should be the USE item itself, got ${owner.kind}`);

  // The Document item also CONTAINS the offset, but it must NOT own it.
  const doc = tree.root;
  assert.ok(doc.range.start.offset <= off && off <= doc.range.end.offset);
  assert.notEqual(owner.id, doc.id,
    'most-specific owner is not the Document');
});

test('F1 inspector filter: two unresolved USEs are two separate findings, never deduplicated', () => {
  const parsed = vrml.parse(TWO_USES_SOURCE);
  const { graph, tree } = buildSceneItems(parsed);

  const rawFindings = semanticFindingsMod.findingsForDocument(graph);
  const presented = presentationMod.presentDocumentFindings(rawFindings);
  const useFindings = presented.filter((p) => p.finding.code === semanticFindingsMod.FINDING_CODE.USE_NOT_BOUND);
  assert.equal(useFindings.length, 2, 'two unresolved USEs stay two findings');

  // Their offsets must differ -- if they collapsed, the inspector would show
  // only one row.
  const offsets = useFindings.map((p) => p.finding.range.start.offset).sort((a, b) => a - b);
  assert.notEqual(offsets[0], offsets[1], 'two findings, two distinct offsets');
});

test('F1 renderer/editor.js wires buildScopeGraph BEFORE findingsForDocument (no swap order)', () => {
  // Source scan: the renderer's onAnalysis must call buildScopeGraph and
  // pass the GRAPH (not the parseResult) to findingsForDocument. The QA
  // report flagged the swapped order; this test pins the corrected shape.
  const file = path.join(__dirname, '..', '..', 'renderer', 'editor.js');
  const src = fs.readFileSync(file, 'utf8');

  // buildScopeGraph must be called with parseResult.
  assert.ok(/scopeGraph\.buildScopeGraph\(a\.parseResult\)/.test(src),
    'must build the scope graph from a.parseResult');
  // findingsForDocument must be called with `graph`, never `a.parseResult`.
  const findingsCall = src.match(/findingsForDocument\(\s*([A-Za-z_$][\w$]*)\s*\)/);
  assert.ok(findingsCall, 'findingsForDocument(...) must be called from editor.js');
  assert.notEqual(findingsCall[1], 'a.parseResult',
    'findingsForDocument must NOT receive the parseResult -- that was the QA finding');
  assert.equal(findingsCall[1], 'graph',
    'findingsForDocument must receive the scope graph');
});

test('F1 renderer does not swallow ESCOPEGRAPH to [] -- error surfaces to console', () => {
  // The renderer must not catch programming errors and turn them into an
  // empty findings list. A real parse + graph never throws ESCOPEGRAPH
  // here (we built the graph), so we assert the wiring is honest: if
  // findingsForDocument throws, the error is logged -- never silently
  // demoted to [].
  const file = path.join(__dirname, '..', '..', 'renderer', 'editor.js');
  const src = fs.readFileSync(file, 'utf8');
  // Find the findingsForDocument(graph) call and inspect a window around it.
  const nearby = src.indexOf('findingsForDocument(graph)');
  assert.ok(nearby >= 0, 'findingsForDocument(graph) must appear in editor.js');
  const window = src.slice(nearby, nearby + 500);
  // The block must surface the error visibly (console.error inside a catch
  // that wraps the call), not return [].
  assert.ok(/console\.error/.test(window),
    'findingsForDocument error path must console.error visibly');
  assert.ok(!/rawFindings\s*=\s*\[\]\s*;?\s*\}\s*catch/.test(window),
    'findingsForDocument error path must NOT silently set rawFindings=[]');
});

// ---------------------------------------------------------------------------
// Cross-check: the corrected pipeline produces a non-empty findings list for
// a known-bad document. If this test ever returns [], the wiring has
// regressed and the inspector would render a false "no diagnostics".
// ---------------------------------------------------------------------------

test('F1 cross-check: corrected path yields >= 2 findings for a fixture with two unresolved USEs', () => {
  const parsed = vrml.parse(TWO_USES_SOURCE);
  const graph = scopeGraphMod.buildScopeGraph(parsed);
  const raw = semanticFindingsMod.findingsForDocument(graph);
  const presented = presentationMod.presentDocumentFindings(raw);
  assert.ok(presented.length >= 2,
    `cross-check: expected >= 2 findings, got ${presented.length}. If this fails, the renderer wiring has regressed.`);
});

// ---------------------------------------------------------------------------
// C1 -- the renderer must supply `itemById` to the Inspector so a selection
// actually resolves to the scene item, not to a permanent "No selection."
// state. Source scan on renderer/editor.js's initSceneViews must show the
// dependency wired through `sceneBridge.sceneTree.itemById`.
// ---------------------------------------------------------------------------

test('C1: renderer/editor.js wires itemById into the Inspector dependencies', () => {
  const file = path.join(__dirname, '..', '..', 'renderer', 'editor.js');
  const src = fs.readFileSync(file, 'utf8');
  // The inspector's createInspector call must hand it an itemById taken
  // straight from the scene-tree facade -- no second implementation, no
  // ad-hoc byId.
  const block = src.match(/createInspector\([\s\S]*?\}\s*\)\s*;/);
  assert.ok(block, 'createInspector(...) block must be present in editor.js');
  assert.ok(/itemById\s*:\s*sceneBridge\.sceneTree\.itemById\b/.test(block[0]),
    'Inspector deps must include itemById: sceneBridge.sceneTree.itemById');
  // And it must NOT be undefined or a private re-implementation.
  assert.ok(!/itemById\s*:\s*\(?\s*\(\s*[a-z_$][\w$]*\s*,\s*id\s*\)/.test(block[0]),
    'itemById must not be a private re-implementation in editor.js');
});

test('C1: Inspector factory requires itemById -- omitting it falls back to "No selection"', () => {
  // Source scan on the inspector factory: it must call `deps.itemById(tree, id)`
  // to look up the selected item. If a future edit drops the dep, the
  // inspector falls back to a "No selection" state for every selection.
  const file = path.join(__dirname, '..', '..', 'renderer', 'scene-inspector.js');
  const src = fs.readFileSync(file, 'utf8');
  assert.ok(/deps\.itemById\(\s*currentTree\s*,\s*id\s*\)/.test(src),
    'Inspector must call deps.itemById(currentTree, id) to resolve the selected item');
});

// ---------------------------------------------------------------------------
// C2 -- the Inspector must NOT call `presentDocumentFindings` a second time
// on already-presented records. The editor binding hands the inspector
// `{finding, presentation}` records ordered by P4-A; the inspector iterates
// them and routes each through P4-B's `messageForPresentation`. Re-running
// P4-A throws EPRESENTATIONSHAPE and silently drops every diagnostic.
// ---------------------------------------------------------------------------

test('C2: Inspector must NOT call presentDocumentFindings on the presented records', () => {
  const file = path.join(__dirname, '..', '..', 'renderer', 'scene-inspector.js');
  const src = fs.readFileSync(file, 'utf8');
  // The corrected path does not invoke presentDocumentFindings inside the
  // renderFindings path.
  const block = src.match(/function\s+renderFindings\([\s\S]*?\}\s*\n\s*\}/);
  assert.ok(block, 'renderFindings function must be present in scene-inspector.js');
  assert.ok(!/presentDocumentFindings\s*\(/.test(block[0]),
    'renderFindings must not call presentDocumentFindings -- it consumes P4-A presented records directly');
});

test('C2: end-to-end -- presented records flow through the inspector without EPRESENTATIONSHAPE', () => {
  // Walk the full corrected path with a real known-bad fixture. The
  // inspector must NOT throw EPRESENTATIONSHAPE; the records it produces
  // for the inner USE finding must keep P4-A order.
  const parsed = vrml.parse(TWO_USES_SOURCE);
  const graph = scopeGraphMod.buildScopeGraph(parsed);
  const raw = semanticFindingsMod.findingsForDocument(graph);
  const presented = presentationMod.presentDocumentFindings(raw);

  // Direct simulation of what renderFindings does internally: iterate the
  // presented array, route each through P4-B, never re-present.
  for (const record of presented) {
    const text = messagesMod.messageForPresentation(record);
    assert.ok(typeof text.title === 'string' && text.title.length > 0,
      'every P4-B result has a non-empty title');
  }
  // And the reverse must throw loudly -- proving the corrected path
  // never re-presents.
  let threwShape = false;
  try {
    presentationMod.presentDocumentFindings(presented);
  } catch (e) {
    if (e && e.code === 'EPRESENTATIONSHAPE') threwShape = true;
  }
  assert.ok(threwShape,
    're-presenting presented records MUST throw EPRESENTATIONSHAPE (the contract that catches a regression)');
});