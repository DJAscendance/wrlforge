'use strict';
// Phase 7C3 -- WorldPreviewBridge unit tests (pure, no Electron, no real fs).
// The bridge is exercised over an in-memory fake world project: a scan graph, a
// virtual file tree (readSaved/listDir), and a fake editor session. Every
// authorization decision, override path, findings classification, rescan flow,
// and cleanup guarantee from the 7C3 spec is asserted here, including the
// resolveWorldRequest overlayLookup ordering (authorization first, overlay
// second) and the no-write/no-temp-file posture.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const zlib = require('node:zlib');

const { createWorldPreviewBridge } = require('../../src/preview/world-preview-bridge');
const { resolveWorldRequest, buildAuthorizedSet, worldAssetUrl, worldBaseUrl } = require('../../src/world-project/preview-source');

const ROOT = path.resolve('/proj/world');
const PRIMARY = path.join(ROOT, 'entry.wrl');
const NESTED = path.join(ROOT, 'rooms', 'hall.wrl');
const NESTED_GZ = path.join(ROOT, 'rooms', 'vault.wrl'); // gzip bytes on disk
const TEXTURE = path.join(ROOT, 'textures', 'stone.png');

const HEADER = '#VRML V2.0 utf8\n';

// ---- fake world -------------------------------------------------------------
// A minimal scan-result shape: what buildAuthorizedSet/buildPreviewPayload read.
function makeGraph() {
  return {
    wrlNodes: [
      { path: PRIMARY, depth: 0, refs: [] },
      { path: NESTED, depth: 1, refs: [] },
      { path: NESTED_GZ, depth: 1, refs: [] },
    ],
    assets: [{ path: TEXTURE, kind: 'texture', present: true }],
    missing: [], caseMismatches: [], remoteRefs: [], unsafe: [],
    stats: { wrlFiles: 3, uniqueAssets: 1, uniqueTextures: 1, totalRefs: 4 },
  };
}

function makeScan(overrides = {}) {
  return { status: 'ok', root: ROOT, primary: PRIMARY, graph: makeGraph(), ...overrides };
}

// A virtual on-disk tree: path -> plain text (or a gzip Buffer for NESTED_GZ).
function makeFiles() {
  return {
    [PRIMARY]: HEADER + 'DEF World Transform { children [ Inline { url "rooms/hall.wrl" } ] }\n',
    [NESTED]: HEADER + 'DEF Hall Shape { geometry Box { size 1 1 1 } }\n',
    [NESTED_GZ]: zlib.gzipSync(Buffer.from(HEADER + 'DEF Vault Shape { geometry Sphere {} }\n', 'utf8')),
  };
}

// Build a bridge over injected fakes. `state` is mutable so tests can flip the
// session/scan mid-flight (document switches, project switches, rescans).
function makeBridge(state = {}) {
  const st = {
    session: { open: true, sessionId: 1, context: 'world', sourcePath: PRIMARY },
    root: ROOT,
    primary: PRIMARY,
    scan: makeScan(),
    files: makeFiles(),
    listings: {
      [ROOT]: ['entry.wrl', 'rooms', 'textures', 'newthing.wrl'],
      [path.join(ROOT, 'rooms')]: ['hall.wrl', 'vault.wrl'],
      [path.join(ROOT, 'textures')]: ['stone.png', 'Wood.PNG'],
    },
    rescan: async () => { throw new Error('rescan not expected'); },
    realpathOk: true,
    reads: [],
    ...state,
  };
  const bridge = createWorldPreviewBridge({
    describeSession: () => st.session,
    getWorldRoot: () => st.root,
    getWorldPrimary: () => st.primary,
    getScan: () => st.scan,
    rescan: () => st.rescan(),
    readSaved: (p) => {
      st.reads.push(p);
      const v = st.files[path.resolve(p)];
      if (v == null) throw new Error('ENOENT ' + p);
      if (Buffer.isBuffer(v)) return { text: zlib.gunzipSync(v).toString('utf8'), wasGzipped: true };
      return { text: v, wasGzipped: false };
    },
    listDir: (d) => st.listings[path.resolve(d)] || [],
    realpathInside: () => st.realpathOk,
  });
  return { bridge, st };
}

const load = (bridge, text, v = 1, sid = 1) => bridge.load({ sessionId: sid, text, bufferVersion: v });

// ---- authorization ------------------------------------------------------------

test('unsaved PRIMARY registers: payload substitutes the buffer as the root scene', () => {
  const { bridge } = makeBridge();
  const buf = HEADER + 'DEF Edited Shape { geometry Cone {} }\n';
  const res = load(bridge, buf);
  assert.equal(res.ok, true);
  assert.equal(res.text, buf); // buffer, not the disk primary
  assert.equal(res.wasGzipped, false);
  assert.equal(res.editedIsPrimary, true);
  assert.equal(res.editedRel, 'entry.wrl');
  assert.equal(res.profile, 'world');
  assert.ok(Number.isInteger(res.generation) && res.generation >= 1);
});

test('primary base URL is the primary\'s own wrlworld:// directory', () => {
  const { bridge } = makeBridge();
  const res = load(bridge, HEADER);
  assert.equal(res.baseURL, worldBaseUrl(ROOT, PRIMARY));
  assert.ok(res.baseURL.startsWith('wrlworld://project/'));
});

test('unsaved NESTED registers: saved primary text, nested identity reported', () => {
  const { bridge, st } = makeBridge();
  st.session = { open: true, sessionId: 2, context: 'world', sourcePath: NESTED };
  const buf = HEADER + 'DEF HallEdited Shape { geometry Cylinder {} }\n';
  const res = bridge.load({ sessionId: 2, text: buf, bufferVersion: 1 });
  assert.equal(res.ok, true);
  assert.equal(res.editedIsPrimary, false);
  assert.equal(res.editedRel, 'rooms/hall.wrl');
  // The payload's root scene stays the SAVED primary (the override rides on the
  // scheme handler when X_ITE requests the nested path).
  assert.match(res.text, /rooms\/hall\.wrl/);
  assert.equal(res.baseURL, worldBaseUrl(ROOT, PRIMARY));
});

test('a NESTED payload carries editedText for X_ITE pre-validation; a PRIMARY payload does not', () => {
  const { bridge, st } = makeBridge();
  st.session = { open: true, sessionId: 7, context: 'world', sourcePath: NESTED };
  const buf = HEADER + '# nested\n';
  const nested = bridge.load({ sessionId: 7, text: buf, bufferVersion: 1 });
  assert.equal(nested.editedText, buf);
  st.session = { open: true, sessionId: 8, context: 'world', sourcePath: PRIMARY };
  const primary = bridge.load({ sessionId: 8, text: HEADER, bufferVersion: 1 });
  assert.equal(primary.editedText, undefined);
});

test('World authorization proof: overlay entry carries the world profile + graph membership', () => {
  const { bridge } = makeBridge();
  load(bridge, HEADER);
  const d = bridge.describe(1);
  assert.equal(d.profile, 'world');
  assert.equal(d.path, PRIMARY);
});

test('renderer cannot steer the target: extra path-like fields are ignored', () => {
  const { bridge } = makeBridge();
  const res = bridge.load({
    sessionId: 1, text: HEADER, bufferVersion: 1,
    path: '/etc/passwd', sourcePath: '/etc/passwd', root: '/', baseURL: 'file:///',
  });
  assert.equal(res.ok, true);
  // The override is keyed to the HELD source, never the renderer's fields.
  assert.equal(bridge.describe(1).path, PRIMARY);
  assert.equal(res.editedRel, 'entry.wrl');
});

test('non-world session is refused', () => {
  const { bridge, st } = makeBridge();
  st.session = { open: true, sessionId: 1, context: 'mall', sourcePath: PRIMARY };
  assert.equal(load(bridge, HEADER).reason, 'not-world');
});

test('stale editor session is refused', () => {
  const { bridge } = makeBridge();
  assert.equal(bridge.load({ sessionId: 99, text: HEADER, bufferVersion: 1 }).reason, 'stale-session');
});

test('closed document is refused', () => {
  const { bridge, st } = makeBridge();
  st.session = { open: false };
  assert.equal(load(bridge, HEADER).reason, 'no-document');
});

test('graph membership required: an in-root file that is not a graph node is refused', () => {
  const { bridge, st } = makeBridge();
  st.session = { open: true, sessionId: 1, context: 'world', sourcePath: path.join(ROOT, 'newthing.wrl') };
  assert.equal(load(bridge, HEADER).reason, 'not-in-graph');
});

test('non-WRL graph assets never receive an override', () => {
  const { bridge, st } = makeBridge();
  st.session = { open: true, sessionId: 1, context: 'world', sourcePath: TEXTURE };
  assert.equal(load(bridge, HEADER).reason, 'not-in-graph');
});

test('exact-case required: a case-different held path misses the allow-list', () => {
  const { bridge, st } = makeBridge();
  st.session = { open: true, sessionId: 1, context: 'world', sourcePath: path.join(ROOT, 'rooms', 'HALL.wrl') };
  assert.equal(load(bridge, HEADER).reason, 'not-in-graph');
});

test('symlink escape is re-refused at preview time', () => {
  const { bridge, st } = makeBridge();
  st.realpathOk = false;
  assert.equal(load(bridge, HEADER).reason, 'symlink-escape');
});

test('a path outside the root is refused before any graph lookup', () => {
  const { bridge, st } = makeBridge();
  st.session = { open: true, sessionId: 1, context: 'world', sourcePath: '/etc/passwd' };
  assert.equal(load(bridge, HEADER).reason, 'outside-root');
});

test('stale scan: no scan at all is refused', () => {
  const { bridge, st } = makeBridge();
  st.scan = null;
  assert.equal(load(bridge, HEADER).reason, 'no-scan');
});

test('stale scan: a scan from ANOTHER project root is refused', () => {
  const { bridge, st } = makeBridge();
  st.scan = makeScan({ root: path.resolve('/proj/otherworld'), primary: path.join(path.resolve('/proj/otherworld'), 'entry.wrl') });
  assert.equal(load(bridge, HEADER).reason, 'root-mismatch');
});

test('no open World Project is refused', () => {
  const { bridge, st } = makeBridge();
  st.root = null; st.primary = null;
  assert.equal(load(bridge, HEADER).reason, 'no-world-project');
});

// ---- overlay + scheme-handler integration -------------------------------------

function servingResolve(bridge, absTarget, files) {
  // Drive the REAL resolveWorldRequest exactly as main.js's handler does.
  const ctx = bridge.servingContext();
  assert.ok(ctx, 'serving context active');
  return resolveWorldRequest(ctx, worldAssetUrl(ROOT, absTarget), {
    readSource: (p) => {
      const v = files[path.resolve(p)];
      if (Buffer.isBuffer(v)) return { text: zlib.gunzipSync(v).toString('utf8'), wasGzipped: true };
      return { text: v, wasGzipped: false };
    },
    readFile: (p) => Buffer.from('PNGBYTES'),
    overlayLookup: (abs) => bridge.overlayTextFor(abs),
  });
}

test('overlay hit only AFTER disk authorization: the edited nested WRL serves the buffer', () => {
  const { bridge, st } = makeBridge();
  st.session = { open: true, sessionId: 3, context: 'world', sourcePath: NESTED };
  const buf = HEADER + 'DEF Overridden Shape {}\n';
  bridge.load({ sessionId: 3, text: buf, bufferVersion: 1 });
  const res = servingResolve(bridge, NESTED, st.files);
  assert.equal(res.status, 200);
  assert.equal(res.overlay, true);
  assert.equal(res.body.toString('utf8'), buf);
  assert.equal(res.mimeType, 'model/vrml');
});

test('disk fallback without an overlay: other authorized WRLs still read from disk', () => {
  const { bridge, st } = makeBridge();
  st.session = { open: true, sessionId: 3, context: 'world', sourcePath: NESTED };
  bridge.load({ sessionId: 3, text: HEADER + '# buf\n', bufferVersion: 1 });
  const res = servingResolve(bridge, PRIMARY, st.files);
  assert.equal(res.status, 200);
  assert.equal(res.overlay, undefined);
  assert.match(res.body.toString('utf8'), /rooms\/hall\.wrl/);
});

test('gzip disk dependency stays gzip-transparent alongside a plain in-memory override', () => {
  const { bridge, st } = makeBridge();
  st.session = { open: true, sessionId: 3, context: 'world', sourcePath: NESTED };
  bridge.load({ sessionId: 3, text: HEADER + '# buf\n', bufferVersion: 1 });
  const res = servingResolve(bridge, NESTED_GZ, st.files);
  assert.equal(res.status, 200);
  assert.match(res.body.toString('utf8'), /DEF Vault/); // decompressed, not gzip bytes
});

test('an unauthorized request is refused BEFORE the overlay is consulted', () => {
  const { bridge, st } = makeBridge();
  st.session = { open: true, sessionId: 3, context: 'world', sourcePath: NESTED };
  bridge.load({ sessionId: 3, text: HEADER, bufferVersion: 1 });
  let consulted = 0;
  const ctx = bridge.servingContext();
  const res = resolveWorldRequest(ctx, worldAssetUrl(ROOT, path.join(ROOT, 'newthing.wrl')), {
    overlayLookup: () => { consulted += 1; return HEADER; },
  });
  assert.equal(res.status, 404); // not in the graph -> refused
  assert.equal(consulted, 0, 'overlay must never be consulted for an unauthorized path');
});

test('overlay presence alone cannot authorize: a traversal request stays refused', () => {
  const { bridge } = makeBridge();
  load(bridge, HEADER);
  const ctx = bridge.servingContext();
  const res = resolveWorldRequest(ctx, 'wrlworld://project/..%2F..%2Fetc%2Fpasswd', {
    overlayLookup: () => HEADER,
  });
  assert.equal(res.status, 403);
});

test('assets are never overridden: a texture request ignores the overlay hook', () => {
  const { bridge, st } = makeBridge();
  bridge.load({ sessionId: 1, text: HEADER, bufferVersion: 1 });
  const res = servingResolve(bridge, TEXTURE, st.files);
  assert.equal(res.status, 200);
  assert.equal(res.overlay, undefined);
  assert.equal(res.mimeType, 'image/png');
});

test('no serving context when inactive: overlayTextFor is null before any load', () => {
  const { bridge } = makeBridge();
  assert.equal(bridge.servingContext(), null);
  assert.equal(bridge.overlayTextFor(NESTED), null);
});

// ---- version / generation ordering ---------------------------------------------

test('buffer versions are monotonic; an older version is refused as stale', () => {
  const { bridge } = makeBridge();
  load(bridge, HEADER + '# v2\n', 2);
  const older = load(bridge, HEADER + '# v1\n', 1);
  assert.equal(older.ok, false);
  assert.equal(older.reason, 'stale-version');
  assert.equal(bridge.describe(1).bufferVersion, 2);
});

test('an equal-version manual Update is an idempotent re-render (fresh generation)', () => {
  const { bridge } = makeBridge();
  const a = load(bridge, HEADER + '# same\n', 3);
  const b = load(bridge, HEADER + '# same\n', 3);
  assert.equal(b.ok, true);
  assert.ok(b.generation > a.generation);
});

test('stale response rejection: an older generation can never be accepted', () => {
  const { bridge } = makeBridge();
  const a = load(bridge, HEADER + '# a\n', 1);
  const b = load(bridge, HEADER + '# b\n', 2);
  assert.equal(bridge.accept({ sessionId: 1, generation: a.generation }).ok, false);
  assert.equal(bridge.accept({ sessionId: 1, generation: b.generation }).ok, true);
  assert.equal(bridge.accept({ sessionId: 1, generation: b.generation }).ok, false, 'replay refused');
});

test('an oversized buffer is refused with no residue', () => {
  const { bridge } = makeBridge();
  const res = load(bridge, 'x'.repeat(8 * 1024 * 1024 + 16));
  assert.equal(res.reason, 'too-large');
  assert.equal(bridge.describe(1).hasOverlay, false);
});

// ---- buffer-reference findings --------------------------------------------------

test('a NEW local reference (exists, exact case, not in graph) is surfaced, never loaded', () => {
  const { bridge } = makeBridge();
  const buf = HEADER + 'Inline { url "newthing.wrl" }\n';
  const res = load(bridge, buf);
  assert.deepEqual(res.buffer.newRefs, ['newthing.wrl']);
  // Authorization is UNCHANGED: the new file still misses the allow-list.
  const ctx = bridge.servingContext();
  assert.equal(ctx.authorized.has(path.join(ROOT, 'newthing.wrl')), false);
});

test('a missing buffer reference is classified missing', () => {
  const { bridge } = makeBridge();
  const res = load(bridge, HEADER + 'Inline { url "rooms/ghost.wrl" }\n');
  assert.deepEqual(res.buffer.missingRefs, ['rooms/ghost.wrl']);
  assert.ok(res.missingAssets.includes('rooms/ghost.wrl'), 'merged into the advisory list');
});

test('a case-mismatched buffer reference is classified, not loaded', () => {
  const { bridge } = makeBridge();
  const res = load(bridge, HEADER + 'ImageTexture { url "textures/wood.png" }\n');
  assert.equal(res.buffer.caseRefs.length, 1);
  assert.equal(res.buffer.caseRefs[0].actual, 'Wood.PNG');
});

test('remote buffer references are surfaced and never fetched', () => {
  const { bridge } = makeBridge();
  const res = load(bridge, HEADER + 'ImageTexture { url "http://example.com/x.png" }\n');
  assert.deepEqual(res.buffer.remoteRefs, ['http://example.com/x.png']);
  assert.ok(res.remoteUrls.includes('http://example.com/x.png'));
});

test('unsafe buffer references (absolute / traversal) are surfaced and refused', () => {
  const { bridge } = makeBridge();
  const res = load(bridge, HEADER + 'Inline { url "../outside.wrl" }\nInline { url "/abs/path.wrl" }\n');
  assert.equal(res.buffer.unsafeRefs.length, 2);
});

test('already-authorized references produce no findings', () => {
  const { bridge } = makeBridge();
  const res = load(bridge, HEADER + 'Inline { url "rooms/hall.wrl" }\nImageTexture { url "textures/stone.png" }\n');
  assert.deepEqual(res.buffer.newRefs, []);
  assert.deepEqual(res.buffer.missingRefs, []);
  assert.deepEqual(res.buffer.caseRefs, []);
});

// ---- Find new files (explicit rescan) -------------------------------------------

test('Find new files runs the injected rescan; the next Update uses the NEW graph', async () => {
  const { bridge, st } = makeBridge();
  let rescans = 0;
  const NEW = path.join(ROOT, 'newthing.wrl');
  st.rescan = async () => {
    rescans += 1;
    const g = makeGraph();
    g.wrlNodes.push({ path: NEW, depth: 1, refs: [] });
    st.scan = makeScan({ graph: g });
    return st.scan;
  };
  // Before: the buffer ref is new + unauthorized.
  const before = load(bridge, HEADER + 'Inline { url "newthing.wrl" }\n', 1);
  assert.deepEqual(before.buffer.newRefs, ['newthing.wrl']);
  // Explicit action only: nothing rescanned yet.
  assert.equal(rescans, 0);
  const r = await bridge.rescanForNewFiles({ sessionId: 1 });
  assert.equal(r.ok, true);
  assert.equal(rescans, 1);
  // The overlay (the unsaved buffer) survived the rescan.
  assert.equal(bridge.describe(1).hasOverlay, true);
  // A fresh Update authorizes the file against the new graph: no new-ref finding,
  // and the scheme context now serves it.
  st.files[NEW] = HEADER + 'DEF NewThing Shape {}\n';
  const after = load(bridge, HEADER + 'Inline { url "newthing.wrl" }\n', 2);
  assert.deepEqual(after.buffer.newRefs, []);
  assert.equal(after.ok, true);
  assert.equal(bridge.servingContext().authorized.has(NEW), true);
});

test('a busy rescan is reported, not queued', async () => {
  const { bridge, st } = makeBridge();
  st.rescan = async () => { const e = new Error('busy'); e.code = 'EBUSY'; throw e; };
  const r = await bridge.rescanForNewFiles({ sessionId: 1 });
  assert.deepEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: 'busy' });
});

// ---- saved-version fallback ------------------------------------------------------

test('Show saved version renders entirely from disk and skips the overlay', () => {
  const { bridge, st } = makeBridge();
  const buf = HEADER + '# unsaved\n';
  load(bridge, buf, 1);
  const saved = bridge.saved({ sessionId: 1 });
  assert.equal(saved.ok, true);
  assert.equal(saved.saved, true);
  assert.match(saved.text, /rooms\/hall\.wrl/); // the DISK primary, not the buffer
  // This render's scheme reads skip the overlay entirely...
  assert.equal(bridge.overlayTextFor(PRIMARY), null);
  // ...but the unsaved overlay state survives for a later Update.
  assert.equal(bridge.describe(1).hasOverlay, true);
  const again = load(bridge, buf, 1);
  assert.equal(again.ok, true);
  assert.equal(again.text, buf);
  assert.equal(bridge.overlayTextFor(PRIMARY), buf);
});

test('saved fallback for a NESTED document serves the saved nested WRL from disk', () => {
  const { bridge, st } = makeBridge();
  st.session = { open: true, sessionId: 4, context: 'world', sourcePath: NESTED };
  bridge.load({ sessionId: 4, text: HEADER + '# nested buf\n', bufferVersion: 1 });
  bridge.saved({ sessionId: 4 });
  const res = servingResolve(bridge, NESTED, st.files);
  assert.equal(res.status, 200);
  assert.equal(res.overlay, undefined);
  assert.match(res.body.toString('utf8'), /DEF Hall Shape/);
});

// ---- cleanup ---------------------------------------------------------------------

test('document/session switch invalidates the previous overlay (no nested-buffer leak)', () => {
  const { bridge, st } = makeBridge();
  st.session = { open: true, sessionId: 5, context: 'world', sourcePath: NESTED };
  bridge.load({ sessionId: 5, text: HEADER + '# old nested\n', bufferVersion: 1 });
  // The editor reopens a different document -> new sessionId.
  st.session = { open: true, sessionId: 6, context: 'world', sourcePath: PRIMARY };
  bridge.load({ sessionId: 6, text: HEADER + '# new primary\n', bufferVersion: 1 });
  // The prior session can never serve buffer content again.
  assert.equal(bridge.describe(5).open, false);
  const r = bridge.overlay.resolve({ sessionId: 5, path: NESTED, profile: 'world' });
  assert.equal(r.status, 'closed');
});

test('project switch: the new project\'s scan cannot serve the old document', () => {
  const { bridge, st } = makeBridge();
  load(bridge, HEADER, 1);
  // The user opens ANOTHER project (root+primary+scan all move on).
  const OTHER = path.resolve('/proj/second');
  st.root = OTHER;
  st.primary = path.join(OTHER, 'main.wrl');
  st.scan = makeScan({ root: OTHER, primary: path.join(OTHER, 'main.wrl'), graph: { wrlNodes: [{ path: path.join(OTHER, 'main.wrl') }], assets: [], missing: [], caseMismatches: [], remoteRefs: [], unsafe: [], stats: {} } });
  const res = load(bridge, HEADER, 2);
  assert.equal(res.ok, false); // held doc is outside the new root / not in its graph
  assert.ok(['outside-root', 'not-in-graph', 'root-mismatch'].includes(res.reason));
});

test('session close reaches zero overlays, zero generations, no serving context', () => {
  const { bridge } = makeBridge();
  load(bridge, HEADER, 1);
  bridge.invalidateSession(1);
  const leak = bridge.leak();
  assert.equal(leak.size, 0);
  assert.equal(leak.activeGenerations, 0);
  assert.equal(leak.serving, false);
  assert.equal(bridge.overlayTextFor(PRIMARY), null);
  assert.equal(bridge.servingContext(), null);
});

test('renderer-reload cleanup: clear() wipes everything', () => {
  const { bridge } = makeBridge();
  load(bridge, HEADER, 1);
  bridge.clear();
  const leak = bridge.leak();
  assert.deepEqual({ size: leak.size, gens: leak.activeGenerations, serving: leak.serving },
    { size: 0, gens: 0, serving: false });
});

test('no source mutation, no temporary WRL: the bridge only ever READS injected deps', () => {
  const { bridge, st } = makeBridge();
  const beforeFiles = JSON.stringify(Object.keys(st.files).sort());
  const beforeText = st.files[PRIMARY];
  load(bridge, HEADER + '# edited heavily\n', 1);
  bridge.saved({ sessionId: 1 });
  assert.equal(JSON.stringify(Object.keys(st.files).sort()), beforeFiles, 'no file created');
  assert.equal(st.files[PRIMARY], beforeText, 'no file mutated');
  // Every disk touch went through readSaved (a read), nothing else.
  assert.ok(st.reads.length > 0);
  assert.ok(st.reads.every((p) => typeof p === 'string'));
});

test('leak surface never exposes buffer text', () => {
  const { bridge } = makeBridge();
  const secret = HEADER + '# SECRET-BYTES\n';
  load(bridge, secret, 1);
  assert.ok(!JSON.stringify(bridge.leak()).includes('SECRET-BYTES'));
  assert.ok(!JSON.stringify(bridge.describe(1)).includes('SECRET-BYTES'));
});
