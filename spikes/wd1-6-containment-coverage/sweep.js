'use strict';
// WD1.6-C -- containment coverage over the real corpus.
//
// THE QUESTION THIS ANSWERS, and its denominator, stated before any number:
//
//   For ACTUAL CHILD-NODE PLACEMENTS -- a node written into an SFNode or MFNode
//   field of another node, in a real authored document -- how often can
//   `childLegality` return a DEFINITIVE verdict (`LEGAL` or `ILLEGAL`) rather
//   than withholding one?
//
// The unit is a PLACEMENT, not a field declaration: a schema-shaped denominator
// would measure the schema, and what is at issue is whether C reaches the
// containment questions people's documents actually pose. A `Transform` with
// eleven children is eleven placements.
//
// READ-ONLY, boundary-guarded, deterministic. Discovery, decoding, decoded-text
// de-duplication and the forbidden-path guard are P2C's committed
// `spikes/wd1-route-semantics/corpus.js`, reused unmodified -- the same
// arrangement P2C itself used for WD1.4's. Nothing here writes to a corpus tree,
// copies corpus content into this repository, or reads a White Dune path: the
// inherited guard THROWS on one rather than skipping it.
//
// NOT A VALIDATOR AND NOT A POLICY. A corpus `ILLEGAL` is a measurement, not a
// verdict on the document. Real content may be non-conforming, and C may be
// wrong -- which is why every distinct ILLEGAL rule is reported with a count and
// sanitized example ids for adjudication rather than being silently tallied.

const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const corpus = require(path.join(REPO_ROOT, 'spikes', 'wd1-route-semantics', 'corpus.js'));
const { ast } = require(path.join(REPO_ROOT, 'src', 'vrml'));
const sg = require(path.join(REPO_ROOT, 'src', 'vrml', 'scope-graph.js'));
const containment = require(path.join(REPO_ROOT, 'src', 'vrml', 'containment.js'));

const { CONTAINMENT_STATUS: CS, CONTAINMENT_REASON: CR, CANDIDATE_KIND } = containment;

const MAX_EXAMPLES = 5;

/**
 * Every SCENE-GRAPH node occurrence, in source order -- deliberately NOT
 * `ast.walk`.
 *
 * `ast.walk` descends into a PROTO interface declaration's DEFAULT VALUE, and a
 * node written there is not a node occurrence in the scene graph: P2A indexes no
 * type reference for it, so `interfaceSourceOf` throws `ESCOPEPARSE` on it. That
 * is an inherited P2A/WD1.6-B boundary, not C's to widen (a default value is a
 * prototype's declared value, not a child placed in a parent's field), so the
 * traversal simply does not go there.
 *
 * Roots are the document's own statements plus every PROTO body's, recursively.
 * Node-valued fields are followed into their children; nothing else is.
 */
function forEachSceneNode(tree, visit) {
  const walkStatements = (statements) => {
    if (!Array.isArray(statements)) return;
    for (const statement of statements) {
      if (!statement || typeof statement !== 'object') continue;
      if (statement.type === ast.NODE.NODE) walkNode(statement);
      else if (statement.type === ast.NODE.PROTO) walkStatements(statement.body);
    }
  };
  const walkNode = (node) => {
    visit(node);
    if (!Array.isArray(node.fields)) return;
    for (const field of node.fields) {
      if (!field || typeof field !== 'object') continue;
      // 4.8.3 / WD.md §8: a node body's ROUTE and PROTO statements land in
      // `fields` too. Dispatch on `type`, never on position.
      if (field.type === ast.NODE.PROTO) { walkStatements(field.body); continue; }
      if (field.type !== ast.NODE.FIELD) continue;
      for (const child of placementsIn(field.value)) {
        if (child.type === ast.NODE.NODE) walkNode(child);
      }
    }
  };
  walkStatements(tree && tree.statements);
}

/** Every node written directly into one field's value, in source order. */
function placementsIn(fieldValue) {
  if (!fieldValue || typeof fieldValue !== 'object') return [];
  if (fieldValue.type === ast.NODE.NODE || fieldValue.type === ast.NODE.USE) return [fieldValue];
  if (fieldValue.type === ast.NODE.ARRAY && Array.isArray(fieldValue.items)) {
    return fieldValue.items.filter((i) => i
      && (i.type === ast.NODE.NODE || i.type === ast.NODE.USE));
  }
  return [];
}

function newCounters() {
  return {
    parentNodesExamined: 0,
    fieldOccurrencesExamined: 0,
    nodeValuedFieldOccurrences: 0,
    placementsExamined: 0,
    byStatus: Object.create(null),
    byReason: Object.create(null),
    byCandidateKind: Object.create(null),
    metadataCovered: 0,
    metadataUncovered: 0,
    exclusionCompleteRule: 0,
    positiveOnlyRule: 0,
    illegalRules: Object.create(null),
    uncoveredFields: Object.create(null),
    documentsWithPlacements: 0,
    documentsWithIllegal: 0,
    judgeErrors: 0,
    judgeErrorExamples: [],
  };
}

const bump = (table, key) => { table[key] = (table[key] || 0) + 1; };

/**
 * One document's placements, judged.
 *
 * `judge` is injected so `controls.js` can substitute a MUTATED judge and prove
 * the counters actually move. A harness whose numbers a broken implementation
 * would not change is a passive counter, not evidence.
 */
function sweepDocument(parsed, docId, counters, judge = containment.childLegality) {
  let graph;
  try {
    graph = sg.buildScopeGraph(parsed);
  } catch (err) {
    return { graphError: String(err && err.message).slice(0, 200) };
  }

  let placements = 0;
  let illegal = 0;

  forEachSceneNode(parsed.tree, (node) => {
    if (!Array.isArray(node.fields)) return;
    counters.parentNodesExamined += 1;
    for (const field of node.fields) {
      if (!field || field.type !== ast.NODE.FIELD) continue;
      const written = placementsIn(field.value);
      if (!written.length) continue;
      counters.fieldOccurrencesExamined += 1;

      let arityKnown = false;
      for (const candidate of written) {
        // A throw is RECORDED, never swallowed and never fatal: an unexpected
        // one is a finding, and a harness that dies on the first is a harness
        // that reports nothing. `run.js` fails the run on a non-zero count.
        let v;
        try {
          v = judge(graph, node, field.name, candidate);
        } catch (err) {
          counters.judgeErrors += 1;
          if (counters.judgeErrorExamples.length < MAX_EXAMPLES) {
            counters.judgeErrorExamples.push({
              id: docId,
              field: `${node.nodeType}.${field.name}`,
              code: err && err.code ? err.code : null,
              message: String(err && err.message).slice(0, 200),
            });
          }
          continue;
        }
        if (!v.arity) continue; // not a node-valued declaration -- not a placement
        if (!arityKnown) { counters.nodeValuedFieldOccurrences += 1; arityKnown = true; }

        counters.placementsExamined += 1;
        placements += 1;
        bump(counters.byStatus, v.status);
        bump(counters.byReason, `${v.status}/${v.reason}`);
        bump(counters.byCandidateKind, (v.candidate && v.candidate.kind) || 'unproven-type');

        if (v.required) {
          counters.metadataCovered += 1;
          if (v.required.exclusionComplete) counters.exclusionCompleteRule += 1;
          else counters.positiveOnlyRule += 1;
        } else {
          counters.metadataUncovered += 1;
          const key = `${node.nodeType}.${field.name}`;
          const slot = counters.uncoveredFields[key] || (counters.uncoveredFields[key] = { count: 0, examples: [] });
          slot.count += 1;
          if (slot.examples.length < MAX_EXAMPLES && !slot.examples.includes(docId)) slot.examples.push(docId);
        }

        if (v.status === CS.ILLEGAL) {
          illegal += 1;
          // Keyed on the RULE, not the document: adjudication is per rule, and a
          // rule producing thousands of hits needs reading once, not once each.
          // NULL-SAFE ON PURPOSE. An ILLEGAL with no acceptance rule behind it is
          // precisely the defect the reconciliation below exists to catch, so it
          // must be RECORDED rather than crash the sweep -- a harness that dies
          // on the bug it is looking for reports nothing at all.
          const rules = (v.required && v.required.rules) ? [...v.required.rules] : [];
          const candType = (v.candidate && v.candidate.nodeType) || null;
          const key = `${v.reason}|${rules.join('+')}`
            + `|${node.nodeType}.${field.name}|${candType}`;
          const slot = counters.illegalRules[key] || (counters.illegalRules[key] = {
            reason: v.reason,
            rules,
            field: `${node.nodeType}.${field.name}`,
            candidateType: candType,
            candidateKind: (v.candidate && v.candidate.kind) || null,
            derivationDepth: v.candidate ? v.candidate.derivation.length : 0,
            count: 0,
            examples: [],
          });
          slot.count += 1;
          if (slot.examples.length < MAX_EXAMPLES && !slot.examples.includes(docId)) slot.examples.push(docId);
        }
      }
    }
  });

  if (placements) counters.documentsWithPlacements += 1;
  if (illegal) counters.documentsWithIllegal += 1;
  return { placements, illegal };
}

/** Definitive = a terminal answer was reached. The numerator of the headline. */
function definitive(counters) {
  return (counters.byStatus[CS.LEGAL] || 0) + (counters.byStatus[CS.ILLEGAL] || 0);
}

/** Every partition must reconcile to the placement total or the run is void. */
function reconcile(counters) {
  const problems = [];
  const total = counters.placementsExamined;
  const sum = (table) => Object.values(table).reduce((a, b) => a + b, 0);
  if (sum(counters.byStatus) !== total) problems.push('byStatus does not sum to placements');
  if (sum(counters.byReason) !== total) problems.push('byReason does not sum to placements');
  if (sum(counters.byCandidateKind) !== total) problems.push('byCandidateKind does not sum to placements');
  if (counters.metadataCovered + counters.metadataUncovered !== total) {
    problems.push('metadata coverage does not sum to placements');
  }
  if (counters.exclusionCompleteRule + counters.positiveOnlyRule !== counters.metadataCovered) {
    problems.push('rule completeness does not sum to metadata-covered');
  }
  const illegalTallied = Object.values(counters.illegalRules).reduce((a, r) => a + r.count, 0);
  if (illegalTallied !== (counters.byStatus[CS.ILLEGAL] || 0)) {
    problems.push('illegal rule distribution does not sum to the ILLEGAL count');
  }
  // The hard invariant: an ILLEGAL may only be produced by an exclusion-complete
  // rule. This is the safety property the whole lane is arranged around, so it is
  // checked over the real corpus and not only in the focused tests.
  for (const rule of Object.values(counters.illegalRules)) {
    if (!rule.rules.length) {
      problems.push(`ILLEGAL produced with NO acceptance rule: ${rule.field} <- ${rule.candidateType}`);
    } else if (!rule.rules.every((id) => containment.EXCLUSION_COMPLETE_RULES.includes(id))) {
      problems.push(`ILLEGAL produced by a positive-only rule: ${rule.field} <- ${rule.candidateType}`);
    }
  }
  return problems;
}

module.exports = {
  MAX_EXAMPLES,
  forEachSceneNode,
  placementsIn,
  newCounters,
  sweepDocument,
  definitive,
  reconcile,
  corpus,
  CS,
  CR,
  CANDIDATE_KIND,
};
