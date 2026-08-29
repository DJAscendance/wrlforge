'use strict';
// Shared fixture support for the WD1.7-D suites. NOT a test file (the runner
// collects `*.test.js` only).
//
// It builds on WD1.7-C's own archive helper rather than a second one: D consumes
// C's evidence, so the evidence D is tested against must be produced by the real
// C path over a real filesystem -- exact-case lookup, gzip-by-magic and archive
// containment are WD1.7-B's contracts and D must sit on top of them.

const { parse, interfaceQuery } = require('../../src/vrml');
const {
  resolveExternalPrototype, buildExternalDependencyGraph,
} = require('../../src/proto-resolution');
const { makeArchive, cleanupArchives, H } = require('../proto-resolution/fixture-archive');

/**
 * Materialise `files`, resolve the single EXTERNPROTO of `rootPath` through C,
 * and hand back everything D needs -- plus the C dependency graph.
 *
 * @param {object} files POSIX-relative path -> contents.
 * @param {string} rootPath Which of them is the declaring document.
 * @param {object} [opts] `{ index, maxDepth, sources }`.
 */
function scenario(files, rootPath, opts = {}) {
  const { context } = makeArchive(files, opts.sources);
  const parseResult = parse(files[rootPath]);
  const graph = interfaceQuery.buildScopeGraph(parseResult);
  const externs = parseResult.tree.statements.filter((s) => s.type === 'ExternProto');
  const declaration = externs[opts.index || 0];
  const baseDocument = { sourceId: 'archive', path: rootPath };
  const resolution = resolveExternalPrototype({
    context, baseDocument, parseResult, declaration,
  });
  const dependencyGraph = buildExternalDependencyGraph(parseResult, {
    context, baseDocument, ...(opts.maxDepth == null ? {} : { maxDepth: opts.maxDepth }),
  });
  return { context, parseResult, graph, declaration, baseDocument, resolution, dependencyGraph };
}

module.exports = { H, scenario, cleanupArchives };
