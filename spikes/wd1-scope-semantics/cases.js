'use strict';
// WD1.5 spike -- authored expected-truth cases.
//
// INDEPENDENCE IS THE POINT OF THIS FILE. It must never `require`
// `scope-model.js`, and it must never import that module's constant tables.
// Every status and reason below is written out as a bare string literal, by
// hand, from ISO/IEC 14772-1. The duplication is deliberate: if the expectations
// were derived from the thing under test, agreement would prove nothing.
// `test.js` enforces the independence structurally (source scan + a clean child
// process whose `require.cache` is inspected).
//
// Every fixture here is original, authored for this lane, and copied from
// nothing -- not from the corpus, not from White Dune, not from the RE
// artifacts, not from any third-party example.
//
// Expectation vocabulary (hand-written, mirrors the standard, not the code):
//   ref    -- 'use' | 'node-type' | 'is' | 'route-node' | 'route-event'
//   nth    -- 1-based occurrence of that (ref, name) pair in source order
//   status -- 'resolved' | 'unresolved' | 'ambiguous' | 'invalid'
//             | 'unsupported' | 'recovered'
//   reason -- the stable reason identifier the standard justifies
//   role   -- for ROUTE references only: 'source' | 'destination'
//
// `findings` are scope-level observations that are not a single reference's
// resolution (duplicate declarations, type mismatches, redundant routes).
//
// `grade` records how firmly the standard supports the expectation:
//   'normative-explicit' | 'normative-derived' | 'interpretation'
// An `interpretation` disagreement is a design question, not a defect.

const H = '#VRML V2.0 utf8\n';

const CASES = [
  // -------------------------------------------------------------------------
  // DEF / USE -- ISO/IEC 14772-1 4.6.2, 4.8.4
  // -------------------------------------------------------------------------
  {
    id: 'D01',
    group: 'def-use',
    title: 'Top-level DEF followed by USE',
    cite: '4.6.2',
    grade: 'normative-explicit',
    source: `${H}Group { children [\n  DEF Ball Shape { }\n  USE Ball\n] }\n`,
    expect: [{ ref: 'use', name: 'Ball', nth: 1, status: 'resolved', reason: 'ok' }],
  },
  {
    id: 'D02',
    group: 'def-use',
    title: 'USE before DEF is not resolvable',
    cite: '4.6.2 -- "the closest node with the given name PRECEDING it"',
    grade: 'normative-explicit',
    source: `${H}Group { children [\n  USE Ball\n  DEF Ball Shape { }\n] }\n`,
    expect: [{ ref: 'use', name: 'Ball', nth: 1, status: 'invalid', reason: 'use-before-def' }],
  },
  {
    id: 'D03',
    group: 'def-use',
    title: 'Duplicate DEF in one document scope shadows',
    cite: '4.6.2 -- duplicates are legal and the binding is defined; the tool still refuses to choose',
    grade: 'normative-explicit',
    source: `${H}DEF Ball Shape { }\nDEF Ball Group { }\nGroup { children [ USE Ball ] }\n`,
    expect: [{ ref: 'use', name: 'Ball', nth: 1, status: 'ambiguous', reason: 'duplicate-def-in-scope' }],
    findings: [{ code: 'duplicate-def-in-scope', count: 1 }],
  },
  {
    id: 'D04',
    group: 'def-use',
    title: 'Same DEF name in two separate PROTO bodies is not a duplicate',
    cite: '4.8.4 -- a PROTO establishes a DEF/USE scope separate from the rest of the scene and from other PROTOs',
    grade: 'normative-explicit',
    source: `${H}PROTO Left [ ] { Group { children [ DEF Pivot Transform { } USE Pivot ] } }\n`
      + `PROTO Right [ ] { Group { children [ DEF Pivot Transform { } USE Pivot ] } }\n`
      + `Group { }\n`,
    expect: [
      { ref: 'use', name: 'Pivot', nth: 1, status: 'resolved', reason: 'ok' },
      { ref: 'use', name: 'Pivot', nth: 2, status: 'resolved', reason: 'ok' },
    ],
    findings: [{ code: 'duplicate-def-in-scope', count: 0 }],
  },
  {
    id: 'D05',
    group: 'def-use',
    title: 'DEF inside a PROTO body may not be USEd outside it',
    cite: '4.8.4 -- "Nodes given a name by a DEF construct inside the prototype may not be referenced in a USE construct outside"',
    grade: 'normative-explicit',
    source: `${H}PROTO Widget [ ] { Group { children [ DEF Inner Shape { } ] } }\n`
      + `Group { children [ USE Inner ] }\n`,
    expect: [{
      ref: 'use', name: 'Inner', nth: 1,
      status: 'unresolved', reason: 'def-not-visible-across-proto-boundary',
    }],
  },
  {
    id: 'D06',
    group: 'def-use',
    title: 'DEF outside a PROTO may not be USEd inside it',
    cite: '4.8.4 -- "Nodes given a name by a DEF construct outside the prototype scope may not be referenced in a USE construct inside"',
    grade: 'normative-explicit',
    source: `${H}DEF Outer Shape { }\n`
      + `PROTO Widget [ ] { Group { children [ USE Outer ] } }\n`
      + `Group { }\n`,
    expect: [{
      ref: 'use', name: 'Outer', nth: 1,
      status: 'unresolved', reason: 'def-not-visible-across-proto-boundary',
    }],
  },
  {
    id: 'D07',
    group: 'def-use',
    title: 'Nested PROTO bodies do not collide on DEF names',
    cite: '4.8.4 -- separate from the rest of the scene AND from any nested PROTO statements',
    grade: 'normative-explicit',
    source: `${H}PROTO Outer [ ] {\n`
      + `  Group { children [ DEF Hub Transform { } USE Hub ] }\n`
      + `  PROTO Inner [ ] { Group { children [ DEF Hub Transform { } USE Hub ] } }\n`
      + `}\nGroup { }\n`,
    expect: [
      { ref: 'use', name: 'Hub', nth: 1, status: 'resolved', reason: 'ok' },
      { ref: 'use', name: 'Hub', nth: 2, status: 'resolved', reason: 'ok' },
    ],
    findings: [{ code: 'duplicate-def-in-scope', count: 0 }],
  },
  {
    id: 'D08',
    group: 'def-use',
    title: 'Hyphenated DEF names behave like any other name',
    cite: 'Annex A IdRestChars -- "-" is legal after the first character',
    grade: 'normative-derived',
    source: `${H}Group { children [\n  DEF arm-left-ROT Transform { }\n  USE arm-left-ROT\n] }\n`,
    expect: [{ ref: 'use', name: 'arm-left-ROT', nth: 1, status: 'resolved', reason: 'ok' }],
  },
  {
    id: 'D09',
    group: 'def-use',
    title: 'A vendor node type still participates in DEF/USE',
    cite: '4.6.2 (naming is independent of node type) + 4.8.1 (unknown type is not a declared prototype)',
    grade: 'normative-derived',
    source: `${H}Group { children [\n  DEF Vend BlaxxunAvatar { }\n  USE Vend\n] }\n`,
    expect: [
      { ref: 'use', name: 'Vend', nth: 1, status: 'resolved', reason: 'ok' },
      { ref: 'node-type', name: 'BlaxxunAvatar', nth: 1, status: 'unresolved', reason: 'node-type-unknown' },
    ],
  },
  {
    id: 'D10',
    group: 'def-use',
    title: 'Duplicate DEFs of different node types are still ambiguous',
    cite: 'WD1.4 hard gate: ambiguity is decided on the NAME alone, before any type filtering',
    grade: 'normative-derived',
    source: `${H}DEF Thing Shape { }\nDEF Thing Group { }\nGroup { children [ USE Thing ] }\n`,
    expect: [{ ref: 'use', name: 'Thing', nth: 1, status: 'ambiguous', reason: 'duplicate-def-in-scope' }],
  },

  // -------------------------------------------------------------------------
  // PROTO / EXTERNPROTO declarations -- 4.8.1, 4.8.4, 4.9
  // -------------------------------------------------------------------------
  {
    id: 'P11',
    group: 'proto',
    title: 'Top-level PROTO declaration and instance',
    cite: '4.8.4 -- instantiable anywhere after the completion of the definition',
    grade: 'normative-explicit',
    source: `${H}PROTO Cube [ ] { Box { } }\nShape { geometry Cube { } }\n`,
    expect: [{ ref: 'node-type', name: 'Cube', nth: 1, status: 'resolved', reason: 'ok' }],
  },
  {
    id: 'P12',
    group: 'proto',
    title: 'Instance before declaration is not legal',
    cite: '4.8.4 -- "may be instantiated in a file anywhere AFTER the completion of the prototype definition"',
    grade: 'normative-explicit',
    source: `${H}Shape { geometry Cube { } }\nPROTO Cube [ ] { Box { } }\n`,
    expect: [{
      ref: 'node-type', name: 'Cube', nth: 1,
      status: 'invalid', reason: 'proto-instance-before-declaration',
    }],
  },
  {
    id: 'P13',
    group: 'proto',
    title: 'Duplicate PROTO declaration names in one scope',
    cite: '4.8.1 -- "Node type names shall be unique in each VRML file"',
    grade: 'normative-explicit',
    source: `${H}PROTO Cube [ ] { Box { } }\nPROTO Cube [ ] { Sphere { } }\nShape { geometry Cube { } }\n`,
    expect: [{ ref: 'node-type', name: 'Cube', nth: 1, status: 'ambiguous', reason: 'duplicate-proto-declaration' }],
    findings: [{ code: 'duplicate-proto-declaration', count: 1 }],
  },
  {
    id: 'P14',
    group: 'proto',
    title: 'A nested PROTO declaration is usable inside its enclosing body',
    cite: '4.8.4 -- nested definitions are local to the enclosing prototype',
    grade: 'normative-explicit',
    source: `${H}PROTO Outer [ ] {\n  PROTO Knob [ ] { Sphere { } }\n  Shape { geometry Knob { } }\n}\nGroup { }\n`,
    expect: [{ ref: 'node-type', name: 'Knob', nth: 1, status: 'resolved', reason: 'ok' }],
  },
  {
    id: 'P15',
    group: 'proto',
    title: 'The same nested PROTO name in two outer PROTOs does not collide',
    cite: '4.8.4 -- locality of nested declarations',
    grade: 'normative-explicit',
    source: `${H}PROTO A [ ] { PROTO Knob [ ] { Sphere { } } Shape { geometry Knob { } } }\n`
      + `PROTO B [ ] { PROTO Knob [ ] { Box { } } Shape { geometry Knob { } } }\nGroup { }\n`,
    expect: [
      { ref: 'node-type', name: 'Knob', nth: 1, status: 'resolved', reason: 'ok' },
      { ref: 'node-type', name: 'Knob', nth: 2, status: 'resolved', reason: 'ok' },
    ],
    findings: [{ code: 'duplicate-proto-declaration', count: 0 }],
  },
  {
    id: 'P16',
    group: 'proto',
    title: 'EXTERNPROTO declaration and instance',
    cite: '4.9.1 -- equivalent to PROTO except the body lives elsewhere',
    grade: 'normative-explicit',
    source: `${H}EXTERNPROTO Gold [ ] "materials.wrl#Gold"\n`
      + `Shape { appearance Appearance { material Gold { } } }\n`,
    expect: [{ ref: 'node-type', name: 'Gold', nth: 1, status: 'resolved', reason: 'ok' }],
  },
  {
    id: 'P17',
    group: 'proto',
    title: 'A PROTO and an EXTERNPROTO sharing a name collide',
    cite: '4.8.1 + 4.9.1 -- both declare a node type in the same namespace',
    grade: 'normative-derived',
    source: `${H}PROTO Gold [ ] { Material { } }\nEXTERNPROTO Gold [ ] "materials.wrl#Gold"\nGroup { }\n`,
    findings: [{ code: 'duplicate-proto-declaration', count: 1 }],
  },
  {
    id: 'P18',
    group: 'proto',
    title: 'An unknown ProtoInstance name is not resolvable',
    cite: '4.8.1 -- not a built-in type and not a declared prototype',
    grade: 'normative-derived',
    source: `${H}Shape { geometry NeverDeclared { } }\n`,
    expect: [{ ref: 'node-type', name: 'NeverDeclared', nth: 1, status: 'unresolved', reason: 'node-type-unknown' }],
  },

  // -------------------------------------------------------------------------
  // Interfaces and IS -- 4.3.5, 4.3.6, 4.8.2, 4.8.3, 4.8.4, 6.40
  // -------------------------------------------------------------------------
  {
    id: 'I19',
    group: 'interface',
    title: 'A valid interface field bound with IS',
    cite: '4.8.3 + Table 4.4 -- exposedField definition to field declaration is legal',
    grade: 'normative-explicit',
    source: `${H}PROTO Mover [ field SFVec3f offset 0 0 0 ] {\n`
      + `  Transform { translation IS offset }\n}\nGroup { }\n`,
    expect: [{ ref: 'is', name: 'offset', nth: 1, status: 'resolved', reason: 'ok' }],
  },
  {
    id: 'I20',
    group: 'interface',
    title: 'IS referencing a name absent from the interface',
    cite: '4.8.3 -- "Results are undefined if an IS statement refers to a non-existent declaration"',
    grade: 'normative-explicit',
    source: `${H}PROTO Mover [ field SFVec3f offset 0 0 0 ] {\n`
      + `  Transform { translation IS nowhere }\n}\nGroup { }\n`,
    expect: [{ ref: 'is', name: 'nowhere', nth: 1, status: 'unresolved', reason: 'is-member-not-declared' }],
  },
  {
    id: 'I21',
    group: 'interface',
    title: 'Duplicate interface member names in one PROTO',
    cite: '4.3.5 -- "shall be unique in each PROTO statement"',
    grade: 'normative-explicit',
    source: `${H}PROTO Mover [ field SFVec3f offset 0 0 0\n  field SFFloat offset 1 ] {\n`
      + `  Transform { }\n}\nGroup { }\n`,
    findings: [{ code: 'duplicate-interface-member', count: 1 }],
  },
  {
    id: 'I22',
    group: 'interface',
    title: 'Type-incompatible IS binding',
    cite: '4.8.3 -- "it is illegal to associate an SFColor with an SFVec3f"',
    grade: 'normative-explicit',
    source: `${H}PROTO Mover [ field SFColor tint 1 1 1 ] {\n`
      + `  Transform { translation IS tint }\n}\nGroup { }\n`,
    expect: [{ ref: 'is', name: 'tint', nth: 1, status: 'invalid', reason: 'is-type-mismatch' }],
  },
  {
    id: 'I23',
    group: 'interface',
    title: 'Access-incompatible IS binding',
    cite: '4.8.3 Table 4.4 -- an eventIn definition may bind only an eventIn declaration',
    grade: 'normative-explicit',
    source: `${H}PROTO Snap [ eventOut SFTime fired ] {\n`
      + `  DEF S Script { eventIn SFTime go IS fired url "x.js" }\n}\nGroup { }\n`,
    expect: [{ ref: 'is', name: 'fired', nth: 1, status: 'invalid', reason: 'is-access-mismatch' }],
  },
  {
    id: 'I24',
    group: 'interface',
    title: 'A nested PROTO IS binds the innermost interface',
    cite: '4.8.4 -- "IS statements inside a nested prototype’s implementation may refer to the prototype declarations of the innermost prototype"',
    grade: 'normative-explicit',
    source: `${H}PROTO Outer [ field SFVec3f outerOffset 0 0 0 ] {\n`
      + `  PROTO Inner [ field SFVec3f innerOffset 0 0 0 ] { Transform { translation IS innerOffset } }\n`
      + `  Shape { geometry Box { } }\n}\nGroup { }\n`,
    expect: [{ ref: 'is', name: 'innerOffset', nth: 1, status: 'resolved', reason: 'ok' }],
  },
  {
    id: 'I25',
    group: 'interface',
    title: 'IS outside any PROTO body',
    cite: '4.3.6 -- "The body of a node statement that is INSIDE A PROTOTYPE DEFINITION may contain IS statements"',
    grade: 'normative-explicit',
    source: `${H}Transform { translation IS anything }\n`,
    expect: [{ ref: 'is', name: 'anything', nth: 1, status: 'invalid', reason: 'is-outside-proto-body' }],
  },
  {
    id: 'I26',
    group: 'interface',
    title: 'A Script interface member participates in IS',
    cite: 'Annex A scriptBodyElement -- "eventIn fieldType eventInId IS eventInId"',
    grade: 'normative-explicit',
    source: `${H}PROTO Snap [ eventIn SFTime go ] {\n`
      + `  DEF S Script { eventIn SFTime go IS go url "x.js" }\n}\nGroup { }\n`,
    expect: [{ ref: 'is', name: 'go', nth: 1, status: 'resolved', reason: 'ok' }],
  },

  // -------------------------------------------------------------------------
  // ROUTEs -- 4.10.2
  // -------------------------------------------------------------------------
  {
    id: 'R27',
    group: 'route',
    title: 'A valid ROUTE',
    cite: '4.10.2',
    grade: 'normative-explicit',
    source: `${H}DEF Clock TimeSensor { }\n`
      + `DEF Path PositionInterpolator { key [ 0 1 ] keyValue [ 0 0 0 1 1 1 ] }\n`
      + `ROUTE Clock.fraction_changed TO Path.set_fraction\nGroup { }\n`,
    expect: [
      { ref: 'route-node', name: 'Clock', nth: 1, role: 'source', status: 'resolved', reason: 'ok' },
      { ref: 'route-node', name: 'Path', nth: 1, role: 'destination', status: 'resolved', reason: 'ok' },
      { ref: 'route-event', name: 'fraction_changed', nth: 1, role: 'source', status: 'resolved', reason: 'ok' },
      { ref: 'route-event', name: 'set_fraction', nth: 1, role: 'destination', status: 'resolved', reason: 'ok' },
    ],
  },
  {
    id: 'R28',
    group: 'route',
    title: 'ROUTE source DEF missing',
    cite: '4.10.2 -- "Nodes referenced in a ROUTE statement shall be defined before the ROUTE statement"',
    grade: 'normative-explicit',
    source: `${H}DEF Path PositionInterpolator { key [ 0 1 ] keyValue [ 0 0 0 1 1 1 ] }\n`
      + `ROUTE Clock.fraction_changed TO Path.set_fraction\nGroup { }\n`,
    expect: [{
      ref: 'route-node', name: 'Clock', nth: 1, role: 'source',
      status: 'unresolved', reason: 'def-not-declared-in-scope',
    }],
  },
  {
    id: 'R29',
    group: 'route',
    title: 'ROUTE destination DEF missing',
    cite: '4.10.2',
    grade: 'normative-explicit',
    source: `${H}DEF Clock TimeSensor { }\nROUTE Clock.fraction_changed TO Path.set_fraction\nGroup { }\n`,
    expect: [{
      ref: 'route-node', name: 'Path', nth: 1, role: 'destination',
      status: 'unresolved', reason: 'def-not-declared-in-scope',
    }],
  },
  {
    id: 'R30',
    group: 'route',
    title: 'A duplicate DEF makes a ROUTE endpoint ambiguous',
    cite: '4.6.2 + WD1.4 hard gate',
    grade: 'normative-derived',
    source: `${H}DEF Clock TimeSensor { }\nDEF Clock TimeSensor { }\n`
      + `DEF Path PositionInterpolator { key [ 0 1 ] keyValue [ 0 0 0 1 1 1 ] }\n`
      + `ROUTE Clock.fraction_changed TO Path.set_fraction\nGroup { }\n`,
    expect: [{
      ref: 'route-node', name: 'Clock', nth: 1, role: 'source',
      status: 'ambiguous', reason: 'duplicate-def-in-scope',
    }],
  },
  {
    id: 'R31',
    group: 'route',
    title: 'ROUTE source event not declared on the node',
    cite: '4.10.2 + clause 6 node interfaces',
    grade: 'normative-derived',
    source: `${H}DEF Clock TimeSensor { }\n`
      + `DEF Path PositionInterpolator { key [ 0 1 ] keyValue [ 0 0 0 1 1 1 ] }\n`
      + `ROUTE Clock.no_such_changed TO Path.set_fraction\nGroup { }\n`,
    expect: [{
      ref: 'route-event', name: 'no_such_changed', nth: 1, role: 'source',
      status: 'unresolved', reason: 'route-event-not-declared',
    }],
  },
  {
    id: 'R32',
    group: 'route',
    title: 'ROUTE destination event not declared on the node',
    cite: '4.10.2 + clause 6 node interfaces',
    grade: 'normative-derived',
    source: `${H}DEF Clock TimeSensor { }\nDEF Box1 Transform { }\n`
      + `ROUTE Clock.fraction_changed TO Box1.set_nothing\nGroup { }\n`,
    expect: [{
      ref: 'route-event', name: 'set_nothing', nth: 1, role: 'destination',
      status: 'unresolved', reason: 'route-event-not-declared',
    }],
  },
  {
    id: 'R33',
    group: 'route',
    title: 'ROUTE event type mismatch',
    cite: '4.10.2 -- "The types of the eventIn and the eventOut shall match exactly"',
    grade: 'normative-explicit',
    source: `${H}DEF Touch TouchSensor { }\n`
      + `DEF Path PositionInterpolator { key [ 0 1 ] keyValue [ 0 0 0 1 1 1 ] }\n`
      + `ROUTE Touch.touchTime TO Path.set_fraction\nGroup { }\n`,
    findings: [{ code: 'route-event-type-mismatch', count: 1 }],
  },
  {
    id: 'R34',
    group: 'route',
    title: 'ROUTE using Script-declared events',
    cite: '6.40 -- Script events are declared with PROTO interface syntax',
    grade: 'normative-explicit',
    source: `${H}DEF Logic Script { eventOut SFTime fired\n  eventIn SFBool poke\n  url "x.js" }\n`
      + `DEF Clock TimeSensor { }\nROUTE Logic.fired TO Clock.set_startTime\nGroup { }\n`,
    expect: [
      { ref: 'route-event', name: 'fired', nth: 1, role: 'source', status: 'resolved', reason: 'ok' },
      { ref: 'route-event', name: 'set_startTime', nth: 1, role: 'destination', status: 'resolved', reason: 'ok' },
    ],
  },
  {
    id: 'R35',
    group: 'route',
    title: 'A ROUTE inside a PROTO body resolves within that body',
    cite: '4.10.2 -- ROUTEs may appear in a prototype definition',
    grade: 'normative-explicit',
    source: `${H}PROTO Anim [ ] {\n`
      + `  Group { children [ DEF Clock TimeSensor { }\n`
      + `    DEF Path PositionInterpolator { key [ 0 1 ] keyValue [ 0 0 0 1 1 1 ] } ] }\n`
      + `  ROUTE Clock.fraction_changed TO Path.set_fraction\n}\nGroup { }\n`,
    expect: [
      { ref: 'route-node', name: 'Clock', nth: 1, role: 'source', status: 'resolved', reason: 'ok' },
      { ref: 'route-node', name: 'Path', nth: 1, role: 'destination', status: 'resolved', reason: 'ok' },
    ],
  },
  {
    id: 'R36',
    group: 'route',
    title: 'A ROUTE may not cross a PROTO boundary',
    cite: '4.8.4 -- the PROTO DEF/USE scope is separate; ROUTE endpoints are DEF names',
    grade: 'normative-derived',
    source: `${H}DEF Clock TimeSensor { }\n`
      + `PROTO Anim [ ] {\n`
      + `  Group { children [ DEF Path PositionInterpolator { key [ 0 1 ] keyValue [ 0 0 0 1 1 1 ] } ] }\n`
      + `  ROUTE Clock.fraction_changed TO Path.set_fraction\n}\nGroup { }\n`,
    expect: [{
      ref: 'route-node', name: 'Clock', nth: 1, role: 'source',
      status: 'unresolved', reason: 'def-not-visible-across-proto-boundary',
    }],
  },
  {
    id: 'R37',
    group: 'route',
    title: 'A ROUTE forward reference is not legal',
    cite: '4.10.2 -- "shall be defined before the ROUTE statement"',
    grade: 'normative-explicit',
    source: `${H}DEF Clock TimeSensor { }\n`
      + `ROUTE Clock.fraction_changed TO Path.set_fraction\n`
      + `DEF Path PositionInterpolator { key [ 0 1 ] keyValue [ 0 0 0 1 1 1 ] }\n`,
    expect: [{
      ref: 'route-node', name: 'Path', nth: 1, role: 'destination',
      status: 'invalid', reason: 'route-endpoint-forward-reference',
    }],
  },
  {
    id: 'R38',
    group: 'route',
    title: 'Vendor event names on an unknown node type are unprovable',
    cite: '4.10.2 -- the interface of an unknown node type is not knowable from the file',
    grade: 'normative-derived',
    source: `${H}DEF Vend BlaxxunAvatar { }\nDEF Clock TimeSensor { }\n`
      + `ROUTE Vend.avatarChanged TO Clock.set_startTime\nGroup { }\n`,
    expect: [{
      ref: 'route-event', name: 'avatarChanged', nth: 1, role: 'source',
      status: 'unsupported', reason: 'route-endpoint-interface-unknown',
    }],
  },

  {
    id: 'R57',
    group: 'route',
    title: 'A ROUTE inside a node body is a statement, not a field',
    cite: '4.3.3 -- "A node’s body consists of any number of field statements, IS statements, ROUTE statements, PROTO statements or EXTERNPROTO statements"',
    grade: 'normative-explicit',
    // Regression for a prototype defect the corpus found: the parser collects
    // node-body ROUTE/PROTO statements into the node's `fields` array, and an
    // earlier revision skipped them -- losing 5,444 real ROUTEs.
    source: `${H}Group {\n  children [ DEF Clock TimeSensor { }\n`
      + `    DEF Path PositionInterpolator { key [ 0 1 ] keyValue [ 0 0 0 1 1 1 ] } ]\n`
      + `  ROUTE Clock.fraction_changed TO Path.set_fraction\n}\n`,
    expect: [
      { ref: 'route-node', name: 'Clock', nth: 1, role: 'source', status: 'resolved', reason: 'ok' },
      { ref: 'route-node', name: 'Path', nth: 1, role: 'destination', status: 'resolved', reason: 'ok' },
      { ref: 'route-event', name: 'fraction_changed', nth: 1, role: 'source', status: 'resolved', reason: 'ok' },
    ],
  },
  {
    id: 'P58',
    group: 'proto',
    title: 'A PROTO declared inside a node body still declares into the enclosing scope',
    cite: '4.3.3 (PROTO is a node-body statement) + 4.8.4 (a node introduces no scope)',
    grade: 'normative-derived',
    source: `${H}Group {\n  PROTO Knob [ ] { Sphere { } }\n  children [ Shape { geometry Knob { } } ]\n}\n`,
    expect: [{ ref: 'node-type', name: 'Knob', nth: 1, status: 'resolved', reason: 'ok' }],
  },

  // -------------------------------------------------------------------------
  // Recovery and adversarial cases
  // -------------------------------------------------------------------------
  {
    id: 'X39',
    group: 'recovery',
    title: 'A truncated PROTO body cannot prove absence',
    cite: 'Fail-closed: a partial tree proves presence, never absence',
    grade: 'interpretation',
    source: `${H}PROTO Widget [ ] { Group { children [ USE Ghost\n`,
    expect: [{ ref: 'use', name: 'Ghost', nth: 1, status: 'recovered', reason: 'scope-recovered' }],
  },
  {
    id: 'X40',
    group: 'recovery',
    title: 'A truncated ROUTE leaves an endpoint without a name',
    cite: 'Annex A routeStatement -- both endpoints are required',
    grade: 'normative-derived',
    source: `${H}DEF Clock TimeSensor { }\nROUTE Clock.fraction_changed TO\n`,
    expect: [{ ref: 'route-node', name: null, nth: 1, role: 'destination', status: 'invalid', reason: 'missing-name' }],
  },
  {
    id: 'X41',
    group: 'recovery',
    title: 'Names differing only by punctuation are different names',
    cite: 'Annex A Id -- identifiers are compared as exact character sequences',
    grade: 'normative-explicit',
    source: `${H}DEF arm_left Transform { }\nDEF arm-left Transform { }\n`
      + `Group { children [ USE arm-left ] }\n`,
    expect: [{ ref: 'use', name: 'arm-left', nth: 1, status: 'resolved', reason: 'ok' }],
    findings: [{ code: 'duplicate-def-in-scope', count: 0 }],
  },
  {
    id: 'X42',
    group: 'recovery',
    title: 'A name containing "/" is an ordinary name',
    cite: 'Annex A IdRestChars excludes only control characters and the listed delimiters',
    grade: 'normative-derived',
    source: `${H}DEF path/to/thing Transform { }\nGroup { children [ USE path/to/thing ] }\n`,
    expect: [{ ref: 'use', name: 'path/to/thing', nth: 1, status: 'resolved', reason: 'ok' }],
  },
  {
    id: 'X43',
    group: 'recovery',
    title: 'Unusual but tokenizable characters do not change scope',
    cite: 'Annex A Id -- classification by exclusion',
    grade: 'normative-derived',
    source: `${H}DEF a:b@c!d Transform { }\nGroup { children [ USE a:b@c!d ] }\n`,
    expect: [{ ref: 'use', name: 'a:b@c!d', nth: 1, status: 'resolved', reason: 'ok' }],
  },
  {
    id: 'X44',
    group: 'recovery',
    title: 'Scopes whose printable path strings would collide stay distinct',
    cite: 'WD1.4 found a real wrong anchor from a "/"-joined scope key; scopes must be identities, not strings',
    grade: 'interpretation',
    source: `${H}PROTO A/B [ ] { Group { children [ DEF Hit Shape { } USE Hit ] } }\n`
      + `PROTO A [ ] { PROTO B [ ] { Group { children [ DEF Hit Shape { } USE Hit ] } } Group { } }\n`
      + `Group { }\n`,
    expect: [
      { ref: 'use', name: 'Hit', nth: 1, status: 'resolved', reason: 'ok' },
      { ref: 'use', name: 'Hit', nth: 2, status: 'resolved', reason: 'ok' },
    ],
    findings: [{ code: 'duplicate-def-in-scope', count: 0 }],
  },
  {
    id: 'X45',
    group: 'recovery',
    title: 'An unnamed PROTO recovery form fails closed',
    cite: 'Fail-closed: a scope with no provable owner cannot answer "not declared"',
    grade: 'interpretation',
    source: `${H}PROTO [ ] { Group { children [ USE Ghost ] } }\nGroup { }\n`,
    expect: [{ ref: 'use', name: 'Ghost', nth: 1, status: 'recovered', reason: 'proto-scope-not-provable' }],
  },
  {
    id: 'X46',
    group: 'recovery',
    title: 'Scope survives a text edit that only moves offsets',
    cite: 'Scope is lexical structure, not absolute position',
    grade: 'interpretation',
    source: `${H}Group { children [ DEF Ball Shape { } USE Ball ] }\n`,
    after: `${H}# a comment inserted above\n\nGroup { children [ DEF Ball Shape { } USE Ball ] }\n`,
    expect: [{ ref: 'use', name: 'Ball', nth: 1, status: 'resolved', reason: 'ok' }],
    expectAfter: [{ ref: 'use', name: 'Ball', nth: 1, status: 'resolved', reason: 'ok' }],
  },
  {
    id: 'X47',
    group: 'recovery',
    title: 'A deleted declaration leaves its reference unresolved',
    cite: '4.6.2 -- no preceding declaration means no binding',
    grade: 'normative-explicit',
    source: `${H}Group { children [ DEF Ball Shape { } USE Ball ] }\n`,
    after: `${H}Group { children [ USE Ball ] }\n`,
    expect: [{ ref: 'use', name: 'Ball', nth: 1, status: 'resolved', reason: 'ok' }],
    expectAfter: [{ ref: 'use', name: 'Ball', nth: 1, status: 'unresolved', reason: 'def-not-declared-in-scope' }],
  },
  {
    id: 'X48',
    group: 'recovery',
    title: 'A renamed declaration leaves old references unresolved',
    cite: '4.6.2 -- binding is by exact name',
    grade: 'normative-explicit',
    source: `${H}Group { children [ DEF Ball Shape { } USE Ball ] }\n`,
    after: `${H}Group { children [ DEF Sphere1 Shape { } USE Ball ] }\n`,
    expect: [{ ref: 'use', name: 'Ball', nth: 1, status: 'resolved', reason: 'ok' }],
    expectAfter: [{ ref: 'use', name: 'Ball', nth: 1, status: 'unresolved', reason: 'def-not-declared-in-scope' }],
  },
  {
    id: 'X49',
    group: 'recovery',
    title: 'Two identical declarations in distinct scopes are two symbols',
    cite: '4.8.4 -- scope separation',
    grade: 'normative-explicit',
    source: `${H}PROTO One [ ] { Group { children [ DEF Same Shape { } ] } }\n`
      + `PROTO Two [ ] { Group { children [ DEF Same Shape { } ] } }\nGroup { }\n`,
    findings: [{ code: 'duplicate-def-in-scope', count: 0 }],
    symbolExpect: { kind: 'node-def', name: 'Same', count: 2, distinctScopes: 2 },
  },
  {
    id: 'X50',
    group: 'recovery',
    title: 'Malformed content yields a graph, but the graph withholds scope claims',
    cite: 'Fail-closed: a partial tree proves a declaration EXISTS, never which scope owns it',
    grade: 'interpretation',
    // REVISED. This case originally expected `resolved/ok`, encoding the claim
    // that "presence is provable from a partial tree". An external review
    // challenged that claim and it did not survive: parser recovery MOVES scope
    // boundaries, so the declaration set of a damaged scope is untrustworthy in
    // both directions. See X59 for the case that proves it wrong outright.
    source: `${H}Group { children [ DEF Ball Shape { } USE Ball ] \nTransform { translation }\n`,
    expect: [{ ref: 'use', name: 'Ball', nth: 1, status: 'recovered', reason: 'scope-recovered' }],
  },
  {
    id: 'X59',
    group: 'recovery',
    title: 'An unclosed PROTO must not manufacture a unique binding out of an ambiguous one',
    cite: '4.8.4 + fail-closed: an absorbed scope sees a declaration set that never existed',
    grade: 'interpretation',
    // Regression for the accepted external-review finding. With the brace
    // present this document is AMBIGUOUS: two `DEF Foo` share the document
    // scope. With the brace missing, the PROTO body swallows the trailing
    // statements, and because a PROTO body has no `defParent` the absorbed scope
    // is blind to the outer `DEF Foo` -- leaving exactly one candidate. An
    // earlier revision returned `resolved` bound to the Transform, which is a
    // confidently WRONG answer and the one thing the hard gate forbids.
    source: `${H}DEF Foo Group { }\nPROTO P [ ] {\n  Shape { }\n`
      + `DEF Foo Transform { }\nGroup { children [ USE Foo ] }\n`,
    expect: [{ ref: 'use', name: 'Foo', nth: 1, status: 'recovered', reason: 'scope-recovered' }],
    // The same document with the brace closed: the honest answer is ambiguity.
    after: `${H}DEF Foo Group { }\nPROTO P [ ] {\n  Shape { }\n}\n`
      + `DEF Foo Transform { }\nGroup { children [ USE Foo ] }\n`,
    expectAfter: [{ ref: 'use', name: 'Foo', nth: 1, status: 'ambiguous', reason: 'duplicate-def-in-scope' }],
  },

  // -------------------------------------------------------------------------
  // Self-reference and recursion -- 4.4.2/4.4.4 and 4.8.4
  // -------------------------------------------------------------------------
  {
    id: 'X51',
    group: 'recovery',
    title: 'A USE inside the node it names would be self-referential',
    cite: '4.4.2 -- "A VRML file contains a directed acyclic graph"',
    grade: 'normative-derived',
    source: `${H}DEF Loop Group { children [ USE Loop ] }\n`,
    expect: [{ ref: 'use', name: 'Loop', nth: 1, status: 'invalid', reason: 'self-referential-use' }],
  },
  {
    id: 'X56',
    group: 'recovery',
    title: 'A Script holding a reference to itself is NOT a forbidden cycle',
    cite: '4.4.4 -- the DAG rule binds the TRANSFORMATION HIERARCHY, and "a descendant of a Script node is not part of the transformation hierarchy"',
    grade: 'normative-explicit',
    // Regression for a prototype defect the corpus found: an earlier revision
    // applied the acyclicity rule to the whole scene graph and flagged 489 real
    // occurrences of this standard idiom as invalid.
    source: `${H}DEF Logic Script { field SFNode myself USE Logic\n  eventOut SFTime fired\n  url "x.js" }\nGroup { }\n`,
    expect: [{
      ref: 'use', name: 'Logic', nth: 1,
      status: 'resolved', reason: 'self-reference-outside-transformation-hierarchy',
    }],
  },
  {
    id: 'X52',
    group: 'proto',
    title: 'A prototype may not be instantiated inside its own implementation',
    cite: '4.8.4 -- "recursive prototypes are illegal"',
    grade: 'normative-explicit',
    source: `${H}PROTO Rec [ ] { Group { children [ Rec { } ] } }\nGroup { }\n`,
    expect: [{ ref: 'node-type', name: 'Rec', nth: 1, status: 'invalid', reason: 'recursive-proto-instance' }],
  },
  {
    id: 'X53',
    group: 'interface',
    title: 'exposedField in a Script node is not permitted',
    cite: '6.40 -- "With the exception of the url field, exposedFields are not allowed in Script nodes"',
    grade: 'normative-explicit',
    source: `${H}DEF S Script { exposedField SFBool flag FALSE\n  url "x.js" }\nGroup { }\n`,
    findings: [{ code: 'script-exposed-field', count: 1 }],
  },
  {
    id: 'X54',
    group: 'interface',
    title: 'An exposedField collides with its own implicit event names',
    cite: '4.3.5 -- an interface with exposedField zzz "shall not contain eventIns or eventOuts with the prefix set_ or the suffix _changed and the given name"',
    grade: 'normative-explicit',
    source: `${H}PROTO Bad [ exposedField SFBool flag FALSE\n  eventIn SFBool set_flag ] { Group { } }\nGroup { }\n`,
    findings: [{ code: 'exposed-field-alias-collision', count: 1 }],
  },
  {
    id: 'X55',
    group: 'route',
    title: 'A repeated ROUTE is redundant, not an error',
    cite: '4.10.2 -- "Redundant routing is ignored"',
    grade: 'normative-explicit',
    source: `${H}DEF Clock TimeSensor { }\n`
      + `DEF Path PositionInterpolator { key [ 0 1 ] keyValue [ 0 0 0 1 1 1 ] }\n`
      + `ROUTE Clock.fraction_changed TO Path.set_fraction\n`
      + `ROUTE Clock.fraction_changed TO Path.set_fraction\nGroup { }\n`,
    findings: [{ code: 'duplicate-route', count: 1 }],
  },
];

module.exports = { CASES };
