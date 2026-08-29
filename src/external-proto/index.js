'use strict';
// WD1.7-B -- external PROTO retrieval substrate. NODE-ONLY ENTRY POINT.
//
// THIS IS NOT PART OF THE BROWSER-SAFE `src/vrml` FACADE, and it must never be
// reachable from it. `require('../vrml')` stays free of `fs`, `zlib` and
// `crypto` so the renderer/editor bundle keeps loading pure semantic modules;
// this module is the opposite kind of thing -- a filesystem substrate -- and it
// lives in its own directory precisely so the import direction is one-way:
//
//     renderer / editor semantic layer
//              ^  structured retrieval evidence (plain frozen data)
//     Node-side retrieval substrate  (src/external-proto)
//              |
//              v  pure helpers only
//     src/files/vrml-file.js (gzip magic authority)
//
// It does not live in `src/world-project/` either: WD1.7-C, WD1.7-D and
// WD1.7-B2 all consume it, and putting it inside one profile would make that
// profile the owner of a cross-profile authority -- the exact shape WD1.7-A §16
// argues against when it makes B2 a CONSUMER rather than a second resolver.
//
// SCOPE. Retrieval only:
//
//     written candidate + explicit base + frozen context
//       -> classification -> configured routing -> safe filesystem retrieval
//       -> raw-byte validation -> gzip/UTF-8 decode -> immutable evidence
//
// and it STOPS there. No parsing of the retrieved text, no ISO 4.9.3 target
// selection, no `#fragment` lookup, no interface comparison, no class
// derivation, no dependency traversal, no cycle detection, no compatibility
// classification, no network, no writes.

const { createResolverContext, sourceById, DEFAULT_LIMITS } = require('./resolver-context');
const { classifyReference, REFERENCE_FORM, CLASSIFY_REASON } = require('./reference-forms');
const { ROUTE_REASON } = require('./routing');
const { retrieveExternalCandidate, RETRIEVAL_STATUS, RETRIEVAL_REASON } = require('./retrieval');

module.exports = Object.freeze({
  // configuration
  createResolverContext,
  sourceById,
  DEFAULT_LIMITS,
  // the one primary operation
  retrieveExternalCandidate,
  // pure classification, published because WD1.7-B2 needs to CLASSIFY the
  // EXTERNPROTO references it discovers without necessarily retrieving them
  classifyReference,
  // constant tables a caller branches on
  REFERENCE_FORM,
  RETRIEVAL_STATUS,
  RETRIEVAL_REASON,
  // reason vocabularies, so a consumer can render an explanation without
  // string-matching on literals
  CLASSIFY_REASON,
  ROUTE_REASON,
});

// NOT exported, and intentionally so. `routeCandidate` and `normalizeBaseDocument`
// are the substrate's own composition, and `retrieval.js`'s `_internals` are
// there for focused tests -- neither is a consumer-facing "you could also reach
// in here". Adding to the surface above is a decision, not a convenience.
