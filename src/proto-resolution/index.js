'use strict';
// WD1.7-C -- external PROTO target selection and dependency traversal.
// NODE-ONLY ENTRY POINT.
//
// The layer that turns "we obtained these bytes" into "this is the prototype
// implementation the EXTERNPROTO refers to". It sits ON TOP of three closed
// authorities and replaces none of them:
//
//     WD1.7-C orchestration            (this directory)
//       |-- WD1.7-B public facade      retrieval, routing, containment, gzip
//       |-- src/vrml .parse            the ONE syntax authority
//       `-- src/vrml .protoTarget      the pure ISO 4.9.3 selector, and
//           src/vrml .interfaceQuery   WD1.5-P2A type resolution
//
// The import direction is strictly downward. Nothing here is required by
// `src/vrml`, by `src/external-proto` or by `src/world-project`; the browser-safe
// semantic facade stays free of `fs`, `zlib` and `crypto`, and the pure half of
// this lane lives there rather than here precisely so it can.
//
// THE SPLIT, and why it is where it is:
//
//   `src/vrml/proto-target.js`  PURE. "Which PROTO does THIS DOCUMENT supply?"
//                               A parse result and a written fragment in, a
//                               frozen selection out. No URL, no base, no
//                               filesystem. ISO 4.9.3 is a statement about a
//                               document, so it belongs beside the parser.
//   `external-resolver.js`      NODE. "Which CANDIDATE supplies it?" The ISO
//                               4.5.2 ordered walk, stopping on RESOLVED and
//                               only on RESOLVED.
//   `dependency-graph.js`       NODE. "What follows from it?" ISO 4.5.3 base
//                               propagation, instantiation-driven traversal,
//                               and cycle detection on the ratified tuple.
//
// WHERE C STOPS. It proves a target and hands the proof on. It does NOT compare
// the local EXTERNPROTO interface against the target's (ISO 4.9.2 -- WD1.7-D),
// derive the target's implementation class (4.8.3 -- WD1.7-D), enrich any
// WD1.6-B/C answer, or populate `compatibility` (WD1.7-E, BLOCKED). Strict-local
// WD1.6 results are unchanged by this lane's existence: nothing here is reachable
// from a query that has no resolver context.
//
// AND IT REWRITES NOTHING. No EXTERNPROTO-to-PROTO substitution, no url
// rewriting, no inlining, no dead-reference replacement (WD1.7-A §11). The
// canonical source text is untouched, and every AST handle a result exposes is a
// parse-lifetime projection, never a persistent identity (WD.md §2/§7).

const {
  RESOLUTION_STATUS,
  RESOLUTION_REASON,
  SELECTION_STATUS,
  SELECTION_RULE,
  createResolutionSession,
  resolveExternalPrototype,
} = require('./external-resolver');
const {
  TRAVERSAL_STATUS, INCOMPLETENESS_REASON, buildExternalDependencyGraph,
} = require('./dependency-graph');

module.exports = Object.freeze({
  // the two primary operations
  resolveExternalPrototype,
  buildExternalDependencyGraph,
  // an operation-scoped, disposable parse cache; optional, and never global
  createResolutionSession,
  // constant tables a consumer branches on. `SELECTION_*` are re-exported by
  // IDENTITY from `src/vrml`.protoTarget rather than copied: one candidate's
  // `selection.status` and a direct `selectPrototypeTarget` call must compare
  // equal, and two frozen tables with the same keys would not make that obvious.
  RESOLUTION_STATUS,
  RESOLUTION_REASON,
  TRAVERSAL_STATUS,
  // Why a graph declined to call itself complete. Published because a consumer
  // that must not act on a partial dependency set has to be able to branch on
  // WHICH limit it hit -- a bare `complete: false` is not actionable.
  INCOMPLETENESS_REASON,
  SELECTION_STATUS,
  SELECTION_RULE,
});

// NOT exported, and intentionally so. `dependency-graph.js`'s `_internals` (the
// cycle and memo key builders) exist for focused tests; the per-candidate
// projections and the frame model are this lane's own composition. Adding to the
// surface above is a decision, not a convenience -- the same rule WD1.7-B's
// facade states, for the same reason.
