'use strict';
// WD1.7-D -- external PROTO interface and class enrichment.
// NODE-ONLY ENTRY POINT.
//
// The layer that answers the two external semantic questions WD1.6 could not
// establish locally, given a target WD1.7-C already proved:
//
//   1. ISO 4.9.2 -- does the local EXTERNPROTO interface satisfy the selected
//      implementation's?  (`external.interface`)
//   2. ISO 4.8.3 -- what implementation class can now be externally proven?
//      (`external.implementationClass`)
//
// It sits ON TOP of four closed authorities and replaces none of them:
//
//     WD1.7-D orchestration              (this directory)
//       |-- WD1.7-C  proto-resolution    target selection + dependency traversal
//       |-- WD1.6-C  vrml .containment   ISO 4.8.3, the ONE class authority
//       |-- WD1.7-D  vrml .protoAgreement  ISO 4.9.2, PURE
//       `-- WD1.6-B  vrml .interfaceQuery   the scope graphs all of them read
//
// The import direction is strictly downward. Nothing in `src/vrml`,
// `src/external-proto`, `src/proto-resolution` or `src/world-project` requires
// this directory, and the browser-safe semantic facade stays free of `fs`.
//
// THE SPLIT, and why it is where it is:
//
//   `src/vrml/proto-agreement.js`   PURE. "Do these two DECLARED interfaces
//                                   satisfy 4.9.2?" Two scope graphs in, a frozen
//                                   agreement out. No URL, no base, no
//                                   filesystem, no retrieval. 4.9.2 is a
//                                   statement about two documents, so it belongs
//                                   beside the parser.
//   `src/vrml/containment.js`       PURE, and UNCHANGED in what it decides.
//                                   `protoImplementationClass` is the same 4.8.3
//                                   derivation `childLegality` has always run,
//                                   entered at a declaration instead of at an
//                                   occurrence.
//   `external-enrichment.js`        NODE. "Which proven target, and what does
//                                   C's graph say about the next generation?"
//
// WHERE D STOPS. It proves an interface relationship and an implementation
// class, and hands both on with provenance. It does NOT retrieve, select a
// target, route a url, compute an ISO 4.5.3 base, decide UI severity, write a
// message, alter `childLegality`, change World Project packaging, or populate
// `compatibility` -- that slot is permanently `null` and belongs to WD1.7-E,
// which is BLOCKED. No compatibility-profile identifier is spelled anywhere in
// this lane.
//
// AND STRICT-LOCAL SEMANTICS ARE UNCHANGED BY ITS EXISTENCE. Every WD1.6 query
// answers exactly as it did before, because none of them can reach anything
// here: no WD1.6 module accepts a resolver context, and the strict verdict this
// lane reports is obtained by calling the strict authority itself.

const { protoAgreement } = require('../vrml');
const {
  ENRICHMENT_STATUS,
  ENRICHMENT_REASON,
  EXTERNAL_CLASS_STATUS,
  EXTERNAL_CLASS_REASON,
  createEnrichmentSession,
  enrichExternalPrototype,
} = require('./external-enrichment');

module.exports = Object.freeze({
  // the one primary operation
  enrichExternalPrototype,
  // an operation-scoped, disposable scope-graph cache; optional, never global
  createEnrichmentSession,
  // constant tables a consumer branches on
  ENRICHMENT_STATUS,
  ENRICHMENT_REASON,
  EXTERNAL_CLASS_STATUS,
  EXTERNAL_CLASS_REASON,
  // The ISO 4.9.2 tables, re-exported by IDENTITY from `src/vrml`.protoAgreement
  // rather than copied: an `external.interface.status` and a direct
  // `compareInterfaceAgreement` call must compare equal, and two frozen tables
  // with the same keys would not make that obvious.
  AGREEMENT_STATUS: protoAgreement.AGREEMENT_STATUS,
  MEMBER_STATUS: protoAgreement.MEMBER_STATUS,
  AGREEMENT_FINDING: protoAgreement.AGREEMENT_FINDING,
  AGREEMENT_BASIS: protoAgreement.AGREEMENT_BASIS,
  AGREEMENT_REASON: protoAgreement.AGREEMENT_REASON,
});

// NOT exported, and intentionally so. The class walk, the provenance projector
// and the dependency-graph lookups are this lane's own composition; adding to
// the surface above is a decision, not a convenience -- the same rule WD1.7-B's
// and WD1.7-C's facades state, for the same reason.
