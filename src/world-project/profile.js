'use strict';
// The World Project validation profile -- deliberately, structurally separate
// from validator.js (Mall Item rules). Pure: no Electron, no fs.
//
// This module exists to make the profile boundary explicit and testable:
//   * MALL_ONLY_RULES enumerates the Mall Item rules that MUST NOT be applied to
//     a World Project (a test asserts none of these leak into world analysis),
//   * classifyFindings() turns an asset graph into world diagnostics, each tagged
//     with a CONFIDENCE level so the UI never presents an unconfirmed historical
//     figure (like the ~20-texture web-form limit) as a current server rule.
//
// Confidence levels (from AGENTS.md / docs/WORLD_PROJECT_RECON.md):
//   confirmed          -- an actual, evidence-backed current constraint
//   historical         -- past behavior, not known to be a current server rule
//   runtime-warning    -- likely to break at load time (missing/case/traversal)
//   performance         -- advisory only (large asset counts / bytes)
//   unknown             -- a current Cybertown requirement we have NOT confirmed
const CONFIDENCE = Object.freeze({
  CONFIRMED: 'confirmed',
  HISTORICAL: 'historical',
  RUNTIME_WARNING: 'runtime-warning',
  PERFORMANCE: 'performance',
  UNKNOWN: 'unknown',
});

// Mall Item rules that are NOT World Project rules. World analysis must never
// apply these; they are listed so their absence can be asserted in tests and
// documented for readers. (Evidence: real worlds are complete buildings with
// many textures, nested Inline composition, and no single-item placement box.)
const MALL_ONLY_RULES = Object.freeze([
  'one-texture-limit',
  'ground-y--1.75',
  'center-x-0',
  'max-z-+1',
  'bounds-10x10x10',
  'scale-125-percent',
  'no-complete-buildings',
  'no-inline',
  'gzip-80kb-cap',
]);

// Turn a graph into a flat list of world findings, each:
//   { code, severity, confidence, message, count }
// severity: 'error' | 'warning' | 'info'. Nothing here is enforced as a hard
// gate in this lane (no upload/packaging exists yet) -- these drive the UI's
// summary/notes so builders can act, and are honest about confidence.
function classifyFindings(graph) {
  const s = graph.stats || {};
  const out = [];

  if (s.missing > 0) {
    out.push({ code: 'missing-assets', severity: 'error', confidence: CONFIDENCE.RUNTIME_WARNING,
      count: s.missing, message: `${s.missing} referenced asset(s) not found on disk` });
  }
  if (s.caseMismatches > 0) {
    out.push({ code: 'case-mismatch', severity: 'error', confidence: CONFIDENCE.RUNTIME_WARNING,
      count: s.caseMismatches, message: `${s.caseMismatches} reference(s) differ only by filename case (breaks on a case-sensitive server)` });
  }
  if (s.unsafe > 0) {
    out.push({ code: 'unsafe-path', severity: 'error', confidence: CONFIDENCE.RUNTIME_WARNING,
      count: s.unsafe, message: `${s.unsafe} reference(s) use an absolute path or escape the project root` });
  }
  if (s.cycles > 0) {
    out.push({ code: 'dependency-cycle', severity: 'warning', confidence: CONFIDENCE.RUNTIME_WARNING,
      count: s.cycles, message: `${s.cycles} Inline dependency cycle(s) detected (traversal was bounded)` });
  }
  if (s.remoteRefs > 0) {
    out.push({ code: 'remote-reference', severity: 'warning', confidence: CONFIDENCE.UNKNOWN,
      count: s.remoteRefs, message: `${s.remoteRefs} remote URL reference(s) (surfaced, never fetched; server support unknown)` });
  }
  if (graph.truncated) {
    out.push({ code: 'graph-truncated', severity: 'warning', confidence: CONFIDENCE.PERFORMANCE,
      message: 'dependency graph hit the node cap; not all files were walked' });
  }
  if (graph.depthCapped) {
    out.push({ code: 'graph-depth-capped', severity: 'warning', confidence: CONFIDENCE.PERFORMANCE,
      message: 'Inline nesting hit the depth cap; deeper files were not walked' });
  }

  // Texture count is INFORMATIONAL ONLY. The ~20-texture figure is a historical
  // web-form limit, NOT a current server constraint (real worlds reach ~70), so
  // it is never an error and never a hard cap here.
  out.push({ code: 'texture-count', severity: 'info', confidence: CONFIDENCE.HISTORICAL,
    count: s.uniqueTextures || 0,
    message: `${s.uniqueTextures || 0} unique textures (no fixed limit; ~20 was a web-form figure, not a server rule)` });

  return out;
}

module.exports = { CONFIDENCE, MALL_ONLY_RULES, classifyFindings };
