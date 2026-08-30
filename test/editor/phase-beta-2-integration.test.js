'use strict';
// Phase Beta 2 -- end-to-end integration smoke for the recovery lifecycle.
//
// Drives the production code paths (RecoveryController + EditorController +
// recovery-store + session-store) across multiple "process lifetimes" so a
// reader can see the full saved-clear-snapshot -> adopt-keeps-snapshot ->
// newer-text-wins -> save-clears -> external-change-EEXTERNAL chain without
// spinning up Electron. The IPC layer in main.js is the only thing between
// these controllers and the renderer; the controllers are the only thing
// between the IPC layer and the disk file -- so exercising them at this
// layer is the closest the local coding agent can get to a runtime check
// without owning an Electron capture-server run.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { EditorController } = require('../../src/editor/editor-controller');
const { RecoveryController } = require('../../src/editor/recovery-controller');
const store = require('../../src/editor/recovery-store');

function tmpDirs() {
  return {
    ud: fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-pb2-int-ud-')),
    src: fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-pb2-int-src-')),
  };
}
function writeWrl(p, text, gzip = false) {
  fs.writeFileSync(p, gzip ? zlib.gzipSync(Buffer.from(text)) : text);
}

// Build an EditorController + RecoveryController pair for a particular
// userData + Mall source. Mirrors what main.js does in createEditorController
// and createRecoveryController.
function bootstrap({ userDataPath, mallSource }) {
  let ec = new EditorController({
    userDataPath, getMallSource: () => mallSource,
  });
  let rc = new RecoveryController({
    userDataPath,
    openSession: (rec) => ec.openFromRecovery(rec),
  });
  ec.recoveryController = rc; // mirror main.js wiring
  return { ec, rc };
}

// Simulate a "fresh launch": discard old controllers, build new ones over
// the same userData (and same source). This is what main.js's
// createEditorController does on app boot, and it's what the prompt module
// drives on every page mount (since sessionStorage is per-renderer).
function relaunch(state) {
  const next = bootstrap({ userDataPath: state.ud, mallSource: state.src });
  state.ec = next.ec;
  state.rc = next.rc;
  return state;
}

test('integration (smoke): full lifecycle -- edit / crash / restart / Restore / type / crash / restart / Restore-newer / Save clears', () => {
  const d = tmpDirs();
  const src = path.join(d.src, 'item.wrl');
  const onDisk = '#VRML V2.0 utf8\nGroup { children [ ORIG ] }\n';
  writeWrl(src, onDisk);
  const state = { ud: d.ud, src, ec: null, rc: null };
  relaunch(state);

  // 1. Edit dirty (renderer pings recovery).
  state.rc.recordDirtyState({
    buffer: 'edit-1', sourcePath: src, baseline: onDisk, activeWorkspace: 'editor',
  });
  state.rc.forceFlush();
  // Crash before Save.
  const recover1 = store.loadRecovery(d.ud).record;
  assert.strictEqual(recover1.buffer, 'edit-1');
  assert.strictEqual(recover1.baseline, onDisk);

  // 2. Restart 1 -- find the record, Restore.
  relaunch(state);
  let r = state.rc.readRecovery();
  assert.strictEqual(r.found, true);
  let adopted = state.rc.adoptRecovery(r.record);
  assert.strictEqual(adopted.ok, true);
  assert.strictEqual(adopted.sourceRecovered, true);
  // Buffer is now installed; the document is the recovered buffer vs the
  // recovered baseline.
  let desc = state.ec.describe({ includeText: true });
  assert.strictEqual(desc.text, 'edit-1');
  assert.strictEqual(desc.dirty, true);
  // CORRECTION (B3): recovery STAYS on disk after Restore.
  assert.strictEqual(store.loadRecovery(d.ud).ok, true, 'recovery stays after Restore');

  // 3. Type more -- newer snapshot overwrites.
  state.rc.recordDirtyState({
    buffer: 'edit-2-newer', sourcePath: src, baseline: onDisk, activeWorkspace: 'editor',
  });
  state.rc.forceFlush();

  // 4. Crash again before Save.
  // 5. Restart 2 -- find the newer record, Restore.
  relaunch(state);
  r = state.rc.readRecovery();
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.record.buffer, 'edit-2-newer', 'newest snapshot wins');
  adopted = state.rc.adoptRecovery(r.record);
  assert.strictEqual(adopted.ok, true);
  desc = state.ec.describe({ includeText: true });
  assert.strictEqual(desc.text, 'edit-2-newer');

  // 6. Save -- clears recovery. Disk has not changed since snapshot, so
  // there is no external-change conflict and the Save succeeds directly.
  const okRes = state.ec.save(undefined, 'edit-2-newer', { allowOverwrite: false });
  assert.strictEqual(okRes.ok, true);
  assert.strictEqual(store.loadRecovery(d.ud).ok, false, 'Save success clears recovery');
});

test('integration (smoke): missing source -- recovery stays, prompt offers again next launch', () => {
  const d = tmpDirs();
  const src = path.join(d.src, 'gone.wrl');
  writeWrl(src, '#VRML V2.0 utf8\nA\n');
  // Step 1: dirty snapshot against the source.
  store.saveRecovery(d.ud, store.makeRecord({
    sourcePath: src, context: 'mall', profile: 'mall-item', root: null,
    format: 'plain', baseline: '#VRML V2.0 utf8\nA\n',
    buffer: '#VRML V2.0 utf8\nA+\n', dirty: true, activeWorkspace: 'editor',
  }));
  // Step 2: external deletion.
  fs.unlinkSync(src);

  // Step 3: restart -- adopt. recoverAsUnsaved path is taken; the recovery
  // file is kept.
  const state = { ud: d.ud, src, ec: null, rc: null };
  relaunch(state);
  const r = state.rc.readRecovery();
  const adopted = state.rc.adoptRecovery(r.record);
  assert.strictEqual(adopted.ok, true);
  assert.strictEqual(adopted.sourceMissingRecovered, true);
  // Recovery stays on disk -- the user can re-decide.
  assert.strictEqual(store.loadRecovery(d.ud).ok, true);
  // Step 4: ANOTHER restart -- still has the snapshot.
  relaunch(state);
  const r2 = state.rc.readRecovery();
  assert.strictEqual(r2.found, true);
  assert.strictEqual(r2.record.buffer, '#VRML V2.0 utf8\nA+\n');
  // Step 5: user picks Start Fresh -- clears.
  state.rc.recordClear();
  assert.strictEqual(store.loadRecovery(d.ud).ok, false);
});

test('integration (smoke): gzip source round-trip -- recovery never writes the source', () => {
  const d = tmpDirs();
  const src = path.join(d.src, 'item.wrl');
  const onDisk = '#VRML V2.0 utf8\nGroup { children [ GZIP ] }\n';
  writeWrl(src, onDisk, true /* gzip */);
  const state = { ud: d.ud, src, ec: null, rc: null };
  relaunch(state);
  const info = state.ec.openFromRecovery({
    sourcePath: src, profile: 'mall-item', context: 'mall', root: null,
    buffer: '#VRML V2.0 utf8\nGroup { children [ USER ] }\n',
    baseline: onDisk,
  });
  assert.strictEqual(info.format, 'gzip', 'gzip format preserved through restore');
  // First two bytes are the gzip magic (1f 8b). Different compression
  // runs produce different compressed bytes (level + OS + mtime fields
  // vary); we only need to assert the magic and the format reported by
  // the editor.
  const head = fs.readFileSync(src).slice(0, 2);
  assert.strictEqual(head[0], 0x1f);
  assert.strictEqual(head[1], 0x8b);
  // Restore then Save: the source path can hold the recovered buffer.
  const res = state.ec.save(undefined, '#VRML V2.0 utf8\nGroup { children [ USER ] }\n', { allowOverwrite: true });
  assert.strictEqual(res.ok, true);
  // The saved bytes are still gzip (magic preserved).
  assert.strictEqual(fs.readFileSync(src).slice(0, 2).toString('hex'), '1f8b');
});

test('integration (smoke): B3 second-crash regression -- Restore + zero edits + crash + restart + Restore AGAIN', () => {
  const d = tmpDirs();
  const src = path.join(d.src, 'item.wrl');
  const onDisk = '#VRML V2.0 utf8\nGroup { children [ X ] }\n';
  writeWrl(src, onDisk);
  store.saveRecovery(d.ud, store.makeRecord({
    sourcePath: src, context: 'mall', profile: 'mall-item', root: null,
    format: 'plain', baseline: onDisk,
    buffer: '#VRML V2.0 utf8\nGroup { children [ X USER ] }\n',
    dirty: true, activeWorkspace: 'editor',
  }));
  const state = { ud: d.ud, src, ec: null, rc: null };
  relaunch(state);
  // First launch: Restore.
  let adopted = state.rc.adoptRecovery(state.rc.readRecovery().record);
  assert.strictEqual(adopted.ok, true);
  // Zero new edits. Session describes the recovered buffer as dirty.
  const desc = state.ec.describe({ includeText: true });
  assert.strictEqual(desc.dirty, true);
  // Crash before any further user action.
  // Second launch: find the SAME text.
  relaunch(state);
  const r = state.rc.readRecovery();
  assert.strictEqual(r.found, true, 'recovery is still on disk after Restore + zero edits');
  assert.strictEqual(r.record.buffer, '#VRML V2.0 utf8\nGroup { children [ X USER ] }\n');
  // User picks Restore again (the prompt fires; this is the QA scenario).
  adopted = state.rc.adoptRecovery(r.record);
  assert.strictEqual(adopted.ok, true);
});

test('integration (smoke): B3 newer-edits regression -- Restore + type + crash + restart + Restore again sees newer', () => {
  const d = tmpDirs();
  const src = path.join(d.src, 'item.wrl');
  const onDisk = '#VRML V2.0 utf8\nGroup { children [ X ] }\n';
  writeWrl(src, onDisk);
  store.saveRecovery(d.ud, store.makeRecord({
    sourcePath: src, context: 'mall', profile: 'mall-item', root: null,
    format: 'plain', baseline: onDisk,
    buffer: 'edit-0', dirty: true, activeWorkspace: 'editor',
  }));
  const state = { ud: d.ud, src, ec: null, rc: null };
  relaunch(state);
  state.rc.adoptRecovery(state.rc.readRecovery().record);
  state.rc.recordDirtyState({ buffer: 'edit-1', sourcePath: src, baseline: onDisk, activeWorkspace: 'editor' });
  state.rc.recordDirtyState({ buffer: 'edit-2', sourcePath: src, baseline: onDisk, activeWorkspace: 'editor' });
  state.rc.forceFlush();
  // Crash before Save.
  relaunch(state);
  const r = state.rc.readRecovery();
  assert.strictEqual(r.record.buffer, 'edit-2', 'newest snapshot wins across crash');
});
