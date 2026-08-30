'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { EditorController } = require('../../src/editor/editor-controller');

const WRL = '#VRML V2.0 utf8\nGroup { children [] }\n';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `wrlforge-${prefix}-`));
}
function writeWrl(dir, name, text = WRL, gzip = false) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, gzip ? zlib.gzipSync(Buffer.from(text)) : text);
  return p;
}

// A controller wired for Mall: getMallSource points at `mallPath`.
function mallController(mallPath, extra = {}) {
  return new EditorController({
    getMallSource: () => mallPath,
    userDataPath: extra.userDataPath || null,
    launchExternal: extra.launchExternal,
    promptSaveAs: extra.promptSaveAs,
  });
}

test('openMall authorizes the current Mall item; nothing open -> ENOMALL', () => {
  const dir = tmpDir('ctl-mall');
  const p = writeWrl(dir, 'item.wrl');
  const c = mallController(p);
  const d = c.openMall();
  assert.strictEqual(d.open, true);
  assert.strictEqual(d.text, WRL);
  assert.strictEqual(d.context, 'mall');
  assert.strictEqual(d.sessionId, 1);

  const none = new EditorController({});
  assert.throws(() => none.openMall(), (e) => e.code === 'ENOMALL');
});

test('openWorldPrimary / openWorldReference authorize against the world root + graph', () => {
  const root = tmpDir('ctl-world');
  const primary = writeWrl(root, 'world.wrl');
  const subDir = path.join(root, 'sub');
  fs.mkdirSync(subDir, { recursive: true });
  const nested = writeWrl(subDir, 'inner.wrl');
  const allowedWrl = new Set([path.resolve(primary), path.resolve(nested)]);
  const c = new EditorController({ getWorldContext: () => ({ root, primary, allowedWrl }) });

  const d1 = c.openWorldPrimary();
  assert.strictEqual(d1.context, 'world');
  assert.strictEqual(d1.sourcePath, path.resolve(primary));

  const d2 = c.openWorldReference(path.resolve(nested));
  assert.strictEqual(d2.sourcePath, path.resolve(nested));
  assert.strictEqual(d2.sessionId, 2, 'each open bumps the session id');
});

test('openWorldReference rejects traversal and unrelated in-root files', () => {
  const root = tmpDir('ctl-worldrej');
  const primary = writeWrl(root, 'world.wrl');
  writeWrl(root, 'stray.wrl');
  const allowedWrl = new Set([path.resolve(primary)]);
  const c = new EditorController({ getWorldContext: () => ({ root, primary, allowedWrl }) });

  assert.throws(() => c.openWorldReference('../../etc/passwd'), (e) => e.code === 'EAUTH' && e.reason === 'outside-root');
  assert.throws(() => c.openWorldReference('stray.wrl'), (e) => e.code === 'EAUTH' && e.reason === 'not-in-project');

  const noWorld = new EditorController({});
  assert.throws(() => noWorld.openWorldReference('x.wrl'), (e) => e.code === 'ENOWORLD');
});

test('setText validates its argument and drives dirty state', () => {
  const dir = tmpDir('ctl-settext');
  const c = mallController(writeWrl(dir, 'item.wrl'));
  const { sessionId } = c.openMall();
  assert.throws(() => c.setText(sessionId, 123), (e) => e.code === 'EARG');
  assert.strictEqual(c.setText(sessionId, WRL + '# edit\n').dirty, true);
  assert.strictEqual(c.setText(sessionId, WRL).dirty, false);
});

test('a stale sessionId is rejected on every mutating op', () => {
  const dir = tmpDir('ctl-stale');
  const c = mallController(writeWrl(dir, 'item.wrl'));
  const { sessionId } = c.openMall(); // current id = 1
  const stale = sessionId + 100;      // an id the renderer might still be holding

  assert.throws(() => c.setText(stale, WRL), (e) => e.code === 'ESTALE');
  assert.throws(() => c.save(stale, WRL), (e) => e.code === 'ESTALE');
  assert.throws(() => c.reload(stale), (e) => e.code === 'ESTALE');
  assert.throws(() => c.openInExternal(stale), (e) => e.code === 'ESTALE');
  // A read-only conflict probe with a stale id reports stale, doesn't throw.
  assert.deepStrictEqual(c.checkConflict(stale), { open: true, stale: true });
  // The matching id still works.
  assert.strictEqual(c.setText(sessionId, WRL + '#ok\n').dirty, true);
});

test('save writes only to the held path; conflict -> EEXTERNAL until allowOverwrite', () => {
  const dir = tmpDir('ctl-save');
  const p = writeWrl(dir, 'item.wrl');
  const c = mallController(p);
  const { sessionId } = c.openMall();
  c.setText(sessionId, WRL + '# mine\n');

  // External edit lands under us.
  fs.writeFileSync(p, WRL + '# theirs\n', 'utf8');
  assert.throws(() => c.save(sessionId), (e) => e.code === 'EEXTERNAL');
  assert.strictEqual(fs.readFileSync(p, 'utf8'), WRL + '# theirs\n', 'external change not clobbered');

  const res = c.save(sessionId, WRL + '# mine\n', { allowOverwrite: true });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.dirty, false);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), WRL + '# mine\n');
  assert.ok(res.backup && fs.existsSync(res.backup));
});

test('gzip source round-trips as gzip through the controller', () => {
  const dir = tmpDir('ctl-gzip');
  const p = writeWrl(dir, 'item.wrl', WRL, true);
  const c = mallController(p);
  const d = c.openMall();
  assert.strictEqual(d.format, 'gzip');
  c.setText(d.sessionId, WRL + '# gz\n');
  c.save(d.sessionId);
  const onDisk = fs.readFileSync(p);
  assert.strictEqual(onDisk[0], 0x1f);
  assert.strictEqual(zlib.gunzipSync(onDisk).toString('utf8'), WRL + '# gz\n');
});

test('saveAs goes through the main-owned dialog; the renderer names no write path', async () => {
  const dir = tmpDir('ctl-saveas');
  const p = writeWrl(dir, 'src.wrl', WRL, true);
  const dest = path.join(dir, 'copy.wrl');
  let asked = null;
  const c = mallController(p, { promptSaveAs: async (opts) => { asked = opts; return dest; } });
  const { sessionId } = c.openMall();

  const res = await c.saveAs(sessionId, WRL + '# as\n', { format: 'plain' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.sourcePath, dest);
  assert.strictEqual(res.format, 'plain');
  assert.ok(asked && asked.defaultPath === p, 'the dialog default is the current source, not a renderer value');
  assert.strictEqual(fs.readFileSync(dest, 'utf8'), WRL + '# as\n');
  // The session now points at the user-chosen file.
  assert.strictEqual(c.describe().sourcePath, dest);

  // A cancelled dialog is a clean no-op.
  const c2 = mallController(writeWrl(dir, 'src2.wrl'), { promptSaveAs: async () => null });
  const { sessionId: sid2 } = c2.openMall();
  const cancelled = await c2.saveAs(sid2, WRL);
  assert.deepStrictEqual(cancelled, { ok: false, canceled: true, sessionId: 1 });
});

test('reload discards buffer edits and takes the on-disk version', () => {
  const dir = tmpDir('ctl-reload');
  const p = writeWrl(dir, 'item.wrl');
  const c = mallController(p);
  const { sessionId } = c.openMall();
  c.setText(sessionId, 'unsaved');
  fs.writeFileSync(p, WRL + '# disk\n', 'utf8');
  const res = c.reload(sessionId);
  assert.strictEqual(res.text, WRL + '# disk\n');
  assert.strictEqual(c.describe().dirty, false);
});

test('openInExternal delegates to the injected launcher on the held source', () => {
  const dir = tmpDir('ctl-ext');
  const p = writeWrl(dir, 'item.wrl');
  const launched = [];
  const c = mallController(p, { launchExternal: (f) => { launched.push(f); return { launched: true }; } });
  const { sessionId } = c.openMall();
  const res = c.openInExternal(sessionId);
  assert.strictEqual(res.sourcePath, p);
  assert.deepStrictEqual(launched, [p], 'external editor opened the SAME source, not a renderer path');
  assert.strictEqual(res.editorStatus.launched, true);
});

test('session restore: persists on open, restores the last document', () => {
  const ud = tmpDir('ctl-restore-ud');
  const dir = tmpDir('ctl-restore');
  const p = writeWrl(dir, 'item.wrl');
  const c = mallController(p, { userDataPath: ud });
  c.openMall();

  // A brand-new controller (fresh process) restores from disk.
  const fresh = new EditorController({ userDataPath: ud });
  const r = fresh.restore();
  assert.strictEqual(r.restored, true);
  assert.strictEqual(r.sourcePath, path.resolve(p));
  assert.strictEqual(r.text, WRL);
});

test('session restore: missing file / nothing-saved / explicit close are not restored', () => {
  const ud = tmpDir('ctl-restore2-ud');
  const dir = tmpDir('ctl-restore2');

  // Nothing ever saved.
  assert.deepStrictEqual(new EditorController({ userDataPath: ud }).restore(), { open: false, restored: false, reason: 'none' });

  // Open then delete the file -> missing.
  const p = writeWrl(dir, 'item.wrl');
  const c = mallController(p, { userDataPath: ud });
  c.openMall();
  fs.rmSync(p);
  assert.strictEqual(new EditorController({ userDataPath: ud }).restore().reason, 'missing');

  // Re-create and open, then explicit close clears the record.
  writeWrl(dir, 'item.wrl');
  const c2 = mallController(p, { userDataPath: ud });
  const s2 = c2.openMall();
  c2.close(s2.sessionId);
  assert.strictEqual(new EditorController({ userDataPath: ud }).restore().reason, 'none');
});

test('world restore refuses a document that no longer sits inside its recorded root', () => {
  const ud = tmpDir('ctl-wrestore-ud');
  const root = tmpDir('ctl-wrestore');
  const primary = writeWrl(root, 'world.wrl');
  const allowedWrl = new Set([path.resolve(primary)]);
  const c = new EditorController({ userDataPath: ud, getWorldContext: () => ({ root, primary, allowedWrl }) });
  c.openWorldPrimary();

  // Same file, but pretend the recorded root moved: hand-write a record whose
  // root no longer contains the file.
  const store = require('../../src/editor/session-store');
  const rec = store.loadSession(ud);
  assert.strictEqual(rec.context, 'world');
  store.saveSession(ud, { ...rec, root: '/gone-root-xyz' });
  assert.strictEqual(new EditorController({ userDataPath: ud }).restore().reason, 'moved-root');
});

// Phase Beta 2 -- openFromRecovery restores a dirty buffer WITHOUT writing the
// source file. The source byte on disk is identical before and after.
test('openFromRecovery installs a dirty buffer; the source file is untouched', () => {
  const dir = tmpDir('ctl-recovery');
  const p = writeWrl(dir, 'item.wrl', WRL);
  const onDisk = fs.readFileSync(p);
  const c = mallController(p);
  // Pre-condition: source file has known bytes.
  assert.strictEqual(onDisk.toString('utf8'), WRL);
  // Adopt the recovery snapshot -- simulate that the user had typed buffer
  // 'WRL + NEW LINE' on top of the original WRL when the editor "crashed".
  const RECOVERED_BUFFER = '#VRML V2.0 utf8\nGroup { children [ NEW LINE ] }\n';
  const d = c.openFromRecovery({
    sourcePath: p,
    profile: 'mall-item',
    context: 'mall',
    root: null,
    buffer: RECOVERED_BUFFER,
    baseline: WRL,
  });
  assert.strictEqual(d.open, true);
  assert.strictEqual(d.text, RECOVERED_BUFFER);
  assert.strictEqual(d.dirty, true, 'recovered buffer is dirty vs the disk source');
  // The source file on disk MUST be untouched. That is the load-bearing rule.
  const after = fs.readFileSync(p);
  assert.deepStrictEqual(after, onDisk, 'source file is byte-identical after recovery');
});

// Phase Beta 2 -- an external change to the source between snapshot and
// restore is still safe; the recovered buffer is offered for inspection but
// the source keeps its newer bytes (we DON'T auto-merge).
test('openFromRecovery does not auto-merge when the source changed since the snapshot', () => {
  const dir = tmpDir('ctl-recovery-conflict');
  const p = writeWrl(dir, 'item.wrl', WRL);
  const c = mallController(p);
  const externallyChanged = '#VRML V2.0 utf8\nGroup { children [ EXTERNAL ] }\n';
  fs.writeFileSync(p, externallyChanged);
  const RECOVERED_BUFFER = '#VRML V2.0 utf8\nGroup { children [ USER ] }\n';
  const d = c.openFromRecovery({
    sourcePath: p,
    profile: 'mall-item',
    context: 'mall',
    root: null,
    buffer: RECOVERED_BUFFER,
    baseline: WRL,
  });
  assert.strictEqual(d.dirty, true, 'the recovered buffer is still flagged dirty');
  assert.strictEqual(d.text, RECOVERED_BUFFER);
  // No merge: disk kept its external bytes.
  assert.strictEqual(fs.readFileSync(p, 'utf8'), externallyChanged);
});

// Phase Beta 2 -- gzip source round-trips through openFromRecovery transparently.
test('openFromRecovery keeps gzip format intact (no silent conversion to plain)', () => {
  const dir = tmpDir('ctl-recovery-gzip');
  const p = writeWrl(dir, 'item.wrl', WRL, true /* gzip */);
  const onDisk = fs.readFileSync(p);
  const c = mallController(p);
  const RECOVERED_BUFFER = '#VRML V2.0 utf8\nGroup { children [ GZ ] }\n';
  const d = c.openFromRecovery({
    sourcePath: p, profile: 'mall-item', context: 'mall', root: null,
    buffer: RECOVERED_BUFFER, baseline: WRL,
  });
  assert.strictEqual(d.format, 'gzip', 'format is gzip, NEVER silently plain');
  assert.deepStrictEqual(fs.readFileSync(p), onDisk, 'source untouched');
});
