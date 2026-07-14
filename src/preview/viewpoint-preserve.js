'use strict';
// Phase 7C3 -- pure viewpoint-preservation resolver for the World live preview.
//
// When the editor's unsaved-buffer preview replaces the scene, the user's view
// must not reset unnecessarily. Before replacement the renderer captures the
// bound viewpoint's identity ({ name, description, index }); after the new scene
// renders it asks this module which viewpoint to re-bind. The priority order is
// locked (docs/PHASE_7C_PROPOSAL.md section 14):
//
//   1. exact DEF-name match          (the same authored node still exists)
//   2. exact description match       (renamed DEF, same label) -- but ONLY when
//      that description matches exactly one current viewpoint; duplicate
//      descriptions are never relied on
//   3. the previous index, if still valid
//   4. the first viewpoint
//   5. X_ITE's default view (bind nothing)
//
// Pure and DOM/X_ITE-free: identities in, a { action, index, matchedBy } decision
// out, so every fallback rule unit-tests in Node. The renderer does the actual
// bindViewpoint call. This module never navigates, never binds, never renders.

// Normalize a captured identity field: a non-empty string or null.
function norm(v) {
  return typeof v === 'string' && v !== '' ? v : null;
}

// Decide which of `current` (an array of { name, description }) to re-bind after
// a scene replacement, given `prev` (the identity captured before it). Returns:
//   { action: 'bind', index, matchedBy: 'def'|'description'|'index'|'first' }
//   { action: 'none', matchedBy: 'default' }   -- leave X_ITE's default view
function resolveViewpointRestore(prev, current) {
  const list = Array.isArray(current) ? current : [];

  // Nothing was bound before (or nothing captured): do not force a bind -- the
  // new scene's own default binding (its first viewpoint, per VRML97) stands.
  if (!prev || typeof prev !== 'object') {
    return { action: 'none', matchedBy: 'default' };
  }
  if (list.length === 0) return { action: 'none', matchedBy: 'default' };

  const prevName = norm(prev.name);
  if (prevName) {
    const i = list.findIndex((vp) => vp && norm(vp.name) === prevName);
    if (i >= 0) return { action: 'bind', index: i, matchedBy: 'def' };
  }

  const prevDesc = norm(prev.description);
  if (prevDesc) {
    const matches = [];
    list.forEach((vp, i) => { if (vp && norm(vp.description) === prevDesc) matches.push(i); });
    // Exactly one match required: duplicate descriptions are ambiguous, so the
    // resolver falls through to the index rule rather than guessing.
    if (matches.length === 1) return { action: 'bind', index: matches[0], matchedBy: 'description' };
  }

  const idx = prev.index;
  if (Number.isInteger(idx) && idx >= 0 && idx < list.length) {
    return { action: 'bind', index: idx, matchedBy: 'index' };
  }

  return { action: 'bind', index: 0, matchedBy: 'first' };
}

// A module-unique name (see preview-state.js): this file is also loaded as a
// plain browser <script> in editor.html's shared global scope.
const VIEWPOINT_PRESERVE_API = { resolveViewpointRestore };

// Dual use: CommonJS for main/tests AND a window global for the renderer.
if (typeof module !== 'undefined' && module.exports) module.exports = VIEWPOINT_PRESERVE_API;
if (typeof window !== 'undefined') window.WrlViewpointPreserve = VIEWPOINT_PRESERVE_API; // eslint-disable-line no-undef
