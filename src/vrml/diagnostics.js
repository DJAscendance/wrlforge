'use strict';
// Diagnostic model for the VRML97 parser (Phase 7A).
//
// Pure data + stable codes. No Electron, no fs -- every consumer (tokenizer,
// parser, semantic analysis, asset-refs) produces Diagnostic records of the same
// shape so a future editor can render squiggles, a problems list, and go-to-
// definition uniformly. Codes are STABLE: downstream UI, tests, and docs key off
// them, so never renumber an existing code -- only add new ones.

const SEVERITY = Object.freeze({
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
  HINT: 'hint',
});

// Stable diagnostic codes. Grouped by producer; gaps left intentionally so new
// codes slot in without renumbering. NEVER change an existing string value.
const CODE = Object.freeze({
  // --- tokenizer (lexical) ---
  UNTERMINATED_STRING: 'VRML010',
  INVALID_NUMBER: 'VRML011',
  UNEXPECTED_CHAR: 'VRML012',

  // --- parser (syntax) ---
  MISSING_HEADER: 'VRML001',
  INVALID_HEADER: 'VRML002',
  EXPECTED_TOKEN: 'VRML020',
  UNEXPECTED_TOKEN: 'VRML021',
  EXPECTED_FIELD_VALUE: 'VRML022',
  UNCLOSED_BRACE: 'VRML023',
  UNCLOSED_BRACKET: 'VRML024',
  EXPECTED_NODE: 'VRML025',
  EXPECTED_IDENTIFIER: 'VRML026',
  EXPECTED_INTERFACE: 'VRML027',

  // --- safety limits ---
  MAX_DEPTH: 'VRML030',
  MAX_TOKENS: 'VRML031',
  MAX_NODES: 'VRML032',

  // --- semantic (index) ---
  DUPLICATE_DEF: 'VRML040',
  UNRESOLVED_USE: 'VRML041',
  UNRESOLVED_ROUTE_SOURCE: 'VRML042',
  UNRESOLVED_ROUTE_TARGET: 'VRML043',
  DUPLICATE_ROUTE: 'VRML044',
});

// Build a Diagnostic. `range` is a {start,end} span (see tokenizer positions).
// Optional: `expected` (token/construct that was wanted), `related` (array of
// {message, range} pointing at e.g. the first DEF for a duplicate).
function makeDiagnostic(severity, code, message, range, extra = {}) {
  const d = { severity, code, message, range: range || null };
  if (extra.expected != null) d.expected = extra.expected;
  if (extra.related != null) d.related = extra.related;
  return d;
}

// Convenience constructors, one per severity.
const error = (code, message, range, extra) =>
  makeDiagnostic(SEVERITY.ERROR, code, message, range, extra);
const warning = (code, message, range, extra) =>
  makeDiagnostic(SEVERITY.WARNING, code, message, range, extra);
const info = (code, message, range, extra) =>
  makeDiagnostic(SEVERITY.INFO, code, message, range, extra);
const hint = (code, message, range, extra) =>
  makeDiagnostic(SEVERITY.HINT, code, message, range, extra);

module.exports = { SEVERITY, CODE, makeDiagnostic, error, warning, info, hint };
