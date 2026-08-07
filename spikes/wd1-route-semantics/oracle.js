'use strict';
// WD1.5-P2C -- the INDEPENDENT expected-truth model for ROUTE semantics.
//
// =========================================================================
// THIS MODULE MAY NOT SEE THE THING IT GRADES
// =========================================================================
//
// The entire value of a "0 wrong bindings" claim rests on the grader being
// something other than the implementation compared against itself. That is
// enforced here structurally, three independent ways, not by convention:
//
//   1. The LOAD-TIME GUARD below throws if the production ROUTE resolver is
//      already loaded when this module is required. `run.js` therefore loads the
//      oracle FIRST, before the sweep pulls in `scope-graph.js`, which is what
//      makes the check meaningful rather than decorative.
//   2. `test.js` loads THIS FILE ALONE in a clean child process and asserts
//      `require.cache` afterwards contains neither `scope-graph.js` nor
//      `symbols.js`. That proves the absence transitively -- through every
//      module this one reaches, at any depth -- which a source scan cannot.
//   3. `test.js` also scans this source with comments stripped and asserts the
//      forbidden module names and helper names never appear.
//
// What it MAY use is deliberately narrow and all of it is semantically neutral
// infrastructure that predates this lane and answers a different question:
//
//   * `src/vrml` `parse()`      -- tokens and an AST. Shared substrate, no ROUTE
//                                  semantics whatsoever. Grading a resolver on a
//                                  DIFFERENT parse would grade the parser.
//   * `src/vrml/node-schema.js` -- WD1.3's generated ISO/x_ite FACT table: which
//                                  fields a built-in node has, their VRML97
//                                  declaration and their type token. Standards
//                                  data, not resolution logic.
//
// Everything semantic below is derived here, from the clause text, and
// duplicates the production tables ON PURPOSE:
//
//   * its own PROTO lexical stack and 4.8.4 DEF-scope disjointness;
//   * its own "defined before the ROUTE" visibility rule (4.10.2);
//   * its own duplicate-name refusal (4.6.2, no ranking -- WD.md §7);
//   * its own 4.7/4.8.2 exposedField alias expansion;
//   * its own 4.10.2 shorthand fallback and its direction-specific precondition;
//   * its own direction and exact-type expectations (4.10.2).
//
// FAIL-CLOSED BY DESIGN. Where the oracle cannot settle a question from the
// clause text and the schema alone it ABSTAINS with a named reason, and the
// abstention is COUNTED AND REPORTED rather than silently dropped. An oracle
// that guesses would manufacture false "wrong binding" reports; one that
// abstains quietly would hide real ones. Neither is acceptable, so every
// uncomparable site is named.

const path = require('path');

// ---------------------------------------------------------------------------
// 1. The load-time independence guard
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Written as path FRAGMENTS assembled at run time so that the literal module
// names the guard forbids do not appear in this file as requirable strings --
// the source scan in `test.js` checks for exactly that.
const VRML_DIR = path.join(REPO_ROOT, 'src', 'vrml');
const FORBIDDEN_PRODUCTION_MODULES = Object.freeze([
  path.join(VRML_DIR, ['scope', 'graph.js'].join('-')),
  path.join(VRML_DIR, 'symbols.js'),
]);

function assertProductionResolverNotLoaded(when) {
  const loaded = FORBIDDEN_PRODUCTION_MODULES.filter((m) => Object.prototype.hasOwnProperty
    .call(require.cache, m));
  if (loaded.length) {
    throw new Error(
      `WD1.5-P2C oracle independence violation (${when}): the production ROUTE `
      + `resolver is already loaded (${loaded.map((m) => path.basename(m)).join(', ')}). `
      + 'The oracle must be required BEFORE the production sweep so that its '
      + 'independence is provable. Load order in run.js is part of the evidence.',
    );
  }
}

assertProductionResolverNotLoaded('module load');

// Neutral infrastructure only. Note what is NOT here.
const { parse } = require(path.join(VRML_DIR, 'index.js'));
const schema = require(path.join(VRML_DIR, 'node-schema.js'));

// Requiring the façade must not have dragged the resolver in behind our back.
assertProductionResolverNotLoaded('after loading neutral infrastructure');

// ---------------------------------------------------------------------------
// 2. Vocabulary -- the oracle's own, deliberately NOT the production constants
// ---------------------------------------------------------------------------
//
// These are bare string literals authored here. Importing the production
// `STATUS`/`REASON`/`ACCESS` tables would be a dependency on the graded module
// dressed up as a convenience, and the duplication is the point.

/** What the oracle expects for a node name or an endpoint. */
const EXPECT = Object.freeze({
  /** Exactly one declaration is visible and it is this one. */
  BINDS: 'binds',
  /** The oracle is certain NOTHING should bind here. */
  NO_BINDING: 'no-binding',
  /** The oracle cannot settle this from the clause text + schema. Not graded. */
  ABSTAIN: 'abstain',
});

const ACCESS = Object.freeze({
  FIELD: 'field',
  EVENT_IN: 'eventIn',
  EVENT_OUT: 'eventOut',
  EXPOSED_FIELD: 'exposedField',
});

const SIDE = Object.freeze({ SOURCE: 'source', DESTINATION: 'destination' });

// A.2's `fieldType` production. Authored from the grammar, not imported.
const FIELD_TYPES = new Set([
  'SFBool', 'SFColor', 'SFFloat', 'SFImage', 'SFInt32', 'SFNode', 'SFRotation',
  'SFString', 'SFTime', 'SFVec2f', 'SFVec3f',
  'MFColor', 'MFFloat', 'MFInt32', 'MFNode', 'MFRotation', 'MFString', 'MFTime',
  'MFVec2f', 'MFVec3f',
]);

const DECLARED_ACCESS = new Set([ACCESS.FIELD, ACCESS.EVENT_IN, ACCESS.EVENT_OUT,
  ACCESS.EXPOSED_FIELD]);

// A marker stored in an interface map when one effective name is claimed twice.
// 4.3.5 prohibits the collision outright, so NEITHER declaration is the intended
// one and neither is returned -- choosing between them would be the ranking
// WD.md §7 bans.
const COLLIDED = Symbol('collided-effective-name');

// ---------------------------------------------------------------------------
// 3. The oracle's own lexical model
// ---------------------------------------------------------------------------
//
// 4.6.2: node names are limited in scope to a single VRML file OR PROTOTYPE
// DEFINITION, and a DEF'd node may be referenced later by USE **or ROUTE**.
// 4.8.4: a PROTO body's DEF/USE scope is separate from the rest of the scene and
// from nested PROTOs, IN BOTH DIRECTIONS -- disjointness, not shadowing, so a
// PROTO body scope has NO PARENT and a lookup simply stops there.

function newDefScope(kind, owner) {
  return { kind, owner, defs: new Map() };
}

function offsetOf(node) {
  return (node && node.range && node.range.start && node.range.start.offset) || 0;
}

/**
 * Walk a parse tree and collect, independently:
 *   - every DEF declaration, per disjoint DEF scope, with its source offset;
 *   - every PROTO / EXTERNPROTO type declaration, per LEXICAL level;
 *   - every ROUTE, tagged with the DEF scope and type chain in force at it.
 *
 * The type-name namespace is walked as a NESTING chain rather than a disjoint
 * one: 4.8.4's disjointness rule is stated for the DEF/USE name scope, and the
 * oracle does not extend it to type names on its own authority. Where that
 * distinction could change an answer the oracle abstains (see `resolveType`).
 */
function collect(tree) {
  const routes = [];
  const allDefScopes = [];

  function walkTypeLevel(statements, defScope, typeChain) {
    // One lexical level's own type declarations, gathered BEFORE descending so
    // that a PROTO body can see the level it is declared in.
    const level = new Map();
    const pushType = (name, declNode, kind) => {
      if (!name) return;
      const list = level.get(name) || [];
      list.push({ name, declNode, kind, offset: offsetOf(declNode) });
      level.set(name, list);
    };
    for (const st of statements || []) {
      if (!st || typeof st !== 'object') continue;
      if (st.type === 'Proto') pushType(st.name, st, 'proto');
      else if (st.type === 'ExternProto') pushType(st.name, st, 'externproto');
    }
    const chain = typeChain.concat([level]);

    for (const st of statements || []) walkStatement(st, defScope, chain);
    return chain;
  }

  function walkStatement(st, defScope, typeChain) {
    if (!st || typeof st !== 'object') return;
    switch (st.type) {
      case 'Proto': {
        // 4.8.4 -- a FRESH, PARENTLESS DEF scope for the body.
        const bodyScope = newDefScope('proto-body', st);
        allDefScopes.push(bodyScope);
        walkTypeLevel(st.body || [], bodyScope, typeChain);
        return;
      }
      case 'ExternProto':
        // No body exists locally and none is ever loaded.
        return;
      case 'Route':
        routes.push({ node: st, defScope, typeChain, offset: offsetOf(st) });
        return;
      case 'Node': {
        if (st.def) {
          const list = defScope.defs.get(st.def) || [];
          list.push({ name: st.def, node: st, offset: offsetOf(st), typeChain });
          defScope.defs.set(st.def, list);
        }
        // A node body creates NO DEF scope. Its fields, and any ROUTE among
        // them (Annex A.3), belong to the ENCLOSING scope.
        for (const f of st.fields || []) walkStatement(f, defScope, typeChain);
        // A Script's own interface declarations are the third namespace; they
        // are read by `interfaceOf`, never as DEFs. Their `IS`/default values
        // may still contain nodes.
        for (const i of st.interfaces || []) {
          if (i && i.default) walkValue(i.default, defScope, typeChain);
        }
        return;
      }
      case 'Field':
        walkValue(st.value, defScope, typeChain);
        return;
      case 'Use':
      case 'Is':
      case 'InterfaceDecl':
      case 'Header':
        return;
      default:
        walkValue(st, defScope, typeChain);
    }
  }

  function walkValue(v, defScope, typeChain) {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const item of v) walkValue(item, defScope, typeChain);
      return;
    }
    if (v.type === 'Array') {
      // A bracketed MF value. `items` is the parser's key -- and this is where
      // the Cybertown/Blaxxun ROUTE-and-PROTO-inside-an-MFNode-array construct
      // that the parser leniently accepts (WD.md §9) actually lands, so an
      // oracle that failed to descend here would miss both the DEFs and the
      // ROUTEs in most real content.
      for (const item of v.items || []) walkValue(item, defScope, typeChain);
      return;
    }
    if (v.type === 'Numbers') return; // scalar run: nothing lexical
    if (v.type === 'Node' || v.type === 'Route' || v.type === 'Proto'
      || v.type === 'ExternProto' || v.type === 'Field') {
      walkStatement(v, defScope, typeChain);
      return;
    }
    // Scalars, strings, bools, NULL, number runs: nothing lexical.
  }

  const documentScope = newDefScope('document', tree);
  allDefScopes.push(documentScope);
  walkTypeLevel(tree.statements || [], documentScope, []);

  return { routes, documentScope, allDefScopes };
}

// ---------------------------------------------------------------------------
// 4. Node-name expectation (4.6.2 + 4.10.2 R5 + 4.8.4)
// ---------------------------------------------------------------------------

/**
 * Which DEF declaration should this ROUTE node name denote?
 *
 * 4.10.2 is explicit that nodes referenced in a ROUTE "shall be defined before
 * the ROUTE statement", so visibility is the set of declarations in THIS scope
 * with a smaller source offset. Two or more of them is `no-binding`: 4.6.2's
 * closest-preceding rule is real and is deliberately NOT implemented, because
 * ranking candidates is exactly what WD.md §7 forbids on an identity path.
 */
function expectNode(name, defScope, routeOffset) {
  if (name == null || name === '') {
    // A token fact -- there is no name to look up. Nothing to grade.
    return { verdict: EXPECT.ABSTAIN, why: 'missing-name-token-fact' };
  }
  const declared = defScope.defs.get(name) || [];
  const preceding = declared.filter((d) => d.offset < routeOffset);
  if (preceding.length === 1) return { verdict: EXPECT.BINDS, decl: preceding[0] };
  if (preceding.length > 1) {
    return { verdict: EXPECT.NO_BINDING, why: 'duplicate-declaration-in-scope' };
  }
  if (declared.length > 0) {
    return { verdict: EXPECT.NO_BINDING, why: 'declared-only-after-the-route' };
  }
  return { verdict: EXPECT.NO_BINDING, why: 'not-declared-in-this-scope' };
}

// ---------------------------------------------------------------------------
// 5. Interface tables -- the oracle's own 4.7 / 4.8.2 alias expansion
// ---------------------------------------------------------------------------
//
// 4.7:   an exposedField zzz may be referred to as `set_zzz` (treated as an
//        eventIn) and as `zzz_changed` (treated as an eventOut).
// 4.8.2: declaring `exposedField zzz` in a prototype interface is EQUIVALENT to
//        declaring field zzz + eventIn set_zzz + eventOut zzz_changed.
//
// Both say the same thing about what an interface CONTAINS, so one expansion
// serves both. The map is keyed by EFFECTIVE lookup name; each value records
// which DECLARED member answered, because that -- not the spelling the author
// used -- is the binding a rename or a scene tree acts on.

function addEffective(map, key, entry) {
  if (map.has(key)) {
    map.set(key, COLLIDED);
    return;
  }
  map.set(key, entry);
}

function expandMembers(members) {
  const map = new Map();
  for (const m of members) {
    if (!m || !m.name || !DECLARED_ACCESS.has(m.access)) continue;
    const type = m.type;
    if (m.access === ACCESS.EXPOSED_FIELD) {
      addEffective(map, m.name, { declaredName: m.name, access: ACCESS.EXPOSED_FIELD, type });
      addEffective(map, `set_${m.name}`, { declaredName: m.name, access: ACCESS.EVENT_IN, type });
      addEffective(map, `${m.name}_changed`, { declaredName: m.name, access: ACCESS.EVENT_OUT, type });
    } else {
      addEffective(map, m.name, { declaredName: m.name, access: m.access, type });
    }
  }
  return map;
}

/** Built-in members, from WD1.3's committed fact table. VRML97 declarations only. */
function builtinMembers(nodeType) {
  const rec = schema.getNodeSchema(nodeType);
  if (!rec) return null;
  const members = [];
  for (const fieldName of schema.listFields(nodeType)) {
    const f = schema.getFieldSchema(nodeType, fieldName);
    if (!f) continue;
    // WD1.3 records 232 X3D-only fields that must never leak into VRML97. A
    // field with no VRML97 declaration is not part of this node's VRML97
    // interface and cannot be a ROUTE endpoint on it.
    if (!DECLARED_ACCESS.has(f.vrml97Declaration)) continue;
    members.push({ name: fieldName, access: f.vrml97Declaration, type: f.type });
  }
  return members;
}

/** Members an interface DECLARATION list contributes (PROTO, EXTERNPROTO, Script). */
function declaredMembers(interfaces) {
  const out = [];
  for (const d of interfaces || []) {
    if (!d || d.type !== 'InterfaceDecl') continue;
    out.push({ name: d.name, access: d.access, type: d.fieldType });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 6. Type resolution -- conservative, because a wrong type is a wrong interface
// ---------------------------------------------------------------------------

/**
 * What interface does the node this ROUTE bound actually expose?
 *
 * Abstains whenever the answer would rest on a rule this oracle is not
 * independently confident of: an unknown type, a type name declared more than
 * once at a visible level, or a PROTO/EXTERNPROTO whose only declaration
 * follows the instance. Those sites are counted, never silently dropped.
 */
function interfaceOf(declNode) {
  const nodeType = declNode.node.nodeType;
  const typeChain = declNode.typeChain || [];
  const instanceOffset = offsetOf(declNode.node);

  // Innermost level outward. A level that declares the name at all answers --
  // an outer declaration cannot reach past an inner one of the same name.
  for (let i = typeChain.length - 1; i >= 0; i -= 1) {
    const list = typeChain[i].get(nodeType);
    if (!list || !list.length) continue;
    if (list.length > 1) {
      return { kind: 'abstain', why: 'duplicate-type-declaration-at-one-level' };
    }
    const decl = list[0];
    if (decl.offset > instanceOffset) {
      // P2A owns instance-before-declaration ordering; not P2C's gate.
      return { kind: 'abstain', why: 'type-declared-after-instance' };
    }
    if (decl.kind === 'externproto') {
      return {
        kind: 'externproto',
        // 4.9.2 -- what it DECLARES is authoritative locally; what it OMITS is
        // unknowable, because the declaration may be a strict subset.
        map: expandMembers(declaredMembers(decl.declNode.interfaces)),
      };
    }
    return { kind: 'proto', map: expandMembers(declaredMembers(decl.declNode.interfaces)) };
  }

  // No user declaration is visible: a clause-6 built-in, or nothing the oracle
  // can speak about.
  const builtins = builtinMembers(nodeType);
  if (!builtins) return { kind: 'abstain', why: 'unknown-node-type' };

  if (nodeType === 'Script') {
    // 4.12 / Annex A.3 -- a Script instance carries its OWN interface, and it
    // is consulted before the clause-6 Script fields (url, directOutput,
    // mustEvaluate). Ordering matters: `expandMembers` marks a collision, and a
    // user member that shadowed a built-in one would be reported as collided
    // rather than silently preferred, which is the fail-closed direction.
    const own = declaredMembers(declNode.node.interfaces);
    return { kind: 'script', map: expandMembers(own.concat(builtins)) };
  }
  return { kind: 'builtin', map: expandMembers(builtins) };
}

// ---------------------------------------------------------------------------
// 7. Endpoint expectation -- 4.10.2 direction + the shorthand fallback
// ---------------------------------------------------------------------------

/** 4.10.2 -- routes may be established ONLY from eventOuts to eventIns. */
function canServe(access, side) {
  if (side === SIDE.SOURCE) {
    return access === ACCESS.EVENT_OUT || access === ACCESS.EXPOSED_FIELD;
  }
  return access === ACCESS.EVENT_IN || access === ACCESS.EXPOSED_FIELD;
}

/**
 * Which endpoint should this written event name denote on this interface?
 *
 * 4.10.2's shorthand: "if a ROUTE to an eventIn named zzz finds no eventIn of
 * that name, the browser shall then try set_zzz". Two properties of it are
 * load-bearing and are implemented deliberately:
 *
 *   ORDER IS NORMATIVE. The written name is tried FIRST. Trying the alias first
 *   could bind `set_zzz` in an interface that also declares a real `eventIn
 *   zzz`, which is a wrong endpoint.
 *
 *   THE LOOKUP IS DIRECTION-SPECIFIC (R19, owner-adjudicated 2026-08-07). A
 *   written `zzz` found only as a `field` has NOT found the required event, so
 *   the fallback still applies. The same reasoning covers a `zzz` found only as
 *   an event of the WRONG direction.
 *
 * The fallback's precondition is the safety property: it may fire only when the
 * required event is PROVABLY absent. A collided effective name proves nothing,
 * so the oracle abstains there rather than falling through.
 */
function expectEndpoint(iface, written, side) {
  if (iface.kind === 'abstain') return { verdict: EXPECT.ABSTAIN, why: iface.why };
  if (written == null || written === '') {
    return { verdict: EXPECT.ABSTAIN, why: 'missing-event-name-token-fact' };
  }

  const direct = iface.map.get(written);
  if (direct === COLLIDED) {
    return { verdict: EXPECT.ABSTAIN, why: 'collided-effective-name' };
  }
  if (direct && canServe(direct.access, side)) {
    return { verdict: EXPECT.BINDS, endpoint: direct, viaShorthand: false };
  }

  const fallbackName = side === SIDE.SOURCE ? `${written}_changed` : `set_${written}`;
  const alias = iface.map.get(fallbackName);
  if (alias === COLLIDED) {
    return { verdict: EXPECT.ABSTAIN, why: 'collided-effective-name' };
  }
  if (alias && canServe(alias.access, side)) {
    return { verdict: EXPECT.BINDS, endpoint: alias, viaShorthand: true };
  }

  if (iface.kind === 'externproto') {
    // 4.9.2 -- local absence is not absence. Unknowable, never false.
    return { verdict: EXPECT.ABSTAIN, why: 'externproto-not-locally-verifiable' };
  }
  if (direct) {
    // The name exists but cannot serve this side, and no alias saved it.
    return { verdict: EXPECT.NO_BINDING, why: side === SIDE.SOURCE
      ? 'named-member-is-not-an-event-out' : 'named-member-is-not-an-event-in' };
  }
  return { verdict: EXPECT.NO_BINDING, why: 'no-such-endpoint-on-this-interface' };
}

// ---------------------------------------------------------------------------
// 8. The public entry point
// ---------------------------------------------------------------------------

/**
 * Independently derive the expected semantics of every ROUTE in a parse.
 *
 * @param {object} parsed a production parse result (neutral substrate)
 * @returns {Array} one record per ROUTE, in source order, each carrying the
 *   oracle's node and endpoint expectations for both sides.
 */
function expectations(parsed) {
  const { routes } = collect(parsed.tree);
  routes.sort((a, b) => a.offset - b.offset);

  return routes.map((r) => {
    const side = (which, half) => {
      const nodeName = half ? half.node : null;
      const eventName = half ? half.event : null;
      const nodeExpect = expectNode(nodeName, r.defScope, r.offset);
      let endpointExpect;
      if (nodeExpect.verdict !== EXPECT.BINDS) {
        // The event question is never asked against a node nothing bound. This
        // mirrors a real dependency, not the implementation: an interface
        // cannot be read off a node that was never identified.
        endpointExpect = { verdict: EXPECT.ABSTAIN, why: 'node-not-bound' };
      } else {
        endpointExpect = expectEndpoint(interfaceOf(nodeExpect.decl), eventName, which);
      }
      return { side: which, nodeName, eventName, node: nodeExpect, endpoint: endpointExpect };
    };

    return {
      astRoute: r.node,
      offset: r.offset,
      source: side(SIDE.SOURCE, r.node.from),
      destination: side(SIDE.DESTINATION, r.node.to),
    };
  });
}

/**
 * The oracle's own type-compatibility expectation for a whole ROUTE.
 * 4.10.2 R11: the types shall match EXACTLY -- no coercion, no SF/MF widening.
 */
function expectTypeCompatible(record) {
  const a = record.source.endpoint;
  const b = record.destination.endpoint;
  if (a.verdict !== EXPECT.BINDS || b.verdict !== EXPECT.BINDS) {
    return { verdict: EXPECT.ABSTAIN, why: 'an-endpoint-did-not-bind' };
  }
  const ta = a.endpoint.type;
  const tb = b.endpoint.type;
  if (!FIELD_TYPES.has(ta) || !FIELD_TYPES.has(tb)) {
    return { verdict: EXPECT.ABSTAIN, why: 'unrecognised-field-type-token' };
  }
  return { verdict: EXPECT.BINDS, compatible: ta === tb, sourceType: ta, destType: tb };
}

module.exports = {
  EXPECT,
  ACCESS,
  SIDE,
  FIELD_TYPES,
  COLLIDED,
  assertProductionResolverNotLoaded,
  collect,
  expectNode,
  expandMembers,
  builtinMembers,
  declaredMembers,
  interfaceOf,
  canServe,
  expectEndpoint,
  expectations,
  expectTypeCompatible,
  // Re-exported so a caller can parse without reaching for the façade itself,
  // which keeps the oracle's dependency surface visible in one place.
  parse,
};
