'use strict';
// Phase 3A recon shim. The URL-field extractor was promoted to the production
// World Project profile in Phase 4A; this file re-exports it so the read-only
// `recon:world` CLI and its tests keep working against a single source of truth.
// New code should require ../../src/world-project/url-fields directly.
module.exports = require('../../src/world-project/url-fields');
