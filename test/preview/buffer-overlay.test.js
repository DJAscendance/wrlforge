'use strict';
// Phase 7C1 -- pure tests for the unsaved-buffer preview foundation: the overlay
// registry, the last-valid-scene state machine, and the debounce/coalescing
// scheduler. No Electron, no fs, no sleeping -- time is injected. These prove the
// safety core: an overlay never authorizes a path, stale versions/generations are
// rejected, cleanup is deterministic, and buffer text never leaks into diagnostics.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createBufferOverlay, classifyBufferSize, utf8ByteLength,
  mallAuthorization, worldAuthorization,
  AUTO_REFRESH_MAX_BYTES, HARD_MAX_BYTES, RESOLVE,
} = require('../../src/preview/buffer-overlay');

const State = require('../../src/preview/preview-state');
const { createPreviewScheduler } = require('../../src/preview/preview-scheduler');

const MALL_PATH = '/proj/item/thing.wrl';
const WORLD_PATH = '/proj/world/rooms/hall.wrl';

function mallReg(overlay, over = {}) {
  const path = over.path || MALL_PATH;
  return overlay.register({
    sessionId: over.sessionId || 's1',
    docId: over.docId || `mall:${path}`,
    path,
    profile: 'mall',
    bufferVersion: over.bufferVersion == null ? 1 : over.bufferVersion,
    text: over.text == null ? '#VRML V2.0 utf8\nShape { geometry Box {} }\n' : over.text,
    authorization: over.authorization || mallAuthorization(path),
    byteLength: over.byteLength,
  });
}

function worldReg(overlay, over = {}) {
  const path = over.path || WORLD_PATH;
  return overlay.register({
    sessionId: over.sessionId || 'w1',
    docId: over.docId || `world:${path}`,
    path,
    profile: 'world',
    bufferVersion: over.bufferVersion == null ? 1 : over.bufferVersion,
    text: over.text == null ? '#VRML V2.0 utf8\nGroup {}\n' : over.text,
    authorization: over.authorization || worldAuthorization(path, { inGraph: true }),
    byteLength: over.byteLength,
  });
}

// ---------------------------------------------------------------- registration --

test('Mall registration and resolution serves buffer text for the held path', () => {
  const overlay = createBufferOverlay();
  const desc = mallReg(overlay);
  assert.equal(desc.hasOverlay, true);
  assert.equal(desc.profile, 'mall');
  const gen = overlay.beginGeneration('s1');
  const r = overlay.resolve({ sessionId: 's1', generation: gen, path: MALL_PATH, docId: `mall:${MALL_PATH}`, profile: 'mall' });
  assert.equal(r.status, RESOLVE.OVERLAY);
  assert.match(r.text, /Box/);
  assert.equal(r.bufferVersion, 1);
});

test('World registration and resolution serves buffer text for an in-graph WRL', () => {
  const overlay = createBufferOverlay();
  worldReg(overlay);
  const gen = overlay.beginGeneration('w1');
  const r = overlay.resolve({ sessionId: 'w1', generation: gen, path: WORLD_PATH, profile: 'world' });
  assert.equal(r.status, RESOLVE.OVERLAY);
  assert.match(r.text, /Group/);
});

test('disk fallback: a different authorized path in the same session is not overridden', () => {
  const overlay = createBufferOverlay();
  worldReg(overlay);
  const gen = overlay.beginGeneration('w1');
  const r = overlay.resolve({ sessionId: 'w1', generation: gen, path: '/proj/world/rooms/other.wrl' });
  assert.equal(r.status, RESOLVE.DISK);
  assert.equal(r.text, undefined);
});

test('missing entry: an open session with no overlay resolves to missing (caller reads disk)', () => {
  const overlay = createBufferOverlay();
  // Register then invalidate the document to reach the open-but-no-entry state.
  mallReg(overlay);
  overlay.invalidateDocument('s1');
  const gen = overlay.describe('s1').generation;
  const r = overlay.resolve({ sessionId: 's1', generation: gen, path: MALL_PATH });
  assert.equal(r.status, RESOLVE.MISSING);
});

test('multiple sessions are independent', () => {
  const overlay = createBufferOverlay();
  mallReg(overlay, { sessionId: 'a', path: '/proj/a.wrl', docId: 'mall:/proj/a.wrl', authorization: mallAuthorization('/proj/a.wrl'), text: 'AAA' });
  mallReg(overlay, { sessionId: 'b', path: '/proj/b.wrl', docId: 'mall:/proj/b.wrl', authorization: mallAuthorization('/proj/b.wrl'), text: 'BBB' });
  const ga = overlay.beginGeneration('a');
  const gb = overlay.beginGeneration('b');
  assert.match(overlay.resolve({ sessionId: 'a', generation: ga, path: '/proj/a.wrl' }).text, /AAA/);
  assert.match(overlay.resolve({ sessionId: 'b', generation: gb, path: '/proj/b.wrl' }).text, /BBB/);
  assert.equal(overlay.size, 2);
});

test('multiple sequential documents in one session (switch clears then re-registers)', () => {
  const overlay = createBufferOverlay();
  mallReg(overlay, { sessionId: 's', path: '/proj/one.wrl', docId: 'mall:/proj/one.wrl', authorization: mallAuthorization('/proj/one.wrl'), text: 'ONE' });
  overlay.invalidateDocument('s'); // document switch
  mallReg(overlay, { sessionId: 's', path: '/proj/two.wrl', docId: 'mall:/proj/two.wrl', authorization: mallAuthorization('/proj/two.wrl'), bufferVersion: 1, text: 'TWO' });
  const g = overlay.beginGeneration('s');
  const r = overlay.resolve({ sessionId: 's', generation: g, path: '/proj/two.wrl' });
  assert.match(r.text, /TWO/);
  // The first doc's path is no longer overlaid.
  assert.equal(overlay.resolve({ sessionId: 's', generation: g, path: '/proj/one.wrl' }).status, RESOLVE.DISK);
});

// ------------------------------------------------------------ version/generation --

test('version monotonicity: a lower buffer version is rejected', () => {
  const overlay = createBufferOverlay();
  mallReg(overlay, { bufferVersion: 5 });
  assert.throws(() => mallReg(overlay, { bufferVersion: 4 }), /ESTALEVERSION|<=/);
  // Equal version is also rejected (not strictly newer).
  assert.throws(() => mallReg(overlay, { bufferVersion: 5 }), /ESTALEVERSION|<=/);
  // A newer version replaces.
  const d = mallReg(overlay, { bufferVersion: 6, text: 'newer' });
  assert.equal(d.bufferVersion, 6);
});

test('generation monotonicity: begin bumps, accept requires the current generation', () => {
  const overlay = createBufferOverlay();
  mallReg(overlay);
  const g1 = overlay.beginGeneration('s1');
  const g2 = overlay.beginGeneration('s1');
  assert.equal(g2, g1 + 1);
  // Accepting the older generation is stale.
  assert.equal(overlay.acceptGeneration('s1', g1).ok, false);
  assert.equal(overlay.acceptGeneration('s1', g1).reason, 'stale');
  // Accepting the current one works.
  assert.equal(overlay.acceptGeneration('s1', g2).ok, true);
  // Replaying an accepted generation is rejected.
  assert.equal(overlay.acceptGeneration('s1', g2).reason, 'replayed');
});

test('stale completion rejection: an older generation never resolves as live', () => {
  const overlay = createBufferOverlay();
  mallReg(overlay);
  const g1 = overlay.beginGeneration('s1');
  overlay.beginGeneration('s1'); // g2 is now current
  const r = overlay.resolve({ sessionId: 's1', generation: g1, path: MALL_PATH });
  assert.equal(r.status, RESOLVE.STALE);
});

test('a newer buffer version is never replaced by an older one (interleaved)', () => {
  const overlay = createBufferOverlay();
  mallReg(overlay, { bufferVersion: 10, text: 'v10' });
  assert.throws(() => mallReg(overlay, { bufferVersion: 9, text: 'v9' }));
  const g = overlay.beginGeneration('s1');
  assert.match(overlay.resolve({ sessionId: 's1', generation: g, path: MALL_PATH }).text, /v10/);
});

// -------------------------------------------------------------- invalidation ----

test('document invalidation clears the entry but keeps the session', () => {
  const overlay = createBufferOverlay();
  mallReg(overlay);
  assert.equal(overlay.invalidateDocument('s1'), true);
  assert.equal(overlay.describe('s1').open, true);
  assert.equal(overlay.describe('s1').hasOverlay, false);
});

test('session invalidation closes the session forever', () => {
  const overlay = createBufferOverlay();
  mallReg(overlay);
  assert.equal(overlay.invalidateSession('s1'), true);
  const g = 999;
  assert.equal(overlay.resolve({ sessionId: 's1', generation: g, path: MALL_PATH }).status, RESOLVE.CLOSED);
  // Re-registering a closed session throws.
  assert.throws(() => mallReg(overlay), /ECLOSED|closed/);
  // beginGeneration on a closed session throws.
  assert.throws(() => overlay.beginGeneration('s1'), /ECLOSED|closed/);
});

test('full clear wipes every session', () => {
  const overlay = createBufferOverlay();
  mallReg(overlay, { sessionId: 'a', path: '/proj/a.wrl', docId: 'd', authorization: mallAuthorization('/proj/a.wrl') });
  worldReg(overlay, { sessionId: 'b' });
  overlay.clear();
  assert.equal(overlay.size, 0);
  assert.deepEqual(overlay.describe().sessions, []);
});

// ------------------------------------------------------------------ size tiers --

test('auto-refresh threshold: a buffer at/under 1 MiB is auto-eligible', () => {
  const c = classifyBufferSize(AUTO_REFRESH_MAX_BYTES);
  assert.equal(c.tier, 'auto');
  assert.equal(c.autoEligible, true);
  const overlay = createBufferOverlay();
  const d = mallReg(overlay, { byteLength: 500 * 1024, text: 'x' });
  assert.equal(d.sizeTier, 'auto');
});

test('manual-only threshold: a buffer over 1 MiB is valid but manual-update only', () => {
  const c = classifyBufferSize(AUTO_REFRESH_MAX_BYTES + 1);
  assert.equal(c.tier, 'manual');
  assert.equal(c.autoEligible, false);
  assert.equal(c.manualEligible, true);
  const overlay = createBufferOverlay();
  const d = mallReg(overlay, { byteLength: 2 * 1024 * 1024, text: 'big' });
  assert.equal(d.sizeTier, 'manual');
});

test('hard maximum: an oversized buffer is refused without truncation and stores nothing', () => {
  const c = classifyBufferSize(HARD_MAX_BYTES + 1);
  assert.equal(c.tier, 'refused');
  const overlay = createBufferOverlay();
  assert.throws(() => mallReg(overlay, { byteLength: HARD_MAX_BYTES + 1, text: 'huge' }),
    /EBUFFERTOOLARGE|hard maximum/);
  // Nothing was stored.
  assert.equal(overlay.size, 0);
  assert.equal(overlay.describe('s1').known, false);
});

test('utf8ByteLength counts UTF-8 bytes, not code units', () => {
  assert.equal(utf8ByteLength('abc'), 3);
  assert.equal(utf8ByteLength('é'), 2); // é
  assert.equal(utf8ByteLength('\u{1F600}'), 4); // emoji
});

// ------------------------------------------------------------------- security ----

test('forged/mismatched authorization proofs are rejected', () => {
  const overlay = createBufferOverlay();
  const isNoAuth = (e) => e.code === 'ENOAUTH';
  // Missing proof.
  assert.throws(() => overlay.register({ sessionId: 's', docId: 'd', path: MALL_PATH, profile: 'mall', bufferVersion: 1, text: 'x' }), isNoAuth);
  // ok:false proof.
  assert.throws(() => mallReg(overlay, { authorization: { ok: false, profile: 'mall', source: 'mall-session', path: MALL_PATH } }), isNoAuth);
  // Proof for a DIFFERENT path than the entry (path spoof).
  assert.throws(() => mallReg(overlay, { authorization: mallAuthorization('/proj/evil.wrl') }), isNoAuth);
  // World proof reused for a mall registration (wrong source).
  assert.throws(() => mallReg(overlay, { authorization: worldAuthorization(MALL_PATH, { inGraph: true }) }), isNoAuth);
  // World proof not in the graph.
  assert.throws(() => worldReg(overlay, { authorization: worldAuthorization(WORLD_PATH, { inGraph: false }) }), isNoAuth);
});

test('cross-session access: a request with the wrong session id cannot read another buffer', () => {
  const overlay = createBufferOverlay();
  mallReg(overlay, { sessionId: 'real', text: 'SECRET' });
  const r = overlay.resolve({ sessionId: 'forged', generation: 1, path: MALL_PATH });
  assert.equal(r.status, RESOLVE.CLOSED);
  assert.equal(r.text, undefined);
});

test('cross-document access: a matching path but wrong docId is unauthorized', () => {
  const overlay = createBufferOverlay();
  mallReg(overlay, { docId: 'mall:real' });
  const g = overlay.beginGeneration('s1');
  const r = overlay.resolve({ sessionId: 's1', generation: g, path: MALL_PATH, docId: 'mall:other' });
  assert.equal(r.status, RESOLVE.UNAUTHORIZED);
  assert.equal(r.reason, 'doc-mismatch');
});

test('profile mismatch on resolve is unauthorized', () => {
  const overlay = createBufferOverlay();
  worldReg(overlay);
  const g = overlay.beginGeneration('w1');
  const r = overlay.resolve({ sessionId: 'w1', generation: g, path: WORLD_PATH, profile: 'mall' });
  assert.equal(r.status, RESOLVE.UNAUTHORIZED);
});

test('unknown/invalid profile is rejected at registration', () => {
  const overlay = createBufferOverlay();
  assert.throws(() => overlay.register({ sessionId: 's', docId: 'd', path: MALL_PATH, profile: 'generic', bufferVersion: 1, text: 'x', authorization: { ok: true } }), (e) => e.code === 'EPROFILE');
});

test('traversal-shaped identity only matches the exact authorized path', () => {
  const overlay = createBufferOverlay();
  mallReg(overlay);
  const g = overlay.beginGeneration('s1');
  // A traversal-shaped path that is NOT the entry path -> disk fallback, never overlay.
  const r = overlay.resolve({ sessionId: 's1', generation: g, path: '/proj/item/../item/thing.wrl' });
  assert.equal(r.status, RESOLVE.DISK);
});

test('overlay access after session close returns closed, never text', () => {
  const overlay = createBufferOverlay();
  mallReg(overlay, { text: 'PRIVATE' });
  const g = overlay.beginGeneration('s1');
  overlay.invalidateSession('s1');
  const r = overlay.resolve({ sessionId: 's1', generation: g, path: MALL_PATH });
  assert.equal(r.status, RESOLVE.CLOSED);
  assert.equal(r.text, undefined);
});

test('stale generation and stale buffer version both refuse to serve/override', () => {
  const overlay = createBufferOverlay();
  mallReg(overlay, { bufferVersion: 3 });
  const g1 = overlay.beginGeneration('s1');
  overlay.beginGeneration('s1'); // supersede
  assert.equal(overlay.resolve({ sessionId: 's1', generation: g1, path: MALL_PATH }).status, RESOLVE.STALE);
  assert.throws(() => mallReg(overlay, { bufferVersion: 2 }), (e) => e.code === 'ESTALEVERSION');
});

test('describe() never leaks buffer text', () => {
  const overlay = createBufferOverlay();
  mallReg(overlay, { text: 'TOP-SECRET-BUFFER-CONTENT' });
  const one = JSON.stringify(overlay.describe('s1'));
  const all = JSON.stringify(overlay.describe());
  assert.doesNotMatch(one, /TOP-SECRET/);
  assert.doesNotMatch(all, /TOP-SECRET/);
  // The descriptor still exposes the leak-assertion surface.
  assert.equal(overlay.describe('s1').hasOverlay, true);
  assert.equal(overlay.describe().size, 1);
});

// --------------------------------------------------------------- determinism ----

test('determinism: identical operations yield identical descriptors', () => {
  function run() {
    const overlay = createBufferOverlay();
    mallReg(overlay, { bufferVersion: 2, text: 'same' });
    overlay.beginGeneration('s1');
    overlay.beginGeneration('s1');
    return overlay.describe('s1');
  }
  assert.deepEqual(run(), run());
});

test('no source mutation / no filesystem access: registration is pure text-in', () => {
  const overlay = createBufferOverlay();
  const text = '#VRML V2.0 utf8\nShape {}\n';
  const before = text;
  mallReg(overlay, { text });
  assert.equal(text, before); // input string is a primitive; unchanged by contract
  // The module must not require fs or electron.
  const src = require('fs').readFileSync(require.resolve('../../src/preview/buffer-overlay'), 'utf8');
  assert.doesNotMatch(src, /require\(['"]fs['"]\)/);
  assert.doesNotMatch(src, /require\(['"]electron['"]\)/);
});

test('leak surface: no overlay survives its owning session close', () => {
  const overlay = createBufferOverlay();
  mallReg(overlay, { sessionId: 'x' });
  worldReg(overlay, { sessionId: 'y' });
  assert.equal(overlay.size, 2);
  overlay.invalidateSession('x');
  overlay.invalidateSession('y');
  assert.equal(overlay.size, 0);
  assert.deepEqual(overlay.sessionIdsWithEntries(), []);
  assert.equal(overlay.activeGenerationCount, 0);
});

// ==================================================== last-valid state machine ==

const { PREVIEW_STATES, FAILURE } = State;

test('state: first successful preview goes Idle -> Updating -> Current', () => {
  let s = State.createPreviewState();
  assert.equal(s.state, PREVIEW_STATES.IDLE);
  s = State.beginUpdate(s, 1, 10);
  assert.equal(s.state, PREVIEW_STATES.UPDATING);
  s = State.succeed(s, 1, 10);
  assert.equal(s.state, PREVIEW_STATES.CURRENT);
  assert.equal(s.haveLastValid, true);
  assert.equal(s.displayedBufferVersion, 10);
});

test('state: an edit after Current marks Outdated', () => {
  let s = State.createPreviewState();
  s = State.beginUpdate(s, 1, 10);
  s = State.succeed(s, 1, 10);
  s = State.edit(s, 11);
  assert.equal(s.state, PREVIEW_STATES.OUTDATED);
  assert.equal(s.currentBufferVersion, 11);
});

test('state: a newer success replaces the displayed scene', () => {
  let s = State.createPreviewState();
  s = State.beginUpdate(s, 1, 10);
  s = State.succeed(s, 1, 10);
  s = State.beginUpdate(s, 2, 11);
  s = State.succeed(s, 2, 11);
  assert.equal(s.state, PREVIEW_STATES.CURRENT);
  assert.equal(s.displayedGeneration, 2);
  assert.equal(s.lastValidGeneration, 2);
});

test('state: a failed newer preview keeps the last valid scene', () => {
  let s = State.createPreviewState();
  s = State.beginUpdate(s, 1, 10);
  s = State.succeed(s, 1, 10);
  s = State.beginUpdate(s, 2, 11);
  s = State.fail(s, 2, FAILURE.SCENE_LOAD);
  assert.equal(s.state, PREVIEW_STATES.SHOWING_LAST_VALID);
  assert.equal(s.failureCategory, FAILURE.SCENE_LOAD);
  // The displayed scene did NOT advance to the broken generation.
  assert.equal(s.displayedGeneration, 1);
  assert.equal(s.lastValidGeneration, 1);
});

test('state: a failure with no previous scene goes Failed (no last valid)', () => {
  let s = State.createPreviewState();
  s = State.beginUpdate(s, 1, 10);
  s = State.fail(s, 1, FAILURE.SYNTAX);
  assert.equal(s.state, PREVIEW_STATES.FAILED);
  assert.equal(s.haveLastValid, false);
});

test('state: an older success/failure never changes state after a newer generation begins', () => {
  let s = State.createPreviewState();
  s = State.beginUpdate(s, 1, 10);
  s = State.succeed(s, 1, 10);
  s = State.beginUpdate(s, 2, 11); // newer generation in flight
  const snapshot = s;
  // A late completion for the OLD generation 1 is ignored entirely.
  assert.deepEqual(State.succeed(s, 1, 10), snapshot);
  assert.deepEqual(State.fail(s, 1, FAILURE.SCENE_LOAD), snapshot);
});

test('state: manual disk fallback lands in Current with source=disk', () => {
  let s = State.createPreviewState();
  s = State.beginUpdate(s, 1, 5);
  s = State.diskFallback(s, 1, 5);
  assert.equal(s.state, PREVIEW_STATES.CURRENT);
  assert.equal(s.source, 'disk');
});

test('state: document switch forgets the displayed scene', () => {
  let s = State.createPreviewState();
  s = State.beginUpdate(s, 1, 10);
  s = State.succeed(s, 1, 10);
  s = State.switchDocument(s);
  assert.equal(s.state, PREVIEW_STATES.IDLE);
  assert.equal(s.haveLastValid, false);
  assert.equal(s.displayedGeneration, 0);
});

test('state: once closed, all transitions are no-ops', () => {
  let s = State.createPreviewState();
  s = State.beginUpdate(s, 1, 10);
  s = State.succeed(s, 1, 10);
  s = State.close(s);
  assert.equal(s.state, PREVIEW_STATES.CLOSED);
  assert.equal(State.edit(s, 99).state, PREVIEW_STATES.CLOSED);
  assert.equal(State.beginUpdate(s, 5, 99).state, PREVIEW_STATES.CLOSED);
  assert.equal(State.succeed(s, 5, 99).state, PREVIEW_STATES.CLOSED);
});

test('state: edit before any render stays Idle (nothing to be Outdated against)', () => {
  let s = State.createPreviewState();
  s = State.edit(s, 3);
  assert.equal(s.state, PREVIEW_STATES.IDLE);
  assert.equal(s.currentBufferVersion, 3);
});

test('state: transitions are pure (input frozen, not mutated)', () => {
  const s0 = State.createPreviewState();
  assert.ok(Object.isFrozen(s0));
  const s1 = State.beginUpdate(s0, 1, 1);
  assert.notEqual(s1, s0);
  assert.equal(s0.state, PREVIEW_STATES.IDLE); // original untouched
});

// ===================================================== debounce / coalescing ===

test('scheduler: fake-clock debounce fires only after the debounce window', () => {
  const sch = createPreviewScheduler({ debounceMs: 700 });
  sch.requestAuto('s', { bufferVersion: 1, byteLength: 100, at: 1000 });
  assert.equal(sch.poll('s', 1699).fire, false); // not yet due
  const fired = sch.poll('s', 1700);
  assert.equal(fired.fire, true);
  assert.equal(fired.bufferVersion, 1);
  // Consumed: a second poll finds nothing.
  assert.equal(sch.poll('s', 5000).fire, false);
});

test('scheduler: rapid edits coalesce into the newest version and slide the due time', () => {
  const sch = createPreviewScheduler({ debounceMs: 700 });
  sch.requestAuto('s', { bufferVersion: 1, byteLength: 10, at: 1000 });
  sch.requestAuto('s', { bufferVersion: 2, byteLength: 10, at: 1200 });
  sch.requestAuto('s', { bufferVersion: 3, byteLength: 10, at: 1500 });
  // Only one pending request exists.
  assert.equal(sch.pendingCount(), 1);
  // The earliest window (1000+700=1700) is NOT enough; it slid to 1500+700=2200.
  assert.equal(sch.poll('s', 1700).fire, false);
  const fired = sch.poll('s', 2200);
  assert.equal(fired.fire, true);
  assert.equal(fired.bufferVersion, 3); // newest wins
});

test('scheduler: an explicit Update bypasses the debounce (immediate)', () => {
  const sch = createPreviewScheduler({ debounceMs: 700 });
  const res = sch.requestManual('s', { bufferVersion: 4, at: 1000 });
  assert.equal(res.immediate, true);
  const fired = sch.poll('s', 1000);
  assert.equal(fired.fire, true);
  assert.equal(fired.kind, 'manual');
});

test('scheduler: buffers over the auto threshold are declined for auto but allowed for manual', () => {
  const sch = createPreviewScheduler({ debounceMs: 700, autoMaxBytes: 1024 * 1024 });
  const auto = sch.requestAuto('s', { bufferVersion: 1, byteLength: 2 * 1024 * 1024, at: 1000 });
  assert.equal(auto.scheduled, false);
  assert.equal(auto.reason, 'manual-only');
  assert.equal(sch.pendingCount(), 0);
  const man = sch.requestManual('s', { bufferVersion: 1, at: 1000 });
  assert.equal(man.scheduled, true);
});

test('scheduler: cancel clears a pending request (document switch / session close)', () => {
  const sch = createPreviewScheduler({ debounceMs: 700 });
  sch.requestAuto('s', { bufferVersion: 1, byteLength: 10, at: 1000 });
  assert.equal(sch.cancel('s'), true);
  assert.equal(sch.poll('s', 9999).fire, false);
  assert.equal(sch.pendingCount(), 0);
});

test('scheduler: only one generation/request is pending per session at a time', () => {
  const sch = createPreviewScheduler({ debounceMs: 700 });
  sch.requestAuto('a', { bufferVersion: 1, byteLength: 10, at: 1000 });
  sch.requestAuto('a', { bufferVersion: 2, byteLength: 10, at: 1100 });
  sch.requestManual('a', { bufferVersion: 3, at: 1200 });
  assert.equal(sch.pendingCount(), 1);
  assert.equal(sch.pendingFor('a').bufferVersion, 3);
});
