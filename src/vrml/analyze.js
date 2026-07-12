'use strict';
// Lightweight semantic index over the VRML97 AST (Phase 7A).
//
// Kept SEPARATE from parsing: this pass takes a syntax tree and produces a
// name/route index plus semantic diagnostics (duplicate DEF, unresolved USE,
// dangling/duplicate ROUTE endpoints). It does NOT do runtime type validation --
// that needs a node/field-type schema and is deliberately out of 7A scope.
//
// Scope model (7A): a single flat document scope. PROTO bodies introduce their own
// scope in VRML97; treating them flatly can under-report a shadowed name -- called
// out as a known limitation. Ordering (USE-before-DEF) is likewise not enforced
// yet; resolution is by existence anywhere in the document.

const { NODE, walk } = require('./ast');
const { CODE, error, warning } = require('./diagnostics');

function analyze(tree) {
  const diagnostics = [];
  const defs = []; // { name, range, node }
  const defsByName = new Map();
  const duplicateDefs = [];
  const uses = []; // { name, range, resolved }
  const routes = []; // { from, to, range, resolvedFrom, resolvedTo }

  if (!tree) {
    return { defs, defsByName, duplicateDefs, uses, routes, diagnostics };
  }

  // Pass 1: collect every DEF (a Node carrying a def name).
  walk(tree, (node) => {
    if (node.type === NODE.NODE && node.def) {
      const rec = { name: node.def, range: node.defRange || node.range, node };
      defs.push(rec);
      if (defsByName.has(node.def)) {
        duplicateDefs.push(rec);
        const first = defsByName.get(node.def);
        diagnostics.push(error(CODE.DUPLICATE_DEF,
          `Duplicate DEF '${node.def}'`, rec.range,
          { related: [{ message: `first defined here`, range: first.range }] }));
      } else {
        defsByName.set(node.def, rec);
      }
    }
  });

  // Pass 2: USE references and ROUTE endpoints resolve against the DEF table.
  walk(tree, (node) => {
    if (node.type === NODE.USE) {
      const resolved = node.name != null && defsByName.has(node.name);
      uses.push({ name: node.name, range: node.range, resolved });
      if (node.name != null && !resolved) {
        diagnostics.push(error(CODE.UNRESOLVED_USE,
          `USE references undefined DEF '${node.name}'`, node.range));
      }
    } else if (node.type === NODE.ROUTE) {
      const resolvedFrom = node.from && node.from.node != null && defsByName.has(node.from.node);
      const resolvedTo = node.to && node.to.node != null && defsByName.has(node.to.node);
      const rec = { from: node.from, to: node.to, range: node.range, resolvedFrom, resolvedTo };
      routes.push(rec);
      if (node.from && node.from.node != null && !resolvedFrom) {
        diagnostics.push(error(CODE.UNRESOLVED_ROUTE_SOURCE,
          `ROUTE source references undefined DEF '${node.from.node}'`,
          node.from.nodeRange || node.range));
      }
      if (node.to && node.to.node != null && !resolvedTo) {
        diagnostics.push(error(CODE.UNRESOLVED_ROUTE_TARGET,
          `ROUTE destination references undefined DEF '${node.to.node}'`,
          node.to.nodeRange || node.range));
      }
    }
  });

  // Duplicate ROUTE detection (same source node.event -> same dest node.event).
  const seenRoutes = new Set();
  for (const r of routes) {
    const key = `${r.from && r.from.node}.${r.from && r.from.event}->${r.to && r.to.node}.${r.to && r.to.event}`;
    if (r.from && r.from.node && r.to && r.to.node) {
      if (seenRoutes.has(key)) {
        diagnostics.push(warning(CODE.DUPLICATE_ROUTE, `Duplicate ROUTE ${key}`, r.range));
      } else {
        seenRoutes.add(key);
      }
    }
  }

  return { defs, defsByName, duplicateDefs, uses, routes, diagnostics };
}

module.exports = { analyze };
