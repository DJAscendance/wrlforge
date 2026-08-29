'use strict';
// WD1.6-B -- the projection-equivalence comparison rule.
//
// Pure and dependency-light on purpose: `run.js` supplies the corpus and the
// counting, this file decides what "agrees" means, and `test.js` grades this
// file against authored cases. Splitting them is what makes the rule reviewable
// without reading a sweep.
//
// WHAT IS BEING PROVED. `effectiveInterfaceOf` must be an ENUMERATION of the
// shipped endpoint authority, not a second resolver. So the comparison is made
// at the LOWEST available acquisition level -- the endpoint record itself --
// and deliberately NOT against a verdict:
//
//   * `isConnectionVerdict(...).endpoint` is minted directly from acquisition
//     BEFORE Table 4.4 is applied, so comparing it compares acquisition;
//   * `routeEndpointFor(...)` is likewise the record acquisition produced,
//     before 4.10.2's direction rule is applied.
//
// Table 4.4, direction legality and type matching are downstream POLICY. They
// are not part of this claim and are not compared. A lane that compared verdicts
// would pass or fail for reasons that have nothing to do with one-authority.

const BUILTIN_SCHEMA = 'builtin-schema';

/**
 * 4.10.2's ROUTE shorthand spelling, reconstructed FOR COMPARISON ONLY.
 *
 * A ROUTE reports its endpoint under the name the author WROTE, even when the
 * fallback fired and a different declaration answered. The projection has no
 * such rule -- it enumerates declarations and their 4.7 alias names, and 4.10.2
 * shorthand is a different rule running in the opposite direction.
 *
 * So the harness normalizes the written name to the spelling that actually
 * resolved before looking it up. This is the HARNESS reconstructing ROUTE's own
 * rule to line two answers up; `interface-query.js` still never manufactures a
 * shorthand binding, and nothing here is imported by production.
 */
function routeShorthandFor(name, side) {
  return side === 'source' ? `${name}_changed` : `set_${name}`;
}

/**
 * Which written name in the projection should answer for this endpoint?
 *
 * `viaShorthand` is not on the published endpoint record, so it is detected
 * through the resolution's `detail`, which is where P2C reports it.
 */
function lookupNameFor(writtenName, side, detail) {
  return detail === 'route-endpoint-via-shorthand'
    ? routeShorthandFor(writtenName, side)
    : writtenName;
}

/**
 * Compare one shipped endpoint record against the projection's binding.
 *
 * @returns {{ok: boolean, field: string|null, expected: *, actual: *}}
 */
function compareEndpoint(binding, endpoint) {
  if (!binding) {
    return { ok: false, field: 'binding-missing', expected: endpoint.effectiveName, actual: null };
  }
  if (binding.status !== 'resolved') {
    return { ok: false, field: 'status', expected: 'resolved', actual: binding.status };
  }
  const member = binding.member;
  if (!member) {
    return { ok: false, field: 'member', expected: endpoint.effectiveName, actual: null };
  }
  const checks = [
    ['origin', endpoint.origin, member.declarationOrigin],
    ['effectiveName', endpoint.effectiveName, member.name],
    ['access', endpoint.access, binding.effectiveAccess],
    ['type', endpoint.type, member.type],
  ];
  // `range` is comparable only for a DECLARED endpoint. A clause-6 built-in is
  // declared nowhere in the file, so acquisition reports the REFERENCE's own
  // range there while the projection honestly reports `null`. Comparing them
  // would be comparing two different questions.
  if (endpoint.origin !== BUILTIN_SCHEMA) {
    checks.push(['declRange', endpoint.range, member.declRange]);
  }
  for (const [field, expected, actual] of checks) {
    if (expected !== actual) return { ok: false, field, expected, actual };
  }
  return { ok: true, field: null, expected: null, actual: null };
}

/**
 * Compare the projection's binding against the raw shared authority.
 *
 * The third leg of the triangle. Endpoint records above prove the SHIPPED paths
 * agree with the projection; this proves the projection agrees with the
 * authority both of them call, so a pass cannot come from the authority merely
 * agreeing with itself.
 */
function compareAcquisition(binding, acquired) {
  if (!binding) {
    return { ok: false, field: 'binding-missing', expected: acquired.status, actual: null };
  }
  if (binding.status !== acquired.status) {
    return { ok: false, field: 'status', expected: acquired.status, actual: binding.status };
  }
  if (binding.reason !== acquired.reason) {
    return { ok: false, field: 'reason', expected: acquired.reason, actual: binding.reason };
  }
  if (!acquired.endpoint) return { ok: true, field: null, expected: null, actual: null };
  const checks = [
    ['access', acquired.endpoint.access, binding.effectiveAccess],
    ['form', acquired.endpoint.form, binding.form],
    ['viaAlias', acquired.endpoint.viaAlias, binding.viaAlias],
  ];
  for (const [field, expected, actual] of checks) {
    if (expected !== actual) return { ok: false, field, expected, actual };
  }
  return { ok: true, field: null, expected: null, actual: null };
}

module.exports = { routeShorthandFor, lookupNameFor, compareEndpoint, compareAcquisition };
